# 侧边栏槽位拖拽交换 · 细节与交互文案（Detail Layer）

- **日期**：2026-10-16
- **状态**：细节层已确认，待全树自检与终审
- **上游**：目标层（D1–D7）、约束层（D8–D13）、架构层（D14–D19）

## 本层基线（既有视觉与文案事实）

**视觉通道占用情况**（`src/ui/styles/sidebar.css:153-190`）：

| 通道 | 现状 |
|---|---|
| `background` | **已占用**：`.tbs-slot-row--bound:hover` → `--color-bg-hover` |
| `border-bottom` | 已占用：1px `--color-border`（行分隔线） |
| `position: relative` | 已就位，可挂伪元素 |
| 左侧色条 `__color-bar` | `absolute`，`left:0`，全高 |
| `cursor` | 基础行 `default`；`--bound` 行 `pointer`（= "点我可激活"） |
| 编号 `__number` | 20×20，**`aria-hidden="true"` 且零交互** |

**类名规范**：BEM `tbs-slot-row__element` / `--modifier`（既有 19 个类）。

**文案语域**（采集自 `src/ui/sidebar/App.tsx`）：

| 类别 | 既有样例 | 规则 |
|---|---|---|
| toast 成功/信息 | `Slot 3 renamed`、`Slot 3 URL updated`、`Saved to slot 3`、`Slot 3 deleted` | 完整句，对象 + 动作 |
| toast 错误 | `Failed to save slot 3`、`Could not create tag`、`Undo failed` | `Failed to …` / `Could not …` |
| 菜单项 | `Rename Title…`、`Change Icon…`、`Edit URL…`、`Clear Slot Data`、`Add to Global Rules` | 祈使短语；会弹对话框的加 `…` |
| 冲突 | `This rule was modified elsewhere. Refresh and try again.`（`settings/App.tsx:1839`） | 既有句式，**直接复用** |
| 拼写 | `colour`（英式）与 `authorized`（美式）**并存** | 混合体，不统一为单一变体 |

**无障碍既有约定**：`UndoBar` = `role="status" aria-live="polite"`；`Toast` = `role="alert" aria-live="assertive" aria-atomic="true"`；"随交互高频变化的视觉态"一律不 `aria-live`（如拖拽 `--drop` 高亮）。

**既有缺口（本层顺带发现）**：`role="list"` 的行**没有** `aria-posinset` / `aria-setsize`，编号 `aria-hidden`，行名形如 `Slot 3: GitHub (Bound)`（`App.tsx:2800-2803`、`589-597`）。

---

## D20 · 拖拽的可发现性补偿（光标）

**决定**：整行**保持 `cursor: pointer`**（保留"点击激活"信号）；**`cursor: grab` 只加在编号 `__number` 上**。整行仍是拖拽面（D8 不变），可抓的暗示集中在编号。

**否决**：
- 整行 `cursor: grab` —— 会让**更高频**的"点击激活"失去光标暗示，用高频能力换低频能力不划算。
- 悬停时才浮现编号手柄 —— 把入口藏到需要 hover 才发现，等于**只有已经知道的人才能找到**，可发现性问题原封不动。

**理由**：`pointer`（可点）与 `grab`（可抓）作用于**不同元素**，两个信号可共存不混淆；编号当前零交互且 `aria-hidden`，是唯一"不占用任何既有能力"的位置（与约束层 Q8 同一论据）。

---

## D21 · 待定交换态的三类视觉

**决定**：三处分工，**互不抢通道**：

| 对象 | 形式 | 表达 |
|---|---|---|
| **源槽** | `opacity` 降低 | "它正在被搬走" |
| **目标槽** | `outline` 强调 | 当前落点。**不动 `background`**，让 `:hover` 保持可用 |
| **边界提示** | 行下方一条短促提示 | 环绕到顶/底（详见 D22、D25-⑤） |

**否决**：
- 一律用背景色 —— 会与 `:hover` **抢同一通道**，用户无法分辨"鼠标在哪"与"目标是哪"。
- 只用文字状态（行内插入 `→ target`）—— 会在拖拽过程中**改变行高**，导致后续行的落点位置在拖拽中途漂移（拖拽交互最不该发生的抖动）。

