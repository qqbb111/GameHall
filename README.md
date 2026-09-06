# GameHall

`GameHall` 是一个完全独立的好友联机棋牌桌游网站，不复用也不依赖 GameLobby。提供 2–4 人经典基础版璀璨宝石、五子棋、标准双人路墙棋和 24 点速度对决；围棋、关牌、炸金花、罗松、牛牛只显示“开发中”。

## 首版能力

- 游客昵称进入，通过六位邀请码或 `?room=XXXXXX` 分享链接加入好友房。璀璨宝石支持 2–4 人，其余游戏仍为双人。
- 服务端权威校验回合、规则、版本和胜负；`actionId` 幂等，拒绝过期 `expectedVersion`。
- SQLite 使用 WAL、外键、事务和版本化迁移，原子保存房间状态与动作回执。
- 活跃玩家断线后整局暂停，60 秒内凭 HttpOnly Cookie 恢复；服务重启后全员有 10 分钟恢复窗口。
- 24 点题钟在暂停时冻结；服务每秒持久化运行心跳，硬重启后按最后运行时刻恢复真实剩余题时，不会重置为 30 秒。
- 双人游戏结束后双方可申请复赛，五子棋交换黑白、路墙棋交换起始边。璀璨宝石由房主保留邀请码返回等待区、补人并重新准备。
- 房内支持 8 个快捷表情和最多 100 个可见字符的自定义消息；每个房间持久化最近 100 条，房间清理时级联删除。
- 无账号、匹配、观战、跨房私聊、排行榜、永久战绩、AI、真钱、充值、筹码或奖励兑换。

## 技术结构

```text
apps/web                 React + Vite 响应式中文界面
apps/server              Express + Socket.IO + node:sqlite 权威服务
packages/game-core       四款游戏的纯函数规则引擎
packages/protocol        Zod 协议校验、事件和共享类型
render.yaml              单实例免费 Render Web Service（临时试玩）
apps/web/public/og.png    GameHall 分享预览图与页面社交元数据
```

要求 Node.js 24.15+、pnpm 11.19+。

## 本地运行

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

网页默认运行在 `http://127.0.0.1:5173`，Vite 将 `/api` 和 `/socket.io` 代理到 `http://127.0.0.1:3000`。首次启动自动创建 `apps/server/storage/gamehall.sqlite` 并执行缺失迁移。

需要单独检查迁移时，可在服务停止后运行：

```bash
pnpm migrate
```

## 分层验证

开发过程中只运行受影响范围的检查，不为每个 commit 重复执行全量测试：

```bash
pnpm verify:web       # Web 交互、样式与构建
pnpm verify:core      # 游戏规则核心
pnpm verify:server    # 服务端、数据库与 Socket.IO
```

一次交付中的所有 commit 完成后，统一运行一次完整门禁：

```bash
pnpm verify:full
```

它依次执行 lint、typecheck、单元测试、集成测试、production build 和负载冒烟，与 CI 使用同一入口。`test:integration` 会启动真实 HTTP/Socket.IO 服务与 2–4 个 Socket.IO 客户端，覆盖四款游戏完整对局、第五人拒绝、幂等/乱序动作、断线与重启恢复、房间消息、房主交接和补人重开；`smoke:load` 建立 50 个并发连接与 25 个活跃房间。

璀璨宝石定向验证：

```bash
pnpm --filter @gamehall/game-core test -- splendor
pnpm --filter @gamehall/server test -- splendor-migration
pnpm --filter @gamehall/server test:integration -- splendor
pnpm --filter @gamehall/web test -- SplendorGame RoomPage
```

规则测试固定完整卡池摘要、贵族清单、2/3/4 人设置，并检查完整模拟对局中的宝石与卡牌守恒。联机测试覆盖每种必选阶段的重连与文件数据库重启，以及状态和回执插入失败时的事务回滚。迁移测试使用冻结的 v3 SQL 文件创建带旧对局、成员、消息和回执的数据库，验证升级、重复启动、失败回滚、外键与完整性。

