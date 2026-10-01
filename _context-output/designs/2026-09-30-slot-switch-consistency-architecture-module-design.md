# Architecture Layer — Data Shapes, Contracts & Module Structure

> **上游**：Goal（D1–D16）+ Constraint（C1–C7 / RK1）
> **层**：🏗️ Architecture
> **决策**：A1–A18（18 项），**OPEN：0**
> **日期**：2026-09-30 · **基线**：HEAD `d1f1f1d`（实测代码路径见各项）

---

## A1 · item 1 的根因与修复点（基线修正）

**实测事实**：`SWITCH_SLOT`（`worker-orchestrator.ts:356-357`）与 `switch-slot-x`（`:230-257`）**已经共用 `slotService.switchSlot`**——**解析逻辑本就一致**，差异只在**结果副作用**：仅命令路径处理 `needs_recovery`（开窗），`SWITCH_SLOT` 只回传。

**决定**：新增 `applySwitchOutcome(outcome, context)`（置于 `worker-orchestrator`），两条路径**都**调用它；由它**唯一**负责恢复窗、通知、诊断。
**否决**：把副作用下沉进 `slotService`（服务耦合 windows+notifications）；UI 层统一（与 D2 冲突）。

## A2 · 副作用映射契约（`applySwitchOutcome`）

| `outcome.type` | 恢复窗 | 通知 | 诊断 |
|---|---|---|---|
| `needs_recovery` | **create-or-focus**（键 = `slotId`，D12） | `no_target`（每动作至多 1 次） | ✅ |
| `switched` + `crossWindow` | — | `cross_window_switch`（既有） | ✅ |
| `switched`（非跨窗） | — | — | ✅ |
| `incognito_blocked` | — | — | ✅（UI 如实提示，C3） |
| `no_match` | — | — | ✅ |

> **修正（BLK-B / B2，2026-09-30 裁决）**：本表原有 `protected_blocked` 行**已撤销**——该变体无生产者。
> 特权页拦截属**打开/导航**路径，返回既有 domain error `PROTECTED_PAGE`（`types.ts:247`），
> 由恢复窗走**既有窗内报错**路径渲染，**不经** `applySwitchOutcome`。

**幂等**：① 同 `slotId` 重复触发 → 复用/聚焦同一窗；② 单次调用只跑一遍映射，**绝不**重复发通知/诊断。

## A3 · 状态归属（Q23 = A）

| 区 | 内容 | 理由 |
|----|------|------|
| **`sync`（`syncState` 键）** | 三旋钮策略（全局 + 槽位覆盖）、`switchDirection`、`autoBindGlobal`、`schemaVersion` | 用户**意图**，应随账号同步 |
| **`local`（`localState` 键）** | `bindings`、`cycleCursors`、`recoverySessions`（含 windowId）、`iconCache`… | **tabId/窗口是设备现实**，不可同步 |

**决定**：sync 区**不新增键**（仍写 `syncState`）；local 区**不新增键**。

## A4 · Position 起点 = `binding.tabId`（Q24 = A）

**决定**：不新增游标字段。Position 起点 = 该槽的 `binding.tabId`；环由**实时查询**导出（与 C4「不缓存」一致）。
**术语收紧**：Goal 层 D4/D5 的"游标"= **binding**；`binding` **仅由提交类动作推进**（Q25）。

### A4b · `binding` 更新矩阵（Q25 / Q26 裁决，含既有特例）

| 动作类 | 实例 | `binding` | 依据 |
|---|---|---|---|
| **提交类** | 组合 4 的 `Switch to slot x`（快捷键 + 点行）、Strategy C 切换、Recovery `Open URL` | ✅ 更新 | 用户裁决 |
| **浏览类** | slot 行 `⤺/↻`（`NEXT/PREV_MATCH_SLOT`）、Current Page `⤺/↻`（`NEXT/PREV_MATCH_CURRENT`）、**新增** `↑/↓`（`POSITION_CURRENT_*`） | ❌ **刻意不更新** | 用户裁决；slot 行特例为既有契约（`slot-service.ts:394`） |

