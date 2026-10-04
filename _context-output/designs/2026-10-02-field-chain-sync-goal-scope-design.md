# Goal Layer — Field Chain Correctness, Three-View Sync & Rewrite UI Redesign

> **迭代范围**：单一整体迭代 = A（正确性）+ B（重定优先级并触发重应用）+ C（流程）+ D（界面）
> **日期**：2026-10-02 · **基线**：HEAD `a3d6ab3`
> **层**：🔍 Goal
> **决策**：Q1–Q14（14 项），**OPEN：0**
> **关联既有设计**：`2026-07-14-*-design.md`（6 份）、`2026-09-30-slot-switch-consistency-*`（5 份，上一迭代）

---

## 1. Mission

让 **title / icon 的优先级链成为"唯一真源 + 唯一实现 + 可解释可清除"**，并把「改了不生效」这一类用户可感知缺陷彻底消除；同时让 Current Page / slot / Data Dashboard 三个视图**按同一链派生**、能显示来源与遮蔽、并提供一键清除。

**为什么**：侦察（13 项实测不一致）证明当前链有**两份实现**（UI 手抄且漏协议校验）、**排序三份**、**注释与代码相反**，且**4 条写入路径"改了不投递"** —— 用户点 Reset / 改 slot URL 后已开标签页纹丝不动。

---

## 2. Scope

### IN
- **A 正确性**：链收敛为单一共享纯函数；消除"改了不生效"（不投递 / 清除无效 / 静默清空标题 / 注释漂移）
- **B 优先级与重应用**：链固定 `override > slot > rule > site`（**title 与 icon 各一条独立链**），并在 override/slot/rule 写入后**触发重算+重投递**
- **C 流程**：影响面预览（编辑期）+ 权威汇总（提交后）；保存覆盖保持**有意非对称**；manual 规则取消
- **D 界面**：Page Rewrite Rules、Data Dashboard、New Global Page Rule、共享标题/图标编辑器

### OUT（明确不做）
- 不新增 npm 依赖；不新增 permission / host_permission / command
- 不改 incognito / 特权页拦截模型（沿用现有 `isAllowed()` / `isProtectedUrl` 语义）
- 不改槽位匹配策略模型（上一迭代刚定型的三旋钮四格）
- 不做 i18n 框架（界面统一英文）
- 不改 Lock 的"内存态、不持久化"语义

---

## 3. Success Criteria

| ID | 判据 |
|----|------|
| SC1 | title 与 icon **各有一条独立链**；任一层改动后，**三个视图与 background 投递值一致**（同一纯函数，构造保证） |
| SC2 | 任何会改字段的写入（override / slot / rule / Dashboard 编辑与 Reset）落存储后**必然触发**对受影响标签页的重算+重投递（含**显式清除**） |
| SC3 | 「清除」= **回落到链的下一层**；全部清空后**还原站点原值**（标题快照 / 图标靠不删原 link），**不再出现"清空标题"或"图标消失"** |
| SC4 | 三视图均显示**按字段独立**的来源徽标 + 遮蔽标记 + 一键清除；徽标**可点击跳焦**到对应配置行 |
| SC5 | slot 的"对应 tabId"由 `Strategy + MatchType + MatchURL`（复用 `resolveSwitch`）推算；**rule 编辑走多命中维度**；位置槽取已记录 binding |
| SC6 | `mode='manual'` **取消**：规则一律参与链，仅 `enabled` 控制开关 |
| SC7 | 保存覆盖的**非对称**（快捷键 Confirm / 侧边栏静默+UndoBar）被显式标注为**有意设计** |
| SC8 | 改写界面共用**共享编辑件**：`RuleFormFields`（Match URL / Match Type / Priority）+ `FieldEditor`（Title / Icon）**两层**（DT8）；孤儿 `RuleEditor.tsx` / `DualCards.tsx`（含其专属测试）**删除**。**⚠️ 已登记例外（IMP-3 / IMP-7）**：① **位置形状**有意保留差异（Rules 新建在顶部内联、编辑在行内）；② **`Clear` 能力**在 `rule-create` 面**不渲染**（由 `FormScene` 派生）—— 二者均为**有意设计**，非分叉 |
| SC9 | 既有测试无回归；`typecheck` 0；lint **delta-0**；三浏览器 build 通过 |

---

## 4. 术语

| 术语 | 定义 |
|------|------|
| **链 / chain** | `override > slot > rule > site` 的字段解析顺序；**title 与 icon 各自一条** |
| **节点 / tier** | 链上的一层：`override` / `slot` / `rule` / `site` |
| **遮蔽 / masked** | 某行所属层的值**存在但不是当前胜出值**（被更上层盖住） |
| **清除 / clear** | 删除某一层的值 → 重算 → **回落到下一层**；全部为空 → 还原站点原值 |
| **结算 / settle** | 清除后链落到 `site` 层 → 走"还原站点原值"投递模式 |
| **受管配置项** | override 项、显式设置过标题/图标的 slot 项、**被 rule 遮蔽的页面** |
| **对应 tabId** | slot 的"切换会落到哪个 tab"（`resolveSwitch` 推算或 binding） |

