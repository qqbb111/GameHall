# GameHall 分层验证与 Agent 协作

本项目采用“单写入者、独立验证者”的串行协作方式。目标是在不降低交付门槛的前提下，减少开发过程中重复运行全量测试的时间和模型开销。

## 角色与边界

- 实现 Agent 默认使用 Sol medium，负责理解需求、修改代码、更新测试和创建 commit。数据库、协议、游戏规则、事务与并发等复杂改动可升级为 Sol high。
- 验证 Agent 默认使用 Luna medium，在 commit 完成后只读审查 diff 并运行验证。它不得修改实现、测试或降低断言。
- Luna max 只用于普通验证无法解释的竞态、幂等、断线恢复或 flaky 问题，不用于机械执行测试命令。
- 同一时间只有实现 Agent 可以写工作区。集成测试和负载测试必须串行运行，避免共享服务或数据库相互污染。

## 何时启用独立验证 Agent

以下改动默认使用单 Agent：文案、纯样式、局部组件和范围明确的测试修正。

满足任一条件时增加独立验证 Agent：

- 修改游戏规则、数据库迁移、房间状态或 Socket.IO 协议；
- 涉及重连、事务、幂等、并发或安全；
- 同时影响两个以上 workspace 包；
- 一个交付批次包含多个功能 commit；
- 用户明确要求独立复核。

## 验证矩阵

| 改动范围 | 实现过程中 | commit 前 |
| --- | --- | --- |
| 文案、纯样式 | 相关页面测试或浏览器检查 | `pnpm --filter @gamehall/web build` |
| Web 交互 | 对应 Vitest 文件 | `pnpm verify:web` |
| game-core 规则 | 对应规则测试 | `pnpm verify:core` |
| protocol 类型 | protocol 测试 | protocol lint/typecheck/test，并检查 server/web typecheck |
| Server、房间、数据库 | 对应 unit test | `pnpm verify:server` |
| Socket、重连、跨层流程 | 精确回归测试 | unit test 与 integration test |
| 性能或连接规模 | 相关 integration test | server build；最终门禁包含 smoke-load |

一个 commit 只运行受影响范围的验证。一个交付批次全部完成后，再运行一次：

```powershell
pnpm verify:full
```

该命令依次运行 lint、typecheck、单元测试、集成测试、production build 和负载冒烟，并与 CI 使用同一入口。

## 失败交接

验证 Agent 发现失败后停止扩大全量检查，并向实现 Agent 提供：

1. 首个失败命令；
2. 关键断言或日志；
3. 可能受影响的文件与测试；
4. 代码问题、测试问题或环境问题的判断；
5. 最小复现方式。

实现 Agent 修复并补充回归测试、创建新 commit 后，验证 Agent 先重跑失败项和受影响检查。只有这些检查稳定通过后，才重新运行 `pnpm verify:full`。

## 三次交付试运行记录

先在 GameHall 连续记录三个交付批次，再决定是否推广到其他仓库或引入额外模型服务。

| 批次 | 改动类型 | 实现耗时 | 定向验证耗时 | 全量验证耗时 | 失败定位次数 | 模型用量备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 |
| 2 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 |
| 3 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 |
