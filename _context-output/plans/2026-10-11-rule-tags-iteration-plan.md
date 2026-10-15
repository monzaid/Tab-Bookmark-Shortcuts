# Rule Tags 迭代 — Work Plan

> **计划名称**: rule-tags-iteration-plan
> **创建时间**: 2026-10-11 · **创建者**: sw-strategic-planner (Prometheus)
> **状态**: Ready for Execution（**0 项 [DECISION NEEDED]** —— 设计已四层闭合、0 项 OPEN，本计划仅登记 **8 项计划层裁决 P1–P8**（见 §Context / Pre-Planning Review），均已给出依据，不阻塞执行）
> **先读后规划**: 已完整读取主设计文档 + 决策清单 YAML + 四份层分册（Goal / Constraint / Architecture / Detail）；规划期实读源码核实 **24 处**关键事实（非引用设计）
> **上游设计（四层闭合，0 OPEN，42 决策 / 6 回溯修订）**:
> - 主文档 `_context-output/designs/2026-10-10-rule-tags-design.md`
> - 决策清单 `_context-output/designs/2026-10-10-rule-tags-decisions.yaml`
> - 分册 `…-goal-scope-…` / `…-constraint-boundaries-…` / `…-architecture-module-…` / `…-detail-interaction-copy-…`
> **取向（继承设计，不重开）**: 标签是**纯组织维度**，不进执行链；零第三方运行时依赖；TDD 三层 vitest project（`unit` / `integration` / `ui-smoke`）；**不承担向后兼容**（C9）；容量问题**不在本次范围**（C0）。

---

## TL;DR

> **Quick Summary**: 为 `PageRule` 引入**标签**（全局标签表 `SyncState.tags: TagDefinition[]` + 规则侧 `tagIds: string[]`，C1/A6），新增**独立 `TagService` + 独立消息族**（A1，`TagService` 不持有任何投递入口 ⇒「标签不影响行为」由模块边界保证），新增**自研布尔表达式引擎**（`src/shared/tag-expression.ts` 纯模块：AST + 迭代解析 + 迭代求值 + 名字↔id 实体解析，A2/G4/G5），把 `tags` 升格为**第 5 个导入导出维度**（S5，同步 4 处模型），新增**第 7 个导航页 Tags**（D-a），并在 Rules 页加 **chip 表达式构建器 + Tags 列（默认收起）**（D-b/D-c/D-d）。**规则执行行为与今天完全一致。**
>
> **Deliverables**（具体文件，详见 Work Objectives）:
> - `src/shared/tag-expression.ts`（**新**，AST + 迭代解析 + 迭代求值 + 实体解析，D1/A2）
> - `src/shared/tags.ts`（**新**，领域纯函数：trim 规范化 / 上限校验 / 自洽差集 / 名字↔id 解析，C2/C3/S3）
> - `src/shared/types.ts`（`TagDefinition` / `PageRule.tagIds` / `SyncState.tags` / 第 5 维度 4 处模型）
> - `src/shared/export-package.ts`（`PortableTag` / `PortableRule.tags` / `RULE_KEYS.tags` / 双向映射 / 自洽判定，A3/A4/S3）
> - `src/shared/messages.ts`（**新**：`CREATE_TAG` / `RENAME_TAG` / `DELETE_TAG` / `SET_RULE_TAGS`，A1）
> - `src/background/tag-service.ts`（**新**，标签表独占 + 上限/去重/级联/悬空剥离，A1/A-h/D3）
> - `src/background/storage-repository.ts`（标签搬运原语：`getTags` + `mutateSyncTags`，A-g）
> - `src/background/worker-orchestrator.ts`（路由 + `KNOWN_ACTIONS` 同提交，A-c 类护栏）
> - `src/shared/import-diff.ts` + `src/background/import-export-service.ts`（第 5 维度 presence + 两处裁决点，A7/A8/A9/A10）
> - `src/ui/shared/tag-chip-input.tsx`（**新**，chip 构建器，G5/D2/R6）
> - `src/ui/shared/rule-form-fields.tsx` + `src/ui/shared/rule-form-submit.ts` + `src/ui/sidebar/App.tsx`（打标入口 G3）
> - `src/ui/settings/App.tsx`（`RulesSection` chip 筛选 + Tags 列 / `TagsSection` 第 7 页 / `ImportExportSection` 第 5 维度卡片 + 两处弹窗）
> - 测试：表达式引擎穷举（含深嵌套不崩）/ 领域函数 / `TagService` 上限与级联原子性 / 第 5 维度协议 / 导入导出对称性 / chip 结构守卫
>
> **Estimated Effort**: **L（3–4 天）** — **21 个实现任务（T1–T21）+ 4 个终审（F1–F4）**
> **Parallel Execution**: YES — 5 Waves（Wave 4 为 `App.tsx` 串行集成段）+ FINAL
> **Critical Path**（**唯一权威**，全计划仅此一条）: `T1 → T4 → T9 → T15 → T20 → F1–F4 → user okay`
> （`T2/T3/T5/T6/T7/T8/T10/T11/T12/T13/T14` 为该链上的**并列前置**，可并行完成、不延长链路；`T16/T17/T18/T19/T21` 不在链上。）
> **关键风险**: **编译期护栏造成的多波中间红灯窗口**（P7：加必填字段 ⇒ 逐处编译报错，这是**特性**而非缺陷）+ **`App.tsx` 单文件多点改动**（严格串行）+ **测试 fixture 连锁面（63 文件触碰 `SyncState`/`PageRule` 构造）** + 深嵌套不得爆栈（D1）

---

## Context

### Original Request

由用户（主 Agent）交付一份**可执行工作计划**，输入为已四层收敛（0 OPEN、42 决策、6 回溯修订）且用户已批准的**设计**：

- **核心约束（一句话）**：标签是**纯组织维度**，**不进执行链**——该不变量由**模块边界**保证（`TagService` 不持有任何投递入口），而非靠调用者自觉；筛选是**完整布尔表达式**（chip 构建器 + 自研解析器），求值下沉到 **`src/shared/tag-expression.ts` 纯模块**。
- **原话诉求**：「迭代 rules 特性，支持 tag 标签系统，新增 rule 时可以指定多个 tag（也可以不指定），可以在 Page Rewrite Rules 界面通过 tag 筛选 rule，这个是必要的，为了管理更多的规则而设计。」
- **计划硬要求**：任务含 ID / 目标 / 改动文件（路径 + 行号）/ 依赖前置 / 验收方式（**具体测试层级 + 断言方向**）；按依赖顺序分波次并标出可并行部分；明确标识受**编译期护栏**保护的任务；标出实现期必须同步的既有文档/注释（主文档 §7 的 5 项）；尊重既有测试纪律——断言针对**不变式**而非「检测变化」，jsdom 无布局引擎处断言**结构**（参考 `tests/unit/ui/settings-class-css.test.ts`）。**不得修改设计文档，不得修改 `src/`（规划者只产出计划）。**

### Interview Summary

本会话**无访谈阶段**——用户明确「设计已经过 sw-brainstorming 四层评审并由用户批准，你的任务是规划实施，不要重新设计」。规划者职责收敛为 **D-d（测试分层与 RED 可构造性）** 与 **执行可构造性核实**，外加一项设计未覆盖但实现必须回答的事项：**编译期护栏造成的中间态红灯窗口如何组织**。

**Key Decisions（继承自设计，不再重开）**:

| 决策 | 内容 |
|---|---|
| G1 / A1 / A-a | 纯组织标签；独立 `TagService` + 独立消息族；**`TagService` 不持有投递入口** ⇒「标签不影响行为」由结构保证 |
| G3 / D-b / D-f | 打标入口 = 新建 + 单条编辑 + **Tags 管理页**；chip 输入框可就地新建（立即落盘，取消表单后标签留下 ⇒ 孤立标签由 Tags 页可见） |
| G4 / G5 / G6 | 布尔表达式（AND / OR / NOT / 括号优先级）；**结构化 chip 构建器 + 自研解析器，无自由文本**；变量只有标签 |
| C1 / C2 / C3 | 全局标签表 + 规则存 id；`TagDefinition = {id,name,backgroundColor,textColor}`；唯一性 = **trim 后逐字节相等**；每规则 ≤8 标签 / 名字 ≤32 字符 / 总数不限 |
| C4 / C5 / C6 / C7 / C8 | 级联删除 + 告知影响数；复用 `UndoBar`（原子批量快照，5s，`Confirm` 关闭 → 提交 → 再弹）；解析不成功一律「未筛选」；已删标签保留 chip + 表达式暂停 + 点名提示；表达式不设上限 |
| C9 / D1 / D2 / D3 / D4 | 不背兼容；解析求值**不得因深度崩溃**（迭代实现）；chip 自带「插入时的名字」；写入路径剥离悬空 tag id；**诊断不得含标签名** |
| A3 / A4 / A5 / A6 | 包内根级 `tags: PortableTag[]`（携颜色、**无 id**）+ `PortableRule.tags: string[]`（内联名）；导出侧消灭不自洽 ⇒ 落盘文件**恒自洽**；逐标签勾选 + 导出前弹窗 |
| A7 / A8 / A9 / A10 | `tags` 提供 `incremental`/`overwrite`；`overwrite` 的删除可由用户改判为 `incremental`；导入侧语义不自洽同样弹窗；悬空名字未命中 ⇒ 默认外观创建 + 披露数量 |
| S1 / S2 / S3 / S4 / S5 / S6 | 6 项回溯修订（颜色属性、包内实体、导出侧消不自洽、维度模式、第 5 维度、导入侧默认外观） |
| D0 / D-a / D-c / D-d / D-e / D-g | `tags` 为独立第 5 维度（同步 4 处模型）；第 7 导航页；Tags 列默认收起；框体自动折行不截断；后果式弹窗措辞；6 条红线 R1–R6 |

### Research Findings（规划期实读源码核实，非引用设计）

| # | 实测事实 | 证据（文件:行） | 对计划的影响 |
|---|---|---|---|
| R1 | `RULE_KEYS` 用 `as const satisfies Record<keyof PortableRule, true>` **穷尽校验** | `export-package.ts:159-161` | 给 `PortableRule` 加 `tags` 不同步 allowlist = **编译错误**（护栏已存在）；T1 依赖它 |
| R2 | `ROOT_KEYS`/`SLOT_KEYS`/`SETTINGS_KEYS` 同机制；`PACKAGE_FIELD_ALLOWLIST` 由其 `Object.keys` 派生 | `export-package.ts:139-168` | 新增 `PortableTag` 需**同时**加 `TAG_KEYS` 才能被 tolerant reader 覆盖；T1 |
| R3 | `mutateSync` 串行队列 + `structuredClone` + `stripDerivedRecipeValues` 双侧 + 内部 `configVersion+1`、**无乐观锁** | `storage-repository.ts:762-789` | **级联删除的原子性免费获得**（A-g）：标签表改动 + N 条引用清理写进**同一个 mutator** 即为一笔事务；T6 |
| R4 | `mutateSync` 是**私有**；`addRule`/`updateRuleById`/`removeRuleById` 为其既有薄封装 | `storage-repository.ts:709-752` | 需新增标签专用薄封装（`mutateSyncTags`），**不**把业务规则下沉到存储层（A1-C 否决理由）；T6 |
| R5 | `applyToMatchingTabs` **仅 3 个调用点**，全部在 `rule-service.ts`（create/update/delete） | `rule-service.ts:172,283,311` | 标签写入**绝不能**经过该路径——这是 G1「零行为变化」最易被破坏处；T9 用「`TagService` 无投递入口」结构保证 |
| R6 | `KNOWN_ACTIONS` 是**手写白名单** + `_Unknown`/`_NotAnAction` 双向 `Exclude` 编译守卫 | `worker-orchestrator.ts:53-114` | 新增 4 个标签动作**必须同提交**清理白名单，否则「编译过、运行被拒」；T7 |
| R7 | `DimensionPresence` 是**必填**结构；`DIMENSION_META` 是 `Record<keyof DimensionPresence, …>`（加字段即编译错误） | `types.ts:422-427`、`App.tsx:3011-3016` | D0 的补偿事实：**加第 5 维度会逐处编译报错，不会漏**；T1/T14 |
| R8 | `DIMENSION_LABELS` 是 `ReadonlyArray<{dim: keyof DimensionPresence; label}>` | `App.tsx:2998-3003` | 增 `tags` 项后**所有** `DIMENSION_LABELS.map` 消费者自动覆盖（导出卡片/导入卡片/结果清单，共 5 处）；T14 |
| R9 | `import-diff.ts` 的 `presence(pkg)` 返回 4 键 `DimensionPresence` | `import-diff.ts:141` | 需加 `tags` 键；T8 |
| R10 | `ImportExportService.applyImport` **手工构造** `dimensions` 四键对象 | `import-export-service.ts:401-409` | 需加 `tags` 键 + 计数来源（标签维度非记录列表，计数语义需定义）；T8 |
| R11 | `defaultImportIntent()` 返回 4 键 `dimensionModes` | `types.ts:320-329` | 需加 `tags: 'incremental'`；T1 |
| R12 | `createDefaultSyncState` / `migrateSyncState` 用 `??` **宽容补齐**（注释明写 **NO MIGRATION** 裁决） | `storage-repository.ts:79-88, 244-261` | 本机存档缺 `tags`/`tagIds` 沿此宽容补齐（P2 裁决）；T1/T6 |
| R13 | D-13 prune 用 `useEffect` + `visible` Set，依赖 `[search, sort, rules]` | `App.tsx:1034-1046` | R1 红线：表达式输入须进入该依赖；T14 |
| R14 | `UndoBar` 快照模型是 `UndoLayerWrite[]`（`tab-override` / `slot-marker` 两个 kind） | `undo-bar.tsx:18-44` | C5 的「标签实体 + N 条引用」需**扩展**该 discriminated union（P3 裁决），**不新建撤销机制**；T15 |
| R15 | `UndoBar` 默认 5000ms；`Confirm` 有 **120ms 防误触窗口**且 confirm 按钮 DOM 序优先 | `undo-bar.tsx:62`、`components.tsx:322-336` | R3/R4 红线（`Confirm`→提交→再弹，串行；破坏性操作不设默认按钮）；T15/T16 |
| R16 | 诊断契约 `isSanitized` 断言不含 `http://`/`https://`/`title`/`regex`/`pattern` | `diagnostics-service.ts:75-84` | D4 落点：标签名与页面标题同级敏感，不得进诊断；T20 反例搜索 |
| R17 | `settings-class-css.test.ts` 是「**表而非记忆**」结构守卫：递归 walk + 双向 comment-strip + **判定器可判别性 case table** | `tests/unit/ui/settings-class-css.test.ts` | 新类的定义完整性 + chip 可访问性守卫须遵循该范式（R6）；T13/T21 |
| R18 | `layer-boundary.test.ts` 用 **allowlist 属性断言**（`src/shared/**` 不得解析出界）+ 判别性 case table | `tests/unit/shared/layer-boundary.test.ts` | `tag-expression.ts` / `tags.ts` 落在 `src/shared` ⇒ **自动**受该守卫约束（A-b：不得依赖 React/chrome）；T5 |
| R19 | 三层 vitest project：`unit` / `integration` / `ui-smoke`，全部 jsdom；`alias` 含 `@shared`/`@background`/`@ui` 等 | `vitest.workspace.ts` | 任务验收必须指名**具体 project** 与文件路径；T3 |
| R20 | 全仓 **63 个测试文件**构造 `SyncState` / `PageRule` fixture | `search_content` 计数 | `PageRule.tagIds` 若**必填**则连锁面巨大 ⇒ 由 T19 专门迁移（P1 裁决）；**不得**为绕编译改成可选 |
| R21 | 无 `_context/` 目录（仅 `_context-output/`）；既有 7 个计划均在 `_context-output/plans/`，证据约定 `_context-output/evidence/` | 目录清单 | 计划与证据路径遵循仓库既有惯例（P8 裁决） |
| R22 | 现有 nav **6 项**；`SettingsSection` 联合类型 6 个字面量；`NAV_ITEMS` 6 项；`App.tsx` 约 4900 行 | `App.tsx:53, 214-221` | 第 7 页 = 3 处同改（`SettingsSection` / `NAV_ITEMS` / `renderSection`）；**`App.tsx` 巨型文件 ⇒ 多任务严格串行** |
| R23 | `RuleFormFields` 是 sidebar/settings **共用**的唯一规则表单字段集（SC8 / IMP-7） | `src/ui/shared/rule-form-fields.tsx:1-18` | 打标入口须加在该共享组件 ⇒ 一处改动覆盖两入口（G3）；T13 |
| R24 | `PortableSettings` 有「**absent ≠ carried-and-empty**」先例注释（R4/9） | `export-package.ts:68-94` | `ExportScope.tags?: boolean` 与包内 `tags?` 沿用该语义；T1/T11 |

### Pre-Planning Review（内联 Metis 缺口分析）

> **Intent Classification**: `Mid-sized Task` / 置信度 **high** —— 有边界的功能迭代（新增标签实体 + 表达式引擎 + 第 5 维度协议 + 3 处 UI），边界已由设计四层锁定（42 决策 / 0 OPEN），非绿地、非纯重构。
> **AI-Slop 扫描**: 检测到 **Scope Inflation**（「其他系统也会用到 tag」可能被扩成通用标签平台）、**Premature Abstraction**（表达式引擎可能被抽成通用查询语言）、**Gold-Plating**（容量 8KB 可能被顺手拆 key）三类信号，已注入 Guardrails 抑制。

**Identified Gaps（addressed）**:

| # | Gap | 处置 |
|---|---|---|
| G-A | **编译期护栏的中间态红灯窗口**（设计未覆盖） | **P7 裁决**：T1 落地后 `typecheck` 会（**预期地**）在 `presence` / `dimensions` / `App.tsx` 元数据 / 全 fixture 处报错——**这些错误就是下游任务的入口清单**（D0 的补偿事实即此）。**收口点明示**（已实测 `tsconfig.json`：`include` = `["src","tests","vite.config.ts","vitest.config.ts","scripts"]` ⇒ **`typecheck` 覆盖 `tests`**）：**src 侧 0 error** = **T14 完成**（用「`error TS` 行中落于 `src/` 的条数 = 0」判定）；**全仓 0 error + 三层测试全绿** = **T19 完成**。计划**不假装**每任务独立绿，改以「波末 `typecheck` 断言错误集合 ⊆ 预期清单」为验收形式。 |
| G-B | **`PageRule.tagIds` 必填 vs 可选**（设计写死必填，但会连锁 63 文件） | **P1 裁决**：**必填**（遵设计 Data Model + C9-①）。连锁面由 **T19** 一次性迁移；**禁止**改成可选来规避编译错误（那会让「引用完整性」在类型层失守）。 |
| G-C | **本机存档缺 `tags`/`tagIds` 的读取姿态**（C9-① 原措辞「视为损坏并拒绝」与 `migrateSyncState` 既定的宽容立场冲突） | **P2 裁决**：本机读取**沿用宽容 `??` 补齐**（R12 的 NO MIGRATION 立场 = 宽容读取，非迁移分支）；严格性**只施加于导入包**（C9-②）。**✅ 已回写上游**：C9-① 措辞经设计方修订为「不兼容 = 不写迁移分支，而非读取必须严格」，并在 `constraint-boundaries` §C9 与 `decisions.yaml` C9 条目中记录了冲突证据（`migrateSyncState` 对每个顶层字段都 `??` 兜底）。**P2 现已与修订后的 C9 一致，不再是「计划层覆盖设计」。** |
| G-D | **`UndoBar` 如何承载「标签实体 + N 条引用」** | **P3 裁决**：新增 `UndoLayerWrite` 第 3 个 kind（`tag-delete`），复用既有原子批量重放契约（DT9）。**不新建机制**（C5 明令）。discriminated union ⇒ 加 kind 会逐处编译报错（额外护栏）。 |
| G-E | **`TagService` 与 `StorageRepository` 的分工边界** | **P4 裁决**：业务规则（trim 去重 / 上限 / 级联语义 / 悬空剥离）**全在 `TagService`**；`StorageRepository` 只加搬运原语。遵 A1-C 的否决理由。 |
| G-F | **深嵌套的深度保护策略**（D1 只说「迭代实现 / 深度保护」） | **P5 裁决**：**显式栈迭代**，非「递归 + 深度计数」。C8 无上限 ⇒ 深度只受内存约束；「爆栈 ⇒ 设置页白屏」不可接受。 |
| G-G | **chip 的「插入时名字」（D2）存哪** | **P6 裁决**：存于 **UI 态**（不落盘）。C9-③ 表达式不持久化；D2 只需显示后备（设计明写「无需墓碑记录」）。 |
| G-H | **`tags` 维度的 `changed` 计数语义**（`ImportDimensionOutcome` 是 `{changed, failed}`，但标签不是记录列表） | **T8 内定义**：`changed` = 本次导入实际写入的标签实体数（新建 + 改名/改色的复用命中）；`failed` = 因上限/重复被拒的个数。与「钉在 diff 行上」的既有口径一致（R10 注释：数字与行不能矛盾）。 |

**Guardrails Recommended**:

1. **标签不得进执行链**（G1）——反例搜索：`rg "tagIds|tags\b" src/background/rule-service.ts src/background/field-delivery-service.ts src/shared/field-chain.ts` → **0 命中**（I1 的机械守卫）。
2. **`TagService` 不得持有投递入口**（A-a）——反例搜索：`rg "delivery|applyToMatchingTabs|redeliver" src/background/tag-service.ts` → 0。
3. **不新增第 3 个第三方依赖**（`package.json` dependencies 恒为 `react` + `react-dom`）——F2 核对 diff。
4. **不拆 sync key / 不做容量改造**（C0 明确拒绝）——反例搜索：`rg "QUOTA_BYTES_PER_ITEM|SYNC_KEY" src/` 命中数**不变**。
5. **不做旧档兼容 / 迁移分支**（C9）——反例搜索：`rg "legacy|migrateTag|backCompat" src/shared/tags.ts src/background/tag-service.ts` → 0。
6. **诊断不得含标签名**（D4）——反例搜索：标签名不得出现在 `diagnostics-service.ts` 写入的任何 entry（T20 断言）。
7. **`src/shared/**` 不得解析出界**（A-b，既有守卫）——`tag-expression.ts` / `tags.ts` 不得 import React / chrome / `@ui` / `@background`。
8. **不把 `tags` 做成通用查询语言**（G6 明确否决 `field op value` 预埋）——表达式变量**只有标签**。
9. **不修改设计文档**（本计划只读设计层）；**不修改 `src/`**（规划者职责边界）。

**Defaults Applied（计划层默认 — P1–P8，覆盖方式见 §Open Questions）**:

| # | 裁决 | 依据 |
|---|---|---|
| P1 | `PageRule.tagIds` **必填** | 设计 Data Model 写死；C9-① |
| P2 | 本机读取**宽容补齐**；严格性只施加于导入包 | R12 既定 NO MIGRATION 立场；C9-①（**已按本裁决修订措辞**）+ C9-② |
| P3 | `UndoLayerWrite` 增 `tag-delete` kind | C5「复用现有 UndoBar / 无新机制」 |
| P4 | 业务规则在 `TagService`；存储层只加搬运原语 | A1-C 否决理由 |
| P5 | 表达式**显式栈迭代** | C8 + D1「不得爆栈」 |
| P6 | chip 后备名存 **UI 态** | C9-③；D2「无需墓碑」 |
| P7 | 中间红灯窗口**接受并登记**；收口点 = **T14（`src/` 侧 typecheck 0）** / **T19（全仓 typecheck 0 + 三层测试全绿）**（`tsconfig.include` 含 `tests`，已实测） | D0 补偿事实 |
| P8 | 证据目录 = `_context-output/evidence/` | R21 仓库惯例 |

---

## Work Objectives

### Core Objective

在**不改变任何规则执行行为**的前提下，为规则引入可跨系统复用的**标签实体**与可表达完整布尔的**筛选表达式**，并把 `tags` 接入既有的导入导出与破坏性操作保护体系（`Confirm` / `UndoBar` / diff 披露），使 50–300 条规模下的规则**可被找到**。

### Concrete Deliverables

- [ ] `src/shared/tag-expression.ts`（**新**）— AST + **迭代**解析 + **迭代**求值 + 名字↔id 实体解析；无 React / chrome 依赖（A2/A-b/D1）
- [ ] `src/shared/tags.ts`（**新**）— 领域纯函数：`normalizeTagName`（trim）/ `validateTagLimits`（≤8、≤32）/ `collectRuleTagNames` / `selfConsistencyDiff`（S3 差集）/ `resolveTagIdsByName`（C2/A-e）
- [ ] `src/shared/types.ts` — `TagDefinition`、`PageRule.tagIds`、`SyncState.tags`、`ExportScope.tags?`+`excludedTagNames?`、`DimensionPresence.tags`、`ImportIntent.dimensionModes.tags`、`ImportDimensionOutcomes.tags`、`defaultImportIntent` 增项；**并改 `:223` 注释为 5 个维度**（§7 第 1 项）
- [ ] `src/shared/export-package.ts` — `PortableTag`、`PortableRule.tags`、`RULE_KEYS.tags`、`TAG_KEYS`、`syncStateToPackage` 携带 tags、`packageToSyncPatch` 名字→本地 id、自洽判定接线（A3/A4/S3）
- [ ] `src/shared/messages.ts` — `CreateTagRequest` / `RenameTagRequest` / `DeleteTagRequest` / `SetRuleTagsRequest` + `UiRequest` 联合 + 响应类型（A1）
- [ ] `src/background/tag-service.ts`（**新**）— CREATE/RENAME/DELETE/SET_RULE_TAGS；上限 / trim 去重 / **级联删除（单 mutator）+ 悬空剥离**（D3/A-g/A-h）
- [ ] `src/background/storage-repository.ts` — `getTags()` + `mutateSyncTags(mutator)` 搬运原语；`createDefaultSyncState`/`migrateSyncState` 补 `tags`（R12/P2）
- [ ] `src/background/worker-orchestrator.ts` — 4 个标签路由 + `KNOWN_ACTIONS` **同提交**（R6）
- [ ] `src/shared/import-diff.ts` + `src/background/import-export-service.ts` — `presence` 加 `tags`；`dimensions` 加 `tags` 计数；导入两处裁决点（A7/A8/A9/A10）
- [ ] `src/ui/shared/tag-chip-input.tsx`（**新**）— chip 构建器（点选标签 / 运算符 / 括号；**就地新建**；可聚焦 + 键盘删除 + 可访问名称）（G5/D-b/R6）
- [ ] `src/ui/shared/rule-form-fields.tsx` + `rule-form-submit.ts` + `src/ui/sidebar/App.tsx` — 打标入口（G3/R23）
- [ ] `src/ui/settings/App.tsx` — `RulesSection`（chip 筛选 + Tags 列默认收起 + D-13 prune 扩展）/ `TagsSection`（第 7 页，增删改查 + 孤立标签 + 删除 `Confirm`→`UndoBar`）/ `ImportExportSection`（第 5 维度卡片 + 两处不自洽弹窗 + 结果披露）
- [ ] `src/ui/styles/settings.css` — 新增 `tbs-settings__tag-*` / `tbs-tag-chip*` 类定义（R17 守卫）

### Definition of Done

- [ ] `npm run typecheck` → **0 error**（**全仓**含 `tests`；P7 收口点 = **T19 完成时**达成；T14 完成时须得 **`src/` 侧 0 error**：
      `npm run typecheck 2>&1 | grep "error TS" | grep -c "src/"` → 0。
      ⚠️ **中间红灯是预期的**（P7）：T1 之后 `tsc` 必然报错，判定标准是「错误集合 ⊆ T1 的 5 项预期清单」，
      **不得**在 T14/T19 之前要求 0 error。）
- [ ] `npm run lint` → **0 warning**（`--max-warnings 0`；不放宽 `eslint.config.mjs`）
- [ ] `npm run test:unit` → ALL PASS；`npm run test:integration` → ALL PASS；`npm run test:ui-smoke` → ALL PASS
- [ ] `npm run build:chrome && npm run build:edge && npm run build:firefox` → 三浏览器均成功
- [ ] **反例搜索 I1（标签不进执行链）**: `rg "tagIds" src/background/rule-service.ts src/background/field-delivery-service.ts src/shared/field-chain.ts` → **0 命中**
- [ ] **反例搜索 A-a（`TagService` 无投递入口）**: `rg "delivery|applyToMatchingTabs|redeliver" src/background/tag-service.ts` → **0 命中**
- [ ] **反例搜索 C0（未拆 key）**: `rg -c "SYNC_KEY" src/background/storage-repository.ts` 与改造前一致；`package.json` dependencies 仍恰为 `react` + `react-dom`
- [ ] **表达式深嵌套不崩**: 构造 5000 层括号表达式，`unit` 测试下 `parse` + `evaluate` **不抛栈溢出**且不阻塞（D1）
- [ ] **级联删除原子性**: 一次 `DELETE_TAG` 后 `configVersion` **恰 +1**，且标签表与全部规则引用在**同一笔**写入内一致（A-g）
- [ ] **导出恒自洽**: 任意 `ExportScope` 下产出的包满足 `union(被导出规则的 tags) ⊆ 根级 tags`（S3）
- [ ] **导入往返保真**: 导出 → 导入后标签名与颜色一致；悬空名字的两种命中/未命中路径分支均被断言（A-e/A-f/S6）
- [ ] **`tags` 维度与既有 4 维度同构**: `DIMENSION_LABELS` / `DIMENSION_META` / 卡片 / 模式选择器 / 结果计数均覆盖 `tags`（R5 红线）

