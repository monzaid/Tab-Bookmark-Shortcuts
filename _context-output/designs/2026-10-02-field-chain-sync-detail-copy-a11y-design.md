# Detail Layer ② — 成品文案（D-a）与 a11y 写法（D-f）

> **上游**：Goal（Q1–Q14）+ Constraint（C1–C8）+ Architecture（A1–A12 / A1-bis / A4-bis）+ ① UI deep-dive（S1–S4b）+ ② 四界面方向（D-1..D-21 / DT10 / DT11）+ ③ 实现级方向（IMP-1..IMP-19）+ ① Detail（DT1–DT12）
> **层**：📐 Detail 深挖②（对应 §"覆盖对账"的 **D-a 成品文案** + **D-f a11y 写法**）
> **日期**：2026-10-02 · **基线**：HEAD `a3d6ab3`
> **状态**：✅ **已完成** —— 决策 **CT1 / CT2 / CT3-a / CT3-b / CT3-g / CT4**，**OPEN：0**

---

## 0. 文案基准（D-a-1，用户裁决 ①）

| 类别 | 规则 | 例 |
|---|---|---|
| **描述句**（toast / 空态 / 提示 / 状态） | **sentence case**（仅句首与专有名词大写）+ 简短 | `Rule updated` / `No rules yet` / `Failed to reset items` |
| **标签 / 按钮 / 选项名** | **Title Case** | `Match URL` / `Custom Title` / `Save` / `Reset All` / `Use chain` |
| **placeholder** | sentence case，**不加句末句点** | `https:// or data: URI`（**`Leave empty to keep original` 必须删除**，见 §1.2） |
| 句末标点 | 单句**不加**句点；多句或含逗号才加 | `Cleared 3 layers · 12 tabs affected`（用 ` · ` 分隔，不加句点） |

### 0.1 须修正的既有不一致（实测）

| 位置 | 现状 | 修正为 |
|---|---|---|
| `settings/App.tsx:772` | `rule created`（**小写**） | `Rule created` |
| `sidebar/App.tsx:1320` | `Global rule created` | `Rule created`（**去掉 Global**：与设置页统一；规则本就是全局概念，术语见 §3） |
| `settings/App.tsx:1450` | `icon updated`（**清除时也说 updated**） | 见 §2 的 `Icon cleared`（① N18） |
| `settings/App.tsx:710` | `Rule updated` | **保留** |
| `settings/App.tsx:1321/1345` | `All items reset` / `Selected items reset` | `All items cleared` / `Selected items cleared`（**术语统一为 clear**，见 §3） |

### 0.2 术语统一（关键：全产品只保留一套词）

| 概念 | 统一用词 | 禁用 |
|---|---|---|
| 清空某层 / 整条链 | **clear / cleared** | `reset`（除 `Reset All` 的历史按钮名，见下） |
| 撤销一次编辑（纯前端，DT7 ①） | **reset（this edit）** | `revert` / `undo edit` |
| 侵权性批量清空（Dashboard 顶部两按钮） | **`Reset All` / `Reset Selected`** —— **保留旧名**（已确立的按钮，改名收益低于风险） | — |

> **⚠️ 术语冲突点（须在文档中显式说明，防止"被修掉"）**：`reset` 一词**同时**表示"撤销编辑"（DT7 ①）与"批量清空"（Dashboard 顶部）。二者的**作用域不同**（单个编辑 vs 批量），故保留；但**`Clear`（DT7 ②）与 `Reset All` 都是"清空"** → 须在 UI 上由**作用域文案**区分（见 §2）。

---

## 1. FieldEditor · 维度选项（Title 2 项 / Icon 3 项）

### 1.1 形态（OPEN-CT1 裁决）

| 维度 | `radiogroup` 选项 | 选中时的下方控件 |
|---|---|---|
| **Title** | `Custom Title` / `Use chain` | 输入框（`Custom Title` 时） |
| **Icon** | `Icon URL` / `Custom Icon` / `Use chain` | URL 输入框 / `IconEditor` / 仅旁注（`Use chain` 时） |

### 1.2 文案定稿

