# Detail Layer — Sidebar In-place Modal, Shared Editor Boundary & Icon Option Redesign

> **上游**：Goal（Q1–Q14）+ Constraint（C1–C8 / RK-1）+ Architecture（A1–A12）+ Architecture UI deep-dive（S1–S4）
> **层**：📐 Detail（**WIP**）
> **决策**：DT1–DT12（**已收敛**），**OPEN：0**，**待裁定：0**
> **日期**：2026-10-02 · **基线**：HEAD `a3d6ab3`
> **回填状态**：**①–⑤ 已全部完成**（2026-10-02）—— S4a/S4b 模式模型 + `onClearChain` + `submitMode`、A1-bis/A4-bis、S1 字段表、第 14 项不一致、双层组件地图
> **下游**：四界面 UI/UX 设计方向见 `2026-10-02-field-chain-sync-architecture-four-surfaces-ui-direction-design.md`（D-1..D-21 + DT10/DT11）；**成品文案与 a11y 写法见 `2026-10-02-field-chain-sync-detail-copy-a11y-design.md`**（深挖②，CT1–CT4，✅ 已完成）；**校验边界 / 跳焦 / 空态×delivery 见 `2026-10-02-field-chain-sync-detail-validation-focus-empty-design.md`**（深挖③，E1–G1，✅ 已完成）
> **覆盖对账**：三份上游"遗留至 Detail"条目 **7 类已深挖 + 5 类已关闭（深挖②③）+ 1 类归入计划（D-d）**，**Detail 层已无 OPEN**

---

## DT1 · 侧边栏入口处置 = **就地弹窗 + 与设置页共用同一实现**（用户裁决 B）

**决定**：保留侧边栏就地弹窗（S1），但**与设置页共用同一实现** —— 同一 `FieldEditor` + 同一校验 + 同一影响面预览。

**理由（用户）**：
1. 侧边栏的核心价值正是「看着当前页直接建规则」；跳转到设置页会把用户从**当前页上下文**推走，且需要新建一条「预填传递通道」（新机制 = 新分叉面）；
2. 从架构上共用实现已把分叉风险降到最低（同一组件 + 同一纯函数驱动的预览），与「只在设置页编辑」只差**入口数量**，而入口数量带来的是**可用性收益**；
3. 「能力不等」（侧边栏少字段）会制造**新的不一致**（与 D8 同族），除非有明确产品理由。

**已接受的代价（显式登记）**：字段集若将来分叉（例如设置页新增 `enabled`），必须**显式决定**侧边栏是否同步 —— 不允许静默漂移。

**"靠构造保证一致"的落地三要素**（替代"靠测试事后对齐"）：

| # | 要素 | 约束 |
|---|---|---|
| 1 | **单一组件** | `src/ui/shared/field-editor.tsx`（S4 / A12）为唯一实现；四个入口**不得自绘** Icon 三模式 radio、标题输入、`↺` 清除 |
| 2 | **单一校验** | URL 规范化（`wildcardToRegex`）、正则合法性、Icon 值判定（`data:` vs `http(s)`）收敛为**共享纯函数**，四入口只调用 |
| 3 | **单一影响面** | `impact` 由共享纯函数（A3 的受影响集合）计算；四入口只传参（`tabId` / `slotId` / `ruleId`） |

**防漂移约束**：字段集差异**只能**通过**显式 props / variant** 表达；组件内**不得**按"调用方是谁"分支（如 `if (surface === 'sidebar')`）。新增字段 = 改一处 props + 四处调用点**显式**选择（**不设隐式默认**，缺省即编译报错）。

---

## DT2 · 命名统一：以侧边栏的**显式命名**为准

**决定**：图标三模式命名统一为 **`Icon URL` / `Custom Icon` / `Use chain`**。

> **⚠️ 第三项原名 `Site original value`，已由 IMP-17/IMP-17b 全局改名为 `Use chain`**（见实现级方向文档）。改名理由：① 它必须**同时适用于 Title**（DT5 对称），而 `Site original value` 是图标语境；② 它描述的是"**本层不设值 → 由链的下层决定**"，而非"使用站点原值"——若某页同时命中 `slot`，实际显示的是 **slot 的值**。

