# 侧边栏槽位拖拽交换 · 主设计文档

- **日期**：2026-10-16
- **状态**：四层已穷尽，Act 3 全树自检完成，两项矛盾已裁决 —— **待用户终审**
- **范围**：跨服务 + 多子系统（消息协议 / 服务层 / 仓库层 / 拖拽与键盘 UI / 撤销 / 无障碍）
- **子文档**：
  - `2026-10-16-slot-drag-swap-goal-scope-design.md`（目标层 D1–D7）
  - `2026-10-16-slot-drag-swap-constraint-boundaries-design.md`（约束层 D8–D13）
  - `2026-10-16-slot-drag-swap-architecture-module-design.md`（架构层 D14–D19）
  - `2026-10-16-slot-drag-swap-detail-interaction-copy-design.md`（细节层 D20–D26）
- **决策清单**：`2026-10-16-slot-drag-swap-decisions.yaml`

---

## 1. Overview

在侧边栏的槽位列表里，**拖拽一个槽到另一个槽，交换两者的记录数据**。键盘用户有两条等价路径（菜单与手势）。

**功能是一个单一原语**：把两槽的**内容**（`urlMatch` / `uiMarker` / 快照 / **绑定**）对调，**配置**（`strategy` / `autoBindOverride`）留在原编号。空的槽是合法内容，于是四种组合（有↔有 / 有↔空 / 空↔有 / 空↔空）都是同一个对调的特例，**无需分支**。

### 决定形态的三条硬事实

1. **槽位 `id` 固定 1..10 且是身份**。UI 用 `Array.from({length:10})` 生成、`slots.find(s => s.id === n)` 取值，快捷键 `save-slot-N` 锚在 N 上。`SyncState.slots` 的数组顺序**不参与语义** → 「重排」不可能，交换只能是**内容对调**。
2. **后端完全没有槽位交换原语**（`SWAP_SLOT`/`REORDER_SLOT`/`MOVE_SLOT` 全仓零命中），且 `KNOWN_ACTIONS` 是手写白名单并有门禁测试。
3. **记录与绑定分属两个存储区**：`SlotDefinition` 在 `storage.sync`、`SlotBinding` 在 `storage.local`；仓库注释明确 **「there is no cross-area transaction」**（`storage-repository.ts:1048`）。

---

## 2. Architecture

### 2.1 数据边界（D1、D2、D5）

| 类别 | 字段 | 交换时 |
|---|---|---|
| **内容** | `urlMatch`、`uiMarker`、`titleSnapshot`、`faviconSnapshot`、**绑定** | **跟着走** |
| **配置** | `strategy`、`autoBindOverride` | **留在原编号** |
| **派生态** | `cycleCursors`、`recoverySessions`/`recoverySnapshots`、`lastSuccessSlotId` | **清空**（若后者指向这两槽则置空） |

### 2.2 消息协议（D16、D17）

- 消息：**`SWAP_SLOTS`**（与 `SET_SLOT_*`/`UPDATE_SLOT_*` 同族，明确是复数操作）
- 载荷：`{ sourceSlotId: number; targetSlotId: number }`，携带 **`expectedVersion`**
- **服务层自己读**两槽状态再对调（UI 传来的副本可能已过期）
- 与 `UiAction` union **同批**注册进 `KNOWN_ACTIONS`（否则被 `isKnownAction` 拒为 `UNKNOWN_ACTION`）
- 撤销消息：**`UNDO_SWAP`**

### 2.3 UI 状态（D15）

**单一「待定交换」状态** `{ source: number; target: number } | null`，由**列表级 hook** 持有（落在 `src/ui/shared/use-*.ts`，与 `use-expand-row` 同族）。

**拖拽与 Alt 手势是它的两种输入方式** —— 两者语义同构（定源 → 选目标 → 提交/取消）：

| 输入 | 定源 | 选目标 | 提交 |
|---|---|---|---|
| 拖拽 | `dragstart` | `dragover` | `drop` |
| 手势 | 按下 `Alt`（武装） | `↑`/`↓` | 松开 `Alt` |

统一之后，D13 的"`dragstart` 取消武装态"**自动成立**，无需特例代码。

**范围澄清**：该状态**不包含菜单路径**（那是模态提交，见 2.5）。

### 2.4 更新令牌：交换的"操作"到底是什么（D10/D11/D12/D23）

两条通道，生命周期**不同**：

