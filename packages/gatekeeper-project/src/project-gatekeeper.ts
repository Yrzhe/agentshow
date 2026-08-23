// The Worker's outward shape: a vendor that provisions one account per person, an account that
// offers that person's agent a single ambient capability, a verifier that answers what a would-be
// observer may see, and the gatekeeper facet the Workshop installs into each of their gadgets.
//
// Nothing here is shared between two people's agents, which is the whole point. Each member's agent
// talks to their own facet, holding their own account id; what they have in common is the project
// Durable Objects those facets reach, and every one of those answers per member. Collaboration
// happens in the projects, not in anybody's chat.

import { DurableObject, RpcStub, WorkerEntrypoint } from "cloudflare:workers";
import { skipRpcValidation, validateRpc } from "capnweb-validate";
import type {
  AccountDescription,
  ActionDescription,
  ActionKind,
  AgentCatalog,
  ApprovalQueue,
  Gatekeeper,
  GatekeeperConnectCallback,
  GatekeeperConnectOptions,
  GatekeeperUser,
  GatekeeperUserVerifier,
  ObservationAuthorizer,
  ObservationDescription,
  ResourceDescription,
  SupportedResource,
  VendorDescription,
} from "@gadgets/workshop-shared/gatekeeper";
import { boundAgentCatalog } from "@gadgets/workshop-shared/gatekeeper";
import { applyAction, rejectAction, revertAction } from "./actions.js";
import { configuredDomain, domainName } from "./domain.js";
import { fileUrl, projectUrl } from "./links.js";
import { newId, parseSet, projectSet } from "./model.js";
import { ProjectObserverTracker, type ProjectVerifierApi } from "./observers.js";
import {
  AUTO_APPROVABLE_KINDS,
  ProjectDirectorySession,
  type PendingAction,
  type ProjectContext,
  type ProjectHost,
  type ProjectStore,
} from "./sessions.js";
import type { ProjectDirectory, ProjectSummary } from "./types.js";
import TYPES_CODE from "./types-code.js";

/** The Phosphor "UsersThree" glyph, inline so the deployment serves no third-party asset. */
const PROJECT_ICON = {
  url: "data:image/svg+xml," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256' fill='currentColor'>" +
    "<path d='M244.8,150.4a8,8,0,0,1-11.2-1.6A51.6,51.6,0,0,0,192,128a8,8,0,0,1,0-16,24,24,0,1,0" +
    "-23.24-30,8,8,0,1,1-15.5-4A40,40,0,1,1,219,117.51a67.94,67.94,0,0,1,27.43,21.68A8,8,0,0,1,244" +
    ".8,150.4ZM190.92,212a8,8,0,1,1-13.84,8c-15.81-27.26-44.13-44-73.08-44s-57.27,16.75-73.08,44a8," +
    "8,0,1,1-13.84-8,97.5,97.5,0,0,1,42.79-40.44,48,48,0,1,1,88.26,0A97.49,97.49,0,0,1,190.92,212Z" +
    "M104,152a32,32,0,1,0-32-32A32,32,0,0,0,104,152ZM64,120a8,8,0,0,0-8-8A24,24,0,1,1,79.24,82a8,8," +
    "0,1,0,15.5-4A40,40,0,1,0,37,117.51,67.94,67.94,0,0,0,9.6,139.19a8,8,0,0,0,12.8,9.61A51.6,51.6," +
    "0,0,1,64,128,8,8,0,0,0,64,120Z'/>" +
    "</svg>"),
};

/** How the Workshop introduces one project to a person who has not opened it yet. */
const PROJECT_RESOURCE_TITLE = "Projects";

/** What every account and gatekeeper facet is scoped by. */
type ProjectAccountProps = {
  sharingDomain: string;
  /** This person's stable identity in every project they belong to. */
  accountId: string;
};

/** Props the deployment sets on the Workshop's service binding to this Worker. */
type GatekeeperVendorProps = {
  sharingDomain?: string;
};

/** One project's Durable Object, reached as the store the sessions and actions are written against. */
function projectStoreFor(
  exports: Cloudflare.Exports,
  sharingDomain: string,
  projectId: string,
): ProjectStore {
  const namespace = exports.ProjectDurableObject;
  return namespace.get(namespace.idFromName(domainName(sharingDomain, projectId)));
}

