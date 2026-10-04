# Architecture Deep-dive ② — 四界面 UI/UX 设计方向（现状实测 + 方向）

> **上游**：Goal（Q1–Q14）+ Constraint（C1–C8 / RK-1）+ Architecture（A1–A12）+ UI deep-dive ①（S1–S4）+ Detail（DT1–DT9）
> **层**：🏗️ Architecture 深挖（第二份，**方向性**，非规格）
> **日期**：2026-10-02 · **基线**：HEAD `a3d6ab3`
> **检查方式**：静态分析（未实跑）+ 子代理定向勘察（43 次工具调用）
> **与 UI deep-dive ① 的关系**：① 解决"**有哪些缺陷**"，本文解决"**改成什么形状 / 走什么方向**"
> **本层决策**：DT10（提交模型 = A3 混合）、DT11（`null` 为一元表示），**OPEN 0**

---

## 0. 本次勘察新增的**实测事实**（① 未覆盖，逐条附行号）

| # | 事实 | 证据 | 严重度 |
|---|---|---|---|
| N1 | **`Confirm` 在设置页完全未使用** —— `settings/App.tsx` **未 import** `Confirm` | import 仅 `Button, Toast, StatusBadge`（`:13`）；全文件 `Confirm` 只出现在 `:1811` 文案与 `:1946` 注释 | 🔴 |
| N2 | **`styles/tokens.css` 已是实际情况下的唯一 token 源**；`--tbs-*` 旧体系（`shared/global.css`、`sidebar/sidebar.css`）**全仓库零引用**（死样式层） | `styles/base.css:6 @import './tokens.css'`；`sidebar/App.tsx:26-27`、`settings/main.tsx:6-7` | 🟠 |
| N3 | **侧边栏无固定宽度**；两个 manifest（chrome/edge）**均未声明 `default_width`** | `styles/sidebar.css:8-14` 无 `width`；`manifests/chrome.json` `side_panel` 仅 `default_path` | 🟠 |
| N4 | **20. slot `⋯` 菜单无键盘语义**：有 `role="menu"` 但**无 Escape 关闭、无方向键、无焦点移入**；关闭仅靠外部 `mousedown` | `sidebar/App.tsx:402`（menu）、`:172-181`（外部关闭） | 🟠 |
| N5 | **Current Page favicon 是"假按钮"**：声明 `role="button" tabIndex={0}` 但**无 `onKeyDown`**，键盘无法触发图标编辑 | `sidebar/App.tsx:1557-1563`（仅 `onDoubleClick` `:1559`） | 🟠 |
| N6 | **错误出现在两处**：创建规则失败同时写入弹窗内 `saveError`（`:793-795`）与全局 toast（`:1324-1326`） | 同左 | 🟡 |
| N7 | **正则提示与实际保存值不一致**：实时提示用**未做 `wildcardToRegex` 转换**的原文（`:704`），而 `handleSave` 用转换后的值（`:610-614`）→ 可能出现"提示合法但保存被拒" | 同左 | 🟠 |
| N8 | **`selectedIds` 与可见行不同步**：批量删除用**整个 `selectedIds`**，但 `:893` 只显示数量 → 搜索过滤后可能删除**用户看不见的**规则 | `settings/App.tsx:653, 814-824, 891-893` | 🔴 |
| N9 | **`resetAll` / `resetSelected` 无确认**（`danger` 按钮直接执行）；**`resetEntryTitle` 绕过 `editing` state**，直接在 `entries` 里查（`:1603-1606`） | `:1467-1472`、`:1308-1353`、`:1358-1376` | 🔴 |
| N10 | **清除语义两套表示**：current-page 用 `null`（`sidebar:1299`、`settings:1443`），slot 用 `{type:'url', value:''}`（`settings:1296,1317,1341,1447`；`sidebar:1385`） | 同左 | 🟠 |
| N11 | **`Toast` 的 `action` 能力全仓库从未使用**（唯一的 Undo 是 overwrite 场景的 `UndoBar`），且 **`UndoBar` 打开时不聚焦按钮** | `components.tsx:240-241, 272-276`；`sidebar/App.tsx:486-488` | 🟠 |
| N12 | **`DashboardEditForm` / `RuleFormState` 有对应"草稿保护"组件 `DraftProtectionDialog`（含 `isDirty`）但未被任何当前界面引用** | `DualCards.tsx:101, 157-168`；`sidebar/App.tsx` / `settings/App.tsx` 均未 import | 🟡 |
| N13 | **`InlineRuleEditor` 无 Escape 取消**（同页 `sidebar` 的行内编辑有） | `settings/App.tsx:519-641` 无 `onKeyDown`；对照 `sidebar/App.tsx:211-215, 238-242` | 🟡 |
| N14 | **`InlineRuleEditor` 展开后焦点不移入**新出现的表单 | `settings/App.tsx:1160-1166` | 🟡 |
| N15 | **`FormField` 的 `errorId` / `hintId` 算出来了但未 `aria-describedby` 到输入**（需调用方自行绑定） | `components.tsx:341-371` | 🟡 |
| N16 | **"空态"与"加载失败"不可区分**：`loadRules` 失败静默（`:661-671`）、`DashboardSection.load` 失败静默（`:1265-1267`）→ 与真空白（`:1169-1175`、`:1576-1582`）同貌 | 同左 | 🟠 |
| N17 | **搜索无结果与"尚未配置"共用同一文案** | `settings/App.tsx:1169-1175` | 🟡 |
| N18 | **`applyEditIcon` 的清除分支 toast 仍是 `icon updated`**（用户执行"清除"却看到"已更新"） | `settings/App.tsx:1450` | 🟡 |
| N19 | **New Rule 表单无 `Enabled`、Inline 有**；**Inline 无正则校验、New Rule 有** —— 两处表单能力**双向不等** | `:1010-1015` vs `:620-623`；`:546-552` vs `:936-943` | 🟠 |
| N20 | **侧边栏 `Loading...` 用内联硬编码样式**绕过 token；弹窗错误也用内联 `#DC2626` | `sidebar/App.tsx:1483`；`:793-795` | 🟡 |