**理由**：`outline` 不参与布局、不与 `:hover` 的背景冲突，是唯一能"同时既显示悬停又显示目标"的选择；项目已有 `outline` 用法（`.tbs-tag-selector__option:has(input:focus-visible)` 用 `outline: 2px solid var(--color-primary)`）。

---

## D22 · 两种输入方式的反馈位置

**决定**：**反馈总出现在用户的注意力所在**：

- **拖拽**：目标行 `outline` 高亮（D21），并在 `dragstart` 用 **`dataTransfer.setDragImage()`** 让随光标的拖影**带上槽位编号** —— "手里拿着槽 3"跟随光标可见。**用标准 API，不用 `dragover` 挪自定义浮层**。
- **键盘手势**：边界提示**锚定在焦点行**（武装/目标行）旁，**不跟随鼠标**。

**否决**：
- 边界提示跟随鼠标 —— 键盘操作时鼠标可能不在侧边栏（甚至在其他显示器），提示会指向与注意力无关处，**比不提示更困惑**。
- 用 `dragover` 的 `clientX/clientY` 持续挪浮层伪装"跟随鼠标" —— 刷新率由浏览器决定、可能跳动，且原生拖拽本就在绘制拖影。

**理由**：用户已明确要"跟随鼠标"的意图 —— `setDragImage()` 正是**标准且零脆弱**的实现方式（编号随光标走），无需偏方。

---

## D23 · `⋯` 菜单选目标编号的形态

**决定**：`Swap with slot…`（D25-①）打开一个**输入框**，用户键入目标编号 `1..10`。**点击/回车即执行，不再二次确认**（交换可撤销，D6/D18）。

**校验（并入 D17 既有约定）**：输入须为 1..10 整数；越界/非法 → 就地阻止、不发起消息；等于源槽编号 → 就地阻止并提示（与 D17 的 `source === target` 一致）。

**否决**：
- 对话框列出 1..10 的槽位按钮 —— 更符合 recognition，但用户选择了输入框；本项目的既有设定本就假设用户知道编号（快捷键 `save-slot-3`/`switch-slot-3`、行左编号、菜单文案 `Slot N`），故 recall 负担不是本次新引入。
- 嵌套子菜单 —— 项目无子菜单先例，需新造 `aria-haspopup`/嵌套 `menu` 角色。
- 菜单项直接"武装"该行再让用户点目标 —— 焦点还在菜单里却被要求离开菜单，步数更多，且超时/失焦取消（D12）后要重来。

**影响**：D24 的对照行是该选择的补偿。

---

## D24 · 输入框上方的编号对照

**决定**：输入框**上方提供一行可扫读对照**，形如 `1 GitHub · 2 Empty · 3 News…`。不改变"打字提交"的交互。

**否决**：纯输入框（在面向 10 个对象的选择里只能靠记忆）；只给占位符 `1-10`（只回答"范围"，没回答"哪个是哪个"）。

**理由**：零成本补回 recall 缺口；且**空槽被交换时行为不同**（D3：有↔空 = 移动），所以"目标是不是空的"是**会影响结果的真实信息**，值得可见。

---

## D25 · 全部用户可见文案

**决定**：

