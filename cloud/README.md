# 微信小程序 + 云开发（M1）部署指南

这一层是设计文档的 **M1**：把已测好的纯引擎搬上微信云开发，跑通「服务端权威 +
按玩家脱敏」的单房间联机。**只能在本地微信开发者工具完成**（需要 AppID、要开通云
开发、云端沙箱没有模拟器）。

## 目录

```
project.config.json            指向 miniprogram/ 与 cloud/functions/
miniprogram/                   小程序前端（原生）
  app.js                       wx.cloud.init，填你的云环境 ID
  pages/lobby/                 创建 / 加入房间
  pages/game/                  棋盘 / 股价 / 手牌 / 各阶段操作，watch 数据库
  utils/game.js                客户端渲染辅助（仅展示，规则在云端）
cloud/functions/dispatch/      权威云函数
  index.js                     create / join / start / action 四个命令
  engine/                      由 `npm run build:cloud` 从 src/engine 编译而来
  package.json                 依赖 wx-server-sdk
cloud/database-rules/          三个集合的安全规则
```

## 一次性配置步骤（本地）

1. **填 AppID**：用微信开发者工具打开本仓库根目录，或编辑 `project.config.json`
   的 `appid` 为你的小程序 AppID。
2. **开通云开发**：工具顶部「云开发」→ 开通，记下**环境 ID**。
3. **填环境 ID**：把 `miniprogram/app.js` 里的 `env: 'TOUCH_YOUR_CLOUD_ENV_ID'`
   改成你的环境 ID。
4. **建数据库集合**（云开发控制台 → 数据库 → 新建集合）：
   - `rooms`、`room_private`、`room_secret`
5. **设置安全规则**（每个集合 → 权限设置 → 自定义安全规则），粘贴
   `cloud/database-rules/` 下对应的 JSON：
   - `rooms` → `rooms.rules.json`（所有人可读、仅云函数可写）
   - `room_private` → `room_private.rules.json`（仅本人 openid 可读）
   - `room_secret` → `room_secret.rules.json`（客户端完全不可读写）
6. **编译并部署云函数**：
   - 在仓库根目录先跑一次：`npm install && npm run build:cloud`
     （把引擎编译进 `cloud/functions/dispatch/engine/`）
   - 在工具里右键 `cloud/functions/dispatch` →「上传并部署：云端安装依赖」
     （会自动装 `wx-server-sdk`）。

## 跑起来

1. 工具里「编译」运行小程序，进入大厅。
2. A 设备点「创建房间」→ 得到 6 位房间号 → 进入对局（大厅等待）。
3. B 设备（或工具的多账号调试 / 真机扫码）输入房间号「加入房间」。
4. 房主点「开始游戏」。之后每人**只看到自己的手牌**，轮到自己才能操作；棋盘、
   股价、日志实时同步。

## 数据流（与设计文档一致）

```
客户端 → wx.cloud.callFunction('dispatch', {cmd:'action', roomId, action})
dispatch 云函数：
  读 room_secret（完整 state） → reduce(state, openid, action) 校验推进
  → 写回 room_secret（完整）
  → 写 rooms.public（公共视图，无手牌）
  → 写 room_private/{roomId_openid} = redact(state, openid)（含本人手牌）
客户端 watch 自己的 room_private 文档 → 收到脱敏视图 → 渲染
```

- 服务端权威：客户端从不直接写状态，只发意图。
- 隐藏信息：手牌/牌库只在 `room_secret` 与本人 `room_private` 里，安全规则保证别人读不到。
- 可复用：`dispatch/index.js` 里那段 `reduce + redact + 写回` 与自建 ws 服务端
  （`src/server/server.ts`）逻辑同构，引擎一行不改。

## 注意

- `cloud/functions/dispatch/engine/` 是**生成产物**。改了 `src/engine` 后重跑
  `npm run build:cloud` 再上传云函数。
- 断线重连：小程序 storage 存 openid（云函数按 openid 认人），重进房间页会
  重新 watch 自己的 `room_private` 文档，自动补到最新脱敏快照。
