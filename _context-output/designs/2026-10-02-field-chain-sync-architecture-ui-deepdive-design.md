# Architecture Deep-dive — The Four Rewrite UI Surfaces (UI/UX Review + Screen Specs)

**审查模式**：全量（范围：侧边栏 `New Global Page Rule` 弹窗、Page Rewrite Rules（含 New Rule / InlineRuleEditor）、Data Dashboard（含 Edit 子组件））｜**检查方式**：静态分析（未实跑）

> **上游**：Goal（Q1–Q14）+ Constraint（C1–C8 / RK-1）+ Architecture（A1–A12）
> **层**：🏗️ Architecture 深挖（版本化子文档）
> **日期**：2026-10-02 · **基线**：HEAD `a3d6ab3`

---

## ① 执行摘要

四个改写界面**共享同一批字段**（Match URL / Match Type / Title / Icon 三模式 / Priority），却由**彼此复制的实现**承载 —— 实测：**Title + Icon 块重复 4 处**、**Match URL / Match Type / Priority 各重复 3 处**（DT8 回填）。字段集、图标模式命名与提示文案已经开始分叉（`Icon URL`/`Custom Icon` vs `URL`/`Custom`），且**正则实时校验只存在于 3 处中的 2 处**（Inline 编辑器缺失 —— 第 14 项不一致）。更严重的是**破坏性操作缺少确认与失败反馈**：`Reset All` 一键清空全部自定义标题/图标且无撤销，规则删除同样无确认且**失败静默**。

> **计数更正**：原文写作"四份彼此复制的实现"，实测为**两类重复粒度**（Title/Icon 4 处、其余 3 处），已按此更正。

---

## ② 维度覆盖表

| 维度 | 状态 | 说明 |
|------|------|------|
| D1 第一印象与信息层级 | ⚠️ | Dashboard 无空状态；`Edit {entryId}` 以内部 id 作标题 |
| D2 操作反馈 | ⚠️ | 规则删除**失败静默**（`// silently fail`） |
| D3 状态可见性 | ⚠️ | 无投递状态（本迭代 A10 引入 `delivery` 前的空白） |
| D4 状态完整性与错误处理 | ⚠️ | `Reset All` / 删除规则**无确认**；Dashboard 无空态 |
| D5 流程与效率 | ⚠️ | 同一动作三处表单并存；批量操作无二次确认 |
| D6 弹窗与覆盖层 | ✅ | 侧边栏弹窗已用共享 `Dialog`（Escape/焦点陷阱/焦点还原） |
| D7 布局与响应式 | ➖ | 本次为交互/结构审查，未涉布局断点（归设计类） |
| D8 一致性与术语 | ⚠️ | 图标模式命名分叉；标题占位符两种写法；行级/字段级 Reset 语义不同 |
| D9 可发现性与认知负担 | ⚠️ | 影响面不可见（改前不知波及谁）；无跳焦 |
| D10 用户控制感与情绪 | ⚠️ | 不可逆清空无撤销；"改了不生效"无法自查 |
| D11 无障碍 | ⚠️ | 图标模式 radio 组缺少 `role="radiogroup"` 的**统一**标注（4 处不一致；**需 a11y reviewer 复核**） |
| D12 扩展就绪与易维护 | 🔧 | 图标三模式块 + "Reset→清空"提示在 4 处重复；存在孤儿 `RuleEditor.tsx` |
| D13 功能设计合理性 | ⚠️ | `Auto-apply on match`（manual）是**不可见地永不生效**的开关（本迭代 Q11 取消） |

---

## ③ 已证实问题（按严重度 → 影响面排序）

