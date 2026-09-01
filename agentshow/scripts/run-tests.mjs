import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 跑 vitest，然后核对**磁盘上的每个测试文件都真的跑了**。
 *
 * 存在的理由是一个不报错的失效模式：`vite dev` 开着的时候 workers 那个
 * project 会被静默丢掉，vitest 只跑 node 的 5 个文件、打印一切正常、退出 0。
 * 这个仓库唯一的测试门禁自己有一个假绿状态 —— 人核对文件数才发现得了，
 * 而人不会每次都核对。
 *
 * 用磁盘上的文件集当期望值，而不是写死一个数字：数字会在加测试时忘记更新,
 * 于是门禁悄悄降格成「至少跑了当年那么多」。
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 和 vitest.config.ts 的两个 project 的 include 对齐。 */
const TEST_DIRS = ["__tests__", "__tests__/do"];

function expectedFiles() {
  const out = [];
  for (const dir of TEST_DIRS) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        out.push(join(dir, entry.name));
      }
    }
  }
  return new Set(out);
}

/**
 * `npm test -- <某个文件>` 是故意只跑一部分，这时候核对完整性只会碍事。
 * CI 跑的是不带参数的那条，闸还在。
 */
const passThrough = process.argv.slice(2);
const filtered = passThrough.length > 0;

const workDir = mkdtempSync(join(tmpdir(), "agentshow-tests-"));
const reportPath = join(workDir, "report.json");

/** 返回退出码。所有早退都走 return —— process.exit 会跳过下面的清理。 */
function runAndCheck() {
  const run = spawnSync(
    "npx",
    [
      "vitest",
      "run",
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json=${reportPath}`,
      ...passThrough
    ],
    { cwd: root, stdio: "inherit" }
  );

  if (run.status !== 0) return run.status ?? 1;
  if (filtered) {
    console.log("\n只跑了指定的文件，跳过完整性核对。");
    return 0;
  }

  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (e) {
    console.error(`\n测试报告读不出来，无法确认跑了哪些文件：${e}`);
    return 1;
  }

  const ran = new Set(
    (report.testResults ?? []).map((r) => relative(root, r.name))
  );
  const missing = [...expectedFiles()].filter((f) => !ran.has(f)).sort();

  if (missing.length > 0) {
    console.error(
      `\n有 ${missing.length} 个测试文件在磁盘上但这一轮没有跑：\n` +
        missing.map((f) => `  ${f}`).join("\n") +
        "\n\n最常见的原因是 vite dev 正开着 —— 它会让 workers 那个 project 被静默丢掉。" +
        "\n关掉 dev 再跑一次。"
    );
    return 1;
  }

  console.log(`\n${ran.size} 个测试文件全部执行，与磁盘上的一致。`);
  return 0;
}

let code;
try {
  code = runAndCheck();
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
process.exit(code);
