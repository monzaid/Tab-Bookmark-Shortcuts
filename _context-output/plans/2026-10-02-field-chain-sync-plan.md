# Field Chain Correctness, Three-View Sync & Rewrite UI Redesign — Work Plan

> **计划名称**: field-chain-sync-plan
> **创建时间**: 2026-10-02 · **创建者**: sw-strategic-planner (Prometheus)
> **状态**: Ready for Execution（含 1 项**计划层默认裁决**，见 §Pre-Planning Review「Defaults Applied」）
> **上游设计（已四层收敛，OPEN 0，140 项裁决 + 19 项侦察证据）**:
> - 主文档 `_context-output/designs/2026-10-02-field-chain-sync-design.md`
> - 决策清单 `_context-output/designs/2026-10-02-field-chain-sync-decisions.yaml`
> - 9 份子文档（Goal / Constraint / Architecture ×3 深挖 / Detail ×2 深挖）
> **基线**: HEAD `a3d6ab3`（实测 `git log` 确认；工作区仅 `_context-output/designs/` 未跟踪文档，`src/` 无改动）
> **Coherence Check（设计矛盾/缺口）**: 见 §Design Contradictions & Gaps（**5 项，含证据；其中 3 项阻断级**）

---

## TL;DR

> **Quick Summary**: 把 title/icon 的优先级链收敛为「**单一共享纯函数**（`src/shared/field-chain.ts`）+ **单一写侧协调者**（`src/background/field-delivery-service.ts`）+ **单一内容脚本投递实现**」，从而用**构造保证**消除「改了不生效」；同时按同一链重写侧边栏/Rules/Dashboard 三界面（共享 `RuleFormFields` + `FieldEditor` 两层组件），落地清除语义、来源徽标、跳焦、a11y 与成品文案。
>
> **Deliverables**（具体文件，详见 Work Objectives）:
> - `src/shared/field-chain.ts`（新，A1/A1-bis，读侧唯一真源）
> - `src/background/field-delivery-service.ts`（新，A2/A3/A5/A6/A8）
> - `src/background/site-snapshot-store.ts`（新，A7/C6）
> - `src/shared/messages.ts` 契约重塑（A9/A11，删 `APPLY_RULE_TO_TAB`/`GET_CANDIDATES`/`APPLY_REWRITE`；新增 `FIELD_APPLY`/`SITE_SNAPSHOT_REPORT`）
> - `src/shared/types.ts` 契约重塑（删 `RuleMode`/`PageRule.mode`；`DashboardRow`；`LocalState.siteSnapshot`）
> - `src/ui/shared/{field-editor,rule-form-fields,radio-group,empty-state,undo-bar}.tsx` + `use-expand-row.ts` + `use-jump-to-row.ts`（新，共享件）
> - `src/ui/sidebar/App.tsx` / `src/ui/settings/App.tsx` 三界面重写
> - 删除孤儿 `src/ui/settings/RuleEditor.tsx` / `src/ui/sidebar/DualCards.tsx` 及其专属测试 + 死样式层 `src/ui/shared/global.css` / `src/ui/sidebar/sidebar.css`
> - 测试：`field-chain` 穷举、`normalizeUrl` 前后对照、投递调度、组件等价、契约清理、UI
>
> **Estimated Effort**: **XL（5+ 天）** — **21 个实现任务（T1–T21）+ 4 个终审（F1–F4）**
> **Parallel Execution**: YES — 4 Waves + FINAL
> **Critical Path**: `T1 → T7 → T8 → T14 → T15 → T20 → F1-F4 → user okay`（与 §Wave 图一致；原「T14 → T19」为笔误，T19 不在关键路径上）

---

## Context

### Original Request

由主 Agent（协调者）交付一份**可执行工作计划**，输入为已四层收敛（OPEN 0）的设计与决策清单：

- **核心约束（不可谈判）**：权限零扩张；内容脚本是投递唯一实现（`executeScript` 仅 apply 兜底）；lint delta-0 + typecheck 0 + 三浏览器 build；`src/ui` CJK 0；WCAG 2.1 AA；**强制独立复验（不采信执行者自审）**。
- **计划硬要求**：先读后规划（完整读主文档 + YAML，抽查 ≥3 份子文档）；每条任务含唯一 ID / 目标 / 涉及文件（路径 + 行号范围）/ 依赖前置 / 验收判据 / **RED 可构造性说明**；给出 Wave 分组与关键路径；登记 RK-1..RK-4；**不得修改任何设计文档、不得修改 `src/`**。

### Interview Summary

本会话**无访谈阶段**（用户已在 design 阶段完成 140 项裁决，OPEN 0）。规划者职责收敛为 **D-d（测试分层与 RED 可构造性）**——这是设计层唯一显式移交计划层的事项（`decisions.yaml:571-581`，`status: DEFERRED`）。

**Key Decisions（继承自设计，不再重开）**:
- **Q5/A1**：链抽为 `src/shared/field-chain.ts` 纯函数，UI 内存态同步计算（否决 `COMPUTE_FIELDS` 往返；否决双份 + 锁步测试）。
- **Q4/A2**：重算+重投递收敛为 `recomputeAndRedeliver(affectedTabIds)` 单一入口（否决纯事件驱动 / 各写入方自理）。
- **C2**：内容脚本为投递唯一实现；`executeScript` 退化为仅 apply 兜底并标 `degraded`（消除现状主/备能力集不同）。
- **Q11/A9/IMP-18**：取消 `mode='manual'` → 删 `PageRule.mode`/`RuleMode`/`APPLY_RULE_TO_TAB`/`GET_CANDIDATES`/每 URL guard（**12 条落地清单**）。
- **Q6/DT7/DT9/A4-bis**：清除 = 回落下一层 + 站点原值还原；两条作用域（本层 `Use chain` / 整链 `Clear`）；`Clear` 免确认 + 5s `UndoBar`（原子批次恢复）。
- **DT10/DT12/IMP-19**：提交模型 = A3 混合（Dashboard `Save` 草稿；侧边栏/slot 立即提交；`Clear` 恒立即生效）；**不做**未保存指示（仅每行 `Save.disabled`）。
- **E1/E1-a/E4/E5**：UI 全量复用后台校验原语；**必须先 `wildcardToRegex` 再校验**；`normalizeUrl` 全局补「尾斜杠等同」（排除根路径 `'/'`）。
- **F1/F1b/F2**：跳焦 = 滚到 + ~2s 临时高亮（不自动展开）；回退链（目标行 → 表格第一行 → 搜索框），**回退不高亮** + 如实说明 + 非视觉播报。

### Research Findings

**Codebase Analysis（规划期实读源码核实，非引用设计文档）**:

| # | 实测事实 | 证据（文件:行） | 对计划的影响 |
|---|---|---|---|
| 1 | 链实现确有**两份**：`rule-service.computeFieldsFrom` 与侧边栏手抄 | `src/background/rule-service.ts:345-406` vs `src/ui/sidebar/App.tsx:1492-1528` | T1 必须成为唯一真源；T8/T14 消除手抄 |
| 2 | rule 排序**未用**共享函数（内联 sort） | `rule-service.ts:360-363` vs 共享 `src/shared/url-utils.ts:457-471` | T1 复用 `sortRulesByPriority`/`selectWinningRule` |
| 3 | 主路径为 `executeScript`，fallback 为 `sendMessage`（**能力集不同**） | `src/background/apply-fields.ts:126-161`；`applyRewriteInPage:22-108`（`title=null` 实为 `document.title=''`，`:31-32`） | T8 反转主备（内容脚本为唯一实现） |
| 4 | `content/index.ts` 有**每 URL 一次** guard（`appliedUrls`） | `src/content/index.ts:228-231` | T4/T8 删除，由 A5 调度取代 |
| 5 | `force` 概念存在但主路径未真正读取其语义 | `apply-fields.ts:115,137,157`；`worker-orchestrator.ts:927,942-954` | T7 删除 `force`（投递恒幂等） |
| 6 | 受保护页判定**分散 3 处** | `worker-orchestrator.ts:972`（`reapplyFieldsToBoundTab`）、`:617`、`:469`（设计点名） | T7 集中到投递入口（A8） |
| 7 | `KNOWN_ACTIONS` 为**手写白名单**，含 `APPLY_RULE_TO_TAB`(`:56`)/`GET_CANDIDATES`(`:81`) | `worker-orchestrator.ts:43-97` | T4 必须与联合类型**同提交**清理（防「编译通过但运行被拒」） |
| 8 | UI 裸 `new RegExp` 实测 **5 处**（设计称 4 处，见 §Design Contradictions G-3） | `sidebar/App.tsx:617,704`；`settings/App.tsx:467,736,938` | T3 全部替换为 `validateRegex(wildcardToRegex(x).pattern)` |
| 9 | 共享校验原语**已存在**但活表单几乎不用 | `url-utils.ts:301`(`validateRegex`)、`:607`(`isSafeFaviconProtocol`)、`:493`(`detectRuleConflict`)、`:18`(`normalizeUrl`) | T3 收敛；`normalizeUrl` 仅「import 未用」(`sidebar:499`,`settings:18`) |
| 10 | `settings/App.tsx` **未 import** `Confirm` | `settings/App.tsx:13`（仅 `Button, Toast, StatusBadge`） | T15/T16 接入 `Confirm` |
| 11 | `Toast.action` 能力**零使用**（仅定义） | `components.tsx:241,247,273` | T11 泛化 `UndoBar`（避免第二套撤销 UI） |
| 12 | `UndoBar` 硬编码文案 + `role="alert" aria-live="polite"`（语义冲突）+ 打开不聚焦 | `sidebar/App.tsx:462-493`（`:487` 硬编码、`:486` role 冲突） | T11 泛化 + T17 修 role/焦点 |
| 13 | `DraftProtectionDialog`/`isDirty` **零引用** | `sidebar/DualCards.tsx:101,157-168`；`settings`/`sidebar` 均未 import | T18 随孤儿删除；T16 复用 `isDirty` 思路做每行 `Save.disabled` |
| 14 | `selectedIds` 与可见集不同步（批量删除可能删不可见项） | `settings/App.tsx:653,814-824,891-893` | T15（见 §Design Contradictions G-1） |
| 15 | Dashboard 表头全选用 `entries`，行用 `sortedEntries` | `settings/App.tsx:1479-1487` vs `:1539` | T16 一致化 |
| 16 | `InlineRuleEditor` 无 Escape / 无展开后焦点移入 / `colSpan={8}` | `settings/App.tsx:519-521,1160-1166` | T11(`useExpandRow`) + T15(`colSpan` 8→7) |
| 17 | `.tbs-dialog` 自身即滚动容器（`max-height:80vh; overflow-y:auto; padding`），header/footer 是其子元素 | `base.css:157-166,168-185` | T12 补 sticky（IMP-2 带出） |
| 18 | `--tbs-*` 旧样式层零引用（死代码） | `src/ui/shared/global.css`(149 命中)、`src/ui/sidebar/sidebar.css`(32 命中)；仅 `styles/base.css`+`styles/sidebar.css` 被 import | T12 删除（N2） |
| 19 | `settings.css` 的 `.tbs-settings__drawer` 存在但零引用；`z-index:300` < `Dialog` 400 | `settings.css:475-493,603-605`；`base.css:150` | T16 采用**行内展开**（IMP-4），不用 drawer |
| 20 | 既有测试**可编译面**包含 `tests/`（`tsconfig.include` 含 tests） | `package.json` `typecheck`=`tsc --noEmit`；`vitest.workspace.ts` 三个 project | 每个提交须保持 typecheck 绿（含测试夹具形状） |

**External Research**: 无（C8 不新增依赖；无外部库引入）。

### Pre-Planning Review（内联 gap analysis — Metis 清单落地）

> 设计层 OPEN 0，故 pre-planning 焦点为「**执行可构造性 + 易漏项 + 计划层默认裁决**」。

**Identified Gaps（addressed）**:

| # | Gap | 处置 |
|---|---|---|
| G-A | **D-d 测试分层与 RED 可构造性未定义**（设计显式移交） | 每任务携带「RED 可构造性说明」；Wave 4 收口既有测试锚点迁移（T19） |
| G-B | **RK-1 缓解措施（`field-chain` 穷举单测 + 前后等价对照）未落到具体用例** | T1 定义 title/icon 两条独立链的**穷举矩阵**（4 个 tier × 设置/未设置 × 优先级并列） |
| G-C | **`normalizeUrl` 尾斜杠等同属「已发布匹配语义变更」（RK-2/E5-d）无对照基线** | T2 用 `git show a3d6ab3:src/shared/url-utils.ts` 的旧实现做**前后对照**（同输入 → 新旧输出比对表） |
| G-D | **易漏项清单需逐条落到任务**（IMP-18 12 条 / 5 处裸 `new RegExp` / sticky / 死样式 / N8 / N1 / N11） | 见 §易漏项对照表（逐条映射到任务 ID） |
| G-E | **`FormScene`（派生 `canClearChain` 的唯一真源）在设计层仍是「待你确认」**（深挖③ §4.2），而 IMP-7 强制 `deriveCapabilities(scene)` | **计划层默认裁决**：以 `RuleFormFields.variant`（`create|edit`）+ `FieldEditor` 显式 props 表达能力，`canClearChain` 由 `variant !== 'create'` 在一处派生（见 §Design Contradictions G-2 与 T10） |
| G-F | **`selectedIds` 裁剪策略 (a)/(b) 未裁决**（深挖② D-13 列为「待裁决」） | **计划层默认裁决 = (a) 自动裁剪**（与「所见即所操作」一致，无新交互）——登记为计划层默认，可被覆盖 |
| G-G | **既有测试「完全自由重写」（C7）导致覆盖真空** | T19 逐文件登记**语义保留 / 语义消失 / 主备反转**三类，并新增 T20 端到端一致测试补证据 |

**Guardrails Recommended**:

1. **不新增 permission / host_permission / command / npm 依赖**（C1/C8）——终审 F1 逐条核对 `manifests/*.json` 与 `package.json` diff。
2. **内容脚本是投递唯一实现**（C2）——禁止在 `executeScript` 注入函数里新增 `restore` 语义。
3. **`field-chain.ts` 是链的唯一实现**——终审 F4 搜索 UI 侧是否仍有手抄链（`state.sync.rules.filter(...type==='auto')` 等）。
4. **lint delta-0**（不放宽 `eslint.config.mjs`、不新增 `eslint-disable`）。
5. **界面统一英文 + `src/ui` CJK 0**（`tests/unit/ui/no-cjk-in-ui.test.tsx` 为守卫）。
6. **`--tbs-*` 旧 token 层不得复活**——新增样式只用 `tokens.css` 的 `--color-*`/`--space-*`/`--duration-*`。
7. **不修改任何设计文档**（本计划只读设计层）。

**Defaults Applied（计划层默认，可覆盖）**:

| # | 默认 | 理由 / 覆盖方式 |
|---|---|---|
| D-1 | `selectedIds` 裁剪 = **(a) 自动裁剪**（过滤/刷新时移除不可见 id） | 与「所见即所操作」一致；无新交互（深挖② 已倾向 (a)）。若用户选 (b)，替换 T15 的裁剪实现 |
| D-2 | `FormScene` **不落地为独立模块**；能力由 `RuleFormFields.variant` + 显式 props 表达 | 设计层未裁决该抽象；避免为未裁决抽象建模块（防 AI-slop over-abstraction）。若用户确认 FormScene，则在 T10 前插入一个派生层任务 |
| D-3 | Wave 4 为集成波（2 任务，低于 5-8） | 集成波天然较小（依赖多个上游），符合并行化规则例外 |

---

## Work Objectives

### Core Objective

让 **title / icon 的优先级链成为「唯一真源 + 唯一实现 + 可解释可清除」**：任何改字段的写入落存储后必然触发对受影响标签页的**重算 + 重投递**（含显式清除），三视图（Current Page / slot / Data Dashboard）按**同一纯函数**派生显示值与来源，并重写四界面共享编辑器（消除 3~4 处复制实现）。

### Concrete Deliverables

- [x] `src/shared/field-chain.ts` — 读侧唯一真源（`resolveFieldChain` / `ChainResult` / `TierValue` / `TierOwner` / `clearChain`）
- [x] `src/background/field-delivery-service.ts` — 写侧唯一协调者（`recomputeAndRedeliver` / 受影响集合 / 单一入口 leading-trailing / 有界重试 / `degraded`）
- [x] `src/background/site-snapshot-store.ts` — `siteSnapshot`（`local` 严格封闭）
- [x] `src/shared/messages.ts` — 契约清理 + 新增 `FIELD_APPLY`/`SITE_SNAPSHOT_REPORT`
- [x] `src/shared/types.ts` — 删 `RuleMode`/`PageRule.mode`；`DashboardRow`；`LocalState.siteSnapshot`
- [x] `src/shared/form-validation.ts` — 共享校验纯函数（`validateRuleForm`/`validateFieldEditors`，E1/E1-a/CT4-bis）
- [x] `src/shared/url-utils.ts` — `normalizeUrl` 补尾斜杠等同（E4/E5-a）
- [x] `src/content/index.ts` — apply / restore / 惰性捕获 / 回报（唯一实现）
- [x] `src/background/apply-fields.ts` — 退化为 `executeScript` 仅 apply 兜底
- [x] `src/ui/shared/field-editor.tsx` — 字段编辑器（Title/Icon 维度，S4a）
- [x] `src/ui/shared/rule-form-fields.tsx` — 规则表单字段集（S4b/DT8）
- [x] `src/ui/shared/radio-group.tsx`、`empty-state.tsx`、`undo-bar.tsx`、`use-expand-row.ts`、`use-jump-to-row.ts`
- [x] `src/ui/sidebar/App.tsx`、`src/ui/settings/App.tsx` — 三界面重写
- [x] 删除：`src/ui/settings/RuleEditor.tsx`、`src/ui/sidebar/DualCards.tsx`、`tests/unit/ui/rule-editor.test.tsx`、`tests/unit/ui/dual-cards.test.tsx`、`src/ui/shared/global.css`、`src/ui/sidebar/sidebar.css`

### Definition of Done

- [x] `npm run typecheck` → **0 error**
- [x] `npm run lint` → **delta-0**（基线错误数不变；不放宽配置）
- [x] `npm run test:unit` → ALL PASS；`npm run test:integration` → ALL PASS；`npm run test:ui-smoke` → ALL PASS
- [x] `npm run build:chrome && npm run build:edge && npm run build:firefox` → 三浏览器均成功
- [x] 反例搜索无命中：`rg "mode === 'auto'|mode === 'manual'|APPLY_RULE_TO_TAB|GET_CANDIDATES" src/` → 0
- [x] 反例搜索无命中：`rg "new RegExp\(" src/ui/` → 0（UI 侧禁裸 `new RegExp`）
- [x] `tests/unit/ui/no-cjk-in-ui.test.tsx` → PASS（`src/ui` CJK 0）
- [x] WCAG 2.1 AA 复核：新增控件（`RadioGroup`/`Confirm`/`UndoBar`/跳焦）全部**可键盘操作 + 可见焦点 + 非仅颜色**（F3 场景化验证 + axe 断言）

### Must Have

- [x] `field-chain.ts` 为 title 与 icon **各一条独立链**，链序 **`override > slot > rule > site`**，且 rule 胜出复用 `sortRulesByPriority`/`selectWinningRule`（SC1/A1）
- [x] 所有改字段的写入（override / slot / rule / Dashboard 编辑与清除）落存储后**必然调用** `recomputeAndRedeliver`（SC2/Q4）
- [x] **清除 = 回落下一层 + 站点原值还原**；不再出现「清空标题」或「图标消失」（SC3/Q6）
- [x] `siteSnapshot` 只存 `local`，字段仅 `{title, faviconHref}`，tab 关闭丢弃、导航重捕获（A7/C6）
- [x] `mode` / `RuleMode` / `APPLY_RULE_TO_TAB` / `GET_CANDIDATES` / 每 URL guard **全部删除**（Q11/A9，12 条清单）
- [x] `RuleFormFields` + `FieldEditor` 两层共享件被四入口复用（SC8/DT8）
- [x] 跳焦 = 滚到 + ~2s 高亮 + 回退链 + 非视觉播报（F1/F1b/F2）
- [x] 错误归属路由表落地（字段级内联 + 表单级区；toast 收窄为「成功 + 批量结果」）（E3/E3b）
- [x] `Clear` 免确认 + 泛化 `UndoBar`（原子批次恢复 + 重新投递）（DT7/DT9/IMP-6）

### Must NOT Have (Guardrails)

- [x] **不新增**任何 `permission` / `host_permission` / `command`（C1）
- [x] **不新增** npm 依赖；**不放宽** `eslint.config.mjs` 严格度；**不新增** `eslint-disable`（C8）
- [x] **不做 i18n**（界面统一英文）；**不改** incognito / 特权页拦截模型；**不改**槽位匹配策略模型（三旋钮四格）；**不改** Lock 内存态语义（Goal §2 OUT）
- [x] **不做** `FormScene` 独立抽象模块（未裁决，防 over-abstraction，见 Defaults D-2）
- [x] **不做**脏点 / 汇总条 / `Save all`（IMP-14 已撤销）
- [x] **不复活** `--tbs-*` 旧 token 层；**不新增**内联硬编码颜色（如 `#DC2626`）
- [x] **不修改**任何设计文档（只读）；**不修改** `src/` 之外的构建脚本语义（除既有）
- [x] **不做**「实时冲突检测」（E2：仅提交后如实提示）
- [x] **不碰** `src/ui/styles/tokens.css` 的颜色语义定义（只允许新增 `*--jump` 类，且只用既有 token）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — 所有验证由 Agent 执行。禁止「用户手动测试 / 目视确认」。

### Test Decision