### [D4] 🔴 阻断 · 📄 单页(Page Rewrite Rules / Data Dashboard) — `Reset All` / `Reset Selected` 无确认、无撤销
- **位置**：`src/ui/settings/App.tsx:1467-1472`（按钮）、`:1308-1353`（`resetAll`/`resetSelected`）
- **证据**：两个按钮直接调用重置流程；**全文件无 `Confirm` 组件使用**（唯一 `Confirm` 字样是 `Confirm Import`，`:1811`），亦无撤销入口
- **用户视角**：一次误点即清空**全部**自定义标题与图标，没有二次确认、也没有撤销
- **影响**：用户配置整体丢失，且无法察觉是在哪一步丢的
- **改进方向**：破坏性批量操作加入与"删除槽位"一致的 `Confirm` 前置；并给出可撤销窗口
- **修复方案**：推荐（`Confirm` + `danger` 变体，文案写明将清除多少项）/ 备选1（改为"先列出将清除的 N 项 + 确认"）
- **参考**：D4 状态完整性与错误处理
- **相关标注**：与 `sidebar-slot-menu-delete` 已确立的"删除需确认"模式保持一致

### [D2/D4] 🟠 困惑 · 📄 单页(Page Rewrite Rules) — 删除规则无确认且**失败静默**
- **位置**：`:784-790`（`handleDeleteRule`）、`:814-822`（`handleBatchDelete`）、`:1153`（🗑️ 按钮）
- **证据**：`await sendMessage('DELETE_RULE', …)` 后直接刷新；`catch { // silently fail }` 与 `catch { /* continue */ }`
- **用户视角**：误点 🗑️ 规则即消失；若删除失败，界面**没有任何提示**，用户以为已删
- **影响**：数据与认知双重不一致（本地看着删了、后台可能没删）
- **改进方向**：删除前置确认；失败必须如实提示（复用既有 toast 机制）
- **修复方案**：推荐（`Confirm` + 失败 `toast`）/ 备选1（仅失败提示，不加确认）
- **参考**：D4（唯一定义维度）；D2 仅引用
- **相关标注**：无

### [D8/D9] 🟠 困惑 · 🌐 全站 — 同一批字段由**复制实现**承载，命名已分叉
- **位置**：`sidebar/App.tsx:572-798`（`CreateRuleModal`）、`settings/App.tsx:903-1023`（New Rule）、`:430-642`（`InlineRuleEditor`）、`:1587-1677`（Dashboard Edit）
- **证据**：图标三模式 radio 块重复 **4 次**；命名不一致——侧边栏为 `Icon URL` / `Custom Icon`（`:742,746`）而设置页为 `URL` / `Custom`（`:971,975`、`:1623,1631`）；`Reset` 提示 `Icon will be cleared and shown as "—".` 重复 3 次（`:767,996,1660`）；标题占位符两种写法（`Leave empty to keep original` vs `Custom Title (optional)` 标签 + 同占位符）
- **用户视角**：同一件事在不同入口的字段顺序、选项名、提示不同，需要重新学习；侧边栏与设置页对同一模式的叫法都不一样
- **影响**：跨入口认知负担；后续每加一个字段要改 4 处（易漏）
- **改进方向**：抽出**单一 `FieldEditor` 组件**承载"标题 + 图标（三模式）+ 按字段清除 + 来源徽标 + 遮蔽提示 + 影响面预览"，四入口复用
- **修复方案**：推荐（共享组件 + 统一命名 `URL` / `Custom` / `Reset`）/ 备选1（仅统一命名与字段顺序，暂不抽组件）
- **参考**：D8 一致性与术语（唯一定义维度）；D9 仅引用
- **相关标注**：与 Q13（共享编辑器）同向；关联实现 F10

### [D8] 🟠 困惑 · 📄 单页(Page Rewrite Rules) — 三个编辑面并存，其中一个是孤儿
- **位置**：`:903-1023`（顶部 New Rule 表单）、`:430-642`（行内 `InlineRuleEditor`）、`src/ui/settings/RuleEditor.tsx`（**src 无任何引用**，仅 `tests/unit/ui/rule-editor.test.tsx` 引用）
- **证据**：同一页面同时提供"顶部表单创建"与"行内展开编辑"；孤儿组件仍带着自己的创建弹窗与测试
- **用户视角**：两个表单看起来都能创建规则，不清楚差别；孤儿组件让人无法判断"哪个才是真的"
- **影响**：编辑心智分裂；孤儿测试给出**虚假覆盖率**
- **改进方向**：按 Q13 删除孤儿；把"创建"与"编辑"统一为同一组件的两个模式
- **修复方案**：推荐（删孤儿 + 创建/编辑共用组件）/ 备选1（保留两处但显式标注差异）
- **参考**：D8 / D12
- **相关标注**：历史遗留（`RuleEditor.tsx` 为早期实现）

