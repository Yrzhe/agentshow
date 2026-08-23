// One Durable Object per connected account: the list of projects that account belongs to.
//
// This is an index, not a source of truth. Membership lives in each project, so an entry here can
// outlive the membership it names -- a project owner who removes someone does not reach into their
// account to tidy up. Listing therefore asks each project what the account may see and drops the
// entries that answer "nothing", which also repairs the index as a side effect.

import { DurableObject } from "cloudflare:workers";
import type { ProjectSummary } from "./types.js";

interface Entry {
  projectId: string;
  /** When this account joined, for a stable order that does not need the project to answer. */
  joined: number;
}

export class MemberProjectsDurableObject extends DurableObject<Cloudflare.Env> {
  /**
   * The name this account shows other members.
   *
   * Held here as well as in each project's member list, because it is the account's own preference:
   * a project it has not joined yet still has to be told what to call it.
   */
  async getDisplayName(): Promise<string> {
    return this.ctx.storage.kv.get<string>("displayName") ?? "";
  }

  async setDisplayName(displayName: string): Promise<void> {
    this.ctx.storage.kv.put("displayName", displayName);
  }

  async remember(projectId: string): Promise<void> {
    const entries = this.#entries();
    if (entries.some((entry) => entry.projectId === projectId)) return;
    entries.push({ projectId, joined: Date.now() });
    this.ctx.storage.kv.put("projects", entries);
  }

  async forget(projectId: string): Promise<void> {
    this.ctx.storage.kv.put(
      "projects", this.#entries().filter((entry) => entry.projectId !== projectId));
  }

  /** Drop everything: the account has been revoked and must not be presented again. */
  async deleteAll(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  async listProjectIds(): Promise<string[]> {
    return this.#entries()
      .sort((a, b) => a.joined - b.joined)
      .map((entry) => entry.projectId);
  }

  /**
   * Drop the projects this account can no longer see.
   *
   * The caller resolves the summaries, because only it holds the domain-scoped stubs; this object
   * just keeps the surviving ids.
   */
  async retain(live: readonly ProjectSummary[]): Promise<void> {
    const keep = new Set(live.map((summary) => summary.projectId));
    const entries = this.#entries();
    const survivors = entries.filter((entry) => keep.has(entry.projectId));
    if (survivors.length !== entries.length) {
      this.ctx.storage.kv.put("projects", survivors);
    }
  }

  #entries(): Entry[] {
    return this.ctx.storage.kv.get<Entry[]>("projects") ?? [];
  }
}