- **Infrastructure exists**: YES（`vitest.workspace.ts`：`unit` / `integration` / `ui-smoke` 三个 project；`@testing-library/react`；`jsdom`；`tests/setup.ts`）
- **Automated tests**: **TDD**（每任务 RED → GREEN → REFACTOR）
- **Framework**: vitest（+ `@testing-library/react`、`@testing-library/user-event`）
- **每任务**：先写失败测试（RED 可构造性已逐条声明），再最小实现使其通过
- **手动验收替代**：`tests/manual/three-browser-acceptance.md` 为**人工脚本**，本计划**不作为验收门禁**；改以 `build:chrome/edge/firefox` 编译成功 + 自动化测试 + F3 场景化 QA 代替

### QA Policy

每个任务必须含 Agent 可执行 QA 场景（happy path + failure/edge），证据落 `_context-output/evidence/task-{N}-{slug}.{ext}`。

- **Backend / 纯函数 / 调度**：`Bash`（`npx vitest run --project unit -t "<name>"`；直接断言输入→输出）
- **Frontend / UI**：`Bash`（`npx vitest run --project ui-smoke`）+ `@testing-library/react` 断言 DOM（选择器/文案/`aria-*`）
- **构建/工程门禁**：`Bash`（`npm run typecheck` / `npm run lint` / `npm run build:chrome`）

### 门禁规则（本计划硬要求）

| 层级 | 门禁 |
|---|---|
| **每任务结束** | `npm run typecheck` **0 error** + `npm run lint` **delta-0**（本任务触及文件不新增告警） |
| **每 Wave 结束** | 该 Wave 全部任务相关测试全绿（`test:unit` + 相关 `test:integration`） |
| **FINAL** | 三浏览器 build 通过 + `test:unit`/`test:integration`/`test:ui-smoke` 全绿 + WCAG 2.1 AA 复核 |

---

## Design Contradictions & Gaps（规划期发现，**逐条附证据**）

> 规划要求：若发现主文档与子文档**矛盾，必须报告而不是擅自选择**。以下 5 项，**3 项为阻断级（需用户裁决）**，2 项为登记级（已有默认处置）。

### 🔴 G-1（阻断）· `selectedIds` 裁剪策略 (a)/(b) **未被裁决，但被列为「待裁决」**

- **证据**：深挖② `architecture-four-surfaces-ui-direction-design.md:154-158` 明写「D-13 … **须裁决**」并给出 (a) 自动裁剪 / (b) 显式标注，且 §8 遗留表 `:269` 仍列「📐 遗留至 Detail / 计划」；但主文档 `design.md:14` 声明「**OPEN 0**」，YAML `deferred` 段（`:571-581`）**未包含 D-13**。
- **矛盾实质**：主文档宣称 OPEN 0，子文档仍有一项显式「待裁决」（仅给出了作者倾向 (a)，非用户裁决）。
- **本计划处置（默认 D-1）**：按 **(a) 自动裁剪** 落地（T15），并在 T15 内**显式登记**该默认与理由，可被用户一行指令覆盖。
- **需用户确认**：`(a) 自动裁剪` 还是 `(b) 显式标注 "5 selected (2 not visible)"`？

### 🔴 G-2（阻断）· `FormScene` 抽象在深挖③中标注「**待你确认**」，但 IMP-7 又强制 `deriveCapabilities(scene)`

- **证据**：深挖③ `architecture-three-surfaces-implementation-direction-design.md:167-186`：`FormScene` 形状标题为「**建议形状（待你确认）**」；同文 `:314-323`（IMP-7）又要求 `canClearChain` **只允许**由 `deriveCapabilities(scene)` 派生，不得手写；同时 §6 遗留表 `:586` 把「`FormScene`/`FormView` 的最终形状」列为「**取决于 IMP-1/3/4/11**」。
- **矛盾实质**：一个被要求「必须由它派生能力」的抽象，其形状本身**未裁决**；若执行者自行发明 `FormScene`，即引入设计未授权的结构（违反 DT1「不设隐式默认」精神，也触碰 Must NOT「不做未裁决抽象」）。
- **本计划处置（默认 D-2）**：**不落地独立 `FormScene` 模块**；用 `RuleFormFields.variant`（`'create' | 'edit'`）在一个**唯一派生点**计算 `canClearChain = variant !== 'create'`（T10），从而同时满足 IMP-7 的「单点派生 + 禁止调用点手写」与「不引入未裁决抽象」。
- **需用户确认**：是否需要独立 `FormScene` 类型（若需要，T10 前插入一个 Wave 0 派生层任务）。

### 🟡 G-3（登记）· 设计称「**四处**裸 `new RegExp`」，实测 **5 处**

- **证据**：深挖③ `detail-validation-focus-empty-design.md:100` 列出 4 处（`sidebar:704`、`sidebar:616-620`、`settings:735-740`、`settings:936-943`）；实测 `rg "new RegExp" src/ui/` 得 **5 处**：`sidebar/App.tsx:617`、`sidebar/App.tsx:704`、`settings/App.tsx:467`（`InlineRuleEditor.handleSave`）、`settings/App.tsx:736`、`settings/App.tsx:938`。
- **差异实质**：设计把 `sidebar:616-620` 记为一处（该区间含 `:617`），但**漏计** `settings/App.tsx:467`（同一 `InlineRuleEditor` 的**保存路径**，与 `:738` 展示路径成对）。
- **本计划处置**：T3 按**实测 5 处**清理（不是 4 处），并在 T3 References 显式登记这一偏差。**不视为设计错误**（设计范围表述为「四处」但语义为「全部裸 `new RegExp`」），仅登记防漏。

### 🟡 G-4（登记）· 深挖② 未明示 `no-cjk-in-ui` 守卫是否会拦截「共享组件新增文件」

- **证据**：`tests/unit/ui/no-cjk-in-ui.test.tsx`（守卫）与深挖② 文案全为英文，二者一致；但深挖② 的**中文参考注释**（如 `detail-copy-a11y-design.md` 内示例）容易被执行者误抄进代码。
- **本计划处置**：每个 UI 任务 Must NOT 显式禁止 CJK 字面量入 `src/ui`；T19 运行守卫。

### 🟡 G-5（登记）· `DraftProtectionDialog`/`isDirty` 的处置在 DT10 与 IMP-13 之间**未定死**

- **证据**：深挖② `:271` 与深挖③ IMP-13 的 `13c`（`:250`）均把 `DraftProtectionDialog` / `isDirty` 归为「可考虑在 Q13 孤儿清理中一并处置」；但 `DualCards.tsx:157-168` 是其定义处，而 **Q13 要求删除 `DualCards.tsx`** ⇒ 若删除组件，`DraftProtectionDialog` 也随之消失。
- **矛盾实质**：DT10 又说「顺带启用**已存在却零引用**的脏态跟踪（N12）」——「启用 `isDirty` 思路」（T16 的 `Save.disabled`）与「删除 `DraftProtectionDialog`」（T18）需明确不冲突。
- **本计划处置**：`DraftProtectionDialog` **随孤儿删除**（T18，无人引用）；`isDirty` **仅作为思路**在 T16 以「草稿值 vs baseline 是否相等」推导 `Save.disabled`（不复活该组件）。已登记，不构成阻断。

---

## Execution Strategy

### Parallel Execution Waves

> 目标每波 5-8 个任务；Wave 4 为集成波（天然较小，符合例外）。
> **真实依赖**：`field-chain.ts`（读侧，T1）是 `field-delivery-service`（写侧，T7/T8）与三视图（T13/T14/T15/T16）的**共同前置**；契约清理（删 `mode`，T4）牵动侧边栏与设置页多处，**必须排在其依赖的 UI 任务之前**。

```
Wave 1（立即开始 — 契约 + 唯一真源 + 共享原语，全部无依赖）:
├── T1: field-chain.ts 读侧唯一真源（A1/A1-bis）+ 穷举单测  [deep]
├── T2: normalizeUrl 尾斜杠等同（E4/E5-a）+ 前后对照单测      [quick]
├── T3: 共享校验纯函数 form-validation.ts（E1/E1-a/CT4-bis）  [quick]
├── T4: 契约清理（types/messages/KNOWN_ACTIONS/message-client）[deep]
├── T5: site-snapshot-store.ts（A7/C6）                       [quick]
└── T6: radio-group / empty-state / use-expand-row 共享件      [quick]

Wave 2（Wave 1 后 — 写侧 + 投递 + 共享编辑器 + 跳焦，最大并行）:
├── T7: field-delivery-service.ts 受影响集合 + 单一入口调度（A2/A3/A5/C4）[deep]
├── T8: 投递协议 FIELD_APPLY 三态 + 内容脚本唯一实现 + 兜底降级（A4/A6/C2/C3）[deep]
├── T9: 受保护页集中判定 + 删除 force（A8/A5）                 [quick]
├── T10: rule-form-fields.tsx（S4b/DT8 + canClearChain 单点派生）[deep]
├── T11: field-editor.tsx + undo-bar.tsx（S4a/DT7/DT9/IMP-6）  [deep]
├── T12: 死样式层清理 + .tbs-dialog sticky（②N2/IMP-2）        [quick]
└── T13: use-jump-to-row.ts 跳焦（F1/F1b/F2）                  [deep]

Wave 3（Wave 2 后 — 三界面重写 + 文案 + a11y）:
├── T14: 侧边栏弹窗改造（S1/DT4/DT5/IMP-1/2/7/8）              [deep]
├── T15: Rules 界面重写（S2/IMP-9/10/18/D-13裁剪）             [deep]
├── T16: Dashboard 重写（S3/A10/IMP-4/5/13/19/G1）             [deep]
├── T17: a11y 收口（CT3-a/b/g + IMP-12 + G1 汇总句）           [deep]
├── T18: 孤儿与死代码删除（Q13/N10/DT11）                      [quick]
└── T19: 校验收敛落地 + 既有测试锚点迁移（E1/E1-a/C7/RK-1）     [deep]

Wave 4（集成波 — 端到端一致 + 工程门禁）:
├── T20: 三视图 = 投递值 端到端一致测试 + 三浏览器 build 门禁   [deep]
└── T21: lint delta-0 收口 + CJK 守卫 + CJK/样式 token 复核     [quick]

Wave FINAL（全部任务后 — 4 个并行审查）:
├── F1: Plan Compliance Audit（含 Must NOT 反例搜索）
├── F2: Code Quality Review（build/lint/tests/slop）
├── F3: Real QA（逐任务 QA 场景复跑 + WCAG 2.1 AA）
└── F4: Scope Fidelity Check（含「链是否仍有两份实现」搜索）

Critical Path: T1 -> T7 -> T8 -> T14 -> T15 -> T20 -> F1-F4 -> user okay
（T1 阻塞 T7/T8/T13/T14/T15/T16；T7/T8 阻塞 T14/T15/T16/T20）
Parallel Speedup: ~55% faster than sequential
Max Concurrent: 7（Wave 2）
```

### Dependency Matrix

```
- T1: 无依赖（Wave 1）— blocks T7,T8,T13,T14,T15,T16,T20
- T2: 无依赖（Wave 1）— blocks T3（校验复用 normalizeUrl）,T20
- T3: 无依赖（Wave 1）— blocks T4(载荷去 mode 后校验),T10,T14,T15
- T4: 无依赖（Wave 1）— blocks T8（协议新增 action）,T14,T15,T16,T19
- T5: 无依赖（Wave 1）— blocks T8（捕获回报）,T16
- T6: 无依赖（Wave 1）— blocks T10,T11,T15,T16,T17
- T7: depends T1,T4 — blocks T8,T14,T15,T16,T20
- T8: depends T1,T4,T5,T7 — blocks T14,T15,T16,T20
- T9: depends T7,T8 — blocks T20
- T10: depends T3,T4,T6 — blocks T14,T15
- T11: depends T1,T6 — blocks T14,T15,T16
- T12: 无依赖（Wave 2，仅样式）— blocks 无（无代码依赖）
- T13: depends T1,T6,T4 — blocks T15,T16
- T14: depends T1,T4,T7,T8,T10,T11,T13 — blocks T20
- T15: depends T1,T4,T7,T8,T10,T11,T13 — blocks T20
- T16: depends T1,T4,T5,T7,T8,T11 — blocks T20
- T17: depends T6,T11,T13 — blocks T20
- T18: depends T14,T15,T16 — blocks T19
- T19: depends T4,T10,T14,T15,T16,T18 — blocks T20
- T20: depends T14,T15,T16,T17,T19 — blocks F1-F4
- T21: depends T12,T18,T19 — blocks F1-F4
- F1-F4: depends ALL
```

### 易漏项对照表（✅ 不得遗漏，逐条映射）

| 易漏项（来源） | 落地任务 | 具体 |
|---|---|---|
| IMP-18 **12 条**清单 | **T4**（1,2,3,4,10,11）+ **T14**（6,7,8）+ **T15**（2,3,4,5,9）+ **T16**（工具栏文案） | 逐条核对（见 T4/T14/T15 描述） |
| 四处（实测 **五处**）裸 `new RegExp` | **T3**（共享函数）+ **T19**（删除点核对） | `sidebar:617,704`；`settings:467,736,938` |
| `.tbs-dialog` header/footer **sticky**（IMP-2 带出） | **T12** | `base.css:157-166` 是滚动容器 → `:168-173`/`:180-185` 补 `position:sticky` + 不透明背景 + 负 margin 补 padding 缝 |
| `--tbs-*` 死样式层清理（② N2） | **T12** | 删 `src/ui/shared/global.css` + `src/ui/sidebar/sidebar.css`（零 import） |
| `selectedIds` 与可见集不同步（N8） | **T15** | 自动裁剪（默认 D-1） |
| `Confirm` 在设置页**未 import**（N1） | **T15/T16** | `settings/App.tsx:13` 加入 `Confirm` import |
| `Toast.action` **零使用**（N11） | **T11** | 泛化 `UndoBar` 而非启用 `Toast.action`（避免第二套撤销 UI） |
| `UndoBar` role 语义冲突（`alert`+`polite`） | **T17** | 改为 `role="status"`（二者不叠加） |
| `UndoBar` 打开不聚焦 Undo | **T17** | 抢焦点 + g1 焦点归还 |
| 4 处既有文案不一致（D-a-1） | **T19** | `rule created`→`Rule created`；`Global rule created`→`Rule created`；`icon updated`（清除）→`Icon cleared`；`All items reset`→`All items cleared` |
| `R6 短路`（`sidebar:1244` 空值即不写） | **T14** | 重写为显式模式判定（CT1 影响 #3 / CT4） |
| `placeholder` 删除（`Leave empty to keep original`） | **T14** | CT1 影响 #2 |
| 孤儿 `RuleEditor.tsx`/`DualCards.tsx` + 测试 | **T18** | 4 文件删除 |
| slot 空串 icon 写入路径（N10/DT11） | **T18** | 一元化为 `null`（`settings:1296,1317,1341,1447`；`sidebar:1385`）—— ⚠️**措辞更正**：实测 `sidebar:1385` 是 **`{type:'upload', value:''}`**（非 `'url'`），`settings` 四处为 `{type:'url', value:''}`（**两种空串形态**，一元化时都须覆盖） |
| `InlineRuleEditor` `colSpan` 8→7 | **T15** | `settings:521,1171` |
| Dashboard 表头全选 `entries` vs 行 `sortedEntries` | **T16** | `settings:1479-1487` vs `:1539` 一致化 |
| `Edit {entryId}` 内部 id 标题 | **T16** | 改用 `label`（`Edit Tab 3`） |
| 「有行但全不可投递」汇总句（G1） | **T17** | `2 items · none can be applied here`；`unknown` 不计入 |

---

## TODOs

> 实现 + 测试 = 一个任务，从不分离。每个任务含：What to do + Must NOT do + 前置依赖 + References + RED 可构造性 + Acceptance + QA Scenarios + Commit。

---

### Wave 1 — 契约 + 唯一真源 + 共享原语（无依赖，立即开始）

- [x] **T1. `src/shared/field-chain.ts` 读侧唯一真源 + 穷举单测**

  **What to do**:
  1. 新建 `src/shared/field-chain.ts`（纯函数，无浏览器 API 依赖），按 A1 导出：`TierOwner`（`override{tabId}`/`slot{slotId}`/`rule{ruleId}`/`site`）、`TierValue{value:string|null; owner:TierOwner; known:boolean}`、`ChainResult{winner:{value:string|null; source:'override'|'slot'|'rule'|'site'}; tiers:{override?:TierValue;slot?:TierValue;rule?:TierValue;site:TierValue}; masked:TierOwner[]}`。
  2. 实现 `resolveFieldChain(field:'title'|'favicon', input:{sync:SyncState; local:LocalState; tabId:number; tabUrl:string}):ChainResult`。链序 **`override > slot > rule > site`**；rule 分支**必须复用** `sortRulesByPriority`/`selectWinningRule`（`url-utils.ts:457-471`），不得内联 sort。
  3. 「设定值」判定（A1-bis）：`undefined`/`null`/`''`（trim 后为空）**一律未设定**；非空 = 已设定。**读取侧保留三种容错**（不可因写入侧一元化而收紧）。
  4. `field:'favicon'` 的每个 tier 值**必须过 `isSafeFaviconProtocol`**（`url-utils.ts:607`）；不通过则跳过该 tier 继续下落（对齐现状 `rule-service.ts:386-403` 的语义）。
  5. `slot` tier **严格 tabId 作用域**：仅当 `local.bindings` 中存在 `slotId→tabId` 匹配时才有值（对齐 `rule-service.ts:408-419` 注释）。
  6. `masked`：有值但被上层盖住的 tier 的 `owner` 列表（驱动「清除遮蔽」）。
  7. `site` 节点：`value` 来自 `input.local.siteSnapshot` 中该 tabId 的快照（T5 定义形状；本任务只读、可先按可选字段访问），**未捕获 → `known:false` + `value:null`**（UI 显示 `—`）。
  8. 导出 `clearChain(field, entry:{kind:'override'|'slot'|'rule'|'site'; tabId?:number; slotId?:number; ruleId?:string}): TierOwner[]` —— 返回**有序待写层清单**（Dashboard override 项 → `[override, slot, rule]`；位置槽 → `[slot, rule]`，override 不参与）。

  **Must NOT do**:
  - 不得 import 任何 background/UI 模块（保持 `shared` 纯函数）；不得发起 IPC。
  - **不得手抄排序**（必须调 `sortRulesByPriority`/`selectWinningRule`）。
  - 不得把写入逻辑放进 `field-chain`（写入归 T7 的 `FieldDeliveryService`）。
  - 不得删除读取侧的 `undefined`/`null`/`''` 三态容错。

  **Recommended Agent Profile**:
  - **Category**: `deep` — 核心解析语义，需精确对齐既有 `computeFieldsFrom` 行为并覆盖穷举矩阵。
  - **Skills**: `sw-tdd-agent`（RED→GREEN）、`lsp-code-analysis`（核对 `computeFieldsFrom` 调用面）。
  - **Skills Evaluated but Omitted**: `sw-ui-ux-review`（非 UI 层）。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1（与 T2–T6）
  - **Blocks**: T7, T8, T13, T14, T15, T16, T20
  - **Blocked By**: None

  **References**（CRITICAL）:
  - **Pattern References**:
    - `src/background/rule-service.ts:345-406`（`computeFieldsFrom`）—— **既有链实现的权威行为**（override→slot→rule），本任务须保持语义等价（除新语义）。
    - `src/background/rule-service.ts:408-419`（`resolveSlotField` 注释）—— slot tier 的 tabId 严格作用域。
    - `src/shared/url-utils.ts:457-471`（`sortRulesByPriority`/`selectWinningRule`）—— **必须复用**的排序真源。
    - `src/shared/url-utils.ts:607-637`（`isSafeFaviconProtocol`）—— favicon tier 白名单。
  - **API/Type References**:
    - `src/shared/types.ts:228-251`（`SyncState`/`LocalState`）—— 输入形状。
    - `src/shared/types.ts:99-113`（`RuleMode`/`PageRule`）—— 注意 T4 将删 `mode`；本任务用例中 `rules` 不含 `mode`。
    - `_context-output/designs/2026-10-02-field-chain-sync-architecture-module-design.md:10-68`（A1 / A1-bis）—— `ChainResult` 形状与 `clearChain` 契约。
  - **Test References**:
    - `tests/unit/shared/url-utils.test.ts:271-301`（排序/冲突矩阵）—— **穷举矩阵的写法范式**。
    - `tests/unit/background/rule-service.test.ts`（`computeFields` 断言范式）。
  - **WHY**: `computeFieldsFrom` 是**唯一的行为基线**；`field-chain` 若不与它等价，三视图与投递将立即分叉（正是本迭代要消灭的缺陷）。`sortRulesByPriority` 复用是 SC1 的构造保证点。

  **RED 可构造性说明**（哪条测试先失败）:
  - 新建 `tests/unit/shared/field-chain.test.ts`，先写「**title 链：override 胜出**」→ 当前无 `field-chain.ts` → **import 失败（RED 1）**。
  - 「**rule 排序：priority 高者胜、同 priority 新者胜**」→ 在仅有 `computeFieldsFrom` 的 clone 实现时若内联 sort 与共享函数行为不一致即失败（GREEN 后作为回归护栏）。
  - 「**favicon 非法协议跳过该 tier 下落**」→ 若实现漏 `isSafeFaviconProtocol` 则失败。

  **Acceptance Criteria**:
  - [ ] `tests/unit/shared/field-chain.test.ts` 新建，含**穷举矩阵 ≥ 24 用例**：title 与 favicon **各一条独立链** × 4 tier × {已设定,未设定} + priority 并列 + `masked` + `known:false` + `clearChain` 层清单。
  - [ ] `npx vitest run --project unit -t "field-chain"` → **ALL PASS**
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios**:
  ```
  Scenario: title 链 override 遮蔽 slot/rule（happy path）
    Tool: Bash (test runner)
    Preconditions: sync.rules=[{id:'r1',priority:0,title:'R',enabled:true,urlMatch:{type:'exact',value:'https://a.com/'}}]；local.tabOverrides=[{tabId:1,title:'O'}]；local.bindings=[{slotId:5,tabId:1}]；sync.slots[4].uiMarker.customTitle='S'
    Steps:
      1. 运行 `npx vitest run --project unit -t "override wins over slot and rule"`
      2. 断言 `result.winner.value === 'O'` 且 `result.winner.source === 'override'`
      3. 断言 `result.masked` 含 `{kind:'slot',slotId:5}` 与 `{kind:'rule',ruleId:'r1'}`
    Expected Result: 3 条断言全部通过；`tiers.site.known === false`（未捕获快照）
    Failure Indicators: winner.source 非 override / masked 为空 / tiers 缺 site
    Evidence: _context-output/evidence/task-1-title-chain-happy.txt

  Scenario: favicon 非法协议被跳过（failure/edge）
    Tool: Bash (test runner)
    Preconditions: 同 tab，override.favicon={type:'url',value:'javascript:alert(1)'}；rule.favicon={type:'url',value:'https://cdn/x.png'}
    Steps:
      1. 运行 `npx vitest run --project unit -t "unsafe favicon falls through"`
      2. 断言 `result.winner.source === 'rule'`（override 被跳过而非生效）
      3. 断言 `result.winner.value === 'https://cdn/x.png'`
    Expected Result: override tier 被跳过，rule tier 生效
    Failure Indicators: winner.value 为 'javascript:alert(1)'
    Evidence: _context-output/evidence/task-1-unsafe-favicon-error.txt
  ```

  **Commit**: YES — groups with T2/T3/T4/T5/T6
  - Message: `feat(shared): add field-chain as single source of truth`
  - Files: `src/shared/field-chain.ts, tests/unit/shared/field-chain.test.ts`
  - Pre-commit: `npm run typecheck && npm run lint`