## 开发协作

- 每个逻辑完整的改动创建独立 Git commit，并同步更新本 README 中受影响的功能、接口、运行方式或开发约定。
- 文案、局部样式和单组件修改默认由单个实现 Agent 完成。
- 游戏规则、数据库、Socket.IO、重连、事务、并发、安全或跨包改动增加独立只读验证 Agent。
- 实现默认使用 Sol medium，独立验证默认使用 Luna medium；Luna max 仅用于疑难竞态、幂等或 flaky 问题。
- 同一时间只有一个 Agent 修改工作区，集成测试与负载测试串行执行。

完整的验证矩阵、失败交接格式和三次试运行记录见 [`docs/verification-workflow.md`](docs/verification-workflow.md)。仓库级硬性规则见 [`AGENTS.md`](AGENTS.md)。

## 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `HOST` | HTTP 监听地址 | `0.0.0.0` |
| `PORT` | HTTP 端口；Render 会自动提供 | `3000` |
| `DATABASE_PATH` | SQLite 文件路径 | `./storage/gamehall.sqlite`（相对服务进程目录） |
| `PUBLIC_ORIGIN` | 对外 HTTPS 源；生产环境可由 `RENDER_EXTERNAL_HOSTNAME` 自动推导 | 本地为 `http://127.0.0.1:5173` |
| `ALLOWED_ORIGINS` | 允许的逗号分隔源；自定义域名时设置 | 生产仅 `PUBLIC_ORIGIN`；开发另含本地 Vite 源 |

## Render 部署

