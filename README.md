# 并购风云 · 联机版 MVP

经典桌游 **Acquire（并购风云，1964）** 的联机版起步实现。本仓库对应设计文档里的
**M0（规则引擎）**，并额外提供一个 **浏览器热座（pass-and-play）渲染层**，让你在
没有微信开发者工具的环境下也能直接看到棋盘渲染、验证规则。

## 架构（与设计文档一致）

规则引擎与传输层彻底解耦：引擎是一份零网络依赖的纯 TypeScript reducer
`(state, action) => newState`，不 import 任何 WebSocket / 微信 API。

```
src/engine/        纯 TS 规则引擎（可复用，可单测，云函数/自建服务端/浏览器通用）
  types.ts         AcquireState / PlayerAction / GameDefinition 契约
  data.ts          公司、棋盘几何、股价表
  rng.ts           可重放的种子洗牌
  acquire.ts       reducer + 状态机 + 脱敏（redact）+ 终局结算
  acquire.test.ts  成立公司 / 并购分红 / 2:1 换股 / 安全公司 / 终局 测试
src/web/           浏览器热座渲染层（同一引擎，H5 预览）
```

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

> 在 Claude Code 云端会话里：可以用预装的 Chromium + playwright-core 起 `preview`
> 服务并截图（本仓库 README 顶部的界面即如此生成）。微信端 / 云开发部署（M1+）
> 仍需拉回本地做。

## 里程碑进度

- [x] **M0** 规则引擎 + 测试（本仓库）
- [x] 浏览器 H5 热座渲染（额外，便于在云端会话验证 UI）
- [ ] **M1** 包进 `GameDefinition` 接微信云开发，单房间端到端（本地）
- [ ] **M2** 小程序棋盘/市场/并购弹窗（本地）
- [ ] **M3** 断线重连 + 持久化 + 房间生命周期
- [ ] **M4** 接第二个游戏验证通用层复用
