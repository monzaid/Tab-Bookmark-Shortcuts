# UI/UX Remediation — Experience Defect Fix Plan for Tab Bookmark Shortcuts

> **计划名称**: ui-ux-remediation-plan
> **创建时间**: 2026-09-29
> **创建者**: sw-strategic-planner (Prometheus)
> **状态**: Draft **v3** — 在 v2 基础上，按 `sw-plan-reviewer` **定向** High Accuracy Review 结论（(a)(b) 已闭合；(c) 中 U9 存在 1 个 blocker）就地修订：闭合 **1 个 blocker**（BLK-U9：U9 断言未真正与 U1 解耦）+ 3 项 nit（N7/N8/N9）（见 Revision Log v3）；v2 已闭合 3 个 blocker + 6 项 nit，回写 5 项已裁决 Decisions，并修正 2 处引用漂移（见 Revision Log v2）
> **计划文件路径**: `_context-output/plans/2026-09-29-ui-ux-remediation-plan.md`
> **Evidence 目录**: `_context-output/evidence/`
> **与既有计划的关系**: 本计划是**独立的 UI/UX 层计划**，与已验收的代码层计划 `2026-09-28-fix-roadmap-plan.md`（B1–B14 + T1–T37）**无重叠、不混编**。B1–B14 属后台/存储/安全域；本计划只处理 12 项 UI/UX 体验缺陷（P1–P12）。
> **修订基线（本次实测）**: `unit` = **398 tests / 36 files**；`integration` = **170 tests / 16 files**；`ui-smoke` = **6 tests / 1 file**（均为干净树实跑结果，非引用）。

---

## Revision Log (v2)

> 本节逐条记录 v2 相对 v1 的全部修订，供 `sw-plan-reviewer` 复核与执行者追溯。**所有引用真实性均经规划者独立复核**（读文件 + `rg` 全仓检索 + 实跑），不依赖问题清单或 v1 自述。

### A. Blocker 闭合（3/3）

| ID | v1 缺陷 | 复核证据（规划者独立确认） | v2 修订 | 落点 |
|----|---------|--------------------------|---------|------|
| **B1** | U1 删除清单**遗漏** `recovery-selector.test.tsx:5` 的 `import type { TabCandidate }` | `tsconfig.json` 启用 `"noUnusedLocals": true`；该 import 在 `:77`/`:187` 两处 `candidates: TabCandidate[]` 注解中使用——两个 Candidate describe 删除后即**无引用** → TS6133 | U1 删除步骤补「同步移除 `:5` 的 `import type { TabCandidate }`」；U1 acceptance 新增 `npm run typecheck` 出口校验 | TL;DR / U1 What-to-do·Acceptance / Research #6 / Commit 1 |
| **B2** | 用例计数 **6/5 实为 7/6**；错误判据「→ ALL PASS（5 用例）」诱导**误删受保护 Recovery 用例** | 实测：candidate 相关 `it` = **7**（`:83/:101/:116/:132/:156/:174/:186`）；Recovery 相关 `it` = **6**（`:18/:25/:31/:37/:43/:51`）；文件为 Recovery+Candidate **混合文件** | 全部计数改 **candidate=7 / Recovery=6**；U1 acceptance/GE5 统一表述为「外科式删除 `:76-202` 两个 describe（含 7 个 `it`），保留 `Recovery window` 两个 describe（6 个 `it`）」；**删除所有「（5 用例）」错误表述** | TL;DR / Research #6 / U1 全部计数点 / U1 Acceptance / GE5 / Commit 1 |
| **B3** | P9/GE2 的 VERSION_CONFLICT 文案**误引** `RuleEditor.tsx:323` | 全仓 `rg '规则已被其他操作修改'` → **唯一命中 `src/ui/settings/App.tsx:323`**，宿主为 `settings/App.tsx:246` 的 `InlineRuleEditor`；`RuleEditor.tsx:323` 实为 `</section>`（其真实锚点是 `:298` 的 `Delete Rule`） | 所有 `RuleEditor.tsx:323` / `:321-325` 引用**全部更正为 `settings/App.tsx:323`（宿主 `InlineRuleEditor`）**；Deliverables 与 Commit 8 文件清单同步更正（删 `RuleEditor.tsx`、改 `settings/App.tsx`）；GE2 锚点仍为 `inline-rule-editor.test.tsx:222`（该锚点正确） | Deliverables / U8 What-to-do·References / Commit 8 / F4 说明 |

### B. Nit 闭合（6/6）

| # | v1 缺陷 | v2 修订 | 落点 |
|---|---------|---------|------|
| **N1** | GE1 允许列仅写 `:80`，遗漏 `clickReset()` 内 `:82` 的同名定位串 | GE1 允许列**显式写出 `:80` 与 `:82` 两处**（`getByRole('menuitem', {name:'Reset'})` 出现两次：一次断言、一次点击） | Guardrail Exceptions → GE1 |
| **N2** | U9 断言 `candidate-selector` 目录不存在 → 与 U1 形成**跨任务断言耦合**（同 Wave 并行时 U9 可能先于 U1 失败） | **解耦**（⚠️ **v3 补充落实**：v2 声称的「动态枚举现存入口页 + `src/ui` 全目录 0 命中」**仍未真正解耦**——动态枚举与全目录扫描**均会覆盖**归 U1 删除的 `candidate-selector/index.html`，与「U9 不删该文件」自相矛盾，构成 v3 Blocker BLK-U9）。**v3 最终落实为固定白名单**：U9 只断言「`sidebar`/`settings`/`recovery`/`import-preview`/`conflict-confirm` **五个** 白名单入口页均 `lang="en"` 且不含 `zh-CN`」；「目录不存在」由 **U1 守卫测试** 独占；「全仓无 `zh-CN`/CJK」由 **U8 的 `no-cjk-in-ui.test.tsx`** 兜底 | U9 What-to-do·Acceptance·QA / U1 Acceptance / Dependency Matrix / Risks R3c |
| **N3** | U1 未声明后台边界，执行者可能越界删除后台 action/type | U1 补边界声明：「**仅删页**；后台 `GET_CANDIDATES`（`worker-orchestrator.ts:648-654`）与 `message-client.ts:297-299` 的 `getCandidates` **保留**（属后台域，不在本计划范围）」 | U1 Must-NOT-do |
| **N4** | U7 未显式登记 Dialog 迁移的既有定位回归点 | U7 acceptance **显式列出**回归检查点：`slot-add-to-global.test.tsx` 经 `getByLabelText('Match URL')`（`:94`）与 `name:'Save'`（`:144`）定位；迁 `Dialog` 后模态新增 `Close dialog`、标题 `h3`→`h2`、Save 移入 footer，上述定位仍成立（已复核：**无标题/按钮数量断言**） | U7 Acceptance |
| **N5** | P5 数量错误（称 4 个入口页），实为 **6 个**；且 P10 采纳删除后口径未说明 | P5/P9 计数更正为 **6 个** `lang="zh-CN"` 入口页（实测 `rg` = 6：`sidebar`/`settings`/`import-preview`/`candidate-selector`/`conflict-confirm`/`recovery`）；因 P10 删除 → `candidate-selector/index.html` 随 U1 移除 → U9 改「**U1 完成后仍存在的全部入口页**」（删除后 = 5 个）⚠️ **v3 更正**：该「动态口径」因**覆盖候选页**而未真正解耦，现改为**固定白名单 5 个**（见 v3 Blocker BLK-U9） | TL;DR / Research #5 / U9 What-to-do·References·QA |
| **N6** | U4 正面确认（hashchange 监听、`resolveSectionFromHash` 纯函数、jsdom 可达性） | **保留不动**（复核确认正确：`open-page.ts:44-50` 确为 hash-only 导航；`src/ui/**` 内 `location.hash`/`hashchange` = 0 命中，RED 成立） | U4（未改动，仅记录） |

### C. 5 项已裁决 Decisions 回写（从 Decisions Needed → Decisions Resolved in v2）

| # | 决策 | 最终裁决（用户） | 影响面（哪些任务因此无歧义 / 哪些 acceptance 收紧） |
|---|------|-----------------|------------------------------------------------|
| **1** | 语种定调 | **EN**（界面统一英文；`index.html` 的 `lang` 改 `en`；`sidebar/App.tsx:585`、`settings/App.tsx:323` 等 CJK 漂移一并英文化） | U8/U9 从「待裁决」变**无歧义**；P9 边界由「混排消除」**扩展为「全部 CJK 漂移英文化」**（含 `settings/App.tsx:141,151,161,187-190` 整段中文与 `settings/App.tsx:95`）；U8 acceptance 收紧为「`src/ui/**` 中 12 行 CJK 全部消除」；U9 acceptance 收紧为「**5 个固定白名单入口页** `lang="en"`」（⚠️ v3 更正：不再用「全部现存入口页 + `src/ui` 无 `zh-CN`」口径 —— 见 BLK-U9） |
| **2** | P10 `candidate-selector` | **删除** | U1 无歧义（不再有「补齐」分支）；U1 acceptance 收紧为「三浏览器构建 + 冒烟 5 + `typecheck` 0 error + 全仓 0 命中」；`vite.config.ts` 入口 8 → 7 |
| **3** | P2 删除路径可撤销 | **不做**（保持范围保真；只加二次确认，不新增后台 action） | U5 无歧义（备选 A 移入「若用户另行授权则独立立项」）；U5 acceptance 只验「Confirm 前置 + 文案统一」，**不验撤销**；护栏「不新增后台 action」保持硬约束 |
| **4** | `IconEditor.tsx` 两处中文 | **一并英文化** | U8 范围收紧：`src/ui/components/IconEditor.tsx:242`/`:287` 的 CJK **必须**改英文（否则 P9 未彻底闭环）；U8 acceptance 增列该两点；已复核**无测试锁定**这两处 |
| **5** | `settings/App.tsx:323` 中文（受 `inline-rule-editor.test.tsx:222` 锁定） | **改** | U8 无歧义（不再是 conditional）；**GE2 从「条件生效」改为「确定生效」**，`inline-rule-editor.test.tsx:222` 定位串必须同步更新（判据结构 `toHaveTextContent` 不放宽） |

### D. 规划者独立复核发现的**新增引用漂移**（NEW）

