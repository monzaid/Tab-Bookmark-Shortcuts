# Architecture Deep-dive ③ — 三界面的**实现级**设计方向（容器 / 场景 / 密度）

> **上游**：Goal（Q1–Q14）+ Constraint（C1–C8）+ Architecture（A1–A12 / A1-bis / A4-bis）+ UI deep-dive ①（S1–S4b）+ 四界面方向 ②（D-1..D-21 / DT10 / DT11）+ Detail（DT1–DT12）
> **层**：🏗️ Architecture 深挖（第三份，**实现级**）
> **日期**：2026-10-02 · **基线**：HEAD `a3d6ab3`
> **与 ② 的关系**：② 给出**方向**（D-1..D-21），③ 把方向落到**可实现的结构**（容器 / 场景 / 密度），并暴露**必须裁决的实现选择**（IMP）
> **裁决状态**：**IMP-1..IMP-19 全部已裁决**；**OPEN：0**

---

## 0.1 裁决总览（一页速览）

| ID | 问题 | 裁决 |
|---|---|---|
| **IMP-1** | 侧边栏弹窗容器 | ✅ **保留 `Dialog`**（288px 单列） |
| **IMP-2** | 窄栏 `FieldEditor` 密度 | ✅ **常驻展开**（靠滚动；顺带关闭 IMP-11） |
| **IMP-3** | Rules `New Rule` 容器 | ✅ **保持现状（顶部内联表单）** |
| **IMP-4** | Dashboard `Edit` 容器 | ✅ **行内展开**（与 `InlineRuleEditor` 同形状、可多行） |
| **IMP-5** | Dashboard 行内链密度 | ✅ **单元格只放胜出值 + 徽标**，四层值进展开面板 |
| **IMP-6** | `Clear` 撤销承载 | ✅ **泛化 `UndoBar` 为共享组件** |
| **IMP-7** | 创作态 `Clear` | ✅ **不渲染**（能力由 `FormScene` 派生） |
| **IMP-8** | `MatchSummary` 查询时机 | ✅ **打开时查一次，URL 改动后即失效** |
| **IMP-9** | Rules 列序 | ✅ **重排（不合并单元格）** |
| **IMP-10** | 空态判定位置 | ✅ **各 Section 自行判定**（实为四态） |
| **IMP-11** | `FormView` 密度切换 | ✅ **随 IMP-2 自动关闭** |
| **IMP-12** | `FormField` a11y 修复范围 | ✅ **只修本迭代触达的字段** |
| **IMP-13** | 多行草稿 vs 刷新 | ✅ **不持久草稿**（代价已被 IMP-19 放大） |
| **IMP-14** | 多行脏标记 | ❌ **已撤销**（用户裁决） |
| **IMP-15** | 展开集是否共享 | ✅ **抽共享 hook `useExpandRow`** |
| **IMP-16** | Escape / 焦点是否纳入 | ✅ **两处一并修**（随 `useExpandRow`） |
| **IMP-17** | 第三选项命名 | ✅ **全局改名** |
| **IMP-17b** | 具体标签字符串 | ✅ **`Use chain`** |
| **IMP-18** | `Mode` 列 vs Q11 | ✅ **Q11 成立，删除 `Mode` 列**（7 列） |
| **IMP-19** | 无脏标记 ⇒ 是否取消草稿？ | ✅ **保留统一 `Save`**（草稿仍在，不做未保存指示） |

---

## 0.2 须回填上游的清单（由 ③ 的裁决推出）

| # | 回填对象 | 内容 | 来源 |
|---|---|---|---|
| 1 | **DT2 / DT3 / DT5 / DT6** | 第三项 `Site original value` → **`Use chain`**（+ 两态旁注） | IMP-17/17b（**已回填**） |
| 2 | **① 的 S4a** | 新增 `canClearChain`（DT1 合规显式能力） | IMP-7 |
| 3 | **② 的 D-7** | 命中数改为"打开查一次 + 改动后 stale" | IMP-8（**已回填**） |
| 4 | **② 的 D-11** | 列序定为 7 列（`Icon` / `Title` 相邻，删 `Mode`） | IMP-9 / IMP-18（**已回填**） |
| 5 | **② 的 D-8 / D-20** | D-8：字段集统一但**位置形状有意保留差异**；D-20：改用**泛化 `UndoBar`**（非 `Toast.action`） | IMP-3 / IMP-6 |
| 6 | **② 的 D-11..D-21 中被 IMP 改写者** | D-4（三段式密度降级）、D-16（Escape/焦点纳入本迭代）、D-17/D-18（Dashboard 改行内 + 保留统一 `Save`）、D-19（单元格密度）、D-20（撤销机制） | 多项 |
| 11 | **深挖③ 的 D-e / D-b / D-g** | 校验收敛（E1/E1-a 修 ① N7）、错误归属路由表（E3/E3b）、`normalizeUrl` 尾斜杠等同（E4/E5）、跳焦定稿（F1/F1b/F2）、空态汇总句（G1） | 深挖③ |
| 7 | **① 的 D8/D12** | 补"**能力差异例外**"（create 面无 `Clear`）与"**位置差异有意保留**" | IMP-3 / IMP-7 |
| 8 | **Goal Q13 / SC8** | "4 入口共用同一组件"→ 明确为 **`RuleFormFields`（create/edit）+ `FieldEditor`**，并注明能力/位置例外 | DT8 / IMP-3 / IMP-7 |
| 9 | **A12 组件地图** | 增 `useExpandRow`、`EmptyState`、泛化的 `UndoBar`（搬入 `src/ui/shared/`） | IMP-6/10/15 |
| 10 | **Q11 落地清单** | 12 处（含**侧边栏仍在用 `mode`** 的 `:1520/1766/1311/568/576/596`） | IMP-18 |

---

## 0. 本次新核实的实现约束（决定后续所有选型）

| # | 约束 | 实测证据 | 对设计的影响 |
|---|---|---|---|
| **R1** | **侧边栏弹窗的真实可用宽度约 288px** | `.tbs-dialog { max-width: 480px; width: 90%; }`（`base.css:161-162`）；侧边栏面板宽度**由宿主决定、manifest 未声明**（`sidebar.css:8-14` 无 `width`；`manifests/chrome.json` 只设 `default_path`）。典型侧栏 ~320px → **90% ≈ 288px** | 弹窗内**不能用 2 列网格**；`settings.css:524-529` 的 `.tbs-settings__rule-form-grid { grid-template-columns: 1fr 1fr }` **不能**照搬到侧边栏 |
| **R2** | **`.tbs-dialog` 已有 `max-height: 80vh; overflow-y: auto`** | `base.css:163-164` | 内容超长可滚动，**无需自建滚动容器**；但 `RuleFormFields` 若自身再套滚动容器会出现**双滚动条** |
| **R3** | **`.tbs-settings__drawer` 存在但当前零引用**（宽 380px，`position:fixed`，`z-index:300`，`transform` 滑入；`@media` 下宽 100%） | `settings.css:475-493`、`:603-605`；全仓库无使用点 | 可作为 Dashboard Edit 的**现成**容器候选（免新建）；但 `z-index:300` **低于** `Dialog` 的 400（`base.css:150`）→ **抽屉内不能再开 Dialog**（会被压在下面） |
| **R4** | **`UndoBar` 硬编码"Slot N overwritten"** | `sidebar/App.tsx:486-487`；`UndoState` 只含 `slotId`（`:81-85`） | **当前依附于侧边栏**；Dashboard 的 `Clear` 若要撤销，`UndoBar` 必须**泛化**（文案 + 快照载荷）或**搬入共享层** |
| **R5** | **`.tbs-dialog-overlay` 是 `position:fixed; inset:0`** | `base.css:147-150` | 在**设置页**（长文档）中，弹窗会**铺满整个 viewport**而非居中于内容区 —— 与"编辑表格某一行"的上下文感受不一致 |
| **R6** | **侧边栏标题提交有个"空值即不写"的短路** | `sidebar/App.tsx:1244`：`if (!next \|\| next === currentTitleInitial) return;` | **DT6 的"本层不设值"在侧边栏标题上目前没有写入路径** —— 只有独立的 `handleCurrentTitleReset`（`:1257-1269`）。`FieldEditor` 必须**显式区分**"空输入"与"用户选了第三选项" |
| **R7** | **`Dialog` 已具备完整 a11y 能力**（`aria-modal`、Tab 陷阱、Escape、焦点首元素、`returnFocusRef` + `focusFallbackRef`） | `components.tsx:134-231` | 凡"模态编辑"**都应复用**，不应自建 |

