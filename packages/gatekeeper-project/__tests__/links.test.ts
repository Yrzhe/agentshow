import { describe, expect, it } from "vitest";
import {
  ROUTE_PREFIX,
  baseUrl,
  fileUrl,
  parseFileUrl,
  parseProjectUrl,
  parseWidgetUrl,
  projectUrl,
  projectUrlPattern,
  publicOrigin,
  widgetApiUrl,
  widgetUrl,
} from "../src/links.js";

const env = { PUBLIC_BASE_URL: "https://os.example.com" };
const projectId = "a".repeat(32);
const fileId = "b".repeat(32);
const widgetId = "c".repeat(32);

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

describe("widget links", () => {
  it("ends in a slash, because a widget is a directory rather than a document", () => {
    // Without it a browser would resolve the widget's own `app.js` one level up, outside the widget.
    const url = widgetUrl(env, projectId, widgetId);
    expect(url).toBe(`https://os.example.com${ROUTE_PREFIX}/w/${projectId}/${widgetId}/`);
    expect(widgetApiUrl(env, projectId, widgetId)).toBe(`${url}api/`);
    expect(parseWidgetUrl(env, url))
      .toEqual({ projectId, widgetId, assetPath: "", api: false });
  });

  it("reads the widget's root the same with or without the slash, and with a token", () => {
    for (const url of [
      widgetUrl(env, projectId, widgetId),
      `${ROUTE_PREFIX}/w/${projectId}/${widgetId}`,
      `${widgetUrl(env, projectId, widgetId)}?t=abc.123.def`,
    ]) {
      expect(parseWidgetUrl(env, url)).toEqual({ projectId, widgetId, assetPath: "", api: false });
    }
  });

  it("keeps the path inside the widget, at any depth", () => {
    expect(parseWidgetUrl(env, `${widgetUrl(env, projectId, widgetId)}assets/app.js`))
      .toEqual({ projectId, widgetId, assetPath: "assets/app.js", api: false });
  });

  it("separates the backend's routes from the widget's files", () => {
    const url = widgetUrl(env, projectId, widgetId);
    expect(parseWidgetUrl(env, `${url}api/todos/7`))
      .toEqual({ projectId, widgetId, assetPath: "todos/7", api: true });
    // `api` on its own, with or without a slash, is still the backend rather than a file called api.
    expect(parseWidgetUrl(env, `${url}api`))
      .toEqual({ projectId, widgetId, assetPath: "", api: true });
    expect(parseWidgetUrl(env, `${url}api/`))
      .toEqual({ projectId, widgetId, assetPath: "", api: true });
  });

  it("declines a traversal, a malformed id, and the other routes", () => {
    const url = widgetUrl(env, projectId, widgetId);
    // The tail here is attacker-supplied, so this is the one route where traversal has to be
    // refused rather than normalized away.
    expect(parseWidgetUrl(env, `${url}../../f/${projectId}/${fileId}`)).toBe(null);
    expect(parseWidgetUrl(env, `${url}assets/../../../etc`)).toBe(null);
    expect(parseWidgetUrl(env, `${ROUTE_PREFIX}/w/${projectId}/nope/index.html`)).toBe(null);
    expect(parseWidgetUrl(env, `${ROUTE_PREFIX}/w/${projectId}`)).toBe(null);
    expect(parseWidgetUrl(env, projectUrl(env, projectId))).toBe(null);
    expect(parseWidgetUrl(env, fileUrl(env, projectId, fileId))).toBe(null);
  });

  it("leaves the file and project routes reading exactly as they did", () => {
    // Widget addresses keep their trailing slash and the others do not, so this is worth stating.
    expect(parseFileUrl(env, `${fileUrl(env, projectId, fileId)}/`)).toEqual({ projectId, fileId });
    expect(parseProjectUrl(env, `${projectUrl(env, projectId)}/`)).toBe(projectId);
  });
});
