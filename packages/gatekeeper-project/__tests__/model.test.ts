import { describe, expect, it } from "vitest";
import {
  ProjectError,
  canDelete,
  canRead,
  canWrite,
  decodeContent,
  defaultVisibility,
  encodeContent,
  fileSets,
  formatInviteCode,
  inferMimeType,
  indexedText,
  isTextLike,
  normalizePath,
  parseAnchor,
  parseEnvVarName,
  parseInviteCode,
  parseLimit,
  parseSet,
  projectSet,
  snippet,
  visibilityAfterMove,
} from "../src/model.js";
import type { ProjectFileSummary } from "../src/types.js";

/** A file summary with only the fields the rule under test looks at. */
function file(fields: Partial<ProjectFileSummary>): ProjectFileSummary {
  return {
    fileId: "f1", path: "notes.md", name: "notes.md", mimeType: "text/markdown", size: 0,
    visibility: "private", ownerId: "alice", ownerName: "Alice", description: "",
    writable: true, commentCount: 0, updated: "", url: "",
    ...fields,
  };
}

describe("paths", () => {
  it("converges the spellings that would otherwise collide", () => {
    expect(normalizePath("shared/notes.md")).toBe("shared/notes.md");
    expect(normalizePath("/shared/notes.md")).toBe("shared/notes.md");
    expect(normalizePath("shared//notes.md/")).toBe("shared/notes.md");
    expect(normalizePath(" shared / notes.md ")).toBe("shared/notes.md");
    expect(normalizePath("./shared/./notes.md")).toBe("shared/notes.md");
  });

  it("refuses traversal, control characters and backslashes", () => {
    expect(() => normalizePath("shared/../secret.md")).toThrow(ProjectError);
    expect(() => normalizePath("shared\\notes.md")).toThrow(ProjectError);
    expect(() => normalizePath("shared/no\u0000tes.md")).toThrow(ProjectError);
  });

  it("refuses a path that normalizes away to nothing", () => {
    expect(() => normalizePath("/")).toThrow(ProjectError);
    expect(() => normalizePath("  ")).toThrow(ProjectError);
    expect(() => normalizePath(42)).toThrow(ProjectError);
  });

  it("refuses a path longer than the limit", () => {
    expect(() => normalizePath("a".repeat(513))).toThrow(/512/);
  });
});

describe("visibility", () => {
  it("reads a shared/ path as the intent to share", () => {
    expect(defaultVisibility("shared/notes.md")).toBe("project");
    expect(defaultVisibility("shared")).toBe("project");
    expect(defaultVisibility("notes.md")).toBe("private");
    // Not a prefix match on the bare word: only the directory shares.
    expect(defaultVisibility("shared-notes.md")).toBe("private");
    expect(defaultVisibility("mine/shared/notes.md")).toBe("private");
  });

  it("follows a move in and out of shared/", () => {
    expect(visibilityAfterMove("private", "shared/notes.md")).toBe("project");
    expect(visibilityAfterMove("project", "mine/notes.md")).toBe("private");
  });

  it("keeps a public file public wherever it is moved", () => {
    expect(visibilityAfterMove("public", "mine/notes.md")).toBe("public");
    expect(visibilityAfterMove("public", "shared/notes.md")).toBe("public");
  });
});

describe("permissions", () => {
  const alice = { memberId: "alice", isMember: true };
  const bob = { memberId: "bob", isMember: true };
  const stranger = { memberId: "carol", isMember: false };

  it("lets a member read project files and their own private ones", () => {
    expect(canRead("project", "alice", bob)).toBe(true);
    expect(canRead("private", "alice", alice)).toBe(true);
    expect(canRead("private", "alice", bob)).toBe(false);
  });

  it("keeps everything but public files from a non-member", () => {
    expect(canRead("public", "alice", stranger)).toBe(true);
    expect(canRead("project", "alice", stranger)).toBe(false);
    expect(canRead("private", "carol", stranger)).toBe(false);
  });

  it("lets only a file's owner overwrite it, project owners included", () => {
    expect(canWrite("alice", "alice")).toBe(true);
    expect(canWrite("alice", "bob")).toBe(false);
  });

  it("lets a project owner delete someone else's file, to moderate", () => {
    expect(canDelete("alice", { memberId: "bob", role: "owner" })).toBe(true);
    expect(canDelete("alice", { memberId: "bob", role: "member" })).toBe(false);
    expect(canDelete("alice", { memberId: "alice", role: "member" })).toBe(true);
  });
});

describe("content", () => {
  it("infers a type from the path when the caller supplies none", () => {
    expect(inferMimeType("shared/notes.md")).toBe("text/markdown");
    expect(inferMimeType("shared/CHART.PNG")).toBe("image/png");
    expect(inferMimeType("shared/data")).toBe("application/octet-stream");
  });

  it("agrees with itself about what counts as text", () => {
    expect(isTextLike("text/markdown")).toBe(true);
    expect(isTextLike("application/json")).toBe(true);
    expect(isTextLike("image/svg+xml")).toBe(false);
    expect(isTextLike("application/pdf")).toBe(false);
  });

  it("round-trips text through decode and encode", () => {
    const { bytes } = decodeContent("# Notes\n", undefined);
    expect(encodeContent(bytes, "text/markdown")).toBe("# Notes\n");
  });

  it("round-trips bytes through a base64 data URI", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const { bytes, mimeType } = decodeContent(png, undefined);
    expect(mimeType).toBe("image/png");
    expect(encodeContent(bytes, "image/png")).toBe(png);
  });

  it("lets an explicit type win over the one the data URI declares", () => {
    expect(decodeContent("data:text/plain,hi", "text/markdown").mimeType).toBe("text/markdown");
  });

  it("refuses content that is not a string, or base64 that is not", () => {
    expect(() => decodeContent(42, undefined)).toThrow(ProjectError);
    expect(() => decodeContent("data:image/png;base64,!!!", undefined)).toThrow(/base64/);
  });

  it("indexes text only, and only up to the cap", () => {
    expect(indexedText(new TextEncoder().encode("hello"), "text/plain")).toBe("hello");
    expect(indexedText(new Uint8Array([1, 2, 3]), "application/pdf")).toBe("");
    const long = new TextEncoder().encode("x".repeat(100 * 1024));
    expect(indexedText(long, "text/plain").length).toBe(64 * 1024);
  });
});

