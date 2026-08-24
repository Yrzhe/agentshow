// Test worker for the workerd suite: the production entrypoints, so miniflare can bind the Durable
// Objects, plus a hook Durable Object for the parts that need `ctx.props`.
//
// `TestHooks` is a Durable Object rather than a WorkerEntrypoint because a `DurableObjectClass` from
// `ctx.exports.X({ props })` is only reachable through `ctx.facets` -- which is also how the overseer
// instantiates a gatekeeper in production. Everything a test drives here it drives through the real
// facet, so the approval queue is the only thing standing in.

import { DurableObject, RpcStub, RpcTarget } from "cloudflare:workers";
import type {
  ActionDescription,
  ApprovalQueue,
  GatekeeperUserVerifier,
  ObservationDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import type { ProjectGatekeeper } from "../src/project-gatekeeper.js";
import type { ProjectDirectory } from "../src/types.js";

export { default } from "../src/index.js";
export * from "../src/index.js";

/** What the deployment sets on an account, and therefore on its gatekeeper facet. */
export type GatekeeperProps = { sharingDomain: string; accountId: string };

type TestExports = {
  ProjectGatekeeper(options: { props: GatekeeperProps }): DurableObjectClass<ProjectGatekeeper>;
};

/** A write the agent asked for, as the person deciding about it would have been shown it. */
export interface Submission {
  id: number;
  description: ActionDescription;
}

/**
 * The overseer's approval queue, reduced to a filing cabinet.
 *
 * Reads are allowed and recorded; writes are recorded and left pending, so a test can approve or
 * refuse them afterwards as two separate steps, which is the shape production has.
 */
class TestQueue extends RpcTarget {
  constructor(
    private readonly submissions: Submission[],
    private readonly observations: ObservationDescription[],
  ) {
    super();
  }

  async authorizeObservation(description: ObservationDescription): Promise<void> {
    this.observations.push(description);
  }

  async submitAction(id: number, description: ActionDescription): Promise<void> {
    this.submissions.push({ id, description });
  }
}

/** A would-be collaborator with a known answer: refuses `denied`, or fails outright. */
class ScriptedVerifier extends RpcTarget {
  constructor(private readonly denied: readonly string[] | string) {
    super();
  }

  async hasSetAccess(_sharingDomain: string, setId: string): Promise<boolean> {
    if (typeof this.denied === "string") throw new Error(this.denied);
    return !this.denied.includes(setId);
  }
}

export class TestHooks extends DurableObject<Cloudflare.Env> {
  readonly #submissions = new Map<string, Submission[]>();
  readonly #observations = new Map<string, ObservationDescription[]>();

  /**
   * A session on this facet, handed back for the test to drive.
   *
   * The facet is cached under `facetName`, so each case wants its own name: reusing one would
   * silently reuse the first case's props and storage.
   */
  async openDirectory(facetName: string, props: GatekeeperProps): Promise<ProjectDirectory> {
    const queue = new RpcStub(
      new TestQueue(this.submissionsFor(facetName), this.observationsFor(facetName)),
    ) as unknown as RpcStub<ApprovalQueue>;
    return this.#gatekeeper(facetName, props).startSession(queue);
  }

  async submitted(facetName: string): Promise<Submission[]> {
    return [...this.submissionsFor(facetName)];
  }

  async observed(facetName: string): Promise<ObservationDescription[]> {
    return [...this.observationsFor(facetName)];
  }

  async applyAction(facetName: string, props: GatekeeperProps, id: number): Promise<void> {
    await this.#gatekeeper(facetName, props).applyAction(id);
  }

  /** The refusal, or null when the gatekeeper went through with it. */
  async rejectAction(
    facetName: string,
    props: GatekeeperProps,
    id: number,
  ): Promise<string | null> {
    return failureOf(() => this.#gatekeeper(facetName, props).rejectAction(id));
  }

  async revertAction(
    facetName: string,
    props: GatekeeperProps,
    id: number,
  ): Promise<string | null> {
    return failureOf(() => this.#gatekeeper(facetName, props).revertAction(id));
  }

  /**
   * Offer this facet a collaborator who cannot read `denied`, and report the refusal.
   *
   * Refusals only. A collaborator who passes is stored, and storing a stub needs a persistent one --
   * which is what the overseer hands over and what a local `RpcTarget` here is not. The tracker's
   * admit-and-then-exclude behaviour is covered against a fake store in `observers.test.ts`.
   */
  async refuseObserver(
    facetName: string,
    props: GatekeeperProps,
    observerId: string,
    denied: readonly string[] | string,
  ): Promise<string | null> {
    const verifier = new RpcStub(new ScriptedVerifier(denied)) as unknown as
      Fetcher<GatekeeperUserVerifier>;
    return failureOf(() =>
      this.#gatekeeper(facetName, props).addObserver(observerId, verifier));
  }

  submissionsFor(facetName: string): Submission[] {
    return mapEntry(this.#submissions, facetName);
  }

  observationsFor(facetName: string): ObservationDescription[] {
    return mapEntry(this.#observations, facetName);
  }

  #gatekeeper(facetName: string, props: GatekeeperProps) {
    const exports = this.ctx.exports as unknown as TestExports;
    return this.ctx.facets.get<ProjectGatekeeper>(facetName, () => ({
      class: exports.ProjectGatekeeper({ props }),
    }));
  }
}

function mapEntry<T>(map: Map<string, T[]>, key: string): T[] {
  const existing = map.get(key);
  if (existing) return existing;
  const created: T[] = [];
  map.set(key, created);
  return created;
}

async function failureOf(call: () => Promise<unknown>): Promise<string | null> {
  try {
    await call();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
