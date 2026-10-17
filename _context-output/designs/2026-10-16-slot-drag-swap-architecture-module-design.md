# 侧边栏槽位拖拽交换 · 架构与模块（Architecture Layer）

- **日期**：2026-10-16
- **状态**：架构层已确认，待进入细节层
- **上游**：`2026-10-16-slot-drag-swap-goal-scope-design.md`（D1–D7）、`...-constraint-boundaries-design.md`（D8–D13）

## 本层基线（既有接口事实，约束推荐）

| 事实 | 证据 |
|---|---|
| **sync 与 local 是两个独立写入通道**：`writeSync(expectedVersion, updater)` 带乐观版本检查、经 `syncWriteQueue` 串行；`writeLocal(updater)` **无版本检查**、经 `localWriteQueue` 串行 | `storage-repository.ts:380`、`:688` |
| 仓库注释明确：**「there is no cross-area transaction」**，既有对策是 `snapshot → 操作 → 失败则 restore` | `storage-repository.ts:1048-1058`（`clearAndWriteWithCompensation`） |
| 现有撤销是**单键、单槽**结构：`PENDING_UNDO_KEY='pendingUndo'`，字段 `{slotId, captureId, slotSnapshot, bindingSnapshot, expiresAt}`，5s TTL，`captureId` 证明归属 | `storage-repository.ts:42-67` |
| `UNDO_SAVE` 载荷只有 `{slotId}`，服务层 `restoreSlot(slotId)` 只还原一个槽 | `messages.ts:90-93`、`slot-service.ts:642` |
| 消息信封：`RequestBase.configVersion?` 可选；`ResponseBase = {success:true} \| {success:false; errorCode; message}` | `messages.ts:29-38` |
| `KNOWN_ACTIONS` 是手写白名单，**不自动同步** `UiAction` union，有门禁测试 | `worker-orchestrator.ts:54-77`、`tests/unit/background/known-actions.test.ts:5-19` |
| 错误码 `SLOT_NOT_FOUND` 已存在并用于槽位路径 | `worker-orchestrator.ts:760` |
| 版本兜底写法：`request.configVersion ?? this.repo.getConfigVersion()` | `worker-orchestrator.ts:757` |
| 投递接口：`recomputeAndRedeliver(tabIds)`，按 tabId 去重、并发投递 | `field-delivery-service.ts:109` |
| 槽位行 UI：行根 `div.tbs-slot-row[role=listitem][tabIndex=0]`，外层 `[role=list]`；行接收 20+ props | `sidebar/App.tsx:589`、`:2800` |
| 项目已有 6 个自定义 hook，其中 `use-expand-row` / `use-jump-to-row` 是"列表级状态 + 行消费"同款模式 | `src/ui/shared/` |
| 既有拖拽测试装置：**手写 `DataTransfer` 对象** + `fireEvent.dragStart/dragOver/drop` | `tests/unit/ui/tag-chip-input.test.tsx:1063-1072` |

---

## D14 · 跨存储"原子性"的落地级别

**决定**：**顺序写入 + 失败补偿**（沿用项目既有对策）：

1. 快照两槽的 record 与 binding（含 D5 涉及的派生态）
2. **写 sync**（带 `expectedVersion`）——失败即中止返回，**无需补偿**（此时未动 local）
3. **写 local**（写入两槽新绑定 + 清空派生态）
4. 若 ③ 失败 → 用快照**回写 sync 与 local** 复原
5. 对外只返回**一个**结果

**否决**：只保证 sync 原子（会产生"内容换了、绑定没换"的静默错误状态，正是 D1 的反面）；不追求跨区原子（同）。

**如实记录的边界**：若第 ④ 步**自身也失败**，仍会残留不一致。这与项目既有 `clearAndWriteWithCompensation` 有**完全相同的边界**，不夸大保证。文档与实现注释都必须写明。

**为什么不是新造**：`clearAndWriteWithCompensation` 已是同款模式并有 T22 测试钉住；复用同一心智能降低理解成本。

---

## D15 · 瞬态「待定交换」状态的形状与归属

