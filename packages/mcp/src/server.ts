import type Database from 'better-sqlite3'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import type {
  DeleteNoteInput,
  DeleteNoteOutput,
  GetNotesInput,
  GetNotesOutput,
  GetPeersAllOutput,
  GetPeersInput,
  GetPeersOutput,
  GetProjectHistoryInput,
  GetProjectHistoryOutput,
  RegisterStatusInput,
  RegisterStatusOutput,
  ShareNoteInput,
  ShareNoteOutput,
} from '@agentshow/shared'
import { updateSession } from './db/queries.js'
import { registerCleanupHooks } from './lifecycle/cleanup.js'
import { handleGetPeers } from './tools/get-peers.js'
import {
  handleDeleteNote,
  handleGetNotes,
  handleShareNote,
} from './tools/notes.js'
import { handleGetProjectHistory } from './tools/project-history.js'
import { handleRegisterStatus } from './tools/register-status.js'

type ToolSchema = {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
}

type ToolDefinition = {
  name: string
  description: string
  inputSchema: ToolSchema
  handler: (
    input: Record<string, unknown>,
    ctx: { db: Database.Database; sessionId: string | null; projectId: string | null },
  ) =>
    | RegisterStatusOutput
    | GetPeersOutput
    | GetPeersAllOutput
    | ShareNoteOutput
    | GetNotesOutput
    | DeleteNoteOutput
    | GetProjectHistoryOutput
}

const toolDefinitions: ToolDefinition[] = [
  {
    name: 'register_status',
    description: 'Register or update what this session is working on. Call at the start of each task.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string' },
        task: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
      },
    },
    handler: (input, ctx) => handleRegisterStatus(input as RegisterStatusInput, ctx),
  },
  {
    name: 'get_peers',
    description: 'See what other agent sessions are doing, either in this project or across all projects.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['all'] },
        project: { type: 'string' },
      },
    },
    handler: (input, ctx) => handleGetPeers(input as GetPeersInput, ctx),
  },
  {
    name: 'share_note',
    description: 'Share a finding or decision with other sessions in this project. Same key = update.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['key', 'content'],
    },
    handler: (input, ctx) => handleShareNote(input as ShareNoteInput, ctx),
  },
  {
    name: 'get_notes',
    description: 'Read shared notes from this or another project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        since: { type: 'string' },
        search: { type: 'string' },
      },
    },
    handler: (input, ctx) => handleGetNotes(input as GetNotesInput, ctx),
  },
  {
    name: 'delete_note',
    description: 'Delete a shared note by key.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
      },
      required: ['key'],
    },
    handler: (input, ctx) => handleDeleteNote(input as DeleteNoteInput, ctx),
  },
  {
    name: 'get_project_history',
    description: 'View past session summaries and notes for a project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        since: { type: 'string' },
        search: { type: 'string' },
      },
    },
    handler: (input, ctx) =>
      handleGetProjectHistory(input as GetProjectHistoryInput, ctx),
  },
]

const serverInstructions = `You have AgentShow installed - a local coordination system for multi-session collaboration.

When the user asks about active sessions, other agents, project status, or shared notes, use the agentshow tools:
- register_status: Register what you're working on (call this at the start of each new task)
- get_peers: See what other sessions are doing
- share_note / get_notes: Share findings with other sessions
- get_project_history: View past session activity

Always call register_status with your cwd before using other agentshow tools.`

export function createAgentShowServer(db: Database.Database): Server {
  const server = new Server(
    {
      name: 'agentshow',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: serverInstructions,
    },
  )

  let sessionId: string | null = null
  let projectId: string | null = null
  let projectName: string | null = null

  registerCleanupHooks(
    db,
    () => sessionId,
    () =>
      projectId && projectName
        ? {
            id: projectId,
            name: projectName,
          }
        : null,
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolDefinitions.find((candidate) => candidate.name === request.params.name)

    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`)
    }

    const input = (request.params.arguments ?? {}) as Record<string, unknown>
    const output = tool.handler(input, { db, sessionId, projectId })

    if (tool.name === 'register_status') {
      const registerOutput = output as RegisterStatusOutput
      sessionId = registerOutput.session_id
      projectId = registerOutput.project_id
      projectName = registerOutput.project_name
    } else if (sessionId) {
      updateSession(db, sessionId, {
        last_heartbeat: new Date().toISOString(),
      })
    }

    return toToolResult(output)
  })

  return server
}

function toToolResult(output: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(output, null, 2),
      },
    ],
    structuredContent: output as Record<string, unknown>,
  }
}