| 元素 | 文案 | 说明 |
|---|---|---|
| Title 字段标签 | `Custom Title (optional)` | **保留** |
| Title 选项 1 | `Custom Title` | 与 Icon 的 `Custom Icon` 同族 |
| Title 选项 2 | `Use chain` | 与 Icon 共用同一术语 |
| Title 输入框 placeholder | **（删除）** | `Leave empty to keep original` **必须删** —— "不使用本层"由 `Use chain` 显式表达；留着会误导（见 OPEN-CT1 连带影响 #2） |
| Title 空值提示 | `Enter a title, or choose Use chain` | OPEN-CT4 ① |
| Icon 选项 1 / 2 / 3 | `Icon URL` / `Custom Icon` / `Use chain` | DT2 + IMP-17b |
| Icon URL placeholder | `https:// or data: URI` | **保留** |
| Icon URL 空值提示 | `Enter an icon URL, or choose Custom Icon / Use chain` | CT4-bis |
| Icon Custom 空值提示 | `Pick colors and text, or choose Icon URL / Use chain` | CT4-bis |
| `Use chain` 旁注 · edit 态 | `Clears this layer — the value falls back to the next one in the chain.` | DT6 |
| `Use chain` 旁注 · create 态 | `This field stays unset — other layers will decide.` | DT6 / IMP-7 |
| `radiogroup` 的 `aria-label` | Title **`Title source`** / Icon **`Icon source`** | 取代现状 `Icon mode`（`sidebar/App.tsx:739`）—— 统一用 `source`（本层值的**来源**），Title 侧原名不存在 |
| 各选项的隐藏说明 | 见 §6 a11y | — |

---

## 2. FieldEditor · 共用按钮与状态

| 元素 | 可见文案 | `aria-label` | 备注 |
|---|---|---|---|
| 撤销编辑 ① | `↺`（无文字） | **`Reset this edit`** | DT7 ①；纯前端 |
| 清空整链 ② | `🗑`（无文字） | **`Clear title`** / **`Clear icon`** | DT7 ②；**立即生效**；DT9 免确认 |
| ② 的"立即生效"标注（DT12） | `Applies immediately` | — | 与底部 `Save` 视觉分离；**必填** |
| Title 清除后 toast | `Title cleared` | — | 修正 `icon updated` 的错配（① N18） |
| Icon 清除后 toast | `Icon cleared` | — | 同上 |

---

## 3. 徽标（四态）+ 遮蔽 + 跳焦（D-b 的前半）

| 元素 | 文案 | 备注 |
|---|---|---|
| 徽标 · override | **`Page`** | 术语决策：`override` 对用户不可读（① 记为内部名）→ 用 `Page`（= 当前页设置） |
| 徽标 · slot | **`Slot N`** | 用真实编号 |
| 徽标 · rule | **`Rule`** | — |
| 徽标 · site | **`Site`** | — |
| 遮蔽提示 | **`Overridden by a page setting`** / **`Overridden by Slot 5`** / **`Overridden by a rule`** | 取代 ① 的 `masked by an override`（术语统一 + 具体化来源） |
| 清除遮蔽入口 | **`Clear the page setting`** | 取代 `Clear the masking override`；作用域与 §2 的 `Clear` 一致 |
| 徽标 tooltip/aria | `Value from Slot 5 — click to jump to its settings` | 跳焦入口（IMP-5） |

---

## 4. 投递状态（`delivery`）

| 状态 | 文案 | 备注 |
|---|---|---|
| `ok` | **（不显示）** | 正常态**不占位**（避免噪声） |
| `protected` | **`Can't rewrite this page`** | 取代 `Cannot rewrite (protected page)`（更口语；`Can't` 比 `Cannot` 短） |
| `degraded` | **`Limited: can't restore the site value`** | 取代 `Degraded — cannot restore the site value`（`Degraded` 对用户无意义） |
| `unknown` | **`—`** | Q14；**须与"无值"区分**（IMP-5） |

---

## 5. 影响面预览（含阈值）+ 四态空态 + 失败反馈

### 5.1 ⚠️ 必须先分清：**两套预览机制**（否则会与 DT9 打架）

