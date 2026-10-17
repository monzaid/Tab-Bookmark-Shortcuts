# 撤销模型修订 · 堆积化（Scope Revision）

- **日期**：2026-10-16
- **状态**：7 项裁决已定，作为计划输入；**推翻已批准设计的 D18**
- **性质**：**范围修订**。原设计的槽位交换（四层闭合）保持不变，但其 D18「并列独立双槽撤销」被本文件推翻

---

## 0. 为什么这是一次修订

用户原批准的设计（`2026-10-16-slot-drag-swap-design.md`）在 **D18** 明确**否决**了堆叠：

> "扩展 `pendingUndo` 成数组 —— 会动到一条**已被测试钉死**的既有路径（`SAVE_SLOT` 撤销）… 且交换与单槽撤销的生命周期并不相同"

并据此选择"新增并列键 `pendingSwapUndo`"。用户随后决定**全项目撤销改为可堆积**，因此：
- **D18 作废**（不再是并列独立键）
- **D6 的"专有双槽撤销"形态作废**（交换的撤销改用共享栈）
- 范围从"一个槽位功能"扩为**全项目撤销模型改造**

---

## 1. 关键事实（盘点所得，决定设计形态）

### 1.1 存在**两份**并存的撤销机制

| 机制 | 谁用 | 数据在哪 | 重放方式 |
|---|---|---|---|
| **后台快照** | 侧边栏覆盖保存（`SAVE_SLOT`） | 后台 `pendingUndo` 独立 local 键 | 发**一条** `UNDO_SAVE { slotId }`，后台 `restoreSlot` 自己恢复 |
| **UI 重放** | 设置页（tag 删除 / rule-tags / tab-override / slot-marker） | UI state 里的 `UndoSnapshot.writes` | **逐条发消息**（`RESTORE_TAG` / `SET_RULE_TAGS` / `SET_TAB_OVERRIDE` / `UPDATE_SLOT_UI_MARKER`） |

**"统一为一份共享栈"必须调和这个差异** —— 栈条目需要**判别式**（replay 方式不同）。这是本次最重要的新模型决定。

### 1.2 后台 `pendingUndo` 是单键单槽（最硬的假设）

- `PENDING_UNDO_KEY = 'pendingUndo'`（独立 local 键，**不在 `LocalState` 内**）
- `PendingUndoSnapshot { slotId, captureId, slotSnapshot, bindingSnapshot, expiresAt }`
- **`clearPendingUndo` 无条件 `remove` 整个键**（`storage-repository.ts:1200`）—— 改数组后若不动它，**任一定时器会清空整栈**
- `getPendingUndo(slotId)` 只能返回单个；`restoreSlot` 依赖它
- `captureId`（T34）是**同槽快速连写**的归属证明

### 1.3 UI 有**三处**独立持有者，且侧边栏那个"同名不同形"

| 持有者 | 位置 | 形状 |
|---|---|---|
| 侧边栏 | `sidebar/App.tsx:1458` | **私有** `interface UndoState { slotId; previousSlot; expiresAt }`（`:82-86`）—— 与共享 `UndoState` **同名不同形**（共享类型在 `:890` 被别名成 `SharedUndoState`） |
| 设置页 Tags | `settings/App.tsx:655` | 单个共享 `UndoState` |
| 设置页 Dashboard | `settings/App.tsx:2856` | 单个共享 `UndoState` |

三处全是**单值 `useState<UndoState \| null>`**，无一处是数组。

### 1.4 `UndoLayerWrite` 现有 4 种 kind

`undo-bar.tsx:18-76`：`'tab-override'` / `'slot-marker'` / `'tag-delete'` / `'rule-tags'`。
`UndoSnapshot = { writes: UndoLayerWrite[]; affectedTabIds: number[] }` —— **`writes` 已是一批**，但**整个 app 一次只持有一个 snapshot**。

**槽位交换需要第 5 种 kind**（或复用后台快照机制）：`'slot-marker'` 只携带 `customTitle`/`icon`，**不包含** `urlMatch`/快照/绑定，不足以还原一次交换。

### 1.5 UI 从未消费 `expiresAt`