| ID | 漂移 | 证据 | 修订 |
|----|------|------|------|
| **NEW-D1** | v1 正文 4 处引用「GE1/GE2/**GE3** 三类」，但 Guardrail Exceptions 表**只有 GE1/GE2/GE4/GE5，无 GE3** | 表定义与正文互相矛盾 | **定义 GE3**（补上缺口）：`tests/unit/ui/{settings,sidebar-open-page,sidebar-regex-display}.test.tsx` 的**纯追加**新用例例外（仅允许 append 新 `it`，禁止改动/删除既有断言）。正文统一改为「GE1–GE5 五类」 |
| **NEW-D2** | `IconEditor.tsx` 路径漂移：v1 多处写作裸 `IconEditor.tsx`，实际位于 **`src/ui/components/IconEditor.tsx`**（非 `src/ui/shared/`）；且 Research #8 称 CJK「仅 9 处」实为 **12 行** | `rg 'IconEditor'` → `@ui/components/IconEditor`（`sidebar/App.tsx:433`、`settings/App.tsx:14`）；CJK 实测 = settings 9 行 + sidebar 1 行 + IconEditor 2 行 = **12 行** | 全部 IconEditor 引用补全为 `src/ui/components/IconEditor.tsx`；Research #8 计数更正为 12 行并列出完整清单 |

### E. v2 自证结论（摘要）

- **3 blocker 全部闭环**：B1（typecheck 门禁可达）、B2（计数 7/6 与误删风险消除）、B3（引用真实化）——均附独立复核证据。
- **U1/U8/U9 抽查**：RED 可构造 ✅（守卫测试在删除前必失败 / CJK 存在即失败 / `lang="zh-CN"` 即失败）；验收可达成 ✅（含 `typecheck`/构建/冒烟/静态断言）；引用真实 ✅（全部锚点已读原文件确认）。
- **门禁用例数预期（v2）**：见「Success Criteria → 修订后门禁用例数预期」。
- **前置决策阻塞**：**已全部解除**（0 个任务被前置决策阻塞）——见「Decisions Resolved in v2」末注。

---

## Revision Log (v3)

> 本节逐条记录 v3 相对 v2 的修订。来源：`sw-plan-reviewer` **定向** High Accuracy Review 结论 —— **(a)(b) 已闭合；(c) 中 U9 存在 1 个 blocker**。本轮回写 **1 个 blocker + 3 项 nit**，并同步修正 Dependency Matrix、Wave 1 并行度声明、Risks、Final Checklist、Success Criteria 门禁预期。**所有事实均经规划者独立复核**（重跑 `rg` + 读原文）。

### A. Blocker 闭合（1/1）

| ID | v2 缺陷（自相矛盾） | 复核证据（规划者独立确认） | v3 修订 | 落点 |
|----|--------------------|--------------------------|---------|------|
| **BLK-U9** | 计划声称 U9「**已与 U1 解耦、不依赖 U1**」，但断言与操作范围**自相矛盾**：② 断言 `src/ui` **全目录** `rg 'lang="zh-CN"'` = **0 命中**（该覆盖面**包含**归 U1 删除的 `candidate-selector/index.html`），同时 `:1119` 又声明「**不删除** `candidate-selector/index.html`」——二者直接冲突；且 `:1146`「acceptance 不依赖 U1」在 **U1 完成前不可达**（动态枚举会含候选页 → 「每个均 `lang=en`」必失败；全目录扫描亦命中候选页 → 「=0」必失败） | 实测 `src/ui/candidate-selector/index.html:2` = `<html lang="zh-CN">`（`rg 'lang="zh-CN"' src` = **6 命中**，含该文件）→ 该文件**仅在 U1 完成时**才消失。故 v2 的 U9 断言在 U1 前**必红**，与「不依赖 U1」相反 | **采用推荐方案（固定白名单）**：① 将 `page-lang.test.tsx` 断言**限定为 U9 负责的固定白名单**= `sidebar`/`settings`/`recovery`/`import-preview`/`conflict-confirm` **五个** `index.html` 均含 `lang="en"` 且不含 `lang="zh-CN"`；② **删除**「`src/ui` 全目录 0 命中 `zh-CN`」这条断言（该职责移交：目录不存在 → U1 守卫测试；全仓无 CJK/无 `zh-CN` 兜底 → U8 的 `no-cjk-in-ui.test.tsx`）；③ 同步修正 `:1109`/`:1112`/`:1114`/`:1146`/`:1157` + Dependency Matrix `:283` 的措辞与期望值，使全文自洽 | U9 What-to-do·Acceptance·QA / Dependency Matrix / Risks R3c / Success Criteria / Final Checklist |

### B. Nit 闭合（3/3）

| # | v2 缺陷 | v3 修订 | 落点 |
|---|---------|---------|------|
| **N7** | 门禁用例数预期表写 unit「≈ 42 files」，但本轮新增测试文件实为 **9 个** → 36+9 = **45 files** | files 预期改为 **45**（`≈ 421–430 tests / **45 files**`），并标注「**精确值以实跑为准；新增文件 9 个**」（`candidate-selector-removed` / `settings-loading-states` / `conflict-confirm-default-safe` / `settings-deeplink` / `sidebar-slot-menu-delete` / `sidebar-error-state` / `sidebar-modal-a11y` / `page-lang` / `no-cjk-in-ui`） | Success Criteria → 门禁用例数预期表 |
| **N8** | `BP1–BP5` 定义后正文**零引用**，产生「定义未引用」的悬空感 | 在 Final Verification 的 F1 中**至少引用一次对应编号**（BP1/BP4），并明确标注「**BP1–BP5 为阻塞点索引表，供执行者按需查证**」；不逐条引用 | Blocking Points 说明 + F1 Must-Have verification |
| **N9** | 文档提及未纳入（`README.md:101`、`RELEASE_CANDIDATE.md:83` 亦提及 `candidate-selector`），执行者可能困惑 | **明确声明**：「**文档提及不在 U1 范围内**」——F1 核对作用域为 `src` / `vite.config.ts` / `tests`（`rg "candidate-selector" src vite.config.ts tests`），**不含 `.md` 文档**，故不会误判红；U1 **不**清理文档提及（保持范围保真，避免越界改文档） | U1 Must-NOT-do + F1 核对作用域说明 + Out of Scope |

### C. v3 自证结论（摘要）

- **BLK-U9 已闭环**：U9 断言收敛为「**5 个固定白名单**入口页均 `lang="en"` 且不含 `zh-CN`」，**不再触碰 `candidate-selector`**——故 **U9 在 U1 未完成时即可独立通过 acceptance**（白名单内无候选页；U9 改完自身 5 个文件即全绿）。
- **Wave 1 四并发成立**：U1（删候选页，隔离文件）/ U2（settings 三态）/ U3（conflict-confirm）/ U9（固定白名单 5 个 `index.html`）文件与断言均**互不重叠**。
- **职责边界唯一化**：`candidate-selector` 目录不存在 = **U1 守卫测试独占**；全仓 `zh-CN`/CJK 兜底 = **U8 的 `no-cjk-in-ui.test.tsx` 独占**；U9 只管自身 5 个入口页。

---

## TL;DR

> **Quick Summary**: 修复一轮 UI/UX 体验审查发现的 **12 项体验缺陷（P1–P12）**，分布在 6 个 React 入口页与 1 个共享组件库（`src/ui/shared/components.tsx`）。全部修复遵循 TDD：先产出**能在未修复代码上真实失败**的测试（RED）→ 最小实现（GREEN）→ 质量门禁。**UI 层不做范围外重构。**
>
> **Deliverables**:
> - P1 页脚 Import/Export 入口指向真实可用能力（settings 导入导出分区）+ settings 消费 `#hash` 深链（顺带修复既有 `#diagnostics` 深链失效）
> - P2 槽位菜单删除语义化：文案改正 + 前置 Confirm + `UndoBar` 参数化（**裁决 DR3：删除路径不新增撤销**，仅二次确认，见 Decisions Resolved in v2）
> - P3 侧边栏加载失败渲染显式错误态 + Retry（不再伪装为 10 个空槽位）
> - P4 侧边栏两个手写模态改用既有 `Dialog` 原语（兑现 Escape / 焦点陷阱 / 焦点还原）
> - P5 入口页语言声明与界面文案对齐（`lang` 定调为 `en`；全仓 `lang="zh-CN"` 入口页共 **6 个**，其中 `candidate-selector/index.html` 随 P10 删除由 U1 移除，故 U9 需改 **其余 5 个固定白名单页** —— `sidebar`/`settings`/`recovery`/`import-preview`/`conflict-confirm`；**U9 验收口径为一组硬编码白名单**（不扫全目录、不含候选页），故 **U9 在 U1 未完成时可独立通过 acceptance**）
> - P6 同一动作多语命名收敛（槽位删除语义统一；明确区分 DualCards「移除覆盖」为不同语义，**不改**）
> - P7 冲突窗口 5s 倒计时默认改为**非破坏性**（等同 Cancel）
> - P8 重命名/改图标/改 URL 增加 `⋯` 菜单显式入口（双击保留为快捷方式）
> - P9 同一表单内中英文混排消除 + **全部 CJK 漂移英文化**（裁决 DR1/DR4/DR5：含 `sidebar/App.tsx:585`、`settings/App.tsx:95,141,151,161,187-190,323`、`src/ui/components/IconEditor.tsx:242,287`，全仓 12 行）
> - P10 `candidate-selector` 孤儿页处置（**裁决 DR2：删除**，见 Decisions Resolved in v2）
> - P11 设置页顶层加载/错误/空 三态区分
> - P12 Toast 停留时长统一（sidebar 3000 → 5000，与共享默认一致）
> - 4 份 Final Verification 报告（F1–F4）
>
> **Estimated Effort**: Medium (1.5–2.5 天，**9 个实现任务** + 4 个最终验证任务)
> **Parallel Execution**: YES — 5 waves + FINAL（**8 项问题集中 sidebar/App.tsx 强制串行；U9 使 Wave 1 达到 4 并发**）
> **Critical Path（最长依赖链）**: U4 (P1) → U5 (P2+P6+P8) → U6 (P3) → U7 (P4) → U8 (P9+P12) → F1–F4 → user okay
> **Wave 1 可 4 并发**：U1（删 candidate-selector，隔离文件）/ U2（settings 三态）/ U3（conflict-confirm）/ U9（**5 个固定白名单** `index.html`）——四者**文件与断言均互不重叠**；**v3 已真正解除 U1↔U9 耦合**（U9 断言不含候选页），U9 可在 U1 未完成时独立通过。

---

## Context

### Original Request

> 为项目 `c:/myProjects/github/Tab-Bookmark-Shortcuts`（Manifest V3 跨浏览器扩展 Chrome/Edge/Firefox；TypeScript strict + React 18 + Vite 6 + Vitest 2）制定一份**可执行的 UI/UX 修复工作计划**，修复刚完成的一轮 UI/UX 体验审查所发现的 12 项问题（P1–P12，已带 file:line 证据）。**只做规划，不要实现代码。**

要求：TDD（RED→GREEN→门禁）；任务化 + DAG 依赖 + Wave 组织；按严重度与文件冲突串行化；每任务含文件/验收标准/可验证证据/`Must NOT do`/RED 可构造性；护栏（不削弱既有测试断言、不引新依赖、不放宽 eslint、UI 层不做范围外重构）；交互类给「推荐 vs 备选」并择一说明理由；文案类给成品文案；标注风险/阻塞点/需执行期决策项；先经 `sw-plan-reviewer` 审查。

### Interview Summary

本计划**免除访谈轮次**：请求已提供完整输入（12 项问题 + file:line 证据 + 测试基线 + 门禁命令 + 护栏清单）。依据「自我清关检查」：

- 核心目标明确：YES（修复 P1–P12）
- 范围边界建立：YES（IN/OUT 见 Work Objectives；明确排除 5 项未验证推断）
- 关键歧义残留：YES，**规划期已裁决 5 项**（语种定调 / P10 删除 vs 补齐 / P1 落点 / P7 默认 / P6 语义边界），另有 3 项标注为执行期决策与用户仲裁项
- 技术方案已决定：YES（问题清单已给修复方向，本计划细化为任务）
- 测试策略已确认：YES（TDD；UI 层用 `tests/unit/ui/*.test.tsx` + `tests/ui-smoke/` 承接；复用既有 `mockSendMessage` 模式）
- 阻塞性问题：见 Risks（无阻断启动的阻塞点）

### Research Findings（已独立核实，非引用）

> 本节全部结论来自本次规划期的直接读取/搜索，**未依赖问题清单的自述**。

1. **`#diagnostics` 深链当前是失效的（新发现，影响 P1 方案）**：全仓搜索 `location.hash` / `window.location.hash` / `hashchange` → **0 命中**（`src/ui/**` 内）。`SettingsApp` 的 `activeSection` 初值硬编码为 `'slots'`（`settings/App.tsx:1749`），且**无任何 hash 读取逻辑**。故 `sidebar/App.tsx:1065-1067` 打开的 `settings/index.html#diagnostics` 实际落在「Slots & Shortcuts」分区。→ **P1 不能只改 URL 字符串**，必须同时补 hash→section 消费，否则「Import/Export 入口指向导入导出分区」同样不成立。
2. **P2 的修复方向有权威依据（非仅『对照』）**：`_context-output/designs/2026-07-14-tab-bookmark-shortcuts-ui-ux-design.md:199` 明文规定「**槽位解绑、持久规则删除、本地图标缓存删除按既定风险级别二次确认**」。即 P2 的「前置 Confirm」是**既定设计**而非新主张。
3. **`UndoBar` 的文案与 aria-label 被既有测试锁定**：`sidebar-result-handling.test.tsx:127` 断言 `button { name: 'Undo overwrite of slot 1' }`（来源 `sidebar/App.tsx:424` 的 `Undo overwrite of slot ${undo.slotId}`）。→ P2 复用 UndoBar 时**必须保留覆盖语义的 aria-label 不变**，以 `variant`/`label` 参数扩展，不可直接改写既有字符串。
4. **`sidebar-result-handling.test.tsx` 与 P2/P6 存在硬耦合**：`:80` 断言 `getByRole('menuitem', { name: 'Reset' })`；`:99` 断言错误文案含 `Failed to unbind slot 1`；`:104` 断言**不含** `Slot 1 unbound`；`clickReset()`（`:74-83`）为「开菜单 → 点菜单项 → 立即断言」两步流。P2 的「改名 + 加 Confirm」会同时破坏 **3 个定位字符串**与 **1 个交互流**。→ 必须登记为**授权护栏例外**（见 Guardrail Exceptions），且**仅允许改定位/流程，不允许放宽任何 `expect` 判据**。
5. **`pages.smoke.test.tsx` 的 6 页断言与 P10 强耦合（用户已提示，已核实）**：`:122-147` 的 `candidate-selector` 用例是**6 个 `it` 之一**（实测整文件 `it` = 6，位于 `:66/:74/:83/:100/:122/:149`）；`vitest.workspace.ts:36-46` 有独立 `ui-smoke` project；`vite.config.ts:37` 有 `candidate-selector` 多入口（`input` 共 **8** 键，删除后 7）。
6. **`candidate-selector` 的删除代价比表面更大（新发现 · v2 已修正计数）**：`tests/unit/ui/recovery-selector.test.tsx:4` 直接 `import { CandidateSelectorApp }`，其 **candidate 相关 `it` = 7 个**（实测 `:83/:101/:116/:132/:156/:174/:186`），分布于 `:76-202` 的两个 describe（`Candidate selector — Happy path` / `— Error path`）。**该文件是 Recovery + Candidate 混合文件**：同文件 `Recovery window` 两个 describe 含 **6 个 `it`**（`:18/:25/:31/:37/:43/:51`）**受保护、必须保留**。删除组件即**必须精确删除 7 个候选用例**，并同步移除 `:5` 的 `import type { TabCandidate }`（删除后无引用，`noUnusedLocals` 下触发 TS6133）。
   - ⚠️ **v1 误载**：v1 曾声称「6 个用例 / 保留 5 个」。正确为 **candidate=7 / Recovery=6**。错误基线会诱导执行者**为凑数而误删受保护的 Recovery 用例**（违反本计划护栏），已在 v2 全面更正。
7. **`candidate-selector` 无任何样式表**：`src/ui/styles/` 仅 7 个 css，**无 candidate-selector 样式**。→ 选择「补齐」意味着**净新增样式表 + 真实候选来源接线 + 新入口交互**（净新功能，超出「修复」范围）。
8. **界面文案语言实况：英文占绝对多数，中文为少数漂移（v2 已修正计数）**：`src/ui/**` 内 CJK 实为 **12 行**（v1 误载为「9 处」），完整清单：`src/ui/components/IconEditor.tsx:242,287`（**注意路径是 `src/ui/components/`，非 `shared/`**）；`src/ui/sidebar/App.tsx:585`；`src/ui/settings/App.tsx:95,141,151,161,187,188,189,190,323`。其余全部为英文。→ 直接影响 P5/P9 的语种裁决（见 Decisions Resolved in v2 → DR1），并使裁决 DR4/DR5 落地。
   - **实测入口页 `lang`**：`rg 'html lang="zh-CN"' src/ui` = **6 命中**（`sidebar` / `settings` / `import-preview` / `candidate-selector` / `conflict-confirm` / `recovery`），**全部 6 个均为 `zh-CN`**（v1 称「4 个」错误，见 Nit N5）。
9. **既有 `Dialog` 原语已具备 P4 所需的全部能力**：`shared/components.tsx:102-169` 实现焦点保存/还原（`:106-117`）、Escape（`:121-124`）、Tab 循环陷阱（`:126-140`），并有独立单测 `tokens-components.test.tsx:43-64`。→ P4 是**复用**而非新建。
10. **P11 的「三态」缺口属实且落点明确**：`SettingsApp`（`:1748-1857`）无顶层 `loading`/`error`；`ShortcutsSection`（`:75-110`）用 `commands.length === 0` 兼作加载态（`:104-105`），「加载完但为空」时仍显示 `Loading commands...`。

### Pre-Planning Review (sw-pre-planning-consultant)

**Intent Classification**: `Mid-sized Task`（置信度 high）—— 12 项**有边界**的 UI/UX 行为与文案修正，落点在既有组件与页面内，不引入新功能域、不改公共契约形态。混合少量 `Refactoring` 特征（P4 模态收敛到既有 `Dialog` 原语），但**行为在该维度上发生变化**（正是修复目的），故按 Mid-sized Task 处理（边界定义 + AI-slop 护栏优先）。

**Identified Gaps** (addressed):
- *「语种定调未决」*：P5/P6/P9 三者互锁。**已由用户裁决（Decisions Resolved in v2 → DR1）：EN**。P9 边界随之扩展为「全仓 12 行 CJK 全部英文化」（含裁决 DR4 的 `IconEditor` 与裁决 DR5 的 `settings:323`）。
- *「P1 的落点假设未验证」*：问题清单以 `#diagnostics` 为「既定模式」，但该模式**本身失效**（Research #1）。已在 U4 显式纳入 hash 消费实现。
- *「P10 删除面未清点」*：问题清单只提示 `pages.smoke` 与 `vite.config.ts`，**遗漏** `recovery-selector.test.tsx` 的 **7 个**候选用例、`:5` 的类型 import、与无 CSS 的事实（Research #6/#7）。已在 U1 完整清点（v2 修正计数）。
- *「P2 与既有测试硬耦合」*：问题清单未提示 `sidebar-result-handling.test.tsx` 的 **4 处定位串（含 `:80`/`:82` 同串两现）** + 交互流耦合。已登记 Guardrail Exception 并限定改动边界。
- *「v1 引用漂移」（v2 新增闭合）*：`RuleEditor.tsx:323` 误引（实为 `settings/App.tsx:323`）、GE3 悬空引用、`IconEditor.tsx` 路径与 CJK 计数 — 均已修正（见 Revision Log v2 §A/§D）。

**Guardrails Recommended**:
- **不做行为无关的重构**：禁止顺手清理、重命名无关符号、调整格式。
- **不引入新依赖**：焦点陷阱/确认框/撤销条均复用既有实现。
- **不加无测试的修复**：每任务必须先有失败测试，并在证据文件记录 RED 输出。
- **不削弱既有断言**：仅 **GE1–GE5 五类显式登记**的定位/流程/追加更新，且不得放宽任何 `expect` 判据。
- **QA 零人工**：全部验收由命令/测试断言完成。

---

## Work Objectives

### Core Objective

在**不引入新依赖、不削弱既有测试判据、不做范围外重构**的前提下，用 TDD 修复 12 项 UI/UX 体验缺陷（P1–P12），使 6 个 UI 入口的**任务可达性、破坏性操作安全性、可访问性（重点：Escape/焦点管理）、文案一致性（全英文）**达标，且 `lint`（delta-0）、`typecheck`、`test:unit`、`test:integration`、`test:ui-smoke`、三浏览器 `build:*` 全部通过。

### Concrete Deliverables

- [ ] `src/ui/sidebar/App.tsx` — P1 页脚入口目标改指；P2 菜单文案/Confirm/UndoBar 扩展；P3 错误态+Retry；P4 两模态改 `Dialog`；P6 槽位删除文案统一；P8 菜单显式编辑项；P9 正则提示文案；P12 Toast duration
- [ ] `src/ui/settings/App.tsx` — P1 `#hash` → `activeSection` 消费；P11 顶层 `loading`/`error`/empty 三态；P9 文案英文化（`:95`、`:141`、`:151`、`:161`、`:187-190`、**`:323`（VERSION_CONFLICT，宿主 `InlineRuleEditor`，裁决 DR5）**）
- [x] ~~`src/ui/settings/RuleEditor.tsx` — P9 VERSION_CONFLICT 文案~~ **【v2 撤销：该文件不含此文案；真实落点为 `src/ui/settings/App.tsx:323`，本文件无需改动（其 `:298` 的 `Delete Rule` 语义已正确）】**
- [ ] `src/ui/conflict-confirm/App.tsx` — P7 倒计时默认非破坏性
- [ ] `src/ui/components/IconEditor.tsx` — P9 CJK 英文化（`:242` 占位符 / `:287` 折叠文案；**裁决 DR4：一并英文化**）
- [ ] `src/ui/shared/components.tsx` — P2/P7 所需的**参数化扩展**（仅新增可选 props，不改默认）
- [ ] `src/ui/{sidebar,settings,import-preview,conflict-confirm,recovery}/index.html` — P5 `lang` 对齐（**5 个固定白名单**；`candidate-selector/index.html` 随 P10 由 U1 删除，U9 不动该文件）
- [ ] **删除** `src/ui/candidate-selector/**`（3 文件）+ `vite.config.ts` 条目 + `tests/ui-smoke/pages.smoke.test.tsx` 用例 + `tests/unit/ui/recovery-selector.test.tsx` 的 **7 个**候选用例 + 该文件 `:5` 的 `import type { TabCandidate }`（P10）
- [ ] 新增/扩展测试（**共 9 个新增文件**）：`tests/unit/ui/sidebar-error-state.test.tsx`、`sidebar-slot-menu-delete.test.tsx`、`sidebar-modal-a11y.test.tsx`、`settings-deeplink.test.tsx`、`settings-loading-states.test.tsx`、`conflict-confirm-default-safe.test.tsx`、`candidate-selector-removed.test.ts`、`page-lang.test.tsx`、`no-cjk-in-ui.test.tsx`（**v3 补齐：v2 遗漏列此项，与门禁 files=45 口径对齐 —— Nit N7 关联修正**）
- [ ] Final Verification 报告 F1–F4（输出到对话）

### Definition of Done

- [ ] `npm run lint` → **delta-0**：新增 error/warning 数为 0（基线为 638 errors，详见「Lint 基线说明」）
- [ ] `npm run typecheck` → 退出码 0，0 error（**B1 关键门禁**：U1 删除候选用例后必须同步移除 `:5` 的 `import type { TabCandidate }`，否则 `noUnusedLocals` 报 TS6133）
- [ ] `npm run test:unit` → 全绿（含新增测试）
- [ ] `npm run test:integration` → 全绿（无回归）
- [ ] `npm run test:ui-smoke` → 全绿，且用例数由 6 **降为 5**（P10 删除后）
- [ ] `npm run build:chrome` / `build:edge` / `build:firefox` → 三者均成功
- [ ] 每个 P 项有至少 1 个「能在修复前失败、修复后通过」的测试
- [ ] F1–F4 四份审查全部 APPROVE
- [ ] 全部既有 UI 测试（`tests/unit/ui/` 18 文件）保持通过；**除 GE1–GE5 五类登记例外外，无任何 `expect` 判据被放宽或删除**

### Must Have

- P2 槽位删除**执行前**弹 Confirm（依据 design spec §8:199）；`UndoBar` 具备可选 `label`/`undoLabel` prop（默认文案不变）；**删除路径不新增撤销**（**裁决 DR3：不做**，不新增后台 action）
- P4 两个模态具备 Escape 关闭、Tab 焦点陷阱、关闭后焦点还原
- P7 倒计时归零**不执行覆盖**，而是等同 Cancel（非破坏性）
- P3 加载失败渲染错误态 + Retry 按钮（不与 loading 态同时出现）
- P11 设置页区分「加载中 / 加载失败 / 确实为空」三态
- P1 入口打开后**实际落在目标分区**（依赖 hash 消费实现）
- P10 `candidate-selector` 的 5 处引用点（目录 / `vite.config.ts:37` / `pages.smoke:122-147` / `recovery-selector:76-202` 的 7 用例 / `recovery-selector:5` 类型 import）全部同步清除，构建 + 冒烟 + `typecheck` 全绿
- **P9（裁决 DR1/DR4/DR5 收紧）**：`src/ui/**` 内 **12 行 CJK 全部消除**，界面统一英文
- 全部修复不引入新 npm 依赖
- 每任务含 QA 场景（含 ≥1 failure/edge）与证据路径

### Must NOT Have (Guardrails)

- ❌ **禁止**实现代码之外的「顺手重构」——不改公共 API 名称与形状、不重排无关代码、不升级依赖
- ❌ **禁止**引入 npm 包（焦点陷阱/确认/撤销/Toast 全部复用既有实现）
- ❌ **禁止**放宽 `eslint.config.mjs` 严格度或新增 `eslint-disable`（既有 3 处 `eslint-disable` 不在本计划范围）
- ❌ **禁止**删除或弱化既有 `expect` 判据（`toBeInTheDocument` / `toHaveTextContent` / `toHaveLength` 等一律不得删除、不得改为更宽松形式）
- ❌ **禁止**触碰 5 项明确排除的未验证推断（见 OUT）
- ❌ **禁止**修改 `src/ui/sidebar/DualCards.tsx` 的「Remove」语义（P6 明确区分：那是「移除覆盖」，与「删除槽位」不同类）
- ❌ **禁止**把计划拆成多文件（单一计划原则）
- ❌ **禁止**在验收标准中出现「用户手动测试/目视确认」
- ❌ **禁止**改动 P1–P12 之外的代码路径（含 `import-preview/App.tsx` 的导出能力补齐——那属净新功能，见 OUT）
- ❌ **禁止**为 P10 选择「补齐」路径（**裁决 DR2：删除**；详见 Decisions Resolved in v2）
- ❌ **禁止**改动 `src/ui/settings/RuleEditor.tsx` 的 VERSION_CONFLICT 文案（**该文件不含此文案**；真实落点是 `settings/App.tsx:323`——见 Blocker B3）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision

- **Infrastructure exists**: YES（Vitest 2 workspace：`unit` / `integration` / `ui-smoke`；`tests/setup.ts` 内置 `chrome` 全局桩；`@testing-library/react` 16 + `user-event` 14）
- **Automated tests**: **TDD** — 每任务 RED（失败测试）→ GREEN（最小实现）→ REFACTOR
- **RED 可验证性要求**：每个新测试必须先在**未修复代码**上运行并观察到失败，执行者须在证据文件中记录 RED 运行输出。
- **既有 mock 模式**：`vi.stubGlobal('chrome', { runtime: { sendMessage: mockSendMessage, getURL, onMessage }, ... })` + 按 `msg.action` 路由响应（模板见 `tests/unit/ui/sidebar-result-handling.test.tsx:47-71`）。

### Lint 基线说明（重要）

`npm run lint`（`eslint src tests --max-warnings 0`）在**干净树上即为红**（约 638 errors），根因为锁定的 `typescript-eslint` 8.65.0 与 `strictTypeChecked` 的规则漂移，**属已登记的独立范围**。本计划**不改动 eslint 配置**，判据为 **delta-0 新增错误**：

```
# 基线采集（在实现前于干净树执行一次，落盘）
npx eslint src tests --format json > _context-output/evidence/lint-baseline-before.json
# 实现后对比
npx eslint src tests --format json > _context-output/evidence/lint-baseline-after.json
# 判据：after 中 (file,line,ruleId) 集合 ⊆ before 集合之外的新增为 0
```

新增文件（如新测试文件）**不得引入新 error/warning**。

### QA Policy

Every task MUST include agent-executed QA scenarios. Evidence saved to `_context-output/evidence/task-{U}-{scenario-slug}.txt`。

- **UI 组件/页面**: Bash（`npx vitest run tests/unit/ui/<file>`）+ Testing Library — 渲染、交互、断言 DOM
- **冒烟**: Bash（`npm run test:ui-smoke`）
- **静态检查**: Bash（`npm run typecheck`；`npx eslint ... --format json`）
- **构建**: Bash（`npm run build:chrome|edge|firefox`）

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (可并行起步 — 4 个非 sidebar-App 任务，文件互不重叠):
├── U1: P10 candidate-selector 删除（5 处引用点同步清除）
├── U2: P11 设置页顶层三态
├── U3: P7 conflict-confirm 默认非破坏性
└── U9: P5 入口页 lang 声明（5 个固定白名单 index.html；与 U1 无重叠文件、无重叠断言）

Wave 2 (U4 — 独占 sidebar/App.tsx 序列起点):
└── U4: P1 页脚入口 + settings #hash 深链消费          ← 依赖 U2（同文件 settings/App.tsx 串行）

Wave 3 (U5 — sidebar 串行链 1):
└── U5: P2+P6+P8 槽位菜单（删除语义/Confirm/显式编辑项） ← 依赖 U4

Wave 4 (U6):
└── U6: P3 侧边栏加载失败错误态 + Retry                ← 依赖 U5

Wave 5 (U7 → U8 — sidebar 串行链尾):
├── U7: P4 两模态改用 Dialog 原语                      ← 依赖 U6
└── (串行) U8: P9 全仓 CJK 英文化（sidebar+settings+IconEditor）+ P12 Toast 时长 ← 依赖 U7

Wave FINAL (全部实现任务之后 — 4 路并行审查，然后取用户 okay):
├── F1: Plan Compliance Audit
├── F2: Code Quality Review (含 delta-0 lint 对比)
├── F3: Real Agent-Executed QA
└── F4: Scope Fidelity Check
→ 呈现结果 → 取得用户显式 okay

Critical Path (定义 = 最长依赖链): U4 → U5 → U6 → U7 → U8 → F1–F4 → user okay
Parallel Speedup: 有限（sidebar 单文件强制串行；Wave 1 四任务并行）
Max Concurrent: 4 (Wave 1)
```

### Dependency Matrix

```
- U1: No dependencies (Wave 1；candidate-selector 目录 + vite.config + 2 个既有测试文件 + 1 个新增守卫测试)
- U2: No dependencies (Wave 1；settings/App.tsx)
- U3: No dependencies (Wave 1；conflict-confirm/App.tsx)
- U9: No dependencies (Wave 1；**6 个** `index.html` 中改 U9 负责的 **5 个固定白名单**（`sidebar`/`settings`/`recovery`/`import-preview`/`conflict-confirm`）；**v3 真正解耦：U9 不依赖 U1 的任何断言** —— U9 **只**断言「其 5 个白名单入口页均 `lang="en"` 且不含 `zh-CN`」，**不断言** `src/ui` 全目录、**不触碰** `candidate-selector`；「`candidate-selector` 目录不存在」由 U1 守卫测试独占，「全仓无 CJK」由 U8 的 `no-cjk-in-ui.test.tsx` 兜底)
- U4: depends on U2（同文件 settings/App.tsx：U2 的顶层三态先落地，U4 再补 hash 消费）
- U5: depends on U4（同文件 sidebar/App.tsx 串行）
- U6: depends on U5（同文件 sidebar/App.tsx 串行）
- U7: depends on U6（同文件 sidebar/App.tsx 串行）
- U8: depends on U7（同文件 sidebar/App.tsx 串行 + GE2 触碰 inline-rule-editor）
- F1–F4: depend on ALL implementation tasks (U1–U9)
- **Longest chain（关键路径）**: U4 → U5 → U6 → U7 → U8 → F1–F4
- ⚠️ U5 可能触碰 shared/components.tsx（UndoBar label 扩展）；U8 亦可能触碰（若 P12 采显式常量，默认不采）。
  两者 Wave 不同（U5 在 W3、U8 在 W5），天然串行，无冲突。
- ✅ **v3 已真正解耦** U1 与 U9 的断言耦合：
  - v1 让 U9 断言「candidate-selector 目录不存在」→ 隐式依赖 U1；
  - v2 改为「动态枚举现存入口页 + `src/ui` 全目录 0 命中」→ **仍不完全解耦**（动态枚举与全目录扫描**均会覆盖**归 U1 删除的 `candidate-selector/index.html`，U1 前必红，与「U9 不改不删该文件」自相矛盾 —— 即 v3 Blocker **BLK-U9**）；
  - **v3 最终落实**：U9 断言**限定为 5 个固定白名单**入口页（`sidebar`/`settings`/`recovery`/`import-preview`/`conflict-confirm`）均 `lang="en"` 且不含 `zh-CN`，**不断言全目录、不触碰 `candidate-selector`**。→ 两任务文件与断言均不重叠，**U9 在 U1 未完成时即可独立通过 acceptance**，可**真正并行**。
  - 职责唯一化：「`candidate-selector` 目录不存在」= U1 守卫测试 `candidate-selector-removed.test.ts` **独占**；「全仓无 `zh-CN`/无 CJK」= U8 的 `no-cjk-in-ui.test.tsx` **独占**。
```

### Agent Dispatch Summary

```
- Wave 1: 4 tasks — U1->deep(跨 5 处引用点+构建/冒烟/typecheck 耦合), U2->quick, U3->quick, U9->quick
- Wave 2: 1 task  — U4->deep(深链消费+入口目标，跨 sidebar/settings)
- Wave 3: 1 task  — U5->deep(确认流+菜单扩展，测试耦合最多)
- Wave 4: 1 task  — U6->quick
- Wave 5: 2 tasks — U7->deep(可访问性原语迁移), U8->quick
- Wave FINAL: 4 tasks — F1->oracle, F2->unspecified-high, F3->unspecified-high, F4->deep
```

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: WHAT TO DO + QA SCENARIOS + References + Commit info.
> **TDD 铁律**：先写测试并观察 RED，再实现 GREEN，最后跑门禁。

---

### Wave 1 — 并行起步（非 sidebar）

- [ ] U1. **P10 — 删除孤儿页 `candidate-selector`（5 处引用点同步清除）**

  **What to do**:
  - 删除目录 `src/ui/candidate-selector/`（`App.tsx` / `main.tsx` / `index.html`）。
  - 删除 `vite.config.ts:37` 的 `'candidate-selector'` 多入口条目（`input` 由 8 → 7 键）。
  - 删除 `tests/ui-smoke/pages.smoke.test.tsx:122-147` 的 candidate-selector 用例（GE4；该文件 `it` 由 **6 → 5**）。
  - **外科式删除** `tests/unit/ui/recovery-selector.test.tsx:76-202` 的两个 describe 块（`Candidate selector — Happy path` + `Candidate selector — Error path`，**含 7 个 `it`**：`:83/:101/:116/:132/:156/:174/:186`），**保留** `Recovery window` 的两个 describe（**6 个 `it`**：`:18/:25/:31/:37/:43/:51`）（GE5）。
  - **同步移除两处现已无用的 import**（**B1 关键**）：
    - `:4` 的 `import { CandidateSelectorApp } from '@ui/candidate-selector/App';`
    - `:5` 的 `import type { TabCandidate } from '@shared/types';` —— 该类型的**唯一用途**是 `:77` 与 `:187` 的 `candidates: TabCandidate[]` 注解，随两个 describe 删除后**不再被引用**；`tsconfig.json` 启用 `"noUnusedLocals": true`，遗漏即触发 **TS6133**，导致 DoD「`typecheck` 退出码 0」无法达成。
  - **RED 可构造性**：先写「删除后应无残留引用」的守卫断言——在 `tests/unit/ui/` 新增 `candidate-selector-removed.test.ts`，用 `readFileSync` + `existsSync` 断言：① `src/ui/candidate-selector` 目录**不存在**；② `vite.config.ts` 源码不含 `candidate-selector`；③ `tests/ui-smoke/pages.smoke.test.tsx` 的 `it(` 计数 = **5**；④ `tests/unit/ui/recovery-selector.test.tsx` 源码不含 `CandidateSelectorApp` / `TabCandidate`。该测试在**删除前**必然失败（4 条中至少 3 条失败），构成有效 RED。
  - ⚠️ **不要**在实现前跑 `npm run test:unit` 期待全绿——RED 阶段该守卫测试必失败，属预期。
  - ⚠️ **本任务是「`candidate-selector` 目录不存在」断言的唯一归属方**（v2 起 U9 不再断言该项；**v3 已真正解耦**：U9 断言收敛为 5 个固定白名单，不含候选页 —— 见 Nit N2 / Blocker BLK-U9）。

  **Must NOT do**:
  - 不删除 `import-preview` 页（本计划不处置该页，见 Out of Scope）。
  - 不删除 `src/ui/candidate-selector/App.tsx` 中的任何**逻辑**到别处——能力不做迁移（**裁决 DR2：删除**）。
  - **不改** `tests/unit/ui/recovery-selector.test.tsx` 中 `Recovery window` 的 **6 个 `it`**（受保护；不得为凑数误删——这正是 v1 错误基线「5 用例」的最大风险点）。
  - 不改 `tests/ui-smoke/pages.smoke.test.tsx` 其余 **5 个**用例与共享 `chrome` 桩。
  - **仅删页**：**不得**删除后台 `GET_CANDIDATES` 与相关类型（**Nit N3 边界声明**）：
    - `src/background/worker-orchestrator.ts:648-654` 的 `GET_CANDIDATES` case（**保留**）；
    - `src/ui/shared/message-client.ts:297-299` 的 `getCandidates`（**保留**）；
    - `src/shared/messages.ts:224-227` / `:373-375` 的 `GetCandidatesRequest` / `GetCandidatesResponse`（**保留**）；
    - `TabCandidate` 类型定义本身（`@shared/types`，**保留**——只移除 `recovery-selector.test.tsx` 中的 **import 语句**）。
    - 理由：候选能力的后台域属 `2026-09-28-fix-roadmap-plan.md` 范围，删除后台 action 会越过本计划边界并可能破坏后台测试。
  - **不改文档提及（Nit N9）**：`README.md:101`、`RELEASE_CANDIDATE.md:83` 亦提及 `candidate-selector`，但**文档提及不在 U1 范围内**——本任务**不清理**、**不修改**任何 `.md` 文件。
    - 理由：① 保持范围保真（U1 作用域 = `src/**` + `vite.config.ts` + `tests/**`，**不含文档**）；② F1 核对作用域为 `rg "candidate-selector" src vite.config.ts tests`（**不含 `.md`**），故文档提及**不会误判红**；③ 文档改写属独立的表达层任务，避免越界。
    - （备选方案「顺带清理文档」**未采纳**，理由同上——避免把「删页」扩大为「文档改写」。）

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 跨 5 处引用点（目录 / vite 入口 / 冒烟用例 / 混合测试文件的 7 个 `it` / 类型 import）+ 构建入口 + 两个测试文件；遗漏任一处会使构建、冒烟或 `typecheck` 必红。
  - **Skills**: [`sw-verification-before-completion`]
    - 需以「三浏览器构建成功 + 冒烟 5 用例 + `typecheck` 0 error + 全仓 0 命中」四证据证明清除彻底，不能凭「我删了目录」声明完成。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with U2, U3, U9)
  - **Blocks**: F1–F4
  - **Blocked By**: None

  **References**:
  - **Pattern References**:
    - `src/ui/candidate-selector/App.tsx:57-143` — 待删除组件（`CandidateSelectorApp`）。
    - `src/ui/candidate-selector/main.tsx:9-14` — 桩数据入口（`candidates={[]}`），证明无真实数据源。
    - `src/ui/candidate-selector/index.html` — 待删除入口。
  - **API/Type References**（**全部保留，不删**；仅作证据引用）:
    - `src/background/worker-orchestrator.ts:648-654` — `GET_CANDIDATES` 在无 `ruleId` 时恒返回 `{success:true,candidates:[]}`（能力不可达的根因）。
    - `src/background/slot-service.ts:605-632` — `findCandidates` 为私有方法，未通过任何 action 暴露给 UI。
    - `src/ui/shared/message-client.ts:297-299` — `getCandidates`（**保留**）。
    - `src/shared/messages.ts:224-227` / `:373-375` — `GetCandidatesRequest` / `GetCandidatesResponse`（**保留**）。
  - **Test References**:
    - `tests/ui-smoke/pages.smoke.test.tsx:122-147` — 待删除用例（GE4）。
    - `tests/unit/ui/recovery-selector.test.tsx:4` + `:5` + `:76-202` — 待删除的两条 import 与两个 describe（GE5）；`:5` 为 **B1** 所指的未使用类型 import。
    - `vitest.workspace.ts:36-46` — `ui-smoke` project 定义（**不改**）。
  - **External References**: 无。
  - **WHY Each Reference Matters**: `worker-orchestrator.ts:648-654` 与 `slot-service.ts:605-632` 共同证明「候选能力从未接线」，是选择删除而非补齐的**证据基础**（也说明为何后台 action 应**保留**——能力域未死，只是 UI 入口未接线）；`recovery-selector.test.tsx` 的 **7 个**候选用例与 `:5` 的类型 import 是清单**未提示**的隐藏耦合点，遗漏则 `test:unit` 或 `typecheck` 必红。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新增守卫测试先运行 → **RED**（证据：`_context-output/evidence/task-U1-red.txt`）
  - [ ] `npx vitest run tests/unit/ui/candidate-selector-removed.test.ts` → ALL PASS（4 条断言全绿）
  - [ ] `npm run test:unit` → ALL PASS（无残留 import 错误）
  - [ ] `npm run test:ui-smoke` → ALL PASS，**用例数 = 5**（6 − 1）
  - [ ] **`npm run typecheck` → 退出码 0，0 error**（**B1 关键门禁**：证明 `:5` 的 `TabCandidate` import 已同步移除，无 TS6133）
  - [ ] `npm run build:chrome` → 成功（入口由 8 → 7）
  - [ ] `npx vitest run tests/unit/ui/recovery-selector.test.tsx` → ALL PASS（**6 用例**，即保留的 Recovery 两个 describe）

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 删除后全仓无 candidate-selector 残留
    Tool: Bash (rg + test)
    Steps:
      1. rg -n "candidate-selector" src vite.config.ts tests → 期望 0 命中
         · 作用域**不含 `.md` 文档**（Nit N9）：`README.md:101` / `RELEASE_CANDIDATE.md:83` 的提及不在 U1 范围，不得误判红
      2. test ! -d src/ui/candidate-selector → 期望 true
      3. 检查 pages.smoke.test.tsx 中 it( 出现次数 = 5（原 6，−1）
      4. 检查 recovery-selector.test.tsx 中 it( 出现次数 = 6（原 13，−7；**不得为 5**）
      5. rg -n "TabCandidate|CandidateSelectorApp" tests/unit/ui/recovery-selector.test.tsx → 期望 0 命中（B1）
    Expected Result: 0 命中 / 目录不存在 / 冒烟 5 用例 / recovery 保留 6 用例 / 无残留 import
    Failure Indicators: 任一残留 → 构建或冒烟必红；recovery 计数若为 5 → **误删了受保护的 Recovery 用例**
    Evidence: _context-output/evidence/task-U1-residue-zero.txt

  Scenario: 三浏览器构建 + 冒烟 + typecheck 在删除后仍通过
    Tool: Bash
    Steps:
      1. npm run test:ui-smoke
      2. npm run typecheck          → 期望 exit 0（B1：验证 `:5` 类型 import 已移）
      3. npm run build:chrome && npm run build:edge && npm run build:firefox
    Expected Result: 冒烟 5 pass；typecheck exit 0；三个 build 退出码 0
    Failure Indicators: vite 报「Could not resolve entry」→ 入口条目遗漏；typecheck 报 TS6133 → `:5` import 未移除
    Evidence: _context-output/evidence/task-U1-build-ok.txt
  ```

  **Commit**: YES (Commit 1)
  - Message: `chore(ui): remove orphan candidate-selector page (P10)`
  - Files: `src/ui/candidate-selector/**`, `vite.config.ts`, `tests/ui-smoke/pages.smoke.test.tsx`, `tests/unit/ui/recovery-selector.test.tsx`（删 7 用例 + `:4`/`:5` 两条 import）, `tests/unit/ui/candidate-selector-removed.test.ts`
  - Pre-commit: `npm run test:unit && npm run test:ui-smoke && npm run typecheck && npm run build:chrome`

- [ ] U2. **P11 — 设置页顶层「加载中 / 加载失败 / 确实为空」三态**

  **What to do**:
  - `src/ui/settings/App.tsx:1748-1857`：为 `SettingsApp` 增加顶层 `loading`（初始 `true`）与 `error`（初始 `null`）状态。
  - `loadState`（`:1758-1778`）：成功分支后 `setLoading(false)`；`catch` 分支改为 `setLoading(false); setError('Failed to load settings')`（**保留**既有 `setToast` 错误提示，不删）。
  - 渲染三态：`loading === true` → 渲染显式 loading 区（`role="application"` 容器 + `aria-busy="true"` + 可访问文本，如 `Loading settings...`）；`error !== null && !loading` → 渲染 `role="alert"` 错误区 + `Retry` 按钮（`onClick` 重新调用 `loadState`）；否则渲染既有内容。
  - 三态**互斥**：loading 与 error 不同时出现（error 区仅在 `!loading` 时渲染）。
  - `ShortcutsSection`（`:75-110`）：把「加载态」与「空态」拆开——新增 `loading` prop；`commands.length === 0 && loading` → `Loading commands...`；`commands.length === 0 && !loading` → `No commands available`（或等效「确实为空」文案）。
  - 补测试 `tests/unit/ui/settings-loading-states.test.tsx`：① GET_STATE/GET_COMMANDS 永久 pending → 断言 loading 文本可见且无 `#slots` 表格；② GET_STATE reject → 断言 `role="alert"` 含 `Failed to load settings` 且存在 `Retry`；③ 点击 `Retry` → 令 mock 转为成功 → 断言表格出现；④ GET_COMMANDS 成功返回 `commands: []` → 断言**不**显示 `Loading commands...`（区分「空」与「加载中」）。
  - ⚠️ **RED 守卫**：当前代码无顶层 loading/error，故 ①②④ 三条断言在当前代码上必失败（无 `Loading settings...` 文本、无 `Retry` 按钮、空数组时仍显示 `Loading commands...`），构成有效 RED。

  **Must NOT do**:
  - 不改 `settings.test.tsx:47-55` 断言的「22 行 = 1 表头 + 21 命令」结构（loaded 后仍须渲染 21 行）。
  - 不删除既有 `setToast({variant:'error', message:'Failed to load settings'})` 行为（新增 error 区是**叠加**，不是替换）。
  - 不引入 loading 骨架/动画依赖。
  - 不改 `DiagnosticsSection` / `ImportExportSection`（P1 在 U4 触碰同文件，故 U2 需先完成，避免二次编辑冲突）。

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件、三态分支明确。
  - **Skills**: [`sw-verification-before-completion`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with U1, U3)
  - **Blocks**: U4（同文件 `settings/App.tsx`）
  - **Blocked By**: None

  **References**:
  - **Pattern References**:
    - `src/ui/settings/App.tsx:1758-1778` — 待改 `loadState`（现有 catch 仅 setToast）。
    - `src/ui/settings/App.tsx:104-105` — `commands.length === 0` 兼作加载态（缺口）。
    - `src/ui/sidebar/App.tsx:1318-1324` — 既有 loading 态渲染范式（`aria-busy="true"`），可对照风格。
  - **API/Type References**:
    - `src/ui/settings/App.tsx:64-71` — `NAV_ITEMS`（三态渲染包裹整个导航+内容，不改各项）。
  - **Test References**:
    - `tests/unit/ui/settings.test.tsx:6-29` — `mockSendMessage` 按 action 路由模板（新测试直接沿用）。
    - `tests/unit/ui/settings.test.tsx:47-55` — 必须保持通过的既有行数断言（R7）。
  - **WHY Each Reference Matters**: `sidebar/App.tsx:1318-1324` 提供项目内既有 loading 无障碍写法，照搬可保证一致性；`settings.test.tsx:47-55` 是 U2 的**硬护栏**（三态改造不得破坏 loaded 后的表格渲染）。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新测试先运行 → **RED**（证据：`_context-output/evidence/task-U2-red.txt`）
  - [ ] `npx vitest run tests/unit/ui/settings-loading-states.test.tsx` → ALL PASS（≥ 4 tests）
  - [ ] `npx vitest run tests/unit/ui/settings.test.tsx` → ALL PASS（无回归）
  - [ ] `npm run test:unit` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 加载中与加载失败互斥且可重试
    Tool: Bash (test runner)
    Steps:
      1. mock GET_STATE 返回永不 resolve 的 Promise → 断言文本含 "Loading settings" 且 queryByRole('table') 为空
      2. mock GET_STATE 改为 reject → 断言 getByRole('alert') 含 "Failed to load settings" 且存在 name=Retry 的按钮
      3. 令 mock 转成功 → 点击 Retry → 断言命令表出现（22 行）
    Expected Result: 三态按序正确切换，Retry 生效
    Failure Indicators: loading 与 error 同时出现 / Retry 无响应 / 表格在 error 态下仍渲染
    Evidence: _context-output/evidence/task-U2-three-state.txt

  Scenario: 确实为空 ≠ 加载中
    Tool: Bash (test runner)
    Steps:
      1. GET_COMMANDS 成功返回 commands: []，GET_STATE 成功
      2. 断言 NOT getByText('Loading commands...')；断言存在空态文案
    Expected Result: 显示「确实为空」，不显示加载中
    Failure Indicators: 空数组仍显示 "Loading commands..."（P11 原缺陷）
    Evidence: _context-output/evidence/task-U2-empty-vs-loading.txt
  ```

  **Commit**: YES (Commit 2, 与 U4 合并)
  - Message: `feat(settings): three-state loading and hash deep-link (P11, P1)`
  - Files: `src/ui/settings/App.tsx`, `tests/unit/ui/settings-loading-states.test.tsx`
  - Pre-commit: `npm run test:unit`

- [ ] U3. **P7 — 冲突窗口倒计时超时改为非破坏性默认（等同 Cancel）**

  **What to do**:
  - `src/ui/conflict-confirm/App.tsx:37-57`：倒计时归零分支由 `void handleOverwrite()` 改为 `void handleCancel()`。
  - `:123-125` 的文案由 `Auto-overwrite in {countdown}s` 改为非破坏性语义，如 `Cancelling in {countdown}s`（成品文案见 QA）。
  - `:117` 的 `aria-label="Auto-overwrite countdown"` 同步改为 `Cancelling countdown`。
  - 保留两个按钮（`Cancel` / `Overwrite`）与既有 `aria-label` 不变（`pages.smoke.test.tsx:149-161` 只断言 ≥2 按钮，保持通过）。
  - 「归零后不自动覆盖」须可从状态观察到：归零调用 `handleCancel` 后 `status` 变为 `cancelled` 并 `window.close()`。
  - 补测试 `tests/unit/ui/conflict-confirm-default-safe.test.tsx`：使用 `vi.useFakeTimers()` 推进 5s →
    ① 断言 `onOverwrite` **未**被调用；② `onCancel` **被**调用一次；③ 断言归零前文案为 `Cancelling in Ns`（非 `Auto-overwrite`）。
  - ⚠️ **RED 守卫**：当前实现归零调用 `onOverwrite`，故断言 ①（`onOverwrite` 未被调用）与 ③（文案为 Cancelling）在旧代码上必失败，构成有效 RED。
  - ⚠️ **测试须替换 `window.close`**：组件终态调用 `window.close()`；在 jsdom 中需 `vi.spyOn(window, 'close').mockImplementation(() => {})` 避免报错，并在断言后还原。

  **Must NOT do**:
  - 不删除 `Overwrite` 按钮（破坏性结果仍需**显式点击**）。
  - 不改 `ConflictInfo` / `ConflictConfirmProps` 形状。
  - 不改 `pages.smoke.test.tsx` 的 conflict 用例（**GE4 仅授权删除 candidate 用例，不授权改动 conflict 用例**）。
  - 不改 `conflict-confirm.css` 的 `@keyframes`（属 Out of Scope 未验证推断）。

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`sw-verification-before-completion`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with U1, U2)
  - **Blocks**: F1–F4
  - **Blocked By**: None

  **References**:
  - **Pattern References**:
    - `src/ui/conflict-confirm/App.tsx:37-57` — **被修复点**：归零 → `handleOverwrite()`。
    - `src/ui/conflict-confirm/App.tsx:69-87` — `handleCancel` 及其 `cancelled` 终态渲染（复用为目标行为）。
    - `src/ui/recovery/App.tsx:36-42` — **既定安全范式**：超时即 Dismiss（非破坏性），本任务与之对齐。
  - **API/Type References**:
    - `src/ui/conflict-confirm/App.tsx:23-27` — `ConflictConfirmProps`（`onOverwrite` / `onCancel` 均为 `() => Promise<void>`）。
  - **Test References**:
    - `tests/ui-smoke/pages.smoke.test.tsx:149-161` — 必须保持通过的按钮数量断言。
  - **WHY Each Reference Matters**: `recovery/App.tsx:36-42` 证明「超时非破坏性」是本项目**既有既定策略**，P7 是向既定策略对齐而非新主张；`pages.smoke` 的按钮断言约束「不得删按钮」这一 Must NOT。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新测试先运行 → **RED**（证据：`_context-output/evidence/task-U3-red.txt`）
  - [ ] `npx vitest run tests/unit/ui/conflict-confirm-default-safe.test.tsx` → ALL PASS（≥ 3 tests）
  - [ ] `npm run test:ui-smoke` → ALL PASS
  - [ ] `npm run test:unit` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 5s 无操作 → 不覆盖，而是取消
    Tool: Bash (test runner, fake timers)
    Steps:
      1. render ConflictConfirm，onOverwrite/onCancel 为 vi.fn()
      2. vi.advanceTimersByTime(5000)
      3. 断言 onOverwrite 未被调用；onCancel 被调用 1 次
    Expected Result: 超时等同 Cancel
    Failure Indicators: onOverwrite 被调用（原破坏性行为）
    Evidence: _context-output/evidence/task-U3-timeout-safe.txt

  Scenario: 用户显式点击 Overwrite 仍可覆盖（破坏性需显式）
    Tool: Bash (test runner)
    Steps:
      1. render；立即 click name='Force overwrite slot'
      2. 断言 onOverwrite 被调用 1 次
    Expected Result: 显式点击保留覆盖能力
    Failure Indicators: Overwrite 按钮被移除或失效
    Evidence: _context-output/evidence/task-U3-explicit-overwrite.txt
  ```

  **Commit**: YES (Commit 3)
  - Message: `fix(conflict): make countdown timeout non-destructive (P7)`
  - Files: `src/ui/conflict-confirm/App.tsx`, `tests/unit/ui/conflict-confirm-default-safe.test.tsx`
  - Pre-commit: `npm run test:unit && npm run test:ui-smoke`

---

### Wave 2 — sidebar 串行链起点

- [ ] U4. **P1 — 页脚 Import/Export 入口指向真实能力 + settings 消费 `#hash` 深链**

  **What to do**:
  - `src/ui/settings/App.tsx`：新增 hash → section 消费。初始化 `activeSection` 时读取 `window.location.hash`，映射 `#import-export` → `'import-export'`、`#diagnostics` → `'diagnostics'`、`#rules`/`#strategy`/`#dashboard`/`#slots` 同理；无 hash 或非法 hash → 默认 `'slots'`。同页面内监听 `hashchange` 以支持「已打开的 settings 标签被 hash 导航」场景（`open-page.ts:46-50` 的正是不重载的 hash-only 导航，**必须**监听才生效）。
    - 实现建议：新增纯函数 `resolveSectionFromHash(hash: string): SettingsSection`，便于单测；`useState(() => resolveSectionFromHash(window.location.hash))` + `useEffect` 注册 `hashchange`。
  - `src/ui/sidebar/App.tsx:1061-1063`：`handleOpenImportExport` 的目标由 `'src/ui/import-preview/index.html'` 改为 `'src/ui/settings/index.html#import-export'`（与 `handleOpenDiagnostics`（`:1065-1067`）完全同构）。
  - **不改** `:1615` 按钮的 `aria-label="Import or export"`（`sidebar.test.tsx:206` 依赖它）与可见文本 `↕ Import/Export`。
  - 补测试：
    - `tests/unit/ui/settings-deeplink.test.tsx`：① 令 `window.location.hash = '#import-export'` → render → 断言「Import / Export」分区可见（如存在 `getByRole('button', { name: 'Choose File to Import' })` 或 `<h2>Import / Export</h2>`）；② `#diagnostics` → 断言 Diagnostics 分区可见；③ 无 hash → 断言默认 Slots 分区；④ 派发 `hashchange`（hash 改为 `#rules`）→ 断言分区切换生效。在 jsdom 中通过 `Object.defineProperty(window, 'location', { value: { ...window.location, hash: '#import-export' }, writable: true })` 或 `window.location.hash = ...` + `window.dispatchEvent(new HashChangeEvent('hashchange'))` 驱动。
    - 扩展 `tests/unit/ui/sidebar-open-page.test.tsx`：**新增**一条用例断言点击 `Import or export` 时经 background 的 `OPEN_PAGE` payload 为 `{ url: 'chrome-extension://test-id/src/ui/settings/index.html#import-export' }`（**GE3 仅授权 append**：**不改**既有 4 用例）。
  - ⚠️ **RED 守卫**：当前 `SettingsApp` 无 hash 消费 → ①/②/④ 必失败（`#import-export` 时仍显示 Slots 分区）；当前 sidebar 目标是 `import-preview` → 新增 sidebar 用例必失败。构成有效 RED。
  - ⚠️ **测试环境注意**：既有 `sidebar-open-page.test.tsx` 的 `chrome.runtime.getURL` 是 `(path) => 'chrome-extension://test-id/' + path`（`:20`），故期望 URL 拼接须与之一致。

  **Must NOT do**:
  - 不改 `sidebar.test.tsx:206` 依赖的 `aria-label='Import or export'`。
  - 不删除 `import-preview` 页或改其内容（Out of Scope）。
  - **不改** `sidebar-open-page.test.tsx:61-121` 的 settings/diagnostics 既有 4 用例。
  - 不为 hash 消费引入 router 依赖（手写 `resolveSectionFromHash` 即可）。
  - 不改 `worker-orchestrator.ts` 的 `OPEN_PAGE` 处理（hash 传递已由 `openOrReusePage` 支持）。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 跨 `sidebar/App.tsx` + `settings/App.tsx`；且 hash-only 导航与 `hashchange` 监听的配合易「修好一半」（URL 变了但分区没变）。
  - **Skills**: [`sw-verification-before-completion`]
  - **Skills Evaluated but Omitted**: `sw-systematic-debugging`（根因已知：无 hash 消费）。

  **Parallelization**:
  - **Can Run In Parallel**: NO（独占 `sidebar/App.tsx` 串行链首）
  - **Parallel Group**: Wave 2
  - **Blocks**: U5（同文件 `sidebar/App.tsx`）
  - **Blocked By**: U2（同文件 `settings/App.tsx`）

  **References**:
  - **Pattern References**:
    - `src/ui/sidebar/App.tsx:1065-1067` — `handleOpenDiagnostics`（**同构范式**，P1 照此写）。
    - `src/ui/sidebar/App.tsx:1061-1063` — **被修复点**。
    - `src/ui/settings/App.tsx:1749` — `activeSection` 初值硬编码 `'slots'`（缺口）。
    - `src/shared/open-page.ts:44-50` — hash-only 导航（`tabs.update(id, {url})` 不重载），证明**必须**监听 `hashchange`。
  - **API/Type References**:
    - `src/ui/settings/App.tsx:28` — `SettingsSection` 联合类型（映射目标）。
    - `src/ui/settings/App.tsx:64-71` — `NAV_ITEMS` 的 id 集合（hash 取值域）。
  - **Test References**:
    - `tests/unit/ui/sidebar-open-page.test.tsx:18-32` + `:42` — `chrome` 桩与 `SETTINGS_URL` 常量（新增用例复用）。
    - `tests/unit/ui/sidebar.test.tsx:201-209` — 页脚三按钮既有断言（护栏）。
  - **WHY Each Reference Matters**: `open-page.ts:44-50` 是**关键**——它决定了「打开已存在的 settings 标签时不重载页面」仅靠改 hash 生效，故 `hashchange` 监听是必需项而非可选项；忽略它会让「第二次点击 Import/Export」静默失效。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新测试先运行 → **RED**（证据：`_context-output/evidence/task-U4-red.txt`）
  - [ ] `npx vitest run tests/unit/ui/settings-deeplink.test.tsx` → ALL PASS（≥ 4 tests）
  - [ ] `npx vitest run tests/unit/ui/sidebar-open-page.test.tsx` → ALL PASS（既有 4 + 新增 1）
  - [ ] `npm run test:unit` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 页脚 Import/Export 打开后落在导入导出分区
    Tool: Bash (test runner)
    Steps:
      1. sidebar: mock OPEN_PAGE 成功 → click name='Import or export'
      2. 断言 runtimeSendMessage 收到 payload.url 含 'settings/index.html#import-export'
      3. settings: hash='#import-export' → render → 断言导入/导出分区可见（非 Slots）
    Expected Result: 任务可达（与 #diagnostics 同构）
    Failure Indicators: 仍指向 import-preview / 打开后落在 Slots 分区
    Evidence: _context-output/evidence/task-U4-entry-reachable.txt

  Scenario: 既有 #diagnostics 深链同时被修复
    Tool: Bash (test runner)
    Steps:
      1. hash='#diagnostics' → render <SettingsApp />
      2. 断言 Diagnostics 分区可见（如 heading 'Diagnostics' 且 Export/Clear All 按钮存在）
    Expected Result: #diagnostics 实际生效（修复既有失效）
    Failure Indicators: 落在 Slots 分区（P1 附带的既有缺陷未修）
    Evidence: _context-output/evidence/task-U4-diagnostics-deeplink.txt

  Scenario: 已打开标签被 hash 导航时分区跟随
    Tool: Bash (test runner)
    Steps:
      1. render（无 hash → Slots）
      2. window.location.hash='#rules' 并 dispatchEvent(new HashChangeEvent('hashchange'))
      3. 断言 Rules 分区可见
    Expected Result: hashchange 被消费
    Failure Indicators: 分区不切换（未监听 hashchange）
    Evidence: _context-output/evidence/task-U4-hashchange.txt
  ```

  **Commit**: YES (Commit 4；Commit 2 已含 settings 部分)
  - Message: `feat(sidebar): route Import/Export footer to settings section (P1)`
  - Files: `src/ui/sidebar/App.tsx`, `src/ui/settings/App.tsx`, `tests/unit/ui/settings-deeplink.test.tsx`, `tests/unit/ui/sidebar-open-page.test.tsx`
  - Pre-commit: `npm run test:unit`

---

### Wave 3 — sidebar 串行链 2

- [ ] U5. **P2 + P6 + P8 — 槽位菜单：删除语义化 + 前置 Confirm + 显式编辑项**

  **What to do**:
  - **P6 文案统一（槽位删除语义）**：`sidebar/App.tsx:379` 菜单项 `Reset` → `Delete Slot`（带 `--danger` 类不变）；`handleUnbind`（`:994`）成功 Toast `Slot N unbound` → `Slot N deleted`；失败 Toast `:997` `Failed to unbind slot N` → `Failed to delete slot N`。
  - **P2 前置 Confirm**：`⋯` 菜单点击 `Delete Slot` 时**不**直接 `onUnbind`，改为 `setDeleteConfirm(slotNumber)`（SlotRow 内 state）；渲染 `<Confirm open={!!deleteConfirm} title="Delete Slot" message={`Delete slot ${n}? ...`} confirmLabel="Delete" variant="danger" onConfirm={...} onCancel={...} />`（复用 `@ui/shared/components` 的 `Confirm`，它内部用 `Dialog`）。
    - `onConfirm`：`setDeleteConfirm(null)` 后调用既有 `onUnbind(slotNumber)`（**仅**删除路径不变，仍发 `UNBIND_SLOT`）。
  - **P2 删除路径是否可撤销 — 【裁决 DR3：不做】（v2 已定，无歧义）**：
    - **裁决结果**：删除路径**不新增** UndoBar / 不新增撤销动作；**仅保留 Confirm 前置 + 文案统一**。撤销能力**继续仅服务覆盖路径**（现状不变，范围保真）。
    - **裁决理由（技术依据，供追溯）**：`UNDO_SAVE` 的恢复依赖 `pendingUndo` 快照，而快照**只在覆盖路径捕获**（`slot-service.ts:81`/`:125` 的 `captureBeforeOverwrite`）。删除路径**未**捕获 → 删除后 `UNDO_SAVE` 会走「无快照降级为删除」（`slot-service.ts:579-581`）→ **撤销无效**（槽位已删，再删一次）。要实现真正可撤销，**必须新增后台 action**（如 `CAPTURE_UNDO`）并在删除前捕获 → 越过「UI 层」边界，属**净新功能**。design spec §8:199 的既定要求只是「**二次确认**」，未要求「解绑可撤销」。
    - **仍照做的部分**：`UndoBar` 的 `label?: string` / `undoLabel?: string` 可选 prop 扩展**照做**（成本为零、提升可复用性、且**不改**默认文案以保 `sidebar-result-handling.test.tsx:127`）——本次不被删除路径使用，仅使组件就绪。
    - **若产品方要求「删除可撤销」**：作为**独立 feature 需求**单独立项（需显式授权跨层改动：后台 + `messages.ts`），**不在本计划内**。
  - **P8 显式编辑入口**：`⋯` 菜单（`:372-389`）在既有 `Delete Slot` / `Add to Global Rules` 之外新增三项：`Rename Slot…` → `onEditTitle(slotNumber, <行内编辑占位>)`；`Change Icon…` → `onEditIcon(slotNumber)`；`Edit URL…` → 触发既有 URL 编辑态。
    - ⚠️ `onEditTitle` 签名是 `(slotId, title: string)`（`SlotRowProps:129`，最终调 `UPDATE_SLOT_UI_MARKER`）。菜单项**不能**直接调用它（需先取得输入）。做法：菜单项改为「触发 SlotRow 内既有行内编辑态」——新增本地回调 `startTitleEdit()`（等价于既有 `handleTitleDoubleClick`，`:174-183` 的逻辑）与 `startUrlEdit()`（等价 `handleUrlDoubleClick`，`:200-207`）；`Change Icon…` 直接 `onEditIcon(slotNumber)`。
    - **双击保留**（`:247`/`:286`/`:297` 不变）作为快捷方式。
  - 补测试：
    - `tests/unit/ui/sidebar-slot-menu-delete.test.tsx`：① 点击 `Delete Slot` → 断言**未**立即发 `UNBIND_SLOT`，且出现确认框（`getByRole('dialog')` 含 Delete Slot）；② 点确认框 `Delete` → 断言发出 `UNBIND_SLOT {slotId}`；③ 点确认框 `Cancel` → 断言**未**发 `UNBIND_SLOT`；④ 菜单项文本为 `Delete Slot`（不再有 `Reset`）。
    - `tests/unit/ui/sidebar-modal-a11y.test.tsx` 由 U7 负责（P4）。
    - **GE1 更新** `tests/unit/ui/sidebar-result-handling.test.tsx`：`clickReset()` 改名/改流程为「开菜单 → 点 `Delete Slot` → 点确认框 `Delete`」；**`:80` 与 `:82` 两处**（`waitFor` 断言 + `fireEvent.click`）定位串 `'Reset'` → `'Delete Slot'`（**同串两现，遗漏 `:82` 会导致点击落空/测试不明原因变红**）；`:99` 期望子串 `Failed to unbind slot 1` → `Failed to delete slot 1`；`:104` 期望「不含」`Slot 1 unbound` → 改为「不含」`Slot 1 deleted`。**:99/:104 的 `some(...)` 判据结构原样保留**；**`:127` 的 `Undo overwrite of slot 1` 不动**（覆盖路径护栏）。
  - ⚠️ **RED 守卫**：当前菜单项为 `Reset` 且点击即 `UNBIND_SLOT`（无确认框）→ ①②④ 必失败；`sidebar-result-handling` 在**未**更新 GE1 前会因定位串不符而失败（属预期，更新后应通过）。有效 RED。
  - ⚠️ **菜单项数量**：已核查无「菜单项数量」断言（仅按名称取项），新增 3 项安全（Risks 表 R6 已闭合）。

  **Must NOT do**:
  - **不改** `DualCards.tsx` 的 `Remove`（P6 语义边界，见 Decisions Resolved in v1 #3）。
  - **不改** `src/ui/settings/RuleEditor.tsx:298` 的 `Delete Rule`（持久规则删除，语义已正确）。
  - **不做「删除路径可撤销」**（**裁决 DR3**）：不新增 UndoBar 到删除路径、不新增后台 action、不改 `messages.ts` / `worker-orchestrator.ts`。
  - 不删除 `UndoBar` 覆盖路径的既有默认文案 `Slot N overwritten` / `Undo overwrite of slot N`（`:423`/`:424` 保持）。
  - 不改 `Delete Slot` 在菜单中的 `--danger` 类语义。
  - 不删除双击编辑入口（P8 是**新增**入口，非替换）。
  - 不改 GE1 之外的任何测试文件。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 触碰 3 个 P 项、1 个新增确认流、3 个菜单项与 1 处既有测试流程改写（GE1），耦合面最大。
  - **Skills**: [`sw-verification-before-completion`, `sw-receiving-review`]
    - `sw-receiving-review`: GE1 是「授权改动既有测试」，须严格限于定位/流程，不得放宽判据——需技术化核对而非表演式同意。

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: U6
  - **Blocked By**: U4

  **References**:
  - **Pattern References**:
    - `src/ui/sidebar/App.tsx:372-389` — **被修复点**：`⋯` 菜单（`Reset` 项）。
    - `src/ui/sidebar/App.tsx:986-1003` — `handleUnbind`（删除链路，Toast 文案源）。
    - `src/ui/sidebar/App.tsx:406-429` — `UndoBar`（复用目标；`:424` 的 aria-label 是护栏）。
    - `src/ui/sidebar/DualCards.tsx:137-145` — **既有 Confirm 范式**（`Confirm` + danger variant），P2 照此写。
    - `src/ui/sidebar/App.tsx:174-183` / `:200-207` — 既有行内编辑启动逻辑（P8 的 `startTitleEdit`/`startUrlEdit` 复用其逻辑）。
    - `_context-output/designs/2026-07-14-tab-bookmark-shortcuts-ui-ux-design.md:199` — **权威依据**：槽位解绑须二次确认。
  - **API/Type References**:
    - `src/ui/shared/components.tsx:237-264` — `Confirm`（内部 `Dialog`，含 Escape/焦点管理）。
    - `src/ui/sidebar/App.tsx:114-133` — `SlotRowProps`（`onEditTitle`/`onEditIcon`/`onUpdateUrl` 既有回调）。
    - `src/ui/sidebar/App.tsx:81-85` — `UndoState`（若要扩展 `label`）。
  - **Test References**:
    - `tests/unit/ui/sidebar-result-handling.test.tsx:74-83`（内含 **`:80` 与 `:82` 两处 `'Reset'`**）+ `:99` + `:104` + `:127` — GE1 的改动/保留点（**Nit N1：`:80`/`:82` 两处均需改**）。
    - `tests/unit/ui/slot-add-to-global.test.tsx:86-95` — 菜单交互模板（开菜单 → 点项）。
    - `tests/unit/ui/dual-cards.test.tsx:43-60` — Confirm 交互模板（trigger + 确认框双按钮）。
  - **WHY Each Reference Matters**: `design spec §8:199` 把「二次确认」从「对照」升格为**既定设计约束**，是本任务 P2 不可裁剪的依据；`sidebar-result-handling.test.tsx:127` 的 `Undo overwrite of slot 1` 说明 UndoBar 的**默认**文案不可动，扩展必须走可选 prop。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新测试先运行 → **RED**（证据：`_context-output/evidence/task-U5-red.txt`）
  - [ ] `npx vitest run tests/unit/ui/sidebar-slot-menu-delete.test.tsx` → ALL PASS（≥ 4 tests）
  - [ ] `npx vitest run tests/unit/ui/sidebar-result-handling.test.tsx` → ALL PASS（GE1 更新后，2 用例判据结构不变）
  - [ ] `npm run test:unit` → ALL PASS
  - [ ] `npm run test:ui-smoke` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 删除槽位需先确认（取消则保留）
    Tool: Bash (test runner)
    Steps:
      1. 开 slot 1 菜单 → 点 'Delete Slot'
      2. 断言未收到 UNBIND_SLOT（立即）
      3. 断言 getByRole('dialog') 内文本含 'Delete Slot'
      4. 点 'Cancel' → 断言仍未收到 UNBIND_SLOT
    Expected Result: 破坏性操作被拦截
    Failure Indicators: 未弹确认框即发出 UNBIND_SLOT（原 P2 缺陷）
    Evidence: _context-output/evidence/task-U5-confirm-blocks.txt

  Scenario: 确认后执行删除且文案统一
    Tool: Bash (test runner)
    Steps:
      1. 同上，点确认框 'Delete'
      2. 断言收到 UNBIND_SLOT {slotId:1}
      3. 断言成功 Toast 文本为 'Slot 1 deleted'（非 'unbound'）
    Expected Result: 文案与行为一致（P2+P6）
    Failure Indicators: Toast 仍为 'unbound' / 菜单项仍为 'Reset'
    Evidence: _context-output/evidence/task-U5-confirm-executes.txt

  Scenario: 失败路径如实报错（既有判据不放宽）
    Tool: Bash (test runner)
    Steps:
      1. mock UNBIND_SLOT 返回 {success:false}
      2. 走确认流 → 断言 alert 含 'Failed to delete slot 1'，且不含 'Slot 1 deleted'
    Expected Result: 失败不被报成成功
    Failure Indicators: 显示成功文案
    Evidence: _context-output/evidence/task-U5-failure-honest.txt

  Scenario: P8 菜单显式编辑入口可用
    Tool: Bash (test runner)
    Steps:
      1. 开 slot 1 菜单 → 断言 menuitem 'Change Icon…' 存在 → click → 断言 icon 编辑模态出现
      2. 断言 menuitem 'Rename Slot…' / 'Edit URL…' 存在
    Expected Result: 无需双击即可进入编辑
    Failure Indicators: 菜单仅 2 项 / 编辑入口不可用
    Evidence: _context-output/evidence/task-U5-explicit-edit.txt
  ```

  **Commit**: YES (Commit 5)
  - Message: `fix(sidebar): confirm before deleting a slot, unify delete wording, add explicit edit entries (P2, P6, P8)`
  - Files: `src/ui/sidebar/App.tsx`, `src/ui/shared/components.tsx`（若扩展 UndoBar label）, `tests/unit/ui/sidebar-result-handling.test.tsx`, `tests/unit/ui/sidebar-slot-menu-delete.test.tsx`
  - Pre-commit: `npm run test:unit`

---

### Wave 4 — sidebar 串行链 3

- [ ] U6. **P3 — 侧边栏加载失败渲染显式错误态 + Retry（不再伪装为空配置）**

  **What to do**:
  - `src/ui/sidebar/App.tsx:1318-1324`：在既有 `if (state.loading)` 之后、`const slots = ...` 之前插入错误态分支：`if (state.error)` → 渲染显式错误区（`role="alert"`，文本含既有 `state.error` 值 `'Failed to load state'`）+ `Retry` 按钮（`onClick={() => { void loadState(); }}`）。**互斥**：错误态与 loading 态不同时渲染（loading 分支在前，天然互斥）。
    - 边界：`state.error` 存在时**不**渲染 10 个空槽位列表（必须早于 `:1326` 的 `slots` 计算与槽位渲染）。
  - `loadState`（`:735-771`）：加载开始时 `setState(prev => ({...prev, loading: true, error: null}))`；`catch` 分支保持写 `error: 'Failed to load state'`（`:769` 既有）；成功分支清 `error: null`（`:759-764` 补 `error: null`）。
  - `Retry` 按钮须可重试成功：重试前 `error` 清空 → loading → 成功渲染槽位列表。
  - 补测试 `tests/unit/ui/sidebar-error-state.test.tsx`：① 令 `mockSendMessage` reject（模拟后台不可用）→ 断言 `role="alert"` 文本含 `Failed to load state` 且存在 `Retry` 按钮；② 断言**不**渲染 10 个空槽位（如 `queryAllByText('Empty')` 长度为 0）；③ 点 `Retry` 前令 mock 转成功 → 断言槽位列表渲染（`list` name='10 bookmark slots'）。
  - ⚠️ **RED 守卫**：当前代码**从不**渲染 `state.error`（全仓 0 处读取，已核实）→ ①② 必失败（无 alert、无 Retry，且渲染了 10 个 Empty 槽位）。有效 RED。
  - ⚠️ **注入时机**：错误态测试须让 `GET_STATE` reject 而**不**影响 `GET_COMMANDS`/`chrome.tabs.query`（否则干扰）。参照 `tests/unit/ui/sidebar-regex-display.test.tsx:47-57` 的**最小 chrome 桩**（只含 `runtime.sendMessage` + `tabs.query`）以避免 `hasTabsApi()` 分支副作用。

  **Must NOT do**:
  - 不改 `:769` 的错误文案来源（沿用既有 `'Failed to load state'` 字符串，不新造字符串）。
  - 不删除既有 loading 分支（`:1318-1324`）。
  - 不改 `sidebar.test.tsx` 等 18 个既有 UI 测试的任何断言。
  - 不引入错误边界（ErrorBoundary）或新依赖。

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`sw-verification-before-completion`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4
  - **Blocks**: U7
  - **Blocked By**: U5

  **References**:
  - **Pattern References**:
    - `src/ui/sidebar/App.tsx:1318-1324` — 既有 loading 态（错误态插入点）。
    - `src/ui/sidebar/App.tsx:1326` — `const slots = state.sync?.slots ?? []`（**必须在错误态之后**，否则 Empty 槽位仍渲染）。
    - `src/ui/sidebar/App.tsx:769` — `error: 'Failed to load state'` 写入点（既有，0 处消费）。
    - `src/ui/recovery/App.tsx:87` — 既有 `role="alert"` 错误范式（风格对照）。
  - **API/Type References**:
    - `src/ui/sidebar/App.tsx:69-79` — `SidebarState`（含 `loading`/`error` 字段）。
  - **Test References**:
    - `tests/unit/ui/sidebar-regex-display.test.tsx:47-57` — 最小 chrome 桩模板（避免 `hasTabsApi` 干扰）。
    - `tests/unit/ui/sidebar.test.tsx:84-94` — `list` name='10 bookmark slots' 既有定位（新测试复用）。
  - **WHY Each Reference Matters**: `:1326` 的 `slots` 计算与渲染是「伪装为空配置」的**机制根源**，错误态分支必须前置；`sidebar-regex-display.test.tsx` 的最小桩能避免 `chrome.storage.onChanged` 等缺失导致的假红。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新测试先运行 → **RED**（证据：`_context-output/evidence/task-U6-red.txt`）
  - [ ] `npx vitest run tests/unit/ui/sidebar-error-state.test.tsx` → ALL PASS（≥ 3 tests）
  - [ ] `npm run test:unit` → ALL PASS
  - [ ] `npm run test:ui-smoke` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 加载失败 → 显式错误态 + Retry（非空配置）
    Tool: Bash (test runner)
    Steps:
      1. mockSendMessage 对 GET_STATE reject
      2. render → 断言 getByRole('alert') 含 'Failed to load state'
      3. 断言存在 name=Retry 的按钮
      4. 断言 queryAllByText('Empty').length === 0（不渲染 10 空槽位）
    Expected Result: 失败被如实呈现
    Failure Indicators: 显示 10 个 Empty 槽位（原 P3 缺陷）
    Evidence: _context-output/evidence/task-U6-error-state.txt

  Scenario: Retry 后恢复
    Tool: Bash (test runner)
    Steps:
      1. 初始 GET_STATE reject → 错误态
      2. mock 转为成功（含 1 个 slot）→ 点击 Retry
      3. 断言 getByRole('list', {name:'10 bookmark slots'}) 出现，alert 消失
    Expected Result: 重试可恢复
    Failure Indicators: Retry 无响应 / alert 与列表同时存在
    Evidence: _context-output/evidence/task-U6-retry-recovers.txt
  ```

  **Commit**: YES (Commit 6)
  - Message: `fix(sidebar): surface load failure with retry (P3)`
  - Files: `src/ui/sidebar/App.tsx`, `tests/unit/ui/sidebar-error-state.test.tsx`
  - Pre-commit: `npm run test:unit`

---

### Wave 5 — sidebar 串行链尾

- [ ] U7. **P4 — 两个手写模态改用既有 `Dialog` 原语（Escape / 焦点陷阱 / 焦点还原）**

  **What to do**:
  - `IconEditorModal`（`sidebar/App.tsx:444-471`）：把 `<div className="tbs-modal-overlay" role="dialog" aria-modal="true" aria-label="Change tab icon">` 包裹改为 `<Dialog open onClose={onCancel} title="Change Icon" footer={<>...</>}>`。
    - 表单内容（`IconEditor` + 提示）作为 `children`。
    - footer：`Reset`（若有 `onReset`）/ `Cancel` / `Apply`（`handleApply`）移入 `footer` prop。
    - 保留 `aria-label` 语义：`Dialog` 用 `title` 生成 `aria-label`（`components.tsx:153`），故 `title="Change Icon"` 即可（原 `aria-label` 为 `Change tab icon`，改用标题文本更一致且不违背任何断言——已核查无该 aria-label 断言）。
  - `CreateRuleModal`（`:484-690`）：同样改用 `Dialog`（`title="New Global Page Rule"`，`footer` 放 Cancel/Save）。表单各 section 作为 `children`。
  - **不改** 模态内部的任何表单逻辑、state、handleSave/handleApply 行为。
  - 因 `Dialog` 自带 Escape（`components.tsx:121-124`）与 Tab 陷阱（`:126-140`）与焦点还原（`:114-116`），两模态自动获得 P4 三项能力。
  - 补测试 `tests/unit/ui/sidebar-modal-a11y.test.tsx`：
    - ① 打开 Icon 编辑模态（通过菜单 `Change Icon…` 或既有双击路径）→ 按 `Escape` → 断言模态关闭（`queryByRole('dialog')` 为空）。
    - ② 打开模态后断言焦点在模态内（`document.activeElement` 是模态内元素）。
    - ③ 关闭后断言焦点还原到触发元素（`document.activeElement` 为原按钮）。
    - ④ Tab 循环：在末个可聚焦元素上 Tab → 断言焦点回到首个（`Dialog` 陷阱）。
  - ⚠️ **RED 守卫**：当前两模态为手写 `<div role="dialog">`，无 Escape/陷阱/焦点还原 → ①③④ 必失败（按 Escape 无反应；关闭后焦点不还原）。有效 RED。
  - ⚠️ **CSS**：`Dialog` 使用 `tbs-dialog-overlay`/`tbs-dialog*`（`base.css:147-185` 已有）；切换后 `tbs-modal-overlay` 类不再被这两处使用（**保留 CSS 不删**，避免影响其它使用方与 Out of Scope 原则）。视觉变化在容许范围（R5）。

  **Must NOT do**:
  - 不改 `Dialog` 原语本身（`components.tsx:102-169`）——它是复用目标，非修改对象。
  - 不删除 `tbs-modal*` CSS 规则（可能有其它使用方；删除属范围外清理）。
  - 不改模态内的表单字段、`aria-label`、`name`、按钮文本（除容器层）。
  - 不改 `tokens-components.test.tsx:43-64` 的 `Dialog` 既有断言。
  - 不删除双击编辑入口。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 可访问性原语迁移 + 焦点行为验证；「焦点还原」在 jsdom 中需精细构造，易假绿。
  - **Skills**: [`sw-verification-before-completion`, `sw-ui-ux-review`]
    - `sw-ui-ux-review`: 焦点/键盘可达性属其覆盖维度（状态可见性、用户控制感、无障碍）。

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 5
  - **Blocks**: U8
  - **Blocked By**: U6

  **References**:
  - **Pattern References**:
    - `src/ui/shared/components.tsx:102-169` — **复用目标** `Dialog`（含 `:106-117` 焦点保存/还原、`:121-124` Escape、`:126-140` Tab 陷阱）。
    - `src/ui/sidebar/App.tsx:444-471` — **被修复点 1**：`IconEditorModal`。
    - `src/ui/sidebar/App.tsx:484-690` — **被修复点 2**：`CreateRuleModal`（含 `:542-543` 手写 overlay）。
    - `src/ui/settings/App.tsx` / `src/ui/sidebar/DualCards.tsx` — 既有「用 `Confirm`/`Dialog`」的范式对照。
  - **API/Type References**:
    - `src/ui/shared/components.tsx:93-100` — `DialogProps`（`open`/`onClose`/`title`/`children`/`footer`）。
  - **Test References**:
    - `tests/unit/ui/tokens-components.test.tsx:43-64` — `Dialog` 的 Escape 既有断言（证明原语能力，护栏）。
    - `tests/unit/ui/slot-add-to-global.test.tsx:86-95` — 打开 `CreateRuleModal` 的既有流程（新测试可复用其 mock 与菜单流）。
  - **WHY Each Reference Matters**: `components.tsx:102-169` 是 P4 的**唯一真源**——复用即得三项能力，无需新写焦点管理；`tokens-components.test.tsx:43-64` 证明该原语的能力**已被测试锁定**，故迁移后可依赖。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新测试先运行 → **RED**（证据：`_context-output/evidence/task-U7-red.txt`）
  - [ ] `npx vitest run tests/unit/ui/sidebar-modal-a11y.test.tsx` → ALL PASS（≥ 4 tests）
  - [ ] `npx vitest run tests/unit/ui/slot-add-to-global.test.tsx` → ALL PASS（无回归）
  - [ ] `npm run test:unit` → ALL PASS
  - [ ] **既有定位回归检查点（Nit N4 — Dialog 迁移的显式风险点）**：`slot-add-to-global.test.tsx` 经以下定位串访问模态内元素，迁移后**必须仍然成立**：
    1. `:94` `getByLabelText('Match URL')` —— `CreateRuleModal` 的 URL 输入（`sidebar/App.tsx:547` 的 `htmlFor="rule-url"`），迁入 `Dialog` 后仍作为 `children` 渲染，`id`/`label` 关联不变；
    2. `:144` `getByRole('button', { name: 'Save' })` —— 迁入 `Dialog` 的 `footer` prop 后仍以 `name='Save'` 可达；
    3. `:86-96` 的 `openSlotAddToGlobal` 流程（开菜单 → 点 `Add to Global Rules` → 等 `Match URL` 出现）不受容器替换影响。
    - **已复核无影响的断言**：该文件**无**标题层级断言（`h3`→`h2` 无感）、**无**按钮数量断言（新增 `Close dialog` 无感）——已用 `rg` 确认仅命中 `getByLabelText('Match URL')` 与 `name:'Save'` 两类定位。

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Escape 关闭两个模态
    Tool: Bash (test runner)
    Steps:
      1. 打开 Icon 编辑模态 → fireEvent.keyDown(dialog, {key:'Escape'}) → 断言模态关闭
      2. 打开 Create Rule 模态 → 同上
    Expected Result: Escape 生效
    Failure Indicators: 按 Escape 无反应（手写模态缺陷）
    Evidence: _context-output/evidence/task-U7-escape.txt

  Scenario: Dialog 迁移后既有模态内定位仍成立（Nit N4）
    Tool: Bash (test runner)
    Steps:
      1. npx vitest run tests/unit/ui/slot-add-to-global.test.tsx → 断言 6 用例全绿
      2. 该文件经 getByLabelText('Match URL')（:94）与 name:'Save'（:144）定位模态内元素
      3. 人工核对（静态）：rg -n "getByRole\\('heading'|getAllByRole\\('button'\\)" tests/unit/ui/slot-add-to-global.test.tsx → 期望 0 命中（无标题/数量断言）
    Expected Result: 迁移不破坏既有定位（无标题层级、无按钮数量依赖）
    Failure Indicators: slot-add-to-global 出现红 → Dialog 改动越界（如改了 label/id 关联或按钮文本）
    Evidence: _context-output/evidence/task-U7-modal-locators.txt

  Scenario: 焦点陷阱与焦点还原
    Tool: Bash (test runner)
    Steps:
      1. 记录触发按钮为 trigger；点击打开模态
      2. 断言 document.activeElement 在 dialog 内
      3. 在最后一个可聚焦元素上 keyDown Tab → 断言 activeElement 回到首个
      4. Escape 关闭 → 断言 activeElement === trigger
    Expected Result: 焦点被约束且还原
    Failure Indicators: 焦点逃逸到模态外 / 关闭后焦点丢失
    Evidence: _context-output/evidence/task-U7-focus.txt
  ```

  **Commit**: YES (Commit 7)
  - Message: `fix(sidebar): use accessible Dialog primitive for modals (P4)`
  - Files: `src/ui/sidebar/App.tsx`, `tests/unit/ui/sidebar-modal-a11y.test.tsx`
  - Pre-commit: `npm run test:unit`

- [ ] U8. **P9 + P12 — 全仓 CJK 英文化（12 行）+ Toast 时长统一**

  **What to do**:

  > **v2 范围（决策已裁决）**：P9 边界由「同一表单内混排消除」**扩展为「全仓 12 行 CJK 全部英文化」**（裁决 DR1 EN 定调 + 裁决 DR4 `IconEditor` + 裁决 DR5 `settings:323`）。下表的 12 行即本任务的**完整清单**，逐行核对不得遗漏。

  - **P9 — 全仓 CJK 英文化（12 行，逐项列出）**：

    | # | 文件:行 | 现值（CJK） | 成品文案（英文） |
    |---|---------|------------|----------------|
    | 1 | `src/ui/sidebar/App.tsx:585` | `✓ 已自动转换为正则表达式: {pattern}` | `✓ Auto-converted to regex: {pattern}` |
    | 2 | `src/ui/settings/App.tsx:95` | `未设置`（`cmd.shortcut ?? '未设置'`） | `Not set` |
    | 3 | `src/ui/settings/App.tsx:141` | `A. 会话标签优先 — tabId 存在即切换` | `A. Session tab first — switch when tabId exists` |
    | 4 | `src/ui/settings/App.tsx:151` | `B. 会话标签 + 规则校验（默认）— tabId 存在且 URL 仍匹配` | `B. Session tab + rule check (default) — tabId exists and URL still matches` |
    | 5 | `src/ui/settings/App.tsx:161` | `C. 严格规则匹配 — 忽略 tabId，仅 URL/正则查找` | `C. Strict rule match — ignore tabId, resolve by URL/regex only` |
    | 6 | `src/ui/settings/App.tsx:187` | `继承全局 ({globalStrategy})` | `Inherit global ({globalStrategy})` |
    | 7 | `src/ui/settings/App.tsx:188` | `A — 会话标签优先` | `A — Session tab first` |
    | 8 | `src/ui/settings/App.tsx:189` | `B — 会话 + 规则校验` | `B — Session + rule check` |
    | 9 | `src/ui/settings/App.tsx:190` | `C — 严格规则匹配` | `C — Strict rule match` |
    | 10 | `src/ui/settings/App.tsx:323` | `规则已被其他操作修改，请刷新后重试` | `This rule was modified elsewhere. Refresh and try again.` |
    | 11 | `src/ui/components/IconEditor.tsx:242` | `placeholder="🚀、A、文档"` | `placeholder="🚀, A, Doc"`（`、` 与 `文档` 须英文化） |
    | 12 | `src/ui/components/IconEditor.tsx:287` | `{showUpload ? '▼' : '▶'} 或上传图标文件` | `{showUpload ? '▼' : '▶'} or upload an icon file` |

    - **⚠️ #10 的真实宿主（Blocker B3）**：该文案位于 **`src/ui/settings/App.tsx:323`**，宿主组件是 `settings/App.tsx:246` 的 `InlineRuleEditor`（不是 `RuleEditor.tsx`）。**不得**去 `src/ui/settings/RuleEditor.tsx` 找该文案——该文件 `:323` 是 `</section>`，不含任何 CJK；其 `:298` 的 `Delete Rule` 语义已正确、**不需改动**。
    - **⚠️ #10 受测试锁定（裁决 DR5：改）**：`tests/unit/ui/inline-rule-editor.test.tsx:222` 断言该中文字串 → 必须同步更新为英文（**GE2 生效**；判据结构 `toHaveTextContent` **不放宽**）。
    - **⚠️ 一致性参照**：`sidebar/App.tsx:589` 的 `✓ Valid regex` 已英文，保持不变；`:591` 的 `✗ {e.message}` 不变。
    - **已复核无测试锁定**：#3–#9（`rg '会话标签优先|继承全局|严格规则匹配|规则校验' tests` = 0 命中）、#11/#12（`rg '上传图标文件|Text / Emoji' tests` = 0 命中）——均可安全英文化。

  - **P12（Toast 时长）**：`src/ui/sidebar/App.tsx:1608` 的 `duration={3000}` → **删除该 prop**（取 `Toast` 默认 `5000`，`components.tsx:185`），使 sidebar 与 `import-preview/App.tsx:224`（5000）及共享默认一致。
    - **推荐**：省略 prop 而非写 `5000`（单一真源 = 默认值）；**备选**：显式 `duration={5000}`。二者择一，推荐前者。
    - **不抽常量（裁决：不抽）**：不将 `5000` 抽为 `components.tsx` 导出常量，避免过度抽象。
  - 补测试：
    - 扩展 `tests/unit/ui/sidebar-regex-display.test.tsx` **新增**一条用例（**不改**既有 2 条）：令用户输入通配符并切到 regex → 断言 `role="status"` 文本含 `Auto-converted to regex` 且**不含** CJK。
    - P9 settings 文案断言置于 `tests/unit/ui/settings.test.tsx` **新增**用例（不改既有）：断言 `未设置` 不再出现、`Not set` 出现。
    - **新增 CJK 全域静态守卫 `tests/unit/ui/no-cjk-in-ui.test.tsx`（v2 新增，覆盖裁决 DR1/DR4/DR5）**：用 `readFileSync` 递归扫描 `src/ui/**/*.{ts,tsx}`，断言**全仓 0 行 CJK**（正则 `[\u4e00-\u9fff]`）。该测试在修复前**必失败**（当前 12 行命中），是裁决 DR1/DR4/DR5 的统一闭环证据；亦防止后续回归。
    - P12：新增断言（置于 `sidebar-regex-display.test.tsx` 或新文件）：渲染 sidebar 后 Toast 自动消失时间 > 3000ms（fake timers 推进 3000ms 断言 Toast 仍在，推进到 5000ms 后消失）。**注意**：`Toast` 的 `onDismiss` 由 sidebar state 驱动，需触发一次成功 Toast（如 save）后再计时。
  - ⚠️ **RED 守卫**：当前 `:585`/`未设置`/策略文案/`IconEditor` 两处为中文、`duration={3000}` → 上述断言**全部必失败**（含新增的 CJK 全扫守卫命中 12 行）。有效 RED。
  - ⚠️ **P12 测试的坑**：`Toast` 的 `useEffect`（`components.tsx:186-191`）在 `duration`/`onDismiss` 变化时重置计时；须确保断言期间 `onDismiss` 引用稳定，否则计时被反复重置导致假通过。采用「渲染后立即断言 `getByRole('alert')` 存在，推进 3000ms 仍在，推进至 5000ms 后消失」并避免中间触发 state 更新。

  **Must NOT do**:
  - ❌ **不得**改动 `src/ui/settings/RuleEditor.tsx`（该文件**不含** VERSION_CONFLICT 文案——Blocker B3；其 `:298` `Delete Rule` 语义已正确）。
  - ❌ **不得**放宽 GE2 的 `toHaveTextContent` 判据（只改字串字面量，不改断言形式）。
  - ❌ **不得**为消除 CJK 而改动任何 `aria-label` / `role` / `name` / 测试定位串（英文串本就合规；CJK 仅出现在可见文本与 placeholder 中，已逐行核对）。
  - 不删除 `Toast` 的 `duration` prop 定义或改共享默认 `5000`（`components.tsx:185`）。
  - 不把 `5000` 抽为导出常量（裁决：不抽）。
  - 不改 GE2 之外的既有测试断言（#3–#9、#11、#12 均已复核无测试锁定，只改产品代码，**不动测试**）。
  - 不改 `src/ui/settings/App.tsx` 的 `DiagnosticsSection` / `ImportExportSection`（U2/U4 已触碰或即将触碰，本任务只改文案行）。

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`sw-verification-before-completion`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 5（串行于 U7 之后）
  - **Blocks**: F1–F4
  - **Blocked By**: U7

  **References**:
  - **Pattern References**:
    - `src/ui/sidebar/App.tsx:585` — **被修复点 #1**（中文正则提示）。
    - `src/ui/sidebar/App.tsx:589` — 相邻英文 `✓ Valid regex`（目标一致性）。
    - `src/ui/sidebar/App.tsx:1608` — `duration={3000}`（P12）。
    - `src/ui/settings/App.tsx:95` — **被修复点 #2**（`未设置`）。
    - `src/ui/settings/App.tsx:141,151,161,187,188,189,190` — **被修复点 #3–#9**（策略描述/下拉选项整段中文）。
    - `src/ui/settings/App.tsx:321-325` — **被修复点 #10**（VERSION_CONFLICT 文案分支；**宿主为同文件 `:246` 的 `InlineRuleEditor`**，**Blocker B3 修正点**）。
    - `src/ui/components/IconEditor.tsx:242,287` — **被修复点 #11–#12**（placeholder / 折叠文案；**裁决 DR4**）。
  - **API/Type References**:
    - `src/ui/shared/components.tsx:175-185` — `ToastProps.duration` 与默认 `5000`（单一真源）。
    - `src/ui/import-preview/App.tsx:224` — `duration={5000}` 既有显式值（一致性参照，**不改**）。
  - **Test References**:
    - `tests/unit/ui/sidebar-regex-display.test.tsx:59-87` — 既有 2 用例（护栏，不改；新增第 3 条）。
    - `tests/unit/ui/settings.test.tsx:47-64` — 既有行数（22）与 StatusBadge 断言（护栏；新增文案断言）。
    - `tests/unit/ui/inline-rule-editor.test.tsx:212-224` — **GE2 定位点**（`:222` 中文字串 → 英文，裁决 DR5）。
    - `tests/unit/ui/sidebar-open-page-helper.test.tsx:80` — `readFileSync` 静态断言范式（新 CJK 守卫测试照此写）。
  - **WHY Each Reference Matters**: `components.tsx:185` 的默认 `5000` 是 P12 的单一真源，故「省略 prop」优于「硬写 5000」；`sidebar-regex-display.test.tsx` 已在渲染 sidebar 并驱动 regex 路径，是 P9 断言的最低成本落点；`settings/App.tsx:321-325`（**非 `RuleEditor.tsx`**）是 B3 修正后的真实锚点——引用错误会导致该文案漏改。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新断言先运行 → **RED**（证据：`_context-output/evidence/task-U8-red.txt`）
  - [ ] `npx vitest run tests/unit/ui/sidebar-regex-display.test.tsx` → ALL PASS（既有 2 + 新增）
  - [ ] `npx vitest run tests/unit/ui/settings.test.tsx` → ALL PASS（既有护栏 + 新增文案断言）
  - [ ] `npx vitest run tests/unit/ui/inline-rule-editor.test.tsx` → ALL PASS（**GE2 生效**，`:222` 定位串已同步英文；**裁决 DR5 确定生效，非条件**）
  - [ ] `npx vitest run tests/unit/ui/no-cjk-in-ui.test.tsx` → ALL PASS（**全仓 0 行 CJK**，覆盖裁决 DR1/DR4/DR5）
  - [ ] `rg -n '[\u4e00-\u9fff]' src/ui` → **0 命中**（最终人工核对，与上一条互为佐证）
  - [ ] `npm run test:unit` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: sidebar 正则提示为英文（无混排）
    Tool: Bash (test runner)
    Steps:
      1. 在 Create Rule 模态输入通配符并选 regex
      2. 断言 role=status 文本匹配 /Auto-converted to regex/
      3. 断言该文本不含 CJK（/[\u4e00-\u9fff]/ 不命中）
    Expected Result: 同一表单无中英混排
    Failure Indicators: 仍显示 '已自动转换为正则表达式'
    Evidence: _context-output/evidence/task-U8-no-mixed-lang.txt

  Scenario: Toast 时长统一为默认 5000ms
    Tool: Bash (test runner, fake timers)
    Steps:
      1. 触发一次成功 Toast（save slot）→ 断言 alert 存在
      2. advanceTimersByTime(3000) → 断言 alert 仍存在（旧代码 3000 时会消失）
      3. advanceTimersByTime(2000) → 断言 alert 消失
    Expected Result: 停留 5s
    Failure Indicators: 3000ms 即消失
    Evidence: _context-output/evidence/task-U8-toast-duration.txt

  Scenario: 设置页快捷键占位文案为英文
    Tool: Bash (test runner)
    Steps:
      1. render <SettingsApp />（21 命令中 18 无快捷键）
      2. 断言 getByText('Not set') 出现 ≥1；queryByText('未设置') 为 null
    Expected Result: 占位文案英文
    Failure Indicators: 仍显示 '未设置'
    Evidence: _context-output/evidence/task-U8-settings-not-set.txt
  ```

  **Commit**: YES (Commit 8)
  - Message: `chore(ui): align page language and unify toast duration (P5, P9, P12)`
  - Files: `src/ui/sidebar/App.tsx`, `src/ui/settings/App.tsx`, **`src/ui/components/IconEditor.tsx`**, `tests/unit/ui/sidebar-regex-display.test.tsx`, `tests/unit/ui/settings.test.tsx`, `tests/unit/ui/inline-rule-editor.test.tsx`, `tests/unit/ui/no-cjk-in-ui.test.tsx`
  - ~~`src/ui/settings/RuleEditor.tsx`~~ **【v2 移除：该文件不含 VERSION_CONFLICT 文案；真实落点为 `src/ui/settings/App.tsx:323`（Blocker B3）】**
  - Pre-commit: `npm run test:unit && npm run build:chrome`