**决定**：统一为**单一状态** `{ source: number; target: number } | null`，由**列表级 hook** 持有（落在 `src/ui/shared/use-*.ts`，与 `use-expand-row` 同族）；**拖拽与 Alt 手势只是它的两种输入方式**；行通过 props 得知自己是否为 source / target。

**关键洞察**：拖拽与手势语义**完全相同**（定源 → 选目标 → 提交/取消）——
- 拖拽：`dragstart` 定源、`dragover` 移目标、`drop` 提交
- 手势：武装定源、`↑/↓` 移光标、`keyup` 提交

D13 那句"`dragstart` 时取消武装态"正是这一点的暗示 —— 统一之后该要求**自动成立**，不再需要"取消对方"的特例代码。

**否决**：两套独立状态（会产生"武装中拖拽/拖拽中武装"等无意义组合，需逐一设防）；React Context（本仓库无此机制，而 `SlotRow` 已在接收 20+ props，加 2-3 个是一致的）。

**影响**："当前是否处于交换操作中"成为单一布尔量；D12 的超时、D13 的非法落点、行的视觉反馈都只读一处。

**范围澄清（Act 3 自检时补明确）**：本状态描述的是**拖拽与 Alt 手势**这两条**手势型**输入，**不包含菜单路径**。菜单路径（D10/D23）走对话框式的**模态提交**，生命周期由对话框自身管理（`Escape`/取消/提交），因此**不受 D12 的失焦与超时约束** —— 否则菜单一打开（焦点离开槽行）就会被取消。详见约束层 D12 的"适用范围"。

---

## D16 · 消息协议

**决定**：
- 消息名 **`SWAP_SLOTS`**（与既有 `SET_SLOT_*` / `UPDATE_SLOT_*` 同族，且明确是**复数**操作）
- 载荷 **`{ sourceSlotId: number; targetSlotId: number }`**，并携带 **`expectedVersion`**（走 `RequestBase.configVersion`）
- **服务层自己读**两槽当前内容再对调；版本不符 → 整体拒绝 **`CONFIG_CONFLICT`**，UI 提示「配置已变化，请重试」
- 与 `UiAction` union **同批**注册进 `KNOWN_ACTIONS`（不注册会被 `isKnownAction` 以 `UNKNOWN_ACTION` 拒绝）

**否决**：载荷携带两份完整内容（UI 传来的副本可能已过期，会写回陈旧内容覆盖用户别处的修改）；不带版本（"两槽同时生效"建立在可能已过期的读上，且失败无信号）。

---

## D17 · 校验分层与幂等

**决定**：**UI 先行拦截 + 服务层兜底校验**（UI 不是边界）

**UI 层**：
- 拖到自身 / 同一槽不发起（D13 已定）
- **空↔空不发起**（本地已知两边皆空）
- 手势中 `source === target` 时**不提交**，但**分两种情形**（Act 3 自检时补明确）：
  - **原地未动**（光标仍停在源槽、用户没按过方向键就松开）→ **静默取消**。用户什么都没要求，不该报"到头了"（无操作即无反馈，与项目的空操作惯例一致）。
  - **环绕到边界**（用户在边界槽上仍按 `↑`/`↓`）→ 给**符号 + 文案**提示（`↑`/`↓` + `Top`/`Bottom`，D25-⑤b）。这才是"你已经到头了"的真实表达，否则用户连按到末尾后再按，会以为按键失灵。

  > **自检发现的矛盾**：D25-⑤b 的 `Top`/`Bottom` 语义是"**你已经到头了**"，而"原地未动"与"到头"是两件事 —— 共用一个提示会让那条提示变得不可信。故本轮明确拆开。

**服务层（兜底，因消息可被快捷键/未来入口直接调用）**：

| 情形 | 处理 |
|---|---|
| `sourceSlotId === targetSlotId` | 拒绝 `INVALID_REQUEST`（调用方逻辑有误，静默会掩盖缺陷） |
| 编号**越界**（非 1..10 整数） | `SLOT_NOT_FOUND`（**复用既有错误码，不扩 `DomainErrorCode`**） |
| 1..10 内**缺记录** | **空槽 —— 合法内容**，走对调。**不是错误** |
| 两槽皆空 | **成功但零写入**（幂等：不报错、**不动版本**） |