### Must Have

- [ ] 标签**不影响**匹配 / 优先级 / 启用——由 `TagService` 不持有投递入口**结构保证**（A-a / I1）
- [ ] `SyncState.tags: TagDefinition[]`（含 `backgroundColor`/`textColor`）+ `PageRule.tagIds: string[]`（C1/S1/A6）
- [ ] 唯一性 = **trim 后逐字节相等**（`Work ≠ work`，`work` vs ` work ` 必须拒绝）；**颜色不参与身份**（C2/S1）
- [ ] 每规则 ≤8 标签、名字 ≤32 字符、**总数不限**（C3）
- [ ] 删除标签 = `Confirm` 报影响数（「将被 N 条规则摘除」）→ 级联摘除 → **`UndoBar` 可撤销**（C4/C5/R3）
- [ ] 写入路径在持久化前**剥离悬空 tag id**，落点 `TagService`（D3/A-h）
- [ ] 布尔表达式：AND / OR / NOT / 括号优先级；**chip 构建器 + 自研解析器，无自由文本**（G4/G5）
- [ ] 解析不成功 → **一律「未筛选」（显示全部）** + 框边轻提示（C6）
- [ ] 引用的标签已删 → **保留 chip + 表达式暂停生效 + 点名提示**，chip 显示**后备名**（C7/D2）
- [ ] 解析与求值**不得因深度崩溃**（显式栈迭代）（C8/D1）
- [ ] 包内根级 `tags: PortableTag[]`（**携颜色、无 id**）+ `PortableRule.tags: string[]`（内联名）（A3/A4/S2）
- [ ] 导出**逐标签勾选** + 差集非空时**后果式弹窗**（补足 / 丢弃，两选项**等权、无默认按钮**）（A5/D-e/R4）
- [ ] 导入 `overwrite` 的删除**可由用户改判为 `incremental`**；且**必须经 diff 披露**，不得绕过 C4 保护（A7/A8/§7 第 5 项）
- [ ] 导入语义不自洽 → 同样弹窗（补足最小集 / 丢弃悬空）（A9）
- [ ] 悬空名字「文件没有、本机也没有」→ **默认外观创建 + 结果披露数量**；本机命中则复用本机颜色（A10/S6）
- [ ] 第 5 维度 `tags` 同步 4 处模型 + `DIMENSION_LABELS`/`DIMENSION_META`（S5/D0/R5）
- [ ] 第 7 个导航页 **Tags**（增删改查 + **孤立标签可见**）（D-a/C3）
- [ ] Rules 表新增 **Tags 列（默认收起）**，由 `⊘` 开关切换（D-c）
- [ ] chip **可聚焦、可键盘删除、有可访问名称**（R6）
- [ ] **诊断不含标签名**（D4）
- [ ] 就地新建标签**立即落盘**（取消表单后留下，由 Tags 页可见），且**必须走同一条 `TagService` 写入路径**（D-b/D-f/A1）

### Must NOT Have (Guardrails)

- [ ] **标签不进执行链**（I1）——不在 `resolveFieldChain` / `selectWinningRule` / 投递路径出现 `tagIds`/`tags`
- [ ] **`TagService` 不持有投递入口**（A-a）——不得调 `applyToMatchingTabs` / `FieldDeliveryService`
- [ ] **不扩展 `RuleService` 管标签**（A1-B 已否决）——`RuleService` 不感知标签表
- [ ] **不新增第三方运行时依赖**（`package.json` dependencies 恒 2 项）
- [ ] **不拆 sync key / 不做容量改造**（C0 明确拒绝）——容量问题单独立项
- [ ] **不做软删除 / 归档 / 墓碑**（C4/C7/D2 均否决第三态）
- [ ] **不做「草稿标签」第三态**（D-f 否决）——不得出现「引用一个尚未落盘的标签」
- [ ] **不做自动摘除 chip / 不自动规范化表达式**（C7-A 已否决）
- [ ] **不做旧档兼容 / 迁移分支 / 静默纠正**（C9）
- [ ] **不预埋 `field op value` 形状**（G6-C 已否决）——表达式变量只有标签
- [ ] **不给表达式设上限 / 不降级为「N 个条件」摘要 / 不转内部滚动**（C8/D-d 已否决）
- [ ] **不得给破坏性操作设默认按钮 / 不得让 `Enter` 触发默认项**（D-e-D/R4）
- [ ] **不得并行编辑 `src/ui/settings/App.tsx`**（R22 巨型文件 ⇒ 严格串行）
- [ ] **不修改设计文档**；**不修改与本计划无关的 `src/` 模块**

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.
> Acceptance criteria requiring "user manually tests/confirms" are FORBIDDEN.

### Test Decision

- **Infrastructure exists**: YES（Vitest 2；三层 project `unit` / `integration` / `ui-smoke`，全部 jsdom；基线 **152 文件 / 1323 测试全绿**）
- **Automated tests**: **TDD** —— 每个任务 `RED（失败测试）→ GREEN（最小实现）→ REFACTOR`
- **Framework**: Vitest 2（`vitest.workspace.ts` 三 project）+ `@testing-library/react`（UI）
- **命令**: `npm run test:unit` / `npm run test:integration` / `npm run test:ui-smoke` / `npm run typecheck` / `npm run lint`
- **RED 可构造性**：每任务显式说明「先写什么失败测试、如何断言它失败」。**jsdom 无布局引擎 / 无 canvas** ⇒ UI 任务只断言**结构 + 文案 + 可访问性**，**不得**断言像素或布局几何（遵 `settings-class-css.test.ts` 范式，R17）
- **编译期护栏的验证形式**（P7）：波末以 `npm run typecheck 2>&1 | grep "error TS"` 断言「错误集合 ⊆ 预期清单」，而非断言 0。**已实测 `tsconfig.include` 含 `tests`** ⇒ `typecheck` 覆盖测试：**`src/` 侧 0 error 的收口点 = T14**（判定式：`npm run typecheck 2>&1 | grep "error TS" | grep -c "src/"` → 0）；**全仓 0 error 的收口点 = T19**

### QA Policy

Every task MUST include agent-executed QA scenarios. Evidence saved to `_context-output/evidence/task-{N}-{scenario-slug}.{ext}`（P8：仓库既有惯例）。

> **验证口径（统一，消除「手工」歧义）**：所有验证均为 **agent 自动化**，共三类 ——
> 1. **纯函数/服务**（`tag-expression` / `tags` / `TagService` / 协议）：`npx vitest run <file> --project unit`（或 `integration`），断言**输入→输出不变式**；
> 2. **`ui-smoke`（jsdom）结构断言**：`@testing-library/react` 断言 DOM 结构 + 文案 + `aria-*`（**不含** canvas 像素与布局几何；证据为 `.txt`）；
> 3. **静态结构守卫**（反例搜索 + `.css` 定义完整性）：Bash（`rg`）+ `npx vitest run tests/unit/ui/<guard> --project unit`，同 `settings-class-css.test.ts` 范式。
>
> **测试纪律（用户明确要求）**：断言针对**不变式**而非「检测变化」——如「`configVersion` 恰 +1」「差集为空」「`tagIds` 不含悬空 id」，而非「函数被调用过」。**禁止**用裸计数断言（`expect(x.length).toBe(3)`）替代结构性断言，除非该计数本身即不变量（如「≤8」）。

- **共享层纯模块**（`tag-expression` / `tags`）：`npx vitest run tests/unit/shared/<file> --project unit` —— 断言不变式 + **判别性 case table**（先例 `layer-boundary.test.ts:86-133`）
- **背景服务**（`TagService` / `storage-repository` / `import-export-service`）：`npx vitest run tests/integration/<file> --project integration`（`createMockAdapter()` + `repo.initialize()`，先例 `import-export-service.test.ts:88-90`）
- **UI**（settings 三处 / sidebar / 共享组件）：`npx vitest run tests/ui-smoke/<file> --project ui-smoke`（结构 + 文案 + `aria`）
- **协议护栏**（`KNOWN_ACTIONS` 双向守卫）：`npx vitest run tests/unit/shared/messages-import-export-contract.test.ts --project unit`（先例：以 `handleMessage` 私有通道驱动**真实**白名单闸门，R6）
- **反例搜索 / 结构守卫**：Bash（`rg`）+ `npx vitest run tests/unit/ui/settings-class-css.test.ts --project unit`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1（Start Immediately — 共享契约 + 护栏起点 + 盘点）:
├── T1: 数据模型 + 包协议契约（types.ts + export-package.ts）【护栏起点】[deep]
├── T2: 既有文档/术语同步（field-chain design §0.2 术语表）            [quick]
└── T3: 标签测试夹具 + fixture 迁移面盘点（tests/helpers/tag-fixtures.ts）[quick]

Wave 2（After Wave 1 — 领域纯函数 + 协议贯通，MAX PARALLEL）:
├── T4: tags.ts 领域纯函数（规范化 / 上限 / 自洽差集 / 名字↔id）      [deep]
├── T5: tag-expression.ts 表达式引擎（AST + 迭代解析 + 迭代求值）      [deep]
├── T6: storage-repository 标签搬运原语（getTags + mutateSyncTags）     [quick]
├── T7: messages.ts 标签消息族 + KNOWN_ACTIONS 同提交                  [deep]
└── T8: 第 5 维度协议贯通（import-diff presence + service dimensions）  [deep]

Wave 3（After Wave 2 — 服务 + 数据源 + 共享组件，MAX PARALLEL）:
├── T9:  TagService（上限/去重/级联/悬空剥离）+ worker 路由接线         [deep]
├── T10: TagService 导入两处裁决（overwrite 改判 + 语义不自洽）         [deep]
├── T11: 导出自洽数据源（ExportScope 勾选 + 差集 + exportPackage 携带）  [deep]
├── T12: chip 输入共享组件（tag-chip-input.tsx）+ 单元测试              [deep]
├── T13: 标签表单共享接线（rule-form-fields / rule-form-submit / sidebar）[deep]
└── T14: App.tsx 第 5 维度元数据 + D-13 prune 扩展【typecheck 收口】     [deep]

Wave 4（After Wave 3 — settings 三处，App.tsx 严格串行）:
├── T15: RulesSection chip 筛选 + Tags 列 + 表达式暂停提示              [deep]
├── T16: TagsSection 第 7 导航页（增删改查 + 孤立标签 + Confirm/UndoBar）[deep]
└── T17: ImportExportSection 第 5 维度卡片 + 两处弹窗 + 结果披露         [deep]

Wave 5（After Wave 4 — 收口 + 端到端 + 守卫）:
├── T18: 第 5 维度结构守卫（类定义完整性 + chip a11y + 反例搜索）        [deep]
├── T19: fixture 连锁迁移 + 既有测试锚点对齐（必填 tagIds）             [deep]
├── T20: 集成端到端（导出→导入往返 / 两处裁决 / 级联原子性）             [deep]
└── T21: §7 五项文档/注释复核 + I1/A-a 机械反例搜索                    [quick]

Wave FINAL（After ALL tasks — 4 parallel reviews, then user okay）:
├── F1: Plan Compliance Audit
├── F2: Code Quality Review
├── F3: Real Manual QA
└── F4: Scope Fidelity Check
→ Present results → Get explicit user okay

