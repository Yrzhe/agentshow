// The agent-facing API of the Project Gatekeeper. This file is the only documentation an agent
// gets, so each comment describes what a method does and what it returns -- never how the
// gatekeeper implements it.
//
// `types-code.ts` carries a copy of everything below as a string, because `getTypeScriptTypes()`
// has to return it at runtime. `scripts/gatekeeper-types.test.ts` fails when the two drift.

/** How widely a project file is visible. */
export type ProjectFileVisibility =
  /** Only you can read it, even though it lives in the project. */
  | "private"
  /** Every member of the project can read it. */
  | "project"
  /** Anyone who can reach this deployment and holds the file's link can read it. */
  | "public";

/** What a member may do in a project. Owners can also remove members and revoke invites. */
export type ProjectRole = "owner" | "member";

/** A project you belong to. */
export interface ProjectSummary {
  projectId: string;
  name: string;
  description: string;
  /** Your own role in this project. */
  role: ProjectRole;
  memberCount: number;
  /** Files you can see: your own, plus everything shared with the project. */
  fileCount: number;
  /** Address of the project. Paste it into a chat to introduce only this project to an agent. */
  url: string;
}

/** Someone who has joined a project. */
export interface ProjectMember {
  memberId: string;
  /** The name this member chose for themselves; empty until they set one. */
  displayName: string;
  role: ProjectRole;
  joined: string;
}

/**
 * Where a comment is attached inside a file. `file` comments apply to the whole document, `page`
 * comments to one page of a paginated document, and `text` comments to a character range.
 */
export type ProjectCommentAnchor =
  | { kind: "file" }
  | { kind: "page"; page: number }
  | { kind: "text"; start: number; end: number; quote: string };

/** A comment written by a project member. */
export interface ProjectComment {
  commentId: string;
  fileId: string;
  authorId: string;
  authorName: string;
  body: string;
  anchor: ProjectCommentAnchor;
  /** Set when this comment replies to another one. */
  replyTo?: string;
  resolved: boolean;
  created: string;
}

/** A file in a project. */
export interface ProjectFileSummary {
  fileId: string;
  /** Slash-separated path within the project. Paths under `shared/` are visible to every member. */
  path: string;
  name: string;
  mimeType: string;
  /** Size of the stored bytes. */
  size: number;
  visibility: ProjectFileVisibility;
  ownerId: string;
  ownerName: string;
  description: string;
  /** Set when the file is a skill, in which case this is the name the skill is invoked by. */
  skillName?: string;
  /** Whether you may overwrite this file. Only a file's owner may. */
  writable: boolean;
  commentCount: number;
  updated: string;
  /** Address of the file, for humans to open and for `readFile()` callers to quote. */
  url: string;
}

/** A file together with its contents. */
export interface ProjectFileContent extends ProjectFileSummary {
  /**
   * The text of a text file, or a `data:` URI for a binary one. Character offsets in a `text`
   * comment anchor count from the start of this string.
   */
  content: string;
}

/** One search hit. */
export interface ProjectFileMatch {
  file: ProjectFileSummary;
  /** The part of the file that matched, for deciding whether to read the whole thing. */
  snippet: string;
}

/** A shared configuration value. Read its contents with `getEnvVar()`. */
export interface ProjectEnvVar {
  name: string;
  description: string;
  updatedBy: string;
  updated: string;
}

/** An invitation that lets someone else join the project. */
export interface ProjectInvite {
  /**
   * Give this to the person you are inviting; they pass it to `joinProject()`. It works once you
   * have confirmed making it, and is as good as a password until it expires.
   */
  code: string;
  role: ProjectRole;
  expires: string;
}

/**
 * A membership change you have asked for.
 *
 * Joining or starting a project waits for you to confirm it, so the project is not open yet when
 * one of these comes back. Call `listProjects()` afterwards to work in it.
 */
export interface ProjectRequest {
  projectId: string;
  url: string;
  /** Always true, as a reminder that this project cannot be opened yet. */
  pending: true;
}

/** What to write in `writeFile()`. */
export interface ProjectFileWrite {
  /** Where to put the file. A path under `shared/` defaults to project-wide visibility. */
  path: string;
  /** Text, or a `data:` URI to store bytes. */
  content: string;
  /** Defaults to a type inferred from the path. */
  mimeType?: string;
  /** What the file covers, shown to members and to agents deciding whether to read it. */
  description?: string;
  /** Defaults to `project` under `shared/` and `private` anywhere else. */
  visibility?: ProjectFileVisibility;
  /** Register the file as a skill under this name. */
  skillName?: string;
  /** Overwrite this existing file of yours instead of creating a new one. */
  fileId?: string;
}