### [D4/D1] 🟡 不爽 · 📄 单页(Data Dashboard) — 无空状态
- **位置**：`:1460-1584`（整个 Dashboard 区）
- **证据**：全文检索无空状态文案或空态分支；仅有 `:1462-1464` 的一句静态说明
- **用户视角**：新用户看到一张空表，不知道这里会出现什么、需要做什么才会出现内容
- **影响**：功能可发现性低（用户不会主动去侧边栏设置标题/图标）
- **改进方向**：空态给出"如何让内容出现"的一句话 + 指向操作入口
- **修复方案**：推荐（空态文案 + 指向侧边栏 Current Page / slot 的说明）/ 备选1（空态 + 直达按钮）
- **参考**：D4（唯一定义维度）；D1 仅引用
- **相关标注**：无

### [D3/D10] 🟡 不爽 · 📄 单页(Data Dashboard) — "改不动"的页面无从分辨
- **位置**：`:1460-1584`；配合本迭代 A10 的 `delivery` 字段（尚未存在）
- **证据**：现状 Dashboard 不区分"正常生效 / 受保护页 / 内容脚本未就绪 / 站点原值未知"
- **用户视角**：在 `chrome://` 或扩展无权限的页面设置了标题，Dashboard 看不出它**不会生效**；这与本轮 C3/C5 的"可观察状态"目标直接冲突
- **影响**："改了不生效"在 Dashboard 上**无法自查**——正是本轮要消灭的症状
- **改进方向**：按 A10 呈现 `delivery`（`ok` / `degraded` / `protected` / `unknown`）并在行内给出原因
- **修复方案**：推荐（行内状态徽标 + 悬停说明）/ 备选1（仅受保护页与降级显示，`unknown` 省略）
- **参考**：D3 状态可见性（唯一定义维度）；D10 仅引用
- **相关标注**：依赖 C3（降级）/ C5（受保护页）已定语义

### [D8] 🟡 不爽 · 📄 单页(Data Dashboard) — 行级 Reset 与字段级 `↺` 语义不同
- **位置**：`:1292`（行级 Reset → `REMOVE_TAB_OVERRIDE`，整行丢弃）对比 `:1600-1611`（字段级 `↺` → `resetEntryTitle`，单字段）
- **证据**：两者都表现为"重置"，但一个清整行（含图标）、一个只清标题
- **用户视角**：点行级 Reset 把图标一起清掉了，而字段级 `↺` 只清标题——同一个 `↺` 图标两种后果
- **影响**：误清数据；用户无法预测按钮效果
- **改进方向**：按 Q13 澄清统一为**按字段清除**（整行 Reset 拆为"清标题 / 清图标"）
- **修复方案**：推荐（按字段清除 + 明确的 `Clear title` / `Clear icon` 文案）/ 备选1（保留整行 Reset 但文案写明"同时清除标题与图标"）
- **参考**：D8 一致性与术语
- **相关标注**：与 Q13 的"按字段独立"一致

### [D9] 🟡 不爽 · 🧩 单组件(Data Dashboard Edit) — 以内部 id 作标题
- **位置**：`:1589` `Edit {editing.entryId}`
- **证据**：`entryId` 为内部标识（如 `cp-<tabId>`，由 `worker-orchestrator` 生成），直接渲染进 `h3`
- **用户视角**：标题显示 `Edit cp-123`，不是"当前页 (Tab 3)"这类可读标签
- **影响**：用户无法确认自己正在编辑哪一项
- **改进方向**：改用 `label`（如 `Tab 3` / `Slot 5`）作为标题
- **修复方案**：推荐（`Edit <label>`）/ 备选1（`Edit <label> (当前页)` 带来源）
- **参考**：D9 可发现性与认知负担
- **相关标注**：无