| | **A · `MatchSummary`**（规则命中预览） | **B · `Clear` 预览**（DT9） |
|---|---|---|
| 用途 | "这条规则会命中哪些页" | "**即将删掉什么**"（唯一防线） |
| 出现位置 | 规则表单的 `Where` 分组之后 | **紧贴 `Clear` 按钮**（DT12：与其维度贴合） |
| 时机 | **打开时查一次**，改动后 `outdated`（IMP-8） | **点击 `Clear` 的瞬间**（或悬停/聚焦时预取） |
| 阈值 | **前 3 条 + `…and K more`**（Q9 / **CT2 裁决**） | **默认展开、不折叠**（DT9 硬约束） |
| 首要信息 | **数量**（`Matches 12 tabs`） | **将被删除的全局配置本身**（DT9） |
| 排序 | **稳定**：`Tab N` 数字序（见 5.3） | 同上 |

> **⇒ CT2 的"前 3 条"只适用于 A**；B 因 DT9 要求"唯一防线"，**必须全列且默认展开**。二者形态不同是**有意的**，不得统一（防误修）。

### 5.2 A · `MatchSummary` 成品文案

| 状态 | 文案 |
|---|---|
| 命中 > 0 | **`Matches 12 tabs`** |
| 命中 > 0 且有遮蔽 | **`Matches 12 tabs · 3 masked`**（`masked` = 该规则的值会被更上层盖住的 tab 数） |
| 命中 = 0（**初始即 0**） | **`No open tabs match right now`**（**中性**，不给否定性警告 —— 见 IMP-8 的 8c） |
| 已失效（用户改了 URL / Match Type） | **`Matches 12 tabs · outdated`**（数字**变灰** + 文字标注；**不可仅靠颜色**） |
| 展开折叠 | 折叠时：**`…and 9 more`** + 按钮 **`Show all`**；展开后按钮 **`Show less`** |
| 列表条目 | **`Tab 3 — acme.com/page`**（`Tab N` + URL 的 host+path，过长则截断并保留 `title`） |
| 遮蔽条目的附加标记 | **`masked`**（小徽标，`title="The value from this rule is overridden on this tab"`） |

### 5.3 列表排序（必须稳定，否则 Q9 的"抖动"问题重现）

**排序键**：`Tab N` 的**数字序**（升序）。理由：① 行号是用户唯一能跨界面认出的标识（`Tab 3`）；② 避免按 URL 字典序造成相邻条目跨域跳动；③ **IMP-8 之后列表不再实时变化**，稳定性主要服务于"展开后重看同一列表"的一致。

### 5.4 B · `Clear` 预览成品文案（DT9）

| 元素 | 文案 |
|---|---|
| 标题行 | **`This will clear:`** |
| 条目（层值） | **`Page setting — title "Work"`** / **`Slot 5 — title "Work"`** / **`Rule "GitHub*" — title "GH"`** |
| 影响行 | **`Affects 12 tabs`** |
| 最终提示 | **`Tabs will fall back to the site value.`** |
| 无任何可清层时 | **`Nothing to clear`**（`Clear` 按钮相应**禁用**） |

### 5.5 四态空态（IMP-10）+ 失败反馈

| 位置 | 态 | 文案 |
|---|---|---|
| Rules | `empty` | **`No rules yet`** + **`Create one here, or use the sidebar's "+" button.`** |
| Rules | `no-match` | **`No rules match your search`** + 按钮 **`Clear search`** |
| Rules | `error`（首次） | **`Couldn't load rules`** + 按钮 **`Retry`** |
| Rules | `error`（刷新） | **`Couldn't refresh rules — showing the last loaded list.`** + 按钮 **`Retry`**（非阻塞条） |
| Dashboard | `empty` | **`Nothing customized yet`** + **`Set a title or icon from the sidebar to see it here.`** |
| Dashboard | `no-match` | 同 Rules（附带 `Clear search`） |
| Dashboard | `error`（首次/刷新） | 同 Rules（词换为 `items`） |
| 侧边栏 | `empty`（无活动页） | **`No active tab`**（保留）+ 副行 **`Open a page to customize it.`** |
| 侧边栏 | `error`（冷启失败） | **`Couldn't load settings`** + **`Retry`**（现状已有，保留） |
| 侧边栏 | `error`（刷新） | **`Couldn't refresh — showing the last loaded settings.`**（现状近似，统一句式） |

**失败反馈（含部分失败）**：