---

- [x] **T2. `normalizeUrl` 补「尾斜杠等同」（E4/E5-a）+ 前后对照单测**

  **What to do**:
  1. 修改 `src/shared/url-utils.ts:18-45` 的 `normalizeUrl`：在重构返回串前，对 `pathname` 应用 **`pathname !== '/' && pathname.endsWith('/')` → 去掉一层尾斜杠**（E5-a：**排除根路径 `'/'`**，只去一层）。
  2. 保持 E5-b：**query 原序保留、hash 仍忽略**；不扩大到 path/query 大小写或排序。
  3. 保持 E5-c：`new URL()` 抛错时**原样返回**（不改变 catch 分支）。
  4. 不重复实现 E5-e（`./`/`../` 归一交给 `new URL()`）。
  5. 新建 `tests/unit/shared/normalize-url-trailing-slash.test.ts`（**前后对照**）：用 `git show a3d6ab3:src/shared/url-utils.ts` 的旧 `normalizeUrl` 逻辑（**测试内联一份旧实现副本**，不改生产代码）对同一组输入求值，断言「新旧输出差异**恰好**为『非根路径尾斜杠被去除』」。

  **Must NOT do**:
  - 不得改 `urlsMatch`/`matchesUrl`/`detectRuleConflict` 的调用方式（它们自动受益）。
  - 不得扩大到去除 query 尾斜杠 / 排序 query / 小写 path。
  - 不得在 catch 分支抛错或返回 `''`。

  **Recommended Agent Profile**:
  - **Category**: `quick` — 单文件局部 + 一个对照测试。
  - **Skills**: `sw-tdd-agent`。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T3（校验用 `normalizeUrl`）, T20
  - **Blocked By**: None

  **References**:
  - **Pattern References**: `src/shared/url-utils.ts:18-45`（`normalizeUrl` 现状）、`:50-52`（`urlsMatch`）。
  - **API/Type References**: `src/shared/url-utils.ts:408-455`（`matchesUrl`）—— 4 个消费者之一。
  - **Test References**: `tests/unit/shared/url-utils.test.ts`（既有 URL 归一断言范式）；`git show a3d6ab3:src/shared/url-utils.ts` 取旧实现（**只读**）。
  - **WHY**: RK-2 是**已发布匹配语义变更**（exact 规则 `https://a.com/page` 将开始命中 `https://a.com/page/`）；无对照测试则「匹配面变宽」无证据。

  **RED 可构造性说明**:
  - 「`normalizeUrl('https://a.com/page/') === normalizeUrl('https://a.com/page')`」→ 当前实现为 `false` → **RED（失败）**。
  - 「`normalizeUrl('https://a.com/') === 'https://a.com/'`」（E5-a 根路径不被去斜杠）→ 若实现写成无条件去尾斜杠则失败（防过修）。

  **Acceptance Criteria**:
  - [ ] `tests/unit/shared/normalize-url-trailing-slash.test.ts` 新建；含 ≥ 8 对照用例（含根路径、多尾斜杠、带 query、带 hash、非法 URL）。
  - [ ] `npx vitest run --project unit -t "normalize"` → ALL PASS；既有 `tests/unit/shared/url-utils.test.ts` 仍 ALL PASS。
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios**:
  ```
  Scenario: 尾斜杠等同生效（happy path）
    Tool: Bash (test runner)
    Preconditions: 无
    Steps:
      1. `npx vitest run --project unit -t "trailing slash"`
      2. 断言 normalizeUrl('https://a.com/page/') === normalizeUrl('https://a.com/page')
      3. 断言 normalizeUrl('https://a.com/page/?x=1') === normalizeUrl('https://a.com/page?x=1')
    Expected Result: 断言全通过
    Failure Indicators: 任一为 false
    Evidence: _context-output/evidence/task-2-trailing-slash-happy.txt

  Scenario: 根路径不被破坏（failure/edge）
    Tool: Bash (test runner)
    Steps:
      1. 断言 normalizeUrl('https://a.com') === 'https://a.com/'
      2. 断言 normalizeUrl('https://a.com/') === 'https://a.com/'
    Expected Result: 根路径稳定为 'https://a.com/'（E5-a）
    Failure Indicators: 结果为 'https://a.com'（空 pathname）
    Evidence: _context-output/evidence/task-2-root-path-error.txt
  ```

  **Commit**: YES — groups with T1/T3/T4/T5/T6
  - Message: `fix(shared): treat trailing slash as equivalent in normalizeUrl`
  - Files: `src/shared/url-utils.ts, tests/unit/shared/normalize-url-trailing-slash.test.ts`
  - Pre-commit: `npm run typecheck && npm run lint`

---

- [x] **T3. 共享校验纯函数 `src/shared/form-validation.ts`（E1/E1-a/CT4-bis）**

  **What to do**:
  1. 新建 `src/shared/form-validation.ts`（纯函数），导出：
     - `validateRuleForm(input:{matchType:'exact'|'regex'; url:string; titleMode:'set'|'use-chain'; titleValue:string; iconMode:'url'|'custom'|'use-chain'; iconValue:string; iconConfig?:IconConfig}): {valid:boolean; errors:{field:'matchUrl'|'title'|'icon'; message:string; severity:'block'|'warn'}[]}`
     - `validateFieldEditors(...)`（Dashboard 面：无 Match URL）。
  2. **E1-a 硬约束**：`matchType==='regex'` 时，**先 `wildcardToRegex(input.url).pattern`，再 `validateRegex(converted)`** —— 校验的串与保存的串**必须同一个**。
  3. **E1-b**：`validateRegex` 的 `warn`（过宽）**不阻断**（`severity:'warn'`）；仅 `valid===false`（TOO_LONG/非法/ReDoS）阻断。
  4. **E1-c**：`iconMode==='url'` → `isSafeFaviconProtocol(iconValue)`；`iconMode==='custom'` → 渲染后的 `data:` URI 也须过同一函数；`use-chain` 无值不校验。
  5. **E1-d/E5-c**：`matchType==='exact'` 时，用 `normalizeUrl` 的 try/catch 语义判定「**是否可解析**」：若 `normalizeUrl(input.url) === input.url.trim()` **且** 不构成合法 URL（无法被 `new URL()` 解析）→ 报 `Enter a full URL (https://…)`。**须额外判定「是否可解析」**（不能只比较字符串）。
  6. **CT4-bis 通用规则**：凡「声明有值形态但未提供值」→ 无效：
     - Title `set` 空 → `Enter a title, or choose Use chain`
     - Icon `url` 空 → `Enter an icon URL, or choose Custom Icon / Use chain`
     - Icon `custom` 无内容 → `Pick colors and text, or choose Icon URL / Use chain`
     - Match URL 空 → `Enter a URL pattern`
  7. **E2-c**：冲突文案统一为 `A rule with the same URL already exists`（两条后台文案合并为一句，供 T15/T19 复用）。

  **Must NOT do**:
  - **不得**让 UI 直接用裸 `new RegExp`（本文件的 `validateRegex` 是唯一入口）。
  - **不得**新增实时冲突检测调用（E2）。
  - 不得在 `severity:'warn'` 时返回 `valid:false`。

  **Recommended Agent Profile**:
  - **Category**: `quick` — 纯函数 + 表驱动测试。
  - **Skills**: `sw-tdd-agent`。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T10, T14, T15
  - **Blocked By**: None（仅概念上复用 T2 的 `normalizeUrl`；可并行，若 T2 未完成则先按现状签名调用）

  **References**:
  - **Pattern References**: `src/shared/url-utils.ts:301-374`（`validateRegex` 返回值形状）、`:375-407`（`wildcardToRegex`）、`:607-637`（`isSafeFaviconProtocol`）。
  - **API/Type References**: `_context-output/designs/2026-10-02-field-chain-sync-detail-validation-focus-empty-design.md:84-121`（E1/E1-a…E1-e）；**CT4 / CT4-bis 在 `detail-copy-a11y-design.md`**（CT4-bis 通用规则见其 §「CT4-bis」，⚠️原文误引 `detail-validation-focus-empty-design.md:273-300`）。
  - **Test References**: `tests/unit/shared/url-utils.test.ts`（`validateRegex` 用例范式）。
  - **WHY**: E1-a 是**修 ① N7**（「提示合法但保存被拒」）的关键；若仍校验原文，UI 与后台仍会相反。

  **RED 可构造性说明**:
  - 「`validateRuleForm({matchType:'regex', url:'*.example.com'})` 应通过」→ 若实现校验**原文**（含 `*`）则 `new RegExp('*.example.com')` 抛错 → **RED**；正确实现先 `wildcardToRegex` 得 `.*\.example\.com` 才通过。
  - 「`validateRuleForm({titleMode:'set', titleValue:''})` → `valid:false` 且 message 为 `Enter a title, or choose Use chain`」→ 当前无该函数 → RED。

  **Acceptance Criteria**:
  - [ ] `tests/unit/shared/form-validation.test.ts` 新建；含 ≥ 12 用例（regex 通配符转换、500 字上限、ReDoS 拒绝、过宽不阻断、favicon 协议、CT4-bis 4 条空值、exact 不可解析）。
  - [ ] `npx vitest run --project unit -t "form-validation"` → ALL PASS
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios**:
  ```
  Scenario: 通配符先转换再校验（happy path，修 N7）
    Tool: Bash (test runner)
    Steps:
      1. `npx vitest run --project unit -t "wildcard converted before validation"`
      2. 断言 validateRuleForm({matchType:'regex', url:'*.example.com', ...}).valid === true
      3. 断言对 501 字符 pattern 返回 valid===false 且 message 含长度上限
    Expected Result: 通配符合法通过；超长被拒
    Failure Indicators: 通配符被误判非法
    Evidence: _context-output/evidence/task-3-validation-happy.txt

  Scenario: Custom Title 已选但为空（failure，CT4）
    Tool: Bash (test runner)
    Steps:
      1. 断言 validateRuleForm({titleMode:'set', titleValue:'   '}).valid === false
      2. 断言 errors[0].message === 'Enter a title, or choose Use chain'
      3. 断言 errors[0].severity === 'block'
    Expected Result: 阻止提交 + 精确文案
    Failure Indicators: valid 为 true 或文案不符
    Evidence: _context-output/evidence/task-3-empty-title-error.txt
  ```

  **Commit**: YES — groups with T1/T2/T4/T5/T6
  - Message: `feat(shared): add shared form validation reusing backend primitives`
  - Files: `src/shared/form-validation.ts, tests/unit/shared/form-validation.test.ts`
  - Pre-commit: `npm run typecheck && npm run lint`

---

- [x] **T4. 契约清理：删 `mode`/`APPLY_RULE_TO_TAB`/`GET_CANDIDATES`/每 URL guard（A9/A11/Q11/IMP-18 1,2,3,4,10,11）**

  **What to do**（**IMP-18 12 条清单的契约面**）:
  1. `src/shared/types.ts:99,104` — 删 `RuleMode` 类型 + `PageRule.mode` 字段。
  2. `src/shared/messages.ts:13,99,112` — 从 import 去掉 `RuleMode`；`CREATE_RULE`（`:96-99`）/`UPDATE_RULE`（`:108-112`）载荷**去掉 `mode`**。
  3. `src/shared/messages.ts:123-133` — 删 `APPLY_RULE_TO_TAB`（`:128` 变体 + 请求类型）；`:261`,`:416` 删 `GET_CANDIDATES`；`:448` 删 `APPLY_REWRITE`（旧协议，A11 由 `FIELD_APPLY` 取代）。
  4. `src/shared/messages.ts` 新增：`FIELD_APPLY`（worker → content，A4 三态 `FieldDirective`）与 `SITE_SNAPSHOT_REPORT`（content → worker，A7 回报）联合类型（形状见 A4/A11；本任务只定契约，实现在 T8）。
  5. `src/background/worker-orchestrator.ts:43-90` — `KNOWN_ACTIONS` 删 `APPLY_RULE_TO_TAB`(`:56`)、`GET_CANDIDATES`(`:81`)、`APPLY_REWRITE`(若在列)；**新增 `FIELD_APPLY`/`SITE_SNAPSHOT_REPORT` 若属 worker 入站**。**此步必须与联合类型同提交**（防「编译通过但运行被拒」）。
  6. `src/ui/shared/message-client.ts:227` — `createRule` 载荷去 `mode`；`:239-241` 删 `applyRuleToTab`；删 `getCandidates`（若存在）。
  7. `src/ui/shared/message-client.ts:20` — `UNKNOWN_ACTION` 文案保持不变（勿动）。
  8. 全仓库适配编译面：删除后凡引用 `mode`/`APPLY_RULE_TO_TAB`/`GET_CANDIDATES` 的生产代码**占位适配为去 `mode`**；UI 表单字段的删除在 T14/T15（本任务只做**编译面**适配，允许 UI 侧暂时保留 `mode` state 的**读取**但需去除 `PageRule.mode` 的类型引用）。

  **Must NOT do**:
  - **不得**在 messages 里保留 `mode` 的 `deprecated` 兼容字段（Q11 一律参与链）。
  - **不得**改 `SET_MATCH_SETTINGS` 相关 action（沿用 `SET_GLOBAL_STRATEGY`，`:245-246`）。
  - **不得**在此任务里改 UI 布局或交互（那属 T14/T15）。
  - **不得**为了让 typecheck 通过而放宽 `tsconfig`/eslint。

  **Recommended Agent Profile**:
  - **Category**: `deep` — 契约删改的编译波面广（types + messages + orchestrator + message-client + UI 引用），错一处即 typecheck 红。
  - **Skills**: `lsp-code-analysis`（`findReferences` 枚举 `mode`/`APPLY_RULE_TO_TAB`/`GET_CANDIDATES` 全部引用）、`sw-tdd-agent`。

  **Parallelization**:
  - **Can Run In Parallel**: NO（与 T14/T15 存在编译面耦合，须先落地）
  - **Parallel Group**: Wave 1（可与 T1/T2/T3/T5/T6 并行；但它是 T14/T15/T16/T19 的前置）
  - **Blocks**: T8, T14, T15, T16, T19
  - **Blocked By**: None

  **References**:
  - **Pattern References**: `src/shared/messages.ts:96-135,199-230,249-330,440-460`（既有契约形状）。
  - **API/Type References**: `_context-output/designs/2026-10-02-field-chain-sync-architecture-module-design.md:99-119`（A4 协议）、`:150-165`（A8）、`:169-235`（A9/A10/A11/A12）、`_context-output/designs/2026-10-02-field-chain-sync-architecture-three-surfaces-implementation-direction-design.md:400-423`（IMP-18 12 条）。
  - **Test References**: `tests/unit/background/known-actions.test.ts`（KNOWN_ACTIONS 断言范式）、`tests/unit/shared/messages.test.ts`。
  - **WHY**: `KNOWN_ACTIONS` 是手写白名单（`worker-orchestrator.ts:37-41` 注释已注明「不强制同步」）→ 漏改会「编译通过但运行被拒」；IMP-18 第 11 条正是这条。

  **RED 可构造性说明**:
  - 「`routeMessage({action:'GET_CANDIDATES', ...})` 返回 `UNKNOWN_ACTION`」→ 删除后**应恒为未知**；当前实现**能处理** → 测试先失败（若断言「已删除」）。
  - 「`CREATE_RULE` 载荷不含 `mode` 时 typecheck 通过」→ 删除 `PageRule.mode` 后，任何仍写 `mode:` 的 UI 代码**编译报错** → typecheck 为本任务的 RED 信号（**先用 `grep` 列出全部引用点，再逐个删**）。
  - 有效 RED（前置）：`tests/unit/background/known-actions.test.ts` 增断言「`APPLY_RULE_TO_TAB` 不在 KNOWN_ACTIONS」→ 当前**在** → 失败。

  **Acceptance Criteria**:
  - [ ] `rg "mode === 'auto'|mode === 'manual'|ApplyRuleToTab|APPLY_RULE_TO_TAB|GET_CANDIDATES" src/shared src/background` → **0 命中**（UI 侧由 T14/T15 收尾）。
  - [ ] `tests/unit/background/known-actions.test.ts` 更新后 ALL PASS。
  - [ ] `npm run typecheck` → 0 error；`npm run lint` → delta-0
  - [ ] `FIELD_APPLY`/`SITE_SNAPSHOT_REPORT` 类型已定义（供 T8 消费）。

  **QA Scenarios**:
  ```
  Scenario: 已删除的 action 不再被路由（happy path）
    Tool: Bash (test runner)
    Steps:
      1. `npx vitest run --project unit -t "known-actions"`
      2. 断言 routeMessage({action:'APPLY_RULE_TO_TAB'}) 返回 {success:false,errorCode:'UNKNOWN_ACTION'}
      3. 断言 routeMessage({action:'GET_CANDIDATES'}) 同上
    Expected Result: 两条均 UNKNOWN_ACTION
    Failure Indicators: 任一被处理
    Evidence: _context-output/evidence/task-4-removed-actions-happy.txt

  Scenario: CREATE_RULE 载荷不再需要 mode（failure/edge）
    Tool: Bash (test runner)
    Steps:
      1. 构造 CREATE_RULE 载荷（不含 mode）并断言 createRule 成功
      2. 断言返回规则对象**无** `mode` 属性
    Expected Result: 创建成功且无 mode
    Failure Indicators: 类型报错或 mode 仍被写入
    Evidence: _context-output/evidence/task-4-create-rule-no-mode-error.txt
  ```

  **Commit**: YES — groups with T1/T2/T3/T5/T6
  - Message: `refactor(contract): drop mode, APPLY_RULE_TO_TAB, GET_CANDIDATES; add FIELD_APPLY`
  - Files: `src/shared/types.ts, src/shared/messages.ts, src/background/worker-orchestrator.ts, src/ui/shared/message-client.ts, tests/unit/background/known-actions.test.ts`
  - Pre-commit: `npm run typecheck && npm run lint`

---

- [x] **T5. `src/background/site-snapshot-store.ts`（A7/C6/Q14）**

  **What to do**:
  1. 新建 `src/background/site-snapshot-store.ts`，封装 `local` 的 `siteSnapshot` 记录（形状：`SiteSnapshotEntry{tabId:number; title:string|null; faviconHref:string|null; capturedAt:string}`）。
  2. 在 `src/shared/types.ts:242-251` 的 `LocalState` **新增** `siteSnapshot?: SiteSnapshotEntry[]`（可选，兼容旧数据）；**严格封闭**：不进 `sync`、不进导出、不进诊断。
  3. 实现生命周期 API：`capture(tabId, {title, faviconHref})`（**首次改写前惰性捕获**）、`recapture(tabId, ...)`（**每次导航后重新捕获**）、`dropIfNoRewrite(tabId)`（**链不再改写 → 丢弃**）、`drop(tabId)`（**tab 关闭 → 丢弃**，防 tabId 复用串值）、`reset()`（扩展重载 → 保留 local，但 store 需能重读）。**全部仅存 `local`**。
  4. 只读约束：不得提供 `site` 节点的**写入**接口（`site` 原值属站点）。
  5. 单测：`tests/unit/background/site-snapshot-store.test.ts`（用 `createMockAdapter`）。

  **Must NOT do**:
  - **不得**把 `siteSnapshot` 放进 `sync` / `ExportPayload` / `ImportPreview` / 诊断。
  - **不得**存 `url` 或页面内容（字段仅 `{title, faviconHref}`）。
  - **不得**在导航后保留旧页快照（必须重新捕获，否则会还原上一页标题）。

  **Recommended Agent Profile**:
  - **Category**: `quick` — 单模块 + mock 测试。
  - **Skills**: `sw-tdd-agent`。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T8（捕获回报落库）, T16（Dashboard `site` 节点读）
  - **Blocked By**: None

  **References**:
  - **Pattern References**: `src/background/storage-repository.ts`（local 读写模式）。
  - **API/Type References**: `_context-output/designs/2026-10-02-field-chain-sync-architecture-module-design.md:150-165`（A7）、`_context-output/designs/2026-10-02-field-chain-sync-constraint-boundaries-design.md:59-68`（C6）。
  - **Test References**: `tests/unit/background/tab-override-fix.test.ts`（adapter/repo 夹具范式）。
  - **WHY**: C6 是隐私红线；任何「顺手进导出」都会扩大扩散面。

  **RED 可构造性说明**:
  - 「`capture(1,{title:'X',faviconHref:null})` 后 `get(1).title === 'X'`」→ 无模块 → import 失败（RED）。
  - 「`drop(1)` 后 `get(1) === undefined`」（防 tabId 复用）→ 若实现漏 drop 则失败。
  - 「`ExportPayload` 不含 `siteSnapshot`」→ 断言导出 JSON 的 key 集合。

  **Acceptance Criteria**:
  - [ ] `tests/unit/background/site-snapshot-store.test.ts` 新建；含 capture/recapture/drop/dropIfNoRewrite/封闭性 5 组用例。
  - [ ] `npx vitest run --project unit -t "site-snapshot"` → ALL PASS
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios**:
  ```
  Scenario: 惰性捕获 + 导航重捕获（happy path）
    Tool: Bash (test runner)
    Steps:
      1. capture(7,{title:'A',faviconHref:'https://a/f.ico'}) → 断言 get(7).title === 'A'
      2. recapture(7,{title:'B',faviconHref:null}) → 断言 get(7).title === 'B' 且 faviconHref === null
    Expected Result: 重捕获覆盖旧值
    Failure Indicators: 仍为 'A'
    Evidence: _context-output/evidence/task-5-capture-happy.txt

  Scenario: 封闭性 —— 不进导出（failure/edge）
    Tool: Bash (test runner)
    Steps:
      1. capture(7,...) 后调用 exportPayload 构造
      2. 断言 JSON.stringify(payload).includes('siteSnapshot') === false
    Expected Result: 导出不含 siteSnapshot
    Failure Indicators: 导出包含该字段
    Evidence: _context-output/evidence/task-5-export-closure-error.txt
  ```

  **Commit**: YES — groups with T1/T2/T3/T4/T6
  - Message: `feat(background): add strictly-sealed siteSnapshot store in local`
  - Files: `src/background/site-snapshot-store.ts, src/shared/types.ts, tests/unit/background/site-snapshot-store.test.ts`
  - Pre-commit: `npm run typecheck && npm run lint`