### Wave 1（续）— U9（与 U1–U3 并行；文件中列于此处便于阅读，执行归属 Wave 1）

- [ ] U9. **P5 — 入口页 `lang` 声明与界面文案对齐（`zh-CN` → `en`）**

  **What to do**:
  - 把 `src/ui/{sidebar,settings,recovery,import-preview,conflict-confirm}/index.html:2` 的 `<html lang="zh-CN">` 改为 `<html lang="en">`（**5 个固定白名单**）。
  - ⚠️ **计数口径（Nit N5，v2 修正）**：全仓 `lang="zh-CN"` 的入口页实为 **6 个**（v1 误称「4 个」）：`sidebar` / `settings` / `import-preview` / `candidate-selector` / `conflict-confirm` / `recovery`。其中 **`candidate-selector/index.html` 随 P10 由 U1 删除**，故本任务只需改**其余 5 个**。
  - ⚠️ **验收口径（v3 Blocker BLK-U9 最终落实，采用固定白名单）**：U9 的断言**仅限定为 U9 自己负责的 5 个白名单入口页**（`sidebar` / `settings` / `recovery` / `import-preview` / `conflict-confirm`），断言这 5 个均含 `lang="en"` 且不含 `lang="zh-CN"`。
    - **不再**「动态枚举 `src/ui/*/index.html`」，**不再**断言「`src/ui` 全目录 0 命中 `zh-CN`」——因为这两者**均会覆盖**归 U1 删除的 `candidate-selector/index.html`，会使 U9 在 **U1 完成前必红**（与「U9 不改不删该文件」自相矛盾，即 v3 Blocker）。
    - 职责移交：**`candidate-selector` 目录不存在** → U1 守卫测试 `candidate-selector-removed.test.ts` 独占；**全仓无 `zh-CN` / 无 CJK 兜底** → U8 的 `no-cjk-in-ui.test.tsx` 独占。
  - 补测试 `tests/unit/ui/page-lang.test.tsx`（**v3 固定白名单，Nit N2 真正落实**）：
    - ① 对**固定白名单 5 个路径**逐一 `readFileSync` 断言「含 `lang="en"`」；
    - ② 对**同一 5 个路径**断言「不含 `lang="zh-CN"`」；
    - ③ **【v2/v3 移除】** ~~动态枚举现存入口目录~~、~~断言 `src/ui` 全目录 `lang="zh-CN"` = 0 命中~~、~~断言 `src/ui/candidate-selector` 目录不存在~~ → 前两项**因覆盖面包含候选页而删除**（职责移交 U8 的 `no-cjk-in-ui.test.tsx`），第三项**移交 U1 守卫测试**。理由：这些断言都会让 U9 隐式依赖 U1 的完成状态，构成**跨任务断言耦合**（违反并行安全）。
  - ⚠️ **RED 守卫（v3，说明不含 candidate-selector）**：当前**这 5 个白名单文件均**为 `lang="zh-CN"` → ①② 必失败。有效 RED（**不依赖 U1**，因为断言集**不含** `candidate-selector/index.html`）。

  **Must NOT do**:
  - 不改 `<title>` 文本。
  - **不得**断言 `candidate-selector` 目录是否存在，**也不得**断言 `src/ui` 全目录内 `lang="zh-CN"` 命中数（**Nit N2 / v3 Blocker BLK-U9**：前者归 U1 守卫测试，后者归 U8 的 `no-cjk-in-ui.test.tsx`；U9 只断言自身 5 个白名单文件）。
  - **不删除、不修改** `candidate-selector/index.html`（那是 U1 的职责；**U9 不打开该文件**）——此点保留，且与上文白名单断言**不再冲突**（白名单不含该文件）。
  - ⚠️ **不得**扫描 `src/ui` 全目录下「现存的所有 `index.html`」——白名单是**硬编码的 5 个路径**，不是目录枚举，以保证 U9 独立于 U1。
  - 不新建 locale/i18n 框架（P5 只对齐声明，不引入 i18n 系统）。
  - 不改 `manifests/*.json` 的 `default_locale`（无该项，且属构建配置）。

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`sw-verification-before-completion`]

  **Parallelization**:
  - **Can Run In Parallel**: YES（纯静态文件，与 U1 无文件冲突——U1 删除 candidate-selector，U9 只改其 5 个白名单 `index.html`）
  - **Parallel Group**: Wave 1（可与 U1/U2/U3 并行；U9 与 U1 **无重叠文件且无重叠断言**，**v3 已真正解除断言耦合**）
  - **Blocks**: F1–F4
  - **Blocked By**: **None**（v3 修正：v1 曾记依赖；v2 声称已解耦但断言仍覆盖候选页 → 实为**未解耦**（BLK-U9）；**v3 改为固定白名单后依赖才真正消除**——U9 断言不含 `candidate-selector/index.html`，故 U1 是否完成均不影响 U9 通过）

  **References**:
  - **Pattern References**:
    - `src/ui/sidebar/index.html:2` / `settings/index.html:2` / `recovery/index.html:2` / `import-preview/index.html:2` / `conflict-confirm/index.html:2` — **5 个待改文件 = 测试的固定白名单**（均实测含 `lang="zh-CN"`）。
    - `src/ui/candidate-selector/index.html:2` — **第 6 个**（由 U1 删除）。**本任务不改不删，且不进白名单、不参与测试枚举**——仅作计数口径说明（全仓实测 6 命中）。
  - **API/Type References**: 无。
  - **Test References**:
    - `tests/unit/ui/sidebar-open-page-helper.test.tsx:80` — 既有「读源码文件 + 断言」的范式（`readFileSync` + `resolve(process.cwd(), ...)`），新测试照此写。
  - **WHY Each Reference Matters**: `sidebar-open-page-helper.test.tsx` 证明项目内已有「源码级静态断言」先例，P5 用它避免浏览器行为依赖，测试稳定且零人工。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新测试先运行 → **RED**（证据：`_context-output/evidence/task-U9-red.txt`）
  - [ ] `npx vitest run tests/unit/ui/page-lang.test.tsx` → ALL PASS（**真正不依赖 U1**：断言 = **5 个固定白名单**入口页均 `lang="en"`，不含候选页）
  - [ ] `npm run test:unit` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: U9 负责的 5 个白名单入口页均为 lang=en，且白名单内无 zh-CN
    Tool: Bash (rg + test runner)
    Steps:
      1. 对白名单 5 个文件逐一检查：
         rg -n 'lang="en"' src/ui/{sidebar,settings,recovery,import-preview,conflict-confirm}/index.html
         → 期望 5 命中（每个白名单文件 1 命中）
      2. 对同一白名单 5 个文件检查：
         rg -n 'lang="zh-CN"' src/ui/{sidebar,settings,recovery,import-preview,conflict-confirm}/index.html
         → 期望 0 命中（U9 已改完这 5 个）
      3. npx vitest run tests/unit/ui/page-lang.test.tsx → ALL PASS
    Expected Result: 5 个白名单入口页语言声明为 en；白名单内 0 命中 zh-CN
    Failure Indicators: 白名单任一页面仍 zh-CN
    Evidence: _context-output/evidence/task-U9-lang.txt
  ```

  > **Nit N2 / Blocker BLK-U9 解耦说明（v3）**：
  > 本场景**只扫 5 个固定白名单路径**，**不**扫 `src/ui` 全目录，**不**断言 `candidate-selector` 是否存在。
  > 故步骤 1/2 的期望值**固定为 5 / 0**，**无论 U1 是否完成都成立**——这才是真正的解耦。
  > 全仓 `zh-CN` 兜底（覆盖 `candidate-selector`）由 U8 的 `no-cjk-in-ui.test.tsx` 与 F1 的 `rg` 核对负责；`candidate-selector` 目录不存在由 U1 守卫测试负责。

  **Commit**: YES (Commit 8, 与 U8 合并)
  - Message: `chore(ui): align page language and unify toast duration (P5, P9, P12)`
  - Files: `src/ui/{sidebar,settings,recovery,import-preview,conflict-confirm}/index.html`（**5 个白名单**，不含 `candidate-selector`）, `tests/unit/ui/page-lang.test.tsx`
  - Pre-commit: `npm run test:unit && npm run build:chrome`

---

## Risks, Blockers & Decisions

### Cross-Module Coupling Map

| 耦合点 | 涉及任务 | 串行原因 |
|--------|----------|----------|
| `src/ui/sidebar/App.tsx` | U4 → U5 → U6 → U7 → U8 | 8 项问题（P1/P2/P3/P4/P6/P8/P9/P12）集中此文件，编辑冲突必须串行 |
| `src/ui/settings/App.tsx` | U2 → U4 → **U8** | U2 加三态、U4 加 hash 消费、**U8 改 `:95`/`:141`/`:151`/`:161`/`:187-190`/`:323` 文案**，同文件（U8 在 W5，天然晚于 U2/U4） |
| `src/ui/components/IconEditor.tsx` | **U8 独占** | P9 英文化（裁决 DR4）；被 sidebar/settings 共享组件引用，但**只得改该文件本身**，不越界改引用方 |
| `src/ui/shared/components.tsx`（若扩展） | U3（W1）→ U5（W3） | 天然跨波串行 |
| `tests/ui-smoke/pages.smoke.test.tsx` | U1 独立 | P10 删除后 6→5 用例；其他任务不得触碰 |
| `tests/unit/ui/recovery-selector.test.tsx` | U1 独占 | Recovery+Candidate **混合文件**：删 7 个候选用例 + `:4`/`:5` 两条 import，保留 6 个 Recovery 用例（GE5） |
| `tests/unit/ui/sidebar-result-handling.test.tsx` | U5 独占 | P2 改名+加 Confirm 的唯一受影响测试（GE1） |
| `tests/unit/ui/inline-rule-editor.test.tsx` | U8 独占 | P9 VERSION_CONFLICT 文案英文化的测试锁定点（GE2，`:222`） |

### Risks

| # | 风险 | 影响 | 缓解 |
|---|------|------|------|
| R1 | **P1 的 hash 消费是新行为**（当前 `#diagnostics` 也失效） | 中：若只改 URL 字符串则「任务仍不可达」 | U4 显式实现 hash→section 消费；RED 用「hash=import-export 时对应分区可见」断言 |
| R2 | **P2 破坏 4 处既有定位串（`:80`/`:82` 的 `'Reset'` 同串两现 + `:99`/`:104` 文案子串）+ 1 个交互流** | 中：测试红 | GE1 显式登记（**Nit N1：`:80` 与 `:82` 两处都要改**）；仅改定位/流程，`expect` 判据（`:99`/`:104` 的 `some(...)` 结构）**原样保留**；`:127` 不动 |
| R3 | **P10 删除遗漏引用点** | 高：构建/冒烟/typecheck 必红 | U1 清点 **5 点**（目录/`vite.config.ts:37`/`pages.smoke:122-147`/**`recovery-selector:76-202` 的 7 用例**/**`recovery-selector:5` 的类型 import**）；验收含三浏览器构建 + 冒烟 5 用例 + **`typecheck` 0 error** |
| R3b | **误删受保护的 Recovery 用例**（v1 错误基线「5 用例」的诱因） | 高：违反护栏 + 静默丢失 6 项覆盖 | v2 已更正基线为 **candidate=7 / Recovery=6**；U1 acceptance 与 QA 显式断言「recovery-selector `it` 计数 = **6**（不是 5）」；GE5 明文「不得改动 Recovery 的 6 个 `it`」 |
| R3c | **U9 与 U1 的跨任务断言耦合**（v1 断言目录不存在；v2 改为「动态枚举 + 全目录 0 命中」但仍**覆盖候选页** → 实为未解耦，即 **BLK-U9**） | 高（v2 未真正闭合）：U1 前 U9 必红，个别任务被迫隐式串行 | **v3 真正解耦（Nit N2 最终落实）**：U9 断言**限定为 5 个固定白名单**入口页（`sidebar`/`settings`/`recovery`/`import-preview`/`conflict-confirm`）均 `lang="en"` 且不含 `zh-CN`，**不扫全目录、不含候选页**；「目录不存在」归 U1 守卫测试、「全仓无 `zh-CN`/CJK」归 U8 的 `no-cjk-in-ui.test.tsx`。→ **U9 在 U1 未完成时可独立通过 acceptance** |
| R4 | **P7 改默认后 `pages.smoke` 的 conflict 用例受影响** | 低：该用例只断言 ≥2 按钮 | U3 保持两个按钮存在（Cancel/Overwrite），仅改超时行为 |
| R5 | **P4 迁移到 `Dialog` 后模态 CSS 类变化 + 既有定位回归** | 中：布局可能变化 / 既有测试定位失效 | `Dialog` 用 `tbs-dialog*` 类（base.css:147-185 已有）；保留 `aria-label` 与标题文本，仅换容器；**U7 acceptance 显式登记 `slot-add-to-global.test.tsx:94`（`getByLabelText('Match URL')`）与 `:144`（`name:'Save'`）两个回归检查点**，且已复核该文件无标题/按钮数量断言（Nit N4） |
| R6 | **P8 菜单新增项改变「菜单项数量」断言（若有）** | 低-中 | 已核查：仅 `sidebar-result-handling`/`slot-add-to-global` 按**名称**取项，无数量断言 |
| R7 | **P11 三态改造触及 `ShortcutsSection` 既有断言** | 中 | 已核查 `settings.test.tsx:47-55` 断言 22 行（1 表头 + 21 命令），改造须保持命令表在 loaded 后仍渲染 21 行 |
| R8 | **P5 `lang="en"` 与残留中文不一致** | 低（**v2 已闭合**） | P5 改全部入口页 `index.html` 声明；P9 按裁决 DR1/DR4/DR5 消除**全仓 12 行 CJK**（含 `IconEditor.tsx:242,287` 与 `settings/App.tsx:323`），故 R8 不再存在：界面文案与 `lang` 完全一致，由 `no-cjk-in-ui.test.tsx` 守卫 |
| R9 | **U8 的 Toast 3000→5000 影响既有计时类断言** | 低 | 已核查：全仓**无** Toast `duration` 相关断言（`rg 'duration|3000|5000' tests` 仅命中 tokens/icon-service/worker-orchestrator 的非 Toast 用例）；`sidebar-result-handling.test.tsx` 的 undo 流程不依赖 Toast duration；`UndoBar` 自身计时独立（`App.tsx:407-419`） |
| R10 | **B1：类型 import 残留导致 `typecheck` 失败** | 高（若遗漏）：DoD「`typecheck` 0 error」不可达 | U1 显式列入「同步移除 `:5` 的 `import type { TabCandidate }`」；acceptance 与 QA 均含 `npm run typecheck` 出口校验（`noUnusedLocals: true` 下遗漏即 TS6133） |
| R11 | **B3：VERSION_CONFLICT 文案文件误引导致漏改** | 高（若沿用 v1 引用）：P9 漏改一半 | v2 全仓检索确认该中文串**唯一命中 `src/ui/settings/App.tsx:323`**（宿主 `InlineRuleEditor`）；已更正 Deliverables / U8 References / Commit 8 三处；`Must NOT Have` 明文禁止去 `RuleEditor.tsx` 改该文案 |
| R12 | **CJK 全扫守卫（`no-cjk-in-ui.test.tsx`）可能误报** | 低 | 该守卫仅扫 `src/ui/**/*.{ts,tsx}` 的 `[\u4e00-\u9fff]`；已实测当前命中恰为 12 行且**全部**是本任务的目标文案（无注释/无无关字符串）；若出现漏改则该测试正确报红，属预期信号 |

