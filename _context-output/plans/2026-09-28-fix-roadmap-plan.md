# Fix Roadmap — Deep Code Review Remediation for Tab Bookmark Shortcuts

> **计划名称**: fix-roadmap-plan
> **创建时间**: 2026-09-28
> **创建者**: sw-strategic-planner (Prometheus)
> **状态**: Revised v2 — 3 blockers + 5 nits 已就地修订（见 Revision Log），待 sw-plan-reviewer 复审
> **计划文件路径**: `_context-output/plans/2026-09-28-fix-roadmap-plan.md`
> **修订版本**: v2（2026-09-28）— 修订 3 个 blocker（T9 协议白名单语义、T2 RED 构造、T17 回退路径）+ 5 项 nit（关键路径统一、T19 降级、T7 测试落点、行号漂移、OPEN_SIDEBAR 既有处理）

---

## TL;DR

> **Quick Summary**: 修复一次深度代码审查在 Manifest V3 跨浏览器扩展（Chrome/Edge/Firefox，TypeScript strict + React 18 + Vite 6 + Vitest 2）中发现的 **14 项缺陷（B1–B14）**，其中 4 项阻断发布（P0）。全部修复遵循 TDD：先产出失败测试（RED）→ 最小实现（GREEN）→ 质量门禁。
>
> **Deliverables**:
> - B1 `writeLocal` 串行队列失败后存活 + 错误传播（`src/background/storage-repository.ts`）
> - B2 `UNDO_SAVE` 基于 pendingUndo 快照真实恢复（`worker-orchestrator.ts` + `slot-service.ts`）
> - B3 `unbindSlot` 返回并传播 `WriteResult`（`slot-service.ts` + `worker-orchestrator.ts`）
> - B4 ReDoS 防护：正则编译缓存 + `validateRegex` 升级 + 导入预览安全校验（`url-utils.ts` + `import-export-service.ts`）
> - B5 incognito 能力边界诚实化（`manifests/*.json` + `chrome-adapter.ts` + `scripts/validate-manifest.mjs`）
> - B6 本地状态不可变更新（`storage-repository.ts`）
> - B7 icon 解析缓存 + `computeFields` 纯函数化（`storage-repository.ts` + `rule-service.ts`）
> - B8 icon fetch 超时/协议白名单/私网拒绝（`icon-service.ts`）
> - B9 favicon/icon 协议白名单：**允许 `data:` / `http:` / `https:`，拒绝 `javascript:` / `file:` / `blob:` / `data:text/html` 等危险协议**（`rule-service.ts` + `apply-fields.ts`）— 见 Revision Log B1/决策 (a)
> - B10 `INTERNAL` → `INTERNAL_ERROR` 类型收敛（`worker-orchestrator.ts`）
> - B11 UI 六页统一走 `message-client`，`chrome.*` 收敛到适配器（`src/ui/**`）
> - B12 `startupCleanup` / `reapplyToMatchingTabs` 批量化（`storage-repository.ts` + `rule-service.ts`）
> - B13 内容脚本已上报 URL 集合 LRU 上限（`src/content/index.ts`）
> - B14 受保护页前缀构建期共享常量（`scripts/*` + `content/index.ts` + `url-utils.ts`）
> - 4 个 Final Verification 审查报告（F1–F4）
>
> **Estimated Effort**: Large (3–5 天，23 个实现任务 + 4 个最终验证任务)
> **Parallel Execution**: YES — 5 waves (Sprint 0–3 + 低危可选波)
> **Critical Path（定义：最长依赖链）**: T1 (B1) → T6 (B6) → T10 (B7a) → T11 (B7b) → T12 (B12) → F1–F4 → user okay。此为 DAG 中节点数最多的依赖链（5 个实现任务 + FINAL 波）；**F1–F4 依赖全部 23 个实现任务**，故任一任务落在关键路径之外仍会阻塞 F1–F4。其余链短于此：T2 → T3（2 跳）、T19 → T16 → T17/T18（3 跳）、T4 → T5（2 跳）。

---

## Context

### Original Request

> 为项目 `c:/myProjects/github/Tab-Bookmark-Shortcuts` 制定一份**可执行的修复工作计划**，修复一份已完成的深度代码审查所发现的全部问题。质量门禁命令：`npm run lint`（0-warning）、`npm run typecheck`、`npm run test:unit`、`npm run test:integration`、`npm run test:ui-smoke`、`npm run build:chrome` / `build:edge` / `build:firefox`。**只做规划，不要实现代码。**

审查问题清单已带证据行号提供（B1–B14 + 4 项低危），要求按 Sprint 0–3 落实为 Wave，产出任务化、带 DAG 依赖、每任务含 RED→GREEN→门禁验收标准、标注文件/风险/阻塞点的计划。

### Interview Summary

本计划**免除访谈轮次**，用户在请求中已提供完备输入（问题清单、证据行号、排期建议、验收方式、测试风格提示）。依据"自我清关检查"：

- 核心目标明确：YES（修复 B1–B14 + 低危项）
- 范围边界建立：YES（IN/OUT 见 Work Objectives）
- 关键歧义残留：YES，**v2 已将 5 项（B9 语义 / T17 范围 / T2 构造 / T19 定位 / T7 测试落点）定案**（见 Decisions Resolved in v2），另有 5 项需执行期决策（见 Decisions Needed），均不阻断 Wave 1 启动
- 技术方案已决定：YES（清单已给出修复方向，本计划将其细化为任务）
- 测试策略已确认：YES（TDD，复用 `mock-adapter` 的 `nextError` / `executeScriptError` 故障注入）
- 阻塞性问题：见 Risks

**Key Decisions**:
- **计划落盘位置**：项目 `_context-output/` 为既有输出约定（仅含 `designs/`），故计划写入 `_context-output/plans/2026-09-28-fix-roadmap-plan.md`，evidence 写入 `_context-output/evidence/`。不复用 skill 默认的 `_context/memory/sw-shared/`（该目录在本项目不存在）。
- **Wave = Sprint**：直接采用用户建议的 Sprint 0–3 映射为 Wave 1–4，并追加 Wave 5（低危可选）与 Wave FINAL（F1–F4）。
- **文件冲突规避**：同一文件被多任务触碰时强制串行（如 `worker-orchestrator.ts` 的 B2/B3、`storage-repository.ts` 的 B6/B7/B12、**`shared/url-utils.ts` 的 T4/T9/T15**），已在依赖矩阵标注。
- **每个缺陷独立 RED**：每个任务先写失败测试再实现，而非一次性写全部测试。
- **B9 语义边界（v2）**：协议白名单 = `data:`（限 `data:image/*`）/ `http:` / `https:`；拒绝 `javascript:`/`file:`/`blob:`/`data:text/html`。安全目标是关闭危险协议注入面，而非禁止远程 favicon（详见 Revision Log Blocker 1）。

### Research Findings

**Codebase Analysis**（通过直接读取源码与测试目录验证，所有引用行号已核实存在）:

- `storage-repository.ts:412-420` `writeLocal` 确无 `.catch` 复位；对照 `writeSync:247` 有 `.catch(() => ...)` 复位 → B1 证据成立。
- `worker-orchestrator.ts:284-292` `UNBIND_SLOT` 与 `UNDO_SAVE` 均调用 `slotService.unbindSlot`，且 `slot-service.ts:470-476` 的 `unbindSlot` 丢弃 `removeSlot` 返回值（`await this.repo.removeSlot(slotId, version)` 未接收结果）→ B2/B3 证据成立。
- `url-utils.ts:69-105` `validateRegex` 仅检查长度与语法；`url-utils.ts:167-178` `matchesUrl` 每次 `new RegExp()` 无缓存 → B4 证据成立。
- `chrome-adapter.ts:309-320` `isAllowed()` 读 `chrome.runtime.getManifest().incognito !== 'not_allowed'`；`manifests/base.json` 全文确认**未声明 `incognito` 键** → 恒返回 `true` → B5 证据成立。
- `storage-repository.ts:183-188` `getLocalState` 仅 `{ ...this.localCache! }`（浅拷贝），mutator 直接 `push` → B6 证据成立。
- `storage-repository.ts:175-181` `getSyncState` 每次 `resolveIconReferences`；`rule-service.ts:550-558` `reapplyToMatchingTabs` 循环内逐标签调用 `computeFields` → B7 证据成立。
- `icon-service.ts:90-106` `fetch(url, { mode: 'cors' })` 无 `AbortController`、先 `response.ok` 后读 blob → B8 证据成立。
- `rule-service.ts:378-385` `resolveSlotField` 直取 `slot.faviconSnapshot` 与 `slot.uiMarker.icon.value`；`apply-fields.ts:52` `link.href = favicon` → B9 证据成立。
- `worker-orchestrator.ts:300/321/329` 返回字面量 `errorCode: 'INTERNAL'`，而 `types.ts:254` 的 `DomainErrorCode` 仅有 `'INTERNAL_ERROR'`（类型漂移未被 TS 拦截）→ B10 证据成立。
- `content/index.ts:18-20` `reportedUrls` / `appliedUrls` 无界；`content/index.ts:23-32` 与 `url-utils.ts:332-341` 前缀列表重复 → B13/B14 证据成立。

**关键发现（影响计划结构与验证）**:

1. **`tests/ui-smoke/` 目录不存在** — `vitest.workspace.ts:36-46` 声明了 `ui-smoke` project 且 `package.json` 有 `test:ui-smoke` 脚本，但无任何测试文件。UI 测试全部位于 `tests/unit/ui/`。→ **影响 B11 验证**：B11 是最大的 UI 重构（6 页），若无 ui-smoke 落地，任何"仅改 UI 入口"的回归只能靠 `tests/unit/ui/*.test.tsx` 覆盖。已新增 **T19** 作为可选基础任务，并在 Decisions Needed 中标注。
2. **`sidebar-adapter.ts` 与 `message-client.ts` 在生产代码零引用**（`search_content` 对 `src/` 搜索 `message-client|sidebar-adapter` 返回 0 命中）→ B11 描述的"收敛到适配器"实际是**建立新接线**而非替换既有调用，工作量比表面更大。
3. **`resolveSlotField` 与 `computeFields` 是同一 favicon 数据链的两个环节**（`rule-service.ts`），B9 与 B7/B12 在此文件交叉 → 已在 DAG 中串行化。
4. **`removeSlot` 返回 `WriteResult`**（`storage-repository.ts` 版本检查式写入），故 B3 只需在 `unbindSlot` 接收并向上传递，无需改存储层。
5. **`mock-adapter.ts:28-30` 提供 `nextError` / `executeScriptError` 一次性故障注入**（`checkError()` 消费后清空），是 B1/B2/B3/B8 的 RED 测试首选工具；`adapter.reset()`（:103-110）会重置两者。

### Pre-Planning Review (sw-pre-planning-consultant)

**Intent Classification**: `Refactoring`（置信度 high）—— 修改既有代码以修复缺陷，**行为在缺陷维度上发生变化**（这正是修复的目的），但不引入新功能、不改变公共契约形态。混合少量 `Mid-sized Task` 特征（B5 跨 manifest/脚本/适配器）。

**Identified Gaps** (addressed):
- *"行为保持边界"*：修复必然改变行为（这正是目的），故必须为**每个任务**明确"仅改变缺陷行为，其余行为由既有测试保持"。已在各任务 `Must NOT do` 与回归门禁中落实。
- *"ui-smoke 门禁为空"*：已在 T19 与 Decisions Needed 中处理，且所有任务验收不依赖它（改依赖 `test:unit` / `test:integration`）。
- *"B2 语义未闭环"*：清单指出"无快照时应改文案为'删除槽位'"，但未指定快照存储键名与 TTL 清理机制。本计划给出 `storage.local` 的 `pendingUndo` 键 + 5s TIMER 清理的显式设计（见 T3）。
- *"B5 能力边界表述"*：`not_allowed` 与"用户持久化授权标志"的关系需明确——本计划采用"manifest 声明 `not_allowed` + `storage.local` 持久化用户授权标志作为 `isAllowed` 判据"（见 T7）。

**Guardrails Recommended**:
- **不做行为无关的重构**：禁止顺手清理无关代码、重命名公共 API、调整非缺陷路径的格式。
- **不引入新依赖**：禁止为 LRU/缓存/并发引入 npm 包（手写即可，避免供应链面扩大）。
- **不加无测试的修复**：每个任务必须先有失败测试，测试必须能在旧代码上失败（可验证 RED）。
- **不扩大网络行为**：B8/B9 修复只能**收紧**网络/协议许可，绝不放宽。
- **不做 scope creep 的"顺便优化"**：低危项（T20–T23）单列 Wave 5，可裁剪。
- **QA 零人工**：所有验收由命令/测试断言完成，禁止"用户人工验证"。

---

## Work Objectives

### Core Objective

在**不改变公共契约形态、不引入新依赖**的前提下，用 TDD 修复深度审查发现的 14 项缺陷（B1–B14），使 P0 阻断项全部闭环、P1 安全/正确性/性能项达标、P2 架构漂移项收敛，且全套质量门禁（lint/typecheck/unit/integration/build×3）保持绿色。

### Concrete Deliverables

- [ ] `src/background/storage-repository.ts` — B1 `writeLocal` 队列存活；B6 不可变更新；B7 icon 解析缓存；B12 `startupCleanup` 批量查询
- [ ] `src/background/worker-orchestrator.ts` — B2 pendingUndo 快照恢复；B3 `WriteResult` 传播；B10 `INTERNAL_ERROR` 收敛
- [ ] `src/background/slot-service.ts` — B3 `unbindSlot` 返回 `WriteResult`
- [ ] `src/shared/url-utils.ts` — B4 正则编译缓存 + ReDoS 加固；B14 引用共享前缀常量
- [ ] `src/background/import-export-service.ts` — B4 导入预览 regex 安全校验
- [ ] `src/background/icon-service.ts` — B8 超时/协议/私网防护
- [ ] `src/background/rule-service.ts` — B7b `computeFields` 纯函数化；B9 favicon **危险协议黑名单**（放行 `data:`/`http:`/`https:`，拒绝 `javascript:`/`file:`/`blob:`/`data:text/html`）
- [ ] `src/background/apply-fields.ts` — B9 注入端危险协议防御性拒绝（同一白名单内联）
- [ ] `manifests/base.json` + `chrome.json` + `edge.json` + `firefox.json` — B5 `incognito: not_allowed`
- [ ] `src/adapters/chrome-adapter.ts` — B5 `isAllowed` 基于持久化授权标志
- [ ] `scripts/validate-manifest.mjs` — B5 断言 `incognito` 键存在
- [ ] `src/content/index.ts` — B13 LRU 上限；B14 引用生成常量
- [ ] `scripts/gen-protected-prefixes.mjs`（新建）+ 生成产物 — B14 单一真源
- [ ] `src/ui/**`（6 入口）— B11 统一 `message-client`，`chrome.*` 收敛
- [ ] 新增/扩展测试：`tests/unit/shared/url-utils.test.ts`、`tests/unit/background/{icon-service,unbind-slot,rule-service}.test.ts`、`tests/integration/{storage-repository,worker-orchestrator,import-export-service}.test.ts`、`tests/unit/adapters/adapter.test.ts`
- [ ] **新增** `tests/unit/adapters/chrome-adapter-incognito.test.ts` — B5（T7）针对真实 `createChromeAdapter` 的 `chrome` 全局桩测试（`mock-adapter.isAllowed` 不读 manifest/storage，无法验证该修复；见 Revision Log nit#3）
- [ ] Final Verification 报告 F1–F4（输出到对话）

### Definition of Done

- [ ] `npm run lint` → 退出码 0，0 warning（`--max-warnings 0`）
- [ ] `npm run typecheck` → 退出码 0，0 error
- [ ] `npm run test:unit` → 全绿，且新增测试数 ≥ 12
- [ ] `npm run test:integration` → 全绿，且新增测试数 ≥ 8
- [ ] `npm run build:chrome` / `build:edge` / `build:firefox` → 三个均成功产出 `dist/<browser>/manifest.json`
- [ ] `node scripts/validate-manifest.mjs chrome|edge|firefox` → 三浏览器均 PASSED
- [ ] 每个 B 项有至少 1 个"能在修复前失败、修复后通过"的测试
- [ ] F1–F4 四份审查全部 APPROVE

### Must Have

- B1–B14 全部有对应实现改动 + 对应测试
- B4 的 `validateRegex` 能拒绝灾难性回溯模式（`(a+)+$`、`(.*)*`、`(x+)+`）并返回 `REGEX_RISK`
- B2 的 `UNDO_SAVE` 在存在快照时**恢复槽位定义 + binding**，而非删除
- B5 的 `manifests/base.json` 显式含 `"incognito": "not_allowed"`，且 `validate-manifest.mjs` 对其断言
- B8 的 icon fetch 具备 8s 超时、http/https 白名单、loopback/私网拒绝
- B9 的 `link.href` **只接受协议白名单内取值**：`data:`（含 `local-icon:` 解析结果）/ `http:` / `https:`；**拒绝** `javascript:` / `file:` / `blob:` / `data:text/html`（危险协议）——安全意图是"关闭危险协议注入面"，不是"禁止一切远程 favicon"（见 Revision Log Blocker 1 决策 (a) 及论证）
- 全部修复不引入新 npm 依赖
- 每个任务含 QA 场景（含 ≥1 failure/edge 场景）与证据路径

### Must NOT Have (Guardrails)

- ❌ **禁止**实现代码之外的"顺手重构"——不改公共 API 名称与形状、不重排无关代码、不升级依赖
- ❌ **禁止**为 LRU/缓存/并发/超时引入 npm 包（手写实现）
- ❌ **禁止**放宽任何网络/协议许可（B8 只做收紧；B9 的协议白名单为 `data:`/`http:`/`https:` 闭集，**禁止**加入 `file:`、`ftp:`、`javascript:`、`blob:`、`data:text/html` 或通配符协议）
- ❌ **禁止**以"B9 只允许 data URI"为名改动既有集成测试断言（`rule-delivery-real-dom.test.ts` / `rule-apply-persistence.test.ts` / `rule-delivery-robust.test.ts` 中 http(s) favicon 断言是**合法行为护栏**，必须保持通过；见 Revision Log Blocker 1）
- ❌ **禁止**在没有可验证失败测试的情况下提交修复（反 TDD）
- ❌ **禁止**改动 `src/adapters/contract.ts` 的公共接口签名（B5 只改实现语义与 manifest，不改 `isAllowed(): Promise<boolean>` 形状）
- ❌ **禁止**把计划拆成多文件（单一计划原则）
- ❌ **禁止**在验收标准中出现"用户手动测试/目视确认"
- ❌ **禁止**改动 `src/shared/messages.ts` 中既有 action 的 payload 形状（B11 只做接线与收敛，如需新 action 必须是新增而非改型）
- ❌ **禁止**触碰 B1–B14 之外的代码路径（低危项若非纳入 Wave 5 则不修）

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.
> Acceptance criteria requiring "user manually tests/confirms" are FORBIDDEN.

### Test Decision

- **Infrastructure exists**: YES（Vitest 2 workspace：`unit` / `integration` / `ui-smoke` 三 project；`tests/setup.ts`；`@testing-library/react`）
- **Automated tests**: **TDD** — 每任务 RED（失败测试）→ GREEN（最小实现）→ REFACTOR
- **Framework**: Vitest 2（`vitest.workspace.ts`）+ jsdom + Testing Library
- **Fault injection**: `mock-adapter` 的 `state.nextError` / `state.executeScriptError`（一次性、被 `checkError()` 消费）+ `adapter.reset()`（`mock-adapter.ts:103-110`）
- **RED 可验证性要求**：每个新测试必须先在**未修复代码**上运行并观察到失败，再实现。执行者须在证据文件中记录 RED 运行输出。

### QA Policy

Every task MUST include agent-executed QA scenarios.
Evidence saved to `_context-output/evidence/task-{N}-{scenario-slug}.{ext}`（本计划采用项目既有 `_context-output/` 约定）。

- **Library/Module（本项目主体）**: 使用 Bash（`npx vitest run <file>` / `npm run test:unit`）— 导入函数、调用、断言返回值
- **UI 组件**: 使用 Bash（`npm run test:unit -- tests/unit/ui/*.test.tsx`）+ Testing Library — 渲染、交互、断言 DOM
- **Manifest/构建**: 使用 Bash（`node scripts/validate-manifest.mjs <browser>`、`npm run build:chrome`）— 断言退出码与 stdout
- **静态检查**: 使用 Bash（`npm run lint` / `npm run typecheck`）

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Sprint 0 — 阻断发布 / P0，立即可启动):
├── T1: B1 writeLocal 队列存活 + 错误传播
├── T2: B3 unbindSlot 返回 WriteResult 并向上传播
├── T4: B4a url-utils 正则编译缓存 + validateRegex ReDoS 加固
│        └─ (串行于同 Wave) T3: B2 UNDO_SAVE pendingUndo 快照恢复  ← 依赖 T2
│        └─ (串行于同 Wave) T5: B4b ImportExportService 预览 regex 安全校验 ← 依赖 T4

Wave 2 (Sprint 1 — 安全/正确性 / P1，需 Wave 1 完成):
├── T6: B6 本地状态不可变更新（storage-repository）
├── T7: B5 incognito 能力边界（manifests + adapter + validator）
├── T8: B8 icon fetch 超时/协议/私网防护
└── T9: B9 favicon / uiMarker.icon 危险协议黑名单（rule-service + apply-fields）

Wave 3 (Sprint 2 — 性能 / P1，需 T6 完成):
├── T10: B7a iconResolutionCache（storage-repository）      ← 依赖 T6
├── T11: B7b computeFields 纯函数化 + 循环外读状态（rule-service） ← 依赖 T10
└── T12: B12 startupCleanup / reapplyToMatchingTabs 批量化  ← 依赖 T10, T11

Wave 4 (Sprint 3 — 架构收敛 / P2，可与 Wave 2/3 部分并行):
├── T13: B10 INTERNAL → INTERNAL_ERROR 类型收敛
├── T14: B13 内容脚本 LRU 上限
├── T15: B14 受保护页前缀构建期共享常量
├── T19: ui-smoke 测试脚手架落地（**可独立交付的并行可选前置**，非 T16 硬门禁）
└── (串行于同 Wave)
     ├── T16: B11a 六页统一 message-client                 ← 无硬前置；护栏 = 15 个既有 UI 单测（T19 为并行可选前置）
     ├── T17: B11b sidebar 主路径走 OPEN_PAGE / 回退收敛单一 helper ← 依赖 T16
     └── T18: B11c sidebar-adapter 接线或删除 + OPEN_SIDEBAR 入路由 ← 依赖 T16

Wave 5 (低危可选 — 可裁剪，不阻断发布):
├── T20: notifications iconUrl 回退 runtime.getURL
├── T21: handleMessage action 白名单 + 响应超时
├── T22: 中英错误文案统一
└── T23: detectBrowserType 以 API 形态为主判据

Wave FINAL (全部实现任务之后 — 4 路并行审查，然后取用户 okay):
├── F1: Plan Compliance Audit
├── F2: Code Quality Review
├── F3: Real Manual QA (agent-executed)
└── F4: Scope Fidelity Check
→ 呈现结果 → 取得用户显式 okay

Critical Path (定义 = 最长依赖链): T1 → T6 → T10 → T11 → T12 → F1–F4 → user okay
              （5 个实现任务 + FINAL 波，为 DAG 中最长链；T2→T3 与 T19→T16→T17/T18 均更短）
              注意：F1–F4 依赖 ALL 23 个实现任务，故关键路径仅表示"最早可完成时间"下界；
              任一任务延期仍会推迟 F1–F4，需统一协调。
Parallel Speedup: ~55% faster than sequential
Max Concurrent: 4 (Wave 2)
```

### Dependency Matrix

```
- T1: No dependencies (Wave 1)
- T2: No dependencies (Wave 1)
- T3: depends on T2 (同文件 worker-orchestrator.ts UNBIND/UNDO 分支串行)
- T4: No dependencies (Wave 1)
- T5: depends on T4 (复用升级后的 validateRegex)
- T6: depends on T1 (同文件 storage-repository.ts，B1 先落地)
- T7: No dependencies (Wave 2；跨 manifests/scripts/adapter，独立)
- T8: No dependencies (Wave 2；icon-service.ts 独立)
- T9: depends on T4（同文件 `src/shared/url-utils.ts`：T9 在其上追加 `isSafeFaviconProtocol`，须晚于 T4 的缓存/ReDoS 改动）
  ⚠️ 行内护栏：既有 `rule-delivery-real-dom.test.ts` / `rule-apply-persistence.test.ts` / `rule-delivery-robust.test.ts` 的 http(s) favicon 断言必须保持通过（协议白名单含 http/https）