---

- [x] **T6. 共享小件：`radio-group.tsx` / `empty-state.tsx` / `use-expand-row.ts`（CT3-a/IMP-10/IMP-15）**

  **What to do**:
  1. 新建 `src/ui/shared/radio-group.tsx`（CT3-a）：`<fieldset>` + `<legend>` + 各选项 `<label><input type="radio" name={name}></label>`；props `{label, name, value, onChange, options:{value,label,description?}[], disabled?}`。**原生语义**，不用 `div[role=radiogroup]`。
  2. 新建 `src/ui/shared/empty-state.tsx`（IMP-10）：`variant: 'empty'|'no-match'|'error-first'|'error-stale'` + 可选 `action:{label,onClick}`；**零判定逻辑**（判定归各 Section）。文案见深挖② §5.5。
  3. 新建 `src/ui/shared/use-expand-row.ts`（IMP-15/16）：`useExpandRow<Id extends string>(opts?)` 返回 `{expanded, isExpanded, toggle(id,rowEl), collapseAll, getRowHandlers(id)}`；约束 15a（展开**后**再聚焦，`setTimeout(...,0)` 或 `useEffect`）、15b（Escape = 收起本行）、15c（收起后焦点回归 toggle 按钮，否则掉 `<body>`）、15d（`Set` 不可变更新 `new Set(prev)`）。
  4. 单测：`tests/unit/ui/radio-group.test.tsx`、`tests/unit/ui/empty-state.test.tsx`、`tests/unit/ui/use-expand-row.test.tsx`。

  **Must NOT do**:
  - `EmptyState` **不得**自己判定 `empty`/`no-match`。
  - `RadioGroup` **不得**用 `aria-label` 代替 `<legend>`（要用原生 `legend`）。
  - `useExpandRow` **不得**在 `toggle` 内同步 focus（元素未挂载）。
  - 不得在此任务里改 `settings/App.tsx` 或 `sidebar/App.tsx`（归 T15/T16）。

  **Recommended Agent Profile**:
  - **Category**: `quick` — 三个小共享件 + 单测。
  - **Skills**: `sw-tdd-agent`、`lsp-code-analysis`（核对 `expandedRuleIds` 既有习惯 `settings:649,689-696`）。
  - **Skills Evaluated but Omitted**: `sw-ui-ux-review`（交互审查非本任务）。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T10, T11, T15, T16, T17
  - **Blocked By**: None

  **References**:
  - **Pattern References**: `src/ui/shared/components.tsx`（共享组件风格 + `Dialog` a11y `:122-231`）；`settings/App.tsx:649,689-696`（既有 `Set` 展开习惯）；`sidebar/App.tsx:1235`（`setTimeout(()=>ref.focus(),0)` 先例）。
  - **API/Type References**: `_context-output/designs/2026-10-02-field-chain-sync-detail-copy-a11y-design.md:176-213`（CT3-a/c）、`:148-172`（空态文案）；`_context-output/designs/2026-10-02-field-chain-sync-architecture-three-surfaces-implementation-direction-design.md:518-552`（useExpandRow 形状）。
  - **Test References**: `tests/unit/ui/tokens-components.test.tsx`（共享组件测试范式）。
  - **WHY**: 这三件是 T15/T16 的**共同前置**（Rows 与 Dashboard 共用展开 + `RadioGroup` 8→11 组统一 + 四态空态）。

  **RED 可构造性说明**:
  - 「`<RadioGroup label="Title source" ... />` 渲染出 `legend` 且 `getByRole('group',{name:'Title source'})` 命中」→ 无组件 → RED。
  - 「Escape 触发 `collapseAll`」→ 无 hook → RED。
  - 「`EmptyState variant='no-match'` 渲染 `No rules match your search` + `Clear search` 按钮」→ RED。

  **Acceptance Criteria**:
  - [ ] 3 个新组件/hook 文件 + 3 个测试文件。
  - [ ] `npx vitest run --project unit -t "RadioGroup|EmptyState|useExpandRow"` → ALL PASS
  - [ ] `npm run typecheck` → 0 error；`tests/unit/ui/no-cjk-in-ui.test.tsx` → PASS

  **QA Scenarios**:
  ```
  Scenario: RadioGroup 原生语义（happy path）
    Tool: Bash (test runner)
    Steps:
      1. render <RadioGroup label="Title source" name="t" value="set" options={[{value:'set',label:'Custom Title'},{value:'use-chain',label:'Use chain'}]} onChange={spy}/>
      2. 断言 screen.getByRole('group',{name:'Title source'}) 存在
      3. 点击 'Use chain' → 断言 onChange 收到 'use-chain'
    Expected Result: 组可被无障碍树识别且可键盘切换
    Failure Indicators: 无 group role / legend 缺失
    Evidence: _context-output/evidence/task-6-radio-group-happy.txt

  Scenario: useExpandRow 收起后焦点回归（failure/edge）
    Tool: Bash (test runner)
    Steps:
      1. 渲染两个含 toggle 按钮的行，展开 A，断言焦点在 A 的首个字段
      2. 按 Escape → 断言 A 收起且焦点回到 A 的 toggle 按钮（非 body）
    Expected Result: 焦点回归 toggle
    Failure Indicators: document.activeElement === body
    Evidence: _context-output/evidence/task-6-expand-focus-error.txt
  ```

  **Commit**: YES — groups with T1/T2/T3/T4/T5
  - Message: `feat(ui): add shared RadioGroup, EmptyState, useExpandRow`
  - Files: `src/ui/shared/radio-group.tsx, src/ui/shared/empty-state.tsx, src/ui/shared/use-expand-row.ts, tests/unit/ui/{radio-group,empty-state,use-expand-row}.test.tsx`
  - Pre-commit: `npm run typecheck && npm run lint`

---

### Wave 2 — 写侧 + 投递 + 共享编辑器 + 跳焦（Wave 1 后，最大并行）

- [x] **T7. `src/background/field-delivery-service.ts` 受影响集合 + 单一入口调度（A2/A3/A4/A5/C4）**

  **What to do**:
  1. 新建 `src/background/field-delivery-service.ts`，构造注入 `RuleService` + `SlotService` + `StorageRepository` + `BrowserAdapter`（A2：**不**放 `RuleService` 内，避免服务环）。
  2. 实现 `recomputeAndRedeliver(tabIds:number[]): Promise<DeliveryReport>`：对每个 tab 调 `field-chain.resolveFieldChain('title'|'favicon', {sync,local,tabId,tabUrl})` → 生成 A4 指令 → 交 A6 通道投递。
  3. **受影响集合按维度**（A3）：override → `[tabId]`；slot → `binding.tabId`，无 binding → `resolveSwitch` 推算（`candidates[0]`，复用 `src/background/switch/resolve-switch.ts:48`，**位置槽用已记录 binding**）；rule → 多命中（`matchesUrl` 命中列表）。
  4. **单一入口 + leading/trailing**（A5）：若该 tab 无在途投递 → 立即执行（leading）；否则标 pending（不排队重放中间态）；在途完成后若有 pending → 用**最新状态**再跑一次（trailing）并清 pending。
  5. **C4 红线**：同 tab 合流最新一次；编辑动作 ~300ms 防抖；**重试队列每 tab 唯一**（新投递重置计数）；重试 1/2/3/5/10/20/30s（7 次），超限 → 降级 + 标 `degraded`（仅内存）。可复用 `worker-orchestrator.ts:272-282` 的 `coalesce` 骨架。
  6. `DeliveryReport` 含每 tab `ok|degraded|protected|unknown`（驱动 Q8 权威汇总 + `delivery` 展示）。
  7. 在 `worker-orchestrator.ts` 接线：把 `RULE CRUD / REMOVE_TAB_OVERRIDE / SET_TAB_OVERRIDE / UPDATE_SLOT_UI_MARKER / UPDATE_SLOT_URL` 的写入路径改为**落存储后统一调用** `recomputeAndRedeliver`（修侦察 #6/#7）。当前 `REMOVE_TAB_OVERRIDE`（⚠️**行号更正**：`rule-service.ts:574-576`，原写 `:563-567` 实为 `applyFieldsToTab` 调用）与 `UPDATE_SLOT_URL`（`worker-orchestrator.ts:704` 附近）**不重投递**。
  8. 单测：`tests/unit/background/field-delivery-service.test.ts`（调度/去重/重试/降级）+ `tests/integration/field-delivery-integration.test.ts`。

  **Must NOT do**:
  - **不得**在 `field-chain` 内做写入（读侧保持纯）。
  - **不得**保留 `force`（T9 删除；本任务新接口一律无 `force` 参数）。
  - **不得**引入全局串行队列（C4 否决：旧值可能覆盖新值）。
  - **不得**让每个写入方各自投递（必须走单一入口）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — 并发调度 + 重试状态机 + 多写入路径接线。
  - **Skills**: `sw-tdd-agent`、`lsp-code-analysis`（枚举写入路径调用方）。

  **Parallelization**:
  - **Can Run In Parallel**: NO（依赖 T1 完成后才能定 `resolveFieldChain` 调用；与 T8 强耦合需串行）
  - **Parallel Group**: Wave 2（与 T10/T11/T12/T13 并行；与 T8 顺序）
  - **Blocks**: T8, T14, T15, T16, T20
  - **Blocked By**: T1, T4

  **References**:
  - **Pattern References**: `src/background/worker-orchestrator.ts:272-282`（`coalesce` per-key in-flight 去重骨架）、`:942-956`（现 `handleContentNavigation`）、`:966-977`（`reapplyFieldsToBoundTab`）、`:660-680`（`UPDATE_SLOT_UI_MARKER` 触发投递的既有做法）。
  - **API/Type References**: `src/shared/field-chain.ts`（T1）、`src/background/switch/resolve-switch.ts:25-60`（`ResolveSwitchInput`/`resolveSwitch`）、`_context-output/designs/2026-10-02-field-chain-sync-architecture-module-design.md:72-97,121-141`（A2/A3/A5/A6）。
  - **Test References**: `tests/integration/worker-orchestrator.test.ts`（routeMessage 断言范式）、`tests/integration/open-page-coalescing.test.ts`（去重/合流断言范式）。
  - **WHY**: A5 是修侦察 #11（无按 tab 排序 → 旧值后写覆盖新值）的关键；单一入口是 SC2 的构造保证点。

  **RED 可构造性说明**:
  - 「同一 tab 连续 3 次 `recomputeAndRedeliver([1])` → 投递次数 ≤ 2（leading + 1 trailing），且末次用最新状态」→ 无服务 → import 失败（RED）。
  - 「`REMOVE_TAB_OVERRIDE` 落存储后触发投递」→ 当前 `rule-service.ts:574-576`（⚠️**行号更正**，原写 `:563-567`）**不投递** → 断言「投递被调用」失败（RED）。
  - 「重试 7 次后第 8 次不再投递且标 `degraded`」→ RED。

  **Acceptance Criteria**:
  - [ ] `tests/unit/background/field-delivery-service.test.ts` 新建；含 leading/trailing、合流、防抖、重试时间表、按维受影响集合、`degraded` 标记 ≥ 10 用例。
  - [ ] `npx vitest run --project unit -t "field-delivery"` → ALL PASS
  - [ ] `npm run typecheck` → 0 error；`npm run lint` → delta-0

  **QA Scenarios**:
  ```
  Scenario: rule 写入 → 多命中投递（happy path，修侦察 #7）
    Tool: Bash (test runner)
    Preconditions: mockAdapter 有 tab 1/2/3；rule r1 命中 tab1 与 tab3
    Steps:
      1. 调用 UPDATE_RULE（改 title）→ 断言 recomputeAndRedeliver 被调用，且 tabIds 含 1 与 3
      2. 断言 tab2 未被投递
    Expected Result: 仅命中 tab 被投递
    Failure Indicators: 投递全集 / 未投递
    Evidence: _context-output/evidence/task-7-affected-set-happy.txt

  Scenario: 同 tab 并发投递合流（failure/edge）
    Tool: Bash (test runner)
    Steps:
      1. 模拟在途投递未完成时再触发 2 次（不同值）
      2. 断言最终值 = 最后一次触发对应的链值（非中间值）
      3. 断言总投递次数 ≤ 2
    Expected Result: 最后一次必然生效
    Failure Indicators: 中间值覆盖最终值
    Evidence: _context-output/evidence/task-7-coalesce-error.txt
  ```

  **Commit**: YES — groups with T8
  - Message: `feat(background): add FieldDeliveryService (single entry, coalesced scheduling)`
  - Files: `src/background/field-delivery-service.ts, src/background/worker-orchestrator.ts, tests/unit/background/field-delivery-service.test.ts`
  - Pre-commit: `npm run typecheck && npm run lint`

---

- [x] **T8. 投递协议 `FIELD_APPLY` 三态 + 内容脚本唯一实现 + 兜底降级（A4/A4-bis/A6/C2/C3）**

  **What to do**:
  1. 按 A4 实现 `FieldDirective`（`{kind:'set'; value:string}` / `{kind:'restore'}` / `{kind:'none'}`）与 `FieldApplyMessage{type:'FIELD_APPLY'; title?:FieldDirective; favicon?:FieldDirective}`（T4 已定契约，本任务实现语义）。
  2. `src/content/index.ts` 为**唯一实现**：
     - `apply`：`set` → 写 title / favicon；
     - `restore`：title ← **页面作用域快照**（内容脚本持有）；favicon ← **删除我们插入的 `<link>`**（**从不删除原 link**，天然回落）—— `restore` 覆盖「整链清除后 `site` 亦无值」；
     - **首次改写前惰性捕获**站点原值 → 回报 `SITE_SNAPSHOT_REPORT`（A7/T5）；
     - **删除 `content/index.ts:228-231` 的每 URL guard**（由 T7 的 leading/trailing 取代，A9）。
  3. `src/background/apply-fields.ts` 退化为 **`executeScript` 仅 apply** 的最小兜底（**不支持 restore**）；命中即标 `degraded`（C2/C3）。
  4. 有界重试失败 → 降级 `executeScript` 仅 apply + 标 `degraded`；**清除在降级页只做「停止改写」**（A6）。
  5. `src/content/index.ts` 删 `APPLY_REWRITE` 处理（`:250-252`）→ 改 `FIELD_APPLY`（T4 已删旧协议类型）。
  6. 单测：`tests/unit/content/content-script.test.ts` 重写（新协议）+ `tests/integration/rule-delivery-robust.test.ts` **主备反转**（C7：断言颠倒）。

  **Must NOT do**:
  - **不得**在 `executeScript` 注入函数里实现 `restore`（无状态，页面作用域快照无法存活）。
  - **不得**删除站点原 `<link>`（必须「插入更高优先级 link、清除时自然回落」）。
  - **不得**保留 `applyRewriteInPage` 的 `document.title=''`（侦察 #5，Q6 禁止「清空标题」）。
  - **不得**在协议层表达「清空」（A4：协议不可表达清空）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — 内容脚本 + 兜底 + 快照回报 + 重试降级，MV3 上下文约束多。
  - **Skills**: `sw-tdd-agent`、`sw-systematic-debugging`（DOM 时序/`document.head` 延迟）。

  **Parallelization**:
  - **Can Run In Parallel**: NO（顺序在 T7 之后）
  - **Parallel Group**: Wave 2
  - **Blocks**: T14, T15, T16, T20
  - **Blocked By**: T1, T4, T5, T7

  **References**:
  - **Pattern References**: `src/content/index.ts:222-253`（现 `applyRewrite` + guard + message listener）、`:257-270`（SPA 导航包装）、`src/background/apply-fields.ts:22-108`（`applyRewriteInPage` 的 favicon 应用 + `head` 轮询）、`:126-161`（现主/备顺序）。
  - **API/Type References**: `_context-output/designs/2026-10-02-field-chain-sync-architecture-module-design.md:99-117`（A4/A4-bis）、`:143-159`（A6/A7）、`_context-output/designs/2026-10-02-field-chain-sync-constraint-boundaries-design.md:21-43`（C2/C3/C4）。
  - **Test References**: `tests/unit/content/content-script.test.ts`、`tests/integration/rule-delivery-robust.test.ts`（**主备反转**）、`tests/integration/rule-delivery-real-dom.test.ts`。
  - **WHY**: 侦察 #4（`executeScript` 与 `sendMessage` 能力集不同）是「清除只在 executeScript 生效」的根因；C2 反转主备是修它的唯一方式。

  **RED 可构造性说明**:
  - 「`FIELD_APPLY {title:{kind:'restore'}}` → `document.title` 回到站点原值」→ 当前内容脚本无 restore → RED。
  - 「兜底路径不支持 restore：`executeScript` 时 `title` 为 restore → 不改变 document.title」→ RED（当前兜底把 `null`→`undefined`，`apply-fields.ts:157`）。
  - 「清除 favicon 后站点原 `<link>` 仍在」（从不删原 link）→ 若实现删除全部 link 则失败。

  **Acceptance Criteria**:
  - [ ] `tests/unit/content/content-script.test.ts` 覆盖 set/restore/none 三态 + 惰性捕获回报；ALL PASS。
  - [ ] `tests/integration/rule-delivery-robust.test.ts` 主备反转后 ALL PASS；`tests/integration/rule-delivery-real-dom.test.ts` ALL PASS。
  - [ ] `rg "appliedUrls" src/content/index.ts` → 0（guard 已删）。
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios**:
  ```
  Scenario: restore 还原站点原标题（happy path）
    Tool: Bash (test runner)
    Preconditions: jsdom document.title='Original'；先 set 为 'Rewritten'，快照已捕获 'Original'
    Steps:
      1. 发 FIELD_APPLY {title:{kind:'restore'}}
      2. 断言 document.title === 'Original'
      3. 断言 favicon restore 后站点原 <link rel="icon"> 仍存在
    Expected Result: 标题回原值、原 favicon link 未被删
    Failure Indicators: title 为 '' 或原 link 消失
    Evidence: _context-output/evidence/task-8-restore-happy.txt

  Scenario: 兜底路径不承诺 restore（failure/edge）
    Tool: Bash (test runner)
    Preconditions: 模拟内容脚本不可达，走 executeScript 兜底
    Steps:
      1. 发 restore 指令
      2. 断言 document.title 未被清空（兜底仅 apply）
      3. 断言该 tab 被标 degraded
    Expected Result: 降级为「停止改写」且标 degraded
    Failure Indicators: title 被清空 / 未标 degraded
    Evidence: _context-output/evidence/task-8-fallback-error.txt
  ```

  **Commit**: YES — groups with T7
  - Message: `refactor(content): content script owns apply/restore; executeScript is apply-only fallback`
  - Files: `src/content/index.ts, src/background/apply-fields.ts, src/shared/messages.ts, tests/unit/content/content-script.test.ts, tests/integration/rule-delivery-robust.test.ts`
  - Pre-commit: `npm run typecheck && npm run lint`

---