---

## 1. 界面 1 · 侧边栏（`src/ui/sidebar/App.tsx`，1831 行）

### 1.1 现状结构（实测）

| 分区 | 行号 | 关键内容 |
|---|---|---|
| 整页 Loading | 1480-1486 | 纯文本（**无骨架屏**，内联样式） |
| 根容器 | 1531 | `role="application"` |
| header | 1533-1550 | `▼ Current Page` 折叠开关 + `🔒/🔓` 锁 |
| Current Page 区 | 1553-1684 | favicon+标题（1555-1604）/ URL（1606-1610）/ 动作行（1613-1682） |
| 非阻塞错误条 | 1723-1730 | `role="status"` 旧数据刷新失败 |
| slot 列表 | 1741-1806 | **固定 10 行**（`Array.from({length:10})`） |
| UndoBar / Toast / footer | 1808-1827 | footer：⚙ / ↕ / 📊 |

**编辑入口全盘点（可发现性问题的根源）**：

| 目标 | 入口 | 键盘可达 |
|---|---|---|
| Current Page 标题 | **仅双击**（`:1599`） | ❌ |
| Current Page 图标 | **仅双击**（`:1559`，假按钮 N5） | ❌ |
| Current Page 标题 Reset | 仅编辑态内 `↺`（`:1585-1593`） | 编辑后才可达 |
| Current Page 图标 Reset | 仅在 Icon Dialog footer（`:546-548`） | ✅（在 Dialog 内） |
| slot 标题 / 图标 / URL | 双击（`:307-325`）+ `⋯` 菜单（`:401-440`） | 菜单 ❌（N4） |

### 1.2 设计方向（S1-dir · 侧边栏）

**D-1 · 从"双击驱动"转为"显式可点 + 双击加速"（关键方向）**
双击是**不可发现**的（依赖 `title` 悬停提示）。方向：**每个可编辑字段常驻一个显式入口**（铅笔 IconButton，`aria-label` 明确），双击**继续保留**作为加速路径。这条同时修 N4/N5 与 ①「D9 可发现性」。
> 不采用"整块 hover 才显示按钮"——侧边栏窄、hover 区域小；改为**始终可见**的 `✎`。

**D-2 · Current Page 与 slot 使用**同一套**"字段行"结构（收口 4 处形态差异）**
现状：Current Page 是"favicon + 标题 + URL"三段式；slot 是"色条 + 序号 + 图标 + 标题 + URL + 徽章"。方向：抽 **`EntityFieldRow`**（label + 值 + `✎` + 状态徽标），两处共用 —— 使 **DT4 的预填/来源标注**（`From current page` / `From slot N`）有统一落点。