---

## 1. 界面 2 · `New Global Page Rule` 弹窗

### 1.1 目标结构（② D-6/D-9 的落地形态）

```
Dialog (title="New Global Page Rule")        ← R7：保留（a11y 全部免费）
├─ FormScene('rule-create')                 ← 唯一场景声明（§4）
│  ├─ Group 1 · Where                       ← Match URL + Match Type
│  ├─ ▸ MatchSummary                        ← D-7：常驻命中数 + N=0 警告
│  ├─ Group 2 · What → FieldEditor ×2       ← Title / Icon（② D-9）
│  └─ Group 3 · Priority
└─ footer: Cancel | Save                    ← D-8：disabled 绑定校验 + 原因文案
```

### 1.2 必须解决的实现细节

| # | 细节 | 说明 |
|---|---|---|
| 1.2.1 | **窄宽度下的分组呈现（R1）** | 288px 内不能两列。推荐**单列 + 分组标题**（`Where` / `What` / `Priority`）；`Match Type` 的两个 radio 可同行（`Exact URL` / `Regex` 短）。 |
| 1.2.2 | **`MatchSummary` 的位置** | ② D-7 要求"边输边看命中数"。它在 `Match Type` 之后、`What` 之前 —— 是**只读行**（非表单字段），故**不占 label 行高**。 |
| 1.2.3 | **`FieldEditor` 的展开态** | 侧边栏窄 → ② 的 `RuleFormFields.View`（D-4 三段式）在**窄栏**把 Title/Icon 折叠为**两行摘要**（`Title: …` / `Icon: …` + 徽标），点击展开编辑。**是行为选择，见 IMP-2**。 |
| 1.2.4 | **创作态（R6 + DT5）** | ①`rule` 层不存在 → `ChainResult` 的 `rule` 节点**空缺**；②`Clear` 的待清层清单只有"本层 + 其下"，而本层尚未落存储。**必须显式处置**（IMP-4）。 |
| 1.2.5 | **`Save` 的禁用与原因（D-8）** | `disabled = !url.trim() \|\| invalid \|\| saving`；`invalid` 时**旁挂** `role="alert"` 的原因文案（复用 `tbs-settings__regex-invalid` 的样式 token，不再内联 `#DC2626`）。 |
| 1.2.6 | **焦点闭环** | 补 `returnFocusRef`（回 Current Page 的 `＋` 或 slot 菜单项）—— 与 slot 删除 Confirm（`:443-453`）一致。 |

---

## 2. 界面 3 · `Page Rewrite Rules`

### 2.1 目标结构

```
RulesSection
├─ toolbar: Search | + New Rule            ← New Rule 的容器见 IMP-3
├─ NewRuleForm（create 场景）或 Dialog
├─ BatchBar（sticky；N selected）
├─ Table（列经 D-11 重排）
│  ├─ 行（正常）
│  └─ 行（展开）→ InlineRuleEditor（edit 场景）
└─ EmptyState（三态之一）
```

### 2.2 必须解决的实现细节

| # | 细节 | 说明 |
|---|---|---|
| 2.2.1 | **三处表单的 `FormScene` 声明** | `rule-create` / `rule-edit` / `field-edit`（§4）。**`rule-create` 现在被两个地方用**（侧边栏弹窗 + 设置页顶部表单）→ 必须**同一场景、同一字段集**（否则 N19 的"双向不等"会重现，只是换了位置）。 |
| 2.2.2 | **`Enabled` 的两难（N19）** | `Enabled` 只在 edit 面存在（`settings/App.tsx:620-623`）。若 `rule-create` 场景统一为"无 Enabled"，则**新建的规则无法预置为 disabled**（当前也不可能，故**行为不变**）。→ 建议 `rule-create` 不含 `Enabled`，并在 create 后由表格开关控制（**行为保持**）。 |
| 2.2.3 | **表格列重排（D-11）** | 删除 `Mode` 列后回收宽度。建议 `☑ / Result(Icon+Title) / URL Pattern / Priority / Enabled / Actions`。**`Result` 合并列**使"这条规则会让我看到什么"一眼可见。 |
| 2.2.4 | **`InlineRuleEditor` 的位置** | 现状是 `<tr><td colSpan={8}>`（`:520-521`）内嵌表单。改为 `colSpan` 随列数变化（8 → 7）。**容器形态见 IMP-3 的连带项**。 |
| 2.2.5 | **空态三态（D-15）** | 需要**三个互斥分支**：`尚未配置` / `搜索无结果（+ Clear search）` / `加载失败（+ Retry）`。当前 `loadRules` 失败静默（`:661-671`）→ 必须**先把失败暴露为状态**。 |
| 2.2.6 | **批量部分失败（N8 相关）** | `handleBatchDelete/BatchSetEnabled` 的 `catch { /* continue */ }`（`:819, 831`）→ 改为**收集失败项**并如实汇报（`3 of 5 deleted · 2 failed`）。 |

---

## 3. 界面 4 · `Data Dashboard`

### 3.1 目标结构

```
DashboardSection
├─ toolbar: Reset Selected | Reset All      ← 前置 Confirm（N1/N9）
├─ Table（每行 Title/Icon 单元格 = FieldEditor 只读态 + 徽标）
├─ EmptyState（三态）
└─ EditPanel（editing ≠ null）              ← 容器形态见 IMP-4
   ├─ FieldEditor(title)   ← draft
   ├─ FieldEditor(icon)    ← draft
   └─ footer: Cancel | Save（dirty 驱动）
```

### 3.2 必须解决的实现细节

