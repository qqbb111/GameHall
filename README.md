# GameHall

![GameHall：好友棋牌桌游馆，支持璀璨宝石、五子棋、四子连线、黑白棋、点格棋、路墙棋、24 点和德州扑克。](apps/web/public/og.png)

GameHall 是一个面向好友局的实时多人棋盘游戏平台。玩家使用昵称和六位邀请码创建私人房间，通过浏览器直接开始游戏；服务端负责房间生命周期、规则校验、状态持久化和实时广播。

当前提供八款可玩的游戏：

- 璀璨宝石：经典基础版，支持 2–4 人。
- 五子棋：15×15 棋盘，双人对局。
- 四子连线：7 列 6 行下落棋盘，双人对局。
- 黑白棋：8×8 棋盘，双人夹子翻转与数量结算。
- 点格棋：4×4 个点组成 3×3 方格，双人占边封格得分。
- 路墙棋：标准双人 9×9 棋盘。
- 24 点：限时双人速度对决。
- 德州扑克：标准无限注 2–4 人好友牌局，虚拟筹码跨手保留直至产生最终冠军。

## 核心能力

- 私人房间：通过邀请码或 `?room=XXXXXX` 分享链接加入；主动离房直接返回大厅，房间被其他人关闭或到期时显示提示。
- 服务端权威状态：回合、规则、胜负、版本和权限均在服务端校验。
- 可靠动作处理：使用 `actionId` 防止重复提交，使用 `expectedVersion` 拒绝过期状态上的操作；确认超时会以原 `actionId` 有界重试并同步权威棋盘。
- 持久化与恢复：SQLite WAL、外键、事务和版本化迁移；断线和服务重启具备有限恢复窗口。
- 连接恢复：WebSocket 不可用时尝试轮询，过期会话自动重建；网络恢复或页面唤醒时使用 `room:sync` 重新取得当前房间快照与消息，旧房间迟到事件及操作回执会被忽略。
- 单人电脑练习：四子连线与黑白棋可从首页或 `?practice=connect-four` / `?practice=reversi` 进入，无须昵称或实时连接；可选轻松/认真、自己或电脑先手，支持悔棋、重新开始和返回大厅。当前棋局、实际设置与悔棋历史自动保存在当前浏览器，刷新或返回后可继续；其他标签更新进度时首页入口会刷新，浏览器前进/后退保留原滚动与键盘焦点。设置只在明确重新开始后生效，电脑计算超时可重试。不创建房间或写入 SQLite。
- 多人房间：支持 2–4 人入座、准备、开局、结算和房主重开；多人玩法共享房间生命周期，具体回合由各自规则引擎推进。
- 房内消息：支持快捷表情和短文本消息，并持久化最近消息。
- 响应式界面：桌面、窄屏桌面、平板和手机都可从首页输入昵称、加入好友房或创建房间；八款游戏可搜索、按短局/策略/多人/收藏筛选，卡片可查看规则与大致时长，规则弹窗支持键盘操作。收藏保存在当前浏览器，无法存储时仍可临时使用；动画遵从系统减少动态效果设置。入房后回到房间标题，终局结果与棋盘同时可见，房间侧栏展示当前玩法规则；多人玩法由房主在成员准备后开局。

## 技术架构

```text
浏览器 React/Vite
        │ HTTP + Socket.IO
        ▼
Express / Socket.IO 服务
        │ 房间、会话、动作、事务、广播
        ├── packages/game-core   纯函数游戏规则
        ├── packages/protocol    Zod 协议与共享类型
        └── SQLite                房间、成员、消息、动作回执与对局状态
```

仓库采用 pnpm workspace 管理：

```text
apps/web                 React + Vite 前端
apps/server              Express + Socket.IO 服务端
packages/game-core       八款游戏的规则引擎
packages/protocol        客户端与服务端共享的事件协议
docs/                    验证流程与项目文档
render.yaml              Render 单实例部署配置
```