**D-3 · Current Page 的 `●`本土链展示升级为 A1 的 `ChainResult`**
现状 `:1492-1528` 是**手抄的两份链**（正是 ①「#1 链实现两份」）。方向：**直接渲染 A1 的 `ChainResult`**（四层值 + 来源徽标 + `masked`），与 Dashboard **同一份数据、同一套徽标组件** —— 侧边栏因此**自动获得**"为什么改不动"的解释能力（①「D3/D9」）。

**D-4 · 窄栏的分层信息密度** — ⚠️ **已由 IMP-2 降级**
现状断点：`max-width:299px` 隐藏 actions/icon（`styles/sidebar.css:724-735`）、`min-width:440px` 显示 `__meta`（`:739-743`）。
**IMP-2 裁决**：`FieldEditor` **两面均常驻展开** ⇒ **不存在密度切换**（IMP-11 随之关闭）。D-4 从"三段式密度策略"**降级为纯宽度断点**（隐藏**次要信息**，不再涉及字段的展开/折叠）。**但保留原约束**：**不得在窄栏隐藏"清除/编辑入口"**（否则能力不等，违背 DT1 理由③）。

**D-5 · 键盘与焦点**
- slot `⋯` 菜单：`Escape` 关闭 + `ArrowUp/Down` roving tabindex + 打开时**焦点移入首项**（修 N4）；
- Current Page 图标：补 `onKeyDown`（Enter/Space）（修 N5）；
- UndoBar 打开时**主动聚焦 Undo 按钮**（修 N11 后半）。

---

## 2. 界面 2 · `New Global Page Rule` 弹窗（`CreateRuleModal:572-798`）

### 2.1 现状（实测）

| 顺序 | 行号 | 内容 |
|---|---|---|
| Dialog | 649-661 | **未传** `returnFocusRef` / `focusFallbackRef`（对比 slot 删除 Confirm `:443-453` 传了） |
| 1 Match URL | 662-683 | input + `↺` |
| 2 Match Type | 685-710 | radio + 实时校验（**用未转换原文**，N7） |
| 3 Custom Title | 712-734 | input + `↺` |
| 4 Icon | 737-769 | 三态 radio + URL input / IconEditor / **`Reset` 提示旧文案** |
| 5 Priority | 772-784 | number |
| 6 Auto-apply | 786-791 | **Q11 将删除** |
| 错误行 | 793-795 | `role="alert"`，内联 `#DC2626` |

**`handleSave`（`:606-644`）的三处静默**：空 URL → `return`（`:607`，无提示）｜正则非法 → `return`（`:619`，**不写 `saveError`**，且 Save 按钮 `disabled` 条件（`:656`）只看 `url.trim()`，**按钮不变灰** → 用户点击后"什么都没发生"）。

**预填数据流（实测）**：设置者 2 处 —— `handleSlotAddToGlobal`（`:1425-1436`，slot 数据）+ Current Page `＋`（`:1617-1621`，**不传 `matchType`**）；`CreateRuleModal` 用三元兜底（`:1712-1715`），**未设 prefill 时回落到当前页 URL**（隐式默认，与 DT1「不设隐式默认」冲突）。

### 2.2 设计方向（S1-dir · 弹窗）

**D-6 · 从"6 个并列区块"改为"3 组语义分组"**
现状是把 6 个字段**平铺**（`tbs-modal__section` × 6）。方向按语义分组：
1. **Where**（`Match URL` + `Match Type`）—— "这条规则管哪些页"；
2. **What**（`Custom Title` + `Icon`，即 `FieldEditor`）—— "改成什么"；
3. **Priority** —— "多规则冲突时谁赢"。

**D-7 · 结果预览前置（把"影响面"从附加项提升为常驻区）** — ⚠️ **已由 IMP-8 修订**
现状影响面是 ① 的"新增项"（待实现）。方向：在**分组 1 之后**放一个**常驻**的 `Matches N tabs` 行。
**IMP-8 修订**：**打开表单时查一次**（以预填 URL 为输入）；用户**改动 `Match URL` / `Match Type` 后即失效**（变灰 + `outdated` 标注）；**不做实时防抖重查**。`N = 0` 的文案须为中性（`No open tabs match right now`），且须区分"初始即 0"（给警告）与"已失效"（不给警告）。这条仍消灭"建了规则看不到效果"（① D13 同族）。