| # | 细节 | 说明 |
|---|---|---|
| 3.2.1 | **容器选型是硬约束（R3/R5）** | 三个候选：**R3 的 drawer（现成、宽 380px，但 `z-index:300` 低）** / **inner `Dialog`（a11y 免费，但 overlay 铺满 viewport 且 `z-index:400`）** / **保持内联重构**。见 **IMP-4**。 |
| 3.2.2 | **`Clear` 的 `UndoBar` 归属（R4）** | `UndoBar` 目前在侧边栏（`:462-493`）且文案硬编码"Slot N"。Dashboard 的 `Clear` 需要**自己的**撤销提示 → 要么泛化 `UndoBar` 为共享组件（带 `message` + 快照载荷），要么在设置页新建同类组件（**会变成第二套撤销 UI，与 ② D-20 冲突**）。 |
| 3.2.3 | **行内链展示密度（② D-19）** | 表格单元格空间有限。`FieldEditor` 只读态在单元格内**不能**放四层值 → 建议：单元格 = **胜出值 + 来源徽标**（徽标 hover 出四层 popover）。**密度取舍见 IMP-5 的连带项**。 |
| 3.2.4 | **`sortedEntries` vs `entries`（① N-实测 #36）** | 表头全选基于 `entries`（`:1479-1487`），行基于 `sortedEntries`（`:1539`）→ 一致化。 |
| 3.2.5 | **槽位改值路径（② D-18）** | slot 行改值写 `uiMarker.customTitle`（`:1410-1413`）**不是**本 tab 私有 → `impact` 预览必须显示**所有绑定该 slot 的 tab**（② D-19 / DT9 的"第一信息"要求）。 |

---

## 4. 核心抽象：`FormScene` / `FormView` / `FieldEditor` 三层

### 4.1 为什么需要 `FormScene`（而不是"到处传 `fieldEditor: 'title'|'favicon'|'both'`"）

① 的 S4b 接口里有 `variant: 'create' | 'edit'` + `fieldEditor: 'title'|'favicon'|'both'` + `offset`。但这**不足以**表达四个面的真实差异。实测差异清单：

| 面 | Match URL | Match Type | FieldEditor | Priority | Enabled | 提交模型 | 容器 | 宽度 |
|---|---|---|---|---|---|---|---|---|
| 侧边栏弹窗 | ✅ 预填当前页 | ✅ 预填 `exact` | Title + Icon | ✅ | ❌ | 草稿（Save） | Dialog | ~288px |
| Rules · New Rule | ✅ 预填空 | ✅ | Title + Icon | ✅ | ❌ | 草稿（Save Rule） | ? IMP-3 | 全宽 |
| Rules · Inline Edit | ✅ 预填规则 | ✅ | Title + Icon | ✅ | ✅ | 草稿（Update Rule） | 行内 | 全宽 |
| Dashboard Edit | ❌ | ❌ | Title + Icon（override 语义）**不适用第三选项** | ❌ | ❌ | 草稿（Save） | ? IMP-4 | ~380px |

**⇒ `fieldEditor: 'both'` 同时覆盖了"规则面（有 Match URL）"与"override 面（无 Match URL）"，但两者的 `FieldEditor` 语义不同**（override 面的 `site` 节点是站点原值、规则面的 `site` 同样；但**第三选项的"回落"目标层不同**）。这就是需要 `FormScene` 的原因。

### 4.2 建议形状 — ⚠️ **本项在 Act 3 被漏登，已补裁决（G-2：不建独立 `FormScene` 模块）**

**✅ 裁决（2026-10-02，Act 3 补登）**：**不建独立的 `FormScene` 模块**；`canClearChain` 由 **`RuleFormFields.variant`** 单点派生（`variant === 'create'` ⇒ `false`）。理由：
1. **避免过度抽象**（YAGNI）—— 四个面的差异可由 `variant` + 既有 props 表达，无需引入第二个类型系统；
2. **与 IMP-7 的硬要求一致**：能力**仍由一处派生**（`variant` → `canClearChain`），未违反 DT1 的"不得按调用方分支 / 不得手写布尔"；
3. 若后续确有需要（如新增第五个面），再引入 `FormScene` 也不破坏现有 props。
> **登记**：本项在 Act 3 的"全树自审"中**被漏登**（保留了"待你确认"字样），由规划期复核发现并补登 → 属**流程瑕疵**，非设计缺陷。
> **若希望改为独立 `FormScene` 模块**，请在规划前告知（会在 T10 前插一个派生层任务）。

### 4.2-orig 原建议形状（**已由上述裁决取代，保留供追溯**）

```ts
/** 场景 = 一处表单的"完整身份"（字段集 + 落点 + 提交模型），唯一真源 */
export type FormScene =
  | { kind: 'rule-create'; surface: 'sidebar' | 'settings' }
  | { kind: 'rule-edit'; ruleId: string }
  | { kind: 'field-edit'; source: 'override' | 'slot'; tabId?: number; slotId?: number };

/** FormView：**纯布局**，零业务逻辑（接受由场景算出的 props） */
interface FormViewProps {
  scene: FormScene;
  children: React.ReactNode;      // 由各面自行组合（Match URL / FieldEditor / Priority）
}
```

**关键设计约束**：
1. **`FormScene` 是唯一真源** —— 字段集 / 提交落点 / 校验 / 影响面维度**全部由它派生**；各面**不得**再传散装 boolean；
2. **`FormView` 只负责布局**（单列 / 分组 / 折叠密度）—— 便于侧边栏（窄）与设置页（宽）用**同一份字段组合、不同布局**；
3. **新增字段 = 改 `FormScene` + 一处字段组合** → 四面的"字段集是否同步"变成**类型问题**（缺省即编译报错，符合 DT1）。

---

## 5. 实现级 IMP 清单（**裁决完成：19 / 19**；IMP-17/17b/18/19 为问答过程中新登记项）

### ✅ IMP-6 · `Clear` 的撤销承载 = **① 泛化 `UndoBar` 为共享组件**（用户裁决）

**决定**：把 `UndoBar` 从 `sidebar/App.tsx:462-493` **搬入 `src/ui/shared/`**，`UndoState` 泛化：

| 现状（`sidebar/App.tsx:81-85`） | 泛化后 |
|---|---|
| `{ slotId, previousSlot, expiresAt }` | `{ message: string; snapshot: UndoSnapshot; expiresAt: number }` |
| 硬编码文案 `Slot N overwritten`（`:487`） | **由调用方提供**（`message`） |
| 只承载"槽位覆盖" | 承载：**槽位覆盖** / **`Clear`（批次多层级快照）** / **Dashboard 重置** |

**`UndoSnapshot` 的批次形状（关键）**：
```ts
type UndoLayerWrite =
  | { kind: 'tab-override'; tabId: number; title?: string | null; favicon?: IconSource | null }
  | { kind: 'slot-marker';  slotId: number; customTitle?: string | null; icon?: IconSource | null }
  | { kind: 'rule';         ruleId: string; title?: string | null; favicon?: IconSource | null };
type UndoSnapshot = { writes: UndoLayerWrite[]; affectedTabIds: number[] };
```
**原子恢复**（DT9 的硬约束）：`Undo` **一次性回放 `writes` 全部条目** → 再触发一次 `recomputeAndRedeliver(affectedTabIds)`。**不得分次**（否则留下"清了 2 层、恢复 1 层"的中间态）。