| # | 场景 | 文案 | 依据 |
|---|---|---|---|
| ① | 菜单项（D10 主入口） | **`Swap with slot…`** | 既有菜单项一律"动词短语 + `…`"；`slot` 单数与 `Slot 3` 用词一致 |
| ② | 冲突提示（D16 的 `CONFIG_CONFLICT`） | **`Slot data changed elsewhere. Refresh and try again.`** | **直接复用**既有句式（`settings/App.tsx:1839` `modified elsewhere. Refresh and try again.`），用户已在规则编辑处见过同款，不需学第二种说法 |
| ③ | 撤销条（D18） | **`Slots 3 and 7 swapped`** | 既有条为"结果 + 对象/数量"（`2 tags deleted`、`Slot 3 deleted`）；`Swap undone` 说的是**动作**而非**结果**，与既有条不符 |
| ④ | 成功 toast | **不发** | 交换改的正是**列表本身**，用户立刻看到两行内容对调；既有 `Saved to slot 3` 之所以发，是因为它改的是"当前标签页"、列表里看不出来 |
| ⑤ | 失败 toast | **`Failed to swap slots 3 and 7`** | 套用 `Failed to …` 句式 |
| ⑤b | 边界提示（D17 符号＋文案，锚定焦点行） | 符号 **`↑` / `↓`** + 文案 **`Top` / `Bottom`** | `↑`/`↓` 恰是触发它的那两个键（**符号与按键同形**，用户一望即知"到头了"）；`▲▼` 与按键不同形；整句太长而这是"连按时的即时反馈" |

**否决（④）**：发成功 toast —— 重复告知已经可见的结果，是噪音。

---

## D26 · 无障碍

**决定**：**三件事**，均沿用既有约定：

1. **等价性**：菜单路径 = **完整功能**（选任意编号、可撤销），因此**拖拽对读屏用户不是必需** —— 无需为拖拽补键盘替代（`Alt+↑/↓` 另提供快路径）。
2. **瞬态态不播报**：待定交换态（D15）是**视觉态**（D21 的 `opacity` / `outline`），**对读屏不奏报** —— 它随每次 `↑/↓` 变化，播报会造成连续打断。代之以**提交后的结果宣告**（撤销条 `role="status" aria-live="polite"`，D25-③）与**失败时的 toast**（`role="alert"`，既有 `Toast`）。
3. **行的位置语义补齐**（本层顺带发现的既有缺口）：给 `listitem` 加 **`aria-posinset` / `aria-setsize`**，使读屏能说"第 3 项，共 10 项"。

   **⚠️ 自检修正**：本项原先还写了"去掉 `__number` 的 `aria-hidden`，让编号进入可访问名" —— 这是**错的**。行的 `aria-label` 已经是 `Slot ${slotNumber}: ${displayTitle} (${statusText})`（`sidebar/App.tsx:597`），**编号本来就在可访问名里**。若再去掉 `__number` 的 `aria-hidden`，读屏会**念两遍编号**（一次来自 label、一次来自那个 span）。因此 `__number` **保持 `aria-hidden`**，本项只加 `aria-posinset` / `aria-setsize` 两个属性。

**否决**：
- 只做等价性、不补位置语义 —— 菜单路径虽可用，但用户提交后**听不到结果**（D25-④ 成功不发 toast），会不确定操作是否生效。
- 让待定态也播报（每次 `↑/↓` 用 `aria-live` 播报"目标：槽 7"）—— **反模式**：连按会引发连续播报把用户淹没，且焦点行本身已承载"我在哪"的信息。

**理由（第 3 条的紧迫性）**：本功能**恰好让"编号"变成可操作对象**（D20 的 `grab` 手柄、D23 的编号输入），此时位置语义从"锦上添花"变成"必须"。且与既有做法一致：项目对"随交互高频变化的视觉态"一律不 `aria-live`（拖拽 `--drop` 高亮、`tbs-tag-selector__option:has(input:checked)`），而**结果**才宣告（`UndoBar` 的 `role="status"`、`Toast` 的 `role="alert"`）。

---

## 细节层自检

- **无 OPEN 项**。
- **跨决策一致性**：D20（`grab` 只在编号）× D23（编号输入）—— 编号同时成为"可抓提示"与"可输入的目标"，两者都指向"编号 = 行的地址"，语义统一；D21（`outline` 不占 `background`）× D22（`outline` 用于拖拽目标）一致；D24（对照行）是 D23（输入框）的补偿；D25-④（成功不发 toast）× D26-2（结果由撤销条宣告）互相依赖，缺一不可。
- **本层**未新增悬空问题。少量实现细节（`.tbs-slot-row--dragging` / `--drop-target` 的具体命名、对照行的截断策略）属实现期常规决定，不影响设计成立性。
