// One Durable Object per widget: the only place a widget may keep anything.
//
// A widget's backend is code a member wrote, running in an isolate this Worker built for it, so the
// question is not what it would like to reach but what it is handed. It is handed this: a key-value
// store that belongs to one widget in one project, and nothing else. Not the project's Durable
// Object, whose methods answer for every member; not the R2 bucket, whose keys address every file
// in the deployment.
//
// The same object is reachable two ways, and the boundary is the same one either way. A backend
// gets the stub straight into its isolate's `env`; a widget with no backend gets the same methods
// over HTTP under its own `api/store` (see `widget-store-api.ts`), which is what makes persistence
// something a widget can have without a Worker Loader and without writing any server code at all.
//
// So these methods are the widget's whole API for persistence, and they are written as an API
// rather than as internals: bounded, and refusing rather than throwing something a widget author
// cannot read.

import { DurableObject } from "cloudflare:workers";
import { ProjectError } from "./model.js";

/** Longest key a widget may use. Long enough to namespace, short enough to keep listings cheap. */
export const MAX_KEY_LENGTH = 512;

/** Largest single value. Durable Object storage allows more; a widget's scratch space needs less. */
export const MAX_VALUE_BYTES = 128 * 1024;

/** How many keys one widget may hold. */
const MAX_KEYS = 1000;

/** Most keys one `list()` returns. */
export const MAX_LIST = 200;

/** What `list()` gives back. Values come with keys because a widget almost always wants both. */
export interface WidgetStoreEntry {
  key: string;
  value: string;
}

export class WidgetStoreDurableObject extends DurableObject<Cloudflare.Env> {
  /** The value stored under `key`, or null. */
  async get(key: string): Promise<string | null> {
    return this.ctx.storage.kv.get<string>(entryKey(checkKey(key))) ?? null;
  }

  /** Store `value` under `key`, replacing whatever was there. */
  async put(key: string, value: string): Promise<void> {
    const name = checkKey(key);
    if (typeof value !== "string") {
      throw new ProjectError("A widget store value must be a string.");
    }
    const size = new TextEncoder().encode(value).byteLength;
    if (size > MAX_VALUE_BYTES) {
      throw new ProjectError(
        `That value is ${size} bytes; a widget store value may be at most ${MAX_VALUE_BYTES}.`);
    }
    const existing = this.ctx.storage.kv.get<string>(entryKey(name));
    if (existing === undefined && this.#count() >= MAX_KEYS) {
      throw new ProjectError(`This widget's store already holds its limit of ${MAX_KEYS} keys.`);
    }
    this.ctx.storage.kv.put(entryKey(name), value);
  }

  async delete(key: string): Promise<void> {
    this.ctx.storage.kv.delete(entryKey(checkKey(key)));
  }

  /** Entries whose key starts with `prefix`, in key order. */
  async list(opts?: { prefix?: string; limit?: number }): Promise<WidgetStoreEntry[]> {
    const prefix = opts?.prefix === undefined ? "" : checkKey(opts.prefix, { allowEmpty: true });
    const limit = typeof opts?.limit === "number" && Number.isInteger(opts.limit) && opts.limit > 0
      ? Math.min(opts.limit, MAX_LIST)
      : MAX_LIST;
    const entries: WidgetStoreEntry[] = [];
    for (const [key, value] of this.ctx.storage.kv.list<string>({ prefix: entryKey(prefix) })) {
      entries.push({ key: key.slice(PREFIX.length), value });
      if (entries.length >= limit) break;
    }
    return entries;
  }

  /** Throw the whole store away. Used when the widget it belongs to is deleted. */
  async deleteAll(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  #count(): number {
    let count = 0;
    for (const _entry of this.ctx.storage.kv.list<string>({ prefix: PREFIX })) count++;
    return count;
  }
}

/**
 * Namespace for a widget's own keys inside this object's storage.
 *
 * The prefix exists so a widget cannot name a key that collides with anything this object might
 * come to keep for itself.
 */
const PREFIX = "e:";

function entryKey(key: string): string {
  return `${PREFIX}${key}`;
}

function checkKey(key: unknown, opts: { allowEmpty?: boolean } = {}): string {
  if (typeof key !== "string" || (key === "" && !opts.allowEmpty)) {
    throw new ProjectError("A widget store key is required.");
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new ProjectError(`A widget store key may be at most ${MAX_KEY_LENGTH} characters.`);
  }
  return key;
}
