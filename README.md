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
- 24 点：限时双人速度对决；可点牌输入数值，在光标位置编辑算式，并用快捷键或按钮撤销、重做。
- 24 点单人练习：首页卡片或 `?practice=twenty-four` 直接进入，无须昵称或连接。可选不限时 10 题或 60 秒挑战；每组 10 道可解且牌面数字组合不重复的题。错答即时反馈并保留算式，逐步提示展示一种可行解法；答对或查看答案后由玩家手动进入下一题。结果区分独立解出、参考解出和查看答案，支持暂停、恢复与再来一组。明确开始、继续或进入下一题后，键盘焦点进入可操作的算式框或下一题按钮；异步生成期间用户移焦后不抢焦点。挑战计时在题间持续，运行中页面隐藏或离开时暂停，恢复后等待手动继续；已暂停或已结算的页面离开不会改写共享存档。
- 德州扑克：标准无限注 2–4 人好友牌局，虚拟筹码跨手保留直至产生最终冠军。

## 核心能力

- 私人房间：通过邀请码或 `?room=XXXXXX` 分享链接加入；只有 `room` 查询参数会预填邀请码，其他页面参数不会生成房间码。主动离房直接返回大厅，房间被其他人关闭或到期时显示提示。
- 服务端权威状态：回合、规则、胜负、版本和权限均在服务端校验。
- 可靠动作处理：使用 `actionId` 防止重复提交，使用 `expectedVersion` 拒绝过期状态上的操作；确认超时会以原 `actionId` 有界重试并同步权威棋盘。
- 持久化与恢复：SQLite WAL、外键、事务和版本化迁移；断线和服务重启具备有限恢复窗口。
- 连接恢复：WebSocket 不可用时尝试轮询，过期会话自动重建；网络恢复或页面唤醒时使用 `room:sync` 重新取得当前房间快照与消息，旧房间迟到事件及操作回执会被忽略。在线棋盘的回合提示会区分轮到谁、好友离线暂停、自己连接恢复和本次操作确认中；确认期间棋盘暂不可重复操作。
- 单人电脑练习：四子连线、黑白棋、点格棋和五子棋可从首页或 `?practice=connect-four` / `?practice=reversi` / `?practice=dots-and-boxes` / `?practice=gomoku` 进入，无须昵称或实时连接；可选轻松/认真、自己或电脑先手，支持悔棋、重新开始和返回大厅。五子棋在 15 路棋盘上落子，先手执黑；手机默认显示完整棋盘，可点“放大”在棋盘内双向滑动，或点“定位最近一步”（空局为棋盘中心）查看局部，再点“全盘”返回全局；拖动棋盘不会落子。点格棋封格得分后可连续画边，电脑也会接着完成连续回合。进行中已有落子时，重新开始需确认清空当前局；Esc 或点击背景可取消并回到重开按钮，空局或终局可直接开始新局。轮到自己时可用“提示一步”查看建议落点及原因，自由选择、采用或取消；提示不自动落子，也不计入存档。当前棋局、实际设置与悔棋历史自动保存在当前浏览器，刷新或返回后可继续；另一窗口更新同款练习时，当前棋盘保留在本标签，冲突提示并排预览两盘差异，再让玩家明确选择接着已保存的局面或保存当前棋局，离开不会覆盖另一窗口。选择接着共享棋局时会重读修订；若另一窗口又更新，先展示新预览，需再次明确选择，读取期间本地继续落子也不会被迟到结果覆盖。浏览器用 IndexedDB 事务按游戏核对存档修订，不依赖 Web Locks；暂时无法访问共享存储时保留本标签草稿并提示范围。其他标签更新进度时首页入口会刷新，浏览器前进/后退保留原滚动与键盘焦点。设置只在明确重新开始后生效，电脑计算和提示超时可重试。四种搜索都在后台运行，动作经纯规则校验。不创建房间或写入 SQLite。
- 棋盘键盘操作：点格棋用方向键选空边、Enter/空格画边；四子连线用左右方向键跳过满列、Home/End 到首末可用列、Enter/空格投放。键盘落子后轮到自己时可继续从棋盘操作；Tab 离开棋盘后不会抢回焦点。
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