/**
 * One project's shared workspace: its members, the files they share, the comments on those files,
 * the skills the project has agreed on, and its shared configuration.
 *
 * Files you write are yours. You can read anything shared with the project but you can only
 * overwrite your own files -- use `copyFile()` to start your own copy of someone else's.
 */
export interface ProjectWorkspace {
  /** The project itself. */
  info(): Promise<ProjectSummary>;

  /** Everyone who has joined. */
  listMembers(): Promise<ProjectMember[]>;

  /** Create an invitation code. Only an owner may invite. */
  createInvite(opts?: { role?: ProjectRole; expiresInDays?: number }): Promise<ProjectInvite>;

  /** Remove a member and their invitations. Only an owner may, and never themselves. */
  removeMember(memberId: string): Promise<void>;

  /** Files you can see, newest first. */
  listFiles(opts?: {
    /** Restrict to files whose path starts with this prefix. */
    pathPrefix?: string;
    /** Restrict to one member's files. */
    ownerId?: string;
    /** Restrict to files at this visibility. */
    visibility?: ProjectFileVisibility;
    /** Return only skills. */
    skillsOnly?: boolean;
    limit?: number;
  }): Promise<ProjectFileSummary[]>;

  /** Full-text search over the files you can see. */
  searchFiles(query: string, opts?: { limit?: number }): Promise<ProjectFileMatch[]>;

  /** Read one file. Throws if it does not exist or is not shared with you. */
  readFile(fileId: string): Promise<ProjectFileContent>;

  /**
   * Create one of your files, or overwrite one you already own. Throws when `fileId` names
   * someone else's file, or when the path is already taken by one; copy it instead.
   */
  writeFile(file: ProjectFileWrite): Promise<ProjectFileSummary>;

  /** Copy any file you can read into a new file of your own, so you can change it. */
  copyFile(fileId: string, opts: { path: string; description?: string }): Promise<ProjectFileSummary>;

  /**
   * Move or rename one of your files.
   *
   * The path decides who can see it: moving a file into `shared/` shares it with the project, and
   * moving it back out makes it private again. A public file stays public wherever it is moved.
   */
  moveFile(fileId: string, path: string): Promise<ProjectFileSummary>;

  /** Change who can see one of your files. */
  setFileVisibility(
    fileId: string,
    visibility: ProjectFileVisibility,
  ): Promise<ProjectFileSummary>;

  /** Delete one of your files, and its comments with it. A project owner may delete any file. */
  deleteFile(fileId: string): Promise<void>;

  /**
   * A link to a file's contents. Public files get a stable link anyone can open; every other file
   * gets one that expires, and only works for people the file is shared with.
   */
  getFileLink(fileId: string): Promise<{ url: string; expires: string | null }>;

  /**
   * Comments on one file, oldest first, or on every file you can see when `fileId` is omitted.
   * Comments are only ever visible to project members, including comments on public files.
   */
  listComments(fileId?: string): Promise<ProjectComment[]>;

  /** Comment on a file. Anchor it to a page or a character range to be specific. */
  addComment(
    fileId: string,
    body: string,
    opts?: { anchor?: ProjectCommentAnchor; replyTo?: string },
  ): Promise<ProjectComment>;

  /** Mark a comment settled. Its author, the file's owner, and a project owner may. */
  resolveComment(commentId: string): Promise<void>;

  /** The project's skills: instruction documents members have agreed to share. */
  listSkills(): Promise<ProjectFileSummary[]>;

  /** The names of the project's shared configuration values, without their contents. */
  listEnvVars(): Promise<ProjectEnvVar[]>;

  /** The contents of one shared configuration value. */
  getEnvVar(name: string): Promise<string>;

  /** Set a shared configuration value. Any member may. */
  setEnvVar(name: string, value: string, description?: string): Promise<void>;

  /** Delete a shared configuration value. */
  deleteEnvVar(name: string): Promise<void>;
}

/**
 * Your projects.
 *
 * A project is a place to share files, comments, skills and configuration with other people. It
 * shares none of your chats: everyone works with their own agent and sees only what the project
 * holds.
 */
export interface ProjectDirectory {
  /** Every project you belong to. */
  listProjects(): Promise<ProjectSummary[]>;

  /** Start a project. You become its owner. */
  createProject(opts: { name: string; description?: string }): Promise<ProjectRequest>;

  /** Join a project using a code someone gave you. */
  joinProject(code: string, opts?: { displayName?: string }): Promise<ProjectRequest>;

  /** Open one of your projects. */
  openProject(projectId: string): Promise<ProjectWorkspace>;

  /** Choose the name other members see on your files and comments. */
  setDisplayName(displayName: string): Promise<void>;
}