**推翻**：deep-dive 中「统一为 `URL` / `Custom`」的建议（以侧边栏显式命名为准）、以及 DT6 原定的 `Site original value`。
**理由（用户裁决）**：`Icon URL` / `Custom Icon` 更自解释，且与字段标签 `Icon (optional)` 同族；`URL` / `Custom` 过于笼统。
**影响**：D8 的命名分叉（侧边栏 `Icon URL`/`Custom Icon` vs 设置页 `URL`/`Custom`，`sidebar/App.tsx:742,746` vs `settings/App.tsx:971,975`、`:1623,1631`）以**显式命名**收口。**三选项均为名词短语**（`Icon URL` / `Custom Icon` / `Use chain`）。

---

## DT3 · Icon 选项重设计（第三项由 `Reset` 改为 `Use chain`）

**决定**：`Icon (optional)` 的选项集 = `Icon URL` / `Custom Icon` / **`Use chain`**（原名 `Site original value`，经 IMP-17/IMP-17b 改名）；`Use chain` 取代原 `Reset`。

**实测依据（现实现的有损推断，支持本次重设计）**：

| 位置 | 现状 | 问题 |
|---|---|---|
| `sidebar/App.tsx:579` | `iconConfig = { dataUri: defaultIcon }` | 站点 favicon 是 `http(s)` URL，却被塞进 `dataUri` 字段 |
| `sidebar/App.tsx:582` | `iconMode = defaultIcon ? 'custom' : 'url'` | 于是 `http(s)` 预填被**显示为 `Custom Icon`** |
| `IconEditor.tsx:50` | `if (config.dataUri) return config.dataUri;` | 使上述误标"恰好可用"（不渲染、直接透传 URL），掩盖了错误 |
| `sidebar/App.tsx:1314` | `favicon: { type: 'upload', value: ruleData.icon }` | `http(s)` favicon 被持久化为 `type: 'upload'`（**类型与值不符**） |
| `sidebar/App.tsx:1620` | 预填 `icon: displayCurrentFavicon \|\| state.currentTabFavicon` | 「Add to global rules」默认就落到上述错误分支 |

**修正（模式推断改为按值判定）**：

| 预填值 | 模式 |
|---|---|
| `data:` URI | `Custom Icon` |
| `http(s)://` | `Icon URL` |
| 空 / 未捕获 | `Use chain` |

**文案**：`Reset` 的 `Icon will be cleared and shown as "—".`（`sidebar/App.tsx:767`、`settings/App.tsx:996,1660`）**必须替换** —— `—` 在 A10 的语义是**未知**（`unknown`），不是"无图标"，用它描述"清除"是**术语错位**。
**语义**：已由 **DT6（A1）** 关闭 —— 本层不写值、回落下一层。

---

## DT4 · 预填 = 带入 Current Page / slot 上下文

**决定**：`Match URL` / `Match Type` / `Title` / `Icon` 四项**全部**带入上下文值；来源统一为**链（A1）**而非手抄（顺带消灭侦察 #1 的 `displayCurrentTitle`）。

| 字段 | Current Page 来源 | slot 来源 |
|---|---|---|
| `Match URL` | `currentTabUrl` | `slot.urlMatch.value` |
| `Match Type` | `exact` | `slot.urlMatch.type` |
| `Title` | `resolveFieldChain('title').winner.value`（取代 `displayCurrentTitle`） | 槽**对应 tabId**（Q3：binding / `resolveSwitch` 推算）的链值 |
| `Icon` | `resolveFieldChain('favicon').winner.value` | 同左 |

**时机**：打开弹窗时**快照一次**（Q8 已接受"编辑期预测 vs 提交后权威"）；弹窗打开期间**不**随标签页变化重算 —— 避免用户输入被静默覆盖（复用 N8 的结构判等教训）。
**⚠️ 本条被 DT7 修订**：`Title` / `Icon` 的**编辑基准**不是"预填值"（那是链的**胜出值**，可能是 slot/rule/site），而是**本层已保存的值**；`↺` 复位到**本层基准**。`Match URL` / `Match Type` **没有链**，仍复位到上下文预填值。

---

## DT5 · `Custom Title (optional)` 与 `Icon (optional)` **对称**支持 `Use chain`