### [D12] 🔧 系统缺陷 · 🌐 全站 — 图标三模式块与清除提示在 4 处重复实现
- **位置**：`:736-769`、`:966-998`、`:1614-1662` 及侧边栏 `:736-769`
- **证据**：每处约 30 行的 radio + 条件输入 + 提示，逻辑相同、文案已分叉（见上条 D8 发现）
- **用户视角**：无直接不适（故此条归系统缺陷而非不爽）
- **影响**：每新增一个字段需改 4 处；分叉会持续扩大
- **改进方向**：抽 `FieldEditor`
- **修复方案**：推荐（共享组件）/ 备选1（仅抽图标三模式子组件）
- **参考**：D12 扩展就绪与易维护（基于静态结构推断）
- **相关标注**：与 F4 同根因，二者合并为一项行动

### [D13] 🟡 不爽 · 📄 单页(侧边栏 + Rules) — `Auto-apply on match` 是不可见地永不生效的开关
- **位置**：侧边栏 `:786-791`、Rules New Rule `:1010-1015`
- **证据**：取消勾选即写 `mode='manual'`，而链只筛 `mode==='auto'`（`rule-service.ts:357-365`）→ 该规则不参与任何改写；且 UI 无任何提示
- **用户视角**：建了规则、看着它躺在列表里，页面却毫无变化
- **影响**：典型的"改了不生效"；用户会怀疑扩展坏了
- **改进方向**：按 Q11 取消 `mode`（规则一律参与链，仅 `enabled` 控制）
- **修复方案**：推荐（移除该勾选）/ 备选1（保留但显式标注"仅作模板，不会自动生效"）
- **参考**：D13 功能设计合理性
- **相关标注**：与 Goal Q11 一致

### [D8] 🟡 不爽 · 📄 单页(Rules 行内编辑) — **正则实时校验只在 2/3 处存在**（**第 14 项不一致**，DT8 回填）
- **位置**：`settings/App.tsx:430-642`（`InlineRuleEditor`）
- **证据**：`Match Type = Regex` 时，侧边栏弹窗（`sidebar/App.tsx:697-709`，含 `wildcardToRegex` 自动转换提示）与 Rules 创建表单（`settings/App.tsx:935-943`）都会实时显示 `✓ Valid regex` / `✗ <message>`；**行内编辑器从 :546-551 直接跳到下一步，没有任何校验反馈**
- **用户视角**：同一个 `Match Type` 选项，两个表单会即时告诉你正则对不对，行内编辑**不会** —— 用户以为"这里没有校验"或"我的正则没问题"
- **影响**：非法正则在保存时才暴露（或静默失败），与 D2/D13 同族
- **改进方向**：由 DT8 的 `RuleFormFields` **共享校验**收口（顺带统一自动转换提示）
- **修复方案**：推荐（共享校验纯函数 + 共享提示组件）/ 备选1（仅给 Inline 补一段同样的内联块，仍存三份）
- **参考**：D8 一致性与术语
- **相关标注**：DT8 的收口收益之一

### [D9] 🔵 建议 · 📄 单页(Dashboard ↔ Rules) — 无跨面跳焦
- **位置**：`:1587-1677`（Dashboard Edit）与 `:1026-1177`（Rules 表）
- **证据**：两处互相不可达；本迭代 A10 的 `anchor`（`TierOwner`）尚未接入
- **用户视角**：在 Dashboard 看到"来自 rule 的值"，却无法跳到那条规则
- **影响**：排查链路来源需人工翻找
- **改进方向**：按 A10 用 `anchor` 实现跳焦 + 行高亮
- **修复方案**：推荐（徽标可点击 → 滚动并高亮目标行）/ 备选1（仅提供"在 Rules 中筛选"链接）
- **参考**：D9
- **相关标注**：依赖 A10

---

## ④ 未验证推断区（不进统计）

