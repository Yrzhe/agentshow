import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import test from "node:test";
import {
  agentFacingTypes,
  expectedMirrors,
  mirroredGatekeepers,
  mirrorPath,
  renderTypesCode,
} from "./gatekeeper-types.ts";

test("every gatekeeper's runtime types match its declaration", async () => {
  for (const [pkg, expected] of await expectedMirrors()) {
    const actual = await readFile(mirrorPath(pkg), "utf8");
    assert.equal(
      actual,
      expected,
      `packages/${pkg}/src/types-code.ts is stale. ` +
      `Run: node scripts/gatekeeper-types.ts --write`);
  }
});

test("the mirror drops leading implementation notes and keeps the declarations", () => {
  const source = [
    "// Notes for whoever maintains this file.",
    "// Still notes.",
    "",
    "/** Real documentation. */",
    "export interface Thing { a: string }",
    "",
  ].join("\n");
  assert.equal(
    agentFacingTypes(source),
    "/** Real documentation. */\nexport interface Thing { a: string }\n");
});

test("a declaration with no leading notes is mirrored whole", () => {
  const source = "/** Kept. */\nexport interface Thing { a: string }\n";
  assert.equal(agentFacingTypes(source), source);
});

// Evaluated rather than pattern-matched. Backticks, `${` and backslashes are exactly what a
// declaration full of template-literal types contains, and the mirror is correct only if the string
// it produces at runtime is the declaration it was generated from.
test("the mirror escapes what would otherwise break out of the template literal", () => {
  const declaration = "type T = `${string}\\n`;\nexport type U = `a\\\\b`;\n";
  const body = literalBody(renderTypesCode(declaration));
  assert.equal(new Function(`return \`${body}\`;`)(), declaration);
});

/** What `renderTypesCode` put inside the template literal it assigns to `TYPES_CODE`. */
function literalBody(rendered: string): string {
  const open = "const TYPES_CODE = `";
  const start = rendered.indexOf(open);
  assert.notEqual(start, -1, `no TYPES_CODE assignment in:\n${rendered}`);
  return rendered.slice(start + open.length, rendered.lastIndexOf("`;"));
}

test("each mirrored package is declared once", () => {
  assert.equal(new Set(mirroredGatekeepers).size, mirroredGatekeepers.length);
});