- [x] **T9. 受保护页集中判定（A8/C5）+ 删除 `force`（A5）**

  **What to do**:
  1. `isProtectedUrl` **只在投递入口**（T7 的 `recomputeAndRedeliver`）判定**一次**；受保护页 → **不投递** + `delivery='protected'`；**edit 仍允许**。
  2. **移除分散判定**：`worker-orchestrator.ts:972`（`reapplyFieldsToBoundTab`）、`:617`（`reapplyToMatchingTabs`）、`:469`（`applyToTab`）—— 逐处删除，改由入口统一判定。
  3. **删除 `force`**：`ApplyPayload.force`（`apply-fields.ts:115,137`）、`handleContentNavigation(tabId,url,force)`（`worker-orchestrator.ts:942,953`）、`CONTENT_READY` 传 `true`（`:930`）、`CONTENT_NAVIGATION` 传 `false`（`:921`）、`content/index.ts:222,229,251` 的 `force` 参数。投递恒为「写入当前链状态」（幂等）。
  4. 单测：`tests/unit/background/protected-delivery.test.ts`（受保护页不投递 + `delivery='protected'`；edit 仍成功）。

  **Must NOT do**:
  - **不得**在 UI 直接禁止编辑受保护页（C5：edit 仍允许）。
  - **不得**保留任何 `force` 参数（含类型、调用、注释）。
  - **不得**把 `isProtectedUrl` 的判定留在内容脚本（已有一个 `content/index.ts:226`，T8 删除后由入口统一）。

  **Recommended Agent Profile**:
  - **Category**: `quick` — 删除式收敛 + 一个测试文件。
  - **Skills**: `lsp-code-analysis`（`findReferences('force')`/`isProtectedUrl`）、`sw-tdd-agent`。

  **Parallelization**:
  - **Can Run In Parallel**: NO（依赖 T7/T8 落地）
  - **Parallel Group**: Wave 2
  - **Blocks**: T20
  - **Blocked By**: T7, T8

  **References**:
  - **Pattern References**（⚠️**行号已按实测更正**）：三处分散判定跨两文件 —— `src/background/rule-service.ts:609`（`reapplyToMatchingTabs`）、`src/background/worker-orchestrator.ts:966`（`reapplyFieldsToBoundTab`）、`src/background/rule-service.ts:455`（`applyToTab`）；`force` 流转 `src/background/worker-orchestrator.ts:942-977`；内容脚本内判定 `src/content/index.ts:222-231`。
  - **API/Type References**: `_context-output/designs/2026-10-02-field-chain-sync-architecture-module-design.md:163-165`（A8）、`:121-141`（A5 删 force）。
  - **Test References**: `tests/unit/shared/protected-prefixes.test.ts`、`tests/integration/slot-service.test.ts`。
  - **WHY**: 一处判定 = 一处真相；用户必须看得见「为什么没生效」（`Can't rewrite this page`）。

  **RED 可构造性说明**:
  - 「对 `chrome://settings` 投递 → `delivery==='protected'` 且未调用投递通道」→ 当前 `reapplyFieldsToBoundTab` 只在**该路径**判定，入口无统一判定 → RED。
  - 「`ApplyPayload` 无 `force` 字段」→ 当前**有** → typecheck/断言 RED。

  **Acceptance Criteria**:
  - [ ] `rg "force" src/background/apply-fields.ts src/background/worker-orchestrator.ts src/content/index.ts` → 0 命中。
  - [ ] `tests/unit/background/protected-delivery.test.ts` 新建；ALL PASS。
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios**:
  ```
  Scenario: 受保护页不投递但可编辑（happy path）
    Tool: Bash (test runner)
    Steps:
      1. 对受保护 URL 调 recomputeAndRedeliver([tabId])
      2. 断言 report[tabId].delivery === 'protected' 且投递通道未被调用
      3. 对同一 tab 执行 SET_TAB_OVERRIDE → 断言成功（edit 允许）
    Expected Result: 不投递 + 编辑成功
    Failure Indicators: 发生投递 / 编辑被拒
    Evidence: _context-output/evidence/task-9-protected-happy.txt

  Scenario: force 已彻底移除（failure/edge）
    Tool: Bash (test runner)
    Steps:
      1. 断言 ApplyPayload 类型无 force（tsc 编译）
      2. rg 搜索无 force
    Expected Result: 0 命中
    Failure Indicators: 仍存在
    Evidence: _context-output/evidence/task-9-force-removed-error.txt
  ```

  **Commit**: NO（并入 T7/T8 的提交序列，作为收尾提交）
  - Message: `refactor(background): centralize isProtectedUrl at delivery entry; drop force`

---

- [x] **T10. `src/ui/shared/rule-form-fields.tsx`（S4b/DT8 + `canClearChain` 单点派生）**

  **What to do**:
  1. 新建 `src/ui/shared/rule-form-fields.tsx`：含 `Match URL`（+ `↺` 复位到预填）+ `Match Type`（`RadioGroup`，含**共享正则实时校验**，调 T3 的 `validateRuleForm`）+ `FieldEditor`（子件，T11）+ `Priority`。`variant: 'create' | 'edit'`（**仅两态**）。
  2. **`canClearChain` 单点派生**（IMP-7 + G-2 默认处置）：在**本组件内唯一一处**计算 `const canClearChain = variant !== 'create'`，显式传给 `FieldEditor`；**禁止任何调用点手写该布尔**。
  3. `prefill` 为**必填 prop**；**取消**侧边栏 `CreateRuleModal` 的三元隐式回落（`sidebar:1712-1715`，DT1 不设隐式默认）。
  4. `Enabled` **不含**（面特异，仅 edit 面用；`settings:620-623` 现状）；`Auto-apply on match`（`mode`）**不含**（T4 已删）。
  5. `aria-describedby` 绑定（IMP-12 触达面 1–3）：`Match URL` → 校验错误节点；`Match Type` → 实时校验/转换提示节点；`Priority` → 范围提示。用 `FormField` 的 `errorId`/`hintId`（`components.tsx:341-371`）。
  6. `impactDefaultExpanded?: boolean`（DT9：`Clear` 场景预览默认展开）。
  7. 单测：`tests/unit/ui/rule-form-fields.test.tsx`（create/edit **等价性**：字段集/校验/文案一致；`canClearChain` 在两面取值正确）。

  **Must NOT do**:
  - **不得**在组件内按「调用方是谁」分支（DT1：禁 `if (surface==='sidebar')`）。
  - **不得**让任何调用点手写 `canClearChain`。
  - **不得**自绘 Icon 三模式 radio（必须用 `FieldEditor`）。
  - **不得**保留 `Leave empty to keep original` placeholder。

  **Recommended Agent Profile**:
  - **Category**: `deep` — 共享件是四入口一致性（SC8）的关键，`aria-describedby` 与预填显式化易错。
  - **Skills**: `sw-tdd-agent`、`lsp-code-analysis`。

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 T11/T12/T13 并行）
  - **Parallel Group**: Wave 2
  - **Blocks**: T14, T15
  - **Blocked By**: T3, T4, T6

  **References**:
  - **Pattern References**: `src/ui/shared/components.tsx:341-371`（`FormField` + `errorId`/`hintId`）、`settings/App.tsx:519-641`（`InlineRuleEditor` 现状字段集）、`:902-1024`（New Rule 现状）。
  - **API/Type References**: `_context-output/designs/2026-10-02-field-chain-sync-architecture-ui-deepdive-design.md:306-326`（S4b 接口）、`_context-output/designs/2026-10-02-field-chain-sync-detail-interaction-copy-design.md:208-226`（DT8 边界与代价）、`_context-output/designs/2026-10-02-field-chain-sync-architecture-three-surfaces-implementation-direction-design.md:307-333`（IMP-7 `canClearChain` 合规示例）。
  - **Test References**: `tests/unit/ui/inline-rule-editor.test.tsx`（现有行内编辑器测试，将重写）、`tests/unit/ui/settings.test.tsx`。
  - **WHY**: DT8 是「收口 3 组重复块（Match URL/Type/Priority）」的落点；IMP-7 的**合规前提**正是「能力由单点派生、调用点不得手写」。

  **RED 可构造性说明**:
  - 「`<RuleFormFields variant='create' .../>` 不渲染 Clear（`canClearChain=false`）」与「`variant='edit'` 渲染 Clear」→ 无组件 → RED。
  - 「create 与 edit 两模式的字段集一致」→ 若在 create 面遗漏正则校验（现状 Inline 缺失，① N14/第 14 项不一致）则失败。

  **Acceptance Criteria**:
  - [ ] `tests/unit/ui/rule-form-fields.test.tsx` 新建；含 create/edit 等价 + `canClearChain` 派生 + aria-describedby 绑定 ≥ 8 用例。
  - [ ] `rg "canClearChain=" src/ui/sidebar/App.tsx src/ui/settings/App.tsx` → **仅在 T14/T15 的组件调用处不出现手写布尔**（由 `variant` 传入）。
  - [ ] `npm run typecheck` → 0 error；`tests/unit/ui/no-cjk-in-ui.test.tsx` → PASS

  **QA Scenarios**:
  ```
  Scenario: create/edit 字段集等价（happy path）
    Tool: Bash (test runner)
    Steps:
      1. render variant='create' → 断言存在 Match URL / Match Type / Title source / Icon source / Priority
      2. render variant='edit' → 断言同一字段集合
      3. 断言两者都内含正则校验提示（输入非法 regex 出现 role=alert）
    Expected Result: 字段集与校验完全一致
    Failure Indicators: create 面缺正则校验
    Evidence: _context-output/evidence/task-10-equivalence-happy.txt

  Scenario: create 面不渲染 Clear（failure/edge）
    Tool: Bash (test runner)
    Steps:
      1. render variant='create'
      2. 断言 queryByLabelText('Clear title') === null 且 queryByLabelText('Clear icon') === null
      3. render variant='edit' → 断言两者存在
    Expected Result: 能力差异由单点派生
    Failure Indicators: create 面出现 Clear
    Evidence: _context-output/evidence/task-10-clear-capability-error.txt
  ```

  **Commit**: YES — groups with T11
  - Message: `feat(ui): add shared RuleFormFields (create/edit)`
  - Files: `src/ui/shared/rule-form-fields.tsx, tests/unit/ui/rule-form-fields.test.tsx`
  - Pre-commit: `npm run typecheck && npm run lint`

---

- [x] **T11. `src/ui/shared/field-editor.tsx` + `src/ui/shared/undo-bar.tsx`（S4a/DT7/DT9/IMP-6）**

  **What to do**:
  1. 新建 `src/ui/shared/field-editor.tsx`，按 S4a/D T5 模式模型：`mode: FieldMode = {kind:'set';value:string} | {kind:'use-chain'}`（title/icon 共用 `kind` 集合，icon 多一种 `set` 载荷形态）；props 含 `field`、`mode`、`onChange`、`iconConfig`/`onIconConfigChange`、`lastValue`、`chain`、`baseline`、`onResetEdit`、`onClearChain`、`clearing?`、`onClearMaskingOverride?`、`impact?`、`submitMode:{kind:'immediate'}|{kind:'draft';dirty;onDraftChange}`、`canClearChain?`、`disabled?`。
  2. 内含（唯一实现）：Title 2 项 / Icon 3 项 `RadioGroup`（`Custom Title`/`Use chain`；`Icon URL`/`Custom Icon`/`Use chain`）；`↺`（`Reset this edit`，**纯前端**复位到 `baseline`）；`Clear`（`Clear title`/`Clear icon`，**立即写存储 + 重投递**，当 `canClearChain`）；来源徽标（可点击跳焦）+ 遮蔽提示（`Overridden by …`）+ `Clear the page setting` 入口；影响面预览（`Clear` 场景**默认展开**，以「将被删除的全局配置」为第一信息）；`Applies immediately` 标注（DT12，必填且与底部 `Save` 视觉分离）。
  3. `dirty` **推导**而非手动置：`dirty = mode !== baseline || iconConfig !== baselineIconConfig`（DT12）。
  4. `Use chain` 旁注两态：edit 态 `Clears this layer — the value falls back to the next one in the chain.`；create 态 `This field stays unset — other layers will decide.`（T10 传 `variant` 派生）。
  5. `aria-describedby`：`Use chain` 旁注 + 遮蔽提示 + 影响面预览（IMP-12 触达面 4）。
  6. 新建 `src/ui/shared/undo-bar.tsx`（IMP-6 泛化）：`UndoState = {message:string; snapshot:UndoSnapshot; expiresAt:number}`；`UndoSnapshot = {writes:UndoLayerWrite[]; affectedTabIds:number[]}`（`UndoLayerWrite` 三变体 tab-override / slot-marker / rule）；**原子恢复**（一次性回放全部 `writes` → 再触发一次 `recomputeAndRedeliver`）；variant token 复用 `Toast`。
  7. 单测：`tests/unit/ui/field-editor.test.tsx`、`tests/unit/ui/undo-bar.test.tsx`。

  **Must NOT do**:
  - **不得**在 `FieldEditor` 内按调用方分支（DT1）；`canClearChain` 只能来自 T10 的单点派生。
  - **不得**把 `Clear` 放进 `Save` 的草稿栈（DT12：`Clear` 恒立即生效）。
  - **不得**用 `Toast.action` 做撤销（IMP-6：避免第二套撤销 UI）。
  - **不得**分次恢复 `UndoSnapshot`（DT9：必须原子批次）。
  - **不得**让 `↺` 写存储（DT7 ①：纯前端）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — 两个核心共享件，含提交模型/模式模型/原子撤销/a11y，易错面大。
  - **Skills**: `sw-tdd-agent`、`sw-ui-ux-review`（交互语义与 DT12 视觉区分）。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: T14, T15, T16
  - **Blocked By**: T1, T6

  **References**:
  - **Pattern References**: `src/ui/shared/components.tsx:233-300`（`Toast`/variant tokens，供 `UndoBar` 复用）、`:122-231`（`Dialog` a11y 参照）、`sidebar/App.tsx:462-493`（现 `UndoBar` 与 `UndoState`）、`sidebar/App.tsx:81-85`（`UndoState` 形状）；`src/ui/components/IconEditor.tsx`（`IconConfig`/`renderIconToDataUri`）。
  - **API/Type References**: `_context-output/designs/2026-10-02-field-chain-sync-architecture-ui-deepdive-design.md:258-304`（S4a 接口）、`_context-output/designs/2026-10-02-field-chain-sync-architecture-three-surfaces-implementation-direction-design.md:192-218`（IMP-6 `UndoSnapshot` 形状）、`_context-output/designs/2026-10-02-field-chain-sync-detail-interaction-copy-design.md:122-192`（DT7/DT9）、`_context-output/designs/2026-10-02-field-chain-sync-detail-copy-a11y-design.md:41-104`（文案/徽标/投递状态）。
  - **Test References**: `tests/unit/ui/sidebar-modal-a11y.test.tsx`、`tests/unit/ui/tokens-components.test.tsx`。
  - **WHY**: `Clear` 的破坏面（`slot.uiMarker`/`rule.title` 全局配置）要求「预览为唯一防线 + 原子撤销」；IMP-6 的批次快照形状是 DT9 硬约束的落地。

  **RED 可构造性说明**:
  - 「`onClearChain` 触发后 `UndoBar` 出现 + 点 Undo 恢复**全部** writes（一次性）」→ 无组件 → RED。
  - 「`dirty` 在 mode 与 baseline 相等时为 false（`Save.disabled`）」→ RED。
  - 「`canClearChain=false` 时 `Clear` 不渲染」→ RED。

  **Acceptance Criteria**:
  - [ ] `tests/unit/ui/field-editor.test.tsx` 与 `undo-bar.test.tsx` 新建；含模式模型、`↺` vs `Clear` 分工、原子撤销、dirty 推导、旁注两态、a11y 绑定 ≥ 12 用例。
  - [ ] `npx vitest run --project unit -t "FieldEditor|UndoBar"` → ALL PASS
  - [ ] `npm run typecheck` → 0 error；`no-cjk-in-ui` PASS

  **QA Scenarios**:
  ```
  Scenario: Clear 免确认 + 原子 Undo（happy path）
    Tool: Bash (test runner)
    Steps:
      1. 构造 UndoSnapshot{writes:[override,slot,rule], affectedTabIds:[1,2]}
      2. 点 Clear（无 Confirm 出现）→ 断言 onClearChain 被调用一次
      3. 点 Undo → 断言三类 writes 一次性全部恢复，且 recomputeAndRedeliver([1,2]) 被调用一次
    Expected Result: 原子恢复 + 单次重投递
    Failure Indicators: 分次恢复 / 缺重投递 / 出现 Confirm
    Evidence: _context-output/evidence/task-11-undo-atomic-happy.txt

  Scenario: ↺ 不写存储（failure/edge）
    Tool: Bash (test runner)
    Steps:
      1. 修改 mode 后点 ↺
      2. 断言 mode 回到 baseline 且 onClearChain / 任何写存储回调**未被调用**
    Expected Result: 纯前端复位
    Failure Indicators: 触发写存储
    Evidence: _context-output/evidence/task-11-reset-no-write-error.txt
  ```

  **Commit**: YES — groups with T10
  - Message: `feat(ui): add shared FieldEditor and generalized UndoBar`
  - Files: `src/ui/shared/field-editor.tsx, src/ui/shared/undo-bar.tsx, tests/unit/ui/{field-editor,undo-bar}.test.tsx`
  - Pre-commit: `npm run typecheck && npm run lint`

---

- [x] **T12. 死样式层清理 + `.tbs-dialog` header/footer sticky（② N2 / IMP-2）**

  **What to do**:
  1. 删除零引用死样式层：`src/ui/shared/global.css`（149 命中 `--tbs-*`，零 import）与 `src/ui/sidebar/sidebar.css`（32 命中，零 import）。**先确认无 import**（`rg "shared/global.css|sidebar/sidebar.css" src tests`）—— 注意区分 `src/ui/styles/sidebar.css`（**在用**，`sidebar/App.tsx:27` import）。
  2. `src/ui/styles/base.css:157-166` 的 `.tbs-dialog` 是**滚动容器**（`max-height:80vh; overflow-y:auto; padding:var(--space-xl)`）；给 `.tbs-dialog__header`（`:168-173`）加 `position:sticky; top:0`，`.tbs-dialog__footer`（`:180-185`）加 `position:sticky; bottom:0`，**均加不透明背景**（用 `var(--color-bg)`）防内容透出；用负 margin 或 padding 调整补齐滚动容器 padding 造成的边缘缝隙。
  3. 单测：`tests/unit/ui/dialog-sticky.test.tsx`（读 `base.css` 断言 sticky + 不透明背景，范式见 `slot-action-button-sizing.test.tsx:152` 读 CSS）。

  **Must NOT do**:
  - **不得**删除 `src/ui/styles/sidebar.css`（在用）；**不得**删除 `tokens.css`。
  - **不得**在 sticky 元素上用透明背景（内容会透出）。
  - **不得**新增 `!important`。

  **Recommended Agent Profile**:
  - **Category**: `quick` — 纯 CSS + 一个 CSS 断言测试。
  - **Skills**: `sw-tdd-agent`。
  - **Skills Evaluated but Omitted**: `sw-ui-ux-review`（无交互变更）。

  **Parallelization**:
  - **Can Run In Parallel**: YES（纯样式，无代码依赖）
  - **Parallel Group**: Wave 2
  - **Blocks**: T21
  - **Blocked By**: None

  **References**:
  - **Pattern References**: `src/ui/styles/base.css:145-186`（Dialog 样式）、`:6`（`@import './tokens.css'`，证明 `tokens.css` 是唯一 token 源）；`tests/unit/ui/slot-action-button-sizing.test.tsx:68,152`（读 CSS 文件断言范式）。
  - **API/Type References**: `_context-output/designs/2026-10-02-field-chain-sync-architecture-four-surfaces-ui-direction-design.md:16-17`（N2 死样式层）、`_context-output/designs/2026-10-02-field-chain-sync-architecture-three-surfaces-implementation-direction-design.md:261-274`（IMP-2 sticky 必要修补 + 边缘缝隙）。
  - **WHY**: 常驻展开后 `.tbs-dialog` 内容变长，`Save`/`Cancel` 会滚出视野（IMP-2 明确「必然发生」）；N2 是「唯一 token 源」的前提。

  **RED 可构造性说明**:
  - 「`.tbs-dialog__footer` 含 `position: sticky`」→ 当前无 → 测试 RED。
  - 「`src/ui/shared/global.css` 不存在」→ 当前存在 → RED。

  **Acceptance Criteria**:
  - [ ] `src/ui/shared/global.css` 与 `src/ui/sidebar/sidebar.css` 已删除；`rg "shared/global.css|sidebar/sidebar.css" src tests` → 0 依赖（测试除外，需同步清理）。
  - [ ] `base.css` 的 header/footer 含 `position: sticky` + 不透明背景。
  - [ ] `npm run build:chrome` → 成功（样式未破坏构建）。

  **QA Scenarios**:
  ```
  Scenario: Dialog header/footer sticky（happy path）
    Tool: Bash (test runner)
    Steps:
      1. 读取 src/ui/styles/base.css
      2. 断言 .tbs-dialog__header 与 .tbs-dialog__footer 规则含 'position: sticky'
      3. 断言两者背景为 var(--color-bg)（不透明）
    Expected Result: sticky + 不透明背景均存在
    Failure Indicators: 缺 sticky / 背景透明
    Evidence: _context-output/evidence/task-12-sticky-happy.txt

  Scenario: 死样式层已删（failure/edge）
    Tool: Bash
    Steps:
      1. `ls src/ui/shared/global.css src/ui/sidebar/sidebar.css` → 应不存在
      2. `npm run build:chrome` → 成功
    Expected Result: 文件不存在且构建成功
    Failure Indicators: 文件仍在 / 构建失败
    Evidence: _context-output/evidence/task-12-dead-css-error.txt
  ```

  **Commit**: YES — standalone
  - Message: `chore(styles): remove dead --tbs-* layer; make dialog header/footer sticky`
  - Files: `src/ui/styles/base.css, src/ui/shared/global.css (deleted), src/ui/sidebar/sidebar.css (deleted), tests/unit/ui/dialog-sticky.test.tsx`
  - Pre-commit: `npm run typecheck && npm run lint`

---

