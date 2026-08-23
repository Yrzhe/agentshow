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

test("the mirror escapes what would otherwise break out of the template literal", () => {
  const rendered = renderTypesCode("type T = `${string}\\n`;\n");
  assert.match(rendered, /type T = \\`\\\$\{string}\\\\n\\`;/);
  assert.doesNotMatch(rendered.slice(rendered.indexOf("TYPES_CODE = `") + 14, -2), /[^\\]`/);
});

test("each mirrored package is declared once", () => {
  assert.equal(new Set(mirroredGatekeepers).size, mirroredGatekeepers.length);
});
