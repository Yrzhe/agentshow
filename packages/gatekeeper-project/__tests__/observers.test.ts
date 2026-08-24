// Who, besides the member whose agent read something, gets to see what it read.
//
// The tracker is the answer, and it is asked in two directions: a collaborator arriving after some
// reads have happened has to be checked against all of them, and a read happening after a
// collaborator has been admitted has to exclude them if it reveals something new. Both are checked
// here against a plain map, because what varies is the bookkeeping and not the storage.

import { describe, expect, it } from "vitest";
import { ProjectObserverTracker, type ProjectVerifierApi } from "../src/observers.js";

type TrackerKv = ConstructorParameters<typeof ProjectObserverTracker>[0];

const DOMAIN = "https://os.example.com";
const project = "p:project-1";
const file = "f:project-1:file-1";

function makeKv(): TrackerKv {
  const map = new Map<string, unknown>();
  return {
    get: <T>(key: string) => map.get(key) as T | undefined,
    put: <T>(key: string, value: T) => void map.set(key, value),
    delete: (key: string) => void map.delete(key),
    list: <T>({ prefix }: { prefix: string }) =>
      [...map.entries()].filter(([key]) => key.startsWith(prefix)) as [string, T][],
  };
}

/** Another member's account, which answers for itself about what it can reach. */
function verifier(allowed: readonly string[] | { fails: string }) {
  const asked: string[] = [];
  const api = {
    async hasSetAccess(sharingDomain: string, setId: string) {
      expect(sharingDomain).toBe(DOMAIN);
      asked.push(setId);
      if (!Array.isArray(allowed)) throw new Error((allowed as { fails: string }).fails);
      return allowed.includes(setId);
    },
  } as unknown as Fetcher<ProjectVerifierApi>;
  return { api, asked };
}

async function observe(tracker: ProjectObserverTracker, setIds: string[]) {
  const check = await tracker.prepareObservation(setIds);
  check.commit();
  return check.excludeObservers;
}

describe("ProjectObserverTracker", () => {
  it("checks a newcomer against everything already read", async () => {
    const tracker = new ProjectObserverTracker(makeKv(), DOMAIN);
    await observe(tracker, [project, file]);

    const stranger = verifier([project]);
    await expect(tracker.addObserver("stranger", stranger.api))
      .rejects.toThrow(/not a member of a project/);
    expect(stranger.asked.toSorted()).toEqual([file, project].toSorted());

    const member = verifier([project, file]);
    await expect(tracker.addObserver("member", member.api)).resolves.toBeUndefined();
  });

  it("excludes an admitted collaborator from what they cannot read themselves", async () => {
    const tracker = new ProjectObserverTracker(makeKv(), DOMAIN);
    const colleague = verifier([project]);
    await tracker.addObserver("colleague", colleague.api);

    // Membership is enough for the project itself.
    expect(await observe(tracker, [project])).toBeUndefined();
    // One member's private file is not, so the read happens without them.
    expect(await observe(tracker, [file])).toEqual(["colleague"]);
    // ...and having been recorded, the same read does not ask again.
    expect(await observe(tracker, [file])).toBeUndefined();
    expect(colleague.asked).toEqual([project, file]);
  });

  it("keeps a refused read pending, so the next attempt re-checks it", async () => {
    const kv = makeKv();
    const tracker = new ProjectObserverTracker(kv, DOMAIN);
    const colleague = verifier([]);
    await tracker.addObserver("colleague", colleague.api);

    // An authorization the overseer throws out leaves nothing committed.
    const attempted = await tracker.prepareObservation([file]);
    expect(attempted.excludeObservers).toEqual(["colleague"]);
    expect(kv.get("set:" + file)).toBe("pending");

    // Pending is still enough for a newcomer to be checked against: a read in flight must not be a
    // way to get a set past the check.
    const stranger = verifier([]);
    await expect(tracker.addObserver("stranger", stranger.api)).rejects.toThrow();
    expect(stranger.asked).toEqual([file]);

    expect(await observe(tracker, [file])).toEqual(["colleague"]);
    expect(kv.get("set:" + file)).toBe("observed");
  });

  it("refuses rather than admits when the verification itself fails", async () => {
    const tracker = new ProjectObserverTracker(makeKv(), DOMAIN);
    await observe(tracker, [project]);
    const broken = verifier({ fails: "verifier exploded" });

    await expect(tracker.addObserver("broken", broken.api)).rejects.toThrow(/verifier exploded/);
  });

  it("forgets a removed collaborator, idempotently", async () => {
    const tracker = new ProjectObserverTracker(makeKv(), DOMAIN);
    const colleague = verifier([project]);
    await tracker.addObserver("colleague", colleague.api);

    tracker.removeObserver("colleague");
    tracker.removeObserver("colleague");
    expect(await observe(tracker, [file])).toBeUndefined();
    expect(colleague.asked).toEqual([]);
  });
});