**决定**：**标题也有"三选项"模型**，与图标对称；第三项同为 `Use chain`（原名 `Site original value`，见 IMP-17b）。**其值来源 = 当前 tabId 的链**：`override > slot > rule > site`。

**回填 S4（硬约束）**：现 `FieldEditorProps`（S4 `:238-247`）的 `value: string | IconConfig` —— 对 **title 只有裸字符串、没有模式概念**，无法表达"URL / Custom / Use chain"。必须回填为**统一模式模型**（`field: 'title' | 'favicon'` + `mode` + 模式化取值），否则 title 侧必然在四处再分叉一次。

**值来源直接复用既有形状，无需新增架构**：
- A10 的 `DashboardRow.chain: ChainResult` **已经**携带 `tiers = { override?, slot?, rule?, site }`（A1 `:30`）→ 用户要求的"获取 override > slot > rule > site 的数据"**逐字映射**到既有契约；
- `site` 节点值来自 A7 的 `siteSnapshot`（Q14 内容脚本回报）；**未捕获 → `known:false` → 显示 `—`**；
- 因此第三项旁的 UI **必须展示整条链**（四层值 + 来源徽标），这正是 S3 已设计的 `ChainResult` 呈现 —— **Title 与 Icon 各一份**（Q13）。

**⚠️ 创作态警告（必须处理）**：S1「New Global Page Rule」里**规则尚不存在**，链中的 `rule` 层是**既有**胜出规则，**不含正在创建的这条**。弹窗必须显式标注（如 `This rule is not saved yet`），否则用户会把"本次将要写入的值"与"链上旧值"混淆。

---

## DT6 · `Use chain` 写侧语义 = **A1（本层不设值 → 回落）**（用户裁决）；标签经 IMP-17b 改名

**决定（用户裁决 A1）**：第三选项提交时**本层不写值**（等价现有 `reset` / 空值），链自然回落 `override → slot → rule → site`。
**零架构改动**：与 Q6（清除=回落）+ A4（每字段三态 `set` / `restore` / `none`）完全自洽；**A1 关闭了 A2 的"图标无法用字符串表达哨兵"难题**。

**文案（**主标签已由 IMP-17b 全局改名为 `Use chain`**）**：

| 位置 | 文案 |
|---|---|
| 主标签 | **`Use chain`**（IMP-17b 裁决；原名 `Site original value` 已撤销 —— 它不适用于 Title，且字面暗示"站点原值"而实际可能显示 slot/rule 值） |
| **旁注 · edit 态（必填）** | `Clears this layer — the value falls back to the next one in the chain.` |
| **旁注 · create 态（IMP-7 连带，必填）** | **不暗示"回落"**（创作态规则未存、`site` 未捕获，几乎无可回落）→ 如 `This field stays unset — other layers will decide.` |
| **取代** | `Icon will be cleared and shown as "—".`（`sidebar/App.tsx:767`、`settings/App.tsx:996,1660`）—— `—` 在 A10 是 `unknown`，用它描述"清除"属**术语错位** |

---

## DT7 · **两个按钮、各司其职**（用户裁决）：`↺` = 撤销编辑；`Clear` = 清空整条链

**决定**：`FieldEditor` 每个维度各有两个按钮，**都保留**、语义严格分工（**与 DT12 的提交模型正交**：`Clear` 恒立即生效）：

| 按钮 | 名称 | 图标 | 行为 | **写存储？** | 步数 / 可逆性 |
|---|---|---|---|---|---|
| ① | `Reset this edit`（**撤销我的编辑**） | `↺` | 把输入框**恢复成打开时的基准值**（= 本层已保存值） | ❌ **纯前端**，不落存储 | 1 步；可逆（再改回去） |
| ② | `Clear`（**新增**） | 🗑 | **清空该维度整条链** `override → slot → rule → site` | ✅ **写存储 + 触发重投递**（A5/A4） | 1 步；**破坏性，靠 `UndoBar` 兜底（DT9）**；**不受提交模型影响，一律立即生效**（DT10） |