### Blocking Points（阻塞点）

> **ID 约定**：阻塞点编号用 **`BP1`–`BP5`**，**刻意区别于 Revision Log §A 的 Blocker `B1`–`B3`**（后者是 v1 计划缺陷，非执行阻塞）。
> **使用说明（Nit N8）**：`BP1`–`BP5` 是**阻塞点索引表**，供执行者在对应环节按需查证；本计划**不逐条在正文展开引用**。其中 **BP1（`sidebar/App.tsx` 串行顺序）与 BP4（lint delta-0 判据）已在 Final Verification 的 F1 中被显式引用**（见下 F1），其余（BP2/BP3/BP5）作为环境与顺序提醒保留。

- **BP1（顺序）**：`sidebar/App.tsx` 必须严格按 U4→U5→U6→U7→U8 顺序，任何跳序会导致编辑冲突。
- **BP2（顺序）**：U4 依赖 U2 完成（同文件 `settings/App.tsx`）。
- **BP3（环境）**：三浏览器构建需 Node ≥ 20（`package.json:engines`）。
- **BP4（判据）**：lint 判据为 delta-0（基线红），**不可**以「lint 全绿」为验收；须以 before/after JSON 差集证明。
- **BP5（已解除）**：v1 曾存在多项前置决策未裁决（语种/P10/P1 已决、P2 撤销、IconEditor、`settings:323`）。**v2 已全部裁决解除**（DR1–DR6）——**当前 0 个任务被前置决策阻塞**，见下「Decisions Resolved in v2」末注。