**D-8 · 提交按钮的"可提交"与"为什么不能提交"**
现状：`disabled={!url.trim() || saving}`（`:656`）→ 正则非法时按钮**仍可点**、点了**静默返回**（N7 + `:619`）。方向：按钮 `disabled` 条件与**校验结果**绑定，并在按钮旁常驻一行**原因文案**（如 `Invalid regex: …`）。**"能点但没反应"是本弹窗最差的一处体验**。

**D-9 · 复用 `RuleFormFields`（DT8）+ `FieldEditor`（S4a）**
弹窗本体退化为：`Dialog` + `RuleFormFields`（`variant='create'`）+ 创作态标注（DT5 的 `This rule is not saved yet`）+ 影响面。**Prepre 显式化**：`RuleFormFields` 的 `prefill` 为**必填 prop**，取消 `:1712-1715` 的三元隐式回落（DT1）。

**D-10 · 焦点闭环**：补 `returnFocusRef`（回 `＋` 按钮或 `⋯` 菜单项）—— 与 slot 删除 Confirm 一致（`:443-453`）。

---

## 3. 界面 3 · `Page Rewrite Rules`（`settings/App.tsx:875-1181` + `InlineRuleEditor:430-642`）

### 3.1 现状（实测）

| 分区 | 行号 | 备注 |
|---|---|---|
| 工具栏 | 875-888 | 搜索（只匹配 `urlMatch.value` + `title`，`:855-859`）+ `+ New Rule` |
| 批量条 | 891-900 | Enable / Disable / Delete（**均无确认**） |
| New Rule 表单 | 902-1024 | 有正则校验（936-943）、**无 Enabled** |
| 表格 | 1026-1177 | 8 列；排序键**不含 `id`**（`:33`） |
| `InlineRuleEditor` | 1160-1166 渲染 | **无正则校验**（546-552）、**有 Enabled**（620-623）→ 与 New Rule **双向不等**（N19） |
| 空态 | 1169-1175 | 与"搜索无结果"**同文案**（N17） |
| Toast | 1179-1181 | `action` 从未使用（N11） |

**破坏性操作全景（实测）**：`🗑️` 行删除（`:1153-1155` → `:784-791`，**无确认、无 toast、失败静默**）｜批量 Enable/Disable/Delete（`:894-898` → `:826-836` / `:814-824`，**部分失败被 `catch { /* continue */ }` 吞掉**，`:819, 831`）｜**`selectedIds` 可能含不可见行**（N8）。

### 3.2 设计方向（S2-dir · Rules）

**D-11 · 表格列的重排：把"用户关心的"放前面** — ⚠️ **已由 IMP-9 / IMP-18 修订**
现状列序：`☑ / Icon / URL Pattern / Mode / Priority / Title / Enabled / Actions`（8 列）。
**最终裁决列序（IMP-9 + IMP-18）**：`☑ / Icon / Title / URL Pattern / Priority / Enabled / Actions`（**7 列**）——
- **`Title` 前移到第 3 位**（紧跟 `Icon`），使"结果"相邻靠前（**不合并单元格**，保留各自排序）；
- **`Mode` 列删除**（随 Q11 取消 `manual`）→ 连带 `SortKey` 去 `mode`、`colSpan` 8 → 7。

**D-12 · 删除与批量的"确认 + 如实反馈"（收口 ① F2 / ② N1）**
设置页**未 import `Confirm`**（N1）是根本原因。方向：把 `Confirm` 接入 Rules 与 Dashboard 的**全部破坏性操作**（行删除、批量删除、`Reset All` / `Reset Selected` / 行级 Reset），并**替换静默 catch 为如实 toast**（含**部分失败**："3 of 5 deleted · 2 failed"）。

**D-13 · `selectedIds` 与可见集的关系必须显式** — ⚠️ **本项在 Act 3 被漏登，已补裁决（D-13 = (a)）**
现状 `:893` 只显示数量、删除用全集（N8）→ **可能删除用户看不见的规则**。方向二选一：
- **(a) 自动裁剪**：过滤变化时把不可见的 id 移出选中集（简单、无意外）；
- **(b) 显式标注**：批量条显示 `5 selected (2 not visible)` 并给"仅操作可见项"开关（信息更全，但更复杂）。