1. 将本项目放入由你控制的 GitHub/GitLab 仓库；不要提交 `.env`、SQLite 文件或 `storage/`。
2. 在 Render 创建 [Blueprint](https://render.com/docs/blueprint-spec) 并选择根目录的 `render.yaml`。试玩配置使用新加坡区域的单实例免费 Node Web Service，不需要付费资源。
3. Blueprint 将 SQLite 写入 `/opt/render/project/src/storage/gamehall.sqlite`。免费实例没有持久磁盘：每次休眠、重启或重新部署后，游客、房间和对局数据都会清空；迁移会在服务启动时自动重建数据库。
4. 首次上线后检查 `/healthz` 返回 `{"ok":true}`，再用独立浏览器验收建房、加入、四款游戏与断线重连；璀璨宝石再检查四人开局和补人重开。
5. 如使用自定义域名，设置 `PUBLIC_ORIGIN=https://你的域名`，并把该源加入 `ALLOWED_ORIGINS` 后重新部署。

免费实例适合临时发给朋友试玩，但闲置 15 分钟后会休眠，唤醒、重启或重新部署时本地 SQLite 会清空。需要稳定保存数据时，应将 `plan` 升级为付费实例并挂载 1 GB [持久磁盘](https://render.com/docs/disks)；SQLite 模式仍只能运行单实例。如果未来要横向扩容，应先把房间状态和动作回执迁移到可共享的数据服务。
实时连接使用 Render 公网支持的 [WebSocket](https://render.com/docs/websocket)，生产环境由同一 Node 服务同源提供网页、HTTPS/WSS 与健康检查。

## 已实现规则边界

- 璀璨宝石：经典基础版 90 张发展卡、10 张贵族；2/3/4 人每色普通宝石为 4/5/7 枚，黄金 5 枚，贵族为人数加一。完整拿取、明牌/盲抽保留、永久折扣、普通宝石与黄金自由组合支付、十枚上限归还、多贵族选择、十五分最后一轮和共享胜利。
- 五子棋：15×15、黑先、连续至少五子胜、无禁手、满盘和棋。
- 路墙棋：标准双人 9×9、每人十墙、直跳/受阻斜跳、墙冲突校验和双方 BFS 通路校验。
- 24 点：A=1、J=11、Q=12、K=13，四牌各一次，仅二元四则与括号；自研解析器使用精确有理数且不执行 `eval`。每题 30 秒，错误冷却 3 秒，先到 5 分获胜。

后续新增五款开发中游戏前，必须先确认完整规则清单。

## 璀璨宝石房间与数据

界面采用原创 SVG 宝石、矿场/工坊/宫殿卡面与贵族徽章。六种宝石以形状、颜色和中文名称共同区分；玩家分数和永久折扣常驻，详情可展开。卡牌点击后打开确认面板，默认普通宝石优先，可调整黄金支付；盲抽也需确认。必选归还与贵族阶段自动定位，交易面板支持键盘焦点循环与 Escape 返回。手机为纵向牌桌和固定底部快捷操作区，支持减少动画偏好；结算保留桌面可读性并在顶部提供返回等待区入口。

浏览器验收使用独立内存数据库与四个本地客户端，在 1440px、768px、375px 检查布局，并操作准备开局、拿取、黄金支付、盲抽确认、归还、贵族、结算和重开；必选/支付/结算使用受控场景，完整自然对局另由真实 Socket.IO 集成测试覆盖。

- 至少两位、全员在线且准备后，房主通过 `room:start` 确认开局。新局重新洗牌并由服务端随机首家，按座位顺序循环；开局后不接纳新玩家。
- 认输、主动离开、断线超过 60 秒或重启恢复超过十分钟，中止且不计胜负，显示原因与当时分数，不生成赢家。无合法主行动时才可跳过，整轮全员无法行动则中止。这是明确标注在规则帮助中的线上补充约定；默认无回合倒计时。
- 结束或中止后，房主通过 `room:reopen` 保留邀请码，释放离线座位并清空准备和旧对局。房主离开、等待区房主断线，或中止后房主仍离线时，交给最早入房的在线成员。离开当前房间后才能加入其他房间。
- `room:start` / `room:reopen` 均携带 `{ commandId, roomId, expectedVersion }`，权限、阶段、准备状态与回执在事务内处理。重复命令返回原回执，过期或篡改请求不再洗牌、重开；命令和 `game:action` 共用回执表，编号不能跨用途复用。
- `game:action` 新动作：`takeTokens`、`reserve`、`purchase`、`returnTokens`、`chooseNoble`、受限 `pass`；`resign` 可在暂停时中止。购买与归还均提交包含五色和 `gold` 的完整数量对象，服务端严格校验。
- 主行动、归还宝石、选择贵族、结束阶段分别持久化。快照只包含市场、供应、公开玩家信息、牌堆数量及本人的保留牌；对手只见保留数量，终局和重连也不会公开私牌。旧座位聊天记录通过服务端 `isMine` 标记区分原发送者。
- SQLite v4 在单事务内备份相关数据、按依赖重建表并恢复原索引，扩展游戏和 0–3 座位约束，保存 `host_seat`。历史迁移不变；旧游戏仍以 `Player = 0 | 1` 和座位检查限制双人。

规则依据：[官方基础版规则书](https://cdn.svc.asmodee.net/production-spacecowboys/uploads/2025/10/SCSPL01EN_SPLENDOR_RULES_LIGHT.pdf)。发展卡成本、分数、奖励颜色逐项对比 [kyle-ip 数据](https://github.com/kyle-ip/splendor/blob/main/src/data/card-pool.json) 与 [anicolao 核对表](https://github.com/anicolao/splendor/blob/main/data/verified_card_properties.csv)，90 项完全一致。按 `tier|bonus|points|white,blue,green,red,black` 排序、LF 连接且无末尾换行的 SHA-256 为 `417d650b072d783121cbb910ac3aa5bbce0f533fffb05a34c3645ed68d5c6401`。贵族另与 [Splendor-AI 清单](https://github.com/roeey777/Splendor-AI/blob/master/src/splendor/splendor/splendor_utils.py) 交叉核对，纠正前一个 JSON 中将红四黑四误写为绿四黑四的一项。只使用规则事实与数值，界面不使用原版卡图。