### Decisions Resolved in v1（规划期已裁决，v2 保留）

1. **P1 落点 → 指向 settings 导入导出分区 + 补 hash 消费**。理由：settings 的 `ImportExportSection` 功能完整（含导出），而 `import-preview` 页为固定桩且无导出入口；与 `#diagnostics` 模式统一，顺带修复既有深链失效。
2. **P7 超时默认 → Cancel（非破坏性）**。理由：与 `recovery/App.tsx:36-42` 的超时即 Dismiss 一致；破坏性结果必须显式点击（`design spec §8` 的风险分级精神）。
3. **P6 语义边界 → 只收敛「删除槽位」一词**（`Reset`→`Delete`，Toast 统一），**DualCards 的 `Remove`（移除覆盖）保持不动**。理由：移除覆盖是「立即执行 + 提示恢复边界」类（design spec §8:199），与删除槽位不同类。

### Decisions Resolved in v2（用户已裁决，v1 时代遗留项全部闭合）

> **来源**：`sw-plan-reviewer` High Accuracy Review 后的用户裁决轮（2026-09-29）。**全部采用规划者建议值。**

> **ID 约定**：决策编号用 **`DR1`–`DR6`**（Decision Resolved），**刻意区别于 Risks 表的 `R1`–`R12`**，避免交叉引用歧义。

