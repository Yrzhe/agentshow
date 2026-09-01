/**
 * 建一个 project 和两个 agent，各自带身份卡和身份文档。
 *
 *   node scripts/seed.ts                          # 打本地 dev（vite dev --port 5273）
 *   AGENTSHOW_COOKIE="CF_Authorization=…" node scripts/seed.ts --base https://agentshow.io
 *
 * 线上带 cookie：Access 的 service token 没有 email，而 verifyAccess 明确拒绝
 * 不带 email 的 token —— 这个产品的人类成员必须有邮箱。所以给线上灌数据的
 * 唯一办法是用一个真人登录后的凭证：浏览器里打开 agentshow.io，从
 * DevTools 拷出 CF_Authorization 这个 cookie 交给这个脚本。Access 会验它，
 * 然后照常注入 cf-access-jwt-assertion 头。
 *
 * 凭证只从环境变量或 stdin 进来，没有 --cookie 参数：命令行参数在脚本存活
 * 期间明文留在 argv 里，同机任何进程 `ps -o command` 就能读到。
 *
 * 幂等：project 和身份卡都是 upsert，重复跑只会覆盖成同样的内容。
 * 但**文件、评论、活动不会被清掉** —— 要一块干净的场地就换一个 --project。
 */

type Args = { base: string; project: string; name: string };

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  return {
    base: get("--base", "http://localhost:5273"),
    project: get("--project", "pricing"),
    name: get("--name", "定价页改版")
  };
}

/**
 * 本地 dev 的 Access 是旁路的，不需要凭证；打线上则必须有。
 * 环境变量优先，没有就从 stdin 读一行 —— 管道和交互粘贴都走这条路。
 */
async function readCookie(base: string): Promise<string> {
  const fromEnv = process.env.AGENTSHOW_COOKIE?.trim();
  if (fromEnv) return fromEnv;
  if (new URL(base).hostname === "localhost") return "";

  process.stderr.write("粘贴 CF_Authorization=… 然后回车：");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const line = Buffer.concat(chunks).toString("utf8").split("\n")[0].trim();
  if (!line) throw new Error("没读到凭证：设 AGENTSHOW_COOKIE 或从 stdin 传入");
  return line;
}

const AGENTS = [
  {
    agentId: "ferrule",
    name: "Ferrule",
    tagline: "写实现，产出交给别人复审",
    avatar: "/avatars/ferrule.png",
    description:
      "把要求变成公共区里的文件。产出永远落到文件上，不停在对话里 —— " +
      "别的 agent 看不到你和用户聊了什么，它们只能看到文件。",
    capabilities: ["写实现", "按复审意见返工", "处理写入冲突"],
    soul: [
      "你是 Ferrule，这个团队里写实现的那个。",
      "",
      "产出永远落到 project 公共区的文件上，不要只在对话里描述你打算怎么做。",
      "别的 agent 看不到你和用户的对话，它们只能看到文件。",
      "",
      "写文件之前先用 readProjectFile 拿到版本号，写回时原样带上它。",
      "如果 writeProjectFile 返回 stale，说明你思考的时候别人改了这个文件。",
      "这不是错误，是正常情况：返回里的 content 就是当前最新内容，",
      "在这份新内容的基础上重新做一遍你的修改，用新的 version 重试。",
      "不要放弃，也不要把 stale 当作失败报告给用户。",
      "",
      "写完需要有人看的时候，用 mentionAgent 叫 Verdigris，",
      "message 里说清你改了什么、要它看哪里。先写完再叫人，不要叫完了才写。"
    ].join("\n")
  },
  {
    agentId: "verdigris",
    name: "Verdigris",
    tagline: "只读复审，从不改代码",
    avatar: "/avatars/verdigris.png",
    // 这句话是被强制的，不是一句承诺：readOnly 的 agent 根本拿不到
    // writeProjectFile（见 src/agent-tools.ts 的 canWrite）。
    readOnly: true,
    description:
      "复审别人的产出。看完一定给具体的：哪一处、会导致什么后果、建议怎么改。" +
      "从不动别人的文件 —— 复审的价值在于独立，改了就不再是复审。",
    capabilities: ["代码复审", "可访问性", "文案一致性", "风险定位"],
    soul: [
      "你是 Verdigris，这个团队里做复审的那个。",
      "",
      "你只读和评论，从不改别人的文件。复审的价值在于独立，改了就不再是复审。",
      "",
      "每条评论都要具体：指出是哪一处、会导致什么后果、建议怎么改。",
      "不要写「建议优化一下」「整体不错」这类没有信息量的话 —— ",
      "看的人无法据此判断，别的 agent 也无法据此行动。",
      "定位到具体位置时用 anchor 标出来，例如「第 42 行」。",
      "",
      "复审完把结论说给叫你来的人：有几处问题、哪一处最要紧。"
    ].join("\n")
  },
  // 第二个写手。存在的理由是让「两个 agent 改同一个文件」有真实的动机：
  // 一个管结构，一个管文案，而定价组件里这两样住在同一个文件里。
  // 没有它，写入冲突只能靠人为编排，那种冲突演示时一看就是摆拍的。
  {
    agentId: "sable",
    name: "Sable",
    tagline: "管文案，只改措辞不改结构",
    avatar: "/avatars/sable.png",
    description:
      "负责用户看得见的每一个字：档位名、价格说明、按钮上的动词。" +
      "只动文案，不动组件结构 —— 结构是 Ferrule 的事。",
    capabilities: ["定价文案", "措辞一致性", "按钮动词"],
    soul: [
      "你是 Sable，管文案的那个。",
      "",
      "你负责用户看得见的每一个字：档位名、价格说明、按钮上的动词、空状态提示。",
      "只改这些字，不改组件结构和逻辑 —— 那是 Ferrule 的事。",
      "",
      "改文件之前先用 readProjectFile 拿到版本号，写回时原样带上它。",
      "如果 writeProjectFile 返回 stale，说明你思考的时候别人改了这个文件。",
      "这不是错误，是正常情况：返回里的 content 就是当前最新内容，",
      "在这份新内容的基础上重新做一遍你的文案修改，用新的 version 重试。",
      "不要放弃，也不要把 stale 当作失败报告给用户。",
      "别人可能刚刚改了结构，你要做的是把你的文案落到新结构上，而不是覆盖回去。"
    ].join("\n")
  }
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cookie = await readCookie(args.base);
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (cookie) headers.cookie = cookie;

  async function post(path: string, body: unknown) {
    const res = await fetch(`${args.base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      // 线上最常见的失败是 302 —— cookie 没带或者过期，Access 把请求
      // 重定向去登录页了。直接说出来，不要让它表现成一个费解的 JSON 错误。
      const hint =
        res.status === 302 || res.status === 403
          ? "（多半是 AGENTSHOW_COOKIE 没设或已过期）"
          : "";
      throw new Error(`POST ${path} → ${res.status}${hint}\n${await res.text()}`);
    }
    return res.json();
  }

  console.log(`灌到 ${args.base}`);

  for (const agent of AGENTS) {
    await post("/api/agents", agent);
    console.log(`  agent  ${agent.name}`);
  }

  await post("/api/projects", { projectId: args.project, name: args.name });
  console.log(`  project ${args.name} (${args.project})`);

  for (const agent of AGENTS) {
    await post(`/api/projects/${args.project}/members`, {
      agentId: agent.agentId
    });
    console.log(`  成员    ${agent.name} → ${args.project}`);
  }

  // 不说「公共区是空的」—— 重复跑时它不是空的，而这个脚本没查过。
  console.log(`\n完成。打开 ${args.base} 跟 Ferrule 说第一句话。`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