| 场景 | 文案 |
|---|---|
| 单条删除失败 | **`Couldn't delete the rule`** |
| 批量删除部分失败 | **`Deleted 3 of 5 · 2 failed`**（② N8 / IMP-14 的 14b） |
| 批量启停部分失败 | **`Updated 4 of 5 · 1 failed`** |
| `Clear` 后（DT9） | **`Cleared 3 layers · 12 tabs affected`**（+ `Undo` 按钮，泛化 `UndoBar`） |
| 保存覆盖（Q12，侧边栏） | **`Slot 5 overwritten`**（**保留**现状措辞，`UndoBar` 内） |
| 影响面预览加载失败（IMP-8） | **`Couldn't check matches`**（不阻塞表单；`Matches` 行位置显示该文案 + `Retry` 链接） |

---

## 6. a11y 写法（D-f）

### 6.1 ✅ OPEN-CT3-a · 选项组 = **③ 抽共享 `RadioGroup` 组件**（用户裁决）

```ts
interface RadioGroupProps {
  /** 组标签（渲染为 <legend>）：`Title source` / `Icon source` / `Match type` */
  label: string;
  /** 组名（渲染为各 radio 的 `name`，保证互斥分组） */
  name: string;
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string; description?: string }[];
  disabled?: boolean;
}
```
**内部实现**：`<fieldset>` + `<legend>` + 各选项（`<label>` 包裹 `<input type="radio" name={name}>`）。
**为什么选 `fieldset/legend` 而非 `div[role=radiogroup][aria-label]`**：原生语义、屏幕阅读器支持最一致；且 `legend` 会**自动**成为组标签（不依赖 `aria-label` 是否被写全）。

**统一效果（**8 组**，取代现状 4 处不一致）**：

| 界面 | 组 1 | 组 2 |
|---|---|---|
| 侧边栏弹窗 | `Match type` | `Title source` + `Icon source`（**共 3 组**） |
| Rules · New Rule | `Match type` | `Title source` + `Icon source`（**共 3 组**） |
| Rules · Inline | `Match type` | `Title source` + `Icon source`（**共 3 组**） |
| Dashboard · Edit | —（无 Match） | `Title source` + `Icon source`（**共 2 组**） |

> 修正现状：`settings/App.tsx:931`（New Rule `Match type`）与 `:1616`（Dashboard `Icon mode`）**均缺 `aria-label`** 的缺陷，因收口到组件而**结构性消失**（不可能再漏）。

### 6.2 无取舍项（**直接定死，标准做法**）

| # | 项 | 写法 |
|---|---|---|
| **CT3-c** | 行内展开的 `aria-expanded` / `aria-controls` | toggle 按钮：`aria-expanded={isExpanded(id)}` + `aria-controls={panelId(id)}`；面板容器 `id={panelId(id)}` + `role="form"` + `aria-label`（`InlineRuleEditor:522` 已验证）。随机 `id` 用 `useId()` 生成，避免多处冲突 |
| **CT3-d** | `FormField` 的 `aria-describedby`（IMP-12 触达面） | `aria-describedby={[errorId, hintId].filter(Boolean).join(' ')}`；**须绑到 `input` 本体**（调用方负责，因 `children` 是任意节点）；`errorId` 节点保留 `role="alert"` |
| **CT3-e** | 状态与颜色的解耦（C8 / WCAG 2.1 AA） | 所有"仅颜色"的语义都需**文字或图标**补充：`outdated`（IMP-8）、`masked`、`degraded`、脏态、`radio` 选中态 |
| **CT3-f** | 图标模式选项的隐藏说明 | 因 `label` 已够短，**不再**加 `aria-describedby`；但 `Use chain` 的**旁注**须与 radio 关联（`aria-describedby` 指向旁注 id），否则屏幕阅读器读不到"本层不设值"的关键语义 |

### 6.3 ✅ OPEN-CT3-b · `Confirm` 初始焦点 = **② 聚焦"确认"（快捷）**（用户裁决）

**决定**：`Confirm` 打开时初始焦点落在**确认按钮**（延续 `Dialog` 的"聚焦第一个可聚焦元素"行为，`:138-141`）⇒ **`Confirm` 的 DOM 顺序为「确认 → 取消」**（确认在前，才可能被首次聚焦到）。