| # | 决策 | **最终裁决** | 对任务的影响面 |
|---|------|-------------|--------------|
| **DR1** | 语种定调 | **EN** — 界面统一英文；全部 `index.html` 的 `lang` 改 `en`；`sidebar/App.tsx:585`、`settings/App.tsx:323` 等 CJK 漂移一并英文化 | **U8/U9 变无歧义**；P9 边界由「混排消除」**扩展为「全仓 12 行 CJK 全部英文化」**；U8 acceptance 收紧（新增 CJK 全扫守卫测试）；U9 断言收敛为**5 个固定白名单**入口页（⚠️ v3 更正：v2 的「现存入口页动态化」因覆盖候选页而未解耦，见 BLK-U9） |
| **DR2** | P10 `candidate-selector` | **删除**（移入口目录 + `vite.config.ts` 条目 + 同步测试） | **U1 无歧义**（无「补齐」分支）；U1 acceptance 收紧为「5 引用点 + 构建 + 冒烟 5 + **`typecheck` 0 error** + 全仓 0 命中」；入口 8 → 7 |
| **DR3** | P2 删除路径是否提供可撤销 | **不做**（保持范围保真；只加二次确认，不新增后台 action） | **U5 无歧义**（v1 的「备选 A」移出执行范围）；U5 acceptance 只验「Confirm 前置 + 文案统一」，**不验撤销**；护栏「不新增后台 action」保持硬约束；`UndoBar` 的 `label`/`undoLabel` 可选 prop 扩展**仍照做**（成本零、使组件就绪） |
| **DR4** | `src/ui/components/IconEditor.tsx` 两处中文 | **一并英文化**（否则 P9 未彻底闭环） | **U8 范围收紧**：`:242`/`:287` **必须**改英文；U8 acceptance 增列该两点；已复核**无测试锁定** |
| **DR5** | `settings/App.tsx:323` 中文（受 `inline-rule-editor.test.tsx:222` 锁定） | **改**（连带 GE2 定位更新） | **U8 无歧义**（v1 的「仅当采纳」条件 → **确定生效**）；**GE2 从「条件生效」改为「必须生效」**；`:222` 定位串同步英文（`toHaveTextContent` 判据不放宽） |
| **DR6** | P12 是否抽常量（v1 Decisions Needed #3） | **不抽**（仅省略 prop 取默认，单一真源 = `components.tsx:185` 的 `5000`） | U8 无歧义；避免过度抽象 |

