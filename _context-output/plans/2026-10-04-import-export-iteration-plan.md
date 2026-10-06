# Import / Export 界面功能迭代与优化 — Work Plan

> **计划名称**: import-export-iteration-plan
> **创建时间**: 2026-10-04 · **创建者**: sw-strategic-planner (Prometheus)
> **状态**: Ready for Execution（**0 项 [DECISION NEEDED]** —— 用户已裁定 **Q1=A**（配方在 **UI 侧**渲染 PNG）/ **Q2=B-2**（**`settings/App.tsx` 内独立导出 section**，不新增 HTML 页面与构建入口）；计划层默认裁决 D-1/D-2 已被这两项裁定覆盖，见 §Pre-Planning Review 与 §Open Questions）
> **修订记录（v2 · 2026-10-05，依 sw-plan-reviewer REJECT 意见）**: ① 同步 Q1=A / Q2=B 裁定（BLOCKER 1/2）· ② Wave 4 拆 4a/4b + T9 依赖登记（HIGH 3）· ③ 关键路径统一为一条（MEDIUM 1）· ④ T14 行号引用更正（MEDIUM 2）· ⑤ 验证口径统一为「ui-smoke(jsdom) 结构断言 + 浏览器 skill 自动化」（LOW）
> **修订记录（v3 · 2026-10-05，Q2 口径裁定为 B-2）**: B-1/B-2 口径已由用户裁定为 **B-2** —— 独立导出面板 = **`settings/App.tsx` 内独立导出 section**，**不新增 HTML 页面、不新增构建入口**（`vite.config.ts` 保持 **7** 入口）。据此：TL;DR/Concrete Deliverables/Must Have/DoD/Open Questions/RK-9/Wave 说明/依赖矩阵/Agent Dispatch/T19 整块/Commit 20/提交顺序约束/Final Checklist 全部同步；`import-preview` 孤儿页（F1）与 `2026-07-14-ui-ux-design.md:150-156` 的"设置页 5 分区含导入导出"作为 B-2 依据。**Q1=A 相关内容未改动。**
> **上游设计（四层闭合，0 OPEN，44 项决策：38 RESOLVED / 2 取代 / 4 作废）**:
> - 主文档 `_context-output/designs/2026-10-04-import-export-design.md`
> - 决策清单 `_context-output/designs/2026-10-04-import-export-decisions.yaml`
> - 子文档 `…-goal-scope-…` / `…-constraint-boundaries-…` / `…-architecture-package-protocol-…` / `…-detail-interaction-copy-…`
> **先读后规划**: 已完整读取主文档 + YAML；四份子文档全文读取；规划期实读源码核实 20 处关键事实（非引用设计）
> **既有一致性修订**（保留，不得回退）: `2026-07-14-…-decisions.yaml`（`import-export-format` / `import-merge` / `export-local-icons` 标记 REVISED）+ `constraints-permissions-privacy-design.md` 图标章节澄清

---

## TL;DR

> **Quick Summary**: 把导入/导出从「两个单选按钮 + 静默整体替换」改造成**一个自描述可携带包**：导出按 4 维度（槽位/规则/策略/快捷键）产出包、图标只带 `URL`/裸 `local-icon:` 引用/可复现配方（**不搬运字节**）；导入走「`IMPORT_INSPECT`（只读、意图无关）产出记录级 diff → 用户按维度选模式 + 逐记录覆盖 → `IMPORT_APPLY` 作为**唯一写入者**，在**绑定预览版本号**上原子写入」。修复 F1–F4 四项缺陷，并以「量化删除提示 + 可选导出备份 + 风险确认」替代撤销。
>
> **Deliverables**（具体文件，详见 Work Objectives）:
> - `src/shared/export-package.ts`（新，独立传输 schema + 双向映射层，A14/D11/D13/D14）
> - `src/shared/import-diff.ts`（新，diff 计算 + 意图应用 + 匹配重合检测，A12/D8/D10）
> - `src/background/import-export-service.ts`（重写，三动作：`EXPORT_PACKAGE`/`IMPORT_INSPECT`/`IMPORT_APPLY`，A11/C4/D15）
> - `src/background/storage-repository.ts`（扩展：配方持久化 + **原样上送配方（不渲染）** + 清空图标槽 + `textColor`）
> - `src/shared/messages.ts` + `src/shared/types.ts`（协议重构 + `IconSource.textColor` + 包类型）
> - `src/background/worker-orchestrator.ts`（路由 + `KNOWN_ACTIONS` 同提交 + F4 版本号）
> - `src/ui/settings/App.tsx`（`ImportExportSection` 演化为**导入** diff 表 + 确认弹窗；并在同文件内**新建独立导出 section**（维度勾选 + 记录展开 + 包摘要）—— **Q2=B-2**，不新增 HTML 页面与构建入口）
> - `src/ui/import-preview/App.tsx`（`ImportPreviewTable` **演进而非重写**；**配方渲染落点 = UI 侧**，在展示处调用 `renderIconToDataUri` 产 **PNG**）
> - `src/ui/shared/icon-field-editor.tsx` / `rule-form-submit.ts` / `sidebar/App.tsx`（配方持久化写入路径 3 处）
> - `src/adapters/contract.ts` + `chrome-adapter.ts`（Firefox `commands.update()` + Chrome/Edge 差异报告）
> - `src/adapters/mock-adapter.ts`（**测试基建：定向/持久失败注入**，补偿路径测试的硬前提）
> - 测试：包往返保真 / 映射层 / 校验 / diff / 意图应用 / 重合检测 / 补偿路径（注入失败）/ 协议断言迁移
>
> **Estimated Effort**: **XL（5+ 天）** — **23 个实现任务（T0–T22）+ 4 个终审（F1–F4）**
> **Parallel Execution**: YES — 5 Waves（Wave 4 内含 4a/4b 两个串行段）+ FINAL
> **Critical Path**（**唯一权威**，全计划仅此一条）: `T2 → T8 → T10 → T14 → T17 → T18 → T21 → F1–F4 → user okay`
> （`T0/T1/T3/T4/T5/T6/T20` 为该链上的**并列前置**，可并行完成、不延长链路；`T11/T12/T13/T15/T16/T19/T22` 不在链上。）
> **关键风险**: 跨存储区无事务（补偿路径）+ canvas 在 jsdom 不可用 + 协议重构回归面 + **已裁定消解**：配方渲染落点 = **UI 侧 PNG**（background 无 canvas、SVG 被安全闸门拒 → 不再让 background 渲染，见 Q1=A）

---

## Context

### Original Request

由用户（主 Agent）交付一份**可执行工作计划**，输入为已四层收敛（0 OPEN）且用户已终审通过的设计：

- **核心约束（一句话）**：包内不搬运字节（只带 Icon URL / 裸 `local-icon:` 引用 / 可复现图标配方）；导入要么全成要么零改动，由服务端依「文件 + 显式意图」重新推导，`IMPORT_APPLY` 复用 `IMPORT_INSPECT` 读到的那一份字符串（构造性无漂移）；**不提供撤销**，破坏性导入以「量化提示 + 可选导出备份 + 风险确认」替代；域违规跳过该记录并醒目披露，不因一条坏记录毁掉整次导入。
- **取向（用户指定）**：TDD（RED→GREEN→REFACTOR，偏好先产出失败测试）；YAGNI（不重新引入已剔除项）；维度范围锁定 4 个；**不提供旧导出文件兼容**（不计划迁移逻辑）。
- **计划硬要求**：任务含 ID / 目标 / 涉及文件（路径 + 行号）/ 依赖 / 验收判据 / RED 可构造性；Wave 分组 + 关键路径；风险与缓解；分阶段交付顺序；开放问题；**不得修改设计文档、不得修改 `src/`**（规划者只产出计划）。

### Interview Summary

本会话**无访谈阶段**——用户已在 design 阶段完成 44 项裁决且明确指定取向（TDD / YAGNI / 不背兼容 / 4 维度锁定）。规划者职责收敛为 **D-d（测试分层与 RED 可构造性）** 与 **执行可构造性核实**。

**Key Decisions（继承自设计，不再重开）**:

| 决策 | 内容 |
|---|---|
| G1 / G5-refined | B+C 并做、不背兼容；导入边界＝**每维度一个增量/覆盖模式**（默认增量） |
| C1 / C2 / C9 | 包内禁位图；导出**解引用 + 裸发** `local-icon:`；缺失由消费方判定 |
| C3 / C4 / F4 | 严格原子 + 服务端权威 + **绑定预览版本号**（修 F4） |
| C10 | 替换记录**同步清空其图标存储槽**（作用域严格 / 原子 / 补偿） |
| A2 / A3 / A4 | 未携带维度**不给选择器**；三态由 JSON 表达；逐维默认 + 逐记录覆盖 |
| A8 / A9 | **不实现撤销**；替代＝量化 + 导出备份按钮 + 风险确认按钮（并列，非前置） |
| A11 / A14 / D12 | 三动作；独立传输 schema + 双向映射；APPLY **复用同一份字符串** |
| D3 / D4 / D5 | `strategy` 唯一归策略维度；统一 schema 按平台降级；**4 维度锁定** |
| D7 / D8 / D10 | 恒定确认弹窗（量化删除）；双侧默认覆盖；匹配重合恒定提示（定义＝Match URL + Match Type 一致） |
| D14 / D15 | 严格字段集合 + 域约束（`slot.id ∈ 1..10` 等）；域违规**跳过 + 醒目披露** |

### Research Findings（规划期实读源码核实，非引用设计）

| # | 实测事实 | 证据（文件:行） | 对计划的影响 |
|---|---|---|---|
| 1 | `commitImport` 无条件 `state.rules = preview.rules` | `import-export-service.ts:210` | F2 根因；T8/T9 重写 |
| 2 | 导出把非 URL 图标包成 `[local:${value}]` | `import-export-service.ts:49` | F3 根因（首尾均不匹配 `startsWith('local-icon:')`）；T5 修 |
| 3 | 图标解析仅认 `startsWith('local-icon:')` | `storage-repository.ts:68,416`（`ICON_REF_PREFIX`） | 带包装引用**永远解析不了**；T5/T6 |
| 4 | 引用键由记录 id 派生 | `storage-repository.ts:387`(`icon:${rule.id}`) / `:400`(`icon:slot-${slot.id}`) | slot id 恒 1..10 → 目标机"假成功"碰撞；T11 清空槽 |
| 5 | `getSyncState` 每次读取都 `resolveIconReferences` | `storage-repository.ts:226,410` | 导出拿到的是**已解引用 data URI** → 必须重新识别转回引用；T4 |
| 6 | `iconResolutionCache` 已存在（miss 记 `null`，local 写入即 `clear()`） | `storage-repository.ts:123,207,454-473` | **Q1=A 后**该缓存**只服务 `local-icon:` 引用解引用**（background 不渲染配方）→ 不变；UI 侧渲染 memo 由 T12 另建 |
| 7 | `findUnsafeRegex` 失败 → **拒绝整包**，且有测试断言 | `import-export-service.ts:122,184` / `tests/integration/import-export-service.test.ts:34-83` | D15 要求放宽为"跳过该记录"；T3 + 测试迁移 |
| 8 | UI 发 `IMPORT_COMMIT` **不带** `configVersion` | `settings/App.tsx:2073` | F4 根因；T17 |
| 9 | 后端 `?? this.repo.getConfigVersion()` | `worker-orchestrator.ts:756` | 乐观锁**必然通过**；T17 |
| 10 | `KNOWN_ACTIONS` 为**手写白名单**（含 `EXPORT_CONFIG`/`IMPORT_PREVIEW`/`IMPORT_COMMIT`） | `worker-orchestrator.ts:45-94`（`:73-75`） | 协议重构必须与联合类型**同提交**清理（防"编译过、运行被拒"）；T14 |
| 11 | 适配器 `commands` **只有** `getAll`/`onCommand`/`removeCommandListener` | `contract.ts:82-86`、`chrome-adapter.ts:54-71` | Firefox `commands.update()` 需新增能力；T15 |
| 12 | `ImportPreviewTable` 完整存在但**全仓无引用**（仅 `import-preview/main.tsx` 独立页 + vite 入口） | `src/ui/import-preview/App.tsx:26`、`vite.config.ts:36`、`main.tsx:3` | F1；T18 **演进**复用 |
| 13 | `IconSource` 有 `backgroundColor?`/`text?`，**无 `textColor?`**，且 `type:'template'` **从未被产出** | `types.ts:55-65`（对照 `IconEditor.tsx:17-22` 有 `textColor`） | T2 扩展 schema |
| 14 | 配方随写随丢：3 处写入路径一律先 `renderIconToDataUri` 再写 `{type:'upload'}` | `sidebar/App.tsx:933`、`rule-form-submit.ts:80`、`settings/App.tsx:1656` | T7 建配方持久化写入路径 |
| 15 | `renderIconToDataUri` 用 **canvas**（默认 `image/png`），jsdom 不可用 | `IconEditor.tsx:66-105`（`document.createElement('canvas')`） | **UI 侧**渲染（Q1=A）在 jsdom 不可用 → T12 用**渲染器桩**断言调用；不可在 jsdom 断言像素（真浏览器归 F3 浏览器 skill） |
| 16 | background `generateTemplateIcon` 产出 **SVG** data URI | `icon-service.ts:354-360`（`<svg …>`） | **与 #17 冲突** → 见 §Design Contradictions G-A |
| 17 | `isSafeFaviconProtocol` **拒绝** `data:image/svg+xml`，只放行 bitmap 子类型 | `url-utils.ts:610,628-634`（`SAFE_DATA_IMAGE_SUBTYPES`） | 配方若在 background 渲染为 SVG → **被闸门丢弃** |
| 18 | `resolveForDisplay` 的 `template` 分支已调 `generateTemplateIcon` | `icon-service.ts:404-406` | 现有模板路径**已带此隐患**（产 SVG）；**已裁定（Q1=A）**：background **不得**渲染配方，`type:'template'` **原样上送 UI**，渲染落点 = **UI 侧**（T12） |
| 19 | mock-adapter 失败注入仅**一次性 `nextError`**，无 area/key 定向 | `mock-adapter.ts:27-32,99-105` | **无法构造"仅 sync 写失败"** → 补偿路径不可测；T0 建基建 |
| 20 | `writeSync` 内部**先写 local**（`offloadLargeIcons`）**再写 sync**（`setSyncWithRetry`：含 1 次重试 + fallback local） | `storage-repository.ts:277-284,301-330` | 补偿设计的精确锚点；T0/T11 |

**External Research**: 无（设计 C8/不新增依赖；无外部库引入）。Firefox `commands.update()` 签名以 MDN 为准（T15 References）。

### Pre-Planning Review（内联 Metis 缺口分析）

> **Intent Classification**: `Mid-sized Task` / 置信度 high —— 有边界的功能迭代（修 4 缺陷 + 协议重构），边界已由设计四层锁定，非绿地、非纯重构。
> **AI-Slop 扫描**: 检测到 `Scope Inflation` 与 `Premature Abstraction` 两类信号（"导出备份"可能被扩成通用备份系统；映射层可能被抽象成通用序列化框架），已注入 Guardrails 抑制。

**Identified Gaps（addressed）**:

| # | Gap | 处置 |
|---|---|---|
| G-A | **[已裁定 Q1=A] 配方渲染落点 = UI 侧**：background（MV3）**无 canvas**，`generateTemplateIcon` 只产 SVG（被闸门拒）。~~默认裁决 D-1（存储层读取时由 UI 注入渲染器渲染）~~ **已作废**。 | **用户裁定 Q1=A（2026-10-05）**：配方**只持久化在存储层**；`getSyncState` 对 `type:'template'` **原样上送**（不渲染、不产 SVG）；渲染由 **UI 侧**（sidebar / settings / import-preview）在**展示处**调用 `renderIconToDataUri` 产出 **PNG**。**否决** B 方案（background PNG 编码 — 触碰 guardrail「不新增依赖与权限」）。落地见 T12。 |
| G-B | **补偿路径当前不可构造**（mock-adapter 无定向失败） | **T0（Wave 1）** 新增测试基建：`failNextStorageSet(area, key?)` 定向失败 + `failStorageSet(area, key)` 持久失败 + `nextError` 保留。**解除 T11/T16 阻塞。** |
| G-C | **D-d 测试分层与 RED 可构造性**（设计显式移交） | 每任务携带「RED 可构造性说明」；canvas 相关（T7/T13）标注"仅打桩断言 + 真实浏览器手工"；T21 收口既有测试锚点迁移 |
| G-D | **协议重构回归面**（`KNOWN_ACTIONS` 手写白名单） | T14 强制「messages.ts 联合类型 + KNOWN_ACTIONS + message-client + 测试」**同提交**；F4 反例搜索守卫 |
| G-E | **F2 修复的测试缺口**：既有测试**未断言**"merge 模式不丢规则"（正是 F2） | T9 新增**保真单测**：`keep existing` 路径下目标机规则数组**逐条不变**（§G4-A 判据） |
| G-F | **三处配方写入路径分散**（`sidebar:933` / `rule-form-submit:80` / `settings:1656`） | T7 抽为**单一转换函数**（`iconConfigToIconSource`）在 `@ui/shared`，三处调用；防三份手抄漂移 |

**Guardrails Recommended**:

1. **不新增 permission / host_permission / command / npm 依赖**（C8/G1）——F1 终审核对 `manifests/*.json` 与 `package.json` diff。
2. **包内禁任何原始位图**（C1）——禁止导出路径出现 `data:` bitmap；F4 反例搜索 `rg "data:image" src/background/import-export-service.ts` → 0。
3. **不实现导入撤销**（A8）——禁止新增快照/`pendingUndo` 用于导入；`pendingUndo` 仅保留槽位覆盖语义。
4. **4 维度锁定**（D5）——禁止增删维度；F4 反例搜索包字段集合。
5. **协议清理同提交**（G-D）——禁止 `EXPORT_CONFIG`/`IMPORT_PREVIEW`/`IMPORT_COMMIT` 残留（编译过≠运行可用）。
6. **不修改设计文档**（本计划只读设计层）；**不修改 `src/`**（规划者职责边界）。
7. **不背兼容**（G1）——禁止任何 legacy 判别 / 静默纠正 / 迁移逻辑。

**Defaults Applied（计划层默认 — D-1/D-2 已被用户裁定覆盖，保留以存档裁前状态）**:

| # | 裁前默认 | 现状 |
|---|---|---|
| ~~D-1~~ | ~~配方渲染在 UI 侧：存储层只持久化配方；链路读到配方时经**注入的 PNG 渲染器**渲染（UI 提供 `renderIconToDataUri`，background 用缓存/占位）。~~ | **已作废 → 由 Q1=A 取代（2026-10-05）**。裁定内容：配方**只持久化**；`getSyncState` **原样上送** `type:'template'`（background **不渲染**、**不注入渲染器**、**不产 SVG**）；渲染落点 = **UI 侧展示处**（`renderIconToDataUri` 产 PNG）。背景：background 无 canvas（G-A）且 SVG 被闸门拒（#17）。否决 B 方案（触碰 guardrail「不新增依赖与权限」）。落地见 T12。 |
| ~~D-2~~ | ~~`EXPORT_PACKAGE` 复用 `EXPORT_CONFIG` 的下载 UI（不新增导出面板）~~ | **已作废 → 由 Q2=B-2 取代（2026-10-05）**。裁定内容：仅在 `src/ui/settings/App.tsx` 内**新建独立导出 section**（维度勾选 + 记录展开 + 包摘要），**不新增** HTML 页面与构建入口；**不复用**现有下载 UI。理由：既有设计权威定「设置页左侧固定导航」的 5 个分区已含"导入导出"，导出天然属于该分区；且仓库既有 `import-preview` 独立页正是"建了但全仓无引用"的孤儿（F1），再建同类页面有重蹈风险。落地见 T19。**口径确认：B-1/B-2 已由用户裁定为 B-2（2026-10-05）**。 |
| D-3 | **Wave 3 为 7 任务、Wave 4 拆 4a/4b**（Wave 4a=2、4b=2、Wave 5=2 低于 5-8） | 集成波天然较小（依赖多个上游），符合并行化规则例外。 |

---

## Work Objectives

### Core Objective

让导入/导出成为**可解释、可保真**的可携带包流程：导出按 4 维度产出、图标只带可复现信息；导入由 `IMPORT_INSPECT` 产出记录级 diff，用户按维度显式选模式，`IMPORT_APPLY` 作为唯一写入者在绑定版本号上原子写入（失败零改动 + 补偿回滚），域违规与缺失图标一律"跳过/占位 + 醒目披露"。

### Concrete Deliverables

- [ ] `src/shared/export-package.ts` — 独立传输 schema + 双向映射层（`SyncState ⇄ Package`）+ 包校验（A14/D11/D14）
- [ ] `src/shared/import-diff.ts` — diff 计算 + 意图应用 + 匹配重合检测（A12/D8/D10）
- [ ] `src/background/import-export-service.ts` — 三动作 + 服务端重算 + 版本绑定 + 域违规跳过（A11/C3/C4/D15）
- [ ] `src/background/storage-repository.ts` — 配方持久化 + **原样上送配方（不渲染、不产 SVG）** + 清空图标槽（原子/补偿）+ `textColor`
- [ ] `src/shared/types.ts` — `IconSource.textColor` + 包类型 + `ImportIntent`；**删** `ExportPayload`/旧 `ImportPreview`/`ImportSlotConflict`
- [ ] `src/shared/messages.ts` — 三动作契约（**删** `EXPORT_CONFIG`/`IMPORT_PREVIEW`/`IMPORT_COMMIT`）
- [ ] `src/background/worker-orchestrator.ts` — 路由 + `KNOWN_ACTIONS` 同提交 + F4 版本号
- [ ] `src/adapters/contract.ts` + `chrome-adapter.ts` — Firefox `commands.update()` + Chrome/Edge 差异报告
- [ ] `src/adapters/mock-adapter.ts` — 定向/持久失败注入（测试基建）
- [ ] `src/ui/settings/App.tsx` — **导入** diff 表 + 维度模式 + 恒定量化确认弹窗；并在同文件内**新建独立导出 section**（维度勾选 + 记录展开 + 包摘要，**Q2=B-2**，不新增 HTML 页面与构建入口）
- [ ] `src/ui/import-preview/App.tsx` — `ImportPreviewTable` 演进（维度分组 + 字段级展开 + **UI 侧配方渲染为 PNG**）
- [ ] `src/ui/shared/icon-source.ts`（新）— `iconConfigToIconSource` 单一转换（T7）
- [ ] `src/ui/sidebar/App.tsx` / `src/ui/shared/rule-form-submit.ts` / `src/ui/shared/icon-field-editor.tsx` — 配方持久化写入路径

### Definition of Done

- [ ] `npm run typecheck` → **0 error**
- [ ] `npm run lint` → **delta-0**（基线错误数不变；不放宽 `eslint.config.mjs`）
- [ ] `npm run test:unit` → ALL PASS；`npm run test:integration` → ALL PASS；`npm run test:ui-smoke` → ALL PASS
- [ ] `npm run build:chrome && npm run build:edge && npm run build:firefox` → 三浏览器均成功
- [ ] 反例搜索无命中：`rg "EXPORT_CONFIG|IMPORT_PREVIEW|IMPORT_COMMIT" src/` → 0
- [ ] 反例搜索无命中：`rg "\[local:" src/` → 0（包装已移除）
- [ ] 反例搜索无命中：`rg "data:image/(png|jpeg|webp)" src/background/import-export-service.ts` → 0（包内禁位图）
- [ ] 反例搜索无命中：`rg "renderIconToDataUri" src/background/` → 0（**Q1=A**：渲染只在 UI 侧；background 不注入渲染器、不调 canvas）
- [ ] 断言 background 对 `type:'template'` **原样上送**（T12 测试：`getSyncState()` 返回配方对象形状不变，且**不新增**配方渲染）
      ⚠️ **注**：`getPlaceholder()`（`icon-service.ts:386`）**本就产** `data:image/svg+xml`（静态灰底 "?"，既有代码）→ **不可**用"background 内 `svg+xml` → 0"作反例（会误报既有占位符）；约束只针对"**配方渲染**"。原因见 §T12 与"新发现自洽问题"。
- [ ] **settings 页内存在独立导出 section**（含维度勾选 + 记录展开 + 包摘要）；**反例搜索**：`rg "export-panel" .` → 0（不得新增页面与入口）；`vite.config.ts` 入口数仍为 **7**（**Q2=B-2**）
- [ ] 保真测试证明：`keep existing` 路径下目标机 `rules` 数组逐条不变（T9）
- [ ] 补偿测试证明：注入 sync 写失败 → local 图标键**恢复原值**、`configVersion` **不变**（T16）

### Must Have

- [ ] 三动作协议：`EXPORT_PACKAGE(scope)` / `IMPORT_INSPECT(file)` / `IMPORT_APPLY(file, intent)`；仅 APPLY 写入（A11）
- [ ] 独立传输 schema + 双向映射层，**不镜像 `SyncState`**（A14）；`configVersion` 不进包（D5）
- [ ] 导出解引用 + **裸发** `local-icon:`（C2）；URL 直接导出 URL
- [ ] 配方（背景色/文本/文本色）持久化并可复现渲染；**渲染落点 = UI 侧（产 PNG）**，background **原样上送**（C1/A6，**Q1=A**）
- [ ] **独立导出 section**（位于 `settings/App.tsx`，含维度勾选 + 记录展开 + 包摘要），不复用旧下载 UI（**Q2=B-2**）
- [ ] 缺失图标由**消费方**判定（引用不可解析 ⇒ 缺失 ⇒ 占位）（C9-②）
- [ ] 替换记录时**清空其图标存储槽**（作用域严格 / 原子 / 补偿）（C10）
- [ ] `IMPORT_APPLY` **复用 `IMPORT_INSPECT` 同一份字符串**（D12），无重读、无指纹
- [ ] `IMPORT_APPLY` **绑定预览时确定的版本号**（C3/F4）
- [ ] 逐维度模式（默认增量）+ 逐记录覆盖 + 组标题批量（A1/A4/D8）
- [ ] 未携带维度**不给选择器**（A2）；三态由 JSON 表达（A3）
- [ ] 域违规**跳过 + 醒目披露**（单独归类"因不安全被跳过"）（D15）
- [ ] 恒定确认弹窗 + 量化删除 + 「导出备份」+「我了解风险」（并列，非前置）（D7/A9）
- [ ] 匹配重合恒定提示（定义＝Match URL + Match Type 一致）（D10）
- [ ] Firefox `commands.update()`；Chrome/Edge 差异报告 + 引导手动设置，该维度**不提供覆盖模式**（D4）

### Must NOT Have (Guardrails)

- [ ] **不实现导入撤销**（A8）——无快照、无 `pendingUndo` 用于导入、无 C5/C6/C7 遗留
- [ ] **包内禁原始位图**（C1）——无 `data:` bitmap、无体积开关、无 `MAX_OUTPUT_SIZE` 偿还
- [ ] **不提供 manifest 清单**（A1）、**不提供 `EXPORT_DESCRIBE` 第四动作**（A11/YAGNI）、**不做强制备份**（A9）
- [ ] **不做旧导出文件兼容 / 迁移**（G1）——无 legacy 判别、无静默纠正
- [ ] **不增删维度**（D5）——恰为槽位/规则/策略/快捷键
- [ ] **不把 `preview` 由 UI 回传作为权威**（C4）——UI 只传意图
- [ ] **不新增 permission / npm 依赖**（C8/G1）——**Q1=A 明令否决**"background PNG 编码"（会触碰本 guardrail）
- [ ] **不在 background 渲染配方**（**Q1=A**）——`src/background/` 内不得出现 `renderIconToDataUri`；`type:'template'` 不得被 background 渲染（`generateTemplateIcon` 的 SVG 路径不得服务于配方；`getPlaceholder()` 静态占位不受此限）
- [ ] **不修改设计文档**、**不修改与本计划无关的 `src/` 模块**
- [ ] **不引入通用序列化框架**（防 premature abstraction）——映射层只服务本包 schema

---

## Risk & Mitigation

> 用户明确要求的三项重点风险（跨存储补偿 / canvas 渲染 / 协议重构回归面）+ 规划期新发现风险，逐条给出严重度、触发条件与缓解。