| 推断 | 为何未验证 |
|------|-----------|
| 图标模式 radio 组的键盘可达性与焦点顺序在 4 处是否一致 | 需实跑/需 a11y reviewer 复核；静态只能确认 `role="radiogroup"` 标注**不一致**（1 处缺失 `aria-label`），但**可否键盘操作**未验证 |
| `Reset All` 后浏览器端实际观感（是否立即消失、是否有中间态） | 需实跑 |
| 影响面预览在高命中规则（如 50 页）下的渲染性能 | 需实跑 |
| `Edit {entryId}` 在其他语言/长度下的溢出 | 需实跑 |
| 侧边栏弹窗在窄侧栏（~300px）下的字段可用性 | 需实跑（D7 未审） |

---

## ⑤ 跨维度综合建议（3–5 条，均引用 ≥2 维度）

1. **让破坏性操作可确认、可如实反馈**（D4 + D2）：`Reset All` / `Reset Selected` / 规则删除统一加 `Confirm`，失败必须 toast；当前"失败静默"会让用户以为已生效。
2. **把"标题+图标编辑"收敛为一个共享组件**（D8 + D12）：四份复制实现已经分叉（命名 `Icon URL`/`Custom Icon` vs `URL`/`Custom`），每加字段要改四处。
3. **让每个字段都能解释"当前值从哪来、为什么改不动"**（D3 + D9）：来源徽标 + 遮蔽提示 + `delivery`（受保护/降级/未知）+ 跳焦，把"改了不生效"从猜测变成可见事实。
4. **统一"重置"的语义**（D8 + D10）：行级 Reset 与字段级 `↺` 必须一致（按字段清除），否则同一个图标两种后果。
5. **补齐空态与不可读标识**（D1 + D4 + D9）：Dashboard 空态说明"内容从哪来"；`Edit cp-123` 改为人类可读标签。

---

## ⑥ 改进对照表模板（留空待填）

| 维度 | 问题数 | 待处理 | 已修复 | 已豁免 |
|------|--------|--------|--------|--------|
| D1 | 2 | | | |
| D2 | 2 | | | |
| D3 | 2 | | | |
| D4 | 4 | | | |
| D5 | 1 | | | |
| D6 | 0 | | | |
| D7 | ➖ | | | |
| D8 | 5 | | | |
| D9 | 3 | | | |
| D10 | 2 | | | |
| D11 | 1 | | | |
| D12 | 1 | | | |
| D13 | 1 | | | |

---

# 四个面的架构规格（本次深挖产出）

## S1 · 侧边栏 `New Global Page Rule` 弹窗（`sidebar/App.tsx:572-798`）— **DT1 决定保留就地弹窗**

| 项 | 决定 |
|---|---|
| 容器 | **保留**共享 `Dialog`（Escape / Tab 陷阱 / 焦点还原，D6 ✅ 不动） |
| 字段 | Match URL（带 `↺` 复位到预填）/ Match Type + 实时校验（含通配符自动转换提示）/ **Title** / **Icon 三选项** / Priority |
| **删除** | `Auto-apply on match` 勾选（Q11 取消 `mode`，同时消除 D13 的"永不生效开关"） |
| **新增** | **影响面预览**（Q8/Q9，**定稿**：`Matches 12 tabs · 3 masked` + **前 3 条** + `…and 9 more`；**IMP-8**：打开时查一次、改动后 `outdated`；`N=0` 用中性句 `No open tabs match right now`） |
| **复用** | **`RuleFormFields`**（DT8）+ 内含 `FieldEditor`（Title/Icon）→ 消除 D8/D12 的分叉 |
| 预填（DT4） | `Match URL` / `Match Type` / `Title` / `Icon` **四项全部带入上下文**；来源统一为**链**（A1）；**打开时快照一次**、打开期间不重算；显式标注 `From current page` / `From slot N` |
| 命名（DT2 + IMP-17b） | `Icon URL` / `Custom Icon` / **`Use chain`**（取代 `Reset`）——**侧边栏的显式命名成为全系统基准**；第三项原名 `Site original value` **已由 IMP-17b 改名**（它不适用于 Title，且字面暗示"站点原值"而实际可能显示 slot/rule 值） |
| 第三选项（DT5/DT6） | 与 icon 对称，**Title 也有三选项**；语义 = 本层不设值 → 回落（旁注 `Clears this layer — the value falls back to the next one in the chain.`） |
| `↺` / `Clear`（DT7） | `↺` = 复位到**本层基准**（纯前端，不再是"复位到链的胜出值"）；`Clear` = 清空该维度整条链 |
| **创作态约束（DT5/DT7）** | 链中 `rule` 层是**既有**规则、**不含正在创建的这条** → 须标注 `This rule is not saved yet`；`Clear` 须**禁用或仅清 `rule` 层** |
| 宽度约束（D7 遗留） | 侧边栏 ~300px：`RuleFormFields.View` 把 Title/Icon 折叠为**两行摘要** |