**⚠️ 前置决策阻塞核查（第四部分要求 5）**：**无任何任务被前置决策阻塞**。
- v1「Decisions Needed」共 5 项，其中 **#1（IconEditor）→ DR4 已决**、**#2（`settings:323`）→ DR5 已决**、**#3（P12 常量）→ DR6 已决**、**#4（P2 撤销）→ DR3 已决**、**#5（P10 删除 vs 补齐）→ DR2 已决**。
- 其余 v1「Decisions Resolved」3 项（P1 落点 / P7 默认 / P6 语义边界）在 v1 即已裁决，v2 保留为 `Decisions Resolved in v1`。
- 结论：**0 个未决决策**；U1–U9 全部任务的前置条件均已在规划期闭合，可直接进入执行。

### Auto-Resolved（规划期已自动闭合）

- 计划落盘位置：`_context-output/plans/`（项目既有约定，与 `2026-09-28-fix-roadmap-plan.md` 同级）；evidence 同级 `_context-output/evidence/`。
- 计划命名：沿用既有连字符风格 `2026-09-29-ui-ux-remediation-plan.md`。
- 任务编号用 `U*`（区别既有计划的 `T*/B*/F*`），避免与代码层计划混编。
- 既有 `#diagnostics` 深链失效：并入 U4（同一 hash 消费机制），单列于 U4 的验收。
- **（v2 新增）GE3 定义补齐**：v1 正文引用 GE3 但登记表无此项 → 现定义 GE3 = **纯追加型测试例外**（允许在既有测试文件 append 新 `it`，禁止改动/删除既有断言），覆盖 `settings.test.tsx` / `sidebar-open-page.test.tsx` / `sidebar-regex-display.test.tsx`。
- **（v2 新增）CJK 全扫守卫测试**：`tests/unit/ui/no-cjk-in-ui.test.tsx` 作为裁决 DR1/DR4/DR5 的统一闭环与防回归证据。
- **（v2 新增）`IconEditor.tsx` 路径规范化**：统一写作 `src/ui/components/IconEditor.tsx`（v1 有裸写 `IconEditor.tsx` 的漂移）。

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must PASS. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** (recommended: `oracle`)

  Read the plan end-to-end:
  - **Must Have verification**: 逐条验证——读 `sidebar/App.tsx` 的 Confirm 前置与 UndoBar 调用、`conflict-confirm/App.tsx` 的归零分支、`sidebar/App.tsx` 的错误态分支、`settings/App.tsx` 的三态与 hash 消费、**`settings/App.tsx:323` 与 `src/ui/components/IconEditor.tsx:242,287` 的英文化**；跑 `npx vitest run tests/unit/ui/<new-files>`。
  - **Must NOT Have verification**: `grep -rn "candidate-selector" src vite.config.ts tests` → 必须 0 命中（⚠️ **核对作用域不含文档**：`README.md:101`、`RELEASE_CANDIDATE.md:83` 的提及**不在 U1 范围内**，见 **Nit N9**；不得因文档提及而误判红）；`grep -rn "eslint-disable" src/ui` → 数量不得增加（基线 **3** 处）；`git diff package.json` → 无依赖新增；`git diff src/ui/settings/RuleEditor.tsx` → **必须为空**（B3：该文件不应被本计划改动）。
  - **P10 清除核对（含 B1/B2）**：`test ! -d src/ui/candidate-selector`；`grep -c "candidate-selector" vite.config.ts` = 0；`pages.smoke.test.tsx` 用例数 = **5**；`recovery-selector.test.tsx` 用例数 = **6**（**不是 5**）；`rg "TabCandidate|CandidateSelectorApp" tests/unit/ui/recovery-selector.test.tsx` = 0 命中；`npm run typecheck` exit 0。
  - **U9 白名单断言核对（BLK-U9 闭合验证）**：`rg -n 'lang="en"' src/ui/{sidebar,settings,recovery,import-preview,conflict-confirm}/index.html` → 5 命中；对同一 5 文件 `rg -n 'lang="zh-CN"'` → **0 命中**（**仅核对白名单，不核对候选页**；候选页由 P10 清除核对与 CJK 兜底负责）。
  - **CJK 清零核对（裁决 DR1/DR4/DR5）**：`rg -n '[\u4e00-\u9fff]' src/ui` → **0 命中**；`npx vitest run tests/unit/ui/no-cjk-in-ui.test.tsx` → ALL PASS。
  - **阻塞点核对**：**BP1**（`sidebar/App.tsx` 必须按 U4→U5→U6→U7→U8 串行 —— 核对 `git log` 提交顺序无跳序）；**BP4**（lint 判据为 delta-0，核对 before/after JSON 差集新增 = 0，**不得**以「lint 全绿」为判据）。
  - **Evidence verification**: `_context-output/evidence/task-U*/` 文件齐全。
  - Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | Evidence [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** (recommended: `unspecified-high`)

  - **Build**: `npm run build:chrome|edge|firefox` 三者成功（入口数 8 → 7）
  - **Lint（delta-0）**: 对比 `lint-baseline-before.json` / `lint-baseline-after.json`，新增 (file,line,ruleId) = 0
  - **Typecheck**: `npm run typecheck` 0 error（**尤其验证 B1**：无 TS6133 未使用 import）
  - **Tests**: `npm run test:unit && npm run test:integration && npm run test:ui-smoke` 全绿
  - **Patterns**: `as any` / `@ts-ignore` / 空 catch 新增 / 生产代码 `console.log` 新增
  - Output: `Build [PASS/FAIL] | Lint-delta [0/N] | Typecheck [PASS/FAIL] | Tests [N pass/N fail] | VERDICT: APPROVE/REJECT`

- [ ] F3. **Real Agent-Executed QA** (recommended: `unspecified-high`)

  执行每个任务的每个 QA 场景（agent 执行）：含 P2 的「Confirm→取消（槽位保留）」「Confirm→确认（槽位删除）」（**裁决 DR3：不验「删除后 Undo 恢复」——该能力按裁决不做**）；P3 的「失败→错误态→Retry→成功」；P4 的「Escape 关闭」「Tab 循环」「焦点还原」+ **`slot-add-to-global` 定位回归（Nit N4）**；P7 的「超时→Cancel 而非 Overwrite」；P1 的「点击 Import/Export→落到导入导出分区（含既有 `#diagnostics`）」。
  - Evidence: `_context-output/evidence/final-qa/`
  - Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT: APPROVE/REJECT`

- [ ] F4. **Scope Fidelity Check** (recommended: `deep`)

  每任务对照 `git diff` 做 1:1 映射；检查无超规格新增（无新依赖、无未授权文件）；检查 `Must NOT do` 合规；检测任务越界；标记未登记改动。
  - **GE 例外核对**：仅 **GE1–GE5 五类**测试改动存在，且无任何 `expect` 判据被放宽。
  - **越界重点核对（v2 新增）**：① `src/ui/settings/RuleEditor.tsx` 必须**零改动**（B3）；② 后台域（`worker-orchestrator.ts` 的 `GET_CANDIDATES`、`message-client.ts` 的 `getCandidates`、`messages.ts` 的 `GetCandidates*`）必须**保留**（Nit N3 边界）；③ `recovery-selector.test.tsx` 的 6 个 Recovery 用例必须**原样保留**（B2 误删风险）。
  - **文档提及核对（v3 新增，Nit N9）**：`README.md` / `RELEASE_CANDIDATE.md` 的 `candidate-selector` 提及**不在 U1 范围**；核对 `git diff -- '*.md'` → 本计划**不得**产生任何 `.md` 改动（除非另立授权）。
  - **U9 断言范围核对（v3 新增，BLK-U9）**：`git diff tests/unit/ui/page-lang.test.tsx` → 断言**仅含 5 个白名单路径**；**不得**出现 `readdirSync('src/ui')` 全目录枚举或对 `candidate-selector` 的任何断言。
  - Output: `Tasks [N/N compliant] | Contamination [CLEAN/N] | Unaccounted [CLEAN/N] | VERDICT: APPROVE/REJECT`

---

## Commit Strategy

```
Commit 1: chore(ui): remove orphan candidate-selector page (P10)
  Files: src/ui/candidate-selector/**, vite.config.ts, tests/ui-smoke/pages.smoke.test.tsx, tests/unit/ui/recovery-selector.test.tsx (删 7 用例 + :4/:5 两条 import), tests/unit/ui/candidate-selector-removed.test.ts
  Pre-commit: npm run test:unit && npm run test:ui-smoke && npm run typecheck && npm run build:chrome

Commit 2: feat(settings): three-state loading and hash deep-link (P11, P1)
  Files: src/ui/settings/App.tsx, tests/unit/ui/settings-loading-states.test.tsx, tests/unit/ui/settings-deeplink.test.tsx
  Pre-commit: npm run test:unit

Commit 3: fix(conflict): make countdown timeout non-destructive (P7)
  Files: src/ui/conflict-confirm/App.tsx, tests/unit/ui/conflict-confirm-default-safe.test.tsx
  Pre-commit: npm run test:unit && npm run test:ui-smoke

Commit 4: feat(sidebar): route Import/Export footer to settings section (P1)
  Files: src/ui/sidebar/App.tsx, tests/unit/ui/sidebar-open-page.test.tsx
  Pre-commit: npm run test:unit

Commit 5: fix(sidebar): confirm before deleting a slot, unify delete wording, add explicit edit entries (P2, P6, P8)
  Files: src/ui/sidebar/App.tsx, tests/unit/ui/sidebar-result-handling.test.tsx, tests/unit/ui/sidebar-slot-menu-delete.test.tsx
  Pre-commit: npm run test:unit

Commit 6: fix(sidebar): surface load failure with retry (P3)
  Files: src/ui/sidebar/App.tsx, tests/unit/ui/sidebar-error-state.test.tsx
  Pre-commit: npm run test:unit

Commit 7: fix(sidebar): use accessible Dialog primitive for modals (P4)
  Files: src/ui/sidebar/App.tsx, tests/unit/ui/sidebar-modal-a11y.test.tsx
  Pre-commit: npm run test:unit

Commit 8: chore(ui): align page language and unify toast duration (P5, P9, P12)
  Files: src/ui/{sidebar,settings,recovery,import-preview,conflict-confirm}/index.html (5 个固定白名单，不含 candidate-selector), src/ui/sidebar/App.tsx, src/ui/settings/App.tsx,
         src/ui/components/IconEditor.tsx,
         tests/unit/ui/page-lang.test.tsx, tests/unit/ui/sidebar-regex-display.test.tsx,
         tests/unit/ui/settings.test.tsx, tests/unit/ui/inline-rule-editor.test.tsx (GE2),
         tests/unit/ui/no-cjk-in-ui.test.tsx
  REMOVED (v2): src/ui/settings/RuleEditor.tsx  ← 该文件不含 VERSION_CONFLICT 文案（真实落点 = src/ui/settings/App.tsx:323，Blocker B3）
  Pre-commit: npm run test:unit && npm run build:chrome
  Note: U8（P9+P12）与 U9（P5）合并提交；U9 在 Wave 1，U8 在 Wave 5 —— 合并入同一 commit message 但可分批落盘
  Note: GE2 由 v1 的「条件生效」改为「必须生效」（裁决 DR5）；本计划**不得**产生 RuleEditor.tsx 的 diff
```

---

## Success Criteria

### Verification Commands

```bash
# 类型检查
npm run typecheck            # Expected: exit 0, 0 errors

# 单元测试（含新增）
npm run test:unit            # Expected: all pass

# 集成测试（无回归）
npm run test:integration     # Expected: all pass

# UI 冒烟（P10 删除后 5 用例）
npm run test:ui-smoke        # Expected: all pass

# Lint delta-0 判据
npx eslint src tests --format json > _context-output/evidence/lint-baseline-after.json
# 与 lint-baseline-before.json 做 (file,line,ruleId) 差集 → 新增 = 0

# 三浏览器构建（P10 删除后入口数由 8 → 7）
npm run build:chrome && npm run build:edge && npm run build:firefox

# CJK 清零核对（裁决 DR1/DR4/DR5）
rg -n '[\u4e00-\u9fff]' src/ui   # Expected: 0 命中
```

### 修订后门禁用例数预期（v3 · 交付要求 2）

> 基线为**干净树实跑结果**（规划者已执行 `npx vitest run --project <name> --run`）。
> **v3 Nit N7**：unit **files** 预期由 v2 的「≈ 42」更正为 **45**（36 基线 + 9 新增文件）；**精确值以执行时实跑为准**。

| Project | 基线（v1 时代实测） | 修订后预期 | 增减说明 |
|---------|-------------------|-----------|---------|
| **unit** | **398 tests / 36 files** | **≈ 421–430 tests / ≈ 45 files** | **files**：36 + **9 个新增测试文件** = **45**（新增文件：`candidate-selector-removed` / `settings-loading-states` / `conflict-confirm-default-safe` / `settings-deeplink` / `sidebar-slot-menu-delete` / `sidebar-error-state` / `sidebar-modal-a11y` / `page-lang` / `no-cjk-in-ui`）。**tests**：**−7**（U1 删 candidate × 7）+ 新增：U1 守卫 4、U2 三态 4、U3 冲突 3、U4 深链 4 + sidebar-open-page 1、U5 菜单 4、U6 错误态 3、U7 a11y 4、U8 regex +1 / CJK 守卫 1 / settings 文案 +1、U9 page-lang 1 ≈ **+31** → 净 ≈ **+24**。**精确值以执行时实跑为准**；**唯一硬约束**：`recovery-selector.test.tsx` 必为 **6**（非 5）、`pages.smoke` 必为 **5**（非 6） |
| **integration** | **170 tests / 16 files** | **170 tests / 16 files（不变）** | 本计划**不触碰**集成域（后台/存储/安全属 `2026-09-28-fix-roadmap-plan.md`）；预期**零回归、零新增** |
| **ui-smoke** | **6 tests / 1 file** | **5 tests / 1 file** | **−1**（U1 删 `pages.smoke.test.tsx:122-147` 的 candidate-selector 用例），与 **U1 acceptance「用例数 = 5」完全一致** ✅ |

**ui-smoke 6 → 5 的一致性说明**：该预期**唯一来源**是 U1（P10 删除），与 U1 acceptance 的「`npm run test:ui-smoke` → 用例数 = 5」严格对应；无任何其他任务触碰 `tests/ui-smoke/**`。故 U1 完成后 `ui-smoke` 必为 5。

### Final Checklist

- [ ] 全部 Must Have 已实现
- [ ] 全部 Must NOT Have 已遵守（尤其：无新依赖、无 `expect` 放宽、未触碰 DualCards Remove、**未改动 `RuleEditor.tsx`**、**后台 `GET_CANDIDATES` 域保留**、**未改动 `.md` 文档提及**）
- [ ] 全部任务含 QA 场景且证据落盘
- [ ] `recovery-selector.test.tsx` 保留 **6** 个 Recovery 用例（**未误删**）；`pages.smoke` = **5**
- [ ] **U9 白名单断言已落实（BLK-U9 闭合）**：`page-lang.test.tsx` **只断言 5 个固定白名单**（`sidebar`/`settings`/`recovery`/`import-preview`/`conflict-confirm`）均 `lang="en"` 且不含 `zh-CN`；**无**全目录/候选页断言 → **U9 在 U1 未完成时可独立通过**
- [ ] `src/ui` 内 **0 行 CJK**（裁决 DR1/DR4/DR5 闭环）；`candidate-selector` 目录不存在由 **U1 守卫测试** 独占验证
- [ ] F1–F4 全部 APPROVE 并取得用户 okay
- [ ] 草稿文件已清理

---

## Guardrail Exceptions（授权测试改动登记）

> 除以下 **GE1–GE5 五类**，**任何既有测试文件的改动均视为违规**。
> **v2 变更**：v1 正文引用了「GE3」但登记表缺失 → 现**补齐 GE3 定义**（D 节 NEW-D1）。

| ID | 文件 | 允许改动 | 禁止改动 |
|----|------|----------|----------|
| **GE1** | `tests/unit/ui/sidebar-result-handling.test.tsx` | ① **`:80` 与 `:82` 两处**菜单项名 `'Reset'` → 新名称 `'Delete Slot'`（`clickReset()` 内：`:80` 为 `waitFor` 断言、`:82` 为实际 `fireEvent.click`，**同串两现，两处都要改**）；② `clickReset()`（`:74-83`）增加「点击 Confirm 的 `Delete`」步骤；③ `:99`/`:104` 的**文案子串**随 P6 统一而更新 | **不得**删除/放宽 `:99`、`:104` 的 `some(...)` 判据结构；不得删除任一 `it`；**不得**改 `:127` 的 `Undo overwrite of slot 1`（覆盖路径护栏） |
| **GE2** | `tests/unit/ui/inline-rule-editor.test.tsx` | `:222` 的 `'规则已被其他操作修改，请刷新后重试'` → 新英文文案（**裁决 DR5：确定生效，非条件**；锚点正确，无需改文件位置） | 不得删除该 `it`；不得放宽 `toHaveTextContent` |
| **GE3** | `tests/unit/ui/{settings,sidebar-open-page,sidebar-regex-display}.test.tsx` | **纯追加**新 `it`（P9/P11 文案断言、P1 入口 payload 断言、P9 regex 去 CJK 断言） | **不得**改动或删除既有任何 `it` 与其 `expect` 判据（只允许 append） |
| **GE4** | `tests/ui-smoke/pages.smoke.test.tsx` | 删除 `:122-147` 的 candidate-selector 用例（P10；用例数 6 → 5） | **不得**改动其余 5 个用例的任何断言 |
| **GE5** | `tests/unit/ui/recovery-selector.test.tsx` | 删除 `:76-202` 的 `Candidate selector` 两个 describe 块（**含 7 个 `it`**）+ `:4` 的 `CandidateSelectorApp` import + **`:5` 的 `import type { TabCandidate }`（Blocker B1）**（P10） | **不得**改动 `Recovery window` 的 **6 个 `it`**（受保护）；**不得**为凑数把用例计数做成 5 |

> **已核实无需例外（记录以免误改）**：`tests/unit/ui/sidebar-open-page.test.tsx` **无** Import/Export 入口断言（`:61-121` 仅覆盖 `Open settings` 与 `View diagnostics`）；`tests/unit/ui/sidebar.test.tsx:206` 断言的是 aria-label `'Import or export'`，而 P1 **不改** aria-label（只改目标 URL）。故 P1 不产生既有测试改动。

---

## Out of Scope (明确排除)

**不纳入**（未验证推断，无实跑证据；**不得**规划为修复项）：
- 侧边栏 loading 3s 内可感知性
- `conflict-confirm.css` 的 `@keyframes` 是否覆盖 `prefers-reduced-motion`
- 440px 断点溢出
- `tbs-modal-overlay` 的 `position:absolute` 滚动行为
- 自绘列表读屏顺序

**另排除**（本次不做）：
- `import-preview/App.tsx` 的「导出能力补齐」——删除该页不属于本计划；P1 采取「入口改指 settings」而非「补齐该页功能」
- `import-preview` 页本身的桩数据问题（`main.tsx:14-15`）——P1 改入口后该页不再是可达路径；是否删除该页**留作后续独立评估**（本计划不删）
- 任何后台/存储/安全域改动（属 `2026-09-28-fix-roadmap-plan.md`）
- **（v2 新增边界）后台候选能力域**：`GET_CANDIDATES`（`worker-orchestrator.ts:648-654`）、`message-client.ts:297-299` 的 `getCandidates`、`messages.ts` 的 `GetCandidatesRequest`/`GetCandidatesResponse`、`TabCandidate` 类型定义 —— **全部保留**（U1 只删 UI 页，Nit N3）
- **（v2 新增边界）`src/ui` 之外**：P9 的 CJK 英文化**仅限 `src/ui/**`**。已实测 `src/` 全域 CJK = **12 行且全部在 `src/ui/`**（`settings` 9 + `sidebar` 1 + `components/IconEditor` 2），**`src/background`/`src/content`/`src/shared`/`src/adapters` 当前 0 命中**；CJK 全扫守卫测试的作用域因此也限定为 `src/ui/**`（不扩展到后台域）
- **（v3 新增边界，Nit N9）文档提及**：`README.md:101`、`RELEASE_CANDIDATE.md:83` 亦提及 `candidate-selector`，但**文档提及不在 U1 范围内**——本计划**不修改任何 `.md` 文档**。理由：① 保持范围保真（U1 作用域 = `src/**` + `vite.config.ts` + `tests/**`）；② F1 核对作用域为 `rg "candidate-selector" src vite.config.ts tests`（**不含 `.md`**），故不会误判红；③ 文档改写属独立表达层任务。（备选「顺带清理文档」**未采纳**。）

---

## Follow-up Tasks（registered — 不在本计划范围内执行）

> 由用户指令登记（2026-09-30）。**本计划不执行**；供后续独立任务跟踪。

### FU-1 — `import-preview` 页成为孤儿页（U4 改向后的同构遗留）

- **来源**：U4（P1）将侧边栏页脚 `Import/Export` 改指 `settings/index.html#import-export` 后，`src/ui/import-preview/**` **不再有任何代码入口**。
- **证据（2026-09-30 独立核实）**：
  - 全仓 `rg "import-preview"` 命中 = 其自身文件 + `src/ui/styles/import-preview.css` + `src/ui/settings/App.tsx:1618`（仅一个 className）
  - **无任何 `openPage('src/ui/import-preview/index.html')` 调用**（原唯一入口已在 U4 移除）
  - `vite.config.ts:36` 仍保留其多入口
  - 该页 `main.tsx:14-15` 仍为**固定桩数据 + 空 `onCommit`**
- **性质**：与 **P10（`candidate-selector`）同构** —— "页面存在但用户不可达"。
- **为何本计划不处置**：删除会连带影响仍直接使用其导出组件的测试（`tests/unit/ui/import-diagnostics.test.tsx` 用 `ImportPreviewTable`/`DiagnosticsPanel`/`IconStatus`/`UnifiedToast`；`tests/ui-smoke/pages.smoke.test.tsx:100-101` 冒烟该页）→ 属独立范围。
- **建议处置（择一，需另立任务评估）**：① **删除**页与入口 + 迁移/移除相关测试导出（组件若仍被复用则先抽为共享模块）；② **补齐**：接真实数据 + 补导出入口 + 恢复 `openPage` 入口 + 补样式。
- **验收提示**：处置后须同步更新 `pages.smoke.test.tsx` 用例数（当前 5）与 `vite.config.ts` 入口数（当前 7）。