---

## 5. Decisions（Q1–Q14）

### Q1 · 迭代范围
**决定**：**A + B + C + D 全组合**。
**理由**：侦察证明"改了不生效"（#2/#3/#4）是**非 UI 缺陷**，只做界面（D）会把它留在原地；B（重定/触发重应用）正是这些缺陷的修法。
**影响**：单一设计文档 → 单一计划。

### Q2 · 「同步」的语义 = 纯派生（只读重算）
**决定**：编辑动作**只写它所属的那一层**（Current Page → override；slot → `uiMarker`）；三视图**都从链重算显示值**，**不做跨层写入**。slot 的"对应 tabId"由 `Strategy + MatchType + MatchURL` 推算用于定位。遮蔽用「来源徽标 + 覆盖提示」呈现，并**提供一键"清除遮蔽它的 override"**。
**否决**：双向写传播（把"改这一个标签页"静默放大成"改该槽全局"，作用域失控且不可逆）；派生 + 显式同步（保留为可选动作，非默认）。
**影响**：无需写传播；"同步"= 消灭三份重复解析 + 统一链。

### Q3 · slot 的「对应 tabId」
**决定**：**模拟一次真实切换**（复用 `resolveSwitch`）取唯一 tabId —— 有 binding → `binding.tabId`；无 binding → `candidates[0]`（排序后首个）。**位置槽不推算**，直接用**已记录的 binding**（其切换依赖"记录的 tabId + 活动页 + 方向"）。
**依据（用户）**：override/slot 的修改是**唯一 tabId 维度**，而 **rule 是按多个命中标签页维度**。
**否决**：候选集合成员判定（多值会让 Dashboard 联动标注随排序抖动）。

### Q4 · 重算 + 重投递的触发
**决定**：**收敛为单一服务入口 + 显式调用**。所有改字段的写入路径（Current Page override、slot 标题/图标/URL、Dashboard 编辑与 Reset、rule CRUD）在**落存储后统一调用** `recomputeAndRedeliver(affectedTabIds)`：内部用**共享纯函数**算字段 → 对受影响已开标签页投递（**含显式清除语义**）。受影响范围：override/slot → **唯一 tabId**；rule → **所有命中该 rule 的标签页**。
**否决**：纯事件驱动（写入方无法表达"这是清除"，清除语义会继续只在部分路径生效）；各写入方自理（即现状，正是缺陷来源）。

### Q5 · 共享字段链的位置
**决定**：抽成 **`src/shared/field-chain.ts` 纯函数**，输入 `{ sync, local, tabId, tabUrl }`，输出节点值 + 胜出值 + 来源 + 遮蔽信息；**background 与 UI 都 import**。rule 排序改为复用既有 `sortRulesByPriority` / `selectWinningRule`（`url-utils.ts:457-471`）。UI 侧用**内存 state 同步计算**（无异步、无往返）。
**否决**：保留在 background + 新增 `COMPUTE_FIELDS` 消息（侧边栏是高频路径，每次 `onActivated`/`onUpdated` 都往返一次）；保留两份 + 锁步测试（只能事后发现分叉）。
**影响**：一处实现 ⇒「视图显示值 = 实际投递值」成为**构造保证**；顺带修掉 UI 侧缺协议白名单。

### Q6 · 「清除 / Reset」的语义
**决定**：**回落下一层 + 站点原值还原**。
- "原值" = **链的下一个值**（清除 override → 回落到 slot；slot 也为空 → rule；全空 → `site`）
- 落到 `site` 时：标题用**页面作用域快照**还原（随导航失效）；图标靠**插入更高优先级 link 而不删原 link**，清除时自然回落
**否决**：只"停止干预"（标题半场不可靠：多数站点不会重设 title）；维持清空行为（Reset 后标题变空、图标消失，比不清除更糟）。
**影响**：只需两种投递模式 `apply` / `restore-site`；顺序（先删后算）即语义，**无需额外排除逻辑**。

### Q7 · 三视图的呈现
**决定**：**三视图一致** —— 显示值旁标注来源徽标（`override`/`slot`/`rule`/`site`）；当**实际显示值不来自本行所属层**时显示"被 override 遮蔽"+**一键清除该遮蔽 override**；Current Page 与 Dashboard 同样给徽标与清除。
**附加（用户）**：**编辑标题/图标时在旁标注会影响哪些 Current Page / override / slot**。
**否决**：只在 Dashboard 集中呈现（用户察觉问题的地方没有解法）；仅 toast 提示。