`packages/game-core` 提供八款游戏的纯规则引擎，服务端统一负责房间状态、动作校验、版本推进、实时广播与恢复；前端根据共享快照渲染对应的棋盘、牌桌和结算界面。

Web 的四子连线、黑白棋电脑搜索模块复用相同纯规则，在独立 Worker 中以有界深度和节点数选择合法动作；战术判断覆盖四连胜负与黑白棋角位。
本地练习存档的编解码按棋种隔离，带格式版本、大小和悔棋历史上限；读取时使用对应纯规则反序列化，并核对单人局的回合、自然终局与比分。四子连线的四连检测复用规则核心。
首页在会话连接中也可进入电脑练习；若已进入练习后好友房才恢复，页面提示并由玩家自行返回好友对局。练习入口遵从浏览器前进/后退，保留房间邀请码及其他 URL 参数。

`room:sync` 只接受成员的房间 ID，并在限流范围内重发权威房间、游戏和消息快照。访客会话超过有效期后会建立新身份，无法凭旧会话恢复原座位。

运行环境要求 Node.js `24.15+`、pnpm `11.19+`。

## 本地运行

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

启动后访问：

- Web：`http://127.0.0.1:5173`
- 服务健康检查：`http://127.0.0.1:3000/healthz`

Vite 会把 `/api` 和 `/socket.io` 代理到本地服务。首次启动时，服务端会创建 SQLite 数据库并执行缺失迁移。需要单独运行迁移时，在服务停止后执行：

```bash
pnpm migrate
```

## 验证

按改动范围选择定向检查：

```bash
pnpm verify:web       # 前端 lint、类型检查、测试和构建
pnpm verify:core      # 游戏规则核心 lint、类型检查、测试和构建
pnpm verify:server    # 服务端、数据库、Socket.IO 和集成测试
```

交付前运行完整门禁：

```bash
pnpm verify:full
```

完整门禁覆盖 lint、typecheck、单元测试、真实 HTTP/Socket.IO 集成测试、生产构建和负载冒烟。集成测试覆盖八款游戏、房间边界、重复与过期动作、断线恢复、重启恢复、房间消息、房主交接、多人对局和房间重开；负载冒烟覆盖 50 个连接和 25 个活跃房间。

璀璨宝石的定向检查：

```bash
pnpm --filter @gamehall/game-core test -- splendor
pnpm --filter @gamehall/server test -- splendor-migration
pnpm --filter @gamehall/server test:integration -- splendor
pnpm --filter @gamehall/web test -- SplendorGame RoomPage
```

四子连线及新棋盘游戏数据库迁移的定向检查：

```bash
pnpm --filter @gamehall/game-core test -- connect-four
pnpm --filter @gamehall/server test -- board-games-migration
pnpm --filter @gamehall/server test:integration -- connect-four
pnpm --filter @gamehall/web test -- ConnectFourGame
pnpm --filter @gamehall/web test -- solo-ai solo-progress SoloPracticePage SoloPracticePass App HomePage
pnpm --filter @gamehall/game-core test -- reversi
pnpm --filter @gamehall/server test:integration -- reversi
pnpm --filter @gamehall/web test -- ReversiGame
pnpm --filter @gamehall/game-core test -- dots-and-boxes
pnpm --filter @gamehall/server test:integration -- dots-and-boxes
pnpm --filter @gamehall/server test:integration -- board-games-lifecycle
pnpm --filter @gamehall/web test -- DotsAndBoxesGame
pnpm --filter @gamehall/web test -- solo-ai
```

连接恢复的定向检查：

```bash
pnpm --filter @gamehall/protocol test
pnpm --filter @gamehall/server test:integration -- connection-recovery
pnpm --filter @gamehall/server test:integration -- room-close-notification
pnpm --filter @gamehall/web test -- gamehall-client HomePage
```

