// The Worker's HTTP surface: what a person gets when they open a link.
//
// This is the one path with no member identity behind it, so it is also the one where a mistake is
// served to whoever holds the URL. What it has to get right is which files it hands over at all, and
// what a browser is allowed to do with the bytes once it has them.

import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { configuredDomain, domainName } from "../src/domain.js";
import { fileUrl, projectUrl } from "../src/links.js";
import { newId } from "../src/model.js";
import type { ProjectDurableObject } from "../src/project-store.js";
import type { ProjectFileVisibility } from "../src/types.js";

const testEnv = env as unknown as {
  PROJECT_STORE: DurableObjectNamespace<ProjectDurableObject>;
  PROJECT_FILES: R2Bucket;
  PUBLIC_BASE_URL: string;
  PROJECT_SHARING_DOMAIN: string;
};

const alice = { memberId: "alice", displayName: "Alice" };

/**
 * A project holding one file, in the Durable Object the fetch handler will look in.
 *
 * Keyed exactly as the handler keys it -- by sharing domain and project id -- because a test that
 * seeded a differently-named object would pass while proving nothing about the route.
 */
async function hostedFile(opts: {
  path: string;
  content: string;
  mimeType: string;
  visibility: ProjectFileVisibility;
}) {
  const projectId = newId();
  const name = domainName(configuredDomain(testEnv), projectId);
  const store = testEnv.PROJECT_STORE.get(testEnv.PROJECT_STORE.idFromName(name));
  await store.initialize(projectId, "Launch", "", alice);

  const bytes = new TextEncoder().encode(opts.content);
  const plan = await store.planWrite(alice.memberId, {
    path: opts.path, size: bytes.byteLength, visibility: opts.visibility,
  });
  const contentKey = newId();
  await testEnv.PROJECT_FILES.put(contentKey, bytes);
  const file = await store.commitWrite(alice.memberId, {
    fileId: plan.fileId,
    contentKey,
    path: opts.path,
    mimeType: opts.mimeType,
    size: bytes.byteLength,
    visibility: plan.visibility,
    description: "",
    indexedText: "",
  });
  return { store, projectId, file, url: fileUrl(testEnv, projectId, file.fileId) };
}

describe("serving a file", () => {
  it("does not let a public file run as this deployment", async () => {
    // The dangerous shape: HTML a member published, displayed inline, under the origin the Workshop
    // itself answers on and behind the same Access session.
    const { url } = await hostedFile({
      path: "shared/post.html",
      content: "<script>fetch('/api/steal')</script>",
      mimeType: "text/html",
      visibility: "public",
    });
    const response = await SELF.fetch(url);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    // The type is still the honest one, and still not sniffable into something else.
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toMatch(/^inline; filename\*=UTF-8''/);
    expect(await response.text()).toBe("<script>fetch('/api/steal')</script>");
  });

  it("sandboxes an SVG too, which is markup that browsers will run", async () => {
    const { url } = await hostedFile({
      path: "shared/logo.svg",
      content: "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
      mimeType: "image/svg+xml",
      visibility: "public",
    });
    const response = await SELF.fetch(url);

    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("refuses a project-visible file without a token, and serves it with one", async () => {
    const { store, file, url } = await hostedFile({
      path: "shared/plan.md",
      content: "the plan",
      mimeType: "text/markdown",
      visibility: "project",
    });

    const refused = await SELF.fetch(url);
    expect(refused.status).toBe(404);
    expect(await refused.text()).toMatch(/does not exist, or is not shared with you/);

    const link = await store.mintLink(alice.memberId, file.fileId);
    const signed = await SELF.fetch(link.url);
    expect(signed.status).toBe(200);
    expect(await signed.text()).toBe("the plan");
    // Held by whoever has the link until it expires, so nothing in between may keep a copy.
    expect(signed.headers.get("cache-control")).toBe("private, no-store");
    expect(signed.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");

    // A token is a claim about one file, so it does not travel to another.
    const elsewhere = await hostedFile({
      path: "shared/other.md", content: "other", mimeType: "text/markdown", visibility: "project",
    });
    const token = new URL(link.url).searchParams.get("t")!;
    const moved = await SELF.fetch(`${elsewhere.url}?t=${encodeURIComponent(token)}`);
    expect(moved.status).toBe(404);
  });
});

describe("other routes", () => {
  it("tells someone what a project link is without naming the project", async () => {
    const response = await SELF.fetch(projectUrl(testEnv, newId()));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toMatch(/link to a shared project/);
    expect(body).toMatch(/only visible to the people who have\s+joined it/);
  });

  it("answers 404 for a path that names nothing, and 405 for a write", async () => {
    expect((await SELF.fetch(`${testEnv.PUBLIC_BASE_URL}/gatekeeper/project/nonsense`)).status)
      .toBe(404);
    const posted = await SELF.fetch(projectUrl(testEnv, newId()), { method: "POST" });
    expect(posted.status).toBe(405);
    expect(posted.headers.get("allow")).toBe("GET, HEAD");
  });
});