**已接受的代价**：存在**"连按两下 Enter"**路径（第一个 Enter 打开、第二个 Enter 确认）。

**⚠️ 必须补的 4 条约束（否则该风险会真的兑现；且它们都能用既有能力消除）**：

| # | 约束 | 依据 |
|---|---|---|
| **b1** | **打开的那次回车不得穿透** —— 触发按钮需在 `keydown` 阻止默认行为，或对话框挂载时忽略该次重复事件 | 否则"打开"与"确认"由**同一物理按键**完成 |
| **b2** | **必须传 `returnFocusRef` / `focusFallbackRef`** —— 本迭代新增的所有 `Confirm` 用法都要传；现状删除 slot 的已传（`sidebar/App.tsx:443-453`），设置页尚无用法 | `components.tsx:100-119`（已为"触发器被卸载"设计） |
| **b3** | **不可逆操作（`Reset All` / 批量删除）→ 必须配 `UndoBar`（IMP-6）** | 焦点在"确认"上放大了误触概率 → `Confirm` 之外还需**可撤销兜底**（与 DT9 同一机制） |
| **b4** | **禁止"同一物理按键既打开又确认"** —— 且 `Confirm` 打开后应有**极短保护期**（~100–150ms 内忽略 Enter），防连击 | 本裁决直接产生 |

> 本裁决**不改变** `Confirm` 的视觉（`variant` 仍为 `default` / `danger`），仅决定**焦点与 DOM 顺序**。

### 6.4 ✅ OPEN-CT3-g · `UndoBar` 焦点 = **② 抢焦点到 `Undo` 按钮**（用户裁决）

**决定**：`UndoBar` 出现时**主动聚焦 `Undo` 按钮** ⇒ 键盘用户 5 秒内按 `Enter` 即可撤销（误操作救援最快）。

**与 `Confirm`（CT3-b）方向相反是「故意的」**：`Confirm` 的确认是**破坏性**的（故防连击），`Undo` 的确认是**救援性**的（故鼓励快速触发）—— 二者不矛盾。

**⚠️ 必须写死的 4 条约束**：

| # | 约束 | 理由 |
|---|---|---|
| **g1** | **焦点必须归还** —— `Undo` 或**过期**后，焦点回到 `UndoBar` 出现**之前**的元素（`Clear` 的触发按钮）；该元素可能已消失（如整行被清空）→ 退回到**稳定的**容器（面板 / 表格行） | 否则焦点掉到 `<body>`（与 `Dialog` 的 `focusFallbackRef` 同类问题，`components.tsx:110-119`） |
| **g2** | **`UndoBar` 与 `Confirm` 不得同时抢焦点** —— 二者可能叠加（`Reset All` 的 `Confirm` 确认后弹 `UndoBar`）⇒ 必须定死：**`Confirm` 关闭 → 提交 → 再弹 `UndoBar`**（串行，非并行） | 两个焦点抢占源并存 = 焦点冲突 |
| **g3** | **打开的那次回车不得穿透**（同 CT3-b 的 b1/b4）—— 触发按钮的 `keydown` 需阻止默认，且 `UndoBar` 挂载后极短保护期内忽略 `Enter` | 防"同一按键既触发又撤销"（虽然 `Undo` 无害，但会造成"莫名其妙被撤销"） |
| **g4** | **避免双重播报** —— 现状是 `role="alert" aria-live="polite"`（`sidebar/App.tsx:486`）：`alert` 隐含 assertive，与 `polite` **语义冲突**；且**焦点已移动**时屏幕阅读器会读聚焦元素 ⇒ 应改为 **`role="status"`**（或去掉 live 属性），**二选一**，不得叠加 | 实测缺陷（① N11 的延伸） |

**接受代价（显式登记）**：抢焦点会**打断正在进行的输入**（尤其 `Clear` 立即生效后用户想接着改）；缓解靠 **g1 的焦点归还**（5 秒后自动回来，不永久打断）。

---

## 7. 待裁决（本深挖②的 OPEN）

### ✅ OPEN-CT1 · Title 维度形态 = **② 两选项 radio：`Custom Title` / `Use chain`**（用户裁决）

**决定**：Title 与 Icon **完全同形**（都是 `radiogroup`，仅**项数不同**）：

