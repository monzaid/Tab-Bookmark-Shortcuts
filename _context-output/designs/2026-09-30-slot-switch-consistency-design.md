# Slot Switch Consistency & Strategy Model Redesign — Main Design

> **迭代**：单一整体迭代（1+2 行为一致性 bug 修复 + 3+4 功能重设计）
> **日期**：2026-09-30 · **基线**：HEAD `d1f1f1d`
> **项目**：Tab-Bookmark-Shortcuts — MV3 跨浏览器扩展（TS strict + React 18 + Vite 6 + Vitest 2）
> **层子文档**：`...-goal-core-scope-design.md` / `...-constraint-boundaries-design.md` / `...-architecture-module-design.md` / `...-detail-interaction-copy-design.md`
> **决策清单**：`2026-09-30-slot-switch-consistency-decisions.yaml`（46 项，OPEN 0，登记风险 1）

---

## 1. Overview

### 1.1 问题（两族）

**族 A · 行为不一致（bug）**
| # | 症状 | 根因（实测） |
|---|------|-------------|
| 1 | 侧边栏点 slot 与快捷键效果不同：侧边栏**只弹 toast 不开窗**（`sidebar/App.tsx:986-988` 文案 `Slot x: opening recovery window` 与实际不符）；快捷键**开窗**（`worker-orchestrator.ts:239-256`）。快捷键 `Tab Not Found` 弹 **2 次**、`Open URL` 开 **2 个**窗 | 两条路径的**结果副作用**未统一（解析层其实已共用 `slotService.switchSlot`） |
| 2 | 无 Settings 标签页时点底部入口 → 生成 **2 个**标签页 | `openOrReusePage` 是 `query → 找 → create` 的**非原子**逻辑；且有**两个创造者**：`OPEN_PAGE`（background）与侧边栏直连 fallback |

**族 B · 模型与交互重设计**
| # | 目标 |
|---|------|
| 3 | `Global Matching Strategy` 由 A/B/C 黑盒 → **三旋钮**（`tabIdMode` × `ruleCheckMode` × `priority`）严格按四格定义执行；新增**方向设置**；侧边栏 Current Page 新增 `↑/↓` **位置**步进 |
| 4 | 恢复窗：`Open URL` 仅 Exact 展示；`Next Match` 拆为 **Previous/Next Match** 且**点击不关窗**；新增**自动绑定**复选框（全局默认 + 槽位三态覆盖，可在设置页查看/编辑） |

### 1.2 术语（全局唯一）

| 术语 | 定义 |
|------|------|
| **Match** | 基于 slot `urlMatch`（Exact/Regex/Wildcard）的候选匹配 |
| **Position** | 基于**浏览器标签页顺序**（当前窗口 tab strip index）的相邻移动 |
| **聚焦 / Focus** | 游标 tab ≠ 当前活动 tab → 切到游标 tab |
| **步进 / Step** | 游标 tab == 当前活动 tab → 环内按方向移到相邻标签页 |
| **环 / Ring** | **当前窗口**存活标签页按 index 排序构成的有序环形 |
| **游标 / Cursor** | = 该槽的 **`binding.tabId`**（仅由**提交类**动作推进） |
| **恢复窗** | 标题 `Tab Not Found` 的 popup 窗口 |
| **提交类 / 浏览类动作** | 提交类**更新** `binding`；浏览类**刻意不更新**（见 §3.4） |

### 1.3 核心原则（本轮的"宪法"）

1. **单一真源** —— 一致性由**构造**保证，不靠多处实现"碰巧同步"：
   - 恢复窗 → **background 唯一负责**（D2）
   - 结果副作用 → **`applySwitchOutcome` 唯一映射**（A1/A2）
   - 打开/新建 → **单一创造者 + in-flight 合流**（A9/A10）
   - Match 语义 / 位置环 → **共享纯原语**，resolver 不得重写（A7）
2. **一名一义** —— Match 与 Position 在**代码、消息契约、按钮名**三层都不得混用（Q36/Q38）。
3. **偏好随账号、tabId 随设备** —— sync 放意图，local 放设备现实（A3）。

---

## 2. Architecture

### 2.1 状态形状