function memberIndexFor(exports: Cloudflare.Exports, props: ProjectAccountProps) {
  const namespace = exports.MemberProjectsDurableObject;
  return namespace.get(namespace.idFromName(domainName(props.sharingDomain, props.accountId)));
}

// ---------------------------------------------------------------------------
// Vendor

@validateRpc()
export class GatekeeperVendor extends WorkerEntrypoint<Cloudflare.Env, GatekeeperVendorProps> {
  async describe(): Promise<VendorDescription> {
    return {
      displayName: PROJECT_RESOURCE_TITLE,
      url: "https://github.com/cloudflare/cloudflare-os-starter",
      logo: PROJECT_ICON,
      color: "#eef7ee",
      tagline: "Share files, comments, skills and settings with other people",
      description:
        "A project is a place to work with other people without working in the same chat. " +
        "Everyone keeps their own agent; what they share is a project's files, the comments on " +
        "them, the skills they have agreed on, and its shared configuration. Always available -- " +
        "no connection needed.",
      autoProvisionsAccount: true,
      providesAuth: false,
    };
  }

  /**
   * Mint an account for one person.
   *
   * The id is random and carries no identity of its own: it is what the projects this person joins
   * will know them by, and the name other members see is theirs to choose.
   *
   * Return validation is skipped because proxy-wrapping a `WorkerEntrypoint` stub breaks Workers
   * serialization.
   */
  @skipRpcValidation()
  async createAccount(): Promise<Fetcher<GatekeeperUser>> {
    const sharingDomain = this.ctx.props.sharingDomain ?? configuredDomain(this.env);
    return this.ctx.exports.ProjectAccount({
      props: { sharingDomain, accountId: crypto.randomUUID() },
    }) as unknown as Fetcher<GatekeeperUser>;
  }

  connectAccount(
    _callback: Fetcher<GatekeeperConnectCallback>,
    _options?: GatekeeperConnectOptions,
  ): Promise<{ url: string }> {
    throw new Error("Projects are auto-provisioned; there is no connect flow.");
  }

  async getSupportedResources(_options?: { userId?: string }): Promise<SupportedResource[]> {
    return [];
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }
}

// ---------------------------------------------------------------------------
// Account

@validateRpc()
export class ProjectAccount
    extends WorkerEntrypoint<Cloudflare.Env, ProjectAccountProps>
    implements GatekeeperUser {
  async describe(): Promise<AccountDescription> {
    return {
      displayName: PROJECT_RESOURCE_TITLE,
      avatar: PROJECT_ICON,
      singleton: { tsType: "ProjectDirectory" },
    };
  }

  async getSingletonGatekeeperClass(): Promise<DurableObjectClass<Gatekeeper<ProjectDirectory>>> {
    return this.ctx.exports.ProjectGatekeeper({ props: this.ctx.props });
  }

  /**
   * Forget this account's projects.
   *
   * Deliberately one-sided: a project is shared property, so revoking one person's account must not
   * delete work its other members are relying on. What goes is this account's own index of which
   * projects it belongs to, and with it the only way to present this account id again -- so its
   * private files become unreachable, exactly as they do when an owner removes a member, while what
   * it shared with a project stays under its name.
   */
  async revoke(): Promise<void> {
    await memberIndexFor(this.ctx.exports, this.ctx.props).deleteAll();
  }

  /** No URL-addressed resources: the account offers one ambient capability over every project. */
  async getSupportedResources(): Promise<SupportedResource[]> {
    return [];
  }

  getGatekeeperClassFor(_url: string): never {
    throw new Error(
      "Projects are reached through the ambient Projects capability, not by connecting a URL. " +
      "Call openProject() with the id from listProjects().");
  }

  startResourceConfigurator(_resourceUrlPattern: string): never {
    throw new Error("Projects have no URL-addressed resources to configure.");
  }

  async ensureResources(_resourceUrlPatterns: string[]): Promise<{ url?: string }> {
    return {};
  }

  reconnect(): never {
    throw new Error("Projects are auto-provisioned; there are no credentials to refresh.");
  }

  async getAuthenticatedEmail(): Promise<string | null> {
    return null;
  }

  @skipRpcValidation()
  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    return this.ctx.exports.ProjectVerifier({ props: this.ctx.props });
  }
}