| 通道 | 形态 | 生命周期 |
|---|---|---|
| **手势型**（拖拽、`Alt+↑/↓`） | 瞬态待定交换 | `Escape` / 失焦 / **3 秒超时** 均取消（D12） |
| **模态型**（`⋯` → `Swap with slot…` → 输入框） | 对话框提交 | 由对话框自身管理；**不受失焦/超时约束** |

**为什么必须分开**：`⋯` 菜单**一打开槽行就失去焦点**（焦点移入菜单项）。若失焦取消适用于所有路径，菜单路径**在最开始就被自己取消**。而模态路径不存在"用户离开后替他提交"的风险 —— 那正是 D12 的立法目的。

### 2.5 待定交换态的视觉（D20、D21、D22）

| 对象 | 形式 | 理由 |
|---|---|---|
| **源槽** | `opacity` 降低 | "它正在被搬走" |
| **目标槽** | `outline` 强调 | **不动 `background`** —— 该通道已被 `--bound:hover` 占用，`outline` 不参与布局、可与 `:hover` 共存 |
| **边界提示** | 焦点行旁短促提示（`↑`/`↓` + `Top`/`Bottom`） | 锚定**注意力所在**，不跟随鼠标（键盘操作时鼠标可能不在侧边栏） |
| **拖影** | `dragstart` 用 `setDragImage()` 携带槽位编号 | 满足"跟随鼠标"意图的**标准做法**，不用 `dragover` 挪浮层的偏方 |

**可发现性补偿（D20）**：整行保持 `cursor: pointer`（"点击激活"信号），`cursor: grab` **只加在编号 `__number`**（当前零交互且 `aria-hidden`，是唯一不占用既有能力的位置）。两个信号作用于不同元素，不混淆。

### 2.6 文本选中（D9，红线）

标题 / URL 文本元素上显式 `draggable={false}` 并拦截 `dragstart` 冒泡，**保留选中复制**能力。因 D8 已排除它们作为可抓区域，此决定**不缩小可抓范围**，只补上"被排除区域保留原能力"。

---

## 3. Data Flow

### 3.1 写入序列（D14：顺序写入 + 失败补偿）

```
① 快照两槽 record + binding（含派生态）
② 写 sync（带 expectedVersion）    ── 失败 ⇒ 中止返回（未动 local，无需补偿）
③ 写 local（两槽新绑定 + 清派生态）
④ ③ 失败 ⇒ 用快照回写 sync 与 local 复原
⑤ 对外只返回一个结果
```

**❗如实记录的边界**：若第 ④ 步**自身也失败**，仍会残留不一致。这与项目既有 `clearAndWriteWithCompensation`（`storage-repository.ts:1054`）有**完全相同的边界**，不夸大保证。

### 3.2 交换后重新投递（D7）

立即 `delivery.recomputeAndRedeliver([sourceTabId, targetTabId])` —— 与 `UPDATE_SLOT_URL` 同款既有先例（`worker-orchestrator.ts:783-785` 注释：*"a slot URL edit must redeliver to the slot's bound tab"*）。**两侧都投**（交换后两槽的主人互换，且各自套用**新编号**的策略）。

### 3.3 撤销（D18 —— ⚠️ **已作废，见下**）

> **⚠️ D18 已作废（2026-10-16，范围修订）**
>
> 用户决定**全项目撤销改为可堆积**，因此本节原定的"**并列一条独立的双槽撤销**（`pendingSwapUndo` + `UNDO_SWAP`）"**不再成立**：
>
> - `pendingSwapUndo` **不引入**
> - `UNDO_SWAP` **不引入**（契约计数 **+1 ⇒ 53**，非 54）
> - 交换的撤销改走**共享撤销栈**（`replay: 'background'` 分支），复用 `UNDO_SAVE { slotId, captureId }`
> - 后台快照改为**判别式** `kind: 'single' | 'swap'`，由 `kind: 'swap'` 承载两槽内容与绑定（裁决 **Z1**）
>
> 依据：`2026-10-16-undo-stack-revision-design.md`；实施见 `plans/2026-10-16-undo-stack-and-slot-swap-plan.md`（T1/T3/T13）。
>
> **下文保留为原决策记录**（其"为什么不能复用被钉死的 `pendingUndo`"的论证仍然成立 —— 只是结论从"另开一个键"变成了"改 `pendingUndo` 本身"）。

**原决定**：**并列一条独立的双槽撤销**，不复用、不改造 `pendingUndo`：