- [x] **T13. `src/ui/shared/use-jump-to-row.ts` 跳焦（F1/F1b/F2）**

  **What to do**:
  1. 新建 `src/ui/shared/use-jump-to-row.ts`：接收 `anchor: TierOwner` + 表格行解析器 + 搜索框 ref；行为：
     - **F1**：滚到目标行 + 高亮，**不自动展开**、**不改用户筛选/排序**；
     - **F1b 回退链**：目标行可见 → 滚 + 高亮；不可见但有行 → 滚到**表格第一行**（**绝不高亮**）；无行 → 聚焦**搜索框**；
     - **F1b-b 如实说明**：回退时 `role="status"` 播报（目标被筛掉：`The target rule is hidden by the current search — showing all matches instead.`；无行：`No rules to show — try clearing the search.`）；
     - **F2**：临时高亮 ~2s（带过渡），**reduced-motion 降级去掉过渡但保留高亮**（F2-b）；**非视觉播报** `Jumped to the rule`（F2-c，不抢焦点）；重复跳焦**重置计时器**（F2-d）；回退场景**不套用高亮**（F2-e）。
  2. 新增 CSS 类 `tbs-settings__row--jump`（只用 `tokens.css` 的 `--color-*`/`--duration-*`；F2-a）；`settings.css` 内加入。
  3. 单测：`tests/unit/ui/use-jump-to-row.test.tsx`（可见/不可见/无行三情形 + 计时器重置 + 播报）。

  **Must NOT do**:
  - **不得**自动展开目标行（F1）。
  - **不得**在回退时高亮（F1b-a：高亮 = 「这就是目标」的语义）。
  - **不得**在 reduced-motion 下把高亮一起降掉（F2-b：会看不到任何反馈）。
  - **不得**抢焦点（高亮是纯视觉，靠播报补 a11y）。
  - **不得**新增硬编码颜色（用 token）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — 跨 Section 定位 + 回退链 + a11y 播报 + 计时器，边界多。
  - **Skills**: `sw-tdd-agent`、`sw-ui-ux-review`。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2
  - **Blocks**: T15, T16
  - **Blocked By**: T1, T4, T6

  **References**:
  - **Pattern References**: `settings/App.tsx:855-872`（搜索/排序）、`:649,689-696`（展开 Set）、`:1107`（`tbs-settings__row--disabled` 同族命名）；`src/ui/styles/tokens.css:139-151`（`prefers-reduced-motion` 降级）。
  - **API/Type References**: `_context-output/designs/2026-10-02-field-chain-sync-detail-validation-focus-empty-design.md:126-155`（F1/F1b）、`:256-270`（F2 四约束）、`:63-72`（跳焦既有机制）。
  - **Test References**: `tests/unit/ui/settings-deeplink.test.tsx`（跨 Section 定位范式）。
  - **WHY**: F1b 消灭「点了徽标没反应」（与 ② D-8「能点但没反应」同族）；F2-b/F2-c 是 a11y 硬要求（无焦点移入时的唯一反馈）。

  **RED 可构造性说明**:
  - 「目标行被搜索筛掉 → 滚到表格第一行且**不高亮** + `role=status` 说明」→ 无 hook → RED。
  - 「连续两次跳焦 → 第二个的定时器不被第一个提前清除」→ RED。
  - 「reduced-motion 下保留高亮」→ RED。

  **Acceptance Criteria**:
  - [ ] `tests/unit/ui/use-jump-to-row.test.tsx` 新建；含三情形 + 计时器 + 播报 + reduced-motion ≥ 8 用例。
  - [ ] `tbs-settings__row--jump` 只用既有 token；`rg "#[0-9A-Fa-f]{6}" src/ui/styles/settings.css` → 0 新增。

  **QA Scenarios**:
  ```
  Scenario: 目标可见 jumps + 2s 高亮（happy path）
    Tool: Bash (test runner)
    Steps:
      1. 渲染含 3 行的表，row2 存在；触发 jumpTo({kind:'rule',ruleId:'r2'})
      2. 断言 row2 获得 --jump 类且被滚动到（scrollIntoView 被调用）
      3. 前进 2s（fake timers）→ 断言 --jump 类被移除
    Expected Result: 滚到 + 高亮 + 2s 后消失
    Failure Indicators: 无高亮 / 高亮不消失
    Evidence: _context-output/evidence/task-13-jump-happy.txt

  Scenario: 目标被筛掉 → 回退不高亮（failure/edge）
    Tool: Bash (test runner)
    Steps:
      1. 设置搜索使 row2 不渲染（表格仍有 row1）
      2. 触发 jumpTo(r2)
      3. 断言滚动到 row1 且 **row1 无 --jump 类**；断言存在 role=status 且文本含 'hidden by the current search'
    Expected Result: 回退到第一行、不高亮、有如实说明
    Failure Indicators: 高亮 row1（误导）/ 无说明
    Evidence: _context-output/evidence/task-13-jump-fallback-error.txt
  ```

  **Commit**: YES — groups with T15
  - Message: `feat(ui): add jump-to-row with fallback chain and non-visual announcement`
  - Files: `src/ui/shared/use-jump-to-row.ts, src/ui/styles/settings.css, tests/unit/ui/use-jump-to-row.test.tsx`
  - Pre-commit: `npm run typecheck && npm run lint`

---

### Wave 3 — 三界面重写 + 文案 + a11y（Wave 2 后）

- [x] **T14. 侧边栏弹窗改造（S1/DT1/DT4/DT5/DT6/DT7/IMP-1/2/7/8 + IMP-18 6,7,8）**

  **What to do**:
  1. `src/ui/sidebar/App.tsx` 的 `CreateRuleModal`（`:572-798`）改造为：`Dialog`（**保留**，IMP-1）+ `RuleFormFields(variant='create')` + 创作态标注（`This rule is not saved yet`，DT5）+ `MatchSummary`（IMP-8）。
  2. **IMP-18 第 6 条**：删 `Auto-apply on match` 勾选（`sidebar:786-791`）。
  3. **IMP-18 第 7 条**：`:1520`、`:1766` 删 `r.mode === 'auto' &&`（只留 `r.enabled !== false`）。
  4. **IMP-18 第 8 条**：`:1311`（`handleCreateGlobalRule` 载荷）、`:568`（`onSave` 签名）、`:576,596`（`mode` state）删 `mode`。
  5. **DT4**：四项预填（`Match URL`/`Match Type`/`Title`/`Icon`）**全部**带入上下文，来源统一为**链**（`resolveFieldChain` 取代 `displayCurrentTitle`，`:1492-1528` 的手抄链删除）；打开时**快照一次**。
  6. **D-3**：Current Page 的 `●` 展示改为渲染 `ChainResult`（四层值 + 来源徽标 + `masked`）。
  7. **R6 短路重写**（`sidebar:1244`）：空值不再隐含「不使用本层」→ 显式模式判定（CT1 影响 #3 / CT4）。
  8. **placeholder 删除**：`:721` 的 `Leave empty to keep original` 删除（CT1 影响 #2）。
  9. **D-1 可发现性**：可编辑字段常驻 `✎` 入口（`aria-label`），保留双击作为加速（修 N4/N5）；`⋯` 菜单补 Escape/方向键/焦点移入（D-5）；Current Page 图标补 `onKeyDown`（Enter/Space）。
  10. **D-10 焦点闭环**：`Dialog` 传 `returnFocusRef`（回 `＋` 或 `⋯` 菜单项，`:649-661` 现未传）。
  11. 单测：`tests/unit/ui/sidebar-modality.test.tsx`（弹窗字段集 = RuleFormFields；无 mode；预填来自链；R6 重写）。

  **Must NOT do**:
  - **不得**删除 `Dialog`（IMP-1：全产品唯一保留的模态弹窗）。
  - **不得**用两列网格（R1：288px）。
  - **不得**在窄栏隐藏「清除/编辑入口」（D-4 保留约束）。
  - **不得**自绘 Icon/Title 字段（必须 `RuleFormFields`/`FieldEditor`）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — 侧边栏是高频路径（1831 行），改造面广（弹窗 + Current Page + slot 列表）。
  - **Skills**: `sw-tdd-agent`、`lsp-code-analysis`。

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 T15/T16 并行；三界面文件互斥）
  - **Parallel Group**: Wave 3
  - **Blocks**: T18, T19, T20
  - **Blocked By**: T1, T4, T7, T8, T10, T11, T13

  **References**:
  - **Pattern References**: `src/ui/sidebar/App.tsx:572-798`（`CreateRuleModal`）、`:1229-1314`（标题/图标编辑 + 建规则）、`:1480-1528`（Loading + 手抄链 `:1492-1528`）、`:1553-1684`（Current Page 区）、`:1741-1806`（slot 列表）；`src/ui/shared/components.tsx:122-231`（`Dialog`）。
  - **API/Type References**: `_context-output/designs/2026-10-02-field-chain-sync-architecture-ui-deepdive-design.md:207-221`（S1 字段表）、`_context-output/designs/2026-10-02-field-chain-sync-detail-interaction-copy-design.md:36-104`（DT2–DT6）。
  - **Test References**: `tests/unit/ui/sidebar-modal-a11y.test.tsx`、`sidebar-dialog-focus-return.test.tsx`、`sidebar-icon-editor-prefill.test.tsx`、`sidebar-regex-display.test.tsx`。
  - **WHY**: 侧边栏的显式命名（`Icon URL`/`Custom Icon`/`Use chain`）是全系统基准（DT2）；手抄链（`:1492-1528`）是侦察 #1 的现场。

  **RED 可构造性说明**:
  - 「弹窗内不存在 `Auto-apply on match`」→ 当前**存在**（`:786-791`）→ RED。
  - 「`state.sync.rules.filter` 不再含 `mode === 'auto'`」→ 当前 `:1520,1766` 含 → RED。
  - 「空标题输入不再因 `next === currentTitleInitial` 短路」→ 当前 `:1244` 短路 → RED。

  **Acceptance Criteria**:
  - [ ] `tests/unit/ui/sidebar-modality.test.tsx` 新建；ALL PASS。
  - [ ] `rg "mode" src/ui/sidebar/App.tsx` → 0 命中（含 `iconMode` 需改名为 `mode`/`iconMode` 的新模式模型，无 `auto|manual` 残留）。
  - [ ] `npm run typecheck` → 0 error；`no-cjk-in-ui` PASS

  **QA Scenarios**:
  ```
  Scenario: 弹窗复用共享字段集（happy path）
    Tool: Bash (test runner)
    Steps:
      1. 打开 New Global Page Rule 弹窗
      2. 断言存在 Match URL / Match Type / Title source / Icon source / Priority，且无 Auto-apply on match
      3. 输入非法 regex → 断言出现 role=alert 内联错误且 Save 禁用
    Expected Result: 共享字段集 + 校验内联 + Save 禁用
    Failure Indicators: 仍有 mode 勾选 / 无内联校验
    Evidence: _context-output/evidence/task-14-modal-happy.txt

  Scenario: 预填来自链而非手抄（failure/edge）
    Tool: Bash (test runner)
    Steps:
      1. 构造 chain：override=null, slot='S', rule='R'（当前页命中 slot）
      2. 打开弹窗 → 断言 Title 预填 = 'S'（slot 胜出）且来源标注为 slot
    Expected Result: 预填 = 链胜出值
    Failure Indicators: 预填为手抄的 displayCurrentTitle
    Evidence: _context-output/evidence/task-14-prefill-error.txt
  ```

  **Commit**: YES — groups with T15
  - Message: `feat(sidebar): reuse shared RuleFormFields; converge on chain-derived prefill`
  - Files: `src/ui/sidebar/App.tsx, tests/unit/ui/sidebar-modality.test.tsx`
  - Pre-commit: `npm run typecheck && npm run lint`

---

- [x] **T15. Rules 界面重写（S2/IMP-3/9/10/18 2,3,4,5,9 + D-12/D-13/D-15/D-16）**

  **What to do**:
  1. **IMP-18 第 2 条**：`settings/App.tsx:1048-1057` 删 `Mode` 列头与排序按钮。
  2. **IMP-18 第 3 条**：`:33`（`SortKey` 去 `mode`）、`:36-49`（`compareRules` 删分支）。
  3. **IMP-18 第 4 条**：`:521`（`InlineRuleEditor` colSpan）、`:1171`（空态 colSpan）**8 → 7**。
  4. **IMP-18 第 5 条**：`:616-619`（Inline `Auto-apply`）、`:1010-1015`（New Rule `Auto-apply`）删勾选。
  5. **IMP-18 第 9 条**：`:419,445-446,494,701`（Inline 的 `mode` state/载荷）、`:388-399,401-411`（`RuleFormState`/`EMPTY_RULE_FORM`）删 `mode`。
  6. **IMP-9 列序**：重排为 `☑ / Icon / Title / URL Pattern / Priority / Enabled / Actions`（7 列）；`Title` 前移到第 3（不合并单元格）。
  7. **IMP-3**：`New Rule` 保持**顶部内联**（`:902-1024`），`InlineRuleEditor` 保持**行内**（`:1160-1166`）—— **位置差异有意保留**；两者字段集/校验/文案由 `RuleFormFields` 两模式构造保证一致。
  8. **D-16/IMP-15/16**：`InlineRuleEditor` 改走 `useExpandRow`（Escape 取消 + 展开后焦点移入 + 收起后焦点回归）；`colSpan` 随列数。
  9. **D-12**：接入 `Confirm`（`settings:13` 加 import）——行删除（`:1153-1155`→`:784-791`）+ 批量删除（`:814-824`）前置 `Confirm`；**替换静默 catch** 为如实 toast（含部分失败 `Deleted 3 of 5 · 2 failed`）。
  10. **D-13（默认 (a) 自动裁剪）**：过滤变化时把不可见 id 移出 `selectedIds`（`:653,814-824,891-893`）；**显式登记该默认**。
  11. **IMP-10/D-15 四态空态**：`:661-671`（`loadRules` 静默 catch → error state，保留旧数据时非阻塞形态）；`:1169-1175` 拆为 `empty`/`no-match`/`error` 三分支（用 `EmptyState`）。
  12. **D-11/D9**：不展示内部 id（表格与 `aria-label` 用可读标签）。
  13. **跳焦入口**：接收 `anchor`（来自 Dashboard 徽标）→ 调 T13 的 `useJumpToRow`。
  14. 单测：`tests/unit/ui/rules-table.test.tsx`（7 列 + 列序 + 空态三态 + 自动裁剪 + Confirm + 部分失败 toast）。

  **Must NOT do**:
  - **不得**「统一」`New Rule` 与 `InlineRuleEditor` 的位置（IMP-3：有意差异）。
  - **不得**合并 Icon/Title 单元格（IMP-9）。
  - **不得**保留 `mode` 列/排序/state。
  - **不得**放宽 `selectedIds` 语义为「含不可见项」（默认 D-1=(a)）。
  - **不得**在 New Rule 加 `Enabled`（面特异，行为保持）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — 表格/批量/空态/确认/跳焦多关注点（`settings/App.tsx` 85KB），须精准定位行号。
  - **Skills**: `sw-tdd-agent`、`lsp-code-analysis`。

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 T14/T16 并行）
  - **Parallel Group**: Wave 3
  - **Blocks**: T18, T19, T20
  - **Blocked By**: T1, T4, T7, T8, T10, T11, T13

  **References**:
  - **Pattern References**: `settings/App.tsx:644-1184`（`RulesSection`）、`:430-642`（`InlineRuleEditor`）、`:875-900`（工具栏/批量条）、`:1026-1103`（表头）、`:1159-1175`（行内展开 + 空态）。
  - **API/Type References**: `_context-output/designs/2026-10-02-field-chain-sync-architecture-ui-deepdive-design.md:223-236`（S2）、`_context-output/designs/2026-10-02-field-chain-sync-architecture-three-surfaces-implementation-direction-design.md:381-397`（IMP-9）、`:400-453`（IMP-18/IMP-10）、`_context-output/designs/2026-10-02-field-chain-sync-architecture-four-surfaces-ui-direction-design.md:145-169`（D-11..D-16）、`:154-158`（D-13）。
  - **Test References**: `tests/unit/ui/inline-rule-editor.test.tsx`、`rule-inline-notice.test.tsx`、`settings-loading-states.test.tsx`。
  - **WHY**: IMP-18 的落地清单含「侧边栏仍在用 mode」（本任务 T14 的 6/7/8 条），两任务合起来才是完整 12 条；D-13 是 OPEN 裁决缺口（G-1）。

  **RED 可构造性说明**:
  - 「表头无 `Mode` 且列数 = 7」→ 当前 8 列含 Mode → RED。
  - 「搜索过滤后 `selectedIds` 不含不可见 id」→ 当前包含 → RED。
  - 「`InlineRuleEditor` 按 Escape 收起」→ 当前无 `onKeyDown` → RED。

  **Acceptance Criteria**:
  - [ ] `tests/unit/ui/rules-table.test.tsx` 新建；ALL PASS。
  - [ ] `rg "SortKey.*mode|toggleSort\('mode'\)|mode === 'auto'" src/ui/settings/App.tsx` → 0 命中。
  - [ ] `npm run typecheck` → 0 error；`no-cjk-in-ui` PASS

  **QA Scenarios**:
  ```
  Scenario: 7 列且列序正确（happy path）
    Tool: Bash (test runner)
    Steps:
      1. 渲染 Rules 表
      2. 断言表头依次为 ☑ / Icon / Title / URL Pattern / Priority / Enabled / Actions
      3. 断言无 'Mode' 表头
    Expected Result: 7 列 + 正确列序
    Failure Indicators: 仍 8 列 / Title 位置不符
    Evidence: _context-output/evidence/task-15-columns-happy.txt

  Scenario: 自动裁剪 selectedIds（failure/edge）
    Tool: Bash (test runner)
    Steps:
      1. 选中 3 行（含 row2），再搜索使 row2 不可见
      2. 断言 row2 已从 selectedIds 移除
      3. 点击批量删除 → 断言只删可见的 2 行
    Expected Result: 所见即所操作
    Failure Indicators: row2 仍被删除
    Evidence: _context-output/evidence/task-15-select-prune-error.txt
  ```

  **Commit**: YES — groups with T13/T14
  - Message: `feat(settings): rewrite Rules table (7 cols), confirmations, empty states, selection prune`
  - Files: `src/ui/settings/App.tsx, tests/unit/ui/rules-table.test.tsx`
  - Pre-commit: `npm run typecheck && npm run lint`

---

- [x] **T16. Dashboard 重写（S3/A10/IMP-4/5/13/19/G1 + N8/N9/D-17..D-21）**

  **What to do**:
  1. **数据源改 `DashboardRow[]`**（A10/T4 契约）：`worker-orchestrator.ts:760-800` 的 `GET_DASHBOARD` 重塑为返回 `DashboardRow`（`kind:'override'|'slot'|'rule-hit'`，含 `chain:{title,favicon}` 与 `delivery`，`anchor` 承载跳焦）；受管配置清单 = override 项 + 显式设置过标题/图标的 slot 项 + **被 rule 遮蔽的页面**；折叠的「受管标签页视图」= rule 命中页。
  2. `settings/App.tsx` `DashboardSection`（`:1216-1684`）：`load()`（`:1249-1268`）解析 `DashboardRow[]`；`DashboardEntry` 类型扩展（含 `chain`/`delivery`/`anchor`）。
  3. **IMP-4 行内展开**：Edit 面板从「表格下方单一 `div`」（`:1587-1677`）改为**内嵌到对应行**（`<tr><td colSpan={5}>`，与 `InlineRuleEditor` 同形状，**支持多行同时展开**）；草稿态改 `Map<entryId, DashboardEditForm>`；**不用** `Dialog`/`drawer`。
  4. **IMP-5 单元格密度**：单元格 = **胜出值 + 来源徽标**（`Page`/`Slot N`/`Rule`/`Site`）；四层值 + `masked` + 清除入口进展开面板；`site` 未捕获 → `—`（`known:false`），**须区分「`—`（未知）」与「空」**；`site` 节点**不可编辑**；徽标是**唯一跨面跳焦入口** → `button` 语义 + `aria-label`。
  5. **D-18/DT10**：两个 `FieldEditor`（Title/Icon）各自 `↺`（草稿）+ `Clear`（立即）；**两个维度的改值统一由底部 `Save` 提交**（`submitMode='draft'`）；`Save.disabled = !dirty`（**由本行 dirty 真实驱动**，IMP-19/F-5）。
  6. **D-20/IMP-6**：`Reset All` / `Reset Selected` / 行级 Reset 前置 `Confirm`（N9）+ 接入泛化 `UndoBar`；删除 `Reset All`/`Reset Selected` 无确认现状（`:1467-1472`）。
  7. **Q13/N10/DT11 收尾**（与 T18 分工：本任务改**调用点**）：`resetEntry`（`:1288-1306`）/`resetAll`（`:1308-1329`）/`resetSelected`（`:1331-1353`）的 slot 分支改按字段清除；`resetEntryTitle`（`:1358-1376`）改为 `Clear` 语义（走 `onClearChain`）。
  8. **N8 一致化**：表头全选基于 `entries`（`:1479-1487`）vs 行 `sortedEntries`（`:1539`）→ 一致化。
  9. **D-9/`:1589`**：`Edit {entryId}` → `Edit {label}`（如 `Edit Tab 3`）。
  10. **D-21/G1 空态 + 汇总句**：`empty`（`Nothing customized yet` + `Set a title or icon from the sidebar to see it here.`）/`no-match`/`error` 三态（`EmptyState`）；「有行但全不可投递」汇总句（G1：`2 items · none can be applied here`，**`unknown` 不计入**）。
  11. **`delivery` 呈现**：`ok`（不显示）/`protected`（`Can't rewrite this page`）/`degraded`（`Limited: can't restore the site value`）/`unknown`（`—`）。
  12. 单测：`tests/unit/ui/dashboard.test.tsx`（多行草稿 Map、每行 `Save.disabled`、Confirm、汇总句、`anchor` 跳焦、`Edit {label}`）。

  **Must NOT do**:
  - **不得**用 `Dialog` 做 Dashboard Edit（IMP-4 已否决：overlay 铺满 + z-index 冲突）。
  - **不得**把四层值放单元格（IMP-5：单元格只放胜出值 + 徽标）。
  - **不得**让 `site` 节点可编辑（C6：只读）。
  - **不得**把 `unknown` 计入「不可投递」统计（G1-a：否则汇总句恒真）。
  - **不得**做脏点/汇总条/`Save all`（IMP-14 撤销）。
  - **不得**用 `Toast.action` 做撤销（用 `UndoBar`）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — 契约重塑 + 行内多草稿 + Confirm/UndoBar + 空态/delivery，面最广。
  - **Skills**: `sw-tdd-agent`、`lsp-code-analysis`、`sw-ui-ux-review`。

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 T14/T15 并行）
  - **Parallel Group**: Wave 3
  - **Blocks**: T18, T19, T20
  - **Blocked By**: T1, T4, T5, T7, T8, T11

  **References**:
  - **Pattern References**: `settings/App.tsx:1216-1684`（`DashboardSection`）、`:1249-1277`（load + storage.onChanged）、`:1288-1394`（reset*/openEdit）、`:1459-1584`（工具栏/表格）、`:1587-1677`（Edit 面板现状）；`worker-orchestrator.ts:760-800`（`GET_DASHBOARD` 现状）。
  - **API/Type References**: `src/shared/types.ts:127-136`（`DashboardItem` 现形状 → 改 `DashboardRow`）、`_context-output/designs/2026-10-02-field-chain-sync-architecture-module-design.md:181-199`（A10 `DashboardRow`）、`_context-output/designs/2026-10-02-field-chain-sync-architecture-three-surfaces-implementation-direction-design.md:219-238`（IMP-4 六细节）、`:294-304`（IMP-5）、`:240-259`（IMP-13/19）、`_context-output/designs/2026-10-02-field-chain-sync-detail-copy-a11y-design.md:96-105`（delivery 文案）。
  - **Test References**: `tests/unit/ui/settings.test.tsx`、`import-diagnostics.test.tsx`。
  - **WHY**: A10 的 `chain`/`delivery` **由后台一处算好**（避免前端拼一份的同型分叉）；IMP-4 的 `Map<entryId,draft>` 对应既有 `expandedRuleIds`（`settings:649`）形状，无需发明新机制。

  **RED 可构造性说明**:
  - 「展开两行 → 两行各自 `Save.disabled` 独立」→ 当前单 `editing`（`:1223`）→ RED。
  - 「单元格式显示胜出值 + 徽标（`Slot 5`）」→ 当前仅值（`:1556-1562`）→ RED。
  - 「汇总句 `2 items · none can be applied here`（`unknown` 不计入）」→ RED。
  - 「`Edit Tab 3` 而非 `Edit cp-123`」→ 当前 `:1589` 用 `entryId` → RED。

  **Acceptance Criteria**:
  - [ ] `tests/unit/ui/dashboard.test.tsx` 新建；ALL PASS。
  - [ ] `GET_DASHBOARD` 返回类型 = `DashboardRow[]`（typecheck 强制）。
  - [ ] `rg "Reset all items|Selected items reset|icon updated|reset\`\}" src/ui/settings/App.tsx` → 文案已按 T19/D-a-1 更新。
  - [ ] `npm run typecheck` → 0 error；`no-cjk-in-ui` PASS

  **QA Scenarios**:
  ```
  Scenario: 行内多草稿独立 Save（happy path）
    Tool: Bash (test runner)
    Steps:
      1. 展开 entry A 与 entry B
      2. 改 A 的 Title → 断言 A 的 Save 可点、B 的 Save 仍禁用
      3. 点 A Save → 断言 A 提交（调 Save 回调），B 草稿仍在
    Expected Result: 每行 dirty 独立驱动
    Failure Indicators: B 的 Save 也被启用
    Evidence: _context-output/evidence/task-16-inline-draft-happy.txt

  Scenario: unknown 不计入不可投递汇总（failure/edge）
    Tool: Bash (test runner)
    Steps:
      1. 构造 rows：2 个 unknown + 1 个 ok
      2. 断言**不显示** 'none can be applied here' 汇总句
      3. 改为 1 个 protected → 断言显示 '1 item · none can be applied here'
    Expected Result: unknown 不计入，protected 计入且单数
    Failure Indicators: unknown 被计入 / 单复数错
    Evidence: _context-output/evidence/task-16-summary-error.txt
  ```

  **Commit**: YES — groups with T18
  - Message: `feat(settings): rewrite Dashboard (DashboardRow, inline edit, delivery, Confirm+UndoBar)`
  - Files: `src/ui/settings/App.tsx, src/background/worker-orchestrator.ts, tests/unit/ui/dashboard.test.tsx`
  - Pre-commit: `npm run typecheck && npm run lint`