`undo-bar.tsx:111-117` 只有一个 `setTimeout(durationMs)`，`onExpire?: () => void` **无参** —— 承载不了"哪一条过期"。`state.expiresAt` 在组件里被完全忽略。**堆积后"各条独立倒计时"必须实装**，否则退化为"最新一条的倒计时决定整栈寿命"。

### 1.6 不触碰导出模型（好消息）

`pendingUndo` **不在 `LocalState` 内**、不参与导出/导入/诊断。改成数组只要仍在**同一个独立 local 键**内，就不触碰导出模型或 `LocalState` 形状。
**⚠️ 反面约束**：**不要**把快照塞进 `LocalState` —— 那会走上 `writeLocal` 的 strip 不变式（R2/FIX-B「派生 render 不得被持久化」），而 `setPendingUndo` 走 `adapter.storage.set` 直写、正因如此才安全。

### 1.7 测试被钉死的位置

- **5 处单数获取** `getByRole('button', { name: /^Undo$/ })` → 同屏多条立刻抛 "multiple elements"：
  `tests/ui-smoke/tags-section.test.tsx:151,220,223,253`、`tests/unit/ui/dashboard-undo-recipe.test.tsx:103,133`、`tests/unit/ui/sidebar-result-handling.test.tsx:148,150`
- **单键语义被显式断言**：`tests/integration/worker-orchestrator.test.ts:574-632`（注释明写 "snapshot slot 2 **into the same key**"）
- **批量撤销原子性前提**：`tests/integration/storage-repository-tags.test.ts:5-9`（级联提升版本恰好 +1）

### 1.8 两条既有裁决不受影响（只要不扩覆盖面）

- `2026-09-29-ui-ux-remediation-plan.md:707-713` **DR3**：槽位删除**不做**撤销
- `2026-10-04-import-export-iteration-plan.md:148,232` **A8**：导入**不做**撤销

本次**只改堆叠能力，不扩覆盖面**（`clearShown`/`clearSelected`/`resetEntry`/`handleUnbind` 依旧无撤销）。

---

## 2. 七项裁决

| # | 问题 | 裁决 | 影响 |
|---|---|---|---|
| **U1** | 堆叠呈现（Q1） | **多条撤销条同时堆叠显示**，每条一个 `Undo` 按钮 | 5 处单数获取的测试必红，需改为 `within(bar)` 限定作用域 |
| **U2** | 容量与 TTL（Q2 + S3 修订） | **每条独立 5s 倒计时**；**不限条数**（由 5s 逐条过期自然回收） | ⚠️ **S3=C 覆盖了 Q2 的「保留 N=10」**，Q2 的"每条独立倒计时"部分仍有效。需实装 per-entry `expiresAt` 消费（现状 UI 忽略它） |
| **U3** | 任务切分（Q3） | **两者合并为一份计划** | 计划规模大：6 源文件 + 2 个 3000+ 行 `App.tsx` + ~7 测试文件 |
| **U4** | 统一程度（Q4） | **统一为一份共享撤销栈**，三处持有者接入同一模型 | 顺带消除侧边栏"同名不同形"的私有 `UndoState` |
| **U5** | 后台存储形状（S1） | **单键存数组**：`pendingUndo: [snap…]`；`clearPendingUndo` 改为**按 `(slotId, captureId)` 过滤后写回** | 必须改 `getPendingUndo` 签名（带 `captureId` 或返回数组）；须**宽容读**旧存档残留的单对象 |
| **U6** | 侧边栏归属（S2） | **侧边栏也堆叠**，进入同一栈 | 需**显式建模**"重放方式"差异（后台快照 vs UI 重放） |
| **U7** | 超限与清理（S3） | **不限条数** | 与 U2 一致；无淘汰逻辑 |

### 由 U1 自动派生的必需改动

**每条撤销条有自己的 `Undo` 按钮 ⇒ `UNDO_SAVE` 必须携带身份**（不能是"弹出栈顶"，否则点第 2 条会撤销最新那条，与堆叠呈现自相矛盾）：

```
UNDO_SAVE { slotId }  →  UNDO_SAVE { slotId, captureId }
```