**为什么"③ 选 `Use chain`"不能取代 ②**：③ 只能清**本层** → 链**回落**。当链上还有 `slot`/`rule` 值时，③ 的结果是"显示 slot/rule 的值"，**不是**站点原值。用户要的"清空整条链、回到站点原值"**③ 做不到**（与 DT1 理由③"能力不等会制造不一致"同族）。**这正是 IMP-17b 把第三项从 `Site original value` 改名为 `Use chain` 的理由** —— 旧名会让用户以为 ③ 能做到它做不到的事。

**"清哪些层"如何决定（A1-bis 回填，**已实测澄清**）**：**不需要任何 tombstone / 哨兵** —— 三层本来就区分"已设定 / 未设定"（`undefined` / `null` / `''` 皆 = 未设定；非空值 = 已设定，见 A1-bis 表）。因此 `Clear` = **按作用域把各层写回"未设定"**，属既有形状的既有语义。
**但"清哪些层"不由写入方各自决定**（否则又回到"各写入方自理" = 本迭代要消灭的缺陷源）→ 由 **`field-chain` 输出有序层清单**（A1-bis 的 `clearChain`），写入由 A2 执行。
**已知两处需要一元化**（实测 N10）：current-page 用 `null`（`sidebar/App.tsx:1299`、`settings/App.tsx:1443`），但 **slot 侧用 `{type:'url', value:''}` 空字符串**（`settings/App.tsx:1296,1317,1341,1447`、`sidebar/App.tsx:1385`）→ `Clear` 落地时须**统一为 `null`**（见四界面方向文档 OPEN-B）。

**关键约束（契约）**：
- ② 的**作用范围 = 维度**（title 或 icon），**跨 4 层** → 无法由"只清本层"的 `onClearField` 表达 ⇒ **必须新增一个跨层清除契约**（S4 需新增 **`onClearChain`**，与 `onClearField` 并列）；
- ② 在 S1「New Global Page Rule」**创作态下语义受限**：链中 `rule` 层是**既有**规则、**不含正在创建的这条**（DT5 已警告）⇒ 创作态要么**禁用**②，要么**仅允许清 `rule` 层**；
- ② 在**共享编辑面上对别人可见**：在 Dashboard 清 override **不会**动规则，但会让**所有命中该规则的 tab** 都回落到规则值 → 影响面预览（Q8/Q9）必须显示**实际被清除的条目数**；
- ② **免确认**（用户裁决，见 **DT9**）—— 靠「预览 + 5s UndoBar」兜底，与 Q12 侧边栏保存**同族**。

---

### 遗留发现：`↺` 现存**三种后果**（修 ② 时须一并规范）

| 位置 | 现行为 | 实际语义 |
|---|---|---|
| `settings/App.tsx:565`（Inline title） | `setTitle(rule.title ?? '')` | **复位到已保存值** ✅ 符合 DT7 |
| `settings/App.tsx:538`（Inline URL） | `setUrl(rule.urlMatch.value)` | **复位到已保存值** ✅ |
| `sidebar/App.tsx:727`（title） | `setTitle(defaultTitle)` | **复位到链的胜出值**（可能是 slot/rule/site）❌ 与 DT7 不符 |
| `settings/App.tsx:1605`（Dashboard title） | `resetEntryTitle(entry)` | **清除本层**（写 `null`）❌ 应为 `Clear` 的语义 |

→ 同名同图标、三种后果（**侦察 #9** 的根因）。DT7 后统一为：`↺` = 撤销编辑；清除 = `Clear` 按钮。

---

## DT9 · `Clear` **免确认**，靠「预览 + 5s UndoBar」（用户裁决）

**决定**：`Clear` **立即执行**（不弹 `Confirm`），以 **`UndoBar`（5 秒）** 兜底；与 Q12 侧边栏保存的"静默 + UndoBar"模式**同族**（有意为之，显式登记）。
**前提（硬约束）**：`Undo` **不是"纯前端撤销"** —— `Clear` 已写存储并触发重投递（DT7），因此 `Undo` 是**又一次写入 + 重投递**。

### ⚠️ 落盘时发现的严重语义陷阱（免确认方案下**风险被放大**）

按 DT7，`Clear(title)` = 给 `override` / `slot` / `rule` **三层**写"无值"标记。其中：
- `override` 是**本 tab 私有**（安全）；
- 但 **`slot.uiMarker.customTitle` 与 `rule.title` 是全局配置** —— 清掉它们 = **删除用户的全局配置**，并波及**所有绑定该 slot / 命中该 rule 的 tab**。

