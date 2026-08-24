// The gatekeeper facet: the part that keeps a record of what the agent asked for and does something
// about it when a person decides. Driven through a real facet with real props, because what is being
// tested is the bookkeeping -- which action a decision refers to, and what survives the decision.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { newId } from "../src/model.js";
import type { GatekeeperProps, TestHooks } from "./worker.js";

const testEnv = env as unknown as { TEST_HOOKS: DurableObjectNamespace<TestHooks> };

const hooks = testEnv.TEST_HOOKS.getByName("hooks");

/** Each case gets its own facet: a facet is cached by name, so a shared one shares storage. */
function account(facetName: string): { facetName: string; props: GatekeeperProps } {
  return {
    facetName,
    props: { sharingDomain: "https://os.example.com", accountId: `account-${facetName}` },
  };
}

/** A project this account owns, approved, with a session open on it. */
async function project(facetName: string) {
  const { props } = account(facetName);
  const directory = await hooks.openDirectory(facetName, props);
  const request = await directory.createProject({ name: "Launch" });
  const [created] = await hooks.submitted(facetName);
  await hooks.applyAction(facetName, props, created.id);
  const workspace = await directory.openProject(request.projectId);
  return { facetName, props, directory, workspace, projectId: request.projectId };
}

describe("deciding about an action", () => {
  it("carries out only what was approved, and only once it is", async () => {
    const { facetName, props, directory, workspace } = await project("approve");
    const file = await workspace.writeFile({ path: "shared/plan.md", content: "the plan" });

    // Two submissions so far, and the second has not happened yet.
    const submitted = await hooks.submitted(facetName);
    expect(submitted).toHaveLength(2);
    expect(submitted[1].description.title).toMatch(/Add shared\/plan\.md/);
    expect(await workspace.listFiles()).toEqual([]);

    await hooks.applyAction(facetName, props, submitted[1].id);
    expect(await workspace.readFile(file.fileId)).toMatchObject({ content: "the plan" });
    expect(await directory.listProjects()).toHaveLength(1);
  });

  it("will not reject a write that has already been applied", async () => {
    const { facetName, props, workspace } = await project("reject-applied");
    const file = await workspace.writeFile({ path: "shared/plan.md", content: "the plan" });
    const write = (await hooks.submitted(facetName))[1];
    await hooks.applyAction(facetName, props, write.id);

    // Rejecting a write means throwing away the bytes it staged. Those bytes now belong to the
    // committed file, so the refusal is the whole point: going ahead would leave a row pointing at
    // nothing and take the undo with it.
    expect(await hooks.rejectAction(facetName, props, write.id)).toMatch(/already applied/);
    expect(await workspace.readFile(file.fileId)).toMatchObject({ content: "the plan" });

    // And the record is still on file, so the operation that does undo an applied write still can.
    expect(await hooks.revertAction(facetName, props, write.id)).toBe(null);
    await expect((async () => workspace.readFile(file.fileId))()).rejects.toThrow();
  });

  it("throws away the bytes of a write nobody agreed to", async () => {
    const { facetName, props, workspace } = await project("reject-pending");
    await workspace.writeFile({ path: "shared/plan.md", content: "the plan" });
    const write = (await hooks.submitted(facetName))[1];

    expect(await hooks.rejectAction(facetName, props, write.id)).toBe(null);
    expect(await workspace.listFiles()).toEqual([]);
    // Settled either way, so deciding again refers to nothing.
    await expect((async () => hooks.applyAction(facetName, props, write.id))())
      .rejects.toThrow(/no longer on file/);
  });
});

describe("admitting a collaborator", () => {
  it("refuses one who cannot read what this workspace has already read", async () => {
    const { facetName, props, projectId, workspace } = await project("observer-refused");
    await workspace.info();

    const refused = await hooks.refuseObserver(facetName, props, "stranger", [`p:${projectId}`]);
    expect(refused).toMatch(/not a member of a project/);
    // A verifier that fails is not a verifier that said yes: sharing has to break loudly rather
    // than quietly hand someone else's project over.
    expect(await hooks.refuseObserver(facetName, props, "broken", "verifier exploded"))
      .toContain("verifier exploded");
  });
});

describe("scoping", () => {
  it("keeps two sharing domains out of each other's projects", async () => {
    const here = account("domain-here");
    const elsewhere = {
      facetName: "domain-elsewhere",
      props: { sharingDomain: "https://other.example.com", accountId: here.props.accountId },
    };
    const mine = await project(here.facetName);

    // The same account id, the same project id, a different deployment: nothing to open.
    const theirs = await hooks.openDirectory(elsewhere.facetName, elsewhere.props);
    expect(await theirs.listProjects()).toEqual([]);
    await expect((async () => theirs.openProject(mine.projectId))()).rejects.toThrow();
    expect(await mine.directory.listProjects()).toHaveLength(1);
  });

  it("answers nothing for an action id it never issued", async () => {
    const { facetName, props } = account("unknown-action");
    await hooks.openDirectory(facetName, props);
    // Rejecting one is a no-op: the overseer may be settling something already pruned.
    expect(await hooks.rejectAction(facetName, props, 99)).toBe(null);
    expect(await hooks.applyAction(facetName, props, 99).catch((error: Error) => error.message))
      .toMatch(/no longer on file/);
    expect(newId()).toMatch(/^[\da-f]{32}$/);
  });
});