**✅ 裁决（2026-10-02，Act 3 补登）= (a) 自动裁剪**
理由：与"所见即所操作"一致，无需新交互；`N8`（可能删除看不见的规则）**直接消除**。
**连带**：批量条的数量文案（深挖② §5.5）即为**可见集**的数量，不再需要"(2 not visible)"这类补充说明。
> **登记**：本项在 Act 3 的"全树自审"中**被漏登**（主文档仍写 OPEN 0），由规划期复核发现并补登 → 属**流程瑕疵**，非设计缺陷。

**D-14 · New Rule 表单与 `InlineRuleEditor` 合并为 `RuleFormFields` 的 `create` / `edit` 两模式（DT8）**
同时消除 N19 的**双向不等**：`Enabled` 归入"面特异"（仅 edit 面，显式登记）；正则校验由共享件提供（两模式都有）。

**D-15 · 空态分化（修 N16/N17）**
三态必须**视觉与文案都不同**：`尚未配置` / `搜索无结果（含"清除搜索"动作）` / `加载失败（含重试）`。

**D-16 · `InlineRuleEditor` 的展开体验（修 N13/N14）** — ✅ **IMP-15/16 已纳入本迭代**
展开后**焦点移入**首个字段；支持 `Escape` 取消（已在 `sidebar` 行内编辑存在，`:211-215`）；`expectedUpdatedAt` 的版本冲突提示保留。
**IMP-15/16 裁决**：抽**共享 hook `useExpandRow`**（展开集 + Escape + 焦点 + 焦点回归），**Rules 与 Dashboard 两处一并修**。

---

## 4. 界面 4 · `Data Dashboard`（`settings/App.tsx:1216-1684`）

### 4.1 现状（实测）

| 分区 | 行号 | 备注 |
|---|---|---|
| 标题 + 工具栏 | 1461-1473 | `Reset Selected` / `Reset All`（**无确认**，N9） |
| 表格 | 1476-1582 | 列：`☑ / Source+URL显隐 / Title / Icon / Actions` |
| 空态 | 1576-1582 | 与加载失败不可区分（N16） |
| Edit 面板 | 1587-1677 | **普通 `div`**，非 dialog、无 `aria-modal`、无焦点陷阱、**无 Escape** |
| 数据源 | 1251 (`GET_DASHBOARD`) | 生产端 `worker-orchestrator.ts:760-800` |

**Edit 面板的三处结构问题（实测）**：
1. **两个独立提交按钮** `Apply Title` / `Apply Icon`（`:1666-1671`）+ 一个纯关闭的 `Done`（`:1672-1674`）→ **用户不知道自己有没有保存成功**（两个都点？点 Done 会不会丢？）；
2. **`↺` 绕过 `editing` state**（`:1603-1606` 直接在 `entries` 里查 entry 后调 `resetEntryTitle`）→ 与"编辑草稿"模型不一致；
3. **行级 Reset vs 字段级 `↺` 语义不同**（① 已记）：`resetEntry` 用 `REMOVE_TAB_OVERRIDE`（**标题+图标一起清**，`:1292`）vs `resetEntryTitle` 用 `SET_TAB_OVERRIDE{title:''}`（只清标题，`:1362`）。

**图标清除的两套表示**：current-page `favicon: null`（`:1443`）vs slot `icon: {type:'url', value:''}`（`:1445-1448`）（N10）。

### 4.2 设计方向（S3-dir · Dashboard）

**D-17 · Edit 面板改为 Dialog 或抽屉（与 `Dialog` 原语对齐）** — ⚠️ **已被 IMP-4 取代**
原方向：改为 `Dialog` 或 `drawer`。**IMP-4 裁决**：**改为行内展开**（内嵌到表格对应行，`colSpan={5}`），**与 `InlineRuleEditor` 同形状、支持多行同时展开** —— 因此**不需要** `Dialog` / `drawer`，也不需要 Icon Editor 的 Dialog（行内即可容纳 `IconEditor`，`InlineRuleEditor:597-599` 已是此形态）。
> `drawer`（`settings.css:475-493`）因 **`z-index:300` < `Dialog` 的 400** 而不适用于本场景；该样式仍**零引用**。