| # | 风险 | 严重度 | 触发条件 | 缓解措施（落到任务） |
|---|---|---|---|---|
| **RK-1** | **跨存储区无事务 → "零改动"不成立**（补偿期间 service worker 被挂起，留下不一致窗口） | **高** | `storage.sync` 写失败 / MV3 worker 挂起于补偿之间 | T0 建**定向失败注入**（唯一硬前提）；T11 实现"快照→清 local→写 sync→失败即回滚 local"；T16 覆盖**三种失败形态**（瞬态重试 / 持久失败 / 配额）并断言不变式（`configVersion` 不变 + `syncState` 全等 + local 图标键恢复）。**残余风险如实记录**：补偿窗口内挂起仍可能不一致——设计 §3.6 明示此为技术现实，非本计划可消除，接受之。 |
| **RK-2** | **canvas 在 jsdom 不可用 → 配方渲染无自动化断言** | **高** | 任何依赖 `renderIconToDataUri` 的路径在单测中调用 | T7 只断言**转换函数**输出（不打桩 canvas）；T12 断言"**background 原样上送配方**（不渲染）"+ "**UI 侧渲染路径调用 `renderIconToDataUri` 产出 PNG**"（jsdom 下用**渲染器桩**），**不得**在 jsdom 断言 canvas 像素（会假绿）；真实浏览器像素验证交由 F3（**浏览器 skill 自动化**）。 |
| **RK-3** | **协议重构回归面**（牵动 4 处 + `KNOWN_ACTIONS` 手写白名单） | **高** | 只改联合类型而漏改白名单 → "编译过、运行被拒" | T14 强制**同提交**（messages + types + KNOWN_ACTIONS + message-client + 测试）；QA 断言"白名单与联合类型无差集"；F1 反例搜索 `EXPORT_CONFIG\|IMPORT_PREVIEW\|IMPORT_COMMIT` → 0。 |
| **RK-4** | **[新发现] background 无 canvas 且 SVG 被安全闸门拒** → 配方渲染落点 | **高 → 已消解** | `generateTemplateIcon` 产 SVG（`icon-service.ts:354`）+ `isSafeFaviconProtocol` 拒 `svg+xml`（`url-utils.ts:628`） | **用户已裁定 Q1=A（2026-10-05）**：存储层**只持久化配方**，`getSyncState` **原样上送** `type:'template'`（background **不渲染**）；渲染落点 = **UI 侧**（sidebar / settings / import-preview 展示处调用 `renderIconToDataUri` 产 **PNG**）。T12 断言"background 对 `type:'template'` 原样上送、不调 `renderIconToDataUri`"；DoD 反例搜索 `renderIconToDataUri` 于 `src/background/` → 0（⚠️ **不**用 `svg+xml` 作反例——`getPlaceholder()` 本就产它）。**B 方案（background PNG 编码）已被否决**（触碰 guardrail「不新增依赖与权限」）。 |
| **RK-5** | **F2 修复无测试证明**（既有测试未覆盖"merge 不丢规则"） | **中** | 修复后无回归守卫 | T9 新增**保真单测**（`keep existing` 路径 `rules` 逐条深比较），**先写必失败**（现网 `:210` 无条件替换）→ 事实上的 RED 证据。 |
| **RK-6** | **三处配方写入路径手抄漂移** | **中** | `sidebar:933` / `rule-form-submit:80` / `settings:1656` 各自维护转换 | T7 抽为**单一** `iconConfigToIconSource`，三处调用；F2 审查新增重复实现。 |
| **RK-7** | **"假成功"解析**（引用键碰撞 → 静默显示目标机自己的图标） | **中** | 目标机恰有同 id 记录且图标已转存 | T11 清空被替换记录的图标槽（"假成功"比破图更糟：用户不会去重选）；QA 断言 `icon:slot-N` 被删除。 |
| **RK-8** | **匹配重合漏报**（规则 id 随机 → 增量下同时保留两边） | **中** | 跨机导入 + 增量模式 | T8 实现"对最终状态的纯函数"重合检测（D10 定义）；T22 恒定提示；边界有意收窄（语义重合不覆盖），已在 QA 明确负例。 |
| **RK-9** | **T18/T19 同波改同文件**（均改 `src/ui/settings/App.tsx`） | **中（保留串行）** | 同波并发编辑 | **Q2=B-2 落地后**：T18 与 T19 **同改** `src/ui/settings/App.tsx`（T18=导入区，T19=导出 section）→ 保留**串行落地**顺序 **T18 → T19**（同属 4b，串行执行），避免同文件并发编辑。 |
| **RK-10** | **UI 测试 project 归属**（jsdom vs 真实浏览器） | **低** | 把 canvas 相关断言放进 `ui-smoke` | 明确分工：`ui-smoke` 走 jsdom（**结构/文案**断言）；真实浏览器验证只在 F3（**浏览器 skill 自动化**）。**不得**在 jsdom 场景命名/标注 `.png` 证据。 |

**风险登记总结**：RK-1/RK-2 为**高**且均已有明确落点；RK-4 已由用户裁定 **Q1=A** **消解**（不再是未裁决风险）；无未缓解的高风险项。RK-1 的残余不一致窗口为**设计已接受的技术现实**（非计划缺陷）。

---

## Open Questions（需用户裁决或补充信息）

> 本计划为 0 项设计层 OPEN 的产物；以下 2 项**均已被用户裁定**，**无未决项**。保留原文以存档裁前状态（裁定时间 2026-10-05，裁定发生在计划生成之后）。

**Q1 [✅ 已裁定 = A（2026-10-05）— 影响 T12/T13]：配方渲染落点**
- **背景**（裁前记录）：设计 §1.2 称"既有测试是打桩的"，但未裁定配方**在哪里**渲染。规划期实读发现：background（MV3 service worker）**无 canvas**，其 `generateTemplateIcon` 只产 **SVG** data URI（`icon-service.ts:354-360`），而 `isSafeFaviconProtocol` **明确拒绝** `data:image/svg+xml`（`url-utils.ts:610,628-634`）。
- **裁定（用户）**：**选 (A)** —— 配方渲染落在 **UI 侧**，`renderIconToDataUri` 产出 **PNG**；background 侧将配方**原样传给 UI**（**不渲染**）。**不采用** (B)"background PNG 编码"（触碰既有 guardrail「不新增依赖与权限」）。
- **据此作废**：裁前默认裁决 **D-1**（"存储层读取时由 UI 注入的 PNG 渲染器渲染"）——其措辞把渲染点指向 background 读路径，与裁定冲突；已被取代。
- **设计文档已同步更正**（同一裁定落地于三处设计制品）：`…-architecture-package-protocol-design.md` 的 A6 条目（「⚠️ 渲染落点更正（2026-10-05）」段）、`…-design.md` §2.4 引用块、`…-decisions.yaml` 的 `A6-recipe-value-model.revisions`。
- **落地**：T12（重写为"background 原样上送 + UI 侧渲染产 PNG"）；T13（`textColor` 贯通）。

**Q2 [✅ 已裁定 = B-2（2026-10-05）— 影响 T19]：`EXPORT_PACKAGE(scope)` 的 UI 形态**
- **背景**（裁前记录）：默认裁决 D-2 采用"复用现有下载 UI（Blob + 文件名），不新增独立导出面板"。
- **裁定（用户）**：**选 (B)** —— **新建独立导出面板**，**不复用**现有下载 UI。**据此作废 D-2**。
- **口径确认（用户裁定，2026-10-05）**：裁定为 **B-2** —— 独立导出面板 = **仅在 `src/ui/settings/App.tsx` 内新建独立导出 section**（带**维度勾选 + 记录展开 + 包摘要**的完整体验面），**不新增 HTML 页面、不新增构建入口**。
  - **理由**：既有设计权威定「设置页左侧固定导航」的 5 个分区**已含"导入导出"**（`_context-output/designs/2026-07-14-tab-bookmark-shortcuts-ui-ux-design.md:150-156`），导出天然属于该分区；且仓库已有的 `import-preview` 独立页正是"建了但全仓无引用"的孤儿（本计划的 F1），再建同类页面有重蹈风险。
  - **保留不变**：仍然**不复用**现有"一个按钮 + 直接下载"的旧导出 UI（Q2=B 相对 Q2=A 的实质差异）；仍须包含维度勾选、记录展开、包摘要与先展示后下载的流程。
  - **据此回退 T19**：不再新建 `src/ui/export-panel/`、不再改 `vite.config.ts`；T19 的 Files 收敛为 `src/ui/settings/App.tsx`（及必要的 `src/ui/styles/settings.css`）。**其余任务与判据不受影响。**

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.
> Acceptance criteria requiring "user manually tests/confirms" are FORBIDDEN.

### Test Decision

- **Infrastructure exists**: YES（Vitest 2，三层 `unit` / `integration` / `ui-smoke`，基线 `120 suites / 1025 tests` 全通过）
- **Automated tests**: **TDD**（用户明确取向）——每个任务 `RED（失败测试）→ GREEN（最小实现）→ REFACTOR`
- **Framework**: Vitest 2（`vitest.workspace.ts` 三 project）+ `@testing-library/react`（UI）
- **命令**: `npm run test:unit` / `npm run test:integration` / `npm run test:ui-smoke`
- **RED 可构造性**：每任务显式说明"先写什么失败测试、如何断言它失败"；canvas 依赖任务（T7/T12/T13）标注"**jsdom 打桩断言** + **浏览器 skill 自动化**佐证（F3）"

### QA Policy

Every task MUST include agent-executed QA scenarios. Evidence saved to `_context-output/evidence/task-{N}-{scenario-slug}.{ext}`.

> **验证口径（统一，消除"手工"歧义）**：所有验证均为 **agent 自动化**，共两类 ——
> 1. **`ui-smoke`（jsdom）结构断言**：`@testing-library/react` 断言 DOM 结构 + 文案（**不含** canvas 像素；证据为 `.txt`，**不得**命名 `.png`）；
> 2. **浏览器 skill 自动化**（`agent-browser` / `playwright-cli`）用于真实浏览器场景（canvas 配方渲染、真实 JSON 下载/上传）—— 由 **F3** 统一执行，证据可为 `.png`。
>
> **注意**：仓库 `package.json` **无 Playwright 依赖** → 任务级 QA 一律走 `ui-smoke`(jsdom) 或 vitest；**真实浏览器仅经浏览器 skill（F3）**，不得在任务内标注 `手工 Playwright`。

- **Bookmark/Library（BG service/映射/校验/diff）**: Bash（`npx vitest run <file> -t "<name>"`）—— 断言输入输出
- **UI（settings〔含导出 section〕/ import-preview）**: `test:ui-smoke`（jsdom 结构 + 文案断言）；**真实浏览器**（canvas / 真实下载）→ 浏览器 skill 自动化（F3）
- **Adapter（commands.update 差异）**: Bash（`npx vitest run tests/**/adapter* -t "<name>"`）
- **跨存储补偿**: Bash（`npx vitest run tests/integration -t "<name>"`，含注入失败）

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1（Start Immediately — 共享契约 + 测试基建）:
├── T0: mock-adapter 定向/持久失败注入（B2 硬前提）        [quick]
├── T1: 传输 schema + 双向映射层（export-package.ts）       [deep]
├── T2: IconSource 扩展（textColor）+ 包/意图类型          [quick]
├── T3: findUnsafeRegex 语义放宽 + 域约束校验器             [deep]
└── T4: 图标引用识别/解引用纯函数（导出侧）                [quick]

Wave 2（After Wave 1 — 核心逻辑，MAX PARALLEL）:
├── T5:  导出侧图标改写（URL / 裸引用 / 配方）             [deep]
├── T6:  消费方"引用不可解析 ⇒ 缺失"判定 + 占位            [deep]
├── T7:  配方持久化写入路径（3 处收敛为 1 函数）           [deep]
├── T8:  diff 计算 + 意图应用 + 匹配重合检测（import-diff） [deep]
└── T12: 配方**原样上送**（存储层不渲染；渲染落点 = UI 侧，Q1=A）[deep]

Wave 3（After Wave 2 — 持久化 + 协议 + 适配层 + 预览组件，MAX PARALLEL）:
├── T9:  保真单测（keep existing 不丢规则）                [quick]
├── T10: 服务端重算 + 版本绑定（F4）                       [deep]
├── T11: 清空图标存储槽（作用域/原子/补偿）                 [deep]
├── T13: IconSource.textColor 持久化 + **UI 侧渲染**        [quick]
├── T14: 协议重构（messages/types/KNOWN_ACTIONS/同提交）    [deep]
├── T15: Firefox commands.update + Chrome/Edge 差异报告     [deep]
└── T20: ImportPreviewTable 演进（维度分组 + 字段展开）     [deep]

Wave 4a（After Wave 3 — 协议就绪后立即可跑）:
├── T16: 补偿路径集成测试（注入失败）                      [deep]
└── T17: 三动作接线（worker 路由 + message-client）         [deep]

Wave 4b（After Wave 4a — 依赖 T17 的消息封装）:
├── T18: 导入 UI（维度模式 + diff 表 + 确认弹窗）          [deep]
└── T19: 导出 UI（**独立导出 section**，Q2=B-2：`settings/App.tsx` 内新建，不新增页面/入口）[deep]

Wave 5（After Wave 4b — 端到端 + 收口）:
├── T21: 既有测试锚点迁移 + 端到端保真/补偿验证             [deep]
└── T22: 结果清单呈现（宽容/域违规/缺失/重合/快捷键引导）   [deep]

Wave FINAL（After ALL tasks — 4 parallel reviews, then user okay）:
├── F1: Plan Compliance Audit
├── F2: Code Quality Review
├── F3: Real Manual QA
└── F4: Scope Fidelity Check
→ Present results → Get explicit user okay

Critical Path（唯一权威）: T2 → T8 → T10 → T14 → T17 → T18 → T21 → F1-F4 → user okay
Parallel Speedup: ~70% faster than sequential
Max Concurrent: 7（Wave 3）
```

> **同波无依赖校验（逐项，声明须与实际依赖一致）**：
> - Wave 2：T5←T1/T4、T6←T2、T7←T2、T8←T2、T12←T2（**全部指向 Wave 1**）✓
> - Wave 3：T9←**T8**（Wave 2）✓；T10←T1/T8 ✓；T11←T0/T12 ✓；T13←T2/T12 ✓；T14←T1/T2/T3 ✓；T15←（无）✓；T20←T8 ✓
> - **Wave 4a**：T16←T0/T11（Wave 1/3）✓；T17←T14/T10/T5/T6（Wave 3/2）✓ —— **同波内 T16 与 T17 互不依赖** ✓
> - **Wave 4b**：T18←T8/**T17**/T20 ✓（T17 在 4a）；T19←T1/**T17** ✓（T17 在 4a）—— **同波内 T18 与 T19 互不依赖** ✓
> - Wave 5：T21←T16/T17/T18/T19/T20；T22←T18/T20/T15 ✓
> - ⚠️ **修正说明**：v1 曾把 `T17→T18/T19` 置于同波（Wave 4）内，违反"同波无依赖"；本版拆为 **4a→4b** 修复。
> **同文件串行提醒（弱化，保留一条）**：**Q2=B-2** 下 T18 与 T19 **同改** `src/ui/settings/App.tsx`（T18 改导入区；T19 在该文件内**替换旧导出 UI 为独立 section**）→ 保留**串行落地**顺序建议 **T18 → T19**（同属 4b，串行执行）；T19 不再依赖 `vite.config.ts`。

### Dependency Matrix

```
- T0:  No dependencies（Wave 1）
- T1:  No dependencies（Wave 1）
- T2:  No dependencies（Wave 1）
- T3:  No dependencies（Wave 1）
- T4:  No dependencies（Wave 1）
- T5:  depends on T1（映射层）, T4（引用识别）— Wave 2
- T6:  depends on T2（类型）— Wave 2
- T7:  depends on T2（textColor）— Wave 2
- T8:  depends on T2（意图类型）— Wave 2
- T12: depends on T2（配方承载）— Wave 2（**Q1=A**：background 原样上送，渲染落点 UI 侧）
- T9:  depends on **T8, T10**（diff 语义 + 服务端实现）— Wave 3
- T10: depends on T1（重算输入）, T8（diff）— Wave 3
- T11: depends on T0（失败注入）, T12（配方承载）— Wave 3
- T13: depends on T12（配方承载）, T2（textColor）— Wave 3
- T14: depends on T1, T2, T3（契约形状定稿）— Wave 3
- T15: No dependencies on T1-T14（独立适配层）— Wave 3
- T20: depends on T8（diff 形状）— Wave 3
- T16: depends on T0, T11（补偿实现）— **Wave 4a**
- T17: depends on T14（协议）, T10（服务端）, T5/T6（图标）— **Wave 4a**
- T18: depends on T8（diff 形状）, T17（消息）, T20（组件）— **Wave 4b**
- T19: depends on T1（包摘要）, T17（消息）— **Wave 4b**
- T21: depends on T16, T17, T18, T19, T20（全链路）— Wave 5
- T22: depends on T18, T20（清单 UI）— Wave 5
```

> **T9 的依赖变更（HIGH 3 修正）**：v1 仅登记 `T8`，但 T9 的 Acceptance 要求 `GREEN（T10 完成后）` → 实际隐含依赖 T10（其绿灯依赖 T10 实现，T9 自身 Must NOT 明确"不实现新逻辑"）。**本版显式登记 `Blocked By: T8, T10`**，并保持 T9 在 Wave 3 内、但**执行序上排在 T10 之后**（同波内串行：T10 → T9）。

### Agent Dispatch Summary

```
- Wave 1: 5 tasks — T0->quick, T1->deep, T2->quick, T3->deep, T4->quick
- Wave 2: 5 tasks — T5->deep, T6->deep, T7->deep, T8->deep, T12->deep
- Wave 3: 7 tasks — T9->quick（**须在 T10 后**）, T10->deep, T11->deep, T13->quick, T14->deep, T15->deep, T20->deep
- Wave 4a: 2 tasks — T16->deep, T17->deep
- Wave 4b: 2 tasks — T18->deep, T19->deep（**T18 先于 T19**）
- Wave 5: 2 tasks — T21->deep, T22->deep
- Wave FINAL: 4 tasks — F1->oracle, F2->unspecified-high, F3->unspecified-high, F4->deep
```

> Wave 3 含 7 任务（最大并发），其中 T9 需在 T10 之后串行；Wave 4a/4b/5 为集成波（低于 5-8，属并行化规则的自然例外）。

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: WHAT TO DO + QA SCENARIOS + References + Commit info.
> **A task WITHOUT QA Scenarios is INCOMPLETE. No exceptions.**

- [x] **T0. mock-adapter 定向/持久存储失败注入（测试基建 — 补偿路径唯一硬前提）**

  **What to do**:
  - 在 `MockAdapterState` 增加 `failStorageSet?: { area: StorageArea; key?: string; remaining?: number }`（`remaining` undefined = 持久失败；数字 = 剩余失败次数）
  - 在 `storage.set`（`mock-adapter.ts:351-361`）入口按 `area`（可加 `key` 过滤）判定：命中则递减/清除并抛 `AdapterError('BROWSER_API_ERROR', 'Injected storage.set failure')`；**在写入与 `onChanged` 广播之前抛出**（保证失败不产生任何状态变更）
  - 新增便捷方法：`failNextStorageSet(area, key?)`（count=1）、`failStorageSet(area, key)`（持久）、`clearStorageFailures()`；`reset()` 一并清空
  - **RED 测试**（先写）：`tests/unit/adapters/mock-adapter-failure.test.ts`
    - `failNextStorageSet('sync')` → 首次 `storage.set('sync', …)` reject，第二次成功
    - `failStorageSet('local','icon:slot-3')` → 对 `icon:slot-3` 的写持久失败，对其它 key 正常
    - 失败注入下 `state.syncStorage`/`state.localStorage` **未被污染**，`onChanged` **未广播**
  - **不得**修改既有 `nextError` 语义（保留一次性全局失败）；新机制与之正交

  **Must NOT do**:
  - 不给生产适配器（`chrome-adapter.ts`）加失败注入
  - 不改变 `storage.set` 成功路径的调用日志契约（`logCall` 仍记录）

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: 单文件测试基建，范围清晰，无架构判断
  - **Skills**: [`sw-tdd-agent`] — 需 RED→GREEN 循环与断言风格对齐
  - **Skills Evaluated but Omitted**: `sw-systematic-debugging`（无既有 bug 待查）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 1（with T1–T4）
  - **Blocks**: T11, T16 | **Blocked By**: None（可立即启动）

  **References**:
  - **Pattern References**:
    - `src/adapters/mock-adapter.ts:27-32` — `nextError`/`executeScriptError`/`sendMessageError` 既有一次性注入模式，新机制须同构扩展而非替换
    - `src/adapters/mock-adapter.ts:99-105` — `checkError()` 的"取出即清"模式，`remaining` 语义参考它
    - `src/adapters/mock-adapter.ts:337-381` — `storage` 区实现（`get`/`set`/`remove`/`clear`/`onChanged`），注入点须落在 `set` **写 store 之前**
  - **API/Type References**:
    - `src/adapters/contract.ts:StorageArea` — 区域联合类型；`AdapterError`（`:60-73`）错误码
  - **Test References**:
    - `tests/integration/import-export-service.test.ts:16-21` — mock adapter `createMockAdapter()` + `reset()` 的既有用法
  - **WHY Each Reference Matters**: 补偿路径测试的**全部可信度**取决于"能否精确让 sync 写失败而 local 写成功"——`storage-repository.ts:277-284` 证明 `writeSync` 内部**先 local 后 sync**，故只有 area/key 定向注入才能把失败逼进补偿分支（设计 A13 的硬前提）。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：新测试文件存在且**初始失败**（注入能力尚未实现）
  - [ ] GREEN：`npx vitest run tests/unit/adapters/mock-adapter-failure.test.ts` → ALL PASS（≥3 断言组）
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 定向失败只命中目标 key（happy — 精确可控）
    Tool: Bash (vitest)
    Preconditions: adapter = createMockAdapter(); repo = new StorageRepository(adapter); await repo.initialize()
    Steps:
      1. adapter.failStorageSet('local', 'icon:slot-3')
      2. await adapter.storage.set('local', { 'icon:slot-3': 'X' }) → 断言 REJECT（AdapterError）
      3. await adapter.storage.set('local', { 'icon:slot-9': 'Y' }) → 断言 RESOLVE
      4. 断言 adapter.state.localStorage['icon:slot-9'] === 'Y' 且 'icon:slot-3' 不在 store
    Expected Result: 精确命中目标 key，其余 key 不受影响
    Failure Indicators: 写入被误放过 / 非目标 key 也被拒 / 失败时 store 被污染
    Evidence: _context-output/evidence/task-0-directed-failure.txt

  Scenario: 失败注入不污染状态、不广播（failure — 补偿前提）
    Tool: Bash (vitest)
    Preconditions: 同上；注册 storage.onChanged 计数监听
    Steps:
      1. adapter.failNextStorageSet('sync')
      2. let changed = 0; adapter.storage.onChanged(() => changed++)
      3. await expect(adapter.storage.set('sync', { syncState: { configVersion: 99 } })).rejects.toThrow()
      4. 断言 changed === 0 且 adapter.state.syncStorage 无 'syncState'
    Expected Result: 失败是"干净失败"（无副作用），补偿逻辑才有明确的回滚基线
    Evidence: _context-output/evidence/task-0-clean-failure.txt
  ```

  **Evidence to Capture**: `task-0-directed-failure.txt`、`task-0-clean-failure.txt`

  **Commit**: YES（groups with T0）
  - Message: `test(adapters): add directed + persistent storage failure injection`
  - Files: `src/adapters/mock-adapter.ts, tests/unit/adapters/mock-adapter-failure.test.ts`
  - Pre-commit: `npm run test:unit`

- [x] **T1. 独立传输 schema + 双向映射层（`src/shared/export-package.ts`）**

  **What to do**:
  - 定义包 schema（**独立于 `SyncState`**，A14）：
    ```
    interface ExportPackage {
      schemaVersion: number;           // 固定 1（不背兼容）
      generator: { name: string; version: string };  // 仅诊断，不参与校验（D11）
      exportedAt: string;
      scope: ExportScope;              // 记录用户勾选了哪些维度/记录（D1）
      slots?: PortableSlotDef[];       // 缺失 = 未携带；[] = 携带但空（A3）；已剥离 strategy（D3）
      rules?: PortableRule[];          // 同上
      settings?: PortableSettings;     // 全局三项 + 每 slot strategy（D2/D3）
      shortcuts?: PortableShortcuts;   // 全局 1 + 每 slot 20（D2/D3）
    }
    ```
  - `PortableIcon`（记录内图标承载）：`{ kind: 'url'; url: string } | { kind: 'local-ref'; ref: string } | { kind: 'recipe'; bgColor?; text?; textColor? }`（C1；**不含位图**）
  - **双向映射层**：`syncStateToPackage(sync, scope) : ExportPackage` 与 `packageToSyncPatch(pkg, current) : { slots?, rules?, settings?, shortcuts? }`
    - 映射层**只做形状转换**，不做 diff、不写存储、不校验域（职责单一）
    - `configVersion` / `createdAt` / `updatedAt` **不进包**（D5）——映射时剔除
  - `isExportPackage(value): value is ExportPackage` 形状守卫（结构性错误判别，与 D14 校验器分工：本函数只判"是不是包"）
  - **RED 测试**（先写）：`tests/unit/shared/export-package-map.test.ts`
    - 往返：`packageToSyncPatch(syncStateToPackage(state, allScope), state)` 在 4 维度上都等价（保真，G4-A）
    - 未勾选维度 ⇒ 对应字段 **不存在**（而非 `[]`/`undefined` 键）
    - `strategy` **不出现在** `slots[]`（D3）；出现在 `settings.slotStrategies`
    - `configVersion`/时间戳**不出现在**包任何位置

  **Must NOT do**:
  - 不镜像 `SyncState` 形状（顶层与记录都必须独立）
  - 不引入通用序列化/反射框架（只服务本 schema）
  - 不在此任务做 diff / 校验 / 存储写入

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 契约设计 + 双向等价，需谨慎处理"携带 vs 未改动"的可枚举性
  - **Skills**: [`sw-tdd-agent`, `sw-service-designer`]
  - **Skills Evaluated but Omitted**: `sw-feature-designer`（无跨服务特性）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 1（with T0, T2–T4）
  - **Blocks**: T5, T10, T14, T19 | **Blocked By**: None

  **References**:
  - **Pattern References**:
    - `src/shared/types.ts:243-253` — `SyncState` 形状（映射**源**；须被剔除内部字段）
    - `src/shared/types.ts:79-92` — `SlotDefinition`（含 `strategy`/`createdAt`/`updatedAt`，均须处理）
    - `src/background/import-export-service.ts:40-58` — 现网 `ExportPayload` 构造（镜像形态的反例）
  - **API/Type References**:
    - `src/shared/types.ts:209-239` — 现 `ExportPayload`/`ImportPreview`/`ImportSlotConflict`（本任务起被替代，T14 删除）
    - 设计 §2.1/§2.2/§2.3 — 包形状、维度集合、三态表达
    - `2026-10-04-import-export-decisions.yaml`：A14 / D3 / D5 / D11 / A3
  - **WHY Each Reference Matters**: A14 的必要性在于"包**不可能**照抄 `SyncState`"（导出时图标已被改写、内部字段会泄漏）；G4-A 要求"不改动未勾选的记录"，故"携带了什么"必须成为**枚举事实**（缺失 vs 空数组进一步由 A3 区分）。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run tests/unit/shared/export-package-map.test.ts` → ALL PASS（往返等价 ≥4 维度 + 3 条负例）
  - [ ] 断言包 JSON 中不含 `configVersion`/`createdAt`/`updatedAt`（字符串搜索）
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 全量往返保真（happy — G4-A）
    Tool: Bash (vitest)
    Preconditions: 构造含 10 slot（其中一个带 per-slot strategy）、3 rule、非默认全局三项的 SyncState
    Steps:
      1. const pkg = syncStateToPackage(state, { slots:true, rules:true, settings:true, shortcuts:true })
      2. const patch = packageToSyncPatch(pkg, state)
      3. 断言 patch.slots 深度等于 state.slots 的映射（strategy 除外，见 settings）
      4. 断言 patch.rules 深度等于 state.rules
      5. 断言 patch.settings 三全局项 + slotStrategies 完整
    Expected Result: 4 维度往返无损；无字段丢失
    Failure Indicators: 任一字段在往返中丢失/改名/被默认值覆盖
    Evidence: _context-output/evidence/task-1-roundtrip-fidelity.txt

  Scenario: 未携带维度不产生键（failure/edge — A3 三态）
    Tool: Bash (vitest)
    Preconditions: 同上 state
    Steps:
      1. const pkg = syncStateToPackage(state, { slots:true, rules:false, settings:false, shortcuts:false })
      2. 断言 'rules' in pkg === false（字段不存在，而非 []）
      3. 断言 'settings' in pkg === false 且 'shortcuts' in pkg === false
      4. 断言 JSON.stringify(pkg) 不含 '"configVersion"'
    Expected Result: 未携带 = 字段缺失；内部字段零泄漏
    Evidence: _context-output/evidence/task-1-absent-dimension.txt
  ```

  **Evidence to Capture**: `task-1-roundtrip-fidelity.txt`、`task-1-absent-dimension.txt`

  **Commit**: YES（groups with T1）
  - Message: `feat(shared): add portable export package schema + bidirectional mapping`
  - Files: `src/shared/export-package.ts, tests/unit/shared/export-package-map.test.ts`
  - Pre-commit: `npm run typecheck && npm run test:unit`