| 维度 | 选项 | 值形态 |
|---|---|---|
| **Title** | `Custom Title` / `Use chain` | 2 项 |
| **Icon** | `Icon URL` / `Custom Icon` / `Use chain` | 3 项 |

**⇒ 这正是 DT5「对称」的真正含义**：对称的不是"项数相同"，而是**"同一控件形状 + 同一术语（`Use chain`）+ 同一语义（本层不设值）"**。

**连带的结构影响（必须回填）**：
| # | 影响 | 说明 |
|---|---|---|
| 1 | **`FieldMode` 的 title 分支** | `{ kind: 'set'; value: string } \| { kind: 'use-chain' }` —— 与 icon 的三分支**共用同一 `kind` 集合**（icon 仅多一种 `set` 的载荷形态） |
| 2 | **`placeholder` 失效** | `Leave empty to keep original`（`sidebar/App.tsx:721`）**必须删除** —— "不使用本层"现在由 `Use chain` **显式**表达；留着会让用户以为"清空输入框"等于"不使用本层" |
| 3 | **R6 短路必须重写** | `sidebar/App.tsx:1244` 的 `if (!next \|\| next === currentTitleInitial) return;` —— 空值不再能隐含"不使用本层"，必须改为**显式模式判定**（见 OPEN-CT4） |
| 4 | **`↺`（DT7 ①）的作用域扩大到"模式"** | 不再只是"复位文本"，而是**复位整个 `FieldMode`**（含 radio 选择）→ 与 S4a 的 `baseline: FieldMode` 一致 |
| 5 | **① 文档的 4 处 Icon radiogroup 统一** | 从"4 处 icon 三模式"扩为**"Title 2 项 + Icon 3 项"共 8 组 radigroup**（每入口 2 组）——统一力度需加大 |

### ✅ OPEN-CT4 · `Custom Title` 已选但输入为空 = **① 视为无效，禁止提交**（用户裁决）

**决定**：选中 `Custom Title` 后输入框**必填**；为空时 `Save` **禁用** + 提示 **`Enter a title, or choose Use chain`**。

**⇒ 泛化为一条通用校验规则（CT4-bis，本裁决的自然延伸，**同一类问题一次消灭**）**：

> **凡"已声明某个有值形态、但未提供值"→ 无效，禁止提交 + 行内提示。**

| 维度 | 有值形态 | 空值时的提示 |
|---|---|---|
| **Title** | `Custom Title` | `Enter a title, or choose Use chain` |
| **Icon** | `Icon URL` | `Enter an icon URL, or choose Custom Icon / Use chain` |
| **Icon** | `Custom Icon` | `Pick colors and text, or choose Icon URL / Use chain`（自绘必须有内容） |
| **Match URL** | （唯一形态） | `Enter a URL pattern`（现状是"能点但静默 return"，① N7 + ② D-8 已记） |

**连带改动（必须）**：
| # | 位置 | 改动 |
|---|---|---|
| 1 | `sidebar/App.tsx:656` | `Save` 的 `disabled` 从 `!url.trim() \|\| saving` 扩为**含字段级有效性** |
| 2 | `sidebar/App.tsx:607, 616-620` | 删除"空值静默 return"（`:607`）与"正则非法静默 return"（`:619`）→ 两者都改为**置错误状态 + 禁用提交** |
| 3 | `sidebar/App.tsx:644`（`handleSave` icon 计算） | 现状 `iconMode==='url' && iconUrl.trim()` → 空 URL **静默存为无图标** ⇒ 改为**无效** |
| 4 | **R6 短路（`sidebar/App.tsx:1244`）** | 彻底重写（空值不再隐含"不使用本层"） |
| 5 | `RuleFormFields` 的校验（DT1 要素 2） | 上述规则**收敛为共享纯函数**（`validateFieldEditors`），两面共用 |

**收益（与既有目标对齐）**：
- 与 **Q6**（清除 ≠ 清空）**方向一致** —— ③ 会被否决正因为它把"清空标题"重新引回来；
- 与 **② D-8**（"能点但没反应"是本弹窗最差体验）**同一修法**；
- **`''` 从此不再是写入侧值** ⇒ 与 **DT11**（`null` 为唯一"未设定"表示）完全一致（`''` 仅保留**读取侧**容错）。