- T10: depends on T6 (同文件 storage-repository.ts 串行)
- T11: depends on T10, T9 (rule-service 需消费已解析状态；且与 T9 同文件 `rule-service.ts` 串行)
- T12: depends on T10, T11 (storage-repository startupCleanup + rule-service reapply 串行)
- T13: No dependencies (Wave 4；worker-orchestrator.ts 的 catch 分支，与 B2/B3 不同区域 → 但与 T3 同文件，须在 T3 之后)
- T14: No dependencies (Wave 4；content/index.ts）
- T15: depends on T14（同文件 `content/index.ts`）+ T9（同文件 `src/shared/url-utils.ts`；须晚于 T9 追加的 `isSafeFaviconProtocol`）
- T16: No hard dependency（护栏 = 15 个既有 UI 单测）；T19 为**并行可选前置**（提供 ui-smoke 额外承接，非阻断）
- T17: depends on T16
- T18: depends on T16
- T19: No dependencies (Wave 4 基础任务，可独立交付；不阻断 T16–T18)
- T20, T21: No dependencies (Wave 5)
- T22: depends on T13 (同 worker-orchestrator/rule-service 区域)
- T23: No dependencies (Wave 5；adapters）
- F1–F4: depend on ALL implementation tasks (T1–T23)
- **Longest chain（关键路径）**: T1 → T6 → T10 → T11 → T12 → F1–F4
```

### Agent Dispatch Summary

```
- Wave 1: 5 tasks — T1->deep(并发/队列语义), T2->quick, T3->deep(状态机+TTL), T4->deep(ReDoS), T5->quick
- Wave 2: 4 tasks — T6->deep(不可变语义), T7->deep(跨模块), T8->deep(网络安全), T9->quick
- Wave 3: 3 tasks — T10->deep, T11->deep(重构+性能), T12->deep(并发批处理)
- Wave 4: 7 tasks — T13->quick, T14->quick, T15->deep(构建期代码生成), T16->deep(UI 大改), T17->deep, T18->unspecified-high, T19->quick
- Wave 5: 4 tasks — T20->quick, T21->quick, T22->quick, T23->quick
- Wave FINAL: 4 tasks — F1->oracle, F2->unspecified-high, F3->unspecified-high, F4->deep
```

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: WHAT TO DO + QA SCENARIOS + References + Commit info.
> **A task WITHOUT QA Scenarios is INCOMPLETE. No exceptions.**
> **TDD 铁律**：先写测试并观察 RED，再实现 GREEN，最后跑门禁。

---

### Wave 1 — Sprint 0（阻断发布 / P0）

- [x] T1. **B1 — `writeLocal` 串行队列失败后保持存活并向上传播错误**

  **What to do**:
  - 在 `src/background/storage-repository.ts:412-420` 修改 `writeLocal`：把队列保存为一个**永不 rejected** 的 promise（操作链尾部追加 `.catch` 复位），同时让**本次调用**仍返回/抛出真实错误给调用方。
  - 参照 `writeSync:247` 的既有复位模式（`this.syncWriteQueue = operation.catch(() => ({success:false,...}))`），但注意 `writeLocal` 返回 `Promise<void>`：需拆分"队列存活链"与"调用方可见错误"——建议实现为 `const run = this.localWriteQueue.then(...); this.localWriteQueue = run.catch(() => undefined); return run;`，使 `localWriteQueue` 永不复位失败，而 `run` 的 rejection 传播给调用方。
  - 补集成测试 `tests/integration/storage-repository.test.ts`：用 `adapter.state.nextError = { code: 'BROWSER_API_ERROR', message: 'inject' }` 注入一次性写失败（`mock-adapter.ts:27-30` 定义 `{ code: string; message: string }`，`:85-91` 的 `checkError()` 消费后清空）→ 断言该次 `setBinding` reject（`writeLocal` 不吞错，直接把 `storage.set` 抛出的错误传播给调用方）；**第二次**调用必须在无注入情况下**成功**（证明队列存活）。
    - ⚠️ **注入时机**：必须保证 `nextError` 被 **`storage.set`** 消费，而非被更早的适配器调用消费。前提是 `repo.initialize()` 已完成（`localCache` 已加载，`getLocalState()` 走缓存**不发 IO**），故 `writeLocal` 内首个触发 `checkError()` 的调用即 `adapter.storage.set`。若测试中使用了 `adapter.setTabs`/`tabs.query` 等前置调用，须在其**之后**再设 `nextError`（v1 未注明此约束，易导致注入被"提前消费"而假绿/假红）。
    - 注：`code` 取值需使用 `DomainErrorCode` 的真实成员（`BROWSER_API_ERROR` 等）；v1 使用的 `'STORAGE_ERROR'` **不在** `DomainErrorCode`（`src/shared/types.ts:211-255`）中，已修正。
  - 覆盖所有 `writeLocal` 消费方之一（如 `setBinding`）作为失败注入点。

  **Must NOT do**:
  - 不改 `writeLocal` 的签名（保持 `Promise<void>`）。
  - 不改 `writeSync` / `mutateSync` 的既有行为。
  - 不为"吞掉错误"而把 `writeLocal` 改成返回 `WriteResult`（那是 B3 的范围，属于不同层）。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 涉及 Promise 队列错误语义（存活 vs 传播的职责拆分），易出现"修好一半"的隐蔽错误。
  - **Skills**: [`sw-systematic-debugging`, `sw-verification-before-completion`]
    - `sw-systematic-debugging`: 队列永久 rejected 是典型"持久态污染"缺陷，需根因驱动而非试错。
    - `sw-verification-before-completion`: 必须以注入证据证明"第二次成功"，不能凭直觉声明修复。
  - **Skills Evaluated but Omitted**:
    - `sw-lint-checker`: 由统一门禁覆盖，无需单独加载。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T2, T4)
  - **Blocks**: T6（同文件 storage-repository.ts 串行）
  - **Blocked By**: None (can start immediately)

  **References**:
  - **Pattern References**:
    - `src/background/storage-repository.ts:205-249` — `writeSync` 的队列复位模式（`:246-247` 的 `.catch(() => ({success:false, errorCode:'INTERNAL_ERROR', ...}))`）；这是本任务要移植到 `writeLocal` 的范式。
    - `src/background/storage-repository.ts:490-510` — `mutateSync` 的同类复位（第二处对照，已核实为 `mutateSync` 所在区段）。
    - `src/background/storage-repository.ts:412-420` — **被修复点**：`writeLocal` 现行实现。
  - **API/Type References**:
    - `src/background/storage-repository.ts:writeLocal` — 签名 `(updater: (current: LocalState) => LocalState): Promise<void>`。
    - `src/shared/types.ts:LocalState` — 本地状态形状。
  - **Test References**:
    - `tests/integration/storage-repository.test.ts:53-70` — `setBinding` 写 local 的既有测试结构，作为新增失败注入测试的模板。
    - `src/adapters/mock-adapter.ts:28` / `:85-91` — `nextError` 与一次性 `checkError()` 消费语义；注入后仅影响下一次操作。
    - `src/adapters/mock-adapter.ts:103-110` — `reset()` 重置 `nextError`。
    - `tests/unit/background/sync-write-resilience.test.ts` — 既有"写入韧性"测试范式，可对照其命名与断言风格。
  - **External References**:
    - MDN `Promise.prototype.catch` — `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/catch`（确认 catch 返回新 promise 不污染原链）。
  - **WHY Each Reference Matters**: `writeSync` 的 `:246-247` 复位写法是本仓库已验证范式，照搬可保证一致性；`mock-adapter.nextError` 是唯一能在集成层注入一次性存储故障的钩子，B1 的 RED 测试必须依赖它。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新增测试先运行于未修复代码 → **RED**（证明测试有效），证据：`_context-output/evidence/task-1-red.txt`
  - [ ] `npx vitest run tests/integration/storage-repository.test.ts` → ALL PASS（新增 ≥ 2 tests：相继失败的第二次写成功 + 错误传播）
  - [ ] `npm run test:integration` → ALL PASS（无回归）

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 首次写失败后，第二次本地写仍成功
    Tool: Bash (test runner)
    Preconditions: mock-adapter 已 reset，StorageRepository 已 initialize
    Steps:
      1. 在 repo.initialize() 与所有前置 setTabs/query 之后，设 adapter.state.nextError = { code: 'BROWSER_API_ERROR', message: 'inject' }
      2. await repo.setBinding(bindingA) → 断言该次调用 reject（错误被传播）
      3. 不设 nextError，await repo.setBinding(bindingB)
      4. 断言 setBinding(bindingB) 成功；await repo.getLocalState() 的 bindings 包含 bindingB
    Expected Result: 第二次写成功且 local 缓存含 bindingB
    Failure Indicators: 第二次写仍 reject（队列永久 rejected 未修复）/ 缓存与存储分裂
    Evidence: _context-output/evidence/task-1-queue-survives-after-failure.txt

  Scenario: 队列失败不复位时仍向调用方传播错误
    Tool: Bash (test runner)
    Preconditions: 同上
    Steps:
      1. 注入 nextError，调用 writeLocal 消费方
      2. 断言 Promise rejection 被调用方观察到（expect(...).rejects）
    Expected Result: 调用方收到错误，而非静默成功
    Evidence: _context-output/evidence/task-1-error-propagates-error.txt
  ```

  **Commit**: YES (groups with none)
  - Message: `fix(storage): keep local write queue alive after failure (B1)`
  - Files: `src/background/storage-repository.ts, tests/integration/storage-repository.test.ts`
  - Pre-commit: `npm run lint && npm run typecheck && npm run test:integration`

- [x] T2. **B3 — `unbindSlot` 返回并传播 `WriteResult`（不再静默丢弃）**

  **What to do**:
  - `src/background/slot-service.ts:470-476`：把 `unbindSlot(slotId: number): Promise<void>` 改为 `Promise<WriteResult>`；接收 `const result = await this.repo.removeSlot(slotId, version)` 并 `return result`（含版本冲突失败信息）。
  - `src/background/worker-orchestrator.ts:284-286`（`UNBIND_SLOT` 分支）：`const result = await this.slotService.unbindSlot(...)`；若 `!result.success` 则 `return { success:false, errorCode: result.errorCode ?? 'INTERNAL_ERROR', message: result.message ?? 'unbind failed' }`。
  - 更新所有 `unbindSlot` 调用点（含 T3 将改的 `UNDO_SAVE` 分支），确保处理返回值而非忽略。
  - 补测试 `tests/unit/background/unbind-slot.test.ts`（已存在，扩展它）：**用"仅 sync 区写入失败"的故障桩构造 RED**——先 `seed`/`saveSlot` 建好槽位与绑定，再按 `tests/unit/background/sync-write-resilience.test.ts:31-38` 的既有模式覆写适配器：`const originalSet = adapter.storage.set; adapter.storage.set = async (area, items) => { if (area === 'sync') throw new Error('QUOTA_BYTES exceeded'); return originalSet(area, items); }`（在 `finally` 中还原）。此时：
    - `removeBinding`（写 `local`）**成功**；
    - `removeSlot`（写 `sync`）路径为 `writeSync` → `setSyncWithRetry` → `isQuotaError`（`storage-repository.ts:322-325`，`/quota/i` 命中 `QUOTA_BYTES`）→ 直接 rethrow → 被 `writeSync` 的 catch 捕获 → `classifyWriteError`（`:290-300`）→ 返回 `{ success:false, errorCode:'BROWSER_API_ERROR', message:'Storage quota exceeded...' }`。
    - 断言：`const r = await slotService.unbindSlot(1); expect(r).toMatchObject({ success:false, errorCode:'BROWSER_API_ERROR' })`；并断言 `handleMessage({action:'UNBIND_SLOT', payload:{slotId:1}})` 的响应 `success === false`。
    - **RED 可验证性**：v1 的 `unbindSlot` 返回 `void`（`r` 为 `undefined` → `expect(r).toMatchObject(...)` 失败），且 `UNBIND_SLOT` 恒返回 `{success:true}` → 两条断言均失败，构成有效 RED。
  - ⚠️ **不要用 `emitStorageChange` 构造 configVersion 冲突**（v1 计划的错误构造）——`handleStorageChange`（`storage-repository.ts:151-159`）在 `areaName==='sync' && changes[SYNC_KEY]` 时**直接写 `this.syncCache = newValue`**，故 `getConfigVersion()` 立即返回新值；而 `unbindSlot` 用 `version = this.repo.getConfigVersion()`（`slot-service.ts:474`）**永远取当前值**，版本必然匹配 → `removeSlot` 返回 `success:true`，断言"`success===false`"必失败。v1 所称"repo 内部版本仍为 0"**不可达**（见 Revision Log Blocker 2）。
  - ⚠️ 另一处不可达路径（记录以免执行者误用）：靠直接改 `adapter.state.syncStorage['syncState'].configVersion = 5` 且**不触发** `emitStorageChange` 来制造"`getConfigVersion()` 落后"也不成立——`writeSync` 内部第一步即 `const current = await this.getSyncState()`（`storage-repository.ts:213`），在 `cacheValid===false` 时会 `hydrate()` 从真源重读并自愈。故 **T2 不覆盖 configVersion 冲突分支**；该分支的既有覆盖由 `tests/integration/storage-repository.test.ts:124-136`（`CONFIG_CONFLICT`）承担，无需重复。

  **Must NOT do**:
  - 不改 `removeSlot` 的签名与语义（它已正确返回 `WriteResult`）。
  - 不在冲突时"重试"（那是新行为，超出范围）——只如实传播失败。
  - 不改动 `removeBinding` 的调用顺序（仍先解绑 local 再尝试删 slot）。

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 改动面小（两个函数 + 调用点），语义明确。
  - **Skills**: [`sw-verification-before-completion`]
    - `sw-verification-before-completion`: 需"写入失败被如实传播 + 二次调用仍成功"双证据，不能只跑 happy path。
  - **Skills Evaluated but Omitted**:
    - `sw-systematic-debugging`: 根因已由审查给出（丢弃返回值），无需调查。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T4)
  - **Blocks**: T3（同文件 worker-orchestrator.ts UNDO/UNBIND 分支串行）
  - **Blocked By**: None (can start immediately)

  **References**:
  - **Pattern References**:
    - `src/background/slot-service.ts:470-476` — **被修复点**：`unbindSlot` 现行 `void` 返回、丢弃 `removeSlot` 结果。
    - `src/background/worker-orchestrator.ts:284-292` — `UNBIND_SLOT` 与 `UNDO_SAVE` 调用点（`await unbindSlot(...); return { success:true }` 恒真）。
  - **API/Type References**:
    - `src/background/storage-repository.ts:72-74` — **`WriteResult` 定义处**（已核实：`export type WriteResult = { success:true; configVersion:number } | { success:false; errorCode:DomainErrorCode; message:string }`）。注意：它导出自 `storage-repository.ts`，**非** `types.ts`——`unbindSlot` 需从该模块导入该类型。
    - `src/background/storage-repository.ts:541-546` — `removeSlot(slotId, expectedVersion): Promise<WriteResult>`，版本不匹配时返回 `success:false`。
    - `src/background/storage-repository.ts:205-249` — `writeSync`（含 `:216-222` 的 `CONFIG_CONFLICT` 版本检查 + `:242-244` catch → `classifyWriteError`）。
    - `src/background/storage-repository.ts:255-284` — `setSyncWithRetry`（`:266-268` `isQuotaError` 直接 rethrow）。
    - `src/background/storage-repository.ts:290-317` — `classifyWriteError`（quota → `BROWSER_API_ERROR`）。
    - `src/background/storage-repository.ts:322-325` — `isQuotaError`（`/quota/i` / `/QUOTA_BYTES/i`）。
    - `src/shared/types.ts:254` — `DomainErrorCode` 联合（`WriteResult` 失败分支的 `errorCode` 类型来源）。
  - **Test References**:
    - `tests/unit/background/unbind-slot.test.ts` — 既有 unbind 测试，扩展而非新建（当前 3 个用例仅覆盖 happy path / 幂等）。
    - `tests/unit/background/sync-write-resilience.test.ts:29-55` — **本任务 RED 的构造模板**：以 `adapter.storage.set` 覆写实现"仅 sync 区写入抛错"，并在 `finally` 还原。
    - `tests/integration/storage-repository.test.ts:124-136` — 既有 `CONFIG_CONFLICT`（`configVersion` 冲突）用例；**说明该分支已被覆盖**，T2 无需重复（原 v1 误引 `rule-version-check.test.ts`）。
    - `tests/unit/background/rule-version-check.test.ts` — **仅**覆盖 `updateRule` 的 `updatedAt` 版本检查（`VERSION_CONFLICT`），与 `removeSlot` 的 `configVersion` 机制**不同**，**不可照搬**（见 Revision Log Blocker 2）。
    - `tests/integration/slot-service.test.ts` — slot 服务集成断言风格。
  - **WHY Each Reference Matters**: `sync-write-resilience.test.ts` 是本仓库已验证的"定向写失败"注入范式（覆写 `adapter.storage.set`），是构造 B3 RED 的正确模板；`WriteResult` 判别联合决定错误分支写法。原 v1 引用的 `rule-version-check.test.ts` 测的是另一套机制（`updatedAt` vs `configVersion`），导致 RED 场景不可达——已在 v2 修正。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新增测试在未修复代码上 **RED**（`unbindSlot` 返回 `undefined`、`UNBIND_SLOT` 恒 `success:true`）→ 证据 `_context-output/evidence/task-2-red.txt`
  - [ ] `npx vitest run tests/unit/background/unbind-slot.test.ts tests/integration/slot-service.test.ts` → ALL PASS（新增 ≥ 2 tests）
  - [ ] `npm run test:integration` → ALL PASS（`worker-orchestrator.test.ts` 无 UNBIND 断言，无需改动；确认全绿即可）

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: sync 写入失败时 unbindSlot 返回失败且 UNBIND_SLOT 响应失败
    Tool: Bash (test runner)
    Preconditions: repo 已 initialize；sync 中已有 slot id=1 且 local 有对应 binding；
                  以覆写 adapter.storage.set（仅 area==='sync' 抛 'QUOTA_BYTES exceeded'）制造一次性写失败
    Steps:
      1. 覆写 adapter.storage.set：area==='sync' 时 throw new Error('QUOTA_BYTES exceeded')
      2. const r = await slotService.unbindSlot(1)
      3. 断言 r.success === false 且 r.errorCode === 'BROWSER_API_ERROR'
      4. await handleMessage({action:'UNBIND_SLOT', payload:{slotId:1}}) → 断言响应 success === false
      5. finally 还原 adapter.storage.set
    Expected Result: 写入失败被如实上报，不再静默 success
    Failure Indicators: 返回 undefined / success:true（未传播失败）
    Evidence: _context-output/evidence/task-2-write-failure-propagated.txt

  Scenario: 正常解绑仍成功（happy path 不回归）
    Tool: Bash (test runner)
    Preconditions: 无故障注入
    Steps:
      1. const r = await slotService.unbindSlot(1)
      2. 断言 r.success === true；getSyncState().slots 不含 id=1；bindings 不含 slotId=1
    Expected Result: 成功删除且无残留
    Evidence: _context-output/evidence/task-2-unbind-happy.txt
  ```

  **Commit**: YES (groups with none)
  - Message: `fix(slot): propagate RemoveSlot WriteResult from unbindSlot (B3)`
  - Files: `src/background/slot-service.ts, src/background/worker-orchestrator.ts, tests/unit/background/unbind-slot.test.ts`
  - Pre-commit: `npm run test:unit && npm run test:integration`

- [x] T3. **B2 — `UNDO_SAVE` 基于 `pendingUndo` 快照真实恢复（含 5s TTL 清理）**

  **What to do**:
  - **快照写入**：在 `src/background/worker-orchestrator.ts:108-134` 的"检测到 slot 占用"分支，当用户确认覆盖保存（即在真正执行 `saveSlot` 覆盖前）把 `existingSlot` 快照连同覆盖时刻写入 `storage.local` 的 `pendingUndo` 键：`{ slotId, slotSnapshot: existingSlot, bindingSnapshot, expiresAt: Date.now()+5000 }`。通过 `repo.writeLocal`（或新增一个 `repo.setPendingUndo(...)`）写入，避免直接触碰 adapter。
  - **TTL 清理**：设置 5s `TIMER`（`setTimeout`）在到期时清除 `pendingUndo`；同时上层 `getPendingUndo()` 读取时对 `expiresAt < Date.now()` 返回 `null`（双重保险，防止 SW 休眠丢失 timer）。
  - **UNDO_SAVE 分支**（`worker-orchestrator.ts:288-292`）：读取快照——**有快照**：`repo.saveSlot(snapshot, currentVersion)` 恢复槽位定义 + `repo.setBinding(bindingSnapshot)` 恢复绑定，清除 `pendingUndo`，返回 `success:true`（若 saveSlot 失败则传播其 `WriteResult`，依赖 T2 的传播模式）；**无快照**：退化为删除语义（调用 `unbindSlot`），并由 T17/B11 侧的 UI 文案改为"删除槽位"。
  - `src/background/slot-service.ts` 增加 `restoreSlot(snapshot, binding)` 辅助（或复用 `saveSlot`），保持服务层职责。
  - 补集成测试 `tests/integration/worker-orchestrator.test.ts`：覆盖保存→UNDO_SAVE 后 `getSyncState().slots` 恢复为原 slot（title/urlMatch 一致）+ binding 恢复；以及无快照时 UNDO_SAVE 删除。

  **Must NOT do**:
  - 不改 `UNDO_SAVE` 消息的 payload 形状（仍只用 `slotId`）。
  - 不实现"多重撤销栈"（仅单次快照，符合 UI 5 秒撤销条语义）。
  - 不把快照写入 `storage.sync`（撤销是本机瞬态，必须 `storage.local`）。
  - 不依赖 `setTimeout` 单独保证清理（SW 可能休眠）——必须 `expiresAt` 惰性校验。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 涉及跨 storage 层状态机 + TTL + SW 休眠语义，是最容易出现"看似修好实则数据丢失"的复杂任务。
  - **Skills**: [`sw-systematic-debugging`, `sw-verification-before-completion`]
    - `sw-systematic-debugging`: 数据丢失类缺陷必须端到端验证恢复链路。
    - `sw-verification-before-completion`: 需断言恢复后的具体字段值，而非仅 success。
  - **Skills Evaluated but Omitted**:
    - `sw-grill-docs`: 本任务不引入领域术语变更。

  **Parallelization**:
  - **Can Run In Parallel**: YES（在 Wave 1 内与 T1/T4 并行，但**必须晚于 T2**）
  - **Parallel Group**: Wave 1 (with T1, T4)
  - **Blocks**: T13（同文件 worker-orchestrator.ts）
  - **Blocked By**: T2（同文件 UNBIND/UNDO 分支；且需 `WriteResult` 传播模式）

  **References**:
  - **Pattern References**:
    - `src/background/worker-orchestrator.ts:108-134` — 覆盖冲突检测与"取消/确认"分支，是快照写入的插入点。
    - `src/background/worker-orchestrator.ts:288-292` — **被修复点**：UNDO_SAVE 现行等价删除。
    - `src/background/slot-service.ts:470-476` — `unbindSlot`（无快照时的退化路径，T2 后返回 `WriteResult`）。
    - `src/background/storage-repository.ts:412-420` — `writeLocal`（快照写入通道，T1 后已健壮）。
  - **API/Type References**:
    - `src/shared/types.ts:SlotDefinition` / `SlotBinding` — 快照与 binding 的形状。
    - `src/shared/types.ts:LocalState` — `pendingUndo` 需并入本地状态或其伴生键。
    - `src/shared/messages.ts:84-90` — `UNBIND_SLOT` / `UNDO_SAVE` action 定义（payload 不变）。
    - `src/background/storage-repository.ts:saveSlot` — 恢复用写入（版本检查式）。
  - **Test References**:
    - `tests/integration/worker-orchestrator.test.ts` — 既有 orchestrator 集成范式，扩展以覆盖 UNDO 链路。
    - `tests/unit/background/conflict-overwrite.test.ts` — 覆盖冲突既有测试，可与快照断言联动。
    - `tests/integration/storage-repository.test.ts:72-90` — `emitStorageChange` 模拟外部写（构造 TTL/过期场景）。
  - **WHY Each Reference Matters**: `conflict-overwrite.test.ts` 已覆盖"覆盖"前半段，B2 只是补上"撤销恢复"后半段；`writeLocal` 是唯一合法的 local 写通道，快照必须经它写入以复用 B1 的健壮性。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新增测试在未修复代码上 **RED**（当前 UNDO_SAVE 后槽位消失而非恢复）→ 证据 `_context-output/evidence/task-3-red.txt`
  - [ ] `npx vitest run tests/integration/worker-orchestrator.test.ts` → ALL PASS（新增 ≥ 3 tests）
  - [ ] 断言恢复后 `slots[0].titleSnapshot` / `urlMatch.value` 与原快照**逐字段相等**
  - [ ] `npm run test:integration` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 覆盖保存后 5 秒内 UNDO_SAVE 恢复原槽位与绑定
    Tool: Bash (test runner)
    Preconditions: sync 中 slot id=1 为 {urlMatch: {type:'exact', value:'https://old.example'}, titleSnapshot:'Old'}
    Steps:
      1. 触发 SAVE_SLOT 冲突确认覆盖为新 URL（写入 pendingUndo 快照）
      2. 断言 getSyncState().slots[0].urlMatch.value === 'https://new.example'（覆盖已生效）
      3. 发送 UNDO_SAVE({slotId:1})
      4. 断言响应 success === true
      5. 断言 getSyncState().slots[0].urlMatch.value === 'https://old.example' 且 titleSnapshot === 'Old'
      6. 断言 binding 恢复为覆盖前 tabId
    Expected Result: 槽位定义与绑定均恢复为覆盖前状态
    Failure Indicators: 槽位被删除（slots 为空）/ 只恢复定义未恢复绑定 / title 与 urlMatch 不一致
    Evidence: _context-output/evidence/task-3-undo-restores-snapshot.txt

  Scenario: 快照过期后 UNDO_SAVE 退化为删除且不误恢复
    Tool: Bash (test runner)
    Preconditions: 伪造 pendingUndo.expiresAt = Date.now() - 1
    Steps:
      1. 写入过期快照
      2. 发送 UNDO_SAVE({slotId:1})
      3. 断言槽位被删除（退化语义）且不抛异常
    Expected Result: 过期快照不被使用，退化路径安全
    Evidence: _context-output/evidence/task-3-undo-expired-error.txt
  ```

  **Commit**: YES (groups with none)
  - Message: `fix(undo): restore slot snapshot on UNDO_SAVE with TTL (B2)`
  - Files: `src/background/worker-orchestrator.ts, src/background/slot-service.ts, tests/integration/worker-orchestrator.test.ts`
  - Pre-commit: `npm run test:integration`

- [x] T4. **B4a — 正则编译缓存 + `validateRegex` ReDoS 加固**

  **What to do**:
  - `src/shared/url-utils.ts:167-178`：把 `matchesUrl` 的 `new RegExp(definition.value)` 改为经 `getCompiledRegex(pattern)`（模块级 `Map<string, RegExp>` 缓存；命中即复用；编译失败缓存 `null` 并返回 `false`）。缓存需有上限（如 500 条）或按 pattern 长度裁剪，避免无界增长（与 B13 精神一致）。
  - `src/shared/url-utils.ts:69-105` `validateRegex`：在语法检查后新增**灾难性回溯探测**，拒绝以下形态并返回 `error: 'REGEX_RISK'`：
    - 嵌套量词 `(a+)+`、`(x+)+`、`(a*)*`
    - 重复的分组量词 `(.*)*`、`(.+)+`
    - 通过静态结构检测实现（扫描"分组内含量词 + 分组外再带量词"的模式），**不**使用带超时的实际回溯执行（避免自身引入 DoS）。
  - 保持 `RegexValidationResult` 类型形状（`valid` / `error` / `message`），`error` 使用既有 `'REGEX_RISK'`。
  - 补测试 `tests/unit/shared/url-utils.test.ts`：恶意正则拒绝（`(a+)+$`、`(.*)*`、`(x+)+`）+ 合法正则通过 + 缓存复用断言（可用 `vi.spyOn` 或在同 pattern 二次调用时验证返回相同 RegExp 实例/不重复编译）。

  **Must NOT do**:
  - 不引入第三方正则安全库（如 `safe-regex`）——手写检测，避免新依赖。
  - 不用"执行 + 超时中断"方式检测 ReDoS（JS 无法中断同步回溯，超时方案无效且危险）。
  - 不改变 `matchesUrl` 对合法正则的匹配语义（必须与修复前对同一合法 pattern 结果一致）。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: ReDoS 静态检测需要正确理解量词嵌套结构，误拒合法正则或漏放恶意正则都会造成缺陷。
  - **Skills**: [`sw-verification-before-completion`, `sw-systematic-debugging`]
    - `sw-verification-before-completion`: 必须用真实恶意串证明修复（如 `aaaaaaaaaaaaaaaaaaaaaaaa!` 不导致挂起）。
    - `sw-systematic-debugging`: 需区分"语法无效"与"结构危险"两类拒绝。
  - **Skills Evaluated but Omitted**:
    - `sw-external-researcher`: ReDoS 检测形态已由请求明确列举，无需外部研究。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2/T3)
  - **Blocks**: T5（复用升级后的 validateRegex）
  - **Blocked By**: None (can start immediately)

  **References**:
  - **Pattern References**:
    - `src/shared/url-utils.ts:167-178` — **被修复点 1**：`matchesUrl` 无缓存编译。
    - `src/shared/url-utils.ts:69-105` — **被修复点 2**：`validateRegex` 仅长度/语法/宽泛检测（`:89-93` 的 `riskPatterns` 可扩展为结构化探测）。
  - **API/Type References**:
    - `src/shared/url-utils.ts:RegexValidationResult` — 返回值形状 `{valid, error?, message?}`。
    - `src/shared/types.ts:UrlMatchDefinition` — `{ type:'exact'|'regex'; value:string }`。
    - `src/shared/url-utils.ts:MAX_REGEX_LENGTH` — 既有长度上限常量。
  - **Test References**:
    - `tests/unit/shared/url-utils.test.ts` — 既有纯函数测试（RELEASE_CANDIDATE 明确列出），扩展 ReDoS 用例。
    - `tests/unit/ui/sidebar-regex-display.test.tsx` — 下游对 regex 展示的断言，确认修复不破坏 UI 侧。
  - **External References**:
    - OWASP ReDoS 参考 — `https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS`（恶意模式分类）。
    - MDN RegExp — `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions`（量词语义）。
  - **WHY Each Reference Matters**: `validateRegex` 现有 `riskPatterns` 只匹配"整串通配"形态，B4 要求扩展为**结构性**嵌套量词检测；`matchesUrl` 是密集调用点（computeFields/findCandidates/reapply），缓存是性能与安全双重修复。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新增测试在未修复代码上 **RED**（`(a+)+$` 当前返回 `valid:true`）→ 证据 `_context-output/evidence/task-4-red.txt`
  - [ ] `npx vitest run tests/unit/shared/url-utils.test.ts` → ALL PASS（新增 ≥ 5 tests：3 恶意拒绝 + 合法通过 + 缓存复用）
  - [ ] 合法 regex 的 `matchesUrl` 结果与修复前对同一输入一致（回归断言）
  - [ ] `npm run test:unit` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 灾难性回溯模式被拒绝为 REGEX_RISK
    Tool: Bash (test runner)
    Preconditions: 无
    Steps:
      1. validateRegex('(a+)+$') → 断言 valid === false 且 error === 'REGEX_RISK'
      2. validateRegex('(.*)*') → 同上
      3. validateRegex('(x+)+') → 同上
      4. validateRegex('^https://example\\.com/.*$') → 断言 valid === true（合法不误拒）
    Expected Result: 恶意拒绝、合法通过
    Failure Indicators: 恶意返回 valid:true（漏放）/ 合法返回 REGEX_RISK（误拒）
    Evidence: _context-output/evidence/task-4-redos-reject.txt

  Scenario: 编译缓存复用且不重复编译同一 pattern
    Tool: Bash (test runner)
    Preconditions: 无
    Steps:
      1. 对同一 pattern 连续调用 matchesUrl 两次
      2. 断言两次结果一致；通过 spy/实例相等断言底层 RegExp 只编译一次
      3. 传入非法 pattern → 断言返回 false 且不抛异常
    Expected Result: 缓存命中、非法 pattern 安全返回 false
    Evidence: _context-output/evidence/task-4-cache-reuse-error.txt
  ```

  **Commit**: YES (groups with T5)
  - Message: `fix(regex): cache compiled regex and reject catastrophic backtracking (B4)`
  - Files: `src/shared/url-utils.ts, tests/unit/shared/url-utils.test.ts`
  - Pre-commit: `npm run test:unit`

- [x] T5. **B4b — `ImportExportService.generatePreview` 对每条 rule 的 regex 复用安全校验**

  **What to do**:
  - `src/background/import-export-service.ts` 的 `generatePreview`：对导入数据中每条 rule（及 slot）的 `urlMatch.type === 'regex'` 的 `value` 调用 T4 升级后的 `validateRegex`；若 `valid === false`（含 `REGEX_TOO_LONG` / `REGEX_INVALID` / 扩展后的 `REGEX_RISK` 中的拒绝档）则整体返回 `{ success:false, errorCode:'IMPORT_INVALID', message: '<rule 定位信息> + 原因' }`。
  - 明确 `REGEX_RISK` 的处置：对本任务而言，**灾难性回溯类风险必须拒绝（IMPORT_INVALID）**；"宽泛匹配"类提示可保留为告警但不阻断（执行者需在实现中区分"拒绝档"与"告警档"，保持 `validateRegex` 单一入口）。
  - 补集成测试 `tests/integration/import-export-service.test.ts`：导入含 `(a+)+$` regex 的 rule → `generatePreview` 返回 `IMPORT_INVALID`；导入合法 regex → 预览成功。

  **Must NOT do**:
  - 不改 `IMPORT_PREVIEW` 消息 payload 形状。
  - 不在预览阶段实际执行（`test()`）导入的 regex（只做静态安全校验，避免预览自身被 ReDoS）。
  - 不改导出路径行为。

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单点接线，复用 T4 能力，改动小。
  - **Skills**: [`sw-verification-before-completion`]
    - `sw-verification-before-completion`: 需证明"恶意导入被拒 + 合法导入通过"两向证据。

  **Parallelization**:
  - **Can Run In Parallel**: YES（Wave 1 内，但必须晚于 T4）
  - **Parallel Group**: Wave 1 (with T1–T3)
  - **Blocks**: None
  - **Blocked By**: T4（复用升级后的 `validateRegex`）

  **References**:
  - **Pattern References**:
    - `src/background/import-export-service.ts:generatePreview` — **被修复点**：当前未校验 regex 安全性。
    - `src/background/import-export-service.ts:60` — 既有错误码使用范式（`INTERNAL_ERROR` 等）。
  - **API/Type References**:
    - `src/shared/url-utils.ts:validateRegex` — T4 升级后的安全校验入口。
    - `src/shared/types.ts:242` — `IMPORT_INVALID` 错误码。
    - `src/shared/types.ts:ExportBundle`（或导入数据类型）— rule/slot 形状与 `urlMatch` 字段路径。
  - **Test References**:
    - `tests/integration/import-export-service.test.ts` — 既有导入导出集成测试，扩展恶意 regex 用例。
    - `tests/unit/ui/import-diagnostics.test.tsx` — 导入诊断 UI 断言，确认错误码展示不回归。
  - **WHY Each Reference Matters**: 导入是**外部数据入口**，B4 的攻击面就在这里；`import-diagnostics.test.tsx` 说明 UI 已按 errorCode 分支渲染，错误码必须准确。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新增测试在未修复代码上 **RED**（当前恶意 regex 导入可预览成功）→ 证据 `_context-output/evidence/task-5-red.txt`
  - [ ] `npx vitest run tests/integration/import-export-service.test.ts` → ALL PASS（新增 ≥ 2 tests）
  - [ ] `npm run test:integration` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 导入含灾难性回溯 regex 的 rule 被拒
    Tool: Bash (test runner)
    Preconditions: 构造 ExportBundle，其中一条 rule.urlMatch = {type:'regex', value:'(a+)+$'}
    Steps:
      1. const res = await service.generatePreview(bundle)
      2. 断言 res.success === false 且 res.errorCode === 'IMPORT_INVALID'
      3. 断言 message 含该 rule 的可定位信息
    Expected Result: 恶意导入在预览阶段被拒
    Failure Indicators: 返回 success:true（攻击面未关闭）
    Evidence: _context-output/evidence/task-5-import-redos-rejected.txt

  Scenario: 合法 regex 导入预览成功
    Tool: Bash (test runner)
    Preconditions: rule.urlMatch = {type:'regex', value:'^https://example\\.com/.*$'}
    Steps:
      1. const res = await service.generatePreview(bundle)
      2. 断言 res.success === true 且预览项含该 rule
    Expected Result: 合法数据不被误拒
    Evidence: _context-output/evidence/task-5-import-valid-ok.txt
  ```

  **Commit**: YES (groups with T4)
  - Message: `fix(regex): validate imported regex safety in generatePreview (B4)`
  - Files: `src/background/import-export-service.ts, tests/integration/import-export-service.test.ts`
  - Pre-commit: `npm run test:unit && npm run test:integration`