> **⚠️ 措辞精化（计划前置裁决 A4 时修正）**：本表原写作"编号越界 / **槽不存在** → `SLOT_NOT_FOUND`"，这是**我的措辞失误**，且会**推翻 D3** —— 本项目的「空槽」在数据上就等于 `sync.slots` 里**没有该 id 的记录**（UI 是 `Array.from({length:10})` + `slots.find(s => s.id === n)`，`sidebar/App.tsx:2801-2803`；`types.ts:753-761` 的 `slots` 是稀疏数组）。若把"缺记录"判为 `SLOT_NOT_FOUND`，则「有↔空」**永远报错**，而空槽恰是本功能最初点名的核心场景。
>
> 现状已明确：**「槽不存在」仅指编号越界**；域内缺记录 = 空槽 = 合法操作数。D3 保持有效。
>
> **不采用 `SLOT_EMPTY` 的理由**：既有 `switchSlot` 用它表示"想切换但槽是空的"——那是一个**错误态**（用户要求了一个做不了的动作）。而本功能里空槽是**合法操作数**，语义不同，复用会让错误码自相矛盾。

**先例**：`TagService` 的注释原话即"UI is not the boundary"；"零写入不动版本"与上一轮 `createTag` 的重复写入不 bump 版本一致。

---

## D18 · 双槽撤销的记录与还原 —— ⚠️ **已作废**

> **⚠️ 本决策已作废（2026-10-16，范围修订）**
>
> 用户随后决定**全项目撤销改为可堆积**（`2026-10-16-undo-stack-revision-design.md` U1–U7、裁决 **Z1**），因此本条的形态**不再成立**：
> - `pendingSwapUndo` 独立键 **未引入**
> - `UNDO_SWAP` **未引入**（契约计数 **+1 ⇒ 53**，不是 54）
> - 交换的撤销改走**共享撤销栈**的 `replay:'background'` 分支，复用 `UNDO_SAVE { slotId, captureId }`
> - 后台快照改为**判别式** `kind: 'single' | 'swap'`，由 `kind:'swap'` 承载两槽（Z1）
> - `pendingUndo` **被改造成数组**（正是本条当初否决的方向）—— 但按 U5 的方式：`clearPendingUndo` 从"无条件删整个键"改为按身份过滤后写回，并补 `pendingUndoWriteQueue` 串行化（后者是 F4 审查发现的、数组化引入的竞态）
>
> 下文保留为**原决策记录**。其"不能轻率复用 `pendingUndo`"的论证**仍然有效**（T34 归属证明、双身份清理定时器确实都要一并处理），只是结论从"另开一个键"变为"改造 `pendingUndo` 本身并逐项解决那些牵连"。
>
> 实施见 `plans/2026-10-16-undo-stack-and-slot-swap-plan.md`（T1/T3/T4/T13/T18）。

**原决定**：**并列一条独立的双槽撤销**（不复用、不改造 `pendingUndo`）：
- 新增独立 local 键 **`pendingSwapUndo`**，结构 `{ sourceSlotId, targetSlotId, sourceSnapshot, targetSnapshot, captureId, expiresAt }`
- 新增消息 **`UNDO_SWAP`**，服务层在**一次写入**里还原两槽（沿用 D14 的顺序写入＋补偿）

**否决**：
- 扩展 `pendingUndo` 成数组 —— 会动到一条**已被测试钉死**的既有路径（`SAVE_SLOT` 撤销），其 `captureId` 归属证明（T34）、5s TTL 的 lazy 校验、按 `(slotId, captureId)` 双身份的清理定时器都会被牵连；且交换与单槽撤销的生命周期并不相同
- UI 连发两次 `UNDO_SAVE` —— 必然是两次独立写入，**撤销本身就会产生中间态**，违反 D4
- 撤销 D6（放弃撤销）—— D6 已否决