**连带影响（须回填）**：
1. **`UndoBar` 需支持"背景色/语义变体"**（覆盖 = 中性；`Clear` = 破坏性恢复）—— 复用 `Toast` 的 variant token（`base.css`）；
2. **`UndoBar` 打开时必须聚焦 Undo 按钮**（`sidebar/App.tsx:486-488` 当前**不聚焦** → DT9 的 a11y 要求**当前就有 bug**）；
3. **② 文档 D-20 需更正**：原文建议"开启 `Toast.action` 的第一个用例" → 改为**复用泛化后的 `UndoBar`**（避免第二套撤销 UI）；
4. **设置页需引入 `UndoBar` 的挂载点**（当前设置页无任何撤销 UI）；
5. **`Clear` 的 `message` 需含破坏范围**（DT9：`Cleared 3 layers · 12 tabs affected`）。

### ✅ IMP-4 · Dashboard `Edit` 面板容器 = **③ 行内展开**（用户裁决，**与 `InlineRuleEditor` 同形状**）

**决定**：Dashboard 的 `Edit` **不再是表格下方的单一面板**，改为**内嵌到表格对应行**（`<tr><td colSpan={5}>`），**形状与 `InlineRuleEditor` 一致**，且**支持多行同时展开编辑**。

**实测对齐依据**：Rules 页的 `expandedRuleIds: Set<string>`（`settings/App.tsx:649`）**已经支持多行同时展开**（`toggleExpand:689-696`）→ 本决定使两处**交互形状一致**，无需发明新机制。

**必须解决的实现细节（本决定新增 6 条）**：

| # | 细节 | 说明 |
|---|---|---|
| 4a | **草稿态从"单个"变"每行一个"** | 现状是单个 `editing: DashboardEditForm \| null`（`:1223`）→ 须改为 **`Map<entryId, DashboardEditForm>`**（对应 `expandedRuleIds` 的形状） |
| 4b | 🔴 **刷新冲掉未保存草稿（新风险）** | `storage.onChanged` 自动刷新（`:1270-1277`）与 `load()`（`:1249-1268`）会在**外部变更**时重载 → **行 A 的未保存草稿会被冲掉**。侧边栏已有 N8 的结构判等教训。**须裁决**：见 IMP-13 |
| 4c | **`colSpan` 随列数** | Dashboard 为 **5 列**（现状 `colSpan={5}`，`:1578`）→ 行内编辑行用 `colSpan={5}`（若 IMP-9 合并列则再调） |
| 4d | **a11y（非模态）** | 行内展开**不用** `aria-modal`（非模态，不应抢焦点边界）；用 `role="form"` + `aria-label`（`InlineRuleEditor:522` 已验证）+ 触发行 `aria-expanded`/`aria-controls`（对照 `:1148`） |
| 4e | **多面板并存的 dirty 指示** | 多行可同时展开 → 每行 `Save` 的 `disabled` 只反映**本行** dirty；表格行需**显式标记"有未保存更改"**（否则用户找不到哪个面板没存） |
| 4f | **Escape 取消 + 展开后焦点移入** | 与 IMP-16（D-16）同款处理；`InlineRuleEditor` 现状**两处都缺**（① N13/N14）→ 两处一并修 |

**对 IMP-5 的影响（正向）**：行内展开**缓解了单元格密度问题** —— 单元格只需"胜出值 + 来源徽标"，**四层值放进展开面板**（空间充足）。IMP-5 的答案因此收窄。

**对本项原候选的结论**：`Dialog`（overlay 铺满、R5）与 `drawer`（`z-index:300` 会挡 Icon Editor）**均被否决**；且本决定**不需要** Icon Editor 的 Dialog（行内即可容纳 `IconEditor`，`InlineRuleEditor:597-599` 已是此形态）。

### ✅ IMP-13 · 多行并存的 Dashboard 草稿 = **① 不持久草稿**（用户裁决）

**决定**：草稿**只活在客户端组件 state**；外部变更 / `storage.onChanged` / `load()` 触发的重载 → **草稿直接丢弃，不提示**。

**接受此裁决后必须承担的三点（显式登记）**：

| # | 承担项 | 说明 |
|---|---|---|
| 13a | **损伤面随 IMP-4 放大** | 现状只有**一个** `editing`（`:1223`），而 IMP-4 允许多行展开 → 从"最多丢 1 个草稿"变为"**可丢 N 个**"。用户的输入成本更高，本裁决的代价比现状更大 |
| 13b | **最高频的触发源是"用户自己"** | 见下 |
| 13c | **`DraftProtectionDialog` / `isDirty` 继续零引用** | ① N12 的登记项不变（**不因本裁决而启用**）；可考虑在 Q13 的孤儿清理中一并处置 |

**13b 展开（这是我认为最需要你知情的一点）**：
触发源**不只是"改 slot 定义"**。实测三点：
1. **`Clear` 自身就会触发** —— DT7 的 `Clear` **写存储** → 立即触发 `storage.onChanged` → `load()` → **同一面板里的草稿被冲掉**；
2. **保存另一行也会触发** —— 行 B 的 `Save` 写存储 → 重载 → **行 A 的草稿被冲掉**；
3. **最高频的是 `Clear` 的"两段交互"**（DT9）：`Clear` 立即生效（写存储 + 重载，草稿被冲）→ 用户在 5 秒内点 `Undo`（**再写一次存储 + 再重载**）。
**⇒ 用户在同一个展开面板里"边清边改"时，草稿几乎必然被冲掉。**

**⚠️ 后续修订（IMP-14 撤销 / IMP-19）**：原本为缓解此代价而设计的 `Save all`（IMP-14 ③）**已被撤销**（用户裁决：不做脏点 / 汇总条 / `Save all`）→ **本代价回到"完全无缓解"状态**（唯一信号是每行 `Save` 的 `disabled`）。详见 IMP-19 的"残留空洞"。

### ✅ IMP-2 · 窄栏 `FieldEditor` 密度 = **① 常驻展开**（用户裁决）

**决定**：侧边栏弹窗内 Title / Icon **两个 `FieldEditor` 全平铺常驻展开**，靠 `.tbs-dialog` 的 `max-height:80vh; overflow-y:auto`（R2）滚动。

**🔴 本裁决带出一个必须修补的实测缺陷**：`.tbs-dialog` **自身就是滚动容器**（`base.css:157-166`：`max-height:80vh; overflow-y:auto; padding: var(--space-xl)`），而 header / footer 都是它的**子元素** → **内容变长后 `Save` / `Cancel` 会滚出视野**。既有弹窗内容都短，故此问题**至今未暴露**；常驻展开后它**必然发生**。
**必要修补（1 条，不新开裁决项）**：给 `.tbs-dialog__header` / `.tbs-dialog__footer` 加 `position: sticky`（top / bottom）+ **不透明背景**（否则内容会透出）。注意该滚动容器有 `padding`，sticky 元素需用负 margin 或调整 padding 补齐边缘缝隙。