**D-18 · Edit 面板改为 `FieldEditor` + **统一 `Save`**（DT10 裁决 A3）**
现状 `Apply Title` + `Apply Icon` + `Done` 三按钮的心智混乱。方向：**两个维度（Title / Icon）各一个 `FieldEditor`**，各自带 `Reset this edit`（`↺`，纯前端 —— 修改**草稿**）与 `Clear`（DT7，**立即写存储** + UndoBar）；**两个维度的"改值"统一由底部 `Save` 提交**（DT10）。
> 这条同时消灭"`↺` 绕过 `editing`"（`↺` 变为 `FieldEditor` 内部草稿操作，不再直连 `resetEntryTitle`）与"两套清除语义"（N10 由 DT7 的"本层清除 / 整链清除"取代）。
> **`Save` 的 disabled 条件**：`!dirty`（复用已存在但零引用的 `isDirty` 思路，N12）。

**D-19 · Dashboard 行内**直接嵌入链的四层值（A10 的 `chain`）**
现状表格只有 `Title / Icon` 两列**胜出值**。方向：每行的 `Title` / `Icon` 单元格改为 **`FieldEditor` 的只读态**（值 + 来源徽标 + 遮蔽标记），点击徽标**跳焦**到规则行（① F11）。**这样"为什么这个 tab 显示这个标题"在 Dashboard 一眼可见**。

**D-20 · 破坏性操作接入 `Confirm`（N1/N9）+ 空的 `Toast.action`（N11）** — ⚠️ **撤销机制已被 IMP-6 修订**
`Reset All` / `Reset Selected` / 行级 Reset 全部前置 `Confirm`（**不变**）。
**IMP-6 修订**：撤销**不**用 `Toast.action`（它全仓库零使用且与 `UndoBar` 并存 = 两套 UI），改为**泛化 `UndoBar` 为共享组件**（批次快照 + 文案 + 影响 tab 数），侧边栏与设置页共用。

**D-21 · 空态分化（N16）+ 受管配置清单的定位**
现状空态文案是 `No custom icons or titles set yet.`（`:1579`）—— 与 Q10 的"混合定位"（受管配置清单 + 折叠的受管标签页视图）不一致。方向：空态说明**内容从哪来** + 指向两个入口（侧边栏 Current Page / slot 菜单）。

---

## 5. 跨界面方向（4 条，取代 ① 的第 5 节）

1. **可发现性：把"双击 / 悬停 / 猜测"换成"常驻显式入口 + 显式原因文案"**（D-1 / D-8 / D-15 / D-16）—— 修 N4/N5/N13/N14/N16/N17。
2. **一致性的"构造保证"从数据延伸到交互**：① 的构造保证只覆盖**链的计算**；本文明确保**交互**也走共享件（`RuleFormFields` 两模式 / `FieldEditor` 两按钮 / 三态空态）—— 修 N19 与 D8/D12。
3. **破坏性操作**：一律"**确认（或 UndoBar）+ 如实反馈（含部分失败）**"，且**设置页必须开始使用 `Confirm`**（N1 是根因）—— 修 ① F1/F2 与 N8/N9。
4. **死代码清理**：`--tbs-*` 旧样式层（`shared/global.css`、`sidebar/sidebar.css`）**零引用**（N2）应随 Q13 的孤儿组件清理一并删除；否则"唯一 token 源"永远说不清。

---

## 6. 裁决结果（本层已收敛，**裁决 2 / 待裁决 0**）

### DT10 · 提交模型 = **A3 混合**（Dashboard 用统一 `Save`；侧边栏 / slot 就地编辑用立即提交）（用户裁决）

| 面 | 模型 | 理由 |
|---|---|---|
| **Dashboard Edit 面板** | **统一 `Save`**（一次提交两个维度） | 有明确"编辑面板"边界，用户预期"编辑完保存"；顺带启用**已存在却零引用**的脏态跟踪（N12） |
| **侧边栏 Current Page / slot 行内编辑** | **立即提交**（沿用现状：`onBlur` / 双击编辑保存） | 就地编辑、无面板边界，"保存按钮"会打断手感 |

**`Clear` 不受本模型影响 —— 一律立即提交**（DT7/DT9）：
- 理由①：**形态与逐字段改值相同**（在 `FieldEditor` 内点按钮），放进 `Save` 的草稿栈会**破坏"同操作同语义"**；
- 理由②：`Clear` 的 `UndoBar` 是**单一撤销单元**，草稿化后撤销栈要与 `Save` 的草稿栈**互相嵌套**（复杂度激增）。