```ts
// ── sync（用户意图，随账号同步）──
export type TabIdMode = 'exists' | 'no-exists';
export type RuleCheckMode = 'match' | 'no-match';
export type Priority = 'tabId' | 'rule-check' | 'none';
export interface MatchRuleSettings { tabIdMode: TabIdMode; ruleCheckMode: RuleCheckMode; priority: Priority; }

interface SyncState {
  matchSettings: MatchRuleSettings;       // 全局（直接取代 globalStrategy）
  switchDirection: 'previous' | 'next';   // 全局方向（单命令入口）
  autoBindGlobal: boolean;                // 全局默认
  // 【裁定 2026-09-30】删除 schemaVersion：不做迁移（应用未公测、无用户历史），故无需版本锚点。
  // 【裁定 2026-09-30】不做旧字段兼容：`globalStrategy` 直接删除，旧持久化数据被忽略、
  //   静默落到新默认（exists + match + tabId）。无提示、无备份。
  slots: SlotDefinition[];                // slot.strategy 重塑（见下）
  rules: PageRule[];
  configVersion: number;                  // 不变（乐观并发）
}

interface SlotDefinition {
  strategy: 'inherit' | MatchRuleSettings;  // 整块继承（Q16）
  autoBindOverride?: boolean;               // undefined = 继承 autoBindGlobal（D14）
  // ...既有字段不变
}

// 【裁定 2026-09-30 · Q1-A】彻底删除：
//   type MatchStrategy = 'A' | 'B' | 'C'      → 删除
//   const DEFAULT_STRATEGY: MatchStrategy      → 删除（新增 DEFAULT_MATCH_SETTINGS 取代）
// A/B/C 与新四格的对应关系【仅保留为本文档 §3.1 的 markdown 对照表】，不进入代码/类型。

// ── local（设备现实，不同步）──
// bindings（含 Position 起点）、cycleCursors、recoverySessions（新增 windowId 与 candidateCursor）、iconCache…
```

### 2.2 SwitchOutcome（最小扩展）

```ts
export type SwitchOutcome =
  | { type: 'switched'; tabId: number; windowId: number; crossWindow: boolean }  // 既有；聚焦/步进复用
  | { type: 'no_match'; slotId: number }                                          // 既有
  | { type: 'needs_recovery'; recoveryId: string; slotId: number }                // 既有（测试锁定，不得移除）
  | { type: 'incognito_blocked'; slotId: number };                                // 既有
// 既有 4 变体【完全不动】。
// 【修正 · BLK-B / B2】：原计划的 protected_blocked 变体【撤销】——它无生产者
// （switchSlot 允许切特权页；特权页拦截属"打开/导航"路径）。特权页拦截改用既有的
// domain error 'PROTECTED_PAGE'（types.ts:247），由恢复窗走"窗内报错"路径渲染。
```

### 2.3 模块结构

```
src/background/switch/
  ├── resolve-switch.ts          # 入口：按 (tabIdMode, ruleCheckMode) 选 resolver；priority 仅组合 1
  ├── resolvers/{combination-1..4}.ts
  └── primitives.ts              # 共享纯原语（resolver 禁止重写）
```

**共享纯原语**：`ruleCheckTabMatch` / `findMatchCandidates` / `buildPositionRing` / `applyPriority` / `focusOrStep`
**`applySwitchOutcome(outcome, context)`**（`worker-orchestrator`）：恢复窗 + 通知 + 诊断的**唯一**副作用点。

### 2.4 消息契约

| 动作 | 变更 | 载荷 |
|---|---|---|
| `SET_GLOBAL_STRATEGY` | 重塑 | `{ matchSettings }` |
| `SET_SLOT_STRATEGY` | 重塑 | `{ slotId, strategy: 'inherit' \| MatchRuleSettings }` |
| `SET_SWITCH_DIRECTION` | **新增** | `{ direction }` |
| `SET_AUTO_BIND_GLOBAL` | **新增** | `{ enabled }` |
| `SET_SLOT_AUTO_BIND` | **新增** | `{ slotId, override: boolean \| null }` |
| `POSITION_CURRENT_PREV` / `POSITION_CURRENT_NEXT` | **新增** | `{ anchorTabId?: number }`（**修正 · BLK-A / A1**：侧边栏传 `lockedTabId ?? currentTabId`；background 不读内存态、可测） |
| `RECOVERY_PREV_MATCH` | **新增** | `{ recoveryId, autoBind }` |
| `RECOVERY_NEXT_MATCH` / `RECOVERY_OPEN_URL` | 扩展载荷 | `{ recoveryId, autoBind }` |
| `SWITCH_SLOT` | 不变（组合 4 与"点 slot 行"复用） | `{ slotId }` |
| `NEXT/PREV_MATCH_SLOT`、`NEXT/PREV_MATCH_CURRENT` | 不变 | slot 行 / Current Page 的 `⤺/↻`（Match） |