describe("comment anchors", () => {
  it("defaults to the whole file", () => {
    expect(parseAnchor(undefined)).toEqual({ kind: "file" });
    expect(parseAnchor(null)).toEqual({ kind: "file" });
    expect(parseAnchor({ kind: "file" })).toEqual({ kind: "file" });
  });

  it("takes a page number of one or more", () => {
    expect(parseAnchor({ kind: "page", page: 3 })).toEqual({ kind: "page", page: 3 });
    expect(() => parseAnchor({ kind: "page", page: 0 })).toThrow(ProjectError);
    expect(() => parseAnchor({ kind: "page" })).toThrow(ProjectError);
  });

  it("takes a character range, and insists on the quoted text", () => {
    expect(parseAnchor({ kind: "text", start: 4, end: 9, quote: "Notes" }))
      .toEqual({ kind: "text", start: 4, end: 9, quote: "Notes" });
    // An empty range is a caret, which is a legitimate place to attach a note.
    expect(parseAnchor({ kind: "text", start: 4, end: 4, quote: "N" }))
      .toMatchObject({ start: 4, end: 4 });
    expect(() => parseAnchor({ kind: "text", start: 9, end: 4, quote: "Notes" }))
      .toThrow(ProjectError);
    expect(() => parseAnchor({ kind: "text", start: 4, end: 9 })).toThrow(/quoted text/);
  });

  it("refuses an unknown kind", () => {
    expect(() => parseAnchor({ kind: "line", line: 2 })).toThrow(ProjectError);
    expect(() => parseAnchor("file")).toThrow(ProjectError);
  });
});

describe("names and limits", () => {
  it("holds configuration names to the shape an environment variable can take", () => {
    expect(parseEnvVarName("API_TOKEN")).toBe("API_TOKEN");
    expect(parseEnvVarName("_private2")).toBe("_private2");
    expect(() => parseEnvVarName("2fast")).toThrow(ProjectError);
    expect(() => parseEnvVarName("api-token")).toThrow(ProjectError);
    expect(() => parseEnvVarName("A".repeat(65))).toThrow(ProjectError);
  });

  it("clamps a limit rather than refusing a large one", () => {
    expect(parseLimit(undefined, 50, 200)).toBe(50);
    expect(parseLimit(500, 50, 200)).toBe(200);
    expect(parseLimit(10, 50, 200)).toBe(10);
    expect(() => parseLimit(0, 50, 200)).toThrow(ProjectError);
  });
});

describe("snippets", () => {
  it("quotes the part that matched", () => {
    const text = `${"a".repeat(400)} findme ${"b".repeat(400)}`;
    const excerpt = snippet(text, "findme");
    expect(excerpt).toContain("findme");
    expect(excerpt.startsWith("...")).toBe(true);
    expect(excerpt.endsWith("...")).toBe(true);
  });

  it("falls back to the beginning when the query is not in the indexed text", () => {
    expect(snippet("short document", "absent")).toBe("short document");
    expect(snippet("", "absent")).toBe("");
  });
});

describe("observation sets", () => {
  it("names the project for anything every member may read", () => {
    expect(projectSet("p1")).toBe("p:p1");
    expect(parseSet("p:p1")).toEqual({ kind: "project", projectId: "p1" });
  });

  it("names one file when its visibility may narrow later", () => {
    expect(parseSet("f:p1:f1")).toEqual({ kind: "file", projectId: "p1", fileId: "f1" });
  });

  it("reveals nothing for a public file: there is no one to keep it from", () => {
    expect(fileSets("p1", [
      file({ fileId: "a", visibility: "public" }),
      file({ fileId: "b", visibility: "project" }),
      file({ fileId: "c", visibility: "private" }),
    ])).toEqual(["f:p1:b", "f:p1:c"]);
  });

  it("rejects a set id it did not mint", () => {
    expect(parseSet("p:")).toBe(null);
    expect(parseSet("f:p1")).toBe(null);
    expect(parseSet("x:p1")).toBe(null);
  });
});

describe("invite codes", () => {
  const projectId = "0".repeat(32);
  const secret = "1".repeat(32);

  it("carries the project, so redeeming one needs no registry", () => {
    const code = formatInviteCode(projectId, secret);
    expect(parseInviteCode(code)).toEqual({ projectId, secret });
    expect(parseInviteCode(` ${code} `)).toEqual({ projectId, secret });
  });

  it("refuses anything that is not one of its own codes", () => {
    expect(() => parseInviteCode("nope")).toThrow(ProjectError);
    expect(() => parseInviteCode(`${projectId}.${secret}.extra`)).toThrow(ProjectError);
    expect(() => parseInviteCode(`${projectId}.short`)).toThrow(ProjectError);
    expect(() => parseInviteCode(undefined)).toThrow(ProjectError);
  });
});
