## 1. `agentKey()` 是否可碰撞

能。`dm` 同时是合法 slug 和「无 project」的保留编码，因此以下两组不同输入产出同一个字符串：

```text
(owner="alice@example.com", agentId="a", projectId=undefined)
(owner="alice@example.com", agentId="a", projectId="dm")

两者均产出：alice@example.com~a:dm
```

依据：`SLUG_RE` 接受 `dm`（`agentshow/src/agent-key.ts:26-27`）；`agentKey()` 把缺省 project 映射为字面量 `dm`（`agentshow/src/agent-key.ts:45-54`）；`parseAgentKey()` 又把字面量 `dm` 无条件还原为 `null`（`agentshow/src/agent-key.ts:80-89`）。所以 project slug `dm` 与 DM 无法区分。

除此之外，在 `agentId` 和非空 `projectId` 都满足该 slug 正则的前提下，不能通过移动 `~` 或 `:` 的边界再制造碰撞：输出串中最后一个 `~` 必然是 owner 分隔符，因为两个 slug 都不能含 `~`；该位置之后的第一个 `:` 必然是 agent/project 分隔符，因为 `agentId` 不能含 `:`。相同输出因此会唯一确定 owner、agentId 和 project 槽位。唯一例外就是上述 `undefined` 与合法 slug `dm` 被编码成同一槽位。

## 2. RFC 5322 对 owner 分隔符的影响

RFC 5322 §3.2.3 的 `atext` 明确包含 `~`，不包含 `:`；同节把 `:` 列入 `specials`。RFC 5322 §3.2.4 的 `qtext` 包含 ASCII 58（`:`），而 §3.4.1 定义 `local-part = dot-atom / quoted-string / obs-local-part`。因此：

- `~` 可以直接出现在未加引号的邮箱本地部分，例如 `a~b@example.com`。
- `:` 不能直接出现在 dot-atom，但可以出现在 quoted-string 本地部分，例如 `"a:b"@example.com`。

规范出处：[RFC 5322 §3.2.3 Atom、§3.2.4 Quoted Strings、§3.4.1 Addr-Spec](https://www.rfc-editor.org/rfc/rfc5322.html)。

这不改变第 1 题的结论。owner 中的 `~` 都位于 `agentKey()` 追加的最后一个 `~` 之前，所以 `lastIndexOf("~")` 仍能找回正确边界；owner 中的 `:` 也位于该最后一个 `~` 之前，不会影响随后只在 `rest` 中执行的 `indexOf(":")`（`agentshow/src/agent-key.ts:67-81`）。RFC 允许这些字符不会新增碰撞，也不会消除 `dm` 碰撞。

## 3. `routeAgentRequest` 实际接受的路径形状

`agents@0.21.0` 的 `routeAgentRequest()` 本身只把前缀设为 `agents`，再委托给 `partyserver` 的 `routePartykitRequest()`（`node_modules/agents/dist/index.js:7066-7070`；锁定版本见 `agentshow/package-lock.json:3969-3983`）。真正的解析规则是：

```text
/<prefix>/<namespace>/<instance-name>
/<prefix>/<namespace>/<instance-name>/<任意后续路径...>
```

在本应用未传第三个 options 参数时，`prefix` 就是单段、大小写敏感的 `agents`。解析器对 `new URL(req.url).pathname` 按 `/` 切分并过滤空段，要求过滤后的开头严格是 `agents`，且至少还有 namespace 与 instance 两段；随后固定取 namespace 和紧邻其后的 name，再用该 name 调 `idFromName`（`node_modules/partyserver/dist/index.js:482-508`）。后续任意段原样随请求转发给该实例（`node_modules/partyserver/dist/index.js:510-542`）。因此尾斜杠、重复斜杠和额外 handler 子路径都只是上述同一种形状的等价写法；它没有单段实例名、查询参数实例名或其他备用路由形状。

对当前应用，答案是：没有任何被 SDK 接受的形状能让实例名落在 `checkAgentRoute` 的 `parts[1]` 以外。闸门去掉 `/agents/` 后也按 `/` 切分并过滤空段，固定以 `parts[0]` 为 namespace、`parts[1]` 为实例名（`agentshow/src/agent-route.ts:16-36`），与 SDK 的索引完全一致。`parts.length < 2` 时，SDK 对应的过滤后总段数不足 3，也会直接返回 `null`，不会路由到任何 DO（`node_modules/partyserver/dist/index.js:483-486`）。

通用 API 有一个不在当前调用中启用的例外：调用方可以用 `options.prefix` 覆盖默认前缀，因为 `...options` 位于 `prefix: "agents"` 之后（`node_modules/agents/dist/index.js:7066-7070`），而 partyserver 也支持多段 prefix（`node_modules/partyserver/dist/index.js:482-486`）。若本应用未来改为自定义或多段 prefix，却不同时修改 `checkAgentRoute`，实例名索引就可能错位；当前代码没有启用该形状。
