// A Gatekeeper declares its agent-facing API twice: once as `src/types.d.ts`, which the compiler
// checks the implementation against, and once as a string, because `getTypeScriptTypes()` has to
// return it at runtime and a `.d.ts` erases before it can be read.
//
// The string is generated from the declaration rather than maintained beside it. Drift is the
// failure mode worth engineering against: the compiler keeps the implementation honest about
// `types.d.ts`, so a stale string is invisible locally and reaches the agent as documentation for
// an API that no longer exists.
//
// `--write` regenerates every mirror; `gatekeeper-types.test.ts` fails when one is out of date.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Packages whose `src/types.d.ts` has a generated `src/types-code.ts` beside it. */
export const mirroredGatekeepers = ["custom-gatekeeper", "gatekeeper-project"];

/**
 * The declaration file's leading implementation notes, stripped from the mirror.
 *
 * The comment block at the top of a `types.d.ts` addresses whoever maintains the file, and the
 * generator is usually part of what it explains. Agents get the declarations alone: upstream's
 * `write-gatekeeper` skill is explicit that gatekeeper internals must not leak into the API
 * documentation.
 */
export function agentFacingTypes(source: string): string {
  const lines = source.split("\n");
  let start = 0;
  while (start < lines.length && lines[start].startsWith("//")) start++;
  if (start === 0) return source;
  while (start < lines.length && lines[start].trim() === "") start++;
  return lines.slice(start).join("\n");
}

/** The `types-code.ts` module body mirroring `types.d.ts`. */
export function renderTypesCode(source: string): string {
  const escaped = agentFacingTypes(source)
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("${", "\\${");
  return "// Generated from types.d.ts by scripts/gatekeeper-types.ts. Do not edit by hand: run\n" +
    "//   node scripts/gatekeeper-types.ts --write\n" +
    "//\n" +
    "// `getTypeScriptTypes()` returns this at runtime, where the declaration file no longer\n" +
    "// exists. gatekeeper-types.test.ts fails when the two disagree.\n" +
    "\n" +
    `const TYPES_CODE = \`${escaped}\`;\n` +
    "\n" +
    "export default TYPES_CODE;\n";
}

export function declarationPath(pkg: string): string {
  return join(root, "packages", pkg, "src", "types.d.ts");
}

export function mirrorPath(pkg: string): string {
  return join(root, "packages", pkg, "src", "types-code.ts");
}

/** The mirror each package should have, keyed by package name. */
export async function expectedMirrors(): Promise<Map<string, string>> {
  const entries = await Promise.all(mirroredGatekeepers.map(async (pkg) =>
    [pkg, renderTypesCode(await readFile(declarationPath(pkg), "utf8"))] as const));
  return new Map(entries);
}

async function main(): Promise<void> {
  if (!process.argv.includes("--write")) {
    throw new Error("Pass --write to regenerate the mirrors.");
  }
  for (const [pkg, contents] of await expectedMirrors()) {
    await writeFile(mirrorPath(pkg), contents);
    console.log(`wrote packages/${pkg}/src/types-code.ts`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(`\nFailed. ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