- 新增独立 local 键 **`pendingSwapUndo`**，结构 `{ sourceSlotId, targetSlotId, sourceSnapshot, targetSnapshot, captureId, expiresAt }`
- 新增消息 **`UNDO_SWAP`**，服务层在**一次写入**里还原两槽（沿用 3.1 的序列）

**为什么并列而非扩展 `pendingUndo`**：后者按**单键单槽**存储，有 T34 的 `captureId` 归属证明、5s TTL 的 lazy 校验、按 `(slotId, captureId)` 双身份的清理定时器 —— 改数组会动到一条**已被测试钉死**的既有路径（`SAVE_SLOT` 撤销）。且 `pendingUndo` 本身即"放在 `LocalState` 之外的独立 local 键"，再加一个并列键是同款决策。

---

## 4. Error Handling

### 4.1 校验分层（D17）

**UI 先行拦截 + 服务层兜底**（消息可被快捷键/未来入口直接调用，UI 不是边界）。

| 层 | 情形 | 处理 |
|---|---|---|
| UI | 拖到自身 / 同一槽 | 不发起（D13） |
| UI | 空↔空 | 不发起（本地已知） |
| UI | 手势：**原地未动**（没按过方向键） | **静默取消** |
| UI | 手势：**环绕到边界**仍按 | 不提交 + `↑`/`↓` + `Top`/`Bottom` 提示 |
| 服务层 | `sourceSlotId === targetSlotId` | 拒绝 `INVALID_REQUEST` |
| 服务层 | 编号**越界**（非 1..10 整数） | `SLOT_NOT_FOUND`（**复用既有错误码**） |
| 服务层 | 1..10 内**缺记录** | **空槽 —— 合法内容**，走对调（**不是错误**） |
| 服务层 | 两槽皆空 | **成功但零写入**（幂等：不报错、**不动版本**） |

> **⚠️ 措辞精化（A4）**：「空槽」在本项目数据上就等于 `sync.slots` 里没有该 id 的记录。若把"缺记录"当作错误，则「有↔空」永远失败、D3 被推翻。故**「槽不存在」仅指编号越界**。详见架构层 D17。

### 4.2 非法落点（D13）

| 情形 | 处理 |
|---|---|
| 拖到自身 | `dropEffect='none'`（禁止光标），静默 |
| 拖到**编辑态**槽行 | **拒绝**（禁止光标） |
| 拖出列表 | 静默取消 |
| `dragstart` | 取消待提交的激活计时器 + 取消已武装的 Alt 态 |

**为什么编辑态行必须拒绝（数据完整性，非体验）**：编辑态提交走 `onEditTitle(slotNumber, draft)`，写回的是**该编号**。若交换先发生，用户松焦时草稿会写进**已换内容**的槽 —— 他改 A 的标题却覆盖了 B 的记录。**拒绝是唯一不产生串写的选择**（"自动提交"会写用户没要的东西，"丢弃草稿"会吞掉已输入内容）。

### 4.3 冲突（D16）

`CONFIG_CONFLICT` → 整体拒绝，提示 **`Slot data changed elsewhere. Refresh and try again.`**（复用既有句式，`settings/App.tsx:1839`）。

### 4.4 文案（D25）

| 场景 | 文案 |
|---|---|
| 菜单项 | `Swap with slot…` |
| 冲突 | `Slot data changed elsewhere. Refresh and try again.` |
| 撤销条 | `Slots 3 and 7 swapped` |
| 成功 toast | **不发**（交换改的正是列表本身，用户立刻看到；既有 `Saved to slot 3` 之所以发，是因为它改的是当前标签页、列表里看不出来） |
| 失败 toast | `Failed to swap slots 3 and 7` |
| 边界提示 | `↑`/`↓` + `Top`/`Bottom`（符号与按键同形） |

**语域规则**（采集自既有代码）：toast 完整句（`Slot 3 renamed`）、错误 `Failed to …`/`Could not …`、菜单项祈使短语 + `…`。拼写为**英式+美式混合体**（`colour` 与 `authorized` 并存），不强行统一。

---

## 5. Testing Strategy（D19）