**后果**：用户在 Current Page 点"Clear title"，本意可能只是"这一页回到原样"，实际却**删掉了 Slot 5 的标题设置**（影响 3 个 tab）与规则标题（影响 12 个 tab）。
**免确认后，这个后果必须由「预览」单独承担**（`Confirm` 这道防线已被用户主动放弃）。

**因此对预览的硬性要求（升级 DT7 的约束 ②）**：
- 预览**必须列出行将被删除的"全局配置"本身**（如 `Slot 5 title: "Work"`、`Rule "GitHub*" title: "GH"`），而**不只是**"影响 N 个 tab 的计数"；
- 计数是**次要**信息；"我要删掉的这条全局配置"是**主要**信息；
- 预览**默认展开**（不折叠到 `…and K more`），因为它是唯一防线。

> **已实测的风险面（N-实测）**：`slot.uiMarker` 与 `rule.title` 是**全局配置**，`Clear` 会波及多 tab；且 `Toast.action` 能力**全仓库从未使用**（`components.tsx:240-241,272-276`）→ `UndoBar` 是本仓储唯一既有撤销机制，**DT9 复用它是正确选择**（避免第二套撤销 UI）。
> **同样已实测**：`UndoBar` 打开时**不聚焦按钮**（`sidebar/App.tsx:486-488`）→ DT9 的 a11y 要求（键盘可达 Undo）**当前就有 bug**，需一并修。

### `Undo` 的原子性 / 批次契约（新增实现约束）

| 要求 | 说明 |
|---|---|
| **批次快照** | `Clear` 提交前，先快照**将被清除的全部层值**（如 3 条：override / slot / rule），随 `UndoBar` 一起携带 |
| **原子恢复** | `Undo` **一次性恢复整批**（3 条一起回），**不得**分次 → 否则会留下"清了 2 层、恢复了 1 层"的中间态 |
| **恢复即写入** | 恢复后**必须重新触发** `recomputeAndRedeliver`（A5/A4），使其他受影响 tab 一并回到原值 |
| **过期即固化** | 5 秒后 `UndoBar` 消失 → **不可逆**（与 Q12 同语义，显式登记） |
| **展示内容** | `UndoBar` 文案应**如实**写清破坏范围（如 `Cleared 3 layers · 12 tabs affected`），而非只说 `Cleared` |

**登记风险（本层新增）**：预览被忽略 + 5 秒窗口过期 ⇒ **全局配置不可逆丢失**。缓解：预览默认展开且以"将被删除的全局配置"为**第一信息**；`UndoBar` 文案写明层数与影响 tab 数。

---

## DT12 · 提交模型 = **A3 混合**（用户裁决；详见四界面方向文档 DT10）—— 对 `FieldEditor` 的直接影响

**决定**：
| 面 | 改值（`FieldEditor` 输入） | `Clear`（DT7） |
|---|---|---|
| **Dashboard Edit 面板** | **草稿态**，由底部 `Save` **统一提交**两个维度 | **立即提交** |
| **侧边栏 Current Page / slot 行内** | **立即提交**（沿用 `onBlur` / 双击保存） | **立即提交** |

**因此 `FieldEditor` 需要一份"提交模型"输入**（已回填 S4a 的 `submitMode: SubmitMode`）。
**⚠️ 本裁决产生的一致性缺口（必须显式处理）**：同一面板内，**改值等 `Save`、`Clear` 却立即生效** → `Clear` 必须**视觉上与其维度紧贴**并标注"立即生效"，且与底部 `Save` **视觉分离**。否则用户会以为 `Clear` 也会等 `Save`。
**`Reset this edit`（`↺`）不手动置 dirty** —— 它只是"改回草稿原值"，dirty 由"草稿值 vs 基准值是否相等"**推导**（`dirty = mode !== baseline || iconConfig !== baselineIconConfig`）。

---

## DT8 · 共享组件边界 = **B（`RuleFormFields` 包全部 5 道菜）**（用户裁决）