### Q8 · 影响面标注的时机
**决定**：**C（两者都要）** —— **A 编辑期行内实时预览**（commit 前，紧贴输入框）+ **B 提交后权威汇总**（toast/通知，来自 Q4 返回的受影响集合）。
**已知并接受**：A 是**预测**（基于当前快照），编辑期间标签页变化会让预测与实际不同；**B 为权威**。

### Q9 · 影响面列表的粒度
**决定**：**计数 + 前 3 条 + 折叠展开**（如 `Matches 12 tabs · 3 masked` + 前 3 条带徽标 + `…and 9 more (expand)`；展开后内联逐条含"清除遮蔽"入口）。
**否决**：只给计数 + 跳 Dashboard（打断编辑流）；全部内联（规则命中多页时拖慢渲染、淹没表单）。

### Q10 · Data Dashboard 的定位
**决定**：**混合** ——
- 保留 **受管配置清单**：override 项 + **显式设置过标题/图标的 slot** + **被 rule 遮蔽的页面**
- 每项展示**链上每个节点的值**（+ 来源徽标 **可点击跳焦**到对应配置行：rule 节点 → Page Rewrite Rules 的对应行 + 遮蔽标记）
- 新增**折叠式「受管标签页视图」**：以 tab 为行，同样的链结果；**可单独编辑 rule 命中页**；编辑后**在该 tabId 的配置项末尾追加一条受管配置**
**否决**：只做"按 tab 的统一视图"（会丢失"我只想看我设置过什么"的定位）；纯配置清单（rule 命中的页面看不到，即 #11）。

### Q11 · 规则 `mode`（Auto / Manual）
**决定**：**取消 `manual`** —— 规则**一律参与链**，仅 `enabled` 控制开关；`mode` 字段删除；`APPLY_RULE_TO_TAB` 的孤儿路径一并收敛。
**理由**：`manual` 目前**不可见地永不生效**（除一个无 UI 的动作），属"改了不生效"同族；取消后"规则 = 生效的改写，`enabled` = 开关"**一名一义**。

### Q12 · 保存覆盖的流程（**维持原样，升格为有意设计**）
**决定**：**保持非对称** —— 快捷键保存到已占用槽位**弹 Confirm**（快捷键可能未开侧边栏，用户看不到将被覆盖的内容）；侧边栏保存**静默覆盖 + 5 秒 UndoBar**（用户主动点击）。
**影响**：须在代码与设计文档中**显式标注为有意**，防止后续被误当不一致修掉。

### Q13 · 编辑入口与孤儿组件
**决定**：**收敛为共享编辑件 + 删除孤儿** —— 抽出**两层**共享件（DT8）：`RuleFormFields`（`Match URL` / `Match Type` / `Priority`）+ `FieldEditor`（标题 / 图标；同字段、同校验、同影响面预览），供各改写面复用；**删除** `src/ui/settings/RuleEditor.tsx` 与 `src/ui/sidebar/DualCards.tsx`（及其专属测试）。
**附加（用户）**：**title 链与 icon 链独立**，**不共享**。
**影响**：徽标 / 遮蔽 / 影响面 / 清除**均按字段独立计算**；顺带统一 Dashboard 的**两套 Reset 语义**为**按字段清除**（整行 Reset 拆为"清标题 / 清图标"）。

### Q14 · `site` 节点的值来源
**决定**：**内容脚本回报站点原值** —— 首次改写时把站点原值（title + 原 favicon link）**回报 background**，存于 `local` 的**临时、按 tabId、随导航/关闭失效**记录；Dashboard 的 `site` 节点读它；**未捕获显示 `—`**。
**否决**：读 `tab.title`（自证循环：显示的是我们自己的改写）；不展示 `site` 节点（答不出"全部清除后我会看到什么"）。
**依据**：`tabs.query()` 的 `tab.title` 在改写后已是我们写入的值，站点原值只在页面上下文可见。

---

## 6. 关键原始证据（侦察 13 项实测不一致，供下层定位）