- [x] **T2. `IconSource` 扩展（`textColor`）+ 包/意图类型定义**

  **What to do**:
  - `src/shared/types.ts`：给 `IconSource`（`:57-65`）加 `textColor?: string`（对齐 `IconConfig.textColor`，`IconEditor.tsx:20`）；注释 `type:'template'` 语义为"配方承载"
  - 新增导入意图类型（呼应 A4/C4，供 T8/T14 使用）：
    ```
    type DimensionMode = 'incremental' | 'overwrite';   // A1：每维度一模式，默认 incremental
    interface ImportIntent {
      dimensionModes: { slots: DimensionMode; rules: DimensionMode; settings: DimensionMode; shortcuts: DimensionMode };
      recordOverrides?: Array<{ kind: 'slot'|'rule'; id: number|string; action: 'keep'|'take' }>;  // A4：稀疏、仅改过的
    }
    ```
  - 新增结果/预览类型占位：`ImportDiff`（记录级 + 字段级，A12）、`ImportInspection`（diff + 携带情况 + 宽容项 + 域违规 + 匹配重合，D6/§6.2）、`ImportApplyResult`（清单，§4.3）——**仅类型定义**，实现留 T8/T17
  - **RED 测试**（先写）：`tests/unit/shared/types-icon-text-color.test.ts`
    - `IconSource` 可赋 `textColor` 且 `satisfies IconSource`
    - `ImportIntent` 默认 `dimensionModes` 全 `'incremental'` 的构造助手可用

  **Must NOT do**:
  - 不改 `IconSourceType`（仍 `url|upload|template`）
  - 不在本任务实现映射/diff 逻辑（纯类型）

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: 类型增补，影响面需谨慎但改动小
  - **Skills**: [`sw-tdd-agent`]

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 1（with T0, T1, T3, T4）
  - **Blocks**: T6, T7, T8, T12, T13, T14 | **Blocked By**: None

  **References**:
  - **Pattern References**:
    - `src/shared/types.ts:55-65` — `IconSourceType`/`IconSource` 现状（缺 `textColor`）
    - `src/ui/components/IconEditor.tsx:17-22` — `IconConfig { bgColor?, text?, textColor?, dataUri? }`（既有形状，须对齐）
  - **API/Type References**:
    - 设计 §2.2 维度集合、§3.2 模式表、§4.4 重合定义
    - `2026-10-04-import-export-decisions.yaml`：C1 / A4 / A6 / A12 / D14
  - **WHY Each Reference Matters**: C1 要求配方含"文本色"，而 `IconSource` 恰缺 `textColor` → schema 工作是硬前提；`ImportIntent` 形状直接决定 C4 的"服务端可完全重算"是否成立（A4：逐维模式 + 稀疏覆盖）。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run tests/unit/shared/types-icon-text-color.test.ts` → PASS
  - [ ] `npm run typecheck` → 0 error（新类型无冲突）

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 配方型 IconSource 可承载完整配方（happy）
    Tool: Bash (vitest)
    Preconditions: —
    Steps:
      1. const src: IconSource = { type: 'template', value: '', backgroundColor: '#2563EB', text: 'A', textColor: '#FFFFFF' }
      2. 断言编译通过且 src.textColor === '#FFFFFF'
    Expected Result: 配方三要素（bg/text/textColor）齐备
    Evidence: _context-output/evidence/task-2-icon-textcolor.txt

  Scenario: 意图默认值为增量（edge — 默认落在保留）
    Tool: Bash (vitest)
    Preconditions: —
    Steps:
      1. const intent = defaultImportIntent()
      2. 断言 intent.dimensionModes 四项全 'incremental'
      3. 断言 intent.recordOverrides 为 undefined（稀疏）
    Expected Result: 覆盖导入的高风险默认被规避（A1 的"更好的默认"）
    Evidence: _context-output/evidence/task-2-intent-default.txt
  ```

  **Evidence to Capture**: `task-2-icon-textcolor.txt`、`task-2-intent-default.txt`

  **Commit**: YES（groups with T2）
  - Message: `feat(shared): add IconSource.textColor + import intent/diff types`
  - Files: `src/shared/types.ts, tests/unit/shared/types-icon-text-color.test.ts`
  - Pre-commit: `npm run typecheck`

- [x] **T3. `findUnsafeRegex` 语义放宽（拒绝整包 → 跳过该记录）+ 域约束校验器**

  **What to do**:
  - 把 `findUnsafeRegex`（`import-export-service.ts:253-288`）从"返回首个不安全项并**拒绝整包**"改为**分类过滤器**：`partitionByDomainRules(records) : { accepted, rejectedWithReason }`
    - 拒绝项**不是**整包失败，而是逐条收集 `{ kind, id, reason }`（供 D15 披露）
  - 新增域约束校验（D14）：`slot.id ∈ 1..10`、`urlMatch.type ∈ {'exact','regex'}`、正则过 `validateRegex` 闸门（复用 `@shared/url-utils`）、URL 长度上限（复用既有 `validateRegex` 的 `REGEX_TOO_LONG`；普通 URL 上限沿用既有常量/惯例）
  - 修改调用点 `:122`（preview）与 `:184`（commit）：**不再** return 拒绝；改为在 diff/结果中携带 `domainViolations[]`
  - **改写既有测试**（`tests/integration/import-export-service.test.ts:34-83`）：原断言"危险正则 → `success:false`"须迁移为"危险正则 → 该记录被跳过 + 其余照常 + 结果含 violation"
  - **RED 测试**（先写）：`tests/unit/background/domain-rules-partition.test.ts`
    - 不安全正则规则 → 进入 `rejectedWithReason`，**其余记录仍 accepted**
    - `slot.id = 11` → 被拒；`urlMatch.type = 'fuzzy'` → 被拒
    - 全部合法 → `rejectedWithReason` 为空

  **Must NOT do**:
  - 不放宽正则闸门本身（B4 仍是拒绝 tier）
  - 不实现 diff（T8）或写入（T10/T11）
  - 不保留"整包拒绝"分支（D15 明确替换 C3 的第三条触发条件）

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 涉及安全语义变更 + 既有测试迁移，风险高于表面
  - **Skills**: [`sw-tdd-agent`, `sw-reviewer-security`] — 安全闸门语义变更需安全视角复核
  - **Skills Evaluated but Omitted**: `sw-systematic-debugging`

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 1（with T0–T2, T4）
  - **Blocks**: T14 | **Blocked By**: None

  **References**:
  - **Pattern References**:
    - `src/background/import-export-service.ts:244-288` — `findUnsafeRegex` 现状（`valid===false` = reject tier；宽匹配警告 `valid===true` 仍可导入）
    - `src/background/import-export-service.ts:118-124`（preview 调用点）、`:176-186`（commit 重校验调用点）
    - `src/background/rule-service.ts:219-223` — 既有"write 层协议闸门"模式（可复用其错误构造）
  - **API/Type References**:
    - `src/shared/url-utils.ts:615-638` — `isSafeFaviconProtocol`（域约束参照）；`validateRegex`（`:301`）
    - `2026-10-04-import-export-decisions.yaml`：D14 / D15 + `revisions`（C3 第三条触发条件放宽）
    - 主设计 §6.1（域违规为何不整体拒绝 — 技术等价性论证）
  - **Test References**:
    - `tests/integration/import-export-service.test.ts:34-83` — **须迁移**的既有断言（原为"拒绝整包"）
  - **WHY Each Reference Matters**: D15 的技术等价性依赖"B4 模式从不被执行、只做静态校验"→ 跳过即不写入，与整体拒绝**安全等价**；但**披露必须醒目且单独归类**，否则静默跳过比拒绝更危险。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：新测试初始失败；迁移后的既有测试先失败再随实现转绿
  - [ ] `npx vitest run tests/unit/background/domain-rules-partition.test.ts tests/integration/import-export-service.test.ts` → ALL PASS
  - [ ] 断言"一条坏记录不影响其余记录写入"（端到端，见 QA）
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 混合包中坏记录被跳过、好记录照常（happy — D15 核心）
    Tool: Bash (vitest)
    Preconditions: 包含 2 条合法规则 + 1 条不安全正则规则 + 1 条 slot.id=11
    Steps:
      1. 执行 INSPECT（或 partitionByDomainRules）
      2. 断言 accepted 含 2 条合法规则
      3. 断言 rejectedWithReason 含 2 条，reason 分类为"因不安全被跳过"
      4. 执行 APPLY 后断言 sync 中不含不安全正则、不含 slot 11，但含 2 条合法规则
    Expected Result: 坏记录被丢弃且单独归类，整次导入继续
    Failure Indicators: 整包被拒 / 坏记录被写入 / 归类与"未知字段被忽略"混淆
    Evidence: _context-output/evidence/task-3-partition-mixed.txt

  Scenario: slot.id 越界绝不写入（failure — 防看不见的槽位）
    Tool: Bash (vitest)
    Preconditions: 包含 slot.id=11
    Steps:
      1. APPLY 后读取 getSyncState()
      2. 断言 slots 中无 id===11
      3. 断言结果清单含该条 violation
    Expected Result: 越界槽位被丢弃（否则产生 UI 只有 10 行、看不见改不掉的槽位）
    Evidence: _context-output/evidence/task-3-slot-id-range.txt
  ```

  **Evidence to Capture**: `task-3-partition-mixed.txt`、`task-3-slot-id-range.txt`

  **Commit**: YES（groups with T3）
  - Message: `feat(background): relax regex gate to per-record skip + domain constraint partition`
  - Files: `src/background/import-export-service.ts, tests/unit/background/domain-rules-partition.test.ts, tests/integration/import-export-service.test.ts`
  - Pre-commit: `npm run test:integration`

- [x] **T4. 图标引用识别 + 解引用纯函数（导出侧基础）**

  **What to do**:
  - 新增纯函数（置于 `src/shared/export-package.ts` 或 `src/shared/icon-ref.ts`）：
    - `classifyIconValue(rawValue: string) : 'url' | 'local-ref' | 'data-uri' | 'unknown'`
      - `http(s):` → `'url'`
      - `startsWith('local-icon:')` → `'local-ref'`（**仅裸引用**；`[local:…]` 视为 `'unknown'`，因为已证否）
      - `data:` → `'data-uri'`（**仅 upload 位图**：**Q1=A 后配方不再以 data URI 形式出现**（background 原样上送 `type:'template'`），故 `data-uri` 一律按 upload 位图 → 转引用；**不再需要"反推是否为配方"**）
      - 其它 → `'unknown'`
    - `toPortableIcon(icon: IconSource, rawValue: string) : PortableIcon`（导出侧改写：URL→url；upload→裸 `local-ref`；template→recipe）
  - **RED 测试**（先写）：`tests/unit/shared/icon-ref-classify.test.ts`
    - `http://x/a.png` → `'url'`
    - `local-icon:icon:slot-3` → `'local-ref'`
    - `[local:local-icon:icon:slot-3]` → `'unknown'`（**明确证否包装**）
    - `data:image/png;base64,…` → `'data-uri'`
  - **注意（Q1=A 简化）**：因 `getSyncState()` 每次读取都会 `resolveIconReferences`（`storage-repository.ts:226`），**upload 类**导出入口拿到的是**已解引用**的 data URI → 分类函数需识别"这是被解引用回来的值"。**配方（`type:'template'`）已由 Q1=A 保证原样上送**（T12），故**不经** `classifyIconValue` 的 `data-uri` 分支，直接由 `IconSource.type` 判定（T5 承接）——**无需"从 data URI 反推配方"**。

  **Must NOT do**:
  - 不在此任务读存储或写存储（纯函数）
  - 不实现**配方渲染**（T12 已将落点定为 **UI 侧**）
  - 不保留任何 `[local:…]` 兼容分支（G1 不背兼容）

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: 纯函数 + 分类判别，逻辑清晰
  - **Skills**: [`sw-tdd-agent`]

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 1（with T0–T3）
  - **Blocks**: T5 | **Blocked By**: None

  **References**:
  - **Pattern References**:
    - `src/background/import-export-service.ts:49` — 现网包装产出 `[local:${value}]`（**反例**，本任务修正方向）
    - `src/background/storage-repository.ts:68,410-442,454-474` — `ICON_REF_PREFIX`、`resolveIconReferences`、`resolveIconRef`（理解"读到的是 data URI"）
    - `src/background/icon-service.ts:401-419` — `resolveForDisplay` 的 `template`/`upload`/`url` 分支（分类依据）
  - **API/Type References**:
    - `src/shared/types.ts:55-65` — `IconSource`
    - 设计 §2.4 图标承载表 + C2 依据块（`[local:…]` **首尾均不匹配** `startsWith('local-icon:')`）
  - **WHY Each Reference Matters**: C2 要求"导出必须解引用**并裸发**"，但现网 `getSyncState` 已解引用为 data URI，故导出路径必须**重新识别并转回引用**——本任务的分类函数正是该转换的判别内核。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run tests/unit/shared/icon-ref-classify.test.ts` → ALL PASS（≥4 用例，含包装证否）
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 裸引用被识别、包装被证否（happy + failure 合一）
    Tool: Bash (vitest)
    Preconditions: —
    Steps:
      1. classifyIconValue('local-icon:icon:slot-3') → 断言 'local-ref'
      2. classifyIconValue('[local:local-icon:icon:slot-3]') → 断言 'unknown'
      3. classifyIconValue('https://a.com/f.png') → 断言 'url'
    Expected Result: 裸引用可解析；包装永不解析（与 startsWith 语义一致）
    Failure Indicators: 包装被误判为引用（会导致"假解析"）
    Evidence: _context-output/evidence/task-4-classify.txt

  Scenario: 解引用回来的 data URI 被识别（edge — 导出侧关键）
    Tool: Bash (vitest)
    Preconditions: —
    Steps:
      1. classifyIconValue('data:image/png;base64,iVBOR...') → 断言 'data-uri'
    Expected Result: 导出入口可据此触发"转引用/配方"改写（T5）
    Evidence: _context-output/evidence/task-4-datauri-detect.txt
  ```

  **Evidence to Capture**: `task-4-classify.txt`、`task-4-datauri-detect.txt`

  **Commit**: YES（groups with T4）
  - Message: `feat(shared): add icon value classification (bare-ref detection, wrapper rejected)`
  - Files: `src/shared/export-package.ts`（或 `icon-ref.ts`）, `tests/unit/shared/icon-ref-classify.test.ts`
  - Pre-commit: `npm run test:unit`

- [ ] **T5. 导出侧图标改写（URL / 裸引用 / 配方对象）**

  **What to do**:
  - 在导出映射（T1 的 `syncStateToPackage`）内接入 T4 的分类：对每个 slot/rule 图标执行改写
    - `'url'` → `{ kind:'url', url }`（**不上引用**，C2）
    - upload 类 data URI → `{ kind:'local-ref', ref:'local-icon:icon:slot-N' }`（**裸发**，C2）
    - template 配方 → `{ kind:'recipe', bgColor, text, textColor }`（C1）
  - **关键（简化，Q1=A）**：
    - **配方**：因 **background 原样上送**（Q1=A，T12），`IconSource.type === 'template'` **可直接判定为配方**（不再需要"从 data URI 反推配方"）→ 直接映射 `{ kind:'recipe', … }`
    - **upload 类**：`getSyncState` 已解引用（#5）为 data URI，需从**原始存储**或记录 id 派生"该引用指向哪个 key"——引用键由记录 id 派生（`icon:${rule.id}` / `icon:slot-${slot.id}`，`storage-repository.ts:387,400`）
  - 移除 `:49` 的 `[local:…]` 包装逻辑
  - **RED 测试**（先写）：`tests/unit/shared/export-icon-rewrite.test.ts`
    - 含 URL 图标的 slot → 包内 `{ kind:'url' }`
    - 含 upload 图标的 slot → 包内 `{ kind:'local-ref', ref:'local-icon:icon:slot-3' }`（**无** `[local:`）
    - 含 template 配方的 slot → 包内 `{ kind:'recipe', bgColor, text, textColor }`
    - 断言 `JSON.stringify(pkg)` 中 `rg "\[local:"` 命中 0

  **Must NOT do**:
  - 不导出任何位图 bytes（C1）
  - 不保留 `[local:…]` 任何形态
  - 不改写 `faviconSnapshot` 语义（T5 只处理 `uiMarker.icon` 与 `rule.favicon`）

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 需理解"已解引用 vs 原始引用键"的绕行，易错
  - **Skills**: [`sw-tdd-agent`, `sw-codebase-explorer`] — 引用键派生逻辑需交叉核实
  - **Skills Evaluated but Omitted**: `sw-reviewer-performance`

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 2（with T6–T10）
  - **Blocks**: T17 | **Blocked By**: T1, T4

  **References**:
  - **Pattern References**:
    - `src/background/import-export-service.ts:43-52` — 现网 slot 图标改写（`:49` 为包装反例）
    - `src/background/storage-repository.ts:380-403` — `offloadLargeIcons`：**引用键的派生规则**（`icon:${rule.id}` / `icon:slot-${slot.id}`）与阈值 `ICON_OFFLOAD_THRESHOLD = 6*1024`
    - `src/background/storage-repository.ts:410-442` — `resolveIconReferences`（解引用方向，本任务为其逆向）
  - **API/Type References**:
    - 设计 §2.4 / §5 导出数据流；C1 / C2 / C9
    - `2026-10-04-import-export-decisions.yaml`：C1 / C2
  - **WHY Each Reference Matters**: C2 的两个硬要求（解引用 + 裸发）在"读取已解引用"的现网下必须**逆向重识别**；而引用键由记录 id 派生这一点同时是 T11"假成功碰撞"的成因。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run tests/unit/shared/export-icon-rewrite.test.ts` → ALL PASS
  - [ ] `rg "\[local:" src/background/import-export-service.ts` → 0
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 三类图标各自改写正确（happy）
    Tool: Bash (vitest)
    Preconditions: state 含 3 个 slot：URL 图标 / upload(data URI) 图标 / template 配方图标
    Steps:
      1. const pkg = syncStateToPackage(state, { slots:true })
      2. 断言 slot[url].icon.kind === 'url'
      3. 断言 slot[upload].icon.kind === 'local-ref' 且 ref.startsWith('local-icon:')
      4. 断言 slot[recipe].icon.kind === 'recipe' 且含 bgColor/text/textColor
      5. 断言 JSON.stringify(pkg).includes('[local:') === false
    Expected Result: 三类承载正确、零位图、零包装
    Failure Indicators: 出现 [local: 包装 / 出现 data:image 位图 / kind 判错
    Evidence: _context-output/evidence/task-5-icon-rewrite.txt

  Scenario: 大图标的引用键派生正确（edge — 6KB 阈值）
    Tool: Bash (vitest)
    Preconditions: slot 3 的图标 >6KB（已被 offload 为 icon:slot-3）
    Steps:
      1. 导出后断言 ref === 'local-icon:icon:slot-3'
    Expected Result: 键与 offloadLargeIcons 派生规则一致（接收方才"必然解析失败"→缺失占位）
    Evidence: _context-output/evidence/task-5-ref-key-derivation.txt
  ```

  **Evidence to Capture**: `task-5-icon-rewrite.txt`、`task-5-ref-key-derivation.txt`

  **Commit**: YES（groups with T5）
  - Message: `feat(background): export icons as URL / bare ref / recipe (drop [local:] wrapper)`
  - Files: `src/background/import-export-service.ts, src/shared/export-package.ts, tests/unit/shared/export-icon-rewrite.test.ts`
  - Pre-commit: `npm run test:unit`

- [ ] **T6. 消费方"引用不可解析 ⇒ 缺失"判定 + 占位呈现**

  **What to do**:
  - 在读取路径（`resolveIconReferences` 消费侧，或链路 `field-chain` 的图标解析）实现规则：**引用无法解析 ⇒ 视为缺失图标 ⇒ 显示占位**（C9-②）
    - 现状：`if (actualUri)` 才替换，否则**原样留下字面量**（`storage-repository.ts:416-437`）→ 字面量会流到 UI 与 favicon 路径
  - 占位复用 `icon-service.getPlaceholder()`（灰色 `?` SVG，`icon-service.ts:386`）；**不得**与"本来没有图标"的回退（`🔖`）混淆（D9 明确区分）
  - 暴露"缺失"为可读状态（供 T22 清单与 T20 行内修复入口使用）：如 `resolveForDisplay` 返回 `{ uri, missing: boolean }`，或独立的 `isMissingIcon(record)`
  - **RED 测试**（先写）：`tests/unit/background/missing-icon-detection.test.ts`
    - 引用 `local-icon:icon:slot-3` 但 local 无该键 → 判定为 `missing:true` + 返回占位
    - 引用可解析 → `missing:false` + 返回真实 data URI
    - **无图标**（`icon` 为空）→ `missing:false`（区分"缺失"与"本来没有"）
  - **不新增持久化标记**（C9 明确否决"值置空 + 持久化待重选标记"）

  **Must NOT do**:
  - 不扩展 schema 加"待重选"标记
  - 不把占位符当作真实图标写入存储
  - 不改 `isSafeFaviconProtocol`

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 落在链路读侧，影响 3 个 UI 面，需谨慎
  - **Skills**: [`sw-tdd-agent`, `sw-reviewer-logic`]

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 2（with T5, T7–T10）
  - **Blocks**: T17, T22 | **Blocked By**: T2

  **References**:
  - **Pattern References**:
    - `src/background/storage-repository.ts:416-441` — `if (actualUri)` 替换逻辑（缺口的**精确位置**）
    - `src/background/icon-service.ts:386-419` — `getPlaceholder()` 与 `resolveForDisplay()`（占位与"缺失"判定落点）
    - `src/shared/field-chain.ts:167-175` — slot 图标进链的既有判定（`isSafeFaviconProtocol` 过滤）
  - **API/Type References**:
    - `2026-10-04-import-export-decisions.yaml`：C9 / D9（判定落点 + 占位呈现 + 修复入口）
    - 主设计 §2.4（"缺失"由消费方判定）、§6（错误处理表）
  - **WHY Each Reference Matters**: 设计明确指出 `resolveIconReferences` 在解析失败时**原样留下字面量**，故必须在**消费方**加规则；且 D9 要求"缺失"与"本来没有"**可区分**——否则用户看到 `🔖` 无法判断"设了没生效"还是"从没设过"。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run tests/unit/background/missing-icon-detection.test.ts` → ALL PASS（3 分支）
  - [ ] 断言：不可解析引用 ⇒ `missing:true`；可解析 ⇒ `missing:false`；无图标 ⇒ `missing:false`
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 不可解析引用落入"缺失"（happy — C9-②）
    Tool: Bash (vitest)
    Preconditions: sync 中 slot 3 图标 value = 'local-icon:icon:slot-3'，local 无 key 'icon:slot-3'
    Steps:
      1. const r = await resolveForDisplay(...) / isMissingIcon(...)
      2. 断言 missing === true
      3. 断言返回值为 getPlaceholder() 的 SVG（含 fill="#e0e0e0"）
    Expected Result: 稳定落入"缺失" + 占位
    Failure Indicators: 字面量 'local-icon:icon:slot-3' 被当图标渲染
    Evidence: _context-output/evidence/task-6-missing-detected.txt

  Scenario: "本来没有"不被误判为缺失（failure/edge — D9 区分）
    Tool: Bash (vitest)
    Preconditions: slot 5 的 icon 为 undefined / null
    Steps:
      1. 断言 missing === false（这是"没设过"，不是"缺失"）
    Expected Result: 两种状态可区分（D9 的硬要求）
    Evidence: _context-output/evidence/task-6-absent-vs-missing.txt
  ```

  **Evidence to Capture**: `task-6-missing-detected.txt`、`task-6-absent-vs-missing.txt`

  **Commit**: YES（groups with T6）
  - Message: `feat(background): treat unresolvable icon refs as missing + placeholder`
  - Files: `src/background/storage-repository.ts, src/background/icon-service.ts, tests/unit/background/missing-icon-detection.test.ts`
  - Pre-commit: `npm run test:unit`

- [ ] **T7. 配方持久化写入路径（3 处收敛为 1 个转换函数）**

  **What to do**:
  - 新增 `src/ui/shared/icon-source.ts`：`iconConfigToIconSource(config: IconConfig) : IconSource`
    - 若 `config.dataUri`（用户上传）→ `{ type:'upload', value: dataUri }`
    - 否则（配方）→ `{ type:'template', value:'', backgroundColor, text, textColor }`（**保留配方**，renderIconToDataUri 只作预览缓存）
  - 替换 3 处"先 `renderIconToDataUri` 再写 `{type:'upload'}`"的路径：
    - `src/ui/sidebar/App.tsx:933`（slot 图标）
    - `src/ui/shared/rule-form-submit.ts:80`（规则图标）
    - `src/ui/settings/App.tsx:1656`（override/dashboard 写入）
    - 以及 `src/ui/shared/icon-field-editor.tsx:159,249` 的同类逻辑
  - **RED 测试**（先写）：`tests/unit/ui/icon-source-conversion.test.tsx`
    - 配方输入 → 输出 `{ type:'template', ... }` 且**携带 textColor**
    - 上传输入（含 dataUri）→ 输出 `{ type:'upload' }`
    - 断言**不**产生 `{ type:'upload', value:'<svg 或 canvas data uri>' }` 的配方丢失形态

  **Must NOT do**:
  - 不在本任务实现**存储层渲染**（**Q1=A：background 不渲染配方**；渲染落点 = UI 侧，见 T12）
  - 不改变 `IconEditor` 的预览行为（预览仍可用 canvas，属 UI 展示）
  - 不在 jsdom 中真断言 canvas 像素（`renderIconToDataUri` 在 jsdom 不可用，`IconEditor.tsx:66-105`）

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 3 处写入路径 + 一个共享转换，需防手抄漂移
  - **Skills**: [`sw-tdd-agent`, `sw-codebase-explorer`]
  - **Skills Evaluated but Omitted**: `sw-ui-ux-review`（无交互变更）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 2（with T5, T6, T8–T10）
  - **Blocks**: T12, T13 | **Blocked By**: T2

  **References**:
  - **Pattern References**:
    - `src/ui/sidebar/App.tsx:930-935` — slot 图标写入（配方随写随丢）
    - `src/ui/shared/rule-form-submit.ts:76-84` — 规则图标写入
    - `src/ui/settings/App.tsx:1654-1667` — override 写入（`renderIconToDataUri` 后写 `{type:'upload'}`）
    - `src/ui/shared/icon-field-editor.tsx:156-160,246-250` — `IconFieldValue` → data URI（`custom` 分支）
  - **API/Type References**:
    - `src/ui/components/IconEditor.tsx:17-22` — `IconConfig`；`:66-105` — `renderIconToDataUri`（canvas，jsdom 不可用）
    - `src/shared/types.ts:55-65` — `IconSource`（T2 已加 `textColor`）
    - `2026-10-04-import-export-decisions.yaml`：C1（配方持久化）+ A6（配方只存存储层）
  - **WHY Each Reference Matters**: C1 的"附带范围扩张"要求 `IconSource.type:'template'` **从"从未被产出"变为可用**；A6 要求配方成为**唯一持久真源**、渲染值只作缓存（否则两份状态不一致会静默投递旧图标）。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run tests/unit/ui/icon-source-conversion.test.tsx` → ALL PASS
  - [ ] `rg "type: 'upload', value: (iconData|iconValue|faviconValue)" src/ui` 命中数下降至仅剩"真实上传"路径（人工核对 3 处已改）
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 配方写入保留完整配方（happy — C1）
    Tool: Bash (vitest)
    Preconditions: config = { bgColor:'#2563EB', text:'A', textColor:'#FFFFFF' }（无 dataUri）
    Steps:
      1. const src = iconConfigToIconSource(config)
      2. 断言 src.type === 'template'
      3. 断言 src.backgroundColor === '#2563EB' && src.text === 'A' && src.textColor === '#FFFFFF'
      4. 断言 src.value 不包含 canvas data URI
    Expected Result: 配方三要素完整持久化（今日会丢成 {type:'upload'}）
    Failure Indicators: 输出 {type:'upload'}（配方丢失）/ 丢失 textColor
    Evidence: _context-output/evidence/task-7-recipe-persist.txt

  Scenario: 真实上传仍走 upload（edge — 不误伤）
    Tool: Bash (vitest)
    Preconditions: config = { dataUri: 'data:image/png;base64,...' }
    Steps:
      1. const src = iconConfigToIconSource(config)
      2. 断言 src.type === 'upload' && src.value === config.dataUri
    Expected Result: 上传类仍为 upload（区分配方与上传）
    Evidence: _context-output/evidence/task-7-upload-passthrough.txt
  ```

  **Evidence to Capture**: `task-7-recipe-persist.txt`、`task-7-upload-passthrough.txt`

  **Commit**: YES（groups with T7）
  - Message: `feat(ui): persist icon recipes via single iconConfigToIconSource converter`
  - Files: `src/ui/shared/icon-source.ts, src/ui/sidebar/App.tsx, src/ui/shared/rule-form-submit.ts, src/ui/settings/App.tsx, src/ui/shared/icon-field-editor.tsx, tests/unit/ui/icon-source-conversion.test.tsx`
  - Pre-commit: `npm run typecheck && npm run test:unit`

