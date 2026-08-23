import { describe, expect, it } from "vitest";
import {
  ROUTE_PREFIX,
  baseUrl,
  fileUrl,
  parseFileUrl,
  parseProjectUrl,
  projectUrl,
  projectUrlPattern,
  publicOrigin,
} from "../src/links.js";

const env = { PUBLIC_BASE_URL: "https://os.example.com" };
const projectId = "a".repeat(32);
const fileId = "b".repeat(32);

describe("origins", () => {
  it("uses the configured origin, without a trailing slash", () => {
    expect(publicOrigin({ PUBLIC_BASE_URL: "https://os.example.com/" }))
      .toBe("https://os.example.com");
    expect(baseUrl(env)).toBe(`https://os.example.com${ROUTE_PREFIX}`);
  });

  it("falls back to the local origin when nothing configured one", () => {
    expect(publicOrigin({})).toBe("http://localhost:8787");
    expect(publicOrigin({ PUBLIC_BASE_URL: "" })).toBe("http://localhost:8787");
  });

  it("sits under the path the router forwards, which the binding name fixes", () => {
    expect(ROUTE_PREFIX).toBe("/gatekeeper/project");
  });
});

describe("project links", () => {
  it("round-trips", () => {
    const url = projectUrl(env, projectId);
    expect(url).toBe(`https://os.example.com${ROUTE_PREFIX}/p/${projectId}`);
    expect(parseProjectUrl(env, url)).toBe(projectId);
  });

  it("accepts the same path pasted from another host", () => {
    // People paste from a preview host or an alias, and the ids are unguessable anyway.
    expect(parseProjectUrl(env, `https://preview.example.net${ROUTE_PREFIX}/p/${projectId}`))
      .toBe(projectId);
    expect(parseProjectUrl(env, `${ROUTE_PREFIX}/p/${projectId}`)).toBe(projectId);
    expect(parseProjectUrl(env, `${ROUTE_PREFIX}/p/${projectId}/`)).toBe(projectId);
  });

  it("declines a file link, a malformed id, and anything off the route", () => {
    expect(parseProjectUrl(env, fileUrl(env, projectId, fileId))).toBe(null);
    expect(parseProjectUrl(env, `${ROUTE_PREFIX}/p/not-an-id`)).toBe(null);
    expect(parseProjectUrl(env, `${ROUTE_PREFIX}/p/${projectId.toUpperCase()}`)).toBe(null);
    expect(parseProjectUrl(env, `/gatekeeper/context/p/${projectId}`)).toBe(null);
    expect(parseProjectUrl(env, "not a url at all")).toBe(null);
  });

  it("advertises the one resource shape it answers for", () => {
    expect(projectUrlPattern(env)).toBe(`https://os.example.com${ROUTE_PREFIX}/p/:projectId`);
  });
});

describe("file links", () => {
  it("round-trips", () => {
    const url = fileUrl(env, projectId, fileId);
    expect(url).toBe(`https://os.example.com${ROUTE_PREFIX}/f/${projectId}/${fileId}`);
    expect(parseFileUrl(env, url)).toEqual({ projectId, fileId });
  });

  it("keeps parsing when a signed token is appended", () => {
    expect(parseFileUrl(env, `${fileUrl(env, projectId, fileId)}?t=abc.123`))
      .toEqual({ projectId, fileId });
  });

  it("declines a project link and a half-formed file path", () => {
    expect(parseFileUrl(env, projectUrl(env, projectId))).toBe(null);
    expect(parseFileUrl(env, `${ROUTE_PREFIX}/f/${projectId}`)).toBe(null);
    expect(parseFileUrl(env, `${ROUTE_PREFIX}/f/${projectId}/nope`)).toBe(null);
  });
});
