// Generated from types.d.ts by scripts/gatekeeper-types.ts. Do not edit by hand: run
//   node scripts/gatekeeper-types.ts --write
//
// `getTypeScriptTypes()` returns this at runtime, where the declaration file no longer
// exists. gatekeeper-types.test.ts fails when the two disagree.

const TYPES_CODE = `/** How widely a project file or widget is visible. */
export type ProjectFileVisibility =
  /** Only you can read it, even though it lives in the project. */
  | "private"
  /** Every member of the project can read it. */
  | "project"
  /** Anyone who can reach this deployment and holds the link can read it. */
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
 * Where a comment is attached inside a file. \`file\` comments apply to the whole document, \`page\`
 * comments to one page of a paginated document, and \`text\` comments to a character range.
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
  /** Slash-separated path within the project. Paths under \`shared/\` are visible to every member. */
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
  /** Address of the file, for humans to open and for \`readFile()\` callers to quote. */
  url: string;
}

/** A file together with its contents. */
export interface ProjectFileContent extends ProjectFileSummary {
  /**
   * The text of a text file, or a \`data:\` URI for a binary one. Character offsets in a \`text\`
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

/** A shared configuration value. Read its contents with \`getEnvVar()\`. */
export interface ProjectEnvVar {
  name: string;
  description: string;
  updatedBy: string;
  updated: string;
}

/** An invitation that lets someone else join the project. */
export interface ProjectInvite {
  /**
   * Give this to the person you are inviting; they pass it to \`joinProject()\`. It works once you
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
 * one of these comes back. Call \`listProjects()\` afterwards to work in it.
 */
export interface ProjectRequest {
  projectId: string;
  url: string;
  /** Always true, as a reminder that this project cannot be opened yet. */
  pending: true;
}

/** What to write in \`writeFile()\`. */
export interface ProjectFileWrite {
  /** Where to put the file. A path under \`shared/\` defaults to project-wide visibility. */
  path: string;
  /** Text, or a \`data:\` URI to store bytes. */
  content: string;
  /** Defaults to a type inferred from the path. */
  mimeType?: string;
  /** What the file covers, shown to members and to agents deciding whether to read it. */
  description?: string;
  /** Defaults to \`project\` under \`shared/\` and \`private\` anywhere else. */
  visibility?: ProjectFileVisibility;
  /** Register the file as a skill under this name. */
  skillName?: string;
  /** Overwrite this existing file of yours instead of creating a new one. */
  fileId?: string;
}

/**
 * A widget: a small app published into a project.
 *
 * A widget is \`index.html\` plus whatever assets it needs, and optionally a \`backend.js\` that answers
 * its \`api/\` requests. Opening its link runs it in the browser. Who may open it is the widget's
 * visibility, exactly as it is for a file.
 */
export interface ProjectWidgetSummary {
  widgetId: string;
  name: string;
  /** Slash-separated path within the project. A widget under \`shared/\` is visible to every member. */
  path: string;
  description: string;
  visibility: ProjectFileVisibility;
  ownerId: string;
  ownerName: string;
  /** Whether you may change this widget. Only its owner may. */
  writable: boolean;
  /** How many files the widget holds, its backend included. */
  fileCount: number;
  /** Total bytes of those files. They count against the project's quota like any other file. */
  size: number;
  /** Whether the widget has a \`backend.js\`, and so answers anything under \`api/\`. */
  hasBackend: boolean;
  updated: string;
  /**
   * Address of the widget. A public widget can be opened at this address directly; every other
   * widget needs a link from \`getWidgetLink()\`.
   */
  url: string;
}

/** One file inside a widget. */
export interface ProjectWidgetFile {
  /** Path within the widget, such as \`index.html\` or \`assets/app.js\`. */
  path: string;
  mimeType: string;
  size: number;
  updated: string;
}

/** A widget's file together with its contents. */
export interface ProjectWidgetFileContent extends ProjectWidgetFile {
  /** The text of a text file, or a \`data:\` URI for a binary one. */
  content: string;
}

/**
 * One project's shared workspace: its members, the files they share, the comments on those files,
 * the skills the project has agreed on, its shared configuration, and its widgets.
 *
 * Files you write are yours. You can read anything shared with the project but you can only
 * overwrite your own files -- use \`copyFile()\` to start your own copy of someone else's.
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
   * Create one of your files, or overwrite one you already own. Throws when \`fileId\` names
   * someone else's file, or when the path is already taken by one; copy it instead.
   */
  writeFile(file: ProjectFileWrite): Promise<ProjectFileSummary>;

  /** Copy any file you can read into a new file of your own, so you can change it. */
  copyFile(fileId: string, opts: { path: string; description?: string }): Promise<ProjectFileSummary>;

  /**
   * Move or rename one of your files.
   *
   * The path decides who can see it: moving a file into \`shared/\` shares it with the project, and
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
   * Comments on one file, oldest first, or on every file you can see when \`fileId\` is omitted.
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

  /**
   * The widgets you can see: your own, plus everything shared with the project.
   *
   * A widget is a small app living in the project. It is not a skill and not a gadget: sharing a
   * widget shares an app, not a chat.
   */
  listWidgets(opts?: { limit?: number }): Promise<ProjectWidgetSummary[]>;

  /**
   * Start a widget. It has no files yet, so write at least an \`index.html\` before sharing its link.
   *
   * The path decides who can see it, exactly as it does for a file: a widget under \`shared/\`
   * defaults to project-wide, anywhere else to private.
   */
  createWidget(opts: {
    name: string;
    path: string;
    visibility?: ProjectFileVisibility;
    description?: string;
  }): Promise<ProjectWidgetSummary>;

  /** The files one of your widgets serves. */
  listWidgetFiles(widgetId: string): Promise<ProjectWidgetFile[]>;

  /** Read one file out of a widget. */
  readWidgetFile(widgetId: string, path: string): Promise<ProjectWidgetFileContent>;

  /**
   * Write one file into one of your widgets. Only the widget's owner may.
   *
   * \`index.html\` is what the widget's address serves. Paths under \`api/\` belong to the backend and
   * are refused here, and \`backend.js\` is written with \`setWidgetBackend()\` instead, because code
   * and assets are not the same decision.
   */
  writeWidgetFile(
    widgetId: string,
    path: string,
    content: string,
    mimeType?: string,
  ): Promise<ProjectWidgetFile>;

  /**
   * Give one of your widgets a backend, or replace the one it has.
   *
   * The module is an ordinary Worker module -- \`export default { async fetch(request, env) { ... } }\`
   * -- and it answers everything the widget receives under \`api/\`, with the path it sees starting at
   * \`/api\`. It runs in an isolate of its own, with no access to the internet and none to the project
   * beyond what is in its \`env\`:
   *
   * - every one of the project's shared configuration values, by name, with its contents
   * - \`env.WIDGET\`, which is \`{ projectId, widgetId, principal }\`, where \`principal\` is
   *   \`{ kind: "member", memberId, role }\` for a project member and \`{ kind: "public" }\` for
   *   somebody holding a public widget's link
   * - \`env.STORE\`, a key-value store belonging to this widget alone, with \`get(key)\`,
   *   \`put(key, value)\`, \`delete(key)\` and \`list({ prefix, limit })\`
   *
   * \`WIDGET\` and \`STORE\` are reserved: shared configuration of those names is not passed through.
   *
   * A backend can read shared configuration, so publishing a widget publishes whatever its backend
   * chooses to reveal from it.
   */
  setWidgetBackend(widgetId: string, content: string): Promise<ProjectWidgetFile>;

  /**
   * Move or rename one of your widgets.
   *
   * Like a file, the path decides who can see it: moving a widget into \`shared/\` shares it with the
   * project and moving it back out makes it private. A public widget stays public wherever it goes.
   */
  moveWidget(widgetId: string, path: string): Promise<ProjectWidgetSummary>;

  /**
   * Change who can open one of your widgets.
   *
   * This is the whole share control. \`public\` means anyone who can reach this deployment and holds
   * the widget's link, whether or not they have joined the project; their requests reach the
   * backend as \`{ kind: "public" }\`. Changing it back takes effect at once, including for browsers
   * that already have the widget open.
   */
  setWidgetVisibility(
    widgetId: string,
    visibility: ProjectFileVisibility,
  ): Promise<ProjectWidgetSummary>;

  /**
   * A link that opens a widget. A public widget gets a stable one; every other widget gets one that
   * expires and only works for people the widget is shared with.
   */
  getWidgetLink(widgetId: string): Promise<{ url: string; expires: string | null }>;

  /**
   * Delete a widget, its files and its store. Its owner may; a project owner may too, to moderate.
   */
  deleteWidget(widgetId: string): Promise<void>;

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
`;

export default TYPES_CODE;