- [ ] **T8. diff 计算 + 意图应用 + 匹配重合检测（`src/shared/import-diff.ts`）**

  **What to do**:
  - **diff 计算**（`computeDiff(pkg, currentSync)`）：记录级默认 + 字段级可展开（A12）
    - 每条记录归入 `added | replaced | kept | skipped`（+ 每字段 `title`/`icon` 的 `unchanged|changed`）
    - 覆盖 A1 三种情形：文件缺失目标机有（增量=保留/覆盖=删除）、双侧都有（由 diff 决定）、文件有目标机无（新增且进 diff）
    - `strategy` 归属：`slots[]` 已剥离（D3），per-slot strategy 变化落在 `settings` 维度
  - **意图应用**（`applyIntent(pkg, currentSync, intent)`）：以「维度模式（默认增量）+ 稀疏 recordOverrides」产出**目标最终状态**（纯函数，不写存储）
  - **匹配重合检测**（`findMatchOverlaps(finalState)`）：定义 = **`Match URL` + `Match Type` 完全一致**（D10）；对**最终状态**的纯函数；**不覆盖语义重合**（有意收窄）
  - **量化删除**（`quantifyDeletions(finalState, currentSync)`）：只数**真正不可逆的删除**（槽位/规则），不数替换总数（D7）
  - **RED 测试**（先写）：`tests/unit/shared/import-diff.test.ts`
    - 增量 + 文件缺失目标机有 → 记录 = `kept`
    - 覆盖 + 文件缺失目标机有 → 记录 = `deleted`
    - 双侧都有 + 默认预选覆盖（D8）→ 记录 = `replaced`
    - 逐记录 override 把某行改为 `keep` → 该行 `kept`，**其余继承维度模式**（A4）
    - 重合：两条规则 Match URL+Type 相同 → 检测到 1 处；语义重合（正则不同但匹配同 URL）→ **不**报告（D10 边界）

  **Must NOT do**:
  - 不做校验（T3）/ 不写存储（T10/T11）/ 不解析 JSON 文件（T10）
  - 不覆盖语义重合（D10 明确收窄）
  - 不把"替换"计入量化删除（D7 理由：替换可重做）

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 纯逻辑核心，A12/A4/D8/D10 四层语义叠加，最易出错
  - **Skills**: [`sw-tdd-agent`, `sw-reviewer-logic`]
  - **Skills Evaluated but Omitted**: `sw-reviewer-performance`（规模小：10 slot + 常规规则数）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 2（with T5–T7, T9, T10）
  - **Blocks**: T9, T10, T18, T20 | **Blocked By**: T2

  **References**:
  - **Pattern References**:
    - `src/background/import-export-service.ts:126-156` — 现网冲突检测（per-slot `existing`/`imported`），diff 的**语义前身**
    - `src/shared/url-utils.ts:493` — `detectRuleConflict`（既有重叠检测；D10 的字符串一致定义更简单、更可靠）
    - `src/background/rule-service.ts:142` — 规则 id `rule-${Date.now()}-${random}`（**随机唯一** → 跨机导入规则全是"新增"）
  - **API/Type References**:
    - 设计 §3.2 模式表 + §3.8（规则 id 无碰撞）+ §4.4（重合定义）
    - `2026-10-04-import-export-decisions.yaml`：A1 / A4 / A12 / D8 / D10
  - **WHY Each Reference Matters**: §3.8 指出规则 id 随机 → 增量模式会**同时保留两边**、可能产生两条规则竞争同一 URL；D10 因此要求恒定提示。而 A1 的模式**只管辖"文件缺失、目标机有"**这一种情形——「增量 ≠ 不删除任何东西」（逐记录覆盖可制造删除）。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run tests/unit/shared/import-diff.test.ts` → ALL PASS（≥8 用例覆盖 3 情形 × 2 模式 + override + 重合正负例）
  - [ ] 断言重合检测对**最终状态**为纯函数（同输入同输出；不读存储）
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 模式只管辖"文件缺失、目标机有"（happy — A1 更正后定义）
    Tool: Bash (vitest)
    Preconditions: current 有 slot1-3；pkg 携带 slot2(改)、slot4(新)，未含 slot1/slot3
    Steps:
      1. diff(增量) → 断言 slot1/slot3 = kept，slot2 = replaced（双侧都有由 diff 决定），slot4 = added
      2. diff(覆盖) → 断言 slot1/slot3 = deleted，slot2 = replaced，slot4 = added
    Expected Result: 两种模式在"双侧都有"上行为相同；只在"文件缺失目标机有"上分叉
    Failure Indicators: 增量误删 slot1 / 覆盖漏删 slot3
    Evidence: _context-output/evidence/task-8-diff-modes.txt

  Scenario: 逐记录覆盖制造删除并计入量化（edge — D7）
    Tool: Bash (vitest)
    Preconditions: 增量模式 + 对 slot3 加 recordOverride action='take'(删除)
    Steps:
      1. const final = applyIntent(...)
      2. 断言 final 无 slot3
      3. 断言 quantifyDeletions(final, current).slots === 1
    Expected Result: "增量 ≠ 不删除" 被量化如实反映
    Evidence: _context-output/evidence/task-8-override-deletion.txt

  Scenario: 语义重合不报告（failure/edge — D10 收窄）
    Tool: Bash (vitest)
    Preconditions: 规则 A 正则 'https://a\\.com/.*'，规则 B 正则 'https://a\\.com/x'
    Steps:
      1. findMatchOverlaps(final) → 断言 length === 0（字符串不同，有意不覆盖）
      2. 再加规则 C 与 A 的 urlMatch 完全一致 → 断言 length === 1
    Expected Result: 仅报告"字符串完全一致"的重合
    Evidence: _context-output/evidence/task-8-overlap-definition.txt
  ```

  **Evidence to Capture**: `task-8-diff-modes.txt`、`task-8-override-deletion.txt`、`task-8-overlap-definition.txt`

  **Commit**: YES（groups with T8）
  - Message: `feat(shared): add import diff, intent application, overlap detection`
  - Files: `src/shared/import-diff.ts, tests/unit/shared/import-diff.test.ts`
  - Pre-commit: `npm run test:unit`

- [ ] **T9. 保真单测（`keep existing` 路径不丢规则 — 直接堵 F2）**

  **What to do**:
  - 新增**保真证明测试**：`tests/integration/import-fidelity.test.ts`
    - 目标机有 9 条规则；导入包携带 0 条规则或用户选择全部 `keep existing`
    - 断言：导入后目标机 `rules` **逐条不变**（深比较：`id`/`urlMatch`/`priority`/`createdAt`/`updatedAt`）
    - 断言：未勾选维度（如 settings 未携带）的全局字段**一个字节不动**
  - 该测试**先写并必然失败**（现网 `:210` 无条件替换 → 直击 F2）
  - 覆盖 G4-A 判据："任一导入路径不得改动用户未勾选的记录，须有测试证明"

  **Must NOT do**:
  - 不实现新逻辑（本任务的绿灯依赖 **T10** 的实现；作为"契约测试"存在）
  - 不断言预览 UI（纯服务端断言）

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: 单一判据（数组逐条不变）的集成断言
  - **Skills**: [`sw-tdd-agent`]

  **Parallelization**:
  - **Can Run In Parallel**: YES（但**须在 T10 之后**：同波内串行 T10 → T9）| **Parallel Group**: Wave 3（with T10–T15, T20）
  - **Blocks**: T21 | **Blocked By**: **T8（diff 语义）, T10（服务端实现 — 本任务的 GREEN 依赖）**

  **References**:
  - **Pattern References**:
    - `src/background/import-export-service.ts:209-210` — `state.rules = preview.rules`（**F2 根因**，本测试须使其失败）
    - `tests/integration/import-export-service.test.ts:23-32` — `makeSlot` 夹具与既有集成测试骨架
  - **API/Type References**:
    - 设计 §1.1 表格 F2 行 + §1.2 判据 A（保真）
    - `2026-10-04-import-export-decisions.yaml`：G4（A 保真）
  - **WHY Each Reference Matters**: F2 是本次迭代**两个静默数据损坏**之一，且既有测试**未覆盖**（G-E）→ 该测试是"修复有效"的唯一客观证据。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`npx vitest run tests/integration/import-fidelity.test.ts` **初始失败**（证明缺陷可复现）
  - [ ] GREEN（T10 完成后）：同命令 ALL PASS
  - [ ] 断言使用**深比较**（非长度比较），逐字段

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: keep-existing 路径规则逐条不变（happy — F2 直击）
    Tool: Bash (vitest)
    Preconditions: 目标机 3 条规则（含 priority/时间戳差异）；pkg 携带 0 条规则
    Steps:
      1. 记录 before = (await repo.getSyncState()).rules
      2. 走 INSPECT→APPLY（维度模式 rules='incremental'，无携带）
      3. const after = (await repo.getSyncState()).rules
      4. 断言 JSON.stringify(after) === JSON.stringify(before)
    Expected Result: 规则数组逐条不变（现网会清空 → 本测试初始必须失败）
    Failure Indicators: 规则被清空/被改写
    Evidence: _context-output/evidence/task-9-fidelity-rules.txt

  Scenario: 未携带全局维度不动（edge — G4-A）
    Tool: Bash (vitest)
    Preconditions: pkg 只携带 rules；当前 matchSettings 非默认
    Steps:
      1. 记录 before settings
      2.APPLY 后断言 settings 三项 === before
    Expected Result: 未勾选维度零改动
    Evidence: _context-output/evidence/task-9-fidelity-settings.txt
  ```

  **Evidence to Capture**: `task-9-fidelity-rules.txt`、`task-9-fidelity-settings.txt`

  **Commit**: YES（groups with T9）
  - Message: `test(integration): prove keep-existing path preserves rules (F2 guard)`
  - Files: `tests/integration/import-fidelity.test.ts`
  - Pre-commit: `npm run test:integration`

- [ ] **T10. 服务端重算 + 绑定预览版本号（服务端权威 + 修 F4）**

  **What to do**:
  - `IMPORT_APPLY` 的**服务端实现骨架**（`import-export-service.ts`）：**仅凭「文件字符串 + 意图」**重算，不信 UI 的 preview（C4）
    - 解析文件字符串（T1 的守卫 + T3 的域校验）→ 重算 diff（T8）→ 与 `IMPORT_INSPECT` 结果比对（不一致 → 拒绝并回到预览）
  - **绑定预览版本号**（C3/F4）：`APPLY` 载荷携带 `configVersion`（= `INSPECT` 时读到的），服务端 `writeSync(expectedVersion, …)` 用它做乐观锁 → **修 F4**（今日 UI 不带 → 后端取当前 → 必然通过）
  - `APPLY` 复用 `INSPECT` 当时读到的那一份字符串（D12）：服务端**不重读磁盘**、**不做指纹**
  - **RED 测试**（先写）：`tests/integration/import-apply-version-binding.test.ts`
    - 版本漂移：APPLY 携带的 `configVersion` 落后当前 → `CONFIG_CONFLICT`/`STALE_VERSION`，**配置零改动**
    - 服务端重算与 UI 声称不符 → 拒绝
    - 正常路径 → 单次 `writeSync` 成功、版本 +1

  **Must NOT do**:
  - 不信任 UI 回传的 `preview` 作为权威（C4）
  - 不做文件指纹/重读（D12 构造性同一）
  - 不实现清空图标槽（T11）与补偿（T16）
  - 不保留"后端取当前版本"的兜底（`?? this.repo.getConfigVersion()` 的语义须改变——见 T17）

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 权威边界 + 并发保护 + F4，属最高风险点之一
  - **Skills**: [`sw-tdd-agent`, `sw-reviewer-logic`, `sw-reviewer-security`]
  - **Skills Evaluated but Omitted**: `sw-strategic-advisor`（设计已定，无需再咨询）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 3（with T9, T11–T15, T20）
  - **Blocks**: T17 | **Blocked By**: T1, T8

  **References**:
  - **Pattern References**:
    - `src/background/import-export-service.ts:167-225` — `commitImport`（现网 commit；`expectedVersion` 参数已在，但 UI 从未传） 
    - `src/background/storage-repository.ts:251-295` — `writeSync` 乐观锁（`current.configVersion !== expectedVersion` → `CONFIG_CONFLICT`）
    - `src/background/worker-orchestrator.ts:755-758` — `?? this.repo.getConfigVersion()`（**F4 根因**）
    - `src/ui/settings/App.tsx:2073-2076` — UI 现状（不带 `configVersion`）
  - **API/Type References**:
    - 设计 §3.3（提交权威在服务端）+ §3.4（预览即合同）+ §3.5（原子性 / F4 并入）
    - `2026-10-04-import-export-decisions.yaml`：C3 / C4 / D12
  - **WHY Each Reference Matters**: C4 的既有注释（`import-export-service.ts:176-179`）自证"preview may have been built by hand or mutated"→ 权威不能交客户端；`writeSync` 的乐观锁**已存在**，只是 UI 从不传版本号使其**必然通过**（F4）。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run tests/integration/import-apply-version-binding.test.ts` → ALL PASS
  - [ ] 断言版本冲突时**配置零改动**（前后 `getSyncState()` 全等）
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 预览后版本漂移被拦截（happy — F4 修复）
    Tool: Bash (vitest)
    Preconditions: INSPECT 读到 configVersion=5；随后另一写入使当前版本=6
    Steps:
      1. APPLY(fileStr, intent, expectedVersion=5)
      2. 断言 result.success === false 且 errorCode 为版本冲突类
      3. 断言 (await repo.getSyncState()).configVersion === 6（零改动）
    Expected Result: 乐观锁真正生效（现网"必然通过"→ 本测试初始失败）
    Failure Indicators: 写入成功（漂移未被拦截）
    Evidence: _context-output/evidence/task-10-stale-version.txt

  Scenario: 服务端重算与声称不符则拒绝（failure — C4）
    Tool: Bash (vitest)
    Preconditions: 构造"UI 声称的预览"与"文件实际内容"不一致
    Steps:
      1. APPLY → 断言拒绝（服务端以文件为准重算，发现不一致）
    Expected Result: 权威在服务端
    Evidence: _context-output/evidence/task-10-server-authority.txt
  ```

  **Evidence to Capture**: `task-10-stale-version.txt`、`task-10-server-authority.txt`

  **Commit**: YES（groups with T10）
  - Message: `feat(background): server-authoritative apply bound to preview configVersion (fix F4)`
  - Files: `src/background/import-export-service.ts, tests/integration/import-apply-version-binding.test.ts`
  - Pre-commit: `npm run test:integration`

- [ ] **T11. 替换记录时清空其图标存储槽（作用域严格 / 原子 / 补偿）**

  **What to do**:
  - 在 `IMPORT_APPLY` 写入流程内实现 C10：对**本次真正写入**（`decision='import'`）的 slot/rule，**先清掉目标机该记录的本地图标键**（`icon:slot-N` / `icon:${ruleId}`），再写入
    - **作用域严格**（C10-①）：`keep existing` 的记录**一个字节不动**
    - **原子**（C10-②）：清空与写入**同属一次操作**；**失败即补偿回滚**（跨存储区无事务 → 顺序 + 补偿，见 §3.6）
  - 实现顺序（设计 §3.6）：① 记录被清空键的**原值快照**（内存内）→ ② 改/删 local 图标键 → ③ 写 sync 配置 → ③ 失败 → ④ 用快照**恢复 local 键**
  - **RED 测试**（先写）：`tests/integration/import-icon-slot-clearing.test.ts`
    - 目标机 slot 3 有图标键 `icon:slot-3`；导入替换 slot 3 → 断言 **`icon:slot-3` 被删除**（引用必然解析失败 → 稳定落入缺失）
    - `keep existing` 的 slot → 断言其图标键**仍在**
    - 注入 sync 写失败 → 断言 `icon:slot-3` **恢复原值**、`configVersion` 不变（补偿，依赖 T0）

  **Must NOT do**:
  - 不对 `keep existing` 记录做任何改动（G4-A 保真）
  - 不实现撤销/快照（C10-③ 已作废：清空 = **永久删除**）
  - 不改引用键格式（C10 明确否决"加内容哈希"——会迫使迁移 → 数据回归）

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 跨存储区原子性近似 + 补偿，最易出"不一致窗口"
  - **Skills**: [`sw-tdd-agent`, `sw-reviewer-logic`, `sw-systematic-debugging`]
  - **Skills Evaluated but Omitted**: `sw-reviewer-performance`

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 3（with T9, T10, T13–T15, T20）
  - **Blocks**: T16 | **Blocked By**: T0（失败注入）, T12（配方承载/上送语义）

  **References**:
  - **Pattern References**:
    - `src/background/storage-repository.ts:373-403` — `offloadLargeIcons`（**引用键派生**：`icon:${rule.id}` / `icon:slot-${slot.id}`）
    - `src/background/storage-repository.ts:251-295` — `writeSync`（单次配置写入；`expectedVersion` 乐观锁）
    - `src/background/storage-repository.ts:301-330` — `setSyncWithRetry`（1 次重试 + fallback local —— 补偿须覆盖这些失败形态）
    - `src/background/storage-repository.ts:823-838` — `setPendingUndo`/`getPendingUndo`（**lazy TTL 模式**，仅作"MV3 挂起下失效"的参考，**不用于导入撤销**）
  - **API/Type References**:
    - 设计 §3.6（跨存储区无事务）+ §3.7（替换记录须清空图标存储槽）
    - `2026-10-04-import-export-decisions.yaml`：C10（三条派生）+ C3
  - **WHY Each Reference Matters**: §3.7 指出"假成功"比破图**更糟**（用户看到正常图标不会重选）；而 C2 修好导出后**该隐患才被暴露**——它不是"要不要修"而是"怎么修"。补偿路径只在失败时执行，故必须主动注入失败才测得到（A13）。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run tests/integration/import-icon-slot-clearing.test.ts` → ALL PASS（含注入失败 → 补偿）
  - [ ] 断言 keep-existing 记录的图标键**未被触碰**
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 替换记录清空图标槽（happy — C10）
    Tool: Bash (vitest)
    Preconditions: adapter 就绪；目标机 slot 3 已 offload → localStorage['icon:slot-3'] 存在
    Steps:
      1. APPLY 替换 slot 3（decision='import'）
      2. 断言 adapter.state.localStorage['icon:slot-3'] === undefined
      3. 断言 getSyncState() 中 slot 3 图标引用解析失败 → missing
    Expected Result: 稳定落入"缺失"，杜绝"假成功取到目标机自己的图标"
    Failure Indicators: 'icon:slot-3' 仍在（会假成功）
    Evidence: _context-output/evidence/task-11-clear-slot.txt

  Scenario: sync 写失败 → local 图标键补偿恢复（failure — C10-② / A13）
    Tool: Bash (vitest)
    Preconditions: 目标机 slot 3 图标键 = 'ORIGINAL_URI'；adapter.failStorageSet('sync')
    Steps:
      1. APPLY 替换 slot 3
      2. 断言 result.success === false
      3. 断言 adapter.state.localStorage['icon:slot-3'] === 'ORIGINAL_URI'（已恢复）
      4. 断言 (await repo.getSyncState()).configVersion 未变
    Expected Result: 零改动 + local 恢复（补偿生效）
    Failure Indicators: 图标键被永久删除（补偿缺失）/ 版本被推进
    Evidence: _context-output/evidence/task-11-compensation.txt

  Scenario: keep-existing 记录零触碰（edge — C10-① / G4-A）
    Tool: Bash (vitest)
    Preconditions: slot 4 图标键存在，导入 decision='keep existing'
    Steps:
      1. APPLY 后断言 adapter.state.localStorage['icon:slot-4'] 原值不变
    Evidence: _context-output/evidence/task-11-keep-untouched.txt
  ```

  **Evidence to Capture**: `task-11-clear-slot.txt`、`task-11-compensation.txt`、`task-11-keep-untouched.txt`

  **Commit**: YES（groups with T11）
  - Message: `feat(background): clear replaced records' icon slots with compensation`
  - Files: `src/background/storage-repository.ts, src/background/import-export-service.ts, tests/integration/import-icon-slot-clearing.test.ts`
  - Pre-commit: `npm run test:integration`

