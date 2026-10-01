# Detail Layer — Interaction Specs, Boundaries, Copy & Test Strategy

> **上游**：Goal（D1–D16）+ Constraint（C1–C7 / RK1）+ Architecture（A1–A14）
> **层**：📐 Detail
> **决策**：DT1–DT9（9 项），**OPEN：0**
> **日期**：2026-09-30 · **基线**：HEAD `d1f1f1d`

---

## DT1 · 恢复窗 Prev/Next 的游标与 session 生命周期（Q40）

**冲突（实测）**：既有 `recoveryService.nextMatch` 取 `candidates[0]` 并**立即 `removeRecoverySession`**（`recovery-service.ts:109/129`）——"点一次即定死并关会话"，与 item 4「可连续点击、不关窗」不兼容。

**决定**：
- session 记 **`candidateCursor`（以 tabId 锚定，见 DT2）**
- Prev/Next 前进/后退并**更新游标**；**不删除 session**
- **仅** `Open URL` 一次性消费 session（DT3）；`Do Nothing` / TTL 过期移除（DT5）
- 复用窗（D12/A11）后**可恢复到上次浏览位置**
- 与既有 slot `cycleCursors` 范式同构，落在 `local`（A3）

## DT2 · Prev/Next 的起点锚定与环绕（Q41）

- **首次**：若**当前活动页在候选集内** → 以它为起点（Next = 其后一个 → 避免"点一次回到原处"）；否则 Next 起于 `[0]`、Prev 起于 `[last]`
- **锚定**：会话游标记 **`cursorTabId`**（非 index）→ 每次实时重查候选后按 tabId 定位 index（**避免 index 漂移**，与 C4/A14 实时查询一致）
- `cursorTabId` 已被关闭 → 落回 `[0]` / `[last]`
- **环绕**：末 → 首（与 D5 环语义一致）
- **失败条件**：仅当候选集为空 → 窗内报错（D15）；否则不可能失败

## DT3 · `Open URL` 成功后的收尾（Q42）

`Open URL` 成功 → **自动关闭恢复窗** + 释放该槽窗前占位（D12）。
原则：**终止动作关窗、浏览动作留窗**。

## DT4 · 单页环边界（Q43）

- 环 = 当前窗口存活标签页，活动页必在其中 → **环恒 ≥ 1**
- **环仅 1 页 → 步进 = 原地（no-op）**，**不报错、不弹窗**
- "Tab Not Found" 严格保留给「**该槽目标不存在**」（D3/D4）

## DT5 · TTL 过期与再次触发（Q44）

- TTL 到期（既有 5 分钟）→ **自动关窗**（不再保留"已过期"死状态），释放槽占位
- 再次触发同槽 → **新建 session + 新建窗**
- D12 的复用键（活跃 session 的 `windowId`）唯一决定复用：**一个槽要么"正在恢复"，要么"没有恢复"**

## DT6 · 设置页布局（Q45）

**每槽一行（替换现有 10 个 select 的位置，内联紧凑）**：

```
Slot N   Strategy [Inherit global ▾]   Auto-bind [Follow global ▾]
         └─ if Custom:  Tab ID [▾]  Rule Check [▾]  Priority [▾]
```

- 策略 = 1 个 select（`Inherit global` / `Custom`）；选 `Custom` → **内联展开** 3 个 select
- autoBind = 1 个三态 select（`Follow global` / `Always on` / `Always off`）
- 默认态 = 2 控件/槽（`Inherit global` 是默认值 → 多数用户只需 1 个 select）

## DT7 · `↑/↓` 在锁定 tab 失效时（Q46）

- **降级**为「以当前活动页为起点」，**不报错**（"锁定页没了"不是 `↑/↓` 用户的错误）
- 依据：Lock 现状是**侧边栏会话内临时锚点**（`lockedTabId` 为内存态、不持久化；`sidebar/App.tsx:924-928` 锁定期间跳过 `queryCurrentTab`）；`↑/↓` 也在侧边栏内 → 锁不持久化对其无实际影响
- **不**让 Lock 持久化（范围蔓延，无需求支撑）

## DT8 · 成品文案与默认值（Q47，已全部接受）