**决定**：抽 **`RuleFormFields`（规则表单字段集）**，承载 `Match URL` + `Match Type`（**含共享的正则校验**）+ `FieldEditor`（子件，S4 接口不变）+ `Priority`；供 **S1 侧边栏弹窗** 与 **S2 规则创建 / 行内编辑** 共用。
**`FieldEditor`**（S4）**仍是**：`Custom Title` + `Icon`（含三选项、`↺`、`Clear`、徽标/遮蔽、影响面预览）。

**收口收益（可核对）**：
| 项目 | 收口前 | 收口后 |
|---|---|---|
| `Match URL` 重复 | 3 处 | **1** |
| `Match Type` 重复 | 3 处 | **1** |
| └ 正则实时校验 | **2/3 不一致**（Inline 缺失，新增第 14 项不一致） | **1（统一，缺口补上）** |
| `Priority` 重复 | 3 处 | **1** |
| DT4 四项上下文预填 | 写 2 遍 | **写 1 遍** |

**范围与代价（显式登记）**：
- `RuleFormFields` **只服务规则编辑面**（S1 / S2 创建 / S2 行内）。**S3 Dashboard 编辑面不用它**（它编辑 override，无 `Match URL`/`Match Type`/`Priority`，只用 `FieldEditor` 子件）→ `variant` 只需**两态**。
- `Priority` 只有规则面才有 ⇒ 组件需一个**显式的"含 Priority"开关**；**不设隐式默认**（缺省即编译报错，符合 DT1 防漂移约束）。
- **`Enabled` 仍不入**共享件（`settings/App.tsx:620-623` 独有；sidebar 与 New Rule 都没有）→ 保持**面特异**，作为 DT1「已接受代价」的现成实例**显式登记**。
- `Auto-apply on match`（= `mode`）**随 Q11 删除**，不进共享件（不进即不需 `deprecated` 容错）。

---

## OPEN-2 · （已关闭，保留推导过程）

<details><summary>原问题描述（供追溯）</summary>

### 打个比方

想象**有 3 家分店**（① 侧边栏弹窗、② 设置页"新建规则"、③ 设置页"行内编辑"），每家都要**卖同样的 5 样菜**：`Match URL`、`Match Type`、`Custom Title`、`Icon`、`Priority`。

现在的情况是：**3 家店各自从头写菜谱**（复制粘贴代码）。后果有 3 个：
- 有的店**漏写了一样菜**（行内编辑**没有**"正则实时校验"，另外两家有）；
- 有的店**菜名不一样**（`Icon URL`/`Custom Icon` vs `URL`/`Custom`）；
- 想改菜谱，**要跑 3 家店各改一次**，漏一家就分叉。

S4 的方案是：**建一个中央厨房**，规定 3 家店都从这里取菜。但 S4 **只把 2 样菜（`Custom Title` + `Icon`）放进了中央厨房**，剩下 3 样（`Match URL`、`Match Type`、`Priority`）**还是各店自己炒**。

### 所以 OPEN-2 只是在问一句话

> **中央厨房要不要把 5 样菜全包了？**

| | 方案 A（S4 原方案） | 方案 B（扩成 `RuleFormFields`） |
|---|---|---|
| 中央厨房做几样菜 | **2 样**：`Custom Title`、`Icon` | **5 样**：再加 `Match URL`、`Match Type`、`Priority` |
| 3 家店还要自己炒 | 3 样（Match URL / Match Type / Priority） | **0 样**（全从中央厨房取） |
| 漏写那样菜（行内缺正则校验） | **还在漏** | 顺手补上 |
| 菜名不统一（URL/Custom） | 只在 Title/Icon 上解决 | 全解决 |
| 以后改菜谱要改几处 | Title/Icon 改 1 处，**其余仍改 3 处** | **全改 1 处** |
| 工作量大不大 | 小 | 中（多包 3 样菜的代码） |
| 有个小别扭 | 无 | `Priority` **只有规则编辑面才有**（Dashboard 编辑面没有它）→ 中央厨房要**多一个开关**说"这份单子要不要 Priority" |

**只影响这 3 家分店**：Dashboard 的编辑面卖的是**另一份菜单**（它只改"当前这一页"的标题/图标，没有 Match URL / Match Type / Priority），所以它**只用那 2 样菜**，不受本决定影响。

### 一句话选项