- [ ] **T12. 配方承载与渲染落点（background **原样上送**；渲染落点 = UI 侧 — Q1=A）**

  > **v2 重写说明**：v1 要求"存储层读取时由注入的 PNG 渲染器渲染"，与 **用户裁定 Q1=A** 冲突且自证不可行（计划自身记录 background **无 canvas**，见 §Research Findings #15/#16（`:87-90`）；`generateTemplateIcon` 只产 SVG 且被闸门拒，`url-utils.ts:628`）。若按 v1 实现，background 侧的"注入同签名渲染器"**跨进程不可得** → 只会**永远走降级占位**，配方在展示链路**永不渲染**（即功能是坏的）。本版按 Q1=A 重写。

  **What to do**:
  - **存储层只持久化配方**（`type:'template'` + `backgroundColor`/`text`/`textColor`），**不渲染**、**不注入渲染器**、**不产 SVG**（Q1=A）
  - `getSyncState` 路径（`storage-repository.ts:226` → `resolveIconReferences`）仅处理 **`local-icon:` 引用解引用**（既有行为，`ICON_REF_PREFIX`）；对 `type:'template'` **原样保留对象**上送 UI（**新增守卫**：不要在此路径引入 `renderIconToDataUri` / canvas）
  - **渲染落点 = UI 侧**（Q1=A）：在 UI 展示处（`src/ui/sidebar`、`src/ui/settings`、`src/ui/import-preview`）调用既有 `renderIconToDataUri`（`IconEditor.tsx:66-105`，canvas 产 **PNG**）把配方渲染为 PNG data URI 供**展示**；渲染结果**只作展示/缓存**，不持久化（A6：配方是唯一真源）
  - **UI 侧记忆化**（避免展示处高频重渲染）：在 UI 渲染层复用/新增轻量 memo（按配方签名）；**不得**给 background 引入渲染缓存（无渲染即无需缓存）
  - **`template` 既有隐患处理**：`resolveForDisplay` 的 `template` 分支（`icon-service.ts:404-406`）会调 `generateTemplateIcon` 产 **SVG**——本任务须**移除/停用该分支对配方的 SVG 渲染**（改为返回占位或交由 UI 渲染），使其不再产被闸门拒的形态；`getPlaceholder()`（`:386-393`）**保持不变**（既有静态占位，见 Must NOT）

  **Must NOT do**:
  - **不在 background 渲染配方**（Q1=A）——`src/background/` 内不出现 `renderIconToDataUri`、不引入 canvas、不注入"PNG 渲染器"
  - **不新增依赖/权限**（Q1=A 明令否决 B 方案"background PNG 编码"）
  - 不让 background 产位图 bytes 进包（C1）
  - **不把配方渲染结果持久化**（A6：渲染值只作缓存，配方是唯一真源）
  - **不改动 `getPlaceholder()`**（既有静态 SVG 占位，非配方渲染；`resolveForDisplay(undefined)`/未命中路径仍返回它）

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 裁定落地 + 跨层职责边界（存储上送 vs UI 渲染）+ 既有 `resolveForDisplay` 行为收敛
  - **Skills**: [`sw-tdd-agent`] — 职责边界清晰，无需再咨询（Q1 已裁定）
  - **Skills Evaluated but Omitted**: `sw-strategic-advisor`（v1 曾用于"渲染落点属架构权衡"；**裁定已完成**，无需顾问复核）

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 2（with T5–T8）
  - **Blocks**: T11, T13 | **Blocked By**: T2

  **References**:
  - **Pattern References**:
    - `src/background/storage-repository.ts:226,410-442` — `getSyncState` → `resolveIconReferences`（**只解 `local-icon:` 引用**；配方**原样上送**的落点）
    - `src/background/storage-repository.ts:68,454-473` — `ICON_REF_PREFIX` + `resolveIconRef`（既有记忆化仅服务引用解引用，**不**服务配方渲染）
    - `src/background/icon-service.ts:401-419` — `resolveForDisplay` 的 `template` 分支（**须停用其对配方的 SVG 渲染**）
    - `src/background/icon-service.ts:354-362` — `generateTemplateIcon` 产 SVG（**域冲突根源**：仅 UI 不可用）
    - `src/background/icon-service.ts:386-393` — `getPlaceholder()`（既有静态 SVG 占位，**保留**）
    - `src/ui/components/IconEditor.tsx:66-105` — `renderIconToDataUri`（canvas → **PNG**；**UI 侧渲染落点**）
    - `src/shared/url-utils.ts:610,628-634` — `SAFE_DATA_IMAGE_SUBTYPES`（拒 `svg+xml`；放行 png/jpeg/webp）
  - **API/Type References**:
    - 设计 A6 条目（**含「⚠️ 渲染落点更正（2026-10-05，规划期发现 + 用户裁定 Q1=A）」段**）+ `…-design.md` §2.4 引用块 + `…-decisions.yaml` 的 `A6-recipe-value-model.revisions`
    - `2026-10-04-import-export-decisions.yaml`：A6（配方值模型）
  - **WHY Each Reference Matters**: 更正后的 A6 明确"渲染发生在 **UI 侧**（`renderIconToDataUri` 产出 PNG，可通过安全闸门）；background 侧将配方**原样传给 UI**"，且"**链路值模型依旧零改动**"。故本任务在 background 侧**只做守卫（不渲染）**，渲染职责移交 UI；`getPlaceholder()` 是**既有**占位（本就 SVG），不在"配方渲染"约束范围内。

  **Acceptance Criteria（TDD）**:
  - [ ] RED：`tests/unit/background/recipe-storage.test.ts` **初始失败**（先写"background 对 `type:'template'` 原样上送、不产 SVG、不调 `renderIconToDataUri`"的断言）
  - [ ] GREEN：`npx vitest run tests/unit/background/recipe-storage.test.ts` → ALL PASS（3 分支）
  - [ ] `tests/ui-smoke/recipe-render-ui.test.tsx`：UI 渲染路径（桩 `renderIconToDataUri` → 断言被调用且产物为 **PNG**）
  - [ ] 反例搜索：`rg "renderIconToDataUri" src/background/` → 0
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: background 对配方原样上送（happy — Q1=A 核心）
    Tool: Bash (vitest)
    Preconditions: syncState 中 slot 图标 = { type:'template', backgroundColor:'#2563EB', text:'A', textColor:'#FFFFFF' }
    Steps:
      1. const state = await repo.getSyncState()
      2. 断言 slot.uiMarker.icon.type === 'template' 且三配方字段完整（值未被改动）
      3. 断言其 value **不含** 'data:image/'（即未被渲染）
      4. 断言未调用 renderIconToDataUri（背景侧 spy 计数 === 0）
    Expected Result: 配方原样上送，background 不渲染
    Failure Indicators: 配方被 background 渲染成 data URI / 被替换为 SVG / 字段丢失
    Evidence: _context-output/evidence/task-12-recipe-passthrough.txt

  Scenario: background 不再产配方 SVG（failure — 修复既有隐患）
    Tool: Bash (vitest)
    Preconditions: syncState 含 template 配方
    Steps:
      1. const uri = await iconService.resolveForDisplay({ type:'template', backgroundColor:'#2563EB', text:'A' })
      2. 断言 uri **不等于** generateTemplateIcon(...) 的 SVG 产物
      3. 若返回占位 → 断言 uri === getPlaceholder()（既有占位，允许含 svg+xml）
    Expected Result: 配方路径不再产"会被闸门拒"的形态（停用或改判）
    Failure Indicators: 仍返回配方 SVG（会被 isSafeFaviconProtocol 丢弃）
    Evidence: _context-output/evidence/task-12-no-recipe-svg.txt

  Scenario: UI 侧渲染路径产出 PNG（happy — 渲染落点）
    Tool: Bash (vitest) + testing-library（桩 renderIconToDataUri）
    Preconditions: 桩返回 'data:image/png;base64,STUB'；渲染 sidebar/settings/import-preview 中的配方项
    Steps:
      1. render 含 template 配方的展示组件
      2. 断言桩被调用 === 1（含 backgroundColor/text/textColor）
      3. 断言展示的 icon src === 'data:image/png;base64,STUB' 且不含 'svg'
    Expected Result: 渲染落在 UI 侧且产 PNG，可通过安全闸门
    Failure Indicators: 未渲染 / 产物为 svg / 未传 textColor
    Evidence: _context-output/evidence/task-12-ui-render-png.txt
  ```

  **Evidence to Capture**: `task-12-recipe-passthrough.txt`、`task-12-no-recipe-svg.txt`、`task-12-ui-render-png.txt`

  **Commit**: YES（groups with T12）
  - Message: `refactor(background): pass template recipes through unrendered; render at UI side (Q1=A)`
  - Files: `src/background/storage-repository.ts, src/background/icon-service.ts, src/ui/shared/recipe-render.ts`（新，UI 侧渲染 + memo）, `tests/unit/background/recipe-storage.test.ts, tests/ui-smoke/recipe-render-ui.test.tsx`
  - Pre-commit: `npm run typecheck && npm run test:unit`

- [ ] **T13. `IconSource.textColor` 持久化 + 读取侧还原**

  **What to do**:
  - 打通 `textColor` 全链路：`IconConfig.textColor` → `IconSource.textColor`（T7 已写入）→ 存储 → 读取（**原样上送**，T12）→ **UI 侧渲染**（T12 的 `recipe-render`）→ 包（T5 recipe）
  - 补齐 `import-export-service`/映射层的 `textColor` 透传（若 T1/T5 已覆盖则仅补测试）
  - **RED 测试**（先写）：`tests/unit/shared/recipe-roundtrip-textcolor.test.ts`
    - `{type:'template', backgroundColor, text, textColor}` 经"存储→读取"后 `textColor` 完整（读取**不渲染**，只透传）
    - 经"导出→包→导入"往返后 `textColor` 完整（与 T1 往返测试互补，聚焦单字段）

  **Must NOT do**:
  - 不改渲染算法（**UI 侧渲染**由 T12 负责；本任务不涉 background 渲染）
  - 不引入新字段（`textColor` 是唯一新增）

  **Recommended Agent Profile**:
  - **Category**: `quick` — Reason: 单字段透传 + 往返断言
  - **Skills**: [`sw-tdd-agent`]

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 3（with T9–T11, T14, T15, T20）
  - **Blocks**: None | **Blocked By**: T2, T12

  **References**:
  - **Pattern References**:
    - `src/ui/components/IconEditor.tsx:17-22,95-96,156-158` — `textColor` 的产生与使用（`autoTextColor` 回退）
    - `src/shared/types.ts:55-65` — `IconSource`（T2 已加 `textColor`）
  - **API/Type References**:
    - `2026-10-04-import-export-decisions.yaml`：C1（"含新的 textColor"）
    - C1 已核实事实块：`IconConfig` 有 `textColor`、`IconSource` **没有** → 配方持久化需 schema 工作
  - **WHY Each Reference Matters**: 若不补齐 `textColor`，配方渲染会用 `autoTextColor` 回退 → **静默改变用户图标外观**（属 F3 同类静默降级）。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run tests/unit/shared/recipe-roundtrip-textcolor.test.ts` → PASS
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: textColor 全链路保真（happy）
    Tool: Bash (vitest)
    Preconditions: —
    Steps:
      1. const src = { type:'template', value:'', backgroundColor:'#000000', text:'A', textColor:'#FF0000' }
      2. 经存储写入→读取 → 断言 textColor === '#FF0000'
      3. 经 export→package→import → 断言 textColor === '#FF0000'
    Expected Result: 自定义文本色不丢失（否则回退 autoTextColor 会静默改外观）
    Evidence: _context-output/evidence/task-13-textcolor-roundtrip.txt

  Scenario: 未设 textColor 保持 undefined（edge）
    Tool: Bash (vitest)
    Preconditions: —
    Steps:
      1. src 无 textColor → 往返后断言 textColor === undefined（而非被填默认值）
    Expected Result: 不引入"静默填充默认"（C8 宽容须显式披露，不在此处）
    Evidence: _context-output/evidence/task-13-textcolor-absent.txt
  ```

  **Evidence to Capture**: `task-13-textcolor-roundtrip.txt`、`task-13-textcolor-absent.txt`

  **Commit**: YES（groups with T13）
  - Message: `feat(shared): carry IconSource.textColor through storage and package round-trip`
  - Files: `src/shared/export-package.ts, src/shared/import-diff.ts, tests/unit/shared/recipe-roundtrip-textcolor.test.ts`
  - Pre-commit: `npm run test:unit`

- [ ] **T14. 协议重构（`messages.ts` / `types.ts` / `KNOWN_ACTIONS` / `message-client` — 必须同提交）**

  **What to do**:
  - **删除**旧契约：`ExportConfigRequest`/`ExportConfigResponse`（`messages.ts:208-210,496-499`）、`ImportPreviewRequest`/`ImportPreviewResponse`（`:212-215,486-489`）、`ImportCommitRequest`（`:217-223`）、`ExportPayload`/`ImportPreview`/`ImportSlotConflict`/`ImportSlotDecision`（`types.ts:209-239`）
  - **新增**三动作契约（A11）：
    ```
    ExportPackageRequest  { action:'EXPORT_PACKAGE'; payload:{ scope: ExportScope } }
    ImportInspectRequest  { action:'IMPORT_INSPECT'; payload:{ file: string } }
    ImportApplyRequest    { action:'IMPORT_APPLY'; payload:{ file: string; intent: ImportIntent } }  // configVersion 走 RequestBase
    ```
    + 对应 Response（`ImportInspectResponse` 携带 `ImportInspection`；`Export` 携带包字符串；`Apply` 携带 `ImportApplyResult`）
  - **`KNOWN_ACTIONS`**（`worker-orchestrator.ts:45-94`）＋ `UiRequest` 联合类型（`messages.ts:389-433`）**同提交**更新：删 3 旧动作、加 3 新动作（G-D：防"编译过、运行被拒"）
  - `message-client.ts`（`src/ui/shared/message-client.ts:14,288-294`）移除 `ImportPreview`/`ImportSlotConflict` import（`:14`）与导入/导出封装（`:284-294`）；加三动作封装
    （**行号更正**：v1 误写 `:192` —— 该行是 `getCommands`，与导入/导出无关）
  - **RED 测试**（先写）：`tests/unit/shared/messages-import-export-contract.test.ts`
    - 断言 `UiRequest['action']` 含三新动作、**不含**三旧动作（类型级 + 运行时白名单）
    - 断言 `KNOWN_ACTIONS` 与联合类型**无差集**（防手写白名单漏项）

  **Must NOT do**:
  - 不在本任务实现服务端逻辑（T10/T17 已/将实现）
  - 不保留旧动作的兼容分支（G1 不背兼容）
  - 不新增第四动作 `EXPORT_DESCRIBE`（A11/YAGNI）

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 牵动 4 处 + 类型联合，回归面最广
  - **Skills**: [`sw-tdd-agent`, `sw-codebase-explorer`]
  - **Skills Evaluated but Omitted**: `sw-reviewer-security`

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 3（with T11–T13, T15）
  - **Blocks**: T17 | **Blocked By**: T1, T2, T3

  **References**:
  - **Pattern References**:
    - `src/shared/messages.ts:207-223` — 旧三动作契约（删除对象）
    - `src/shared/messages.ts:389-433` — `UiRequest` 联合（须同步）
    - `src/background/worker-orchestrator.ts:45-94` — `KNOWN_ACTIONS` 手写白名单（含 `EXPORT_CONFIG`/`IMPORT_PREVIEW`/`IMPORT_COMMIT`）
    - `src/ui/shared/message-client.ts:14,288-294` — `ImportPreview`/`ImportSlotConflict` 引用点（`:14` 为 import；`:288-294` 为 `importPreview`/`importCommit` 封装）
  - **API/Type References**:
    - 设计 §3.1（三动作）§3.3（意图载荷形状）；A10/A11
    - `2026-10-04-import-export-decisions.yaml`：A10（协议重构，如实记录 4 处代价）/ A11
  - **Test References**:
    - `tests/unit/shared/messages.test.ts:59` — 既有 `IMPORT_PREVIEW` 断言（须迁移）
  - **WHY Each Reference Matters**: `KNOWN_ACTIONS` 是**手写**白名单且"guard 在 dispatch 之前"（`:41-44` 注释）→ 只改联合类型会让新动作在运行时被拒；A10 已如实记录这 4 处代价。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run tests/unit/shared/messages-import-export-contract.test.ts` → ALL PASS
  - [ ] 反例搜索：`rg "EXPORT_CONFIG|IMPORT_PREVIEW|IMPORT_COMMIT" src/shared/messages.ts src/background/worker-orchestrator.ts` → 0
  - [ ] `npm run typecheck` → 0 error（证明无残留引用）

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 三动作契约与白名单一致（happy — G-D）
    Tool: Bash (vitest)
    Preconditions: —
    Steps:
      1. 断言 KNOWN_ACTIONS 含 'EXPORT_PACKAGE'|'IMPORT_INSPECT'|'IMPORT_APPLY'
      2. 断言 KNOWN_ACTIONS 不含 'EXPORT_CONFIG'|'IMPORT_PREVIEW'|'IMPORT_COMMIT'
      3. 类型级断言：UiRequest 联合与 KNOWN_ACTIONS 无差集
    Expected Result: 契约与守卫一致（避免"编译过、运行被拒"）
    Failure Indicators: 白名单漏新动作 / 残留旧动作
    Evidence: _context-output/evidence/task-14-contract-consistency.txt

  Scenario: 旧动作彻底消失（failure — 反例搜索）
    Tool: Bash (ripgrep)
    Preconditions: 全部改动已落地
    Steps:
      1. rg "EXPORT_CONFIG|IMPORT_PREVIEW|IMPORT_COMMIT" src/ → 断言 0 命中
    Expected Result: 无残留（除测试迁移文件外）
    Evidence: _context-output/evidence/task-14-legacy-actions-gone.txt
  ```

  **Evidence to Capture**: `task-14-contract-consistency.txt`、`task-14-legacy-actions-gone.txt`

  **Commit**: YES（groups with T14）
  - Message: `refactor(shared): redesign import/export protocol to EXPORT_PACKAGE/IMPORT_INSPECT/IMPORT_APPLY`
  - Files: `src/shared/messages.ts, src/shared/types.ts, src/background/worker-orchestrator.ts, src/ui/shared/message-client.ts, tests/unit/shared/messages-import-export-contract.test.ts, tests/unit/shared/messages.test.ts`
  - Pre-commit: `npm run typecheck && npm run test:unit`

  > **⚠️ 实施期修正（2026-10-05）：T14 拆为两阶段（T14a / T14b）**
  >
  > **冲突（实施期发现）**：T14 的验收要求「`typecheck` → 0 error」+「`rg "EXPORT_CONFIG|IMPORT_PREVIEW|IMPORT_COMMIT" src/` → 0」，但旧三动作仍有**活体调用者且全属下游**——
  > `src/ui/settings/App.tsx:2013/2044/2070`（T18/T19）、`tests/integration/full-suite.test.ts:132/139`、`tests/unit/shared/messages.test.ts:58-60,275,301`（T21）。
  > ⇒ **单独在 Wave 3 删除旧动作必然破坏构建**（违反"每个提交自洽"）。
  >
  > **为何不能"把 T14 后移到 T18 之后"**：计划依赖图已是 `T14 → T17 → T18`（T18 `Blocked By` 含 T17；T17 `Blocked By` 含 T14）⇒ 后移会**成环**。
  >
  > **裁定：拆两阶段。**
  > - **T14a（本波，Wave 3）**：**只新增**三动作契约（`messages.ts`/`types.ts`）+ 3 个 `KNOWN_ACTIONS` 项 + `message-client` 3 封装；**保留**旧动作共存（`UiRequest` 联合与白名单各含 6 项，编译自洽）。验收：新契约测试绿 + `typecheck` 0 error。**"src/ 反例 0"不在本阶段验收。**
  > - **T14b（并入 T21 收口，Wave 5）**：**删除**旧契约 / 旧 `switch case`（`worker-orchestrator.ts:761/764/767`）/ 旧 `KNOWN_ACTIONS` 项 / 旧 `message-client` 封装；迁移 `messages.test.ts` / `full-suite.test.ts` 锚点；`rg "EXPORT_CONFIG|IMPORT_PREVIEW|IMPORT_COMMIT" src/` → **0**。此时 settings 已迁移（T18/T19 完成），删除安全。
  > - **T17 的 `Blocked By` 由 `T14` 改为 `T14a`**（新动作契约就位即可接线；旧 case 的删除归 T14b）。
  >
  > **⚠️ T14b 反例锚点更正（2026-10-05，审查发现原锚点过窄）**：原 `rg "EXPORT_CONFIG|IMPORT_PREVIEW|IMPORT_COMMIT"` **只覆盖动作字面量**，漏报同族旧契约（非大写、`rg` 不匹配）⇒ 会"锚点打 0 而旧契约仍在"。**增补同族锚点**（`\b` 防误匹配 `ImportPreviewTable`）：
  > ```
  > rg -n "\b(ExportConfigRequest|ExportConfigResponse|ImportPreviewRequest|ImportPreviewResponse|ImportCommitRequest|ImportSlotConflict|ImportSlotDecision|ExportPayload|ImportPreview)\b" src/   → 0
  > ```
  > **名称歧义消解**：`ImportPreview` = **旧类型，删**（本文档 `:147`）；`ImportPreviewTable` = **组件，保留并由 T20 演进**（`:1977`）；新版类型名为 `ImportInspection`，不复用旧名。
  > `message-client.ts` 三个旧方法（`exportConfig`/`importPreview`/`importCommit`）须与 `KNOWN_ACTIONS` **同步删除**。
  >
  > **W5 基线（实测，T14b 须收敛）**：动作字面量 **15** 处；同族旧类型（`\b` 列表）**32** 处；`ImportPreviewTable`/`ImportPreviewProps` **4** 处（豁免）。
  > **补锚点（服务方法名，原两锚点均抓不到）**：
  > ```
  > rg "\.(exportConfig|generatePreview|commitImport)\(" src/   → 0
  > ```
  > （`import-export-service.ts:42/82/199` + 调用点 `worker-orchestrator.ts:762/765/769`；否则"客户端能调、后台无 case"从服务层漏过。）
  >
  > **⚠️ 锚点范围更正之三（2026-10-05，第 9 次同族发现）：锚点须排除注释/文档命中**
  > `rg "EXPORT_CONFIG|IMPORT_PREVIEW|IMPORT_COMMIT" src/ tests/` 会命中**注释与说明文本** —— 而**注释提及历史动作是合理的**（如
  > `worker-orchestrator.ts:808` 解释 F4 与 legacy 的差异；`worker-import-export-routing.test.ts:10/79` 同理）。
  > **实测分类（HEAD `7e1db9e`）**：
  > | 范围 | 报数 | **代码命中** | 注释/文档命中 |
  > |---|---|---|---|
  > | `src/` | 18 | **17** | 1（`worker-orchestrator.ts:808`） |
  > | `tests/` | 12 | 约 **8**（`full-suite:132/139` + `messages.test:58-60/279/305`；`contract.test:50` 是 `LEGACY_ACTIONS` 常量） | 4+（注释/文档） |
  > **裁定**：**锚点以"可执行代码"为界**；纯文本命中（注释/文档）**不构成待迁移项**，不要求归 0。
  > 且下列两处须按**语义翻转**（非清零）处理：
  > - `messages-import-export-contract.test.ts:50` 的 `LEGACY_ACTIONS` + "legacy trio stays registered" 断言 ⇒ T14b 翻转为"**已删除**"；
  > - `worker-import-export-routing.test.ts` 的注释 ⇒ 保留或改写为历史说明。
  > **T14b 开工时须重跑 + 逐行分类取当日真值**（数字会漂：`src/` 已从 15→18、同族类型 32→44）。
  >
  > **✅ 已机械化的锚点变体（2026-10-05，实测命中 = 25 = 17 + 8，与人工分类精确吻合）**：
  > ```
  > rg -n --glob '*.ts' --glob '*.tsx' "^[^*/]*\b(EXPORT_CONFIG|IMPORT_PREVIEW|IMPORT_COMMIT)\b" src/ tests/
  > ```
  > 行首非 `*`/`//` ⇒ 排除整行注释（实测全数排除 `:808`、`routing.test:10/79`、`contract.test:4/5`）。
  > **局限**：仍会命中**行尾注释**（当前无此类）⇒ 阈值以"**人工分类后的代码数**"为准（`src/` **17**、`tests/` **8**），`rg` 只作**回归预警**。
  >
  > **T14b 语义翻转清单（精确落点，reviewer 补）**：
  > | 位置 | 现状 | T14b 应做 |
  > |---|---|---|
  > | `contract.test.ts:50` `LEGACY_ACTIONS` + `:59-63` 断言 | 断言 legacy **仍注册** | **翻转**为"legacy 已删"（`claimed===false`），非清零 |
  > | `messages.test.ts:58-60`（`assertNever` 的 legacy case） | 为穷尽性保留 | **同批删**（删后 `assertNever` 会再次报错 = T14a 那条 TDD 信号），删完 `tsc` 仍须 0 |
  > | `messages.test.ts:279/305`（断言数组含 legacy） | 断言 legacy 合法 | **翻转**为不含 |
  > | `routing.test.ts:10/79` | **纯注释**（历史对照） | **保留**（解释 F4 与 legacy 差异，有价值） |
  >
  > **副作用登记**：锚点若要求"注释也归 0"，会**逼删有价值注释**（如 `:808`、`routing.test.ts:10`）—— 这正是"以代码为界"的理由。
  >
  > **⚠️ 锚点范围更正之二（2026-10-05，审查第四次发现）：动作字面量锚点须含 `tests/`**
  > 原 `rg "...  " src/` 只覆盖 `src/`，但旧动作字面量**也在 `tests/`（实测 7 处）**：
  > `full-suite.test.ts:132`（`IMPORT_PREVIEW`）/ `:139`（`IMPORT_COMMIT`）；
  > `messages.test.ts:58-60`（三动作 switch case）/ `:279`（断言数组）/ `:305`（`IMPORT_COMMIT`）。
  > 若 T14b 只以 `src/` 归 0 为判据 ⇒ **测试层旧契约残留漏网**；且 `messages.test.ts:279/305` 是**断言旧动作存在**的测试，T14b 必须**同步改写**（否则"旧动作已删"与"测试仍断言它在"自相矛盾）。
  > **锚点口径扩为**：
  > ```
  > rg "EXPORT_CONFIG|IMPORT_PREVIEW|IMPORT_COMMIT" src/ tests/   → 0
  > ```
  > （与"迁移测试锚点"意图一致，此处仅把口径写实、纳入机械判据。）
  >
  > **附带（T14a 正确性证据，2026-10-05）**：`UiRequest` 联合加入新三动作后，**既有** `messages.test.ts:82` 的 `assertNever` **穷尽性护栏立即报错**（`TS2345: … is not assignable to parameter of type 'never'`）—— 这正是该护栏的作用：**新联合成员必须补 case**。T14a 必须为三新动作补 `switch` case（否则穷尽性门禁拦截）。**这是正确的 TDD 信号，非缺陷。**
  >
  > **⚠️ T17 硬门禁（2026-10-05，审查发现 BLOCKER + 机械证明）**
  >
  > **缺口**：T14a 后三新动作**过白名单**（`KNOWN_ACTIONS:79-81`）但 **`routeMessage` 无 case**（`git grep "case 'EXPORT_PACKAGE'…"` → 0）⇒ 落 `default`（`:1013`）返回 `UNKNOWN_ACTION` —— 正是 G-D 要防的"编译过、运行被拒"形态。**归属 T17**（T14=契约/白名单/客户端；T17=路由/接线/F4），且 T14a 无法补（缺服务方法 ⇒ 编译不过）。
  >
  > **测试盲区**：`handleMessage` 的 `claimed` 是**同步**白名单判定，异步 `routeMessage` 结果经回调返回 ⇒ 契约测试只断言 `claimed` **结构性看不到"白名单有、case 无"**（第 5 次"守卫集合不完备"同族）。
  >
  > **T17 三条硬门禁（缺一不闭合）**：
  > 1. 补三条 `routeMessage` case（需先补服务层 `exportPackage(scope)` / `inspect(file)`；`applyImport` 已有 `:278`）；
  > 2. `IMPORT_APPLY` 绑定 `request.configVersion`（缺失/漂移即拒）；
  > 3. **双重无差集证明**（两个不同面，均须）：
  >    a. **编译期穷尽性守卫**（覆盖 `AnyRequest ↔ routeMessage case`）：`default` 分支加 `const _exhaustive: never = request;` ⇒ 任何漏加 case 的联合成员 **tsc 直接报错**。零运行时副作用，比"运行时全量调用白名单"更强（后者会触发 `SAVE_SLOT`/`OPEN_PAGE`/`DOWNLOAD_ICON` 等**真实副作用**，须逐一 mock，脆弱）。
  >       （运行时不可达：`handleMessage:445` 的 `isKnownAction` 已挡未知 action；万一到达亦由 `.catch`（`:466`）转 `INTERNAL_ERROR`。）
  >    b. **`KNOWN_ACTIONS ↔ AnyRequest` 双向差集断言化**（编译期守卫**不覆盖**这一面，因白名单是**手写数组**而非类型推导）：把 executor 的一次性 `task-14a-diff-check.txt` 脚本**落为测试断言**，使"union ↔ 白名单无差集"成为**持续**护栏。
>    ⇒ **a + b 合起来**才是完整闭环；单做 a 会留下"白名单漏项"的口子。
> 4. T17 测试须**观察响应**（await `sendResponse` 回调），而非只看同步 `claimed`。
  >
  > **⚠️ 第 3 条最终形态（2026-10-05，审查二次自查 —— 两面均编译期闭环）**
  >
  > **(b) 改为编译期双 Exclude，而非运行时测试**（运行时**无法枚举 TS 类型**、手写列表必漂移）：
  > ```ts
  > // 语义注释：KNOWN_ACTIONS = worker 接收的全部 action（含 ContentRequest），非 UI-only
  > const KNOWN_ACTIONS = [
  >   'SAVE_SLOT', /* … */ 'SITE_SNAPSHOT_REPORT',
  > ] as const satisfies readonly AnyRequest['action'][];     // 白名单 ⊆ union（保留字面量元素类型）
  > type _Unknown      = Exclude<AnyRequest['action'], (typeof KNOWN_ACTIONS)[number]>;  // union ⊆ 白名单
  > type _NotAnAction  = Exclude<(typeof KNOWN_ACTIONS)[number], AnyRequest['action']>;  // 无幽灵项
  > const _bidirectional: [_Unknown, _NotAnAction] extends [never, never] ? true : never = true;
  > ```
  > **🔴 静默失效陷阱（必须先改声明形式）**：现声明是**宽注解**
  > `const KNOWN_ACTIONS: ReadonlyArray<AnyRequest['action']> = [...]`（`worker-orchestrator.ts:45`）
  > ⇒ 元素类型被擦成整个联合 ⇒ `(typeof KNOWN_ACTIONS)[number]` **等于** `AnyRequest['action']`
  > ⇒ `Exclude<…>` **恒为 `never`** ⇒ **守卫恒真、静默失效**（又一处"看着有、实际不管用"）。
  > **⇒ 必须先改成 `as const satisfies` 形式**，否则守卫是假的。
  >
  > **(a)**：`routeMessage` default（`:1012`）加 `const _exhaustive: never = request;`（管"case 漏了"）。
  > **(a) 与 (b) 正交**：(a) 管 case 漏项、(b) 管白名单漏项 + 幽灵项 ⇒ **两面都编译期闭环、零运行时成本、零手写漂移**。
  > `task-14a-diff-check.txt` 一次性脚本保留作证据，不再作护栏。
  >
  > **⚠️ 实现层两处连带（2026-10-05，审查预判 —— 否则 tsc 撞墙 / 留下假注释）**
  > - **③a `includes` 调用点须加宽转**：`as const` 把数组窄化为**只读字面量元组** ⇒
  >   `isKnownAction`（`worker-orchestrator.ts:105`）`KNOWN_ACTIONS.includes(action as AnyRequest['action'])`
  >   会报 `TS2345`（实参更宽）。修法：
  >   `(KNOWN_ACTIONS as readonly AnyRequest['action'][]).includes(action as AnyRequest['action'])`。
  >   否则 executor 一加 `as const` 就撞 tsc 错，易误判"方案不可行"。
  > - **③b 同批改写 N4 注释**（`worker-orchestrator.ts:39-43`）：该注释现自述
  >   "does NOT force this list to stay in sync with the union … adding a new contract action
  >   without adding it here compiles fine" —— 守卫**恰恰消灭了这个 limitation** ⇒ 不改即为
  >   **与代码矛盾的假注释**（本轮反复出现的"文档/实现不一致"形态）。改为"双向由编译期守卫强制
  >   （`satisfies` + `Exclude`）"。**附带意义**：证明本守卫正好闭合了一个**已被代码自认**的既有缺口（N4）。
  > - **③c 语义注释锚点更正**：先前引用的 `messages.ts:234` **未**称"UI-only"（实为"每新动作须同批加入
  >   `UiRequest` 与 `KNOWN_ACTIONS`"）；**准确锚点是 `worker-orchestrator.ts:37`**"the action whitelist
  >   used to decide **whether the message port is claimed**"，且 `:96-98` 已含 3 个 content action。
  >   ⇒ 守卫用 `AnyRequest['action']` **正确**（worker 收件域 = `AnyRequest`，与 `routeMessage` 的
  >   `request: AnyRequest` 一致），**非"误报风险"**。注释写："`KNOWN_ACTIONS` = worker 收件域
  >   （= `AnyRequest`，含 ContentRequest），非 UI-only"。

