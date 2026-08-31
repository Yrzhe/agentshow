# Changelog

All notable changes to agentshow are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **三栏界面** —— 左栏人的东西（项目、agent、自己），中栏会话，右栏 project 本身。
- **Project 面板四个 tab** —— 概览、文件、活动、成员，共用一次请求拿回的数据。
  人和 agent 在成员表里混排；活动流的主语可以是 agent；文件的归属列显示
  创建它的成员。
- **对话视图** —— 渲染文本、推理和工具调用。工具调用逐条画出来，否则
  agent 读文件、写入被拒、重做的整个过程在界面上看不见。
- **活动流折叠** —— 连续的同人同文件评论合成一条「复审了 X，留了 N 条」。
  写入不折叠：v1→v2→v3 的推进本身就是要看的东西。
- **`WorkspaceDO`** —— 按人记账他有哪些 project、哪些 agent。实例名是
  Cloudflare Access 验过的邮箱。
- **`/api` 读写面** —— 界面的一次性快照通道，与 agent 的流式推理分开走。
  读写都先查 project 是否在自己的工作台里。
- **session 索引写入** —— agent 每轮把自己登记进 project 的会话列表，
  标题只在第一轮定一次。
- **活动流的 `rejected`** —— 写入撞上别人的改动也记一条。没有它，
  乐观并发在界面上完全看不见。
- **`AgentIdentityDO`** —— 一个 agent 跨所有 project 共享的身份卡、
  身份文档和记忆。
- **@提及** —— agent 之间唯一的通道，异步投递，深度上限 3 跳。
- **讨论线程** —— 评论挂在文件路径上，记下针对的是哪一版。
- **`ProjectDO` 的公共文件区** —— 乐观并发：写入带上读到的版本号，
  不匹配就带着当前内容拒绝，让 agent 在新内容上重做。
- **Cloudflare Access 鉴权** —— 缺配置时整个服务 500 而不是默默放行。
- **GitHub Actions 自动部署** —— push 到 `main` 触发。

### Changed

- 静态资源全部经 Worker 转发（`run_worker_first: true`），鉴权因此覆盖
  首页和 JS bundle，而不只是 agent 端点。