**⚠️ 由此产生的一致性缺口（必须处理，是本裁决的代价）**：同一个 `FieldEditor` 内，**改值要按 `Save`、清除却立即生效** —— 两种时机在**同一面板**并存 → 必须**显式视觉区分**：`Clear` 紧贴其维度、标注"applies immediately"，并与底部 `Save` 在视觉上分离（否则用户会以为 `Clear` 也会等 `Save`）。

### DT11 · `null` 为「未设定」的唯一表示（用户裁决 — 一元化）

**决定**：写入侧**统一用 `null`**；**删除** slot 侧的 `{type:'url', value:''}` 空字符串路径（`settings/App.tsx:1296,1317,1341,1447`、`sidebar/App.tsx:1385`）。
**读取侧（A1-bis）**：`undefined` / `null` / `''` **一律判为未设定**（保留容错，防历史数据 / 云同步残留导致行为漂移）。
**收益**：收口 N10；`field-chain` 的判定与 UT 只需覆盖**一条**写入路径。
**风险**：云同步可能残留旧格式 → **读取侧容错必须保留**（不可假定写入侧一元化后读侧可收紧）。

---

## 7. 原裁决项（保留推导过程）

### OPEN-A（已裁决 → DT10）
| 选项 | 说明 |
|---|---|
| **A1 · 逐字段立即提交**（现状精神） | 每个 `FieldEditor` 改动即写存储 + 重投递（Q4）。优点：无"丢失未保存"风险；缺点：每次击键若不加防抖会放大投递（C4 已给 ~300ms 防抖）。 |
| **A2 · 统一 Save**（表单精神） | 面板底部一个 `Save`，一次提交两个维度。优点：心智简单、一次确认；缺点：需要**脏态跟踪 + 离开保护**（`DraftProtectionDialog` 已存在但**零引用**，N12）。 |
| **A3 · 混合**：Dashboard 用 A2（有明确"编辑面板"）、侧边栏/slot 用 A1 | 面特异，需显式登记。 |

### OPEN-B（已裁决 → DT11）
`settings/App.tsx:1445-1448` 与 `:1296` 用空字符串 icon，`:1443` 用 `null`（N10）。A1-bis 已规定 **`null` = 未设定** 为唯一表示 → **裁决：一元化为 `null`**，删掉"空字符串 icon"路径。

---

## 8. 遗留至 Detail / 计划（更新）

| 项 | 说明 |
|---|---|
| `EntityFieldRow`（D-2）的字段与形态 | label / 值 / `✎` / 徽标 / 来源标注 |
| 三段式密度断点的**具体阈值**（D-4） | 现仅 `299px` / `440px` 两处 |
| ~~`Matches N tabs` 常驻行的折叠阈值与 `N=0` 警告文案（D-7）~~ | ✅ **已关闭**：阈值 = **前 3 条**（**CT2**）；排序键 = `Tab N` 数字序；`N=0` 文案 = `No open tabs match right now`（**IMP-8** 的 8c，中性句） |
| Rules 表格列重排后的**默认排序与搜索范围**（D-11） | 搜索现只覆盖 `urlMatch.value` + `title` |
| `selectedIds` 裁剪策略（D-13） | 待裁决 (a)/(b) |
| Edit 面板容器选型（D-17） | `Dialog` vs `settings__drawer` |
| 提交模型（DT10） | Dashboard `Save` 的脏态跟踪；**`Clear` 与 `Save` 的视觉区分文案**（如 `applies immediately`）；`DraftProtectionDialog` 是否启用（当前零引用） |
| 一元化收尾（DT11） | 删 `{type:'url',value:''}` 写入路径的**顺序**（须先确认读侧容错已在 `field-chain` 覆盖，否则会漂移）；`import-export` 的旧格式兼容 |
| 三态空态（D-15/D-21）的**成品文案** | 4 处（Rules / Dashboard / 侧边栏 / 加载失败） |
| 死样式层清理（第 5 节 #4） | 需先确认 `shared/global.css` / `sidebar/sidebar.css` 无构建期引用 |
| 新增测试锚点 | `RuleFormFields` 两模式等价、`FieldEditor` 两按钮语义、三态空态、`Confirm` 接入、`selectedIds` 裁剪 |