- [ ] **T15. Firefox `commands.update()` + Chrome/Edge 差异报告**

  **What to do**:
  - 扩展适配器契约（`src/adapters/contract.ts:82-86`）：`commands.update(name, shortcut) : Promise<void>`（WebExtensions `commands.update`）、可选 `commands.reset(name)`
  - `chrome-adapter.ts`（`:54-71`）：实现 `update` —— Firefox 有 `browser.commands.update`；Chrome/Edge **无**该 API → 抛 `AdapterError('BROWSER_API_ERROR', …)` 或按能力探测返回 unsupported
  - `mock-adapter.ts`：加 `commands.update` 打桩（记录调用）+ 可注入 unsupported
  - **差异报告**：服务端/UI 依平台能力判定（D4）：
    - Firefox → 快捷键维度**自动应用**（`commands.update`）
    - Chrome/Edge → **只读**：展示差异 + 引导手动设置；该维度**不提供覆盖模式**（无法执行删除）
  - **RED 测试**（先写）：`tests/unit/adapters/commands-capability.test.ts`
    - Firefox 环境：`update` 生效（调用被记录）
    - Chrome/Edge 环境：`update` 抛 unsupported（或能力探测返回 false）
    - 二者**都不视为失败**（D4）

  **Must NOT do**:
  - 不隐藏快捷键维度（D4 明确否决）
  - 不做"包随平台变化"（D4 否决：Chrome→Firefox 迁移恰最需要）
  - 不新增 manifest `command` 条目（Guardrail 1）

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 跨浏览器能力差异 + 适配层契约变更
  - **Skills**: [`sw-tdd-agent`, `sw-external-researcher`] — `commands.update` 签名以 MDN 为准
  - **Skills Evaluated but Omitted**: `sw-feature-designer`

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 3（with T11–T14）
  - **Blocks**: T22（快捷键引导进入清单） | **Blocked By**: None（独立适配层）

  **References**:
  - **Pattern References**:
    - `src/adapters/contract.ts:81-86` — `commands` 契约现状（仅 `getAll`/`onCommand`/`removeCommandListener`）
    - `src/adapters/chrome-adapter.ts:54-73` — `getAll`/`onCommand` 实现（新 `update` 的同构落点）
    - `src/adapters/mock-adapter.ts:177-190` — `commands` 打桩模式
    - `src/background/worker-orchestrator.ts:869-871` — `GET_COMMANDS` 现状（只读，无 update）
  - **API/Type References**:
    - `src/adapters/contract.ts:NormalizedCommand` — 归一化命令形状
    - `2026-10-04-import-export-decisions.yaml`：D4（统一 schema 按能力降级）
    - 设计 §4.5（跨浏览器能力差异表）
  - **External References**:
    - MDN `browser.commands.update` / `chrome.commands`（确认 Chrome 无 update）
  - **WHY Each Reference Matters**: D4 的两条派生（Chrome/Edge 不提供覆盖模式 + 引导手动设置必须进清单）都以"适配层能如实报告能力"为前提；而"二者都不视为失败"避免把平台限制误报成导入错误。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run tests/unit/adapters/commands-capability.test.ts` → ALL PASS
  - [ ] 断言 Firefox 路径 `update` 可用；Chrome/Edge 路径如实报告 unsupported
  - [ ] `npm run typecheck && npm run build:firefox` → 成功
  - [ ] `rg "\"commands\"" manifests/` 无新增条目（Guardrail 1）

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: Firefox 快捷键自动应用（happy — D4）
    Tool: Bash (vitest)
    Preconditions: adapter.state.browserType = 'firefox'
    Steps:
      1. await adapter.commands.update('save-slot-1', 'Alt+1')
      2. 断言无抛错且 calls 含 commands.update
    Expected Result: Firefox 可自动应用快捷键
    Evidence: _context-output/evidence/task-15-firefox-update.txt

  Scenario: Chrome/Edge 如实报告不支持（failure — 不视为失败）
    Tool: Bash (vitest)
    Preconditions: adapter.state.browserType = 'chrome'
    Steps:
      1. 能力探测 / 调用 update → 断言返回 unsupported（或抛可识别错误）
      2. 断言 UI 分支进入"展示差异 + 引导手动设置"
    Expected Result: 平台限制被如实报告为引导，而非导入失败
    Evidence: _context-output/evidence/task-15-chrome-unsupported.txt
  ```

  **Evidence to Capture**: `task-15-firefox-update.txt`、`task-15-chrome-unsupported.txt`

  **Commit**: YES（groups with T15）
  - Message: `feat(adapters): add Firefox commands.update + Chrome/Edge capability reporting`
  - Files: `src/adapters/contract.ts, src/adapters/chrome-adapter.ts, src/adapters/mock-adapter.ts, tests/unit/adapters/commands-capability.test.ts`
  - Pre-commit: `npm run typecheck`

- [ ] **T16. 补偿路径集成测试（注入 adapter 失败 — A13 核心）**

  **What to do**:
  - 新增**专项补偿集成测试**：`tests/integration/import-compensation.test.ts`
    - **必须注入失败**（依赖 T0）：`failStorageSet('sync')` / `failNextStorageSet('sync')` / `failStorageSet('local','icon:slot-N')`
    - 覆盖设计 §3.6 的顺序 + 补偿：① 清 local 键 → ② 写 sync → ②失败 → ③恢复 local 键
    - 覆盖 `setSyncWithRetry`（`storage-repository.ts:301-330`）的失败形态：**首次失败 → 重试成功**（不算失败）、**两次失败 → fallback local**（须判定为成功还是失败，与设计一致）、**配额错误**（立即失败，不重试）
  - 断言不变式（C3）：失败后 `configVersion` **不变**、`syncState` **全等**、被清空的 local 图标键**已恢复**
  - **RED 测试**（先写）：先构造"当前无补偿"的失败场景，证明**图标键被永久删除**（即补偿缺失）→ 随 T11/T16 实现转绿

  **Must NOT do**:
  - 不实现新业务逻辑（本任务聚焦"制造失败 + 验证补偿"）
  - 不为"成功路径"再写测试（A13：成功路径恰是最不需要保护的一半）
  - 不使用真实浏览器（交给 F3）

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 补偿是最难测的真实工程点，A13 明确"能制造失败"是关键
  - **Skills**: [`sw-tdd-agent`, `sw-systematic-debugging`, `sw-reviewer-logic`]
  - **Skills Evaluated but Omitted**: `sw-reviewer-performance`

  **Parallelization**:
  - **Can Run In Parallel**: YES（with T17 — **同波互不依赖**）| **Parallel Group**: **Wave 4a**（with T17）
  - **Blocks**: T21 | **Blocked By**: T0, T11

  **References**:
  - **Pattern References**:
    - `src/background/storage-repository.ts:251-330` — `writeSync` + `setSyncWithRetry`（**补偿须覆盖的三种失败形态**）
    - `src/background/storage-repository.ts:373-403` — `offloadLargeIcons`（先写 local）
    - `src/background/storage-repository.ts:288-294` — 队列韧性（`syncWriteQueue.catch(...)` 保证队列不永久 reject —— 补偿须与之协调）
    - `tests/integration/import-export-service.test.ts:11-21,85-97` — 集成测试骨架与"安全预览仍提交"正例
  - **API/Type References**:
    - 设计 §3.6 / §7 Testing Strategy（"为何必须注入失败"）+ A13
    - `2026-10-04-import-export-decisions.yaml`：A13 / C10-② / C3
  - **WHY Each Reference Matters**: 设计明言"自然流向只走成功路径，而**成功路径恰恰是最不需要保护的一半**"——补偿路径只在失败时执行，"必须被主动测试"。`setSyncWithRetry` 的内部重试/fallback 意味着"失败"有**多种形态**，补偿必须在**所有**形态下成立。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run tests/integration/import-compensation.test.ts` → ALL PASS（≥4 失败形态）
  - [ ] 断言每个失败后：`configVersion` 不变 + `syncState` 全等 + local 图标键恢复
  - [ ] `npm run test:integration` → 全绿

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: sync 首次失败经重试成功 → 视为成功（happy — 重试语义）
    Tool: Bash (vitest)
    Preconditions: 目标机 slot 3 图标键存在；注入"下一次 sync set 失败"
    Steps:
      1. APPLY 替换 slot 3
      2. 断言 result.success === true（重试后成功）
      3. 断言 'icon:slot-3' 已按 C10 清空（最终写入成功）
    Expected Result: 一次重试内的瞬时失败不导致误补偿
    Evidence: _context-output/evidence/task-16-retry-success.txt

  Scenario: sync 持续失败 → 补偿恢复 local（failure — 核心不变式）
    Tool: Bash (vitest)
    Preconditions: 目标机 slot 3 图标键 = 'ORIGINAL'；failStorageSet('sync') 持久
    Steps:
      1. APPLY
      2. 断言 success === false
      3. 断言 localStorage['icon:slot-3'] === 'ORIGINAL'
      4. 断言 configVersion 未变、syncState 全等
    Expected Result: 零改动 + 补偿恢复
    Failure Indicators: 图标永久丢失 / 版本推进 / local 不一致
    Evidence: _context-output/evidence/task-16-persistent-failure.txt

  Scenario: 配额错误立即失败不重试（edge）
    Tool: Bash (vitest)
    Preconditions: 注入 quota 类错误
    Steps:
      1. APPLY → 断言失败且未触发 retry 延迟（calls 中 sync set 次数 === 1）
    Expected Result: 配额错误语义与瞬态错误区分（isQuotaError 分支）
    Evidence: _context-output/evidence/task-16-quota-no-retry.txt
  ```

  **Evidence to Capture**: `task-16-retry-success.txt`、`task-16-persistent-failure.txt`、`task-16-quota-no-retry.txt`

  **Commit**: YES（groups with T16）
  - Message: `test(integration): prove compensation path under injected storage failures`
  - Files: `tests/integration/import-compensation.test.ts`
  - Pre-commit: `npm run test:integration`

