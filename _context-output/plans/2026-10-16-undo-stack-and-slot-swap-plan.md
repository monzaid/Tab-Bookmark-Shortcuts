# 撤销堆积化 + 槽位拖拽交换 — Work Plan

> **计划名称**: undo-stack-and-slot-swap-plan
> **创建时间**: 2026-10-16 · **创建者**: sw-strategic-planner (Prometheus)
> **状态**: Ready for Execution（**0 项 [DECISION NEEDED]** —— 7 项堆积化裁决 + 2 项计划前置裁决已全部落定；本计划仅登记 **3 项实现前置核实 V1–V3**（见 §Context））
> **先读后规划**: 已完整读取 4 份设计分册 + 主文档 + `decisions.yaml` + 修订文档；规划期经两次独立探索**实读源码核实 40+ 处**关键事实（非引用设计）
> **上游设计**:
> - 主文档 `_context-output/designs/2026-10-16-slot-drag-swap-design.md`
> - 决策清单 `_context-output/designs/2026-10-16-slot-drag-swap-decisions.yaml`
> - 分册 `…-goal-scope-…` / `…-constraint-boundaries-…` / `…-architecture-module-…` / `…-detail-interaction-copy-…`
> - **范围修订** `_context-output/designs/2026-10-16-undo-stack-revision-design.md`（**推翻原 D18**）
> **取向（继承设计，不重开）**: 槽位 `id` 固定 1..10 且是身份（不能重排）；交换 = **内容对调**（`strategy`/`autoBindOverride` 留原编号）；**空是合法内容**；零第三方运行时依赖；TDD 三层 vitest project（`unit`/`integration`/`ui-smoke`）；**不承担向后兼容**；**不扩撤销覆盖面**（遵守既有 DR3 / A8 裁决）。

---

## TL;DR