验证矩阵和失败处理流程见 [`docs/verification-workflow.md`](docs/verification-workflow.md)。

## 游戏规则范围

| 游戏 | 当前规则范围 |
| --- | --- |
| 璀璨宝石 | 90 张发展卡、10 张贵族、2–4 人供应设置、保留、购买、黄金支付、贵族选择、15 分终局与平局处理 |
| 五子棋 | 15×15、黑先、连续五子胜、无禁手、满盘和棋 |
| 四子连线 | 7 列 6 行、棋子落在该列最低空位、横竖斜四连胜、满盘和棋；双方确认复赛后交换先手 |
| 黑白棋 | 8×8、黑先、八方向夹子翻转；无合法步自动跳过，双方均无步或满盘时以棋子数结算，双方确认复赛后交换黑方 |
| 点格棋 | 4×4 个点、24 条边、9 个格子；封闭格子每格得 1 分且继续回合，边全部画满后按分数结算，双方确认复赛后交换先手 |
| 路墙棋 | 双人 9×9、每人十墙、直跳与受阻斜跳、墙冲突校验、双方 BFS 通路校验 |
| 24 点 | A/J/Q/K 映射为 1/11/12/13，四牌各用一次，精确有理数计算，不执行 `eval`，每题 30 秒 |
| 德州扑克 | 2–4 人、1000 虚拟筹码、固定 10/20 盲注、无限注下注、短盲注自动全押跑牌、弃牌死钱、公共牌、摊牌、主池/边池和同牌平分（奇数余数从庄家左侧分配）；筹码跨手保留，全体未淘汰玩家确认后发下一手，仅剩一名有筹码玩家时整局结束 |

围棋、关牌、炸金花、罗松和牛牛目前仅保留产品入口，尚未开放对局。

## 配置

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `HOST` | HTTP 监听地址 | `0.0.0.0` |
| `PORT` | HTTP 端口 | `3000` |
| `DATABASE_PATH` | SQLite 数据库路径 | `./storage/gamehall.sqlite` |
| `PUBLIC_ORIGIN` | 对外访问源 | 本地为 `http://127.0.0.1:5173` |
| `ALLOWED_ORIGINS` | 允许的逗号分隔源 | 开发环境包含本地 Web 源 |

请从 [`.env.example`](.env.example) 开始配置。`.env`、SQLite 文件和 `storage/` 不应提交到仓库。

## 部署

项目提供 [`render.yaml`](render.yaml) 作为 Render 单实例 Web Service 配置。部署后可使用 `/healthz` 检查服务状态。

默认配置适合临时试玩：免费实例会休眠，SQLite 位于实例本地且没有持久磁盘，因此重启、休眠或重新部署可能清空游客、房间和对局数据。需要稳定保存数据时，应使用持久磁盘和单实例部署；如果未来需要横向扩容，应先将房间状态与动作回执迁移到可共享的数据服务。

## 设计边界

- 当前不包含账号系统、匹配、观战、排行榜、永久战绩、跨房私聊和支付能力。
- 免费部署不是高可用生产方案；实时连接、房间状态和 SQLite 数据库由同一个服务实例承载。
- 游戏状态由服务端生成并广播；客户端只提交动作，不直接决定规则结果。
- 对局快照只向玩家公开必要信息，璀璨宝石的保留牌等私有信息不会出现在其他玩家的视图中。
- 对局快照按玩法只向玩家公开必要信息：例如璀璨宝石的保留牌、德州扑克的手牌等私有信息不会出现在其他玩家的视图中。
- 游戏内资源只存在于当前房间和对局生命周期内，不支持充值、提现、跨房间保存或形成长期资产。

## 规则参考

璀璨宝石的基础规则参考[官方规则书](https://cdn.svc.asmodee.net/production-spacecowboys/uploads/2025/10/SCSPL01EN_SPLENDOR_RULES_LIGHT.pdf)，卡牌和贵族数据在测试中以仓库内的固定数据为准。