- [ ] **T17. 三动作接线（`worker-orchestrator` 路由 + `message-client` 封装 + F4 版本号）**

  **What to do**:
  - `worker-orchestrator.ts` 路由：把 `EXPORT_CONFIG`/`IMPORT_PREVIEW`/`IMPORT_COMMIT` 三 case（`:748-758`）替换为 `EXPORT_PACKAGE`/`IMPORT_INSPECT`/`IMPORT_APPLY`
    - `IMPORT_APPLY` 的版本号：**不再** `?? this.repo.getConfigVersion()`（F4 根因）；改为**强制**使用 `request.configVersion`（缺失/不合法 → `INVALID_REQUEST`）
  - `message-client.ts` 加三动作封装（含 `configVersion` 透传）
  - **RED 测试**（先写）：`tests/integration/worker-import-export-routing.test.ts`
    - 三动作经 `emitRuntimeMessage` 分发到服务并返回形状正确
    - `IMPORT_APPLY` **不带** `configVersion` → 被拒（不再兜底取当前版本）

  **Must NOT do**:
  - 不保留旧动作路由（T14 已删契约）
  - 不在 UI 层做权威推导（C4）
  - 不新增 `EXPORT_DESCRIBE`

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 路由 + F4 + 消息往返，跨 3 处
  - **Skills**: [`sw-tdd-agent`, `sw-codebase-explorer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES（with T16 — **同波互不依赖**）| **Parallel Group**: **Wave 4a**（with T16）
  - **Blocks**: T18, T19, T21 | **Blocked By**: T14, T10, T5, T6

  **References**:
  - **Pattern References**:
    - `src/background/worker-orchestrator.ts:748-758` — 旧三路由（替换对象）+ `:755-756`（**F4 根因**）
    - `src/background/worker-orchestrator.ts:45-94,96-100` — `KNOWN_ACTIONS` 与 `isKnownAction` guard
    - `src/background/worker-orchestrator.ts:473-477` — `SAVE_SLOT` 的 `request.configVersion ?? …` 模式（对照：导入**不得**沿用该兜底）
    - `src/ui/shared/message-client.ts:78-80`（`sendRaw`）+ `:282-294`（导入/导出封装，**新增三动作封装的落点**）— 既有封装模式
  - **API/Type References**:
    - `src/shared/messages.ts:26-31` — `RequestBase.configVersion`（广播载体）
    - 设计 §3.3 / §3.5（F4 并入）
  - **WHY Each Reference Matters**: F4 的修复点是**语义改变**——`?? getConfigVersion()` 使乐观锁"必然通过"；导入必须**强制**带版本号，否则"零改动"无法保证（C3）。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run tests/integration/worker-import-export-routing.test.ts` → ALL PASS
  - [ ] 断言 `IMPORT_APPLY` 缺 `configVersion` → 拒绝
  - [ ] `rg "EXPORT_CONFIG|IMPORT_PREVIEW|IMPORT_COMMIT" src/background/worker-orchestrator.ts` → 0
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 三动作路由正确（happy）
    Tool: Bash (vitest)
    Preconditions: orchestrator 就绪；mock adapter 有 slot
    Steps:
      1. emitRuntimeMessage({ action:'IMPORT_INSPECT', payload:{ file:'{…}' }, requestId:'1' }, …)
      2. 断言响应含 inspection（diff + 携带情况）
      3. emitRuntimeMessage({ action:'EXPORT_PACKAGE', payload:{ scope:… }, requestId:'2' }, …)
      4. 断言响应含包字符串
    Expected Result: 三动作可用且形状正确
    Evidence: _context-output/evidence/task-17-routing.txt

  Scenario: APPLY 缺版本号被拒（failure — F4）
    Tool: Bash (vitest)
    Preconditions: —
    Steps:
      1. emitRuntimeMessage({ action:'IMPORT_APPLY', payload:{ file, intent }, requestId:'3' }, …)  // 无 configVersion
      2. 断言 success === false（errorCode INVALID_REQUEST 或版本冲突类）
    Expected Result: 不再兜底取当前版本（乐观锁不再"必然通过"）
    Evidence: _context-output/evidence/task-17-missing-version-rejected.txt
  ```

  **Evidence to Capture**: `task-17-routing.txt`、`task-17-missing-version-rejected.txt`

  **Commit**: YES（groups with T17）
  - Message: `feat(background): wire three import/export actions + enforce configVersion`
  - Files: `src/background/worker-orchestrator.ts, src/ui/shared/message-client.ts, tests/integration/worker-import-export-routing.test.ts`
  - Pre-commit: `npm run typecheck && npm run test:integration`

- [ ] **T18. 导入 UI（维度模式 + diff 表 + 恒定量化确认弹窗）**

  **What to do**:
  - 重写 `ImportExportSection`（`settings/App.tsx:2008+`）的**导入部分**（单页，D6）：
    - 选文件 → `IMPORT_INSPECT(file)` → 展示 diff（**折叠到维度级**，可展开字段级：A12）
    - 组标题行放**维度模式选择器**（默认增量，A1）+ 组内「全部覆盖 / 全部保留」批量（D8）
    - 每条记录可逐条改（默认**双侧覆盖**，D8；未改动继承维度模式，A4）
    - 未携带维度（A2）：标注"本包未包含 X"，**不提供**选择器
    - 点「应用」→ **恒定确认弹窗**（D7）：量化删除 + [导出备份] + [我了解风险，确认导入]（**并列**，A9）
  - **提交时把 `IMPORT_INSPECT` 读到的那一份字符串**传给 `IMPORT_APPLY`（D12 构造性保证）+ 携带 `configVersion`
  - **（Q2=B-2）** 本任务**只负责导入区**；导出 UI 由 **T19 在同文件 `settings/App.tsx` 内**替换为**独立导出 section**（本任务不实现导出逻辑，避免与 T19 同文件并发编辑 → 见 T19 Parallelization）
  - **（Q1=A）** 展示 diff 中的**配方型图标**时，在 UI 侧调用 `renderIconToDataUri` 产 **PNG**（复用 T12 的 UI 渲染路径）
  - `ImportIntent` 状态管理（含稀疏 `recordOverrides`）
  - **RED 测试**（先写）：`tests/ui-smoke/import-flow.test.tsx`（jsdom）
    - 渲染必现元素（`data-testid`）：维度组标题、模式选择器、确认弹窗
    - 「导出备份」点击**不自动放行**（须再点「我了解风险」）

  **Must NOT do**:
  - 不做两步向导（D6 否决）
  - 不把「导出备份」设为前置条件（A9 派生 1）
  - 不复用旧 `importMode`（`replace/merge` 二元）语义
  - 不在客户端重算 diff 作为权威

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 交互重构 + 状态管理 + 无障碍，面较宽
  - **Skills**: [`sw-tdd-agent`, `sw-ui-ux-review`]
  - **Skills Evaluated but Omitted**: `sw-reviewer-security`

  **Parallelization**:
  - **Can Run In Parallel**: NO（**T19 须串行于其后** — 见下）| **Parallel Group**: **Wave 4b**（with T19，**串行执行 T18 → T19**）
  - **Blocks**: T21, T22 | **Blocked By**: T8, T17（Wave 4a）, T20

  **References**:
  - **Pattern References**:
    - `src/ui/settings/App.tsx:2008-2110` — 现 `ImportExportSection`（两单选按钮 + preview 回传，**须重写**）
    - `src/ui/settings/App.tsx:13` — `Confirm` 已 import（可直接用）
    - `src/ui/shared/masked-summary.tsx` — `MaskedSummary` 折叠手法（D6/A12 复用）
  - **API/Type References**:
    - 设计 §4.2（导入交互）+ §3.2（模式表）+ §4.3/§4.4（清单/重合）
    - `2026-10-04-import-export-decisions.yaml`：D6 / D7 / D8 / A2 / A4 / A9 / D12
  - **WHY Each Reference Matters**: D6 选"单页 + 维度折叠"是因为"维度选择器、diff、量化提示、两按钮**必须同时可见**"；A9 强调两按钮是**并列选择**（"点备份即自动放行"会把备份变成隐性必填，退回强制备份的缺陷）。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run --project ui-smoke tests/ui-smoke/import-flow.test.tsx` → ALL PASS
  - [ ] 断言确认弹窗**恒定出现**（即使 0 删除）
  - [ ] 断言「导出备份」后仍须显式确认
  - [ ] `npm run typecheck && npm run lint` → PASS

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 维度模式 + 量化确认（happy）
    Tool: Bash（`vitest --project ui-smoke`，jsdom + testing-library）
    Preconditions: 注入含 3 slot/9 rule 替换的 inspection
    Steps:
      1. 选文件 → 断言 diff 组标题渲染（维度级）
      2. 切换「规则」组模式 = 覆盖
      3. 点击「应用」→ 断言确认弹窗出现且文案含"将删除 …个槽位…条规则，且不可撤销"
      4. 点击「我了解风险，确认导入」→ 断言发出 IMPORT_APPLY（含同一份字符串 + configVersion）
    Expected Result: 决策与证据同屏；提交携带同一份字符串
    Failure Indicators: 弹窗未出现 / 未携带 configVersion / 重读了文件
    Evidence: _context-output/evidence/task-18-import-flow.txt（**jsdom 场景，结构/文案断言 → `.txt`**；真实浏览器留待 F3）

  Scenario: 导出备份不自动放行（failure — A9 派生）
    Tool: Bash（`vitest --project ui-smoke`，jsdom）
    Preconditions: 确认弹窗已开
    Steps:
      1. 点击「导出备份」
      2. 断言未发出 IMPORT_APPLY（仍在弹窗内）
      3. 再点击「我了解风险，确认导入」→ 断言发出
    Expected Result: 两按钮并列，备份非前置（避免隐性必填）
    Evidence: _context-output/evidence/task-18-backup-not-gate.txt

  Scenario: 未携带维度无选择器（edge — A2）
    Tool: Bash（`vitest --project ui-smoke`，jsdom）
    Preconditions: inspection 中 rules 维度未携带
    Steps:
      1. 断言"本包未包含规则"标注存在
      2. 断言该组**无**模式选择器
    Evidence: _context-output/evidence/task-18-absent-dimension-ui.txt
  ```

  **Evidence to Capture**: `task-18-import-flow.txt`、`task-18-backup-not-gate.txt`、`task-18-absent-dimension-ui.txt`
  （**均为 jsdom 结构/文案断言 → `.txt`**；真实浏览器视觉证据由 F3 统一产出 `.png`）

  **Commit**: YES（groups with T18）
  - Message: `feat(ui): rebuild import section with dimension modes + quantized confirm dialog`
  - Files: `src/ui/settings/App.tsx, tests/ui-smoke/import-flow.test.tsx`
  - Pre-commit: `npm run typecheck && npm run lint && npm run test:ui-smoke`

- [ ] **T19. 独立导出 section（Q2=B-2：`settings/App.tsx` 内新建；维度勾选 + 记录展开 + 包摘要）**

  **What to do**（**Q2=B-2：`settings/App.tsx` 内新建独立导出 section**）:
  - 在 `src/ui/settings/App.tsx` 内**新建独立导出 section**（与导入区并列、**互不复用**现有"一个按钮 + 直接下载"的旧导出 UI；不新增 HTML 页面、不改 `vite.config.ts`）
    - 4 个**维度复选框**（槽位/规则/策略/快捷键）；维度可**展开到记录级**取消个别（D1）
    - **空选择必须被拦下**：一个维度都不勾 → **禁止导出**并说明原因（D1 派生）
    - 「导出」→ `EXPORT_PACKAGE(scope)` → **先展示包摘要**（各维度条数）→ 下载（先展示后下载）
    - 文件名沿用 `tab-bookmarks-config-YYYY-MM-DD.json`（D13）；下载仍走 `Blob + URL.createObjectURL`（**沿用既有 `handleExport` 的下载手法，但 UI 容器为该独立 section**）
  - **在 `settings/App.tsx` 内替换旧导出 UI**（原 `ImportExportSection` 的导出部分）为**独立 section** → 保留导入区（T18）；避免两处并存
  - **RED 测试**（先写）：`tests/ui-smoke/export-flow.test.tsx`
    - 4 个维度复选框渲染（**settings 页的导出 section 组件**，`jsdom` 渲染即可）
    - 零勾选 → 导出按钮禁用 + 原因可见
    - 勾选后 → 发出 `EXPORT_PACKAGE` 且含 scope

  **Must NOT do**:
  - **不新增 HTML 页面**（不建 `src/ui/export-panel/` 之类新页面）
  - **不修改 `vite.config.ts`**、**不新增构建入口**（入口数保持 **7**）
  - **不再**"复用现有下载 UI"（**D-2 已作废**，Q2=B-2 覆盖）——但"独立"体现为 **settings 内的独立 section**，而非新页面/新入口
  - 不做"预设按钮 + 记录微调"第二套入口（D1 否决）
  - 不新增 `EXPORT_DESCRIBE` 动作（A11）
  - **不新增 permission / host_permission / command**（Guardrail 1）

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 维度/记录两级勾选状态管理 + section 交互重构（同文件内与导入区共存）
  - **Skills**: [`sw-tdd-agent`, `sw-ui-ux-review`]

  **Parallelization**:
  - **Can Run In Parallel**: NO（**须串行于 T18 之后** — T19 与 T18 **同改 `settings/App.tsx`**，需避免同文件并发编辑）| **Parallel Group**: **Wave 4b**（with T18，**串行 T18 → T19**）
  - **Blocks**: T21 | **Blocked By**: T1, T17（Wave 4a）

  **References**:
  - **Pattern References**:
    - `src/ui/settings/App.tsx:2014-2042` — 现 `handleExport`（**下载手法沿用**：Blob + `createObjectURL`；**但 UI 容器改为同文件内的独立 section**）
    - `src/ui/settings/App.tsx:2006-2012` — 现 section 头注释与状态（**旧导出 UI 须替换为独立 section**）
    - `src/ui/shared/masked-summary.tsx` — `MaskedSummary` 折叠手法（包摘要/记录展开复用；与 T18 一致）
  - **API/Type References**:
    - 设计 §4.1（导出）+ §2.2（维度集合）
    - `_context-output/designs/2026-07-14-tab-bookmark-shortcuts-ui-ux-design.md:150-156` — 设置页左侧固定导航 5 分区**已含"导入导出"**（B-2 的口径依据）
    - `2026-10-04-import-export-decisions.yaml`：D1 / D5 / D13
    - **用户裁定 Q2=B-2（2026-10-05）**：`settings/App.tsx` 内独立导出 section（不作废 D13 的文件名契约）
  - **WHY Each Reference Matters**: D1 的"至少一个维度"规则源于"仅策略/仅快捷键是合法组合"——空包按 A2/D5 完全无效果，用户会以为坏了。**Q2=B-2 后**，导出面是 **settings 页内的独立 section**（不新增入口）；既有设计权威已把"导入导出"列为设置页 5 分区之一，导出天然属于该分区；且 F1 揭示 `import-preview` 独立页是"建了但全仓无引用"的孤儿，再建同类页面有重蹈风险。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run --project ui-smoke tests/ui-smoke/export-flow.test.tsx` → ALL PASS
  - [ ] 断言零勾选时导出被拦 + 说明可见
  - [ ] **反例搜索**：`rg "export-panel" .` → 0（不得新增页面/入口）；`vite.config.ts` 入口数仍为 **7**（**Q2=B-2**）
  - [ ] `rg "ImportExportSection" src/ui/settings/App.tsx` 中**旧导出 UI 已替换为独立导出 section**（导入区保留）
  - [ ] `npm run typecheck && npm run lint` → PASS

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 独立导出 section 四维度勾选并导出（happy — Q2=B-2）
    Tool: Bash（`vitest --project ui-smoke`，jsdom）
    Preconditions: 渲染 settings 页（含新的独立导出 section）
    Steps:
      1. 勾选「槽位」与「策略」
      2. 点击「导出」→ 断言发出 EXPORT_PACKAGE 且 scope 含 slots+settings
      3. 断言先展示包摘要（条数）再触发下载
    Expected Result: 按范围导出，摘要先于下载
    Evidence: _context-output/evidence/task-19-export-scope.txt

  Scenario: 零勾选被拦下（failure — D1 派生）
    Tool: Bash（`vitest --project ui-smoke`，jsdom）
    Preconditions: 全不勾
    Steps:
      1. 断言导出按钮 disabled
      2. 断言原因文案可见
    Expected Result: 不产出"什么都不含"的包
    Evidence: _context-output/evidence/task-19-empty-selection-blocked.txt

  Scenario: 未新增页面/入口（edge — Q2=B-2 反例守卫）
    Tool: Bash（`rg` + `npm run build:chrome`）
    Preconditions: T19 完成后
    Steps:
      1. `rg "export-panel" .` → 断言 0 命中
      2. 断言 `vite.config.ts` 入口数仍为 7；构建成功
    Expected Result: 未新增 HTML 页面与构建入口
    Evidence: _context-output/evidence/task-19-no-new-entry.txt
  ```

  **Evidence to Capture**: `task-19-export-scope.txt`、`task-19-empty-selection-blocked.txt`、`task-19-no-new-entry.txt`

  **Commit**: YES（groups with T19）
  - Message: `feat(ui): add standalone export section (Q2=B-2) with dimension scope + package summary`
  - Files: `src/ui/settings/App.tsx, src/ui/styles/settings.css, tests/ui-smoke/export-flow.test.tsx`
  - Pre-commit: `npm run typecheck && npm run test:ui-smoke`

- [ ] **T20. `ImportPreviewTable` 演进（维度分组 + 字段级展开 — 非重写）**

  > **🔴 本节 What to do / Must NOT do 已被「实施期重裁 v2」作废**（2026-10-06）——
  > `ImportPreviewTable` **不再演进**（T18 已自研渲染、从未消费它），改为**删除目录**；
  > 「维度分组 + 记录级行」**已由 T18 覆盖**，仅**字段级展开**须补（落 T18 记录行）。
  > 「不删除 `DiagnosticsPanel`/`IconStatus`/`UnifiedToast`」**亦作废**（三者 `src/` 零消费者）。
  > **以下原文仅作历史对照，执行以本节末"重裁 v2"为准。**

  **What to do**（作废，见上）:
  - **演进** `src/ui/import-preview/App.tsx` 的 `ImportPreviewTable`（`:26-111`）：
    - 从"slot 冲突表（`existing`/`imported` 两列）"演进为**按维度分组 + 记录级行 + 字段级可展开**（A12/D6）
    - 保留其既有可取处：`aria-label`、`role="table"`、批量按钮、per-row `select`
    - 行内呈现"标题：A → B""图标：不变"（字段级）
    - 缺失图标行内**修复入口**（D9：复用 `getPlaceholder()` + 既有图标编辑器）
  - 与 T18 的 `ImportExportSection` 共用该组件（把 F1 的孤儿组件**接线**）
  - **RED 测试**（先写）：`tests/unit/ui/import-preview-table-evolved.test.tsx`
    - 渲染维度分组标题 + 记录行
    - 展开某记录 → 断言字段级行出现（"图标：不变"）
    - 缺失图标 → 断言占位 + 修复按钮存在
  - 迁移既有 `tests/unit/ui/import-diagnostics.test.tsx:23-56` 中针对旧 props 的断言

  **Must NOT do**（作废，见上）:
  - 不从零重写（F1 明确"演进"；组件已完整存在）
  - 不删除 `DiagnosticsPanel`/`IconStatus`/`UnifiedToast`（同文件其他导出，诊断功能仍在用）
  - 不新增第三套表格范式（复用 `MaskedSummary` 折叠手法）

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 既有组件演进 + 既有测试迁移 + 组件接线
  - **Skills**: [`sw-tdd-agent`, `sw-ui-ux-review`]
  - **Skills Evaluated but Omitted**: `sw-feature-designer`

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 3（with T9–T15）
  - **Blocks**: T18, T21, T22 | **Blocked By**: T8

  **References**:
  - **Pattern References**:
    - `src/ui/import-preview/App.tsx:26-111` — `ImportPreviewTable` 现状（**演进基线**）
    - `src/ui/import-preview/main.tsx:3,14` + `vite.config.ts:36` — 孤儿页与入口（F1 证据：仅此处引用）
    - `src/ui/shared/masked-summary.tsx` — 折叠手法（A12 复用）
    - `src/background/icon-service.ts:386-394` — `getPlaceholder()`（D9 占位）
  - **API/Type References**:
    - `src/shared/types.ts:ImportDiff`（T2 定义）+ `ImportInspection`
    - 设计 §4.3（清单）+ §4.4 + A12/D6/D9
  - **Test References**:
    - `tests/unit/ui/import-diagnostics.test.tsx:23-56` — 旧 props 断言（须迁移）
    - `tests/ui-smoke/pages.smoke.test.tsx:101-104` — 既有 `ImportPreviewTable` 冒烟（须保持可渲染）
  - **WHY Each Reference Matters**: F1 是"设计要求的功能**完整存在但未接线**"——重写会丢弃已验证的高质量组件；A12 要求"记录级默认 + 字段级展开"，与 `MaskedSummary` 同一手法，**不引入新交互范式**。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run --project unit tests/unit/ui/import-preview-table-evolved.test.tsx` → ALL PASS
  - [ ] `npx vitest run --project ui-smoke tests/ui-smoke/pages.smoke.test.tsx` → ALL PASS（页仍可渲染）
  - [ ] 迁移后的 `tests/unit/ui/import-diagnostics.test.tsx` → ALL PASS
  - [ ] `npm run typecheck && npm run lint` → PASS

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 维度分组 + 字段级展开（happy — A12）
    Tool: Bash (vitest) + testing-library
    Preconditions: 构造 ImportDiff（2 slot 替换 + 1 rule 新增）
    Steps:
      1. render(<ImportPreviewTable inspection={diff} … />)
      2. 断言分组标题（"Slots"/"Rules"）存在
      3. 点击某 slot 行展开 → 断言出现"图标：不变"或"标题：A → B"
    Expected Result: 记录级可扫读、字段级可裁决
    Evidence: _context-output/evidence/task-20-dimension-groups.txt

  Scenario: 缺失图标占位 + 修复入口（failure/edge — D9）
    Tool: Bash (vitest)
    Preconditions: diff 含一个 missing 图标的记录
    Steps:
      1. 断言渲染灰色 "?" 占位（非 🔖 回退）
      2. 断言"需重新选择"标注 + 修复按钮存在（aria-label 含"重新选择"）
    Expected Result: 缺失可区分且可修复
    Evidence: _context-output/evidence/task-20-missing-icon-repair.txt
  ```

  **Evidence to Capture**: `task-20-dimension-groups.txt`、`task-20-missing-icon-repair.txt`

  **Commit**: YES（groups with T20）
  - Message: `feat(ui): evolve ImportPreviewTable to dimension-grouped field-expandable diff`
  - Files: `src/ui/import-preview/App.tsx, tests/unit/ui/import-preview-table-evolved.test.tsx, tests/unit/ui/import-diagnostics.test.tsx`
  - Pre-commit: `npm run typecheck && npm run test:unit`

  > **⚠️ 实施期增补（2026-10-05）：孤儿页入口须显式处置**
  > `ImportPreviewTable`（组件）**保留演进**；但其**独立页入口** `src/ui/import-preview/main.tsx` +
  > `index.html` + `vite.config.ts:36`（F1 已知孤儿，全仓无外部引用）须在本任务定稿时**显式处置**：
  > **默认删除独立页入口**（组件改由 settings 内联消费，T18），除非保留作开发预览并写明理由。
  > 不得静默跨过收口（否则孤儿入口会穿过 F1 审查）。
  >
  > **⚠️ 组件保留但类型必须迁移（2026-10-05，审查发现 W5 锚点会命中本文件）**
  > `src/ui/import-preview/App.tsx` 被保留，但其 `:16` 仍 `import type { ImportPreview, ImportSlotConflict, ImportSlotDecision }`、
  > `:21` 用 `ImportPreview`、`:22/:27` 用 `ImportSlotConflict`。这些是**旧类型** ⇒ W5 同族锚点会命中。
  > **本任务验收须含**：把 `:16/:21/:22/:27` 的类型迁到 `ImportInspection` + 新 diff/决策类型，
  > **仅保留 `ImportPreviewTable` / `ImportPreviewProps` 名**；届时锚点对本文件归 0 是**正确预期**（非误报）。
  > （防执行者因"文件要保留"而漏迁类型。）

  > **🔴 实施期重裁 v2（2026-10-06，修正 v1）：删目录 + 补字段级展开（落 T18）**
  >
  > **v1 修正缘由**：v1 曾把整目录判为"重复 UI 删除"⇒ 经 executor 取证、我复核后**认账**：
  > 被 T18 取代的只是「维度分组 + 记录级行 + 确认弹窗」，**不含字段级展开**。
  >
  > **两个真缺口（须显式处置）**：
  > - **(a) 字段级展开（A12 后半）**：`git grep "\.fields" -- src/ui/settings/App.tsx` → **0**；
  >   `ImportFieldDiff` 仅 `import-diff.ts:121/131` 产、**零 UI 消费者**；`computeDiff`
  >   （`:170/:190/:209/:234/:252/:270`）**稳定产出** `fields` ⇒ 数据就绪、UI 缺失。
  >   计划 `:2150` Must-Have 明列 ⇒ **必修**。**落点 = T18 `ImportExportSection` 的记录行**
  >   （`tbs-settings__import-records`），**不是**孤儿组件。
  > - **(b) 缺失图标修复入口（D9）**：`missingIcons` 生产者仍 `[]`（`import-export-service.ts:433`）、
  >   `getPlaceholder` 于 `src/ui` 0 命中 ⇒ **归 T22**（须先通 APPLY 生产者，C11 已定落点）。
  >
  > **🔴 (a) 的硬约束（内部表示不得进入契约 —— 结构化，非"展示层遮盖"）**：
  > 原 `fields[].before/after` 是**内部签名**（`import-diff.ts:49-69` 私有 `portableIconSignature`）：
  > `url:<url>` / `local-ref:<key>` / `recipe:<bgColor>|<text>|<textColor>`。
  > ⇒ **裁定改契约**（reviewer 与我共同评估后的选择 (b)）：
  > ```ts
  > export type ImportFieldValue =
  >   | { kind:'text'; value: string } | { kind:'url'; value: string }
  >   | { kind:'local-ref'; key: string }
  >   | { kind:'recipe'; bgColor: string; text: string; textColor: string };
  > // ImportFieldDiff.before/after: ImportFieldValue | null
  > ```
  > 内部比较串仍作 `facetKey`（`portableIconFacet` 与它**成对相邻**，唯一 owner），但**不再进入契约**。
  > **UI 只做「结构 → 文字」渲染，零解析、零前缀推断**。
  > **反例锚点（精确版；裸前缀字面量不锚）**：
  > ```
  > A. rg -n "startsWith\('(url|local-ref|recipe):'\)" src/ui/     → 0
  > B. rg -n "slice\('(url|local-ref|recipe):'\.length\)" src/ui/  → 0
  > ```
  > （范围只到 `src/ui/`。**不得**写成"`src/` 内前缀归零" —— `src/background/recipe-renderer.ts:30`
  > 已有合法 `RECIPE_CACHE_PREFIX = 'recipe:'`，`recipeSignature()` 拼同格式串作 memo key，会被误伤。
  > 另记账：`recipeSignature`（cache key）与 `portableIconSignature`（比较串）格式重复但独立，
  > 变更 cache key 会作废 memo ⇒ **不属 T20，禁止"统一"**。）
  > **三条前置（防结构化引入新漂移）**：① 无值仍为 `null`（不得 `{kind:'text',value:''}`）；
  > ② `changed` 由 `facetKey` 单一派生；③ 仅 `tests/unit/shared/import-diff.test.ts:148` 须改
  > （保持 `toEqual` 精确；`recipe-roundtrip-textcolor.test.ts:98/124` 只断 `.changed`、勿动）。
  > A12 措辞：「标题 A→B」「图标：不变」（`changed:false` ⇒ 「不变」）；
  > **`deleted` 行 ⇒ "removed"**（`after` 恒 `null`，**不得**把 `null` 当 `''` 渲染成"删成空"）；
  > 「unchanged」措辞**仅适用于 kept 行**。**测试不得断言原始签名字符串出现在 DOM**。
  >
  > **🔴 `62c8960`（(a) 版）重做前取证的三处缺口（2026-10-06）**：
  > 1. **反泄漏断言空转**：`expect(fieldsBox.textContent).not.toMatch(/recipe:|local-ref:|url:/)`
  >    恒真 —— fixture 的 slot 2 **两侧都无图标** ⇒ 走 `unchanged` 分支，DOM 无含前缀值可匹配。
  >    ⇒ 删掉解码器它也绿。**修法**：fixture 须有 **`changed:true` 的图标字段**（一侧带
  >    recipe/url/local-ref、另一侧**不同**）；只"某侧有"不够（同值仍走 unchanged）。
  > 2. **`''` 分支是生产不可达死代码**：`import-diff.ts:121-128` 把 `before/after` 的 `''`
  >    **一律归一为 `null`**（三条产出路径 `fieldDiff:124-125` / `keptFields:133-134` /
  >    `added:171-172`，`deleted` 同构）⇒ `formatFieldValue` 的 `raw === ''` 分支生产不可达；
  >    而 `import-field-format.test.ts` 的 `expect(formatFieldValue('icon','')).toBe('None')`
  >    **断言不可达行为**（测试诚实性同族）⇒ (b) 重做时**删除**该例。
>    **整份测试须按新签名重写**：`formatFieldValue(field, raw)` → `formatFieldValue(v: ImportFieldValue | null)`
  >    ⇒ "留 `null` 那半"也须改签名；`describe` 标题 `signature → human` 改为 `structured value → human`。
  >    真实缺陷 = `null`（"没有"）被渲染成 `'None'`（误读为"变成 None"）；**且 `added`/`deleted`
  >    行 facet 缺失时渲染 `"unchanged"`**（我实测两分支 `changed: afterIcon/before.icon !== ''`
  >    ⇒ 无图标即 `false` ⇒ "未变"；新记录/删除记录并非"未变"）—— 四态映射（见下表）一并消除。
  >    **`None` 保留**：`null` 在四态下只于 `replaced` 箭头分支出现（`null → X` = 原本无现设了；
  >    `X → null` = 原设了现清空 ⇒ 两种读法均准确；`null → null` ⇒ `changed:false` ⇒ "unchanged"）。
  > 3. **`deleted` 行仍走箭头**：`formatFieldDiffLine` 需双参 `(diff, status)`，四态分派
  >    （added / deleted / kept / replaced）。
  > **证伪前置**：临时让 formatter `return raw` 须使反泄漏断言**变红** —— 但**仅当 fixture
  > 有 `changed:true` 的图标字段**时才成立（否则走 `unchanged` 分支，`return raw` 也不显签名）。
  >
  > **UI 四态措辞（2026-10-06 定稿；`formatFieldDiffLine(diff, status)`）**：
  > **精确规则（2026-10-06 修正；status 只对 added/deleted 优先）**：
  > ```
  > status === 'added'   → "<Label>: added (<值>)"   / 无值 ⇒ "<Label>: added"
  > status === 'deleted' → "<Label>: removed (<末值>)" / 无值 ⇒ "<Label>: removed"
  > 否则（kept / replaced）→ changed ? "<Label>: A → B" : "<Label>: unchanged"
  > ```
  > **硬约束**：`replaced` **不得**短路成独立态 —— `import-flow.test.tsx:305` 断言
  > **`status='replaced'` + `changed:false` ⇒ `"Icon: unchanged"`**（slot 2：title 变、icon 未变）。
  > 若 `replaced` 强制走箭头或不走 `changed`，该断言**立刻红**。（v1 的"四态表"把 `replaced`
  > 列为独立态属**表述偏松**，已作废。）
  >
  > | status | 渲染 | 禁止 |
  > |---|---|---|
  > | `deleted` | `"<Label>: removed (<末值>)"` / 无值 ⇒ `"removed"` | 走箭头、**"unchanged"**、**"A → None"** |
  > | `added` | `"<Label>: added (<值>)"` / 无值 ⇒ `"added"` | **"unchanged"** |
  > | `kept` / `replaced` | `changed ? "A → B" : "unchanged"` | — |
  >
  > **(b) 须补的 fixture**：① `added` **带图标**行（验"不得 unchanged"）；② `deleted` **带图标**行
  > （验 `removed (末值)`、不得 `A → None`）；③ 同一 fixture 兼作**反泄漏断言的 `changed:true` 前置**。
  > 原则：**status 优先 + 带值**（既不误述"未变"，也不丢信息）。
  > 「unchanged」**仅** kept；`null` 渲染为「None」表示"无值"，**不得**被读作"变成 None"。
  > `deleted` + `changed:true` 是**契约内合法组合**（`import-diff.ts:211-212` `before: before.title || null`
  > ⇒ 末值是真实值、`changed` 独立按值算）⇒ 故可"带末值"。
  >
  > **新增归零锚点 D′**：`rg -n "portableIconSignature|storedIconSignature" src/` → **0**
  > （两者被 `portableIconFacet`/`facetKey` 取代；实测引用面仅 `import-diff.ts` 内部 +
  > `import-field-format.ts:5` 注释提及 ⇒ 删除安全。防"删一半、编译过而留死名"。）
  >
  > **T20 收口裁定（2026-10-06，含一处自我更正）**：
  > - `62c8960`（(a) 签名串解码版）→ **(b) 结构化重做**用**新提交**（保留"曾用前缀解析"的审计价值）；
  > - **~~`643edfe` amend~~ 作废**：我曾裁定"amend `643edfe` 以并入守卫加固"，理由是"其提交态会误红"。
  >   **该前提被证伪**：`git ls-tree 643edfe src/ui/import-preview` = **空**（该提交树里目录已不存在）
  >   ⇒ `existsSync` 为 false ⇒ 断言**为绿、无误红** ⇒ **不改写历史**，加固随 **`80413d8`** 落盘。
  >   正确表述：旧守卫的唯一脆弱面是"**工作区**出现未提交的空目录"（`mkdir`/编辑器/工具），
  >   属**工作区构件** ⇒ **任何早于加固的提交都一样**、**无"逐提交缺陷"可记**
  >   （reviewer 亦独立撤回其"逐提交误红"前提，并指出该前提由他先提出、已被复制到两处）。
  >   **教训**：判"某提交是否可失败"必须用 `git ls-tree <sha> <path>` 查**该提交的树**，不能用
  >   **当前工作区**的文件状态推断（第 6 次实例）；
  >   判"当前是否存在缺陷"必须**当下复跑**（我曾据一次输出断言"vite 探针残留 ⇒ build 红"，
  >   实为他人探针的**短窗注入**、复查即失效 —— 第 7 次实例）。
  > - **最终结论（reviewer，提交态 `80413d8`）**：**PASS** —— 4 条 RED 全部符预期
  >   （空目录**不红** exit 0；动态导入/换路径/vite 键**红**）；A/B/C/D′ 全 0；6 文件受测集全绿；
  >   `tsc` 0；`build` exit 0 / 99 modules；`toEqual` 精确；变异验证（双层红）通过。
  >   全量终值（lead 稳定环境复跑）：**147 files / 1191 tests / 0 fail**。
  > - **(b) 预审 PASS（reviewer，工作区版）**：`ImportFieldValue` 在契约内；A/B/C/D′ 全 `src/` = 0；
  >   D 合法点恰 2 处（`recipe-renderer.ts:30` cache key + `import-diff.ts:103` facetKey）；
  >   格式化器零解析；`changed` 由 `facetKey` 单一派生（`:162`/`:217-218`）；成对相邻；
  >   empty ⇒ `null`（`textFacet` 未退化）；四态 + `replaced` 走 `changed`；`deleted` 不产 `A → None`；
  >   `import-diff.test.ts:148` 保 `toEqual` 精确；fixture `marker.icon` 带 recipe ⇒ **非空转前置就位**。
  > - **🔬 变异验证通过（reviewer 实做）**：临时让 `case 'recipe'` 返回内部签名串 ⇒ 反泄漏断言**真变红**
  >   ⇒ **非空转已证**；还原后 10/10 绿、零残留（磁盘为人话版）。
  > - 测试数：T20a 1198 → T20b 1185（**−13** = +3 守卫 −1 冒烟 −15 `import-diagnostics`）。
  >
  > **T20b 预核（2026-10-06，reviewer + 我独立抽验）**：`npm run build` **exit 0 / 99 modules**
  > （原 102）；`vite.config.ts` 恰删 1 行 ⇒ `input` 6 键（含非页面 `content`，口径 **7→6**）；
  > `README.md`/`RELEASE_CANDIDATE.md` 已清（后者同时修掉原有过时项 `candidate-selector`）、残留 0 命中；
  > `page-lang` 白名单 4、`toBe(4)` 保精确、`pages.smoke` `it(` 计数 4 ⇒ 自洽。
  > ⇒ T20b 的"删/改/文档/build"面**已就绪**，剩余 = **修守卫 2 bug + T20a (b) 重做**。
  >
  > **`ImportPreviewTable` + 目录 + 入口 = 删除**（终裁）：计划"组件保留、由 settings 内联消费"的
  > 前提**已失效** —— T18 **实际自研渲染、从未消费**它；保留而零引用即仍是孤儿（依据 ②/③）。
  > 其类型 `ImportPreview`/`ImportSlotConflict`/`ImportSlotDecision` 属 **T14b 删除对象**。
  >
  > **执行清单（拆两个提交）**：
  > - **T20a** `feat(ui): surface field-level diff in the import record rows`：**(a)** 字段级展开 +
  >   签名→人话格式化器（落 `ImportExportSection`）+ 单测。**先做**（纯增益、无守卫牵连）。
  > - **T20b** `chore(ui): retire the orphan import-preview page`：
  >   ① 删 `src/ui/import-preview/`（`App.tsx`/`main.tsx`/`index.html`）；
  >   ② 删 `src/ui/styles/import-preview.css`（实测唯一消费方 = `main.tsx:8`）；
  >   ③ 删 `vite.config.ts:36` 的 `'import-preview'` 入口键（实测无入口数断言）；
  >   ④ 删 `tests/unit/ui/import-diagnostics.test.tsx`；
  >   ⑤ 删 `pages.smoke.test.tsx` 的 import-preview 冒烟块；
  >   ⑥ **BLOCKER-1**：`tests/unit/ui/page-lang.test.tsx:17` 白名单 **5→4**（否则 2 例 ENOENT）；
  >   ⑦ **BLOCKER-2**：`tests/unit/ui/candidate-selector-removed.test.ts:33` `5→4`，
  >      **须保留 `toBe(4)` 精确性**（值更新=维护，弱化=放宽）；
  >   ⑧ **新建 `tests/unit/ui/import-preview-removed.test.ts`**（目录不存在 / vite 无入口 /
  >      `src/`+`tests/` 无 `ImportPreviewTable|ImportPreviewProps`）—— 对称于 U1 的 candidate-selector 守卫；
  >      理由：`rg` 反例锚点只在提交时跑、**不是持续守卫**，不阻止孤儿复活（F1 主题）；
  >      **两条实现陷阱（实测已踩，必须先避开）**：
  >      - **空目录**：`git` 不表达空目录 ⇒ `existsSync` 本地为真、CI 为假（跨环境不确定）。
  >        判据须 `existsSync(dir) && readdirSync(dir).length > 0`（空目录不算复活）；
  >      - **自指**：`readDirRecursive('tests')` 会读到守卫自身源码，而断言里写着该正则字面量 ⇒ **恒红**。
  >        修法：用**不构成连续串**的字面量（`'ImportPreview' + 'Table'`）或正则分组
  >        `/ImportPreview(?:Table|Props)/` ⇒ 零自指且**覆盖不缩**。
  >        **不得**降级为 `from '@ui/import-preview'`（漏 `await import(...)` 与裸符号名 ⇒ 覆盖收缩）。
  >      **可失败性（硬证据）**：临时复活目录（非空）/ vite 键 / `src/` 符号，须**各自触发对应一条**。
>      **另两条判决性 RED**（符号面不可降级的证明）：① 动态形式
>      `await import('@ui/import-preview/App')` ⇒ 第 3 条必须红（**该形式无 `from`**，是路径串方案漏掉的那处）；
>      ② 换路径复活（`src/ui/import-previewer/App.tsx` 同名组件）⇒ 第 3 条必须红。
>      **守卫充分性凭证（双方独立实测，建议写进注释）**：
>      - **覆盖面完备**：`3c4ebbe` 下含符号名的**代码文件恰 4 个**
>        （`src/ui/import-preview/App.tsx`/`main.tsx`、`tests/ui-smoke/pages.smoke.test.tsx`、
>        `tests/unit/ui/import-diagnostics.test.tsx`）—— **全在 `src/`+`tests/` 递归范围内** ⇒ 无遗漏面。
>        （另 2 份**历史计划文档**含符号名 ⇒ 属 doc-hygiene 独立项、**不属 T20**、豁免。）
>      - **无二进制风险**：`git ls-files src/` 除 `.ts/.tsx/.css/.html/.json/.svg` 外为空
>        ⇒ `readFileSync(..., 'utf-8')` 不会撞图片而抛错/乱码。
  >   ⑨ `README.md:100` 删该行；⑩ `RELEASE_CANDIDATE.md:83` 修正（该行本就过时：`candidate-selector`
  >      已被 U1 删除却仍列出）。
  > - **不动**：`tests/unit/shared/messages.test.ts:59` 的 `IMPORT_PREVIEW` case（归 **T14b/T21**；
  >   删会牵动 `assertNever`）。
  > - **反例锚点**：`\b(ExportConfigRequest|ExportConfigResponse|ImportPreviewRequest|ImportPreviewResponse|ImportCommitRequest|ImportSlotConflict|ImportSlotDecision|ExportPayload|ImportPreview)\b`
  >   于 `src/` —— **实测基线 5 文件**（`import-export-service.ts` 11 / `messages.ts` 13 /
  >   **`types.ts` 6** / `ui/import-preview/App.tsx` 7 / **`ui/shared/message-client.ts` 3**）；
  >   **删 T20 目录后 = 4 文件**（T20 贡献 **1** 文件；另 3 文件属 **T14b/T21**）。
  >   （⚠️ 更正 2026-10-06：本节 **v1 曾误写"应降为 2 文件"** —— 漏计 `types.ts` 与
  >   `message-client.ts`。以"2"为验收阈值会**永远失败**或迫使执行者误删 T14b 的对象。）
  >   窄口径（计划原 3 类 `\b(ImportPreview|ImportSlotConflict|ImportSlotDecision)\b`）同为 5→4。
  >   `ImportPreviewTable|ImportPreviewProps` 于 `src/`+`tests/` → 0。
  >   **守卫边界（2026-10-06，reviewer 提醒）**：`import-preview-removed.test.ts` 断言的是
  >   **组件符号**（`ImportPreviewTable|ImportPreviewProps`）；**类型** `ImportPreview` /
  >   `ImportSlotConflict` / `ImportSlotDecision` **不在其覆盖面**（属 **T14b/T21**，由 W5 同族锚点管）。
  >   ⇒ 好消息：类型 `ImportPreview` 复活**不会误触**该守卫（单串不匹配 `/ImportPreview(?:Table|Props)/`）；
  >   但**别**把它当"类型也守住了" —— 类型收口仍须 T14b/T21 的锚点 + 迁移毕。
  >   **对称记账**：类型 `ImportPreview` 当前仍存于 4 文件（`import-export-service.ts` 4 / `messages.ts` 3 /
  >   `types.ts` 1 / `message-client.ts` 3）—— 属 T14b/T21 的收口义务，**本轮不动**。
  > - **门禁**（两提交各自 + 合并后）：`tsc` 0 error；全量测试绿（ui-smoke −1、unit −1 文件 +1 新守卫）；
  >   **`npm run build` 通过**（删 vite 入口后）。
  >
  > **澄清**：计划 `:2141` "复用 MaskedSummary 折叠手法" 指**折叠交互方式**（`<details>`/展开按钮），
  > **非复用组件**（其 props 是 `ChainNode[]`，与 `ImportRecordDiff[]` 语义不同，强套即耦合）。
  >
  > **跨计划依据**：`plans/2026-09-29-ui-ux-remediation-plan.md:1487` 称"删除 import-preview 属独立范围"
  > ⇒ 那个"独立范围"**正是本迭代 T20**（接手者）⇒ 不构成阻力。
  >
  > **前置**：executor 先回报 css 引用方；reviewer 独立核验零引用前提 + W5 新基线（应降为 2 文件）
  > + 上述跨计划依据无他处保留承诺 —— 齐后动手。
  > **T22 联动**：计划 `:2269`「缺失图标行内修复入口（与 T20 联动）」的落点改至
  > **T18 `ImportExportSection` 结果清单**。

- [ ] **T21. 既有测试锚点迁移 + 端到端保真/补偿验证（收口）**

  **What to do**:
  - 逐文件登记既有测试的**语义保留 / 语义消失 / 语义替换**三类（协议重构后必然有一批锚点失效）：
    - `tests/unit/ui/import-diagnostics.test.tsx`（旧 props）
    - `tests/unit/shared/messages.test.ts:59`（旧动作）
    - `tests/ui-smoke/pages.smoke.test.tsx:101-104`（`ImportPreviewTable` 形状）
    - `tests/integration/import-export-service.test.ts`（T3 已部分迁移，此处收口）
  - 新增**端到端**：`tests/integration/import-export-e2e.test.ts`
    - **同机全量往返**：`EXPORT_PACKAGE(all)` → `IMPORT_INSPECT` → `IMPORT_APPLY` → 断言状态等价（G4-A）
    - **跨"机"往返**（两个 repo 实例）：含图标（URL/引用/配方）的包导入 → 断言 URL 直接可用、引用落入缺失、配方**原样持久化**（**UI 侧**渲染由 T12 的组件测试覆盖，本任务只断言状态层保真）
    - **补偿不变式**：注入失败 → 零改动（复述 T16 于端到端上下文）
  - 更新 `Definition of Done` 中所有反例搜索的最终确认

  **Must NOT do**:
  - 不保留任何旧动作/旧 props 的兼容测试
  - 不为通过而放宽断言（语义迁移须记录"语义消失"的理由）

  > **⚠️ 实施期增补（2026-10-05）：本任务**吸收 T14b**（删除旧三动作）**
  > T14 已拆为 T14a（新增，Wave 3）/ **T14b（删旧，并入本任务）**。本任务须在 settings 迁移
  > （T18/T19）与测试锚点迁移完成后，删除旧契约 / 旧 `switch case`（`worker-orchestrator.ts:761/764/767`）
  > / 旧 `KNOWN_ACTIONS` 项 / 旧 `message-client` 封装，并确认
  > `rg "EXPORT_CONFIG|IMPORT_PREVIEW|IMPORT_COMMIT" src/` → **0**。

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 收口 + 端到端 + 测试语义裁决
  - **Skills**: [`sw-tdd-agent`, `sw-codebase-explorer`]

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 5（with T22）
  - **Blocks**: F1–F4 | **Blocked By**: T16, T17（4a）, T18, T19（4b）, T20

  **References**:
  - **Pattern References**:
    - `tests/integration/import-export-service.test.ts`（全文件，含 T13/T31 分区）
    - `tests/integration/import-fidelity.test.ts`（T9 新增）
  - **API/Type References**:
    - 设计 §7 Testing Strategy（三层划分）+ §1.2 判据 A/B
  - **WHY Each Reference Matters**: 协议重构（A10）必然作废一批测试锚点，但"作废"必须**逐条登记理由**——否则会静默丢失覆盖（G-C/G-G）。

  **Acceptance Criteria（TDD）**:
  - [ ] `npm run test:unit && npm run test:integration && npm run test:ui-smoke` → **ALL PASS**
  - [ ] 端到端同机往返：状态逐字段等价
  - [ ] 端到端跨"机"往返：URL 可用 / 引用缺失 / 配方**原样持久化**（渲染归 T12 UI 侧）
  - [ ] 断言至少 3 条反例搜索为 0（见 F1）

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 同机全量往返等价（happy — G4-A）
    Tool: Bash (vitest)
    Preconditions: 构造含 4 维度内容的 SyncState（repoA）
    Steps:
      1. pkg = await EXPORT_PACKAGE(all)
      2. ins = await IMPORT_INSPECT(pkg)
      3. await IMPORT_APPLY(pkg, { all:'incremental' }, version)
      4. 断言 repoA 状态等价于导出前（引用类除外，按语义核对）
    Expected Result: 全量往返无损
    Evidence: _context-output/evidence/task-21-e2e-same-machine.txt

  Scenario: 跨"机"图标三态（edge — C1/C9）
    Tool: Bash (vitest)
    Preconditions: repoA 含 URL 图标 / upload(data URI) 图标 / template 配方图标；repoB 为空
    Steps:
      1. 导出 A → 导入 B
      2. 断言 B 中 URL 图标 value 直接可用
      3. 断言 B 中上传类图标引用无法解析 → missing
      4. 断言 B 中配方**原样持久化**（`type:'template'` + 三字段完整；**background 不渲染**，Q1=A）
    Expected Result: 三类承载按 C1 语义各自落位（配方渲染归 UI 侧，见 T12）
    Evidence: _context-output/evidence/task-21-e2e-cross-machine.txt
  ```

  **Evidence to Capture**: `task-21-e2e-same-machine.txt`、`task-21-e2e-cross-machine.txt`

  **Commit**: YES（groups with T21）
  - Message: `test(integration): migrate legacy anchors + add import/export end-to-end`
  - Files: `tests/integration/import-export-e2e.test.ts, tests/unit/ui/import-diagnostics.test.tsx, tests/unit/shared/messages.test.ts, tests/ui-smoke/pages.smoke.test.tsx`
  - Pre-commit: `npm run test:unit && npm run test:integration && npm run test:ui-smoke`

- [ ] **T22. 结果清单呈现（成功 / 宽容 / 域违规 / 缺失 / 重合 / 快捷键引导）**

  **What to do**:
  - 实现导入完成后的**结果清单**（`§4.3`），六类分列：
    - **成功**：新增/替换/保留/跳过的逐条结果
    - **宽容项**：未知字段被忽略 / 可选字段被填默认 —— **折叠汇总 + 展开**（§2.3 低风险默认）
    - **域违规**：单独归类"**因不安全被跳过**"（**醒目、不可跳过**，D15）
    - **缺失图标**："N 个图标需重新选择" + 行内修复入口（与 T20 联动）
    - **匹配重合**："导入后存在 N 处匹配重合（Match URL + Match Type 一致）"（D10）
    - **快捷键**：Chrome/Edge → "请到 `chrome://extensions/shortcuts` 手动设置"（D4 派生 2）
  - **RED 测试**（先写）：`tests/ui-smoke/import-result-list.test.tsx`
    - 六类分组各自渲染对应文案
    - 域违规**与**宽容项**分开归类**（不得混入"未知字段被忽略"）

  **Must NOT do**:
  - 不把域违规并入宽容项（D15 硬要求）
  - 不使用系统通知（`import-preview/App.tsx` 头注释的既有约束）
  - 不持久化"待重选"标记（C9 否决）

  **Recommended Agent Profile**:
  - **Category**: `deep` — Reason: 六类呈现 + 归类边界 + 与 T20/T15 联动
  - **Skills**: [`sw-tdd-agent`, `sw-ui-ux-review`]

  **Parallelization**:
  - **Can Run In Parallel**: YES | **Parallel Group**: Wave 5（with T21）
  - **Blocks**: F1–F4 | **Blocked By**: T18, T20（+ T15 提供快捷键能力信息）

  **References**:
  - **Pattern References**:
    - `src/ui/import-preview/App.tsx:215-228` — `UnifiedToast`（复用通知，不用系统通知）
      > ⚠️ **2026-10-06 更正**：该模块**已由 T20b 删除** ⇒ **不得 import**（路径不存在）。
      > 等价参照 = **`src/ui/shared/components.tsx:248` `Toast`**（settings 在用的共享实现）。
    - `src/ui/shared/masked-summary.tsx` — 折叠汇总手法（宽容项汇总）
  - **API/Type References**:
    - `src/shared/types.ts:ImportApplyResult`（T2 定义）
    - 设计 §4.3（清单表）+ §2.3（宽容汇总）+ D15/D10/D9/D4
  - **WHY Each Reference Matters**: D15 的硬要求是域违规"**醒目且不可跳过**"且**单独归类**——静默跳过（并入宽容项）比拒绝更危险，因为安全类问题被稀释进"无关紧要的字段忽略"里。

  **Acceptance Criteria（TDD）**:
  - [ ] `npx vitest run --project ui-smoke tests/ui-smoke/import-result-list.test.tsx` → ALL PASS
  - [ ] 断言域违规独立分组（不与宽容项合并）
  - [ ] 断言 Chrome/Edge 快捷键引导文案存在
  - [ ] `npm run typecheck && npm run lint` → PASS

  **QA Scenarios（MANDATORY）**:

  ```
  Scenario: 六类结果分列（happy）
    Tool: Bash（`vitest --project ui-smoke`，jsdom）
    Preconditions: ImportApplyResult 含 6 类各至少 1 条
    Steps:
      1. render 结果清单
      2. 断言存在 6 个分组标题
      3. 断言"因不安全被跳过"独立出现（与"未知字段被忽略"不同组）
      4. 断言缺失图标处有修复按钮
      5. 断言"匹配重合"计数正确
      6. 断言 Chrome/Edge 下含 chrome://extensions/shortcuts 引导
    Expected Result: 六类清晰分列、安全项醒目
    Failure Indicators: 域违规被并入宽容项 / 快捷键引导缺失
    Evidence: _context-output/evidence/task-22-result-list.txt（**jsdom 结构/文案断言 → `.txt`**；视觉证据归 F3）

  Scenario: 宽容项折叠可展开（edge — §2.3）
    Tool: Bash（`vitest --project ui-smoke`，jsdom）
    Preconditions: 50 处未知字段
    Steps:
      1. 断言默认显示"本包含 50 处将被忽略的字段（展开可见）"
      2. 展开后断言逐条可见
    Expected Result: 不淹没预览
    Evidence: _context-output/evidence/task-22-tolerant-collapsed.txt
  ```

  **Evidence to Capture**: `task-22-result-list.txt`、`task-22-tolerant-collapsed.txt`

  **Commit**: YES（groups with T22）
  - Message: `feat(ui): render import result list (success/tolerant/domain/missing/overlap/shortcut)`
  - Files: `src/ui/import-preview/App.tsx, src/ui/settings/App.tsx, tests/ui-smoke/import-result-list.test.tsx`
  - Pre-commit: `npm run typecheck && npm run test:ui-smoke`

  > **⚠️ 实施期裁定（2026-10-06）：两处「无生产者」缺口纳入 T22，不得留空壳**
  >
  > **① `shortcutGuidance` 无生产者（且 UI 无平台信号）**
  > 实测：`shortcutGuidance` 仅 `types.ts:387` 声明、零生产/零消费；`browserType` 不在任何
  > `GET_STATE`/sync/`messages` 载荷 ⇒ UI 无法判"我是 Chrome/Edge"。
  > **裁定：由 APPLY 结果填充（服务端生产）**，理由：`commands.updateSupported()`
  > （`contract.ts:92`，两 adapter 已实现，**当前仅测试调用** ⇒ T15-C 记账）正是为此而生；
  > 服务端已有 `adapter.getBrowserType()` ⇒ **零协议改动**（否决"GM 暴露 browserType"，会牵动契约）。
  > **发射条件**：`!updateSupported()` **且** 本次包**携带 `shortcuts` 维度**（`pkg.shortcuts !== undefined`）
  > —— 否则"没导入快捷键却提示"是噪音。文案含 `chrome://extensions/shortcuts`。
  > UI：`shortcutGuidance === undefined` ⇒ **不渲染该分组**。
  >
  > **② `tolerant` 无生产者** —— 见 `decisions.yaml` C8 revision：**T22 内实现最小真实生产者**
  > （allowlist 比对 ⇒ `TolerantItem{kind:'unknown-field', detail:'<json path>'}`），**不得标注"范围外"**。
  >
  > **③ `missingIcons` 精确要求（预审）**：必须遍历 `finalSafe`（`:383-387` 已按 D15 过滤）；
  > 在 `:418` counts 循环附近 **await 收集**（`applyImport` 已 async）；`deleted` 由 `applyIntent`
  > **结构性自动排除**（已移出 `final`）⇒ 无需另写排除，但**测试须断言"被删记录不计入"**；
  > **不得**做成读取侧状态（C11）。循环依赖**实测无风险**（`icon-service.ts` 不 import 本服务）。
  >
  > **④ UI 侧反例锚点（实测现状 0，须保持）**：`src/ui` 内 `local-icon:` /
  > `LOCAL_ICON_REF_PREFIX` / `isMissingIcon` / `resolveForDisplayState` **全 0 命中** ⇒
  > UI **不得硬编码 `'local-icon:'`、不得 `startsWith` 推断**；前缀唯一 owner =
  > `src/shared/icon-ref.ts:11`；判定归服务层，UI 只消费 `missingIcons` 结果；
  > 修复入口复用 FIX-C 的 `iconSourceForOwner`（按 owner 取源）。
  > 锚点（2026-10-06 精修；reviewer 诊断 + lead 实测修正）：
> ```
> A1  rg "local-icon:" src/ui/                      → 0
> A2a rg "startsWith\(LOCAL_ICON_REF_PREFIX\)" src/ → 恰 {icon-ref.ts, export-package.ts, icon-service.ts}
> A2b rg "startsWith\('local-icon:'\)" src/         → 代码 0（**仅 icon-ref.ts:28 注释**，注释不归零）
> A3  rg "isMissingIcon|resolveForDisplayState" src/ui/ → 0（T22 后仍须 0）
> ```
> ⚠️ 早先"`startsWith('local-icon:')` → 0"**不可用**：`icon-ref.ts:28` 是 **JSDoc 注释**内的字面量
> （假阳性）；且**常量消费点是 3 处**（`icon-ref.ts:34` / `export-package.ts:134` / `icon-service.ts:466`），
> 不是 2 处。
> ⚠️ 前缀有**两个字面量 owner**（`icon-ref.ts:11` 与 `storage-repository.ts:69`，后者为重实现、
> 自用于 `:515/:526/:566/:595/:653/:1066`）⇒ 属**既有**、**不阻断 T22**，但**不得新增第三处**。
> ⇒ 判据按"**不新增**"而非"**唯一**"（按"唯一"判会让 T22 一落码即红）。
>
> **`missingIcons` 实现修正**：**直接 `await IconService.isMissingIcon(source)`**（T6 已建、口径同源），
> **不得重写** `type==='upload' && value.startsWith(LOCAL_ICON_REF_PREFIX) && await repo.resolveIconReference(...)`
> 的 if 链（那会新增第三处前缀消费）。位置：`clearAndWriteWithCompensation` **成功之后**（写前算会把
> "即将被清"误报）；失败路径不返回清单。
  >
  > **⑤ 加严项**：域违规须**不同 `data-testid` 容器** + **"反串组"断言**（同记录不得同时出现在两
  > 组）+ **不可跳过**（无 dismiss/`×`，D15）；修复入口**只跳转 + 就地编辑**，测试断言
  > **"点击后未发生任何写类 `sendMessage`"**（C9 否决持久化标记）；**空组不渲染**
  > （例外：D10 重合按设计为**恒定提示**，须单独确认其条件）。

---

## 实施期追加任务（Planning Gap — 不占用 T1–T22 编号）

> 这些是本迭代实施/审查过程中新发现的缺陷与门禁，不属于原计划任务，**单列编号以消歧**（避免与上述 T1–T22 混淆）。
> 依据：`_context-output/designs/2026-10-04-import-export-decisions.yaml` 的 A6 revisions 与 C11。

- [ ] **FIX-A. UUID-23 — settings Undo 回放配方保真**
  - **缺陷**：`settings/App.tsx` 的 `handleUndo` 把快照（`UndoSnapshot` string-only）重放为 `{type:'upload', value:<PNG>}`，清除配方图标后撤销 ⇒ 配方永久拍扁为位图（违反 C1/A6）。
  - **修法**：加宽 `UndoSnapshot`（`ui/shared/undo-bar.tsx:17-20`）以承载原始 `IconSource`；捕获处（`settings/App.tsx:1482-1483`）按 `TierOwner` 重读记录取源；回放（`:1611/:1618`）原样重放，不再重积分。
  - **范围**：**仅 settings 一条**（另两条 sidebar Undo 路径捕获整个对象、`type` 保留、经 `writeSync` strip 兜住，非缺陷）。
  - **测试**：结构断言（快照存 `IconSource` 非 winner 串；回放后 `type:'template'` 保留）；反例锚点 `{ type: 'upload', value:` 不得出现在 Undo 回放路径。
  - **依据**：`decisions.yaml` A6「配方身份保真」+ T13 范围收窄 revision。

- [ ] **FIX-B. UUID-24 — `local.tabOverrides` 配方物化（覆盖 override 最高优先级层）**
  - **缺陷**：`resolveIconReferences` 只物化 sync 的 rules/slots，**不遍历 `local.tabOverrides`** ⇒ override 配方 `value` 恒 `''` ⇒ 链 `asSetFavicon('')` → null → 投递 restore/none ⇒ 当前页图标不生效。
  - **修法**：local 读路径补**等价物化**（**复用同一 `RecipeRenderer`**，落点在进链之前）；施加**同一 strip 不变式**（`writeLocal` 为 `LocalState` 唯一正规写口；`offloadLargeIcons`/`setPendingUndo`/sync-fallback 按 T14 修订豁免表对账）。
  - **测试**：真覆盖 override 层（非 rule 级），断言链上解析为 `data:image/png` + `LocalState` 持久态配方 `value` 仍为 `''`。
  - **依据**：`decisions.yaml` A6 R2 范围补全 revision。

- [ ] **FIX-C. UUID-25 — 编辑往返/反向转换配方身份保真（跨面统一不变量）**
  - **不变量**：唯一持久的必须是配方身份本身（`IconSource`），**不得由渲染值反推**。
  - **sub-a**：新增 `iconSourceToDraft(source: IconSource): IconFieldValue` 为**唯一源感知反向入口**（按 `source.type` 分派；`template` 不填 `dataUri`）；`iconSourceToIconConfig` 补 `url` 分支；**不删** `toIconFieldValue`（prop-派生无源路径）。
  - **sub-b**：新增 `iconSourceForOwner(owner, ctx)` 取源工具，一处实现、三处复用。
  - **sub-c**：🔴 **`InlineRuleEditor`（`settings/App.tsx:447-583`）必修** —— 持有完整 `rule.favicon`（`IconSource`）却按前缀猜，打开配方规则保存即降级 `upload`。
  - **sub-d**：`matchesLocal`（`field-editor.tsx:179`）iconConfig 分支复用 `iconConfigsEqual` **全字段**比较（现仅比 `dataUri` ⇒ composer 上线后重同步恒假 ⇒ 选择器不刷新）。
  - **具名残留**（本轮**显式标注不修**）：`CreateRuleModal`（sidebar `:1039/1042/1055/1056/1181`）+ 调用方 `handleSlotAddToGlobal:1997`、`applyChainValueToDraft:1127-1133`。
  - **反例锚点**：`rg -n "startsWith\('data:'\)" src/ui` 命中集合须收敛到例外清单（P2 prop-派生 + 显示-only + 具名残留）。
  - **依据**：`decisions.yaml` A6「跨面统一不变量」+ 反向门禁改锚 + `matchesLocal` + 前缀锚点 revisions。

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must PASS. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**

- [ ] F1. **Plan Compliance Audit**（recommended: `oracle`）

  Read the plan end-to-end executing:
  - **Must Have 逐项验证**：三动作存在、映射层独立、裸引用、配方持久化（**background 原样上送**）、消费方判定、清空槽、版本绑定、逐维模式、三态、域违规披露、恒定弹窗、重合提示、commands.update、**独立导出 section（Q2=B-2）**
  - **Must NOT Have 反例搜索**：`rg "EXPORT_CONFIG|IMPORT_PREVIEW|IMPORT_COMMIT" src/` → 0；`rg "\[local:" src/` → 0；`rg "data:image/(png|jpeg|webp)" src/background/import-export-service.ts` → 0；`rg "pendingUndo" src/background/import-export-service.ts` → 0；**`rg "renderIconToDataUri" src/background/` → 0（Q1=A）**；**`rg "export-panel" .` → 0 且 `vite.config.ts` 入口数仍为 7（Q2=B-2：未新增页面/入口）**
  - ⚠️ **反例搜索注意**：**不得**用 `rg "data:image/svg\+xml" src/background/` 作反例 —— `getPlaceholder()`（`icon-service.ts:386`）**本就产**该前缀（既有静态占位），会误报；Q1=A 的约束只针对"**配方渲染**"（`type:'template'` 不得被 background 渲染）
  - **Evidence 验证**：`_context-output/evidence/` 各任务证据文件存在
  - **Deliverable 验证**：逐条对照 Concrete Deliverables

  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | Evidence [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review**（recommended: `unspecified-high`）

  - **Build**: `npm run typecheck` → 0 error；`npm run build:chrome && npm run build:edge && npm run build:firefox` → 三浏览器成功
  - **Lint**: `npm run lint` → delta-0（证明未放宽）
  - **Tests**: `npm run test:unit && npm run test:integration && npm run test:ui-smoke` → ALL PASS
  - **Code patterns**: `as any`/`@ts-ignore`/空 catch/`console.log`(生产)/注释掉的代码/未用 import
  - **AI slop**: 过度注释、过度抽象、通用名（`data`/`result`/`temp`）

  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT: APPROVE/REJECT`

- [ ] F3. **Real Browser QA（浏览器 skill 自动化）**（recommended: `unspecified-high` + browser skill）

  从干净状态出发，**用浏览器 skill（`agent-browser` / `playwright-cli`）自动化**执行真实浏览器场景（尤其 **UI 侧 canvas 配方渲染产 PNG** + 真实 JSON 下载/上传）：
  - **逐场景执行**：按精确步骤捕获证据（真实浏览器视觉证据 `final-qa/*.png`）
  - **集成测试**：导出（**settings 页内的独立导出 section**）→ 导入全链路（同机往返 / 跨"机"往返）
  - **边界**：空包、仅策略包、域违规包、缺失图标包、匹配重合包
  - **Evidence**: `_context-output/evidence/final-qa/`

  > **无人工干预**：**不使用**"手工 Playwright"（仓库 `package.json` **无 Playwright 依赖**）——一律经**浏览器 skill** 自动化；F3 是**唯一**产出 `.png` 视觉证据的环节（任务级 QA 走 jsdom → `.txt`）。

  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT: APPROVE/REJECT`

- [ ] F4. **Scope Fidelity Check**（recommended: `deep`）

  - **Spec-Implementation 映射**：逐任务读 "What to do" + `git diff`，1:1 核对
  - **完整性**：设计 4 维度全实现，无遗漏
  - **Anti-Creep**：无 manifest / 无 EXPORT_DESCRIBE / 无强制备份 / 无撤销 / 无迁移逻辑
  - **Must NOT Do 合规**：逐任务核对
  - **Cross-Task 污染**：检测任务越界改他人文件
  - **Unaccounted 变更**：标记未列入任何任务的被改文件

  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT: APPROVE/REJECT`

---

## Commit Strategy

> 每个任务自成一个逻辑提交，保留独立可回滚的粒度；Wave 1 的契约/基建先落地以解锁后续。

```
Commit 1 (T0) : test(adapters): add directed + persistent storage failure injection
  Files: src/adapters/mock-adapter.ts, tests/unit/adapters/mock-adapter-failure.test.ts
  Pre-commit: npm run test:unit

Commit 2 (T1) : feat(shared): add portable export package schema + bidirectional mapping
  Files: src/shared/export-package.ts, tests/unit/shared/export-package-map.test.ts
  Pre-commit: npm run typecheck && npm run test:unit

Commit 3 (T2) : feat(shared): add IconSource.textColor + import intent/diff types
  Files: src/shared/types.ts, tests/unit/shared/types-icon-text-color.test.ts
  Pre-commit: npm run typecheck

Commit 4 (T3) : feat(background): relax regex gate to per-record skip + domain constraint partition
  Files: src/background/import-export-service.ts, tests/unit/background/domain-rules-partition.test.ts, tests/integration/import-export-service.test.ts
  Pre-commit: npm run test:integration

Commit 5 (T4) : feat(shared): add icon value classification (bare-ref detection, wrapper rejected)
  Files: src/shared/export-package.ts, tests/unit/shared/icon-ref-classify.test.ts
  Pre-commit: npm run test:unit

Commit 6 (T5) : feat(background): export icons as URL / bare ref / recipe (drop [local:] wrapper)
  Files: src/background/import-export-service.ts, src/shared/export-package.ts, tests/unit/shared/export-icon-rewrite.test.ts
  Pre-commit: npm run test:unit

Commit 7 (T6) : feat(background): treat unresolvable icon refs as missing + placeholder
  Files: src/background/storage-repository.ts, src/background/icon-service.ts, tests/unit/background/missing-icon-detection.test.ts
  Pre-commit: npm run test:unit

Commit 8 (T7) : feat(ui): persist icon recipes via single iconConfigToIconSource converter
  Files: src/ui/shared/icon-source.ts, src/ui/sidebar/App.tsx, src/ui/shared/rule-form-submit.ts, src/ui/settings/App.tsx, src/ui/shared/icon-field-editor.tsx, tests/unit/ui/icon-source-conversion.test.tsx
  Pre-commit: npm run typecheck && npm run test:unit

Commit 9 (T8) : feat(shared): add import diff, intent application, overlap detection
  Files: src/shared/import-diff.ts, tests/unit/shared/import-diff.test.ts
  Pre-commit: npm run test:unit

Commit 10 (T9) : test(integration): prove keep-existing path preserves rules (F2 guard)
  Files: tests/integration/import-fidelity.test.ts
  Pre-commit: npm run test:integration

Commit 11 (T10): feat(background): server-authoritative apply bound to preview configVersion (fix F4)
  Files: src/background/import-export-service.ts, tests/integration/import-apply-version-binding.test.ts
  Pre-commit: npm run test:integration

Commit 12 (T11): feat(background): clear replaced records' icon slots with compensation
  Files: src/background/storage-repository.ts, src/background/import-export-service.ts, tests/integration/import-icon-slot-clearing.test.ts
  Pre-commit: npm run test:integration

Commit 13 (T12): refactor(background): pass template recipes through unrendered; render at UI side (Q1=A)
  Files: src/background/storage-repository.ts, src/background/icon-service.ts, src/ui/shared/recipe-render.ts, tests/unit/background/recipe-storage.test.ts, tests/ui-smoke/recipe-render-ui.test.tsx
  Pre-commit: npm run typecheck && npm run test:unit

Commit 14 (T13): feat(shared): carry IconSource.textColor through storage and package round-trip
  Files: src/shared/export-package.ts, src/shared/import-diff.ts, tests/unit/shared/recipe-roundtrip-textcolor.test.ts
  Pre-commit: npm run test:unit

Commit 15 (T14): refactor(shared): redesign import/export protocol to EXPORT_PACKAGE/IMPORT_INSPECT/IMPORT_APPLY
  Files: src/shared/messages.ts, src/shared/types.ts, src/background/worker-orchestrator.ts, src/ui/shared/message-client.ts, tests/unit/shared/messages-import-export-contract.test.ts, tests/unit/shared/messages.test.ts
  Pre-commit: npm run typecheck && npm run test:unit

Commit 16 (T15): feat(adapters): add Firefox commands.update + Chrome/Edge capability reporting
  Files: src/adapters/contract.ts, src/adapters/chrome-adapter.ts, src/adapters/mock-adapter.ts, tests/unit/adapters/commands-capability.test.ts
  Pre-commit: npm run typecheck

Commit 17 (T16): test(integration): prove compensation path under injected storage failures
  Files: tests/integration/import-compensation.test.ts
  Pre-commit: npm run test:integration

Commit 18 (T17): feat(background): wire three import/export actions + enforce configVersion
  Files: src/background/worker-orchestrator.ts, src/ui/shared/message-client.ts, tests/integration/worker-import-export-routing.test.ts
  Pre-commit: npm run typecheck && npm run test:integration

Commit 19 (T18): feat(ui): rebuild import section with dimension modes + quantized confirm dialog
  Files: src/ui/settings/App.tsx, tests/ui-smoke/import-flow.test.tsx
  Pre-commit: npm run typecheck && npm run lint && npm run test:ui-smoke

Commit 20 (T19): feat(ui): add standalone export section (Q2=B-2) with dimension scope + package summary
  Files: src/ui/settings/App.tsx, src/ui/styles/settings.css, tests/ui-smoke/export-flow.test.tsx
  Pre-commit: npm run typecheck && npm run test:ui-smoke

Commit 21 (T20): feat(ui): evolve ImportPreviewTable to dimension-grouped field-expandable diff
  Files: src/ui/import-preview/App.tsx, tests/unit/ui/import-preview-table-evolved.test.tsx, tests/unit/ui/import-diagnostics.test.tsx
  Pre-commit: npm run typecheck && npm run test:unit

Commit 22 (T21): test(integration): migrate legacy anchors + add import/export end-to-end
  Files: tests/integration/import-export-e2e.test.ts, tests/unit/ui/import-diagnostics.test.tsx, tests/unit/shared/messages.test.ts, tests/ui-smoke/pages.smoke.test.tsx
  Pre-commit: npm run test:unit && npm run test:integration && npm run test:ui-smoke

Commit 23 (T22): feat(ui): render import result list (success/tolerant/domain/missing/overlap/shortcut)
  Files: src/ui/import-preview/App.tsx, src/ui/settings/App.tsx, tests/ui-smoke/import-result-list.test.tsx
  Pre-commit: npm run typecheck && npm run test:ui-smoke
```

**提交顺序约束**：
- Commit 15（协议重构）**必须**是单一提交（messages + types + KNOWN_ACTIONS + message-client + 测试）——拆开会造成"编译过、运行被拒"的中间态（G-D）。
- Commit 2 / 3 / 4 / 5（Wave 1 契约）应**先于**其消费者提交，以保持每个提交自洽可编译。
- Commit 19 与 20 **（T18 → T19）须串行提交**：**Q2=B-2** 下 T18 与 T19 **同改 `src/ui/settings/App.tsx`**（T18=导入区，T19=同文件内替换旧导出 UI 为独立 section）→ 执行顺序 **T18 → T19**，避免同文件并发编辑冲突。
- Commit 13（T12）落地 **Q1=A**：background **不再渲染配方**（`getSyncState` 原样上送），渲染落点迁移至 **UI 侧**（`src/ui/shared/recipe-render.ts`）→ 该提交**不得**在 `src/background/` 引入 `renderIconToDataUri`。

---

## Success Criteria

### Verification Commands

```bash
npm run typecheck        # Expected: 0 error
npm run lint             # Expected: delta-0（错误数不增）
npm run test:unit        # Expected: ALL PASS
npm run test:integration # Expected: ALL PASS（含补偿路径：注入失败 → 零改动 + local 恢复）
npm run test:ui-smoke    # Expected: ALL PASS
npm run build:chrome     # Expected: 成功（入口数仍为 7，未新增 export-panel 入口 — Q2=B-2）
npm run build:firefox    # Expected: 成功
rg "EXPORT_CONFIG|IMPORT_PREVIEW|IMPORT_COMMIT" src/   # Expected: 0 命中
rg "renderIconToDataUri" src/background/               # Expected: 0 命中（Q1=A：渲染只在 UI 侧）
rg "\[local:" src/                                     # Expected: 0 命中
```

### Final Checklist

- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tasks completed（T0–T22）
- [ ] All tests pass
- [ ] All QA scenarios executed with evidence
- [ ] All Final Verification reviews APPROVED
- [ ] User explicitly approved completion
- [ ] Evidence directory `_context-output/evidence/` populated
- [ ] 设计一致性修订未被回退（`2026-07-14-…-decisions.yaml` REVISED 标记保留）
- [ ] **Q1=A 已落地**：background **不渲染**配方；`rg "renderIconToDataUri" src/background/` → 0；配方在 **UI 侧**渲染为 PNG
- [ ] **Q2=B-2 已落地**：**独立导出 section**存在（位于 `src/ui/settings/App.tsx`，含维度勾选 + 记录展开 + 包摘要）；`rg "export-panel" .` → 0；`vite.config.ts` 入口数仍为 7