**连带推论（简化实现）**：
1. **`IMP-11 自动关闭** —— 本裁决明确"两面都常驻展开"后，**不存在"密度切换"**，因此不需要 `ResizeObserver` / 容器查询 / `surface` 驱动密度。`FormView` 退化为**纯分组布局**（不再持有密度策略）。
2. **`RuleFormFields.View` 的"两行摘要"设计取消** —— ② S4b 里我预留的"窄栏折叠为两行摘要"**不再需要**。
3. **`submitMode`（DT12）仍为面特异** —— 密度统一不等于提交模型统一：侧边栏 `immediate`、Dashboard `draft`，仍须**显式 prop**（符合 DT1"不设隐式默认"）。
4. **② D-4 的"三段式密度策略"降级** —— 变为**纯宽度断点**（隐藏次要信息），不再涉及字段的展开/折叠。

**接受代价（显式登记）**：288px 下弹窗很长；`Clear` / 徽标 / 影响面预览**会淹没在滚动中**。缓解依赖 DT12 已要求的"`Clear` 紧贴其维度" + ② D-6 的分组标题（`Where` / `What` / `Priority`）提供层次锚点。

---

### ✅ IMP-3 · Rules 页 `New Rule` 容器 = **保持现状（顶部内联表单）**（用户裁决）

**决定**：`New Rule` 继续是表格上方的内联展开表单（`showForm` 开关，`:902-1024`）；`InlineRuleEditor` 继续是行内展开。**位置形状差异有意保留。**

**与 DT8 / Q13 的关系澄清（重要，防误修）**：Q13/DT8 要求的是"**共用同一组件**（create / edit 两模式）"，**从未要求位置统一**。实测两处布局**本来就同源** —— New Rule 与 `InlineRuleEditor` 都用 `.tbs-settings__rule-form-grid`（`settings.css:524-529`）。
**⇒ 位置形状不同 ≠ 字段集分叉**：③ 只保留"新建在顶部、编辑在行内"的**位置差异**；字段集 / 校验 / 文案 / 布局仍由 `RuleFormFields` 的 `create` / `edit` 两模式**构造保证**一致。

**必须登记的代价（3 条）**：
| # | 登记项 | 说明 |
|---|---|---|
| 3a | **① 文档 D8 的处置须更正** | 从"消除两个表单"改为"**字段集已统一，位置形状有意保留差异**（用户裁决）"；否则后续会被当缺陷"修掉"（与 Q12 同类处理） |
| 3b | **与 IMP-4 的形状不一致是有意的** | Rules：新建在顶部 / 编辑在行内；Dashboard：**只有**编辑（行内）→ 显式登记为**面特异有意设计** |
| 3c | **`RuleFormFields` 须支持两种容器上下文** | Dialog 内 / 页面内联（布局 wrapper 差异）→ **须在接口上显式体现**，不得隐式判断（DT1） |

---

### ✅ IMP-5 · Dashboard 行内链密度 = **① 单元格只放"胜出值 + 来源徽标"**（用户裁决）

**决定**：表格单元格 = **胜出值 + 来源徽标**（`override` / `slot` / `rule` / `site` 之一）；**四层值 + `masked` + 清除入口全部进 IMP-4 的展开面板**。

**互补关系**：本裁决与 IMP-4 是**分工而非重复** —— 表格负责**扫读**（一行一眼看完），展开面板负责**排查**（空间充足，可放四层 + 遮蔽 + 清除）。

**连带要求**：
1. **徽标必须承载"可跳焦"语义**（① F11 / A10 的 `anchor`）→ 单元格内的徽标是**唯一**的跨面入口，须 `button` 语义 + `aria-label`（不可只靠 hover）；
2. **`site` 未捕获 → `—`**（`known:false`）→ 单元格须**区分**"值为 `—`（未知）"与"无值（空）"；且 `site` 节点**不可编辑**（原值属站点）；
3. **表格行高可预测** → 单元格内**不放**长度不定的东西（如命中列表）。

---

### ✅ IMP-7 · 创作态的 `Clear` = **③ 不渲染**（用户裁决）

**决定**：`rule-create` 场景（侧边栏弹窗 + Rules 的 `New Rule`）**不渲染 `Clear`**；`rule-edit` / `field-edit` 场景渲染。

**⚠️ 与 DT1 的冲突必须用"显式能力"化解（否则会变成新的分叉）**：
DT1 的原文是"字段集差异**只能**通过**显式 props / variant** 表达；组件内**不得**按'调用方是谁'分支；**不设隐式默认**"。③ **不违背** DT1 —— 前提是隐藏必须由**显式能力 prop** 驱动，而非组件内自我判断：

```ts
// ✅ 合规：能力由 FormScene 派生、显式传入；FieldEditor 内**没有** scene 概念
<FieldEditor
  {...}
  canClearChain={scene.kind !== 'rule-create'}   // 由场景派生，非手写布尔