Critical Path（唯一权威）: T1 → T4 → T9 → T15 → T20 → F1–F4 → user okay
Parallel Speedup: ~65% faster than sequential
Max Concurrent: 6（Wave 3）
```

> **同波无依赖校验（逐项，声明须与实际依赖一致）**：
> - Wave 2：T4←T1 ✓；T5←T1 ✓；T6←T1 ✓；T7←T1 ✓；T8←T1 ✓（**全部指向 Wave 1**）
> - Wave 3：T9←T4/T6/T7 ✓；T10←T4/T8/T9 ✓；T11←T4/T8 ✓；T12←T1/T5 ✓；T13←T1/T12/T7 ✓；T14←T1/T8 ✓（**全部指向 Wave 1/2**）
> - Wave 4：T15←T5/T12/T13/T14 ✓；T16←T9/T12/T14 ✓；T17←T8/T11/T14 ✓（**全部指向 Wave 1–3**）
> - Wave 5：T18←T12/T15/T16/T17 ✓；T19←T1（+ 全部 src 改动，见下）；T20←T9/T10/T11/T19 ✓；T21←全部 ✓
> **同文件串行提醒（强制）**——下表由 21 个任务的 Commit Files **实测汇总**（非声明），所有权即事实：
>
> | 文件 | 触及者（波次） | 约束 |
> |---|---|---|
> | `src/shared/types.ts` | **T1**(W1) · **T7**(W2) · **T8**(W2) · **T10**(W3) | ⚠️ **T7 与 T8 同波 ⇒ 必须串行**：`T7 → T8`。执行器**不得**并发编辑该文件 |
> | `src/ui/settings/App.tsx` | **T2**(W1，仅注释) · **T14**(W3) · **T15/T16/T17**(W4) | W4 内**严格串行** `T15 → T16 → T17`（R22 巨型文件 ≈4900 行） |
> | `src/ui/styles/settings.css` | **T12**(W3) · **T15/T16/T17**(W4) | 随 App.tsx 串行；W4 内不得并发 |
> | `src/shared/export-package.ts` | **T1**(W1) · **T11**(W3) | **不是**「仅 T1 触及」。T1 把映射层与 allowlist 做完；T11 追加自洽判定（**只增，不改 T1 既有导出形状**） |
> | `src/background/worker-orchestrator.ts` | **T7**(W2) · **T9**(W3) | 跨波，安全。T7 做动作白名单 + 装配点占位；T9 注入 `tagService` 实例 |
> | `src/background/import-export-service.ts` | **T8**(W2) · **T10**(W3) | 跨波，安全。T8 做维度形状；T10 做两处裁决点 |
> | `src/shared/messages.ts` | **T7**(W2) | 一次（`UiRequest` 联合与 `KNOWN_ACTIONS` **同提交**，R6） |
> | `src/ui/sidebar/App.tsx` | **T13**(W3) | 一次 |
> | `src/background/rule-service.ts` | **T1**(W1) | 一次（**仅机械补 `tagIds: []`**，见 T1 Commit 注记；I1 由搜索守卫保证） |
> | `tests/**` | **T3**(W1，新建 helper) · **T19**(W5，**唯一** fixture 迁移) | 其余任务**不得**为让测试编译而改既有 fixture（P1/P7）；新测试文件由各任务自建，不算迁移 |
>
> **三个必须遵守的后果**：
> 1. **Wave 2 不得让 T7/T8 并发**：二者都要写 `types.ts`（T7 增请求/响应形状，T8 增 diff 形状，**区域不同但文件同一**）⇒ 串行执行，或由执行器强制「T7 提交后再开 T8」。
> 2. **Wave 4 的 `settings.css` 与 `App.tsx` 同步串行**：T15/T16/T17 都在改这两者。
> 3. **T2 的 App.tsx 改动限于注释**（`isRecordDimension` 的分类说明，§7 第 3 项）⇒ 与 W3 的 T14 **无区域重叠**，但若执行序推迟 T2 到 W3 之后，须改为串行。

### Dependency Matrix

```
- T1:  No dependencies（Wave 1）【护栏起点：PageRule.tagIds 必填 / DimensionPresence.tags 必填 / RULE_KEYS.tags】
- T2:  No dependencies（Wave 1）
- T3:  No dependencies（Wave 1）
- T4:  depends on T1（TagDefinition 形状）— Wave 2
- T5:  depends on T1（TagDefinition 用于实体解析）— Wave 2
- T6:  depends on T1（SyncState.tags）— Wave 2
- T7:  depends on T1（消息 payload 引用 TagDefinition）— Wave 2
- T8:  depends on T1（DimensionPresence.tags / PortableTag）— Wave 2
- T9:  depends on T4（领域函数）, T6（原语）, T7（消息）— Wave 3
- T10: depends on T4（差集）, T8（presence）, T9（TagService 落点）— Wave 3
- T11: depends on T4（差集）, T8（包形状）— Wave 3
- T12: depends on T1（TagDefinition）, T5（AST 类型）— Wave 3
- T13: depends on T1, T12（chip 组件）, T7（消息）— Wave 3
- T14: depends on T1, T8（第 5 维度模型）— Wave 3【**`src/` 侧 typecheck 0** 的收口点】
- T15: depends on T5（求值）, T12（chip）, T13（表单），T14（元数据/D13）— Wave 4（**串行首位**）
- T16: depends on T9（TagService 消息）, T12（chip）, T14 — Wave 4（**串行次位**）
- T17: depends on T8（Diff 形状）, T11（自洽数据源）, T14 — Wave 4（**串行末位**）
- T18: depends on T12, T15, T16, T17（须守卫真实存在的类与 chip）— Wave 5
- T19: depends on **T1**（必填字段）+ 全部 src 改动完成 — Wave 5
- T20: depends on T9, T10, T11, T19（全链路可编译/可跑）— Wave 5
- T21: depends on 全部 — Wave 5
```

> **T19 的依赖说明**：其**语义**依赖是 T1（必填字段引入连锁），但**执行时机**必须在**所有 src 改动完成之后**（W5）——否则迁移过的 fixture 会因后续 src 变更再次失效。故登记为「Blocked By: T1（语义）· 执行序：所有 W1–W4 完成后」。

### Agent Dispatch Summary

```
- Wave 1: 3 tasks — T1->deep, T2->quick, T3->quick
- Wave 2: 5 tasks — T4->deep, T5->deep, T6->quick, T7->deep, T8->deep
- Wave 3: 6 tasks — T9->deep, T10->deep, T11->deep, T12->deep, T13->deep, T14->deep
- Wave 4: 3 tasks — T15->deep, T16->deep, T17->deep（**严格串行：T15 → T16 → T17**）
- Wave 5: 4 tasks — T18->deep, T19->deep, T20->deep, T21->quick
- Wave FINAL: 4 tasks — F1->oracle, F2->unspecified-high, F3->unspecified-high, F4->deep
```

> Wave 3 含 6 任务（最大并发）。**Wave 4 为 3 任务**——低于 5-8，属并行化规则的**自然例外**：三者共用 `src/ui/settings/App.tsx`，**结构上无法并行**（R22）。**Wave 5 的 T19/T20/T21 相互独立**（fixture 迁移 / 集成测试 / 文档复核），可并行。

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: WHAT TO DO + QA SCENARIOS + References + Commit info.
> **A task WITHOUT QA Scenarios is INCOMPLETE. No exceptions.**

- [x] **T1. 数据模型 + 包协议契约（护栏起点）**

  **What to do**:
  - `src/shared/types.ts`：
    - 新增 `TagDefinition`：`{ id: string; name: string; backgroundColor: string; textColor: string }`（C1/S1）。字段顺序与注释中**明写**「颜色是外观，不参与身份判定（C2）」。
    - `PageRule` 增 **必填** `tagIds: string[]`（P1；C1/A6）。
    - `SyncState` 增 `tags: TagDefinition[]`。
    - `ExportScope` 增 `tags?: boolean` 与 `excludedTagNames?: string[]`——**沿用** `PortableSettings` 的「absent ≠ carried-and-empty」注释口径（R24）。
    - `DimensionPresence` 增 **必填** `tags: boolean`（R7：必填即护栏）。
    - `ImportIntent.dimensionModes` 增 `tags: DimensionMode`（**必填**）；`defaultImportIntent()` 增 `tags: 'incremental'`（R11）。
    - `ImportDimensionOutcomes` 增 `tags: ImportDimensionOutcome`（**必填**）。
    - **改 `:223` 注释**「The four dimensions are FIXED (D5)」→ **5 个维度**（§7 第 1 项 / decisions.yaml `revised_authorities`）。
  - `src/shared/export-package.ts`：
    - 新增 `PortableTag = { name: string; backgroundColor: string; textColor: string }`（**无 id**，A4/S2）。
    - `PortableRule` 增 `tags: string[]`（内联名，A3）；**同步 `RULE_KEYS` 增 `tags: true`**（R1：`as const satisfies Record<keyof PortableRule, true>` ⇒ 不同步即编译错误）。
    - 新增 `TAG_KEYS = { name, backgroundColor, textColor } as const satisfies Record<keyof PortableTag, true>`；`PACKAGE_FIELD_ALLOWLIST` 增 `tag: Object.keys(TAG_KEYS)`（R2）。
    - `ExportPackage` 增 `tags?: PortableTag[]`；**同步 `ROOT_KEYS` 增 `tags: true`**。
    - `syncStateToPackage` 在 `scope.tags` 时产出 `pkg.tags`（**先做形状映射，差集逻辑留 T11**）；`packageToSyncPatch` 增「名字→本地 id」的**形状**处理（转发给 T4 的 `resolveTagIdsByName`，本任务只接线不实现）。
  - **RED 测试**（先写）：`tests/unit/shared/tag-types-contract.test.ts`
    - `RULE_KEYS` 含 `tags`（`PACKAGE_FIELD_ALLOWLIST.rule` contains `'tags'`）；`ROOT_KEYS`/`TAG_KEYS` 同理。
    - `defaultImportIntent().dimensionModes` 键集合 = `['slots','rules','settings','shortcuts','tags']`。
    - `PortableTag` **不含** `id`（负例：`#PACKAGE_FIELD_ALLOWLIST.tag` 不含 `'id'`）。
    - `PageRule` fixture 缺 `tagIds` ⇒ **typecheck 失败**（用 `// @ts-expect-error` 断言该必填性；这是**唯一的**「故意不填」用例，跑在 typecheck 而非 runtime）。
  - **不得**：把 `tagIds` 或 `DimensionPresence.tags` 写成可选；不得在这一步实现差集/校验/存储写入。

  **Must NOT do**:
  - 不得为「让全仓编译通过」把必填字段放宽为可选（P1）——**看到连锁编译错误是预期的**（P7）。
  - 不得改 `TAG_COLOR`/渲染相关代码（颜色渲染复用既有 `IconPreview` 三件套，S1）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 契约设计 + 两处 `satisfies` 穷尽校验 + 必填蔓延面的判断，需谨慎
  - **Skills**: [`sw-tdd-agent`, `sw-service-designer`] — TDD 循环 + 共享层契约设计
  - **Skills Evaluated but Omitted**: `sw-feature-designer`（无跨服务特性）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 1（with T2, T3）
  - **Blocks**: T4, T5, T6, T7, T8, T12, T13, T14, T19 | **Blocked By**: None

  **References**:
  - **Pattern References**:
    - `src/shared/export-package.ts:139-168` — `ROOT_KEYS`/`SLOT_KEYS`/`SETTINGS_KEYS`/`RULE_KEYS` 的 `as const satisfies` 穷尽校验范式 + `PACKAGE_FIELD_ALLOWLIST` 的 `Object.keys` 派生（R1/R2）
    - `src/shared/export-package.ts:68-94` — `PortableSettings` 的「absent ≠ carried-and-empty」语义注释，`ExportScope.tags?` 须沿用（R24）
    - `src/shared/types.ts:55-73` — `IconSource` 含 `backgroundColor`/`text`/`textColor` 的三件套形状；`TagDefinition` 与它同形（S1 的「与 recipe 图标同形」）
    - `src/shared/types.ts:113-124` — `PageRule` 当前形状（`tagIds` 的落点）
    - `src/shared/types.ts:529-539` — `SyncState` 当前形状（`tags` 的落点）
  - **API/Type References**:
    - `src/shared/types.ts:225-255` — `ExportScope`（`excludedSlotIds`/`excludedRuleIds` 的「只做减法」先例，`excludedTagNames` 须同构）
    - `src/shared/types.ts:422-427` — `DimensionPresence` 必填结构（R7）
    - `src/shared/types.ts:486-497` — `ImportDimensionOutcomes`（`tags` 项落点）
    - `src/shared/types.ts:320-329` — `defaultImportIntent()`（R11）
    - 设计 Data Model — `2026-10-10-rule-tags-design.md` §3（`TagDefinition` / `PageRule.tagIds` / `PortableTag` / 第 5 维度 4 处模型）
  - **Test References**:
    - `tests/unit/shared/messages-import-export-contract.test.ts:49-70` — 以**源码读取 + 字面量断言**守卫 allowlist/契约的范式（R6）
  - **WHY Each Reference Matters**: R1/R7 是把「加字段」变成**编译期强制**的两条现有护栏——本任务是**唯一**触发它们的任务，也是 P7 中间红灯窗口的**起点**。`ExportScope` 的「只做减法」（`excludedX`）必须先看清，否则 `excludedTagNames` 会被误写成「包含列表」。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`tests/unit/shared/tag-types-contract.test.ts` 存在且**初始失败**（新增 const 尚未导出）
  - [ ] GREEN：`npx vitest run tests/unit/shared/tag-types-contract.test.ts --project unit` → ALL PASS（≥4 断言组）
  - [ ] **编译期护栏生效**（P7）：`npm run typecheck 2>&1 | grep "error TS"` 的**错误集合 ⊆ 预期清单**；**预期外错误数（即清单外文件）= 0**。**此步不要求 0 error**（`src/` 侧收口点在 **T14**，全仓收口点在 **T19**）。
  - **预期清单（完整，5 处）**——`PageRule.tagIds` 为**必填**（P1）⇒ 凡是**构造** `PageRule` 字面量的地方都会报错，清单必须把它列全：
    1. `src/background/rule-service.ts:147`（`createRule` 的 `PageRule` 字面量）—— **本任务内即修**（加 `tagIds: []`，见 Commit Files），修完后该行**不再**出现于清单；
    2. `src/shared/import-diff.ts`（`presence(pkg)` 返回 4 键 `DimensionPresence`，R9）；
    3. `src/background/import-export-service.ts:401-409`（手工构造 `dimensions` 四键对象，R10）；
    4. `src/ui/settings/App.tsx`（`DIMENSION_META` 的 `Record<keyof DimensionPresence, …>`，R7）；
    5. `tests/**`（fixture 构造 `PageRule` / `DimensionPresence` / `dimensionModes`）。

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 穷尽校验护栏真的会拦（happy — 护栏存在性）
    Tool: Bash (vitest + tsc)
    Preconditions: T1 的 const 已导出
    Steps:
      1. npx vitest run tests/unit/shared/tag-types-contract.test.ts --project unit → ALL PASS
      2. 断言 PACKAGE_FIELD_ALLOWLIST.rule 含 'tags' 且 PACKAGE_FIELD_ALLOWLIST.tag 恰为 ['name','backgroundColor','textColor']
      3. 断言 defaultImportIntent().dimensionModes 恰有 5 个键且含 tags==='incremental'
    Expected Result: allowlist 与新形状同步；第 5 维度模型齐备
    Failure Indicators: allowlist 漏项（说明 satisfies 未生效或被绕过）
    Evidence: _context-output/evidence/task-1-contract-guards.txt

  Scenario: 必填字段的蔓延面是本任务可枚举的（failure — 中间红灯受控）
    Tool: Bash (tsc)
    Preconditions: 全仓未做下游迁移
    Steps:
      1. npm run typecheck 2>&1 | grep "error TS" > /tmp/t1-errors.txt
      2. 断言每一行都落在预期文件集合内（import-diff.ts / import-export-service.ts / App.tsx / tests/**）
      3. **反向断言（这步证明 I1 而非假设 I1）**：`rg "tagIds|tags" src/background/rule-service.ts` → **0 命中**。
         注意：`rule-service.ts:147` 会因 `PageRule` 字面量缺 `tagIds` 而**报错**（必填字段的蔓延，P1），
         这是**契约层**的报错，不是「标签到达执行链」——本任务已就地修好它（加 `tagIds: []`）。
         真正的 I1 断言是**标签名/id 不得作为业务概念出现在该文件**，故用第 3 步的搜索而非类型错误来判定。
    Expected Result: 连锁错误**只在契约消费者与 fixture**；`rule-service.ts` 只做「补一个空数组」这一处机械改动，
      不含任何标签业务逻辑（无 trim / 无去重 / 无级联 / 无投递）
    Failure Indicators: 预期外文件报错 / `rule-service.ts` 出现标签业务逻辑
    Evidence: _context-output/evidence/task-1-cascade-scope.txt
  ```

  **Evidence to Capture**: `task-1-contract-guards.txt`、`task-1-cascade-scope.txt`

  **Commit**: YES（groups with T1）
  - Message: `feat(shared): add tag data model, package shapes and fifth dimension contract`
  - Files: `src/shared/types.ts, src/shared/export-package.ts, src/background/rule-service.ts, tests/unit/shared/tag-types-contract.test.ts`
    - ⚠️ `src/background/rule-service.ts` 的改动是**机械补缺**：`createRule` 的 `PageRule` 字面量（`:147-157`）加 `tagIds: []`。
      必要性：`PageRule.tagIds` 为必填（P1）⇒ 不补则**本任务自身的 typecheck 恒报错**。
      **不属于**「标签到达执行链」：该文件**不得**出现任何标签业务逻辑（无 trim / 无去重 / 无级联 / 无投递消息）——
      由下方 QA 第 3 步的搜索守卫（I1）保证。这是本计划对 §7「实现期需同步项」的**第 6 项**。
  - Pre-commit: `npm run test:unit -- tests/unit/shared/tag-types-contract.test.ts`

- [x] **T2. 既有文档 / 术语同步（§7 第 4 项）**

  **What to do**:
  - 更新 `_context-output/designs/2026-10-02-field-chain-sync-detail-copy-a11y-design.md` **§0.2 术语统一表**：增 `tag` / `expression` / `predicate` / `chip` / `vocabulary` 五行，**用词以主设计 §Detail「术语定稿」表为准**（`tag / tags`、`expression`、`predicate`、`chip`、`vocabulary`）。
  - 在 `src/ui/settings/App.tsx:4090` 的 `isRecordDimension` 分类注释处**补一句**：标签维度走**部件型**管线（非记录型），故 `dim === 'tags'` **不得**被 `isRecordDimension` 捕获（§7 第 3 项）。**只改注释，不改逻辑**（逻辑在 T14）。
  - 在 `src/shared/types.ts:223` 已由 T1 改为 5 维度 —— 本任务**复核**该注释措辞与新维度清单一致（不重复改）。
  - **【grill 发现 · 笔误更正】** `2026-10-10-rule-tags-detail-interaction-copy-design.md` §2「术语定稿」表的 `词汇表 / vocabulary` 一行为 **`包内根级 tags: string[]（仅名字，A4）`** —— 该行**未随 S2 回溯修订更新**（S2 已把包内根级表改为 `PortableTag[]`，**仍不携带 id** 但**携颜色**）。**须更正为 `PortableTag[]`**（与 A4 修订版一致）。这是**事实性笔误更正，不是决策变更**：S2 的修订索引（decisions.yaml `revisions: S2`）明文记录 `S2: 包内 string[] → PortableTag[]（仍不携带 id）；规则侧仍内联名字`。
  - **不得**修改任何设计**决策**（只补术语/注释 + 上述**已由 S2 决定**的笔误更正）；不得改 `2026-10-10-*` 四份分册的**结论**（`vocabulary` 定义行属例外：它已与 S2 冲突）。

  **Must NOT do**:
  - 不得借「文档同步」重写设计结论或新增决策（设计已闭合，0 OPEN）。
  - 不得改代码逻辑。

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: 纯文档/注释编辑，范围明确
  - **Skills**: [`sw-grill-docs`] — 术语一致性质询与既有文档对照
  - **Skills Evaluated but Omitted**: `sw-tdd-agent`（无代码行为变化）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 1（with T1, T3）
  - **Blocks**: T21（§7 复核） | **Blocked By**: None（T1 的 `:223` 注释复核除外，见 What to do）

  **References**:
  - `_context-output/designs/2026-10-10-rule-tags-detail-interaction-copy-design.md` §2「术语定稿」 — 五个新术语的**权威拼写**
  - `_context-output/designs/2026-10-02-field-chain-sync-detail-copy-a11y-design.md:29-40` — §0.2 术语表的**现有表格形状**（须同构追加）
  - `src/ui/settings/App.tsx:4080-4090` — `isRecordDimension` 定义与其分类注释的落点
  - `_context-output/designs/2026-10-10-rule-tags-decisions.yaml:17-22` — `revised_authorities` 中登记的两项实现期同步
  - **WHY Each Reference Matters**: §7 的 5 项是设计**显式**登记的「实现期须同步」清单，遗漏会导致文档与代码长期漂移；术语表是**全产品只保留一套词**的机制（§0.2 原文），新术语不进表就等于允许第二套拼写。

  **Acceptance Criteria**:
  - [ ] `rg "vocabulary" _context-output/designs/2026-10-02-field-chain-sync-detail-copy-a11y-design.md` → ≥1 命中
  - [ ] §0.2 表格新增 5 行；表头与既有行**格式一致**（`| 概念 | 统一用词 | 禁用 |`）
  - [ ] `rg "isRecordDimension" src/ui/settings/App.tsx -A6` 的注释含「部件型」或等价措辞
  - [ ] **grill 笔误更正**：`rg "PortableTag\[\]" _context-output/designs/2026-10-10-rule-tags-detail-interaction-copy-design.md` → ≥1 命中；且**不再**命中 `包内根级 ` + `` `tags: string[]` ``
  - [ ] `npm run typecheck` 错误集合**与本任务前一致**（未引入新错误）

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 术语表覆盖本次迭代的五个新词（happy）
    Tool: Bash (rg)
    Preconditions: 无
    Steps:
      1. rg -c "chip" _context-output/designs/2026-10-02-field-chain-sync-detail-copy-a11y-design.md
      2. rg -c "predicate" <同文件>
      3. rg -c "vocabulary" <同文件>
    Expected Result: 三个计数均 ≥1（五个术语中至少这三条是本次新增的独有词）
    Failure Indicators: 任一为 0 ⇒ 术语表未同步
    Evidence: _context-output/evidence/task-2-terminology-sync.txt

  Scenario: 只补术语、未改决策（failure — 范围守卫）
    Tool: Bash (git diff)
    Preconditions: T2 提交前
    Steps:
      1. git --no-pager diff --stat _context-output/designs/
      2. 断言改动仅落在 2026-10-02-...-detail-copy-a11y-design.md（§0.2）
      3. 断言 2026-10-10-rule-tags-*.md 未被改动（结论保持）
    Expected Result: 设计结论零改动
    Failure Indicators: 四份 rule-tags 分册出现 diff
    Evidence: _context-output/evidence/task-2-no-decision-drift.txt
  ```

  **Evidence to Capture**: `task-2-terminology-sync.txt`、`task-2-no-decision-drift.txt`

  **Commit**: YES（groups with T2）
  - Message: `docs(design): sync tag/expression/predicate/chip/vocabulary terminology`
  - Files: `_context-output/designs/2026-10-02-field-chain-sync-detail-copy-a11y-design.md, src/ui/settings/App.tsx`
  - Pre-commit: `npm run typecheck`

- [x] **T3. 标签测试夹具 + fixture 迁移面盘点（测试基建）**

  **What to do**:
  - 新建 `tests/helpers/tag-fixtures.ts`：导出 `makeTagDefinition(over?)`、`makeTaggedRule(over?)`、`makeSyncStateWithTags(...)`，**默认值集中在**一处，供 T4–T20 复用（同 `import-export-service.test.ts` 的 `pkgFile`/`portableSlot` 夹具风格）。
  - 产出**机器可读的迁移清单** `_context-output/evidence/task-3-fixture-inventory.txt`：`rg -l "PageRule|SyncState" tests/ --glob "*.{ts,tsx}"` 的**完整文件列表** + 每个文件的 `PageRule`/`SyncState` 构造点行号（R20 的 63 文件面必须**被列举**，而非估计）。
  - 盘点结果**写入 T19 的 References**（本任务只产出清单，不改任何既有 fixture）。
  - **RED 测试**（先写）：`tests/unit/helpers/tag-fixtures.test.ts`
    - `makeTagDefinition()` 返回的形状**恰**含 4 个键（`id`/`name`/`backgroundColor`/`textColor`），**不含**多余键（防止夹具与契约漂移）。
    - `makeTaggedRule()` 的 `tagIds` 默认为 `[]`（**空数组而非 `undefined`**——P1 必填）。
  - **不得**在此任务修改任何既有测试文件。

  **Must NOT do**:
  - 不得迁移既有 fixture（那是 T19 的唯一职责，P1/P7）。
  - 不得把夹具默认值散落到各测试文件内联（会造成 63 处手抄漂移）。

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: 测试基建 + 一次搜索盘点
  - **Skills**: [`sw-tdd-agent`] — 夹具与断言风格对齐
  - **Skills Evaluated but Omitted**: `sw-codebase-explorer`（盘点由 `rg` 一次完成，无需意图分析）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 1（with T1, T2）
  - **Blocks**: T19（迁移清单） | **Blocked By**: None

  **References**:
  - `tests/integration/import-export-service.test.ts:46-86` — 既有夹具范式（`pkgFile`/`portableSlot`/`storedSlot` 集中默认）
  - `tests/ui-smoke/import-flow.test.tsx:41-100` — 真实 fixture 构造（`curRule`/`curSlot`），T19 的迁移对象样例
  - `src/shared/types.ts:113-124` — `PageRule`（`tagIds` 必填落点）
  - **WHY Each Reference Matters**: R20 实测 63 文件触碰 `SyncState`/`PageRule`；**先把面枚举出来**（而非「大概有几十个」）是 T19 能一次性迁移的前提，也是 P7「预期错误集合」可验证的前提。

  **Acceptance Criteria**:
  - [ ] RED：`tests/unit/helpers/tag-fixtures.test.ts` 初始失败
  - [ ] GREEN：`npx vitest run tests/unit/helpers/tag-fixtures.test.ts --project unit` → ALL PASS
  - [ ] `_context-output/evidence/task-3-fixture-inventory.txt` 非空，且**每个文件带行号**
  - [ ] 清单中文件数 ≥1 且**可被 T19 逐条勾销**（格式：`path:line`）

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 夹具形状与契约同源（happy）
    Tool: Bash (vitest)
    Preconditions: T3 夹具已导出
    Steps:
      1. npx vitest run tests/unit/helpers/tag-fixtures.test.ts --project unit
      2. 断言 Object.keys(makeTagDefinition()).sort() === ['backgroundColor','id','name','textColor']
      3. 断言 makeTaggedRule().tagIds 为 [] 而非 undefined
    Expected Result: 夹具与 T1 契约逐字对齐
    Failure Indicators: 夹具多出 id 以外的字段 / tagIds 为 undefined
    Evidence: _context-output/evidence/task-3-fixture-shape.txt

  Scenario: 盘点覆盖真实迁移面（failure — 清单非空非估）
    Tool: Bash (rg)
    Preconditions: 无
    Steps:
      1. rg -l "PageRule" tests/ --glob "*.{ts,tsx}" | wc -l
      2. 断言该数与清单行数一致（清单不得少列文件）
      3. 断言清单包含 tests/integration/field-chain-parity.test.ts（R20 已知触碰点）
    Expected Result: 清单完整
    Failure Indicators: 清单漏文件 ⇒ T19 会留下编译错误
    Evidence: _context-output/evidence/task-3-inventory-completeness.txt
  ```

  **Evidence to Capture**: `task-3-fixture-shape.txt`、`task-3-inventory-completeness.txt`、`task-3-fixture-inventory.txt`

  **Commit**: YES（groups with T3）
  - Message: `test(helpers): add tag fixtures and inventory the PageRule/SyncState migration surface`
  - Files: `tests/helpers/tag-fixtures.ts, tests/unit/helpers/tag-fixtures.test.ts, _context-output/evidence/task-3-fixture-inventory.txt`
  - Pre-commit: `npm run test:unit -- tests/unit/helpers/tag-fixtures.test.ts`

- [x] **T4. `src/shared/tags.ts` 领域纯函数（规范化 / 上限 / 自洽差集 / 名字↔id）**

  **What to do**:
  - 新建 `src/shared/tags.ts`（**纯模块，零 React / chrome 依赖** ⇒ 自动受 `layer-boundary.test.ts` 约束，R18/A-b）：
    - `normalizeTagName(raw: string): string` — **仅 trim 首尾空格**，区分大小写（C2）。不做小写化、不做内部空白折叠。
    - `findDuplicateTagId(tags: TagDefinition[], name: string, excludeId?: string): string | null` — 唯一性判定 = **trim 后逐字节相等**（C2/I4）。`RENAME_TAG` 需 `excludeId`（改名时排除自身）。
    - `isTagNameValid(name: string): boolean` / `TAG_NAME_MAX = 32`（C3）。
    - `isRuleTagIdsValid(tagIds: string[]): boolean` / `RULE_TAG_MAX = 8`（C3）——判定**去重后**长度 ≤8。
    - `stripDanglingTagIds(tagIds: string[], tags: TagDefinition[]): string[]` — D3 的**纯函数核心**（保留原有顺序，仅移除活表不存在的 id）。
    - `resolveRuleTagNames(tagIds: string[], tags: TagDefinition[]): string[]` — 写路径用：`tagIds → 活表名字`（保持 `tagIds` 顺序）。
    - `resolveTagIdsByName(names: string[], tags: TagDefinition[]): string[]` — **A-e**：按 C2 逐字节相等匹配；**命中 ⇒ 复用本机 id**；未命中 ⇒ **不在此处创建**（返回 `{ resolved: string[]; missing: string[] }`，由 T9/T10 决定创建）。
    - `collectRuleTagNames(rules: PageRule[], tags: TagDefinition[]): string[]` — 导出侧差集的输入（S3）。
    - `selfConsistencyDiff(rules: PortableRule[], vocabulary: PortableTag[]): string[]` — **A3/A5/A-f 的唯一定义**：`union(规则内联名) \ 词汇表名`（去重、稳定排序）。**导出弹窗文案与「补足/丢弃」两个选项必须共用这一个函数的返回值**（D-e 的「同源不漂移」）。
    - `findOrphanTagIds(tags: TagDefinition[], rules: PageRule[]): string[]` — C3/A6：反向遍历得出**孤立标签**（Tags 页展示用）。
    - `countTagReferences(tagId: string, rules: PageRule[]): number` — C4 删除确认的影响数（「将被 N 条规则摘除」）。
  - **RED 测试**（先写）：`tests/unit/shared/tags.test.ts`（**穷举 + 判别性 case table**）
    - **C2 边界**：`'work'` vs `' work '` ⇒ `findDuplicateTagId` **命中**（必须拒绝）；`'Work'` vs `'work'` ⇒ **不命中**（区分大小写）；
    - **C3 边界**：名字 32 字符通过 / 33 字符拒绝；`tagIds` 长度 8 通过 / 9 拒绝；`['a','a','b']`（去重后 2）**通过**；
    - **D3 不变式**：`stripDanglingTagIds(['t1','gone','t2'], 活表含 t1/t2)` → `['t1','t2']`（**顺序保持**，且**空表输入返回空数组**）；
    - **A-f 同源性**：`selfConsistencyDiff` 的返回**恰是**弹窗要报的名字集合（用同一函数断言，不重复推导）；
    - **判别性 case table**（先例 `layer-boundary.test.ts:86-133`）：把「必须命中 / 必须不命中」并列，证明**判定器能判别**而非恰好通过。
  - **KEEP IT PURE**：本任务不读写存储、不发消息、不认识 React。

  **Must NOT do**:
  - 不得在此模块内创建/持久化标签（创建是 T9 `TagService` 的职责，A1/A-h）。
  - 不得引入大小写归一或大小写不敏感去重（C2-B/C/D 均已否决）。
  - 不得把颜色纳入身份判定（S1/I4）。
  - 不得为「总数」设上限（C3 明确不限）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 纯函数穷举 + 边界判定 + 与下游弹窗的同源性契约
  - **Skills**: [`sw-tdd-agent`] — 纯函数穷举与 case table 断言风格
  - **Skills Evaluated but Omitted**: `sw-service-designer`（无服务契约）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 2（with T5–T8）
  - **Blocks**: T9, T10, T11 | **Blocked By**: T1

  **References**:
  - **Pattern References**:
    - `src/shared/icon-ref.ts` — `src/shared` 内既有纯模块的**形状**（无宿主依赖、常量单一owner），`tags.ts` 须同构
    - `src/shared/form-validation.ts` — 既有「判定函数返回结构化结果」先例（`ValidationResult`），`resolveTagIdsByName` 的 `{resolved, missing}` 沿用该风格
  - **API/Type References**:
    - `src/shared/types.ts:TagDefinition`（T1 新增）— 本模块的操作对象
    - `src/shared/export-package.ts:PortableTag`（T1 新增）— `selfConsistencyDiff` 的词汇表类型
    - 设计 §3 不变量表 — I2（id 引用永不悬空）/ I4（名字唯一性 = trim 逐字节；颜色不参与）/ I3（导出恒自洽）
    - `2026-10-10-rule-tags-constraint-boundaries-design.md` §C2/C3 + §2（D1–D4）— 上限与规范化的权威定义
    - `2026-10-10-rule-tags-architecture-module-design.md` §A-f — 差集「同源」要求
  - **Test References**:
    - `tests/unit/shared/layer-boundary.test.ts:86-133` — **判别性 case table** 的完整范式（MUST_FLAG / MUST_NOT_FLAG 并列）
    - `tests/unit/shared/url-utils.test.ts` — 共享层纯函数的既有穷举风格
  - **WHY Each Reference Matters**: 本模块是「自洽判定」「悬空剥离」「名字身份」的**唯一实现点**。若 `selfConsistencyDiff` 被导出 UI 与导入 UI 各自实现一次，D-e 的「文案与判定同源不漂移」立刻失效；若 `stripDanglingTagIds` 不保持顺序，`tagIds` 会在每次写入时无意义抖动（一个可观察的伪变化）。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`tests/unit/shared/tags.test.ts` 初始失败
  - [ ] GREEN：`npx vitest run tests/unit/shared/tags.test.ts --project unit` → ALL PASS（≥9 断言组，含 1 组判别性 case table）
  - [ ] `npx vitest run tests/unit/shared/layer-boundary.test.ts --project unit` → ALL PASS（`tags.ts` **未**引入出界依赖，R18/A-b）
  - [ ] 所有断言针对**不变式**（顺序保持 / 差集为空 / 逐字节相等），无裸计数替代结构性断言

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 唯一性判定是 trim 逐字节相等（happy + 边界）
    Tool: Bash (vitest)
    Preconditions: tags.ts 已实现
    Steps:
      1. findDuplicateTagId([{id:'t1',name:'work',...}], ' work ') → 断言 === 't1'（trim 后相等 ⇒ 重复）
      2. findDuplicateTagId([{id:'t1',name:'Work',...}], 'work') → 断言 === null（大小写不同 ⇒ 不同标签）
      3. findDuplicateTagId([{id:'t1',name:'work',...}], 'work', 't1') → 断言 === null（改名时排除自身）
    Expected Result: 与 C2/I4 逐字一致
    Failure Indicators: ' work ' 被判为新标签 / 'Work' 被判与 'work' 重复 / 改名被自身阻断
    Evidence: _context-output/evidence/task-4-identity.txt

  Scenario: 悬空剥离保持顺序且空表安全（failure — 边界）
    Tool: Bash (vitest)
    Preconditions: tags.ts 已实现
    Steps:
      1. stripDanglingTagIds(['t2','gone','t1'], 活表含 t1,t2) → 断言 deepEqual ['t2','t1']（**顺序**与输入一致）
      2. stripDanglingTagIds(['gone'], 空表) → 断言 deepEqual []
      3. stripDanglingTagIds([], 活表) → 断言 deepEqual []
    Expected Result: 顺序稳定、幂等、空安全（I2 的纯函数核心）
    Failure Indicators: 顺序被打乱 / 空输入抛错 / 非幂等
    Evidence: _context-output/evidence/task-4-strip-dangling.txt

  Scenario: 自洽差集是被共用的唯一定义（failure — 同源守卫）
    Tool: Bash (rg + vitest)
    Preconditions: T4 完成，导出 UI 尚未实现
    Steps:
      1. 断言 selfConsistencyDiff 在 src/ 内**只有一处定义**：rg -c "function selfConsistencyDiff" src/shared/tags.ts → 1
      2. rg "selfConsistencyDiff" src/ → 命中仅 tags.ts（消费者在 T10/T11/T17）
      3. 断言差集结果去重且稳定排序（两组同义输入产生同一数组）
    Expected Result: 唯一实现点，无第二处推导
    Failure Indicators: 出现第二处差集推导（将导致 D-e 文案漂移）
    Evidence: _context-output/evidence/task-4-selfconsistency-source.txt
  ```

  **Evidence to Capture**: `task-4-identity.txt`、`task-4-strip-dangling.txt`、`task-4-selfconsistency-source.txt`

  **Commit**: YES（groups with T4）
  - Message: `feat(shared): add tag domain functions (identity, limits, dangling strip, self-consistency diff)`
  - Files: `src/shared/tags.ts, tests/unit/shared/tags.test.ts`
  - Pre-commit: `npm run test:unit -- tests/unit/shared/tags.test.ts`

- [x] **T5. `src/shared/tag-expression.ts` 表达式引擎（AST + 迭代解析 + 迭代求值 + 实体解析）**

  **What to do**:
  - 新建 `src/shared/tag-expression.ts`（**纯模块**，A2/A-b；AST 类型是共享契约）：
    - **AST 类型**（导出的共享契约）：
      - `Node = { kind:'tag'; tagId: string; nameAtInsert: string } | { kind:'not'; child: Node } | { kind:'and'|'or'; left: Node; right: Node }`
      - `ChipToken = { kind:'tag'; tagId: string; nameAtInsert: string; backgroundColorAtInsert: string } | { kind:'op'; op:'AND'|'OR'|'NOT' } | { kind:'paren'; p:'('|')' }` —— **`nameAtInsert`/`backgroundColorAtInsert` 即 D2 的「插入时名字」后备**（P6：UI 态，不落盘）。
    - `parse(chips: ChipToken[]): { ok: true; ast: Node } | { ok: false; reason: 'EMPTY'|'INCOMPLETE'|'UNBALANCED'|'ARITY' }` —— **迭代实现**（显式栈 + 运算符优先级 + 括号配对 + 元数校验，**不得用朴素递归下降**，C8/D1）。优先级：`NOT` > `AND` > `OR`。
    - `evaluate(ast: Node, ruleTagIds: ReadonlySet<string>): boolean` —— **迭代实现**（显式栈求值，D1）。谓词语义：规则**含**该 tagId ⇒ true。
    - `evaluateExpression(chips: ChipToken[], ruleTagIds: Set<string>, tags: TagDefinition[]): { applied: boolean; matched: boolean; missingTagIds: string[] }` —— **C6 + C7 的落点**：
      - `parse` 失败 ⇒ `{ applied: false }`（**一律不筛选**，C6）；
      - `parse` 成功但引用了**活表不存在**的 tagId ⇒ `{ applied: false, missingTagIds }`（**整个表达式暂停生效 + 点名**，C7）；
      - 其余 ⇒ `{ applied: true, matched }`。
    - `resolveChipDisplayName(chip, tags): string` —— 显示优先级：**活表名字**（重命名自动跟随）→ **`nameAtInsert`**（已删时）（D2）。**无墓碑记录**。
    - `canFollowWith(chips: ChipToken[], next): boolean`（可选但推荐，G5 的「候选有限 ⇒ 合法性可达」）—— 只暴露**能保持表达式合法**的候选，使「构建出语法错误」在 UI 上近乎不可达。**若实现，须有独立测试；若不实现，`parse` 的失败态即唯一防线（C6 已覆盖）。**
  - **RED 测试**（先写）：`tests/unit/shared/tag-expression.test.ts`
    - **优先级穷举**：`a OR b AND c` ≡ `a OR (b AND c)`；`NOT a AND b` ≡ `(NOT a) AND b`；
    - **括号**：`(a OR b) AND c` 与不加括号的结果**不同**（证明括号生效）；
    - **元数**：`AND a`（缺左）、`a AND`（缺右）、`NOT`（缺子）、`()` ⇒ 全部 `ok:false`；
    - **C6**：`[]`（空）/ `[a, AND]`（半成品）/ `[(, a]`（括号未闭合）⇒ `applied === false`；**且断言「显示全部」= 消费者视角下 filter 恒真**；
    - **C7**：chip 引用已删 tagId ⇒ `applied === false` 且 `missingTagIds` **点名**该 id；chip 显示名回落到 `nameAtInsert`；
    - **D1 深嵌套不崩**（**硬验收**）：构造 **5000 层** 嵌套（`NOT^(5000)` 或 `((((…))))`）⇒ `parse` + `evaluate` **不抛 `RangeError: Maximum call stack size exceeded`**，并在合理时间内返回；
    - **重命名跟随**：表达式引用 tagId，活表名字变更 ⇒ `resolveChipDisplayName` 返回**新名字**（C1 的收益：id 不变 ⇒ 引用不断）。
  - **不得**引入 `new Function` / `eval`（G5-C 明确否决：校验缺口即任意代码执行）。
  - **不得**支持自由文本（G5）：输入只有 `ChipToken[]`。

  **Must NOT do**:
  - 不得用递归下降（D1 的「不得使用朴素递归下降」是**明文**约束）。
  - 不得设置任何表达式长度/深度上限（C8-A）。
  - 不得在 parse 失败时「应用已完整部分」（C6-B 是最糟选项）。
  - 不得自动摘除已删 tagId 的 chip 或自动规范化（C7-A 已否决）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 迭代解析器 + 显式栈求值 + 深度安全 + 优先级正确性，是本迭代的语义中枢
  - **Skills**: [`sw-tdd-agent`, `sw-systematic-debugging`] — 穷举测试 + 深嵌套失败时的根因定位
  - **Skills Evaluated but Omitted**: `sw-service-designer`（无服务契约，纯模块）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 2（with T4, T6–T8）
  - **Blocks**: T12（chip 组件消费 AST）, T15（RulesSection 求值） | **Blocked By**: T1

  **References**:
  - **Pattern References**:
    - `src/shared/field-chain.ts` — 共享层「纯函数 + 明确不变量注释」的既有风格（**注意**：本模块**不得**与 field-chain 有任何数据交换，I1）
    - `src/shared/form-validation.ts` — 「判定函数返回 discriminated result」先例（`parse` 的 `{ok:false, reason}` 沿用）
  - **API/Type References**:
    - `src/shared/types.ts:TagDefinition`（T1 新增）— 实体解析的输入
    - 设计 §2.2 数据流「筛选（读）」— `chip 序列 → parse → AST（仅解析成功才作用于列表, C6）→ 标签表名字↔id 解析 → evaluate → 规则子集`
    - `2026-10-10-rule-tags-constraint-boundaries-design.md` §C6/C7/C8 + §2（D1/D2）— 失败态与深度约束的权威定义
    - `2026-10-10-rule-tags-architecture-module-design.md` §A2 — 落点与「含实体解析」的范围界定
    - `2026-10-10-rule-tags-detail-interaction-copy-design.md` §D2（P6 裁决）— 后备名存 UI 态
  - **Test References**:
    - `tests/unit/shared/layer-boundary.test.ts` — 本文件**自动**被该守卫覆盖（`src/shared/**` 不得出界），无需新写边界断言，但**必须**让该测试保持绿
    - `tests/unit/shared/url-utils.test.ts` — 纯函数 case-table 风格
  - **WHY Each Reference Matters**: **D1 是本任务唯一的不可协商项**——「爆栈的后果是设置页白屏，而非一个错误提示」（C8 原文）。5000 层用例必须**真实构造**（不是 mock），否则该约束等于未验。C6/C7 的两个失败态是**不同**的：C6 是「表达式本身不完整」（用户正在编辑），C7 是「表达式完整但引用物已消失」（删除的副作用）——把两者混为一谈会退回 C7-B 的最难排查形态。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`tests/unit/shared/tag-expression.test.ts` 初始失败
  - [ ] GREEN：`npx vitest run tests/unit/shared/tag-expression.test.ts --project unit` → ALL PASS（≥10 断言组）
  - [ ] **D1 硬验收**：5000 层嵌套用例 PASS，且测试输出**无** `Maximum call stack size exceeded`
  - [ ] `npx vitest run tests/unit/shared/layer-boundary.test.ts --project unit` → ALL PASS
  - [ ] `rg "new Function|eval\(" src/shared/tag-expression.ts` → **0 命中**

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 优先级与括号确实改变结果（happy — 语义正确性）
    Tool: Bash (vitest)
    Preconditions: tag-expression.ts 已实现
    Steps:
      1. 构造 chips a OR b AND c，且规则仅含 a、不含 c ⇒ evaluateExpression.matched 断言 true（因 b AND c 为 false，a 为 true）
      2. 构造 chips ( a OR b ) AND c，同一规则 ⇒ 断言 matched false（括号改变了语义）
      3. 构造 chips NOT a，规则含 a ⇒ 断言 matched false
    Expected Result: NOT > AND > OR 且括号生效
    Failure Indicators: 两种 a/b/c 组合结果相同（括号被忽略）⇒ 优先级实现错误
    Evidence: _context-output/evidence/task-5-precedence.txt

  Scenario: 深嵌套不爆栈（failure — D1 硬约束）
    Tool: Bash (vitest)
    Preconditions: tag-expression.ts 已实现
    Steps:
      1. 程序化构造 5000 层：chips = ['NOT']*5000 + [tag]
      2. const r = parse(chips) ⇒ 断言 r.ok === true
      3. const v = evaluate(r.ast, new Set([tagId])) ⇒ 断言不抛异常且返回 boolean
      4. 断言测试进程未出现 RangeError（捕获并断言 null）
    Expected Result: 迭代实现 ⇒ 深度只受内存约束
    Failure Indicators: RangeError: Maximum call stack size exceeded ⇒ 退化为递归实现（违反 D1）
    Evidence: _context-output/evidence/task-5-deep-nesting.txt

  Scenario: C6 与 C7 是两个不同失败态（failure — 不混淆）
    Tool: Bash (vitest)
    Preconditions: tag-expression.ts 已实现
    Steps:
      1. chips = [a, AND]（半成品）⇒ 断言 { applied:false } 且 missingTagIds 为空（C6：不完整，无点名）
      2. chips = [a] 但 a.tagId 不在活表 ⇒ 断言 { applied:false, missingTagIds:['a'] }（C7：点名）
      3. chips = []（空）⇒ 断言 { applied:false }（C6 含空表达式）
    Expected Result: 两个失败态互不冒充；且都退化为「显示全部」
    Failure Indicators: 半成品被点名（应为 C6）/ 已删引用未点名（应为 C7）/ 任一情况错误地筛选出空列表
    Evidence: _context-output/evidence/task-5-failure-modes.txt
  ```

  **Evidence to Capture**: `task-5-precedence.txt`、`task-5-deep-nesting.txt`、`task-5-failure-modes.txt`

  **Commit**: YES（groups with T5）
  - Message: `feat(shared): add tag boolean-expression engine (iterative parse/eval, entity resolution)`
  - Files: `src/shared/tag-expression.ts, tests/unit/shared/tag-expression.test.ts`
  - Pre-commit: `npm run test:unit -- tests/unit/shared/tag-expression.test.ts`

- [x] **T6. `storage-repository` 标签搬运原语（`getTags` + `mutateSyncTags`）**

  **What to do**:
  - `src/background/storage-repository.ts`：
    - `createDefaultSyncState()` 增 `tags: []`；`migrateSyncState()` 增 `tags: state.tags ?? []`，并对 `rules` 逐条补 `tagIds: r.tagIds ?? []`（**P2 裁决**：本机读取**宽容补齐**，沿用既有 NO MIGRATION 立场，R12）。
    - 新增**搬运原语**（**只搬运，不含业务规则**——P4 裁决，遵 A1-C 否决理由）：
      - `async getTags(): Promise<TagDefinition[]>` — 从 `getSyncState()` 读 `tags`（走缓存 + 现有 `resolveIconReferences` 路径）。
      - `async mutateSyncTags(mutator: (draft: SyncState) => void): Promise<void>` — **薄封装**既有私有 `mutateSync`（R3/R4）。**一个 mutator 内完成「标签表改动 + 规则引用清理」即为一笔原子事务**（A-g）。
    - **不改** `SYNC_KEY` / `QUOTA_BYTES_PER_ITEM` 相关任何行（C0 明确拒绝，Guardrail 4）。
  - **RED 测试**（先写）：`tests/integration/storage-repository-tags.test.ts`
    - `createDefaultSyncState().tags` 为 `[]`；`migrateSyncState({...无 tags...}).tags` 为 `[]`；`rules[].tagIds` 被补为 `[]`（P2）；
    - **A-g 原子性（核心）**：一次 `mutateSyncTags` 内「删实体 + 从 3 条规则摘除该 id」⇒ 事后断言：**标签表与 3 条规则的 `tagIds` 同时生效**，且 `configVersion` **恰 +1**（不是一个 mutator 拆成多笔）；
    - `getTags()` 返回的数组**不**因调用方修改而污染内部状态（既有 `getSyncState` 的 `{...}` 复制先例）。
  - **不得**在此文件实现上限校验 / trim 去重 / 级联语义（那些在 T9 的 `TagService`，P4）。

  **Must NOT do**:
  - 不得暴露 `mutateSync` 为 public（保持最小暴露面：只加标签专用薄封装，R4）。
  - 不得把业务规则写进存储层（A1-C 已否决）。
  - 不得拆 sync key / 改容量逻辑（C0）。

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: 两个薄原语 + 默认值补齐，范围清晰
  - **Skills**: [`sw-tdd-agent`] — 集成测试与 mock adapter 用法对齐
  - **Skills Evaluated but Omitted**: `sw-systematic-debugging`（无既有 bug）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 2（with T4, T5, T7, T8）
  - **Blocks**: T9, T20 | **Blocked By**: T1

  **References**:
  - **Pattern References**:
    - `src/background/storage-repository.ts:762-789` — `mutateSync` 的串行队列 + `structuredClone` + 双侧 strip + 内部 `configVersion+1`（**A-g 的原子性来源**，R3）
    - `src/background/storage-repository.ts:709-752` — `addRule`/`updateRuleById`/`removeRuleById` 是 `mutateSync` 的**既有薄封装范式** ⇒ `mutateSyncTags` 照此写（R4）
    - `src/background/storage-repository.ts:79-101` — `createDefaultSyncState` / `createDefaultLocalState`（默认值补齐点）
    - `src/background/storage-repository.ts:244-261` — `migrateSyncState` 的 `??` 宽容补齐 + **NO MIGRATION** 注释（P2 依据，R12）
    - `src/background/storage-repository.ts:293-299` — `getSyncState()` 的 `{...}` 浅拷贝 + `resolveIconReferences`（`getTags` 沿用）
  - **API/Type References**:
    - `src/background/storage-repository.ts:37-45` — `SYNC_KEY`/`LOCAL_KEY`/`SYNC_FALLBACK_KEY`/`PENDING_UNDO_KEY`（**不受本次改动影响**：Guardrail 4 的比对基线）
    - `src/shared/types.ts:SyncState`（T1 新增 `tags`）
  - **Test References**:
    - `tests/integration/storage-repository.test.ts` — 既有 repo 集成测试结构（mock adapter + initialize）
    - `tests/integration/import-icon-slot-clearing.test.ts` — 「一次写入完成多件事」的原子性断言先例
  - **WHY Each Reference Matters**: **A-g 是本迭代唯一的「免费原子性」来源**——级联删除（标签实体 + N 条引用）必须在**同一个 mutator** 内完成，否则设计 C4/C5 的「原子批量快照」与「撤销」都失去基础。R4 表明 `mutateSync` 已是**私有**原语且已有 3 个薄封装先例 ⇒ 本任务只需**复刻该范式**，不引入新机制。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`tests/integration/storage-repository-tags.test.ts` 初始失败
  - [ ] GREEN：`npx vitest run tests/integration/storage-repository-tags.test.ts --project integration` → ALL PASS
  - [ ] **原子性不变式**：一次 `mutateSyncTags` 后 `configVersion` **恰 +1**（断言的是增量，不是「有变化」）
  - [ ] `rg -c "SYNC_KEY" src/background/storage-repository.ts` 与 T6 前**一致**（未拆 key，Guardrail 4）
  - [ ] `npx vitest run tests/integration/storage-repository.test.ts --project integration` → ALL PASS（既有 repo 行为零回归）

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 级联删除是一笔原子事务（happy — A-g）
    Tool: Bash (vitest)
    Preconditions: adapter = createMockAdapter(); repo = new StorageRepository(adapter); await repo.initialize()
    Steps:
      1. 预置 tags=[t1,t2] 与 3 条规则（tagIds 分别含 t1 / [t1,t2] / [t2]）
      2. const before = (await repo.getSyncState()).configVersion
      3. await repo.mutateSyncTags(d => { d.tags = d.tags.filter(t=>t.id!=='t1'); d.rules.forEach(r=>{ r.tagIds = r.tagIds.filter(id=>id!=='t1'); }); })
      4. const after = await repo.getSyncState()
      5. 断言 after.configVersion === before + 1
      6. 断言 after.tags 不含 t1 且 3 条规则的 tagIds 均不含 t1（同一笔内同时生效）
    Expected Result: 单 mutator ⇒ 单事务、单版本递增
    Failure Indicators: configVersion 增加 >1（拆成多笔）/ 实体已删但某条规则仍引用 t1（写成了两笔）
    Evidence: _context-output/evidence/task-6-atomic-cascade.txt

  Scenario: 宽容读取不把缺字段当损坏（failure — P2 边界）
    Tool: Bash (vitest)
    Preconditions: 预置老形状存档（无 tags；rules 无 tagIds）
    Steps:
      1. 通过 adapter 直接写 sync 区 { configVersion:1, matchSettings:..., slots:[], rules:[{id:'r1',urlMatch:{type:'exact',value:'https://x/'},priority:0,createdAt:'...',updatedAt:'...'}] }
      2. await repo.initialize(); const s = await repo.getSyncState()
      3. 断言 s.tags deepEqual []
      4. 断言 s.rules[0].tagIds deepEqual []
    Expected Result: 宽容补齐（沿用 NO MIGRATION 立场），不抛错
    Failure Indicators: 抛错 / 把存档判为损坏（P2 只对导入包施加严格性）
    Evidence: _context-output/evidence/task-6-lenient-read.txt
  ```

  **Evidence to Capture**: `task-6-atomic-cascade.txt`、`task-6-lenient-read.txt`

  **Commit**: YES（groups with T6）
  - Message: `feat(background): add tag storage primitives (getTags, mutateSyncTags) with lenient read`
  - Files: `src/background/storage-repository.ts, tests/integration/storage-repository-tags.test.ts`
  - Pre-commit: `npm run test:integration -- tests/integration/storage-repository-tags.test.ts`

- [x] **T7. `messages.ts` 标签消息族 + `KNOWN_ACTIONS` 同提交**

  **What to do**:
  - `src/shared/messages.ts`：
    - 新增 4 个请求类型（形状由 A1 的消息族定义）：
      - `CreateTagRequest { action:'CREATE_TAG'; payload: { name: string; backgroundColor: string; textColor: string } }`
      - `RenameTagRequest { action:'RENAME_TAG'; payload: { tagId: string; name: string } }`
      - `DeleteTagRequest { action:'DELETE_TAG'; payload: { tagId: string } }`
      - `SetRuleTagsRequest { action:'SET_RULE_TAGS'; payload: { ruleId: string; tagIds: string[] } }`
    - **加入 `UiRequest` 联合**（4 处追加）；
    - 补 `DomainErrorCode`（若需）：`TAG_NAME_DUPLICATE` / `TAG_LIMIT_EXCEEDED` / `TAG_NAME_TOO_LONG` / `TAG_NOT_FOUND` / `RULE_TAG_LIMIT_EXCEEDED`（**错误码须进 `DomainErrorCode` 联合**，否则 `ResponseBase` 会编译报错——这是既有护栏）。
    - **响应类型**：`CreateTagResponse`（含新建的 `TagDefinition`）、`DeleteTagResponse`（含 `affectedRuleCount`——C4 的影响数）、`SetRuleTagsResponse`（含去重/剥离后的最终 `tagIds`）。
  - `src/background/worker-orchestrator.ts`：**同提交**把 4 个动作加入 `KNOWN_ACTIONS`（R6 的 `_Unknown`/`_NotAnAction` 双向守卫会**同时**强制它们进联合与白名单——这正是护栏的意义）。**本任务只加白名单项，不加路由分发**（分发在 T9）。
    - ⚠️ **注意**：只加白名单而不加 case 会让 `routeMessage` 落入 default 分支 ⇒ **T7 与 T9 必须相邻**（同 Wave 内 T9 紧随）；若执行器把 T7 单独交付，须在同一提交内加上「动作已登记但未接线」的显式 fallback 返回 `INTERNAL_ERROR`，**不得**留下静默失败。
  - **RED 测试**（先写）：`tests/unit/shared/tag-messages-contract.test.ts`
    - 4 个动作均为**真实**白名单成员：以 `handleMessage` 私有通道驱动闸门（先例 `messages-import-export-contract.test.ts:31-41`）⇒ `claimed === true`；
    - `AnyRequest['action']` **无遗漏**：`Exclude<AnyRequest['action'], typeof KNOWN_ACTIONS[number]>` 为 `never`（编译期已保证，测试再断言一次运行期可见性）；
    - 反例：`rg "CREATE_TAG" src/shared/messages.ts` 与 `src/background/worker-orchestrator.ts` **两处都有**（防「编译过、运行被拒」）。
  - **不得**在本任务实现 `TagService` 逻辑。

  **Must NOT do**:
  - 不得只改联合类型而漏改 `KNOWN_ACTIONS`（R6：这是「编译过、运行被拒」的典型）。
  - 不得扩展既有 `CREATE_RULE`/`UPDATE_RULE` 的 payload 来承载标签（A1-B 已否决：那会经过 `applyToMatchingTabs`，F2/R5）。
  - 不得新增第 5 个动作（YAGNI：只需 CREATE/RENAME/DELETE/SET_RULE_TAGS）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 协议护栏双向守卫 + 错误码联合的连锁，需谨慎
  - **Skills**: [`sw-tdd-agent`, `sw-service-designer`] — 协议契约 + 白名单守卫测试
  - **Skills Evaluated but Omitted**: `sw-feature-designer`（无跨服务特性）

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 T4/T5/T6）| **Parallel Group**: Wave 2 —— ⚠️ **但不得与 T8 并发**：两者都写 `src/shared/types.ts`（本任务增请求/响应形状，T8 增 diff 形状，区域不同但**文件同一**）⇒ 执行序 `T7 → T8`。另**须与 T9 相邻交付**（见 What to do 的警告）
  - **Blocks**: T9, T13 | **Blocked By**: T1

  **References**:
  - **Pattern References**:
    - `src/shared/messages.ts:94-123` — 既有规则消息的**形状**（`payload` 逐字段列举、`action` 字面量）——标签消息须同构且**独立**（A1）
    - `src/background/worker-orchestrator.ts:53-114` — `KNOWN_ACTIONS` + `_Unknown`/`_NotAnAction` 双向 `Exclude` 守卫（R6）——**新动作必须进这里**
    - `src/background/worker-orchestrator.ts:81-86` — 上一迭代的注释「registered here in the same change as the union（G-D）so a message is not compiled in the union but rejected at runtime」——本次须复刻该做法
  - **API/Type References**:
    - `src/shared/messages.ts:405-456` — `UiRequest` / `ContentRequest` / `AnyRequest` 联合（4 处追加点）
    - `src/shared/messages.ts:35-41` — `ResponseBase`（错误码必须落在 `DomainErrorCode` 联合内，否则编译报错）
    - `src/shared/types.ts:575+` — `DomainErrorCode` 联合（新错误码落点）
    - `src/shared/messages.ts:28-33` — `RequestBase`（`requestId` / `configVersion?`）
    - `2026-10-10-rule-tags-architecture-module-design.md` §A1 — 消息族定义（4 个动作）
  - **Test References**:
    - `tests/unit/shared/messages-import-export-contract.test.ts:31-70` — **以 `handleMessage` 私有通道驱动真实白名单闸门**的范式（不得用 `routeMessage`，它绕过闸门）
    - `tests/unit/shared/messages.test.ts` — 既有消息契约断言风格
  - **WHY Each Reference Matters**: R6 的 `KNOWN_ACTIONS` 是**手写**白名单——它的双向 `Exclude` 守卫之所以有效，是因为声明用 `as const` 保留了字面量元素类型（注释明确警告：宽注解会让守卫**静默失效**）。因此新增动作必须**同时**改联合与白名单，且**不得**把 `as const` 改成 `ReadonlyArray<…>`。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`tests/unit/shared/tag-messages-contract.test.ts` 初始失败
  - [ ] GREEN：`npx vitest run tests/unit/shared/tag-messages-contract.test.ts --project unit` → ALL PASS
  - [ ] **双向护栏未失效**：`rg "as const satisfies readonly AnyRequest\['action'\]\[\]" src/background/worker-orchestrator.ts` → 仍命中（未被改成宽注解）
  - [ ] `npm run typecheck` 的**预期外错误数 = 0**（`_Unknown`/`_NotAnAction` 不报错 ⇒ 联合与白名单严丝合缝）

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 四个标签动作真实通过白名单闸门（happy — G-D 护栏）
    Tool: Bash (vitest)
    Preconditions: worker = new WorkerOrchestrator(createMockAdapter()); await worker.initialize()
    Steps:
      1. 对 CREATE_TAG / RENAME_TAG / DELETE_TAG / SET_RULE_TAGS 逐一调用 gate(action, {})
      2. 断言每个 claimed === true
      3. 断言四个动作字面量同时存在于 src/shared/messages.ts 与 src/background/worker-orchestrator.ts
    Expected Result: 联合与白名单同提交，运行期不被拒
    Failure Indicators: claimed===false（漏加白名单）/ 仅一处存在（半提交）
    Evidence: _context-output/evidence/task-7-whitelist.txt

  Scenario: 既有规则动作未被标签改动波及（failure — 零回归）
    Tool: Bash (vitest)
    Preconditions: 同上
    Steps:
      1. 断言 CREATE_RULE / UPDATE_RULE / DELETE_RULE 的 gate(...).claimed 仍为 true
      2. 断言 ImportApplyRequest.payload 形状未变（无 tags 字段混入）
      3. rg "tagIds|tags" src/shared/messages.ts 的命中仅出现在 4 个新请求内
    Expected Result: 既有协议零污染（标签走独立消息族，A1）
    Failure Indicators: 规则消息被扩展出标签字段（将经过投递路径，违反 I1）
    Evidence: _context-output/evidence/task-7-no-protocol-pollution.txt
  ```

  **Evidence to Capture**: `task-7-whitelist.txt`、`task-7-no-protocol-pollution.txt`

  **Commit**: YES（groups with T7）
  - Message: `feat(shared): add tag message family and register actions in KNOWN_ACTIONS`
  - Files: `src/shared/messages.ts, src/shared/types.ts, src/background/worker-orchestrator.ts, tests/unit/shared/tag-messages-contract.test.ts`
  - Pre-commit: `npm run test:unit -- tests/unit/shared/tag-messages-contract.test.ts`

- [x] **T8. 第 5 维度协议贯通（`import-diff` presence + service `dimensions`）**

  **What to do**:
  - `src/shared/import-diff.ts`：
    - `presence(pkg)` 增 `tags: pkg.tags !== undefined`（R9）。
    - 新增 `tagsPartDiff?`（**可选**）或按现有 `settingsParts`/`shortcutParts` 同构补一个「标签行」表示——**推荐**：在 `ImportDiff` 增 `tagNames?: ImportPartDiff[]`（每标签一行，`group:'tag'`），使「补足/丢弃悬空 tags」的 diff 披露**有行可依**（§7 第 5 项：`overwrite` 的删除**必须经 diff 披露**）。
    - `applyIntent` 的**标签维度处理**（A7/A8）：`tags` 维度在 `overwrite` 下的删除语义**默认**级联；但 `A8` 要求**可由用户改判为 `incremental`** ⇒ 在 `ImportIntent` 增 `tagOverwriteResolution?: 'cascade' | 'to-incremental'`（若 T1 未含此字段，**本任务补上**）——二者等价于改写 `dimensionModes.tags`（A8 原文「等价于改写 `ImportIntent.dimensionModes.tags`」）。
  - `src/background/import-export-service.ts`：
    - `applyImport` 的 `dimensions` 对象增 `tags`（R10）：`changed` = 本次实际写入的标签实体数（新建 + 命中的复用），`failed` = 因上限/重复被拒的个数（G-H 裁决）；
    - `inspect` 的返回（`ImportInspection.diff`）自动携带新 `presence.tags`（因 `diff.dimensions` 即 `presence`）。
    - **§7 第 5 项硬约束**：`overwrite` 造成标签删除时，`domainViolations` 之外**必须**产出可渲染的披露（用 T8 新增的 `tagNames` 行），**不得**绕过 C4 的告知保护。
  - **RED 测试**（先写）：`tests/integration/import-fifth-dimension.test.ts`
    - 包含 `tags` ⇒ `inspect().dimensions.tags === true`；不含 ⇒ `false`（A2 三态：未携带 ≠ 携带但空）；
    - **A8 两个分支**：`tags: 'overwrite'` + `tagOverwriteResolution:'cascade'` ⇒ 目标机多余的标签被删除且引用被摘除；`: 'to-incremental'` ⇒ **不删除**任何标签、仅按名字合并（**断言目标机标签表在两种模式下差异恰为「是否删除」**）；
    - **披露不变式**：`cascade` 模式下 diff 必含「将被删除的标签」行（§7 第 5 项）；
    - `dimensions.tags.changed` 与 diff 行数一致（R10 注释要求的「数字与行不矛盾」）。
  - **不得**改 `ExportScope`/`ExportPackage` 形状（那是 T1/T11）。

  **Must NOT do**:
  - 不得让 `overwrite` 无条件删除（A8-A 已否决：那会让「同步外观」静默摧毁数据结构）。
  - 不得把标签维度的 `changed` 计数写成「文件里标签的个数」（那与「实际写入」不符，G-H）。
  - 不得在没有 diff 披露的情况下删除标签（§7 第 5 项）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 两处裁决点 + 维度计数语义 + 与既有 diff 机制的同构
  - **Skills**: [`sw-tdd-agent`, `sw-service-designer`] — 集成分支测试 + 协议贯通
  - **Skills Evaluated but Omitted**: `sw-feature-designer`

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 T4/T5/T6）| **Parallel Group**: Wave 2 —— ⚠️ **但须在 T7 之后**：两者都写 `src/shared/types.ts`（见 T7 的同一提醒）⇒ 执行序 `T7 → T8`
  - **Blocks**: T10, T11, T14, T17 | **Blocked By**: T1

  **References**:
  - **Pattern References**:
    - `src/shared/import-diff.ts:141-165` — `presence(pkg)` 现实现（4 键 ⇒ 加第 5 键，R9）
    - `src/shared/import-diff.ts:548-633` — `settingsPartDiffs`（**部件型 diff 行的既有范式**，`tagNames` 行须同构）
    - `src/shared/import-diff.ts:680-808` — `applyIntent`（意图应用落点）
    - `src/background/import-export-service.ts:401-409` — `dimensions` 手工构造（R10）
    - `src/background/import-export-service.ts:318-326` — `applyImport` 的重算流程（`computeDiff` + `applyIntent` + `partitionRecords`）
  - **API/Type References**:
    - `src/shared/types.ts:261-282` — `ImportPartDiff`（`group` 联合需扩 `'tag'`）
    - `src/shared/types.ts:284-317` — `ImportRecordOverride` / `ImportIntent`（`tagOverwriteResolution` 落点）
    - `src/shared/types.ts:486-497` — `ImportDimensionOutcome(s)`（`tags` 计数语义，G-H）
    - `2026-10-10-rule-tags-architecture-module-design.md` §A7/A8/A9/A10 — 两处裁决点与默认外观
    - 主设计 §7 第 5 项 — 「`overwrite` 的删除**经 diff 披露**，不得绕过 C4 保护」
  - **Test References**:
    - `tests/integration/import-apply-result.test.ts` — 逐维度结果断言先例
    - `tests/integration/import-apply-version-binding.test.ts` — 意图/版本绑定断言先例
    - `tests/unit/shared/import-diff.test.ts` — diff 形状断言风格
  - **WHY Each Reference Matters**: `ImportPartDiff` 的 `group` 联合与 `settingsParts` 是**部件型** diff 的既有机制（与「记录型」并列）。标签不是记录（无列表 id）⇒ 必须走部件型管线，否则会像 D0 含义里警告的那样出现「5 个维度、4 张卡片」的不一致。**§7 第 5 项是本任务最易被漏的硬约束**——`overwrite` 的删除是**破坏性**的，若 diff 不披露就等于绕过 C4。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`tests/integration/import-fifth-dimension.test.ts` 初始失败
  - [ ] GREEN：`npx vitest run tests/integration/import-fifth-dimension.test.ts --project integration` → ALL PASS
  - [ ] **披露不变式**：`cascade` 模式下的 inspection.diff 含标签删除行；`to-incremental` 下**不含**且目标机标签表不被删
  - [ ] `dimensions.tags.changed` **等于** diff 中非 `kept` 的标签行数（数字与行同源）
  - [ ] `npx vitest run tests/unit/shared/import-diff.test.ts --project integration` → ALL PASS（既有 diff 零回归）

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: overwrite 的两种裁决产生不同后果（happy — A8）
    Tool: Bash (vitest)
    Preconditions: 目标机 tags=[A,B]；文件 root tags=[A]，规则引用 A、B
    Steps:
      1. intent = { ...defaultImportIntent(), dimensionModes:{...default, tags:'overwrite'}, tagOverwriteResolution:'cascade' }
      2. applyImport(file, intent, expectedVersion) ⇒ 断言结果 dimensions.tags.changed 反映删除，且目标机 tags 只剩 A
      3. 重试：tagOverwriteResolution:'to-incremental' ⇒ 断言目标机 tags 仍含 A 与 B（未删除）
      4. 断言两次的差异恰为「是否删除 B」（其余一致）
    Expected Result: 选择权交用户，两种模式后果可区分
    Failure Indicators: overwrite 无条件删除（A8-A）/ 两种模式结果相同（控件是假的）
    Evidence: _context-output/evidence/task-8-overwrite-resolution.txt

  Scenario: 删除必须经 diff 披露（failure — §7 第 5 项）
    Tool: Bash (vitest)
    Preconditions: 同上，cascade 模式
    Steps:
      1. const insp = await service.inspect(file)
      2. 断言 insp.diff 中存在标签维度的「将被删除」行（tagNames 含 B）
      3. 断言 overwrite 下若 diff 不含删除行则测试失败（即：本场景是**反向守卫**——证明披露不可被省略）
    Expected Result: 删除在操作前可见
    Failure Indicators: 删除发生但 diff 无对应行 ⇒ 绕过 C4 保护
    Evidence: _context-output/evidence/task-8-disclosure-required.txt
  ```

  **Evidence to Capture**: `task-8-overwrite-resolution.txt`、`task-8-disclosure-required.txt`

  **Commit**: YES（groups with T8）
  - Message: `feat(import): wire fifth dimension through diff, intent resolution and apply outcomes`
  - Files: `src/shared/import-diff.ts, src/shared/types.ts, src/background/import-export-service.ts, tests/integration/import-fifth-dimension.test.ts`
  - Pre-commit: `npm run test:integration -- tests/integration/import-fifth-dimension.test.ts`

- [x] **T9. `TagService`（上限 / trim 去重 / 级联删除 / 悬空剥离）+ worker 路由接线**

  **What to do**:
  - 新建 `src/background/tag-service.ts`（**A1/B**）：
    - `class TagService { constructor(private repo: StorageRepository) {} }` —— **构造函数不接收 `adapter`、不接收 `FieldDeliveryService`、不接收任何投递者**（A-a / I1 的**结构保证**：它**没有**投递入口可调）。
    - `async createTag(input): Promise<{success:true,tag}|{success:false,errorCode,message}>`：
      - 走**同一个** `repo.mutateSyncTags`（**创建 + 引用写入同源**，A-g）；`normalizeTagName` + `findDuplicateTagId`（C2）+ 名字长度（C3）；**失败在 mutator 外先校验，成功在 mutator 内原子写入**。
    - `async renameTag(tagId, name)`：id 不变 ⇒ **引用不断**（C1 的核心收益）；同 C2 去重（`excludeId=tagId`）。
    - `async deleteTag(tagId)` —— **C4 + C5 + A-g 的核心**：
      - 先算出**影响数**（`countTagReferences`）供 UI 的 `Confirm` 文案（「将被 N 条规则摘除」）；
      - 在**一个** mutator 内：删实体 + 从**所有**规则 `tagIds` 中移除该 id（`stripDanglingTagIds`）；
      - 返回 `{ affectedRuleCount, snapshot }`——`snapshot` 即 P3 的 `tag-delete` 撤销载荷（`tag` + `refs: Array<{ruleId, tagIds}>`），由 UI 交给既有 `UndoBar`（T16）。
    - `async setRuleTags(ruleId, tagIds)` —— **D3/A-h 的落点**：
      - **持久化前**必须 `stripDanglingTagIds(tagIds, await repo.getTags())`（**不可依赖 `RuleService`**——它按 A1 不感知标签表）；
      - 上限校验（≤8，去重后）；
      - **绝不调用 `applyToMatchingTabs`**（R5/F2：这是 G1 最易被破坏处）。
    - `async restoreDeletedTag(snapshot)` —— 供 `UndoBar` 原子重放（P3/C5）：**一个** mutator 内恢复实体 + 全部引用。
  - `src/background/worker-orchestrator.ts`：**接线 4 个 case**（`CREATE_TAG`/`RENAME_TAG`/`DELETE_TAG`/`SET_RULE_TAGS` ⇒ 对应 `TagService` 方法），并把 `TagService` 加入构造函数（`this.tagService = new TagService(this.repo)`）。**不传 delivery**（结构保证）。
  - **RED 测试**（先写）：`tests/integration/tag-service.test.ts`
    - **C2**：同名（trim 后相等）⇒ `TAG_NAME_DUPLICATE`；`Work` vs `work` ⇒ 都成功（区分大小写）；
    - **C3**：名字 33 字符 ⇒ `TAG_NAME_TOO_LONG`；`setRuleTags` 9 个 id ⇒ `RULE_TAG_LIMIT_EXCEEDED`；**总数不限**（创建 200 个标签**不报错**）；
    - **C4 + A-g**：`deleteTag` 后**一次** `configVersion` 递增；标签表与全部规则引用同时一致；
    - **D3**：`setRuleTags(ruleId, ['t1','gone'])` 持久化后 `tagIds` **恰为 `['t1']`**（悬空被剥离，且**不被写入**）；
    - **C1**：`renameTag` 后所有引用规则的 `tagIds` **不变**（id 稳定 ⇒ 引用不断），且名字相关读取返回新名字。
  - **结构不变式测试**（**硬验收**）：`tests/unit/background/tag-service-boundary.test.ts`
    - 以**源码读取**断言 `tag-service.ts` **不含** `applyToMatchingTabs` / `delivery` / `redeliver` / `FieldDeliveryService` / `adapter`（A-a 的机械守卫，先例 `layer-boundary.test.ts` 的 token-owner 断言风格）。

  **Must NOT do**:
  - **不得**给 `TagService` 注入 `BrowserAdapter` 以外的任何「能投递」的依赖；不得在 `TagService` 内 import `rule-service` 或 `field-delivery-service`（A-a/I1）。
  - 不得把级联拆成多笔 `mutateSyncTags`（A-g：拆了就失去原子性，C5 的撤销也没了基础）。
  - 不得让 `SET_RULE_TAGS` 经过 `RuleService.updateRule`（那会触发 `applyToMatchingTabs`，R5/F2）。
  - 不得为标签总数设上限（C3）。
  - 不得在 `TagService` 内实现 trim 之外的名字规范化（C2）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 服务边界 + 原子性 + 悬空剥离 + 5 类业务规则，本迭代的核心服务
  - **Skills**: [`sw-tdd-agent`, `sw-service-designer`] — 集成 TDD + 服务边界设计
  - **Skills Evaluated but Omitted**: `sw-systematic-debugging`（无既有 bug）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 3（with T10–T14）—— 但 **T9 必须先于 T10**（T10 复用其落点）
  - **Blocks**: T10, T15, T16, T20 | **Blocked By**: T4, T6, T7

  **References**:
  - **Pattern References**:
    - `src/background/slot-service.ts:594-664` — 既有「服务 + 快照 + 撤销」的完整范式（`setPendingUndo`/`restoreSlot`），`deleteTag`/`restoreDeletedTag` 的**形状**参照它（P3：**复用**而非新造）
    - `src/background/rule-service.ts:63-160` — 既有服务的「校验→写入→返回 discriminated result」结构（**注意**：`createRule` 尾部的 `applyToMatchingTabs`（`:172`）是 TagService **绝不可复制**的一步，R5）
    - `src/background/storage-repository.ts:1097-1160` — `setPendingUndo`/`getPendingUndo`/`clearPendingUndo`（撤销快照的既有存储通道，P3 供参考）
  - **API/Type References**:
    - `src/background/storage-repository.ts:762-789` — `mutateSyncTags`（T6）—— **唯一**写入通道
    - `src/shared/tags.ts`（T4）— `normalizeTagName` / `findDuplicateTagId` / `stripDanglingTagIds` / `countTagReferences` / `TAG_NAME_MAX` / `RULE_TAG_MAX`
    - `src/shared/messages.ts`（T7）— 4 个请求/响应形状
    - `src/background/worker-orchestrator.ts:127-164` — 构造函数与既有服务装配（`tagService` 装配点）
    - `2026-10-10-rule-tags-architecture-module-design.md` §A1/A-a/A-g/A-h — 边界与原子性
    - `2026-10-10-rule-tags-constraint-boundaries-design.md` §C2/C3/C4/C5 + §2（D3）
  - **Test References**:
    - `tests/integration/import-icon-slot-clearing.test.ts` — 「一次写入完成多件事」+ 补偿断言的先例
    - `tests/unit/shared/layer-boundary.test.ts:139-186` — **token owner** 式源码断言（本任务的边界测试照此写）
    - `tests/integration/storage-repository.test.ts` — repo 集成测试结构
  - **WHY Each Reference Matters**: **A-a 是本迭代第一条核心约束**：设计明写「重投递隔离由**模块边界**保证，而非靠调用者自觉：`TagService` 根本没有投递入口」。因此 `slot-service.ts` 的快照范式可以照搬，但**必须**在构造函数层面断掉投递能力（不注入 adapter 之外的能力）。**A-g** 则要求级联**必须**在单 mutator 内——这是 C5 的原子快照能成立的前提。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`tests/integration/tag-service.test.ts` 初始失败
  - [ ] GREEN：`npx vitest run tests/integration/tag-service.test.ts --project integration` → ALL PASS（≥7 断言组）
  - [ ] GREEN：`npx vitest run tests/unit/background/tag-service-boundary.test.ts --project unit` → ALL PASS（A-a 机械守卫）
  - [ ] **反例搜索**：`rg "applyToMatchingTabs|delivery|redeliver" src/background/tag-service.ts` → **0 命中**
  - [ ] **原子性**：`deleteTag` 后 `configVersion` **恰 +1**
  - [ ] **D3**：`setRuleTags` 后落库的 `tagIds` **不含**任何活表不存在的 id

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 级联删除 + 撤销闭环（happy — C4/C5/A-g）
    Tool: Bash (vitest)
    Preconditions: repo 预置 tags=[t1,t2] + 3 条规则（含 t1 的 2 条）
    Steps:
      1. const n = await svc.countAffected(t1) ⇒ 断言 === 2（Confirm 文案的影响数）
      2. const before = (await repo.getSyncState()).configVersion
      3. const del = await svc.deleteTag('t1') ⇒ 断言 success 且 affectedRuleCount===2
      4. 断言 (await repo.getSyncState()).configVersion === before + 1（**一笔**）
      5. await svc.restoreDeletedTag(del.snapshot) ⇒ 断言 t1 与其 2 处引用**同时**恢复
    Expected Result: 破坏性但可撤销；撤销是原子批量重放
    Failure Indicators: 版本 +2（拆笔）/ 撤销只恢复实体而引用丢失 / 影响数与实际不符
    Evidence: _context-output/evidence/task-9-cascade-undo.txt

  Scenario: 悬空 id 永不被持久化（failure — D3/I2）
    Tool: Bash (vitest)
    Preconditions: tags=[t1]
    Steps:
      1. await svc.setRuleTags('r1', ['t1','ghost-1','ghost-2'])
      2. const s = await repo.getSyncState()
      3. 断言 s.rules.find(r=>r.id==='r1').tagIds deepEqual ['t1']
      4. 断言 'ghost-1' 不出现在 sync JSON 的任何位置（rg 于 JSON.stringify(s)）
    Expected Result: 写入即剥离；悬空不进存档
    Failure Indicators: ghost id 落库 ⇒ 违反 I2（且后续读会渲染未知标签）
    Evidence: _context-output/evidence/task-9-dangling-strip.txt

  Scenario: 标签写入不触碰投递路径（failure — A-a/I1 结构守卫）
    Tool: Bash (rg + vitest)
    Preconditions: tag-service.ts 已实现
    Steps:
      1. rg "applyToMatchingTabs|redeliver|FieldDeliveryService" src/background/tag-service.ts → 断言 0 命中
      2. 在集成测试内注入**记录投递次数的** delivery（若 worker 装配允许），执行 createTag/renameTag/deleteTag/setRuleTags
      3. 断言投递次数 === 0（G1「规则执行行为零变化」的机械证据）
    Expected Result: 标签写入对执行链完全不可见
    Failure Indicators: 任一投递被触发 ⇒ I1 失守
    Evidence: _context-output/evidence/task-9-no-delivery.txt
  ```

  **Evidence to Capture**: `task-9-cascade-undo.txt`、`task-9-dangling-strip.txt`、`task-9-no-delivery.txt`

  **Commit**: YES（groups with T9）
  - Message: `feat(background): add TagService with limits, cascading delete and dangling-id stripping`
  - Files: `src/background/tag-service.ts, src/background/worker-orchestrator.ts, tests/integration/tag-service.test.ts, tests/unit/background/tag-service-boundary.test.ts`
  - Pre-commit: `npm run test:integration -- tests/integration/tag-service.test.ts`

- [x] **T10. `TagService` 的导入两处裁决点（`overwrite` 改判 + 语义不自洽）**

  **What to do**:
  - `src/background/import-export-service.ts`（**扩展 T8 的接线**，不改包形状）：
    - **导入侧 A10/S6（悬空名字）**：对每个 `PortableRule.tags` 的名字：
      - `resolveTagIdsByName`（T4）先按 **C2 逐字节相等**查目标机标签表；
      - **命中 ⇒ 复用本机 id 与本机颜色**（A-e：`命中则复用（用本机颜色）`）；
      - **未命中 ⇒ 以默认外观创建**（`backgroundColor`/`textColor` 取**默认常量**），并**累计上报数量**——`ImportApplyResult` 增 `tagsCreatedWithDefaultAppearance: number`（或等价字段），供 UI「N 个标签以默认外观创建」披露（S6/A10）。
    - **A9（语义不自洽）**：文件内「规则引用的名字 ∉ 根级词汇表」时**不再静默拒绝**（C9 的严格性**限定在 schema/版本**）——产出与导出侧**同一组**选项（补足最小集 / 丢弃悬空 tags），由用户裁决。
    - **A8（`overwrite` 改判）**：`tagOverwriteResolution: 'to-incremental'` 时**等价于改写 `dimensionModes.tags`**（A8 原文）⇒ 重新渲染 diff 与确认框（**不是**第二套逻辑）。
  - **RED 测试**（先写）：`tests/integration/tag-import-decisions.test.ts`
    - **A-e 命中复用**：目标机有 `work`（红色）⇒ 文件引用 `work` ⇒ **不新建**，且**用本机红色**（断言目标机颜色未被文件颜色覆盖）；
    - **A-e 未命中新建**：文件引用 `urgent`、目标机没有 ⇒ **新建**且用默认外观；`tagsCreatedWithDefaultAppearance === 1`（**数量被披露**，S6）；
    - **A9 两条出路**：不自洽时「补足」⇒ 词汇表被并入（规则可引用性保持）；「丢弃」⇒ 只剩「丢弃」的规则**明确**少了标签（不静默）；
    - **A8 改判等价性**：`to-incremental` 的结果 == 把 `dimensionModes.tags` 直接设为 `incremental` 的结果（**同一断言，证明是改判而非第二套逻辑**）；
    - **不对称性登记**（S6 的「有据的不对称」）：导入侧「补足」**不携带颜色来源** ⇒ 断言新建项**只能**是默认外观（**不得**凭空发明颜色）。
  - **不得**改 `import-diff.ts` 的差集定义（那是 T4 的 `selfConsistencyDiff`，A-f 的同源要求）。

  **Must NOT do**:
  - 不得让未命中的悬空名字**阻止导入**（A10-D 已否决：那会把可自动收敛的问题退化成失败的导入）。
  - 不得给「默认外观」加第三态标记（A10-C 已否决：不得有「外观未设置」标记）。
  - 不得让导入侧凭文件颜色创建未命中标签（S6：导入侧无颜色来源——**有据的不对称**）。
  - 不得为 A9 另写一套「补足/丢弃」实现（须与导出侧共用 `selfConsistencyDiff`，A-f）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 三处导入裁决（A8/A9/A10）+ 与导出侧的对称/不对称关系
  - **Skills**: [`sw-tdd-agent`, `sw-service-designer`]
  - **Skills Evaluated but Omitted**: `sw-feature-designer`

  **Parallelization**:
  - **Can Run In Parallel**: NO（**串行于 T9 之后**——复用 T9 的标签创建落点与 diff 披露）| **Parallel Group**: Wave 3
  - **Blocks**: T20 | **Blocked By**: T4, T8, T9

  **References**:
  - **Pattern References**:
    - `src/background/import-export-service.ts:287-330` — `applyImport` 的解析 + 重算 + 分区流程（标签处理的插入点）
    - `src/background/import-export-service.ts:518-530` — `collectTolerant`（「宽容但披露」的既有形态；A9 的披露可参照，但**语义不自洽不用 tolerant**——它需要用户裁决，date 在 T8 的 `tagNames` 行）
    - `src/shared/import-diff.ts:680-808` — `applyIntent`（A8 的改判落点）
  - **API/Type References**:
    - `src/shared/tags.ts`（T4）— `resolveTagIdsByName` / `selfConsistencyDiff`（**唯一**差集定义）
    - `src/shared/types.ts:ImportApplyResult`（T1 扩展的 `tagsCreatedWithDefaultAppearance`）
    - `2026-10-10-rule-tags-architecture-module-design.md` §A4/A5/A9/A10 + §A-e/A-f — 导入侧数据流与不对称性理由
    - 主设计 §2.2「导入（两处裁决点）」+ §6 Trade-offs 的「有据的不对称」行
  - **Test References**:
    - `tests/integration/import-fidelity.test.ts` — 往返保真断言先例
    - `tests/integration/import-apply-result.test.ts` — 结果披露断言先例
  - **WHY Each Reference Matters**: A10 的**决定性理由**是「结构完整优先；外观是可后续修正的次要属性」；而**导入侧无颜色来源**造成了「有据的不对称」——这不是实现疏漏，是登记过的取舍（设计 §6）。若实现者「顺手」让导入侧沿用文件颜色，就等于**发明**了一个设计明确记录为「不存在」的信息源，会让 S6 的披露数字失去意义。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`tests/integration/tag-import-decisions.test.ts` 初始失败
  - [ ] GREEN：`npx vitest run tests/integration/tag-import-decisions.test.ts --project integration` → ALL PASS
  - [ ] **A-e 不变式**：命中 ⇒ 本机 id + 本机颜色（**文件颜色不得覆盖**）；未命中 ⇒ 默认外观 + 计数披露
  - [ ] **A-f 同源**：`rg -c "selfConsistencyDiff" src/` → 定义数仍为 1，消费者 ≥2（导出/导入）
  - [ ] **A8 等价性断言** PASS（改判 == 改写模式）

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 悬空名字的命中/未命中两条路径（happy — A-e/S6）
    Tool: Bash (vitest)
    Preconditions: 目标机 tags=[{name:'work',backgroundColor:'#RED'}]；文件 root tags=[{name:'work',backgroundColor:'#BLUE'},{name:'urgent',...}]，规则引用 work 与 urgent
    Steps:
      1. applyImport(...) ⇒ 断言目标机 work 的 backgroundColor 仍为 '#RED'（**命中复用本机颜色**）
      2. 断言 urgent 被创建且其颜色为**默认外观常量**（非文件颜色）
      3. 断言 result.tagsCreatedWithDefaultAppearance === 1
    Expected Result: 命中复用、未命中默认外观、数量披露
    Failure Indicators: work 被改成 #BLUE / urgent 用了文件颜色 / 计数为 0 或缺失
    Evidence: _context-output/evidence/task-10-import-resolution.txt

  Scenario: overwrite 改判等价于改写模式（failure — A8 不是第二套逻辑）
    Tool: Bash (vitest)
    Preconditions: 同一文件与目标机
    Steps:
      1. const viaResolution = applyImport(file, intentWith(tagOverwriteResolution:'to-incremental'), v)
      2. const viaModes = applyImport(file, intentWith(dimensionModes.tags:'incremental'), v)
      3. 断言两者的最终 SyncState deepEqual（除 configVersion 外）与 dimensions.tags 相同
    Expected Result: 改判 = 改写模式，一条推理链
    Failure Indicators: 两者结果不同 ⇒ 存在第二套逻辑（漂移风险）
    Evidence: _context-output/evidence/task-10-resolution-equivalence.txt
  ```

  **Evidence to Capture**: `task-10-import-resolution.txt`、`task-10-resolution-equivalence.txt`

  **Commit**: YES（groups with T10）
  - Message: `feat(import): resolve tag identities on import (reuse by name, default appearance for misses)`
  - Files: `src/background/import-export-service.ts, src/shared/types.ts, tests/integration/tag-import-decisions.test.ts`
  - Pre-commit: `npm run test:integration -- tests/integration/tag-import-decisions.test.ts`

- [x] **T11. 导出自洽数据源（逐标签勾选 + 差集 + 弹窗数据）**

  **What to do**:
  - `src/shared/export-package.ts`（**接线，不重定义差集**）：
    - `syncStateToPackage` 在 `scope.tags` 时产出 `pkg.tags`（`PortableTag[]`，**携颜色、无 id**，A4/S2），并**应用 `scope.excludedTagNames`**（逐标签勾选 = 只做减法，同 `excludedSlotIds` 先例，R24）；
    - `PortableRule.tags` 由 `resolveRuleTagNames(rule.tagIds, sync.tags)` 产出（内联**名字**，A3）。
  - 新增**导出侧自洽计算入口**（供 UI 单点调用，A-f）：
    - `computeExportSelfConsistency(pkg: ExportPackage): { diff: string[]; canSupplement: PortableTag[]; canDrop: PortableRule[] }` —— **`diff` 必须直接来自 T4 的 `selfConsistencyDiff`**；`canSupplement` = 用**本机实体颜色**补足的候选（D-e 的「补足」：并入根级词汇表，**颜色取自本机实体**）；`canDrop` = 丢弃差集后**新增的**规则（D-e 的「丢弃」：`M 条规则将丢失…`）。
  - **RED 测试**（先写）：`tests/unit/shared/export-self-consistency.test.ts`
    - **S3 不变式**：任意 `scope` ⇒ `union(被导出规则的 tags) ⊆ 根级 tags`（**导出侧消灭不自洽**）；
    - **差集同源**：`computeExportSelfConsistency().diff` **deepEqual** `selfConsistencyDiff(pkg.rules, pkg.tags)`（**同一函数**，防漂移）；
    - **两个选项的操作对象恰是差集**：`canSupplement` 的名字集合 === `canDrop` 触及的名字集合 === `diff`（A5 含义：两者与差集**一一对应**，无第三态）；
    - **补足的颜色来源**：`canSupplement[].backgroundColor` 取自**本机 `SyncState.tags`**（不是凭空默认值——与导入侧的不对称对照）。
  - **不得**在 UI 侧再推导一次差集（T17 必须调用本入口）。

  **Must NOT do**:
  - 不得让「补足」在**导出侧**使用默认外观（S6 只针对**导入侧**未命中；导出侧有本机实体可查，D-e/A5 明确「颜色取自本机实体」）。
  - 不得引入第三个选项或默认高亮（A5/D-e 明确：两选项均等权、无第三态）。
  - 不得在包内放 id（A4：**仍不携带 id**）。
  - 不得把 `excludedTagNames` 做成 ALLOW-list（须与 `excludedSlotIds` 同构 = 只做减法，R24）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 自洽不变式 + 两选项与差集的一一对应 + 与导入侧的不对称边界
  - **Skills**: [`sw-tdd-agent`, `sw-service-designer`]
  - **Skills Evaluated but Omitted**: `sw-feature-designer`

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 3（with T9, T12, T13, T14）
  - **Blocks**: T17, T20 | **Blocked By**: T4, T8

  **References**:
  - **Pattern References**:
    - `src/shared/export-package.ts:314-403` — `syncStateToPackage` 的**逐维度**构造（`scope.slots`/`scope.rules`/`scope.settings`/`scope.shortcuts`）⇒ `scope.tags` 须**同构**追加（R24 的「absent ≠ carried-and-empty」）
    - `src/shared/export-package.ts:326-398` — `excludedSlots`/`excludedRules`/`omitted` 的「只做减法」范式（`excludedTagNames` 照此）
    - `src/shared/export-package.ts:420-540` — `packageToSyncPatch`（导出/导入两侧名字↔id 转换的既有接线点）
  - **API/Type References**:
    - `src/shared/tags.ts`（T4）— `selfConsistencyDiff` / `collectRuleTagNames` / `resolveRuleTagNames`
    - `src/shared/export-package.ts:PortableTag` / `PortableRule.tags`（T1）
    - `2026-10-10-rule-tags-architecture-module-design.md` §A3/A4/A5 + §A-f — 自洽判定与弹窗选项的对应关系
    - `2026-10-10-rule-tags-detail-interaction-copy-design.md` §D-e — 后果式措辞的两个选项各自说出的后果
  - **Test References**:
    - `tests/unit/shared/export-package-map.test.ts` — 往返保真 + 负例断言先例
    - `tests/unit/shared/export-icon-rewrite.test.ts` — 导出侧形状断言风格
  - **WHY Each Reference Matters**: A3 的**路径选择记录**写明：用户方案「在导出侧就消灭了不自洽」从而让落盘文件**永远自洽**、导入侧保持严格姿态——「**问题在用户有上下文的地方（导出）解决，而非在他没有上下文的地方（导入）解决**」。因此导出侧的自洽计算必须是**唯一**的差集消费者（A-f），且「补足」在导出侧**有**颜色可供（本机实体），这正是与导入侧构成「有据的不对称」的地方。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`tests/unit/shared/export-self-consistency.test.ts` 初始失败
  - [ ] GREEN：`npx vitest run tests/unit/shared/export-self-consistency.test.ts --project unit` → ALL PASS
  - [ ] **S3**：所有 scope 组合（含「只导标签不带规则」「排除正在被使用的标签」）的产出包满足 `union(规则名) ⊆ 词汇表`
  - [ ] **A-f 同源**：`.diff` 与 `selfConsistencyDiff` 的返回值 deepEqual
  - [ ] `npx vitest run tests/unit/shared/export-package-map.test.ts --project unit` → ALL PASS（既有往返零回归）

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 排除正在被使用的标签仍产出可用数据（happy — A5/D-e）
    Tool: Bash (vitest)
    Preconditions: 本机 tags=[work(红), urgent(蓝)]；规则 r1.tagIds 含两者
    Steps:
      1. scope = { rules:true, tags:true, excludedTagNames:['urgent'] }
      2. const pkg = syncStateToPackage(sync, scope)
      3. const sc = computeExportSelfConsistency(pkg)
      4. 断言 sc.diff deepEqual ['urgent']（差集恰是被排除且被引用的那个）
      5. 断言 sc.canSupplement[0].backgroundColor === 本机 urgent 的颜色（**取自本机实体**）
      6. 断言 sc.canDrop 的长度对应「将丢失 urgent 的规则数」
    Expected Result: 差集驱动两个等权选项
    Failure Indicators: 差集为空（弹窗成死代码）/ 补足用了默认色 / canDrop 语义与文案数字不符
    Evidence: _context-output/evidence/task-11-selfconsistency.txt

  Scenario: 排除未被引用的标签不产生差集（failure — 弹窗不得误触发）
    Tool: Bash (vitest)
    Preconditions: 本机 tags=[work, unused]，规则只引用 work
    Steps:
      1. scope = { rules:true, tags:true, excludedTagNames:['unused'] }
      2. 断言 computeExportSelfConsistency(pkg).diff deepEqual []
      3. 断言该 scope 下**不应**弹窗（diff 为空是弹窗的唯一触发条件）
    Expected Result: 弹窗只在真实不自洽时出现
    Failure Indicators: diff 非空 ⇒ 弹窗会成为噪音
    Evidence: _context-output/evidence/task-11-no-false-dialog.txt
  ```

  **Evidence to Capture**: `task-11-selfconsistency.txt`、`task-11-no-false-dialog.txt`

  **Commit**: YES（groups with T11）
  - Message: `feat(export): carry tag vocabulary and compute self-consistency diff for the export dialog`
  - Files: `src/shared/export-package.ts, tests/unit/shared/export-self-consistency.test.ts`
  - Pre-commit: `npm run test:unit -- tests/unit/shared/export-self-consistency.test.ts`

- [x] **T12. chip 输入共享组件（`src/ui/shared/tag-chip-input.tsx`）**

  **What to do**:
  - 新建 `src/ui/shared/tag-chip-input.tsx` —— **chip 序列的呈现与点选**（A2：UI 只负责「AST ↔ chip 序列」）：
    - 组件 `TagExpressionInput`：受控 `chips: ChipToken[]` + `onChange`；**框内文本输入只用于筛选候选标签列表**（G5：**不用于书写表达式**）；
    - **候选面板**：点选标签 / `AND` / `OR` / `NOT` / `(` / `)`（G5）；可选接 `canFollowWith`（T5）使「候选有限 ⇒ 合法性可达」（G5 的含义：把语法错误变为**近乎不可达**，非事后报错）；
    - **就地新建**（D-b）：候选列表无匹配时出现一行「创建标签 "xxx"」⇒ 回车 ⇒ 调用 `onCreateTag(name)`（**父组件**发 `CREATE_TAG`，走同一条 `TagService` 写入路径，D-f/A1）→ 成功后就地选中；**立即落盘**（取消表单后标签留下，D-f 已接受）；
    - **每个 chip 可单独删除**（G5），**可聚焦、可键盘删除（Backspace/Delete）、有可访问名称**（R6）；
    - **显示名优先级**：活表名字（重命名自动跟随）→ `nameAtInsert` 后备（T5 的 `resolveChipDisplayName`）（D2）；
    - **框体自动折行增高**（D-d：**不设行数上限、不转内部滚动、不做任何截断**）；
    - 渲染 chip 颜色用 `backgroundColorAtInsert`（S1 的实体色），**渲染能力复用** `IconPreview` 的三件套思路（**不新造颜色模型**）。
  - 新建 `src/ui/styles/settings.css` 的类：`tbs-tag-chip`、`tbs-tag-chip__remove`、`tbs-tag-chip-input`、`tbs-tag-chip-input__field`、`tbs-tag-chip-input__candidates`（**类名一经使用必须有定义**，R17 守卫会拦；`tbs-` 前缀家族）。
  - **RED 测试**（先写）：
    - `tests/unit/ui/tag-chip-input.test.tsx`（jsdom **结构 + 可访问性**断言，**不断言布局几何**）：
      - 每个 chip 有 `role`/`aria-label`（可访问名称含标签名）且**可聚焦**；
      - 键盘 `Backspace`/`Delete` 删除聚焦 chip ⇒ `onChange` 收到移除后的序列；
      - 输入无匹配文本 ⇒ 出现「创建标签 "xxx"」行；回车 ⇒ `onCreateTag('xxx')` 被调用**且**（在父组件桩返回成功后）该 chip 被选中；
      - `nameAtInsert` 后备：删除实体后（活表无该 id）chip 仍显示 `nameAtInsert`，**且保留**（不被自动摘除，C7）；
      - **折行结构**：断言容器为**多行容器**（如 `flex-wrap: wrap` 的类存在，或 CSS 规则含 `flex-wrap`）——**以 `settings-class-css.test.ts` 的「断言结构而非几何」方式**，不测量高度。
  - **不得**在此组件内发消息（`onCreateTag` 回调由父级实现，A1：写入路径唯一）。

  **Must NOT do**:
  - 不得提供自由文本表达式输入（G5 明确「无自由文本表达式」）。
  - 不得设表达式长度/行数上限、不得内部滚动、不得降级为「N 个条件」摘要（C8/D-d 均已否决）。
  - 不得自动摘除已删实体的 chip（C7-A 已否决）。
  - 不得在此组件内自行创建标签对象（D-f：必须走 `TagService`）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 交互构建器 + 键盘可达性 + 就地新建生命周期 + 结构守卫兼容
  - **Skills**: [`sw-tdd-agent`, `sw-ui-ux-review`] — 组件 TDD + 可访问性/交互健壮性
  - **Skills Evaluated but Omitted**: `sw-browser-tester`（jsdom 结构断言即可，无需真实浏览器）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 3（with T9, T10, T11, T13, T14）
  - **Blocks**: T13, T15, T16, T18 | **Blocked By**: T1, T5

  **References**:
  - **Pattern References**:
    - `src/ui/shared/field-editor.tsx:540-560` — 既有「可键盘操作的小控件」范式（即时写入 + 可撤销资格标注）
    - `src/ui/shared/inline-editor-shell.tsx` — 既有内联编辑容器（chip 输入框的**容器**结构参照）
    - `src/ui/shared/record-list.tsx` — 既有列表 + 多选（候选面板的渲染范式）
    - `src/ui/components/IconEditor.tsx:17-22` — `IconConfig` 三件套（chip 颜色渲染的**复用**对象，S1：不新造颜色模型）
  - **API/Type References**:
    - `src/shared/tag-expression.ts`（T5）— `ChipToken` / `Node` / `resolveChipDisplayName` / 可选 `canFollowWith`
    - `src/shared/types.ts:TagDefinition`（T1）
    - `2026-10-10-rule-tags-detail-interaction-copy-design.md` §D-b/D-c/D-d + §D-g R6 — 就地新建、收起、折行、a11y
    - `2026-10-10-rule-tags-goal-scope-design.md` §G5 — 「chip 序列本身就是 token 流」+ 候选有限
    - `src/ui/styles/settings.css` — 现有 `tbs-settings__*` / `tbs-field-*` 类（新类的**命名与位置**参照）
  - **Test References**:
    - `tests/unit/ui/settings-class-css.test.ts:134-137,255-269` — **jsdom 无布局引擎时断言结构**的范式（`importZoneIsDropCue` / `FULL_WIDTH` 属性家族断言）
    - `tests/unit/ui/inline-rule-editor.test.tsx` — 内联编辑器的结构 + 键盘断言风格
  - **WHY Each Reference Matters**: R17 的类守卫会**强制**每个 `tbs-settings__*` / `tbs-field-*` 类有定义——新类若沿用该前缀即自动受守卫（这是收益）；若用新前缀（`tbs-tag-*`），**必须**在 T18 把该前缀纳入守卫的 `CLASS_TOKEN`（否则守卫对 chip 失效）。D-d 的「无截断」使**结构断言**（`flex-wrap` 存在）成为唯一可自动验证的形式——jsdom 无法测量高度，断言几何会是**假绿**。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`tests/unit/ui/tag-chip-input.test.tsx` 初始失败
  - [ ] GREEN：`npx vitest run tests/unit/ui/tag-chip-input.test.tsx --project unit` → ALL PASS
  - [ ] **R6 不变式**：每个 chip 有可访问名称 + 可聚焦 + 键盘可删（三条独立断言）
  - [ ] **D2 不变式**：实体已删 ⇒ chip 显示 `nameAtInsert` 且**仍存在**（未被摘除）
  - [ ] **D-d 结构**：容器含折行声明（属性家族断言，非几何）
  - [ ] `npx vitest run tests/unit/ui/settings-class-css.test.ts --project unit` → ALL PASS（新类均有定义）

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: chip 可键盘删除且有可访问名称（happy — R6）
    Tool: Bash (vitest, jsdom)
    Preconditions: render(<TagExpressionInput chips={[tag(work), op(AND), tag(urgent)]} onChange={spy} onCreateTag={spy}/>)
    Steps:
      1. 断言每个 chip 元素可通过 getByLabelText(/work/) 等定位（可访问名称）
      2. 对它 focus() 后触发 keyboard Backspace
      3. 断言 onChange 收到**移除该 chip 后**的序列（长度 -1 且不含 work）
    Expected Result: 键盘完全可达
    Failure Indicators: chip 不可聚焦 / 无可访问名称 / Backspace 无效果
    Evidence: _context-output/evidence/task-12-chip-a11y.txt

  Scenario: 就地新建 + 已删实体后备名（failure — D-b/D2/C7）
    Tool: Bash (vitest, jsdom)
    Preconditions: 活表 tags=[]；chips 含 {tagId:'gone', nameAtInsert:'deprecated'}
    Steps:
      1. 断言 chip 文本含 'deprecated'（后备名），且 chip **仍在**（C7 不自动摘除）
      2. 在输入框键入 'brand-new' ⇒ 断言出现「创建标签 "brand-new"」行
      3. 触发 Enter ⇒ 断言 onCreateTag 收到 'brand-new'
      4. 父组件桩成功后 ⇒ 断言 chips 追加了 brand-new 的 chip（就地选中）
    Expected Result: 后备名可读；就地新建回车即建即选中
    Failure Indicators: chip 被自动摘除 / 未出现创建行 / Enter 未触发回调
    Evidence: _context-output/evidence/task-12-inline-create.txt
  ```

  **Evidence to Capture**: `task-12-chip-a11y.txt`、`task-12-inline-create.txt`

  **Commit**: YES（groups with T12）
  - Message: `feat(ui): add tag chip expression input (keyboard-deletable, inline create, wrapping)`
  - Files: `src/ui/shared/tag-chip-input.tsx, src/ui/styles/settings.css, tests/unit/ui/tag-chip-input.test.tsx`
  - Pre-commit: `npm run test:unit -- tests/unit/ui/tag-chip-input.test.tsx`

- [x] **T13. 标签表单共享接线（`rule-form-fields` / `rule-form-submit` / `sidebar`）**

  **What to do**:
  - `src/ui/shared/rule-form-fields.tsx`（R23：**一处改动覆盖 sidebar + settings 两入口**，G3 的「新建时 + 单条编辑时」）：
    - `RuleFormFieldsValue` 增 `tagIds?: string[]`（**表单草稿态**，非持久化形状）；
    - 新增只读 props：`availableTags: TagDefinition[]`、`onCreateTag(name): Promise<TagDefinition|null>`（父级发 `CREATE_TAG`）；
    - 在字段集内渲染 `TagSelector`（**复选/多选 + 就地新建**）——**新建与编辑两处入口**（G3-B），编辑时**含清空**；
  - `src/ui/shared/rule-form-submit.ts`：
    - `RuleDraftValue` 增 `tagIds?: string[]`；`normalizeRuleDraft` **透传** `tagIds`（**不做 trim/去重/剥离**——那是 `TagService` 的职责，D3/A-h/P4：UI 侧不得自建标签对象或重做领域规则）；
    - ⚠️ 在 `NormalizedRuleFields` 增 `tagIds?: string[]`，并**明确注释**：标签**不在** `CREATE_RULE`/`UPDATE_RULE` 的 payload 中传递（走 `SET_RULE_TAGS`），此字段仅供调用方在**规则保存成功后**另发 `SET_RULE_TAGS`（**顺序**：先规则、后标签，避免引用不存在的 ruleId）。
  - `src/ui/sidebar/App.tsx`：规则创建/编辑提交后，若 `tagIds` 有值 ⇒ 追加一次 `SET_RULE_TAGS`（payload `{ruleId, tagIds}`）；失败**不**回滚规则（标签是组织维度，不影响行为；失败以 toast 披露）。
  - **RED 测试**（先写）：
    - `tests/unit/ui/rule-form-fields-tags.test.tsx`：断言字段集中**存在**标签选择控件；其可访问名称存在；**新建** 与 **编辑** 两 variant 都可打标；编辑含清空；
    - `tests/ui-smoke/tag-tagging-entry.test.tsx`（jsdom 结构）：以 http 桩驱动 sidebar，「保存规则 + 打标」⇒ 断言发出**两个**消息 `CREATE_RULE` **然后** `SET_RULE_TAGS`（**顺序**断言，A1 的独立性）；
    - 反例：断言**没有**把 `tagIds` 放进 `CREATE_RULE` payload（`rg`/桩断言 payload 键集合）。
  - **不得**在 UI 侧做 trim 去重或剥离悬空（P4/D3）。

  **Must NOT do**:
  - 不得把标签塞进 `CREATE_RULE`/`UPDATE_RULE` 的 payload（A1-B 已否决：那会经过 `applyToMatchingTabs`，R5）。
  - 不得在取消表单时回滚已就地新建的标签（D-f 明确：标签留下，由 Tags 页可见）。
  - 不得在 UI 侧实现标签上限/去重（重复 `TagService` 的规则 ⇒ 两处规则会漂移）。
  - 不得新增第二个规则表单实现（SC8/R23：`RuleFormFields` 是唯一字段集）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 共享组件扩展 + 两入口覆盖 + 消息顺序 + 与 `SET_RULE_TAGS` 的职责切分
  - **Skills**: [`sw-tdd-agent`, `sw-service-designer`]
  - **Skills Evaluated but Omitted**: `sw-browser-tester`（jsdom 结构足够）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 3（with T9–T12, T14）—— 但 **须在 T12 之后**（复用 chip/选择组件）
  - **Blocks**: T15, T18 | **Blocked By**: T1, T7, T12

  **References**:
  - **Pattern References**:
    - `src/ui/shared/rule-form-fields.tsx:101-132` — 现有 props 集合（`availableTags`/`onCreateTag` 的**追加位置**；注意 IMP-7「单一推导点」纪律）
    - `src/ui/shared/rule-form-fields.tsx:226-238` — `showEnabled` 的 `tbs-form-field` 内联块（标签控件的**结构位置**参照）
    - `src/ui/shared/rule-form-submit.ts:114-124` — `normalizeRuleDraft`（`tagIds` 透传点）
    - `src/ui/sidebar/App.tsx:933` — 既有「创建规则后立即 apply」的调用点（标签的**第二次**消息须紧随其后，顺序敏感）
  - **API/Type References**:
    - `src/shared/messages.ts`（T7）— `SetRuleTagsRequest` / `CreateTagRequest`
    - `src/ui/shared/message-client.ts:132-147` — `sendRaw`（页面级消息发送的既有入口）
    - `src/ui/shared/rule-form-fields.tsx:33-41` — `RuleFormFieldsValue`（`tagIds` 落点）
    - `2026-10-10-rule-tags-goal-scope-design.md` §G3 + 范围修订 — 三处入口（新建/编辑/Tags 页）
    - `2026-10-10-rule-tags-detail-interaction-copy-design.md` §D-f — 就地新建生命周期 + 必须走同一写入路径
  - **Test References**:
    - `tests/unit/ui/rule-form-fields.test.tsx` — 既有字段集断言风格（扩展而非新建测试文件更佳）
    - `tests/ui-smoke/import-flow.test.tsx:24-40` — jsdom 结构 + 桩驱动 UI 流程的范式
    - `tests/unit/ui/sidebar.test.tsx` — sidebar 消息桩范式
  - **WHY Each Reference Matters**: R23 表明 `RuleFormFields` 是**唯一**的规则字段集 ⇒ 在此加标签控件可**一处覆盖两入口**（G3 的最低限度 B）。但 `rule-service.ts` 的 `createRule/updateRule` 尾部**必然**调 `applyToMatchingTabs`（R5）⇒ 标签**必须**走独立消息且在规则保存**之后**（否则 `SET_RULE_TAGS` 会指向尚未存在的 ruleId）。UI 侧**不得**重做领域规则（P4），否则 trim 去重会出现两套实现。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`tests/unit/ui/rule-form-fields-tags.test.tsx` 初始失败
  - [ ] GREEN：`npx vitest run tests/unit/ui/rule-form-fields-tags.test.tsx --project unit` → ALL PASS
  - [ ] GREEN：`npx vitest run tests/ui-smoke/tag-tagging-entry.test.tsx --project ui-smoke` → ALL PASS
  - [ ] **顺序不变式**：桩记录的消息序列为 `['CREATE_RULE','SET_RULE_TAGS']`
  - [ ] **协议不变式**：`CREATE_RULE` payload 的键集合**不含** `tagIds`/`tags`
  - [ ] `npx vitest run tests/unit/ui/rule-form-fields.test.tsx --project unit` → ALL PASS（既有字段集零回归）

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 两入口都能打标且消息顺序正确（happy — G3/A1）
    Tool: Bash (vitest, jsdom)
    Preconditions: sidebar 渲染 + 消息桩记录
    Steps:
      1. 打开新建规则表单，填入 url，选中两个标签，保存
      2. 断言桩收到 CREATE_RULE，其 payload **无** tagIds
      3. 断言桩随后收到 SET_RULE_TAGS，payload = { ruleId: <新建的 id>, tagIds: [两个] }
      4. 再打开该规则的行内编辑，取消勾选一个标签后保存 ⇒ 断言第二次 SET_RULE_TAGS 的 tagIds 少一个（**含清空**能力）
    Expected Result: 规则先写、标签后写；编辑可改可清
    Failure Indicators: CREATE_RULE 里带 tagIds / SET_RULE_TAGS 早于 CREATE_RULE / 编辑无法清空
    Evidence: _context-output/evidence/task-13-tagging-entries.txt

  Scenario: 取消表单后已新建标签留下（failure — D-f）
    Tool: Bash (vitest, jsdom)
    Preconditions: 桩 CREATE_TAG 成功返回
    Steps:
      1. 新建规则表单内就地新建 'temp-tag' ⇒ 断言 CREATE_TAG 已发出
      2. 点 Cancel（关闭表单，不保存规则）
      3. 断言 **没有** 发出 DELETE_TAG（标签留下）
      4. 断言标签实体仍可在父级 availableTags 中读到（孤立标签，Tags 页可见）
    Expected Result: 标签立即落盘；取消不回滚标签
    Failure Indicators: 取消触发回滚删除 / 标签被内存态丢弃
    Evidence: _context-output/evidence/task-13-cancel-keeps-tag.txt
  ```

  **Evidence to Capture**: `task-13-tagging-entries.txt`、`task-13-cancel-keeps-tag.txt`

  **Commit**: YES（groups with T13）
  - Message: `feat(ui): add tag selection to the shared rule form and tag writes after rule save`
  - Files: `src/ui/shared/rule-form-fields.tsx, src/ui/shared/rule-form-submit.ts, src/ui/sidebar/App.tsx, tests/unit/ui/rule-form-fields-tags.test.tsx, tests/ui-smoke/tag-tagging-entry.test.tsx`
  - Pre-commit: `npm run test:unit -- tests/unit/ui/rule-form-fields-tags.test.tsx`

- [x] **T14. `App.tsx` 第 5 维度元数据 + D-13 prune 扩展【`src/` 侧 typecheck 0 的收口点】**

  **What to do**:
  - `src/ui/settings/App.tsx`（**Wave 3 唯一触及 App.tsx 的任务**；T15–T17 在其后串行）：
    - `DIMENSION_LABELS`（`:2998-3003`）增 `{ dim: 'tags', label: 'Tags' }`（R8：5 处消费者自动覆盖）；
    - `DIMENSION_META`（`:3011-3016`）增 `tags: { title: 'Tags', blurb: <一句后果式描述> }`（R7：`Record<keyof DimensionPresence,…>` 必填 ⇒ 不加即编译错误）；
    - `dimensionCount`（`:2709-2713`）增 `tags` 分支：**标签维度是部件型**（非记录列表）⇒ 返回 `null`（与 `settings`/`shortcuts` 一致，**不得**打「1」——那是个回答不了任何问题的数字，R10/既有注释）；
    - **`isRecordDimension`（`:4090`）保持不变**（标签**不**是记录维度；T2 已补注释）——**显式断言** `dim === 'tags'` 时走部件型分支（T17 消费）；
    - **D-13 prune 扩展**（R1 红线 / R13）：`filteredRules` 的 `useEffect`（`:1037-1046`）**依赖数组增表达式输入**（`tagExpression` 或等价状态），使「表达式变化 ⇒ 选中项同步收窄」（**既有机制**，只扩展输入）；
    - `ExportScope` 构造点（`:2618-2622`）增 `tags: checked.tags` 与 `excludedTagNames`（**只做减法**，须先有 `checked` 的 tags 键：见下一项）；
    - `checked` 状态（导出面板的维度勾选）增 `tags` 键（**初始 `false`**，与既有维度一致）；
    - `summary`（`:2672-2685`）增 `tags` 计数（从 `parsed.tags?.length`）。
  - **本任务是 P7 的 `src/` 侧收口点**（**已实测** `tsconfig.json`：`include` = `["src","tests","vite.config.ts","vitest.config.ts","scripts"]` ⇒ `typecheck` **覆盖 `tests`**）：完成后 `npm run typecheck 2>&1 | grep "error TS" | grep -c "src/"` 必须为 **0**（即**协议与 UI 侧**全部编译通过）；`tests/**` 的必填字段错误**预期仍存在**，由 **T19** 一次性迁移后达成**全仓 0 error**。**不得**为求 0 而放宽必填字段（P1）。
  - **RED 测试**（先写）：`tests/unit/ui/settings-fifth-dimension.test.tsx`
    - `DIMENSION_LABELS` 含 5 项且 `dim` 集合 === `DimensionPresence` 的键集合（**同构断言**，R5 红线）；
    - `DIMENSION_META` 有 `tags` 且 `dimensionCount('tags') === null`（部件型）；
    - **D-13 不变式**（**针对机制而非变化**）：构造「选中 3 条 → 表达式使其中 1 条不可见」⇒ 断言选中集**收窄到可见集**（**不是**「Effect 被调用过」）；
    - 导出 scope 构造含 `tags` 与 `excludedTagNames`。

  **Must NOT do**:
  - 不得把 `tags` 当成记录维度（`isRecordDimension` 不得捕获它）。
  - 不得让 `dimensionCount('tags')` 返回一个数字（R10 的既有纪律）。
  - 不得改 `DIMENSION_LABELS` 的**顺序语义**（5 处消费者依赖其分组顺序）。
  - 不得在 T14 内实现 Tags 页 / chip UI（那是 T15–T17）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 巨型文件内的多点精确改动 + 必填 Record 收口 + prune 机制扩展
  - **Skills**: [`sw-tdd-agent`] — UI 结构断言 + 不变式断言
  - **Skills Evaluated but Omitted**: `sw-ui-ux-review`（无新交互面，仅元数据）

  **Parallelization**:
  - **Can Run In Parallel**: **NO**（App.tsx 串行段首位）| **Parallel Group**: Wave 3（其余 5 任务可并行）
  - **Blocks**: T15, T16, T17, T18 | **Blocked By**: T1, T8

  **References**:
  - **Pattern References**:
    - `src/ui/settings/App.tsx:2997-3016` — `DIMENSION_LABELS` / `DIMENSION_META`（R7/R8 落点）
    - `src/ui/settings/App.tsx:1024-1046` — `filteredRules` + D-13 prune `useEffect`（R13：**依赖数组**是「选中项不得存活于可见性之外」的输入清单）
    - `src/ui/settings/App.tsx:2709-2713` — `dimensionCount`（部件型返回 `null` 的既有纪律）
    - `src/ui/settings/App.tsx:2618-2622` — `ExportScope` 构造点
    - `src/ui/settings/App.tsx:2672-2685` — `summary`（包摘要计数）
  - **API/Type References**:
    - `src/shared/types.ts:DimensionPresence`（T1 增 `tags` 必填）
    - `src/shared/types.ts:ExportScope`（T1 增 `tags?`/`excludedTagNames?`）
    - `2026-10-10-rule-tags-detail-interaction-copy-design.md` §D0 + §D-g R1/R5 — 第 5 维度对称性与 D-13
    - `2026-10-10-rule-tags-decisions.yaml:471-484` — `D0` 与 `D-g` 的原文
  - **Test References**:
    - `tests/unit/ui/rules-table.test.tsx` — 规则表结构断言先例
    - `tests/unit/ui/dashboard.test.tsx` — `App.tsx` 内组件的渲染 + 状态断言风格
    - `tests/unit/ui/settings-class-css.test.ts` — 结构守卫范式（本任务的 UI 断言须不越界到几何）
  - **WHY Each Reference Matters**: R7 使 `DIMENSION_META` 成为**第三个编译期护栏**——加第 5 维度不加此表即编译失败，这正是设计 D0 所说「**加字段会逐处编译报错，不会漏**」的补偿事实。R13 的 `useEffect` 依赖数组是 D-13 的**唯一**输入清单：表达式若不进依赖，选中项会停留在「看不见但被操作」的状态——这是既有既有实现**已经解决过**的问题（`App.tsx:1037`），本任务只是**扩展输入**，不得重写机制。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`tests/unit/ui/settings-fifth-dimension.test.tsx` 初始失败
  - [ ] GREEN：`npx vitest run tests/unit/ui/settings-fifth-dimension.test.tsx --project unit` → ALL PASS
  - [ ] **P7 `src/` 侧收口**：`npm run typecheck 2>&1 | grep "error TS" | grep -c "src/"` → **0**（`tests/**` 的错误留给 T19；全仓 0 的收口点在 T19）
  - [ ] **R5 同构不变式**：`DIMENSION_LABELS.map(d=>d.dim)` 的集合 === `Object.keys(DIMENSION_META)` === `DimensionPresence` 键集合
  - [ ] **D-13 不变式**：表达式变化后 `selectedIds` ⊆ 可见规则 id 集合
  - [ ] `npx vitest run tests/unit/ui/settings.test.tsx --project unit` → ALL PASS（既有设置页零回归）

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 第五维度与既有四维度同构（happy — R5/D0）
    Tool: Bash (vitest)
    Preconditions: 渲染 settings 的导出面板
    Steps:
      1. 断言导出面板出现 5 张 pick 卡片（data-testid 前缀 export-dim- 含 tags）
      2. 断言 DIMENSION_META.tags.title === 'Tags' 且 blurb 非空
      3. 断言 dimensionCount('tags') === null（部件型，不打数字）
      4. 断言导入面板的模式选择器也有 5 个（4 个一样、1 个特殊 = 失守）
    Expected Result: 5 维度完全同构
    Failure Indicators: 卡片数 4 / tags 显示数字 / tags 无 blurb
    Evidence: _context-output/evidence/task-14-dimension-parity.txt

  Scenario: 表达式收窄可见性后选中项同步收窄（failure — D-13）
    Tool: Bash (vitest)
    Preconditions: 规则 r1,r2,r3；选中全部三条
    Steps:
      1. 输入使 r3 不可见的筛选表达式（或等价状态）
      2. 断言 selectedIds 恰为 {r1,r2}（**收窄**，而非保持 3）
      3. 清空表达式 ⇒ 断言 selectedIds 仍为 {r1,r2}（**不清空、不扩张**：prune 是单向收窄）
    Expected Result: 选中项永不存活于可见性之外（既有机制，扩展输入）
    Failure Indicators: r3 仍在 selectedIds ⇒ 批量操作会作用于看不见的行
    Evidence: _context-output/evidence/task-14-d13-prune.txt
  ```

  **Evidence to Capture**: `task-14-dimension-parity.txt`、`task-14-d13-prune.txt`

  **Commit**: YES（groups with T14）
  - Message: `feat(ui): add tags as the fifth dimension metadata and extend D-13 prune to the expression`
  - Files: `src/ui/settings/App.tsx, tests/unit/ui/settings-fifth-dimension.test.tsx`
  - Pre-commit: `npm run typecheck && npm run test:unit -- tests/unit/ui/settings-fifth-dimension.test.tsx`

- [x] **T15. `RulesSection`：chip 表达式筛选 + Tags 列（默认收起）+ 两种暂停提示**

  **What to do**（⚠️ **`App.tsx` 串行段首位；T16/T17 在其后**）：
  - `RulesSection`（`App.tsx` 内）：
    - 工具栏增 `TagExpressionInput`（T12）：与既有文字搜索框**并存、语义互不干扰**（G6：chip 表达式 = 分类筛选；文字搜索 = 字面查找）；
    - `filteredRules`（`:1024-1032`）的筛选链**追加**一步：`evaluateExpression(chips, ruleTagIds, tags)` ⇒ **仅当 `applied === true` 才作用于列表**（C6 的确定性规则）；
    - **两种暂停提示**（C6/C7，**文案结构不同**）：
      - `applied===false && missingTagIds.length===0`（半成品/空）⇒ 框边**轻提示**（「未筛选」类措辞，**不点名**）；
      - `applied===false && missingTagIds.length>0` ⇒ **点名**提示（形如「表达式中的 tag x 已经被删除，暂未筛选，请手动调整表达式」，用**后备名**渲染，D2/C7）；
    - **Tags 列（默认收起）**（D-c）：新增独立列，**默认不渲染列本身**（不是「渲染但为空」），由工具栏 `⊘` 开关切换（**复用**既有 `tbs-settings__url-toggle` / `is-active` 先例，`App.tsx:2186-2191`）；列内容渲染 chip（用实体 `backgroundColor`）；
    - **colSpan 与列数同步**（`:1268` 的空态 `colSpan=7` ⇒ 随 Tags 列开关动态调整；**易漏点**）；
    - 行内编辑器（`InlineRuleEditor`）**始终显示标签**（D-c 的含义：打标反馈不依赖该列，落在行内编辑器与 Tags 页）。
  - **RED 测试**（先写）：`tests/ui-smoke/rules-tag-filter.test.tsx`（jsdom **结构 + 文案**）
    - 输入半成品表达式 ⇒ 列表**仍显示全部**（C6）+ 出现轻提示（**且提示不点名**）；
    - 表达式引用已删标签 ⇒ 列表**仍显示全部**（C7）+ 出现**点名**提示且含后备名；
    - 合法表达式 ⇒ 列表收窄到匹配集；
    - Tags 列开关 ⇒ **默认不在 DOM 中**，点击后出现（**结构断言**：`queryByTestId('rules-col-tags')` 默认 null）；
    - 既有文字搜索**零回归**（两控件互不干扰）。
  - **不得**重写 D-13 prune（T14 已扩展输入）；**不得**给表达式设上限（C8）。

  **Must NOT do**:
  - 不得在解析失败时「只应用已完整部分」（C6-B 最糟）。
  - 不得自动摘除已删引用的 chip（C7-A）。
  - 不得让 Tags 列**默认渲染**（D-c 明确「列本身默认不渲染」）。
  - 不得把 chip 表达式替换掉既有文字搜索框（G6：两者并存）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 巨型文件 + 筛选链插入 + 两种提示的区分 + 动态列
  - **Skills**: [`sw-tdd-agent`, `sw-ui-ux-review`] — UI 结构断言 + 失败态文案体验
  - **Skills Evaluated but Omitted**: `sw-browser-tester`（jsdom 结构足够）

  **Parallelization**:
  - **Can Run In Parallel**: NO（`App.tsx` 串行：T14 → **T15** → T16 → T17）| **Parallel Group**: Wave 4（串行段首位）
  - **Blocks**: T18 | **Blocked By**: T5, T12, T13, T14

  **References**:
  - **Pattern References**:
    - `src/ui/settings/App.tsx:1024-1046` — `filteredRules` + D-13 prune（筛选链插入点 + R13）
    - `src/ui/settings/App.tsx:1061-1071` — 工具栏（文字搜索 + `+ New Rule`）（chip 输入的**并列位置**）
    - `src/ui/settings/App.tsx:1133-1200` — 表头（☑ / Icon / Title / URL Pattern / Priority / Enabled / Actions）与**可排序列范式**（Tags 列须同构，但**不可排序**——它不是规则属性）
    - `src/ui/settings/App.tsx:2183-2191` — `⊘` URL 显示/隐藏开关（**Tags 列开关的先例**，D-c 明确「复用既有 ⊘ 控件先例，不引入新交互模式」）
    - `src/ui/settings/App.tsx:1266-1276` — 空态 `colSpan={7}`（**列数同步点**）
  - **API/Type References**:
    - `src/shared/tag-expression.ts`（T5）— `evaluateExpression` / `resolveChipDisplayName`
    - `src/ui/shared/tag-chip-input.tsx`（T12）
    - `2026-10-10-rule-tags-detail-interaction-copy-design.md` §D-c + §D-g R1/R6 — 列默认收起 + 红线
    - `2026-10-10-rule-tags-constraint-boundaries-design.md` §C6/C7 — 两种失败态的**不同**语义
    - `src/ui/styles/settings.css` — 既有表/开关类
  - **Test References**:
    - `tests/unit/ui/rules-table.test.tsx` — 规则表结构断言
    - `tests/unit/ui/rules-review2.test.tsx` — 规则表筛选/排序断言
    - `tests/unit/ui/sidebar-source-hover.test.tsx` — jsdom 结构断言（**注意其「不测几何」的纪律**）
  - **WHY Each Reference Matters**: **C6 与 C7 的区别是本任务的核心**：C6 是「表达式不完整」（用户正在编辑，**不点名**），C7 是「表达式完整但引用已消失」（删除副作用，**必须点名**）。两者的**合并**会直接退回 C7-B 的最难排查形态（「语法完全正常却静默变空」）。D-c 的「默认收起」**不是**视觉偏好——它的理由是「8 个标签会挤掉 URL Pattern 列，而那是本表信息密度最高的一列」，因此「默认不渲染列本身」是**结构**要求，可在 jsdom 中断言。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`tests/ui-smoke/rules-tag-filter.test.tsx` 初始失败
  - [ ] GREEN：`npx vitest run tests/ui-smoke/rules-tag-filter.test.tsx --project ui-smoke` → ALL PASS
  - [ ] **C6 不变式**：半成品 ⇒ 可见集 == 全部规则（**且**提示不含任何标签名）
  - [ ] **C7 不变式**：已删引用 ⇒ 可见集 == 全部规则（**且**提示逐字含后备名）
  - [ ] **D-c 不变式**：Tags 列默认不在 DOM；开关后出现
  - [ ] 既有文字搜索断言（`rules-review2.test.tsx`）ALL PASS

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 两种暂停提示不互相冒充（happy — C6 vs C7）
    Tool: Bash (vitest, jsdom)
    Preconditions: rules=[r1(tag a), r2(tag b)]；tags=[a]
    Steps:
      1. 输入 chips=[tag a, op AND]（半成品）⇒ 断言两条规则**都可见**；断言提示文本**不含** 'a'（不点名）
      2. 输入 chips=[tag deleted-1]（deleted-1 不在活表，且其 nameAtInsert='old-tag'）⇒ 断言两条规则**都可见**；断言提示文本**含** 'old-tag'（点名，用后备名）
      3. 输入 chips=[tag a]（完整合法）⇒ 断言仅 r1 可见
    Expected Result: 不完整→不点名；已删→点名；完整→收窄
    Failure Indicators: 半成品被点名 / 已删未点名 / 任一情况筛出空列表
    Evidence: _context-output/evidence/task-15-two-pause-messages.txt

  Scenario: Tags 列默认收起且开关不破坏布局契约（failure — D-c）
    Tool: Bash (vitest, jsdom)
    Preconditions: 渲染 RulesSection
    Steps:
      1. 断言 queryByTestId('rules-col-tags') === null（默认不渲染）
      2. 点击 aria-label='Show tags' 的 ⊘ 开关 ⇒ 断言列出现且表头文案为 'Tags'
      3. 断言空态的 colSpan 与当前列数一致（开关前后各断言一次）
    Expected Result: 默认不渲染；开关有效；colSpan 同步
    Failure Indicators: 默认即渲染 / 开关无效 / colSpan 与实际列数不符（空态横跨错位）
    Evidence: _context-output/evidence/task-15-tags-column.txt
  ```

  **Evidence to Capture**: `task-15-two-pause-messages.txt`、`task-15-tags-column.txt`

  **Commit**: YES（groups with T15）
  - Message: `feat(ui): add tag expression filter and collapsed Tags column to the rules table`
  - Files: `src/ui/settings/App.tsx, src/ui/styles/settings.css, tests/ui-smoke/rules-tag-filter.test.tsx`
  - Pre-commit: `npm run test:ui-smoke -- tests/ui-smoke/rules-tag-filter.test.tsx`

- [x] **T16. `TagsSection`：第 7 个导航页（增删改查 + 孤立标签 + `Confirm`/`UndoBar`）**

  **What to do**（⚠️ **`App.tsx` 串行段次位**）：
  - 三处同改 `App.tsx`（R22）：
    - `SettingsSection` 联合类型（`:53`）增 `'tags'`；
    - `NAV_ITEMS`（`:214-221`）增 `{ id: 'tags', label: 'Tags' }`（位置：与 Rules / Data Dashboard / Import-Export 并列，D-a）；
    - `renderSection` 增 `activeSection === 'tags' && <TagsSection />`。
  - 新建 `TagsSection` 组件（同文件内，与 `RulesSection` 同级）：
    - **列表**：每行 = 标签实体（颜色块 + 名字 + **引用计数**（`countTagReferences`）+ **孤立标签可见**（C3：`findOrphanTagIds` 或计数为 0 即为孤立——**必须能看见**，否则会积累成永久盲区））；
    - **增**：新建（名字 ≤32 + 去重由 `TagService` 判定，UI 只展示错误）；
    - **改**：重命名（id 不变 ⇒ 引用不断，C1）；改色（**不参与身份**，S1/I4）；
    - **删**（C4/C5/D-g R3/R4，**本任务最重**）：
      1. 点删除 ⇒ `Confirm`，文案**报出影响数**：「将被 N 条规则摘除」（C4；数字来自 `countTagReferences`）；
      2. **`Confirm` 关闭 → 提交 → 再弹 `UndoBar`**（**串行**，g2/R3；**不得**并行弹）；
      3. 提交 = 发 `DELETE_TAG` ⇒ `TagService` 一笔原子写入；`UndoBar` 状态由返回的 `snapshot` 构造（P3 的 `tag-delete` 载荷）；
      4. `UndoBar` 的 `onUndo` ⇒ 发恢复（走 `TagService.restoreDeletedTag`）；**5s 过期**（`UNDO_DEFAULT_MS`）；
      5. **不设默认按钮**（R4）：`Confirm` 的 confirm 须为 `danger` variant；**不得**让 `Enter` 触发删除（`Confirm` 自带 120ms 防误触窗口，R15）。
  - **RED 测试**（先写）：`tests/ui-smoke/tags-section.test.tsx`
    - **孤立标签可见**：构造一个被 0 条规则引用的标签 ⇒ 断言它出现在列表中且显示计数 0（C3）；
    - **删除串行不变式**：点删除 ⇒ 断言**先**出现 `Confirm` 且文案含影响数「2」；`Confirm` 确认**之后**才出现 `UndoBar`（**断言顺序**：`Confirm` 存在期间 `UndoBar` 不存在）；
    - **撤销不变式**：点 `Undo` ⇒ 断言发出恢复且标签重新出现在列表（引用同时恢复）；
    - **无默认按钮**：断言 `Confirm` 打开瞬间**激活元素不是**确认按钮（或断言确认按钮为 `danger` 且无 `autofocus` 语义）——以行为和 variant 断言，**不测像素**；
    - **重命名不断引用**：改名后断言引用的规则数**不变**（C1）。
  - **不得**新建第二个 `UndoBar` 实现（复用 `@ui/shared/undo-bar`，R14）。

  **Must NOT do**:
  - 不得并行弹 `Confirm` 与 `UndoBar`（g2 裁决，R3/D-g）。
  - 不得给删除设默认按钮 / 让 `Enter` 直接删（R4/D-e-D）。
  - 不得引入软删除 / 归档 / 墓碑（C4-C/C7-D2 均否决第三态）。
  - 不得把孤立标签藏起来（C3：必须是**必需**能力）。
  - 不得为标签总数设上限（C3）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 第 7 页 + 破坏性操作串行 + 撤销闭环 + 导航三处同改
  - **Skills**: [`sw-tdd-agent`, `sw-ui-ux-review`] — 破坏性操作体验 + 顺序不变式
  - **Skills Evaluated but Omitted**: `sw-browser-tester`（jsdom 结构 + 顺序断言足够）

  **Parallelization**:
  - **Can Run In Parallel**: NO（`App.tsx` 串行：T15 → **T16** → T17）| **Parallel Group**: Wave 4（串行段次位）
  - **Blocks**: T18 | **Blocked By**: T9, T12, T14

  **References**:
  - **Pattern References**:
    - `src/ui/settings/App.tsx:53` / `:214-221` / `renderSection`（三处导航同改点，R22）
    - `src/ui/settings/App.tsx:2395-2410` — 既有 `UndoBar` 使用点（**复用**的接线方式）
    - `src/ui/shared/components.tsx:307-363` — `Confirm` 组件（`variant='danger'` / 120ms 防误触 / DOM 序）
    - `src/ui/shared/undo-bar.tsx:18-99` — `UndoLayerWrite` 联合（P3 的 `tag-delete` 扩展点）+ 5s 时长 + `returnFocusRef`
    - `src/ui/settings/App.tsx:1430-1620` — `DashboardSection` 的破坏性批量清理先例（**C4 原文明确援引**：「与 Data Dashboard 的破坏性批量清理先例一致」）
  - **API/Type References**:
    - `src/shared/messages.ts`（T7）— `DELETE_TAG` / `RENAME_TAG` / `CREATE_TAG` 响应形状
    - `src/shared/tags.ts`（T4）— `countTagReferences` / `findOrphanTagIds`
    - `2026-10-10-rule-tags-detail-interaction-copy-design.md` §D-a + §D-g R3/R4 — 第 7 页与破坏性操作红线
    - `2026-10-10-rule-tags-constraint-boundaries-design.md` §C4/C5 — 级联与撤销
    - `_context-output/designs/2026-10-02-field-chain-sync-detail-copy-a11y-design.md`（g2 串行裁决的出处）
  - **Test References**:
    - `tests/unit/ui/sidebar-slot-menu-delete.test.tsx` — 破坏性删除 + `Confirm` 断言先例
    - `tests/unit/ui/dashboard-undo-recipe.test.tsx` — `UndoBar` 闭环断言先例（**最接近本任务**）
    - `tests/unit/ui/sidebar-delete-focus-survives.test.tsx` — 删除后焦点回归断言
  - **WHY Each Reference Matters**: **C5 原文**明写「沿用既有 `g2` 裁决——`Confirm` 关闭 → 提交 → **再**弹 `UndoBar`，串行不并行」，且「危害严格大于既有的 Clear：Clear 破坏**一个**字段值，删标签破坏**散落在 N 条规则上**的引用，而规则本身仍在、静默地不再被筛选命中」。因此本任务的验收**必须**包含「顺序」与「影响数」两条，否则就是**形式上有撤销、实际没有保护**。`dashboard-undo-recipe.test.tsx` 是仓库内最接近的既有闭环测试，应作为主要范式。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`tests/ui-smoke/tags-section.test.tsx` 初始失败
  - [ ] GREEN：`npx vitest run tests/ui-smoke/tags-section.test.tsx --project ui-smoke` → ALL PASS
  - [ ] **C3 不变式**：引用计数 0 的标签**可见**且显示计数
  - [ ] **C5 顺序不变式**：`Confirm` 存在期间 `UndoBar` **不在** DOM；确认后才出现
  - [ ] **C4 不变式**：`Confirm` 文案含**准确**的影响数（与实际被摘除的规则数一致）
  - [ ] **撤销闭环**：`Undo` 后标签与引用**同时**恢复
  - [ ] 导航三处同改：`rg "'tags'" src/ui/settings/App.tsx` 覆盖 `SettingsSection` / `NAV_ITEMS` / `renderSection`

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 删除是破坏性但可撤销、且串行（happy — C4/C5/R3）
    Tool: Bash (vitest, jsdom)
    Preconditions: tags=[work]；2 条规则引用 work
    Steps:
      1. 点击 work 行的 Delete ⇒ 断言出现 Confirm，且文案含 '2'（将被 2 条规则摘除）
      2. 断言此时 UndoBar **不存在**于 DOM（串行）
      3. 点击 Confirm 的确认（danger）按钮 ⇒ 断言 Confirm 消失、**随后** UndoBar 出现
      4. 点击 UndoBar 的 Undo ⇒ 断言 work 重新出现且 2 条规则的引用恢复
    Expected Result: 告知影响数 → 提交 → 再弹撤销；三态严格串行
    Failure Indicators: 无影响数 / Confirm 与 UndoBar 同时出现 / 撤销只恢复实体
    Evidence: _context-output/evidence/task-16-delete-undo.txt

  Scenario: 孤立标签必须可见（failure — C3 盲区守卫）
    Tool: Bash (vitest, jsdom)
    Preconditions: tags=[orphan]（无规则引用）
    Steps:
      1. 渲染 TagsSection
      2. 断言 'orphan' 行存在且其引用计数显示 0
      3. 断言不存在「过滤掉 0 引用」的默认行为（列表未隐藏它）
    Expected Result: 孤立标签不会被静默积累成盲区
    Failure Indicators: orphan 被隐藏 ⇒ 违反 C3 的必需能力
    Evidence: _context-output/evidence/task-16-orphan-visible.txt
  ```

  **Evidence to Capture**: `task-16-delete-undo.txt`、`task-16-orphan-visible.txt`

  **Commit**: YES（groups with T16）
  - Message: `feat(ui): add Tags management page with orphan visibility, cascading delete and undo`
  - Files: `src/ui/settings/App.tsx, src/ui/styles/settings.css, tests/ui-smoke/tags-section.test.tsx`
  - Pre-commit: `npm run test:ui-smoke -- tests/ui-smoke/tags-section.test.tsx`

- [x] **T17. `ImportExportSection`：第 5 维度卡片 + 两处不自洽弹窗 + 结果披露**

  **What to do**（⚠️ **`App.tsx` 串行段末位**）：
  - **导出侧**（`ExportPicker` 段）：
    - 维度卡片自动出现 `tags`（T14 的 `DIMENSION_LABELS`/`DIMENSION_META` 已覆盖，R8）；`dimensionCount('tags')` 因返回 `null` 而**不打数字**（R10）；
    - **逐标签勾选**（A5/B）：新增 `tags` 的记录级列表（同 `RecordList` 范式，`toggleExcluded('tag', name)`——**按名字**，因包内标签身份是名字，R24/A4）；`ExportScope.excludedTagNames` 由该状态构造；
    - **导出前弹窗**（D-e）：`handleExport` 前调用 T11 的 `computeExportSelfConsistency(pkg)`；**diff 非空 ⇒ 后果式弹窗**：
      - 补足：`补足标签：包内将包含 N 个额外的「x」「y」标签定义`（数字与名字**直接渲染差集**，D-e：与判定同源不漂移）；
      - 丢弃：`丢弃标签：M 条规则将丢失「x」「y」标签`；
      - **两选项等权，无默认高亮**（D-e-D：`Enter` 误触就往别人配置里多塞标签）；
    - **弹窗只在 diff 非空时出现**（T11 的 `no-false-dialog` 不变式）。
  - **导入侧**（`ImportSection` 段）：
    - `tags` 维度自动出现独立卡片 + 模式选择器（T14/R8）；**部件型**（`isRecordDimension` 不捕获，T2/T14）；
    - **模式选择器**含 `incremental` / `overwrite`（A7）；`overwrite` 被选中时**展示 A8 的改判入口**（「级联摘除 / 转为 incremental」），其效果 = 改写 `dimensionModes.tags`（T8/T10）；
    - **语义不自洽弹窗**（A9）：与导出侧**同一组选项**（补足最小集 / 丢弃悬空 tags），数据来自 T8 的 `tagNames` diff 行；
    - **结果披露**（S6/A10）：`ImportApplyResult.tagsCreatedWithDefaultAppearance > 0` ⇒ 显示「N 个标签以默认外观创建」；
    - 结果清单中的 `tags` 维度计数自动出现（R8 的 5 处消费者之一）。
  - **RED 测试**（先写）：`tests/ui-smoke/tag-import-export-panels.test.tsx`
    - 导出面板：排除一个**被引用的**标签 ⇒ 断言弹窗出现且文案含**准确数字与名字**；排除一个**未被引用**的 ⇒ 断言**不弹窗**；
    - 两选项**等权**：断言无 `autofocus`/默认高亮（以 DOM 属性 + 无 `Enter` 默认路径断言）；
    - 导入面板：`tags` 卡片 + 模式选择器存在；`overwrite` 选中后**改判入口出现**；
    - 结果披露：桩返回 `tagsCreatedWithDefaultAppearance: 2` ⇒ 断言出现「2 个标签以默认外观创建」。
  - **不得**在 UI 侧重算差集（必须调 T11 的入口，A-f/D-e）。

  **Must NOT do**:
  - 不得给弹窗设默认高亮 / 让 `Enter` 触发任一项（D-e-D）。
  - 不得在 UI 侧自己推导差集或影响数（D-e：文案与判定**同源**）。
  - 不得让 `tags` 卡片成为「4 个一样、1 个特殊」（R5）。
  - 不得让 `overwrite` 在没有 diff 披露的情况下生效（§7 第 5 项）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 两处面板 + 三类弹窗/披露 + 与既有部件型 diff 的对接
  - **Skills**: [`sw-tdd-agent`, `sw-ui-ux-review`]
  - **Skills Evaluated but Omitted**: `sw-browser-tester`（jsdom 结构 + 文案足够）

  **Parallelization**:
  - **Can Run In Parallel**: NO（`App.tsx` 串行：T15 → T16 → **T17**）| **Parallel Group**: Wave 4（串行段末位）
  - **Blocks**: T18 | **Blocked By**: T8, T11, T14

  **References**:
  - **Pattern References**:
    - `src/ui/settings/App.tsx:2729-2759` — 导出维度 pick 卡片（`DIMENSION_LABELS.map`）（自动覆盖 tags，R8）
    - `src/ui/settings/App.tsx:2765-2810` — `RecordList` 记录级勾选 + select-all（标签的**逐标签勾选**参照；注意标签按**名字**而非 id）
    - `src/ui/settings/App.tsx:2632-2670` — `toggleExcluded` / `setExcludedAll`（须扩 `'tag'` kind）
    - `src/ui/settings/App.tsx:4080-4200` — 导入维度卡片 + `isRecordDimension` 分支（**部件型**路径，T2 已补注释）
    - `src/ui/settings/App.tsx:3560-3740` — 既有确认弹窗与结果清单（弹窗 + 披露的**位置**参照）
  - **API/Type References**:
    - `src/shared/export-package.ts`（T11）— `computeExportSelfConsistency`（**唯一**差集入口）
    - `src/shared/import-diff.ts`（T8）— `tagNames` 行
    - `src/background/import-export-service.ts`（T10）— `tagsCreatedWithDefaultAppearance`
    - `2026-10-10-rule-tags-detail-interaction-copy-design.md` §D-e — 后果式措辞（**逐字**的文案模板）
    - `2026-10-10-rule-tags-architecture-module-design.md` §A5/A7/A9 — 弹窗与选项
    - 主设计 §7 第 5 项 — `overwrite` 删除须经 diff 披露
  - **Test References**:
    - `tests/ui-smoke/export-flow.test.tsx` — 导出面板流程断言
    - `tests/ui-smoke/import-flow.test.tsx` — 导入面板结构 + 弹窗断言
    - `tests/ui-smoke/import-result-list.test.tsx` — 结果清单披露断言
  - **WHY Each Reference Matters**: D-e 的**否决理由 A** 写明：陈述式措辞「未说出**收件方**会多拿到 3 个标签定义——而它影响对方机器」，因此文案必须**渲染差集本身**（同源，不漂移）。R5 的对称性要求（「不得出现 4 个一样、1 个特殊」）使「复用 `DIMENSION_LABELS.map`」成为**构建性保证**，而非手工重写 5 张卡片。§7 第 5 项是本任务的**硬约束**：`overwrite` 的删除必须出现在 diff 中，否则用户会在无告知的情况下失去标签体系。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`tests/ui-smoke/tag-import-export-panels.test.tsx` 初始失败
  - [ ] GREEN：`npx vitest run tests/ui-smoke/tag-import-export-panels.test.tsx --project ui-smoke` → ALL PASS
  - [ ] **D-e 同源**：弹窗文案中的数字与名字 === `computeExportSelfConsistency().diff` 的渲染结果
  - [ ] **D-e 等权**：无默认高亮、无 `Enter` 默认路径
  - [ ] **R5**：导出与导入面板的维度卡片/选择器**均为 5 个**
  - [ ] **S6 披露**：`tagsCreatedWithDefaultAppearance > 0` ⇒ 对应文案出现
  - [ ] 既有 `export-flow.test.tsx` / `import-flow.test.tsx` → ALL PASS

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 导出弹窗的文案与判定同源（happy — D-e）
    Tool: Bash (vitest, jsdom)
    Preconditions: 标签 work(被引用) / unused(未被引用)；规则引用 work
    Steps:
      1. 取消勾选 work ⇒ 触发导出 ⇒ 断言弹窗出现
      2. 断言文案含 '补足标签' 与 '丢弃标签' 两项，且数字/名字来自差集（含 'work'）
      3. 断言两个按钮无默认高亮（无 aria-current/autofocus）
      4. 改为只取消 unused ⇒ 断言**不弹窗**（diff 为空）
    Expected Result: 文案与差集同源；只在真实不自洽时弹
    Failure Indicators: 文案数字与差集不符 / unused 也弹窗 / 存在默认按钮
    Evidence: _context-output/evidence/task-17-export-dialog.txt

  Scenario: 导入 overwrite 的改判入口与默认外观披露（failure — A8/S6）
    Tool: Bash (vitest, jsdom)
    Preconditions: 桩 inspect 返回携带 tags 且含删除行；桩 apply 返回 tagsCreatedWithDefaultAppearance=2
    Steps:
      1. 断言 tags 卡片与模式选择器存在（5 个维度）
      2. 选择 overwrite ⇒ 断言出现「级联摘除 / 转为 incremental」改判入口
      3. 断言 diff 区域显示将被删除的标签（§7 第 5 项披露）
      4. 触发 apply ⇒ 断言结果区出现 '2 个标签以默认外观创建'
    Expected Result: 破坏性删除有披露；默认外观创建有数量
    Failure Indicators: 无改判入口 / 无删除披露 / 无默认外观数量
    Evidence: _context-output/evidence/task-17-import-disclosure.txt
  ```

  **Evidence to Capture**: `task-17-export-dialog.txt`、`task-17-import-disclosure.txt`

  **Commit**: YES（groups with T17）
  - Message: `feat(ui): add tag dimension cards, self-consistency dialogs and default-appearance disclosure`
  - Files: `src/ui/settings/App.tsx, src/ui/styles/settings.css, tests/ui-smoke/tag-import-export-panels.test.tsx`
  - Pre-commit: `npm run test:ui-smoke -- tests/ui-smoke/tag-import-export-panels.test.tsx`

- [x] **T18. 第 5 维度结构守卫（类定义完整性 + chip a11y + 反例搜索）**

  **What to do**:
  - 扩展 `tests/unit/ui/settings-class-css.test.ts`（R17 范式，**扩展而非新建**，避免第二个同类守卫）：
    - `CLASS_TOKEN` 的家族**纳入 chip 前缀**（若 T12 用了 `tbs-tag-*` 前缀，须加入 `tbs-(?:settings__|field-|tag-|tag-chip)[a-zA-Z0-9_-]+`），使 chip 的类定义**同样受守卫**；
    - `MUST_NOT_FLAG`/`MUST_FLAG` case table 增 chip 相关行（证明判定器对**新家族**可判别）。
  - 新增结构守卫 `tests/unit/ui/tag-structure-guard.test.ts`（同 R17 范式：「表而非记忆」）：
    - **chip 可访问性**（R6）：以源码/渲染断言每个 chip 渲染点提供 `aria-label` 且可聚焦（键盘删除能力由 T12 断言，此处是**跨文件**的存在性守卫）；
    - **两种暂停提示的区分**（C6/C7）：断言 `App.tsx` 中「点名提示」的渲染路径**存在且依赖 `missingTagIds`**（防未来合并成一个提示）；
    - **`DIMENSION_LABELS`/`DIMENSION_META`/`DimensionPresence` 三者键集合相等**（R5/D0 的机械守卫——在 T14 的 runtime 断言之外再加**源码级**守卫）；
    - **反例搜索（inline）**：断言 `src/background/tag-service.ts` 不含投递符号（A-a）；断言 `src/shared/tag-expression.ts` / `tags.ts` 不含 React/chrome（A-b，由 `layer-boundary.test.ts` 覆盖，此处**断言其为绿**而非重复实现）。
  - **RED 测试**（先写）：守卫文件的 case table 先行（先证明**判定器能判别**，再断言现状干净——同 R17 的双测试结构）。
  - **不得**放宽既有守卫的严格度（不得加 `DYNAMIC_CLASS_ALLOWLIST` 条目来绕过未定义类）。

  **Must NOT do**:
  - 不得把守卫写成裸计数（`expect(classes.length).toBeGreaterThan(0)` 已是既有做法的一部分，但不得以计数**替代**「无 offender」断言）。
  - 不得加白名单条目绕过未定义类（R17 的 `DYNAMIC_CLASS_ALLOWLIST` 应保持为空或仅限真正运行期拼接的类）。
  - 不得在守卫内做「检测变化」（如快照 diff）——只许断言不变式。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 静态守卫设计（表而非记忆）+ 多家族 + 判别性 case table
  - **Skills**: [`sw-tdd-agent`, `sw-lint-checker`] — 守卫 TDD + 跨语言规范
  - **Skills Evaluated but Omitted**: `sw-browser-tester`（静态守卫无需浏览器）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 5（with T19–T21）
  - **Blocks**: None（收口守卫）| **Blocked By**: T12, T15, T16, T17

  **References**:
  - **Pattern References**:
    - `tests/unit/ui/settings-class-css.test.ts:27-34,122-131,174-216` — `CLASS_TOKEN` / `DYNAMIC_CLASS_ALLOWLIST` / `undefinedClasses` / **判别性 case table**（R17 的完整范式）
    - `tests/unit/shared/layer-boundary.test.ts:139-186` — **token owner** 式源码断言（A-a/A-b 的守卫照此）
    - `tests/helpers/strip-comments.ts` — **共享**的 string-aware comment stripper（守卫必须用它，不得各写一份正则）
  - **API/Type References**:
    - `src/ui/styles/settings.css` — 新类的定义位置
    - `src/ui/shared/tag-chip-input.tsx`（T12）— chip 渲染点
    - `src/background/tag-service.ts`（T9）— A-a 的守卫对象
    - `2026-10-10-rule-tags-detail-interaction-copy-design.md` §D-g R6 + 层内自检 — a11y 基准与结构守卫思路
  - **Test References**:
    - `tests/unit/ui/settings-class-css.test.ts`（本体）— 扩展目标
    - `tests/unit/ui/tag-chip-input.test.tsx`（T12）— 本守卫的**补充**（渲染级 vs 源码级）
  - **WHY Each Reference Matters**: R17 的范式核心是**「表，不是记忆」**加上**「证明判定器能判别」**：只断言「现状干净」的守卫是**可能恒真**的（若扫描范围为空）。因此新家族必须**同时**进 `CLASS_TOKEN` 与 case table。C6/C7 的区分若被未来重构合并，用户会退回「语法正常却静默变空」——源码级守卫是唯一能**持续**防住它的机制。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：新守卫的 case table 先行失败（判定器尚未覆盖新家族）
  - [ ] GREEN：`npx vitest run tests/unit/ui/settings-class-css.test.ts tests/unit/ui/tag-structure-guard.test.ts --project unit` → ALL PASS
  - [ ] **守卫非空**：`CLASS_TOKEN` 命中新家族（断言扫描到的 chip 类数 ≥1）
  - [ ] **C6/C7 区分守卫**：断言点名提示的渲染路径存在且以 `missingTagIds` 为条件
  - [ ] **A-a 守卫**：`rg "applyToMatchingTabs|redeliver" src/background/tag-service.ts` → 0，且该断言**在测试文件内**（不是一次性 shell 命令）

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 新类家族受同一守卫保护（happy — R17）
    Tool: Bash (vitest)
    Preconditions: T12/T15/T16/T17 已落地新类
    Steps:
      1. npx vitest run tests/unit/ui/settings-class-css.test.ts --project unit → ALL PASS
      2. 断言 undefinedClasses('tbs-tag-chip-planted-xyz', css) === ['tbs-tag-chip-planted-xyz']（判定器可判别新家族）
      3. 断言 chip 的真实类（如 tbs-tag-chip）被识别为**已定义**
    Expected Result: 新家族无未定义类；判定器对新家族非恒真
    Failure Indicators: 判定器对新家族恒返回 []（守卫形同不存在）
    Evidence: _context-output/evidence/task-18-class-guard.txt

  Scenario: 防线不依赖一次性命令（failure — 值得持续）
    Tool: Bash (rg + vitest)
    Preconditions: 守卫已实现
    Steps:
      1. 在 tbs-tag-chip 内临时植入一个未定义类（不改 CSS）
      2. 断言 settings-class-css 守卫**失败**（证明它真的会拦）
      3. 还原后断言守卫恢复绿
    Expected Result: 守卫可失败（非恒真）
    Failure Indicators: 植入未定义类守卫仍绿 ⇒ 守卫无效
    Evidence: _context-output/evidence/task-18-guard-can-fail.txt
  ```

  **Evidence to Capture**: `task-18-class-guard.txt`、`task-18-guard-can-fail.txt`

  **Commit**: YES（groups with T18）
  - Message: `test(ui): extend class guard to the tag family and add structural guards for chips and C6/C7`
  - Files: `tests/unit/ui/settings-class-css.test.ts, tests/unit/ui/tag-structure-guard.test.ts`
  - Pre-commit: `npm run test:unit -- tests/unit/ui/settings-class-css.test.ts tests/unit/ui/tag-structure-guard.test.ts`

- [x] **T19. fixture 连锁迁移 + 既有测试锚点对齐（必填 `tagIds`）**

  **What to do**（⚠️ **必须在所有 `src/` 改动完成后执行**，见 Dependency Matrix）：
  - 依 **T3 的 `task-3-fixture-inventory.txt`**（逐 `path:line`）迁移全部 fixture：
    - 所有 `PageRule` 构造点补 `tagIds: []`（**空数组**，P1 必填）；
    - 所有 `SyncState` 构造点补 `tags: []`；
    - 优先用 T3 的 `makeTaggedRule()`/`makeSyncStateWithTags()`（**集中默认**，防 63 处手抄漂移）；
    - 仅在**测试语义需要标签**处给非空 `tagIds`（其余保持 `[]`）。
  - **锚点对齐**：逐层跑 `test:unit` → `test:integration` → `test:ui-smoke`，对**每一个**失败断言判断：
    - 若失败源于「必填字段新增」⇒ 迁移 fixture；
    - 若失败源于「行为真的变了」⇒ **不得**改断言，须回到对应任务修复（这是回归，不是适配）；
    - **注意**：`tests/integration/field-chain-parity.test.ts`（R20 已知触碰点）在标签引入后应**仍然通过**——它是 I1（标签不进链）的**既有**证据链。
  - 产出收口证据 `_context-output/evidence/task-19-migration-complete.txt`：迁移文件清单（勾销 T3 的清单）+ 三层测试结果。
  - **不得**为此任务新增测试（只迁移 + 对齐）；**不得**放宽任何既有断言的严格度。

  **Must NOT do**:
  - 不得用 `as any` / `@ts-expect-error` / 可选放宽来绕过必填字段（P1）。
  - 不得把「行为变化的失败」当成「fixture 需要适配」而改断言（那是掩盖回归）。
  - 不得修改 `field-chain-parity.test.ts` 的**语义**（它守的是 I1）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 63 文件面的机械但需判断的迁移（区分「适配」与「回归」）
  - **Skills**: [`sw-tdd-agent`, `sw-verification-before-completion`] — 迁移 + 完成前证据核验
  - **Skills Evaluated but Omitted**: `sw-systematic-debugging`（失败已由分层定位）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 5（with T18, T20, T21）—— 但 **T20 须在 T19 之后**（T20 需要可编译/可跑的基线）
  - **Blocks**: T20 | **Blocked By**: T1（语义）· T3（清单）· 执行序：所有 W1–W4 完成

  **References**:
  - **Pattern References**:
    - `_context-output/evidence/task-3-fixture-inventory.txt`（T3）— **逐条迁移清单**（`path:line`）
    - `tests/helpers/tag-fixtures.ts`（T3）— 集中默认的夹具
    - `tests/integration/import-export-service.test.ts:46-86` — 既有夹具集中默认范式（`pkgFile`）
  - **API/Type References**:
    - `src/shared/types.ts:PageRule`（T1 增必填 `tagIds`）
    - `src/shared/types.ts:SyncState`（T1 增 `tags`）
    - `src/shared/types.ts:DimensionPresence`（T1 增必填 `tags`）⇒ **所有** `DimensionPresence` 字面量（若测试构造）也须补
  - **Test References**:
    - `tests/integration/field-chain-parity.test.ts` — **I1 的既有证据链**，迁移后必须仍绿
    - `tests/unit/ui/settings.test.tsx` — `SyncState` fixture 密集处
    - `tests/ui-smoke/import-flow.test.tsx`（`:71-99`）— `CURRENT` fixture 迁移样例
  - **WHY Each Reference Matters**: R20 实测 63 文件触碰 `SyncState`/`PageRule` —— 这是 P1（必填）的**全部代价**，也正是 D0 所说「加字段会逐处编译报错，不会漏」的**受益面**：编译器把「哪些地方需要迁移」**完整列举**出来了。T3 的清单把这个列举固化为可勾销的产物。**关键判断**是区分「适配」与「回归」——`field-chain-parity.test.ts` 若因标签而失败，说明**标签进了链**（I1 失守），必须改实现而非改测试。

  **Acceptance Criteria（TDD）**:
  - [ ] `npm run typecheck` → **0 error**（含 `tests/`，若 `tsconfig` 覆盖）
  - [ ] `npm run test:unit` → ALL PASS
  - [ ] `npm run test:integration` → ALL PASS（**特别**：`field-chain-parity.test.ts` 绿）
  - [ ] `npm run test:ui-smoke` → ALL PASS
  - [ ] `_context-output/evidence/task-19-migration-complete.txt` 逐条勾销 T3 清单，**无剩余项**
  - [ ] `rg "@ts-expect-error|as any" tests/ | rg -c "tagIds"` → 0（未用逃生口绕过必填）

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 迁移完整且无逃生口（happy — P1）
    Tool: Bash (tsc + vitest)
    Preconditions: 所有 src 改动完成
    Steps:
      1. npm run typecheck ⇒ 断言 0 error
      2. npm run test:unit && npm run test:integration && npm run test:ui-smoke ⇒ 全部 ALL PASS
      3. 逐条核对 task-3-fixture-inventory.txt 的每个 path:line 已带 tagIds/tags
    Expected Result: 必填字段在 63 文件面内被完整迁移
    Failure Indicators: typecheck 报错 / 清单有剩余项 / 出现 @ts-expect-error
    Evidence: _context-output/evidence/task-19-migration-complete.txt

  Scenario: 标签未进入执行链（failure — I1 的既有证据链）
    Tool: Bash (vitest + rg)
    Preconditions: 迁移完成
    Steps:
      1. npx vitest run tests/integration/field-chain-parity.test.ts --project integration ⇒ ALL PASS
      2. rg "tagIds" src/shared/field-chain.ts src/background/rule-service.ts src/background/field-delivery-service.ts ⇒ 0 命中
      3. 若第 1 步为红：断言失败原因是**实现**把标签接入了链（而非测试需适配）——不得改该测试
    Expected Result: 链与投递对标签完全无感
    Failure Indicators: parity 测试红 / 链相关文件出现 tagIds
    Evidence: _context-output/evidence/task-19-chain-untouched.txt
  ```

  **Evidence to Capture**: `task-19-migration-complete.txt`、`task-19-chain-untouched.txt`

  **Commit**: YES（groups with T19）
  - Message: `test: migrate fixtures to required tagIds/tags and align existing anchors`
  - Files: `tests/**（依清单）, tests/helpers/tag-fixtures.ts`
  - Pre-commit: `npm run typecheck && npm run test:unit && npm run test:integration && npm run test:ui-smoke`

- [x] **T20. 集成端到端（导出→导入往返 / 两处裁决 / 级联原子性）**

  **What to do**:
  - 新建 `tests/integration/tag-roundtrip.test.ts`（**端到端**，串起 T4/T9/T10/T11/T19）：
    - **对称性**（主设计 §5 Testing Strategy 明列）：
      - 导出（含标签）⇒ 导入到**空机器** ⇒ 标签名与颜色一致；
      - 导出 ⇒ 导入到**已有同名不同色**的机器 ⇒ **复用本机颜色**（A-e），且**不重复创建**；
      - 导出 ⇒ 导入到**已有同名同色**的机器 ⇒ **幂等**（无新增、无改名）；
    - **两处裁决点分支**：`overwrite` 的 `cascade` / `to-incremental`；语义不自洽的 `补足` / `丢弃`（A8/A9）；
    - **A10/S6**：悬空名字命中/未命中两路（T10 已单测，此处是**跨导出导入**的端到端确认）；
    - **级联原子性端到端**：删除标签 ⇒ 导出 ⇒ 断言产出包**恒自洽**（S3，不含悬空名）。
  - **RED 测试**：即本任务本体（先写会失败的端到端断言，再修到绿）。
  - 产出 `_context-output/evidence/task-20-roundtrip-matrix.txt`（**矩阵**：3 种目标机状态 × 3 种操作，逐格 Pass/Fail）。
  - **不得**在 UI 层验证这些语义（它们属服务层，须在 `integration` project 内断言）。

  **Must NOT do**:
  - 不得只测 happy path（对称性测试**必须**含「同名不同色」与「幂等」两格）。
  - 不得把断言写成「导出成功」这类存在性断言——须断**具体名字与颜色**。
  - 不得在 `ui-smoke`（jsdom）内验证服务语义（层次错配）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 端到端矩阵 + 对称性/幂等 + 跨任务集成
  - **Skills**: [`sw-tdd-agent`, `sw-verification-before-completion`]
  - **Skills Evaluated but Omitted**: `sw-browser-tester`（服务层集成，无需浏览器）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 5（with T18, T21）—— 但 **须在 T19 之后**（需要可跑基线）
  - **Blocks**: None（收口验证）| **Blocked By**: T9, T10, T11, T19

  **References**:
  - **Pattern References**:
    - `tests/integration/import-fidelity.test.ts` — 往返保真断言先例
    - `tests/integration/import-apply-result.test.ts` — 结果与维度计数断言
    - `tests/integration/import-export-service.test.ts:88-130` — 服务级集成测试装配（mock adapter + service）
    - `tests/integration/tag-service.test.ts`（T9）/ `tag-import-decisions.test.ts`（T10）— 本任务的上游断言（此处是**跨模块**组合）
  - **API/Type References**:
    - `src/background/import-export-service.ts` — `exportPackage` / `inspect` / `applyImport`
    - `src/shared/export-package.ts:syncStateToPackage` / `packageToSyncPatch`
    - `2026-10-10-rule-tags-design.md` §5 Testing Strategy — **本任务的范围由设计直接指定**（integration 层：导入导出的对称性 / 两处裁决点的分支 / `overwrite` 的两条路径）
    - `2026-10-10-rule-tags-design.md` §3 不变量 I3（导出恒自洽）
  - **Test References**:
    - `tests/integration/field-chain-parity.test.ts` — 既有 parity 风格（**同时**是本任务 I1 的对照）
    - `tests/integration/smoke.test.ts` — 端到端串联先例
  - **WHY Each Reference Matters**: 设计 §5 把 integration 层的重点**明确**写为「导入导出的**对称性**：导出→导入往返后标签与颜色一致；两处裁决点的分支；`overwrite` 的两条路径」——本任务即该清单的**逐项落实**。加入「幂等」与「同名不同色」两格是因为 A-e 的匹配依据是 **trim 逐字节相等**：若实现者用「不存在就新建」的朴素写法，同名不同色会产生**两个**同名标签，直接违反 C2/I4。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`tests/integration/tag-roundtrip.test.ts` 初始失败（在 T20 开始时）
  - [ ] GREEN：`npx vitest run tests/integration/tag-roundtrip.test.ts --project integration` → ALL PASS
  - [ ] **矩阵覆盖**：3 目标机状态 × 3 操作 = 9 格全部断言（证据文件逐格列出）
  - [ ] **S3**：删除后导出的包 `selfConsistencyDiff === []`
  - [ ] **I4 不变式**：同名不同色场景下目标机标签数**不增加**（无重复条目）

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 往返对称性 + 幂等（happy — 设计 §5）
    Tool: Bash (vitest)
    Preconditions: 源机 tags=[work(#F00), urgent(#00F)]，规则引用两者
    Steps:
      1. 导出全量包 ⇒ 导入**空**机 ⇒ 断言标签名与颜色逐项一致
      2. 把同一包再次导入（幂等）⇒ 断言标签数不变、名字不变、颜色不变
      3. 导入到「已有 work 但颜色为 #0F0」的机器 ⇒ 断言 work 仍为 #0F0 且**未新增**第二个 work
    Expected Result: 对称、幂等、同名复用
    Failure Indicators: 出现两个 work / 本机颜色被覆盖 / 二次导入产生副本
    Evidence: _context-output/evidence/task-20-roundtrip-matrix.txt

  Scenario: overwrite 两条路径的端到端后果（failure — A7/A8）
    Tool: Bash (vitest)
    Preconditions: 目标机 tags=[A,B]，文件 root tags=[A]
    Steps:
      1. overwrite + cascade ⇒ 断言 B 被删且引用被摘除；断言 diff 曾披露该删除（inspect 阶段）
      2. overwrite + to-incremental ⇒ 断言 A、B 均保留
      3. 断言两次导出的结果包均满足 selfConsistencyDiff === []（S3）
    Expected Result: 删除可控、可判、包恒自洽
    Failure Indicators: cascade 无披露 / 两路径结果相同 / 导出出现悬空名
    Evidence: _context-output/evidence/task-20-overwrite-paths.txt
  ```

  **Evidence to Capture**: `task-20-roundtrip-matrix.txt`、`task-20-overwrite-paths.txt`

  **Commit**: YES（groups with T20）
  - Message: `test(integration): add tag round-trip, idempotency and overwrite path coverage`
  - Files: `tests/integration/tag-roundtrip.test.ts, _context-output/evidence/task-20-roundtrip-matrix.txt`
  - Pre-commit: `npm run test:integration -- tests/integration/tag-roundtrip.test.ts`

- [x] **T21. §7 五项文档/注释复核 + I1/A-a 机械反例搜索**

  **What to do**:
  - **§7 五项逐条复核**（主设计 §7 的表格，**逐项**给出「已改 / 位置 / 证据」）：
    1. `src/shared/types.ts:223` 注释 → **5 个维度**（T1 完成，此处**复核**）；
    2. `src/ui/settings/App.tsx:2997-3016` `DIMENSION_LABELS`/`DIMENSION_META` 增 `tags`（T14 完成，复核）；
    3. `src/ui/settings/App.tsx:4090` `isRecordDimension` 分类注释说明标签走**部件型**管线（T2 完成，复核）；
    4. `_context-output/designs/2026-10-02-field-chain-sync-detail-copy-a11y-design.md` §0.2 术语表增 `tag`/`expression`/`predicate`/`chip`/`vocabulary`（T2 完成，复核）；
    5. **S4 与 C4 的关系**：`overwrite` 的删除**经 diff 披露**，不得绕过 C4 保护（T8/T17 完成，**复核为硬断言**）。
  - **机械反例搜索**（一次性但须**如实记录命令与输出**）：
    - I1：`rg "tagIds|tags\b" src/background/rule-service.ts src/background/field-delivery-service.ts src/shared/field-chain.ts` → **0 命中**；
    - A-a：`rg "applyToMatchingTabs|redeliver|FieldDeliveryService" src/background/tag-service.ts` → **0 命中**；
    - C0：`rg -c "SYNC_KEY" src/background/storage-repository.ts` → 与基线一致；`rg "QUOTA_BYTES_PER_ITEM" src/` 命中数不变；
    - 依赖：`package.json` 的 `dependencies` 恰为 `{react, react-dom}`；
    - C9：`rg "legacy|backCompat|migrat" src/shared/tags.ts src/shared/tag-expression.ts src/background/tag-service.ts` → 0 命中（除注释中的「不作迁移」说明）；
    - D4：标签名不得出现在诊断写入路径（`rg "tag" src/background/diagnostics-service.ts` → 0 命中）。
  - 产出 `_context-output/evidence/task-21-§7-and-guardrails.txt`。
  - **本任务只读不改**（若发现未完成项 ⇒ **不自行修复**，回退到对应任务）。

  **Must NOT do**:
  - 不得把「§7 已由其他任务完成」当作免检（复核是**独立**的验收动作）。
  - 不得修改 `src/`（发现缺口应回退到对应任务，而非在此补做）。
  - 不得把一次性 shell 搜索**替代** T18 的持续守卫（本任务是**快照**，T18 是**机制**）。

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: 逐条复核 + 反例搜索，无实现
  - **Skills**: [`sw-verification-before-completion`] — 证据先于断言
  - **Skills Evaluated but Omitted**: `sw-tdd-agent`（无新测试）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 5（with T18–T20）
  - **Blocks**: None | **Blocked By**: 全部（T1–T20）

  **References**:
  - **Pattern References**:
    - `_context-output/designs/2026-10-10-rule-tags-design.md:192-205` — **§7 的五项表格**（本任务的核对清单来源）
    - `_context-output/designs/2026-10-10-rule-tags-decisions.yaml:17-22` — `revised_authorities`（与 §7 前两项对应）
  - **API/Type References**:
    - `2026-10-10-rule-tags-design.md` §3 不变量表（I1–I5 的核对口径）
    - `2026-10-10-rule-tags-architecture-module-design.md` §2（A-a–A-h）
    - `2026-10-10-rule-tags-constraint-boundaries-design.md` §2（D1–D4）+ §C9
  - **Test References**:
    - `tests/unit/ui/tag-structure-guard.test.ts`（T18）— 持续守卫
    - `tests/unit/shared/layer-boundary.test.ts` — A-b 的既有守卫（复核其为绿即可）
  - **WHY Each Reference Matters**: §7 是设计**显式**留下的「实现期须同步」清单；**第 5 项**尤其关键——它是「S4 与 C4 的关系」，即 `overwrite` 不得成为绕过 C4 告知保护的后门。该项**无法**靠编译期护栏保住，只能靠**断言 + 搜索**，因此本任务的复核必须**具体到测试名**。

  **Acceptance Criteria**:
  - [ ] §7 五项**逐条**给出「已改 / 位置 / 证据（命令或测试名）」
  - [ ] I1 反例搜索 → **0 命中**
  - [ ] A-a 反例搜索 → **0 命中**
  - [ ] C0 比对 → `SYNC_KEY` 命中数与基线一致
  - [ ] 依赖清单 → 恰 2 项
  - [ ] `_context-output/evidence/task-21-§7-and-guardrails.txt` 含**命令 + 原始输出**

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: §7 五项全部落实（happy）
    Tool: Bash (rg + vitest)
    Preconditions: T1–T20 完成
    Steps:
      1. rg -n "five dimensions|5 dimensions" src/shared/types.ts ⇒ 断言命中（§7-1）
      2. rg -n "dim: 'tags'" src/ui/settings/App.tsx ⇒ 命中（§7-2）
      3. rg -n "isRecordDimension" src/ui/settings/App.tsx -A6 ⇒ 注释含「部件型」（§7-3）
      4. rg -c "vocabulary" _context-output/designs/2026-10-02-field-chain-sync-detail-copy-a11y-design.md ⇒ ≥1（§7-4）
      5. 断言存在**具名测试**：task-8/task-20 的披露断言（§7-5）
    Expected Result: 5/5 落实且有证据
    Failure Indicators: 任一项无命中或无具名测试
    Evidence: _context-output/evidence/task-21-section7-review.txt

  Scenario: 六条 Guardrail 的反例搜索全 0（failure — 机械守卫）
    Tool: Bash (rg)
    Preconditions: 同上
    Steps:
      1. rg "tagIds" src/shared/field-chain.ts src/background/rule-service.ts src/background/field-delivery-service.ts ⇒ 断言 0
      2. rg "applyToMatchingTabs|redeliver" src/background/tag-service.ts ⇒ 断言 0
      3. rg -c "SYNC_KEY" src/background/storage-repository.ts ⇒ 断言 == 基线值
      4. node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies).sort().join(','))" ⇒ 断言 === 'react,react-dom'
      5. rg "tag" src/background/diagnostics-service.ts ⇒ 断言 0（D4）
    Expected Result: 六项全 0/一致
    Failure Indicators: 任一命中 ⇒ 对应 Guardrail 失守
    Evidence: _context-output/evidence/task-21-guardrails.txt
  ```

  **Evidence to Capture**: `task-21-section7-review.txt`、`task-21-guardrails.txt`

  **Commit**: YES（groups with T21）
  - Message: `docs(review): verify section-7 sync items and run guardrail searches`
  - Files: `_context-output/evidence/task-21-section7-review.txt, _context-output/evidence/task-21-guardrails.txt`
  - Pre-commit: `npm run typecheck && npm run lint`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must PASS. Present consolidated results to user and get explicit "okay" before completing.
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1–F4 as checked before getting user's okay.** Rejection or user feedback → fix → re-run → present again → wait for okay.

- [ ] F1. **Plan Compliance Audit**（推荐 profile: `oracle` / strategic review）

  Read the plan end-to-end executing the following:
  - **Must Have verification**: 逐条读「Must Have」，用**具体命令/文件/测试名**证明其存在（读文件 / 跑具名测试 / `rg` 反例）
  - **Must NOT Have verification**: 逐条搜索禁止模式，**带 file:line** 拒绝：`tagIds` 出现在链/投递/RuleService；`tag-service.ts` 出现投递符号；`package.json` dependencies ≠ 2 项；软删除/第三态；`field op value` 预埋
  - **编译期护栏验证**: 确认两处 `satisfies` 穷尽校验（`export-package.ts:159-161`）与 `DimensionPresence` 必填**未被放宽为可选**，且 `KNOWN_ACTIONS` 的 `as const` **未被改成宽注解**（R6）
  - **Evidence verification**: `_context-output/evidence/task-*` 全部存在且非空
  - **§7 五项验证**: 逐项核对（含**第 5 项**的具名披露测试）

  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | Evidence [N/N] | §7 [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review**（推荐 profile: `unspecified-high`）

  Run static analysis and review all changed files:
  - **Build**: `npm run typecheck` → 0 error；`npm run build:chrome && npm run build:edge && npm run build:firefox` → 三浏览器成功
  - **Lint**: `npm run lint`（`--max-warnings 0`）→ 0 warning；**不得**放宽 `eslint.config.mjs`
  - **Tests**: `npm run test:unit && npm run test:integration && npm run test:ui-smoke` → ALL PASS
  - **Code patterns**: 检查 `as any` / `@ts-ignore` / 空 catch / 生产 `console.log` / 注释掉的代码 / 未用 import
  - **Anti-pattern（本项目特有）**: 第二处差集推导（A-f）/ 第二套撤销机制（P3）/ UI 侧重做领域规则（P4）/ 递归下降（D1）
  - **AI slop detection**: 冗余注释、过度抽象（把表达式抽成通用查询语言）、通用命名（`data`/`result`/`item`/`temp`）

  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT: APPROVE/REJECT`

- [ ] F3. **Real Manual QA**（推荐 profile: `unspecified-high`）

  从 clean state 起，执行**每个任务**的 QA 场景：
  - **Per-Scenario Execution**: 按各任务 QA 场景的 exact steps 执行，捕获证据到 `_context-output/evidence/final-qa/`
  - **Integration Testing**: 跨任务联动——「chip 表达式筛选 → 选中项 prune → 批量操作」「就地新建 → 取消表单 → Tags 页可见 → 删除 → Undo 恢复」「导出排除标签 → 弹窗 → 导入 → 默认外观披露」
  - **Edge Cases**: 空表达式 / 半成品 / 已删引用 / 孤立标签 / 同名不同色 / 二次导入幂等 / 5000 层深嵌套 / 9 个标签 / 33 字符名
  - **层别正确**: 服务语义只在 `integration` 验证；jsdom 只断言**结构 + 文案 + aria**，**不得**断言 canvas 像素或布局几何

  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT: APPROVE/REJECT`

- [ ] F4. **Scope Fidelity Check**（推荐 profile: `deep`）

  For each task: verify implementation matches specification exactly:
  - **Spec-Implementation Mapping**: 逐任务读 "What to do"，对照 `git diff`/`git log`，验证 1:1
  - **Completeness Check**: 42 项设计决策是否**全部**落地（逐层抽查 goal/constraint/architecture/detail，含 6 项回溯修订 S1–S6）
  - **Anti-Creep Check**: 是否有**超出**设计的新增（典型：通用标签平台 / 表达式语言扩容 / 容量拆 key / 软删除 / 批量赋值 G3-C 已推迟）
  - **Must NOT Do Compliance**: 逐任务核对
  - **Cross-Task Contamination**: 检测 `App.tsx` 是否被 T14–T17 之外的任何任务触及；`export-package.ts` 是否仅被 T1 触及；`messages.ts` 是否仅被 T7 触及
  - **Unaccounted Changes**: 标记任何未被任何任务列出的改动文件

  Output: `Tasks [N/N compliant] | Decisions [42 checked] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT: APPROVE/REJECT`

---

## Commit Strategy

```
Commit 1: feat(shared): add tag data model, package shapes and fifth dimension contract
  Files: src/shared/types.ts, src/shared/export-package.ts, tests/unit/shared/tag-types-contract.test.ts
  Pre-commit: npm run test:unit -- tests/unit/shared/tag-types-contract.test.ts

Commit 2: docs(design): sync tag/expression/predicate/chip/vocabulary terminology
  Files: _context-output/designs/2026-10-02-field-chain-sync-detail-copy-a11y-design.md, src/ui/settings/App.tsx
  Pre-commit: npm run typecheck

Commit 3: test(helpers): add tag fixtures and inventory the PageRule/SyncState migration surface
  Files: tests/helpers/tag-fixtures.ts, tests/unit/helpers/tag-fixtures.test.ts, _context-output/evidence/task-3-fixture-inventory.txt
  Pre-commit: npm run test:unit -- tests/unit/helpers/tag-fixtures.test.ts

Commit 4: feat(shared): add tag domain functions (identity, limits, dangling strip, self-consistency diff)
  Files: src/shared/tags.ts, tests/unit/shared/tags.test.ts
  Pre-commit: npm run test:unit -- tests/unit/shared/tags.test.ts

Commit 5: feat(shared): add tag boolean-expression engine (iterative parse/eval, entity resolution)
  Files: src/shared/tag-expression.ts, tests/unit/shared/tag-expression.test.ts
  Pre-commit: npm run test:unit -- tests/unit/shared/tag-expression.test.ts

Commit 6: feat(background): add tag storage primitives (getTags, mutateSyncTags) with lenient read
  Files: src/background/storage-repository.ts, tests/integration/storage-repository-tags.test.ts
  Pre-commit: npm run test:integration -- tests/integration/storage-repository-tags.test.ts

Commit 7: feat(shared): add tag message family and register actions in KNOWN_ACTIONS
  Files: src/shared/messages.ts, src/shared/types.ts, src/background/worker-orchestrator.ts, tests/unit/shared/tag-messages-contract.test.ts
  Pre-commit: npm run test:unit -- tests/unit/shared/tag-messages-contract.test.ts

Commit 8: feat(import): wire fifth dimension through diff, intent resolution and apply outcomes
  Files: src/shared/import-diff.ts, src/shared/types.ts, src/background/import-export-service.ts, tests/integration/import-fifth-dimension.test.ts
  Pre-commit: npm run test:integration -- tests/integration/import-fifth-dimension.test.ts

Commit 9: feat(background): add TagService with limits, cascading delete and dangling-id stripping
  Files: src/background/tag-service.ts, src/background/worker-orchestrator.ts, tests/integration/tag-service.test.ts, tests/unit/background/tag-service-boundary.test.ts
  Pre-commit: npm run test:integration -- tests/integration/tag-service.test.ts

Commit 10: feat(import): resolve tag identities on import (reuse by name, default appearance for misses)
  Files: src/background/import-export-service.ts, src/shared/types.ts, tests/integration/tag-import-decisions.test.ts
  Pre-commit: npm run test:integration -- tests/integration/tag-import-decisions.test.ts

Commit 11: feat(export): carry tag vocabulary and compute self-consistency diff for the export dialog
  Files: src/shared/export-package.ts, tests/unit/shared/export-self-consistency.test.ts
  Pre-commit: npm run test:unit -- tests/unit/shared/export-self-consistency.test.ts

Commit 12: feat(ui): add tag chip expression input (keyboard-deletable, inline create, wrapping)
  Files: src/ui/shared/tag-chip-input.tsx, src/ui/styles/settings.css, tests/unit/ui/tag-chip-input.test.tsx
  Pre-commit: npm run test:unit -- tests/unit/ui/tag-chip-input.test.tsx

Commit 13: feat(ui): add tag selection to the shared rule form and tag writes after rule save
  Files: src/ui/shared/rule-form-fields.tsx, src/ui/shared/rule-form-submit.ts, src/ui/sidebar/App.tsx, tests/unit/ui/rule-form-fields-tags.test.tsx, tests/ui-smoke/tag-tagging-entry.test.tsx
  Pre-commit: npm run test:unit -- tests/unit/ui/rule-form-fields-tags.test.tsx

Commit 14: feat(ui): add tags as the fifth dimension metadata and extend D-13 prune to the expression
  Files: src/ui/settings/App.tsx, tests/unit/ui/settings-fifth-dimension.test.tsx
  Pre-commit: npm run typecheck

Commit 15: feat(ui): add tag expression filter and collapsed Tags column to the rules table
  Files: src/ui/settings/App.tsx, src/ui/styles/settings.css, tests/ui-smoke/rules-tag-filter.test.tsx
  Pre-commit: npm run test:ui-smoke -- tests/ui-smoke/rules-tag-filter.test.tsx

Commit 16: feat(ui): add Tags management page with orphan visibility, cascading delete and undo
  Files: src/ui/settings/App.tsx, src/ui/styles/settings.css, tests/ui-smoke/tags-section.test.tsx
  Pre-commit: npm run test:ui-smoke -- tests/ui-smoke/tags-section.test.tsx

Commit 17: feat(ui): add tag dimension cards, self-consistency dialogs and default-appearance disclosure
  Files: src/ui/settings/App.tsx, src/ui/styles/settings.css, tests/ui-smoke/tag-import-export-panels.test.tsx
  Pre-commit: npm run test:ui-smoke -- tests/ui-smoke/tag-import-export-panels.test.tsx

Commit 18: test(ui): extend class guard to the tag family and add structural guards for chips and C6/C7
  Files: tests/unit/ui/settings-class-css.test.ts, tests/unit/ui/tag-structure-guard.test.ts
  Pre-commit: npm run test:unit -- tests/unit/ui/settings-class-css.test.ts tests/unit/ui/tag-structure-guard.test.ts

Commit 19: test: migrate fixtures to required tagIds/tags and align existing anchors
  Files: tests/**（依 task-3 清单）, tests/helpers/tag-fixtures.ts
  Pre-commit: npm run typecheck && npm run test:unit && npm run test:integration && npm run test:ui-smoke

Commit 20: test(integration): add tag round-trip, idempotency and overwrite path coverage
  Files: tests/integration/tag-roundtrip.test.ts, _context-output/evidence/task-20-roundtrip-matrix.txt
  Pre-commit: npm run test:integration -- tests/integration/tag-roundtrip.test.ts

Commit 21: docs(review): verify section-7 sync items and run guardrail searches
  Files: _context-output/evidence/task-21-section7-review.txt, _context-output/evidence/task-21-guardrails.txt
  Pre-commit: npm run typecheck && npm run lint
```

> **提交顺序约束**：
> - Commit 1 **必须**先于其余全部（护栏起点）。
> - Commit 7 与 Commit 9 **应相邻**（`KNOWN_ACTIONS` 加项后须落路由，否则动作被登记但未接线）。
> - Commit 14/15/16/17 **顺序不可交换**（同文件 `App.tsx` 串行段）。
> - Commit 19 **必须最后**（fixture 迁移须在所有 src 改动之后；否则迁移会失效）。

---

## Success Criteria

### Verification Commands

```bash
# 类型与规范（P7 收口）
npm run typecheck   # Expected: 0 error（**全仓含 tests**；T19 后达成）
# P7 中间收口（T14 后即可断言）：src 侧必须为 0
npm run typecheck 2>&1 | grep "error TS" | grep -c "src/"   # Expected: 0（T14 后）
npm run lint        # Expected: 0 warning（--max-warnings 0）

# 三层测试（最终必须全绿）
npm run test:unit        # Expected: ALL PASS
npm run test:integration # Expected: ALL PASS
npm run test:ui-smoke    # Expected: ALL PASS

# 构建三浏览器
npm run build:chrome && npm run build:edge && npm run build:firefox  # Expected: 三者均成功

# I1：标签不进执行链
rg "tagIds" src/shared/field-chain.ts src/background/rule-service.ts src/background/field-delivery-service.ts
# Expected: 0 命中

# A-a：TagService 无投递入口
rg "applyToMatchingTabs|redeliver|FieldDeliveryService" src/background/tag-service.ts
# Expected: 0 命中

# D4：诊断不含标签名
rg "tag" src/background/diagnostics-service.ts
# Expected: 0 命中

# C0：未拆 sync key、未新增依赖
rg -c "SYNC_KEY" src/background/storage-repository.ts   # Expected: 与基线一致
node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies).sort().join(','))"
# Expected: react,react-dom

# A-b：shared 层不出界（既有守卫，须保持绿）
npx vitest run tests/unit/shared/layer-boundary.test.ts --project unit   # Expected: PASS
```

### Final Checklist

- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tasks completed (21/21)
- [ ] All tests pass（三层全绿，基线 1323 测试 + 新增）
- [ ] All QA scenarios executed with evidence（`_context-output/evidence/task-*`）
- [ ] §7 五项全部落实（含第 5 项的具名披露测试）
- [ ] All Final Verification reviews APPROVED（F1–F4）
- [ ] User explicitly approved completion
- [ ] Evidence directory populated: `_context-output/evidence/`

---

## Open Questions

**无未决项。** 设计层 0 项 OPEN；计划层 8 项裁决（P1–P8）均已给出依据且**不阻塞执行**。

若用户希望**改判**其中任一项，可在执行前一次性指定（**默认即以下裁决**）：

| # | 裁决 | 改判的后果 |
|---|---|---|
| P1 | `PageRule.tagIds` **必填** | 改为可选 ⇒ I2（引用永不悬空）在**类型层**失去强制，须靠运行期自觉 |
| P2 | 本机读取**宽容补齐**；严格性只施加于导入包 | 改为严格 ⇒ 开发期每次存档形状变更都要重建存档（与 `migrateSyncState` 的 NO MIGRATION 立场冲突）。**已被用户批准采纳**（2026-10-11） |
| P3 | `UndoLayerWrite` 增 `tag-delete` kind | 改为独立快照机制 ⇒ 违反 C5「无新机制」，并新增一条需维护的存储通道 |
| P4 | 业务规则在 `TagService`；存储层只加搬运原语 | 改为下沉到存储层 ⇒ 违反 A1-C 已否决的分工 |
| P5 | 表达式**显式栈迭代** | 改为「递归 + 深度计数」⇒ D1 只被部分满足（计数阈值本身成为新的失败面） |
| P6 | chip 后备名存 **UI 态** | 改为持久化墓碑 ⇒ 引入 C7/D2 明确拒绝的第三态 |
| P7 | 中间红灯窗口接受；收口点 = T14（**`src/` 侧** typecheck 0）/ T19（全仓 typecheck 0 + 三层测试全绿） | 改为「每任务独立全绿」⇒ 需把必填字段暂时改成可选再回改（**会实质削弱护栏**） |
| P8 | 证据目录 = `_context-output/evidence/` | 改为 `_context/memory/sw-shared/evidence/` ⇒ 与仓库既有 7 个计划的惯例不一致 |