| # | 不一致 | 证据 |
|---|--------|------|
| 1 | 链实现**两份**（UI 手抄、漏协议白名单） | `rule-service.ts:345-406` vs `App.tsx:1497-1528` |
| 2 | rule 胜出排序**三份**，未用共享函数 | `rule-service.ts:360-363`、`App.tsx:1521`、`:1767` |
| 3 | **注释与代码相反**（注释称 slot > override） | `rule-service.ts:321-325`、`worker-orchestrator.ts:944`、`App.tsx:1494` |
| 4 | 清除**只在 executeScript 生效**（fallback 把 `null`→`undefined`；主路径不读 `force`） | `apply-fields.ts:157`、`content/index.ts:234-241`、`apply-fields.ts:22-108` |
| 5 | "清除标题"实为**清空** `document.title=''`，注释却称"restore site title" | `apply-fields.ts:29,32` vs `:31` |
| 6 | `REMOVE_TAB_OVERRIDE` **不重投递**（`SET` 会）→ Dashboard Reset 对已开页无效 | `rule-service.ts:563-567` vs `:574-576`；`settings/App.tsx:1292` |
| 7 | `UPDATE_SLOT_URL` **不重投递**，而 `UPDATE_SLOT_UI_MARKER` 会 | `worker-orchestrator.ts:704` vs `:674` |
| 8 | **两种覆盖 UX**（快捷键 Confirm / 侧边栏静默）→ Q12 定为有意 | `worker-orchestrator.ts:183-207` vs `slot-service.ts:56-102` |
| 9 | 同一 Dashboard **两套 Reset 语义** | `settings/App.tsx:1292` vs `:1362` |
| 10 | **孤儿**：`RuleEditor.tsx`、`DualCards.tsx` 在 `src/` 无引用 | 仅测试引用 |
| 11 | 投递**无按 tab 排序**（`CONTENT_NAVIGATION` force=false 与 `onUpdated` force=true 竞争） | `worker-orchestrator.ts:942-956` |
| 12 | Dashboard **不展示 rule/site 来源**（纯 rule 生效的页面不出现） | `worker-orchestrator.ts:772-797` |
| 13 | `APPLY_RULE_TO_TAB` **绕过链**且 UI 不可达 | `rule-service.ts:478-481` |
| — | `manual` 规则**永不参与链** | `rule-service.ts:357-365` |
| 14 | **正则实时校验只在 3 处中的 2 处**（规则行内编辑器缺失） | `sidebar/App.tsx:697-709`、`settings/App.tsx:935-943` 有；`settings/App.tsx:546-551`（Inline）无 |
| 15 | `↺` 按钮**三种后果**（复位到已保存值 / 复位到链的胜出值 / 直接清除） | `settings/App.tsx:565,538` vs `sidebar/App.tsx:727` vs `settings/App.tsx:1605` |
| 16 | 站点 favicon（`http(s)`）被误判为 `Custom Icon` 并持久化为 `type:'upload'` | `sidebar/App.tsx:579,582,1314`；`IconEditor.tsx:50` 掩盖 |

### 既有测试锚点（重设计会触碰，需登记或迁移）
`rule-apply-persistence.test.ts`（链的权威测试）、`tab-override-fix.test.ts`、`rule-delivery-robust.test.ts`、`rule-delivery-real-dom.test.ts`、`sidebar-slot-tier-display.test.tsx`、`rule-save-chain.test.ts`、`rule-version-check.test.ts`、`conflict-overwrite.test.ts`、`url-utils.test.ts:271-301`（排序/冲突矩阵）、`rule-editor.test.tsx` 与 `dual-cards.test.tsx`（**孤儿组件测试，将随组件删除**）

---

## 7. 遗留至下层（不得遗漏）

| 归属层 | 遗留项 |
|--------|--------|
| 🔒 Constraint | 权限零扩张（回报原值不新增权限）；`isProtectedUrl` 在投递路径的覆盖（现仅 tier-local）；清除/还原对**受限页面**（fallback 路径）的可行性与降级；`site` 快照的**隐私**（是否只存 title/link、是否含 URL）；性能（高频重投递的节流）；a11y（徽标/遮蔽提示/折叠列表） |
| 🏗️ Architecture | `field-chain.ts` 的**形状**（四节点值 + 胜出 + 来源 + 遮蔽，**title/icon 各自**）；`recomputeAndRedeliver` 的**位置与闸门**；两种投递模式 `apply`/`restore-site` 的协议；**每 tab 投递排序/去重**（修 #11）；`local` 新增 `siteSnapshot` 与**失效时机**；`mode` 字段删除与 `APPLY_RULE_TO_TAB` 收敛；Dashboard 数据源改为"配置 + 链"；**跳焦**机制（跨页定位到规则行）；`GET_DASHBOARD` 形状演进 |
| 📐 Detail | ✅ **已全部关闭** —— 成品文案（深挖②：徽标四态 / 遮蔽 / 清除 / 影响面 / 折叠 / `—` 呈现）；共享边界（DT8 / IMP-3）；`New Global Page Rule`（DT4–DT7 + IMP-1/2/7/8）；4 入口一致性（DT1 三要素 + 例外登记）；🔴 **修订本项**：**受影响集合上限 = 前 3 条**（深挖② CT2，**非**"上限与折叠未定"）；测试分层 → 计划阶段 |