**恢复窗 URL 参数**：`recoveryId`、`title`、`url`（既有）+ **`slotId`**、**`matchType`**（新增）。

---

## 3. Data Flow — Canonical 四格组合表（唯一真源）

旋钮：`tabIdMode` × `ruleCheckMode` × `priority`（**`priority` 仅在组合 1 有效**）。**新默认 = 组合 1 + `priority=tabId`**。

| # | tabIdMode | ruleCheckMode | 行为 |
|---|-----------|---------------|------|
| **1** | exists | match | 绑定 tab 存活？→ 依 `priority`：<br>• `none`：**最严档** — 存活**且 URL 仍匹配** → 切它；**任一条件不满足（已关闭 / 从未绑定 / URL 已漂移）→ Tab Not Found，绝不回退 URL 候选**<br>• `tabId`：存活 → 切它（**不校验 URL**）；否则用 URL/正则候选<br>• `rule check`：先用 URL/正则候选；无匹配 → 回退切绑定 tab<br>**两者皆无 → Tab Not Found** |
| **2** | exists | no-match | 绑定 tab 存活 → 切它（忽略 Match URL）；**否则 → Tab Not Found**（**绝不回退** URL 查找） |
| **3** | no-exists | match | 忽略 tabId，仅按 URL/正则候选 → 切首个；无候选 → Tab Not Found |
| **4** | no-exists | no-match | **Position**：环 = 当前窗口存活标签页；起点 = 该槽 `binding.tabId`<br>• 游标缺失 → Tab Not Found<br>• 游标 == 当前活动 → **步进**（方向 = 方向设置）<br>• 游标 ≠ 当前活动 → **聚焦**<br>• 首次从未切换 → 以当前活动为起点 → 步进<br>成功后更新该槽数据（binding + 游标） |

> **修正 · 2026-09-30（用户裁定 C-A2 + Q1-B，覆盖上表组合 1 `none` 档的字面语义）**：`none` 收紧为**最严档**——绑定 tab **必须存在** **且** URL 仍匹配；**任一条件不满足 → Tab Not Found（绝不回退 URL 候选）**。实现见 `applyPriority` 的 `none` 分支：`return bindingAlive && bindingUrlMatches ? 'use-binding' : 'unresolved'`（`hasCandidates` 在该档**刻意不使用**）。

### 3.1 旧值 A/B/C → 新模型（【已废弃 D10/C4】：**仅作语义对照，不再产生迁移代码**）

> **裁定 2026-09-30**：**不做兼容、不做迁移**（应用未公测、无用户历史）。下表**仅供理解旧语义与新四格的对应关系**，**不作为实现要求**；`schemaVersion` 已删除，`migrateSyncState` 只需**填新形状默认值**（不读旧字段）。

| 旧 | 语义 | 语义对应新格 | 说明 |
|----|------|------|------|
| A | tabId 存在即切换 | 组合 2 | 仅语义对照 |
| B | tabId 存在且 URL 匹配 | 组合 1 / `none` | 仅语义对照 |
| C | 忽略 tabId，仅 URL/正则 | 组合 3 | 仅语义对照 |

**升级行为**：旧 `syncState`（含 `globalStrategy`）**被忽略**，`matchSettings` 落到新默认 `exists + match + tabId`；**不提示、不备份**。

### 3.2 副作用映射（`applySwitchOutcome`）

| `outcome.type` | 恢复窗 | 通知 | 诊断 |
|---|---|---|---|
| `needs_recovery` | **create-or-focus**（键 = `slotId`） | `no_target`（每动作至多 1 次） | ✅ |
| `switched` + `crossWindow` | — | `cross_window_switch` | ✅ |
| `switched`（非跨窗） | — | — | ✅ |
| `incognito_blocked` | — | — | ✅ |
| `no_match` | — | — | ✅ |

**特权页拦截（修正 · B2）**：不在 `SwitchOutcome` 内表达，而是**打开/导航路径**返回既有 domain error `PROTECTED_PAGE`（`types.ts:247`）→ 恢复窗窗内报错 `This URL cannot be opened`；`applySwitchOutcome` 不参与该路径。

### 3.3 方向设置的适用范围（D6 经 Q35 收紧）