---

- [x] **T17. a11y 收口（CT3-b/CT3-g + IMP-12 触达面 + G1 汇总句）**

  **What to do**:
  1. **CT3-b · `Confirm` 焦点**：`components.tsx:306-348` 的 `Confirm` 初始焦点落**确认按钮** → **DOM 顺序改为「确认 → 取消」**；补 4 条约束：b1（打开那次回车不穿透 → 触发按钮 `keydown` 阻止默认）、b2（所有新用法传 `returnFocusRef`/`focusFallbackRef`）、b3（不可逆操作配 `UndoBar`）、b4（`Confirm` 打开后**极短保护期 ~100–150ms 忽略 Enter**）。
  2. **CT3-g · `UndoBar` 焦点**：`src/ui/shared/undo-bar.tsx`（T11）**抢焦点到 Undo 按钮**；补 4 条约束：g1（焦点归还到 `UndoBar` 出现前的元素，元素消失则退到稳定容器）、g2（`UndoBar` 与 `Confirm` **串行不叠加**：`Confirm` 关闭 → 提交 → 再弹 `UndoBar`）、g3（打开那次回车不穿透 + 保护期）、g4（**`role="alert" aria-live="polite"` 语义冲突 → 改 `role="status"`**，二者不叠加）。
  3. **IMP-12 触达面 `aria-describedby`**（T10/T11 已绑；本任务核对 + 补漏）：`Match URL`/`Match Type`/`Priority`/`FieldEditor`(Title/Icon) 的 `aria-describedby` → 对应 `errorId`/`hintId` 节点（`CT3-d`：绑到 `input` 本体，`errorId` 节点保留 `role="alert"`）。
  4. **`FormField` API 登记**：把 `errorId`/`hintId` **正式登记为 `FormField` 公开 API**（导出/文档化），并**登记未绑定清单**（本迭代不修，作为后续项）—— 不新开裁决项。
  5. **`CT3-e` 状态与颜色解耦**：所有「仅颜色」语义（`outdated`/`masked`/`degraded`/脏态/radio 选中）须有**文字或图标**补充。
  6. **`CT3-f`**：`Use chain` 旁注须与 radio 关联（`aria-describedby` 指向旁注 id）。
  7. **G1 汇总句**（与 T16 协同）：确保「有行但存在 `protected`/`degraded`」时表格上方汇总句存在；`unknown` **不计入**。
  8. 单测：`tests/unit/ui/a11y-confirm-undo.test.tsx`（Confirm 焦点 + 保护期 + UndoBar role/焦点归还 + 不叠加）。

  **Must NOT do**:
  - **不得**改 `Confirm` 视觉（仍 `default`/`danger`）。
  - **不得**让 `UndoBar` 与 `Confirm` 同时抢焦点。
  - **不得**叠加 `role="alert"` + `aria-live="polite"`。
  - **不得**只为颜色提供语义（无文字/图标补充）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — a11y 边界（焦点时序/保护期/播报冲突）易错且需 WCAG 2.1 AA。
  - **Skills**: `sw-tdd-agent`、`sw-ui-ux-review`。

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 T14/T15/T16 并行，但焦点交互与它们耦合 → 建议在 Wave 3 尾部）
  - **Parallel Group**: Wave 3
  - **Blocks**: T20
  - **Blocked By**: T6, T11, T13

  **References**:
  - **Pattern References**: `src/ui/shared/components.tsx:100-119`（`focusFallbackRef` 已为「触发器被卸载」设计）、`:122-231`（`Dialog` 焦点首元素 `:138-141`）、`:306-348`（`Confirm`）、`:341-371`（`FormField` `errorId`/`hintId` 注释「由调用方自行绑定」——① N15 成因）。
  - **API/Type References**: `_context-output/designs/2026-10-02-field-chain-sync-detail-copy-a11y-design.md:215-247`（CT3-b/CT3-g 4 条约束）、`:206-213`（CT3-c/d/e/f）、`:107-172`（G1 汇总句 + 空态文案）。
  - **Test References**: `tests/unit/ui/sidebar-slot-confirm-overlay.test.tsx`（Confirm 覆盖层范式）、`sidebar-dialog-focus-return.test.tsx`。
  - **WHY**: IMP-12 的固有缺陷正是「靠调用方自觉」；把它登记为公开 API + 未绑定清单是防「问题再次沉底」的兜底。

  **RED 可构造性说明**:
  - 「`UndoBar` 的 root 为 `role="status"`（非 `alert`）」→ 当前 `sidebar:486` 为 `alert`+`polite` → RED。
  - 「`Confirm` 打开时初始焦点在确认按钮」→ 当前 DOM 顺序未定；若顺序为「取消→确认」则初次聚焦落到取消 → RED。
  - 「打开后 100ms 内按 Enter 不触发确认」→ 当前无保护期 → RED。

  **Acceptance Criteria**:
  - [ ] `tests/unit/ui/a11y-confirm-undo.test.tsx` 新建；ALL PASS。
  - [ ] `rg 'role="alert" aria-live' src/ui` → 0 命中（不叠加）。
  - [ ] `npm run typecheck` → 0 error；`no-cjk-in-ui` PASS

  **QA Scenarios**:
  ```
  Scenario: UndoBar 抢焦点 + 过期归还（happy path）
    Tool: Bash (test runner)
    Steps:
      1. 触发 Clear（UndoBar 出现）→ 断言 document.activeElement 为 Undo 按钮
      2. 断言 UndoBar root role === 'status'
      3. 前进 5s（fake timers）→ 断言焦点回到触发按钮（或稳定容器）
    Expected Result: 抢焦点 + role=status + 归还
    Failure Indicators: 不聚焦 / role=alert / 焦点掉 body
    Evidence: _context-output/evidence/task-17-undobar-a11y-happy.txt

  Scenario: Confirm 保护期防连击（failure/edge）
    Tool: Bash (test runner)
    Steps:
      1. 用键盘 Enter 打开 Confirm，立即（<100ms）再按 Enter
      2. 断言第二次 Enter**未**触发确认
      3. 等 200ms 后再按 Enter → 断言确认触发
    Expected Result: 保护期内不穿透
    Failure Indicators: 连按两下即确认
    Evidence: _context-output/evidence/task-17-confirm-guard-error.txt
  ```

  **Commit**: YES — groups with T14/T15/T16
  - Message: `a11y: fix Confirm/UndoBar focus, add aria-describedby bindings, status announcements`
  - Files: `src/ui/shared/components.tsx, src/ui/shared/undo-bar.tsx, tests/unit/ui/a11y-confirm-undo.test.tsx`
  - Pre-commit: `npm run typecheck && npm run lint`

---

- [x] **T18. 孤儿与死代码删除 + DT11 一元化（Q13/N10/N12/DT11）**

  **What to do**:
  1. 删除孤儿：`src/ui/settings/RuleEditor.tsx`（src 无引用，仅 `tests/unit/ui/rule-editor.test.tsx` 引用）+ `src/ui/sidebar/DualCards.tsx`（仅 `tests/unit/ui/dual-cards.test.tsx` 引用）+ 两个专属测试文件（**4 文件**）。
  2. **DT11 一元化**：删除 slot 侧**空串 icon 写入路径** → 统一用 `null`（⚠️**两种空串形态都要覆盖**）：
      - `settings/App.tsx:1296,1317,1341,1447` → **`{ type:'url', value:'' }`**（若 T16 未清）
      - `sidebar/App.tsx:1385` → **`{ type:'upload', value:'' }`**（**注意：不是 `'url'`**，若 T14 未清）
  3. **N12**：`DraftProtectionDialog`/`isDirty` 随 `DualCards.tsx` 删除一并消失（无引用）；**不复活**（见 §Design Contradictions G-5）。
  4. 随删除失效的私有 helper / 未用 import 一并清理（以 `typecheck` + `lint` 为准）。
  5. 单测：`tests/unit/ui/orphan-removal.test.ts`（断言文件不存在 + `rg` 无引用 + `ExportPayload` 不含旧格式）。

  **Must NOT do**:
  - **不得**删除 `IconEditor.tsx`（在用）。
  - **不得**在**读侧**收紧 `''`/`null`/`undefined` 容错（DT11：读侧保留三种容错）。
  - **不得**复活 `DraftProtectionDialog`。

  **Recommended Agent Profile**:
  - **Category**: `quick` — 删除式收尾 + 一元化收口。
  - **Skills**: `lsp-code-analysis`（确认零引用后再删）、`sw-tdd-agent`。

  **Parallelization**:
  - **Can Run In Parallel**: NO（依赖 T14/T15/T16 完成调用点迁移）
  - **Parallel Group**: Wave 3（尾部）
  - **Blocks**: T19
  - **Blocked By**: T14, T15, T16

  **References**:
  - **Pattern References**: `src/ui/settings/RuleEditor.tsx`、`src/ui/sidebar/DualCards.tsx`（`:101,157-168` 的 `DraftProtectionDialog`）、`settings/App.tsx:1296,1317,1341,1447`、`sidebar/App.tsx:1385`（空串路径）。
  - **API/Type References**: `_context-output/designs/2026-10-02-field-chain-sync-architecture-four-surfaces-ui-direction-design.md:238-242`（DT11）、`:205-211`（D-20/N11）、`_context-output/designs/2026-10-02-field-chain-sync-detail-interaction-copy-design.md:122-141`（DT7/N10）。
  - **Test References**: `tests/unit/ui/rule-editor.test.tsx`、`dual-cards.test.tsx`（**将被删除**）。
  - **WHY**: 孤儿测试给出**虚假覆盖率**（① §3）；N10 两套清除表示会让 `FieldEditor` 判定分叉。

  **RED 可构造性说明**:
  - 「`src/ui/settings/RuleEditor.tsx` 不存在」→ 当前存在 → RED。
  - 「`rg "type:'url', value:''|type: 'url', value: ''" src/` → 0」→ 当前有 → RED。

  **Acceptance Criteria**:
  - [ ] 4 个文件（2 组件 + 2 测试）已删除；`rg "RuleEditor|DualCards" src tests` → 0 命中。
  - [ ] `rg "value: ''" src/ui/settings/App.tsx src/ui/sidebar/App.tsx` → 0（slot 空串路径）。
  - [ ] `npm run typecheck` → 0 error；`npm run lint` → delta-0（删除文件会移除既有告警 → delta ≤ 0 可接受，需记录基线）

  **QA Scenarios**:
  ```
  Scenario: 孤儿彻底移除（happy path）
    Tool: Bash
    Steps:
      1. `ls src/ui/settings/RuleEditor.tsx src/ui/sidebar/DualCards.tsx` → 不存在
      2. `rg "RuleEditor|DualCards" src tests` → 0 命中
      3. `npm run typecheck` → 0 error
    Expected Result: 0 引用且编译通过
    Failure Indicators: 文件仍在 / 编译失败
    Evidence: _context-output/evidence/task-18-orphans-happy.txt

  Scenario: 读侧容错未被收紧（failure/edge）
    Tool: Bash (test runner)
    Steps:
      1. 构造 slot.uiMarker.customTitle=''（旧数据）与 icon={type:'url',value:''}
      2. 断言 resolveFieldChain 视其为**未设定**（回落），不抛错
    Expected Result: 读侧仍容错
    Failure Indicators: 抛错 / 视为已设定
    Evidence: _context-output/evidence/task-18-readtolerance-error.txt
  ```

  **Commit**: YES — groups with T16
  - Message: `chore: remove orphan RuleEditor/DualCards and unify slot clear writes to null`
  - Files: `src/ui/settings/RuleEditor.tsx (deleted), src/ui/sidebar/DualCards.tsx (deleted), tests/unit/ui/rule-editor.test.tsx (deleted), tests/unit/ui/dual-cards.test.tsx (deleted), src/ui/settings/App.tsx, src/ui/sidebar/App.tsx`
  - Pre-commit: `npm run typecheck && npm run lint`

---

- [x] **T19. 校验收敛落地 + 既有测试锚点迁移 + 文案修正（E1/E1-a/C7/RK-1/D-a-1）**

  **What to do**:
  1. **删除 UI 侧全部裸 `new RegExp`（实测 5 处）**：`sidebar/App.tsx:617,704`；`settings/App.tsx:467,736,938` → 全部改调 T3 的 `validateRuleForm`/`validateRegex(wildcardToRegex(x).pattern)`。**登记 G-3 偏差**（设计称 4 处，实测 5 处）。
  2. **既有测试锚点迁移**（C7 完全自由重写，逐文件登记类别）：
     | 测试 | 类别 | 处置 |
     |---|---|---|
     | `tests/integration/rule-apply-persistence.test.ts` | **语义保留** | 表示形式适配（共享纯函数） |
     | `tests/unit/background/tab-override-fix.test.ts` | **语义保留** | 投递路径断言重写（走内容脚本） |
     | `tests/unit/background/rule-save-chain.test.ts` | **语义消失** | 含 `manual` 不投递 → 按新语义重写（登记 RK-1） |
     | `tests/integration/rule-delivery-robust.test.ts` | **主备反转** | 断言颠倒（T8 已做） |
     | `tests/unit/shared/url-utils.test.ts:271-301` | **保留** | 排序/冲突矩阵 |
     | `tests/unit/ui/sidebar-slot-tier-display.test.tsx` | **升级** | 锁步测试 → 构造保证（同纯函数） |
     | `tests/unit/ui/rule-editor.test.tsx` / `dual-cards.test.tsx` | **删除** | T18 |
     | `tests/unit/ui/conflict-overwrite.test.ts` / `rule-version-check.test.ts` | **保留** + 补 `conflictingRuleId` 传 UI（E2-a） |
  3. **文案修正（D-a-1，4 处既有不一致）**：`settings:772` `rule created`→`Rule created`；`sidebar:1320` `Global rule created`→`Rule created`；`settings:1450` `icon updated`（清除场景）→`Icon cleared`；`settings:1321,1345` `All items reset`/`Selected items reset`→`All items cleared`/`Selected items cleared`。**并统一冲突文案**（E2-c：`A rule with the same URL already exists`）。
  4. **`conflictingRuleId` 传 UI**（E2-a）：`sidebar:1316` 现只取 `message` → 补取 `conflict`，供「View the existing rule」跳焦（T13）。
  5. **错误归属路由表落地**（E3/E3b）：`sidebar:1323-1326` 失败时**不再** `setToast({variant:'error'})`；`sidebar:793-795` 保留为表单级区；`settings:522-524` 同上（New Rule 补同位置）；内联提示收敛为共享 `FieldError`。
  6. **toast 收窄**：失败不再用 toast；成功 + 批量结果仍用 toast。
  7. 单测：`tests/unit/ui/error-routing.test.tsx`（字段级内联 + 表单级区 + 无失败 toast + 单次播报）。

  **Must NOT do**:
  - **不得**在 UI 保留任何裸 `new RegExp`。
  - **不得**保留「失败时同时写 `saveError` 与全局 toast」的双重告警（① N6）。
  - **不得**在测试里「为了让其通过」放宽断言语义（C7 允许重写判据，但须登记类别）。
  - **不得**改动 `url-utils.test.ts:271-301` 的矩阵语义。

  **Recommended Agent Profile**:
  - **Category**: `deep` — 测试迁移面广 + 文案/错误路由收敛，须逐文件登记。
  - **Skills**: `sw-tdd-agent`、`sw-systematic-debugging`（测试迁移中的失败归类）。

  **Parallelization**:
  - **Can Run In Parallel**: NO（依赖 T18 完成后才稳定文件集）
  - **Parallel Group**: Wave 3（尾部）
  - **Blocks**: T20
  - **Blocked By**: T4, T10, T14, T15, T16, T18

  **References**:
  - **Pattern References**: `sidebar/App.tsx:606-644`（`handleSave` 三处静默 `:607,619,656`）、`:1316-1326`（双重告警 + `conflictingRuleId` 丢失）、`:697-709`（内联校验）；`settings/App.tsx:458-517`（Inline `handleSave`）、`:522-524`（表单级区）、`:725-741`（New Rule `handleSave`）、`:935-943`（内联校验）。
  - **API/Type References**: `_context-output/designs/2026-10-02-field-chain-sync-detail-validation-focus-empty-design.md:84-121`（E1）、`:102-121`（E2 三前提）、`:189-227`（E3/E3b 路由表）、`_context-output/designs/2026-10-02-field-chain-sync-detail-copy-a11y-design.md:19-37`（D-a-1 4 处修正 + 术语统一）。
  - **Test References**: `_context-output/designs/2026-10-02-field-chain-sync-goal-scope-design.md:161-163`（既有测试锚点清单）。
  - **WHY**: E1-a 与错误路由是「实时提示与真实结果相反」「同一错误播报两次」两处实测缺陷的修法；D-a-1 的 4 处不修正会让术语继续分叉。

  **RED 可构造性说明**:
  - 「`rg "new RegExp\(" src/ui/` → 0」→ 当前 5 处 → RED。
  - 「正则非法时**只**出现字段级内联错误，无全局 toast」→ 当前双重（`sidebar:1323-1326`）→ RED。
  - 「`CREATE_RULE` 失败时 UI 收到 `conflictingRuleId`」→ 当前丢 → RED。

  **Acceptance Criteria**:
  - [ ] `rg "new RegExp\(" src/ui/` → **0**。
  - [ ] `rg "rule created|Global rule created|icon updated|items reset" src/ui/` → **0**（已按 D-a-1 修正）。
  - [ ] `tests/unit/ui/error-routing.test.tsx` 新建；ALL PASS；逐文件测试迁移登记表落入 §Commit Strategy 注释。
  - [ ] `npm run test:unit` + `npm run test:integration` → 全绿（迁移后）。

  **QA Scenarios**:
  ```
  Scenario: 错误只内联一次（happy path，修 N6）
    Tool: Bash (test runner)
    Steps:
      1. 提交非法 regex 规则
      2. 断言出现 Match URL 字段内联 role=alert
      3. 断言**无**全局 error toast（queryByRole('alert') 仅命中字段级）
    Expected Result: 单处内联
    Failure Indicators: 同时出现 toast
    Evidence: _context-output/evidence/task-19-single-error-happy.txt

  Scenario: 冲突提示含跳转链接（failure/edge）
    Tool: Bash (test runner)
    Steps:
      1. 提交同 URL 规则触发 RULE_CONFLICT_BLOCK
      2. 断言 Match URL 内联文案 === 'A rule with the same URL already exists'
      3. 断言存在 'View the existing rule' 入口且点击触发 jumpTo(conflictingRuleId)
    Expected Result: 统一文案 + 跳焦可用
    Failure Indicators: 文案为两条旧句 / 无跳转
    Evidence: _context-output/evidence/task-19-conflict-routing-error.txt
  ```

  **Commit**: YES — standalone
  - Message: `refactor(ui): converge validation, route errors inline, migrate legacy test anchors`
  - Files: `src/ui/sidebar/App.tsx, src/ui/settings/App.tsx, tests/unit/ui/error-routing.test.tsx, tests/**`
  - Pre-commit: `npm run typecheck && npm run lint && npm run test:unit`