**已确认的有意行为**（Q26）：Match 循环后按组合 4 的 `Switch to slot x` → **聚焦回 `binding`**（而非循环到的那页）。写入设计，避免日后被误判为 bug。
⚠️ 违反惯例（循环路径不动 binding）须在实现处**显式注释**，防止被当作"遗漏"修掉。

## A5 · `SwitchOutcome` 最小扩展（Q31 = A，C5 约束）

```ts
export type SwitchOutcome =
  | { type: 'switched'; tabId: number; windowId: number; crossWindow: boolean }  // 既有；聚焦/步进复用
  | { type: 'no_match'; slotId: number }                                          // 既有
  | { type: 'needs_recovery'; recoveryId: string; slotId: number }                // 既有（测试锁定，C5 不得移除）
  | { type: 'incognito_blocked'; slotId: number };                                // 既有
// 既有 4 变体【完全不动】。
// 【修正 · BLK-B / B2，2026-09-30 裁决】：原计划的 protected_blocked 变体【撤销】——
// 无生产者（switchSlot 允许切特权页；拦截属打开/导航路径）。特权页拦截改用既有
// domain error 'PROTECTED_PAGE'（types.ts:247），由恢复窗走窗内报错路径渲染。
```
**决定**：聚焦/步进**不复用为独立变体**（UI 无需区分）；**不新增任何变体**；既有 4 变体**不变**。

## A6 · 新配置形状 + 消息（Q27 = A）

### 状态（`SyncState` 新增）
```ts
export type TabIdMode = 'exists' | 'no-exists';
export type RuleCheckMode = 'match' | 'no-match';
export type Priority = 'tabId' | 'rule-check' | 'none';

export interface MatchRuleSettings { tabIdMode: TabIdMode; ruleCheckMode: RuleCheckMode; priority: Priority; }

interface SyncState {
  schemaVersion: number;                 // A8
  matchSettings: MatchRuleSettings;      // 全局（取代 globalStrategy）
  switchDirection: 'previous' | 'next';  // 全局方向（组合 4 / next-match 单命令）
  autoBindGlobal: boolean;               // 全局默认（D13/D14）
  slots: Array<SlotDefinition>;          // slot.strategy 重塑
  rules: PageRule[];
  configVersion: number;                 // 不变（乐观并发）
}
```
### `SlotDefinition.strategy` 重塑（Q16 = A：整块继承）
```ts
strategy: 'inherit' | MatchRuleSettings;      // inherit → 三字段全跟全局；否则三字段全自定
autoBindOverride?: boolean;                   // D14：undefined = 继承 autoBindGlobal
```
### 消息清单
| 动作 | 状态 | 载荷 |
|---|---|---|
| `SET_GLOBAL_STRATEGY` | **重塑** | `{ matchSettings: MatchRuleSettings }` |
| `SET_SLOT_STRATEGY` | **重塑** | `{ slotId, strategy: 'inherit' \| MatchRuleSettings }` |
| `SET_SWITCH_DIRECTION` | **新增** | `{ direction: 'previous' \| 'next' }` |
| `SET_AUTO_BIND_GLOBAL` | **新增** | `{ enabled: boolean }` |
| `SET_SLOT_AUTO_BIND` | **新增** | `{ slotId, override: boolean \| null }`（null = 清除覆盖→继承） |
| `POSITION_CURRENT_PREV` / `POSITION_CURRENT_NEXT` | **新增** | `{ anchorTabId?: number }`（**修正 · BLK-A / A1**：侧边栏传 `lockedTabId ?? currentTabId`；background 不读内存态、可测；失效则降级为当前活动页） |
| `SWITCH_SLOT` | **不变** | 组合 4 与"点 slot 行"复用 |
| `RECOVERY_PREV_MATCH` | **新增** | `{ recoveryId, autoBind }` |
| `RECOVERY_NEXT_MATCH` / `RECOVERY_OPEN_URL` | **扩展载荷** | `{ recoveryId, autoBind }` |
| `NEXT_MATCH_SLOT` / `PREV_MATCH_SLOT` / `NEXT_MATCH_CURRENT` / `PREV_MATCH_CURRENT` | **不变** | slot 行 / Current Page 的 `⤺/↻`（Match） |
**决定**：granular payload（避免整段提交覆盖并发改动）；每设置一 action。

