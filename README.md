# 并购风云 · 联机版 MVP

经典桌游 **Acquire（并购风云，1964）** 的联机版起步实现。本仓库对应设计文档里的
**M0（规则引擎）**，并额外提供一个 **浏览器热座（pass-and-play）渲染层**，让你在
没有微信开发者工具的环境下也能直接看到棋盘渲染、验证规则。

## 架构（与设计文档一致）

规则引擎与传输层彻底解耦：引擎是一份零网络依赖的纯 TypeScript reducer
`(state, action) => newState`，不 import 任何 WebSocket / 微信 API。

```
src/engine/        纯 TS 规则引擎（可复用，可单测，云函数/自建服务端/浏览器通用）
  types.ts         AcquireState / PlayerAction / PlayerView / GameDefinition 契约
  data.ts          公司、棋盘几何、股价表
  rng.ts           可重放的种子洗牌
  acquire.ts       reducer + 状态机 + 脱敏（redact）+ 终局结算
  acquire.test.ts  成立公司 / 并购分红 / 2:1 换股 / 安全公司 / 终局 测试
src/server/        权威服务端（自建 ws 宿主，等价于微信云函数 dispatch）
  server.ts        持有完整 state + _secret，跑引擎，按玩家脱敏下发
src/web/           前端渲染层（同一引擎/视图，两种宿主）
  app.ts           共享渲染器：输入 PlayerView，输出 PlayerAction
  main.ts          热座驱动（单浏览器本地跑引擎，验证规则/界面）
  client.ts        联机玩家端（连 ws，只收脱敏视图、只发动作）
```

### 两种运行形态

| 形态 | 谁持有 state | 隐藏信息 | 用途 |
|---|---|---|---|
| **热座 demo**（`main.ts`） | 浏览器本地 | ❌ 一页看到所有手牌 | 单机验证规则 + 界面 |
| **联机 每人一页**（`server.ts` + `client.ts`） | 权威服务端 | ✅ 每人只收自己手牌 | 真正多人游玩 |

联机形态就是文档第 2 节「服务端权威 + 状态同步 + 按玩家脱敏」的落地：客户端只发
`PlayerAction` 意图，服务端跑 `reduce` 校验、`redact` 脱敏，把每人自己的 `PlayerView`
推回去。`server.ts` 是平台中立的自建 ws 宿主——换成微信云函数，引擎与前端一行不改。

- **服务端权威**：客户端只发意图（`PlayerAction`），引擎校验后算新 state。
- **隐藏信息**：`hands`（每人手牌）与 `bag`（牌库）只存在于完整 state 中，
  `redact(state, viewerId)` 只下发本人手牌 + 余量计数，种子永不外发。
- **可复用边界**：`GameDefinition` 接口即通用层与游戏层的契约，接新桌游只实现一份。

## 如何验证 / 查看渲染界面

### 1. 跑规则引擎测试（核心逻辑，纯 Node）

```bash
npm install
npm test          # vitest：11 个用例覆盖成立/并购/换股/终局
npm run typecheck
```

### 2. 看真实渲染界面（浏览器热座预览）

设计文档里**微信小程序**的真机预览只能在本地微信开发者工具完成；但本 MVP 的渲染
层是标准浏览器 H5（设计文档第 3、10 节提到的跨平台迁移退路），用同一份引擎，因此
**在任何浏览器、甚至云端无头沙箱里都能跑和截图**。

```bash
npm run dev       # 启动 Vite，浏览器打开 http://localhost:5173
# 或：npm run build && npm run preview
```

打开后是一局可操作的 3 人热座对局：点手牌打板、成立公司、并购处置、买股，
右侧实时显示股票市场、各玩家现金/持股、对局日志。

### 3. 真正的「每人一页」联机（本地多标签即可体验）

```bash
npm run server    # 终端 A：启动权威 ws 服务端（:8787，默认 3 人房）
npm run dev       # 终端 B：启动前端
# 浏览器开 3 个标签，各自进一个玩家：
#   http://localhost:5173/client.html?me=p1&room=demo
#   http://localhost:5173/client.html?me=p2&room=demo
#   http://localhost:5173/client.html?me=p3&room=demo
```

每个标签只看得到自己的手牌、只有轮到自己才能操作，公共棋盘/市场/日志实时同步——
这就是真正的联机拓扑（换设备同理，连同一台机器的 ws 即可）。
房间人数用 `ACQUIRE_PLAYERS=4 npm run server` 调整。

> 在 Claude Code 云端会话里：可以用预装的 Chromium + playwright-core 起 `preview`
> 服务并截图（本仓库 README 顶部的界面即如此生成）。微信端 / 云开发部署（M1+）
> 仍需拉回本地做。

## 里程碑进度

- [x] **M0** 规则引擎 + 测试（本仓库）
- [x] 浏览器 H5 热座渲染（额外，便于在云端会话验证 UI）
- [x] 自建 ws 权威服务端 + 每人一页联机（平台中立，验证真联机拓扑）
- [ ] **M1** 把 `server.ts` 的逻辑搬进微信云函数 `dispatch` + CloudBase 三文档（本地）
- [ ] **M2** 小程序棋盘/市场/并购弹窗（本地）
- [ ] **M3** 断线重连 + 持久化 + 房间生命周期
- [ ] **M4** 接第二个游戏验证通用层复用