**仅作用于「单命令类入口」**：
1. 快捷键 `Switch to next matching tab`（`next-match` 命令）
2. `Switch to slot x`（快捷键 **或** 侧边栏点该槽）且该槽有效策略 = **组合 4**

侧边栏 **`⤺/↻`**（slot 行 = Match；Current Page = Match）**不受**方向设置影响。

### 3.4 `binding` 更新矩阵（Q25/Q26，含既有特例）

| 动作类 | 实例 | `binding` |
|---|---|---|
| **提交类** | 组合 4 的 `Switch to slot x`（快捷键 + 点行）、Strategy C 切换、Recovery `Open URL` | ✅ 更新 |
| **浏览类** | slot 行 `⤺/↻`（`NEXT/PREV_MATCH_SLOT`）、Current Page `⤺/↻`（`NEXT/PREV_MATCH_CURRENT`）、**`↑/↓`**（`POSITION_CURRENT_*`）、Recovery **Prev/Next**（除 autoBind 勾选时写 `tabId`） | ❌ **刻意不更新** |

**已确认为有意行为**：Match 循环后按组合 4 的 `Switch to slot x` → **聚焦回 `binding`**（而非循环到的那页）。
⚠️ 实现处须**显式注释**该惯例，防止被当作"遗漏"修掉。

### 3.5 恢复窗行为

- **创建**：`needs_recovery` 且该槽无活跃 session → 新建 session（记 `windowId`、`slotId`、`matchType`）+ 新建窗；已有 → **聚焦**（每槽至多一窗）
- **Prev/Next**：**Match 候选**内环绕切换；起点锚定 `cursorTabId`（首次：活动页在候选内则其后一个，否则 `[0]`/`[last]`）；实时重查；**不关窗、不消费 session**
- **Open URL**：仅 `Match Type = Exact URL` 展示；打开前**拦截特权页**；成功后**消费 session + 关窗**；`autoBind` 勾选则写该槽 `tabId`
- **Do Nothing**：移除 session + 关窗
- **TTL（5 分钟）**：到期**自动关窗**，释放槽占位；再触发 → 新 session + 新窗

---

## 4. Error Handling

| 情形 | 行为 | 呈现 |
|---|---|---|
| 该槽目标不存在（含组合 2 的"不回退"、组合 3 无候选、组合 4 游标缺失） | 返回 `needs_recovery` | 恢复窗（`Tab Not Found`） |
| 恢复窗 Prev/Next 无候选 | 不跳转、不关窗 | 窗内 `No matching tabs found at this time` |
| `Open URL` 目标为特权页（含 `file://`） | **拦截、不打开** | 窗内 `This URL cannot be opened` |
| 激活 incognito 标签页 / 在 incognito 新建 且未授权 | 不执行，返回 `incognito_blocked` | toast `Incognito access not authorized` |
| 环仅 1 页（步进） | **no-op**（非错误） | 无 |
| 锁定 tab 已关闭（`↑/↓`） | 降级为当前活动页 | 无 |
| 后台不可用（冷启/已失效） | 有界重试 `OPEN_PAGE`；仅 `chrome.runtime.id` 不存在才直连 | 无（不得静默失效） |

**幂等保证**：同 `slotId` 并发 switch → 合流为一次（1 窗/1 通知/1 诊断/1 次 binding 写）；同 `recoveryId` 并发 `OPEN_URL` → 合流；重复 `OPEN_PAGE` → 至多 1 个目标标签页；**串行**合法重触发仍允许。

---

## 5. Testing Strategy（四层，第 4 层强制独立复验）

1. **纯函数单测**：4 resolver 穷举 + **反例**（组合 2「不回退」、组合 4「游标缺失 → needs_recovery」、组合 1 三档 priority）+ 共享原语
2. **集成测试**：`applySwitchOutcome` 映射表逐行；"只弹 1 窗 / 只开 1 页"（并发合流）；新默认归一（无迁移）
3. **UI 测试**：`↑/↓` 语义；恢复窗（`Open URL` 仅 exact / Prev·Next 不关窗 / 连续点击 / 复选框持久化）；设置页三旋钮 + 每槽一行 + 三态；单页环 no-op
4. **门禁 + 独立复验**：`typecheck` 0 / **lint delta-0** / unit / integration / ui-smoke / 三浏览器 build；**独立复验，不采信执行者自审**

---

## 6. Trade-offs（已裁决的取舍）

