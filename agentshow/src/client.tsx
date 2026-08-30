import { createRoot } from "react-dom/client";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/think/react";

/**
 * Task 1 的界面只为验证一件事：模型能不能调通、流式能不能到浏览器。
 * 真正的三栏界面在 Task 8。
 */
function Chat() {
  // 实例名 = `${agentId}:${projectId}`，一个实例就是一条 session。
  // Task 8 的真界面里这个名字由左栏选中的 agent 和 project 拼出来。
  const agent = useAgent({ agent: "AgentDO", name: "ferrule:demo" });
  const { messages, sendMessage, status } = useAgentChat({ agent });

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 18 }}>agentshow · Task 1 连通性检查</h1>

      {messages.map((m) => (
        <div key={m.id} style={{ margin: "12px 0" }}>
          <b>{m.role}: </b>
          {m.parts.map((part, i) =>
            part.type === "text" ? <span key={i}>{part.text}</span> : null
          )}
        </div>
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("q") as HTMLInputElement;
          if (!input.value.trim()) return;
          sendMessage({ text: input.value });
          input.value = "";
        }}
      >
        <input name="q" placeholder="说点什么" style={{ width: "78%", padding: 8 }} />
        <button type="submit" style={{ padding: 8 }}>发送</button>
      </form>

      <p style={{ fontSize: 12, color: "#777" }}>status: {status}</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Chat />);