### ① Global Matching Strategy 区
| 控件 | 标签 | 选项（★ = 默认） |
|---|---|---|
| Tab ID | `Tab ID` | `Exists` ★ / `No tab ID` |
| Rule Check | `Rule Check` | `Match` ★ / `No match` |
| Priority | `Priority` | `Tab ID` ★ / `Rule Check` / `None` |
| Direction | `Switch Direction` | `Previous Match` / `Next Match` ★ |
| Auto-bind | `Auto-bind switched tabs to their slot` | ☑ 默认勾选 |

> **默认值裁决说明**：item 3 原文写 `rule check：match/no match(default)`，但 **D9/Q9/Q10 已裁决新默认 = `Exists + Match + Priority = Tab ID`（组合 1）**。文案按 **D10** 标注（`Match ★`）。用户已确认接受。

### ② 每槽一行
| 控件 | 标签 | 选项 |
|---|---|---|
| 策略 | `Strategy` | `Inherit global` ★ / `Custom` |
| （Custom 展开）| `Tab ID` / `Rule Check` / `Priority` | 同 ① |
| autoBind | `Auto-bind` | `Follow global` ★ / `Always on` / `Always off` |

### ③ 侧边栏
- **新增**：`Switch to previous position tab`（↑）/ `Switch to next position tab`（↓），置于 `⤺/↻` 右侧
- slot 行 `⤺/↻` **沿用**：`Switch to previous matching tab` / `Switch to next matching tab`

### ④ 恢复窗（Tab Not Found）
- 复选框：`Auto-bind to this slot`（默认显示该槽**有效值**）
- 按钮：`Open URL`（**仅** `Match Type = Exact URL` 时展示）/ `Switch to Previous Match` / `Switch to Next Match` / `Do Nothing`
- 窗内错误：特权页被拦 → `This URL cannot be opened`；无候选 → `No matching tabs found at this time`（沿用既有串）

### ⑤ 错误提示
- `incognito_blocked` → toast：`Incognito access not authorized`（沿用既有 `INCOGNITO_NOT_AUTHORIZED` 文案）

## DT9 · 测试与验证分层（Q48）

| 层 | 内容 |
|----|------|
| **1. 纯函数单测**（无 adapter） | 4 个 resolver × 穷举输入，**含反例**：组合 2「**不回退** URL 查找」、组合 4「游标缺失 → `needs_recovery`」、组合 1 三档 priority；共享原语 `ruleCheckTabMatch` / `findMatchCandidates` / `buildPositionRing` / `applyPriority` / `focusOrStep` |
| **2. 集成测试**（mock-adapter） | `applySwitchOutcome` 映射表**逐行**；"**只弹 1 窗 / 只开 1 页**"（并发合流 + in-flight 去重）；**迁移函数**（旧 A/B/C → 新模型，RK1 的缓解） |
| **3. UI 测试** | `↑/↓` 存在与语义；恢复窗（`Open URL` 仅 exact 展示 / Prev·Next **不关窗** / **连续点击** / 复选框持久化）；设置页 3 旋钮 + 每槽一行 + 三态；单页环 no-op |
| **4. 门禁** | `typecheck` 0 / **lint delta-0** / `test:unit` / `test:integration` / `test:ui-smoke` / 三浏览器 build；**+ 独立复验（不采信执行者自审）** |

> **第 4 项的独立复验为强制项**：直接针对上一轮"执行者自审 APPROVE 却漏掉真实功能缺口"的教训（N5/N6/N7）。

---

## 遗留收口确认（逐条给出落点，不再遗留）

| Architecture 遗留项 | 落点 |
|---|---|
| 环 0/1 页边界 | **DT4**（0 页不可达；1 页 = no-op） |
| 恢复窗 TTL 与复用 | **DT5** |
| `protected_blocked` / `incognito_blocked` UI 文案 | **DT8 ④⑤** |
| 三态与方向文案 | **DT8 ①②** |
| `Open URL` 显隐判据 | **DT8 ④**（仅 `matchType === 'exact'`，渲染期判定，A12） |
| `↑/↓` 文案与 aria | **DT8 ③** |
| 设置页布局 | **DT6** |
| 测试分层 | **DT9** |
| 诊断记录字段 | 开页诊断沿用既有 `diagnostics` 结构，字段：`source` / `target` / `result` / `viaFallback` / `creates` / `reuses`（A9） |
| 恢复窗 Prev/Next 游标语义（发现于 Detail） | **DT1–DT2** |