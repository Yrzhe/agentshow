// Who, besides the member whose account this is, may see what their agent read here.
//
// A project binding is broad -- every project the member belongs to, and inside each one a mix of
// files with different audiences -- and there is a per-observer oracle for each piece of it, since
// membership and file visibility are both this gatekeeper's own data. That is upstream's strategy C:
// record the data sets an observation actually revealed, and check every observer against each of
// them rather than against the binding as a whole. A collaborator who belongs to the same project
// may observe what it shares; one who does not may observe nothing from it.

import type { GatekeeperUserVerifier } from "@gadgets/workshop-shared/gatekeeper";

/**
 * The non-standard method a project gatekeeper calls on its own verifier. The overseer hands a
 * verifier back only to the vendor that minted it, so the answer can be trusted.
 */
export interface ProjectVerifierApi extends GatekeeperUserVerifier {
  hasSetAccess(sharingDomain: string, setId: string): Promise<boolean>;
}

type ObserverKv = Pick<DurableObjectStorage["kv"], "get" | "put" | "delete" | "list">;

/**
 * Whether a set has been revealed yet.
 *
 * Two states rather than one because a set becomes visible to `addObserver()` before the
 * observation it belongs to has been authorized: `pending` says "an observation is trying to reveal
 * this", which is enough for an observer arriving mid-flight to be checked against it, and
 * `observed` says the observation went through. An authorization that throws leaves the set pending,
 * so the next attempt re-checks it.
 */
type SetState = "pending" | "observed";

export interface ObservationCheck {
  /** Observers who must not see this observation, in `ObservationDescription`'s shape. */
  excludeObservers?: string[];
  /** Sets this observation is the first to reveal. */
  pendingSets: string[];
  /** Promote the pending sets, once the observation has been authorized. */
  commit(): void;
}

export class ProjectObserverTracker {
  constructor(private kv: ObserverKv, private sharingDomain: string) {}

  /**
   * Admit an observer, or refuse.
   *
   * Re-run on every open, so access lost since the last one is caught here. The loop is what closes
   * the race with an observation in flight: checking a set takes an await, during which another set
   * may be marked, so it keeps going until a pass finds nothing new and only then stores the
   * verifier -- a synchronous write, which an interleaved `prepareObservation` therefore sees.
   */
  async addObserver(id: string, verifier: Fetcher<ProjectVerifierApi>): Promise<void> {
    const checked = new Set<string>();
    for (;;) {
      const sets = this.#trackedSets().filter((setId) => !checked.has(setId));
      if (sets.length === 0) {
        this.kv.put(this.#observerKey(id), verifier);
        return;
      }
      const access = await Promise.all(
        sets.map((setId) => verifier.hasSetAccess(this.sharingDomain, setId)));
      if (access.some((allowed) => !allowed)) {
        throw new Error(
          "This collaborator is not a member of a project whose files this workspace has read, or " +
          "cannot read one of those files themselves, so they cannot observe what it read. Add " +
          "them to the project, or share the files with it, first.");
      }
      for (const setId of sets) checked.add(setId);
    }
  }

  removeObserver(id: string): void {
    this.kv.delete(this.#observerKey(id));
  }

  /**
   * Prepare an observation that reveals `setIds`.
   *
   * Only newly-revealed sets are re-checked: an observer admitted earlier was already verified
   * against everything known then, and `addObserver` runs again on their next open.
   */
  async prepareObservation(setIds: readonly string[]): Promise<ObservationCheck> {
    const pendingSets = [...new Set(setIds)].filter((setId) => !this.#isObserved(setId));
    if (pendingSets.length === 0) return { pendingSets, commit() {} };

    for (const setId of pendingSets) {
      if (this.#state(setId) === undefined) this.kv.put(this.#setKey(setId), "pending");
    }

    const verdicts = await Promise.all([...this.#observers()].map(async ([id, verifier]) => {
      const access = await Promise.all(
        pendingSets.map((setId) => verifier.hasSetAccess(this.sharingDomain, setId)));
      return [id, access.every((allowed) => allowed)] as const;
    }));
    const excluded = verdicts.filter(([, allowed]) => !allowed).map(([id]) => id);
    return {
      ...(excluded.length > 0 ? { excludeObservers: excluded } : {}),
      pendingSets,
      commit: () => this.commitObservation(pendingSets),
    };
  }

  commitObservation(pendingSets: readonly string[]): void {
    for (const setId of pendingSets) this.kv.put(this.#setKey(setId), "observed");
  }

  #observerKey(id: string): string {
    return `observer:${id}`;
  }

  #setKey(setId: string): string {
    return `set:${setId}`;
  }

  #state(setId: string): SetState | undefined {
    return this.kv.get<SetState>(this.#setKey(setId));
  }

  #isObserved(setId: string): boolean {
    return this.#state(setId) === "observed";
  }

  #trackedSets(): string[] {
    return [...this.kv.list<SetState>({ prefix: "set:" })].map(([key]) => key.slice(4));
  }

  *#observers(): IterableIterator<[string, Fetcher<ProjectVerifierApi>]> {
    for (const [key, verifier] of this.kv.list<Fetcher<ProjectVerifierApi>>(
      { prefix: "observer:" })) {
      yield [key.slice("observer:".length), verifier];
    }
  }
}