同步面：`messages.ts`（请求接口）／`worker-orchestrator.ts`（`case` 与 `KNOWN_ACTIONS` 无新增 action，仅载荷变）／`message-client.ts:233` `undoSave`／`slot-service.ts:642` `restoreSlot`／`storage-repository.ts` 的 `getPendingUndo` 与 `clearPendingUndo`。

---

## 3. 新模型（两机制调和）

栈条目带**判别式**，两种重放方式并存于同一个栈：

```ts
type UndoEntry =
  // 后台快照支撑：重放 = 发一条 UNDO_SAVE { slotId, captureId }
  | { id: string; replay: 'background';
      slotId: number; captureId: number;
      message: string; expiresAt: number }
  // UI 重放支撑：重放 = 逐条发 writes 里的消息
  | { id: string; replay: 'client';
      snapshot: UndoSnapshot;
      message: string; expiresAt: number };
```

- `id`：栈内稳定身份（用于 per-entry 倒计时与"点哪条撤哪条"），与后台 `captureId` **不是同一个东西**（后台条目两者都有）
- **槽位交换**：走 `background` 分支（后台快照能承载两槽完整内容 + 绑定），因此**不需要新增 `UndoLayerWrite` kind** —— D18 的"并列独立键"随之作废
- **统一栈的宿主**：一个共享 hook（落在 `src/ui/shared/`），三处 UI 接入

### 3.1 后台快照形状（裁决 Z1）

**问题**：槽位交换的撤销必须还原**两个**槽（内容 + 绑定），而 `PendingUndoSnapshot` 只有**一组** `slotSnapshot` / `bindingSnapshot` —— **装不下**。这直接影响 T1（快照形状）与 T3（`UNDO_SAVE` 语义）。

**裁决 A：快照改为判别式**，一条条目 = 一次撤销：

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

- `UNDO_SAVE { slotId, captureId }` 取出条目后**按 `kind` 分派**：`single` → 既有 `restoreSlot` 语义（含"无快照时降级为 unbind"）；`swap` → 一次写入还原两槽
- **不新增 `UNDO_SWAP` 消息** ⇒ 契约计数 **+1（`SWAP_SLOTS`）= 53**（非 54）
- **否决 B**（两条条目 + `pairId` 关联）：会破坏"一条 = 一次撤销"的直觉，UI 堆叠会显示两条实为同一件事
- **否决 C**（保留独立 `UNDO_SWAP`）：与本次"统一共享栈"相抵，且会多出一条与 `UNDO_SAVE` 平行的通道

**对 T1 的影响**：`kind: 'single'` 分支是既有字段的**原样保留**（加 `kind` 与 `id`），因此宽容读旧存档时按 `kind: 'single'` 补齐即可。

---

## 4. 实现前置（阻塞项）

| # | 前置 | 为什么阻塞 |
|---|---|---|
| **V1** | **Windows Chrome 实测**：对 `Alt` 的 `keydown` 调 `preventDefault()` 能否**既抑制菜单栏、又保留 `keyup` 交付** | 设计已标 `PENDING_VERIFICATION`、`blocks:[D11,D12]`。未出结论前不得实现 Alt 手势提交（fallback：改 `Alt+Enter`）。**jsdom 无法证明此事**（无菜单栏、不移动焦点、keyup 无需抑制即送达） |
| **V2** | 确认 `sync.slots` 是否可能含 `id ∉ [1,10]` 的记录（导入路径是否校验槽范围） | 决定"越界判定"的写法与是否需防御 |
| **V3** | 确认侧边栏是否已有全局 `keydown` 监听、以及 `activeElement → slotNumber` 的既有映射 | 决定 armed 态的解析方式（D15 的列表级 hook 如何知道"哪一行被武装"） |

---

## 5. 既有决策的同步修正（已写入上游文档）

- `...-architecture-module-design.md` **D17**：措辞精化为"越界（非 1..10 整数）→ `SLOT_NOT_FOUND`；域内缺记录 = **空槽 = 合法内容**"（原文"槽不存在"会推翻 D3）
- 主文档 §4.1 与 `decisions.yaml` 同步该精化