**为什么并列是同款选择**：`pendingUndo` 本身就是"放在 `LocalState` 之外的独立 local 键"，注释写明理由是"transient device-local data with a 5s TTL，隔离可避免污染持久化状态形状"。再加一个并列键是同一决策。

**影响**：两条撤销通道**各自独立**，不互相抢占（与"侧边栏只有一个撤销提示位"相容 —— 同一时刻只会有一种操作刚发生）。

---

## D19 · 测试策略（三层分工 + 显式盲区）

**决定**：

| 层 | 内容 | 手段 |
|---|---|---|
| **纯逻辑单测**（服务层） | `swapSlots` 四组合（有↔有 / 有↔空 / 空↔有 / 空↔空）、**策略留位**（D2）、派生态清空（D5）、版本冲突、**两区补偿回滚**（D14 步骤 ④） | 直接调服务层，不经 DOM（同 `tests/integration/slot-service.test.ts` 层） |
| **UI 行为测**（jsdom） | 拖拽走**既有手写 `DataTransfer` 装置**；Alt 手势用 `fireEvent.keyDown/keyUp`（`altKey: true`）+ `advanceTimersByTime` 驱动超时；断言发出**一次** `SWAP_SLOTS` 且载荷正确 | 复用 `tag-chip-input.test.tsx:1063-1072` 的既有做法 |
| **人工验证清单**（写入文档，**不自动化**） | ① Windows Chrome 的 `Alt` 菜单抑制 **与** keyup 是否可兼得（约束层 D12 的实测项）；② 真实拖拽光标形态；③ 环绕到边界提示的可见性 | 人工 |

**⚠️ 必须显式写出的 jsdom 盲区（否则是假保证）**：
jsdom **没有浏览器菜单栏**、**不会因 `Alt` 移动焦点**、`fireEvent.keyUp` **无需"抑制"即可送达**。因此 D12 的实测项**在 jsdom 里必然"通过"，却什么都没证明** —— 把它写成自动化断言是假保证。项目已有此类诚实做法的先例：`sidebar-title-commit.test.tsx` 注释明确写"jsdom 不移动焦点，所以只能断言机制而非竞态本身"。

**否决**：全用 jsdom 断言（产生上述假保证）；只做服务层单测（UI 行为无回归保护）。

---

## 架构层自检

- **无 OPEN 项**。约束层遗留的 **1 项实现期必须实测**（`Alt` 菜单 vs keyup）已由 D19 归入"人工验证清单"，并明确禁止用 jsdom 断言冒充。
- **跨决策一致性**：D15（单一状态）使 D13 的"取消武装态"自动成立；D14（补偿）同时服务 D18 的撤销还原；D16（服务层自读）× D17（兜底校验）分层清晰；D18（并列独立键）与 D14 的写入顺序一致。
- **本层未解决、需细节层处理**：
  1. **D8 的可发现性补偿** —— 约束层已标记"架构层需要一次明确补偿讨论"，但本层聚焦数据流，该项顺延至细节层的交互设计（`cursor: grab` 的施加范围、是否给行加提示、source/target 的视觉表达）。
  2. `Alt` 手势与拖拽**共用的视觉语言**（待定交换态如何呈现：源槽、目标槽、边界提示）。
  3. `⋯` 菜单选择目标编号的具体交互形态。

## 下游待决（细节层）

1. **交互与视觉**：待定交换态的三类视觉（源 / 目标 / 边界提示）、拖拽光标、`cursor: grab` 范围、D8 可发现性补偿。
2. **边缘情况逐条落实**：拖拽中断（拖出窗口 / `Escape`）、拖拽途中外部数据变化（版本冲突的 UI 呈现）、失焦与超时的联合触发、编辑态行的拒绝提示形态。
3. **`⋯` 菜单选目标编号**的交互形态（复用既有 Dialog 模式？内联列表？）。
4. **文案**：边界提示文案、冲突提示文案、撤销条文案、菜单项文案——须与既有语域一致（项目文案为英式英语）。
5. **无障碍**：新控件的角色与可访问名；拖拽对屏幕阅读器不可达时，菜单入口必须是等价完整的路径。