/>
// ❌ 违规：组件内按调用方分支
// if (surface === 'sidebar') return null;
```
**录入方式**：`canClearChain` 的取值**只允许**由 `FormScene` 派生（`deriveCapabilities(scene)`），**不得**由各调用点手写 → 这样"哪一面有这个能力"变成**一处真源**，③ 与 DT1 兼容。

**接受代价（显式登记）**：
| # | 登记项 | 说明 |
|---|---|---|
| 7a | **能力面差异成立** | create 面无 `Clear`、edit 面有 → 这是**本迭代第一处"有意能力差异"**（DT1 理由③ 明确否决过"能力不等"，故须显式登记为**例外**，并附本裁决理由） |
| 7b | **理由（为何例外成立）** | 创作态**无"已落存储的链"可清**：规则尚未保存、`site` 层按新 tab 尚未捕获（A7 惰性捕获）、`ChainResult` 几乎全空 → `Clear` 在 create 态**无对象可作用**（不是"不便"，是**无意义**） |
| 7c | **`Reset this edit`（`↺`）仍在 create 态渲染** | 它有明确对象（复位到预填基准）→ 两按钮的"有无"在 create 态**不同**，须在文档中说明（避免被当 bug） |
| 7d | **① 文档 D8/D12 的"4 入口共享同一组件"表述须补例外** | 否则计划/复审会用"字段集必须完全相等"作为判据而判 FAIL |

**🔴 本裁决顺带暴露一个未决的**命名/语义问题**（新登记 IMP-17，见下）**：create 态既然隐藏了 `Clear`（因为它无链可清），那么**第三选项 `Site original value`（DT6 的"本层不设值 → 回落"）在 create 态同样"无链可回落"** —— 此时它的字面含义（"使用站点原值"）**与实际效果（"本规则不设该字段，由 override/slot/site 决定"）不一致**：若某页同时命中 slot，实际显示的是 **slot 的值**，不是站点原值。

---

### ✅ IMP-17 / IMP-17b · 第三选项**全局改名**为 **`Use chain`**（用户裁决）

**决定**：`Icon URL` / `Custom Icon` / **`Use chain`**（**全场景单一名字、单一语义**）；**撤销 DT6 原定的 `Site original value`**。

**改名理由（两条，均来自实测）**：
1. **必须同时适用于 Title**（DT5 的对称要求）→ `Site original value` 是**图标语境**，对标题不成立（"标题的站点原值"是什么？）；
2. **字面暗示与实际效果冲突** —— 它描述的是"**本层不设值 → 由链的下层决定**"；若某页同时命中 `slot`，用户选了它之后**看到的是 slot 的值，不是站点原值**（这正是 DT6 里我已标记的"名不副实"风险，在 create 态更严重：规则未存 + `site` 未捕获 ⇒ **几乎无可回落**）。`Use chain` 描述的是**行为**（值取自链），对三种情形都成立。

**被推翻的原设计（须登记）**：
- **DT6 的"主标签 = `Site original value`（用户指定，保留）"** → 改为 `Use chain`；
- **DT2 的"命名统一为 `Icon URL` / `Custom Icon` / `Site original value`"** → 第三项改名，**前两项不变**（`Icon URL` / `Custom Icon` 仍为基准）。

**连带回改（已完成）**：DT2 / DT3 / DT5 / DT6 / 遗留-文案；UI deep-dive ① 的 S1 字段表 + S4a + 遗留-文案；Architecture module 的 A1-bis 清除作用域表。

**旁注（两态，必须由旁注承担诚实化）**：
| 场景 | 旁注 |
|---|---|
| edit 态 | `Clears this layer — the value falls back to the next one in the chain.`（DT6 原句） |
| create 态 | **不暗示"回落"**（此时几乎无可回落）→ 如 `This field stays unset — other layers will decide.` |

**净效果**：三选项均为**名词短语**（`Icon URL` / `Custom Icon` / `Use chain`），风格平行；且"名字所描述的是**指派来源**，而非**最终显示值**"这一点全场景一致 —— **只有 `Clear`（DT7）承诺"回到站点原值"**。

---

### ✅ IMP-8 · `MatchSummary` 命中数查询时机 = **① 打开时查一次，URL 改动后即失效**

**决定**：
1. **打开表单时查一次**（以**预填 URL** 为输入）→ 展示 **`Matches 12 tabs`**（含 `N = 0` 的中性句 `No open tabs match right now`）；
2. **一旦用户改动 `Match URL` 或 `Match Type`** → 该数字**立即失效**：**变灰 + 标注 `stale`（如 `Matches 1 tab · outdated`）或直接隐藏**；
3. **不引入**实时防抖重查，**不新增**后台查询通道（沿用既有 tab 查询能力）。

**接受代价（显式登记）**：
| # | 登记项 | 说明 |
|---|---|---|
| 8a | **改动后无参考信息** | 用户调整 URL 后失去命中数参考；缓解靠 ② D-7 的 `N = 0` 警告（**仅在初始查询即 0 时**出现） |
| 8b | **`N = 0` 的两种含义必须区分** | ①**未查到**（初始即 0 → 文案已定稿：**`No open tabs match right now`**，**中性**、不给否定性警告）；②**已失效**（显示 **`Matches 12 tabs · outdated`**，数字变灰 + 文字标注，**不给警告**）—— 成品文案见深挖② §5.2 |
| 8c | **规则创建时命中数常为 0**（实测：A3 的规则维是多 tab，新规则尚无命中者）→ **警告会频繁出现**，文案须避免否定用户 ⇒ **已定稿为中性句 `No open tabs match right now`**（不用 `the rule will not apply`） |
| 8d | **豁免 C4 防抖** | 本决定只查一次，**不触发** C4 的 ~300ms 防抖红线（无连续查询）→ 不违反约束 |
| 8e | **`stale` 的呈现必须可感知但不刺眼** | 变灰 + 文字标注（**不可仅靠颜色**，WCAG 2.1 AA / C8） |

**与 ② D-7 的关系（须更正）**：② D-7 原写"**一边输 URL 一边看到命中数变化**" → 按本裁决改为"**打开即有一个基准数字；改动后即标注失效**"。

---

### ✅ IMP-9 · Rules 表格列序 = **重排（不合并单元格）**（用户裁决）

**决定**：列序由现状 `☑ / Icon / URL Pattern / Mode / Priority / Title / Enabled / Actions`（`:1029-1101`）改为：

> **`☑ / Icon / Title / URL Pattern / Priority / Enabled / Actions`**（**7 列**）

**核心变化**：
1. **`Title` 从第 6 位前移到第 3 位**（紧跟 `Icon`）→ 让"这条规则会让页面变成什么样"（图标 + 标题）**相邻且靠前**，与 D-11 的意图一致，但**不合并单元格**（保留各自的排序与 `aria-label`）；
2. **删除 `Mode` 列** —— 与 Q11（取消 `manual`）保持一致（见 IMP-18 裁决）。

**影响**：
| 项 | 说明 |
|---|---|
| `InlineRuleEditor` 的 `colSpan` | **8 → 7**（`settings/App.tsx:521`、空态 `:1171` 两处） |
| 排序 | `SortKey`（`:33`）**去掉 `mode`** → 变 `urlMatch` / `title` / `priority` / `enabled`；`compareRules`（`:36-49`）同步删分支；表格 `Mode` 列头与排序按钮删除（`:1048-1057`） |
| 搜索 | 不变（仍匹配 `urlMatch.value` + `title`，`:855-859`） |

---

### ✅ IMP-18 · `Mode` 列冲突 → **Q11 成立，删除 `Mode` 列**（用户裁决）

**决定**：**保持 Q11**（取消 `manual`）→ **删除 `Mode` 列**。

**连带改动清单（本裁决明确化 Q11/A9 的落地范围）**：

| # | 位置 | 改动 |
|---|---|---|
| 1 | `src/shared/types.ts:99,104` | 删 `RuleMode` 类型 + `PageRule.mode` 字段 |
| 2 | `settings/App.tsx:1048-1057` | 删 `Mode` 列头与排序按钮 |
| 3 | `settings/App.tsx:33,36-49` | `SortKey` 去 `mode`；`compareRules` 删对应分支 |
| 4 | `settings/App.tsx:521, 1171` | `colSpan` **8 → 7** |
| 5 | `settings/App.tsx:616-619`（Inline）、`:1010-1015`（New Rule） | 删 `Auto-apply on match` 勾选 |
| 6 | `sidebar/App.tsx:787-790` | 删 `Auto-apply on match` 勾选 |
| 7 | `sidebar/App.tsx:1520, 1766` | 删 `r.mode === 'auto' &&` 条件（只留 `r.enabled !== false`） |
| 8 | `sidebar/App.tsx:1311`（`handleCreateGlobalRule` 载荷）、`:568`（`onSave` 签名）、`:576,596`（`mode` state） | 删 `mode` |
| 9 | `settings/App.tsx:419, 445-446, 494, 701`（Inline 的 `mode` state/载荷）、`:388-399, 401-411`（`RuleFormState`/`EMPTY_RULE_FORM`） | 删 `mode` |
| 10 | `rule-service.ts:357-365` | 收敛 `mode==='auto'` 过滤（改为只判 `enabled !== false`） |
| 11 | 消息契约 `CREATE_RULE` / `UPDATE_RULE` | 载荷去掉 `mode`（A11） |
| 12 | 既有测试 | `rule-save-chain.test.ts`（含 manual 不投递）**语义消失** → 按其新语义重写（C7 允许自由重写，登记 RK-1） |

**收益**：消除 ① D13 的"**不可见地永不生效的开关**"（`manual` 规则躺在列表里、页面毫无变化）；并**顺带回收一列宽度**（第 3 → 7 列）。

---

### ✅ IMP-10 · 空态判定 = **① 各 Section 自行判定**（用户裁决）

**决定**：`loading` / `error` / `empty` / `no-match` **四态**均由**各 Section 的客户端 state** 判定；**空态组件只负责渲染**（零判定逻辑）。

**四态定义（必须互斥且视觉/文案都不同）**：

| 态 | 判定 | 文案要点 |
|---|---|---|
| `loading` | 请求在途 | 骨架 / 加载提示 |
| `error`（**首次**，无旧数据） | `catch` 且无旧数据 | **阻塞面板** + `Retry` |
| `error`（**刷新**，有旧数据） | `catch` 且有旧数据 | **非阻塞提示条**（保留旧数据）+ `Retry` |
| `empty`（**成功但空**） | 请求成功 + 集合为空 + **无过滤条件** | "内容从哪来 + 去哪设置" |
| `no-match`（**过滤后为空**） | 集合非空 + **过滤条件非空** + 结果为空 | "搜索无结果" + `Clear search` |

**关键区分**：
1. **`empty` vs `no-match`** —— 现状**共用同一文案**（`settings/App.tsx:1169-1175`）→ 必须分离（① N17）；
2. **`error` vs `empty`** —— 现状**不可区分**（`loadRules` 静默 `catch` `:661-671`；Dashboard `:1265-1267`）→ 必须暴露（① N16）；
3. **`error`（首次）vs `error`（刷新）** —— **侧边栏已有先例**：阻塞错误面板（`:1742-1746`）+ 非阻塞 `role="status"` 提示条（`:1723-1730`）→ **Rules / Dashboard 复制此模式**。

**连带改动（必须）**：
| # | 位置 | 改动 |
|---|---|---|
| 1 | `settings/App.tsx:661-671`（`loadRules`） | 静默 `catch` → 置 **error** state（保留旧数据时用非阻塞形态） |
| 2 | `settings/App.tsx:1265-1267`（Dashboard `load`） | 同上 |
| 3 | `settings/App.tsx:1169-1175` / `:1576-1582` | 拆为 `empty` / `no-match` / `error` 三个分支 |
| 4 | 新增共享组件 | `EmptyState`（`variant: empty \| no-match \| error` + 可选 action）→ 三处复用，避免第四处再分叉 |

**登记**：`no-match` 的判定需**过滤条件非空**（而非仅"结果为空"）—— 否则"集合为空"时也会误判为 `no-match`（两态同时成立时的优先级须定死：**`empty` 优先**）。

---

### ✅ IMP-12 · `FormField` a11y 修复 = **① 只修本迭代触达的字段**（用户裁决）

**决定**：**不改 `FormField` 接口**；只在本迭代触达的字段上，由调用方**显式**把 `errorId` / `hintId` 绑到自己的 `input`。

**⚠️ 本裁决的固有缺陷（显式登记，因为它正是 bug 的成因）**：`FormField` 的注释写"由调用方自行绑定"（`components.tsx:341-371`），而**实际调用方都没绑** —— ① N15 的成因就是"靠自觉"。① 延续了同一机制，故**该缺陷对其他未触达字段依然存在**。

**因此必须补一个"可追踪"的兜底（不新开裁决项）**：把 `errorId` / `hintId` **正式登记为 `FormField` 的公开 API**（导出/文档化），并登记"**未绑定清单**"（本迭代**不修**，作为后续项），否则问题会再次沉底。

**本迭代需显式绑定 a11y 的具体位置**（即"触达面"）：
| # | 位置 | 绑定内容 |
|---|---|---|
| 1 | `RuleFormFields` 的 `Match URL`（含正则非法错误） | `aria-describedby` → 校验错误节点 |
| 2 | `RuleFormFields` 的 `Match Type` | `aria-describedby` → 实时校验/转换提示节点 |
| 3 | `RuleFormFields` 的 `Priority` | `aria-describedby` → 范围提示（若有） |
| 4 | `FieldEditor`（Title / Icon） | `aria-describedby` → `Use chain` 旁注 + 遮蔽提示 + 影响面预览 |

**登记的影响面（审计用）**：未触达的调用点**数量未清点**（① 勘察未枚举全部 `FormField` 使用处）→ 作为"后续项"登记，不阻塞本迭代。

---

### ❌ IMP-14 · 多行未保存指示 = **撤销**（用户裁决：Rules 与 Dashboard **不实现**脏点 + 汇总条）

**决定**：**不实现**脏点（`●`）、汇总条、`Save all`。原裁决（③ 三件套）**作废**。

**⚠️ 本撤销带出一个必须澄清的连带问题（登记为 IMP-19）**：
"不需要脏点 + 汇总条"的最合理解释是 **"不再存在需要标注的中间态"** —— 即 **Dashboard / Rules 的编辑也改为"改动即提交"**（无草稿、无 `Save`）。因为：
- **若有草稿（DT10 的 A3 统一 `Save`）**，则**必须**有某种"哪几行没存"的指示（至少每行 `Save` 的 `disabled` 要反映 dirty），**否则多行展开时用户无法知道状态** → 脏点/汇总条正是为此存在；
- **若改为立即提交**，则**不存在未保存状态** → 脏点 / 汇总条 / `Save all` **自然都不需要**。

**若 IMP-19 确认为"立即提交"，则连带失效的既有裁决**：
| 已裁决项 | 影响 |
|---|---|
| **DT10（A3 混合）** | Dashboard 的"统一 `Save`"→ 改回**立即提交** ⇒ **A3 实际退化为 A1（全产品立即提交）** |
| **IMP-13（不持久草稿）** | 无草稿 ⇒ **整条裁决失去对象**（自动作废，无争议） |
| **IMP-4 的 4a/4b/4e** | 4a（`Map<entryId, draft>`）→ 不需要草稿 → 只需 `Set<entryId>`；4b（草稿被刷新冲掉）→ **风险消失**；4e（多面板 dirty 指示）→ **不需要** |
| **DT12（`Clear` 与 `Save` 视觉分离）** | 改值也立即生效 ⇒ **两者时机一致**，DT12 的"一致性缺口"**消失**（大幅简化） |
| **IMP-15 / IMP-16** | 展开机制只需 `Set`（无草稿）→ 抽象变小；Escape/焦点问题**仍存在**，仍需单独裁决 |

### ✅ IMP-19 · "不需要脏点 + 汇总条" = **② 保留统一 `Save`（草稿仍在），只是不做未保存指示**（用户裁决）

**决定**（确认）：
| 项 | 状态 |
|---|---|
| **DT10（A3 混合：Dashboard 统一 `Save`）** | **保留不变** |
| **DT12（`Clear` 立即生效 vs `Save` 草稿的视觉分离）** | **保留且更重要**（草稿仍在 ⇒ 时机差异仍在） |
| **IMP-13（草稿不持久）** | **保留**（无草稿持久化） |
| **IMP-14（脏点 / 汇总条 / `Save all`）** | **撤销**（本裁决） |
| **IMP-4 的 4a（`Map<entryId, draft>`）** | **保留**（多行各自草稿仍需容器） |
| **IMP-4 的 4b（刷新冲掉草稿）** | **保留为已接受风险**（IMP-13 ① 的代价） |
| **IMP-4 的 4e（多面板 dirty 指示）** | **撤销**（与 IMP-14 同源） |

**⚠️ 残留空洞（显式登记，已确认接受）**：
在多行同时展开 + 无任何未保存指示的前提下：
1. 用户**无法知道哪几行有未保存修改**；
2. 点行 B 的 `Save` → 触发重载 → **行 A 的草稿被静默丢弃**（IMP-13 13b），**且无任何提示**；
3. 因此 **IMP-13 的代价由"部分缓解"回退为"完全无缓解"**（原 IMP-14 ③ 的 `Save all` 曾是唯一缓解手段，随本裁决撤回）。

**保留的最小信号（不属于"脏点/汇总条"，属按钮自身状态，故保留）**：
- 每行 `Save` 的 **`disabled = !dirty`**（DT10 原文）—— 这是**逐行**可得的唯一状态信号；用户可通过"按钮是否可点"推断本行是否被改过。**本迭代须确保该 `disabled` 由本行 dirty 真实驱动**（否则连这个信号也没了）。

**建议（不新增 UI，仅实现注意）**：重载/刷新**不要**给出"全部已保存"之类的暗示性文案（避免用户误以为草稿已存）。

### ✅ IMP-15 + IMP-16 · 展开机制 = **① 抽极小共享 hook `useExpandRow`**（用户裁决）

**决定**：抽 `useExpandRow`（**唯一实现**），供 **Rules** 与 **Dashboard** 共用；**同时**修好两处的 `Escape` 取消与展开后焦点移入。

```ts
/** 行展开的唯一实现：展开集 + Escape 取消 + 展开后焦点移入 */
function useExpandRow<Id extends string>(opts?: {
  /** 收起时的焦点回归目标（默认回到触发的 toggle 按钮） */
  restoreFocusOnCollapse?: boolean;
}): {
  expanded: ReadonlySet<Id>;
  isExpanded: (id: Id) => boolean;
  /** 展开 → 焦点移入首个可聚焦字段；收起 → Escape 触发 */
  toggle: (id: Id, rowEl: HTMLElement | null) => void;
  collapseAll: () => void;
  /** 由展开行容器接收：处理 Escape + 聚焦首个字段 */
  getRowHandlers: (id: Id) => {
    onKeyDown: (e: React.KeyboardEvent) => void;
    ref: React.RefCallback<HTMLElement>;
  };
};
```

**关键实现约束**：
| # | 约束 | 说明 |
|---|---|---|
| 15a | **焦点移入时机** | 展开**后**（DOM 提交后）再聚焦 —— 需 `useEffect` 或 `setTimeout(…,0)`；**不能在 `toggle` 内直接 focus**（元素还未挂载）。侧边栏已有先例：`setTimeout(() => titleInputRef.current?.focus(), 0)`（`sidebar/App.tsx:1235`） |
| 15b | **Escape 的语义 = 收起本行**（非"丢弃改动"） | 与侧边栏行内编辑一致（`sidebar/App.tsx:1273`：`Escape → setEditingTitle(false)`）。**须注意**：若本行有未保存草稿（DT10），Escape **不收起草稿**（草稿仍在、行收起）—— 但**本迭代无未保存指示**（IMP-19）⇒ 用户收起后**看不到草稿还在**。**登记为 IMP-19 残留空洞的一部分** |
| 15c | **焦点回归** | 收起时焦点应回到该行的 toggle 按钮（否则掉到 `<body>`，与 `Dialog` 的 F4/N7 同类问题 `components.tsx:100-119`） |
| 15d | **`Set` 的不可变更新** | 与既有 `expandedRuleIds`（`settings/App.tsx:649`）保持同一习惯（`new Set(prev)`） |
| 15e | **Dashboard 的 `Id` 是 `entryId`** | 与 Rules 的 `ruleId` 同为 `string` ⇒ 泛型可复用 |

**收益**：防"两套展开"分叉（同 DT1 方向）；两处 a11y（① N13/N14）**一次修完**；且 Dashboard **不需**新建展开状态机（`useExpandRow` 直接复用）。

**本裁决不涉及**（已由 IMP-19 撤销）：脏点 / 汇总条 / `Save all` / 多面板 dirty 指示。

---

### 待裁决

| ID | 问题 | 选项 | 我的建议（仅供参考） |
|---|---|---|---|
| **IMP-1** | ✅ **侧边栏弹窗的容器** = **① 保留 `Dialog`**（用户裁决） | 见上方落盘 | — |
| **IMP-2** | ✅ 见上方裁决 = **① 常驻展开** | — | — |
| **IMP-3** | ✅ 见上方裁决 = **保持现状（顶部内联表单）** | — | — |
| **IMP-5** | ✅ 见上方裁决 = **① 单元格只放胜出值 + 徽标** | — | — |
| **IMP-7** | ✅ 见上方裁决 = **③ 不渲染 `Clear`**（另见新登记 **IMP-17**） | — | — |
| **IMP-17** | ✅ **第三选项命名** = **③ 全局改名**（用户裁决） | — | — |
| **IMP-17b** | ✅ **具体标签字符串** = **① `Use chain`**（用户裁决） | — | — |
| **IMP-7** | ✅ 见下方裁决 = **③ 不渲染** | — | — |
| **IMP-8** | ✅ 见下方裁决 = **① 打开时查一次，URL 改动后即失效** | — | — |
| **IMP-9** | ✅ 见下方裁决 = **重排列序（不合并单元格）** | — | — |
| **IMP-18** | ✅ 见下方裁决 = **Q11 成立，删除 `Mode` 列**（7 列） | — | — |
| **IMP-10** | ✅ 见下方裁决 = **① 各 Section 自行判定**（实为**四态**） | — | — |
| **IMP-11** | ✅ **已随 IMP-2 自动关闭** —— 两面均常驻展开 ⇒ **不存在密度切换**；`FormView` 退化为纯分组布局 | — | — |
| **IMP-12** | ✅ 见下方裁决 = **① 只修本迭代触达的字段** | — | — |
| **IMP-13** | ✅ **多行并存的 Dashboard 草稿** = **① 不持久草稿**（用户裁决） | 见下方裁决 | — |
| **IMP-14** | ❌ **已撤销**（用户裁决：Rules 与 Dashboard 不实现脏点 + 汇总条）→ 见 **IMP-19** | — | — |
| **IMP-19** | ✅ **保留统一 Save（草稿仍在），不做未保存指示**（用户裁决） | — | — |
| **IMP-15** | ✅ 见下方裁决 = **抽共享 `useExpandRow`** | — | — |
| **IMP-16** | ✅ 见下方裁决 = **两处一并修**（随 `useExpandRow`） | — | — |

---

## 6. 遗留至 Detail / 计划

| 项 | 说明 |
|---|---|
| `FormScene` / `FormView` 的最终形状 | 取决于 IMP-1/3/4/11 |
| 窄栏 ~288px 下的**具体排布**（R1） | 留待 Detail 的成品文案与间距 |
| `UndoBar` 泛化的载荷形状 | 取决于 IMP-6（需含"批次快照 + 文案 + 影响 tab 数"） |
| `MatchSummary` 的折叠阈值 | 与 Q9 的"前 3 条"合并 |
| 三态空态的**成品文案**（4 处） | ② D-15/D-21 |
| `FormField` 的 a11y 修复范围 | 取决于 IMP-12 |