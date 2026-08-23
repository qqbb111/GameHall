# GameHall

`GameHall` 是一个完全独立的好友联机棋牌桌游网站，不复用也不依赖 GameLobby。首版提供五子棋、标准双人路墙棋和 24 点速度对决；围棋、关牌、炸金花、罗松、牛牛只显示“开发中”，不会生成未确认规则或虚假入口。

## 首版能力

- 游客昵称进入，通过六位邀请码或 `?room=XXXXXX` 分享链接加入双人房。
- 服务端权威校验回合、规则、版本和胜负；`actionId` 幂等，拒绝过期 `expectedVersion`。
- SQLite 使用 WAL、外键、事务和版本化迁移，原子保存房间状态与动作回执。
- 活跃玩家断线后整局暂停，60 秒内凭 HttpOnly Cookie 恢复；服务重启后双方有 10 分钟恢复窗口。
- 24 点题钟在暂停时冻结；服务每秒持久化运行心跳，硬重启后按最后运行时刻恢复真实剩余题时，不会重置为 30 秒。
- 结束后双方可申请复赛，五子棋交换黑白、路墙棋交换起始边。
- 房内只有 👍、👏、😄、🤔 四个固定表情，不接收自由文本。
- 无账号、匹配、观战、聊天、排行榜、永久战绩、AI、真钱、充值、筹码或奖励兑换。

## 技术结构

```text
apps/web                 React + Vite 响应式中文界面
apps/server              Express + Socket.IO + node:sqlite 权威服务
packages/game-core       三款游戏的纯函数规则引擎
packages/protocol        Zod 协议校验、事件和共享类型
render.yaml              单实例付费 Render Web Service + 持久磁盘
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

## 验证门禁

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm smoke:load
```

`test:integration` 会启动真实 HTTP/Socket.IO 服务与两个 Socket.IO 客户端，覆盖建房、加入、准备、整局五子棋、完整走到目标边的路墙棋、打到 5 分并经历错误冷却与题目超时的 24 点对决，以及幂等/乱序动作、无 ACK 客户端、断线恢复、超时判负、优雅/硬重启恢复、重启恢复超时、固定表情和复赛换边。`smoke:load` 建立 50 个并发连接与 25 个活跃房间。

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
2. 在 Render 创建 [Blueprint](https://render.com/docs/blueprint-spec) 并选择根目录的 `render.yaml`。它固定为一个 Starter Node Web Service、一个实例和 1 GB [持久磁盘](https://render.com/docs/disks)。
3. Blueprint 将 SQLite 写入 `/opt/render/project/src/storage/gamehall.sqlite`。迁移在服务启动、打开数据库时以事务自动执行。不要把 SQLite 迁移放入 Render 的 pre-deploy command：该阶段无法访问挂载磁盘。
4. 首次上线后检查 `/healthz` 返回 `{"ok":true}`，再用两个独立浏览器分别验收建房、加入、三款游戏与断线重连。
5. 如使用自定义域名，设置 `PUBLIC_ORIGIN=https://你的域名`，并把该源加入 `ALLOWED_ORIGINS` 后重新部署。

SQLite 持久磁盘决定了此版本只能运行单实例；如果未来要横向扩容，应先把房间状态和动作回执迁移到可共享的数据服务。
实时连接使用 Render 公网支持的 [WebSocket](https://render.com/docs/websocket)，生产环境由同一 Node 服务同源提供网页、HTTPS/WSS 与健康检查。

## 已实现规则边界

- 五子棋：15×15、黑先、连续至少五子胜、无禁手、满盘和棋。
- 路墙棋：标准双人 9×9、每人十墙、直跳/受阻斜跳、墙冲突校验和双方 BFS 通路校验。
- 24 点：A=1、J=11、Q=12、K=13，四牌各一次，仅二元四则与括号；自研解析器使用精确有理数且不执行 `eval`。每题 30 秒，错误冷却 3 秒，先到 5 分获胜。

后续新增五款开发中游戏前，必须先确认完整规则清单。