| 层 | 内容 | 手段 |
|---|---|---|
| **纯逻辑单测** | `swapSlots` 四组合、**策略留位**（D2）、派生态清空（D5）、版本冲突、**两区补偿回滚**（3.1 第 ④ 步） | 直接调服务层（同 `tests/integration/slot-service.test.ts` 层） |
| **UI 行为测** | 拖拽走**既有手写 `DataTransfer` 装置**（`tag-chip-input.test.tsx:1063-1072`）；Alt 手势用 `fireEvent.keyDown/keyUp`（`altKey:true`）+ `advanceTimersByTime`；断言发出**一次** `SWAP_SLOTS` 且载荷正确 | jsdom |
| **人工验证清单**（**不自动化**） | ① Windows Chrome 的 `Alt` 菜单抑制 **与** keyup 是否可兼得；② 真实拖拽光标形态；③ 环绕提示可见性 | 人工 |

**⚠️ 必须显式写出的 jsdom 盲区**：jsdom **没有浏览器菜单栏**、**不会因 `Alt` 移动焦点**、`fireEvent.keyUp` **无需抑制即可送达**。因此上表 ① **在 jsdom 里必然"通过"，却什么都没证明** —— 把它写成自动化断言是**假保证**。项目已有同款诚实做法（`sidebar-title-commit.test.tsx` 注释："jsdom 不移动焦点，所以只能断言机制而非竞态本身"）。

**实现期必须实测项**：Windows Chrome 下对 `Alt` 的 `keydown` 调 `preventDefault()` 能否**既抑制菜单栏、又保留 `keyup` 交付**。若 `preventDefault()` 连带吞掉 keyup，需改方案（例如显式 `Alt+Enter` 提交），由实测结论决定。

---

## 6. Trade-offs

| 取舍 | 代价 | 为何接受 |
|---|---|---|
| **只换内容、策略留位**（D2） | 会出现「某条记录套用**目标编号**原本的策略」这一混合态，**没有其他入口能产生** | 自洽于"内容 vs 配置"的划分；已在此显式记录，**不是 bug**，防止日后被"修正"回去 |
| **跨存储无法真原子**（D14） | 若补偿自身失败，仍残留不一致 | 与既有 `clearAndWriteWithCompensation` 完全同一边界；项目无跨区事务 |
| **输入框选目标**（D23） | recall 取代 recognition | 项目既有设定本就假设用户知道编号（快捷键 `save-slot-3`、行左编号、菜单文案 `Slot N`）；D24 的对照行已补偿 |
| **整行可抓但不显示手柄**（D8/D20） | 可抓区域实际只剩编号与内边距，无 hover 提示 | 编号上的 `cursor: grab` 是唯一不与"点击激活"抢通道的补偿 |
| **成功不发 toast**（D25-④） | 无显式成功确认 | 结果在列表里立即可见；撤销条仍会宣告（D26-2 依赖此条） |
| **待定态不播报**（D26-2） | 读屏用户不知道"正在选目标" | 高频变化态播报会淹没用户；改以**结果**宣告 |

---

## 7. Open Questions

**无 OPEN 项**。Act 3 自检发现的两项矛盾**均已裁决**：

| 矛盾 | 裁决 |
|---|---|
| D12（失焦即取消）× D23（菜单→对话框，焦点必然离开行） | **A**：D12 只约束 Alt 手势的武装态；菜单路径是模态提交，不受失焦/超时约束（D15 的"单一状态"仍成立，它只描述拖拽与手势） |
| D17 的边界提示在「原地未动」时说什么（`Top`/`Bottom` 语义不符） | **A**：原地未动 → **静默取消**；`Top`/`Bottom` 只用于真的环绕到边界 |

**实现期必须实测 1 项**（非设计决策，是待验证事实）：见 §5 的 `Alt` 菜单抑制 vs keyup 交付。

**顺带修正的既有缺口**（D26-3）：槽位 `listitem` 缺 `aria-posinset` / `aria-setsize`，读屏无法表达"10 个槽里的第 3 个"。本功能让"编号"成为可操作对象（D20 的 `grab`、D23 的编号输入），该空缺由"锦上添花"变为"必须"。

**自检时修正的一处自身错误**：D26-3 原写"去掉 `__number` 的 `aria-hidden` 让编号进入可访问名" —— **错**。行的 `aria-label` 已是 `Slot ${slotNumber}: ${displayTitle} (${statusText})`（`sidebar/App.tsx:597`），编号**本就在可访问名里**；再去掉 `aria-hidden` 会让读屏**念两遍**。故 `__number` 保持 `aria-hidden`，只补 `aria-posinset`/`aria-setsize`。