// ---------------------------------------------------------------------------
// Verifier

@validateRpc()
export class ProjectVerifier
    extends WorkerEntrypoint<Cloudflare.Env, ProjectAccountProps>
    implements ProjectVerifierApi {
  /**
   * Whether this account could read, on its own, the data a set names.
   *
   * Answered against current state rather than against anything recorded, so access that has since
   * been taken away is refused at the next open: a file whose owner made it private again, or a
   * project this account has been removed from.
   */
  async hasSetAccess(sharingDomain: string, setId: string): Promise<boolean> {
    if (sharingDomain !== this.ctx.props.sharingDomain) return false;
    const parsed = parseSet(setId);
    if (!parsed) return false;
    return projectStoreFor(this.ctx.exports, sharingDomain, parsed.projectId)
      .canObserve(this.ctx.props.accountId, setId);
  }
}

// ---------------------------------------------------------------------------
// Actions, recorded here until a human decides about them

interface ActionRecord {
  action: PendingAction;
  applied?: true;
}

/** How many applied actions stay revertable. Older ones are dropped to bound this facet's storage. */
const RETAINED_APPLIED_ACTIONS = 200;

// ---------------------------------------------------------------------------
// The gatekeeper facet

@validateRpc()
export class ProjectGatekeeper
    extends DurableObject<Cloudflare.Env, ProjectAccountProps>
    implements Gatekeeper<ProjectDirectory> {
  async describe(): Promise<ResourceDescription> {
    return {
      url: "project://projects",
      title: PROJECT_RESOURCE_TITLE,
      snippet:
        "The projects you share with other people: their files, comments, skills and settings.",
      suggestedBindingName: "PROJECTS",
      tsType: "ProjectDirectory",
    };
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }

  async getAutoApprovableActions(): Promise<ActionKind[]> {
    return [...AUTO_APPROVABLE_KINDS];
  }

  async startSession(approvalQueue: RpcStub<ApprovalQueue>): Promise<ProjectDirectory> {
    const queue = approvalQueue.dup();
    try {
      return new ProjectDirectorySession(this.#host(queue));
    } catch (error) {
      queue[Symbol.dispose]?.();
      throw error;
    }
  }

  /**
   * The member's projects, so an agent can name one without listing anything first.
   *
   * Only what a project is called and what it is for -- the files inside it are a session away, and
   * each of those is its own observation.
   */
  async getAgentCatalog(authorizer: RpcStub<ObservationAuthorizer>): Promise<AgentCatalog | null> {
    const summaries = await this.#summaries();
    if (summaries.length === 0) return null;
    const check = await this.#observers().prepareObservation(
      summaries.map((summary) => projectSet(summary.projectId)));
    await authorizer.authorizeObservation({
      title: "List your projects",
      description:
        `Read the names and descriptions of ${summaries.length} shared projects: ` +
        `${summaries.map((summary) => summary.name).join(", ")}.`,
      ...(check.excludeObservers ? { excludeObservers: check.excludeObservers } : {}),
    });
    check.commit();
    return boundAgentCatalog(summaries.map((summary) => ({
      id: summary.projectId,
      title: summary.name,
      description: summary.description ||
        `A project shared with ${summary.memberCount} people, holding ${summary.fileCount} files.`,
    })));
  }

  async addObserver(id: string, user: Fetcher<GatekeeperUserVerifier>): Promise<void> {
    await this.#observers().addObserver(id, user as unknown as Fetcher<ProjectVerifierApi>);
  }

  async removeObserver(id: string): Promise<void> {
    this.#observers().removeObserver(id);
  }

  async applyAction(action: number): Promise<void> {
    const record = this.#action(action);
    await applyAction(this.#context(), record.action);
    this.ctx.storage.kv.put<ActionRecord>(
      actionKey(action), { action: record.action, applied: true });
    this.#pruneAppliedActions();
  }

  async rejectAction(action: number): Promise<void> {
    const record = this.ctx.storage.kv.get<ActionRecord>(actionKey(action));
    if (!record) return;
    await rejectAction(this.#context(), record.action);
    this.ctx.storage.kv.delete(actionKey(action));
  }

  async revertAction(action: number): Promise<void> {
    const record = this.#action(action);
    await revertAction(this.#context(), record.action);
    this.ctx.storage.kv.delete(actionKey(action));
  }

  // -------------------------------------------------------------------------

  #observers(): ProjectObserverTracker {
    return new ProjectObserverTracker(this.ctx.storage.kv, this.ctx.props.sharingDomain);
  }

  #context(): ProjectContext {
    const props = this.ctx.props;
    const exports = this.ctx.exports;
    const env = this.env;
    const index = memberIndexFor(exports, props);
    return {
      memberId: props.accountId,
      store: (projectId) => projectStoreFor(exports, props.sharingDomain, projectId),
      listProjectIds: () => index.listProjectIds(),
      rememberProject: (projectId) => index.remember(projectId),
      forgetProjects: (live) => index.retain(live),
      getDisplayName: () => index.getDisplayName(),
      setDisplayName: (displayName) => index.setDisplayName(displayName),
      stageBytes: async (projectId, fileId, bytes) => {
        // Keyed by a fresh id rather than by the file, so a write that is never approved cannot
        // overwrite the bytes the file currently has.
        const key = contentKey(props.sharingDomain, projectId, fileId);
        await env.PROJECT_FILES.put(key, bytes);
        return key;
      },
      discardBytes: (key) => env.PROJECT_FILES.delete(key),
      projectUrl: (projectId) => projectUrl(env, projectId),
      fileUrl: (projectId, fileId) => fileUrl(env, projectId, fileId),
    };
  }

  #host(queue: RpcStub<ApprovalQueue>): ProjectHost {
    const tracker = this.#observers();
    return {
      ...this.#context(),
      authorize: async (setIds: readonly string[], description: ObservationDescription) => {
        const check = await tracker.prepareObservation(setIds);
        await queue.authorizeObservation({
          ...description,
          ...(check.excludeObservers ? { excludeObservers: check.excludeObservers } : {}),
        });
        check.commit();
      },
      submit: async (action: PendingAction, description: ActionDescription) => {
        const id = this.#recordAction(action);
        try {
          await queue.submitAction(id, description);
        } catch (error) {
          this.ctx.storage.kv.delete(actionKey(id));
          throw error;
        }
      },
      [Symbol.dispose]: () => queue[Symbol.dispose]?.(),
    };
  }

  /** Every project this account still belongs to. */
  async #summaries(): Promise<ProjectSummary[]> {
    const context = this.#context();
    const summaries: ProjectSummary[] = [];
    for (const projectId of await context.listProjectIds()) {
      const summary = await context.store(projectId).summaryFor(context.memberId);
      if (summary) summaries.push(summary);
    }
    return summaries;
  }

  #recordAction(action: PendingAction): number {
    const id = this.ctx.storage.kv.get<number>("nextActionId") ?? 1;
    this.ctx.storage.kv.put("nextActionId", id + 1);
    this.ctx.storage.kv.put<ActionRecord>(actionKey(id), { action });
    return id;
  }

  #action(action: number): ActionRecord {
    const record = this.ctx.storage.kv.get<ActionRecord>(actionKey(action));
    if (!record) {
      throw new Error(
        `Action ${action} is no longer on file, so it cannot be applied or undone. It was either ` +
        `already settled or is older than the last ${RETAINED_APPLIED_ACTIONS} applied actions.`);
    }
    return record;
  }

  /** Drop the oldest applied records once there are more than the facet keeps. */
  #pruneAppliedActions(): void {
    const applied: number[] = [];
    for (const [key, record] of this.ctx.storage.kv.list<ActionRecord>({ prefix: ACTION_PREFIX })) {
      if (record.applied) applied.push(Number(key.slice(ACTION_PREFIX.length)));
    }
    if (applied.length <= RETAINED_APPLIED_ACTIONS) return;
    const oldest = applied.toSorted((a, b) => a - b)
      .slice(0, applied.length - RETAINED_APPLIED_ACTIONS);
    for (const id of oldest) this.ctx.storage.kv.delete(actionKey(id));
  }
}

const ACTION_PREFIX = "action:";

function actionKey(action: number): string {
  return `${ACTION_PREFIX}${action}`;
}

/** Where one version of a file's bytes lives in the deployment's bucket. */
function contentKey(sharingDomain: string, projectId: string, fileId: string): string {
  return `${encodeURIComponent(sharingDomain)}/${projectId}/${fileId}/${newId(8)}`;
}