### ✅ OPEN-CT2 · 影响面阈值 = **① 前 3 条 + `…and K more`**（用户裁决）

**决定**：`MatchSummary` 列**前 3 条**，其余折叠为 `…and 9 more (expand)`。

**⚠️ 适用范围必须收窄（防与 DT9 打架）**：本阈值**只适用于 `MatchSummary`（规则命中预览）**；**`Clear` 的删除预览（DT9）不受此阈值约束** —— DT9 已定它**默认展开、且以"将被删除的全局配置"为第一信息**（它是唯一防线）。
**⇒ 两套预览机制形态不同是「有意的」**，不得统一（详见 §5.1 的对照表）。

**另有 1 项随本裁决一并定死（原本是 D-c 的空白）**：**列表排序键 = `Tab N` 数字序（升序）** —— 使 Q9 原本担心的"列表随排序抖动"不再发生（IMP-8 已取消实时刷新，排序只需在"展开/收起"间保持一致）。

### OPEN-CT3 · a11y 写法细节（`radiogroup` 标注统一 / `Confirm` 焦点管理 / `aria-expanded`）

---

## 8. 遗留与回填

| 项 | 说明 | 状态 |
|---|---|---|
| **回填 ① D8/D12** | `masked by an override` → `Overridden by a page setting`；`Clear the masking override` → `Clear the page setting` | ⬜ 待做 |
| **回填 ② D-20** | 撤销机制已由 IMP-6 改为泛化 `UndoBar`；文案见 §5.5 | ⬜ 待做 |
| **回填 ② D-11** | 已由 IMP-9/18 回填（7 列） | ✅ |
| **回填 ① S4a** | 新增 `canClearChain`（IMP-7）+ `submitMode`（DT12） | ✅ |
| **回填 ③ IMP-8** | `outdated` 成品文案已定：`Matches 12 tabs · outdated`（§5.2） | ✅ |
| **回填 Detail ① DT9** | 格式确认为 `Cleared 3 layers · 12 tabs affected` | ✅ |
| **回填 Detail ① DT7** | `Reset this edit` / `Clear title` / `Clear icon` / `Applies immediately`（§2） | ✅ |
| **回填 ① 的 4 处 radiogroup 不一致** | 改为"8→11 组统一走 `RadioGroup`"（§6.1） | ⬜ 待做 |
| **回填 ③ IMP-12** | a11y 触达面的 `aria-describedby` 写法已定（§6.2 / CT3-d） | ✅ |
| **回填 DT1 的 `placeholder` 删除** | `Leave empty to keep original` 必须删（OPEN-CT1 影响 #2） | ⬜ 待做 |
| **新增登记：R6 短路重写** | `sidebar/App.tsx:1244`（OPEN-CT1 影响 #3 + OPEN-CT4） | ⬜ 待做 |
| **新增登记：`Confirm` DOM 顺序** | 「确认 → 取消」（CT3-b 决定） | ⬜ 待做 |
| **新增登记：`UndoBar` 的 `role` 修正** | 现状 `alert` + `aria-live="polite"` **语义冲突**（CT3-g 的 g4） | ⬜ 待做 |

---

## 9. 本深挖②的产出汇总（覆盖对账 D-a / D-f 的关闭）

| 覆盖项 | 关闭依据 |
|---|---|
| **D-a 英文成品文案** | ✅ 基准（§0）+ 术语统一（§0.2）+ FieldEditor 全组（§1/§2）+ 徽标/遮蔽/跳焦（§3）+ 投递状态（§4）+ 影响面两套机制（§5.1–5.4）+ 四态空态 ×4 界面（§5.5）+ 失败反馈 6 条 |
| **D-f a11y 写法** | ✅ `RadioGroup` 统一（§6.1，8→11 组）+ 4 项标准写法（§6.2）+ `Confirm` 焦点（§6.3）+ `UndoBar` 焦点（§6.4） |
| **D-c 的一部分** | ✅ 列表排序键 = `Tab N` 数字序（§5.3） |
| **仍开放（属第 3 轮）** | D-b 跳焦的实现方式（滚动/高亮/是否自动展开）、D-d 测试分层、D-e 校验边界的具体规则、D-g 空态 × `delivery` |