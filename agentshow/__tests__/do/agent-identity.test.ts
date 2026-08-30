/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * AgentIdentityDO 装的是跨所有 project 共享的那部分：身份卡、身份文档、记忆。
 *
 * 它之所以要单独成一个 DO，是因为 Think 每个 DO 只管一条 session，
 * 而一条 session 只属于一个 project。身份和记忆要跨 project 活着，
 * 就不能待在会话所在的那个 DO 里。
 */

const id = (name: string) =>
  env.AgentIdentityDO.get(env.AgentIdentityDO.idFromName(name));

describe("AgentIdentityDO", () => {
  it("身份文档默认非空 —— 空 soul 会让 agent 没有人格", async () => {
    await runInDurableObject(id("fresh"), async (o) => {
      expect(o.getIdentityDoc().length).toBeGreaterThan(0);
    });
  });

  it("记忆默认为空字符串，不是 null —— context provider 要的是 string", async () => {
    await runInDurableObject(id("fresh"), async (o) => {
      expect(o.getMemory()).toBe("");
    });
  });

  it("身份文档可写可读 —— agent 自己改写自己", async () => {
    await runInDurableObject(id("ferrule"), async (o) => {
      o.setIdentityDoc("我负责写实现，产出交给别人复审。");
      expect(o.getIdentityDoc()).toBe("我负责写实现，产出交给别人复审。");
    });
  });

  it("记忆是追加的，不是覆盖", async () => {
    await runInDurableObject(id("ferrule"), async (o) => {
      o.appendMemory("定价页用的是 pricing-table.tsx");
      o.appendMemory("Verdigris 复审时特别看空数组");
      const m = o.getMemory();
      expect(m).toContain("pricing-table.tsx");
      expect(m).toContain("空数组");
    });
  });

  it("身份卡可读写，是对外的那一面", async () => {
    await runInDurableObject(id("verdigris"), async (o) => {
      o.setProfile({ name: "Verdigris", tagline: "只读复审，从不改代码" });
      const p = o.getProfile();
      expect(p.name).toBe("Verdigris");
      expect(p.tagline).toBe("只读复审，从不改代码");
    });
  });

  it("同一个 agentId 拿到同一份身份 —— 跨 project 共享就靠这个", async () => {
    await runInDurableObject(id("ferrule"), async (o) => {
      expect(o.getIdentityDoc()).toBe("我负责写实现，产出交给别人复审。");
    });
  });
});
