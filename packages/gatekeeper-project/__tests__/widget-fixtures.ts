// Seeding a project the Worker's own fetch handler will find.
//
// Shared by the two suites that drive widgets over HTTP, and shared rather than copied for one
// reason that matters: the Durable Object is keyed by sharing domain and project id exactly as the
// handler keys it. A suite that seeded a differently-named object would pass while proving nothing
// about the route, and a second copy of that naming is a second chance to get it wrong.

import { env } from "cloudflare:workers";
import { configuredDomain, domainName } from "../src/domain.js";
import { newId } from "../src/model.js";
import type { ProjectDurableObject } from "../src/project-store.js";
import type { ProjectFileVisibility } from "../src/types.js";

export const testEnv = env as unknown as {
  PROJECT_STORE: DurableObjectNamespace<ProjectDurableObject>;
  PROJECT_FILES: R2Bucket;
  PUBLIC_BASE_URL: string;
  WIDGET_LOADER?: WorkerLoader;
};

export const alice = { memberId: "alice", displayName: "Alice" };
export const bob = { memberId: "bob", displayName: "Bob" };

export type Store = DurableObjectStub<ProjectDurableObject>;

/** A project with Alice and Bob in it, in the Durable Object the fetch handler will look in. */
export async function project(): Promise<{ store: Store; projectId: string }> {
  const projectId = newId();
  const store = testEnv.PROJECT_STORE.get(
    testEnv.PROJECT_STORE.idFromName(domainName(configuredDomain(testEnv), projectId)));
  await store.initialize(projectId, "Launch", "", alice);
  const secret = newId();
  await store.commitInvite(alice.memberId, secret, "member", Date.now() + 60_000);
  await store.redeemInvite(secret, bob);
  return { store, projectId };
}

export async function widget(store: Store, opts: {
  path: string;
  name?: string;
  visibility?: ProjectFileVisibility;
  memberId?: string;
}) {
  const memberId = opts.memberId ?? alice.memberId;
  const plan = await store.planWidget(memberId, {
    path: opts.path, ...(opts.visibility ? { visibility: opts.visibility } : {}),
  });
  return store.commitWidget(memberId, {
    widgetId: plan.widgetId,
    name: opts.name ?? "Dashboard",
    path: opts.path,
    description: "",
    visibility: plan.visibility,
  });
}

export async function writeWidgetFile(store: Store, opts: {
  widgetId: string;
  path: string;
  content: string;
  mimeType?: string;
  memberId?: string;
}) {
  const memberId = opts.memberId ?? alice.memberId;
  const bytes = new TextEncoder().encode(opts.content);
  await store.planWidgetFile(memberId, opts.widgetId, { path: opts.path, size: bytes.byteLength });
  const contentKey = newId();
  await testEnv.PROJECT_FILES.put(contentKey, bytes);
  return store.commitWidgetFile(memberId, {
    widgetId: opts.widgetId,
    contentKey,
    path: opts.path,
    mimeType: opts.mimeType ?? "text/html",
    size: bytes.byteLength,
  });
}

/** A project file, for the suites that compare the widget route against the file route. */
export async function file(store: Store, opts: {
  path: string;
  content: string;
  mimeType: string;
  visibility: ProjectFileVisibility;
  memberId?: string;
}) {
  const memberId = opts.memberId ?? alice.memberId;
  const bytes = new TextEncoder().encode(opts.content);
  const plan = await store.planWrite(memberId, {
    path: opts.path, size: bytes.byteLength, visibility: opts.visibility,
  });
  const contentKey = newId();
  await testEnv.PROJECT_FILES.put(contentKey, bytes);
  return store.commitWrite(memberId, {
    fileId: plan.fileId,
    contentKey,
    path: opts.path,
    mimeType: opts.mimeType,
    size: bytes.byteLength,
    visibility: plan.visibility,
    description: "",
    indexedText: "",
  });
}

/** The `set-cookie` value a response offers, as a browser would send it back. */
export function cookieOf(response: Response): string {
  const header = response.headers.get("set-cookie")!;
  return header.slice(0, header.indexOf(";"));
}