Web 的四子连线、黑白棋、点格棋电脑搜索模块复用相同纯规则，在独立 Worker 中以有界深度和节点数选择合法动作；战术判断覆盖四连胜负、黑白棋角位，以及点格棋封格得分、避免送出第三边和连续回合。
本地练习存档的编解码按棋种隔离，带格式版本、大小和悔棋历史上限；读取时使用对应纯规则反序列化，并核对单人局的回合、自然终局与比分。点格棋额外保存最多 24 条实际画边轨迹，从先手逐步重放并逐一核对悔棋前的人类回合快照。五子棋保存最多 225 步完整落子轨迹，逐步重放核对终局和最近最多 16 个悔棋快照，长局仍可刷新继续。超限损坏记录只保留有界指纹作变化提示；这不是跨标签原子比较。四子连线的四连检测复用规则核心。
24 点单人题组在 Web Worker 中生成并验算，界面与在线对局共用算式编辑器；10 题进度、草稿、提示状态和挑战剩余时间使用独立版本化存档。恢复时校验真实牌 ID、题组不重复、可验证答案和作答记录，计时默认暂停。IndexedDB 事务比较修订以避免多窗口覆盖；事务提交回执超时后以本次写入的唯一令牌核对，未能确认时将待核对令牌连同即时草稿保留在 `sessionStorage`，刷新也能继续确认，不会把自己的迟到写入误判成另一窗口。冲突发生时将当前标签的进度保留为草稿，包括已暂停或已结算的题组；刷新后仍可比较本标签与共享进度。冲突框并排显示两边的阶段、题牌、草稿、提示及挑战剩余时间；共享更新只读刷新预览，选择前再次核对版本，若出现未见过的新版先提示重新比较。浏览器禁止存储时会显示保存范围。
练习页和首页以 IndexedDB 为共享存档源，在单次读写事务中比较修订；`sessionStorage` 草稿用于刷新前的即时恢复。首页 24 点入口只读当前浏览器的共享进度与本标签草稿，显示“继续练习”或“查看上组结果”；共享库不可读或存档无效时仍可打开练习。旧版 `localStorage` 记录仅在尚无 IndexedDB 存档时读取，并在首次成功保存时迁移；不双写旧存储。共享存储不可读时，旧记录和本标签草稿仍可恢复，但会提示当前保存范围；四子连线、黑白棋和点格棋也会用写前记录的唯一令牌核对迟到回执与刷新后的存档归属，不把自己的提交误报成窗口冲突，也不把残留的旧草稿误报为已保存。
首页在会话连接中也可进入电脑练习；若已进入练习后好友房才恢复，页面提示并由玩家自行返回好友对局。练习入口遵从浏览器前进/后退，保留房间邀请码及其他 URL 参数。

`room:sync` 只接受成员的房间 ID，并在限流范围内重发权威房间、游戏和消息快照。访客会话超过有效期后会建立新身份，无法凭旧会话恢复原座位。
浏览器命令和动作 ID 使用安全随机数生成标准 UUID；在局域网 HTTP 页面不可用 `crypto.randomUUID()` 时改用 `crypto.getRandomValues()`。缺少安全随机数源时显示明确错误，不发送无效命令。

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

开发模式下也可从同一局域网的 `http://<本机 IP>:3000` 访问已构建的 Web 页面；纯 HTTP 响应不会要求浏览器把脚本升级到 HTTPS。好友房仍按精确 Origin 校验，需将该地址显式配置为 `PUBLIC_ORIGIN` 或列入 `ALLOWED_ORIGINS`，不要开放通配 Origin。浏览器退化到 HTTP polling 且请求不带 Origin 时，会使用 `/api/session` 返回的 `socketProof` 与 HttpOnly 会话 Cookie 共同验证每次请求；该接口响应禁止缓存，证明不会放进连接 URL。生产和 HTTPS 请求保留原有 CSP 升级策略。

## 验证

按改动范围选择定向检查：

Web 测试最多并行使用 4 个 worker，避免本机同时启动大量 jsdom 实例导致页面测试偶发超时；测试文件仍彼此隔离。模拟 IndexedDB 迟到回执的页面测试会等待真实写入及令牌读回核对完成，再结束测试环境。首页测试卸载后会等待四款棋类及 24 点入口已经启动的真实共享读取完成，再清理 jsdom；连接提示使用模拟时钟的测试也会先推进待处理的 IndexedDB 任务。

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
pnpm --filter @gamehall/web test -- dots-solo solo-progress SoloPracticePage DotsAndBoxesGame HomePage App.practice
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