## A7 · 4 resolver + 共享纯原语（Q29 = C，Q30 = A）

```
src/background/switch/
  ├── resolve-switch.ts        # 入口：按 (tabIdMode, ruleCheckMode) 选 resolver；priority 仅组合 1
  ├── resolvers/
  │     ├── combination-1.ts   # tabId exists + rule check match（内部按 priority 三分支）
  │     ├── combination-2.ts   # tabId exists + rule check no-match（命中否则 needs_recovery，不回退）
  │     ├── combination-3.ts   # tabId no-exists + rule check match（仅 URL/正则）
  │     └── combination-4.ts   # tabId no-exists + rule check no-match（聚焦 / 步进 / 缺失）
  └── primitives.ts            # 纯函数原语（共享，禁止在 resolver 内重写）
```
**共享纯原语**（A1/Q30 规定，resolver **不得**自行重写）：
- `ruleCheckTabMatch(tab, urlMatch)` — rule check 谓词
- `findMatchCandidates(tabs, urlMatch, incognitoAllowed)` — Match 候选集
- `buildPositionRing(tabs, windowId)` — 位置环（`↑/↓` 与组合 4 **共用同一个环**，QP 不容分裂）
- `applyPriority(bindingTab, candidates, priority)` — 仅组合 1 使用
- `focusOrStep(ring, bindingTab, activeTabId, direction)` — 组合 4 的聚焦/步进判定（纯）

**决定**：resolver **只编排**；间接触发 I/O 由 `slot-service` 执行（决策与 I/O 分离）。

## A8 · `schemaVersion` 与迁移（Q28 = A）

- `schemaVersion` = `SyncState` **顶层字段**（当前值 **1**）
- 复用既有 `migrateSyncState()` 钩子（`storage-repository.ts:153/160` 的 hydrate 路径）
- 检测旧形状（无 `schemaVersion` 或 = 0）→ 按 D10 映射 → **写回一次** `syncState` → 置 1
- **不递增 `configVersion`**（形状迁移 ≠ 用户配置变更，避免污染乐观并发语义）
- **导入**：`IMPORT_PREVIEW` / `IMPORT_COMMIT` 走**同一映射**（旧导出文件兼容）

## A9 · item 2 的幂等结构（Q33 = A）+ 根因定位

**双创造者风险**（实测）：`OPEN_PAGE` 处理器（`worker-orchestrator.ts:668-689`，background）与侧边栏直连 fallback（`sidebar/App.tsx:1157-1178`，`createChromePageOpenApi` + `openOrReusePage`）。

**决定**：
1. **background**：`OPEN_PAGE` 按**目标 base-url 键**做 **in-flight 合流**（并发 await 同一 promise → 只 create 一次）；串行重复由 `openOrReusePage` 的"已存在即复用"收敛。
2. **侧边栏**：`sendMessage` reject → **先有界重试 `OPEN_PAGE`**（SW 已被唤醒 → 走幂等路径）；**仅当 `chrome.runtime.id` 不存在**（扩展上下文确已失效）才直连 `chrome.tabs.create` —— 此时 background 必已死亡，**无竞争者**。
3. **根因定位（Q12 要求①）**：开页路径写**诊断记录**（来源 / 目标 / 结果 / 是否走 fallback / create|reuse 次数）。
   **首要假设（待诊断证实）**：**冷启 SW 期间 `sendMessage` 的响应通道失效 → 客户端落 `catch` → fallback 与 background 并发各 create 一次 = "两创造者竞速"**。次要假设：同一 handler 被调用两次（命令/事件重复）。诊断可区分二者。