- **A**：保持现状的缩小版 —— **中央厨房只管 Title 和 Icon**，另外 3 样菜 3 家店自己炒（漏写、菜名分叉、改 3 处 都还在）。
- **B**：中央厨房**管全部 5 样菜** —— 3 家店只管摆盘和预填（漏写被修好、菜名统一、以后只改 1 处；代价是中央厨房的参数变多，要一个"有无 Priority"的开关）。

**裁决结果**：**B**（见上 DT8）。

</details>

---

## 覆盖对账：三份上游"遗留至 Detail"条目的**深挖状态**

> 对账对象：Goal §7、Constraint §7、Architecture module「遗留至 Detail」（+ 深挖 ①/②/③ 的遗留表）。
> 结论：**本层的深挖集中在一条线**（共享边界 / 写入语义 / 容器与交互形状），**另有 5 类仍只登记、未探讨**。

### ✅ 已深挖（有具体裁决 + 契约）

| 上游条目 | 出处 | 本层落点 |
|---|---|---|
| 编辑器的共享边界（哪些字段/校验/预览） | Goal §7 / Constraint §7 / module | **DT8**（`RuleFormFields` 包全部 5 道菜）+ **DT1** 三要素 + **IMP-3**（位置差异有意保留） |
| `New Global Page Rule` 改造点 | Goal / Constraint / module | **DT4**（四项上下文预填）+ **DT5/DT6**（三选项对称 + `Use chain`）+ **DT7**（两按钮）+ **IMP-1/2/7/8** + **① S1 字段表** |
| 4 入口一致性验收 | Goal / Constraint / module | **DT1 三要素**（单一组件 / 单一校验 / 单一影响面）+ **SC8 例外登记**（位置差异 + `Clear` 能力差异） |
| 徽标 / 遮蔽 / 清除 的机制 | Goal §7 | **DT7**（`↺` vs `Clear` 分工）+ **DT9**（免确认 + `UndoBar` + 预览为唯一防线）+ **A1-bis**（三条清除作用域） |
| 清除语义（`—` / 空串 / `null`） | Goal §7 | **DT11**（一元化 `null`）+ **A1-bis**（设定值判定表） |
| `site` 节点未捕获的语义 | Goal §7 | **DT5**（`known:false` → `—`+ `site` 不可编辑）+ **IMP-5**（单元格须区分"`—`"与"空"） |
| 提交模型 / 草稿 | ③ IMP 带出 | **DT12**（A3 混合 + `Clear` 恒立即提交）+ **IMP-13/14/19** |
| 展开交互与 a11y | ② D-16 | **IMP-15/16**（`useExpandRow`）+ **IMP-12**（a11y 触达面 4 处） |

### ❌ 仍只登记、未探讨（5 类）

| # | 缺失项 | 上游出处 | 现状 |
|---|---|---|---|
| **D-a** | ✅ **已关闭**（深挖②） | Goal §7 / Constraint §7 / module / ①②③ 各处 | 成品文案已全部定稿 → `2026-10-02-field-chain-sync-detail-copy-a11y-design.md` §0–§5 |
| **D-b** | ✅ **已关闭**（深挖③） | module / ① F11 / A10 `anchor` | **F1**（滚到 + 高亮、不自动展开）+ **F1b**（回退链：目标行 → 表格第一行 → 搜索框；回退**不高亮** + 如实说明）+ **F2**（临时高亮 ~2s；`reduced-motion` 降级**保留高亮** + **非视觉播报**）→ 详见 `detail-validation-focus-empty-design.md` §2 |
| **D-c** | **影响面阈值**（前 3 条 / 折叠阈值） | Goal §7 / Constraint §7 / module / ① Q9 | 只沿用"前 3 条 + `…and K more`"的**方向**；**具体阈值**（3？5？）+ **渲染形态**未定。**IMP-8 已缩小其范围**（打开查一次、改动即 stale），但阈值本身仍缺 |
| **D-d** | ⏸️ **归入计划阶段** | Goal §7 / Constraint §7 / module | 只登记了"`field-chain` 穷举单测 / 投递调度 / 契约清理 / UI 四层"；**未定义每层的具体用例与 RED 可构造条件**。**已决定归入 `sw-strategic-planner` 阶段**（规划者本就负责 RED 可构造性）+ 深挖③ 新增的对照单测（`normalizeUrl` 前后对照，RK-1 缓解） |
| **D-e** | ✅ **已关闭**（深挖③） | Constraint §7（"字段与校验边界"） | **E1**（UI 全量复用后台校验原语：`validateRegex` + `isSafeFaviconProtocol` + `normalizeUrl`）+ **E1-a**（必须先 `wildcardToRegex` 再校验，**修 ① N7**）+ **E2/E3/E3b**（错误归属路由表）+ **E4/E5**（`normalizeUrl` 补尾斜杠等同，含 5 条精确契约）→ 详见 `detail-validation-focus-empty-design.md` §1 |