## S2 · Page Rewrite Rules（`settings/App.tsx:644-1184` + `:430-642`）

| 项 | 决定 |
|---|---|
| **删除孤儿** | `src/ui/settings/RuleEditor.tsx` + `tests/unit/ui/rule-editor.test.tsx`（Q13） |
| **创建/编辑统一** | New Rule 表单与 `InlineRuleEditor` 合并为**同一组件的两个模式**（create / edit，即 `RuleFormFields`）→ 字段集/校验/文案**构造保证一致**。**⚠️ IMP-3 补充**：**位置形状有意保留差异**（新建在顶部内联、编辑在行内）—— Q13 只要求"共用组件"，**未要求位置统一**；两处布局本就同源（都用 `.tbs-settings__rule-form-grid`，`settings.css:524-529`） |
| **新增：展开体验（IMP-15/16）** | 抽共享 hook **`useExpandRow`**（展开集 + `Escape` 取消 + 展开后焦点移入 + 收起后焦点回归）；Rules 与 Dashboard **共用** |
| **新增：删除确认** | 单选 + 批量删除前置 `Confirm`（F2） |
| **修正：失败提示** | 替换 `// silently fail` / `catch { /* continue */ }` 为如实 toast（F2） |
| **修正：不展示内部 id** | 表格与 `aria-label` 改用可读标签（F3） |
| **修正：补齐正则校验** | Inline 编辑器**缺**"实时正则校验与自动转换提示"（**第 14 项不一致**，`sidebar/App.tsx:697-709` 与 `settings/App.tsx:935-943` 有、Inline 无）→ 由 `RuleFormFields` 的共享校验收口（DT8） |
| **新增：影响面预览** | 规则命中集合（Q8/Q9，**多命中维度**，A3） |
| **新增：跳焦入口** | 接收 A10 的 `anchor` → **定稿（深挖③ F1/F1b/F2）**：滚动 + **临时高亮 ~2s**（`reduced-motion` 降级**保留高亮** + **非视觉播报**）；**不自动展开**；目标被搜索筛掉时走**回退链**（表格第一行 → 搜索框），**回退不高亮 + 如实说明** |
| 保留 | 表排序 / 搜索 / 批量启用禁用删除 / `expectedUpdatedAt` 版本冲突提示 |

## S3 · Data Dashboard（`settings/App.tsx:1216-1684`）

| 项 | 决定 |
|---|---|
| **数据源** | 改为 A10 的 `DashboardRow[]`（`kind: 'override'｜'slot'｜'rule-hit'`，含 `chain` 与 `delivery`） |
| **新增：逐节点值** | 每行展示 A1 的 `ChainResult`（title / icon **各一份**），每个节点带 `owner` |
| **新增：来源徽标 + 跳焦** | 徽标可点击 → 按 `owner` 跳焦（rule → Rules 表行）（F11） |
| **新增：遮蔽标记 + 一键清除** | 由 A1 的 `masked` 驱动；文案**已定稿**（深挖②）：`Overridden by Slot 5` / `Clear the page setting` |
| **新增：`delivery` 呈现** | `ok` / `degraded`（C3）/ `protected`（C5）/ `unknown`（Q14 `—`）（F7） |
| **新增：折叠的「受管标签页视图」** | rule 命中页按 tab 成行；**可编辑 → 追加为受管配置项**（Q10） |
| **变更：Reset 语义** | 行级 Reset 拆为**按字段清除**（Q13 澄清，F8） |
| **变更：Edit 标题** | `Edit {entryId}` → `Edit {label}`（F9） |
| **新增：空状态** | 说明"内容从哪来 + 去哪设置"（F6） |
| **新增：确认** | `Reset All` / `Reset Selected` 前置 `Confirm`（F1） |
| 保留 | 排序（label/title）/ URL 显隐 / 选中集 / `storage.onChanged` 自动刷新 |