> **Quick Summary**: 两件事合并为一份计划（U3=C）。
>
> **其一 · 撤销模型堆积化**：把"只有最近一次可撤销"改成**共享撤销栈**（U4）—— 后台 `pendingUndo` 由**单键单槽**改为**单键存数组**（U5），`clearPendingUndo` 从"无条件删键"改为"按 `(slotId, captureId)` 过滤后写回"（**最硬的既有假设**）；UI 三处独立持有者（侧边栏私有 `UndoState`、设置页 Tags、设置页 Dashboard）**统一接入一个共享栈 hook**，顺带消除侧边栏那个"**同名不同形**"的私有类型；呈现为**多条撤销条同时堆叠**（U1），**每条独立 5s 倒计时**（U2，需实装 `expiresAt` 消费 —— 现状 UI 完全忽略它）、**不限条数**（U7）。栈条目带**判别式**以调和两份并存的撤销机制（后台快照重放 vs UI 逐条重放，U6）；`UNDO_SAVE` 载荷**必须增加 `captureId`**（由 U1 自动派生）。
>
> **其二 · 槽位拖拽交换**（设计已四层闭合）：拖拽一个槽到另一个槽，交换**内容**（`urlMatch`/`uiMarker`/快照/**绑定**），配置留位；新增 `SWAP_SLOTS` 消息（**交换的撤销复用 `UNDO_SAVE`，不新增 `UNDO_SWAP`** —— 后台快照改为判别式以承载两槽，见裁决 **Z1**）；视觉为源槽 `opacity` + 目标槽 `outline` + `setDragImage` 携带编号；键盘双入口（`⋯` 菜单输入框 + `Alt+↑/↓` 手势）。**其撤销改用共享栈**（原 D18 的"并列独立键"作废）。
>
> **Deliverables**（详见 Work Objectives）:
> - `src/ui/shared/undo-stack.ts`（**新**，共享栈 hook + `UndoEntry` 判别式模型，U4/U6）
> - `src/ui/shared/undo-bar.tsx`（改为**列表渲染** + per-entry 倒计时 + per-entry `Undo` 按钮，U1/U2）
> - `src/background/storage-repository.ts`（`pendingUndo` **单键数组** + 快照**判别式** `kind: 'single' \| 'swap'`、`getPendingUndo`/`clearPendingUndo` 签名与语义、宽容读旧单对象，U5/Z1）
> - `src/background/slot-service.ts`（`captureUndoSnapshot` / `restoreSlot` 按 `captureId` 精确定位，含定时器归属）
> - `src/shared/messages.ts` + `src/background/worker-orchestrator.ts` + `src/ui/shared/message-client.ts`（`UNDO_SAVE` 载荷加 `captureId`；**`SWAP_SLOTS` 同批注册**）
> - `src/ui/sidebar/App.tsx`（私有 `UndoState` 消除、接入共享栈、拖拽 + Alt 手势 + 菜单入口）
> - `src/ui/settings/App.tsx`（Tags 与 Dashboard 两处接入共享栈 + 交换相关）
> - `src/ui/styles/sidebar.css` / `settings.css`（栈渲染、源/目标视觉、`grab` 光标、边界提示）
> - 测试：栈语义（per-entry 过期、按 `captureId` 精确弹出、超限/无淘汰）、服务层四组合、契约计数、拖拽/Alt UI 行为
>
> **Estimated Effort**: **L（4–5 天）** — **25 个实现任务（T1–T24 + T8a）+ 4 个终审（F1–F4）**
> **执行进度（全部完成）**: ✅ Wave 1+2（T1–T7）· ✅ T8a/T8 · ✅ T9/T10 · ✅ Wave 4（T11–T14）· ✅ Wave 5（T15/T16/T18/T19）· ✅ Wave 6（T20–T23）· ✅ T17 · ✅ T24 —— 每批均经独立复核
> **最终基线**: `tsc --noEmit` = **0** · `vitest run` = **183 个测试文件 / 1798 用例 / 0 失败** · `eslint` = **662 problem**（改造前基线 669，**本轮净减 7**）· 契约计数 **53**
> **⚠️ 数字口径更正（F1 审查发现）**: 先前此处及历次汇报写的"文件数"实为 vitest JSON 的 `numTotalTestSuites`（= **describe 块数** 626），**不是文件数**。真实文件数应取 `testResults.length` = **183**。用例数与失败数为 0 的两项口径一致，不受影响。**该错误源自编排者（规划者）自 Wave 1 起沿用的口径，非执行者笔误。**
> **✅ V1 已实测闭合（2026-10-17，用户裁决 C）**: `Alt` 的 `preventDefault()` **既抑制了浏览器菜单栏、又保留了 `keyup` 交付** —— **Edge**（1881ms）与 **Chrome**（1561ms）双双 `PASS`，且两组对照（不抑制）亦通过。**设计的手势成立，fallback 未采用。**
> 实测材料与结论: `_context-output/evidence/final-qa/V1-alt-manual-check.html`（可复跑的判定页）+ `V1-alt-measurement-result.txt`（结论与"本结论不声称什么"）。`src/ui/shared/use-swap-pending.ts` 的锚点已由 `PENDING` 更新为实测记录，同时**保留** `Alt+Enter` 的 fallback 说明以备将来浏览器回归。
> **本计划已无未闭合项。**
> **Parallel Execution**: YES — 6 Waves + FINAL
> **Critical Path**（**唯一权威**，与 §Dependency Matrix 一致）: `T1 → T2 → T3 → T8 → T9 → T10 → T20 → T22 → T24 → F1–F4 → user okay`
> （`T20` 需 Wave 3 全部完成（含串行的 T9→T10）与 T15/T16/T17/T18/T19；`T18` 不在主链）
> **关键风险**: **撤销栈改造横扫 3 处 UI 持有者与后台单键假设**（`clearPendingUndo` 无条件删键是最大地雷）+ **`UNDO_SAVE` 载荷变更牵动既有测试**（**8 处**单数获取 `Undo` 按钮分布 3 文件，必红）+ **两个 3000+ 行 `App.tsx` 严格串行**（含 `settings/App.tsx` 内 T9→T10）+ **V1（Alt 实测）阻塞 Alt 手势落地**

---

## Context

### Original Request

用户要求（逐层追加）：

1. 「迭代支持侧边栏 slot 槽 用户拖拽槽 切换 2 个槽之间的记录到数据，涉及场景：空槽，有记录数据的槽的各种组合」
2. 经 sw-brainstorming 四层评审（26 决策、0 OPEN）并**批准**
3. 随后**推翻**原 D18：「拓展：这个项目其他处的撤销逻辑也需要支持可堆积多条撤销」

因此本计划是**两件事的合并**（U3=C）：已批准的槽位交换 + 全项目撤销堆积化。

### Interview Summary

- **堆积化 7 项裁决**（U1–U7）：见 `_context-output/designs/2026-10-16-undo-stack-revision-design.md` §2
- **计划前置 2 项裁决**：
  - **A4**：「槽不存在」仅指**编号越界**（非 1..10 整数）→ `SLOT_NOT_FOUND`；1..10 内缺记录 = **空槽 = 合法内容**。原文措辞会推翻 D3，已修正三份文档
  - **A7**：撤销条 → 改为**可堆积**（即 U1–U7）

### Research Findings（规划期实读源码核实，非引用设计）

**撤销面**：

| 事实 | 证据 |
|---|---|
| 后台 `pendingUndo` 是**独立 local 键**，**不在 `LocalState`** 内 | `storage-repository.ts:43`、`:182-183` 注释 |
| `clearPendingUndo` **无条件 `remove` 整个键** ← **最大地雷** | `storage-repository.ts:1200` |
| `PendingUndoSnapshot` 单槽结构 + `captureId`（T34 同槽连写归属证明） | `storage-repository.ts:53-67`、`slot-service.ts:39,615` |
| `captureUndoSnapshot` 是**唯一**写 `setPendingUndo` 处 | `slot-service.ts:596-632`（`:617`） |
| `restoreSlot` 无快照时**降级为删除槽** | `slot-service.ts:647` |
| UI **三处**单值持有者；侧边栏那个**同名不同形** | `sidebar/App.tsx:82-86,1458`；`settings/App.tsx:655,2856` |
| `UndoLayerWrite` 4 种 kind；`writes` 已是数组但**整个 app 只持一个 snapshot** | `undo-bar.tsx:18-81` |
| UI **从未消费 `state.expiresAt`**；`onExpire?: () => void` **无参** | `undo-bar.tsx:111-117,124` |
| TTL 数值一致但有 **3 处硬编码**（侧边栏 `:1753`、Dashboard `:3255` 硬编码 5000） | 同上 |
| **两份机制并存**：侧边栏走后台快照（`UNDO_SAVE` 一条），设置页走 UI 逐条重放 | `sidebar/App.tsx:1788`；`settings/App.tsx:1290-1311,3366-3394` |
| 设置页 Dashboard 的 `clearShown`/`clearSelected`/`resetEntry` **无撤销** | `settings/App.tsx:3117,3158,3184` |
| 侧边栏 `handleUnbind` **无撤销**（既有 DR3 裁决） | `sidebar/App.tsx:1766`；`plans/2026-09-29-ui-ux-remediation-plan.md:707-713` |

**交换面**：

| 事实 | 证据 |
|---|---|
| 槽位 `id` 固定 1..10 且是身份；`slots` 是**稀疏数组**（空槽 = 缺记录） | `sidebar/App.tsx:2800-2803`；`types.ts:753-761` |
| `writeSync` **无条件递增版本** ⇒ 空↔空必须**写前短路** | `storage-repository.ts:405` |
| 无跨区事务；既有对策 `snapshot → 操作 → 失败则 restore` | `storage-repository.ts:1048-1058` |
| `KNOWN_ACTIONS` 手写白名单**不自动同步**，有门禁测试 | `worker-orchestrator.ts:54-113`；`known-actions.test.ts:5-19` |
| **契约计数硬断言 52** | `messages-import-export-contract.test.ts:105,109`（本次加 **1** action `SWAP_SLOTS` ⇒ **53**；Z1 裁决不新增 `UNDO_SWAP`） |
| `messages.test.ts` 是**穷尽 switch + assertNever** ⇒ union 加成员即**编译错误** | `messages.test.ts:28-88` |
| `_bidirectional` 编译期守卫（union 加而白名单不加 ⇒ 编译失败） | `worker-orchestrator.ts:120-123` |
| 槽位行 UI：`role=list` + 行 `role=listitem`；**无 `aria-posinset`/`aria-setsize`** | `sidebar/App.tsx:2800`、`:589-597` |
| `cursor`：基础行 `default`、`--bound` 行 `pointer`（已占用） | `sidebar.css:161,167` |
| **全仓仅 `tag-chip-input.tsx` 有拖拽**；侧边栏**首例** | `tag-chip-input.tsx:1136` |
| jsdom 的 `DataTransfer` stub **无 `setDragImage`** | `tag-chip-input.test.tsx:1064-1069` |
| `switchSlot` 空槽报 `SLOT_EMPTY`；`UPDATE_SLOT_URL` 缺记录报 `SLOT_NOT_FOUND`（**两处惯例不一致**） | `slot-service.ts:176`；`worker-orchestrator.ts:760` |
| 无 `dragover`/`dragstart` 于侧边栏；无 `UNSAVE_SLOT` action | 全仓搜索零命中 |

### Pre-Planning Review（Metis 缺口分析，已内联采纳）

16 项缺口 + 5 类 AI-slop 风险 + 验收可验证性审查。**全部已裁决或写入本计划**，其中：

- **A4（空槽 vs 槽不存在）** → 用户裁决 A，已同步三份文档
- **A7（撤销条覆盖）** → 用户裁决扩为堆积 → 演化为 U1–U7
- **A1/A2/A3/A5/A6/A8/A9** → 见 §Execution Strategy 的「规划期裁定」
- **AI-slop 护栏** → 见 §Must NOT Have

---

## Work Objectives

### Core Objective

1. **撤销堆积化**：建立**共享撤销栈**，使"多次操作后可逐条撤销"，且后台快照能按身份精确取出与清理。
2. **槽位拖拽交换**：侧边栏支持拖拽交换两槽内容，键盘有等价入口，撤销接入共享栈。

### Concrete Deliverables

| # | 文件 | 变更 |
|---|---|---|
| 1 | `src/ui/shared/undo-stack.ts`（**新**） | `UndoEntry` 判别式模型（`replay: 'background' \| 'client'`）+ 栈 hook（push/consume/expire/prune） |
| 2 | `src/ui/shared/undo-bar.tsx` | 列表渲染（多条堆叠）、per-entry `Undo` 按钮与独立倒计时；`onExpire` 改为带 `id` |
| 3 | `src/background/storage-repository.ts` | `pendingUndo` **单键数组**；`getPendingUndo(captureId)`；`clearPendingUndo` 按双身份**过滤后写回**；宽容读旧单对象 |
| 4 | `src/background/slot-service.ts` | `captureUndoSnapshot` 入栈（含定时器归属）；`restoreSlot(slotId, captureId)`；交换快照 |
| 5 | `src/shared/messages.ts` | `UNDO_SAVE` 加 `captureId`；新增 **`SwapSlotsRequest`（仅此一个，无 `UndoSwapRequest`）**；union |
| 6 | `src/background/worker-orchestrator.ts` | `KNOWN_ACTIONS` **+1（`SWAP_SLOTS`）**；`switch` **+1 `case`**；`UNDO_SAVE` 传 `captureId` |
| 7 | `src/ui/shared/message-client.ts` | `undoSave(slotId, captureId)`、`swapSlots(...)`（**无 `undoSwap`** —— 交换撤销复用 `undoSave`） |
| 8 | `src/ui/sidebar/App.tsx` | 消除私有 `UndoState`；接入共享栈；拖拽 + Alt 手势 + `⋯` 菜单入口 |
| 9 | `src/ui/settings/App.tsx` | Tags/Dashboard 两处接入共享栈 |
| 10 | `src/ui/styles/{sidebar,settings,base}.css` | 栈渲染、源/目标视觉、`grab`、边界提示 |
| 11 | 测试 | 栈语义 / 服务层四组合 / 契约计数 / 拖拽与 Alt UI 行为 |

### Definition of Done

- [ ] `npx tsc --noEmit` → **0 errors**（含 `_bidirectional` 守卫与 `messages.test.ts` 穷尽 switch）
- [ ] `npx vitest run` → **全绿**，含改写后的 **8 处**单数获取测试（3 文件）
- [ ] 契约计数 = **53**（仅新增 `SWAP_SLOTS`；**无** `UNDO_SWAP` —— Z1 裁决）
- [ ] 连续两次撤销产生**两条**撤销条，且**点第二条撤销的是第二次操作**（`captureId` 生效）
- [ ] 每条撤销条**独立 5s 过期**，过期后其余条目**不受影响**
- [ ] `clearPendingUndo` **不再清空整栈**（专项测试）
- [ ] 拖拽四组合（有↔有 / 有↔空 / 空↔有 / 空↔空）行为符合 D3
- [ ] 双击图标/标题/URL **仍不触发切换**（既有回归不破）
- [ ] Alt 自动化测试**只断言机制**，顶注引用 `sidebar-title-commit.test.tsx:17-22` 措辞模式

### Must Have

1. 共享撤销栈**单一模型**，三处 UI 接入（U4）
2. `UNDO_SAVE` 带 `captureId`（U1 派生）—— "点哪条撤哪条"
3. per-entry 独立 5s 倒计时（U2）
4. `pendingUndo` 单键数组 + 过滤式清理（U5）
5. 侧边栏覆盖保存**也进栈**（U6）
6. 栈条目判别式调和两份机制（U6）
7. 交换 = 内容对调、配置留位（D2）；空是合法内容（D3）
8. 一次消息一次写入 + 跨区补偿（D14）
9. 消息 union + `KNOWN_ACTIONS` + `case` + client + **3 个必红测试**同一原子任务（A3）
10. `aria-posinset`/`aria-setsize` 补齐（D26-3；`__number` **保持** `aria-hidden`）

### Must NOT Have (Guardrails)

| 护栏 | 依据 |
|---|---|
| **不**引入通用 `moveRecord`/`applyPermutation` 原语 | Metis Premature Abstraction |
| **不**把快照塞进 `LocalState`（会踩 strip 不变式） | `storage-repository.ts:182-183` |
| **不**新增 `DomainErrorCode` | D17 |
| **不**扩大撤销覆盖面（`clearShown`/`clearSelected`/`resetEntry`/`handleUnbind` 依旧无撤销） | 既有 DR3 / A8 |
| **不**做导入撤销 | A8 |
| **不**让槽位可重排 / 支持多选批量交换 / 交换进快捷键系统 | D3 否决、D11 否决；Scope Inflation |
| **不**为交换新增 `UndoLayerWrite` kind（走 `background` 分支） | 修订文档 §3 |
| **不**给 `swapSlots` 造通用校验层/中间件；硬编码 1..10 | Metis Over-Validation |
| **不**新建任何 `.md` 文档（文档在 `_context-output/`，非本次产物） | Metis Documentation Bloat |
| **不**打磨 `setDragImage` 拖影外观、outline 动效、对照行截断策略 | Metis Gold-Plating |
| **不**把 V1（Alt 抑制）写成自动化断言 | D19 诚实性红线 |
| **不**改 `pendingUndo` 之外的持久化形状 | U5 边界 |

---

## Verification Strategy (MANDATORY)

### Test Decision

- **框架**: vitest 2.1.8，三层 project（`unit` / `integration` / `ui-smoke`），jsdom 25
- **纪律**: TDD —— 先写失败测试证明缺陷/新语义，再实现；**断言针对不变式**而非"检测变化"；jsdom 无布局引擎处**断言结构**（参考 `tests/unit/ui/settings-class-css.test.ts`）
- **新测试文件**: 栈语义（可并入 `tests/unit/ui/undo-bar.test.tsx` 或新建）、交换 UI 行为（新建 `tests/unit/ui/sidebar-slot-swap.test.tsx`）

### QA Policy

**零人工干预**。agent 可执行全部验收命令；**唯一人工项**为非阻塞的 V1（且已明确禁止自动化伪装）。

**必须为自动化断言**：

- `[Test Command]` 栈语义：连续两次 push 产生两条；按 `captureId` 精确弹出（**验"点第二条撤第二次"**）；per-entry 过期互不影响；`clearPendingUndo` 不清空整栈
- `[Test Command]` 服务层四组合 + D2 策略留位 + D5 派生态清空 + 版本冲突整体拒绝 + D14 步骤④补偿回滚 → 扩 `tests/integration/slot-service.test.ts`
- `[Test Command]` `SWAP_SLOTS` 通过 `handleMessage` 门禁 → 扩 `tests/unit/background/known-actions.test.ts`（用其既有 `gate()` 范式 `:24-38`）
- `[Test Command]` 契约计数 **52→53** → `messages-import-export-contract.test.ts:105,109`
- `[Static Analysis]` 穷尽 switch 补 case → `messages.test.ts:32-88` 必须**编译通过**（编译期门禁）
- `[Test Command]` UI：拖拽（手写 `DataTransfer`，`tag-chip-input.test.tsx:1056-1074` 范式）发出**恰一次** `SWAP_SLOTS` 且载荷正确；Alt 手势 `fireEvent.keyDown/keyUp({altKey:true}) + advanceTimersByTime` 驱动超时与提交
- `[Test Command]` 既有回归：双击图标/标题/URL **仍不发** `SWITCH_SLOT`（`sidebar-slot-doubleclick-no-switch.test.tsx` 必须保持绿）

**必须为人工清单（非阻塞，标 `[Human Check]`）**：

- **V1**：Windows Chrome 下 `Alt` `preventDefault()` 能否**既抑制菜单、又保留 keyup 交付**
- 真实拖拽光标形态；环绕到边界提示的可见性

**如何避免"人工项伪装成自动化"**（D19 核心诚实性要求）：

- **禁止**在 jsdom 断言任何形如"`Alt` 未弹出浏览器菜单"、"焦点未被 `Alt` 移走"、"因为抑制了所以 keyup 到达"
- 允许自动化的**只是机制**：`keydown` handler 对 `Alt` 调了 `preventDefault()`、`keyup` handler 已接线、提交被调用**一次**
- 测试文件须有**顶注注释**，明确"jsdom 只能证明机制，不能证明菜单抑制"，并**逐字引用** `tests/unit/ui/sidebar-title-commit.test.tsx:17-22` 的措辞模式
- 计划把"是否出现该注释"列为**可核对项**（见 Success Criteria）

---

## Execution Strategy

### 规划期裁定（Metis 缺口，已定，不再重开）

| # | 裁定 |
|---|---|
| **A1** | `swapSlots(sourceSlotId, targetSlotId, expectedVersion)`，与 `saveSlot` 同族；返回新薄联合 `{ success:true; configVersion:number; changed:boolean } \| { success:false; errorCode; message }` —— `WriteResult` **无法表达** D17 的"成功但零写入" |
| **A2** | `pendingSwapUndo` **作废**（修订文档）；改 `pendingUndo` 为数组，三件套签名同步 |
| **A3** | 消息原子变更集：`messages.ts`(接口+union) + `worker-orchestrator.ts`(`KNOWN_ACTIONS` **+1 `SWAP_SLOTS`** + 1 `case`) + `message-client.ts` + **必红测试 3 个**（`messages.test.ts`、`messages-import-export-contract.test.ts` **52→53**、`known-actions.test.ts`）**同一任务内**完成 |
| **A4** | 越界（非 1..10 整数）→ `SLOT_NOT_FOUND`；1..10 内缺记录 = **空槽 = 合法**。**不用** `SLOT_EMPTY`（那是"想切换但槽空"的错误态） |
| **A5** | 投递用**写后重读**两槽 binding（同 `worker-orchestrator.ts:784` 先例），过滤 `null` 后投递 |
| **A6** | 派生态清空走**单次 `writeLocal(updater)`**：换两槽 binding + `cycleCursors`/`recoverySessions`/`recoverySnapshots` 三处 filter + `lastSuccessSlotId` 条件置空。**不新增 3 个仓库方法**（`cycleCursors` 无按 slotId 删、`recoverySnapshots` 无 mutator） |
| **A7** | 空↔空 **写前短路**，`changed:false`，**不 bump 版本**（`writeSync` 无条件 `:405` 递增，必须绕开） |
| **A10** | **`captureId` 必须回流到 UI（规划期漏项，Wave 3 由执行者报告）**。T8 要求侧边栏 push `replay:'background'` 条目，而该条目**必须带后台 `captureId`**；但 `saveSlot` 内部生成 `captureId`（`slot-service.ts:616`）后**只 return `{success, slot}`**、`SaveSlotResponse`（`messages.ts:548-551`）**不含**它，全系统**无任何通道**把 `captureId` 交给 UI。<br>**裁定**：**扩 `SaveSlotResponse.result` 增加 `captureId?: number`**（`slot-service.saveSlot` 把已生成的 `captureId` 一并返回）。<br>**为什么这条不动契约计数 53**：`_bidirectional` 守卫（`worker-orchestrator.ts:120-123`）比较的是 **`AnyRequest['action']` vs `KNOWN_ACTIONS`** —— 只在 **Request** 侧；`SaveSlotResponse` 是 **Response**，**不参与**该守卫，也**不在** `messages-import-export-contract.test.ts` 的计数集合内（该项目当前 0 处断言 `SaveSlotResponse`）。<br>**否决**：新增 `GET_PENDING_UNDO` 消息（会破 Z1 的 53→54）；侧边栏改走 `client` 分支（违反 U6）。<br>**副作用**：Wave 4 的 T11（交换撤销同样走 `background`）**必须复用本通道** —— `SWAP_SLOTS` 的响应同样需回传 `captureId`，否则交换的撤销也会卡在同一处。 |
| **A8** | 拖拽传播：行根 `draggable` + 文本元素 `draggable={false}` **且** `onDragStart={e=>e.preventDefault()}`（仅设前者**不足以**阻止从文本区发起祖先拖拽）。`setDragImage?.(...)` **可选链**（jsdom stub 无此方法） |
| **A9** | armed 前置 = `activeElement` 是槽行根 + 该行非编辑态 + 无 menu 打开；armed 期间禁止进入编辑态，进入编辑态即取消 armed |
| **U1–U7** | 见修订文档 §2 |

### Parallel Execution Waves

```
Wave 1（基础契约，3 任务，可并行）
├── T1  后台 pendingUndo 单键数组化（storage-repository）
├── T2  UndoEntry 判别式模型 + 共享栈 hook 骨架（undo-stack.ts）
└── T3  UNDO_SAVE 载荷加 captureId（messages → client → orchestrator → slot-service 串行链）

Wave 2（栈语义，4 任务；T5/T6/T7 依赖 T2）
├── T4  clearPendingUndo 过滤式清理 + 宽容读旧单对象（依赖 T1）
├── T5  UndoBar 列表渲染 + per-entry 按钮与倒计时（依赖 T2）
├── T6  栈 hook 完整语义：push/consume/expire/prune（依赖 T2）
└── T7  栈语义测试（依赖 T1/T4/T6）

Wave 3（三处 UI 接入；**T8a 是 T8 的前置**；**T9 → T10 必须串行**）
├── T8a captureId 回流到 UI（裁决 A10 —— 计划漏项，Wave 3 由执行者报告）
├── T8  侧边栏接入共享栈 + 消除私有 UndoState（**依赖 T5/T6/T8a**）—— 独立文件（sidebar/App.tsx）
├── T9  设置页 Tags 接入（依赖 T5/T6）—— 文件：settings/App.tsx ✅ 已完成
└── T10 设置页 Dashboard 接入（依赖 **T9**）—— **同一文件 settings/App.tsx，必须串行** ✅ 已完成
     ⚠️ T9 与 T10 同处一个 3000+ 行文件，并行会互相覆盖；与 Wave 6 对 App.tsx 的串行纪律一致
     ⚠️ **T8a 阻塞 Wave 4 的 T11**（交换撤销同样走 `background`，同样需要响应回传 `captureId`）

Wave 4（交换后端，4 任务；T11 与 T12 可并行）
├── T11 swapSlots 服务方法 + 四组合 + 写前短路（依赖 T1/T3）
├── T12 派生态清空单次 writeLocal（依赖 T1）
├── T13 SWAP_SLOTS 消息原子变更集 + 契约计数 53（依赖 T3）
└── T14 交换服务层测试：四组合/策略留位/派生态/版本冲突/补偿回滚（依赖 T11/T12）

Wave 5（交换前端，5 任务；T15/T16 可并行，T17–T19 依赖 T15）
├── T15 拖拽实现：行根 draggable + 文本区防护 + setDragImage（依赖 T13）
├── T16 ⋯ 菜单输入框 + 编号对照行（依赖 T13）
├── T17 Alt 手势（**V1 实测通过后才做**）（依赖 T15）
├── T18 视觉：源/目标/边界提示 + grab 光标（依赖 T15）
└── T19 a11y：aria-posinset/setsize + 结果宣告（依赖 T15）

Wave 6（App.tsx 串行集成段 + UI 测试）
├── T20 sidebar/App.tsx 交换集成（串行）
├── T21 拖拽 / Alt UI 行为测试（含诚实性顶注）
├── T22 既有测试改写（8 处单数获取 Undo，3 文件 → within 限定）
└── T23 回归：双击不切换、五处菜单测试、TTL 硬编码统一

Wave 7（收口）
└── T24 文档一致性：D18 作废标记、D17 精化、注释引用决策 ID

FINAL（4 审查者并行）
└── F1–F4
```

### Dependency Matrix

| 任务 | 依赖 | 阻塞 |
|---|---|---|
| T1 | — | T4, T11, T12 |
| T2 | — | T5, T6 |
| T3 | — | T11, T13 |
| T4 | T1 | T7 |
| T5 | T2 | T8, T9, T10 |
| T6 | T2 | T7, T8, T9, T10 |
| T7 | T1,T4,T6 | — |
| T8,T9,T10 | T5,T6 | T20 |
| T11 | T1,T3 | T14 |
| T12 | T1 | T11 |
| T13 | T3 | T15,T16 |
| T14 | T11,T12 | — |
| T15 | T13 | T17,T18,T19,T20 |
| T16 | T13 | T20 |
| T17 | T15, **V1** | T20 |
| T18,T19 | T15 | T20 |
| **T8a** | **—**（改 `messages.ts` + `slot-service.ts`） | **T8, T11** |
| **T9 → T10** | **T10 依赖 T9**（同一文件 `settings/App.tsx`，串行） | T20 |
| T8 | T5,T6,**T8a** | T20 |
| T20 | T8,T10,T15,T16,T17,T18,T19 | T21–T23 |
| T21,T22,T23 | T20 | T24 |
| T24 | T21–T23 | F1–F4 |

**关键路径权威链**（与上表一致）: `T1 → T2 → T3 → T8 → T20 → T22 → T24 → F1–F4`
（`T20` 另需 **T10** 完成，故 Wave 3 内 `T9 → T10` 的串行也在链上；`T18` 不在主链 —— 它只阻塞 T20 的视觉部分，可与 T14/T15 并行推进。原稿把 `T14 → T18` 写成链上相邻，实为笔误。）

### Agent Dispatch Summary

| Wave | 任务数 | 说明 |
|---|---|---|
| 1 | 3 | 基础契约，全并行 |
| 2 | 4 | T4 独立；T5/T6 并行；T7 收口 |
| 3 | 3 | **T8 可并行；T9 → T10 必须串行**（同处 `settings/App.tsx`） |
| 4 | 4 | T11/T12 并行；T13 独立；T14 收口 |
| 5 | 5 | 交换前端，注意 T17 受 V1 门禁 |
| 6 | 4 | `App.tsx` **严格串行**段 |
| 7 | 1 | 文档一致性 |
| FINAL | 4 | F1–F4 全并行 |

---

## TODOs

### Wave 1 — 基础契约

---

- [ ] **T1 · 后台 `pendingUndo` 单键数组化 + 快照判别式（裁决 Z1）**

  **WHAT TO DO**
  - `src/background/storage-repository.ts`：
    - `PENDING_UNDO_KEY` 的值**不变**（仍是同一个独立 local 键）；改的是**键内的形状**：由 `PendingUndoSnapshot` 变为 `PendingUndoSnapshot[]`
    - **快照改为判别式（Z1 裁决）** —— 因为交换的撤销必须还原**两个**槽（内容 + 绑定），而原结构只有**一组** `slotSnapshot`/`bindingSnapshot`，**装不下**：
      ```ts
      type PendingUndoSnapshot =
        | { kind: 'single'; id: string; captureId: number;
            slotId: number; slotSnapshot: SlotDefinition | null; bindingSnapshot: SlotBinding | null;
            expiresAt: number }
        | { kind: 'swap'; id: string; captureId: number;
            sourceSlotId: number; targetSlotId: number;
            sourceSnapshot: SlotDefinition | null; sourceBinding: SlotBinding | null;
            targetSnapshot: SlotDefinition | null; targetBinding: SlotBinding | null;
            expiresAt: number };
      ```
    - `kind: 'single'` 分支是**既有字段的原样保留**（只加 `kind` 与 `id`），因此宽容读旧存档时按 `kind: 'single'` 补齐即可
    - **新增 `id: string`**（栈内稳定身份，供 UI per-entry 倒计时与"点哪条撤哪条"）；与 `captureId` **不是同一个东西**
    - `setPendingUndo(snapshot)`：**追加**到数组（不再覆盖）
    - `getPendingUndo(captureId?)`：**带 `captureId` 时按身份取一条**（**这是应用真正使用的形式** —— `restoreSlot` 需要用户点的那一条）；不带时返回**全部未过期条目**。
      ⚠️ **措辞更正（R4，F1 审查发现）**：原文写"供 UI 重建栈"，与实现不符 —— **UI 是靠"执行动作时 push"建栈的，从不回读**。无参形式的作用是**把整栈作为整体观察**（测试断言用，将来若有 drain/repair 路径也需它），**当前无生产调用方**。不要把它当作 UI 契约。
    - **宽容读**：读到旧存档残留的**单对象**（非数组）时按"单元素栈"处理（沿用仓库既有"宽容补齐"立场）
    - **不**触碰 `LocalState` 形状

  **MUST NOT**：把快照塞进 `LocalState`（会踩 `writeLocal` 的 strip 不变式，见 `storage-repository.ts:182-183`）；为交换**新增独立消息**（Z1 已裁决复用 `UNDO_SAVE` 按 `kind` 分派）

  **QA SCENARIOS**
  - `[Test Command]` 扩 `tests/integration/storage-repository-tags.test.ts` 或新建 `tests/unit/background/pending-undo-stack.test.ts`：
    - 连续两次 `setPendingUndo` → 读到**两条**（不是一条）
    - 读旧格式（单对象）→ 不抛异常，按 `kind: 'single'` 当作一条
    - **Z1**：入栈一条 `kind: 'swap'` → 读回后 `sourceSnapshot`/`targetSnapshot` **均完好**（承载两槽是本次改造的目的）
    - 断言 `LocalState` 的键集合**未变**（快照仍在独立键内）
  - `[Static Analysis]` `npx tsc --noEmit` → 0 errors

  **证据路径**：`_context-output/evidence/final-qa/T1-*.txt`

---

- [ ] **T2 · `UndoEntry` 判别式模型 + 共享栈 hook 骨架**

  **WHAT TO DO**
  - **新建** `src/ui/shared/undo-stack.ts`：
    ```ts
    export type UndoEntry =
      | { id: string; replay: 'background';
          slotId: number; captureId: number;
          message: string; expiresAt: number }
      | { id: string; replay: 'client';
          snapshot: UndoSnapshot;
          message: string; expiresAt: number };
    ```
  - 该判别式**调和两份并存的撤销机制**（修订文档 §1.1）：`background` = 后台快照支撑、重放发**一条** `UNDO_SAVE`；`client` = UI 重放支撑、重放**逐条**发 `writes` 里的消息
  - hook 骨架（先只出接口与类型，语义在 T6 补全）：`useUndoStack()` 返回 `{ entries, push, consume, expire, clear }`
  - **统一 TTL 常量**：`UNDO_DEFAULT_MS` 与 `PENDING_UNDO_TTL_MS` 的关系要写明（数值一致但两处定义）；**消除**侧边栏 `sidebar/App.tsx:1753` 与 Dashboard `settings/App.tsx:3255` 的硬编码 `5000`

  **MUST NOT**：改 `UndoLayerWrite` 的既有 4 种 kind union；为交换**新增** kind（交换走 `background` 分支）

  **QA SCENARIOS**
  - `[Test Command]` `tests/unit/ui/undo-stack.test.ts`（新建）：`UndoEntry` 两个分支的类型收窄正确（`replay` 判别后可访问各自字段）
  - `[Static Analysis]` grep 反查：`sidebar/App.tsx` 与 `settings/App.tsx` 中不再出现裸 `5000`
  - `[Static Analysis]` `tsc --noEmit` → 0 errors

  **证据路径**：`_context-output/evidence/final-qa/T2-*.txt`

---

- [ ] **T3 · `UNDO_SAVE` 载荷增加 `captureId`**（**串行链：messages → client → orchestrator → slot-service**）

  **WHAT TO DO**
  - 由 **U1** 自动派生：每条撤销条有自己的 `Undo` 按钮 ⇒ 必须能指定"撤销哪一条"，否则点第 2 条会撤销最新那条（与堆叠呈现自相矛盾）
  - `src/shared/messages.ts:90-93`：`UndoSaveRequest.payload` 由 `{ slotId }` 改为 `{ slotId; captureId }`
  - `src/ui/shared/message-client.ts:233`：`undoSave(slotId, captureId)`
  - `src/background/worker-orchestrator.ts:581-590`：`case 'UNDO_SAVE'` 透传 `captureId`
  - `src/background/slot-service.ts:642`：`restoreSlot(slotId, captureId)` —— 用 `getPendingUndo(captureId)` 精确取，然后**按 `kind` 分派**（**Z1 裁决**）：
    - `kind: 'single'` → **既有语义不变**，含"无快照时降级为 `unbindSlot`"（`:647`）
    - `kind: 'swap'` → 在**一次写入**里还原两槽（内容 + 绑定），沿用 T11 的顺序写入＋补偿序列
  - `KNOWN_ACTIONS` **不变**（不新增 action，仅载荷变更；交换的撤销复用本消息）

  **MUST NOT**：把 `captureId` 改成可选并保留"弹出栈顶"的旧行为 —— 那会让 U1 的呈现与行为不一致

  **QA SCENARIOS**
  - `[Test Command]` 扩 `tests/integration/worker-orchestrator.test.ts`：`UNDO_SAVE` 缺 `captureId` → 拒绝或按既有降级；带 `captureId` → 恢复**指定那条**
  - `[Test Command]` **Z1 分派**：入栈 `kind: 'swap'` → `UNDO_SAVE` → **两槽内容与绑定同时还原**；入栈 `kind: 'single'` → 仍走既有单槽语义（**回归不破**）
  - `[Test Command]` 扩 `tests/unit/ui/sidebar-result-handling.test.tsx:127-156`：`UNDO_SAVE` 失败仍要报错
  - `[Test Command]` `npx vitest run --project unit tests/unit/shared/messages.test.ts` → 编译通过（穷尽 switch 需同步）
  - `[Static Analysis]` `tsc --noEmit` → 0 errors（含 `_bidirectional` 守卫 `worker-orchestrator.ts:120-123`）

  **证据路径**：`_context-output/evidence/final-qa/T3-*.txt`

---

### Wave 2 — 栈语义

---

- [ ] **T4 · `clearPendingUndo` 过滤式清理 + 宽容读**（**本项目撤销堆积化最硬的一处改动**）

  **WHAT TO DO**
  - **缺陷本体**：`storage-repository.ts:1200` 的 `clearPendingUndo` **无条件 `remove` 整个 `PENDING_UNDO_KEY`** —— 这是"单键单槽"最硬的假设。改数组后若不动它，**任何一条的清理定时器都会清空整栈**
  - 改为：读数组 → 按 `(slotId, captureId)` **双身份过滤**（沿用 `:1190-1198` 既有的双身份归属判定）→ **写回过滤后的数组**；数组为空时才 `remove` 该键
  - `getPendingUndo` 的 lazy `expiresAt` 校验（`:1161`）**扩展为逐条校验**：读取时丢弃已过期条目（保持"睡眠 service worker 不会丢过期"的既有保证）

  **MUST NOT**：削弱既有的 `captureId` 归属证明（T34 的理由仍然成立 —— 同槽快速连写）

  **QA SCENARIOS**
  - `[Test Command]` **专项**：入栈 2 条（不同 slotId）→ 清第 1 条 → 断言第 2 条**仍在**
  - `[Test Command]` **专项**：入栈 2 条（**同一 slotId** 不同 captureId）→ 清旧 captureId → 断言新的**仍在**（复现 T34 的原始恐惧，但针对数组形态）
  - `[Test Command]` 入栈 1 条 → 清它 → 断言键被 `remove`（不留空数组）
  - `[Test Command]` 注入一条已过期条目 → 读取时被丢弃，其余不受影响
  - `[Test Command]` 扩 `tests/integration/worker-orchestrator.test.ts:574-632`（原断言以"**同一个键**"为前提，需按新形态重述，但**保留其原意**：过期的旧快照不得删掉更新的快照）

  **⚠️ 实现提示（Momus 复审补充）**：`kind: 'swap'` 条目**没有 `slotId`**，故双身份过滤对它不适用 —— 实现时以**全局唯一的 `captureId`** 兜底（`captureId` 由模块级单调计数器 `slot-service.ts:39` 生成，全局唯一），即：过滤条件为「`captureId` 不符 → 保留」。

  **证据路径**：`_context-output/evidence/final-qa/T4-*.txt`

---

- [ ] **T5 · `UndoBar` 列表渲染 + per-entry 按钮与独立倒计时**

  **WHAT TO DO**
  - `src/ui/shared/undo-bar.tsx`：
    - 由"渲染单个 `state`"改为"**渲染 `entries` 列表**"，每条一个 `Undo` 按钮（**U1：多条同时堆叠显示**）
    - `onExpire?: () => void` **改为携带身份**：`onExpire: (id: string) => void` —— 当前无参签名承载不了"哪一条过期"
    - **实装 per-entry 倒计时**（**U2**）：当前 `:111-117` 只有一个 `setTimeout(durationMs)`，且 `state.expiresAt` **在组件里被完全忽略**（`:124` `void shownAt`）。改为**每条按自身 `expiresAt`** 独立计时
    - 保留既有 a11y：`role="status" aria-live="polite"`（**不是** `alert`，CT3-g4 已定）
    - 保留既有行为：打开时取焦点、`returnFocusRef` 归还焦点（`:86-97`）

  **MUST NOT**：改成 `role="alert"`；移除焦点管理

  **⚠️ 临时红树提示（Momus 复审补充）**：本任务改 `UndoBarProps`（`onExpire` 签名 + 渲染列表）会让 **T8/T9/T10** 的调用点**暂时编译报错**，Wave 2 结束时整棵树处于**临时红态**。这是**预期的编译期护栏**，不是缺陷 —— 判据是"**本任务改动处可编译**"，红态在 Wave 3 完成后消除。**不要**为了让树变绿而在本任务顺手改 T8–T10 的文件（那会破坏 Wave 分工）。

  **QA SCENARIOS**
  - `[Test Command]` 扩 `tests/unit/ui/undo-bar.test.tsx`：2 条 entries → 渲染**2 个** `Undo` 按钮；点第一个 → 回调携带**第一个的 id**
  - `[Test Command]` per-entry 过期：2 条 `expiresAt` 相差 1s → `advanceTimersByTime` 越过第一条后，**只剩第二条**
  - `[Test Command]` 扩 `tests/unit/ui/a11y-confirm-undo.test.tsx:51-66`：`role="status"` 与焦点语义不破
  - `[Static Analysis]` `tsc --noEmit` → 0 errors（`UndoBarProps` 变更会让所有调用点报错，正是护栏）

  **证据路径**：`_context-output/evidence/final-qa/T5-*.txt`

---

- [ ] **T6 · 栈 hook 完整语义：push / consume / expire / prune**

  **WHAT TO DO**
  - `src/ui/shared/undo-stack.ts` 补全：
    - `push(entry)`：入栈；**不限条数**（U7）
    - `consume(id)`：按 **`id`** 精确弹出（不是弹出栈顶）—— 这才是"点哪条撤哪条"
    - `expire(id)`：按 `id` 移除已过期一条，**不影响其余**
    - `clear()`：整栈清空（切换 section / 重新加载时用）
  - **U6 差异显式建模**：`replay: 'background'` 的 `consume` 发**一条** `UNDO_SAVE { slotId, captureId }`；`replay: 'client'` 的 `consume` **逐条**重放 `snapshot.writes`（沿用 `settings/App.tsx:1290-1311` 与 `:3366-3394` 既有循环，**不重写重放语义**）
  - `id` 生成：与后台 `captureId` **不是同一个东西**；`background` 条目两者都有

  **MUST NOT**：把 `replay: 'client'` 的重放改成"一条原子消息"（既有路径没有原子重放，见盘点 §5；改它是另一件事）

  **QA SCENARIOS**
  - `[Test Command]` `tests/unit/ui/undo-stack.test.ts`：
    - push 3 条 → `entries.length === 3`
    - `consume(第二条的 id)` → 只移除该条，其余 2 条**保持**
    - `expire(第三条)` → 其余不受影响
    - **不限条数**：push 20 条 → 全部保留（U7）
  - `[Test Command]` 两种 `replay` 的 consume 分别产生正确调用：`background` → 1 次 `undoSave`；`client` → N 次消息（按 `writes.length`）

  **证据路径**：`_context-output/evidence/final-qa/T6-*.txt`

---

- [ ] **T7 · 栈语义测试收口**

  **WHAT TO DO**
  - 补齐 T4/T6 的**组合**场景：后台栈与 UI 栈**一致性**（后台入栈 ↔ UI 入栈同源）
  - 断言"**连续两次操作 → 两条可独立撤销**"这一**用户可见承诺**（U1+U6 的合题）
  - 断言"**5s 逐条过期**"在**不限条数**下的行为（U2+U7）

  **QA SCENARIOS**
  - `[Test Command]` 连续两次 `SAVE_SLOT` → UI 出现 2 条 → **点第 1 条**撤销的是**第一次**（断言后台收到的 `captureId` 是第一次那个）
  - `[Test Command]` 一次 tag 删除 + 一次覆盖保存 → 两种 `replay` 混栈 → 各自撤销正确
  - `[Test Command]` `npx vitest run --project unit tests/unit/ui/undo-*.test.ts*` → 0 failed

  **证据路径**：`_context-output/evidence/final-qa/T7-*.txt`

---

### Wave 3 — 三处 UI 接入共享栈

---

- [ ] **T8a · `captureId` 回流到 UI（裁决 A10 —— T8 的前置，Wave 3 由执行者报告的计划漏项）**

  **WHAT TO DO**
  - **缺口本体**：`saveSlot` 在 `slot-service.ts:616` 生成 `captureId`（T34 归属证明）后**只 return `{ success, slot }`**（`:102`），`SaveSlotResponse`（`messages.ts:548-551`）**不含**它。而 T8 要 push 的 `replay:'background'` 条目**必须**带 `captureId`（`undo-stack.ts:32-47` + `createUndoReplay:84-86` 会原样发给 `UNDO_SAVE`）。**全系统无通道**把 `captureId` 交给 UI。
  - 改 `SaveSlotResponse`（`messages.ts:548-551`）：`result` 的 success 分支增加 **`captureId?: number`**
  - 改 `slot-service.saveSlot`（约 `:102`）：把**已在 `:616` 生成的**那个 `captureId` 一并返回。**注意**：`captureId` 由 `captureUndoSnapshot` 内部生成（`:616`），需让它回流到 `saveSlot` 的返回值 —— 最小改法是让 `captureUndoSnapshot` 返回它、或让 `captureBeforeOverwrite` 透传；**不要**为此外泄整个快照
  - `captureId` 可选：**空槽保存**（无既有记录 → `captureUndoSnapshot` 在 `:599` 提前 return）时不产生快照，此时**无 `captureId`**，UI 也就**不入栈**（与"只有覆盖已占用槽位才显示撤销"的既有门槛 `:1750` 天然一致）

  **MUST NOT**：新增 `GET_PENDING_UNDO` 类消息（会破 Z1 的 53）；把整个快照外泄给 UI；改 `UndoLayerWrite` union

  **QA SCENARIOS**
  - `[Test Command]` 扩 `tests/integration/slot-service.test.ts`（或 `worker-orchestrator.test.ts`）：
    - 覆盖**已占用**槽位 → 响应**含** `captureId`，且 `getPendingUndo(该 captureId)` **能取到**对应快照
    - 保存**空槽** → 响应**不含** `captureId`（无快照可撤销）
  - `[Test Command]` `npx vitest run --project unit tests/unit/shared/messages.test.ts` → 编译通过
  - `[Static Analysis]` `tsc --noEmit` → 本任务处 0 错误
  - `[Check]` **确认契约计数仍为 52**（`SaveSlotResponse` 是 Response，不入 `KNOWN_ACTIONS` 守卫与计数集合）；`messages-import-export-contract.test.ts` 不变

  **证据路径**：`_context-output/evidence/final-qa/T8a-captureid-return.txt`

---

- [ ] **T8 · 侧边栏接入共享栈 + 消除私有 `UndoState`**（**依赖 T8a**）

  **WHAT TO DO**
  - `src/ui/sidebar/App.tsx`：
    - **删除**私有 `interface UndoState { slotId; previousSlot; expiresAt }`（`:82-86`）—— 它与共享 `UndoState`（`undo-bar.tsx:83`）**同名不同形**，共享类型在该文件被别名成 `SharedUndoState`（`:890`），是极易漏改的隐患
    - `:1458` 的单值 state 换成共享栈 hook
    - `:851-869` 的 `SidebarUndoAdapters`：改为产出 `replay: 'background'` 条目（该分支的重放本就是发一条 `UNDO_SAVE`）
    - `:1750-1754` `handleSave` 的写入点：push 一条 `background` 条目（**U6：侧边栏也堆叠**）
    - `:1784-1802` `handleUndo`：改为 `consume(id)` → 发 `UNDO_SAVE { slotId, captureId }`
    - `:2873` 渲染点改为渲染栈
  - **消除硬编码 TTL**：`:1753` 的 `Date.now() + 5000` 改用共享常量

  **MUST NOT**：改变"只有覆盖**已占用**槽位才显示撤销"的既有门槛（`:1750` 的 `existingSlot` 判定）；`handleUnbind` **仍不提供撤销**（既有 DR3 裁决）

  **QA SCENARIOS**
  - `[Test Command]` 连续两次覆盖保存 → 侧边栏出现 **2 条**；点第 1 条 → `UNDO_SAVE` 携带**第一次的 `captureId`**
  - `[Test Command]` grep 反查 `sidebar/App.tsx` 不再有 `previousSlot` 私有态与裸 `5000`
  - `[Test Command]` 扩 `tests/unit/ui/sidebar.test.tsx`、`sidebar-result-handling.test.tsx` → 0 failed

  **证据路径**：`_context-output/evidence/final-qa/T8-*.txt`

---

- [ ] **T9 · 设置页 Tags 接入共享栈**

  **WHAT TO DO**
  - `src/ui/settings/App.tsx` `TagsSection`：`:655` 单值 state → 共享栈 hook
  - 三个写入点（`:824-828` rule-tags、`:900-904` 单删、`:977-981` 批量 N 条）push `replay: 'client'` 条目
  - `:1290-1311` `handleTagUndo` 的重放循环**保留**（`RESTORE_TAG` / `SET_RULE_TAGS`），仅改为由 `consume(id)` 驱动
  - `:1277-1283` 渲染点改渲染栈；硬编码 TTL 统一

  **MUST NOT**：改变批量删除"**一次撤销恢复整批**"的既有语义（`writes` 收集后一条撤销条）；不新增批量撤销入口

  **QA SCENARIOS**
  - `[Test Command]` 扩 `tests/ui-smoke/tags-section.test.tsx:124-257,301-320`：
    - 批量删除 → 仍**一条**撤销条，重放 N 次 `RESTORE_TAG`（既有断言 `:226-228` 的"TWO restore calls"须保持）
    - **新**：单删 + unlink 各一次 → 出现 **2 条**；点第 1 条只重放它自己的 writes
  - `[Test Command]` 确认与撤销条的**严格串行**（确认框未关时不出现撤销条）不破

  **证据路径**：`_context-output/evidence/final-qa/T9-*.txt`

---

- [ ] **T10 · 设置页 Dashboard 接入共享栈**

  **WHAT TO DO**
  - `src/ui/settings/App.tsx` Dashboard 区：`:2856` 单值 state → 共享栈 hook
  - `:3245-3256` `clearEntryField` push `replay: 'client'` 条目（`tab-override` / `slot-marker` 三元）
  - `:3366-3394` `handleUndo` 的循环改为由 `consume(id)` 驱动
  - `:3839-3845` 渲染点改渲染栈；`:3255` 硬编码 `5000` 统一

  **MUST NOT**：给 `clearShown` / `clearSelected` / `resetEntry` **新增**撤销（`settings/App.tsx:3117,3158,3184`）—— 超出范围

  **QA SCENARIOS**
  - `[Test Command]` 扩 `tests/unit/ui/dashboard-undo-recipe.test.tsx`：Clear→Undo 仍重放**原始 `IconSource`**（不得退化成字符串）
  - `[Test Command]` **新**：两行各 Clear 一次 → 2 条撤销条；点第 1 条只还原第 1 行
  - `[Test Command]` `clearShown` 后**无**新增撤销条（护栏）

  **证据路径**：`_context-output/evidence/final-qa/T10-*.txt`

---

### Wave 4 — 交换后端

---

- [ ] **T11 · `swapSlots` 服务方法 + 四组合 + 写前短路**

  **WHAT TO DO**
  - `src/background/slot-service.ts` 新增（**A1 裁定**）：
    ```ts
    async swapSlots(
      sourceSlotId: number, targetSlotId: number, expectedVersion: number,
    ): Promise<
      | { success: true; configVersion: number; changed: boolean }
      | { success: false; errorCode: string; message: string }
    >
    ```
    **不复用 `WriteResult`** —— 它只有 `{success:true; configVersion}`，**无法表达 D17 的"成功但零写入"**
  - 校验（**A4 裁定**，UI 不是边界）：
    - `sourceSlotId === targetSlotId` → `INVALID_REQUEST`
    - **编号越界**（非 1..10 整数）→ `SLOT_NOT_FOUND`（**复用既有错误码，不扩 `DomainErrorCode`**）
    - **1..10 内缺记录 = 空槽 = 合法内容**（**不是错误**，走对调）—— ⚠️ 若把缺记录判为错误，**有↔空永远报错、D3 被推翻**
  - 四组合：有↔有 = 对调；有↔空 = 移动；空↔有 = 移动；空↔空 = **写前短路**
  - **A7 裁定**：空↔空直接 `return { success:true, changed:false, configVersion: 当前 }`，**不得进入 `writeSync`** —— 它**无条件递增版本**（`storage-repository.ts:405`），会与 D17"不动版本"矛盾
  - **D2 内容/配置边界**：跟着走 = `urlMatch`/`uiMarker`/`titleSnapshot`/`faviconSnapshot`/**绑定**；留原编号 = `strategy`/`autoBindOverride`
  - **D14 写入序列**：① 快照两槽 record+binding+派生态 → ② 写 sync（带 `expectedVersion`，**失败即中止**，此时未动 local 故无需补偿）→ ③ 写 local（**A6**：单次 `writeLocal`）→ ④ ③ 失败则用快照回写两区
  - **捕获交换撤销快照**（进共享栈，`replay: 'background'`，条目含两个 slotId + `kind:'swap'` + 全局唯一 `captureId`）
  - ⚠️ **复用 T8a 的通道（裁决 A10）**：`SWAP_SLOTS` 的**响应必须回传 `captureId`** —— 否则 UI 拿不到它、T15/T20 无法 push `background` 条目，交换的撤销就不可用（与 T8 卡住的原因完全相同）。实现时照 T8a 的形态在 `SwapSlotsResponse` 上加 `captureId`（同样是 **Response**，不动契约计数 53）
  - **D7/A5 投递**：**写后重读**两槽 binding（同 `worker-orchestrator.ts:784` 先例），过滤 `null` 后 `recomputeAndRedeliver`

  **MUST NOT**：引入通用 `moveRecord`/`applyPermutation` 原语；新增 `DomainErrorCode`；为"未来需求"预留抽象

  **QA SCENARIOS**
  - `[Test Command]` 扩 `tests/integration/slot-service.test.ts`（**四组合逐一**）：
    - 有↔有：两槽 `urlMatch`/`uiMarker`/快照/绑定**互换**，且 `strategy`/`autoBindOverride` **未动**
    - 有↔空：内容搬到空槽，**源槽变空**（`sync.slots` 里不再有该 id）
    - 空↔有：对称
    - 空↔空：**`changed === false` 且 `configVersion` 未变**
  - `[Test Command]` 越界（0 / 11）→ `SLOT_NOT_FOUND`；`source === target` → `INVALID_REQUEST`
  - `[Test Command]` 版本不符 → `CONFIG_CONFLICT`，且**两槽均未变**
  - `[Test Command]` **A5**：写后重读投递 —— 断言 `recomputeAndRedeliver` 收到的 tabId 集合正确，且空槽侧**不传 `undefined`**
  - `[Test Command]` **D14 步骤④**：注入 local 写失败 → 断言 sync **已回滚**（两槽恢复原样）

  **证据路径**：`_context-output/evidence/final-qa/T11-*.txt`

---

- [ ] **T12 · 派生态清空（单次 `writeLocal`）**

  **WHAT TO DO**
  - **A6 裁定**：在 T11 的**第 ③ 步同一次 `writeLocal(updater)`** 内完成全部 local 变更，**不新增 3 个仓库方法**（`cycleCursors` **无**按 slotId 删除、`recoverySnapshots` **无** mutator —— 分三次写会产生多个 local 写窗口，违反 D14"一次写入"）
  - updater 内：
    - 换两槽 binding（`local.bindings`）
    - `cycleCursors.filter(c => c.slotId ∉ {source, target})`
    - `recoverySessions.filter(s => s.slotId ∉ {source, target})`
    - `recoverySnapshots.filter(s => s.slotId ∉ {source, target})`
    - `lastSuccessSlotId ∈ {source, target} ? null : 原值`
  - **D5 依据**：三者均为瞬态（`recoverySessions` TTL 5 分钟），清空**永不产生错误行为**（下次循环/恢复自然重建），而沿用可能产生**错误的切换目标**

  **MUST NOT**：顺手清 `tabOverrides`（不在 D5 范围）；新增仓库方法

  **QA SCENARIOS**
  - `[Test Command]` 预置两槽的 `cycleCursors`/`recoverySessions`/`recoverySnapshots` + `lastSuccessSlotId` 指向其中一槽 → 交换后**四处均已清空/置空**
  - `[Test Command]` 断言"**单次** `writeLocal`"：用 mock 计数，交换的 local 写入**恰一次**
  - `[Test Command]` 其他 slotId 的派生态**未被误清**

  **证据路径**：`_context-output/evidence/final-qa/T12-*.txt`

---

- [ ] **T13 · `SWAP_SLOTS` 消息族原子变更集**（**A3 裁定 —— 不可拆分**）

  **WHAT TO DO**
  - 同一任务内完成**全部 4 个源文件**（G-D 既有约定："同批注册"，否则 `_bidirectional` 守卫直接编译失败）：
    1. `src/shared/messages.ts`：`SwapSlotsRequest`（`{ sourceSlotId; targetSlotId }`，带 `RequestBase.configVersion`）+ 加入 `UiRequest` union（`:477`）
    2. `src/background/worker-orchestrator.ts`：`KNOWN_ACTIONS`（`:54-113`）加 **`SWAP_SLOTS`（1 个）**；`switch` 加 1 个 `case`
    3. `src/ui/shared/message-client.ts`：`swapSlots(source, target)`
    4. **3 个必红测试同步**（见 QA）
  - **不新增 `UNDO_SWAP`**（**Z1 裁决**）：交换的撤销走**共享栈**的 `replay: 'background'` 分支，复用 `UNDO_SAVE { slotId, captureId }`，由后台按快照的 `kind: 'swap'` 分派还原两槽。因此契约计数 **+1 ⇒ 53**（**不是 54**）

  **MUST NOT**：拆成多个任务；引入 `UNDO_SWAP` 或任何与 `UNDO_SAVE` 平行的撤销通道

  **QA SCENARIOS**
  - `[Test Command]` `tests/unit/shared/messages.test.ts:32-88`（穷尽 switch + `assertNever`）→ **编译通过**（union 加成员即编译错误，这是护栏）
  - `[Test Command]` `tests/unit/shared/messages-import-export-contract.test.ts:105,109` → 计数由 **52** 改为 **53**，`:110-111` 双向 diff 断言同步
  - `[Test Command]` `tests/unit/background/known-actions.test.ts:46-53` 的 `newActions` 补上 **`SWAP_SLOTS`**，用其既有 `gate()` 私有访问范式（`:24-38`）断言通过门禁
  - `[Static Analysis]` `tsc --noEmit` → 0 errors
  - `[Check]` 反查：全仓**无** `UNDO_SWAP` 字样

  **证据路径**：`_context-output/evidence/final-qa/T13-*.txt`

---

- [ ] **T14 · 交换服务层测试收口**

  **WHAT TO DO**
  - 补齐 T11/T12 的**组合与边界**：四组合 × 策略留位 × 派生态清空 × 版本冲突 × 补偿回滚
  - 断言 D2 的**已知取舍**（记录 + **目标编号**的策略）**按设计发生** —— 这是设计文档明示的取舍，**不是 bug**，测试须把它**钉成预期行为**，防止后人"修正"
  - 断言交换的**撤销可恢复两槽**（含绑定）

  **QA SCENARIOS**
  - `[Test Command]` 交换 → 撤销 → **两槽内容与绑定完全回到交换前**
  - `[Test Command]` **D2 取舍显式断言**：源槽记录搬到目标槽后，套用的是**目标编号原本的 `strategy`**
  - `[Test Command]` `npx vitest run --project integration tests/integration/slot-service.test.ts` → 0 failed

  **证据路径**：`_context-output/evidence/final-qa/T14-*.txt`

---

### Wave 5 — 交换前端

---

- [ ] **T15 · 拖拽实现（`draggable` 层级 × `dragstart` 拦截 × `setDragImage`）**

  **WHAT TO DO**
  - `src/ui/sidebar/App.tsx` `SlotRow`：行根（`:589-598`）加 `draggable`，`dragstart` 设 `dataTransfer` 载荷（`text/plain` JSON，沿用 `tag-chip-input.tsx:1146` 模式）+ `effectAllowed='move'`
  - **A8/D9 关键**：仅给标题/URL 设 `draggable={false}` **不足以**保留文本选中 —— HTML5 中 `draggable=false` 只是"该元素不作为拖拽源"，**不阻止从它上面发起祖先的拖拽**。必须**同时**在文本元素上 `onDragStart={e => e.preventDefault()}`
  - **D22**：`dragstart` 用 `dataTransfer.setDragImage?.(...)` 携带**槽位编号** —— **必须可选链**（jsdom 的 stub 只有 `setData/getData/effectAllowed/dropEffect` 四个字段，见 `tag-chip-input.test.tsx:1064-1069`，否则测试抛异常）
  - **D13 守卫**：`dragstart` 时**取消待提交的激活计时器** + **取消已武装的 Alt 态**；拖到自身 → `dropEffect='none'`；拖到**编辑态**行 → **拒绝**；拖出列表 → 静默取消
  - **D13 红线（数据完整性）**：编辑态提交走 `onEditTitle(slotNumber, draft)`，写回的是**该编号**。若交换先发生，草稿会写进**已换内容**的槽 —— **拒绝是唯一不产生串写的选择**

  **MUST NOT**：让文本区可发起拖拽；用 `dragover` + `clientX/Y` 挪自定义浮层伪装"跟随鼠标"（用标准 `setDragImage`）

  **QA SCENARIOS**
  - `[Test Command]` `tests/unit/ui/sidebar-slot-swap.test.tsx`（**新建**）：手写 `DataTransfer`（照 `tag-chip-input.test.tsx:1056-1074` 范式）驱动 `dragStart/dragOver/drop` → 发出**恰一次** `SWAP_SLOTS`，载荷 `{sourceSlotId, targetSlotId}` 正确
  - `[Test Command]` 拖到自身 → **不发**消息；拖到编辑态行 → **不发**消息
  - `[Test Command]` `dragstart` 后待提交的激活计时器被取消（`advanceTimersByTime` 越过间隔 → **无** `SWITCH_SLOT`）
  - `[Test Command]` 文本元素上 `dragstart` 被 `preventDefault`（`fireEvent.dragStart(titleEl)` → 断言 defaultPrevented）
  - `[Static Analysis]` grep：`setDragImage` 调用处**必须**是可选链形式

  **证据路径**：`_context-output/evidence/final-qa/T15-*.txt`

---

- [ ] **T16 · `⋯` 菜单 `Swap with slot…` + 编号对照行**

  **WHAT TO DO**
  - 菜单（`:778-815`）新增 `Swap with slot…`（**D25-① 文案**），排在 `Edit URL…` 之后、`Clear Slot Data` 之前
  - 点击打开**输入框**（**D23**）：用户键入目标编号 `1..10`；**即执行不二次确认**（交换可撤销）
  - **D24**：输入框**上方**一行可扫读对照，形如 `1 GitHub · 2 Empty · 3 News…`（**最简实现即可**，截断策略不作优化 —— Metis Gold-Plating 护栏）
  - 校验（并入 D17）：非 1..10 整数 → 就地阻止；等于源槽 → 就地阻止并提示
  - **模态提交，不入瞬态态**（**矛盾 C1 的裁决**）：菜单路径**不受 D12 失焦/超时约束**，生命周期由对话框自身管理（`Escape`/取消/提交）—— 因为 `⋯` 菜单一打开槽行就失焦，若受约束则**永远无法完成**

  **MUST NOT**：在菜单里嵌套子菜单（项目无先例，需新造嵌套 `menu` 角色）；把菜单路径耦合进 D15 的瞬态态

  **QA SCENARIOS**
  - `[Test Command]` `⋯` → `Swap with slot…` → 输入 `7` → 回车 → 发出 `SWAP_SLOTS {sourceSlotId: 3, targetSlotId: 7}`
  - `[Test Command]` 输入 `11` / `0` / 非数字 → **不发**消息且给出提示
  - `[Test Command]` 输入等于源槽编号 → **不发**消息且给出提示
  - `[Test Command]` 对照行渲染出 10 项，空槽标 `Empty`
  - `[Test Command]` **焦点回归**：关闭对话框后焦点回到 `⋯` 触发元素

  **证据路径**：`_context-output/evidence/final-qa/T16-*.txt`

---

- [ ] **T17 · `Alt + ↑/↓` 手势**（⚠️ **V1 实测通过后才可开始**）

  **WHAT TO DO**
  - **前置门禁**：**V1**（Windows Chrome 下 `Alt` 的 `preventDefault()` 能否既抑制菜单栏、又保留 `keyup` 交付）**必须先实测通过**；若 `preventDefault()` 连带吞掉 `keyup` → **改方案**（fallback：显式 `Alt+Enter` 提交），本任务按实测结论调整
  - **D11 模型**：`Alt+↑/↓` 移动**交换光标**（不是立即交换）—— 立即交换下连按只能做相邻交换（1↔2 再 2↔3），**无法表达"槽 1 ↔ 槽 7"**；**松开 `Alt`** 才提交
  - **D11 边界环绕**：槽 1 按 `↑` → 末尾槽；槽 10 按 `↓` → 开头槽（否则首尾槽在 `↑` 方向不可达）
  - **D12 生命周期（**仅约束本手势**）**：`Escape` 取消 + **失焦即取消** + **约 3 秒超时兜底**（`keyup` 可能收不到：Alt+Tab 切走、系统级弹窗）
  - **D17 细分**（**矛盾 C2 的裁决**）：**原地未动**（没按过方向键就松开）→ **静默取消**；**环绕到边界**仍按 → 不提交 + **符号+文案提示**（`↑`/`↓` + `Top`/`Bottom`，D25-⑤b）
  - **A9 前置守卫**：armed 前置 = `document.activeElement` 是槽行根 **+** 该行非编辑态 **+** 无 menu 打开；**armed 期间禁止进入编辑态**，进入编辑态即取消 armed
  - **D20**：顺序守卫 —— 空的 `↑/↓` 能力留给既有用途（经核实方向键当前**完全空闲**）

  **MUST NOT**：把手势的失焦/超时约束**施加到菜单路径**（C1 裁决）；把边界提示做成跟随鼠标的浮层（D22：键盘时鼠标可能不在侧边栏）

  **QA SCENARIOS**
  - `[Test Command]` `Alt+↓` ×2 → 光标移动两格 → **松开 `Alt`** → 发出**一次** `SWAP_SLOTS`，目标为移动后的槽
  - `[Test Command]` `Alt` 按下后**原地松开** → **不发**消息、**不出**提示
  - `[Test Command]` 在槽 10 上 `Alt+↓` → 光标回到槽 1（环绕）；再按一次仍在 1 → 出现 `↓ Bottom` 提示且**不发**消息
  - `[Test Command]` `Escape` 取消 / 行失焦 / `advanceTimersByTime(3000)` 超时 → 三种情况均**取消且不发**
  - `[Static Analysis]` **诚实性核对（关键）**：本测试文件**必须**有顶注注释，明确"jsdom 只能证明机制，不能证明菜单抑制"，并**逐字引用** `tests/unit/ui/sidebar-title-commit.test.tsx:17-22` 的措辞模式
  - `[Check]` **反查**：本测试文件内**不得**出现"菜单未弹出 / 焦点未移动 / 因为抑制所以 keyup 到达"类断言（grep 应 0 命中）

  **证据路径**：`_context-output/evidence/final-qa/T17-*.txt`

---

- [ ] **T18 · 视觉：源槽 / 目标槽 / 边界提示 / `grab` 光标**

  **WHAT TO DO**
  - **D21 三处分工**（互不抢通道）：
    - **源槽**：`opacity` 降低（"它正在被搬走"）
    - **目标槽**：`outline` 强调 —— **不动 `background`**（该通道已被 `.tbs-slot-row--bound:hover` 占用，`sidebar.css:172-174`），`outline` 不参与布局且可与 `:hover` 共存。项目已有 `outline` 用法（`.tbs-tag-selector__option:has(input:focus-visible)`）
    - **边界提示**：焦点行旁短促提示（`↑`/`↓` + `Top`/`Bottom`，**锚定焦点行**，不跟随鼠标）
  - **D20 光标**：整行**保持 `cursor: pointer`**（保留"点击激活"信号，`sidebar.css:167`）；**`cursor: grab` 只加在编号 `__number` 上**（该元素当前零交互且 `aria-hidden`，`App.tsx:603`，是唯一不占用既有能力的位置）
  - 类名遵循 BEM 既有规范（`tbs-slot-row__element` / `--modifier`，既有 19 个类）

  **MUST NOT**：用背景色区分源/目标（会与 `:hover` 抢通道，用户无法分辨"鼠标在哪"与"目标是哪"）；用行内文字改变行高（会造成拖拽中途落点漂移）；打磨 outline 动效（Gold-Plating 护栏）

  **QA SCENARIOS**
  - `[Test Command]` 扩 `tests/unit/ui/settings-class-css.test.ts`（**结构断言**，遵循"jsdom 无布局引擎处断言结构"的既有纪律）：
    - 目标槽样式含 `outline` 且**不含** `background` 覆盖
    - 源槽样式用 `opacity`
    - `__number` 上有 `cursor: grab`；行根**仍**是 `cursor: pointer`
  - `[Test Command]` 待定态渲染：源/目标各行带正确类名（结构断言）
  - `[Test Command]` 边界提示在焦点行附近渲染（结构断言），文案含 `↑`/`↓` 与 `Top`/`Bottom`

  **证据路径**：`_context-output/evidence/final-qa/T18-*.txt`

---

- [ ] **T19 · 无障碍**

  **WHAT TO DO**
  - **D26-3**：给 `listitem`（`App.tsx:589-598`）加 **`aria-posinset`** / **`aria-setsize`** —— 使读屏能说"10 个槽里的第 3 个"
    - **⚠️ 自检修正（务必遵守）**：`__number` **保持 `aria-hidden`**，**不要**"让编号进入可访问名" —— 行的 `aria-label` **已是** `Slot ${slotNumber}: ${displayTitle} (${statusText})`（`:597`），编号**本就在可访问名里**；再去掉 `aria-hidden` 会让读屏**念两遍**
  - **D26-1 等价性**：菜单路径 = **完整功能**（选任意编号、可撤销），故**无需**为拖拽补键盘替代
  - **D26-2 瞬态态不播报**：待定交换态是**视觉态**，**不 `aria-live`**（随每次 `↑/↓` 变化，播报会连续打断）；代之以**提交后的结果宣告**（撤销条 `role="status"`，D25-③）与**失败 toast**（`role="alert"`）

  **MUST NOT**：让待定态 `aria-live` 播报（反模式：连按会淹没用户）；给 `__number` 去掉 `aria-hidden`

  **QA SCENARIOS**
  - `[Test Command]` 断言行有 `aria-posinset`（1..10）与 `aria-setsize="10"`
  - `[Test Command]` 断言行的可访问名**仍**含编号且**不重复**（例如名称中 `Slot 3` 只出现一次）
  - `[Test Command]` 待定态**不**产生 `aria-live` 播报元素
  - `[Test Command]` 撤销条 `role="status"`，失败 toast `role="alert"`（沿用既有断言）

  **证据路径**：`_context-output/evidence/final-qa/T19-*.txt`

---

### Wave 6 — `App.tsx` 串行集成段 + UI 测试

---

- [ ] **T20 · `sidebar/App.tsx` 交换集成（串行）**

  **WHAT TO DO**
  - 把 T15–T19 的产物在 `sidebar/App.tsx` 内**接线**：拖拽处理器、`Alt` 手势、菜单入口、视觉类名、a11y 属性
  - **D15 瞬态态**：统一为 `{ source, target } | null`，由**列表级 hook** 持有（落在 `src/ui/shared/use-*.ts`，与 `use-expand-row` 同族）；**拖拽与 Alt 手势是它的两种输入方式**，行通过 props 得知自己是否为 source/target
    - 统一之后 D13 的"`dragstart` 取消武装态"**自动成立**（无需特例代码）
    - **范围澄清**：该状态**不含菜单路径**（C1 裁决）
  - 交换成功后的 UI 反馈：**不发成功 toast**（**D25-④** —— 交换改的正是列表本身，用户立刻看到；既有 `Saved to slot 3` 之所以发，是因为它改的是当前标签页、列表里看不出来）；**失败发** `Failed to swap slots 3 and 7`

  **MUST NOT**：让瞬态态与 `editingTitle`/`editingUrl`/`menuOpen` 出现未定义的共存（A9 已定守卫）

  **QA SCENARIOS**
  - `[Test Command]` 端到端（jsdom）：拖拽 → 列表两行内容对调 → 出现**一条**可撤销条 → 点 Undo → 恢复
  - `[Test Command]` 交换成功**不出现** toast；失败出现 `Failed to swap slots 3 and 7`
  - `[Static Analysis]` `tsc --noEmit` → 0 errors

  **证据路径**：`_context-output/evidence/final-qa/T20-*.txt`

---

- [ ] **T21 · 拖拽 / Alt UI 行为测试**

  **WHAT TO DO**
  - 集成层 UI 测试：完整走通"拖拽 → 发出消息 → 列表更新 → 撤销"，覆盖**四组合**
  - `Alt` 手势集成：武装 → 移动 → 提交/取消（含三项取消路径）
  - **诚实性顶注**：Alt 相关测试文件须有注释说明 jsdom 的证明边界

  **MUST NOT**：断言"菜单未弹出 / 焦点未移动"（jsdom 无此能力，属伪装）

  **QA SCENARIOS**
  - `[Test Command]` 四组合端到端各一条：有↔有 / 有↔空 / 空↔有 / 空↔空（末者**不发**消息，因 UI 已拦截）
  - `[Test Command]` Alt 集成：提交一次、三种取消各一次
  - `[Check]` grep 反查：无伪装性断言，且顶注注释存在

  **证据路径**：`_context-output/evidence/final-qa/T21-*.txt`

---

- [ ] **T22 · 既有测试改写（8 处单数获取 `Undo`，分布于 3 个文件 → 作用域限定）**

  **WHAT TO DO**
  - U1（多条堆叠）会使以下**单数获取**测试抛 "multiple elements" —— 逐处改为 `within(<该条撤销条>)` 限定作用域或按 `id`/文案定位。**共 8 处行号，分布于 3 个文件**：
    - `tests/ui-smoke/tags-section.test.tsx` —— **4 处**：`:151, 220, 223, 253`
    - `tests/unit/ui/dashboard-undo-recipe.test.tsx` —— **2 处**：`:103, 133`
    - `tests/unit/ui/sidebar-result-handling.test.tsx` —— **2 处**：`:148, 150`
  - ⚠️ **不止 `getByRole` 单数**：若既有断言隐含"**恰好一条**撤销条"的语义（如对撤销条容器计数、或断言条内文案唯一），改 `within` **不足以**保留原断言强度 —— 需逐处判断是把断言**收窄到某一条**，还是改为"**至少/恰好 N 条**"。**不得为了变绿而放宽断言**（见 MUST NOT）
  - `tests/integration/worker-orchestrator.test.ts:574-632`：原断言以"**同一个键**"为前提（注释 `:581` 明写 "into the same key"），按新数组形态重述 —— **但必须保留其原意**："过期的旧快照不得删掉更新的快照"
  - `tests/integration/storage-repository-tags.test.ts:5-9`：级联提升版本**恰好 +1** 是撤销原子性的前提，确认改后仍成立

  **MUST NOT**：为了让测试变绿而**放宽断言**（例如把"恰一次"改成"至少一次"）；删除 T34 的原始意图

  **QA SCENARIOS**
  - `[Test Command]` 上述 6 个文件全绿
  - `[Test Command]` 反查：这些文件不再有**裸**的 `getByRole('button', { name: /^Undo$/ })`（无 `within` 限定）
  - `[Test Command]` `npx vitest run` → 全量 0 failed

  **证据路径**：`_context-output/evidence/final-qa/T22-*.txt`

---

- [ ] **T23 · 回归与收口**

  **WHAT TO DO**
  - **回归 1**：`tests/unit/ui/sidebar-slot-doubleclick-no-switch.test.tsx` **必须保持绿** —— 上一轮刚修好的"双击不切换"不得被拖拽/手势破坏
  - **回归 2**：5 个菜单相关测试（`sidebar-modal-a11y` / `sidebar-modality` / `sidebar-slot-menu-delete` / `sidebar.test` / `sidebar-result-handling`）—— 新增 `menuitem` 后回归（盘点显示**未发现** `getAllByRole('menuitem')` 计数断言，风险低，仍需回归）
  - **回归 3**：TTL 硬编码统一后，侧边栏与 Dashboard 的过期行为不变
  - **收口**：确认无遗留硬编码 `5000`；确认 `pendingSwapUndo` **未**被引入（修订文档已作废它）

  **MUST NOT**：跳过任一回归（这三项都是既有能力，属红线）

  **QA SCENARIOS**
  - `[Test Command]` 双击图标/标题/URL → **仍不发** `SWITCH_SLOT`
  - `[Test Command]` 5 个菜单测试 + `sidebar-slot-doubleclick-no-switch` 全绿
  - `[Static Analysis]` grep：`src/` 内无 `pendingSwapUndo`；无裸 `5000`
  - `[Test Command]` `npx vitest run` → 全量 0 failed

  **证据路径**：`_context-output/evidence/final-qa/T23-*.txt`

---

### Wave 7 — 文档一致性

---

- [ ] **T24 · 文档一致性收口**

  **WHAT TO DO**
  - 在主文档 `2026-10-16-slot-drag-swap-design.md` 的 **D18** 处**显式标注作废**（指向修订文档），并修正"§3.3 撤销"段
  - 已在规划期完成的修正**核对一遍**：D17 措辞精化（越界 vs 空槽）已同步至架构层 / 主文档 §4.1 / `decisions.yaml`
  - 实现注释只写**设计未覆盖的取舍**，并**引用决策 ID**（如 `D2` / `D14` / `U5`）；**不**复述设计原文
  - **不新建任何 `.md` 文档**

  **MUST NOT**：新建 md；把注释写成设计复述（Metis Documentation Bloat 护栏）

  **QA SCENARIOS**
  - `[Check]` 主文档 D18 处有作废标记且指向修订文档
  - `[Check]` `decisions.yaml` 中 D17 是精化后的措辞
  - `[Static Analysis]` 本次新增源码注释均可对应到一个决策 ID
  - `[Check]` `git status` 中**无**新增 `.md`（除已批准的 6 份设计/计划文档）

  **证据路径**：`_context-output/evidence/final-qa/T24-*.txt`

---


---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> F1–F4 **全部并行**执行。每项产出证据到 `_context-output/evidence/final-qa/`。

---

- [ ] **F1 · 计划合规审查**

  **WHAT TO DO**：逐条核对 T1–T24 的 WHAT TO DO 是否**全部落地**；核对 §Must NOT Have 的 **12 条护栏**是否**无一被违反**（尤其：未引入通用原语、未新增 `DomainErrorCode`、未扩撤销覆盖面、未把快照塞进 `LocalState`、未伪装人工项）。

  **QA SCENARIOS**
  - `[Check]` 24 个任务逐条对照，产出"已落地 / 缺失 / 偏离"三栏表
  - `[Check]` 12 条护栏逐条给出证据（grep/文件核查）
  - `[Check]` 特别核对 **U1–U7 七项裁决**均有对应实现

  **证据路径**：`_context-output/evidence/final-qa/F1-plan-compliance.txt`

---

- [ ] **F2 · 代码质量与一致性**

  **WHAT TO DO**：检查新代码与既有风格的**一致性**：BEM 类名；注释是否**引用决策 ID** 而非复述设计；是否有**未使用的导出/死代码**；`UndoEntry` 判别式是否被**穷尽处理**（`switch` + `assertNever`）；`sidebar/App.tsx` 中私有 `UndoState` 是否**确实删除**。

  **QA SCENARIOS**
  - `[Static Analysis]` `npx eslint src tests` → **问题数不高于改造前基线**（本轮不得净增）
  - `[Static Analysis]` `tsc --noEmit` → 0 errors
  - `[Check]` `UndoEntry` 的每个 `replay` 分支都有处理，且无 `default` 兜底吞掉新分支
  - `[Check]` grep：`sidebar/App.tsx` 不再有私有 `UndoState`、不再有 `previousSlot`

  **证据路径**：`_context-output/evidence/final-qa/F2-code-quality.txt`

---

- [ ] **F3 · 端到端手工/自动集成核验**

  **WHAT TO DO**：走通**用户真实路径**：
  1. 拖拽交换（四组合）
  2. `⋯` 菜单路径
  3. `Alt` 手势路径
  4. 撤销栈：连续两次操作 → 两条 → **逐条撤销**（验"点第二条撤第二次"）
  5. per-entry 5s 过期

  **QA SCENARIOS**
  - `[Test Command]` `npx vitest run` → **全量 0 failed**（记录总文件数/用例数）
  - `[Test Command]` 专项：连续两次交换 → 2 条撤销条 → 点第 2 条 → 恢复第二次交换（**不是**第一次）
  - `[Test Command]` 专项：一条过期后另一条**仍可撤销**
  - `[Human Check]`（**非阻塞**）**V1 结论**：Windows Chrome 下 `Alt` 抑制与 keyup 交付的实测结果；拖拽光标形态；边界提示可见性

  **证据路径**：`_context-output/evidence/final-qa/F3-integration.txt`

---

- [ ] **F4 · 范围保真度审查**

  **WHAT TO DO**：核对**是否做了不该做的**（scope creep）与**是否漏做了该做的**：
  - 覆盖面对照：`clearShown`/`clearSelected`/`resetEntry`/`handleUnbind`/导入 **仍未**获得撤销（既有 DR3/A8）
  - 未实现："槽位重排" / "多选批量交换" / "交换进快捷键系统" / `pendingSwapUndo`
  - 未扩 `DomainErrorCode`；未新增 `.md`
  - **D2 的已知取舍**（记录 + 目标编号策略）**按设计发生**，未被"顺手修正"

  **QA SCENARIOS**
  - `[Check]` 逐条给"未越界"的证据
  - `[Test Command]` **D2 取舍**的行为断言存在且通过
  - `[Check]` `git status` 无新增 `.md`（除已批准的 6 份）

  **证据路径**：`_context-output/evidence/final-qa/F4-scope-fidelity.txt`

---

## Commit Strategy

> 分 4 个提交，每个**自洽可回滚**；提交信息沿用项目语域（conventional commits + 叙述性正文 + `Verification:` 行）。

**C1 · 撤销栈基础（后台）**
- 范围：T1、T4（`storage-repository.ts` 单键数组化 + 过滤式清理）
- 信息：`feat(undo): store pending undo snapshots as a stack`
- 要点：正文必须写明 `clearPendingUndo` 从"删整个键"改为"过滤后写回"——这是最硬的一处改动；说明宽容读旧单对象

**C2 · 撤销栈基础（契约与 UI 宿主）**
- 范围：T2、T3、T5、T6、T7（`UndoEntry` 模型 + `UNDO_SAVE` 加 `captureId` + `UndoBar` 列表渲染 + 栈语义）
- 信息：`feat(undo): render and resolve a stack of undoable actions`
- 要点：写明 `captureId` 的引入理由（U1 派生：多条各有按钮 ⇒ 必须能指定"撤哪一条"）；写明 `onExpire` 签名为何必须带 `id`

**C3 · 三处 UI 接入**
- 范围：T8、T9、T10（侧边栏 / Tags / Dashboard）
- 信息：`refactor(undo): let every surface share one undo stack`
- 要点：写明侧边栏**同名不同形**的私有 `UndoState` 被消除；写明两份机制（后台快照 vs UI 重放）以 `replay` 判别式调和

**C4 · 槽位拖拽交换**
- 范围：T11–T24
- 信息：`feat(sidebar): swap two slots' contents by drag or keyboard`
- 要点：写明内容/配置边界（D2）及其**已知取舍**；写明空槽是合法内容（D3）与"越界 ≠ 空槽"（A4）；写明跨存储无事务、采用"顺序写入 + 补偿"及其失败边界；写明 `Alt` 手势的实测前置与 jsdom 的证明边界；写明交换的撤销**复用 `UNDO_SAVE`**、由快照判别式 `kind: 'swap'` 承载两槽（Z1），故契约计数 **+1 = 53**

---

## Success Criteria

### Verification Commands

```bash
# 1. 类型与编译期护栏（含 _bidirectional 守卫、messages.test.ts 穷尽 switch）
npx tsc --noEmit

# 2. 全量测试
npx vitest run

# 3. 分层单跑（便于定位）
npx vitest run --project integration tests/integration/slot-service.test.ts
npx vitest run --project unit tests/unit/ui/undo-bar.test.tsx tests/unit/ui/undo-stack.test.ts
npx vitest run --project unit tests/unit/background/known-actions.test.ts tests/unit/shared/messages.test.ts
npx vitest run --project ui-smoke tests/ui-smoke/tags-section.test.tsx

# 4. 回归（本轮刚修好的既有能力）
npx vitest run --project unit tests/unit/ui/sidebar-slot-doubleclick-no-switch.test.tsx

# 5. lint（问题数不得高于改造前基线）
npx eslint src tests
```

### Final Checklist

- [ ] `tsc --noEmit` → **0 errors**
- [ ] `vitest run` → **0 failed**（记录文件数/用例数作为证据）
- [ ] 契约计数 = **53**（仅 `SWAP_SLOTS`；**无** `UNDO_SWAP`），且 `messages-import-export-contract.test.ts` 与此一致
- [ ] 连续两次操作 → **两条**撤销条；**点第 2 条撤销的是第 2 次操作**（`captureId` 生效）
- [ ] 每条撤销条**独立 5s 过期**，一条过期**不影响**其余
- [ ] `clearPendingUndo` **不再清空整栈**（专项测试存在且通过）
- [ ] 交换**四组合**行为符合 D3；`strategy`/`autoBindOverride` **留原编号**（D2）
- [ ] 空↔空 → `changed === false` 且**版本未变**（D17）
- [ ] 越界 → `SLOT_NOT_FOUND`；域内缺记录 → **空槽（合法）**（A4）
- [ ] 版本冲突 → `CONFIG_CONFLICT` 且**两槽均未变**
- [ ] D14 步骤④补偿回滚有测试
- [ ] 拖拽**恰一次** `SWAP_SLOTS`；拖到自身/编辑态行**不发**消息
- [ ] 双击图标/标题/URL **仍不切换**（回归绿）
- [ ] `Alt` 测试**只断言机制**，且顶注注释**逐字引用** `sidebar-title-commit.test.tsx:17-22` 措辞模式
- [ ] `Alt` 测试文件**无**"菜单未弹出/焦点未移动"类断言（grep 0 命中）
- [ ] 行的 `aria-posinset`/`aria-setsize` 存在；`__number` **仍** `aria-hidden`；行名中 `Slot N` **只出现一次**
- [ ] 覆盖面**未扩**：`clearShown`/`clearSelected`/`resetEntry`/`handleUnbind`/导入 仍无撤销
- [ ] 无 `pendingSwapUndo`；无新增 `DomainErrorCode`；无新增 `.md`；无裸 `5000`
- [ ] `eslint` 问题数**不高于**改造前基线
- [ ] **V1** 已实测并有结论（`[Human Check]`，**非阻塞**但必须记录）
- [ ] 24 个任务 + F1–F4 全部完成，证据落在 `_context-output/evidence/final-qa/`

### Definition of Done（用户视角）

- 用户连续做两次可撤销操作 → **两条撤销条并存**，**逐条都能撤**（这是本次改造的用户可见承诺）
- 用户把一个槽拖到另一个槽 → **两槽内容与绑定对调**，符合空槽组合的四种情形
- 用户不改用键盘也能完成交换（菜单 + `Alt` 手势 + 拖拽，三路等价）
- 上述任一操作都可撤销，且**撤销的是用户点的那一条**

---

## Final Verification Wave 结果（F1–F4）+ 编排者处置

| 项 | 结论 |
|---|---|
| **F1 计划合规** | `PASS（带保留）` —— 25/25 任务落地、12/12 护栏实质遵守、关键不变量（A4/A7/D2/D14/Z1/A10/D9/D26-3/U1/V1）代码级验证通过 |
| **F4 范围保真** | `PASS` —— **越界零命中**；U1–U7 与 D2–D7/D9/D13 红线/D14 边界/授权/兜底全部闭合 |

### 编排者已修复的审查发现

| 发现 | 处置 |
|---|---|
| **F1 §6.2（真缺陷）**：新增测试文件带 **12 处 lint 错误**，而"lint 未净增"只覆盖了被编辑的既有文件，**回避了新增文件** | **已全部修掉**。现本轮全部新文件 lint 为 **0**；全仓从 681 回到 **667**（低于改造前基线 669），**净增 0**。修的过程中我曾误引入 2 个测试失败与 2 个 tsc 错误（`--fix` 删掉了一个必要的 `as HTMLElement`；把需要 await 的 `act` 改成同步），**均已发现并修复**，最终 1797 用例全绿 |
| **F1 §6.1（数字不实）**：计划首页写"626 文件"，实际 **183** | **已更正**。**根因是编排者（我）**：自 Wave 1 起一直把 vitest 的 `numTotalTestSuites`（=describe 块数）当"文件数"汇报，执行者是照抄我的口径。已在计划中标注该口径错误及正确取法（`testResults.length`） |
| **F1 §6.3（证据缺口）**：T24 无证据文件 | **已补** `evidence/final-qa/T24-doc-consistency.txt`（四项检查逐条落证） |
| **F4 §7（真缺陷，数组化引入）**：`setPendingUndo` 是 read-modify-write 且**无串行化** → 并发保存会**丢撤销条目**；`clearPendingUndo` 同理（可能让已清理条目复活） | **已修**：新增专用 `pendingUndoWriteQueue` 串行化两者（**不复用 `localWriteQueue`**，以保持快照在 `LocalState` 之外的隔离）。**已补 2 个并发测试，并做假验证**：去掉队列后两条测试**确实变红**（`expected [501] to deeply equal [501,502]` = 丢条目；`expected [601,602] to deeply equal [602]` = 已清理条目复活），恢复队列后转绿 |

### 已登记但**未修**的遗留项（避免静默扩范围）

| # | 遗留 | 影响 | 建议 |
|---|---|---|---|
| **R1** | ~~**UI 与后台的 TTL 窗口**（F4 §7）：UI 的 `expiresAt` 在 **push 时**算，后台在 **capture 时**算，二者相差一个 round-trip → 后台先过期。若用户恰在此窗口点撤销，`restoreSlot` 走"无快照 → 降级 `unbindSlot`"分支，会**静默删除该槽**~~ | ~~⚠️ 潜在数据丢失~~ | ✅ **已修（用户裁决 B）**：`captureUndoSnapshot` 现在把**它自己算的** `expiresAt` 与 `captureId` 一并返回，经 `saveSlot`/`swapSlots` 的 **Response** 回流到 UI（`SaveSlotResponse` / `SwapSlotsResponse` 各加 `expiresAt?`，**Response 侧，不动计数 53**）；UI 改用它，不再本地自算。`swapSlots` 与 `captureUndoSnapshot` 两处各自只算**一次** deadline，成为唯一真相源。**已补测试**（`sidebar.test.tsx`：mock 回传 60s 后的 deadline，断言撤销条跨过本地 5s 仍存活），**并做假验证**：把 UI 改回本地自算 → 该测试**精确失败**，恢复后转绿 |
| ~~**R2**~~ | ~~**D25-② 冲突专属文案未落地**（F4 §6-①）~~ | ~~用户看不到"配置已变化"的专属提示~~ | ✅ **已修（用户裁决 B）**：`handleSwap` 现按 `errorCode === 'CONFIG_CONFLICT'` 分支，给出 `Slot data changed elsewhere. Refresh and try again.`（复用设置页既有措辞），其余失败保留通用文案。**已补测试**并**假验证**：去掉分支后**恰好该条红**，恢复后转绿 |
| ~~**R3**~~ | ~~**D18 的作废未覆盖决策源**（F1 §6-2）~~ | ~~只读决策源会得到已被推翻的结论~~ | ✅ **已修（用户裁决 B）**：`decisions.yaml` 的 D18 改为 `status: SUPERSEDED` + `superseded_by` + 作废说明（含"原否决理由仍有效、只是结论由『另开一键』变为『改造 `pendingUndo` 本身』"）；架构分册 D18 同加作废标记。原件保留为历史记录 |
| ~~**R4**~~ | ~~`getPendingUndo()` 无参重载无生产消费者（F1 §6.5）~~ | ~~计划陈述与实现不符~~ | ✅ **已修（B）**：措辞更正 —— 无参形式**不是 UI 契约**（UI 靠"执行动作时 push"建栈，从不回读），其作用是**把整栈作为整体观察**（测试断言用；将来 drain/repair 路径需要）。已在 `storage-repository.ts` 注释与计划 T1 两处更正 |
| ~~**R5**~~ | ~~`shouldClearPendingUndo` 无参时返回 `true`（清空整栈）~~ | ~~未来误用会清空整栈~~ | ✅ **已修（B）**：加注释说明这是"最后手段的全量清空"，**生产调用方全部传身份**（4 处均传双身份），并明确警告勿无参调用 |
| ~~**R6**~~ | ~~`handleDrop` 的 `JSON.parse` 无 try/catch（F4 §6-③）~~ | ~~跨应用拖入的非本项目文本会抛 `SyntaxError`~~ | ✅ **已修（B）**：`JSON.parse` 包 try/catch，且要求 `slotId` 是**整数**，否则视为"非内部拖拽"并回退到已跟踪的 source。**⚠️ 假验证曾失败**：第一版用 `expect(...).not.toThrow()`，而 React 把处理器异常**报告为 `console.error` 而不向 `fireEvent` 重抛**（用一次性 probe 对故意抛错的处理器实测确认）—— 那个断言在**无防护版下也通过**，是**假绿**。改为断言 `console.error` 未被调用后，假验证成立（去防护 → `not json at all` 那条**精确变红**） |

**遗留清单已清空** —— R1–R6 全部处置完毕。

### R7（用户报告，已诊断并修复）—— 交换成功却报 `CONFIG_CONFLICT`

**症状**：两个槽的数据**已经切换了**，却弹出 `Slot data changed elsewhere. Refresh and try again.`

**诊断（实测，非推测）**：一次手势发出了**两条** `SWAP_SLOTS`。

- **并发探针**（真实 orchestrator，两条请求同时发出）复现为：`r1=true/none | r2=false/CONFIG_CONFLICT` —— 第一条写入成功（数据确实换了），第二条的乐观版本检查失败（弹提示）。
- **UI 探针**（同一批内派发两个动作）证实**三种双动作都真的发 2 条**，去掉守卫后：
  - 两次 Enter（按住键的 repeat）→ `sends=2`
  - Enter + 快速点击 `Swap` → `sends=2`
  - 双击 `Swap` → `sends=2`

**根因**：`submitSwapTarget` 无任何防重复保护。`closeSwapDialog()` **拦不住** —— 它只是安排一次状态变更，两个调用在那之前**都已执行完毕**。

**修法**：`swapSubmitRef` 在发送**之前同步置位**；`openSwapDialog` 时复位（保证失败后仍可真正重试）。四种双动作现均为 `sends=1`。

**⚠️ 我在验证方法上失败了两次，如实记录**：

1. **第一版测试是假绿**：我连续调用 `fireEvent.keyDown` 三次并断言只发一条 —— 去掉守卫后**仍然通过**。原因：`fireEvent` **同步刷新 React 状态**，第一次 Enter 后输入框已被卸载，后续事件落在**已卸载节点**上、不再触发 handler。**双提交根本没被复现。**
2. **修正方法是把事件放进同一个 `act()` 批次**，这样 React 来不及重渲染。如此才真正复现（去守卫 → `sends=2`）。正式测试已按此写法，并在注释中写明"分散派发是假绿"这一陷阱，防止后人改回去。

**这与 R2 的关系**：R2 只修了**文案分支**，未触及**为什么会失败**。用户报告的提示本身正是 R2 新增的那句 —— 也就是说 R2 让这个既有缺陷**第一次变得可见**（此前所有失败都显示通用文案，症状不易识别）。

### R8（用户报告 3 个问题，已全部诊断并修复）

**问题 1「第一次交换没有撤销弹窗」+ 问题 2「切换多次后偶发 Failed to swap slots，但数据已切换」—— 同一根因**

`handleMessage`（`worker-orchestrator.ts`）的**响应计时在 `ensureReady()` 之前启动**，所以 **service worker 冷启动耗时被算进第一个动作的预算**：

- 首次交换最慢 → 超预算 → 回应 `TIMEOUT`
- 而 `:507` 的注释明确写着「**a write that overruns is NOT cancelled**」—— **写入已完成、却上报失败**
- 于是：**数据换了**（问题 2 的 toast）+ **没有 `captureId`**（失败响应不带）→ **不入栈 → 没有撤销条**（问题 1）

**实测证据**：UI 探针对比四种响应形态 —— 扁平 `bars=1`、包装 `bars=1`、**`TIMEOUT` `bars=0`**、无 `expiresAt` `bars=1`。

**修法（两处）**：
1. **把预算改为"worker 就绪后才启动"**：`ensureReady().then(() => { budget(); return routeMessage(...) })`。预算是用来约束**动作**的，不是约束 worker 启动的；`ensureReady()` 幂等且首次之后极廉价，因此不削弱"动作卡死也不会让 UI 永等"的保证（既有 `TIMEOUT` 测试仍通过）。
2. **UI 对 `TIMEOUT` 改说"未知"而非断言失败**：提示 `The swap is taking longer than expected. The list has been refreshed — check whether it applied.` 并重读状态 —— 不再声称一个它看不到的失败。

**问题 3「按住 Alt 几秒后光标自动弹回原槽」**

`SWAP_GESTURE_TIMEOUT_MS = 3000` 是"`keyup` 永不到达"的兜底，但**只在 arming 的 keydown 处装载一次、从不刷新**。用户按住 Alt 思考/浏览超过 3 秒，手势就被取消，pending target 消失、光标像是弹回起点。

**修法**：抽出 `armTimeout()`，在**每次方向键按下**时重设 —— **活动是手势仍活着的正面证据**，只有真正的**空闲**才结束它。

**⚠️ 一条既有测试曾钉住旧行为**：`sidebar-slot-alt-gesture.test.tsx` 的"~3s timeout is the backstop"断言 ArrowDown 后**不活动 3 秒**触发清理。我的改动**仍满足它**（ArrowDown 后确实无活动），9/9 全绿；同时**新增**一条"交替按方向键 + 2s 间隔（累计 8s）不得取消、松开必须提交"的测试来锁住新行为。

**三个修复均经假验证**：
- 问题 3：去掉 `armTimeout()` 重设 → 新测试**精确变红**，既有 8 条仍绿
- 问题 1/2：恢复"计时器先启动"的旧顺序 → 冷启动测试**精确变红**（`success: false` = `TIMEOUT`），既有 41 条仍绿

**测试方法论上我又失败过一次并已记录**：冷启动测试第一版让初始化耗时 `RESPONSE_TIMEOUT_MS + 500`（10.5 秒），**撞上 vitest 的 5 秒默认超时**（报"Test timed out"而非断言失败）；第二版改成 60ms 冷启动，又**小于 10 秒预算因而无法区分修复前后**。最终用 **fake timers** 让冷却时间在**虚拟时间**上超过真实预算，才既快又有效。

### R9（主动排查，用户"继续修"）—— 双提交缺陷不止交换一处

R7 只给**交换弹窗**加了防重复守卫。主动排查同源风险，发现**两个更严重的同类缺陷**：

| 位置 | 后果 | 修法 |
|---|---|---|
| **`handleSave`（Save 按钮）** | **实测双击发 2 条 `SAVE_SLOT`**。比交换更严重：`SAVE_SLOT` **会捕获撤销快照** → 两个快照、两条撤销条，且第二次把第一次**记为"覆盖自己的保存"** | 按槽位的在途集合 `saveInFlightRef`（不同槽位仍可并行），`finally` 释放 |
| **`handleUnbind`（删除）** | 确认框 `onConfirm` **异步关闭**，可对一次确认触发两次 → 2 条 `UNBIND_SLOT`。**删除是唯一不可撤销的破坏性操作（DR3）** | 同款 `deleteInFlightRef`，`finally` 释放 |

**同时确认这些点无需保护**（重复执行幂等、不捕获快照）：`SWITCH_SLOT` / `NEXT_MATCH_SLOT` / `PREV_MATCH_SLOT` / `UPDATE_SLOT_URL` / 侧边栏各 `SET_TAB_OVERRIDE`；设置页的四处提交点**已有 `setBusy` / `setBatchProcessing` 守卫**。

**两条修复均经假验证**：
- Save：去掉 `saveInFlightRef` → `a double-clicked Save sends exactly ONE SAVE_SLOT` **精确变红**（另一条 12 条仍绿）
- 删除：去掉 `deleteInFlightRef` → `sends UNBIND_SLOT exactly once for a double-confirmed click` **精确变红**
- 两条守卫都有**反向测试**（失败后必须仍可重试）

**测试环境上我踩了两个坑，均已查明并记录**：
1. `sidebar.test.tsx` 的 T8 describe **不调 `vi.clearAllMocks()`**，所以 `mockSendMessage.mock.calls` **跨测试累积** —— 我第一版断言用了它，量到的是**整个文件**的调用数（`length 4`）而非本测试的。改用该套件自带、每测试重置的 `savedCaptureIds`。
2. 删除的确认框有 **~120ms 防误触窗口**（`Confirm` 的 CT3-b4 保护），测试必须 `flushConfirmGuard()` 先等过去 —— 我最初的探针没等，导致 `UNBIND_SLOT` 一次都没发出，我一度误以为守卫无效。

### R10（用户复报问题 1+2 仍存在）—— **前两次修复都不完整，根因与之前判断不同**

用户复报后重新诊断，发现我对两个问题的判断**都错了**：

**问题 2 的真因：`focusout`，不是我猜的"空闲超时"**

`useSwapPending` 用 `document` 上的 **`focusout`** 作为取消触发器。它在**任何元素**失焦时都会冒泡 —— 包括用户在槽位行之间移动、点击任意位置、以及**方向键改变焦点**。用户按住 Alt 浏览时，一次 `focusout` 就把手势杀掉，光标随之弹回。**R9 那次"每次方向键重设计时器"完全没有针对这一点**，所以问题依旧。

**修法（三处，缺一不可）**：
1. **`focusout` → `window` 的 `blur` + `document` 的 `visibilitychange`**。只有"页面真的看不到键盘了"（Alt+Tab 是最典型的丢失 `keyup` 的方式）才算结束；元素级焦点变化不再作数。
2. **`SWAP_GESTURE_TIMEOUT_MS`：3000 → 300 000（5 分钟）**。既然 V1 已实测 `keyup` 可靠、`blur`/`visibilitychange` 覆盖了真实丢失场景，这个计时器只剩"OS 级拦截且窗口不失去焦点"的极端残余 —— 它是**安全网，不是 UX 边界**，必须长到正常使用中永不触发（用户按住 Alt 想一分钟是合理的）。
3. **移除了我一度加入的 `!e.altKey` 启发式**：我原本想用"`altKey === false` 证明 Alt 已松开"来替代计时器，但**没有证据表明所有浏览器在按住 Alt 时都会在方向键事件上报告 `altKey: true`**。把一个无证据的启发式放进取消路径，可能让问题**更糟**（方向键一按就结束手势）。**主动撤掉了**。

**问题 1 的真因：`PENDING_UNDO_TTL_MS` 与 `UNDO_DEFAULT_MS` 都是 5000，而我 R1 的"修复"放大了它**

R1 让 UI 使用**后台的** `expiresAt`。后台在 **capture 时**打时间戳，响应再经一个 round-trip 回到 UI —— 于是 **round-trip 被算进了用户的 5 秒观看时间**。首次操作最慢（service worker 冷启动），撤销条到达时几乎已过期或根本没有。**R1 把"UI 自算 5 秒"换成了"用后台剩余时间"，正是它让这个既有隐患在首次慢启动时爆发。**

**修法（两处）**：
1. **`PENDING_UNDO_TTL_MS`：5000 → 20 000**。后台**保留期必须长于 UI 显示期**，否则慢响应必然吃掉用户的时间。worker 只是个 lazy 有效性检查，留长无副作用。
2. **UI 用 `Math.min(now + 5s, worker 的 expiresAt)`**：给足**从条出现起算的完整窗口**，同时**永不超出** capture 的有效期（保留 R1 的原始目标：防"条还可见但快照已失效 → 静默删槽"）。

**新增断言**（防止再次悄悄退化）：`PENDING_UNDO_TTL_MS > UNDO_DEFAULT_MS` 被**写成测试**，而不是留在注释里 —— 这个关系一旦反转，慢响应的撤销窗口会再次丢失。

**⚠️ R10 的诊断过程里我犯了一个方法论错误并已修正**：那条"慢响应仍给足 5 秒"的测试，mock **硬编码了 `workerTtl = 5000`**（已作废的配置），所以它模拟的是一个**不再存在的世界**，在正确实现下反而变红。改为**引用真实常量**，让它随配置演进。

### R23（用户裁决）—— **save 不污染链上的 slot 节点**，只有显式修改才赋值（已实现）

用户原话：「save 到槽位，不能污染图标/标题 override > slot > rule > site 链的 slot 节点，因为图标/标题用户并没有修改，**只有通过图标/标题修改操作后才能在 slot 节点赋值**」。

**实现**：`resolveSlotTier` 的槽位值**只来自 `uiMarker`**；save 时的 `titleSnapshot` / `faviconSnapshot` **不再作为槽位值**（它们是"保存那一刻页面显示了什么"的记录，不是用户的定制）。保留一处退让：**marker 存在但协议不可用**时回退快照 —— 那是对"用户设了个坏值"的兜底，marker 缺失时**不会**触发。

**关键：受影响的既有测试是"装置"问题，不是"意图"问题。**

9 条测试红，它们**测的都是"槽位优先于规则"这个仍然成立的意图**，只是用**快照当载体**。我**保留其意图、更换其装置**（改用 `uiMarker` 承载），逐一处理：

| 测试 | 处理 |
|---|---|
| `rule-service.test.ts` ×3（favicon 协议白名单） | `seedSlot` 改把值放进 `uiMarker.icon` —— 否则槽位为空，协议校验会**空洞通过** |
| `rule-apply-persistence.test.ts` ×3 | `seedSlotBinding` 改走 marker |
| `rule-delivery-robust.test.ts` ×1 | 同上 |
| `sidebar-slot-tier-display.test.tsx` ×2 | fixture 的 `BOUND_SLOT` 改走 marker |

**假验证（这一轮最关键，因为改装置最易造成假绿）**：把槽位层的 title 强制为 `null`（等于禁用该层），**7 条精确变红** —— 证明换过装置的测试**仍在真实测量槽位层**，没有退化成"其实在测规则"。

**我此前两次判断错误，均已纠正**：先误判快照回退为"污染"并删掉测试（R22）；在用户明确语义后，才找到**正确的做法是更换装置而非删除测试**。

### R22（验收缺陷）—— `Add to Global Rules` 对已绑定槽位无效 / Dashboard 不展示受 rule 影响的 tab（**诊断完成**）

用户报告两点，且**第 2 点明确指出"链上有记录但 Dashboard 不展示"**，我据此做了完整取证。

**被既有测试保护的设计（关键，我先搞错了）**

`tests/integration/rule-apply-persistence.test.ts:157` 的测试组名是 **"Slot priority tier (current page beats rule)"**，用 `uiMarker: {}` + `titleSnapshot`（即**只有 save 时的快照、没有自定义 marker**）播种，并断言：

```ts
// Slot value wins over the rule value.
expect(payloads.some((p) => p.title === 'Slot Custom Title')).toBe(true);
expect(payloads.some((p) => p.title === 'Rule Low Priority')).toBe(false);
```

即：**快照本身就让槽位层赋值并压过规则，这是刻意设计**。`rule-service.test.ts` 的三条 favicon 用例（`https:` / `http:` / `data:image/png` 通过 `faviconSnapshot` 播种，断言被允许）同理。

**我走错的方向（已回退，如实记录）**

我最初判定 `resolveSlotTier` 用 `customTitle || titleSnapshot` 是"污染"，改为"只有 marker 才算值"。**这让 9 条既有测试变红**（3 条 `rule-service`、1 条 `rule-apply-persistence`、1 条 `rule-delivery-robust`、2 条 `sidebar-slot-tier-display`、2 条 `rule-apply-persistence`），其中 `rule-service` 的 3 条**看起来与我的改动无关**——正是它们让我去查证，才发现设计意图。**链已完全回退到原状。**

我另外删掉了自己刚写的 `field-chain-snapshot.test.ts` —— 它编码了**我的错误假设**（"快照不该压过规则"），而不是事实。**测试不该为我的判断背书。**

**保留的改动（Dashboard，既有测试零回归）**

`buildDashboard` 的**覆盖判定与行判定不一致**：行只在有 `uiMarker` 时生成，但 `coveredTabIds` 把**所有 binding** 都算作已覆盖。后果是**一个 tab 既没有槽位行、又被排除在 rule-hit 之外 → Dashboard 上完全没有它**。这与你第 2 点描述的现象一致，且与"快照压过规则"是**两个独立问题**。

改动：覆盖集只含**真正设置值**（有 `uiMarker`）的槽位绑定，与行判定使用同一谓词。

**仍需你裁决的部分**

第 1 点（rule 对已绑定槽位无效果）**不是 bug，而是刻意设计**——"save 到槽位 = 这个页面显示这个"。若你希望**规则能覆盖已有槽位快照**，那是**产品语义变更**，需要同时改 `resolveSlotTier` 与那 5 条保护该行为的测试，并明确：**用户显式保存到槽位后，规则是否应当改写它？**

### R21（用户要求）—— **删除与重置类操作接入撤销**（三档全部实现，A7/A8 不做）

用户裁决：维持 5 秒窗口、保留「确认 + 撤销」双保险、去重冲突提示「已存在同 URL 规则，未恢复」、**三档全做**。

**档0（12 处，零后台改动）** —— 复用 `tab-override` / `slot-marker`：
当前页标题/图标重置、图标覆盖（sidebar）；槽位图标重置、层级清除、Clear this layer；Dashboard 单条重置、Clear Shown、Clear Selected（**批量为一次 push**，用户按的是一个按钮）。

新增 `snapshotOfOwner` / `snapshotRow`，**写前从 store 读原始值**。图标必须走 `iconSourceForOwner` 取**原始 `IconSource`** —— 用链上物化值会把配方**永久压平为位图**（FIX-A）。

**档1（`rule-enabled`）** —— 重放写**绝对值**而非取反：取反会反转撤销那一刻的状态，把中间的编辑反向覆盖。`RulesSection` 此前**无 `undoStack`**（规则是唯一「全 CRUD 却零撤销」的域），现已建立并渲染 `UndoBar`。

**档2（两个删除）**：
- **`UNBIND_SLOT`**：删除前 `captureBeforeOverwrite`，`captureId` 回传，**复用 `UNDO_SAVE`** —— `restoreSlot` 的 `single` 分支本就是泛化槽恢复，故 **DR3「删除需净新增后台 action」的前提不再成立**。
- **`DELETE_RULE`**：`RuleDeleteSnapshot` 走响应**侧信道**（与 `DELETE_TAG` 同形），新增 **`RESTORE_RULE`**，**id 原样写回**（`addRule` 不重写 id；`tagIds` 挂在规则上，换 id 会孤立全部标签关联）。

**顺手修掉一个我引入的隐患**：`restoreSlot` 无快照时降级删除，而 `unbindSlot` 现在会捕获 —— 那会**在撤销内部再 arm 一条撤销**。抽出 `removeSlotAndBinding`（不捕获）供回退路径使用。

**去重冲突**：`addRule` 按 **urlMatch** 去重（非 id），所以用户重建同 URL 规则后撤销会失败。`restoreRule` 返回 `ALREADY_EXISTS`，重放把它**转成抛错**，host 的 catch 显示「已存在同 URL 规则，未恢复」——**而非静默报告成功**。

**两道契约守卫按设计触发并被更新**：`messages.test.ts` 的穷举 switch、`messages-import-export-contract.test.ts` 的 `KNOWN_ACTIONS ↔ declared` 双向计数（53 → 54）。

**假验证**（各自精确变红）：禁掉 `pushClearUndo` → 档0 两条红；破坏 id 复用 → 档2 的 id 相关两条红。

**lint**：本轮我引入的 **7 处**新增行 lint **全部定位并修完**（未推给"既有基线"），回到 664。

**提交**：`5399b46`，已推送至 `origin/main`（`rev-list` 核实 `0 0`）。

### R20（用户裁决 **B**）—— 编辑状态**随数据迁移**（已实现）

用户选 B：编辑状态应随数据一起移动到目标槽。

**前提：编辑状态必须提升到列表层。** 它原本在**每行的 `useState`**（`editingTitle`/`titleDraft`/`editingUrl`/`urlDraft`/`urlMatchType` 等），**父级读不到就无法迁移** —— 一个 swap 只是让两行用同样的槽号重渲染，各行仍会继续编辑自己原来那个号。所以：

- 新增 `export type SlotEdit`（`slotId` + `kind` + `draft` + `initial` + `matchType`），**`slotId` 是整个设计的核心**：它指明草稿属于**哪条记录**，而不是哪个位置。
- 行变为**受控**：`edit` / `editToken` / `onEditStart` / `onEditDraft` / `onEditMatchType` / `onEditCommit` / `onEditCancel` / `onEditReset`。
- 行的 `editingTitle` 等别名改为「这个编辑**且属于本槽**」，于是 swap 只需改 `edit.slotId` 即可把编辑器交给另一个号。

**迁移方向（最容易搞反的地方）**：`handleSwap(a, b)` 把 **b 的记录放到 a**，所以原本属于 `a` 的编辑，现在描述的是**坐在 b 的记录** → `slotId` 由 `a` 改为 `b`。**草稿不动** —— 它是用户的未保存工作，本身和含义都没变，变的只是前面的那个号。

**只在 `result.changed === true` 时迁移**（空↔空不写入任何东西，什么都没动，编辑器必须留在原处），且**在写入确认成功之后、`loadState()` 之前**执行 —— 这是本特性唯一可能把草稿落到错误记录上的路径，因此不给它留窗口。

**A9 守卫必须收窄（不是删除）**：旧规则是「任一内联编辑器打开就拒绝交换」，理由是编辑器**按槽号**提交。现在内联编辑器不再那样工作，因此**不再是拒绝理由** —— 但**图标编辑器仍是**：它是**捕获了裸 slotId 的模态**，在其下交换会把图标应用到错误的号。所以守卫改为只拦图标模态（新增 `iconEditorOpen` prop 传入行）。**删除会丢掉真正的保护，只是收窄。**

**顺带断开的顺序耦合**：`handleSlotEditCommit` 需要两个写入口（`handleSlotEditTitle` / `handleUpdateSlotUrl`），而它们声明在 `handleSwap` **之后**。用 `writeSlotEditRef` 与 `migrateSlotEditRef` 两个 ref 接线，每次渲染重新指向 —— 否则会形成"提交依赖后声明的处理器"的循环。

**一条既有测试红并被改写**：`dropping onto a row that is being edited sends nothing` 断言的正是**被取代的旧行为**。改写为断言新契约：交换**发生**、草稿**随之迁移**（在槽 3 的输入框里仍是 `Renamed one`，槽 1 的输入框消失）。

**假验证**：移除 `migrateSlotEditRef.current(...)` 调用 → 那条改写后的测试**精确变红**。

### R19（验收反馈）—— ①文案调整（已完成）；②编辑状态归属（用户已裁决 B，见 R20）

**① 文案**（已完成）：标签 `Swap` → **`Swap data`**（两词，且第二词点明是**数据**而非槽位本身 —— "swap with" 单看像是交换**按钮**）；输入框保持 1 词（`Slot #`）；按钮保持 1 词（`Swap`）。`title` 同步为 `Swap this slot's data with another slot (number, or a name)`。

**② 编辑状态归属 —— 已定位，但需要裁决后才动手**

**代码里早有一条设计决策 A9**（`App.tsx` 拖拽守卫的注释原文）：

> 编辑中的行**不能作为交换的来源或目标**。它的编辑器**按槽号提交**，所以它发起的交换会把草稿落进一个**已经移动**的记录里。

**拖拽路径实现了这条守卫**（`:848` 源、`:870` 目标、`:905` 落点，三处都查 `isEditing`）。
**菜单路径完全没有检查 `isEditing`** —— 这是**既有的不一致**，也正是用户遇到的入口。

**用户期望**：编辑状态**随数据一起移动到目标槽**（即"编辑跟随数据"）。
**这条决策说**：应当**拒绝**编辑中的槽参与交换。

两者**互斥**，且都能修好症状。我不替用户裁决，因为"编辑跟随数据"会让**草稿与正在输入的那个值的关系改变**（用户正在改的是"槽 1 的标题"还是"那条记录的标题"，语义不同），而"拒绝"是产品决策。

**已向用户提出的三个选项**：
- **A. 拒绝**（与 A9 一致，成本最低）：`isEditing` 的行**不能**作为交换的源或目标；从 `⋯` 菜单发起时该控件禁用并给出提示。
- **B. 跟随**（用户明确期望）：交换成功后，把编辑状态与草稿**迁移到目标槽**；需要处理草稿在迁移途中是否仍有效、以及哪个槽该显示"未保存"的视觉提示。
- **C. 迁移前先提交**：交换成功时把当前草稿**提交到它所描述的那条记录**，再迁移编辑态。

### R18（验收缺陷）—— 点击交换输入框会**跳转到该槽绑定的标签页**

**根因**：槽行有 `onClick={handleClick}`，而 `handleClick` 会**延迟**（双击间隔，约 500ms）调用 `onSwitch(slotNumber)` —— 延迟是为了让双击成为"编辑"。交换输入框是**行内元素**，点击**冒泡到行** → 约 500ms 后跳转到该槽绑定的 tab，用户正在输入时被拽出侧栏。

`⋯` 菜单里 `Clear Slot Data` / `Edit URL…` 等条目**各自** `stopPropagation`，但输入框、`Swap` 按钮、悬浮候选列表是普通元素，没有。

**修法**：在 `handleClick` 顶部用**单一权威**判断 —— `menuRef.current?.contains(e.target)` 为真则取消待激活并返回。比逐个元素加 `stopPropagation` 更可靠：一处覆盖整个菜单（含日后新增控件），不会像逐元素守卫那样被漏加。

**实测澄清了一件事（探针在"有守卫"与"无守卫"两种状态下各跑一次）**：

| 动作 | 无守卫时是否跳转 |
|---|---|
| 点击输入框 | **是**（`fieldSwitches=1`）← 报告的缺陷 |
| **仅** `click` Swap 按钮 | **是**（`buttonSwitches=1`） |
| `mousedown` + `click` Swap 按钮 | **否**（`mdClickSwitches=0`） |

**原因**：按钮/候选行的提交在 `mousedown`，它**先关闭菜单并卸载**这些元素，随后的 `click` 落在**孤立节点**上、不再冒泡。**这是排序的副产物，不是设计** —— 所以守卫**不依赖**它（注释里明确写了：一旦把提交改到 `click`，每次选目标都会触发跳转）。

**我删掉了一条自己写的噪音测试**：`Swap 按钮不激活行` **在有无守卫时都通过**（因为按钮靠卸载自保）—— 一个永远不会失败的测试不是守卫。**探针是唯一能区分"守卫覆盖了它"与"测试看不见它"的手段。**

**假验证**：移除菜单守卫 → `clicking the swap field does NOT activate the row` **精确变红**（同时证实该缺陷真实存在过）。

### R17（用户要求）—— 恢复菜单原宽、输入框收窄、**不自动聚焦**

1. **"更多菜单的宽度需要恢复为原来的大小"** —— 根因是**我加的 `min-width: 250px`**。菜单本身只有 `min-width: 160px`（由最长条目 "Add to Global Rules" 决定），是我的控件把它撑宽了。**移除该 `min-width`** 即恢复。
2. **"可以把输入框的宽度缩小，因为输入需要填写最多两个数字"** —— 输入框改为 `flex: 0 1 3.5em`（约两个数字加共享内边距）+ `min-width: 0`（`min-width: 0` 才是真正允许压缩的属性：flex 项的自动最小尺寸默认是内容宽度，会把行顶开）。标签从 `Swap with` 缩为 `Swap`，占位从 `Slot number or name` 缩为 `Slot #`。
3. **"不能一开始聚焦到 swap 输入框"** —— 删除挂载时的 `useLayoutEffect` 自动聚焦。理由（写进注释）：`⋯` 是**七个动作**的菜单，用户还没选；一个在交换输入框里闪动的光标**回答了他们还没问的问题**，读起来像菜单擅自做了决定。聚焦改为**用户点击输入框或 Tab** 时发生 —— 那也正是候选列表出现的时刻，**披露与意图因此同步**。

**空间核算（用真实 token，不估）**：`space-xs=4`、`space-sm=8`、`font-xs=11`、`font-sm=12`。行内固定开销 ≈ 标题 35 + 输入框内边距 20 + 边框 2 + 按钮内边距 16 + 字号 24 + 间距 8 ≈ 105px。菜单自然宽 160px → **输入框分得约 44px**，容纳"两个数字"足够；`min-width: 0` 保证更窄的侧栏下它继续让位，而不是把按钮挤到第二行。

**完整措辞不丢**：占位缩短后，完整含义同时存在于 `title` 属性**与可访问名称**中，所以短占位只是提示、不是标签。

**假验证两条，均精确变红**：
- 恢复 `min-width: 250px` → 样式守卫 `keeps the swap control on one row and floats its candidate list` 变红（我用「断言该属性**不存在**」的方式守住了这条回归）
- 恢复挂载自动聚焦 → `shows the swap control on open, in ONE row, WITHOUT stealing focus` 变红

**⚠️ 假验证中我又出了一次错**：第一次注入自动聚焦时我建了 ref 但**忘了把它接到 `<input>` 上**，那样注入**不会生效**（测试不会红，我会误判"守卫无效"）。发现后补上 `ref={fakeRef}` 才真正复现。**这是第二次"验证工具本身没被验证"**（上次是 CRLF 导致 CSS 注入静默失败）—— 已作为教训记录：注入回归后必须确认它确实改变了行为。

### R16（用户要求）—— 候选列表**仅在聚焦时**显示，且**窄于菜单**

1. **"输入框聚焦的时候才展示候选列表"** —— 常开的列表会盖住菜单自己的条目，对"我只是来点 Clear Slot Data"的用户是干扰。加 `focused` 状态门控（`onFocus`/`onBlur`）。
2. **"候选列表的宽度需要比更多菜单的宽度小，不能覆盖菜单选项"** —— 且**不能盖住其它菜单选项**。

**关键：我上一轮的锚点选错了。** 面板原本锚定在**控件行**（`position:relative` 在该行上），于是它从行底垂下、**正好盖住紧邻其下的菜单条目**。改为**锚定整个菜单**：
- 组件改为返回**片段**，让控件行与面板成为**菜单的两个兄弟子元素**
- 列表 `top:100%` 因此相对**菜单**而非行 —— 面板整体落在菜单盒子**之外**
- 宽度 `60%` + `max-width:190px`，并靠**右**对齐（菜单 `right:0` 的延伸方向），所以它不会跑到侧栏之外

**⚠️ focus 门控的经典陷阱（参考实现已踩过并留了注释）**：点击候选项时 `mousedown` 先触发 **blur** → 列表卸载 → 点击落空。`TagExpressionInput` 的注释原文：

> `onMouseDown` + `preventDefault`, not `onClick`: a click moves focus out of the field first, which closes the popup (blur) before the click lands — the classic combobox "the item is gone by the time I click it" bug.

**照做**：候选项与 `Swap` 按钮都改用 `onMouseDown` + `preventDefault`。这也让两条既有测试（用 `fireEvent.click`）需要跟上 —— 它们失败是**测试没跟上实现**，不是缺陷。

**假验证两轮，其中一轮我自己出了错**：
- 注入"去掉 focus 门控" → `shows the candidates only while the field has focus` **精确变红** ✓
- 注入"宽度改成 100%"，**第一次没红** —— 我的 node 脚本按 `\n` 匹配，而文件是 **CRLF**，注入**静默失败**（脚本却打印了注入成功）。改用 `replace_in_file` 重新注入后才精确变红。**这条教训与 R6 的假绿同类：验证工具本身也要被验证。**

### R15（用户要求）—— 交换控件：**一步到位**、**一行内**、**候选悬浮**

R14 的初版仍有两处不合要求，用户明确指出：

1. **"要一步到位，而不是用户点了一次才展示输入框"** —— 初版是 `Swap with slot…` 菜单项，点击后**才**展开输入框，常用路径变成两次点击。
2. **"排版需要控制在一行以内展示所有内容和控件"** —— 初版是标题、输入行、列表、分页四层纵向堆叠。
3. **"候选列表需要悬浮展示，而不是内嵌到菜单选项里"** —— 初版的列表是**内联**文档流，因此**用户每打一个字，菜单下方条目都会被推着位移**。

**修法**：
- **删掉 `swapPickerOpen` 状态与 `openSwapPicker`/`closeSwapPicker`**：控件行**常驻菜单**，打开 `⋯` 时输入框**已经聚焦**（`useLayoutEffect`），一次点击即可输入。
- **一行布局**：`.tbs-slot-swap { display:flex; flex-wrap:nowrap; position:relative }` —— 描述、输入框、按钮同排。`nowrap` 是关键：窄侧栏下**挤压输入框**而不是把按钮挤到第二行。
- **候选列表悬浮**：`.tbs-slot-swap__list { position:absolute; top:100% }`，锚定在该行底部。面板**脱离文档流**，所以输入时菜单条目**不再位移**。分页提示改为列表的**最后一项**（在浮动面板内，且 `aria-hidden`，因为它是状态陈述而非控件）。
- **Escape 语义简化**：只清空缓冲，**不再**关闭控件（控件不再"展开"，无需收起）。菜单自身的 Escape 仍关整个菜单。

**测试**：`openSwapPicker()` 简化为"打开菜单"；新增"无额外点击即可见"与"候选列表悬浮"两条；Escape 测试改写为"清空缓冲且菜单不关"。

**⚠️ jsdom 不加载外部 CSS**，所以 `getComputedStyle` 拿到的 `position` 是空串 —— 我第一版悬浮断言因此失败。**改为把布局断言放进样式守卫 `shared-component-styles.test.ts`**（该文件既有先例就是读 CSS 文本做正则断言，如 `tbs-source-popover` 的 `position: fixed`）。这条教训与 R6 的"假绿"同类：**测试必须能真正观察它声称观察的东西**。

**假验证成功**：把 `position: absolute` 改成 `static` → 样式守卫中 `keeps the swap control on one row and floats its candidate list` **精确变红**（另 8 条仍绿）。

**lint**：我改动的四个文件**新增行零 lint**（脚本按 `git diff -U0` 行号交集核对）。全仓 662 → 665 的差额**不在我改动的文件里**，属既有文件因行号位移而暴露的命中，未顺手改动（超出本次请求范围）。

### R14（用户要求）—— `Swap with slot…` 从**弹窗**改为**菜单内搜索选择器**

**原实现**：菜单项打开一个模态 `Dialog`，里面是**纯数字输入框**（外加十行参考列表）。

**新实现**（用户指定）：**菜单项就地展开**一个选择器 —— 描述文案 + 搜索输入框 + 按钮 + 候选列表，**每页 5 项**、**支持翻页**、**快捷键 `-` / `=`**，交互参考 `Page Rewrite Rules` 的 `Filter by tags` 输入框。在输入框按 **Enter** 或点击旁边的按钮即执行交换。

**参考实现的既有先例（严格遵循，不臆造）**：`TagExpressionInput`
- `-`/`_` 后退、`=`/`+` 前进（接受 Shift 变体，因为多数键盘布局就此产生这两个字符）
- ↑/↓ **页内**环绕（跨页会让列表在用户未要求时滑走）
- Enter 提交**高亮项，否则首条候选**
- 翻页时**清除高亮**（高亮是"页内位置"，跨页后指向用户没见过的行）
- `role="combobox"` + `aria-activedescendant`（焦点必须留在输入框，否则无法继续输入）
- Escape 清空缓冲；缓冲已空时则退出

**我做的两处刻意的偏离**：
1. **每页 5 项**（用户指定），而参考是 8 项。**没有复用同一个常量** —— 两个数字是对**两个不同界面**的独立判断，共用会伪造出并不存在的统一性。
2. **不复用 `SearchField` 组件**。该组件的注释明确写着它**不带 `onKeyDown`、不带 combobox 语义**（"一个带清除按钮的带标签文本框，单一职责"）；而参考实现 `TagExpressionInput` 的**主输入框同样是手写 input**。此处遵循同一先例，直接使用共享搜索样式。

**"关联"逻辑的简化**：候选构造上就是**1..10 除掉源槽**，所以旧的"拒绝 0/11/abc/自身"校验表**在新交互下不可达** —— 我把测试从"拒绝非法值"改写为"**断言这个构造本身**"（不提供源槽、提供其余九个），因为它才是取代校验的东西。**空槽仍可选**，因为空槽是合法操作数（D3：退化为移动）。

**菜单与选择器的共存**（本轮最需要想清楚的一点）：选择器展开时菜单**保持打开**，因此
- 它仍在 `menuRef` 内 → 既有的**外部点击关闭**逻辑不受影响
- 菜单项被**替换**（`{!swapPickerOpen && …}`），而不是叠加
- Escape **先关选择器、菜单留着**：输入框拥有该键，若菜单也响应就会一次关两层

**测试改写**：8 条针对旧弹窗的测试改写为新交互（含新增的分页、按标签搜索、按钮作用于高亮项、Escape 回归菜单项）；`_swap` 双发守卫测试的**批量派发写法完整保留**，因为那条方法论教训与交互无关。

**lint 说明（如实记录）**：我改动的三个文件**新增行零 lint**（用脚本按 `git diff -U0` 的行号交集核对）。全仓计数从 662 → 664，多出的 2 处**不在我改动的文件里**，是既有文件因行号位移而暴露的规则命中，我**没有顺手去改** —— 那超出本次请求范围，且会扩大改动面。

**未执行假验证**（不编造证据）：本轮改动是**纯 UI 结构与交互**，没有"可移除的保护"可供回退；旧测试变红 8 条本身就是"旧行为确实被替换"的证据。测试断言的是**可观察行为**（候选内容、分页、提交目标），不是实现细节。

### R13（用户报告）—— 投递被放在**响应路径**上，拖垮交换响应

用户看到（R8 新增的）`The swap is taking longer than expected. The list has been refreshed — check whether it applied.`

**根因（实测确证）**：`slot-service.ts` 的交换在**返回响应之前** `await this.deliver(affectedTabIds)`。而投递要把 `FIELD_APPLY` 发给已绑定的标签页；**导航中/冻结/尚未注入内容脚本**的页面会**接受消息但永不回复**。于是：

- 写入**早已提交**（`:350-366`）
- 响应被投递拖住 → 超过 `RESPONSE_TIMEOUT_MS = 10_000` → `TIMEOUT`
- **数据确实已交换，却被告知"耗时过长，请自行确认"**

**探针数据（挂起 `tabs.sendMessage`）**：

| | 修复前 | 修复后 |
|---|---|---|
| `answered` | **0**（从未响应） | **1**（立即响应） |
| 数据 | `s1=Three, s3=One` | `s1=Three, s3=One` |

**修法（两处，缺一不可）**：

1. **投递移出响应路径**：`await this.deliver(...)` → `void this.deliver(...).catch(...)`。投递是**已提交写入的副作用**，不是答案的一部分；它在自己的重试阶梯上运行、按标签页报告 `degraded`，调用方也无法据其分项结果做任何事（侧边栏在 toast 后本就会重读状态）。**局部存储的重读仍保持 `await`** —— 它决定要通知谁。
2. **`FIELD_APPLY` 加时限（`FIELD_APPLY_TIMEOUT_MS = 2000`）**：仅把投递移出响应路径会留下另一个洞 —— 永不 settle 的 promise 会让 `state.inFlight` 永久为真，此后**该标签页的每次投递都被并进 `pending` 后丢弃**（静默、永久）。超时把它转成既有的 `degraded` → 无状态 fallback 路径，那正是该路径的用途。

**测试时的两个自我修正**：
- 第一版投递超时测试**直接替换 `adapter.tabs.sendMessage`** 且未还原 —— `adapter.reset()` **不会撤销实例自有属性的直接赋值**，于是同文件后续 **8 条测试全部变红**。改为 `finally` 还原。
- 第一版 `withDeadline` 走**注入的 `DeliveryTimers`** —— 那个缝隙是为驱动重试阶梯而存在的，其测试断言 `scheduled` **精确等于** `RETRY_DELAYS_MS`，我的看门狗定时器混进去就让该断言失败。改为使用**真实 `setTimeout`**：它是本地消息的看门狗，无需虚拟化。

**假验证**：
- 恢复 `await this.deliver(...)` → `returns as soon as the write is committed, even if delivery never settles` **精确变红**
- 去掉 `withDeadline` → `gives up on a never-answering FIELD_APPLY and does not stay in flight` **精确变红**

### R12（用户报告）—— **冷启动时 `initialize()` 并发重入，消息被处理多次**

用户报告：交换报 `Slot data changed elsewhere` 但**数据实际没变**，且**第一次仍无撤销条**。这次两个症状**同一个根因**。

**关于 Playwright**：用户建议用它辅助测试 —— 我**实测并如实说明**：Playwright MCP 只能 `navigate` 到 URL，**无法加载未打包扩展**，而侧边栏必须在 `chrome-extension://` 上下文里才有 `chrome.runtime`。**我没有用它，也不假装用过**。改用了等价的隔离验证：同一 adapter 上并发调用 `ensureReady()`。

**根因（实测确证）**：`initialize()` 的守卫是

```ts
async initialize(): Promise<void> {
  if (this.initialized) return;     // ← 只在入口检查一次
  ...register onMessage...
  await this.repo.initialize();     // ← 中间有多个 await
  ...
  this.initialized = true;          // ← 直到最后才置位
```

**并发调用全部通过守卫**，于是 `onMessage` 被注册多次 → **每条消息被处理多次**。

**实测数据（假验证对照）**：

| | 修复后 | 修复前 |
|---|---|---|
| 并发 3 次 `ensureReady` 后的 `onMessage` 注册数 | **1** | **3** |
| 冷启动 3 条 `GET_STATE` 收到的响应数 | 3（正确） | **7**（重复处理） |

**为何恰好是"第一次"**：只有冷启动（`initialized` 仍为 false 且有多个消息在途）才满足重入条件。交换被发出多次 → 首条成功（版本 +1）、其余乐观检查失败 → `CONFIG_CONFLICT`；而**失败响应不含 `captureId`** → **不入栈 → 没有撤销条**。两个症状由此统一解释。

**修法**：`initPromise` 单飞 —— 主体只执行一次，并发调用者**共享同一个 promise**。监听器**仍在任何 `await` 之前同步注册**（冷启动不丢消息的既有保证不变），且恰好注册一次。

**⚠️ 我的第一版探针测错了对象**：它包装 `initialize` 并统计**包装函数**的调用次数（恒为 3），而**重入本身是无害的** —— 有害的是**主体重复执行导致重复注册**。改为直接统计 `onMessage` 的注册次数后才复现。（这条已写进测试注释。）

**顺带修了一个相邻缺陷**：`GET_STATE` 只把 `configVersion` 放在 `sync` 里，而 `MessageClient.sendRaw` **从响应顶层**读取它 —— 所以每个客户端的跟踪版本**永远是初始的 0**，它的乐观锁从未真正生效。现在顶层也返回 `configVersion`。

### R11（用户报告）—— 撤销可越级执行 → 数据重复

**用户场景**（初始 `s1=X, s2=Y, s3=Z`）：
1. 交换 s1↔s2 → `s1=Y, s2=X, s3=Z`
2. 交换 s2↔s3 → `s1=Y, s2=Z, s3=X`
3. 撤销第 1 步 → `s1=X, s2=Y, s3=X`
4. 撤销第 2 步 → **`s1=X, s2=X, s3=Z`** ← s2 变成 s1 的原始数据

**根因**：撤销**只在 LIFO 顺序下成立**。第 2 步的快照是**从第 1 步留下的状态**拍的，先执行第 1 步会让第 2 步的快照写入**过时内容** —— 于是 s2 被写回"交换前的 s1 内容"。

**修法**：`computeBlockedIds` 计算**被阻塞**的条目（UI 置灰 + 栈内拒执行）。
- 从新到旧扫描，维护"已被更新的交换认领的槽位"集合
- 叠放时**同时认领两个槽**（`slotIds`）—— 若只记 `slotId`，`s2↔s3` 会被判为与 `s1↔s2` 无关，正是泄漏的成因
- 被阻塞者**也认领自己的槽**，使依赖**可传递**：`A(s1,s2)·B(s2,s3)·C(s3,s4)` 中 A 与 B **都**被阻塞（只阻塞 A 会放任 B 先于 C 执行，重复 s3）

**双保险**：置灰只是**可见的一半**。`consume` **本身拒绝**执行被阻塞的条目 —— 键盘激活、陈旧闭包或直接调用都不能越级，数据损坏不关心请求怎么来的。

**⚠️ 我的规则第一版过宽，被既有测试抓住并收窄**：初版把**任何**共享槽位的条目都判为关联，于是**同一槽位连续覆盖两次**也被阻塞 —— 这破坏了栈自身的既有交互（"撤较早那次写入"），`undo-stack.test.ts` 立刻变红。**收窄为"只有交换（跨槽位移）才参与依赖"**：覆盖是**整槽替换**，自包含，先撤较早那次得到的是**自洽的早期状态**，不是重复。

**显式记录的边界**：设置页的 `client` 条目（Tags / Dashboard）**没有槽位足迹**，因此**不参与**本规则。这不是遗漏 —— 它们恢复的是**整字段/整实体值**，先撤较早那次同样自洽；强行关联反而会禁用合法交互（正是第一版过宽被抓住的方式）。

**假验证**：去掉阻塞判断 → **6 条测试变红**，含 `THE REPORTED BUG` 与 `consume REFUSES an older entry`。

**顺带修正两处已被我 R10 改动变成错的注释**：`undo-bar.tsx` 与 `undo-stack.ts` 都还写着"两个 TTL 必须相等" —— 而 R10 的修复**正依赖于它们不等**。已更正并把该关系**写成测试**（`PENDING_UNDO_TTL_MS > UNDO_DEFAULT_MS`）。

**假验证（两问题各两轮，R10）**：
- 问题 2：把 `SWAP_GESTURE_TIMEOUT_MS` 改回 3000 → `holds indefinitely while Alt is down (reported defect 2)` **精确变红**
- 问题 1：恢复 R1 形态（UI 直接用 worker deadline）**且** TTL 改回 5000 → **两条**测试变红，含那条真实模拟慢响应的 `a SLOW response still yields a FULL bar window`
- 另：先用 1.2 秒延迟做假验证**不会红**（延迟太短，无法区分）—— 改为 4 秒（冷启动量级）才复现。这条已写进测试注释。

### Commit Strategy 状态

**未执行**（C1–C4 均未提交）。原因有二：① 提交需用户明确要求（本次指令是"完成所有 Wave"）；② 计划声称 C1–C4"每个自洽可回滚"，但 **C1 单独不成立**：`T1` 改了 `PendingUndoSnapshot` 形状，而 `slot-service` 依赖它，仅提交 `storage-repository` 会让中间态**无法编译** —— 这是计划 Commit Strategy 的一处**过于乐观的假设**，已在交付说明中如实指出。

---

## Open Questions

| # | 问题 | 状态 |
|---|---|---|
| **V1** | Windows Chrome 下 `Alt` 的 `preventDefault()` 能否既抑制菜单栏、又保留 keyup 交付 | **PENDING VERIFICATION** —— 阻塞 T17；jsdom 无法证明；fallback = 改 `Alt+Enter` |
| **V2** | `sync.slots` 是否可能含 `id ∉ [1,10]` 的记录（导入路径是否校验槽范围） | **开工人自解（非阻塞）** —— 见下方"确定性动作"；不阻塞任何任务 |
| **V3** | 侧边栏是否已有全局 `keydown` 监听、及 `activeElement → slotNumber` 既有映射 | **开工人自解（非阻塞）** —— 见下方"确定性动作"；仅影响 T17 的写法细节 |

### V2 / V3 的确定性动作（开工时执行，不阻塞排期）

Momus 判定二者"可由开发者读码/search 在数分钟内解决"，因此**不作为 `[DECISION NEEDED]`**，而是各自绑定到一个任务的第一步：

- **V2**（在 **T11** 开工第一步）：`search_content` 检索导入路径（`import-export-service.ts` 的 `applyImport` / `import-diff.ts`）是否有槽位范围校验。
  - 有校验 → `swapSlots` 的越界判定照 A4 写即可；
  - 无校验 → 仍照 A4 写（**越界 = `SLOT_NOT_FOUND`**），并在 T11 注释记录"导入侧可能引入越界 id"这一事实，**不额外加防御层**（Metis Over-Validation 护栏）。
- **V3**（在 **T17** 开工第一步）：`search_content` 检索 `sidebar/App.tsx` 是否已有 window 级 `keydown` 监听，以及是否已有 `activeElement` → 槽号的映射。
  - 已有 → 复用；
  - 无 → 在列表级 hook（T2 的 `undo-stack.ts` 同族位置）内新增最小映射，**不新建抽象层**。

### 已裁决（不再是 OPEN）

| # | 问题 | 裁决 |
|---|---|---|
| **A4** | 「槽不存在」的精确含义（会推翻 D3） | 「槽不存在」**仅指编号越界**；1..10 内缺记录 = **空槽 = 合法内容** |
| **A7** | 撤销条被覆盖 | 扩为**可堆积**（演化为 U1–U7） |
| **Z1** | 交换的撤销快照装不下两个槽 | 快照改为**判别式**（`kind: 'single' \| 'swap'`）；**不新增 `UNDO_SWAP`**，复用 `UNDO_SAVE` 按 `kind` 分派；契约计数 **53** |