### ⚠️ 另有 2 项**部分**深挖（有方向、缺细节）

| # | 项 | 已有 | 缺 |
|---|---|---|---|
| **D-f** | ✅ **已关闭**（深挖②） | **IMP-12** / **IMP-15b** / **DT9** | `radiogroup` 统一为共享 `RadioGroup`（**8→11 组**）、`Confirm` 焦点（`确认→取消`）、`UndoBar` 焦点（抢焦点 + 4 条约束）、`aria-expanded`/`aria-describedby` 写法 → `detail-copy-a11y-design.md` §6 |
| **D-g** | ✅ **已关闭**（深挖③） | **IMP-10**（四态：`empty` / `no-match` / `error-first` / `error-stale`，且 `empty` 优先） | **G1**：**不新增第 5 态**；有行且存在不可投递项时，表格上方加汇总句（`2 items · none can be applied here`）；**`unknown` 不计入统计**（它是常态，否则汇总句恒真）→ 详见 `detail-validation-focus-empty-design.md` §3 |

---

## 遗留（本层状态：**全关闭**，见「覆盖对账」）

| 项 | 状态 | 终局 |
|---|---|---|
| **D-a 英文成品文案** | ✅ 关闭（深挖②） | `detail-copy-a11y-design.md` §0–§5（**取代**本行旧列的 `Masked by an override` / `Cannot rewrite (protected page)` / `Degraded — …` 等） |
| **D-b 跳焦实现** | ✅ 关闭（深挖③） | **F1**（滚到 + 高亮、不自动展开）+ **F1b**（回退链）+ **F2**（临时高亮 ~2s + 非视觉播报） |
| **D-c 影响面阈值** | ✅ 关闭（深挖②③） | **CT2**（前 3 条 + `…and K more`，**仅 `MatchSummary`**）+ 排序键 `Tab N` 数字序 |
| **D-d 测试分层** | ⏸️ 归入计划阶段 | `field-chain` 穷举单测 + **`normalizeUrl` 前后对照单测**（E5-d）+ 投递调度 + 契约清理 + UI |
| **D-e 校验边界** | ✅ 关闭（深挖③） | **E1 / E1-a**（全量复用 + 先转换再校验，**修 ① N7**）+ **E4/E5**（`normalizeUrl` 尾斜杠等同） |
| **D-f a11y 细节** | ✅ 关闭（深挖②） | **CT3-a**（共享 `RadioGroup`，8→11 组）+ **CT3-b**（`Confirm` 焦点）+ **CT3-g**（`UndoBar` 焦点） |
| **D-g 空态 × delivery** | ✅ 关闭（深挖③） | **G1**（不新增态 + 汇总句；**`unknown` 不计入**） |

**⚠️ 本表旧文案均已作废**，以深挖②③ 为准（术语统一见深挖② §0.2）。
| **新契约回填** | ~~S4 `onClearChain` + `canClearChain` + title 模式模型~~ → **已回填 ① S4a**；`submitMode` **已回填** |
| **已回填（2026-10-02）** | A1-bis、A4-bis、A12 双层组件地图、S1/S4a/S4b、Goal SC8/Q13、① 第 14 项不一致、DT2/DT3/DT5/DT6 改名回改、② D-4/D-7/D-11/D-16/D-17/D-20 修订标注 |
| **登记风险（本层）** | `Clear` 免确认 + `UndoBar` 5s 过期 ⇒ **全局配置（`slot.uiMarker` / `rule.title`）不可逆丢失**；缓解：预览**默认展开**且以"将被删除的全局配置"为**第一信息**（DT9） |
| **待裁定** | **0（已全部关闭）** |