## S4 · 共享编辑件（架构新增件，唯一实现）—— **两层**（DT8 回填）

> **回填依据**：Detail 层 `2026-10-02-field-chain-sync-detail-interaction-copy-design.md` DT4–DT9。

### S4a · `FieldEditor`（字段编辑器 = Title 维度 / Icon 维度，**title 与 icon 各自实例**）

```ts
/** 维度值的模式模型（DT5 回填：title 不再是裸字符串） */
type FieldMode =
  | { kind: 'set'; value: string }              // URL 文本 / Custom 渲染后的 data URI
  | { kind: 'use-chain' };                      // DT6：本层不设值 → 回落下一层（原 `Reset`）

interface FieldEditorProps {
  field: 'title' | 'favicon';           // Q13：两条独立链，逐字段渲染
  mode: FieldMode;                      // DT5 回填：取代原 `value: string | IconConfig`
  onChange: (next: FieldMode) => void;
  /** DT7：除 `use-chain` 外的图标专属载荷（Custom 的 IconConfig 等） */
  iconConfig?: IconConfig;
  onIconConfigChange?: (next: IconConfig) => void;
  /** DT7：即使模式为 `use-chain` 也要保留用户上一份编辑（供切回时还原） */
  lastValue?: FieldMode;
  chain: ChainResult;                   // A1：驱动徽标 / 遮蔽 / 逐节点值
  /** 编辑基准 = 打开时**本层**已保存的值（DT7 的 `↺` 复位目标） */
  baseline: FieldMode;
  onResetEdit: () => void;              // DT7 ①：纯前端复位到 `baseline`，**不写存储**
  onClearChain: () => void;             // DT7 ②：清空该维度**整条链**，**写存储 + 重投递**
  clearing?: boolean;                   // DT7 ②：写存储期间禁用
  onClearMaskingOverride?: () => void;  // Q7：一键清除遮蔽
  impact?: ImpactPreview;               // Q8/Q9：影响面预览（DT9：Clear 场景须**默认展开**）
  submitMode: SubmitMode;               // DT12：immediate | draft（**Clear 恒立即生效**）
  disabled?: boolean;
}

/** DT12：提交模型（A3 混合 —— Dashboard 用 draft，侧边栏/slot 用 immediate） */
type SubmitMode =
  | { kind: 'immediate' }
  | { kind: 'draft'; dirty: boolean; onDraftChange: (d: boolean) => void };

**新增（IMP-7 回填）**：`canClearChain?: boolean`（**由 `FormScene` 派生的显式能力**，**不得**由组件内按调用方判断）—— `rule-create` 场景为 `false`（**不渲染 `Clear`**），`rule-edit` / `field-edit` 为 `true`。
> 合规要求：`canClearChain` 的取值**只允许**来自 `deriveCapabilities(scene)`，**不得**由各调用点手写布尔（否则违反 DT1 的"不设隐式默认 / 不得按调用方分支"）。

**内含（唯一实现）**：
1. 字段输入（title 文本框 / icon 的 `Icon URL` 文本 或 `Custom Icon` 编辑器）；
2. **三选项 radiogroup**：`Icon URL` / `Custom Icon` / **`Use chain`**（DT2/DT3，**IMP-17b 改名**；四入口命名统一 —— **不再有 `URL` / `Custom` / `Reset` / `Site original value` 的分叉**）；
3. **`Reset this edit`（`↺`）** —— 复位到 `baseline`，纯前端（DT7 ①）；
4. **`Clear`（🗑，新增）** —— 清空该维度整条链，写存储 + 重投递，免确认 + `UndoBar`（DT7 ② / DT9）；
5. 来源徽标（可点击跳焦）+ 遮蔽提示与清除入口（Q7）；
6. 影响面预览；**`Clear` 作用时以"将被删除的全局配置本身"为第一信息、默认展开**（DT9 硬约束）；
7. **创作态**：链中 `rule` 层是**既有**规则、**不含正在创建的这条** → 须标注（DT5 警告）；`Clear` 须**禁用或仅清 `rule` 层**（DT7 约束 ②）。

**被 4 个入口复用**：侧边栏弹窗、Rules 创建、Rules 行内编辑、Dashboard 编辑（+ 未来任意新入口）。

### S4b · `RuleFormFields`（规则表单字段集，DT8 新增）

```ts
interface RuleFormFieldsProps {
  offset: 0 | 1;                        // Priority 旋钮（本迭代已定型，非 0/1 变体）
  value: RuleFormValue;
  onChange: (next: RuleFormValue) => void;
  variant: 'create' | 'edit';           // 仅两态（Dashboard 面不用本组件）
  /** DT4：上下文预填 = 链胜出值 + 来源标注 */
  prefill?: { source: 'current-page' | 'slot'; slotId?: number };
  fieldEditor: 'title' | 'favicon' | 'both';
  /** DT9：Clear 场景的预览必须默认展开 */
  impactDefaultExpanded?: boolean;
  onSave: () => void;
  onCancel: () => void;
}
```
**内含**：`Match URL`（+ `↺` 复位到预填）+ `Match Type`（**含共享的正则实时校验**，收口第 14 项不一致）+ `FieldEditor`（子件，S4a 接口不变）+ `Priority`。
**服务**：S1 侧边栏弹窗、S2 创建 / 行内编辑。
**不含**：`Enabled`（仅 `settings/App.tsx:620-623` 独有 → 保持面特异，显式登记为 DT1 代价例）；`Auto-apply on match`（随 Q11 删除）。
**View（Detail 回填待定）**：`RuleFormFields.View` 把 title/icon 用 `<Summary>` 折叠为**两行摘要**（侧边栏宽度受限）；Rules 面用完整布局。

---

## 遗留至 Detail

| 项 | 说明 |
|---|---|
| 英文成品文案 | ✅ **已定稿**（深挖② `detail-copy-a11y-design.md` §0–§5）：基准（sentence case + 标签 Title Case）、术语统一表（`clear` vs `reset`）、`Use chain` 两态旁注、`Reset this edit` / `Clear title` / `Clear icon` / `Applies immediately`、徽标四态（`Page` / `Slot N` / `Rule` / `Site`）、`Overridden by …` / `Clear the page setting`、`Can't rewrite this page` / `Limited: can't restore the site value`、`Matches 12 tabs · outdated` / `No open tabs match right now` / `Show all`、`This will clear:` / `Tabs will fall back to the site value.` / `Nothing to clear`、四态空态 ×4 界面、失败反馈 6 条（含 `Deleted 3 of 5 · 2 failed`）/ `Cleared 3 layers · 12 tabs affected` |
| a11y 复核项 | 图标模式 `radiogroup` 标注统一（4 处不一致）；`Confirm` 的焦点管理；影响面折叠的 `aria-expanded`；**`Clear` 免确认后必须给 `sr-only` 状态播报 + `UndoBar` 键盘可达**（DT9） |
| 影响面预览的阈值 | 前 3 条与折叠阈值的最终取值 |
| 跳焦实现方式 | 跨 Section 滚动 + 高亮 + 是否自动展开该行内联编辑 |
| 4 入口一致性验收 | 字段集 / 校验 / 文案 / 徽标 / 预览在四处的等价断言 |
| 空态与 `delivery` 的组合 | 空态 vs "有行但全 degraded" 的区分 |