| 取舍 | 选择 | 代价 |
|---|---|---|
| 一致性实现 | 单一真源（background 统一 / 共享原语） | 需新增 `applySwitchOutcome` 与 resolver 层（结构变重） |
| 隔离 vs 复用 | 4 个 resolver 类 + 共享纯原语（Q29 C + Q30 A） | 需守住"resolver 不得重写原语"的纪律 |
| 方向设置范围 | 单命令入口（含侧边栏点行） | 侧边栏"点行"方向不可独立指定 |
| `binding` 语义 | **刻意分裂**（提交类更新 / 浏览类不更新） | 需显式注释；存在"按 ↻ 后按快捷键会聚焦回 binding"的**有意**反直觉行为 |
| 环范围 | 仅当前窗口 | 步进不跨窗（跨窗由聚焦承担） |
| 缓存 | 不缓存、实时查询 | 每次 O(n)（数十标签页可忽略），换取位置正确 |
| Position 起点 | 复用 `binding.tabId` | `binding` 承担双重语义（槽指向 + 位置起点） |
| 默认值 | 新默认 = 组合 1 + `priority=tabId`，与旧 B **不等价** | **不做迁移**（无用户历史）；旧配置被忽略、落到新默认 |
| 卡片呈现 | 每槽内联紧凑（替换现有 10 select） | 深自定义时单行较长 |
| **测试处置** | **自由重写**（C5 用户裁决） | 因**不做迁移**，原先的 RK1（"零漂移无证据"）**不再适用**（无老用户需保行为） |
| **契约前置** | **契约 + 派发骨架合并为原子任务** | 无兼容层 ⇒ 无"占位期"；`slot-service` 的 A/B/C 分支必须与类型**同一次**改写（否则 TS2367） |

---

## 7. Open Questions

**无（OPEN = 0）**。

### ✅ RK1 — **已关闭（不再适用）**
裁定 2026-09-30：**不做兼容、不做迁移**（应用未公测、无用户历史）⇒ 不存在"老用户行为变更无测试可证"的问题。D10 / C4 已废弃，`schemaVersion` 已删除。

**仍然必须遵守的跨层契约（与用户配置无关，C5）**：
- `SwitchOutcome.type === 'needs_recovery'` 被 `slot-service.test.ts:146/162`、`full-suite.test.ts:71/179` 锁定 → **不得移除**
- `SwitchOutcome` **4 变体冻结、不增不减**（B2 已撤销 `protected_blocked`）

---

## 8. 权限与工程约束（C1/C6/C7）

- **权限零扩张**：不新增 permission / host_permission / command（既有 `tabs`/`windows`/`storage`/`notifications`/`commands`/`sidePanel`/`scripting` + `<all_urls>` 足够）
- 不新增 npm 依赖；不放宽 eslint 严格度、不新增 `eslint-disable`；**lint 判据 = delta-0**；`typecheck` 0；三浏览器 build 通过
- 新增控件满足 **WCAG 2.1 AA**；界面**统一英文**（`src/ui` CJK 守卫保持 0 命中）
- `isProtectedUrl` **仅**用于「恢复窗 `Open URL`」与「导航到 slot 目标 URL」；`OPEN_PAGE` 到扩展自身页面**放行**；`file://` **加入 canonical 前缀**（重跑 `gen:prefixes`）— 连带：`file://` 亦不可作 rule 改写目标（已确认）

---

## 9. 交付物清单（供规划层）

- 4 个 resolver + **共享纯原语**；`resolve-switch.ts`
- `applySwitchOutcome`（unique side-effect point）+ **in-flight 合流**（switch / open-page / recovery）
- `SyncState` 重塑（**直接取代 `globalStrategy`，无迁移、无 `schemaVersion`**）+ `migrateSyncState` 改为仅填新形状默认值
- 消息：5 新增 / 3 重塑 / 4 不变
- 恢复窗：Prev/Next（Match，可连点）、`Open URL` 收敛（Exact-only + 特权页拦截 + 成功后关窗）、autoBind 复选框（三态 + 载荷携带）
- 侧边栏：`↑/↓` Position 按钮；footer 开页幂等；删除误导 toast
- 设置页：Global 三旋钮 + 方向 + autoBind 全局；每槽一行（策略 inherit/custom + autoBind 三态）
- 诊断：开页路径记录（`source`/`target`/`result`/`viaFallback`/`creates`/`reuses`）用于 item 2 根因定位
- 测试（四层）+ 门禁 + **独立复验**