### Wave 2 — Sprint 1（安全 / 正确性 / P1）

- [x] T6. **B6 — 本地状态改为不可变更新（消除缓存/存储分裂）**

  **What to do**:
  - 定位 `src/background/storage-repository.ts` 中所有**直接篡改共享缓存数组**的 mutator（`state.xxx.push(...)` / 原地 `splice` / 直接改字段）。**v2 已核实行号锚点**：`setBinding:557`、`removeBinding:569`、`removeBindingByTabId:576`、`setCycleCursor:584`、`setLastSuccessSlot:596`、`addRecoverySession:603`、`removeRecoverySession:610`、`setTabOverride:617`、`removeTabOverride:629`、**`setIconCache:636`**（v1 误标为 `:603`，那实际是 `addRecoverySession`）、`addDiagnostic:643`、`clearDiagnostics:654`。统一改为**不可变更新**：`const next = { ...state, bindings: [...state.bindings, newBinding] }`。
  - 与 T1 的 `writeLocal` updater 契约对齐：`writeLocal((current) => nextImmutably)`——updater 必须是纯函数，不得改动传入的 `current`。
  - 二选一（执行者择一并在证据中说明理由）：(a) 全部 mutator 改不可变更新（推荐，根因修复）；(b) `getLocalState` 返回 `structuredClone(this.localCache)`（防御式，但成本高）。**推荐 (a)**；若选 (b) 需额外论证性能。
  - 补集成测试 `tests/integration/storage-repository.test.ts`：调用任一 mutator 后，断言 `await repo.getLocalState()` 与底层 `adapter.storage.get('local')` **一致**（消除"幽灵状态"）；并断言 mutator **未**改变先前通过 `getLocalState()` 拿到的旧快照对象（不可变性）。

  **Must NOT do**:
  - 不改 `getLocalState` 返回类型（仍 `Promise<LocalState>`）。
  - 不与 B7 的 icon 解析缓存混做（B7 在 T10 处理）。
  - 不引入 immer 等不可变库。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需系统性找全所有原地修改点（分散在 ~5 处），漏一处仍会残留幽灵状态。
  - **Skills**: [`sw-systematic-debugging`, `sw-verification-before-completion`]
    - `sw-systematic-debugging`: "缓存与存储分裂"是污染型缺陷，必须穷举写入路径。
    - `sw-verification-before-completion`: 断言必须对比缓存与存储两份真值。
  - **Skills Evaluated but Omitted**:
    - `sw-lint-checker`: 门禁覆盖，无需单独加载。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T7, T8, T9)
  - **Blocks**: T10（同文件 storage-repository.ts 串行）
  - **Blocked By**: T1（同文件 storage-repository.ts；B1 的队列改造先落地，避免冲突）

  **References**:
  - **Pattern References**:
    - `src/background/storage-repository.ts:183-188` — **被修复点 1**：`getLocalState` 浅拷贝。
    - `src/background/storage-repository.ts:557-658` — **被修复点 2**：原地 `push`/`splice` 的 mutator 集合（**v2 核实**：`setBinding:557`、`setCycleCursor:584`、`addRecoverySession:603`、`setTabOverride:617`、`setIconCache:636`、`addDiagnostic:643` 等；v1 把 `setIconCache` 标为 `:603` 有误）。
    - `src/background/storage-repository.ts:412-420` — `writeLocal`（T1 后已健壮的写通道）。
  - **API/Type References**:
    - `src/shared/types.ts:LocalState` — 含 `bindings` / `tabOverrides` / `recoverySessions` / `iconCache` / `diagnostics` 数组与字段。
  - **Test References**:
    - `tests/integration/storage-repository.test.ts:53-70` — 既有 local 写测试。
    - `tests/integration/storage-repository.test.ts:72-90` — `emitStorageChange`（可用于断言缓存与存储对齐）。
  - **WHY Each Reference Matters**: 该文件的 mutator 是 B1（队列失效）的下游受害者——B1 修好后，B6 的幽灵状态才完全可观测；两任务同文件必须串行以避免编辑冲突。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新增测试在未修复代码上 **RED**（缓存数组被原地污染，旧快照被改写）→ 证据 `_context-output/evidence/task-6-red.txt`
  - [ ] `npx vitest run tests/integration/storage-repository.test.ts` → ALL PASS（新增 ≥ 2 tests）
  - [ ] `npm run test:unit && npm run test:integration` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: mutator 后缓存与存储一致且旧快照不被改写
    Tool: Bash (test runner)
    Preconditions: repo 已 initialize
    Steps:
      1. const before = await repo.getLocalState()；记录 before.bindings.length
      2. await repo.setBinding(bindingA)
      3. const after = await repo.getLocalState()；断言 after.bindings.length === before.bindings.length + 1
      4. 断言 before.bindings.length 未变（旧快照不可变）
      5. 直接读 adapter.storage.get('local')，断言直接存值 bindings 长度与 after 一致
    Expected Result: 缓存=存储，旧快照冻结
    Failure Indicators: before 被改写 / 缓存与存储长度不一致（幽灵状态）
    Evidence: _context-output/evidence/task-6-immutable-consistency.txt

  Scenario: 多 mutator 连续调用不产生分裂
    Tool: Bash (test runner)
    Preconditions: 同上
    Steps:
      1. 依次调用 setTabOverride / addRecoverySession / setIconCache / addDiagnostic
      2. 断言每次后 getLocalState() 与 storage 真值均对齐
    Expected Result: 五类 mutator 全部不可变且对齐
    Evidence: _context-output/evidence/task-6-all-mutators-error.txt
  ```

  **Commit**: YES (groups with none)
  - Message: `fix(storage): immutable local state updates (B6)`
  - Files: `src/background/storage-repository.ts, tests/integration/storage-repository.test.ts`
  - Pre-commit: `npm run test:integration`

- [x] T7. **B5 — incognito 能力边界诚实化（manifest 声明 + 授权标志判据 + 校验脚本）**

  **What to do**:
  - `manifests/base.json`：显式新增 `"incognito": "not_allowed"`。
  - 三份覆盖 `manifests/chrome.json` / `edge.json` / `firefox.json`：确认合并后**继承** `not_allowed`（若 `merge-manifest.mjs` 为浅合并，覆盖文件不含该键即继承 base；若覆盖会整体替换 `incognito` 则需各自显式声明——执行者须先读 `scripts/merge-manifest.mjs` 确认合并语义，并在证据中记录结论）。
  - `src/adapters/chrome-adapter.ts:309-320` `isAllowed()`：改为**基于持久化用户授权标志**判定，而非读 manifest 键。授权标志存于扩展自有存储（`storage.local` 的专用键，如 `incognitoAuthorized`）；读取失败时返回 `false`（fail-closed，保持现有 catch 语义）。
  - `src/background/diagnostics-service.ts:162-186` `IncognitoService`：确保 `isAllowed` / `filterTabs` / `isTabAccessible` 消费的是新判据（若它们透传 adapter 则无需改动，需确认）。
  - `scripts/validate-manifest.mjs`：在 `validateManifest` 与 `validateSourceManifests` 中新增断言——合并/源 manifest 必须**显式**含 `incognito` 键且值为 `not_allowed`（避免未来回归到"未声明=看似允许"）。
  - 补测试（**v2 更正测试落点**）：**新增** `tests/unit/adapters/chrome-adapter-incognito.test.ts`，以 `vi.stubGlobal('chrome', {...})` 桩住全局 `chrome`（含 `chrome.runtime.getManifest`、`chrome.storage.local`），直接构造 `createChromeAdapter('chrome')` 并断言：
    - `await adapter.incognito.isAllowed()` 在无授权标志时为 `false`（fail-closed）；
    - 写入授权标志（桩的 `storage.local` 返回 `{ incognitoAuthorized: true }`）后为 `true`。
    - ⚠️ **不要用 `tests/unit/adapters/adapter.test.ts` 验证本修复**——该文件 `:2` 仅导入 `createMockAdapter`，而 `mock-adapter.ts:413-418` 的 `isAllowed` 直接返回 `state.incognitoAllowed`、**既不读 manifest 也不读 storage**，故在原落点断言会"空过"（无法证明真实适配器行为）。`adapter.test.ts` 仅保留既有 mock 契约测试（不新增本修复断言）。
  - 补测试（校验脚本）：`scripts/validate-manifest.mjs` 对缺失 `incognito` 键报错——以临时改动 `manifests/base.json` 或直接调用脚本内部函数断言，证据记录退出码非 0。

  **Must NOT do**:
  - 不改 `contract.ts:163-165` 的 `incognito.isAllowed(): Promise<boolean>` 签名。
  - 不引入"运行时动态申请 incognito 权限"的新 UI 流程（超出范围——只做判据诚实化）。
  - 不放宽 `<all_urls>` 或 permissions 列表。
  - 不删除 `slot-service` / `rule-service` / `recovery-service` 中既有的 incognito 过滤调用（它们是消费方，保持不变）。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 跨 manifest + 构建脚本 + 校验脚本 + 适配器 + 测试五处，且"未声明=恒真"的隐患需要构建期防御。
  - **Skills**: [`sw-verification-before-completion`]
    - `sw-verification-before-completion`: 必须证明三个浏览器构建产物均含 `not_allowed`。
  - **Skills Evaluated but Omitted**:
    - `sw-external-researcher`: MV3 `incognito` 键语义为已知公开知识。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T6, T8, T9)
  - **Blocks**: None（但 F1 会校验 manifest）
  - **Blocked By**: None (can start immediately)

  **References**:
  - **Pattern References**:
    - `src/adapters/chrome-adapter.ts:309-320` — **被修复点 1**：`isAllowed` 读 `manifest.incognito !== 'not_allowed'`（恒真）。
    - `manifests/base.json` — **被修复点 2**：全文无 `incognito` 键（已核实）。
    - `scripts/validate-manifest.mjs:48-93` — `validateSourceManifests`（源校验）。
    - `scripts/validate-manifest.mjs:95-188` — `validateManifest`（产物校验，权限段 :146-157）。
    - `scripts/merge-manifest.mjs` — **必须先读**：确定 base 与覆盖的合并语义（浅合并/深合并）。
  - **API/Type References**:
    - `src/adapters/contract.ts:162-165` — incognito 适配器接口（签名不变）。
    - `src/shared/types.ts:246` — `INCOGNITO_NOT_AUTHORIZED` 错误码（slot-service `incognito_blocked` 路径消费）。
    - `src/background/diagnostics-service.ts:162-186` — `IncognitoService` 消费方。
  - **Test References**:
    - `tests/unit/adapters/chrome-adapter-incognito.test.ts` — **v2 新增测试文件（本任务的 RED 落点）**：桩全局 `chrome` 后测 `createChromeAdapter(...).incognito.isAllowed()`。
    - `src/adapters/chrome-adapter.ts:41-43` — `createChromeAdapter(browserType)` 工厂（测试入口）。
    - `src/adapters/mock-adapter.ts:413-418` — **反例警示**：mock 的 `isAllowed` 返回 `state.incognitoAllowed`，不读 manifest/storage → 用 mock 无法验证本修复。
    - `tests/unit/adapters/adapter.test.ts` — 既有 mock 契约测试（**保留不改**，不承载本修复断言）。
    - `tests/integration/slot-service.test.ts` — 既有 `incognito_allowed/blocked` 断言，确认判据变更不破坏。
    - `tests/integration/diagnostics-service.test.ts` — `IncognitoService` 既有测试。
    - 桩全局 `chrome` 的既有范式：`tests/unit/ui/*.test.tsx`（如 `sidebar-open-page.test.tsx:18-32` 的 `vi.stubGlobal('chrome', {...})`）。
  - **External References**:
    - Chrome MV3 manifest `incognito` — `https://developer.chrome.com/docs/extensions/reference/manifest/incognito`（`spanning` / `split` / `not_allowed` 语义）。
  - **WHY Each Reference Matters**: `merge-manifest.mjs` 的合并语义直接决定需要在几份文件里声明该键（这是本任务最容易出错的点）；`slot-service.test.ts` 的既有断言证明过滤链路已被测试覆盖。**v2 关键修正**：`mock-adapter` 的 `isAllowed` 不读 manifest/storage，故 B5 的 RED 必须在**真实适配器 + 全局 `chrome` 桩**上构造，否则断言恒过（"空过"）。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新增测试在未修复代码上 **RED**（真实 `chrome-adapter` 的 `isAllowed()` 恒 `true`）→ 证据 `_context-output/evidence/task-7-red.txt`
  - [ ] `npx vitest run tests/unit/adapters/chrome-adapter-incognito.test.ts` → ALL PASS（新增 ≥ 2 tests）
  - [ ] `npx vitest run tests/unit/adapters/adapter.test.ts` → ALL PASS（既有 mock 契约无回归）
  - [ ] `node scripts/validate-manifest.mjs chrome` / `edge` / `firefox` → 三者均 PASSED
  - [ ] `npm run build:chrome && npm run build:edge && npm run build:firefox` → 成功；且 `dist/<browser>/manifest.json` 均含 `"incognito": "not_allowed"`
  - [ ] `grep -c '"incognito"' dist/chrome/manifest.json` → ≥ 1

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 未授权时 incognito 被拒绝（fail-closed，真实适配器）
    Tool: Bash (test runner)
    Preconditions: vi.stubGlobal('chrome', {...}) 已桩住 runtime.getManifest + storage.local（无 incognitoAuthorized 标志）；
                   adapter = createChromeAdapter('chrome')
    Steps:
      1. const allowed = await adapter.incognito.isAllowed()
      2. 断言 allowed === false
    Expected Result: 默认拒绝
    Failure Indicators: 返回 true（回到恒真缺陷）/ 断言在 mock-adapter 上"空过"
    Evidence: _context-output/evidence/task-7-incognito-denied.txt

  Scenario: 三浏览器产物均声明 incognito: not_allowed
    Tool: Bash (grep / validate script)
    Preconditions: 已执行三个 build:* 命令
    Steps:
      1. node scripts/validate-manifest.mjs chrome → 断言退出码 0
      2. node scripts/validate-manifest.mjs edge → 断言退出码 0
      3. node scripts/validate-manifest.mjs firefox → 断言退出码 0
      4. grep '"incognito"' dist/*/manifest.json → 断言三份均命中 not_allowed
    Expected Result: 构建期关卡拦截缺失
    Evidence: _context-output/evidence/task-7-manifest-gate-error.txt
  ```

  **Commit**: YES (groups with none)
  - Message: `fix(privacy): declare incognito not_allowed and gate on user flag (B5)`
  - Files: `manifests/base.json, manifests/chrome.json, manifests/edge.json, manifests/firefox.json, src/adapters/chrome-adapter.ts, scripts/validate-manifest.mjs, tests/unit/adapters/chrome-adapter-incognito.test.ts`
  - Pre-commit: `npm run test:unit && node scripts/validate-manifest.mjs chrome`

- [x] T8. **B8 — icon fetch：8s 超时 + 协议白名单 + loopback/私网拒绝**

  **What to do**:
  - `src/background/icon-service.ts:90-106` `downloadAndCache`：
    - 新增 `AbortController` + `setTimeout(8_000)`；`fetch(url, { signal, mode:'cors' })`；`finally` 清除 timer。
    - **先校验 URL 再请求**：`new URL(url)` 协议必须为 `http:` / `https:`，否则 `ICON_DOWNLOAD_FAILED`（拒绝 `file:` / `data:`（由别处处理）/ `ftp:` / 无协议）。
    - **拒绝 loopback/私网主机**：`localhost` / `127.0.0.0/8` / `::1` / `10.0.0.0/8` / `172.16.0.0/12` / `192.168.0.0/16` / `169.254.0.0/16`（链路本地）→ `ICON_DOWNLOAD_FAILED`。
    - **响应体限流**：使用 `Range: bytes=0-<MAX>` 请求头或读取前先校验 `Content-Length`；若超限则中止并失败（避免先读全量 blob 再判断）。
  - 错误码沿用既有 `ICON_DOWNLOAD_FAILED`（`types.ts`）。
  - 补测试 `tests/unit/background/icon-service.test.ts`：超时（mock fetch 永不 resolve → 断言失败）、私网 URL 拒绝、非 http(s) 协议拒绝、超大响应拒绝、正常 data URI 缓存命中。

  **Must NOT do**:
  - 不放宽协议许可（不得允许 `file:`、`ftp:`、通配符）。
  - 不引入 `is-ip` / `ipaddr.js` 等依赖（手写 IPv4/IPv6 私网判定）。
  - 不改 `IconProcessResult` 返回形状。
  - 不改缓存键语义与 `local-icon:` 引用机制（那是 B7/B9 的范围）。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 网络边界防护需正确处理 IPv4/IPv6 私网段、DNS 直连 IP、超时竞态。
  - **Skills**: [`sw-reviewer-security`, `sw-verification-before-completion`]
    - `sw-reviewer-security`: SSRF/超时/资源耗尽防护需要安全视角复审。
    - `sw-verification-before-completion`: 需恶意 URL 证据证明拦截生效。
  - **Skills Evaluated but Omitted**:
    - `sw-external-researcher`: 私网段清单为已知 RFC 1918 知识。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T6, T7, T9)
  - **Blocks**: None
  - **Blocked By**: None (can start immediately)

  **References**:
  - **Pattern References**:
    - `src/background/icon-service.ts:88-142` — **被修复点**：`fetch` 无超时、先读 blob、无 URL 校验。
    - `src/background/icon-service.ts:90-95` — 既有缓存命中早返回（保持该路径不变）。
  - **API/Type References**:
    - `src/shared/types.ts:240` — `ICON_DOWNLOAD_FAILED` 错误码。
    - `src/background/icon-service.ts:IconProcessResult` — 返回形状。
  - **Test References**:
    - `tests/unit/background/icon-service.test.ts` — 既有 icon 测试，扩展安全用例（需 mock 全局 `fetch` 与 `AbortController`）。
  - **External References**:
    - RFC 1918 私网地址 — `https://datatracker.ietf.org/doc/html/rfc1918`（10/8, 172.16/12, 192.168/16）。
    - MDN AbortController — `https://developer.mozilla.org/en-US/docs/Web/API/AbortController`（超时中止模式）。
  - **WHY Each Reference Matters**: 该服务是扩展**唯一的出网路径**，其防护是隐私承诺（RELEASE_CANDIDATE "No telemetry / Icons local-only"）的技术基础；超时缺失会让 SW 被挂起。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新增测试在未修复代码上 **RED**（私网 URL 当前会被请求）→ 证据 `_context-output/evidence/task-8-red.txt`
  - [ ] `npx vitest run tests/unit/background/icon-service.test.ts` → ALL PASS（新增 ≥ 4 tests）
  - [ ] `npm run test:unit` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 私网与非 http(s) URL 被拒绝
    Tool: Bash (test runner)
    Preconditions: mock fetch 记录调用
    Steps:
      1. downloadAndCache('http://127.0.0.1/icon.png', 'k1') → 断言 success===false 且 fetch 未被调用
      2. downloadAndCache('http://192.168.1.5/icon.png', 'k2') → 同上
      3. downloadAndCache('file:///etc/passwd', 'k3') → 同上
      4. downloadAndCache('ftp://h/i.png', 'k4') → 同上
    Expected Result: 四类全部拒绝且无网络请求
    Failure Indicators: fetch 被调用（SSRF 面未关闭）
    Evidence: _context-output/evidence/task-8-private-host-rejected.txt

  Scenario: 超时中止与超大响应拒绝
    Tool: Bash (test runner)
    Preconditions: mock fetch 返回永不 resolve 的 promise / 返回 Content-Length 超限
    Steps:
      1. downloadAndCache('https://example.com/big.png', 'k5')，fetch 挂起 → 断言 8s 内（测试用 fake timers）失败返回 ICON_DOWNLOAD_FAILED
      2. mock 返回超大 Content-Length → 断言被拒绝且未读取全量 body
    Expected Result: 超时与超限均安全失败
    Evidence: _context-output/evidence/task-8-timeout-oversize-error.txt
  ```

  **Commit**: YES (groups with none)
  - Message: `fix(icons): enforce timeout, protocol allowlist and private-host denial (B8)`
  - Files: `src/background/icon-service.ts, tests/unit/background/icon-service.test.ts`
  - Pre-commit: `npm run test:unit`

- [x] T9. **B9 — 注入 favicon / `uiMarker.icon.value` 危险协议黑名单（允许 `data:`/`http:`/`https:`，拒绝 `javascript:`/`file:`/`blob:`/`data:text/html`）**

  > **决策 (a)（v2 修订）**：协议白名单 = **`data:` / `http:` / `https:`**，拒绝其余全部协议（尤其 `javascript:` / `file:` / `blob:` / `data:text/html`）。理由与隐私承诺的兼容性论证见 Revision Log Blocker 1。原 v1 的"仅 `data:`"语义与 3 个既有集成测试硬矛盾，已废弃。

  **What to do**:
  - 在 `src/shared/url-utils.ts` 新增**纯函数** `isSafeFaviconProtocol(value: string): boolean`（单一真源）：解析 `value` 的协议前缀（大小写不敏感、容忍前导空白），返回 `true` 当且仅当协议 ∈ {`data:`（且**非** `data:text/html`、非 `data:text/*`）, `http:`, `https:`}；空串 / 无法识别 / 其他协议 → `false`。同时对 `data:` 增加**子类型白名单**（仅 `data:image/*`），以阻断 `data:text/html`（同源脚本执行）与 `data:image/svg+xml`（SVG 可内嵌 `<script>`）等脚本向量——建议仅允许位图类型（`image/png|jpeg|gif|webp|ico`），最终白名单集合须在证据中记录。
  - `src/background/rule-service.ts:378-385` `resolveSlotField`：在取值前用该函数过滤：
    - `slot.uiMarker.icon?.value` / `slot.faviconSnapshot` 经 `isSafeFaviconProtocol` 校验，**不通过则视为无 favicon**（`favicon` 保持 `null`，继续 fallback 到下一优先级）；
    - `local-icon:<key>` 引用（由 `resolveIconReferences` 解析为 data URI）默认白名单内，保持不变；
    - 通过的值原样返回（**`http(s)` 值保留**——既有投递链路依赖它，见 References）。
  - `src/background/apply-fields.ts:45-53`：在 `link.href = favicon` 前新增防御性断言——**内联同一白名单判断**（注入函数须自包含，不能运行时 import `@shared/url-utils`）；不通过则不创建 link（清空既有 icon 链接但不追加新链接）。此层是"最后一道网"，语义与 `url-utils` 中的函数保持一致。
  - 对 `uiMarker.icon.value` 同样应用白名单（与 `faviconSnapshot` 同一路径）。
  - 补测试 `tests/unit/background/rule-service.test.ts`：断言 `resolveSlotField` 对 `javascript:alert(1)` / `file:///etc/passwd` / `data:text/html,<script>` 返回 `favicon: null`；对 `https://remote/icon.png` **正常返回**；对 `data:image/png;base64,...` 正常工作；对 `local-icon:key` 解析为 data URI。
  - 补测试（注入端）`tests/integration/rule-delivery-real-dom.test.ts` 或新增同层集成测试：以 `favicon='javascript:alert(1)'` 直接驱动注入函数 → 断言 DOM 中**无**该 href 的 link 节点。

  **Must NOT do**:
  - ❌ **不得**要求"仅 `data:`"语义——那会与 `rule-delivery-real-dom.test.ts` / `rule-apply-persistence.test.ts` / `rule-delivery-robust.test.ts` 中既有的 `https` favicon 断言冲突（B9 的验收必须与既有测试兼容）。
  - ❌ **不得**放宽到 `file:` / `ftp:` / `blob:` / `javascript:` / `data:text/html`（危险协议闭集外一律拒绝）。
  - 不破坏 `local-icon:` 引用解析链路（B7 负责其缓存，本任务只消费）。
  - 不改 `FieldComputation` 返回形状。
  - 不在 `apply-fields.ts` 引入对 `@shared/url-utils` 的运行时 import（注入函数需自包含；内联判断或经 T15 构建期常量方案）。

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 判断逻辑明确（协议白名单），改动集中在两个函数的赋值前校验。
  - **Skills**: [`sw-reviewer-security`, `sw-verification-before-completion`]
    - `sw-reviewer-security`: 协议白名单是注入面安全控制，需覆盖危险协议向量。
    - `sw-verification-before-completion`: 需证明危险协议不再进入 DOM，且 http(s) 合法链路不回归。
  - **Skills Evaluated but Omitted**:
    - `sw-systematic-debugging`: 根因已明确。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T6, T7, T8)
  - **Blocks**: None（T11 会再触碰 rule-service.ts，须在其后）
  - **Blocked By**: None (can start immediately)
  - **同文件提示（v2 新增，因 T9 现触碰 `src/shared/url-utils.ts`）**: `url-utils.ts` 在 Wave 1 由 T4 修改、Wave 4 由 T15 修改。T9 位于 Wave 2，**晚于 T4、早于 T15**，故与二者天然串行，无编辑冲突；执行者须基于 T4 完成后（含 `validateRegex`/缓存改动）的 `url-utils.ts` 版本追加 `isSafeFaviconProtocol`。
  - **T11 依赖**: T11 会再触碰 `rule-service.ts`，须在 T9 之后。

  **References**:
  - **Pattern References**:
    - `src/background/rule-service.ts:378-385` — **被修复点 1**：`resolveSlotField` 直取 `uiMarker.icon.value` / `faviconSnapshot`，无协议校验。
    - `src/background/apply-fields.ts:45-53` — **被修复点 2**：`link.href = favicon` 无协议校验（注入端）。
    - `src/shared/url-utils.ts` — `isSafeFaviconProtocol` 新增位置（与既有 `isProtectedUrl` 同文件，风格参考）。
  - **API/Type References**:
    - `src/shared/types.ts:31-36` — `IconSource`（`type: 'url'|'upload'|'template'` + `value`）；注意 `type:'url'` 的 `value` 既可能是 `https://...` 也可能是已渲染的 `data:image/png;base64,...`。
    - `src/background/rule-service.ts:34-39` — `FieldComputation` 返回形状。
    - `src/shared/url-utils.ts:isProtectedUrl` — 同文件既有 URL 判断函数（风格参考）。
  - **Test References**:
    - `tests/unit/background/rule-service.test.ts` — 既有 rule 服务测试，扩展 favicon 危险协议用例。
    - `tests/integration/rule-delivery-real-dom.test.ts:76-94, :96-119, :198-212` — **既有 http(s) favicon 断言护栏**（rule favicon=`https://new.example/icon.png` 注入后 `link.href` 必须等于该 URL）。**决策 (a) 的核心约束**：这些断言必须保持通过。
    - `tests/integration/rule-apply-persistence.test.ts:218-237` — slot 层级 favicon=`https://slot.com/icon.png` 断言（同样为护栏）。
    - `tests/integration/rule-delivery-robust.test.ts:75-90` — 同类 http(s) favicon 断言（同样为护栏）。
    - `tests/integration/rule-delivery-real-dom.test.ts:266-303` — 既有断言"`local-icon:` 被解析为 data URI"（必须保持通过）。
  - **WHY Each Reference Matters**: **原 v1 只识别到 1 个护栏（`test 6` 的 local-icon 用例），遗漏了 3 个会被"仅 data:"语义破坏的 http(s) 断言**（reviewer 已核实）。B9 的原始安全意图是"关闭危险协议注入面（`javascript:`/`file:`/`data:text/html` 等），消除 XSS/本地文件读取向量"，而**不是**"禁止一切远程 favicon"——后者与既有投递链路（以及"用户显式配置的远程图标 URL"这一产品语义）冲突。两处（service + 注入端）双保险是因为注入函数在页面上下文无法复用 service 校验。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新增测试在未修复代码上 **RED**（`javascript:alert(1)` 当前被原样返回并注入）→ 证据 `_context-output/evidence/task-9-red.txt`
  - [ ] `npx vitest run tests/unit/background/rule-service.test.ts` → ALL PASS（新增 ≥ 4 tests：`javascript:` / `file:` / `data:text/html` 拒绝 + `https` 放行）
  - [ ] `npx vitest run tests/integration/rule-delivery-real-dom.test.ts tests/integration/rule-apply-persistence.test.ts tests/integration/rule-delivery-robust.test.ts` → **ALL PASS（既有 http(s) favicon 断言与 local-icon 断言均不回归）**
  - [ ] `npm run test:unit && npm run test:integration` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 危险协议 favicon 被拒、安全协议放行（与既有测试兼容）
    Tool: Bash (test runner)
    Preconditions: 构造 4 个 slot：
      - slotA.faviconSnapshot = 'javascript:alert(1)'
      - slotB.faviconSnapshot = 'file:///etc/passwd'
      - slotC.faviconSnapshot = 'data:text/html,<script>alert(1)</script>'
      - slotD.faviconSnapshot = 'https://remote.example/icon.png'
    Steps:
      1. resolveSlotField(slotA) → 断言 favicon === null
      2. resolveSlotField(slotB) → 断言 favicon === null
      3. resolveSlotField(slotC) → 断言 favicon === null
      4. resolveSlotField(slotD) → 断言 favicon === 'https://remote.example/icon.png'
      5. 另一 slot 为 data:image/png;base64,iVBOR... → 断言 favicon 以 'data:image/' 开头
      6. local-icon:key 引用 → 断言 favicon 为解析后的 data URI
    Expected Result: 危险协议全部拒绝；data:image / http(s) / 本地缓存解析结果均放行
    Failure Indicators: 危险协议被返回并注入（XSS/本地文件向量未关闭）/ http(s) 被误拒（既有投递链路回归）
    Evidence: _context-output/evidence/task-9-dangerous-protocol-blocked.txt

  Scenario: 注入端对危险协议防御性拒绝
    Tool: Bash (test runner, jsdom 真实 DOM)
    Preconditions: 直接以 favicon='javascript:alert(1)' 调用注入函数的 favicon 分支
    Steps:
      1. 执行 applyFields 注入路径
      2. 断言 document.querySelectorAll('link[rel*="icon"]') 中不含 href 为 javascript:alert(1) 的节点
      3. 对照：以 favicon='https://new.example/icon.png' 驱动同一路径 → 断言 link 节点存在（合法链路不受影响）
    Expected Result: DOM 中无危险协议 favicon 链接；http(s) 合法链路正常
    Evidence: _context-output/evidence/task-9-inject-end-guard-error.txt
  ```

  **Commit**: YES (groups with none)
  - Message: `fix(icons): reject dangerous favicon protocols, allow data/http/https (B9)`
  - Files: `src/shared/url-utils.ts, src/background/rule-service.ts, src/background/apply-fields.ts, tests/unit/background/rule-service.test.ts`
  - Pre-commit: `npm run test:unit && npm run test:integration`

### Wave 3 — Sprint 2（性能 / P1）

- [x] T10. **B7a — StorageRepository 内维护 `iconResolutionCache`（写时更新 + onChanged 失效）**

  **What to do**:
  - `src/background/storage-repository.ts:175-181` `getSyncState` 当前每次 `await this.resolveIconReferences({...cache})`，其中对每个 `local-icon:` 引用执行一次 `storage.get` → N 次 IPC。改为：
    - 新增模块级/实例级 `iconResolutionCache: Map<string, string>`（key = `local-icon:` 引用或 cacheKey，value = data URI）。
    - 首次解析结果写入该缓存；后续 `resolveIconReferences` 命中即跳过 IO。
    - **写时更新**：`setIconCache`（B6 改后的不可变版本）写入缓存条目。
    - **失效**：`storage.onChanged` 处理器（既有，见 `storage-repository.ts` 监听逻辑）在 `local` 变化时清空 `iconResolutionCache`（保守失效，避免陈旧）。
  - 保持 `getSyncState` 返回类型与"已解析"对外语义不变——外部调用方不应感知差异（除性能）。
  - 补集成测试 `tests/integration/storage-repository.test.ts`：断言同一 `local-icon:` 引用在**两次** `getSyncState` 调用中只触发**一次**底层 `storage.get`（用 `mock-adapter` 记录调用次数，如 `adapter.getCalls()` 或 `calls` 数组过滤 `storage.get`）；断言 `emitStorageChange` 后缓存失效并重新解析。

  **Must NOT do**:
  - 不改 `getSyncState` 签名或返回形状。
  - 不缓存跨会话（SW 重启即丢失，属预期）。
  - 不在缓存未命中时并发重复请求同一 key（可选：in-flight promise 去重，若实现须加测试；否则保持简单单飞）。
  - 不触碰 `resolveSlotField`（B9/T9 已处理）。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 缓存 + 失效 + 与 B6 不可变改造耦合，易出现陈旧数据或计数断言失败。
  - **Skills**: [`sw-reviewer-performance`, `sw-verification-before-completion`]
    - `sw-reviewer-performance`: 本任务本质是 IPC 次数削减，需以调用次数为证据。
    - `sw-verification-before-completion`: 必须断言"缓存失效后重新解析"这一负向路径。
  - **Skills Evaluated but Omitted**:
    - `sw-external-researcher`: 缓存策略为通用工程知识。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T12 after T11)
  - **Blocks**: T11, T12
  - **Blocked By**: T6（同文件 storage-repository.ts；B6 的不可变改造先落地）

  **References**:
  - **Pattern References**:
    - `src/background/storage-repository.ts:175-181` — **被修复点**：`getSyncState` 每次解析。
    - `src/background/storage-repository.ts:364-404` — `resolveIconReferences`（对每个 `local-icon:` 做 `storage.get`）的实现，是加缓存的位置。
    - `src/background/storage-repository.ts:555-658` — mutator 区（含 `setIconCache:636`），是"写时更新"的挂载点（T6 后为不可变版本）。
  - **API/Type References**:
    - `src/shared/types.ts:LocalState.iconCache` — `Record<cacheKey, dataUri>`，缓存数据真源。
    - `src/background/storage-repository.ts:getSyncState / resolveIconReferences` — 对外/内部契约。
  - **Test References**:
    - `tests/integration/storage-repository.test.ts` — 扩展 IPC 计数断言。
    - `tests/integration/storage-repository.test.ts:72-90` — `emitStorageChange` 模拟失效。
    - `src/adapters/mock-adapter.ts:81-83` — `logCall` 定义处（v1 误标为 `:384`，那是 `scripting.executeScript` 内的调用点）；`calls` 数组（`:70` / `:95`）用于计数 `storage.get`。
  - **WHY Each Reference Matters**: `mock-adapter` 的 `calls` 记录是唯一能**证明** IPC 次数下降的手段——这是本任务的核心验收信号（性能类修复必须有量化证据）。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新增测试在未修复代码上 **RED**（两次 `getSyncState` 触发 ≥ 2 次 `storage.get`）→ 证据 `_context-output/evidence/task-10-red.txt`
  - [ ] `npx vitest run tests/integration/storage-repository.test.ts` → ALL PASS（新增 ≥ 2 tests：缓存命中计数 + 失效后重解析）
  - [ ] `npm run test:integration` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 重复 getSyncState 不重复解析同一 local-icon 引用
    Tool: Bash (test runner)
    Preconditions: sync 中一个 slot 的 favicon 为 'local-icon:k1'；local.iconCache['k1'] 存在
    Steps:
      1. 清空 adapter.calls
      2. await repo.getSyncState()
      3. 记录 storage.get 调用次数 c1
      4. await repo.getSyncState()
      5. 记录 storage.get 调用次数 c2
      6. 断言 c2 === c1（第二次零新增 IPC）
    Expected Result: 第二次解析全部命中缓存
    Failure Indicators: c2 > c1（缓存未生效）
    Evidence: _context-output/evidence/task-10-cache-hit-count.txt

  Scenario: onChanged 后缓存失效并重新解析
    Tool: Bash (test runner)
    Preconditions: 同上，已缓存
    Steps:
      1. adapter.emitStorageChange({ iconCache: {...新值} }, 'local')
      2. await repo.getSyncState()
      3. 断言返回的 favicon 为新值（缓存已失效、重新读取）
    Expected Result: 失效生效，无陈旧数据
    Evidence: _context-output/evidence/task-10-cache-invalidate-error.txt
  ```

  **Commit**: YES (groups with T11, T12)
  - Message: `perf(storage): cache icon resolution to cut IPC calls (B7)`
  - Files: `src/background/storage-repository.ts, tests/integration/storage-repository.test.ts`
  - Pre-commit: `npm run test:integration`

- [x] T11. **B7b — `computeFields` 重构为接受已解析状态的纯函数 + 循环外单次读态**

  **What to do**:
  - `src/background/rule-service.ts:304` `computeFields(tabId, tabUrl, _siteTitle, _siteFavicon)` 当前内部依赖 `getSyncState()`（进而触发 icon 解析）。重构为**接受已解析状态**的形式，例如新增重载/参数 `computeFieldsWith(state: SyncState, tabId, tabUrl, ...)` 或把 `computeFields` 改为 `(state, tabId, tabUrl, ...)`，并保留一个兼容包装（若其他调用点众多）。
  - `src/background/rule-service.ts:550-558` `reapplyToMatchingTabs`：把 `getSyncState()`（或等价解析）**移到循环外读一次**，循环内调用纯函数版本。这样把 N×M 次 IPC 降为 1×M（或 1 次状态读 + 纯计算）。
  - 更新所有 `computeFields` 调用点：`worker-orchestrator.ts:607-609`、`rule-service.ts:533-538` 等，确保传入已解析状态；若某处本就单次调用，保持行为等价。
  - 补测试 `tests/unit/background/rule-service.test.ts`：断言 `reapplyToMatchingTabs` 在多标签匹配时**只读一次** sync 状态（`storage.get` 计数 = 1 或常量）；断言纯函数对同一 `(state, url)` 输出与旧 `computeFields` 逐字段一致（行为等价回归）。

  **Must NOT do**:
  - 不改 `FieldComputation` 返回形状。
  - 不改变字段优先级链（override → rule → slot → site），仅改变状态获取时机。
  - 不与 B9 的 favicon 白名单混做（T9 已完成）。
  - 不为兼容而保留两套并行实现导致行为漂移——必须是同一实现。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 纯函数化重构 + 调用点收敛 + 行为等价性证明，回归风险高。
  - **Skills**: [`sw-reviewer-performance`, `sw-verification-before-completion`]
    - `sw-reviewer-performance`: 需证明 IPC 次数下降。
    - `sw-verification-before-completion`: 需证明"重构不改行为"（逐字段等价断言）。
  - **Skills Evaluated but Omitted**:
    - `sw-grill-docs`: 无术语变更。

  **Parallelization**:
  - **Can Run In Parallel**: NO（与 T12 同文件 rule-service.ts）
  - **Parallel Group**: Wave 3 (sequential after T10)
  - **Blocks**: T12
  - **Blocked By**: T10（需 `getSyncState` 已具缓存）且 T9（同文件 rule-service.ts）

  **References**:
  - **Pattern References**:
    - `src/background/rule-service.ts:304` — `computeFields` 定义。
    - `src/background/rule-service.ts:533-538` — `applyRule` 调用 `computeFields` 后 `reapplyToMatchingTabs`。
    - `src/background/rule-service.ts:550-558` — **被修复点**：循环内逐标签 `computeFields`。
    - `src/background/worker-orchestrator.ts:607-609` — 另一 `computeFields` 调用点。
  - **API/Type References**:
    - `src/shared/types.ts:SyncState` — 已解析状态（T10 后含缓存解析结果）。
    - `src/background/rule-service.ts:FieldComputation` — 返回值形状。
  - **Test References**:
    - `tests/unit/background/rule-service.test.ts` — 既有 rule 测试，扩展纯函数等价与计数断言。
    - `tests/integration/rule-apply-persistence.test.ts` — 既有"apply 后持久化"集成测试，是行为等价回归护栏。
    - `tests/integration/rule-delivery-robust.test.ts` / `rule-delivery-real-dom.test.ts` — 投递链路回归。
  - **WHY Each Reference Matters**: 该重构同时影响"字段优先级"这一核心领域逻辑，`rule-apply-persistence` / `rule-delivery-*` 三个集成测试是判断"是否改坏行为"的既有护栏，必须全绿。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新增计数测试在未修复代码上 **RED**（循环内 N 次状态读）→ 证据 `_context-output/evidence/task-11-red.txt`
  - [ ] `npx vitest run tests/unit/background/rule-service.test.ts` → ALL PASS（新增 ≥ 2 tests）
  - [ ] `npm run test:unit && npm run test:integration` → ALL PASS（含 `rule-apply-persistence` / `rule-delivery-robust` / `rule-delivery-real-dom` 无回归）
  - [ ] 纯函数等价断言：对固定 `(state, tabUrl)`，新实现与旧实现输出逐字段相等

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 多标签匹配时状态只读一次
    Tool: Bash (test runner)
    Preconditions: 3 个标签匹配同一 rule；sync 中有 icon 引用
    Steps:
      1. 清空 adapter.calls
      2. 触发 reapplyToMatchingTabs(rule)
      3. 断言 storage.get（含 icon 解析）总调用次数为常量（1~2），与匹配标签数无关
    Expected Result: IPC 次数不随标签数线性增长
    Failure Indicators: 调用次数与标签数同阶（N+1）
    Evidence: _context-output/evidence/task-11-single-state-read.txt

  Scenario: 字段优先级行为不变（等价回归）
    Tool: Bash (test runner)
    Preconditions: 存在 tab override + rule；slot 同时匹配
    Steps:
      1. 计算 computeFields 结果
      2. 断言 title/favicon 取值来自 override 优先于 rule 优先于 site
    Expected Result: 与修复前完全一致的优先级链
    Evidence: _context-output/evidence/task-11-behavior-equiv-error.txt
  ```

  **Commit**: YES (groups with T10, T12)
  - Message: `perf(rule): compute fields from a single resolved state (B7)`
  - Files: `src/background/rule-service.ts, src/background/worker-orchestrator.ts, tests/unit/background/rule-service.test.ts`
  - Pre-commit: `npm run test:unit && npm run test:integration`

- [x] T12. **B12 — `startupCleanup` 批量查询 + `reapplyToMatchingTabs` 分片并发**

  **What to do**:
  - `src/background/storage-repository.ts:667-700` `startupCleanup`：当前对每个 binding / override 顺序 `await tabs.get(id)`（N+1）。改为 `const allTabs = await this.adapter.tabs.query({})` 一次取全量 → 构造 `Set<number> validTabIds` → 用 Set 校验 binding/override，批量移除失效项。
  - `src/background/rule-service.ts:550-558` `reapplyToMatchingTabs`：顺序遍历所有标签并逐条 `applyFieldsToTab` → 改为**分片并发**（如每批 8 个并发，`Promise.all` 分片），避免同时向浏览器发起过多 executeScript。
  - 保持返回形状（`startupCleanup` 仍返回 `{removedBindings, removedSessions}`）。
  - 补测试：`tests/integration/storage-repository.test.ts` 断言 `startupCleanup` 的 `tabs.get` 调用次数为 0（改用 `tabs.query` 1 次）；`tests/unit/background/rule-service.test.ts` 断言分片并发下所有匹配标签都被投递且并发不超上限。

  **Must NOT do**:
  - 不改 `startupCleanup` 返回类型。
  - 不用无上限 `Promise.all(tabs.map(...))`（标签多时会打爆，必须分片）。
  - 不改投递结果统计语义（成功/失败计数须与顺序版一致）。
  - 不改变 `removedBindings/removedSessions` 的判定条件。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 并发批处理需保证结果等价 + 不超并发上限，且与 T10/T11 同文件耦合。
  - **Skills**: [`sw-reviewer-performance`, `sw-verification-before-completion`]
    - `sw-reviewer-performance`: 核心是消除 N+1 与串行瓶颈。
    - `sw-verification-before-completion`: 需断言调用次数与投递完整性双证据。
  - **Skills Evaluated but Omitted**:
    - `sw-systematic-debugging`: 根因已明确（N+1）。

  **Parallelization**:
  - **Can Run In Parallel**: NO（同文件 rule-service.ts / storage-repository.ts）
  - **Parallel Group**: Wave 3 (sequential after T11)
  - **Blocks**: F1–F4 的集成验证
  - **Blocked By**: T10, T11

  **References**:
  - **Pattern References**:
    - `src/background/storage-repository.ts:667-700` — **被修复点 1**：`startupCleanup` N+1 `tabs.get`。
    - `src/background/rule-service.ts:550-558` — **被修复点 2**：顺序投递循环。
    - `src/background/rule-service.ts`（`applyFieldsToTab` 调用处）— 既有 executeScript 优先 + sendMessage 回退逻辑（不改）。
  - **API/Type References**:
    - `src/shared/types.ts` — binding / override 形状与 `tabId` 字段。
    - `src/adapters/contract.ts:tabs.query / tabs.get` — 适配器接口（`query({})` 返回全量）。
  - **Test References**:
    - `tests/integration/storage-repository.test.ts` — 扩展 startupCleanup 计数断言。
    - `tests/unit/background/rule-service.test.ts` — 扩展分片投递断言。
    - `tests/integration/next-match-binding.test.ts` — 绑定相关既有集成测试（回归护栏）。
    - `tests/unit/background/sync-write-resilience.test.ts` — 既有韧性测试范式。
  - **WHY Each Reference Matters**: `tabs.query({})` 是本仓库已在 `findCandidates` 使用的全量查询模式（可对照）；分片并发必须保持"每条标签都被投递"这一已被 `rule-delivery-real-dom.test.ts` 断言的性质。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新增计数测试在未修复代码上 **RED**（`tabs.get` 被调用 N 次）→ 证据 `_context-output/evidence/task-12-red.txt`
  - [ ] `npx vitest run tests/integration/storage-repository.test.ts tests/unit/background/rule-service.test.ts` → ALL PASS（新增 ≥ 3 tests）
  - [ ] `npm run test:unit && npm run test:integration` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: startupCleanup 单次全量查询且清理结果等价
    Tool: Bash (test runner)
    Preconditions: local.bindings 含 3 个 tabId（其中 1 个已关闭）
    Steps:
      1. 清空 adapter.calls，配置 mock tabs.query({}) 返回 2 个存活标签
      2. await repo.startupCleanup()
      3. 断言 tabs.get 调用次数 === 0
      4. 断言 tabs.query 调用次数 === 1
      5. 断言 removedBindings === 1，剩余 bindings 不含失效 tabId
    Expected Result: N+1 → 1 次查询，清理正确
    Failure Indicators: tabs.get 仍被调用 / 误删存活 binding
    Evidence: _context-output/evidence/task-12-startup-batch.txt

  Scenario: 分片并发投递覆盖全部匹配标签且不超并发上限
    Tool: Bash (test runner)
    Preconditions: 20 个标签匹配同一 rule
    Steps:
      1. 记录 executeScript 调用与并发峰值
      2. await reapplyToMatchingTabs(rule)
      3. 断言 20 个标签全部被投递（无遗漏）
      4. 断言并发峰值 ≤ 分片大小（如 8）
    Expected Result: 全覆盖且受控并发
    Evidence: _context-output/evidence/task-12-sharded-concurrency-error.txt
  ```

  **Commit**: YES (groups with T10, T11)
  - Message: `perf(rule): batch startup cleanup and shard reapply (B12)`
  - Files: `src/background/storage-repository.ts, src/background/rule-service.ts, tests/integration/storage-repository.test.ts, tests/unit/background/rule-service.test.ts`
  - Pre-commit: `npm run test:unit && npm run test:integration`

### Wave 4 — Sprint 3（架构收敛 / P2）

- [x] T13. **B10 — `INTERNAL` → `INTERNAL_ERROR` 类型收敛 + TS 拦截漂移**

  **What to do**:
  - `src/background/worker-orchestrator.ts:300,321,329` 等处的 `errorCode: 'INTERNAL'` 统一改为 `'INTERNAL_ERROR'`（对齐 `src/shared/types.ts:254` 的 `DomainErrorCode`）。
  - 全文搜索 `src/` 中其余 `'INTERNAL'` 字面量（非 `INTERNAL_ERROR`）并一并修正。
  - 把 catch 分支的返回值**显式标注为 `ResponseBase`**（或对应联合类型），使 TS 能对 `errorCode` 漂移报错（防止未来再写错拼写）。
  - 补/扩展测试：断言各 action 在服务抛错时响应 `errorCode === 'INTERNAL_ERROR'`（而非 `'INTERNAL'`）。

  **Must NOT do**:
  - 不改 `DomainErrorCode` 联合（不新增 `INTERNAL` 别名——正确方向是收敛到既有值）。
  - 不改其他错误码语义。
  - 不在本任务中做 action 白名单/超时（那是 T21）。

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 字面量替换 + 类型标注，机械且低风险。
  - **Skills**: [`sw-verification-before-completion`]
    - `sw-verification-before-completion`: 需 `grep` 证明零残留。
  - **Skills Evaluated but Omitted**:
    - `sw-systematic-debugging`: 无调查需求。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T14, T15, T19)
  - **Blocks**: T22（同文件区域）
  - **Blocked By**: T3（同文件 worker-orchestrator.ts；避免编辑冲突）

  **References**:
  - **Pattern References**:
    - `src/background/worker-orchestrator.ts:296-331` — CREATE_RULE / UPDATE_RULE / DELETE_RULE catch 分支（`'INTERNAL'`）。
    - `src/background/worker-orchestrator.ts:138,199,240` — 已正确使用 `'INTERNAL_ERROR'` 的位置（对照）。
  - **API/Type References**:
    - `src/shared/types.ts:254` — `DomainErrorCode` 含 `'INTERNAL_ERROR'`（无 `'INTERNAL'`）。
    - `src/shared/messages.ts:ResponseBase`（或等价响应类型）— 用于显式标注 catch 返回值。
  - **Test References**:
    - `tests/integration/worker-orchestrator.test.ts` — 扩展错误码断言。
    - `tests/unit/ui/message-client.test.ts` — 客户端 `getErrorMessage('INTERNAL_ERROR')` 映射（`message-client.ts:50,126,135`），确认错误码对齐后文案可用。
  - **WHY Each Reference Matters**: 类型漂移之所以未被发现，是因为 catch 返回值未标注类型导致字面量被拓宽——显式标注是**根因修复**而非仅改字符串。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新增断言在未修复代码上 **RED** → 证据 `_context-output/evidence/task-13-red.txt`
  - [ ] `grep -rn "errorCode: 'INTERNAL'" src` → 0 matches
  - [ ] `npm run typecheck` → 0 error
  - [ ] `npx vitest run tests/integration/worker-orchestrator.test.ts` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 服务抛错时响应错误码为 INTERNAL_ERROR
    Tool: Bash (test runner + grep)
    Preconditions: 注入使 ruleService.createRule 抛错
    Steps:
      1. handleMessage({action:'CREATE_RULE', payload:{...}})
      2. 断言响应 success === false 且 errorCode === 'INTERNAL_ERROR'
      3. grep -rn "errorCode: 'INTERNAL'" src → 断言 0 命中
    Expected Result: 类型与字面量双对齐
    Failure Indicators: errorCode === 'INTERNAL' / grep 命中残留
    Evidence: _context-output/evidence/task-13-internal-error-code.txt

  Scenario: 类型标注使漂移在编译期失败（负向证据）
    Tool: Bash (typecheck)
    Preconditions: 临时把某 catch 返回值改为 errorCode:'INTERNAL'
    Steps:
      1. npm run typecheck → 断言报错（证明类型护栏生效）
      2. 还原改动
    Expected Result: TS 能拦截错误码漂移
    Evidence: _context-output/evidence/task-13-ts-guard-error.txt
  ```

  **Commit**: YES (groups with T22)
  - Message: `refactor(worker): unify error codes to INTERNAL_ERROR (B10)`
  - Files: `src/background/worker-orchestrator.ts`
  - Pre-commit: `npm run typecheck`

- [x] T14. **B13 — 内容脚本已上报/已应用 URL 集合加 LRU 上限**

  **What to do**:
  - `src/content/index.ts:18-20` `reportedUrls` / `appliedUrls` 当前为无界 `Set`。改为**有界 LRU（上限 100）**或按 origin 归一化（二选一，执行者择一并在证据说明）。推荐实现一个小型 `BoundedSet`（`Set` + 插入顺序淘汰最旧项：超限时取 `set.values().next().value` 删除）。
  - 保持"once-per-URL 上报"与"applied 守卫（force 可绕过）"语义不变——只限制内存占用，不改变去重行为（在容量内）。
  - 补测试 `tests/unit/content/content-script.test.ts`：断言超过 100 个不同 URL 后集合大小恒定 ≤ 100；断言容量内的去重行为与修复前一致（同一 URL 第二次不重复上报）。

  **Must NOT do**:
  - 不改 `CONTENT_READY` / 上报消息形状。
  - 不改 force 绕过逻辑。
  - 不引入 LRU 依赖库。

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件、算法简单（有界集合）。
  - **Skills**: [`sw-verification-before-completion`]
    - `sw-verification-before-completion`: 需断言上界与去重双性质。
  - **Skills Evaluated but Omitted**:
    - `sw-reviewer-performance`: 规模小，无需专项。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T13, T19)
  - **Blocks**: T15（同文件 content/index.ts 串行）
  - **Blocked By**: None (can start immediately)

  **References**:
  - **Pattern References**:
    - `src/content/index.ts:18-20` — **被修复点**：两个无界 Set。
    - `src/content/index.ts:39-...` — `isProtectedUrl` 与该 Set 的使用位置。
  - **API/Type References**:
    - `src/shared/messages.ts:WorkerToContentMessage` — 内容脚本消息类型（不变）。
  - **Test References**:
    - `tests/unit/content/content-script.test.ts` — 既有内容脚本测试（RELEASE_CANDIDATE 列出），扩展边界用例。
  - **WHY Each Reference Matters**: 内容脚本运行在**每个页面**，无界集合会随导航累积并长期驻留——上限是内存安全要求。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 新增测试在未修复代码上 **RED**（插入 200 个 URL 后 size === 200）→ 证据 `_context-output/evidence/task-14-red.txt`
  - [ ] `npx vitest run tests/unit/content/content-script.test.ts` → ALL PASS（新增 ≥ 2 tests）
  - [ ] `npm run test:unit` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 超过上限后集合有界
    Tool: Bash (test runner)
    Preconditions: 内容脚本模块可实例化状态
    Steps:
      1. 依次以 200 个不同 URL 触发上报/applied 记录
      2. 断言集合 size <= 100
    Expected Result: 内存有界
    Failure Indicators: size 随 URL 数增长（无界）
    Evidence: _context-output/evidence/task-14-bounded.txt

  Scenario: 容量内去重行为不变
    Tool: Bash (test runner)
    Preconditions: 无
    Steps:
      1. 同一 URL 上报两次
      2. 断言只产生一次上报调用（重复被抑制）
    Expected Result: 去重语义保持
    Evidence: _context-output/evidence/task-14-dedup-preserved-error.txt
  ```

  **Commit**: YES (groups with T15)
  - Message: `fix(content): bound reported URL sets (B13)`
  - Files: `src/content/index.ts, tests/unit/content/content-script.test.ts`
  - Pre-commit: `npm run test:unit`

- [x] T15. **B14 — 受保护页前缀改为构建期共享常量（单一真源）**

  **What to do**:
  - 新建 `scripts/gen-protected-prefixes.mjs`：以 `src/shared/url-utils.ts:332-341` 的前缀列表为**唯一真源**，生成一个内容脚本可独立打包的产物（如 `src/shared/protected-prefixes.generated.ts` 或注入到构建配置的常量文件），供 `src/content/index.ts` 与 `url-utils.ts` 共同消费。
  - 把 `src/shared/url-utils.ts:332-341` 与 `src/content/index.ts:23-32` 的重复定义改为**引用生成产物**。若内容脚本因独立打包无法直接 import，则由构建脚本在内容脚本构建前生成内联常量（保持运行时零依赖）。
  - 在 `package.json` 的构建脚本链中接入生成步骤（如 `prebuild` 或 `build:*` 前置）——**注意**：修改 `package.json` 属于必要的接线，须最小化改动（只加生成调用）。
  - 补测试：断言两份消费源的前缀集合**完全相等**（可用一个单测 import 两者并比较）；断言 `isProtectedUrl` 对生成列表中的每个前缀返回 true。

  **Must NOT do**:
  - 不改前缀列表的**内容**（仅去重来源，不增删前缀——增删属行为变更）。
  - 不引入运行时文件读取（内容脚本不能 fs）。
  - 不破坏 `document_start` 内容脚本的自包含性。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 涉及构建期代码生成 + 双消费方接线 + 打包约束，是 Wave 4 最易出错的任务。
  - **Skills**: [`sw-verification-before-completion`]
    - `sw-verification-before-completion`: 必须证明生成产物与运行时一致（构建成功 + 三浏览器产物含内容脚本）。
  - **Skills Evaluated but Omitted**:
    - `sw-external-researcher`: 构建期生成是通用模式。

  **Parallelization**:
  - **Can Run In Parallel**: YES（Wave 4 内，须晚于 T14）
  - **Parallel Group**: Wave 4 (with T13, T19)
  - **Blocks**: None
  - **Blocked By**: T14（同文件 content/index.ts）

  **References**:
  - **Pattern References**:
    - `src/shared/url-utils.ts:332-341` — **重复定义 1**（真源候选）。
    - `src/content/index.ts:23-32` — **重复定义 2**（内容脚本内联副本）。
    - `scripts/merge-manifest.mjs` — 既有构建脚本风格（Node ESM `.mjs`）。
    - `package.json:scripts` — 构建链（`build:chrome` 等），需接入生成步骤。
  - **API/Type References**:
    - `src/shared/url-utils.ts:isProtectedUrl` — 消费方函数。
    - `src/content/index.ts:isProtectedUrl` — 内容脚本内的副本（不一致风险点）。
  - **Test References**:
    - `tests/unit/shared/url-utils.test.ts` — 扩展"生成常量与消费方一致"断言。
    - `tests/unit/content/content-script.test.ts` — 内容脚本保护页断言。
  - **WHY Each Reference Matters**: 该重复是**真实漂移风险**（`url-utils` 有 `'moz-extension://'` 与 content 版本顺序不同，且未来任一处增删会静默不一致）；构建期生成是唯一能同时满足"单一真源"与"内容脚本自包含"的方案。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 一致性测试在未修复代码上 **RED**（若两列表本已一致则改为断言"存在生成产物且被引用"——执行者须先验证差异；已核实两列表**元素集合相同但顺序不同**，故断言改为"顺序无关集合相等 + 引用生成产物"）→ 证据 `_context-output/evidence/task-15-red.txt`
  - [ ] `npx vitest run tests/unit/shared/url-utils.test.ts tests/unit/content/content-script.test.ts` → ALL PASS
  - [ ] `npm run build:chrome && npm run build:edge && npm run build:firefox` → 三者成功
  - [ ] `node scripts/validate-manifest.mjs chrome` → PASSED

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 生成产物为唯一真源，双消费方一致
    Tool: Bash (test runner)
    Preconditions: 已运行生成脚本
    Steps:
      1. 断言生成产物存在且导出前缀数组
      2. 断言 url-utils 与 content 消费的前缀集合与生成产物相等
      3. 断言顺序统一（由生成产物决定）
    Expected Result: 单一真源，无漂移
    Failure Indicators: 任一处仍保留硬编码副本
    Evidence: _context-output/evidence/task-15-single-source.txt

  Scenario: 构建后内容脚本仍自包含且保护页判定正确
    Tool: Bash (build + test)
    Preconditions: 无
    Steps:
      1. npm run build:chrome → 断言退出码 0
      2. 断言 dist 内容脚本含保护页前缀常量（无外部 import 残留）
      3. 单测断言 isProtectedUrl('chrome://settings') === true
    Expected Result: 构建成功且行为不变
    Evidence: _context-output/evidence/task-15-build-selfcontained-error.txt
  ```

  **Commit**: YES (groups with T14)
  - Message: `refactor(content): generate shared protected-prefix constants (B14)`
  - Files: `scripts/gen-protected-prefixes.mjs, src/shared/protected-prefixes.generated.ts, src/shared/url-utils.ts, src/content/index.ts, package.json (build chain), tests/unit/shared/url-utils.test.ts`
  - Pre-commit: `npm run test:unit && npm run build:chrome`

- [x] T16. **B11a — 六个 UI 页面通信层统一走 `message-client`（护栏：15 个既有 UI 单测）**

  **What to do**:
  - 现有事实（v2 校正）：`src/ui/shared/message-client.ts` 存在但**生产代码零引用**（已核实）。六个入口 `src/ui/{sidebar,settings,recovery,import-preview,candidate-selector,conflict-confirm}/` 直接使用 `chrome.*`。**更正 v1 表述**：`sidebar/App.tsx` 的 `chrome` 出现数为 **26 处**（非 22 处；含类型注解），且 **`:984-999` 并非"自行复刻"**——该处**已调用** `openOrReusePage`（`@shared/open-page`，import 见 `App.tsx:395`），属"已复用共享真源的回退路径"（详见 T17）。本任务范围是**跨上下文通信类调用**（`chrome.runtime.sendMessage` 等）改走 `message-client`。
  - 统一改造：各页面通过 `message-client.ts` 的发送/接收封装与后台通信，替换直接 `chrome.runtime.sendMessage` / `chrome.tabs.*` 调用（仅限"跨上下文通信"类调用；真正需 DOM/窗口操作的收敛留给 T17）。
  - 保持每个页面既有组件行为与 props 契约不变（仅替换通信层）。
  - 补/扩展 `tests/unit/ui/*.test.tsx`：现有 15 个 UI 测试必须全绿（它们是行为守卫）；新增断言"页面通过 message-client 路径发起请求"（可 mock `message-client` 并断言被调用）。

  **Must NOT do**:
  - 不改 `message-client.ts` 的对外 API 形状（若需扩展只新增方法）。
  - 不改 `src/shared/messages.ts` 既有 action 的 payload 形状。
  - 不在本任务中做 `chrome.tabs/windows` 的适配器收敛（那是 T17）。
  - 不改 CSS / 视觉。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 六页大范围改动，回归面覆盖全部 UI 测试，需谨慎分步。
  - **Skills**: [`sw-verification-before-completion`, `sw-plan-executor`]
    - `sw-verification-before-completion`: 15 个 UI 测试是唯一的行为护栏，必须全绿。
    - `sw-plan-executor`: 多文件协调改造建议按页面分批推进。
  - **Skills Evaluated but Omitted**:
    - `sw-browser-tester`: ui-smoke 缺失（见 T19），本任务以 jsdom 单测为验收依据。

  **Parallelization**:
  - **Can Run In Parallel**: NO（与 T17/T18 同属 UI 收敛链）
  - **Parallel Group**: Wave 4（可与 T19 并行；T19 为**可选前置**，非硬门禁）
  - **Blocks**: T17, T18
  - **Blocked By**: None（硬护栏 = 15 个既有 UI 单测。T19 提供 ui-smoke 额外承接，属**并行可选前置**，不阻断本任务；v2 按其"可独立交付"定位降级）

  **References**:
  - **Pattern References**:
    - `src/ui/shared/message-client.ts` — **接线目标**（现有 API：`getErrorMessage` :50、错误码处理 :126/:135）。
    - `src/ui/sidebar/App.tsx` — 主要改造对象（`chrome` 出现 26 处，其中业务性直连见 T17 的逐类登记）；`:978-1007` 为 open-page 的"主路径 + 回退路径"（**已复用 `openOrReusePage`**，非复刻）。
    - `src/ui/settings/App.tsx:536-540` — 另一处错误码处理（`INTERNAL_ERROR`），对照统一风格。
  - **API/Type References**:
    - `src/shared/messages.ts` — 全量消息契约（action + payload）。
    - `src/shared/types.ts:254` — `DomainErrorCode` 统合错误码。
  - **Test References**:
    - `tests/unit/ui/*.test.tsx`（15 个文件）— 全部为行为回归护栏，必须全绿。
    - `tests/unit/ui/message-client.test.ts` — message-client 既有单测。
    - `tests/unit/ui/sidebar-open-page.test.tsx` — 覆盖 `App.tsx:978-1007` 的 open-page 主/回退路径；**v2 明确**：本任务的改造**不得**使其任一断言失败（该测试为护栏，不在改动清单内）。
  - **WHY Each Reference Matters**: `sidebar-open-page.test.tsx` 锁定"主路径走 `OPEN_PAGE` + 回退路径复用已开标签"的行为——**v2 更正 v1 的"自行复刻"定性**：该处实际已复用共享 `openOrReusePage`，故 T16/T17 的职责是"统一通信层 + 收敛回退为单一 helper"，而非"删除复刻"。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] `npm run test:unit` → ALL PASS（`tests/unit/ui/*` 全部 15 个文件，0 回归）
  - [ ] `grep -rn "chrome\.runtime\.sendMessage" src/ui/ | wc -l` 相比改造前**显著下降**（通信类调用统一走 `message-client`），且剩余 `chrome.*`（事件订阅 `onActivated/onUpdated/onChanged`、`tabs.query`、`storage.local`、回退 helper）**已逐类登记**为 T17 范围并附前后计数证据
  - [ ] 新增/扩展测试断言页面经 message-client 发起通信

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 六页通信统一走 message-client 且 UI 行为不变
    Tool: Bash (test runner)
    Preconditions: mock message-client
    Steps:
      1. 渲染 sidebar App，触发一次切槽操作
      2. 断言 message-client 的发送方法被调用（而非直接 chrome.runtime.sendMessage）
      3. 断言 UI 渲染结果与改造前一致（既有断言全通过）
    Expected Result: 通信层统一，UI 无回归
    Failure Indicators: 任一 UI 测试失败 / 仍直接调用 chrome.*
    Evidence: _context-output/evidence/task-16-message-client-routing.txt

  Scenario: chrome.* 直用大幅收敛
    Tool: Bash (grep)
    Preconditions: 无
    Steps:
      1. grep -rn "chrome\." src/ui/ → 记录命中数 N_after
      2. 与改造前基线 N_before 对比，断言 N_after < N_before（且剩余集中在 T17 目标文件）
    Expected Result: 收敛可量化
    Evidence: _context-output/evidence/task-16-chrome-usage-reduction-error.txt
  ```

  **Commit**: YES (groups with T17, T18)
  - Message: `refactor(ui): route pages through message-client (B11)`
  - Files: `src/ui/**, tests/unit/ui/**`
  - Pre-commit: `npm run test:unit`

- [x] T17. **B11b — sidebar open-page 主路径走 `OPEN_PAGE`；"后台不可用"回退路径收敛为 `openOrReusePage` 单一真源**（v2 修订：不要求 `chrome.tabs.*` 完全归零）

  > **决策（v2）**：**范围收敛**（非"授权改测试"）。理由：`runtime.sendMessage` 在后台不可用时（SW 未唤醒 / 扩展重载中 / 测试环境）**必须**有本地回退，否则"打开设置页"按钮会静默失效——这是产品必需行为，不能为架构洁癖删除。故保留回退，但把回退收敛为**单一 helper**（`openOrReusePage`）调用，消除"复刻逻辑"。

  **What to do**:
  - **主路径（改造点）**：`src/ui/sidebar/App.tsx:978-983` 保持/强化"先发 `OPEN_PAGE` 消息"（`sendMessage('OPEN_PAGE', { url })`，`messages.ts:242` 既有 action，**不改 payload 形状**；后台处理见 `worker-orchestrator.ts:518+` 的 `OPEN_PAGE` 分支）。
  - **回退路径（收敛点）**：`src/ui/sidebar/App.tsx:984-1002` 保留"后台不可用时的本地回退"，但确认其**已复用** `openOrReusePage`（`@shared/open-page`，import 见 `App.tsx:395`）——**v2 核实**：现行代码**已经**通过 `openOrReusePage({ queryAllTabs, activateTab, navigateTab, createTab }, url)` 承接，而非独立复刻。本任务的收敛要求是：把注入的四组 `chrome.tabs.*` 操作抽为**具名 helper**（如 `createChromePageOpenApi()`），使 `chrome.tabs.*` 仅出现在该单一 helper 内，`openPage` 主体不再直接引用 `chrome.tabs.*`。**不要求** `chrome.tabs.*` 计数归零。
  - **明确归属**：把"主路径 vs 回退路径"的 `chrome.*` 直用**逐条登记**（主路径仅 `chrome.runtime.getURL` 与 `message-client`；回退路径仅 `createChromePageOpenApi()` 内的 4 处 `chrome.tabs.*`），并确认与 T16 的收敛清单一致（纠正 v1 "22 处"的笼统表述——见下 References）。
  - 补测试：`tests/unit/ui/sidebar-open-page.test.tsx` **必须仍通过**（它断言主路径走 `OPEN_PAGE`、回退路径复用已开标签、哈希导航等，是**验收护栏而非需改动的对象**）；**新增**断言"回退路径经 `openOrReusePage` 单一入口"，可用 `vi.mock('@shared/open-page')` 断言该函数被调用。

  **Must NOT do**:
  - ❌ **不得**以"删除 UI 复刻实现"为名移除回退路径，或把 `chrome.tabs.*` 强制归零（会破坏 `sidebar-open-page.test.tsx` 的回退用例与真实可用性）。
  - ❌ **不得**修改 `tests/unit/ui/sidebar-open-page.test.tsx` 中的既有断言（v2 未选择"授权改测试"方案）。
  - 不改 `OPEN_PAGE` 消息 payload 形状（`messages.ts` 既有定义）。
  - 不改 `open-page.ts` 的复用语义（复用既有标签而非总是新建）。
  - 不改视觉。

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: open-page 复用语义（`tests/integration/open-page-reuse.test.ts`）是关键行为，误改会破坏用户体验。
  - **Skills**: [`sw-verification-before-completion`]
    - `sw-verification-before-completion`: 需 open-page 复用集成测试作为证据。
  - **Skills Evaluated but Omitted**:
    - `sw-browser-tester`: 无 ui-smoke 基础。

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (sequential after T16)
  - **Blocks**: T18
  - **Blocked By**: T16

  **References**:
  - **Pattern References**:
    - `src/ui/sidebar/App.tsx:978-983` — **主路径**：`await sendMessage('OPEN_PAGE', { url })`（已存在，v2 保持）。
    - `src/ui/sidebar/App.tsx:984-1002` — **回退路径（收敛点）**：`catch` 分支已调用 `openOrReusePage({...chrome.tabs.* 操作}, url)`；本任务把内联的四组操作抽为具名 helper（`createChromePageOpenApi()`）。
    - `src/ui/sidebar/App.tsx:395` — `import { openOrReusePage } from '@shared/open-page'`（**已存在**，证明单一真源已被使用）。
    - `src/shared/open-page.ts:34-51` — 复用语义真源（hash-insensitive 复用 + hash-only 导航）。
    - `src/background/worker-orchestrator.ts:518+` — 后台 `OPEN_PAGE` 分支（转调 `openOrReusePage`）。
  - **API/Type References**:
    - `src/shared/messages.ts:241-244` — `OpenPageRequest`（`action:'OPEN_PAGE'`, `payload:{url}`）。
    - `src/shared/open-page.ts:12-17` — `PageOpenApi` 接口（helper 的参数形状）。
  - **Test References**:
    - `tests/unit/ui/sidebar-open-page.test.tsx:61-77` — **主路径断言**：点击后经 `OPEN_PAGE` 发出、`tabsCreate` 未被调用（护栏）。
    - `tests/unit/ui/sidebar-open-page.test.tsx:79-94, :96-103, :105-121` — **回退路径断言**：`runtime.sendMessage` reject 时调用 `chrome.tabs.update(5,{active:true})` / `chrome.tabs.create` / hash 导航（护栏，**须保持通过**）。
    - `tests/integration/open-page-reuse.test.ts` — 复用语义集成护栏。
  - **WHY Each Reference Matters**: **v1 的最大错误**是声称"UI 自行复刻 open-page"并据此要求删除——实际 `App.tsx:987` **已复用** `openOrReusePage`（reviewer 已核实）。同时 v1 未察觉 `sidebar-open-page.test.tsx:79-121` 明确断言回退路径**必须**调用 `chrome.tabs.*`，与"`chrome.tabs.*` 归零"互相排斥。v2 据此把范围收敛为"主路径走消息 + 回退收敛单一 helper"，使两条既有护栏都能保持通过。
  - **关于 v1 "sidebar/App.tsx 22 处 chrome.*" 的更正**：`grep` 实测该文件含 `chrome` 出现 **26 处**（含 `:767` 的 `chrome.tabs.TabChangeInfo` 类型引用与多处类型注解）。其中**业务性直连**分布为——主路径 `chrome.runtime.getURL`（`:979`）/ `chrome.runtime.sendMessage`（`:55`）；事件订阅 `chrome.tabs.onActivated/onUpdated`（`:775-780`）、`chrome.storage.onChanged`（`:787-807`）；其它读取 `chrome.tabs.query`（`:677`）、`chrome.storage.local.get`（`:708-710`）；回退路径 `chrome.tabs.query/update/create`（`:986-999`）；锁定标签激活 `chrome.tabs.get/update` + `chrome.windows.update`（`:1138-1142`）。**结论**：不存在"22 处需全部收敛"的单一集合；T16/T17 应逐类登记归属，而非追求计数归零。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] `npx vitest run tests/unit/ui/sidebar-open-page.test.tsx tests/integration/open-page-reuse.test.ts` → ALL PASS（**既有主路径与回退路径断言均不修改且全部通过**）
  - [ ] 新增断言：回退路径经 `openOrReusePage` 单一入口调用（`vi.mock('@shared/open-page')` 后断言被调用）
  - [ ] `grep -n "chrome\.tabs\.\(create\|update\|query\)\|chrome\.windows\." src/ui/sidebar/App.tsx` → 命中**仅限** `createChromePageOpenApi()` helper（回退路径）与 `:1138-1142` 的锁定标签激活（属 T16/T17 登记范围），**主路径 `openPage` 主体 0 命中**
  - [ ] `npm run test:unit && npm run test:integration` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 主路径经 OPEN_PAGE 消息且复用语义保持
    Tool: Bash (test runner)
    Preconditions: mock runtime.sendMessage 返回 { success:true }
    Steps:
      1. 在 sidebar 触发"Open settings"
      2. 断言 runtimeSendMessage 以 { action:'OPEN_PAGE', payload:{url} } 调用
      3. 断言 tabsCreate 未被调用（后台已处理）
    Expected Result: 主路径不直连 chrome.tabs，复用语义与改造前一致
    Failure Indicators: 直接调用 chrome.tabs.create / open-page 单测失败
    Evidence: _context-output/evidence/task-17-open-page-main-path.txt

  Scenario: 后台不可用时回退路径收敛为 openOrReusePage 单一入口
    Tool: Bash (test runner)
    Preconditions: runtime.sendMessage reject（后台不可用）；mock '@shared/open-page' 的 openOrReusePage
    Steps:
      1. 触发"Open settings"
      2. 断言 openOrReusePage 被调用（且传入的 PageOpenApi 由 helper 提供）
      3. 断言已存在 settings 标签被复用（chrome.tabs.update(5,{active:true})，未 create）
      4. 断言 hash 场景（View diagnostics）触发 navigateTab → chrome.tabs.update(5, { url: SETTINGS_URL + '#diagnostics' })
    Expected Result: 回退保留且收敛为单一 helper；既有回退断言全通过
    Failure Indicators: 回退被删除（按钮静默失效）/ 复刻逻辑仍存在于 openPage 主体
    Evidence: _context-output/evidence/task-17-fallback-single-source-error.txt
  ```

  **Commit**: YES (groups with T16, T18)
  - Message: `refactor(ui): route sidebar open-page via OPEN_PAGE, converge fallback to single helper (B11)`
  - Files: `src/ui/sidebar/App.tsx`
  - Pre-commit: `npm run test:unit && npm run test:integration`
  - **注**：`tests/unit/ui/sidebar-open-page.test.tsx` **不在改动清单**（v2 决策：不授权改测试，改以收敛施工范围满足两条既有护栏）。

- [x] T18. **B11c — `sidebar-adapter` 接线或删除 + `OPEN_SIDEBAR` 纳入 `routeMessage`**

  **What to do**:
  - **决策依据（v2 补充既有事实）**：`src/background/sidebar-adapter.ts` 生产零引用（`grep -rn "sidebar-adapter" src/` 仅命中定义文件自身）且 `tests/integration/sidebar-adapter.test.ts` 存在 → **二选一并论证**：(a) 接线；(b) 删除（连同其测试）。
  - **`OPEN_SIDEBAR` 的既有处理（v2 关键补充，避免接线后重复路由）**：`src/background/sidebar-adapter.ts:121-130` 的 `ToolbarActionHandler.initialize()` **已硬编码**监听 `msg?.action === 'OPEN_SIDEBAR'` 并调用 `this.sidebarAdapter.openSidebar()`（返回 `true` 保持端口）。同时 `src/shared/messages.ts` 中**不存在** `OPEN_SIDEBAR` 常量（**已核实**：仅 `OPEN_PAGE` 见 `:242`），故该字面量目前是**未纳入消息契约的孤立路由**。
    - ⚠️ **必须避免重复路由**：若在 `worker-orchestrator.routeMessage` 中新增 `OPEN_SIDEBAR` 分支并**同时**保留 `ToolbarActionHandler` 的消息监听，两条 `runtime.onMessage` 监听器会**同时响应同一消息**（`openSidePanel` 被调用两次，且 `sendResponse` 竞争）。执行者必须**择一**：
        - (i) 走 `routeMessage`：**移除/停用** `ToolbarActionHandler` 的 `OPEN_SIDEBAR` 监听（或让 T18 的删除决策覆盖它），并把 `OPEN_SIDEBAR` 补入 `messages.ts` 契约；或
        - (ii) 保留 `ToolbarActionHandler` 作为唯一处理者：则**不**在 `routeMessage` 中新增该分支，改为把 `OPEN_SIDEBAR` 补入 `messages.ts` 契约（类型诚实化）+ 在 `worker-orchestrator` 初始化时调用 `ToolbarActionHandler.initialize()` 完成接线。
    - 无论择哪条，均需在证据中记录"监听器唯一性"验证（断言 `openSidePanel`/`sidePanel.open` **仅被调用一次**）。
  - 随后在 `routeMessage` 中接线（若择 (i)），转调 `adapter.sidePanel.open`（见 `chrome-adapter.ts:323-334`）。
  - 补/更新测试：若接线则扩展 `tests/integration/sidebar-adapter.test.ts` 且新增 `OPEN_SIDEBAR` 路由测试（**含"只响应一次"断言**）；若删除则移除对应测试、同步清理 `validation` 中的 `OPEN_SIDEBAR` 字面量，并确保 `npm run test:integration` 全绿。

  **Must NOT do**:
  - 不保留"零引用但存在"的僵尸模块（必须接线或删除）。
  - 不新增未在 `messages.ts` 中定义的消息形状。
  - 不改 `routeMessage` 既有分支行为。

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需做出"接线 vs 删除"的架构判断并承担后果，不宜纯机械执行。
  - **Skills**: [`sw-verification-before-completion`]
    - `sw-verification-before-completion`: 删除路径需证明无残留引用。
  - **Skills Evaluated but Omitted**:
    - `sw-systematic-debugging`: 无缺陷调查。

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (sequential after T16)
  - **Blocks**: None
  - **Blocked By**: T16

  **References**:
  - **Pattern References**:
    - `src/background/sidebar-adapter.ts:100-139` — **决策对象**（`SidebarAdapter` + `ToolbarActionHandler`；生产零引用）。
    - `src/background/sidebar-adapter.ts:121-130` — **已存在的 `OPEN_SIDEBAR` 硬编码路由**（`adapter.runtime.onMessage` 内判断 `msg?.action === 'OPEN_SIDEBAR'` → `openSidebar()`）；**必须先处理它以避免重复路由**。
    - `src/background/worker-orchestrator.ts:245-254`（`routeMessage` 主 switch）— `OPEN_SIDEBAR` 需纳入处（若择 (i)）。
    - `src/background/worker-orchestrator.ts:237-243`（`handleMessage`：`routeMessage().then(sendResponse)` + 恒 `return true`）— 与 `ToolbarActionHandler` 的监听器存在**同一消息双响应**风险点。
  - **API/Type References**:
    - `src/shared/messages.ts:240-244` — `OPEN_PAGE` 定义处（**同样**确认不含 `OPEN_SIDEBAR`，需新增常量与 payload）。
    - `src/adapters/contract.ts:sidePanel` — 侧栏能力接口。
    - `src/background/diagnostics-service.ts` / `chrome-adapter.ts:323-334` — `sidePanel.open` 实现（接线目标）。
  - **Test References**:
    - `tests/integration/sidebar-adapter.test.ts:3-13, :88+` — 既有测试（`SidebarAdapter` + `ToolbarActionHandler`，决定其去留）。
    - `tests/integration/worker-orchestrator.test.ts` — 扩展 `OPEN_SIDEBAR` 路由断言（含"仅响应一次"）。
  - **WHY Each Reference Matters**: "零引用模块 + 存在测试 + 孤立字面量路由"是典型架构漂移信号；**v2 新增的关键风险**是 `sidebar-adapter.ts:123` 已硬编码 `OPEN_SIDEBAR`，若接线时不处理它，同一消息会被两条监听器重复处理——故本任务的决策必须显式覆盖该既有处理。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 决策已记录在证据中（接线或删除 + 理由）
  - [ ] `grep -rn "sidebar-adapter" src/` 与决策一致（接线 → 有引用；删除 → 0 命中）
  - [ ] `npx vitest run tests/integration/sidebar-adapter.test.ts tests/integration/worker-orchestrator.test.ts` → ALL PASS（或删除后对应测试已移除且全绿）
  - [ ] `npm run test:integration` → ALL PASS

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: OPEN_SIDEBAR 正确路由且仅被处理一次（无重复路由）
    Tool: Bash (test runner)
    Preconditions: 消息契约含 OPEN_SIDEBAR；按所选方案 (i)/(ii) 已完成监听器唯一化
    Steps:
      1. handleMessage({action:'OPEN_SIDEBAR', payload:{windowId:1}})
      2. 断言响应 success === true 且 sidePanel.open 被调用
      3. 断言 sidePanel.open / openSidePanel **仅被调用一次**（防止 ToolbarActionHandler 监听器 + routeMessage 分支双响应）
    Expected Result: 侧栏可被后台打开，且无重复处理
    Failure Indicators: 落入 default 分支 / 抛错 / sidePanel.open 被调用 2 次
    Evidence: _context-output/evidence/task-18-open-sidebar-route.txt

  Scenario: 无僵尸模块（接线或删除）
    Tool: Bash (grep)
    Preconditions: 决策已执行
    Steps:
      1. grep -rn "sidebar-adapter" src/
      2. 断言结果与决策一致（接线则有引用 / 删除则 0）
    Expected Result: 无零引用残留
    Evidence: _context-output/evidence/task-18-no-zombie-module-error.txt
  ```

  **Commit**: YES (groups with T16, T17)
  - Message: `refactor(worker): wire or remove sidebar-adapter and route OPEN_SIDEBAR (B11)`
  - Files: `src/background/sidebar-adapter.ts, src/background/worker-orchestrator.ts, src/shared/messages.ts, tests/integration/sidebar-adapter.test.ts`
  - Pre-commit: `npm run test:unit && npm run test:integration`

- [x] T19. **（基础任务）ui-smoke 测试脚手架落地 — 当前 `tests/ui-smoke/` 缺失但门禁引用**

  **What to do**:
  - `vitest.workspace.ts:36-46` 声明 `ui-smoke` project（`include: ['tests/ui-smoke/**/*.test.{ts,tsx}']`），`package.json` 有 `test:ui-smoke` 脚本，但 **`tests/ui-smoke/` 目录不存在**（已核实）→ 该门禁实为空跑。
  - 新建 `tests/ui-smoke/`，加入覆盖六页入口的**最小冒烟测试**（每页至少 1 个：渲染成功 + 关键元素存在）。复用 `tests/unit/ui/*.test.tsx` 的 setup 与 mock 模式。
  - **定位（v2 修订）**：本任务为 **T16–T18 的并行可选前置**（提供 ui-smoke 额外承接），**可独立交付，且不阻断任何任务**。T16 的真实硬护栏是 **15 个既有 UI 单测**（`tests/unit/ui/*.test.tsx`），已足以判定回归；未完成 T19 时 T16–T18 仍可开工与验收（v1 的 `Blocks: T16/T17/T18` 属过度约束，已修正）。
  - 验证：`npm run test:ui-smoke` 从"空跑/报错"变为"实际执行 ≥ 6 tests 且全绿"。

  **Must NOT do**:
  - 不修改 `vitest.workspace.ts` 的 project 配置语义（除必要路径，且路径已是 `tests/ui-smoke`）。
  - 不把 ui-smoke 写成重复的完整业务测试（只做冒烟）。
  - 不改被测组件。

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 脚手架 + 冒烟测试，模式可复制既有单测。
  - **Skills**: [`sw-verification-before-completion`]
    - `sw-verification-before-completion`: 需证明该命令从空跑变为实跑。
  - **Skills Evaluated but Omitted**:
    - `sw-browser-tester`: 冒烟为 jsdom 层，非真实浏览器 E2E。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T13, T14)
  - **Blocks**: None（v2 修订：v1 声称 Blocks T16/T17/T18，与"也可独立交付"自相矛盾；T16 已有 15 个既有 UI 单测作为硬护栏，故 T19 仅提供**额外**冒烟承接，不构成阻断）
  - **Blocked By**: None (can start immediately)
  - **补充说明**: 若 T19 与 T16 并行推进，T16 的验收仍以 `npm run test:unit`（15 个 UI 测试）为准；T19 完成后 `npm run test:ui-smoke` 成为增量门禁。

  **References**:
  - **Pattern References**:
    - `vitest.workspace.ts:36-46` — **缺口证据**：`ui-smoke` project 定义。
    - `package.json:scripts.test:ui-smoke` — 门禁命令定义。
  - **API/Type References**:
    - `src/ui/{sidebar,settings,recovery,import-preview,candidate-selector,conflict-confirm}/index.html|main.tsx` — 六页入口。
  - **Test References**:
    - `tests/unit/ui/sidebar.test.tsx` — 既有渲染测试模板。
    - `tests/unit/ui/settings.test.tsx` — 既有渲染测试模板。
    - `tests/setup.ts` — 全局 setup（jsdom + jest-dom）。
  - **WHY Each Reference Matters**: 该缺口使 B11 这一最大重构缺乏冒烟护栏；补上后 `test:ui-smoke` 才真正构成质量门禁。

  **Acceptance Criteria**:

  **If TDD (tests enabled):**
  - [ ] 实施前运行 `npm run test:ui-smoke` → 观察"无测试文件/空跑"现状（证据）
  - [ ] 实施后 `npm run test:ui-smoke` → ALL PASS（≥ 6 tests，六页各 ≥ 1）
  - [ ] `npm run test:unit && npm run test:integration` → 无回归

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: ui-smoke 门禁从空跑变为实跑
    Tool: Bash (test runner)
    Preconditions: tests/ui-smoke/ 已创建
    Steps:
      1. npm run test:ui-smoke
      2. 断言输出含 ≥ 6 个通过的测试
      3. 断言六页入口各被至少一个测试覆盖
    Expected Result: 门禁有效
    Failure Indicators: "No test files found" / 0 tests
    Evidence: _context-output/evidence/task-19-ui-smoke-active.txt

  Scenario: 冒烟测试能捕获渲染失败（负向证据）
    Tool: Bash (test runner)
    Preconditions: 临时使某页渲染抛错
    Steps:
      1. 断言至少一个 ui-smoke 测试失败（证明非空断言）
      2. 还原
    Expected Result: 冒烟具备真实判别力
    Evidence: _context-output/evidence/task-19-smoke-failure-detection-error.txt
  ```

  **Commit**: YES (groups with none)
  - Message: `test(ui): add ui-smoke scaffolding for six page entries`
  - Files: `tests/ui-smoke/**`
  - Pre-commit: `npm run test:ui-smoke`

### Wave 5 — 低危可选（可裁剪，不阻断发布）

> 本波内所有任务 **MAY** 被裁剪。若时间受限，仅交付 Wave 1–4 仍满足 Must Have（B1–B14）。裁剪需在 F4 中登记为"有意排除"。

- [x] T20. **notifications `iconUrl` 空串回退 `runtime.getURL('icons/icon-128.png')`**

  **What to do**:
  - `src/adapters/chrome-adapter.ts:273` 附近：`notifications.create` 的 `iconUrl: ''` 改为回退 `chrome.runtime.getURL('icons/icon-128.png')`。
  - 补测试 `tests/unit/adapters/adapter.test.ts`：断言 `iconUrl` 非空且为扩展内 URL。

  **Must NOT do**:
  - 不改通知的其他字段；不新增网络图标来源。

  **Recommended Agent Profile**:
  - **Category**: `quick` — 单行级回退。
  - **Skills**: [`sw-verification-before-completion`] — 断言语义。
  - **Skills Evaluated but Omitted**: `sw-systematic-debugging` — 无需调查。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - **Pattern References**: `src/adapters/chrome-adapter.ts:270-278` — **被修复点**：`iconUrl: ''`。
  - **API/Type References**: `icons/icon-128.png`（仓库既有图标资源，需确认存在）。
  - **Test References**: `tests/unit/adapters/adapter.test.ts` — 扩展通知断言。
  - **WHY Each Reference Matters**: 空 `iconUrl` 在部分平台会被浏览器拒绝，属低危但真实的静默失败。

  **Acceptance Criteria**:
  - [ ] `npx vitest run tests/unit/adapters/adapter.test.ts` → ALL PASS（新增 ≥ 1 test）
  - [ ] `npm run test:unit` → ALL PASS

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: 通知图标回退为扩展内资源
    Tool: Bash (test runner)
    Preconditions: mock notifications 记录参数
    Steps:
      1. 触发通知
      2. 断言传入 iconUrl 非空且以 chrome-extension:// 开头
    Expected Result: 无空 iconUrl
    Evidence: _context-output/evidence/task-20-notification-icon.txt

  Scenario: getURL 不可用时安全降级
    Tool: Bash (test runner)
    Preconditions: mock runtime.getURL 抛错
    Steps:
      1. 触发通知
      2. 断言不抛出、通知仍创建
    Expected Result: 降级不崩溃
    Evidence: _context-output/evidence/task-20-notification-icon-error.txt
  ```

  **Commit**: YES (groups with T21, T23)
  - Message: `fix(notifications): fall back to bundled icon URL`
  - Files: `src/adapters/chrome-adapter.ts, tests/unit/adapters/adapter.test.ts`
  - Pre-commit: `npm run test:unit`

- [x] T21. **`handleMessage` 恒返回 true → action 白名单 + 响应超时**

  **What to do**:
  - `src/background/worker-orchestrator.ts:242` `handleMessage` 恒 `return true`（保持消息端口开启）→ 改为仅对**白名单内** action 返回 true（异步响应），未知 action 返回 false 或立即 sendResponse 错误。
  - 增加响应超时保护（若处理超时则回错误码 `'TIMEOUT'`，`types.ts:255` 已有该码）。
  - 补测试：断言未知 action 不被静默挂起；断言超时返回 `TIMEOUT`。

  **Must NOT do**:
  - 不改变已知 action 的返回契约。
  - 不用超时中断有副作用的写操作（仅返回超时错误，不强制取消）。

  **Recommended Agent Profile**:
  - **Category**: `quick` — 守卫逻辑明确。
  - **Skills**: [`sw-verification-before-completion`] — 需未知 action 证据。
  - **Skills Evaluated but Omitted**: `sw-reviewer-security` — 属健壮性而非漏洞。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: None
  - **Blocked By**: T13（同文件 worker-orchestrator.ts）

  **References**:
  - **Pattern References**: `src/background/worker-orchestrator.ts:242` — **被修复点**：恒 true。
    `src/background/worker-orchestrator.ts` `handleMessage` 的 switch（全量 action 清单）。
  - **API/Type References**: `src/shared/messages.ts` — action 联合类型（白名单来源）。
    `src/shared/types.ts:255` — `'TIMEOUT'` 错误码。
  - **Test References**: `tests/integration/worker-orchestrator.test.ts` — 扩展未知 action / 超时用例。
  - **WHY Each Reference Matters**: 恒 true 会让每条消息端口常驻，未知 action 静默无响应会导致 UI 卡等待。

  **Acceptance Criteria**:
  - [ ] `npx vitest run tests/integration/worker-orchestrator.test.ts` → ALL PASS（新增 ≥ 2 tests）
  - [ ] `npm run test:integration` → ALL PASS

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: 未知 action 得到显式错误而非静默挂起
    Tool: Bash (test runner)
    Preconditions: 无
    Steps:
      1. handleMessage({action:'NOPE'})
      2. 断言响应含 success:false 或返回 false（端口不挂起）
    Expected Result: 显式失败
    Evidence: _context-output/evidence/task-21-unknown-action.txt

  Scenario: 处理超时返回 TIMEOUT
    Tool: Bash (test runner)
    Preconditions: mock 服务永不 resolve
    Steps:
      1. 发送一个会超时的 action
      2. 断言响应 errorCode === 'TIMEOUT'
    Expected Result: 超时明确上报
    Evidence: _context-output/evidence/task-21-timeout-error.txt
  ```

  **Commit**: YES (groups with T20, T23)
  - Message: `fix(worker): whitelist actions and add response timeout`
  - Files: `src/background/worker-orchestrator.ts, tests/integration/worker-orchestrator.test.ts`
  - Pre-commit: `npm run test:integration`

- [x] T22. **中英错误文案统一**

  **What to do**:
  - 统一 `src/background/rule-service.ts`（中文文案）与 `src/background/storage-repository.ts`（英文文案）的错误 `message` 语言策略（建议统一为英文，与 `message-client.ts:44-50` 的英文映射一致；或统一为中文，由执行者依项目主语言决定并记录）。
  - 确保 `message-client.ts` 的 `getErrorMessage` 映射覆盖所有实际错误码。
  - 补测试：断言错误码到文案的映射完整（遍历 `DomainErrorCode` 均有映射）。

  **Must NOT do**:
  - 不改错误码本身（只改 message 文案）。
  - 不改 UI 已断言的具体文案（先跑 `tests/unit/**` 确认无文案断言冲突，若有则同步更新断言并记录）。

  **Recommended Agent Profile**:
  - **Category**: `quick` — 文案统一。
  - **Skills**: [`sw-verification-before-completion`] — 需映射完整性证据。
  - **Skills Evaluated but Omitted**: `sw-grill-docs` — 无领域术语变更。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: None
  - **Blocked By**: T13（同错误码区域）

  **References**:
  - **Pattern References**: `src/ui/shared/message-client.ts:44-50`（英文映射）、`:126,135` — 文案真源。
    `src/background/rule-service.ts:79,101,197` — 中文文案示例。
    `src/background/storage-repository.ts:247` — 英文文案示例。
  - **API/Type References**: `src/shared/types.ts:225-255` — `DomainErrorCode` 全量枚举。
  - **Test References**: `tests/unit/ui/message-client.test.ts` — 映射断言。
  - **WHY Each Reference Matters**: 混用语言会削弱错误码到用户文案的映射一致性，且部分 UI 测试可能锁定文案。

  **Acceptance Criteria**:
  - [ ] `npx vitest run tests/unit/ui/message-client.test.ts` → ALL PASS（新增映射完整性测试）
  - [ ] `npm run test:unit` → ALL PASS（无文案断言回归）

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: 所有错误码均有用户文案映射
    Tool: Bash (test runner)
    Preconditions: 无
    Steps:
      1. 遍历 DomainErrorCode 全部取值
      2. 断言 getErrorMessage(code) 均返回非空字符串且语言一致
    Expected Result: 映射完整
    Evidence: _context-output/evidence/task-22-error-mapping-complete.txt

  Scenario: 未知错误码有兜底文案
    Tool: Bash (test runner)
    Preconditions: 无
    Steps:
      1. getErrorMessage('NOT_A_CODE')
      2. 断言返回兜底文案而非 undefined
    Expected Result: 安全兜底
    Evidence: _context-output/evidence/task-22-unknown-code-error.txt
  ```

  **Commit**: YES (groups with T20, T21)
  - Message: `chore(i18n): unify error message language`
  - Files: `src/background/rule-service.ts, src/background/storage-repository.ts, src/ui/shared/message-client.ts`
  - Pre-commit: `npm run test:unit`

- [x] T23. **`detectBrowserType` 以 API 形态为主判据**

  **What to do**:
  - `src/adapters/contract.ts:177-194` `detectBrowserType` 当前依赖 UA 字符串 → 改为**以 API 形态为主判据**（如 `browser.sidebarAction` 存在 → firefox；`chrome.sidePanel` 存在 → chrome/edge），UA 仅作最后兜底。
  - 补测试：构造不同 API 形态（mock 存在/不存在 `sidebarAction` / `sidePanel`）断言返回正确 `BrowserType`。

  **Must NOT do**:
  - 不改 `BrowserType` 联合取值。
  - 不引入 UA 解析库。

  **Recommended Agent Profile**:
  - **Category**: `quick` — 判定分支重排。
  - **Skills**: [`sw-verification-before-completion`] — 需各浏览器形态证据。
  - **Skills Evaluated but Omitted**: `sw-external-researcher` — API 差异为已知。

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - **Pattern References**: `src/adapters/contract.ts:177-194` — **被修复点**：UA 判定。
    `src/adapters/chrome-adapter.ts:323`（`sidePanel`）、`manifests/firefox.json`（`sidebar_action`）— 能力差异真源。
  - **API/Type References**: `src/shared/types.ts:BrowserType` — 联合取值。
  - **Test References**: `tests/unit/adapters/adapter.test.ts` — 扩展判定用例。
  - **WHY Each Reference Matters**: UA 字符串可被伪装且浏览器版本迭代会漂移；API 形态是能力检测的可靠判据。

  **Acceptance Criteria**:
  - [ ] `npx vitest run tests/unit/adapters/adapter.test.ts` → ALL PASS（新增 ≥ 2 tests）
  - [ ] `npm run test:unit` → ALL PASS

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: 依 API 形态判定浏览器类型
    Tool: Bash (test runner)
    Preconditions: mock 全局对象
    Steps:
      1. 仅存在 sidebarAction → 断言返回 'firefox'
      2. 仅存在 sidePanel → 断言返回 'chrome' 或 'edge'
      3. 两者皆无 → 断言返回兜底值
    Expected Result: 判定与 API 形态一致
    Evidence: _context-output/evidence/task-23-browser-detect.txt

  Scenario: UA 伪装不影响判定
    Tool: Bash (test runner)
    Preconditions: UA 声称 Firefox 但存在 sidePanel
    Steps:
      1. 断言返回基于 API 的 chrome/edge（不被 UA 误导）
    Expected Result: API 优先
    Evidence: _context-output/evidence/task-23-ua-spoof-error.txt
  ```

  **Commit**: YES (groups with T20, T21)
  - Message: `refactor(adapters): detect browser by API shape`
  - Files: `src/adapters/contract.ts, tests/unit/adapters/adapter.test.ts`
  - Pre-commit: `npm run test:unit`

---

## Risks, Blockers & Decisions

### Cross-Module Coupling Map（依赖图要点）

| 耦合点 | 涉及任务 | 串行原因 |
|--------|----------|----------|
| `worker-orchestrator.ts` | T2 → T3 → (T13 → T21) | 同一 handleMessage switch 区域，多任务编辑冲突 |
| `storage-repository.ts` | T1 → T6 → T10 → T12 | `writeLocal` / 不可变 mutator / icon 缓存 / startupCleanup 同文件递进 |
| `rule-service.ts` | T9 → T11 → T12 | favicon 白名单 → computeFields 纯函数化 → 分片并发 |
| `shared/url-utils.ts` | T4 → T9 → T15 | T4 加缓存/ReDoS、T9 追加 `isSafeFaviconProtocol`、T15 引用生成常量；跨 Wave 但天然串行（Wave1 → Wave2 → Wave4） |
| `content/index.ts` | T14 → T15 | LRU 与共享常量同文件 |
| `manifests + validate-manifest.mjs + chrome-adapter` | T7（单一任务内闭环） | 五处必须同步，否则校验脚本与产物不一致 |
| UI 六页 | T19 ∥ T16 → T17 / T18 | **v2 修正**：T19 为并行**可选**前置（不阻断）；T16 的真实硬护栏是 15 个既有 UI 单测 |

### Risks

| # | 风险 | 影响 | 缓解 |
|---|------|------|------|
| R1 | **T3（B2）数据结构设计未闭环** — `pendingUndo` 并入 `LocalState` 还是独立 storage 键未定 | 中：可能返工 | 计划建议独立键 + `expiresAt` 惰性校验；执行者实现前先读 `LocalState` 与 `writeLocal` 契约，**必须在证据中记录最终选择** |
| R2 | **T7（B5）manifest 合并语义未知** — `merge-manifest.mjs` 浅/深合并决定声明位置 | 中：漏声明会被校验脚本拦住（可控） | 任务内第一步强制读 `merge-manifest.mjs`；校验脚本新增断言作为构建期护栏 |
| R3 | **T11 纯函数化重构可能改变字段优先级** | 高：核心功能回归 | 以 `rule-apply-persistence` / `rule-delivery-robust` / `rule-delivery-real-dom` 三个既有集成测试 + 逐字段等价断言为验收 |
| R4 | **T16 UI 六页重构回归面大且 ui-smoke 缺失** | 高：依赖 jsdom 单测 | T19 落地冒烟作为**增量**门禁（可并行）；15 个既有 UI 测试全绿为**硬门禁**（v2 修正：不依赖 T19 完成） |
| R5 | **T12 分片并发可能改变投递结果统计** | 中：计数偏差 | 断言"全部标签被投递"与"并发峰值 ≤ 分片"双证据 |
| R6 | **T8 私网判定对 IPv6 / DNS 直连不完整** | 中：SSRF 残留 | 采用"拒绝非全局单播"保守策略；F2 安全复查该文件 |
| R7 | **T15 构建期代码生成可能破坏内容脚本自包含** | 中：import 残留致运行时失败 | 强制跑三浏览器 `build:*` + 检查产物无外部 import |
| **R8** | **（v2 新增）T9 协议白名单若被误实现为"仅 `data:`"** | **高：3 个既有集成测试硬失败** | 白名单 = `data:`/`http:`/`https:`；验收含"既有 http(s) favicon 断言全绿"；Must NOT 明确禁止改这 3 个测试的断言 |
| **R9** | **（v2 新增）T2 RED 构造不可达（`emitStorageChange` 版本冲突）** | 中：RED 无法成立 → TDD 失效 | 改用"仅 sync 区写入失败"的适配器覆写构造（模板：`sync-write-resilience.test.ts:31-38`）；不覆盖 configVersion 冲突分支（已由既有用例覆盖） |
| **R10** | **（v2 新增）T17 "chrome.tabs.* 归零"与回退路径互斥** | 高：验收不可达成 / 回退失效 | 范围收敛为"主路径走 `OPEN_PAGE` + 回退收敛单一 helper"；不删回退、不改 `sidebar-open-page.test.tsx` 断言 |
| **R11** | **（v2 新增）T18 接线后 `OPEN_SIDEBAR` 重复路由**（`sidebar-adapter.ts:123` 已硬编码监听） | 中：`sidePanel.open` 双调用 / `sendResponse` 竞争 | 决策必须择一（routeMessage 唯一 或 ToolbarActionHandler 唯一），并断言"仅响应一次" |
| **R12** | **（v2 新增）T1 `nextError` 注入被提前消费** | 低：假红/假绿 | 明确注入时机：必须在 `repo.initialize()` 与所有前置适配器调用**之后**；`code` 用真实 `DomainErrorCode`（`BROWSER_API_ERROR`） |

### Blocking Points（阻塞点）

- **B0（外部）**：`tests/ui-smoke/` 缺失使 `npm run test:ui-smoke` 名存实亡 → 由 T19 解除（**可选、非阻断**）；在此之前及之后，B11 的硬验证均以 `npm run test:unit`（15 个 UI 测试）为准。
- **B1（顺序）**：T1 未完成前不建议动 `storage-repository.ts` 其他区域（B6/B7/B12），否则编辑冲突。
- **B2（顺序）**：T2 未完成前 T3 无法正确传播 `WriteResult`。
- **B3（环境）**：三浏览器构建需 Node ≥ 20（`package.json:engines`）；`build:firefox` 依赖 Firefox 覆盖文件存在（已确认）。
- **B4（顺序，v2 新增）**：`shared/url-utils.ts` 由 T4/Wave1、T9/Wave2、T15/Wave4 依次触碰；须按 Wave 顺序串行（见 Coupling Map）。

### Decisions Resolved in v2（复审后已定案）

1. **B9 语义边界（Blocker 1）→ 决策 (a)**：协议白名单 = `data:` / `http:` / `https:`，拒绝 `javascript:` / `file:` / `blob:` / `data:text/html`。**理由**见 Revision Log Blocker 1（含与"无外部请求"承诺的兼容性论证）。
2. **T17 范围（Blocker 3）→ 决策"收敛"（非"授权改测试"）**：保留"后台不可用"回退，回退收敛为 `openOrReusePage` 单一 helper；不要求 `chrome.tabs.*` 归零；`sidebar-open-page.test.tsx` 不改。
3. **T2 RED 构造（Blocker 2）→ 已定案**：以"仅 sync 区写入失败"的适配器覆写构造；**放弃** `emitStorageChange` 版本冲突构造（不可达）。
4. **T19 定位（nit#2）→ 已定案**：降为 T16–T18 的并行**可选**前置，不阻断。
5. **T7 测试落点（nit#3）→ 已定案**：新增 `tests/unit/adapters/chrome-adapter-incognito.test.ts`（真实适配器 + `chrome` 全局桩）。

### Decisions Needed（仍需执行期决策）

1. **T3 快照存储形态**：`pendingUndo` 作为 `LocalState` 新字段 vs 独立 `storage.local` 键？→ 建议独立键（避免污染 `LocalState` 公共形状）；若选并入则须同步更新 `types.ts` 与既有 local 状态测试。
2. **T15 生成产物落点**：生成到 `src/shared/protected-prefixes.generated.ts`（参与 TS 编译，需加 `.generated` 约定）vs 直接内联进内容脚本构建产物？→ 建议前者 + 构建前生成。
3. **T18 `sidebar-adapter` 去留**：接线 vs 删除？→ 若接线，须按 T18 的"监听器唯一化"要求处理 `sidebar-adapter.ts:123` 的既有硬编码路由；若无法判定归属，**建议删除**（零引用；`OPEN_SIDEBAR` 契约补入 `messages.ts`，可通过 `worker-orchestrator` 路由测试承接），以消除僵尸模块。
4. **Wave 5 裁剪**：T20–T23 是否纳入本次交付？→ 默认**建议全纳入**（工作量小），若时间受限可裁剪并在 F4 登记。
5. **T9 `data:image/svg+xml` 取舍**：SVG 可含脚本 → 建议一并拒绝（只允许位图 `data:image/png|jpeg|gif|webp|ico` 等），由执行者在证据中记录最终白名单集合。

### Auto-Resolved（规划期已自动闭合的小缺口）

- 计划落盘位置：`_context-output/plans/`（项目既有输出约定，非 skill 默认的 `_context/memory/sw-shared/`）。
- evidence 目录：`_context-output/evidence/`（与 plans 同级，保持输出集中）。
- `REGEX_RISK` 双重语义（拒绝档 vs 告警档）：在 T4/T5 中明确区分——灾难性回溯=拒绝，宽泛匹配=告警。
- 低危项排序：统一置于 Wave 5，避免污染 P0/P1 关键路径。

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must PASS. Present consolidated results to user and get explicit "okay" before completing.
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

- [ ] F1. **Plan Compliance Audit** (recommended: `oracle` / strategic review profile)

  Read the plan end-to-end executing the following:
  - **Must Have verification**: 对每条 Must Have 逐项验证实现存在——读对应文件区域、跑对应测试（`npx vitest run tests/unit/shared/url-utils.test.ts` 等）、检查 `manifests/base.json` 的 `incognito` 键、检查 `icon-service.ts` 的 AbortController/白名单。
  - **Must NOT Have verification**: 搜索禁止模式——`grep -n "as any\|@ts-ignore" src` 应仅在白名单外为 0；`search_content "from '"` 检查未新增 npm 依赖（对比 `package.json` diff）；`grep -rn "errorCode: 'INTERNAL'" src` 必须为 0。
  - **B9 协议白名单核对（v2 修订）**：`grep -rn "file://\|javascript:\|blob:\|ftp:" src/background/icon-service.ts src/background/rule-service.ts src/background/apply-fields.ts` —— 命中**仅允许**出现在"**拒绝清单常量/注释**"（如 `DANGEROUS_FAVICON_PROTOCOLS`）中；**不得**出现在赋值给 `link.href` 的表达式路径。F1 须人工区分这两种命中，不可简单断言"0 matches"（v1 的"必须为 0"会与 B9 的拒绝清单**误报冲突**）。
  - **B8 协议收紧核对**：`grep -n "http:\|https:" src/background/icon-service.ts` → 必须存在**白名单**实现；同时确认无 `ftp:`/`file:` 被**允许**。
  - **B9 与既有测试兼容核对**：`npx vitest run tests/integration/rule-delivery-real-dom.test.ts tests/integration/rule-apply-persistence.test.ts tests/integration/rule-delivery-robust.test.ts` 必须 ALL PASS（这是 blocker 1 的核心红线）。
  - **Evidence verification**: 检查 `_context-output/evidence/` 下 task-* 证据文件齐全。
  - **Deliverable verification**: 对照 Concrete Deliverables 逐条核对 git diff。

  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | Evidence [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** (recommended: `unspecified-high` profile)

  Run static analysis and review all changed files:
  - **Build**: `npm run build:chrome` 必须成功（0 error）
  - **Lint**: `npm run lint` 必须 0 warning（`--max-warnings 0`）
  - **Typecheck**: `npm run typecheck` 必须 0 error
  - **Tests**: `npm run test:unit && npm run test:integration` 全绿
  - **Code patterns**: 检查 `as any` / `@ts-ignore` / 空 catch / 生产代码 `console.log` / 注释掉的代码 / 未使用 import
  - **AI slop detection**: 过度注释、过度抽象、泛化命名（data/result/item/temp）

  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Typecheck [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT: APPROVE/REJECT`

- [ ] F3. **Real Manual QA** (recommended: `unspecified-high` + browser skill if UI)

  从干净状态出发，执行**每个任务的每个 QA 场景**（agent 执行，非人类）：
  - **Per-Scenario Execution**: 按各任务 QA 场景的精确命令执行，捕获输出
  - **Integration Testing**: 跨任务联动（如 B3+B2 的 UNBIND→UNDO 链路、B6+B7 的缓存一致性、B5 manifest→adapter→slot-service 过滤）
  - **Edge Cases**: 空状态、连续失败注入、并发版本冲突、恶意正则、私网 URL
  - **Evidence Collection**: 全部证据存 `_context-output/evidence/final-qa/`

  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT: APPROVE/REJECT`

- [ ] F4. **Scope Fidelity Check** (recommended: `deep` profile)

  对每个任务：验证实现与规格精确一致：
  - **Spec-Implementation Mapping**: 读每任务 "What to do"，读 `git diff`，验证 1:1 对应
  - **Completeness Check**: 规格中所有内容都已构建（无遗漏功能）
  - **Anti-Creep Check**: 无超规格新增（无未授权改动、无新依赖、未放宽网络许可）
  - **Must NOT Do Compliance**: 检查每任务 "Must NOT do" 约束
  - **Cross-Task Contamination**: 检测任务越界触碰他任务文件
  - **Unaccounted Changes**: 标记任何未在任何任务中列出的改动文件

  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT: APPROVE/REJECT`

---

## Commit Strategy

```
Commit 1: fix(storage): keep local write queue alive after failure (B1)
  Files: src/background/storage-repository.ts, tests/integration/storage-repository.test.ts
  Pre-commit: npm run lint && npm run typecheck && npm run test:integration

Commit 2: fix(slot): propagate RemoveSlot WriteResult from unbindSlot (B3)
  Files: src/background/slot-service.ts, src/background/worker-orchestrator.ts, tests/unit/background/unbind-slot.test.ts
  Pre-commit: npm run test:unit && npm run test:integration

Commit 3: fix(undo): restore slot snapshot on UNDO_SAVE with TTL (B2)
  Files: src/background/worker-orchestrator.ts, src/background/slot-service.ts, tests/integration/worker-orchestrator.test.ts
  Pre-commit: npm run test:integration

Commit 4: fix(regex): cache compiled regex and reject catastrophic backtracking (B4)
  Files: src/shared/url-utils.ts, src/background/import-export-service.ts, tests/unit/shared/url-utils.test.ts, tests/integration/import-export-service.test.ts
  Pre-commit: npm run test:unit && npm run test:integration

Commit 5: fix(storage): immutable local state updates (B6)
  Files: src/background/storage-repository.ts, tests/integration/storage-repository.test.ts
  Pre-commit: npm run test:integration

Commit 6: fix(privacy): declare incognito not_allowed and gate on user flag (B5)
  Files: manifests/base.json, manifests/chrome.json, manifests/edge.json, manifests/firefox.json, src/adapters/chrome-adapter.ts, scripts/validate-manifest.mjs, tests/unit/adapters/chrome-adapter-incognito.test.ts
  Pre-commit: npm run test:unit && node scripts/validate-manifest.mjs chrome

Commit 7: fix(icons): enforce timeout, protocol allowlist and private-host denial (B8)
  Files: src/background/icon-service.ts, tests/unit/background/icon-service.test.ts
  Pre-commit: npm run test:unit

Commit 8: fix(icons): reject dangerous favicon protocols, allow data/http/https (B9)
  Files: src/shared/url-utils.ts, src/background/rule-service.ts, src/background/apply-fields.ts, tests/unit/background/rule-service.test.ts
  Pre-commit: npm run test:unit && npm run test:integration

Commit 9: perf(storage): cache icon resolution and batch tab queries (B7, B12)
  Files: src/background/storage-repository.ts, src/background/rule-service.ts, tests/integration/storage-repository.test.ts, tests/unit/background/rule-service.test.ts
  Pre-commit: npm run test:unit && npm run test:integration

Commit 10: refactor(worker): unify error codes to INTERNAL_ERROR (B10)
  Files: src/background/worker-orchestrator.ts
  Pre-commit: npm run typecheck

Commit 11: fix(content): bound reported URL sets and share protected prefixes (B13, B14)
  Files: src/content/index.ts, src/shared/url-utils.ts, scripts/gen-protected-prefixes.mjs, tests/unit/content/content-script.test.ts
  Pre-commit: npm run test:unit

Commit 12: refactor(ui): route pages via message-client; sidebar via OPEN_PAGE with single fallback helper (B11)
  Files: src/ui/**, tests/unit/ui/**（T17 仅改 src/ui/sidebar/App.tsx，不改 sidebar-open-page.test.tsx）
  Pre-commit: npm run test:unit && npm run test:integration
  Note: npm run test:ui-smoke 仅在 T19 落地后纳入；否则为可选

Commit 13: chore: low-risk hardening (notifications, action whitelist, i18n, browser detection)
  Files: src/adapters/chrome-adapter.ts, src/background/worker-orchestrator.ts, src/background/rule-service.ts, src/adapters/contract.ts
  Pre-commit: npm run test:unit && npm run test:integration
```

---

## Success Criteria

### Verification Commands

```bash
# Lint（0 warning 硬门禁）
npm run lint            # Expected: exit 0, no output/0 warnings

# 类型检查
npm run typecheck       # Expected: exit 0, no errors

# 单元测试（含新增 B4/B9/B10/B13 测试）
npm run test:unit       # Expected: all pass,新增 ≥ 12 tests

# 集成测试（含新增 B1/B2/B3 测试）
npm run test:integration # Expected: all pass, 新增 ≥ 8 tests

# UI 冒烟（若 T19 落地）
npm run test:ui-smoke   # Expected: all pass（否则为 harness 缺口，见 Decisions Needed）

# 三浏览器构建
npm run build:chrome    # Expected: dist/chrome/manifest.json 生成
npm run build:edge      # Expected: dist/edge/manifest.json 生成
npm run build:firefox   # Expected: dist/firefox/manifest.json 生成

# Manifest 校验（B5 断言 incognito 键）
node scripts/validate-manifest.mjs chrome   # Expected: PASSED
node scripts/validate-manifest.mjs edge     # Expected: PASSED
node scripts/validate-manifest.mjs firefox  # Expected: PASSED

# 禁止模式抽查（F1）
grep -rn "errorCode: 'INTERNAL'" src       # Expected: 0 matches

# B9 危险协议抽查（决策 (a)：白名单 = data/http/https）
grep -rn "javascript:\|file://\|blob:\|data:text/html" src/background/rule-service.ts src/background/apply-fields.ts src/shared/url-utils.ts
# Expected: 仅出现在"拒绝白名单"常量/注释中，不得出现在赋值给 link.href 的路径
```

### Final Checklist

- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tasks completed (23/23，Wave 5 可裁剪)
- [ ] All tests pass (unit + integration)
- [ ] **B9 兼容性验证**：`rule-delivery-real-dom` / `rule-apply-persistence` / `rule-delivery-robust` 三个既有集成测试全绿（http(s) favicon 断言未回归）
- [ ] **T2 RED 可构造性验证**：新增测试在未修复代码上确实失败（证据 `task-2-red.txt`）
- [ ] **T17 双护栏验证**：`sidebar-open-page.test.tsx` 主路径 + 回退路径用例均通过且未被修改
- [ ] All QA scenarios executed with evidence
- [ ] All Final Verification reviews APPROVED
- [ ] User explicitly approved completion
- [ ] Evidence directory: `_context-output/evidence/` populated

---

## Revision Log (v2 — 2026-09-28)

> 本次修订针对 `sw-plan-reviewer-agent` 的 High Accuracy Review（判定 **NOT OKAY**）就地修订：修复 **3 个 blocker** + **5 项 nit**，并记录新发现的引用漂移与不可达构造。**任务编号 T1–T23 / F1–F4 保持不变**。

### Blocker 1 — T9（B9）规格与既有集成测试硬矛盾 → **决策 (a)：协议白名单**

| 项 | 修订内容 |
|----|----------|
| **根因确认** | reviewer 举证属实（已独立复核）：`rule-delivery-real-dom.test.ts:76-94 / :96-119 / :198-212`、`rule-apply-persistence.test.ts:218-237`、`rule-delivery-robust.test.ts:75-90` 均断言 **http(s) favicon 被原样注入**（`link.href === 'https://new.example/icon.png'` / `'https://slot.com/icon.png'`）。v1 的"仅 `data:`、http(s) 返回 null、非 data 不创建 link"与之**不可共存**。v1 仅把 `rule-delivery-real-dom.test.ts` 的 local-icon 用例（`test 6`，实为 `:266-303` 的 `computeFields resolves offloaded local-icon`）列为护栏，**遗漏了上述 3 处 http(s) 断言**。 |
| **最终决策** | **(a) 调整 B9 语义边界**：协议白名单 = `data:`（限 `data:image/*`）/ `http:` / `https:`；**拒绝** `javascript:` / `file:` / `blob:` / `data:text/html` 等危险协议。 |
| **理由（技术上更正确）** | B9 的**原始安全意图**是关闭**危险协议注入面**（`link.href = 'javascript:...'` 造成 XSS；`file://` 造成本地文件探测；`data:text/html` 造成同源脚本执行），**不是**"禁止远程 favicon"。① 与隐私承诺**不冲突**：`RELEASE_CANDIDATE.md:52` 的"No telemetry / 零外部请求"约束的是**扩展自身发起的出网行为**；而 `link.href` 指向远程 URL 是**页面自身的资源加载**（等价于站点原有 favicon 请求），扩展未新增任何网络调用，故不违背该承诺。② 与产品语义一致：UI 明确支持 `iconMode === 'url'`（`settings/App.tsx:300-301` 存 `{type:'url', value: iconUrl}`），且 `slot.faviconSnapshot` 直接取自 `activeTab.favIconUrl`（`slot-service.ts:58`）——**天然是远程 URL**；若仅允许 `data:`，则"槽位继承站点图标"这一核心功能被无声破坏。③ 与既有测试兼容：3 处 http(s) 断言与 `open-page-reuse` 等护栏全部保持绿，`RuleService` 的安全收窄仍通过"危险协议拒绝"用例证明。 |
| **具体改动** | T9 标题改为"危险协议黑名单（允许 `data:`/`http:`/`https:`…）"；新增 `isSafeFaviconProtocol()` 单一真源于 `src/shared/url-utils.ts`（T9 首次触碰该文件，须在 T4 之后）；`What to do` 重写（危险协议拒绝 + http(s) 放行 + `data:image/*` 子类型白名单）；`Must NOT do` 增加"不得要求仅 `data:`""不得放宽到 file/ftp/blob/javascript"；`References` 补齐 3 处被遗漏的护栏测试；验收断言改为"**危险协议被拒 / 安全协议放行**"且明确要求三个既有集成测试全绿；QA 场景改为 4 个 slot（`javascript:`/`file:`/`data:text/html`/`https`）的双向验证；Commit message 与 Files 更新（新增 `src/shared/url-utils.ts`）；TL;DR / Work Objectives / Must Have / Must NOT Have / Risks(R8) / Commit Strategy 同步更新。 |
| **未选 (b) 的原因** | (b) 需改写 3 个既有集成测试的断言（把"远程 favicon 生效"改成"远程 favicon 被拒"），这会**删除既有功能护栏**并违背 `Must NOT Have` 的"禁止放宽/破坏既有行为"原则；且会使"槽位继承站点图标"链路失去端到端覆盖。仅在"产品决定彻底禁止远程 favicon"时才应选择 (b)。 |

### Blocker 2 — T2 的 RED 场景不成立且模板引用错位

| 项 | 修订内容 |
|----|----------|
| **根因确认** | reviewer 举证属实（已独立复核）：`storage-repository.ts:151-159` 的 `handleStorageChange` 在 `areaName==='sync' && changes[SYNC_KEY]` 时**直接写 `this.syncCache = newValue`**；`slot-service.ts:474` 的 `unbindSlot` 用 `version = this.repo.getConfigVersion()`（永远取当前值）→ `removeSlot(slotId, 5)` 版本匹配 → 返回 `success:true`。故 v1 的"`emitStorageChange` 使 configVersion=5 而 repo 内部仍为 0"**不可达**。另：`rule-version-check.test.ts` 测的是 `updateRule` 的 **`updatedAt`**（返 `VERSION_CONFLICT`），与 `removeSlot` 的 **`configVersion`** 机制无关，**不能照搬**。 |
| **具体改动** | T2 `What to do` 的 RED 构造替换为**可达路径**：覆写 `adapter.storage.set`（仅 `area==='sync'` 抛 quota 错，模板见 `sync-write-resilience.test.ts:31-38`）→ `removeSlot` → `writeSync` → `setSyncWithRetry` → `isQuotaError`（`:322-325`）→ rethrow → `classifyWriteError`（`:290-300`）→ `{success:false, errorCode:'BROWSER_API_ERROR'}`；断言 `unbindSlot` 返回该失败且 `UNBIND_SLOT` 响应失败。明确标注"**不要用 `emitStorageChange` 构造**"，并额外记录第二条不可达路径（直改 `syncStorage` 会被 `writeSync` 的 `getSyncState()` 自愈）。 |
| **References 修正** | 删除错误的 `rule-version-check.test.ts` 模板引用（保留并显式标注其"**不可照搬**"原因）；新增 `writeSync:205-249` / `setSyncWithRetry:255-284` / `classifyWriteError:290-317` / `isQuotaError:322-325` 与 `sync-write-resilience.test.ts:29-55` 作为正确模板；补 `storage-repository.test.ts:124-136` 说明 configVersion 冲突**已被覆盖**、无需重复。 |
| **QA / Acceptance 修正** | QA 场景由"版本冲突"改为"sync 写入失败被如实传播"，含 `finally` 还原与"仅响应一次"-类等价断言；验收标准补"新增 ≥ 2 tests"；删除对 `worker-orchestrator.test.ts` "既有 UNBIND 断言需改"的错误要求（该文件无 UNBIND 断言，已核实）。 |
| **T3（B2）同步检查** | 已核查：T3 **未复用** T2 的错误构造（T3 的 RED 基于"UNDO_SAVE 后槽位消失而非恢复"，属可达构造），故无需修正构造；但 T3 引用的 `sendMessage`/`unbindSlot`/`writeLocal` 行号已复核仍准确。 |
| **T1（附带发现，已修正）** | T1 亦使用 `nextError` 注入，但 (i) `code: 'STORAGE_ERROR'` **不在** `DomainErrorCode` 中（`types.ts:211-255`）→ 改为 `BROWSER_API_ERROR`；(ii) 未说明注入时机（`nextError` 会被**最早**的适配器调用消费）→ 补充"必须在 `initialize()` 与所有前置 `setTabs/query` 之后注入"；`writeSync:247` 引用修正为 `:246-247`。此为修订中**新发现**的漂移，一并修正（R12）。 |

### Blocker 3 — T17 与 `sidebar-open-page.test.tsx` 互相排斥 → **决策：范围收敛**

| 项 | 修订内容 |
|----|----------|
| **根因确认** | reviewer 举证属实（已独立复核）：`sidebar-open-page.test.tsx:79-94 / :96-103 / :105-121` 断言"后台不可用（`runtime.sendMessage` reject）时，**本地回退**调用 `chrome.tabs.update/create`（含 hash 复用）"；而 v1 的验收 `grep chrome.tabs.create|update|windows src/ui/sidebar/App.tsx → 0 matches` 要求其归零 → **互斥**。另注：`App.tsx:987` 实际**已复用** `openOrReusePage`（import 见 `:395`），v1 "自行复刻"表述不准确。 |
| **最终决策** | **收敛（不改测试）**：T17 范围改为"**主路径**走 `OPEN_PAGE` 消息；**保留**后台不可用的本地回退，且回退**复用 `openOrReusePage` 单一真源**（抽为具名 helper `createChromePageOpenApi()`）"。 |
| **理由** | 回退是**产品必需**行为：`runtime.sendMessage` 在 SW 未唤醒 / 扩展重载 / 测试环境下会 reject，删除回退会使"打开设置页"按钮静默失效（可用性回归）。故不应为"架构洁癖式的计数归零"牺牲功能。收敛为单一 helper 已达成 B11 的**真实目标**（消除重复实现、单一真源），同时两条既有护栏都保持通过。选择"收敛"而非"授权改测试"，是因为该回退**是正确行为**，不应改写其断言。 |
| **具体改动** | T17 标题与 `What to do` 重写（主路径/回退路径分别说明，回退抽 helper）；`Must NOT do` 明令"不得删除回退""不得强制 `chrome.tabs.*` 归零""不得修改 `sidebar-open-page.test.tsx` 断言"；验收标准改为"既有主/回退用例全绿 + 新增 helper 单一入口断言 + 主路径 `openPage` 主体 `chrome.tabs.*` 0 命中"（不再要求整文件归零）；QA 场景拆为"主路径"与"回退收敛"两条；`Commit.Files` 改为**仅** `src/ui/sidebar/App.tsx`（移除测试文件），并加注"测试不在改动清单"。 |
| **"22 处 chrome.*"表述修正** | 实测 `grep` 该文件 `chrome` 出现 **26 处**（含 `chrome.tabs.TabChangeInfo` 等**类型引用**）。已按**类别**逐一登记（主路径 `runtime.getURL/sendMessage`；事件订阅 `tabs.onActivated/onUpdated`、`storage.onChanged`；其它 `tabs.query`、`storage.local.get`；回退 helper `tabs.query/update/create`；锁定标签 `tabs.get/update` + `windows.update`），并同步修正 T16 的相同表述。 |

### Non-blocking Nits（5 项）

| # | 修订内容 |
|---|----------|
| **N1 Critical Path 自相矛盾** | 统一为**最长依赖链** `T1 → T6 → T10 → T11 → T12 → F1–F4`，三处（TL;DR `:34`、Execution Strategy `:241-244`、Dependency Matrix `:262-272`）一并改写并显式标注"关键路径 = 最长依赖链"；补充说明"F1–F4 依赖全部 23 个实现任务"。 |
| **N2 T19 硬门禁 T16 过度约束** | T19 的 `Blocks: T16,T17,T18` → **None**；T16 的 `Blocked By: T19` → **None**（硬护栏 = 15 个既有 UI 单测）；Coupling Map 与 R4 同步改为"T19 为并行可选前置"；T19 描述强调"可独立交付"。 |
| **N3 T7 测试落点无法验证真实适配器** | 新增 **`tests/unit/adapters/chrome-adapter-incognito.test.ts`**（`vi.stubGlobal('chrome', ...)` + `createChromeAdapter`），并在 T7 中明确：`adapter.test.ts:2` 仅导入 `createMockAdapter`，而 `mock-adapter.ts:413-418` 的 `isAllowed` 返回 `state.incognitoAllowed`、不读 manifest/storage → 原地断言会"空过"；T7 的 References / Acceptance / QA / Commit.Files 全部改指新文件。 |
| **N4 行号小漂移** | `mock-adapter.ts` 的 `logCall` 引用 `:384` → **`:81-83`**（`:384` 是 `scripting.executeScript` 内的调用点）；T6 的 `setIconCache :603` → **`:636`**（`:603` 实为 `addRecoverySession`），并补齐 mutator 全量锚点（`:557 / :584 / :596 / :603 / :610 / :617 / :629 / :636 / :643 / :654`）。 |
| **N5 `OPEN_SIDEBAR` 已硬编码** | 在 T18 的决策依据中纳入 `sidebar-adapter.ts:121-130` 既有 `OPEN_SIDEBAR` 监听（并指出 `messages.ts` **无**该常量）；新增"**必须避免重复路由**"要求（择一：routeMessage 唯一 或 ToolbarActionHandler 唯一），QA 增加"`sidePanel.open` 仅被调用一次"断言；References 补齐 `sidebar-adapter.ts:121-130` 与 `worker-orchestrator.ts:237-254`。 |

### 修订中**新发现**并一并修正的问题

| # | 问题 | 修正 |
|---|------|------|
| **A** | T1 使用 `code:'STORAGE_ERROR'`，但该值**不在** `DomainErrorCode`（`types.ts:211-255`） | 改为 `BROWSER_API_ERROR`；并补"注入时机"约束（避免 `nextError` 被提前消费） |
| **B** | T1 引用 `writeSync:247`（实际复位在 `:246-247`，`writeSync` 整体 `:205-249`） | 行号精确化 |
| **C** | T10 引用 `mock-adapter.ts:384` 作为 `logCall` 定义处（实为调用点） | 改为 `:81-83` |
| **D** | T6 引用 `setIconCache :603`（实为 `addRecoverySession`） | 改为 `:636` |
| **E** | T16/T17 声称 `sidebar/App.tsx` 有"22 处 `chrome.*`"且 `:984-999` 为"自行复刻" | 改为"26 处（含类型引用）"并按类别登记；`:984-999` 更正为"已复用 `openOrReusePage` 的回退路径" |
| **F** | T9 的修改会触碰 `src/shared/url-utils.ts`（与 T4/T15 同文件），v1 未标注串行关系 | T9 新增"同文件提示"与 Blocking Points **B4**；Coupling Map 增加 `shared/url-utils.ts` 行 |
| **G** | `Must Have` / `Must NOT Have` / Risks 未反映 Blocker 1/3 的语义变化 | 同步更新（新增 R8–R12；新增 Must NOT"不得改 3 个既有集成测试断言"） |

### v2 自证清单

**（a）逐条对照 blocker 闭环**

| Blocker | 闭环证据 |
|---------|----------|
| 1（T9 矛盾） | 全文已无"仅 `data:` / http(s) 返回 null / 非 data 不创建 link"表述；T9 白名单为 `data:/http:/https:`；验收显式要求 3 个既有集成测试全绿；`Must NOT` 禁止改其断言 ✅ |
| 2（T2 RED 不可达） | T2 RED 构造改为"仅 sync 区写入失败"（可达）；错误模板引用已替换为 `sync-write-resilience.test.ts`；显式禁止 `emitStorageChange` 构造并说明第二不可达路径；T3 已核查未复用该错误构造 ✅ |
| 3（T17 互斥） | T17 验收**已删除**"`chrome.tabs.*` 归零"要求；改为"主路径走 `OPEN_PAGE` + 回退收敛 helper"；`sidebar-open-page.test.tsx` 移出改动清单 ✅ |

**（b）抽查修改后的 T2 / T9 / T17 是否满足"RED 可构造 + 验收可达成 + 引用真实"**

| 任务 | RED 可构造 | 验收可达成 | 引用真实（已复核） |
|------|-----------|-----------|------------------|
| **T2** | ✅ 覆写 `adapter.storage.set`（sync 抛 quota）→ `writeSync` catch → `classifyWriteError` → `BROWSER_API_ERROR`；v1 代码返 `undefined`/恒 `success:true`，断言必失败 | ✅ `unbind-slot.test.ts` + `slot-service.test.ts` 可全绿；`worker-orchestrator.test.ts` 无 UNBIND 断言 | ✅ `slot-service.ts:470-476`、`storage-repository.ts:205-249 / :255-284 / :290-317 / :322-325 / :541-546`、`sync-write-resilience.test.ts:31-38`、`storage-repository.test.ts:124-136` 均已核实 |
| **T9** | ✅ `javascript:alert(1)` 当前被 `resolveSlotField` 原样返回并注入 → 断言 `favicon === null` 必失败 | ✅ 危险协议拒绝 + http(s)/data/local-icon 放行；3 个既有集成测试不回归 | ✅ `rule-service.ts:378-385`、`apply-fields.ts:45-53`、3 处 http(s) 断言（`:76-94 / :96-119 / :198-212`、`rule-apply-persistence:218-237`、`rule-delivery-robust:75-90`）、`local-icon` 用例 `:266-303` 均已核实 |
| **T17** | ✅ 新断言"回退经 `openOrReusePage` 单一入口"在当前内联实现上可失败（未抽 helper 时无法断言 helper 被调用） | ✅ 两条既有护栏（主路径 `:61-77`、回退 `:79-121`）均不被要求修改且保持通过；验收不再要求计数归零 | ✅ `App.tsx:395 / :978-1003`、`sidebar-open-page.test.tsx:18-32 / :61-121`、`open-page.ts:12-17 / :34-51`、`worker-orchestrator.ts:518+` 均已核实 |

**（c）建议**：**建议再跑一轮 `sw-plan-reviewer` 复审**。理由——本次修订触及 3 个 blocker 的语义边界（尤其 B9 从"仅 data:"改为"协议白名单"）与 4 处测试文件归属（新增 `chrome-adapter-incognito.test.ts`、T9 纳入 `url-utils.ts`、T17 移除测试文件、T9/T17 验收命令变更），且新增工作用 `Task`/`Commit` 文件清单与新引用行号，需要独立验证"红线是否真的解除"。复审时应重点核对：(1) T9 是否仍与任一既有测试冲突；(2) T2 的 quota 构造是否确能命中 `classifyWriteError` 而非 `setSyncWithRetry` 的本地回退；(3) T17 的"主路径 0 命中"grep 是否与 `:1138-1142` 的锁定标签逻辑冲突（该处属 T16 范围，需在 T17 登记中说明归属）。