---

### Wave 4 — 集成波（端到端一致 + 工程门禁）

- [x] **T20. 三视图 = 投递值 端到端一致测试（SC1/SC2 + RK-1 缓解）**

  **What to do**:
  1. 新建 `tests/integration/field-chain-three-views.test.ts`：对同一 `{sync, local, tabId, tabUrl}` 快照，断言：
     - `field-chain.resolveFieldChain`（UI 侧计算）的 `winner.value` **等于** background 实际投递的 `FIELD_APPLY` 指令值（「视图显示值 = 实际投递值」构造保证 → 升级 `sidebar-slot-tier-display` 的锁步测试）；
     - title 与 icon **各一条独立链**，互不干扰（改 title 不动 icon 链，反之亦然）。
  2. 新建 `tests/integration/field-chain-parity.test.ts`（**RK-1 前后等价对照**）：对 title/icon 两条链，用一组**固定输入矩阵**（4 tier × 设置/未设置 × priority 并列），断言新 `field-chain` 与旧 `computeFieldsFrom`（**测试内联旧算法副本**，取自 HEAD `a3d6ab3`）在**除有意变更外**的一致：
     - 有意变更（须显式白名单，不得默默放行）：① `mode='manual'` 不再过滤（Q11）；② favicon 非法协议**每个 tier 都校验**（现状已如此，确认不漂移）；③ `site` 节点新增（旧算法无）。
  3. **三浏览器 build 门禁**：`npm run build:chrome && npm run build:edge && npm run build:firefox`（FINAL 前置）。
  4. 证据落 `_context-output/evidence/task-20-*`。

  **Must NOT do**:
  - **不得**只测一个视图（须三视图 + 投递四方对齐）。
  - **不得**在等价对照里放宽断言以掩盖漂移（有意的变更须**白名单显式列出**）。
  - **不得**引入 Playwright 依赖（不新增 npm 依赖；用 `@testing-library` + mock adapter）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — 端到端一致性 + 前后等价，是本迭代证据最强的收口。
  - **Skills**: `sw-tdd-agent`、`sw-verification-before-completion`。

  **Parallelization**:
  - **Can Run In Parallel**: NO（集成波）
  - **Parallel Group**: Wave 4
  - **Blocks**: F1-F4
  - **Blocked By**: T14, T15, T16, T17, T19

  **References**:
  - **Pattern References**: `tests/integration/rule-apply-persistence.test.ts`（链的权威证据）、`tests/unit/ui/sidebar-slot-tier-display.test.tsx`（原锁步测试，将被升级）、`tests/integration/full-suite.test.ts`。
  - **API/Type References**: `src/shared/field-chain.ts`（T1）、`src/background/field-delivery-service.ts`（T7）、`src/shared/messages.ts`（`FIELD_APPLY`，T4/T8）。
  - **Test References**: `git show a3d6ab3:src/background/rule-service.ts:345-406`（旧算法副本来源，**只读**）。
  - **WHY**: SC1 的判据正是「三视图与 background 投递值一致（同一纯函数，构造保证）」；RK-1 的缓解措施明确要求「链优先级前后等价对照用例（title/icon 各一组）」。

  **RED 可构造性说明**:
  - 「UI 计算的 winner 与投递指令不同」→ 若 UI 仍手抄链则**必然不同**（在 T14/T15 完成前）→ RED（可用 `git stash` 回到手抄版验证 RED 有效）。
  - 「改 title 后 icon 链不变」→ 若实现复用单链则失败。
  - 「旧算法副本 vs 新算法在非白名单输入上一致」→ 若引入未登记漂移则失败。

  **Acceptance Criteria**:
  - [ ] `field-chain-three-views.test.ts` + `field-chain-parity.test.ts` 新建；ALL PASS。
  - [ ] `npm run build:chrome && npm run build:edge && npm run build:firefox` → 三浏览器均成功。
  - [ ] `npm run test:unit && npm run test:integration && npm run test:ui-smoke` → 全绿。

  **QA Scenarios**:
  ```
  Scenario: 三视图与投递值一致（happy path，SC1）
    Tool: Bash (test runner)
    Steps:
      1. 构造快照（override=null, slot='S', rule='R'）→ UI 计算 winner='S'
      2. 触发 recomputeAndRedeliver([tabId])，捕获 FIELD_APPLY 指令
      3. 断言指令 title.value === 'S' === UI winner
    Expected Result: 四方一致
    Failure Indicators: 任一不一致
    Evidence: _context-output/evidence/task-20-three-views-happy.txt

  Scenario: 前后等价对照发现漂移（failure/edge）
    Tool: Bash (test runner)
    Steps:
      1. 修改新 field-chain 让某 tier 多跳过一次（注入临时 bug）
      2. 运行 parity 测试 → 断言**失败**（说明对照有效）
      3. 还原后重新通过
    Expected Result: 对照能捕捉漂移
    Failure Indicators: 注入 bug 后仍通过（对照无效）
    Evidence: _context-output/evidence/task-20-parity-error.txt
  ```

  **Commit**: YES — standalone
  - Message: `test(integration): three-view parity + chain before/after equivalence (RK-1)`
  - Files: `tests/integration/field-chain-three-views.test.ts, tests/integration/field-chain-parity.test.ts`
  - Pre-commit: `npm run test:unit && npm run test:integration && npm run build:chrome`

---

- [x] **T21. 工程门禁收口（lint delta-0 / CJK 守卫 / token 唯一源）**

  **What to do**:
  1. 运行 `npm run lint` → 记录 delta（vs 基线；**不放宽配置、不新增 `eslint-disable`**）；修复本迭代**新增**的告警至 delta-0。
  2. 运行 `tests/unit/ui/no-cjk-in-ui.test.tsx`（`src/ui` CJK 0）→ PASS。
  3. 反例搜索核对：
     - `rg "new RegExp\(" src/ui/` → 0
     - `rg "mode === 'auto'|mode === 'manual'|APPLY_RULE_TO_TAB|GET_CANDIDATES" src/` → 0
     - `rg "#[0-9A-Fa-f]{6}" src/ui/styles/settings.css` → 仅既有（无新增硬编码色）
     - `rg "\-\-tbs-" src/ui/styles src/ui/**/*.css` → 只应命中 `tokens.css`/`base.css` 中**既有** `--tbs-` 类名（`tbs-` 前缀类名允许；`--tbs-*` 自定义属性应 0）
  4. 运行 `npm run typecheck` → 0 error。
  5. 证据落 `_context-output/evidence/task-21-*`。

  **Must NOT do**:
  - **不得**放宽 `eslint.config.mjs` 或新增 `eslint-disable` 来达成 delta-0。
  - **不得**用 `// eslint-disable-next-line` 绕过。
  - **不得**保留任何硬编码颜色（用 token）。

  **Recommended Agent Profile**:
  - **Category**: `quick` — 门禁执行与核对。
  - **Skills**: `sw-lint-checker`、`sw-verification-before-completion`。

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 T20 并行）
  - **Parallel Group**: Wave 4
  - **Blocks**: F1-F4
  - **Blocked By**: T12, T18, T19

  **References**:
  - **Pattern References**: `package.json`（`lint`/`typecheck`/`build:*` 脚本）、`eslint.config.mjs`（严格度，**不得放宽**）。
  - **API/Type References**: `tests/unit/ui/no-cjk-in-ui.test.tsx`（守卫）。
  - **WHY**: C8 的判据是 **lint delta-0**（不是绝对 0）；必须与基线（HEAD `a3d6ab3`）对比而非与 0 对比。

  **RED 可构造性说明**:
  - 「lint delta > 0」→ 若本迭代新增告警 → 门禁失败（RED）。
  - 「`rg "new RegExp\(" src/ui/` 命中」→ RED。

  **Acceptance Criteria**:
  - [ ] `npm run lint` → delta ≤ 0（记录基线与当前计数）。
  - [ ] `npm run typecheck` → 0 error。
  - [ ] 反例搜索 4 条全部为 0 / 无新增。

  **QA Scenarios**:
  ```
  Scenario: lint delta-0（happy path）
    Tool: Bash
    Steps:
      1. `git stash` 到 HEAD a3d6ab3 → `npm run lint 2>&1 | tail -1` 记录基线
      2. 回到工作区 → `npm run lint 2>&1 | tail -1`
      3. 断言 当前告警数 ≤ 基线
    Expected Result: delta ≤ 0
    Failure Indicators: 告警增加
    Evidence: _context-output/evidence/task-21-lint-delta-happy.txt

  Scenario: 反例搜索（failure/edge）
    Tool: Bash
    Steps:
      1. `rg "new RegExp\(" src/ui/` → 断言无输出
      2. `rg "APPLY_RULE_TO_TAB|GET_CANDIDATES" src/` → 断言无输出
    Expected Result: 均无输出
    Failure Indicators: 有命中
    Evidence: _context-output/evidence/task-21-reverse-search-error.txt
  ```

  **Commit**: NO（并入 T20 的 FINAL 前置）
  - Message: `chore: enforce lint delta-0, CJK guard, token single-source`

---

## Final Verification Wave (MANDATORY — ALL 实现任务后)

> 4 个审查 Agent **并行**执行；全部必须 PASS。汇总结果交用户并获显式 "okay" 后才标记完成。
> **不得**在获得用户 okay 前勾选 F1-F4。拒绝或反馈 → 修复 → 重跑 → 再次呈报 → 等 okay。
> **强制独立复验（不采信执行者自审）**——见主 Agent 交接摘要的核心约束。

- [ ] **F1. Plan Compliance Audit**（recommended: `oracle` / strategic review profile）

  端到端读本计划后执行：
  - **Must Have 验证**：逐条验证实现存在（读文件 / `rg` / 跑命令）。
  - **Must NOT Have 验证**：`rg` 搜索禁止模式，带 `file:line` 拒绝：
    - `rg "permission|host_permission" manifests/` 与 HEAD 对比（**零扩张**）
    - `rg "APPLY_RULE_TO_TAB|GET_CANDIDATES|\bmode === 'auto'|\bmode === 'manual'" src/` → 0
    - `rg "eslint-disable" src/` → 与基线一致（无新增）
    - `rg "Toast.action|action={" src/ui/` → 无新增使用（撤销走 `UndoBar`）
  - **证据验证**：检查 `_context-output/evidence/` 中 task-1..task-21 的证据文件存在。
  - **交付物验证**：对照 Concrete Deliverables 清单与实际实现。

  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | Evidence [N/N] | VERDICT: APPROVE/REJECT`

- [ ] **F2. Code Quality Review**（recommended: `unspecified-high` profile）

  - **Build**: `npm run build:chrome && npm run build:edge && npm run build:firefox` → 三者 0 error。
  - **Lint**: `npm run lint` → delta ≤ 0。
  - **Tests**: `npm run test:unit && npm run test:integration && npm run test:ui-smoke` → ALL PASS。
  - **Code patterns**: 检查 `as any`/`@ts-ignore`/空 catch/`console.log`（生产）/注释掉的代码/未用 import。
  - **AI slop 检测**: 过度注释、过度抽象（如为未裁决 `FormScene` 建模块，见 G-2）、泛化命名（`data/result/item/temp`）。
  - **专项**: `.tbs-dialog__header/footer` sticky 生效；`tokens.css` 为唯一 token 源；无硬编码色。

  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT: APPROVE/REJECT`

- [ ] **F3. Real Manual QA**（recommended: `unspecified-high` + browser skill）

  从干净状态起，执行**每个任务**的每条 QA 场景：
  - **逐场景执行**：按 exact steps，捕获证据。
  - **集成测试**：跨任务协同（如 侧边栏 Clear → Dashboard 链重算 → 跳焦到 Rules 行）。
  - **边界**：空态 / 非法输入 / 连续快速操作 / 多行同开草稿 / 受保护页。
  - **WCAG 2.1 AA 复核**（本计划硬要求）：新增控件（`RadioGroup`/`Confirm`/`UndoBar`/跳焦/`EmptyState`）**可键盘操作 + 可见焦点 + 非仅颜色**；`axe` 断言或等价 `@testing-library` 断言；`reduced-motion` 下跳焦**保留高亮**。
  - **证据**：落 `_context-output/evidence/final-qa/`。

  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | WCAG [AA PASS/FAIL] | VERDICT: APPROVE/REJECT`

- [ ] **F4. Scope Fidelity Check**（recommended: `deep` profile）

  逐任务核对实现与规格一致：
  - **Spec-Implementation Mapping**：读每任务 "What to do"，读实际 diff（`git diff`），验证 1:1。
  - **完整性**：规格内的全部已建（无缺失功能）。
  - **反膨胀**：无规格外新增（尤其无未裁决抽象、无第二套撤销 UI、无脏点/汇总条）。
  - **Must NOT Do 合规**：逐任务核对。
  - **跨任务污染**：检测 Task N 触及 Task M 的文件。
  - **未记账变更**：标记任何未列入任何任务的修改文件。
  - **专项**：确认**链只有一份实现**（`rg "state.sync.rules.filter|type === 'auto'" src/ui/` → 0；UI 只调 `field-chain`）。

  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT: APPROVE/REJECT`

---

## 登记风险（来自 YAML，必须携带）

> 以下 4 项**进入计划**，执行者/审查者须知；缓解措施已落具体任务。

| ID | 风险 | 缓解（落地任务） |
|---|---|---|
| **RK-1** | 解析语义与投递协议同改 → 行为漂移失去完整证据 | T1（`field-chain` 穷举单测）+ T20（前后等价对照 + 三视图一致性）+ C7 测试迁移逐文件登记（T19） |
| **RK-2** | `normalizeUrl` 尾斜杠等同使**匹配面静默变宽** = 已发布匹配语义变更 | T2（前后对照单测；4 个消费者影响面在 References 登记） |
| **RK-3** | `Clear` 免确认 + 5s `UndoBar` 过期 ⇒ **全局配置（`slot.uiMarker`/`rule.title`）不可逆丢失** | T11 + T16（预览**默认展开** + 以「将被删除的全局配置」为**第一信息**）；T20 证据 |
| **RK-4** | 多行草稿**无未保存指示**（IMP-19 已接受，无缓解）⇒ 静默丢失 | T16（仅保留每行 `Save.disabled`，**须由本行 dirty 真实驱动**） |

---

## Commit Strategy

> 每个提交须保持 **typecheck 0**（含 `tests/` 编译面，见 Research #20）。

```
Commit 1: feat(shared): add field-chain as single source of truth
  Files: src/shared/field-chain.ts, tests/unit/shared/field-chain.test.ts
  Pre-commit: npm run typecheck && npm run lint

Commit 2: fix(shared): treat trailing slash as equivalent in normalizeUrl
  Files: src/shared/url-utils.ts, tests/unit/shared/normalize-url-trailing-slash.test.ts
  Pre-commit: npm run typecheck && npm run lint

Commit 3: feat(shared): shared form validation reusing backend primitives
  Files: src/shared/form-validation.ts, tests/unit/shared/form-validation.test.ts
  Pre-commit: npm run typecheck && npm run lint

Commit 4: refactor(contract): drop mode/APPLY_RULE_TO_TAB/GET_CANDIDATES; add FIELD_APPLY
  Files: src/shared/types.ts, src/shared/messages.ts, src/background/worker-orchestrator.ts,
         src/ui/shared/message-client.ts, tests/unit/background/known-actions.test.ts
  Pre-commit: npm run typecheck && npm run lint

Commit 5: feat(background): strictly-sealed siteSnapshot store in local
  Files: src/background/site-snapshot-store.ts, src/shared/types.ts,
         tests/unit/background/site-snapshot-store.test.ts
  Pre-commit: npm run typecheck && npm run lint

Commit 6: feat(ui): shared RadioGroup, EmptyState, useExpandRow
  Files: src/ui/shared/{radio-group,empty-state,use-expand-row}.*,
         tests/unit/ui/{radio-group,empty-state,use-expand-row}.test.tsx
  Pre-commit: npm run typecheck && npm run lint

Commit 7: feat(background): FieldDeliveryService + FIELD_APPLY protocol + content-script ownership
  Files: src/background/field-delivery-service.ts, src/background/worker-orchestrator.ts,
         src/background/apply-fields.ts, src/content/index.ts, src/shared/messages.ts,
         tests/unit/background/field-delivery-service.test.ts,
         tests/unit/content/content-script.test.ts, tests/integration/rule-delivery-robust.test.ts
  Pre-commit: npm run typecheck && npm run lint && npm run test:integration

Commit 8: refactor(background): centralize isProtectedUrl; drop force
  Files: src/background/worker-orchestrator.ts, src/background/apply-fields.ts, src/content/index.ts,
         tests/unit/background/protected-delivery.test.ts
  Pre-commit: npm run typecheck && npm run lint

Commit 9: feat(ui): shared RuleFormFields + FieldEditor + generalized UndoBar
  Files: src/ui/shared/{rule-form-fields,field-editor,undo-bar}.*,
         tests/unit/ui/{rule-form-fields,field-editor,undo-bar}.test.tsx
  Pre-commit: npm run typecheck && npm run lint

Commit 10: chore(styles): remove dead --tbs-* layer; dialog sticky header/footer
  Files: src/ui/styles/base.css, src/ui/shared/global.css (del), src/ui/sidebar/sidebar.css (del),
         tests/unit/ui/dialog-sticky.test.tsx
  Pre-commit: npm run typecheck && npm run build:chrome

Commit 11: feat(ui): jump-to-row with fallback chain + announcements
  Files: src/ui/shared/use-jump-to-row.ts, src/ui/styles/settings.css,
         tests/unit/ui/use-jump-to-row.test.tsx
  Pre-commit: npm run typecheck && npm run lint

Commit 12: feat(sidebar): reuse RuleFormFields; chain-derived prefill; drop mode
  Files: src/ui/sidebar/App.tsx, tests/unit/ui/sidebar-modality.test.tsx
  Pre-commit: npm run typecheck && npm run lint

Commit 13: feat(settings): rewrite Rules table (7 cols) + confirmations + empty states
  Files: src/ui/settings/App.tsx, tests/unit/ui/rules-table.test.tsx
  Pre-commit: npm run typecheck && npm run lint

Commit 14: feat(settings): rewrite Dashboard (DashboardRow, inline edit, delivery)
  Files: src/ui/settings/App.tsx, src/background/worker-orchestrator.ts,
         tests/unit/ui/dashboard.test.tsx
  Pre-commit: npm run typecheck && npm run lint

Commit 15: a11y: Confirm/UndoBar focus + aria-describedby + announcements
  Files: src/ui/shared/components.tsx, src/ui/shared/undo-bar.tsx,
         tests/unit/ui/a11y-confirm-undo.test.tsx
  Pre-commit: npm run typecheck && npm run lint

Commit 16: chore: remove orphan RuleEditor/DualCards; unify slot clear to null
  Files: src/ui/settings/RuleEditor.tsx (del), src/ui/sidebar/DualCards.tsx (del),
         tests/unit/ui/rule-editor.test.tsx (del), tests/unit/ui/dual-cards.test.tsx (del),
         src/ui/settings/App.tsx, src/ui/sidebar/App.tsx
  Pre-commit: npm run typecheck && npm run lint

Commit 17: refactor(ui): converge validation, inline error routing, migrate test anchors
  Files: src/ui/sidebar/App.tsx, src/ui/settings/App.tsx, tests/unit/ui/error-routing.test.tsx,
         tests/**（迁移文件，逐文件登记类别）
  Pre-commit: npm run typecheck && npm run lint && npm run test:unit

Commit 18: test(integration): three-view parity + chain before/after equivalence (RK-1)
  Files: tests/integration/field-chain-three-views.test.ts,
         tests/integration/field-chain-parity.test.ts
  Pre-commit: npm run test:unit && npm run test:integration && npm run build:chrome
```

---

## Success Criteria

### Verification Commands

```bash
# typecheck 0
npm run typecheck                          # Expected: 0 error

# lint delta-0（与 HEAD a3d6ab3 对比）
npm run lint                               # Expected: 告警数 ≤ 基线

# 全部测试
npm run test:unit                          # Expected: ALL PASS
npm run test:integration                   # Expected: ALL PASS
npm run test:ui-smoke                      # Expected: ALL PASS

# 三浏览器 build
npm run build:chrome && npm run build:edge && npm run build:firefox   # Expected: 均成功

# 反例搜索（全部期望 0 命中）
rg "new RegExp\(" src/ui/
rg "mode === 'auto'|mode === 'manual'|APPLY_RULE_TO_TAB|GET_CANDIDATES" src/
rg "RuleEditor|DualCards" src tests
rg "type: 'url', value: ''" src/ui/
```

### Final Checklist

- [x] All "Must Have" present
- [x] All "Must NOT Have" absent（含权限零扩张 / 无新增依赖 / 无新增 eslint-disable）
- [x] All tasks completed (21/21)
- [x] All tests pass（unit + integration + ui-smoke）
- [x] All QA scenarios executed with evidence（`_context-output/evidence/`）
- [x] All Final Verification reviews APPROVED（F1-F4）
- [x] WCAG 2.1 AA 复核通过
- [ ] User explicitly approved completion
- [x] 登记风险 RK-1..RK-4 已随计划携带（见 §登记风险）
- [x] 计划层默认 D-1/D-2/D-3 已获用户确认或覆盖