## A10 · switch/open 全程 in-flight 合流（Q34 = A）

| 范围 | 行为 |
|---|---|
| 同 `slotId` 并发 `switchSlot` | 合流 → 1 窗 / 1 通知 / 1 诊断 / 1 次 binding 写 |
| 同 `recoveryId` 并发 `RECOVERY_OPEN_URL` | 合流 → 只建 1 tab |
| `RECOVERY_OPEN_URL` **成功后**再调用 | session **标记已消费** → 返回"已完成"语义，**不重复建 tab**（幂等消费） |
| **串行**合法重触发（用户稍后再操作） | **允许**（不做全局限流） |

## A11 · 恢复窗复用机制

- `recoverySessions` 记录新增 **`windowId`**（用于 `windows.update(windowId, { focused: true })`）
- create-or-focus：按 `slotId` 查该槽活跃 session 的 `windowId` → 存在则**聚焦**，否则 create 并记录 `windowId`
- 每 slot 至多一窗（D12）

## A12 · 恢复窗数据契约（Q39 = A）

- **URL 参数**：`recoveryId`（既有）、`title`/`url`（既有）、**新增** `slotId`、`matchType`
- **动作**：`RECOVERY_PREV_MATCH`（新增，镜像 `RECOVERY_NEXT_MATCH`）
- **autoBind**：复选框切换 → **立即** `SET_SLOT_AUTO_BIND` 持久化（D13）；**同时**动作载荷携带 `autoBind: boolean`（用户当时所见），**background 以载荷为准** → 消除"刚切换就点击"的竞态

## A13 · 权限与命令（C1）

- **不新增** permission / host_permission / command
- 方向设置复用既有 `next-match` / `switch-slot-x`；`switchDirection` 由 A2/A6 的 storage 承载
- 特权页拦截边界（Q37 = A）：`isProtectedUrl` **仅**用于「恢复窗 `Open URL`」与「导航到 slot 目标 URL」；`OPEN_PAGE` 到**扩展自身页面**放行；`'file://'` **加入 canonical 前缀**（`scripts/gen-protected-prefixes.mjs`）并重跑 `npm run gen:prefixes`
  - ⚠️ 连带效应（用户已确认）：`file://` 亦将**不可作 rule 改写目标**（同一清单被 rule 校验复用）

## A14 · 环查询作用域（C4 落地）

`tabs.query({ currentWindow: true })` 一次、按 index 排序、O(n)、**不缓存**；Position **绝不**查全窗口。恢复窗 Prev/Next 沿用既有 accessible-tabs 查询（跨窗，需找回匹配候选）。

---

## 遗留至 Detail（不得遗漏）

| 项 | 说明 |
|----|------|
| 环 0/1 页边界 | 环仅 1 页（=自己，步进为 no-op？）；0 存活页的理论边界 |
| 恢复窗 TTL 与复用 | 5 分钟过期后：聚焦旧窗 vs 新建；窗内文案是否刷新 |
| 特权页拦截 UI | 恢复窗窗内错误文案（成品英文）；`incognito_blocked` 提示位置（toast / 窗内 alert） |
| 三态与方向文案 | `Follow global` / `Always on` / `Always off`；`Previous Match` / `Next Match` |
| `Open URL` 显隐判据 | 仅 `matchType === 'exact'` 展示（渲染期判定） |
| `↑/↓` 文案与 aria | 成品英文 + `aria-label` |
| 设置页布局 | Global Matching Strategy 区重构（三旋钮 + 方向 + autoBind 全局 + 每槽三态/策略） |
| 测试分层 | 纯 resolver 单测（穷举 4 格 + 反例）、原语单测、消息单测、UI 测试、集成 |
| 诊断记录字段 | 开页诊断的具体字段与容量（沿用既有 `diagnostics`） |