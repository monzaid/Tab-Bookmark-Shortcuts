# Slot Switch Consistency & Strategy Model Redesign — Work Plan

> **计划名称**: slot-switch-consistency-plan
> **创建时间**: 2026-09-30 · **创建者**: sw-strategic-planner (Prometheus)
> **状态**: **Draft v6 (FINAL) — 待执行（FROZEN，进入执行）**。v6 在 v5 基础上落实**用户最终两项裁定**：**裁定 A（R1-A）：T1 完成判据改为「编译器驱动闭环」**（`typecheck` 0 error + `test:unit` ALL PASS，由 `tsc`/`vitest` 定义权威清单；手工适配清单**降格为「预期命中参考（非完备性要求）」**）；**裁定 B：第四轮复审 2 BLOCKER + 2 NIT 落地**（`pages.smoke.test.tsx:103-111` 显式纳入 T1 编译面；`settings.test.tsx:96/109/122` 显式登记；删除 `rule-delivery-real-dom.test.ts:329` / `sync-write-resilience.test.ts:133/174/189` 悬空引用；新增 `sync.matchSettings` 缺失兜底 `?? DEFAULT_MATCH_SETTINGS`）。**同时撤回 Rev 5-E / Rev 4-F 的「8/8 提交 typecheck 绿（已完成验证）」错误结论**（详见 Revision Log **Rev 6**）。**定稿轮：本文档自洽、可执行，不再迭代。**
> **上游设计（已获用户批准）**: `_context-output/designs/2026-09-30-slot-switch-consistency-design.md` + `-decisions.yaml`（D10/C4/A8=`SUPERSEDED`、RK1=`CLOSED_NOT_APPLICABLE`）+ 四层子文档
> **基线**: HEAD `d1f1f1d`（实测 `unit`=452/52 · `integration`=170/16 · `ui-smoke`=5/1 · `lint`=642 err/109 files · `eslint-disable`=3 · `src/ui` CJK=0）
> **迭代**: 单一整体迭代（1+2 bug 修复 + 3+4 功能重设计）

---

## Revision Log

### Rev 2 — 2026-09-30 · BLK-A / BLK-B 用户裁决落实（就地修订 v1 → v2）

> 触发：BLK-A（`↑/↓` 载荷）与 BLK-B（特权页契约）两项设计矛盾已由**用户裁决**，设计文档与决策清单**已同步回写**。本节记录计划侧的就地修订、受影响任务与自检结论。

| 裁决 | 内容 | 计划修订落点（任务 / 章节） |
|---|---|---|
| **BLK-A → A1** | `POSITION_CURRENT_PREV/NEXT` 载荷 = **`{ anchorTabId?: number }`**；侧边栏传 `lockedTabId ?? currentTabId`；background **不读**侧边栏内存态（Lock 仍不持久化）；**不新增持久化字段**；`anchorTabId` 失效（tab 已关闭）→ **降级当前活动页、不报错**（DT7） | **T1**（消息载荷形状 + RED 断言 `anchorTabId` 可选）；**T8**（Position 后端 `positionPrev/Next(anchorTabId?)` 消费锚点 + 失效降级 RED/QA）；**T12a**（`onClick` 传参 `state.lockedTabId ?? state.currentTabId` + Must NOT 禁止持久化）；Findings 表 / Must Have / Must NOT Have / Pre-Planning Review / Interview Summary |
| **BLK-B → B2** | **撤销** `SwitchOutcome.type === 'protected_blocked'`；`SwitchOutcome` **既有 4 变体完全不动**；特权页拦截属**打开/导航**路径，`openUrl` 返回 **既有 domain error** `{ success:false, errorCode:'PROTECTED_PAGE' }`（`types.ts:247`），恢复窗走**既有窗内报错**路径渲染 `This URL cannot be opened`；`applySwitchOutcome` 不参与该路径 | **T1**（撤销变体新增 + RED 反例断言无 `protected_blocked`）；**T6**（`openUrl` 返回 `PROTECTED_PAGE` + RED/QA）；**T9**（`applySwitchOutcome` 映射表移除该行 + 逐行断言 4 变体全覆盖）；**T12b**（窗内报错渲染 + RED/QA）；Findings 表 / 映射表引用行号 / Pre-Planning Review |

**同时确认（保留并强化）**：
- **GAP-C**（`ExportPayload.globalStrategy` / `ImportPreview.globalStrategy` 随迁移重塑，`types.ts:159-185`）—— 保留于 **T1/T7**，**要求 RED 证据**。**【Rev 4 更正】** 最终归属 = **T1**（T7 已 `ABSORBED`）；且**不加 `schemaVersion`**。
- **GAP-D**（`KNOWN_ACTIONS` 手写白名单，`worker-orchestrator.ts:43-84`，5 个新 action 必须显式登记）—— 保留于 **T1/T10**，**要求 RED 证据**（防「编译通过但运行被拒」）。
- **实测口径沿用**：`globalStrategy` 被 **31** 个测试文件引用、`strategy` 被 **37** 个引用（设计称「30」，以实测为准）—— RK1 受害面口径不变。

**引用漂移自检（读码核实）**：
- 因设计文档回写，行号漂移已校正：四格表 `132-137`（原 129-134）、迁移表 `139-147`（原 136-144）、副作用映射表 `149-159`（原 146-155）、`A8` 决策 `decisions.yaml:276-284`（原 274-282）。
- 新增/校正源码引用：`types.ts:247`（`PROTECTED_PAGE`，既有）、`types.ts:272-276`（`SwitchOutcome` 4 变体，不动）、`sidebar/App.tsx:924-928`+`:1149-1151`（Lock 内存态）。
- 硬约束**全部保持**：RK1 章节（含「迁移纯函数独立单测为**强制项**」+ F5）未改动；护栏（不新增依赖 / 不放宽 eslint / 不新增 eslint-disable / lint delta-0 / typecheck 0 / 三浏览器 build / WCAG 2.1 AA / `src/ui` CJK 0 / 强制独立复验 F3）未改动。

---

### Rev 3 — 2026-09-30 · sw-plan-reviewer 复审裁定 NOT OKAY（3 BLOCKER + 4 NIT）就地闭环

> ⚠️ **【Rev 4 已取代本节的 BLK-1 处置】** 本节 BLK-1 的「**方案 ①：T1 扩大为「契约 + 全量形状适配」（占位适配 + 后续替换）**」**已被 Rev 4 整体废除** —— 因用户裁定「**不做兼容**」⇒ 无占位期。**BLK-1 的最终处置见 Rev 4-B / 4-C / 4-E**（契约 + 派发骨架合并为一个原子任务）。本节其余内容（BLK-2 / BLK-3 / N1–N4）仍有效。

> 触发：`sw-plan-reviewer` 对 Draft v2 裁定 **NOT OKAY**，3 条 blocker（BLK-1 契约编译波面未闭合 / BLK-2 T3 与精确前缀断言冲突 / BLK-3 授权例外口径不一致）+ 4 条 NIT（N1 无效 RED / N2 私有断言途径 / N3 连带核验面不全 / N4 阶段性红口径）。**设计层无需改动**（3 条均为计划层缺陷）；本节记录计划侧就地修订、受影响任务与自检结论。修订只涉及**计划层**（范围 / 顺序 / 登记 / 口径），**不引入设计未授权的功能**，**4 变体冻结不增不减**。

**BLK-1（致命）—— T1 契约重塑的编译波面未闭合（选方案 ①）**：
- **实测确认**：删除 `SyncState.globalStrategy` 后，以下生产侧引用仍在 T1 范围外，落地即 `typecheck` 失败，而 T1 Acceptance 要求 `typecheck 0`、Commit 1 pre-commit 含 `npm run typecheck` → **T1 无法通过自身验收**（自相矛盾）。
- **裁决**：**选方案 ①** —— **T1 扩大为「契约 + 全量形状适配」**，把下列**生产侧消费者**的**机械适配**全部纳入 T1（`storage-repository.ts:77`（`createDefaultSyncState`）、`:175`（`migrateSyncState` 读）、`:617`（`setGlobalStrategy` 写）；`slot-service.ts:176`（有效策略读取**占位**，T8 领地）；`import-export-service.ts:55/103/140/199`（T7 领地）；`ui/import-preview/main.tsx:14`（构造 `ImportPreview`）；`ui/settings/App.tsx:138/145/156/166/176/205/1623/1771/1795/1796/1821-1826/1898`（T12c 领地）；`shared/types.ts:164/183`（`ExportPayload`/`ImportPreview`））→ 使**每个提交都保持 `typecheck` 绿**；后续任务（T7/T8/T12c）在这些占位上**替换为真实逻辑**。
- **理由**：硬约束要求「每个提交尽量保持绿」；方案 ② 需把 Commit 1 pre-commit 改为不含 `typecheck` 且全程标注阶段性红，与「typecheck 0」目标冲突且留下 T1→T9 的长期红区，违背 TDD 逐提交可验证精神。方案 ① 以「占位适配 + 后续替换」消除红区，代价是 T1 体量增大（见 T1 Files/Must NOT 扩充）。
- **边界纪律**：T1 **只做形状适配**，**不得越界实现 T7/T8/T12c 的业务逻辑**（见 T1 Must NOT do 新增条目）。落地于 **T1**（What to do / Files / Must NOT / References / Acceptance / Commit 1 pre-commit 说明）。

**BLK-2（硬冲突）—— T3 与既有精确前缀断言冲突且未登记**：
- **实测确认**：`tests/unit/shared/url-utils.test.ts:362-375` 的 `it('should have exactly the expected protected prefixes (no drift)')` 用 `toEqual` 精确断言 8 个前缀；`'file://'` 入 canonical（`scripts/gen-protected-prefixes.mjs:43-52`）并重跑后该 `toEqual` **必失败**。
- **修法**：T3 显式登记该文件为**同步更新点**（期望数组加入 `'file://'`，`toEqual` 结构**保留不放宽**），写入 T3 References / Must do / Acceptance / WHY；并说明这是 `file://` 入列的**确定副作用**（连带：`file://` 不可作 rule 改写目标，设计 A13 已确认）。落地于 **T3**。

**BLK-3（自相矛盾）—— 授权例外口径与任务声明不一致**：
- **实测确认**：`Must NOT Have` 的授权例外**仅枚举** `slot-service.test.ts:107/133`、`settings.test.tsx:96/109` 与 `globalStrategy/strategy` 夹具；但 **T6** 声明重写 `recovery-service.test.ts`（`:55-56` 等）、**T12b** 声明重写 `recovery-selector.test.tsx`、**T12a** 声明更新 `sidebar-open-page.test.tsx` —— **均不在例外清单内**。
- **实测确认（第二处）**：**T12b** 声明 `tests/ui-smoke/pages.smoke.test.tsx` 「不得破坏」，但该文件 `:104-111` 构造 `ImportPreview`（含 `globalStrategy:'B'`，随 GAP-C 必改），且 `:83-98` 的 `<RecoveryWindow>` 若新增 props 亦须同步 → 与契约变更直接冲突。
- **修法**：授权例外清单扩为**显式枚举 7 项**：① `slot-service.test.ts`、② `settings.test.tsx`、③ `recovery-service.test.ts`、④ `recovery-selector.test.tsx`、⑤ `sidebar-open-page.test.tsx`、⑥ `pages.smoke.test.tsx`（**仅限** import-preview 形状适配与恢复窗 props 同步）、⑦ 全部 `globalStrategy/strategy` 夹具适配；并明确 `pages.smoke` 的「不得破坏」**仅指恢复窗渲染语义**，而非冻结字面量。同步修正 `Must NOT Have` 与 F4 的核对口径。落地于 **Must NOT Have** / **F4** / **T12b**。

**NIT 一并修正**：
- **N1**：T1「断言源码不含 `protected_blocked`」在修改前即成立 → **不是有效 RED**，改述为**回归护栏**（明确标注其性质），T1 的有效 RED 依赖 known-actions 那条（`routeMessage({action:'SET_SWITCH_DIRECTION'})` 当前返回 `UNKNOWN_ACTION` → 必失败）。落地于 **T1**（Acceptance / QA）。
- **N2**：`isKnownAction` 未 `export`（`worker-orchestrator.ts:87`，`function isKnownAction` 无 `export`）→ T1/T10 的 QA 改为经 `routeMessage` 断言（已知 action 可路由 / 未知 action 返回 `UNKNOWN_ACTION`），沿用既有私有访问范式（`worker-orchestrator.test.ts:56` 的 `routeMessage` 断言）。落地于 **T1**（QA）/ **T10**（QA）。
- **N3**：T3 的连带核验面不全（只核 `rule-service.test.ts:454`，漏 `url-utils.test.ts:362-375`）→ 随 BLK-2 一并补齐（T3 References / Acceptance）。
- **N4**：把「`typecheck` 阶段性红」的口径写清 —— 因选 **方案 ①**，**无阶段性红**：T1 起每个提交 `typecheck` 均为绿；计划显式声明「本计划**不存在** commit 级 typecheck 红区」。落地于 TL;DR / Commit Strategy / Acceptance 口径。

**微偏校正**：`worker-orchestrator.ts`（switch-slot-x）实测区间 **230-260**（含 `:258` 的 `diagnostics.record` 与 `:259` 的 `return`）——原写 `230-257` 已校正为 **230-260**（Research Findings §1、T9 What/References、T11 References 对照区间 `:239-258` 保持不变）。

**BLK-1 扩展（Rev 3 实测补充 —— 复审未列举的同类消费者）**：`tsconfig.json` 的 `include` = `["src","tests","vite.config.ts","vitest.config.ts","scripts"]` → **`npm run typecheck` 亦编译 tests**。故**显式类型标注**的测试夹具/属性读取同样在 Commit 1 破坏 typecheck，已并入 T1 适配面：`tests/unit/shared/messages.test.ts:139/257`（`SyncState`）、`:174`（`RecoverySession`）、`tests/unit/ui/import-diagnostics.test.tsx:7`（`ImportPreview`）、`tests/integration/storage-repository.test.ts:22/96/30/100`、`tests/integration/worker-orchestrator.test.ts:30`、`tests/integration/import-export-service.test.ts:187/398`。**判定边界**：编译期报错的显式标注/属性读取 = 必改（T1）；未标注的 mock 字面量 = 运行期断言，由归属任务顺带更新（不改断言语义）。**未标注 mock 不破坏 typecheck**，故不影响「每提交绿」。

**引用漂移自检（Rev 3 全部读码核实）**：
- 新增/校正源码引用：`storage-repository.ts:74-81/171-179/615-620`（已实测）、`slot-service.ts:174-177`（有效策略读取）、`import-export-service.ts:55/103/140/199`（已实测）、`ui/import-preview/main.tsx:14`（已实测）、`ui/settings/App.tsx:145-218/1623/1771/1795-1796/1821-1836/1898`（已实测）、`shared/types.ts:159-185`（已实测）、`worker-orchestrator.ts:87-91`（`isKnownAction` 未 export，已实测）、`worker-orchestrator.ts:230-260`（已实测）、`url-utils.test.ts:362-375`（已实测）、`scripts/gen-protected-prefixes.mjs:43-52`（已实测）、`tests/ui-smoke/pages.smoke.test.tsx:83-98/104-111`（已实测）。
- 硬约束**全部保持**：RK1 章节（含「迁移纯函数独立单测为**强制项**」+ F5）未改动；护栏（不新增依赖 / 不放宽 eslint / 不新增 eslint-disable / lint delta-0 / typecheck 0 / 三浏览器 build / WCAG 2.1 AA / `src/ui` CJK 0 / 强制独立复验 F3）未改动；**4 变体冻结不增不减**（`SwitchOutcome`）未改动。

---

### Rev 4 — 2026-09-30 · 用户设计级裁定「不做兼容、不做迁移」→ 重排为 v4（BLK-1 残余 + N-1…N-4 闭环）

> 触发：第二轮定向复审判定 **BLK-1 仍 NOT OKAY**（BLK-2 / BLK-3 已 OKAY）。随后用户给出**设计级裁定**（已回写设计文档与 `decisions.yaml`），本节据此重排。**设计层已定，本 Rev 只做计划层重排**（范围 / 编号 / 顺序 / 登记 / 口径），**不引入设计未授权的功能**，**4 变体冻结不增不减**。

#### Rev 4-A · 裁定要点

| # | 裁定（2026-09-30，用户） | 计划层落地 |
|---|---|---|
| 1 | `SyncState` **不需要保留 `globalStrategy`**；`matchSettings` **直接取代** | T1 **删除** `globalStrategy`（不保留、不双写、不读旧值） |
| 2 | **删除 `schemaVersion`**（不做迁移 ⇒ 无版本锚点） | T1 **不新增** `schemaVersion`；v3 中所有 `schemaVersion` 表述作废 |
| 3 | 旧持久化数据**被忽略**，静默落到新默认 `exists + match + priority=tabId`；**不提示、不备份** | `migrateSyncState` 改为**仅填新形状默认值**（不读旧字段）；新增「旧形状 → 新默认」可断言用例 |
| 4 | 旧导出文件**不再可导入** | `generatePreview` 校验 `matchSettings` 形状合法，缺失 → `IMPORT_INVALID`（**不读旧 `globalStrategy`**） |
| 5 | **D10 / C4 / A8 = `SUPERSEDED`**；**RK1 = `CLOSED_NOT_APPLICABLE`** | 「⚠️ RK1」章节改写为**已关闭**；F5 更名「**契约与形状专项**」；迁移单测**不再是强制项** |
| 6 | **仍然生效**：`SwitchOutcome` **4 变体冻结**；`needs_recovery` 被 **4 处**锁定不得移除 | T1 / T9 / F5 口径不变（同 Rev 2 BLK-B / B2） |

> **A/B/C → 四格对照表**降级为**文档语义参考**（`design §3.1`），**不产生任何迁移代码、不读取任何旧值**。

#### Rev 4-B · 结构性后果：契约 + 派发骨架合并为**一个原子任务**

- **无兼容层 ⇒ 不存在「占位适配期」**。v3 的「先占位、后替换」（方案 ①）在「不做兼容」下**不再成立**：占位本身即兼容层。
- **`slot-service` 的 A/B/C 分支比较必须与类型同一次改写**（team-lead 实测复现证据）：
  - `TS2367: This comparison appears to be unintentional because the types 'MatchRuleSettings' and 'string' have no overlap`（`slot-service.ts:186` `=== 'A'` / `:204` `=== 'B'`）
  - `TS2322: Type 'string' is not assignable to type 'MatchRuleSettings'`（`slot-service.ts:69` 的 `strategy ?? 'inherit'`；`worker-orchestrator.ts:484/493` 的 `request.payload.strategy`）
- **合并结果**：原 T1（契约）+ 原 T2（原语）+ 原 T4（resolver）+ 原 T8 的「策略分支改写」+ 原 T7（导入/导出形状与语义）+ 原 T12c（设置页策略区新语义 UI）→ **新 T1（编号不变、**内容扩容**）**。
- **原 T8 缩减**为「**Position 后端 + 方向感知 + 其余编排**」；**原 T5（迁移）整体删除**（无迁移）。
- **编号稳定性策略**：**T1 扩容吸收 T2 / T4 / T5 / T7 / T12c**；T3 / T6 / T8 / T9 / T10 / T11 / T12a / T12b **编号与顺序不变**（避免全文行号与交叉引用漂移）。

**任务映射表（旧 → 新）**：

| 旧编号 | 新归属 | 处置 |
|---|---|---|
| T1 契约重塑 | **T1** | 保留并扩容（删 `globalStrategy`/`schemaVersion`；新默认 `exists+match+tabId`） |
| T2 共享纯原语 | **T1** | `ABSORBED`（原语与 resolver 同提交） |
| T4 4 resolver + `resolve-switch.ts` | **T1** | `ABSORBED`（`slot-service` 必须同提交采用，否则 TS2367） |
| T5 迁移纯函数 + 读时回写 | — | **`DELETED`**（裁定 2/3） |
| T7 import-export 导入映射 | **T1** | `ABSORBED`（`ImportPreview` 形状属编译面；语义 = 拒绝旧导出文件） |
| T12c settings 三旋钮 | **T1** | `ABSORBED`（BLK-1 残余 #4 明示属合并任务正当范围） |
| T8 slot-service 采用 resolver + Position + 方向 | **T8（缩减）** | 策略分支改写并入 T1；T8 留「Position 后端 + 方向感知 + 编排」 |
| T3 `file://` 前缀 | T3 | 不变（**改为独立提交 Commit 2**，与 T1 无耦合） |
| T6 / T9 / T10 / T11 / T12a / T12b | 同名 | 不变（仅口径微调） |

**任务数：14 → 9 实现/诊断任务**（T1 / T3 / T6 / T8 / T9 / T10 / T11 / T12a / T12b）+ F1–F5。

**Wave 重排**：

```
Wave 1: T1（原子核心：契约 + 原语 + resolver + slot-service 分支 + 导入导出 + 设置页策略区）
        T3（file:// 入 canonical —— 与 T1 无文件重叠，真正并行）
Wave 2: T6（recovery-service.ts）
Wave 3: T8（slot-service.ts —— 依赖 T1）
        T12b（recovery UI —— 依赖 T6）
Wave 4: T9（worker-orchestrator.ts 编排；依赖 T1、T6、T8）
Wave 5: T10（合流）→ T11（诊断）—— 与 T9 同文件串行
Wave 6: T12a（sidebar/App.tsx；依赖 T9/T10/T11）
FINAL:  F1–F5 并行
```

#### Rev 4-C · BLK-1 残余逐条闭环（含**行号精度校正**）

| # | 遗漏点（用户列出） | 读码核实 | 闭环落点（任务 + 行号区间） |
|---|---|---|---|
| 1 | `worker-orchestrator.ts:468-471` | ✅ 成立：`:469` 取 version、`:470` `repo.setGlobalStrategy(request.payload.strategy, version)` | **T1**：路由体改 `request.payload.matchSettings` → `repo.setMatchSettings(...)`；`storage-repository.ts:615-620` 改名 |
| 2 | `slot-service.ts:55/69` + `messages.ts:49` + `worker-orchestrator.ts:352` | ✅ 成立：`:55` 形参、`:69` 字面量、`messages.ts:49` payload、`worker-orchestrator.ts:348-353` 透传 | **T1**：`:51-56` 签名 / `:66-75` 字面量 / `messages.ts:41-51` / `worker-orchestrator.ts:346-354` 同改 |
| 3 | `slot-service.ts:185/204/236` | ⚠️ **精度校正**：`:185`、`:236` 是**注释**；真实比较在 **`:186`**（`=== 'A'`）与 **`:204`**（`=== 'B'`）；`:237` 起为「全搜 + 回退」第三分支 | **T1**：`:174-177` 有效策略读取 + `:186` / `:204` 分支 + `:237-272` 回退路径**一并改写为四格 resolver 调用**（直改新语义） |
| 4 | `settings/App.tsx:156/166/176` + `:1795-1796` | ✅ 成立：`:156/166/176` 三个 `checked={globalStrategy === 'A'\|'B'\|'C'}`；`:1795` 类型标注、`:1796` `setGlobalStrategy(sync.globalStrategy)` | **T1**：`StrategySection`（`:137-218`）改三旋钮 + 方向 + 全局 autoBind + 每槽一行；连带 `:16` import、`:1771` `useState`、`:1795-1796` `loadState`、`:1821-1836` `handleGlobalChange`、`:1838-1852` `handleSlotChange`、`:1896-1904` props |
| 5 | `tests/integration/storage-repository.test.ts:74/126/129/139/142` | ✅ 成立：5 处 `repo.setGlobalStrategy('A'\|'C', n)` | **T1**：改 `repo.setMatchSettings(<MatchRuleSettings>, n)`；`:22` / `:96` 读取同改；`:84` / `:342` / `:380` / `:417` 未标注 storage 字面量顺带更新 |

> **要义（用户原话）**：删掉兼容层后 #3 / #4 **不再是「占位死结」**，而是必须在 T1 内**直接改为新语义**。

#### Rev 4-D · 复审 N-1…N-4 + BLK-3 NIT 闭环

- **N-1（「占位 vs 替换」边界不可执行）**：**已因合并而消失** —— Rev 4-B 的原子任务**不含任何占位**，v3 中「T1 只做形状占位、后续替换」的判定口径（T1 Must NOT 末条 / F4 的越界核对）**整体废除**。计划中已无「占位适配期」概念，复审**不应再提**。
- **N-2（`import-export-service` 占位语义含糊）**：**已消解** —— 直改 `matchSettings`；**不读旧 `globalStrategy`**；旧导出文件**不参与导入**（缺失/非法 → `IMPORT_INVALID`）。落点：**T1**（`import-export-service.ts:41-57` / `:101-145` / `:174-202`）。
- **N-3（Dependency Matrix 与 Wave 图 / T6 卡片不一致）**：已修正 —— Wave 图、T6 卡片、Dependency Matrix **三处统一 `T6: deps T1, T3`**。
- **N-4（Commit 1 pre-commit 不含 `test:integration`）**：已追加 —— **Commit 1 pre-commit = `npm run typecheck && npm run test:unit && npm run test:integration`**（`test:integration` 为**新增项**，因 T1 改 `tests/integration/*`）；**Commit 2（T3）pre-commit 含 `test:unit`**（`url-utils.test.ts`）。
- **BLK-3 NIT（`pages.smoke.test.tsx:83-98` 精度）**：已修正 —— 该用例**只断言 `getAllByRole('button').length > 0`，无标题断言**；**`Tab Not Found` 标题的实际锁定点是 `tests/unit/ui/recovery-selector.test.tsx`（经 `@ui/recovery/App`）**，`pages.smoke` 仅覆盖「至少 1 个 button」。v4 中所有「恢复窗渲染语义」表述按此精度重写。

#### Rev 4-E · **第三轮自查：规划者独立读码发现的**新增遗漏（v3 与复审清单均未列）

| # | 新增遗漏点（实测） | 性质 | 归属 |
|---|---|---|---|
| **X1** | `src/ui/shared/message-client.ts:245-247`（`setGlobalStrategy(strategy: string)` → `send('SET_GLOBAL_STRATEGY', { strategy }, true)`）与 `:249-251`（`setSlotStrategy`）：**v3 全文未登记该文件** → payload 改形状后成**悬空引用** | 悬空 + 潜在编译面 | **T1** |
| **X2** | `tests/unit/ui/message-client.test.ts:56 / 88`（`client.setGlobalStrategy('C' / 'A')`）、`:62`（断言 `payload: { strategy: 'C' }`）、`:193`（`sendRaw('SET_GLOBAL_STRATEGY', { strategy: 'A' }, 3)`） | 若 X1 收紧签名 → **TS2345**；即便保留 `string`，断言亦随语义必改 | **T1** |
| **X3** | `src/shared/types.ts:15` `DEFAULT_STRATEGY: MatchStrategy = 'B'` 及消费者 `storage-repository.ts:26/77/175`、`import-export-service.ts:23/103`；测试侧 `tests/unit/shared/messages.test.ts:19/199-200`（`import { DEFAULT_STRATEGY }` + `toBe('B')`） | 新默认 = 三旋钮 + `priority=tabId` ⇒ `DEFAULT_STRATEGY='B'` 语义失效；删除后测试侧**编译 + 断言必红** | **T1**：删除 `DEFAULT_STRATEGY`，新增 `DEFAULT_MATCH_SETTINGS` |
| **X4** | `tests/integration/slot-service.test.ts:135`（`service.saveSlot(1, 0, undefined, 'C')`）**第 4 实参为显式字面量**，而签名在 T1 内变更 → **TS2345** | 编译面（v3 仅作为「行为锚点」授权，**未登记为编译点**） | **T1** |
| **X5** | `tests/unit/shared/messages.test.ts:28-69` 的 `handleUiAction` 是**穷尽 switch + `assertNever`**（`:24-26`）：新增 6 个 action 后 union 变大而 switch 未补 case → `assertNever(request)` 参数非 `never` → **TS2345/TS2349 级编译错误** | 编译面（v3 未登记） | **T1**：补 6 个 `case` |
| **X6** | `tests/unit/ui/import-diagnostics.test.tsx:15`（`globalStrategy: 'B'`，`ImportPreview` **显式标注**）；`tests/ui-smoke/pages.smoke.test.tsx:103-111`（**对象字面量直传具体类型 prop** ⇒ **编译面**）；`src/ui/import-preview/main.tsx:14`（**显式** `preview={{…globalStrategy:'B'…}}`） | 三者均为 `ImportPreview` 形状面；**【Rev 6 · BLOCKER-1 更正】** `pages.smoke` `:103-111` **不是「未标注运行期」，而是编译面（TS2353 / TS2741）** | **T1**（全部三处；`pages.smoke` 仅 `:103-111`）；**`pages.smoke:83-98` 的恢复窗 props 归 T12b** |
| **X7** | `src/background/import-export-service.ts:89-91`（`data.version !== 1` 门槛）与 `:103`（`(data.globalStrategy as MatchStrategy) ?? DEFAULT_STRATEGY`）：裁定 4 后**必须改为校验 `matchSettings`**，否则 `IMPORT_INVALID` 分支永不触发 | 语义缺口 | **T1** |
| **X8** | `src/ui/settings/App.tsx:1623`（`<li>Global Strategy: {preview.globalStrategy}</li>`）—— v3 已列 `:1623`，但**未说明改后文案**；`preview.globalStrategy` 删除后须改 `preview.matchSettings` 或移除该行 | 编译面 + 文案 | **T1**（与 DT6/DT8 文案一致） |
| **X9** | `tests/integration/full-suite.test.ts:201-206`（`adapter.state.syncStorage['syncState'] = { configVersion: 99, globalStrategy: 'C', … }`，实测 `:203`）**未标注**字面量；`tests/integration/storage-repository.test.ts:340/378/415`（实测 `:342 / :380 / :417` 为 `globalStrategy`）同类 | **未标注 ⇒ 不破坏 typecheck**；但属**语义卫生**（旧值不再被读取，用例仍绿但已无意义） | **T1 顺带**（不改断言语义） |
| ~~**X9-悬空**~~ | ⚠️ **【Rev 6-B · NIT-3 已删除】** 原列 `tests/integration/rule-delivery-real-dom.test.ts:329`、`tests/unit/background/sync-write-resilience.test.ts:133/174/189` —— **实测 `rg 'globalStrategy'` 0 命中**（前者 `:329-331` 为 `rules[].favicon.value` 断言；后者 `:133/174/189` 同为 favicon 断言）⇒ **悬空引用，已从 X9 移除** | ~~同类~~ **（不成立，勿采信）** | **删除，不再归属任何任务** |
| **X10** | `src/background/slot-service.ts:665-681`（`createRecoverySession`）构造 session 时**未含** `windowId`/`candidateCursor` —— v3 T6 已提及补 `windowId`，但 `RecoverySession` 若新增**必需**字段，则该处 + `tests/unit/shared/messages.test.ts:174-182` + `tests/integration/storage-repository.test.ts:150-168` + `tests/integration/recovery-service.test.ts:24-36` **均需补字段**（后者为显式标注 → **编译面**） | 编译面（测试侧 3 处显式标注） | **T6** |

> **X 系列（X1–X10）已全部纳入 T1 / T6 / T12b 的 Files 与 References**，**不产生新的悬空引用**。

**已核实「不构成遗漏」的链路（读码确认，列此以防第三轮误报）**：

| 链路 | 核实结论 |
|---|---|
| `worker-orchestrator.ts:496-525`（`UPDATE_SLOT_UI_MARKER`） | `saveSlot({ ...slot, uiMarker, updatedAt })` —— **不触碰 `strategy`**；`strategy` 从 `slot` 展布继承 → 契约变更后**无需改动**（无 TS 错误） |
| `worker-orchestrator.ts:528-554`（`UPDATE_SLOT_URL`） | 只改 `urlMatch` / `updatedAt` → **无需改动** |
| `slot-service.ts:105-129`（`saveSlotFromData`，`CONFLICT_OVERWRITE` 唯一入口） | 字面量 `strategy: 'inherit'` —— 新类型下 `'inherit'` **仍合法** → **无需改动** |
| `slot-service.ts:539-543`（`captureUndoSnapshot`） | `{ ...existingSlot, urlMatch, uiMarker }` 展布 → **无需改动** |
| `slot-service.ts:340-442`（`nextMatchForSlot` / `prevMatchForSlot`） | 只用 `slot.urlMatch`，**不读 `strategy`** → **无需改动**（仅 T8 的方向感知影响 `nextMatch`） |
| `ui/shared/message-client.ts:205-206`（`saveSlot`） | 未传 `strategy`（可选形参省略）→ **无需改动** |
| `settings/App.tsx:67`（`NAV_ITEMS` label `Global Strategy`） | **保持不变**（T1 Must NOT：不改 `NAV_ITEMS`）→ 故意不动，**非遗漏** |

#### Rev 4-F · **「每个提交 typecheck 绿」的破例点核查（⚠️ 原结论「无破例」及表中 ✅ 已由 Rev 6-A-5 撤回/降格，见下方更正框）**

> 用户要求：**明确指出是否存在「每个提交 typecheck 绿」的破例点、是哪个提交、为什么、以及是否有更优解**。

| 提交 | 触碰文件 | `typecheck` 状态 | 说明 |
|---|---|---|---|
| **Commit 1（T1）** | `types.ts` / `messages.ts` / `switch/**` / `storage-repository.ts` / `slot-service.ts` / `import-export-service.ts` / `ui/import-preview/main.tsx` / `ui/shared/message-client.ts` / `ui/settings/App.tsx` / `worker-orchestrator.ts` + **10 个测试文件**（含 **Rev 6 新增：`tests/unit/ui/settings.test.tsx`、`tests/ui-smoke/pages.smoke.test.tsx`（仅 `:103-111`）**） | ✅ 绿（**由 T1 闭环判据保证**：`typecheck` 0 error + `test:unit` ALL PASS） | **关键**：`slot-service.ts` 的 A/B/C 分支（`:186` / `:204`）与 `messages.ts:49` / `slot-service.ts:69` / `worker-orchestrator.ts:484/493` 的形状**必须在同一提交内一起改**（否则 `TS2367` / `TS2322`）→ 由「原子任务合并」保证。**【Rev 6 · A-5】** 原写「8 个测试文件」且判「✅ 绿」为**人工穷举口径**；**已由第四轮复审实测证否**（漏 `pages.smoke.test.tsx:103-111` / `settings.test.tsx:96/109/122`）⇒ **改判据为闭环式**。 |
| **Commit 2（T3）** | `scripts/` + 2 生成物 + `url-utils.test.ts` + `protected-prefixes.test.ts` | ✅ **绿** | 纯数据 + 期望数组同步，与类型无关。 |
| **Commit 3（T6）** | `recovery-service.ts` + `types.ts`（`RecoverySession`）+ `slot-service.ts`（`createRecoverySession`）+ 3 测试文件（**X10**） | ✅ **绿** | `RecoverySession` 新增字段 ⇒ 3 处测试侧显式夹具**同提交补字段**（否则 `TS2739`/`TS2322`）。 |
| **Commit 4（T12b）** | `recovery/*` + `recovery-selector.test.tsx` + `recovery-window.test.tsx` + `pages.smoke.test.tsx`（**仅 `:83-98` props**） | ✅ 绿（**由 pre-commit 保证**） | **【Rev 6 · BLOCKER-1 更正】** `pages.smoke` 的 `:103-111` `ImportPreview` 字面量**已改由 Commit 1（T1）适配**（编译面）；**Commit 4 只改 `:83-98` 的 `<RecoveryWindow>` props**。 |
| **Commit 5（T8）** | `slot-service.ts` + 2 测试文件 | ✅ **绿** | 新增 `positionPrev/Next` 不破坏既有签名。 |
| **Commit 6（T9）** | `worker-orchestrator.ts` + 1 测试文件 | ✅ **绿** | `applySwitchOutcome` 为新增函数；新 action 已在 Commit 1 登记 `KNOWN_ACTIONS`。 |
| **Commit 7（T10+T11）** | `worker-orchestrator.ts` + 3 测试文件 | ✅ **绿** | 合流为内部实现；`DiagnosticEntry` 形状不变。 |
| **Commit 8（T12a）** | `sidebar/App.tsx` + 2 测试文件 | ✅ **绿** | 新按钮 + `sendMessage` 调用（`sendMessage(action, payload?)` 为 `unknown` 透传，**不参与类型检查**）。 |

**结论（⚠️ 已被 Rev 6-A-5 撤回，见下方更正框）**：~~**8/8 提交 `typecheck` 绿，无破例点**~~ —— **该断言不再作为「已实测」事实陈述**。

> ⚠️ **【Rev 6 · A-5 撤回与降格（定稿口径）】** 上表与上句**不再是「已实测通过」的事实陈述**，**降格为「预期命中参考（非完备性要求）」**：
> - **Commit 1 的绿**由 **T1 闭环（Rev 6-A-1）保证** —— 即 `npm run typecheck` → 0 error 且 `npm run test:unit` ALL PASS，**完备性由 `tsc` / `vitest` 定义**，**不由本表定义**。**第四轮复审已实测反例**：`pages.smoke.test.tsx:103-111` 在本表口径下被漏判，说明「人工穷举」不足以作为判据。
> - **其余提交（Commit 2–8）的绿**由**各自 pre-commit**保证（见 Commit Strategy）。
> - 本表**不得**被引用为「8/8 已验证」；复审**不得**再以「清单是否完备」判 `NOT OKAY`（完备性判据已上移至编译器 / 测试运行器）。
> **唯一「潜在破例」的候选 = Commit 1**，其规避手段就是**「契约 + 派发骨架合并为一个原子任务」**（Rev 4-B）—— 这也正是 user 结构性裁定的直接收益。**更优解不存在**：任何「拆分提交」都会重新引入 `TS2367` / `TS2322`（实测），或需在提交间留下阶段性红区（与硬约束冲突）。
> **次要澄清**：`sendMessage` / `sendRaw` 的 payload 形参为 `unknown`（`message-client.ts:132/149`；`settings/App.tsx:51`、`sidebar/App.tsx:95`、`recovery/main.tsx:12`）⇒ **未标注字面量不进入类型检查**（**X6 / X9** 的归类依据），故这些调用点在契约变更后**不会**产生编译错误，只需语义同步（**不构成破例**）。**例外**：`pages.smoke.test.tsx:103-111` 是**对象字面量直传具体类型 prop**（非 `unknown` 通道）⇒ **进入类型检查**，属**编译面**（Rev 6-B BLOCKER-1）。

---

### Rev 5 — 2026-09-30 · 用户裁定 **D17**（Q1-A）落实 = 彻底删除 `MatchStrategy` / `DEFAULT_STRATEGY`（v4 → v5）

> 触发：用户**新裁定**（2026-09-30 · Q1-A，**已回写设计** = 主设计 `§2.1` 注释 + `decisions.yaml:139-147` **D17**）：**彻底删除** `type MatchStrategy = 'A' | 'B' | 'C'` 与 `const DEFAULT_STRATEGY`（**不留死类型 / 死常量**）；新增 **`DEFAULT_MATCH_SETTINGS`**（`{ tabIdMode:'exists', ruleCheckMode:'match', priority:'tabId' }`）**取代**；**A/B/C → 新四格**的对应关系**仅保留为主设计 §3.1 的 markdown 对照表**（`design:146-154`），**不进入代码或类型**。本 Rev 只做**计划层就地修订**（T1 落点 / 静态断言 / 执行 Profile / 失败预案 / 复核），**设计层已定**，**不引入设计未授权的功能**，**护栏全部保持**，**`SwitchOutcome` 4 变体冻结不增不减**。

> **与 v4 的关系**：v4 原 `Must NOT Have` 允许「`MatchStrategy` 类型定义**可保留**（仅供文档语义对照）」。**D17 收紧了该口径** —— **类型定义亦须删除**（不得留死类型）。故 v4 中所有「类型可保留」的表述在 v5 **整体作废**。

#### Rev 5-A · D17 裁定要点与 v4 口径变化

| # | D17 要求（2026-09-30 · Q1-A） | v5 计划层落地 |
|---|---|---|
| 1 | **彻底删除** `type MatchStrategy = 'A' \| 'B' \| 'C'`（`types.ts:8`） | T1 **删除**该类型定义（**不留死类型**） |
| 2 | **彻底删除** `const DEFAULT_STRATEGY: MatchStrategy = 'B'`（`types.ts:15`） | T1 **删除**该常量（**不留死常量**） |
| 3 | 新增 **`DEFAULT_MATCH_SETTINGS`**（`{ tabIdMode:'exists', ruleCheckMode:'match', priority:'tabId' }`）**取代** | T1 **新增** `export const DEFAULT_MATCH_SETTINGS: MatchRuleSettings`（= 新默认，D9） |
| 4 | **A/B/C → 新四格**对照**仅保留为主设计 §3.1 markdown 表** | **不进入代码或类型**；计划/实现**均不得**以 `MatchStrategy`、`'A'\|'B'\|'C'` 字面量、映射表承载该对照（对照表引用 = `design:146-154`，仅文档） |

> **D17 替代方案（已被用户否决，记录备查）**：`[RECOMMENDED-B, REJECTED BY USER]`「保留 `MatchStrategy` 类型供文档语义对照」——否决理由：**会成为无消费者的死类型**（`decisions.yaml:144`）。**故 v5 不得再提「类型可保留」。**

#### Rev 5-B · 全量引用点检索（`rg 'MatchStrategy|DEFAULT_STRATEGY'` 读码核实；**含 `src` + `tests` 全部 = 7 文件 / 32 引用行**）

> **检索范围**：`src/**` + `tests/**`（**排除** `_context-output/{plans,designs}` 文档面）。**结论**：`src` + `tests` 内 `MatchStrategy` / `DEFAULT_STRATEGY` 共 **7 个去重文件 / 32 个去重引用行**，**全部落在已登记的 T1 面内**（v4 的 X3 / X1 / BLK-1 残余 #2 已覆盖其中一部分；本表为**合并去重后的完整清单**，并新增 v4 未逐行列出的 `settings/App.tsx` 8 处与 `messages.ts`/`types.ts`/`slot-service.ts` 的 import 行）。
>
> **计数口径（实测，PowerShell `Select-String` 基线）**：`MatchStrategy` = **25 行命中**（6 文件：`types.ts`/`messages.ts`/`storage-repository.ts`/`slot-service.ts`/`import-export-service.ts`/`settings/App.tsx`）；`DEFAULT_STRATEGY` = **9 行命中**（4 文件：`types.ts`/`storage-repository.ts`/`import-export-service.ts`/`tests/unit/shared/messages.test.ts`）；**token 行合计 34，去重引用行 = 32**（`types.ts:15` 与 `import-export-service.ts:103` 各同行含**两个** token）。**文件并集 = 7**。静态断言以**行命中数归 0** 为准。

| # | 文件 | 行号 | 形态 | 处置（均归 **T1**） |
|---|---|---|---|---|
| 1 | `src/shared/types.ts` | **`:8`** | `export type MatchStrategy = 'A' \| 'B' \| 'C';` | **删除**（D17 #1） |
| 2 | `src/shared/types.ts` | **`:15`** | `export const DEFAULT_STRATEGY: MatchStrategy = 'B';` | **删除**（D17 #2） |
| 3 | `src/shared/types.ts` | **`:54`** | `SlotDefinition.strategy: MatchStrategy \| 'inherit'` | 改 `'inherit' \| MatchRuleSettings` |
| 4 | `src/shared/types.ts` | **`:164`** | `ExportPayload.globalStrategy: MatchStrategy` | 改 `matchSettings: MatchRuleSettings`（GAP-C） |
| 5 | `src/shared/types.ts` | **`:183`** | `ImportPreview.globalStrategy: MatchStrategy` | 改 `matchSettings: MatchRuleSettings`（GAP-C） |
| 6 | `src/shared/types.ts` | **`:191`** | `SyncState.globalStrategy: MatchStrategy` | 删 `globalStrategy`，新增 `matchSettings`（裁定 1） |
| 7 | `src/shared/messages.ts` | **`:9`** | `import { MatchStrategy }` | 改 import `MatchRuleSettings` |
| 8 | `src/shared/messages.ts` | **`:49`** | `SaveSlotRequest.payload.strategy?: MatchStrategy \| 'inherit'` | 改 `'inherit' \| MatchRuleSettings`（BLK-1 残余 #2） |
| 9 | `src/shared/messages.ts` | **`:151`** | `SetGlobalStrategyRequest.payload: { strategy: MatchStrategy }` | 改 `{ matchSettings: MatchRuleSettings }` |
| 10 | `src/shared/messages.ts` | **`:156`** | `SetSlotStrategyRequest.payload.strategy: MatchStrategy \| 'inherit'` | 改 `'inherit' \| MatchRuleSettings` |
| 11 | `src/background/import-export-service.ts` | **`:17`** | `import { …, MatchStrategy }` | 删除该 import 成员 |
| 12 | `src/background/import-export-service.ts` | **`:23`** | `import { DEFAULT_STRATEGY }` | 改 `DEFAULT_MATCH_SETTINGS` |
| 13 | `src/background/import-export-service.ts` | **`:103`** | `(data.globalStrategy as MatchStrategy) ?? DEFAULT_STRATEGY` | **删整行**，改为校验 `matchSettings`（X7；裁定 4） |
| 14 | `src/background/storage-repository.ts` | **`:18`** | `import { …, MatchStrategy }` | 删除该 import 成员 |
| 15 | `src/background/storage-repository.ts` | **`:26`** | `import { DEFAULT_STRATEGY }` | 改 `DEFAULT_MATCH_SETTINGS` |
| 16 | `src/background/storage-repository.ts` | **`:77`** | `globalStrategy: DEFAULT_STRATEGY`（`createDefaultSyncState`） | 改 `matchSettings: DEFAULT_MATCH_SETTINGS` |
| 17 | `src/background/storage-repository.ts` | **`:175`** | `globalStrategy: state.globalStrategy ?? DEFAULT_STRATEGY`（`migrateSyncState`） | 改 `matchSettings: DEFAULT_MATCH_SETTINGS`（**不读旧字段**，裁定 3） |
| 18 | `src/background/storage-repository.ts` | **`:615`** | `async setGlobalStrategy(strategy: MatchStrategy, …)` | 改名 `setMatchSettings(settings: MatchRuleSettings, …)`（BLK-1 残余 #1） |
| 19 | `src/background/slot-service.ts` | **`:19`** | `import { …, MatchStrategy }` | 删除该 import 成员 |
| 20 | `src/background/slot-service.ts` | **`:55`** | `saveSlot(…, strategy?: MatchStrategy \| 'inherit')` | 改 `'inherit' \| MatchRuleSettings`（X4 编译面） |
| 21 | `src/ui/settings/App.tsx` | **`:16`** | `import type { MatchStrategy, … }` | 改 import `MatchRuleSettings` |
| 22 | `src/ui/settings/App.tsx` | **`:138`** | `StrategySectionProps.globalStrategy: MatchStrategy` | 改 `matchSettings: MatchRuleSettings` |
| 23 | `src/ui/settings/App.tsx` | **`:141`** | `onGlobalChange: (strategy: MatchStrategy) => void` | 改 `(settings: MatchRuleSettings) => void` |
| 24 | `src/ui/settings/App.tsx` | **`:142`** | `onSlotChange: (slotId, strategy: MatchStrategy \| 'inherit')` | 改 `'inherit' \| MatchRuleSettings` |
| 25 | `src/ui/settings/App.tsx` | **`:202`** | `onSlotChange(slotId, e.target.value as MatchStrategy \| 'inherit')` | 改 `as 'inherit' \| MatchRuleSettings`（新 UI 下随三旋钮重写） |
| 26 | `src/ui/settings/App.tsx` | **`:1771`** | `useState<MatchStrategy>('B')` | 改 `useState<MatchRuleSettings>(DEFAULT_MATCH_SETTINGS)` |
| 27 | `src/ui/settings/App.tsx` | **`:1795`** | `as { globalStrategy: MatchStrategy; … }` | 改 `as { matchSettings: MatchRuleSettings; … }`（BLK-1 残余 #4） |
| 28 | `src/ui/settings/App.tsx` | **`:1821`** | `handleGlobalChange = (strategy: MatchStrategy)` | 改 `(settings: MatchRuleSettings)` |
| 29 | `src/ui/settings/App.tsx` | **`:1838`** | `handleSlotChange = (slotId, strategy: MatchStrategy \| 'inherit')` | 改 `'inherit' \| MatchRuleSettings` |
| 30 | `tests/unit/shared/messages.test.ts` | **`:19`** | `import { DEFAULT_STRATEGY }` | 改 `DEFAULT_MATCH_SETTINGS`（X3） |
| 31 | `tests/unit/shared/messages.test.ts` | **`:199`** | `it('should have DEFAULT_STRATEGY as B', …)` | 改述为 `DEFAULT_MATCH_SETTINGS` 断言（X3） |
| 32 | `tests/unit/shared/messages.test.ts` | **`:200`** | `expect(DEFAULT_STRATEGY).toBe('B')` | 改 `expect(DEFAULT_MATCH_SETTINGS).toEqual({ tabIdMode:'exists', ruleCheckMode:'match', priority:'tabId' })`（X3） |

> **⚠️ 关键区别（防误判）**：**`src/ui/shared/message-client.ts:245-251`（**X1**）与 `settings/App.tsx` 的 `sendMessage('SET_GLOBAL_STRATEGY', …)` 调用点** **不含 `MatchStrategy` 字面量**（其形参为 `string` / payload 为 `unknown`）⇒ **它们不会成为 `rg 'MatchStrategy'` 的命中点**，**但仍是 T1 必须改的契约形状点**（payload `{ strategy }` → `{ matchSettings }` 语义同步，见 X1 / X2）。**因此：D17 的「删除死类型」与 v4 的「payload 形状重塑」是两件事**，T1 须同时满足：**① `rg 'MatchStrategy|DEFAULT_STRATEGY' src tests` → 0 命中**（D17）；**② `message-client.ts` 等 payload 形状已换新**（X1/X2，不依赖类型名命中）。

> **测试侧「未标注字面量」（X9 类）**：**不含类型名 ⇒ 不在本表 32 处内**，但含旧字段 `globalStrategy` 字面量 → **T1 顺带更新**（不改断言语义；不破坏 typecheck）。
> ⚠️ **【Rev 6-B · NIT-3 更正】** X9 的**实测范围**只含：`tests/integration/full-suite.test.ts:201-206`（`:203`）、`tests/integration/storage-repository.test.ts:340/378/415`（`:342 / :380 / :417`）。**原列的 `tests/integration/rule-delivery-real-dom.test.ts:329`、`tests/unit/background/sync-write-resilience.test.ts:133/174/189` 实测不含 `globalStrategy`（`rg` 0 命中）⇒ 悬空引用，已删除、不归属任何任务。**

> **文档面（**不删**，仅对照）**：`_context-output/designs/2026-09-30-slot-switch-consistency-design.md:81-84`（注释）+ `:146-154`（**§3.1 对照表，D17 指定的唯一保留载体**）、`decisions.yaml:139-147`（D17 决策记录）。**`rg` 静态断言仅覆盖 `src tests`**，**不要求**文档面归零（D17 明确 A/B/C→四格对照**仅保留为 §3.1 markdown 表**）。

#### Rev 5-C · 对 v4 的计划层修订（逐项落点）

1. **`Must NOT Have (Guardrails)` 口径修订（作废 v4「类型可保留」）**：
   - v4 `Must NOT Have` 第 344 条原文「禁止**保留** `DEFAULT_STRATEGY` … 或任何 `MatchStrategy`（`'A'|'B'|'C'`）作为**持久化/契约**取值；**`MatchStrategy` 类型定义可保留**（仅供文档语义对照）」→ **v5 改为**：「禁止保留 `DEFAULT_STRATEGY` **或** `MatchStrategy` **类型定义 / 常量本身**（**不留死类型 / 死常量**，D17）；禁止 `'A'|'B'|'C'` 字面量出现在 `src`/`tests` 任一位置；A/B/C→四格对照**仅允许存在于主设计 §3.1 markdown 表**」。
   - v4 第 334 条「禁止改动 A/B/C 与三旋钮之外的策略语义（**如新增 `MatchStrategy` 变体**）」→ **v5 保留**（措辞改为「**不得以任何形式重新引入 `MatchStrategy` 类型/变体**」）。
   - v4 T1 `What to do` 第 506 条「`MatchStrategy`（`:8`）类型定义**可保留**但仅供文档语义对照」→ **v5 改为**「**删除** `MatchStrategy`（`:8`）类型定义与 `DEFAULT_STRATEGY`（`:15`）常量」，并在 T1 `Must NOT do` 第 564 条同步收紧。
2. **T1 `Acceptance` 静态断言（新增 D17 双断言）**：在 T1 Acceptance 追加 `rg` 断言（见下 Rev 5-C-①）。
3. **`Success Criteria → Verification Commands` + `Final Checklist` 静态断言**（见 Rev 5-C-②）。
4. **F3 / F5 复验专项（Rev 5）**：独立复跑 `rg 'MatchStrategy' src tests` = 0、`rg 'DEFAULT_STRATEGY' src tests` = 0、`rg 'DEFAULT_MATCH_SETTINGS' src tests` ≥ 命中；独立确认 **`types.ts` 内无 `MatchStrategy`/`DEFAULT_STRATEGY` 残骸**、A/B/C 对照**仅**在 `design §3.1`。

##### Rev 5-C-① · T1 Acceptance 追加（原话口径）

```
- [ ] 【D17 静态断言】`rg -n 'MatchStrategy' src tests` → **0 命中**（死类型已彻底删除）
- [ ] 【D17 静态断言】`rg -n 'DEFAULT_STRATEGY' src tests` → **0 命中**（死常量已彻底删除；注意 `DEFAULT_MATCH_SETTINGS` 含子串 `DEFAULT_` 但**不含** `DEFAULT_STRATEGY`，不会误命中）
- [ ] 【D17 静态断言】`rg -n 'DEFAULT_MATCH_SETTINGS' src tests` → **命中**（`types.ts` 定义 + 至少 1 处消费者）
- [ ] 【D17 静态断言】`rg -n "'A'|\"A\"|'B'|'C'" src` → **0 命中**（`'A'|'B'|'C'` 策略字面量不得进入代码；**注**：需排除无关单字母字面量，人工确认命中点非策略语义）
- [ ] 【D17 对照表核查】A/B/C→四格仅存在于 `design:146-154`（§3.1 markdown）；`src tests` 内**无**映射表/对照常量
```

##### Rev 5-C-② · Final Checklist 静态断言追加（原话口径）

```
- [ ] **D17 静态断言**：`rg "MatchStrategy" src tests` → **0 命中**
- [ ] **D17 静态断言**：`rg "DEFAULT_STRATEGY" src tests` → **0 命中**
- [ ] **D17 静态断言**：`rg "DEFAULT_MATCH_SETTINGS" src tests` → **命中**（定义 + 消费者）
- [ ] **D17 载体核查**：A/B/C→新四格对照**仅**为主设计 §3.1 markdown 表（`design:146-154`），**未进入代码/类型**
```

> **`DEFAULT_STRATEGY` 与 `DEFAULT_MATCH_SETTINGS` 的 `rg` 互斥性说明**：`rg 'DEFAULT_STRATEGY'` 是**字面子串**匹配，`DEFAULT_MATCH_SETTINGS` 字符串中**不包含** `DEFAULT_STRATEGY` 子串（`DEFAULT_MATCH_…` vs `DEFAULT_STRATEGY`），故两条断言**互不干扰**、可同时成立（删除后一条为 0，另一条命中）。

#### Rev 5-D · T1 执行 Profile 增强 + 失败预案（用户执行安排，已同意）

**① T1 执行 Profile（明确化）**：

| 项 | 值 |
|---|---|
| **Category** | **`deep`**（维持 v4；**全计划最大单任务**） |
| **允许独立 worktree** | **YES** —— T1 **允许独立 worktree** 执行（体量大、独占 10 个生产文件 + 10 个测试文件，隔离执行避免与其它 Wave 任务的文件争用） |
| **可拆分性** | **不可再拆（NO-FURTHER-SPLIT）** —— T1 为**全计划最大单任务**（牵连 **~40 文件**：10 生产文件 + 10 测试文件 + 新建 `switch/**` 目录 + 既有 cross-ref），**拆即破坏 TS 一致性 → `TS2367`（`slot-service.ts:186/204` 的 `MatchRuleSettings` 与 `'A'\|'B'` 比较）/ `TS2322`（`slot-service.ts:69`、`worker-orchestrator.ts:484/493` 的 `string → MatchRuleSettings`）**（**team-lead 已实测复现**）。**任何形式的「分片提交 / 分阶段落地」都会重现上述错误**，故**不可再拆**。 |

**② 失败预案（用户执行安排，已同意）**：

| 情形 | 处置 | 强制动作 |
|---|---|---|
| **发现「计划外」的编译点**（T1 过程中 `typecheck` 报出 v4/v5 References 未登记的**编译级**点） | **允许就地纳入 T1（追加）** —— 因 T1 为原子任务，任何编译点必须同提交消除，否则违背「每提交绿」 | **必须在交付报告中逐条列出**（文件:行 + TS 错误码 + 归入 T1 的理由）；**禁止静默扩大范围**（silent scope creep） |
| **发现需要改动「已定契约」**（如 `SwitchOutcome` 变体数、`matchSettings` 字段集、消息 action 集合超出 D17/设计已授权范围） | **必须停止并上报**（STOP & ESCALATE） | **不得自行变更**；须回到用户/设计层裁决（`SwitchOutcome` 4 变体冻结 + A1/B2 不受影响） |
| **发现「计划外」的**非编译**语义点**（旧字段字面量、文档对照） | 归 **T1 顺带**（不改断言语义），同报告列出 | 不阻塞提交；**逐条登记** |

> **边界**：**「计划外编译点」允许追加** ≠ **「计划外契约变更」允许追加**。前者的判据 = **`typecheck` 报错的机械适配点**（同 v4 Rev 3 判定边界：「编译期报错的显式标注/属性读取 = 必改」）；后者的判据 = **需要改动已文档化契约的形状/变体/字段集** ⇒ **停 + 上报**。

#### Rev 5-E · 「每提交 typecheck 绿」复核（**⚠️ 结论已被 Rev 6-A-5 撤回**：不再断言「仍 8/8 绿、无破例点」；仅保留「D17 未新增跨提交依赖」的结构性论证）

> 复核问题：**删除 `MatchStrategy` / `DEFAULT_STRATEGY` 后，是否新增「提交级 typecheck 破例点」？**

**结论：未新增破例点，仍为 8/8 提交 `typecheck` 绿**，理由如下：

> ⚠️ **【Rev 6 · A-5 撤回与降格（定稿口径，优先于本节其余文字）】** 本节的「**仍 8/8 绿，无破例点**」**撤回**为如下准确表述：
> - 本节 5 条理由**仅证明「D17 的 32 处引用点不引入新的跨提交依赖」**（这是**结构性论证**，成立且保留）；
> - **但「Commit 1 是否绿」不能由本节论证** —— 必须由 **T1 闭环（`typecheck` 0 error + `test:unit` ALL PASS）实证**（Rev 6-A-1）。**第四轮复审已给出实测反例**（`pages.smoke.test.tsx:103-111` → TS2353 / TS2741），故「人工穷举完备」的前提**已被否证**。
> - 下方表格**降格为「预期命中参考（非完备性要求）」**。**Commit 2–8 的绿**由**各自 pre-commit**保证。

1. **32 处引用点全部落在 Commit 1（T1）**：Rev 5-B 表中 32 处**逐一**归属 T1（`types.ts` / `messages.ts` / `storage-repository.ts` / `slot-service.ts` / `import-export-service.ts` / `settings/App.tsx` / `tests/unit/shared/messages.test.ts`）—— **全在 Commit 1 文件清单内**（v4 Commit 1 Files 已含这 7 个文件）。**无一处**散落到 Commit 2–8。
2. **删除类型/常量属「同一原子改写」的一部分**：`MatchStrategy` 被删除后，其消费者（`SlotDefinition.strategy` / `ExportPayload` / `SyncState` / 消息载荷 / `setGlobalStrategy` 签名）**必须在同一提交内**改为 `MatchRuleSettings` —— 这**正是** T1「契约 + 派发骨架合并」的定义（v4 Rev 4-B）。**删除 ≠ 新增独立红区**，而是**消除** v4 已识别的 `TS2367`/`TS2322` 的**上游根因**（`MatchStrategy` 正是产生 `'A'|'B'` 字面量与 `string` 宽签名的类型来源）。**删除后 TS2367/TS2322 仍会在「未同步改写」的中间态出现，但 T1 原子改写一并消除，故提交边界处为绿。**
3. **无跨提交引用**：`DEFAULT_STRATEGY` 删除后，`storage-repository.ts` / `import-export-service.ts` / `tests/.../messages.test.ts` 的替代（`DEFAULT_MATCH_SETTINGS`）**同在 Commit 1**；Commit 3（T6，`RecoverySession`）与 Commit 5（T8，`slot-service.ts`）**不引用** `MatchStrategy`/`DEFAULT_STRATEGY`（T8 的 `positionPrev/Next` 用 `MatchRuleSettings`，已在 Commit 1 定型）。
4. **Commit 2（T3）无关**：`file://` 前缀为纯数据面，**零** `MatchStrategy` 引用。
5. **唯一「潜在破例」候选仍是 Commit 1**，其规避手段**仍是**「契约 + 派发骨架合并为原子任务」（v4 Rev 4-F）。**D17 不改变该结论**：删除类型/常量**不引入**新的提交间依赖，反而**减少了**契约面（少一个类型、少一个常量）。**更优解仍不存在**（任何拆分都重现 TS 错误）。

| 提交 | `typecheck` | D17 影响 |
|---|---|---|
| **Commit 1（T1）** | ✅ 绿 | **32/32 处 D17 引用点在此提交内一次性消除**；同提交完成 `MatchRuleSettings` 全量替换 |
| Commit 2（T3） | ✅ 绿 | 无 D17 引用 |
| Commit 3–8 | ✅ 绿 | 无 D17 引用（均用 `MatchRuleSettings`，Commit 1 已定型） |

> **结论（Rev 6 定稿口径）**：**D17 未新增「跨提交」破例点**（结构性结论保留）；**但「8/8 绿」的实证义务已上移** —— **Commit 1 的绿由 T1 闭环（`typecheck` 0 error + `test:unit` ALL PASS）保证；Commit 2–8 的绿由各自 pre-commit 保证**。本节表格 = **预期命中参考（非完备性要求）**，**不得**作为「已验证」引用（Rev 6-A-5）。

#### Rev 5-F · 新悬空引用核查（**结论：无新悬空引用**）

| 核查项 | 结论 |
|---|---|
| 删除 `MatchStrategy`（`types.ts:8`）后，是否残留 `import { MatchStrategy }`？ | **无** —— 6 个 `src` import 点（`messages.ts:9`、`import-export-service.ts:17`、`storage-repository.ts:18`、`slot-service.ts:19`、`settings/App.tsx:16` + `types.ts` 自身）**全部在 T1 清单内**，同提交删除 import 成员 |
| 删除 `DEFAULT_STRATEGY`（`types.ts:15`）后，是否残留消费者？ | **无** —— 5 处消费者（`import-export-service.ts:23`、`storage-repository.ts:26`、`tests/unit/shared/messages.test.ts:19` + `:199/:200`）**全部在 T1 清单内** |
| `DEFAULT_MATCH_SETTINGS` 新增后，是否所有引用点均已定义？ | **是** —— 定义点 = `types.ts`（T1），消费者 = `storage-repository.ts:77/175`、`import-export-service.ts:23`、`settings/App.tsx:1771`、`ui/import-preview/main.tsx:14`（+ 测试）—— **均同提交** |
| `message-client.ts:245-251`（X1）删除类型名后是否成悬空？ | **否** —— 该文件**未引用 `MatchStrategy`**（形参 `string`）；其 payload 形状随 T1 同改（X1/X2），**不因 D17 变成新悬空** |
| 是否有 `src`/`tests` 之外（`scripts`、`manifests`、生成物）引用？ | **无** —— `rg` 全仓仅 7 个 `src`/`tests` 文件 + 文档面（plans/designs/yaml），**无脚本/清单引用** |
| 设计文档面是否成为「悬空」？ | **否** —— `design §3.1`（`design:146-154`）是 D17 **指定的保留载体**，**非悬空**；`decisions.yaml:139-147` 为决策记录 |

> **结论**：**D17 的删除面被 T1 原子任务完整吸收，无新增悬空引用**；与 v4 Rev 4-E「X 系列已全部纳入 T1 / T6 / T12b，不产生新的悬空引用」一致。
> **【Rev 6 增补】** ① **NIT-3 去噪**：删除 `rule-delivery-real-dom.test.ts:329`、`sync-write-resilience.test.ts:133/174/189` 三处**悬空引用**（实测 0 命中），**无新悬空**；② **NIT-4 兜底**：新增 `?? DEFAULT_MATCH_SETTINGS` 读侧兜底**增加** `DEFAULT_MATCH_SETTINGS` 的消费者（非悬空，反例：消费者多于定义才会悬空）；③ **BLOCKER-1**：`pages.smoke.test.tsx:103-111` 已纳入 T1（**悬空引用被吸收**，非新增）。

#### Rev 5-G · 对「任务数 / Wave / 关键路径」的影响（**结论：均不变**）

| 维度 | v4 | v5（D17 后） | 是否变化 |
|---|---|---|---|
| **实现/诊断任务数** | 9（T1/T3/T6/T8/T9/T10/T11/T12a/T12b） | **9（不变）** | **不变** —— D17 的 32 处引用点**全部并入既有 T1**，**不新增任务** |
| **验证任务数** | 5（F1–F5） | **5（不变）** | **不变** —— D17 复验并入 F3/F4/F5 的既有专项（新增子项，非新任务） |
| **Wave 结构** | 6 waves + FINAL | **6 waves + FINAL（不变）** | **不变** —— T1 仍独占 Wave 1 |
| **关键路径** | T1 → T8 → T9 → T10 → T11 → T12a → F1–F5 | **不变** | **不变** —— T1 体量增（D17 面），但**深度不变**（仍为单原子任务） |
| **提交数** | 8 | **8（不变）** | **不变** —— D17 面全在 Commit 1 |
| **T1 体量** | ~40 文件 | **~40 文件（不变；32 处引用点落在既有文件内，无新文件）** | **不变**（仅增加 T1 卡内条目，不新增文件） |

> **结论**：**D17 不改变任务数（9+5）、Wave（6+FINAL）、关键路径、提交数（8）、T1 文件集**。它以**「扩容既有 T1 + 强化既有 F3/F4/F5 子项」**方式落地，**符合「不新增任务 / 不削弱并行度 / 单一原子任务」的规划约束**。

#### Rev 5-H · 交付报告核对项（用户要求的四项交付）

| 用户要求 | v5 对应章节 | 结论摘要 |
|---|---|---|
| ① **D17 落点（行号区间）+ 全部引用点** | **Rev 5-B**（32 处表）+ T1 卡片（What/Files/Must NOT/References/Acceptance/RED） | 落点 = **T1**；引用点 = **7 文件 / 32 处**（全表列出行号） |
| ② **修订后任务数 / Wave / 关键路径是否变化** | **Rev 5-G** | **均不变**（9 实现 + 5 验证 / 6 waves + FINAL / 关键路径不变 / 提交 8 不变） |
| ③ **是否仍有 typecheck 破例点** | **Rev 5-E → 由 Rev 6-A-5 更正** | **D17 未新增「跨提交」破例点**（结构性结论）；**「8/8 绿」不再是「已实测」事实** —— **Commit 1 由 T1 闭环保证、Commit 2–8 由各自 pre-commit 保证** |
| ④ **新悬空引用核查结论** | **Rev 5-F** | **无新增悬空引用**（删除面全在 T1；文档面为指定载体，非悬空） |

---

### Rev 6 — 2026-09-30 · **定稿轮（v5 → v6 FINAL）**：用户最终两项裁定落实（**R1-A 编译器驱动闭环** + 第四轮复审 **2 BLOCKER / 2 NIT**）

> 触发：第四轮定向复审给出 **R1-A（T1 完成判据不成立）** 与 **2 BLOCKER + 2 NIT**。用户据此给出**最后两项裁定**。本 Rev 完成计划层落地，**文档定稿为 v6 (FINAL)，状态 = 待执行**。
>
> **本轮性质**：**判据口径重构**（不再以「人工穷举 `tsc` 报错」为收敛方式）+ **错误结论撤回** + **4 项登记闭环**。**不新增任务 / 不改 Wave / 不改关键路径 / 不改 8 提交结构 / 不新增文件类别 / 护栏全部保持。**

#### Rev 6-0 · R1-A 根因与判定（为何 v5 口径不成立）

| 项 | 内容 |
|---|---|
| **第四轮复审判定** | 「**8/8 提交 `typecheck` 绿**」**不成立** |
| **反例（实测）** | `tests/ui-smoke/pages.smoke.test.tsx:103-111` 的 `ImportPreview` **对象字面量**直接传给**具体类型** prop → 删除 `globalStrategy` 后产生 **TS2353**（对象字面量只能指定已知属性）/ **TS2741**（缺少必需属性） |
| **T1 适配面仍不全** | `tests/unit/ui/settings.test.tsx:96/109/122` 3 个用例在三旋钮重写后必红，却**未登记**于 T1 适配面与 Acceptance 目标 |
| **共同根因（用户判定）** | 计划在**用人工穷举预测 `tsc` 的报错**。**适配面约 40 文件**，穷举**无法收敛**（已连续 4 轮各发现新遗漏：Rev 3 扩面 → Rev 4 X1–X10 → Rev 5 D17 32 处 → Rev 6 仍有反例） |
| **结论** | **判据必须改为「闭环式」** —— 由**编译器 / 测试运行器**输出权威清单；人工清单只作**预期命中参考** |

#### Rev 6-A · 裁定 A（R1-A）：T1 采用「编译器驱动完成」

**A-1 · T1 完成判据（闭环式，取代 v5 的开放式验收）**：

```
T1 完成 ⇔ ① `npm run typecheck` → 0 error
        ② `npm run test:unit`  → ALL PASS
（两条命令的输出即「权威适配清单」；完备性由 tsc / vitest 定义，人工清单不再作为完备性判据）
```

- **不再**以「v5 References 清单是否穷尽」作为 T1 通过/不通过的判据 → 复审**不得**再以「清单是否完备」为由判 `NOT OKAY`。
- **`test:unit` 范围 = `vitest run --project unit`**（`vitest.workspace.ts:17-23`，`include: ['tests/unit/**/*.test.{ts,tsx}']`）。
- **Commit 1 pre-commit 保留 `test:integration`**（T1 改 `tests/integration/*` 多处，N-4 既有要求）—— pre-commit 是完成判据的**超集**，不回退。

**A-2 · 手工适配清单降格定性（明文写入 T1）**：

> v5 及此前 T1 卡内列出的**全部适配点**（含 Rev 4-E **X1–X10**、Rev 5-B 的 **32 处 D17 引用点**、Rev 4-C 残余 #1–#5），自 v6 起定性为：
> **「预期命中参考（EXPECTED-HIT REFERENCE）—— 非完备性要求（NOT A COMPLETENESS REQUIREMENT）」**。
> 其作用是**降低首轮返工**，**不是** T1 的验收边界；**T1 的验收边界 = A-1 闭环判据（`typecheck` 0 error / `test:unit` 全绿）**。

**A-3 · T1 What to do 新增闭环步骤（执行循环，明文写入）**：

```
① 改契约（types.ts / messages.ts + 原语/resolver + 各消费者，按原子改写）
② 跑 `npm run typecheck`
③ 跑 `npm run test:unit`
④ 修掉它们报出的**每一处**（编译点 → 机械适配；断言点 → 按新语义改写）
⑤ 重复 ②–④，直到 `typecheck` = 0 error 且 `test:unit` = ALL PASS
```

**A-4 · 失败预案强化（沿用 Rev 5-D 并明确）**：

| 情形 | 处置 | 强制动作 |
|---|---|---|
| **计划外编译 / 断言点**（闭环第 ④ 步报出的、清单未列者） | **允许就地纳入 T1** | **必须在交付报告中逐条列出**（文件:行 + TS 错误码 / 用例名 + 归入 T1 的理由）；**禁止静默扩大范围**（silent scope creep） |
| **需改动「已定契约」**（尤其 `SwitchOutcome` 变体数、A1 / B2 口径、`matchSettings` 字段集、消息 action 集合超出 D17 / 设计授权） | **必须停止并上报**（STOP & ESCALATE） | **不得自行变更**；须回到用户 / 设计层裁决 |

> **边界**：**「计划外编译 / 断言点允许追加」 ≠ 「计划外契约变更允许追加」**。前者判据 = `tsc` / `vitest` 报出的**机械适配点**；后者判据 = **需改动已文档化契约的形状 / 变体 / 字段集** ⇒ **停 + 上报**。

**A-5 · 错误结论撤回与自相矛盾消除（同步修正）**：

| 位置（v5 行号） | v5 错误表述 | v6 修正 |
|---|---|---|
| **Rev 4-F**（`v5:178-195`；结论 `v5:193-194`） | 「**8/8 提交 `typecheck` 绿，无破例点**」（以「已完成验证」语气陈述） | **撤回该结论**：Commit 1 的绿**由 T1 闭环（A-1）保证**；**其余提交的绿由各自 pre-commit 保证**。**不得**再引用 Rev 4-F 的 8/8 表作为「已实测通过」的既有事实；该表降格为**预期命中参考** |
| **Rev 5-E**（`v5:314-332`；结论 `v5:318` / `v5:332`） | 「**结论不变：仍 8/8 绿，无破例点**」「D17 未新增破例点」 | **撤回**：D17 的 32 处集中在 Commit 1，**只说明「不新增跨提交依赖」**；**Commit 1 是否绿须由 A-1 闭环实证**。Rev 5-E 表格降格为**预期命中参考** |
| **T1 卡内 `pages.smoke` 行**（`v5:735`） | 「由 T12b 顺带…**不阻塞 T1**」 | **改为**：`:103-111` 的 `ImportPreview` 字面量为**编译面（TS2353 / TS2741）→ T1 必改**（见 Rev 6-B BLOCKER-1） |
| **T12b 卡内 WHY**（`v5:1550`） | 「必须同步为 `matchSettings`，否则 ui-smoke **编译失败**（TS2322）」 | **改为**：该 `ImportPreview` 字面量已在 **T1** 适配结束；**T12b 只负责 `:83-98` 的 `RecoveryWindow` props**（**无矛盾**：编译面归 T1、props 面归 T12b） |

> 上述 4 处修正后，**文档内不再存在「`pages.smoke` 既『不阻塞 T1』又『编译失败』」的自相矛盾**。

#### Rev 6-B · 裁定 B：第四轮复审 2 BLOCKER + 2 NIT 闭环

**B-1 · [BLOCKER] `tests/ui-smoke/pages.smoke.test.tsx:103-111` 纳入 T1（编译面）**

- **实测**：`:103-111` 为 `<ImportPreviewTable preview={{ … globalStrategy:'B' … }} />` —— 对象字面量**直接传给具体类型 prop**；T1 删除 `globalStrategy` 并新增 `matchSettings` / `switchDirection` / `autoBindGlobal` 后 → **TS2353**（`globalStrategy` 非已知属性）+ **TS2741**（缺 `matchSettings` 等必需属性）。
- **定性**：**编译面（T1 必改）** —— 因 `tsconfig.json` `include` 含 `tests`，`npm run typecheck` 会编译它 ⇒ **不修则 T1 闭环判据（A-1）不成立**。
- **落地**：**T1 Files** 增列 `tests/ui-smoke/pages.smoke.test.tsx`（**仅限** `:103-111`）；**T1 What to do** 增补适配条目：**补** `matchSettings: DEFAULT_MATCH_SETTINGS` / `switchDirection: 'next'` / `autoBindGlobal: true`，**删** `globalStrategy`。
- **与 T12b 的分工（消除 v5 矛盾）**：`:83-98` 的 `<RecoveryWindow>` props 仍归 **T12b**（T12b 才改 `RecoveryWindow` props）；**同一文件的两次触碰分属 Commit 1 与 Commit 4**，属**授权例外-⑥**（`pages.smoke.test.tsx`，仅限 props / 形状适配）。

**B-2 · [BLOCKER] `tests/unit/ui/settings.test.tsx:96/109/122` 显式登记**

- **实测**：`:96`「should render global strategy radios with B checked」（断言 `getByRole('radio', { name: /B\./ })` 选中）；`:109`「should render 10 per-slot strategy selects」（断言 `combobox` / `Strategy for slot/` 计数 = 10）；`:122`「should send SET_GLOBAL_STRATEGY on radio change」（断言 `payload: { strategy: 'C' }`）。三旋钮重写后**必红**（无 `B.` radio、无 per-slot `Strategy` select 命名、无 `SET_GLOBAL_STRATEGY` payload）。
- **登记口径说明（消除歧义）**：该文件位于 `tests/unit/ui/` ⇒ **属 `test:unit` 项目**；此处「**未被 `test:unit` 覆盖**」指**未被 v5 的 T1 适配面 / Acceptance 目标登记**（v5 T1 Acceptance 只列 `messages.test.ts` 等，未含该文件）—— **A-1 闭环后由 `test:unit` 强制拉入**，但**仍必须显式登记**（否则执行者视其为范围外 → 静默红）。
- **落地**：**T1 Files** 增列 `tests/unit/ui/settings.test.tsx`；**T1 What to do（测试侧适配）** 增列该 3 个用例；**授权例外-②** 保持（`settings.test.tsx`）。

**B-3 · [NIT] 删除悬空引用**

- **实测（`rg` 0 命中）**：
  - `tests/integration/rule-delivery-real-dom.test.ts:329` —— **不含** `globalStrategy`（`:329-331` 为 `rules[].favicon.value` 断言）；
  - `tests/unit/background/sync-write-resilience.test.ts:133/174/189` —— **不含** `globalStrategy`（均为 `rules[].favicon.value` 断言）。
- **处置**：从 **Rev 4-E X9 清单**中**移除**上述 4 个行号（**悬空引用**），并更正 X9 实际范围（仅保留**实测命中**者）：
  - **保留（实测命中）**：`tests/integration/full-suite.test.ts:201-206`（`:203 globalStrategy:'C'`）、`tests/integration/storage-repository.test.ts:340/378/415`（`:342 / :380 / :417 globalStrategy`）。
  - **移除（悬空）**：`tests/integration/rule-delivery-real-dom.test.ts:329`、`tests/unit/background/sync-write-resilience.test.ts:133/174/189`。
- **落地**：Rev 4-E 的 **X9 行**（`v5:161`）与 **X9 注**（`v5:259`）就地更正；T1 What to do 中 X9 描述同步更正。

**B-4 · [NIT] `sync.matchSettings` 缺失兜底**

- **风险**：多个 UI 测试的 `GET_STATE` mock 返回 `sync: { configVersion:1, globalStrategy:'B', slots:[], rules:[] }`（**未标注**、运行期）；读入后 `sync.matchSettings` 为 `undefined`；实现若直接解引用（如 `sync.matchSettings.tabIdMode`）→ **低概率运行期 TypeError**（UI 渲染崩溃，**非编译失败**）。
- **实测覆盖面**：`tests/unit/ui/settings-loading-states.test.tsx:37`、`tests/unit/ui/settings-deeplink.test.tsx:27`、`tests/unit/ui/settings.test.tsx:23 / :149 / :171`、以及 `sidebar*.test.tsx` 系列（`tests/unit/ui/sidebar.test.tsx:11` 等）+ `slot-action-button-sizing.test.tsx`、`message-client.test.ts` 等 —— **均以 `{globalStrategy:'B'}` 形状 mock，无 `matchSettings`**。
- **处置（新增实现要求）**：**所有新实现中读 `sync.matchSettings` 的点必须做缺失兜底 `?? DEFAULT_MATCH_SETTINGS`**（读侧防御）。
- **定性（防误判）**：该兜底**不构成兼容层** —— **不读** `globalStrategy`、**不做**形状嗅探、**不写**迁移映射表；仅为**防御性默认值**。与 Rev 4「禁止兼容层」**不冲突**。
- **落地**：**T1 What to do** 新增该实现约束；**T1 Must NOT do** 加澄清条目。

#### Rev 6-C · 对 v5 的计划层修订落点（汇总表）

| # | 修订项 | 落点（章节 / 任务） |
|---|---|---|
| 1 | T1 完成判据改闭环（A-1） | **T1 Acceptance Criteria**（置顶改写）+ **Rev 6-A-1** + TL;DR「T1 完成判据」行 |
| 2 | 手工清单降格定性（A-2） | **T1 References 前置声明** + **Rev 6-A-2** |
| 3 | T1 闭环步骤（A-3） | **T1 What to do 末段「闭环执行循环」** |
| 4 | 失败预案强化（A-4） | **T1 Recommended Agent Profile / Must NOT do** + **Rev 6-A-4** |
| 5 | 撤回 Rev 4-F / Rev 5-E 错误结论（A-5） | **Rev 4-F 结论行**、**Rev 5-E 结论行**就地加撤回标记 + **Rev 6-A-5** |
| 6 | 消除 `v5:735` vs `v5:1550` 矛盾 | **T1 测试侧适配行**、**T12b WHY** 就地改写 |
| 7 | `pages.smoke` 纳入 T1（BLOCKER-1） | **T1 Files + What to do**；T12b 保留 `:83-98` props |
| 8 | `settings.test.tsx` 3 用例登记（BLOCKER-2） | **T1 Files + What to do（测试侧）** |
| 9 | 删除悬空引用（NIT-3） | **Rev 4-E X9 行**（两处）+ T1 描述 |
| 10 | `matchSettings` 缺失兜底（NIT-4） | **T1 What to do + Must NOT do** |

#### Rev 6-D · 「必须保持」核对（不得回归）

| 约束 | v6 状态 |
|---|---|
| 护栏：不新增依赖 / 不放宽 eslint / 不新增 `eslint-disable` / lint delta-0 / typecheck 0 / 三浏览器 build / WCAG 2.1 AA / `src/ui` CJK 0 / **F3 强制独立复验（不采信执行者自审）** | **全部保持** |
| `SwitchOutcome` **4 变体冻结**；A1（`{ anchorTabId?: number }`）；B2（`PROTECTED_PAGE`，无 `protected_blocked`） | **全部保持** |
| 不做迁移、无 `schemaVersion`；旧导出文件 → `IMPORT_INVALID` | **保持** |
| **D17**：彻底删除 `MatchStrategy` / `DEFAULT_STRATEGY`（新增 `DEFAULT_MATCH_SETTINGS`） | **保持** |
| 任务数 **9 + F1–F5**、Wave **6 + FINAL**、关键路径、**8 提交结构** | **不变** |
| 授权例外清单 **8 项** | **保持 8 项**（⑥ `pages.smoke.test.tsx` 的范围说明增补「亦含 `:103-111` 的 `ImportPreview` 形状」，**不新增类别**） |
| T1 Profile：`Category: deep` + 允许独立 worktree + **NO-FURTHER-SPLIT** | **保持** |

#### Rev 6-E · 新增悬空引用核查（结论：**无新悬空引用**）

| 核查项 | 结论 |
|---|---|
| 新增 `tests/ui-smoke/pages.smoke.test.tsx` 至 T1 Files，是否与 T12b 冲突？ | **否** —— 同一文件按**行区间分工**（T1 `:103-111`、T12b `:83-98`），提交边界（Commit 1 / Commit 4）**串行**，无并行写冲突 |
| 新增 `tests/unit/ui/settings.test.tsx` 至 T1 Files，是否与其它任务冲突？ | **否** —— 该文件**无其它任务触碰**（原 T12c 已 `ABSORBED` by T1） |
| 删除 X9 悬空引用后，是否产生新悬空？ | **否** —— 被删的 4 个行号**本就不含** `globalStrategy`（实测 0 命中），删除仅**去噪** |
| `?? DEFAULT_MATCH_SETTINGS` 兜底是否与「禁止兼容层」冲突？ | **否** —— 兜底为**读侧防御默认值**，不读旧字段、不做形状嗅探、不写迁移映射表 ⇒ **非兼容层** |
| Rev 6 是否引入新文件 / 新任务 / 新提交？ | **否** —— 仅在既有文件内增列条目 |

---

## TL;DR

> **Quick Summary**: 消除「同一意图、不同入口、行为不一致」（item 1/2），并将策略从 A/B/C 黑盒重构为三旋钮严格四格语义 + 方向设置（item 3），重做恢复窗与设置页（item 4）。全程 TDD：每任务先构造**能真实失败的 RED**（纯函数单测为主力）→ 最小实现 → 门禁。最终 **F3 强制独立复验（不采信执行者自审）**。
>
> **Deliverables**:
> - `src/background/switch/` — 共享纯原语 `primitives.ts` + 4 resolver + `resolve-switch.ts`
> - `worker-orchestrator.ts` — `applySwitchOutcome`（唯一副作用点）+ 新 action 路由 + in-flight 合流 + 开页诊断
> - `types.ts` / `messages.ts` — `SyncState` 重塑（**删 `globalStrategy`、删 `schemaVersion`**；新默认 `exists+match+tabId`）+ 消息契约（**6 新增**/3 重塑/4 不变）；`SwitchOutcome` **既有 4 变体不变**（撤销 `protected_blocked`，BLK-B→B2）；**【Rev 5 · D17】彻底删除 `MatchStrategy` 类型 + `DEFAULT_STRATEGY` 常量（不留死类型/死常量），新增 `DEFAULT_MATCH_SETTINGS` 取代**
> - `storage-repository.ts` / `import-export-service.ts` — **仅填新形状默认值（无迁移）** + 新形状导出；**旧导出文件不再可导入**
> - `slot-service.ts` — **T1** 策略分派改写为四格 resolver（与类型同次）；**T8** Position（↑/↓ 后端）+ 方向感知
> - `recovery-service.ts` — Prev/Next 游标（不关窗）+ Open URL（exact-only + 特权拦截 + 成功后关窗）+ session `windowId`/`candidateCursor`
> - `sidebar/App.tsx` — `↑/↓` Position 按钮 + 删除误导 toast + footer 开页有界重试
> - `recovery/{App,main}.tsx` — 恢复窗改造
> - `settings/App.tsx` — **T1** 三旋钮 + 方向 + autoBind 全局；每槽一行（策略 + autoBind 三态）
> - `scripts/gen-protected-prefixes.mjs` + 生成物 — `file://` 入 canonical 前缀
> - 四层测试 + 诊断记录 + **F1–F5 独立复验**
>
> **Estimated Effort**: Large（**9 个实现/诊断任务**（T1 / T3 / T6 / T8 / T9 / T10 / T11 / T12a / T12b）+ **5 个验证任务**（F1–F5））
> **Parallel Execution**: YES — 6 waves + FINAL
> **Critical Path**: T1 → T8 → T9 → T10 → T11 → T12a → F1–F5 → user okay
> **Registration Risk**: **RK1 已关闭**（`CLOSED_NOT_APPLICABLE`）—— 用户裁定「不做兼容、不做迁移」（应用未公测、无用户历史）⇒ 不存在「老用户行为变更无测试可证」问题；D10 / C4 / A8 已 `SUPERSEDED`。**仍然生效**：`SwitchOutcome` 4 变体冻结 + `needs_recovery` 4 处锁定（见「⚠️ 跨层契约（RK1 关闭后仍生效）」章节）。
> **Typecheck 口径（Rev 4 → Rev 6 定稿口径）**: **本计划不存在 commit 级 `typecheck` 红区（设计意图）** —— T1 为**原子核心任务**（契约 + 原语 + resolver + `slot-service` 分支 + 导入导出 + 设置页策略区**同一次改写**），**且不存在任何「占位适配」**（Rev 4-B）。
> **【Rev 6 · A-1 判据上移（取代「人工穷举」）】** T1 的绿**以闭环判据实证**：`npm run typecheck` → **0 error** 且 `npm run test:unit` → **ALL PASS**（由 `tsc` / `vitest` 定义**权威适配清单**；人工清单 = **预期命中参考（非完备性要求）**）。**Commit 1 的绿由 T1 闭环保证；Commit 2–8 的绿由各自 pre-commit 保证。** **【Rev 6 · A-5】** Rev 4-F / Rev 5-E 的「8/8 提交 typecheck 绿（已实测）」结论**已撤回**（第四轮复审实测反例：`pages.smoke.test.tsx:103-111` → TS2353/TS2741），其表格降格为**预期命中参考**。

---

## Context

### Original Request

依据已获批准的设计文档生成可执行工作计划。单一整体迭代（1+2 bug 修复 + 3+4 重设计）；4 层 46 决策，OPEN 0。**【Rev 4 裁定后】** D10 / C4 / A8 已 `SUPERSEDED`（不做兼容、不做迁移、无 `schemaVersion`）、RK1 已 `CLOSED_NOT_APPLICABLE`；仍生效的跨层契约 = `SwitchOutcome` 4 变体冻结 + `needs_recovery` 4 处锁定。**【Rev 5 裁定后】** **D17（Q1-A，2026-09-30，已回写设计）** = **彻底删除 `MatchStrategy` 类型与 `DEFAULT_STRATEGY` 常量**（不留死类型/死常量）、新增 `DEFAULT_MATCH_SETTINGS` 取代、A/B/C→四格对照仅留 `design §3.1` markdown 表。核心约束：单一真源、四格严格语义、权限零扩张、lint delta-0、强制独立复验。TDD 每任务须有 RED 可构造性（纯函数单测为主力）。任务化 + DAG + Wave；按文件冲突串行化。每任务含 What/Must NOT/Agent Profile/Parallelization/References（真实 file:line，须读码核实）/Acceptance/QA（≥1 failure）/Commit。保留 `needs_recovery` 契约；item 2 根因定位为独立任务；强制独立复验。**只做规划，不实现。**

### Interview Summary

免除访谈：输入为已批准完整设计（OPEN 0）。自我清关：核心目标 YES / 范围 YES / 歧义残留=设计期已全裁（含 **Rev 4 的「不做兼容、不做迁移」设计级裁定** + **Rev 5 的 D17「彻底删除 `MatchStrategy`/`DEFAULT_STRATEGY`，不留死类型/死常量」**）、规划期发现 2 项工程级冲突（BLK-A / BLK-B，已裁决 A1 / B2）+ 规划层缺陷（BLK-1 / BLK-2 / BLK-3，Rev 3 闭环，其中 BLK-1 残余由 **Rev 4 合并原子任务**彻底闭环）/ 方案 YES / 测试策略 YES / 阻塞=**0**。

### Research Findings（规划者独立读码核实，非引用自述）

1. `applySwitchOutcome` 落点成立：`worker-orchestrator.ts:230-260`（switch-slot-x 开窗；含 `:258` `diagnostics.record` 与 `:259` `return`；Rev 3 校正自原 230-257）与 `:356-357`（`SWITCH_SLOT` 只回传）确为**同一解析、不同副作用** → item1 根因。
2. 循环路径不动 binding 是**既有契约**：`slot-service.ts:375-376`（nextMatchForSlot）、`:432-433`（prevMatchForSlot）已有显式注释 → A4b/§3.4「浏览类不更新 binding」与现状同构。
3. 恢复窗与 DT1 冲突属实：`recovery-service.ts:109`（`candidates[0]`）+ `:129`（立即 `removeRecoverySession`）→ 与「可连点、不关窗」不兼容，须重写。
4. `OPEN_PAGE` 双创造者属实：`worker-orchestrator.ts:668-689`（background `openOrReusePage`）与 `sidebar/App.tsx:1157-1178`（`createChromePageOpenApi` 直连 fallback）。
5. `KNOWN_ACTIONS` 是**手写白名单**（`worker-orchestrator.ts:43-84`），N4 注释明示不随 union 自动同步 → 新增 action 必须同步登记（GAP-D）。
6. 测试夹具面实测：`globalStrategy` 被 **31** 个测试文件引用、`strategy` 被 **37** 个引用（设计称「30」，以实测 31/37 为准）。
7. `settings.test.tsx:96/109` 引用**准确**（B checked / 10 selects）；`slot-service.test.ts:107/133/146/162` **准确**。
8. `SwitchOutcome.type === 'needs_recovery'` 被 `slot-service.test.ts:146/162` + `full-suite.test.ts:71/179` 锁定（合计 4 处）→ 不得移除。
9. `isProtectedUrl` 的实际集合由 `PROTECTED_URL_PREFIXES`（`protected-prefixes.generated.ts:11-20`）驱动，**当前不含 `file://`** → C2/A13 要补入 canonical 列表（`scripts/gen-protected-prefixes.mjs:43-52`）并重跑 `gen:prefixes`；连带 `file://` 不可作 rule 改写目标（`rule-service.test.ts:454` 的 dangerous 列表已含 `file://`，语义兼容）。
10. `recovery-service.openUrl:64` 确为直接 `tabs.create({ url: session.urlMatch.value })`，**无协议校验** → C2 真实缺口成立。
11. **契约编译波面实测（Rev 3 / Rev 4 扩面）**：`SyncState.globalStrategy` 的**生产侧**消费者：`storage-repository.ts:26/77/175/615-620`、`slot-service.ts:19/55/69/176/186/204/237`、`worker-orchestrator.ts:59-60/352/468-471/484/493`、`import-export-service.ts:23/55/103/140/199`、`ui/import-preview/main.tsx:14`、`ui/settings/App.tsx:16/137-218/1623/1771/1795-1796/1821-1836/1838-1852/1896-1904`、`ui/shared/message-client.ts:245-251`（**X1 新增**）、`shared/types.ts:15/164/183/191` —— 全部纳入 **T1 原子改写**（**非占位**，Rev 4-B）。
14. **`MatchStrategy` / `DEFAULT_STRATEGY` 全量实测（Rev 4 / X3；Rev 5 · D17 扩全）**：`rg 'MatchStrategy|DEFAULT_STRATEGY' src tests` = **7 文件 / 32 处**（**Rev 5-B 表**）：`types.ts:8/15/54/164/183/191`（6）、`messages.ts:9/49/151/156`（4）、`storage-repository.ts:18/26/77/175/615`（5）、`slot-service.ts:19/55`（2）、`import-export-service.ts:17/23/103`（3）、`settings/App.tsx:16/138/141/142/202/1771/1795/1821/1838`（9）、`tests/unit/shared/messages.test.ts:19/199/200`（3）—— **D17 要求全部删除/替换（类型 + 常量不留）**，新增 `DEFAULT_MATCH_SETTINGS` 取代。**注**：`message-client.ts:245-251` **不含 `MatchStrategy` 字面量**（形参 `string` / payload `unknown`）→ 不在 32 处内，但属 X1 payload 形状面，仍须 T1 同改。
15. **穷尽 switch 实测（Rev 4 / X5 新增）**：`tests/unit/shared/messages.test.ts:24-26/28-69/72-78` 的 `assertNever` 穷尽 switch —— 新增 6 个 action 后**必须补 case**，否则编译失败。
16. **`slot-service.saveSlot` 显式实参实测（Rev 4 / X4 新增）**：`tests/integration/slot-service.test.ts:135`（`saveSlot(1, 0, undefined, 'C')`）为**显式字面量** → 随签名变更**编译必红**。
17. **Commits 与 tests 的 typecheck 关系实测**：`tsconfig.json` `include:["src","tests",…]` → **`npm run typecheck` 编译 tests**。判定边界：**编译期报错的显式类型标注/属性读取 = 必改**；**未标注 mock 字面量 = 运行期断言，不破坏 typecheck**（Rev 3 结论沿用，Rev 4 扩入 X1–X10）。
12. **精确前缀断言实测（Rev 3 / BLK-2）**：`tests/unit/shared/url-utils.test.ts:362-375` 用 `toEqual` 精确锁定 8 个受保护前缀；`file://` 入 canonical 后**必失败** → T3 须同步登记该文件为更新点（保留 `toEqual` 结构）。
13. **`isKnownAction` 可见性实测（Rev 3 / NIT-N2）**：`worker-orchestrator.ts:87-91` 的 `isKnownAction` **未 `export`**（仅模块内 `handleMessage` 使用）→ T1/T10 的 QA 须经 `routeMessage` 断言（`UNKNOWN_ACTION` / 正常路由），沿用 `worker-orchestrator.test.ts:56` 的私有访问范式。

### Pre-Planning Review (sw-pre-planning-consultant)

> 依据本 skill 的角色模型，「预规划分析」用于捕获规划者可能遗漏的缺口。本节结论经规划者独立复核（`rg` + 读原文 + 实跑）。

**Intent Classification**: `Mid-sized Task`（置信度 high）混合 `Refactoring` —— 有边界的行为修复 + 模型重塑，落点在既有服务/UI 内，不改权限面、不引依赖；但**契约形状变更**（`SyncState` / 消息；`SwitchOutcome` 经 BLK-B / B2 **保持不变**）。**【Rev 4 修正】** 组织方式由「契约先行 + 分层落地」改为「**契约 + 派发骨架的单一原子任务**」——因**无兼容层**，分层落地会产生「占位期」编译死结（TS2367 / TS2322 实测）。

**Identified Gaps (addressed)**:
- *契约变更的传播面未清点* → 30+ 测试文件引用 `globalStrategy/strategy`；GAP-C 揭示 `ExportPayload/ImportPreview` 亦为旧形状载体。
- *新增 action 的登记点未说明* → GAP-D：`KNOWN_ACTIONS` 必须同步。
- *`↑/↓` 起点跨上下文* → BLK-A → **已裁决 A1**：载荷 `{ anchorTabId?: number }`，侧边栏传 `lockedTabId ?? currentTabId`，background 不读内存态、不持久化 Lock。
- *`protected_blocked` 无生产者* → BLK-B → **已裁决 B2**：撤销该变体，改用既有 `PROTECTED_PAGE` domain error（`types.ts:247`），恢复窗走既有窗内报错路径。
- *（Rev 3）契约编译波面未闭合* → BLK-1：**Rev 4 以「原子任务合并」彻底闭环**（非占位）。
- *（Rev 4）`message-client.ts` / `DEFAULT_STRATEGY` / 穷尽 switch / 显式实参未登记* → **X1–X10**（见 Rev 4-E），全部纳入 T1 / T6 / T12b。
- *（Rev 4）RK1 失去可执行证据* → **已关闭**（`CLOSED_NOT_APPLICABLE`）：无用户历史 ⇒ 无需保行为 ⇒ 无「零漂移」义务。
- *（Rev 5）D17 死类型/死常量删除面未清点* → **Rev 5-B 全量检索**：`rg 'MatchStrategy|DEFAULT_STRATEGY' src tests` = **7 文件 / 32 处**，**全部并入 T1**；新增 `DEFAULT_MATCH_SETTINGS` 取代；A/B/C→四格对照仅留 `design §3.1`。**不新增任务 / 不改 Wave / 不新增破例 / 无悬空引用**（Rev 5-E/F/G）。
- *（Rev 5）T1 体量与可拆分性* → **T1 Profile 明确**：`deep` + 允许独立 worktree + **不可再拆**（拆即 TS2367/TS2322）；**失败预案**：计划外编译点可追加并逐条报告、契约变更须停报（Rev 5-D）。

**Guardrails Recommended**（已融入 Must NOT Have）:
- 不新增 npm 依赖；不放宽 eslint、不新增 `eslint-disable`；lint 判据 = **delta-0**。
- 不削弱**授权例外之外**的既有断言；`needs_recovery` 契约不得移除。
- 生产代码不得新增 `console.log`；不得新增 `as any`/`@ts-ignore`。
- 权限零扩张（不新增 permission/host_permission/command）。
- `src/ui` CJK 保持 0 命中；界面统一英文；新增控件满足 WCAG 2.1 AA。

---

## Work Objectives

### Core Objective

在**权限零扩张、不新增依赖、lint delta-0** 约束下，用 TDD 完成「行为一致性修复（item1/2）」+「策略三旋钮与四格严格语义（item3）」+「恢复窗与设置页重设计（item4）」，全部通过 `typecheck` 0 / `test:unit` / `test:integration` / `test:ui-smoke` / 三浏览器 build，并经**独立复验**。

### Concrete Deliverables

- [ ] **【T1 原子核心】** `src/background/switch/primitives.ts`（5 共享纯原语）+ `resolvers/combination-{1..4}.ts` + `resolve-switch.ts`
- [ ] **【T1】** `src/shared/types.ts` / `src/shared/messages.ts` — 形状与契约（**删 `globalStrategy`、删 `schemaVersion`**；新增 `DEFAULT_MATCH_SETTINGS`，**[Rev 5 · D17] 删除 `DEFAULT_STRATEGY` 常量与 `MatchStrategy` 类型定义（不留死类型/死常量）**）
- [ ] **【T1】** `src/background/storage-repository.ts` — **仅填新形状默认值（无迁移、无回写）** + `setMatchSettings`
- [ ] **【T1】** `src/background/slot-service.ts` — **A/B/C 分支与类型同一次改写为四格 resolver 调用**（`switchSlot` 全量）
- [ ] **【T1】** `src/background/import-export-service.ts` — 新形状导出；导入**只接受** `matchSettings`（旧导出文件 → `IMPORT_INVALID`）
- [ ] **【T1】** `src/ui/settings/App.tsx` — 三旋钮 + 方向 + autoBind + 每槽一行（**新语义直接落地**）
- [ ] **【T1】** `src/ui/import-preview/main.tsx` + `src/ui/shared/message-client.ts`（**X1**）— 形状与客户端方法同改
- [ ] **【T1】** `src/background/worker-orchestrator.ts` — 仅 `KNOWN_ACTIONS` 登记 6 个新 action（路由体在 T9）
- [ ] **【T3】** `scripts/gen-protected-prefixes.mjs` + 两个生成物 — `file://` 入列
- [ ] **【T3】** `tests/unit/shared/url-utils.test.ts:362-375` — 精确前缀期望数组同步加入 `'file://'`
- [ ] **【T8】** `src/background/slot-service.ts` — Position 后端（↑/↓）+ 方向感知 + 其余编排
- [ ] **【T6】** `src/background/recovery-service.ts` — Prev/Next 游标 + Open URL 收敛 + session 扩展
- [ ] **【T9】** `src/background/worker-orchestrator.ts` — `applySwitchOutcome` + 路由 + `SET_GLOBAL_STRATEGY`/`SET_SLOT_STRATEGY` 新 payload
- [ ] **【T10/T11】** `src/background/worker-orchestrator.ts` — 合流 + 开页诊断
- [ ] **【T12a】** `src/ui/sidebar/App.tsx` — `↑/↓` + 删误导 toast + footer 有界重试
- [ ] **【T12b】** `src/ui/recovery/{App,main}.tsx` — 恢复窗改造
- [ ] 四层测试 + 诊断记录 + F1–F5（输出到对话）

### Definition of Done

- [ ] ⭐**【Rev 6 · A-1】T1 为闭环完成**：`npm run typecheck` → **0 error** 且 `npm run test:unit` → **ALL PASS**（两命令输出为**权威适配清单**；T1 卡内清单 = **预期命中参考（非完备性要求）**）
- [ ] `npm run typecheck` → 退出码 0，0 error
- [ ] `npm run lint` → **delta-0**（新增 error/warning = 0；基线 642 err，before/after JSON 差集证明）
- [ ] `npm run test:unit` → 全绿（含新增纯函数/resolver/UI 用例）
- [ ] `npm run test:integration` → 全绿（含 `applySwitchOutcome` 映射、**新形状默认值归一**、合流）
- [ ] `npm run test:ui-smoke` → 全绿
- [ ] `npm run build:chrome` / `build:edge` / `build:firefox` → 三者成功
- [ ] `needs_recovery` 契约保留（`slot-service.test.ts:146/162`、`full-suite.test.ts:71/179` 通过）
- [ ] 每个任务含 ≥1「修复前失败、修复后通过」的测试（RED 证据落盘）
- [ ] F1–F5 全部 APPROVE（其中 F3 为独立复验）

### Must Have

- item1：侧边栏点击与快捷键产生**同一 `SwitchOutcome` 语义与同一副作用**；`Tab Not Found` 至多 1 窗
- item2：重复触发开页**至多 1 个**目标标签页；**根因定位有诊断证据**（可区分「两创造者竞速」vs「同 handler 被调两次」）
- item3：4 格严格按定义（组合 2 绝不回退 URL；组合 4 严格走位置环）；`↑/↓` Position（起点 = `anchorTabId`（侧边栏传 `lockedTabId ?? currentTabId`），失效降级当前活动页、不报错）；方向设置作用于单命令入口
- item4：恢复窗 `Open URL` 仅 Exact 展示；Prev/Next 点击不关窗可连点；特权页拦截走**既有** `PROTECTED_PAGE` domain error + 窗内报错 `This URL cannot be opened`（BLK-B / B2）；autoBind 三态（全局默认 + 槽位覆盖，设置页可查看/编辑）
- 旧 A/B/C → 新模型**仅作文档语义对照**（A→组合2、B→组合1/none、C→组合3），**仅保留为主设计 §3.1 markdown 表**（`design:146-154`，**【Rev 5 · D17】**：**不进入代码或类型**，`MatchStrategy` 类型与 `DEFAULT_STRATEGY` 常量**均已删除**）；**【Rev 4】** **不做迁移**：旧持久化数据被忽略、静默落到新默认 `exists+match+tabId`（不提示、不备份）；旧导出文件不再可导入
- `applySwitchOutcome` 为副作用唯一映射点；switch/open-page/recovery **in-flight 合流**
- 不新增依赖；权限零扩张；lint delta-0；`typecheck` 0；三浏览器 build 通过

### Must NOT Have (Guardrails)

- ❌ **禁止**新增 npm 依赖
- ❌ **禁止**放宽 `eslint.config.mjs` 严格度或新增 `eslint-disable`（既有 3 处不动）；lint 判据 = **delta-0**（不得以「lint 全绿」为判据）
- ❌ **禁止**削弱**授权例外之外**的既有断言；**授权例外**仅限**显式枚举**（Rev 3 / BLK-3 扩清单）：① `tests/integration/slot-service.test.ts`（`:107/133` 行为语义 + `globalStrategy/strategy` 夹具）；② `tests/unit/ui/settings.test.tsx`（`:96/109` UI 结构）；③ `tests/integration/recovery-service.test.ts`（Prev/Next 不再关窗/删 session 的语义变更，`:55-56` 等）；④ `tests/unit/ui/recovery-selector.test.tsx`（恢复窗重设计）；⑤ `tests/unit/ui/sidebar-open-page.test.tsx`（footer「重试优先」语义）；⑥ `tests/ui-smoke/pages.smoke.test.tsx`（**仅限** `ImportPreview` 形状适配 `:103-111` 与恢复窗 props 同步 `:83-98`；**【Rev 6 分工】** `:103-111` 归 **T1**（编译面，Commit 1）、`:83-98` 归 **T12b**（props，Commit 4））；⑦ 全部 `globalStrategy/strategy` **夹具适配**（31/37 处引用面）；⑧ **【Rev 4 新增 · 编译面形状适配专项】** 下列「非夹具但与契约强绑定」的测试改动亦**授权**：`tests/unit/ui/message-client.test.ts`（**X2** 客户端方法签名 + payload 断言）、`tests/unit/shared/messages.test.ts` 的 `DEFAULT_STRATEGY` import 与 `assertNever` case 补全（**X3 / X5**）、`tests/integration/slot-service.test.ts:135` 的显式实参（**X4**）、`tests/integration/full-suite.test.ts`（**X9**）、`tests/integration/storage-repository.test.ts` 与 `tests/integration/recovery-service.test.ts` 的 `RecoverySession` 显式夹具补字段（**X10**）、`tests/integration/worker-orchestrator.test.ts`、`tests/integration/import-export-service.test.ts`。——且**必须保留** `SwitchOutcome.type === 'needs_recovery'`（4 处锁定）；**不得削弱** `pages.smoke` 的**恢复窗渲染语义**（其「不得破坏」仅指渲染语义，**不冻结 UI 字面量**；**实际断言仅 `getAllByRole('button').length > 0`**，标题锁定在 `recovery-selector.test.tsx`）
- ❌ **禁止**新增 permission / host_permission / command（方向设置复用既有命令）
- ❌ **禁止**在 `src/ui/**` 引入 CJK（保持 0 命中）；界面统一英文
- ❌ **禁止**生产代码新增 `console.log`；新增 `as any`/`@ts-ignore`
- ❌ **禁止**改动三旋钮之外的策略语义；**【Rev 5 / D17】禁止以任何形式重新引入 `MatchStrategy` 类型或 `'A'|'B'|'C'` 变体**
- ❌ **禁止**新增 `SwitchOutcome` 变体（BLK-B / B2：撤销 `protected_blocked`，既有 4 变体不动；特权页拦截复用既有 `PROTECTED_PAGE` domain error）
- ❌ **禁止**新增持久化字段承载 Lock/`↑/↓` 锚点（BLK-A / A1：仅经载荷 `anchorTabId` 传入，Lock 保持内存态）
- ❌ **禁止**把计划拆成多文件（单一计划原则）
- ❌ **禁止**验收标准出现「用户手动测试/目视确认」
- ❌ **禁止**让 `slotService` 直接依赖 `windows+notifications`（副作用一律留 `applySwitchOutcome`）
- ❌ **禁止**缓存位置环/候选集（A14：实时查询）
- ❌ **【Rev 4 · 取代 Rev 3 的「占位边界」条目】**（原 BLK-1 方案 ① 的「T1 只做形状占位」边界**已整体废除**，因无兼容层、无占位期）改以下列约束：
- ❌ **禁止**保留/新增任何**兼容层或迁移代码**：不得读取旧 `globalStrategy`（读写皆禁）、不得做形状嗅探、不得新增 `schemaVersion`、不得写入任何迁移映射表；`migrateSyncState` **只允许填新形状默认值**
- ❌ **禁止**让旧导出文件参与导入成功路径（`matchSettings` 缺失/非法 → `IMPORT_INVALID`，**不得回退**读旧字段）
- ❌ **【Rev 5 / D17 取代 v4「类型可保留」】** **禁止保留** `DEFAULT_STRATEGY`（`types.ts:15`）**或** `MatchStrategy` 类型定义 / 常量**本身**（**不留死类型 / 死常量**）——`types.ts:8` 的类型与 `:15` 的常量**均须删除**；`'A'|'B'|'C'` 字面量**不得出现在 `src`/`tests` 任一位置**；A/B/C→新四格对照**仅允许存在于主设计 §3.1 markdown 表**（`design:146-154`），**不进入代码或类型**。可断言：`rg 'MatchStrategy' src tests` = 0、`rg 'DEFAULT_STRATEGY' src tests` = 0、`rg 'DEFAULT_MATCH_SETTINGS' src tests` ≥ 命中
- ❌ **禁止**在 T1 内做「分片提交」式的渐进改造：T1 必须是**单次原子改写**（契约 + 原语 + resolver + `slot-service` 分支 + 导入导出 + 设置页策略区），否则 TS2367 / TS2322 必然出现（Rev 4-B 实测）

---

## Design Conflicts & Findings（规划者独立复核，须执行期处理）

| ID | 级别 | 冲突/缺口 | 证据（实测） | 处置（已裁决，2026-09-30） |
|----|------|----------|-------------|---------|
| **BLK-A** | ~~需执行期裁决~~ **已裁决 → A1** | `POSITION_CURRENT_PREV/NEXT` 载荷原设计为 `{}`（§2.4/A6），但 D8 要「起点 = Lock tab」；侧边栏 Lock 是**内存态**（`sidebar/App.tsx:924-928` 的 `lockedTabRef`），background 无法从空载荷推知 | 设计 §2.4 vs D8/DT7 | ✅ **用户裁决 A1**：载荷改为 **`{ anchorTabId?: number }`**；侧边栏传 `lockedTabId ?? currentTabId`；background **不读**侧边栏内存态（Lock 仍不持久化）；严格满足 D8。**不新增持久化字段**。`anchorTabId` 失效（tab 已关闭）→ **降级为当前活动页、不报错**（DT7）。落地于 T1（载荷）/T12a（传参）/T8（consumption） |
| **BLK-B** | ~~低危~~ **已裁决 → B2** | 原计划新增 `SwitchOutcome.type === 'protected_blocked'` 但**无生产者**：`switchSlot` 允许切特权页（C2 明示激活类放行）；`RecoveryService.openUrl` 特权页拦截返回 domain error（`{success:false, errorCode}`）而非 outcome | 设计 §2.2/§3.2/A5 vs `recovery-service.ts:58-85` | ✅ **用户裁决 B2**：**撤销** `protected_blocked`；`SwitchOutcome` **既有 4 变体完全不动**；特权页拦截属**打开/导航**路径，`openUrl` 返回 `{ success:false, errorCode:'PROTECTED_PAGE' }`（复用既有 domain error，`types.ts:247`），由恢复窗走**既有窗内报错**路径渲染 `This URL cannot be opened`；`applySwitchOutcome` **不参与**该路径。落地于 T6（domain error + RED）/T12b（窗内渲染），映射表移除该行 |
| **GAP-C** | 落地遗漏 **（保留，须 RED）** | `ExportPayload.globalStrategy`（`types.ts:164`）与 `ImportPreview.globalStrategy`（`types.ts:183`）是旧形状载体，主设计 §9 未枚举，但新契约要求其随 `SyncState` 一同重塑 | `types.ts:159-185`、`import-export-service.ts:41-57/135-142/199` | **T1 一并重塑**（`matchSettings` + `switchDirection` + `autoBindGlobal`；**无 `schemaVersion`**）；导入形状校验单测 **RED 强制**（**X7**：`:89-103` 必须改为校验 `matchSettings`，否则 `IMPORT_INVALID` 永不触发） |
| **GAP-D** | 执行硬约束 **（保留，须 RED）** | 新增 5 个 action 若未登记进 `KNOWN_ACTIONS` 会被 `isKnownAction` 拒绝 | `worker-orchestrator.ts:43-84` | T1 同步登记 + RED（`known-actions.test.ts`）；T10 含「新 action 可被路由」的 RED |
| **BLK-1** | ~~致命~~ → **Rev 3 方案 ① 未闭合 → Rev 4 彻底闭环** | 删除 `SyncState.globalStrategy` 后，v3 仍以「占位适配 + 后续替换」组织 → 第二轮回审实测发现 **5 处 v3 未覆盖的编译点**（见 Rev 4-C） | 实测 **Rev 4-C 表**：`worker-orchestrator.ts:468-471`、`slot-service.ts:55/69/186/204`、`messages.ts:49`、`worker-orchestrator.ts:352`、`settings/App.tsx:156/166/176/1795-1796`、`tests/integration/storage-repository.test.ts:74/126/129/139/142`；**另加 Rev 4-E 的 X1–X10** | ✅ **Rev 4 结构性解法**：「**契约 + 派发骨架合并为一个原子任务**」（Rev 4-B）—— 删除占位期概念，`slot-service` 分支与类型**同一次改写**（消除 TS2367/TS2322）。**无 commit 级 typecheck 红区；无占位、无兼容层**。**N-1 因此自然消解** |
| **BLK-2** | ~~硬冲突~~ **已闭环（Rev 3）** | `file://` 入 canonical 与既有**精确前缀断言**冲突（`toEqual` 锁定 8 个前缀） | 实测 `tests/unit/shared/url-utils.test.ts:362-375` | ✅ **T3 显式登记该文件为同步更新点**（期望数组加 `'file://'`，`toEqual` 结构**保留不放宽**）；写入 T3 References/Must do/Acceptance/WHY |
| **BLK-3** | ~~自相矛盾~~ **已闭环（Rev 3）** | 授权例外清单未含被 T6/T12a/T12b 声明改写的测试文件；且 T12b「`pages.smoke` 不得破坏」与其字面量（`ImportPreview`/`RecoveryWindow` props）随契约必改**直接冲突** | 实测 `recovery-service.test.ts:55-56`、`recovery-selector.test.tsx`、`sidebar-open-page.test.tsx`、`pages.smoke.test.tsx:83-98/104-111` | ✅ **授权例外扩为显式枚举**（6 个测试文件 + 全部 `globalStrategy/strategy` 夹具）；`pages.smoke` 的「不得破坏」**仅指恢复窗渲染语义**；同步修正 Must NOT Have 与 F4 口径 |
| **D17** | **用户裁定（Rev 5 新增）** | v4 允许「`MatchStrategy` 类型定义保留（仅供文档对照）」；用户 **Q1-A 裁定收紧**为**彻底删除类型 + 常量**（不留死类型/死常量），新增 `DEFAULT_MATCH_SETTINGS` 取代；A/B/C→四格对照仅留 `design §3.1` | 实测 `rg 'MatchStrategy\|DEFAULT_STRATEGY' src tests` = **7 文件 / 32 处**（**Rev 5-B 表**）；`decisions.yaml:139-147`；`design:81-84/146-154` | ✅ **落入 T1**（32 处引用点全并入；不新增任务）；**静态断言** `rg 'MatchStrategy' src tests` = 0、`rg 'DEFAULT_STRATEGY' src tests` = 0、`rg 'DEFAULT_MATCH_SETTINGS' src tests` 命中；**D17 未新增「跨提交」破例点**（Rev 5-E 结构性结论；**「8/8 绿」已由 Rev 6-A-5 撤回为「Commit 1 由 T1 闭环保证、其余由 pre-commit 保证」**）；**无新增悬空引用**（Rev 5-F） |

> **结论**：BLK-A / BLK-B 已由用户裁决（A1 / B2）并**同步回写**设计文档与决策清单。BLK-1 / BLK-2 / BLK-3 为 **sw-plan-reviewer 复审发现的计划层缺陷**：BLK-2 / BLK-3 在 **Rev 3** 闭环；**BLK-1 在 Rev 3 未闭合，已由 Rev 4 以「原子任务合并」彻底闭环**（Rev 4-B / 4-C / 4-E），**设计层不变**。GAP-C / GAP-D 保留原结论并强化为**必须有 RED 证据**。**无阻断性 blocker。**
>
> **【Rev 4 新增裁决】** D10 / C4 / A8 = `SUPERSEDED`（不做兼容、不做迁移、无 `schemaVersion`）；RK1 = `CLOSED_NOT_APPLICABLE`。**仍然生效**：`SwitchOutcome` 4 变体冻结 + `needs_recovery` 4 处锁定。
>
> **【Rev 5 新增裁决 · D17】** 彻底删除 `MatchStrategy` 类型 + `DEFAULT_STRATEGY` 常量（**不留死类型/死常量**），新增 `DEFAULT_MATCH_SETTINGS`；A/B/C→四格对照仅留 `design §3.1` markdown 表。**落入 T1**（Rev 5-B 的 32 处引用点）；**不新增任务 / 不改 Wave / 不改关键路径 / 不新增破例 / 无悬空引用**（Rev 5-E/F/G）。

---

## ⚠️ RK1 — **已关闭（`CLOSED_NOT_APPLICABLE`）** + 仍生效的跨层契约

> **【Rev 4 · 用户裁定 2026-09-30】** **不做兼容、不做迁移**（应用**未公测、无用户历史**）⇒ **不存在「老用户行为变更」问题** ⇒ RK1 **关闭**（`decisions.yaml` 中 `status: CLOSED_NOT_APPLICABLE`，`closed_reason: "…不存在'老用户行为变更'问题；D10/C4/A8 已废弃"`）。

| 项 | 内容 |
|----|------|
| **状态** | `CLOSED_NOT_APPLICABLE`（**不再是本计划需要缓解的风险**） |
| **关闭理由** | 应用未公测、无用户历史 ⇒ 无「零漂移」义务；D10 / C4 / A8 全部 `SUPERSEDED` |
| **原缓解措施处置** | ①「迁移函数独立单测」**不再是强制项**（**T5 已删除**，无迁移函数存在）；②「显式携带 RK1」→ **改为「显式记录已关闭」**（本节）；③ F5 的「迁移零漂移」专项 → **改为「契约与形状专项」**（无 A/B/C 映射断言） |
| **补强建议处置** | 「迁移前后行为等价对照用例」**不再需要**（无迁移路径） |
| **仍然生效（`still_binding`：与用户配置无关的跨层契约）** | ① `SwitchOutcome.type === 'needs_recovery'` 被 `slot-service.test.ts:146/162` + `full-suite.test.ts:71/179`（**4 处**）锁定 → **不得移除**；② `SwitchOutcome` **4 变体冻结、不增不减**（B2 已撤销 `protected_blocked`）；③ `A1`（`{ anchorTabId?: number }`）与 `B2`（`PROTECTED_PAGE`，无 `protected_blocked`）不变；④ 其余设计与决策 **D1–D9 / D11–D16、C1–C3 / C5–C7、A1–A7 / A9–A14、DT1–DT9 不变**；⑤ **【Rev 5 · D17】** `MatchStrategy` 类型与 `DEFAULT_STRATEGY` 常量**不得保留**（不留死类型/死常量），A/B/C→四格对照**仅**留 `design §3.1` markdown 表 |

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — 全部验证由 agent 执行。禁止「用户手动测试/目视确认」。

### Test Decision

- **Infrastructure exists**: YES（Vitest 2 workspace：`unit` / `integration` / `ui-smoke`；`tests/setup.ts`；`@testing-library/react` 16；`mock-adapter` 可编程桩）
- **Automated tests**: **TDD** — 每任务 RED（失败测试）→ GREEN（最小实现）→ REFACTOR
- **RED 可构造性要求**：每个新测试必须先在**未修复代码**上运行并观察到失败，执行者须在证据文件记录 RED 输出
- **主力 = 纯函数单测**：4 resolver 穷举（含反例）+ 共享原语；**无 adapter**，直接断言返回值
- **【Rev 4 修正】合流的 RED**：in-flight 合流以并发用例构造 RED（不依赖旧行为用例）。**迁移 RED 一节已删除**（无迁移；RK1 已关闭）
- **【Rev 5 · D17】死代码删除的 RED**：`MatchStrategy`/`DEFAULT_STRATEGY` 的删除以**静态断言翻转**构造 RED —— 修改前 `rg 'MatchStrategy' src tests` 非 0（命中）→ 删除后归 0；`DEFAULT_MATCH_SETTINGS` 由「模块无此导出」→「存在且值正确」（T1 RED ⑤）

### 强制独立复验（不采信执行者自审）

> 上一轮教训：执行者自审 APPROVE，却漏掉真实功能缺口（N5/N6/N7）。本计划将**独立复验**作为 F3 的强制验收项：
> - F3 由**未参与实现**的审查者独立执行每个任务的 QA 场景，重跑 RED/GREEN、独立读 `git diff`、独立核对契约（`needs_recovery` 等 4 处锁定）。
> - F3 输出必须包含**独立复现命令与原始输出**，不得引用执行者证据文件作为通过依据。

### QA Policy

每任务必须有 agent 可执行 QA 场景；证据落盘 `_context-output/evidence/task-{ID}-{slug}.txt`。
- **纯函数/resolver**：`npx vitest run <file>` — 断言返回值
- **集成/服务**：`npx vitest run tests/integration/<file>` — mock-adapter 断言 `adapter.calls`（如 `windows.create` / `tabs.create` / `notifications.create` 计数）
- **UI**：`npx vitest run tests/unit/ui/<file>` — Testing Library 断言 DOM/交互
- **静态**：`npm run typecheck`；`npx eslint src tests --format json`（delta 比对）
- **构建**：`npm run build:chrome|edge|firefox`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (原子核心 + 独立前缀 — 文件互不重叠):
├── T1: 【原子核心】契约 + 原语 + resolver + slot-service 分支 + 导入导出 + 设置页策略区
│        + 【Rev 5 · D17】删除 MatchStrategy/DEFAULT_STRATEGY 死代码（32 处）+ 新增 DEFAULT_MATCH_SETTINGS
│        Profile: deep · 允许独立 worktree · 不可再拆（NO-FURTHER-SPLIT）
│        Files: types.ts / messages.ts / switch/** / storage-repository.ts / slot-service.ts /
│               import-export-service.ts / ui/import-preview/main.tsx / ui/shared/message-client.ts /
│               ui/settings/App.tsx / worker-orchestrator.ts(KNOWN_ACTIONS) + 测试侧显式标注面
└── T3: file:// 入 canonical 前缀（gen-protected-prefixes.mjs + 重跑 + url-utils.test.ts 期望数组）

Wave 2 (服务层 — 与 T1 无文件重叠):
└── T6: recovery-service.ts 改造（Prev/Next 游标 + Open URL 收敛 + session 扩展）

Wave 3 (编排采用 + 恢复窗 UI):
├── T8: slot-service.ts Position 后端（anchorTabId）+ 方向感知 + 其余编排（依赖 T1）
└── T12b: recovery/{App,main}.tsx（恢复窗改造）← 依赖 T6

Wave 4 (编排层 — 独占 worker-orchestrator.ts，串行):
└── T9: applySwitchOutcome + 新 action 路由 + SET_GLOBAL_STRATEGY/SET_SLOT_STRATEGY payload（依赖 T1、T6、T8）

Wave 5 (幂等与诊断 — 依赖 T9，同文件串行):
├── T10: in-flight 合流（switch / open-page / recovery）+ 单创造者（依赖 T9）
└── T11: item2 根因定位诊断记录（依赖 T10）

Wave 6 (侧边栏 UI):
└── T12a: sidebar/App.tsx（↑/↓ + 删 toast + footer 有界重试）← 依赖 T9、T10、T11

Wave FINAL (全部实现之后 — 5 路并行审查，后取用户 okay):
├── F1: Plan Compliance Audit
├── F2: Code Quality Review（含 delta-0 lint 比对）
├── F3: **独立复验**（Real QA，不采信执行者自审）
├── F4: Scope Fidelity Check
└── F5: 契约与形状专项审计（needs_recovery 4 处锁定 + 4 变体冻结 + 无兼容层核查）
→ 呈现结果 → 取用户显式 okay

Critical Path: T1 → T8 → T9 → T10 → T11 → T12a → F1–F5 → user okay
```

### Dependency Matrix

```
- T1: No deps（W1）—— 原子核心；Blocks: T6、T8、T9、T12a、T12b
- T3: No deps（W1）—— 与 T1 **无文件重叠**（仅 `scripts/` + two generated + `url-utils.test.ts`）
- T6: deps T1、T3（同 recovery-service.ts 独占；`RecoverySession` 类型扩展依赖 T1 的 types.ts）
- T8: deps T1（契约 `matchSettings` + 原语/resolver 已在 T1 落地），独占 slot-service.ts（**注**：T8 与 T6 无文件重叠 → 可并行）
- T9: deps T1、T6、T8，独占 worker-orchestrator.ts（与 T10/T11 串行）
- T10: deps T9（同文件 worker-orchestrator.ts 串行）
- T11: deps T10（同文件 worker-orchestrator.ts 串行）
- T12a: deps T9、T10、T11，独占 sidebar/App.tsx
- T12b: deps T6（**不与 T9 耦合**：恢复窗 UI 只依赖 `errorCode`/`autoBind` 契约，payload 形状已在 T1 定型），独占 recovery/*
- F1–F5: deps ALL（T1、T3、T6、T8、T9、T10、T11、T12a、T12b）
- Longest chain（关键路径）: T1 → T8 → T9 → T10 → T11 → T12a → F1–F5
```

> **【Rev 4 顺序说明（取代 Rev 3）】** T1 是**唯一**触碰 `slot-service.ts` 业务分支的任务吗？——**不是**：T1 完成 `switchSlot` 的**策略分支改写**（消除 TS2367/2322 的必要动作），T8 在此之上补 **Position 后端 + 方向感知 + 编排**。两者**串行**（T8 `deps T1`），**非并行写同一文件**。
> `import-export-service.ts` / `settings/App.tsx` / `ui/import-preview/main.tsx` / `ui/shared/message-client.ts` 由 **T1 一次性完成**（不再有后续任务触碰），因此**不产生并行文件冲突**。
> **T7 / T12c / T2 / T4 / T5 已不存在**，其原文件归属全部并入 T1（见 Rev 4-B 映射表）。
> **T12b 不再 `deps T9`**（Rev 3 曾写 `deps T6、T9`）—— 恢复窗 UI 的 message 形状在 T1 已定型，T9 只做 background 路由，二者无编译耦合；此改动**不产生悬空引用**。
> **【Rev 5 · D17】依赖不变**：D17 的 32 处引用点**全部并入 T1**，**不新增任务、不新增依赖边**。T1 仍 `No deps` + 独占 Wave 1（与 T3 并行）；**T1 允许独立 worktree 执行**（Profile：`deep` + NO-FURTHER-SPLIT）。**Wave / 关键路径 / 提交数均不变**（Rev 5-G）。

### Agent Dispatch Summary

```
- Wave 1: 2 tasks — T1->deep, T3->quick
- Wave 2: 1 task  — T6->deep
- Wave 3: 2 tasks — T8->deep, T12b->quick
- Wave 4: 1 task  — T9->deep
- Wave 5: 2 tasks — T10->deep, T11->unspecified-high
- Wave 6: 1 task  — T12a->deep
- Wave FINAL: 5 tasks — F1->oracle, F2->unspecified-high, F3->deep(独立), F4->deep, F5->oracle
```

> **注**：Wave 划分按**文件冲突**串行化 + 依赖最小化。Wave 2/4/6 为单任务（`recovery-service.ts` / `worker-orchestrator.ts` / `sidebar/App.tsx` 均为独占文件），非并行性缺陷，而是**文件独占的必然结果**。
> **【Rev 5 · D17】T1 执行 Profile**：`Category: deep` + **允许独立 worktree** + **不可再拆（NO-FURTHER-SPLIT）**——T1 为全计划最大单任务（~40 文件），D17 的 32 处引用点并入后仍**不新增文件**；**拆即破坏 TS 一致性（TS2367/TS2322，已实测）**。**Wave 结构 / 关键路径 / 提交数不变**（Rev 5-G）。

### Rev 6-F · 执行者启动须知（EXECUTOR STARTUP — 定稿后进入执行）

**① Wave 执行顺序（严格按依赖，不得跳波）**：

```
Wave 1 : T1（原子核心，独立 worktree）∥ T3（file:// 前缀）
Wave 2 : T6（recovery-service.ts）
Wave 3 : T8（slot-service.ts，deps T1）∥ T12b（recovery UI，deps T6）
Wave 4 : T9（worker-orchestrator.ts，deps T1/T6/T8）
Wave 5 : T10（合流）→ T11（诊断）—— 同文件串行，deps T9
Wave 6 : T12a（sidebar/App.tsx，deps T9/T10/T11）
FINAL  : F1–F5 并行（F3 = 独立复验，不采信执行者自审）→ 取用户显式 okay
关键路径: T1 → T8 → T9 → T10 → T11 → T12a → F1–F5
```

**② T1 的 worktree 要求**：
- `Category: deep`；**允许（并建议）独立 worktree** —— 隔离执行，避免与 Wave 1 的 T3 及后续 Wave 的文件争用。
- **NO-FURTHER-SPLIT**：**不得**把 T1 拆成多任务 / 多次提交（拆即重现 `TS2367` / `TS2322`）。
- T1 独占 **10 个生产文件 + 10+ 个测试文件 + 新建 `src/background/switch/**`**。

**③ 每提交 pre-commit（8 提交，逐一执行）**：

| 提交 | 任务 | pre-commit |
|---|---|---|
| Commit 1 | T1 | `npm run typecheck && npm run test:unit && npm run test:integration`（**另需自跑 `npm run test:ui-smoke`**，因新增 `pages.smoke.test.tsx` 形状适配） |
| Commit 2 | T3 | `npm run typecheck && npm run test:unit` |
| Commit 3 | T6 | `npm run typecheck && npm run test:unit && npm run test:integration` |
| Commit 4 | T12b | `npm run typecheck && npm run test:unit && npm run test:ui-smoke` |
| Commit 5 | T8 | `npm run typecheck && npm run test:integration` |
| Commit 6 | T9 | `npm run typecheck && npm run test:integration` |
| Commit 7 | T10 + T11 | `npm run typecheck && npm run test:integration` |
| Commit 8 | T12a | `npm run typecheck && npm run test:unit && npm run test:ui-smoke` |

> **Commit 1 的绿 = T1 完成判据（`typecheck` 0 error + `test:unit` ALL PASS）；Commit 2–8 的绿 = 各自 pre-commit。**（Rev 6-A-5：不再断言「已实测 8/8 绿」。）

**④ ⭐ 强制交付要求：必须在交付报告中逐条列出「实际改动面」**：
- 闭环执行（A-3）过程中**纳入 T1 的每一处计划外编译 / 断言点**，均须逐条列出：**`文件:行` + `TS 错误码`（或 `用例名`）+ 归入 T1 的理由**。
- **禁止静默扩大范围（silent scope creep）** —— 报告中「实际改动面清单」须与 `git diff` **一致或为其忠实超集**（**F3 / F4 将独立核对**）。
- **触发 STOP & ESCALATE 的情形**（**不得自行变更，须停报**）：需改动 **`SwitchOutcome` 变体数** / **A1（`anchorTabId`）口径** / **B2（`PROTECTED_PAGE`，无 `protected_blocked`）口径** / **`matchSettings` 字段集** / **消息 action 集合超出 D17 / 设计授权**。

**⑤ 定稿后不得回归的清单（执行期红线）**：护栏 8 项（不新增依赖 / 不放宽 eslint / 不新增 `eslint-disable` / lint delta-0 / typecheck 0 / 三浏览器 build / WCAG 2.1 AA / `src/ui` CJK 0 / F3 独立复验）· `SwitchOutcome` 4 变体冻结 · A1 · B2 · 不做迁移 / 无 `schemaVersion` / 旧导出 → `IMPORT_INVALID` · D17 · 任务数 9 + F1–F5 · Wave 6 + FINAL · 关键路径 · 8 提交 · 授权例外 8 项。

---

## TODOs

> Implementation + Test = ONE Task. 每任务 MUST 有 What/Must NOT/Agent Profile/Parallelization/References/Acceptance/QA（≥1 failure）/Commit。
> **TDD 铁律**：先写测试并观察 RED，再实现 GREEN，最后跑门禁。

### Wave 1 — 原子核心 + 独立前缀

- [x] T1. **【原子核心 · Rev 4 合并任务 + Rev 5 · D17 死代码删除】** 契约重塑（`SyncState` 三旋钮，**无 `globalStrategy`、无 `schemaVersion`**）+ **彻底删除 `MatchStrategy` 类型 / `DEFAULT_STRATEGY` 常量（新增 `DEFAULT_MATCH_SETTINGS`）** + 共享纯原语 + 4 resolver + `slot-service` 策略分支同次改写 + 导入/导出 + 设置页策略区（`SwitchOutcome` 维持既有 4 变体）

  > **合并来源**：原 T1（契约）+ 原 T2（原语）+ 原 T4（resolver）+ 原 T8 的策略分支部分 + 原 T7（导入导出）+ 原 T12c（设置页策略区）+ **【Rev 5 · D17】死类型/死常量删除面（32 处引用点）**。**理由**：无兼容层 ⇒ 无占位期 ⇒ 类型与分支必须**同一次改写**（否则 `TS2367: types 'MatchRuleSettings' and 'string' have no overlap` / `TS2322: Type 'string' is not assignable to type 'MatchRuleSettings'`，team-lead 已实测复现）；**D17 删除 `MatchStrategy` 类型后，其 32 处消费者必须同提交替换，否则悬空 → 故一并归 T1**（Rev 5-B / 5-F）。

  > ⭐ **【Rev 6 · A-1 完成判据（闭环式，取代「人工穷举」）】** **T1 完成 ⇔ `npm run typecheck` → 0 error 且 `npm run test:unit` → ALL PASS。** 此两条命令的输出即**权威适配清单**；**完备性由 `tsc` / `vitest` 定义，人工清单不定义完备性**。**`test:unit` 范围 = `vitest run --project unit`**（`vitest.workspace.ts:17-23`，`include: ['tests/unit/**/*.test.{ts,tsx}']`）。**Commit 1 pre-commit 保留 `test:integration`**（超集，不回退）。
  > ⭐ **【Rev 6 · A-2 定性】** 本卡内下文（及 Rev 4-E X1–X10 / Rev 5-B 32 处 / Rev 4-C 残余 #1–#5）列出的**全部适配点 = 「预期命中参考（EXPECTED-HIT REFERENCE）—— 非完备性要求（NOT A COMPLETENESS REQUIREMENT）」**。作用是**降低首轮返工**，**不是** T1 验收边界；**T1 验收边界 = 上面的闭环判据**。**复审不得以「本清单是否完备」判 `NOT OKAY`。**
  > ⭐ **【Rev 6 · A-4 失败预案】** ① **计划外编译 / 断言点**（闭环修错时由 `tsc` / `vitest` 报出）→ **允许就地纳入 T1**，但**必须在交付报告中逐条列出**（文件:行 + TS 错误码 / 用例名 + 理由），**禁止静默扩大范围**；② **需改动「已定契约」**（尤其 `SwitchOutcome` 变体数、A1 / B2 口径、`matchSettings` 字段集、消息 action 集合超出 D17 / 设计授权）→ **必须停止并上报（STOP & ESCALATE）**，**不得自行变更**。

  **What to do**:
  - `src/shared/types.ts`：
    - 新增 `export type TabIdMode = 'exists' | 'no-exists'`（**连字符**）、`RuleCheckMode = 'match' | 'no-match'`、`Priority = 'tabId' | 'rule-check' | 'none'`、`interface MatchRuleSettings { tabIdMode; ruleCheckMode; priority }`。
    - **[裁定 1]** `SyncState`（`:189-194`）：**删除 `globalStrategy`**；新增 `matchSettings: MatchRuleSettings`（**直接取代**）、`switchDirection: 'previous' | 'next'`、`autoBindGlobal: boolean`；保留 `slots` / `rules` / `configVersion`。**[裁定 2]** **不新增 `schemaVersion`**（无版本锚点）。
    - **[X3 / Rev 5 · D17]** **删除 `DEFAULT_STRATEGY`（`:15`）**，新增 `export const DEFAULT_MATCH_SETTINGS: MatchRuleSettings = { tabIdMode:'exists', ruleCheckMode:'match', priority:'tabId' }`（**新默认 = 组合 1 + `priority=tabId`**，D9）。
    - **[Rev 5 · D17]** **删除 `MatchStrategy` 类型定义（`:8`）** —— **不留死类型**（D17 #1；用户已否决「保留类型供文档对照」的 `RECOMMENDED-B` 方案，`decisions.yaml:144`）；**同时删除 `:10-14` 的 A/B/C 语义注释块**（其内容已由 `design §3.1` markdown 表承载，不留对照残留）；`:54` 的 `MatchStrategy | 'inherit'` 改 `'inherit' | MatchRuleSettings`。
    - `SlotDefinition.strategy`（`:54`）改为 `'inherit' | MatchRuleSettings`；新增 `autoBindOverride?: boolean`（undefined = 继承 `autoBindGlobal`）。
    - `SwitchOutcome`（`types.ts:272-276`）**保持既有 4 变体完全不动**（`switched`/`no_match`/`needs_recovery`/`incognito_blocked`）。**【BLK-B / B2】撤销 `protected_blocked`**：特权页拦截用**既有** `PROTECTED_PAGE`（`:247`，**只读复用**）。**不得移除 `needs_recovery`**。
    - **GAP-C**：`ExportPayload`（`:164`）/ `ImportPreview`（`:183`）的 `globalStrategy` 改为 `matchSettings` + `switchDirection` + `autoBindGlobal`（**不加 `schemaVersion`**）。
    - **[Rev 5 · D17 取代 v4]** ~~`MatchStrategy`（`:8`）类型定义**可保留**但仅供文档语义对照~~ → **删除 `MatchStrategy` 类型定义（`:8`）**（**不留死类型**）；A/B/C→四格对照**仅保留为 `design §3.1` markdown 表**（`design:146-154`），**不进入代码/类型**。
  - `src/shared/messages.ts`：
    - **`:9` `import { MatchStrategy }` → 改为 import `MatchRuleSettings`**（D17 删除类型后**必须同改**，否则悬空 import）。
    - **3 重塑**：`SetGlobalStrategyRequest.payload`（`:151`）→ `{ matchSettings: MatchRuleSettings }`；`SetSlotStrategyRequest.payload`（`:156`）→ `{ slotId, strategy: 'inherit' | MatchRuleSettings }`；`RecoveryNextMatchRequest` / `RecoveryOpenUrlRequest`（`:165-173`）扩展 `{ recoveryId, autoBind: boolean }`。
    - **[裁定 6 修正]** **6 新增**（v3 误写 5）：`SET_SWITCH_DIRECTION` `{ direction }`、`SET_AUTO_BIND_GLOBAL` `{ enabled }`、`SET_SLOT_AUTO_BIND` `{ slotId, override: boolean | null }`、`POSITION_CURRENT_PREV` / `POSITION_CURRENT_NEXT`（**BLK-A / A1**：`{ anchorTabId?: number }`）、`RECOVERY_PREV_MATCH` `{ recoveryId, autoBind }`。
    - `SaveSlotRequest.payload.strategy`（`:49`）→ `'inherit' | MatchRuleSettings`（**BLK-1 残余 #2**）。
    - **4 不变**：`SWITCH_SLOT`、`NEXT/PREV_MATCH_SLOT`、`NEXT/PREV_MATCH_CURRENT`。
    - 全部新/改 action 加入 `UiRequest`（`:295-333`）与 `UiAction`（`:432`）。
  - **新建 `src/background/switch/primitives.ts`**（原 T2）：5 个**纯函数**（无 adapter、无 I/O）——`ruleCheckTabMatch` / `findMatchCandidates` / `buildPositionRing` / `applyPriority` / `focusOrStep`；**必须 import 复用** `matchesUrl`（`url-utils.ts:408`）与 `sortCandidates`（`:426-449`），**不得重写匹配逻辑**（A7）。
  - **新建 `src/background/switch/resolvers/combination-{1..4}.ts` + `resolve-switch.ts`**（原 T4）：四格严格语义（`design §3` 为唯一真源）；resolver **只编排、禁止重写原语**、**禁做 I/O**。
  - **`src/background/storage-repository.ts`（直改新语义，非占位）**：
    - `:74-81` `createDefaultSyncState()` → 新形状（`DEFAULT_MATCH_SETTINGS` + `switchDirection:'next'` + `autoBindGlobal:true`；**删 `globalStrategy`**）。
    - `:171-179` `migrateSyncState()` → **仅填新形状默认值**：`{ configVersion: state.configVersion ?? 0, matchSettings: DEFAULT_MATCH_SETTINGS, switchDirection: 'next', autoBindGlobal: true, slots: state.slots ?? [], rules: state.rules ?? [] }` —— **不读旧 `globalStrategy`、不做形状嗅探、不回写、不递增 `configVersion`**（裁定 3）。
    - `:615` `setGlobalStrategy(strategy: MatchStrategy, expectedVersion)` → 改名 **`setMatchSettings(settings: MatchRuleSettings, expectedVersion)`**（**形参类型 `MatchStrategy` → `MatchRuleSettings`**，D17 删类型后悬空；写 `state.matchSettings`）；新增 `setSwitchDirection` / `setAutoBindGlobal` / `setSlotAutoBindOverride`（本地 mutator，沿用 `writeSync`）。
    - `:18` `import { …, MatchStrategy }` → **删除**该 import 成员（D17 删类型后悬空）；`:26` `import { DEFAULT_STRATEGY }` → `DEFAULT_MATCH_SETTINGS`。
  - **`src/background/slot-service.ts`（策略分支与类型同次改写 —— Rev 4-B 核心）**：
    - `:19` `import { …, MatchStrategy }` → **删除该 import 成员并改 import `MatchRuleSettings`**（D17）；`:55` `saveSlot(..., strategy?: MatchStrategy | 'inherit')`（`:51-56`）→ `'inherit' | MatchRuleSettings`；`:66-75` 字面量 `strategy: strategy ?? 'inherit'`；`:112-121` `saveSlotFromData` 的 `strategy:'inherit'` 保持合法。
    - `:174-177` 有效策略读取：`slot.strategy === 'inherit' ? sync.matchSettings : slot.strategy` → **解析为四格组合**。
    - `:186` / `:204` 的 `effectiveStrategy === 'A' | 'B'` 与 `:237-272` 的「全搜 + 回退」**合并替换为** `resolveSwitch({ settings, binding, candidates, activeTabId, direction })` 调用 + 按 `Resolution` 执行 I/O（`activateTabById` / `createRecoverySession`）。**`TS2367` 由此消除**（不再有 `MatchRuleSettings` 与 `'A'|'B'` 的比较）。
    - **本任务只改 `switchSlot` 的策略分派**；**Position 后端（↑/↓）与方向感知留 T8**（该文件两者串行，见 Dependency Matrix）。
  - **`src/background/import-export-service.ts`（原 T7，直改新语义）**：
    - `:17` `import { …, MatchStrategy }` → **删除**该 import 成员（D17 删类型后悬空）；`:23` `import { DEFAULT_STRATEGY }` → `DEFAULT_MATCH_SETTINGS`；`:41-57` `exportConfig` → `ExportPayload` 输出 `matchSettings` + `switchDirection` + `autoBindGlobal`（**删 `globalStrategy`**）。
    - `:89-103` **[X7 / D17]** `generatePreview`：`:103` 的 `(data.globalStrategy as MatchStrategy) ?? DEFAULT_STRATEGY` **整行删除**（**不得残留 `as MatchStrategy` 强转**，否则 `rg 'MatchStrategy' src` 命中非 0）；**改为校验 `matchSettings` 形状合法**（缺失/非对象/字段越界 → `{ success:false, errorCode:'IMPORT_INVALID' }`）；**不读旧 `globalStrategy`**（裁定 4：旧导出文件不再可导入）。`:135-142` `ImportPreview` 构造随新形状。
    - `:174-202` `commitImport`：`state.globalStrategy = preview.globalStrategy` → `state.matchSettings = preview.matchSettings`（+ `switchDirection` / `autoBindGlobal`）；**保持单次 `writeSync` 版本递增语义**。
  - **`src/ui/import-preview/main.tsx:14`**：`ImportPreview` 字面量 → `{ valid:true, slotConflicts:[], newSlots:[], rules:[], matchSettings: DEFAULT_MATCH_SETTINGS, switchDirection:'next', autoBindGlobal:true, configVersion:0 }`。
  - **`src/ui/shared/message-client.ts:245-251`【X1，v3 未登记】**：`setGlobalStrategy` → `setMatchSettings(matchSettings)` 发 `{ matchSettings }`；`setSlotStrategy(slotId, strategy)` 签名改为 `'inherit' | MatchRuleSettings` 并原样透传（**收紧签名** ⇒ 同步处理 X2）。
  - **`src/ui/settings/App.tsx`（原 T12c，直改新语义）**：
    - `:16` `import type { MatchStrategy, … }` → **改 import `MatchRuleSettings`**（D17 删类型后悬空）；`:137-143` `StrategySectionProps` 改新 props（`matchSettings` / `switchDirection` / `autoBindGlobal` / `slots` / `onGlobalChange` / `onSlotChange` / `onDirectionChange` / `onAutoBindGlobalChange` / `onSlotAutoBindChange`）；**[D17] `:138` / `:141` / `:142` 的 `MatchStrategy` 标注全部改为 `MatchRuleSettings`**（**D17 引用点**）、`:202` 的 `as MatchStrategy | 'inherit'` → `as 'inherit' | MatchRuleSettings`（新 UI 下随三旋钮重写）。
    - `:145-218` `StrategySection` **重写**为 DT6/DT8①：三旋钮 select（`Tab ID`：`Exists`★/`No tab ID`；`Rule Check`：`Match`★/`No match`；`Priority`：`Tab ID`★/`Rule Check`/`None`）+ `Switch Direction`（`Previous Match`/`Next Match`★）+ `Auto-bind switched tabs to their slot`（☑）；**每槽一行**（`Strategy`: `Inherit global`★/`Custom`，`Custom` 展开 3 select；`Auto-bind`: `Follow global`★/`Always on`/`Always off`）。
    - `:156/166/176` 的 `globalStrategy === 'A'|'B'|'C'` → **删除**（TS2367 由此消除）。
    - `:1623` `<li>Global Strategy: {preview.globalStrategy}</li>` **[X8]** → 改为渲染 `preview.matchSettings` 的三字段（或移除该行），**文案与 DT8 一致、英文、无 CJK**。
    - **D17 引用点（全部改 `MatchRuleSettings`）**：`:1771` `useState<MatchStrategy>('B')` → `useState<MatchRuleSettings>(DEFAULT_MATCH_SETTINGS)`（+ 新增 `switchDirection` / `autoBindGlobal` state）；`:1795` `as { globalStrategy: MatchStrategy; … }` → `as { matchSettings: MatchRuleSettings; … }`、`:1796` 读取改新字段 **[BLK-1 残余 #4]**；`:1821` `handleGlobalChange = (strategy: MatchStrategy)` → `(settings: MatchRuleSettings)`、改发 `{ matchSettings }`、新增方向/autoBind 处理器（`:1821-1836`）；`:1838` `handleSlotChange = (slotId, strategy: MatchStrategy | 'inherit')` → `'inherit' | MatchRuleSettings`（`:1838-1852`）；`:1896-1904` props 传递同改。
  - **`src/background/worker-orchestrator.ts`（本任务仅 `KNOWN_ACTIONS` + 单行兼容消除属 T1 编译面）**：
    - `:43-84` `KNOWN_ACTIONS`：**登记 6 个新 action**（GAP-D）。
    - `:346-354` `SAVE_SLOT` 路由体：`request.payload.strategy` 透传（类型随 `messages.ts` 变化）**[BLK-1 残余 #2]**。
    - `:468-471` `SET_GLOBAL_STRATEGY` **[BLK-1 残余 #1]**：`this.repo.setMatchSettings(request.payload.matchSettings, version)`。
    - `:473-494` `SET_SLOT_STRATEGY`：`:484` / `:493` 的 `strategy: request.payload.strategy` 类型随契约（**TS2322 由此消除**）。
    - **`applySwitchOutcome` / 新 action 路由在 T9**（本任务不做行为）。
  - **测试侧显式类型标注适配（`tsconfig.include` 含 `tests`）**：
    - `tests/unit/shared/messages.test.ts`：`:139` / `:257` `SyncState` 夹具改新形状；`:127` 的 `strategy:'inherit'` 合法；**[X3]** `:19` / `:199-200` 的 `DEFAULT_STRATEGY` import 与 `toBe('B')` → 改 `DEFAULT_MATCH_SETTINGS`；**[X5]** `:28-69` `handleUiAction` **补 6 个 `case`**（否则 `assertNever` 编译失败）。
    - `tests/unit/ui/import-diagnostics.test.tsx:7/15` `ImportPreview` 夹具 → 新形状。
    - `tests/integration/storage-repository.test.ts`：`:22` / `:96` 读取改 `matchSettings`；`:30` / `:100` `SlotDefinition` 夹具的 `strategy:'B'` → 改 `MatchRuleSettings` 或 `'inherit'`；**[BLK-1 残余 #5]** `:74` / `:126` / `:129` / `:139` / `:142` 的 `repo.setGlobalStrategy('A'|'C', n)` → `repo.setMatchSettings(<MatchRuleSettings>, n)`；`:84` / `:342` / `:380` / `:417` **[X9]** 未标注 storage 字面量顺带更新。
    - `tests/integration/worker-orchestrator.test.ts:30` 读取改 `matchSettings`；`tests/integration/import-export-service.test.ts:187` / `:398` 读取改 `matchSettings`（`:48/69/93/136/163/198/262/296` 的 `globalStrategy:'B'|'A'|'C'` 未标注字面量 **[X9]** 顺带更新为 `matchSettings`；`:136` 的 `'A'` 用例改为**断言旧形状被拒**）。
    - **[X4]** `tests/integration/slot-service.test.ts:135`（`saveSlot(1, 0, undefined, 'C')`）→ 第 4 实参改为 `MatchRuleSettings`（**编译面**）。
    - **[X2]** `tests/unit/ui/message-client.test.ts:56` / `:88` / `:62` / `:193` → `setMatchSettings(...)` + `payload: { matchSettings: ... }`。
    - `tests/integration/full-suite.test.ts:110-138`（导入链路含 `globalStrategy:'A'`）→ 改为**新形状导入用例**（`matchSettings`）或**旧形状被拒用例**；`:201-206` **[X9]** 未标注字面量顺带更新。
    - **【Rev 6 · BLOCKER-1 编译面（T1 必改）】** `tests/ui-smoke/pages.smoke.test.tsx:103-111`：`<ImportPreviewTable preview={{ … globalStrategy:'B' … }} />` 是**对象字面量直传具体类型 prop** → 删 `globalStrategy` 后报 **TS2353**（非已知属性）+ **TS2741**（缺 `matchSettings` 等必需属性）。**适配 = 补 `matchSettings: DEFAULT_MATCH_SETTINGS` / `switchDirection: 'next'` / `autoBindGlobal: true`，删 `globalStrategy`。定性 = 编译面（T1 必改）**（`tsconfig.include` 含 `tests` → 不修则 T1 闭环判据不成立）。该文件 `:83-98` 的 `<RecoveryWindow>` props **仍归 T12b**（T1 不触碰 `:83-98`）。
    - **【Rev 6 · BLOCKER-2】** `tests/unit/ui/settings.test.tsx`：`:96`（`radio` `/B\./` checked）、`:109`（`combobox` `/Strategy for slot/` 计数 = 10）、`:122`（`SET_GLOBAL_STRATEGY` payload `{ strategy:'C' }`）**三用例在三旋钮重写后必红** → 随新 UI 语义重写（**授权例外-②**）。该文件属 `test:unit` 项目 ⇒ `test:unit` 会强制拉入，但**仍显式登记**（防执行者视为范围外而静默红）。
    - **判定边界（Rev 3 沿用；【Rev 6 · A-2】整段仅为「预期命中参考」）**：**编译期报错的显式类型标注 / 属性读取 / 对象字面量直传 = 必改**；**未标注 mock 字面量 / `unknown` 通道 = 运行期断言**，由归属任务顺带更新（不破坏 typecheck）。**最终完备性以 `npm run typecheck` 0 error + `npm run test:unit` ALL PASS 为准。**
  - **【Rev 6 · NIT-4】`sync.matchSettings` 缺失兜底（新增实现要求）**：所有新实现中**读取 `sync.matchSettings`** 的点**必须**做 `?? DEFAULT_MATCH_SETTINGS` 兜底（读侧防御）。**依据**：多个 UI 测试以 `sync:{ configVersion, globalStrategy:'B', slots:[], rules:[] }` mock（**未标注、运行期，无 `matchSettings`**）—— 如 `tests/unit/ui/settings-loading-states.test.tsx:37`、`tests/unit/ui/settings-deeplink.test.tsx:27`、`tests/unit/ui/settings.test.tsx:23/149/171`、`tests/unit/ui/sidebar*.test.tsx`、`tests/unit/ui/slot-action-button-sizing.test.tsx:36`、`tests/unit/ui/message-client.test.ts:36` —— 直接解引用会**低概率运行期 TypeError**。**定性：非兼容层**（不读旧字段、不做形状嗅探、不写迁移表）。
  - **⭐【Rev 6 · A-3 闭环执行循环（本任务的收尾步骤，必须执行）】**：
    ```
    ① 改契约（types.ts / messages.ts + 原语 / resolver + 各消费者，原子改写）
    ② npm run typecheck
    ③ npm run test:unit
    ④ 修掉它们报出的每一处（编译点 → 机械适配；断言点 → 按新语义改写）
    ⑤ 重复 ②–④，直到 typecheck = 0 error 且 test:unit = ALL PASS
    ```
  - **RED 可构造性（Rev 4 扩展；【Rev 5 · D17】补 RED ⑤ → 共 6 项 = 5 有效 RED + 1 回归护栏）**：
    - **有效 RED ①（GAP-D）**：新增 `tests/unit/background/known-actions.test.ts`——断言 `routeMessage({action:'SET_SWITCH_DIRECTION'})` **可正常路由**（不返回 `UNKNOWN_ACTION`）+ 反例 `routeMessage({action:'NOT_A_REAL_ACTION'})` 返回 `{ success:false, errorCode:'UNKNOWN_ACTION' }`。**当前必失败**（union/白名单均无该 action）→ 有效 RED。**访问途径**：`isKnownAction` **未 `export`**（`:87`）→ 经 `routeMessage` 断言（沿用 `worker-orchestrator.test.ts:56` 范式）；**不得**为此加 `export`。
    - **有效 RED ②（四格 resolver）**：新增 `tests/unit/background/switch/primitives.test.ts` + `resolvers.test.ts`——**模块不存在 → 必失败**。穷举：`applyPriority` 三档（`none`/`tabId`/`rule-check`）；`focusOrStep`（游标==活动 → 步进；!= → 聚焦；环=1 → no-op）；`buildPositionRing`（只含目标窗口）；组合 2「binding 亡 → `needs_recovery`，**不得查 URL**」；组合 3「无候选 → `needs_recovery`」；组合 4「游标缺失 → `needs_recovery`」。
    - **有效 RED ③（新默认归一，裁定 3）**：`tests/integration/storage-repository.test.ts` 新增用例——预置**旧形状** `syncState`（含 `globalStrategy:'C'`）→ `hydrate()` 后断言 `matchSettings === DEFAULT_MATCH_SETTINGS`（`exists+match+tabId`）、`switchDirection==='next'`、`autoBindGlobal===true`、`configVersion` **不变**；且 `'globalStrategy' in sync === false`。**当前必失败**（现为 `globalStrategy:'C'`）。
    - **有效 RED ④（旧导出文件被拒，裁定 4）**：`tests/integration/import-export-service.test.ts` 新增用例——导入含 `globalStrategy:'B'` 且**无 `matchSettings`** 的 JSON → 断言 `{ success:false, errorCode:'IMPORT_INVALID' }`。**当前必失败**（现会接受并映射）。**[X7]**
    - 新增 `tests/unit/shared/messages.test.ts` 用例：`MatchRuleSettings` 三字段取值域、`SET_SLOT_AUTO_BIND` 的 `override: null` 合法、`POSITION_CURRENT_PREV/NEXT` 载荷含可选 `anchorTabId`（`{}` 亦合法）、`SwitchOutcome` 仍含既有 4 变体（含 `needs_recovery`）。
    - **【Rev 5 · D17 有效 RED ⑤（死类型/死常量删除面）】**：新增 `tests/unit/shared/messages.test.ts` 用例 —— 断言 `DEFAULT_MATCH_SETTINGS` 深度相等于 `{ tabIdMode:'exists', ruleCheckMode:'match', priority:'tabId' }`（**取代原 `DEFAULT_STRATEGY === 'B'` 用例**，即原 `:199-200` 改写）。**当前必失败**（`DEFAULT_MATCH_SETTINGS` 尚未定义 → **模块导出不存在，编译/运行必红**）。**配套静态断言（不可仅为单测）**：`rg 'MatchStrategy' src tests` = 0、`rg 'DEFAULT_STRATEGY' src tests` = 0、`rg 'DEFAULT_MATCH_SETTINGS' src tests` ≥ 命中 —— **修改前 `rg 'MatchStrategy'`/`'DEFAULT_STRATEGY'` 必命中（非 0）→ 删除后归 0，构成可判定的 RED→GREEN 翻转**。
    - **回归护栏（非 RED，NIT-N1 明确标注）**：`SwitchOutcome` 源不含 `'protected_blocked'` 在修改前**即成立** → **不是有效 RED**，仅作回归护栏。

  **Must NOT do**:
  - **【裁定】** 不得保留/新增**任何兼容层或迁移代码**：不得读取旧 `globalStrategy`（读写皆禁）、不做形状嗅探、**不新增 `schemaVersion`**、不写迁移映射表。
  - **【裁定】** 不得让旧导出文件参与导入成功路径（**不得**回退读 `globalStrategy`）。
  - **【Rev 5 · D17】** **不得保留 `MatchStrategy` 类型定义（`:8`）或 `DEFAULT_STRATEGY` 常量（`:15`）本身**（**不留死类型 / 死常量**）；**不得**残留任何 `import { MatchStrategy }` / `as MatchStrategy` 强转（否则 `rg 'MatchStrategy' src tests` 非 0）；**不得**以映射表/常量承载 A/B/C→四格对照（**仅** `design §3.1` markdown 表）；`'A'|'B'|'C'` 字面量不得出现在 `src`/`tests`。
  - 不得让 `MatchStrategy`（`'A'|'B'|'C'`）出现在 `SyncState` / `SlotDefinition.strategy` / `ExportPayload` / `ImportPreview` / 任一消息载荷中（**[Rev 5 · D17] 类型定义亦须删除**，不留文档对照残留）。
  - 不改 `SWITCH_SLOT` / 4 个 Match action 的载荷形状（保持不变契约）。
  - **不得新增/移除 `SwitchOutcome` 变体**（BLK-B / B2：4 变体冻结）。
  - 不新增 permission/command；`switchDirection` 不新增快捷键命令。
  - **不得**在本任务内实现 `applySwitchOutcome` 或新 action 的**行为路由**（那是 T9）；本任务只做契约 + 白名单登记 + `SET_*_STRATEGY` 的**单行 payload 适配**。
  - **不得**在本任务内实现 Position 后端（↑/↓）与方向感知（那是 T8）。
  - **不得分片提交**（Rev 4-B：类型与分支必须同一次改写）。
  - **不得**触碰 `tests/ui-smoke/pages.smoke.test.tsx:83-98` 的 `<RecoveryWindow>` props（那是 T12b 面；本任务仅改 `:103-111` 的 `ImportPreview` 字面量）。
  - **【Rev 6 · A-4】不得静默扩大范围**：闭环修错时纳入的任何**计划外编译 / 断言点**，**必须**在交付报告中逐条列出（文件:行 + TS 错误码 / 用例名 + 理由）。
  - **【Rev 6 · A-4】不得自行变更已定契约**（`SwitchOutcome` 变体数 / A1 / B2 口径 / `matchSettings` 字段集 / 消息 action 集合）—— 需变更**必须停止并上报**。
  - **【Rev 6 · NIT-4 澄清】** 读 `sync.matchSettings` 的 `?? DEFAULT_MATCH_SETTINGS` 兜底**不属**兼容层，**允许且要求**；但**不得**借该兜底回退读取 `globalStrategy`。

  **Recommended Agent Profile（Rev 5 增强）**:
  - **Category**: `deep`（**全计划最大单任务**）— 牵连 **~40 文件**（10 生产文件 + 10 测试文件 + 新建 `switch/**` 目录 + 既有 cross-ref）与消息 union；一处形状错则全链路编译失败。
  - **允许独立 worktree**: **YES**（隔离执行，避免与 Wave 1 的 T3 及各后续 Wave 文件争用）。
  - **可拆分性**: **不可再拆（NO-FURTHER-SPLIT）** —— 拆即破坏 TS 一致性 → **`TS2367`**（`slot-service.ts:186/204` 的 `MatchRuleSettings` 与 `'A'|'B'` 比较）/ **`TS2322`**（`slot-service.ts:69`、`worker-orchestrator.ts:484/493` 的 `string → MatchRuleSettings`）（**已实测**）。
  - **完成判据（Rev 6 · A-1 闭环式）**: **`npm run typecheck` → 0 error 且 `npm run test:unit` → ALL PASS**（由 `tsc` / `vitest` 定义权威清单；**卡内清单 = 预期命中参考，非完备性要求**）。**执行收尾必须走闭环循环**（改契约 → 跑 typecheck → 跑 test:unit → 修掉每一处 → 重复至全绿）。
- **失败预案（用户执行安排；Rev 6 · A-4 强化）**: ① 发现**计划外编译 / 断言点** → **允许就地纳入 T1（追加）**，但**必须在交付报告中逐条列出**（文件:行 + TS 错误码 / 用例名 + 理由）（**禁止静默扩大范围**）；② 发现需**改动已定契约**（如 `SwitchOutcome` 变体数、A1 / B2 口径、`matchSettings` 字段集、action 集合）→ **必须停止并上报**（**不得自行变更**）。
  - **Skills**: [`sw-verification-before-completion`]
  - **Skills Evaluated but Omitted**: `sw-systematic-debugging`（非调试任务）。

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 T3 无文件重叠）
  - **独立 worktree**: **允许（YES）**（Rev 5 · D17）—— 体量大、独占 10 生产文件 + 10 测试文件，隔离执行避免文件争用
  - **Parallel Group**: Wave 1 (with T3)
  - **Blocks**: T6、T8、T9、T12a、T12b
  - **Blocked By**: None

  **References**:
  - **Pattern References**:
    - `src/shared/types.ts:189-194` — 现 `SyncState`（**裁定 1/2**：删 `globalStrategy`、不新增 `schemaVersion`）。
    - `src/shared/types.ts:272-276` — 现 `SwitchOutcome`（**BLK-B / B2：完全不动**，4 变体保持）。
    - `src/shared/types.ts:247` — `PROTECTED_PAGE`（**只读复用**）。
    - `src/shared/types.ts:8-15` — `MatchStrategy`（`:8`）与 `DEFAULT_STRATEGY`（`:15`）（**[X3] + [Rev 5 · D17]**：**类型与常量一并删除**，不留死类型/死常量）。
    - `_context-output/designs/2026-09-30-slot-switch-consistency-design.md:81-84` — **D17 裁定注释**（「彻底删除」原文）。
    - `_context-output/designs/2026-09-30-slot-switch-consistency-design.md:146-154` — **§3.1 旧 A/B/C → 新四格对照表（D17 指定的唯一保留载体；仅 markdown，不进入代码）**。
    - `_context-output/designs/2026-09-30-slot-switch-consistency-decisions.yaml:139-147` — **D17 决策记录**（含被否决的 `RECOMMENDED-B`「保留类型」方案）。
    - `src/shared/types.ts:51-62` — 现 `SlotDefinition`（`strategy` 重塑 + `autoBindOverride`）。
    - `src/shared/types.ts:159-185` — `ExportPayload` / `ImportPreview`（**GAP-C**；**不加 `schemaVersion`**）。
    - `src/shared/url-utils.ts:408-415` / `:426-449` — `matchesUrl` / `sortCandidates`（原语唯一真源）。
    - `src/background/slot-service.ts:607-633` — 现 `findCandidates`（原语提炼来源）。
    - `_context-output/designs/2026-09-30-slot-switch-consistency-design.md:132-139` — **四格组合表（唯一真源）**。
    - `_context-output/designs/2026-09-30-slot-switch-consistency-detail-interaction-copy-design.md:67-83` — DT8①② 成品标签与默认值。
  - **API/Type References**:
    - `src/shared/messages.ts:41-51` — `SaveSlotRequest.payload.strategy`（**[BLK-1 残余 #2]**）。
    - `src/shared/messages.ts:149-157` — `SetGlobalStrategyRequest` / `SetSlotStrategyRequest`。
    - `src/shared/messages.ts:165-178` — Recovery 请求（待扩展 `autoBind`）。
    - `src/shared/messages.ts:295-333` / `:432` — `UiRequest` union / `UiAction`。
    - `src/background/worker-orchestrator.ts:43-84` — `KNOWN_ACTIONS`（**GAP-D**）。
    - `src/background/worker-orchestrator.ts:87-91` — `isKnownAction`（**未 `export`** → 经 `routeMessage` 断言）。
    - `src/background/worker-orchestrator.ts:346-354` — `SAVE_SLOT` 路由体透传（**[BLK-1 残余 #2]**）。
    - `src/background/worker-orchestrator.ts:468-471` — `SET_GLOBAL_STRATEGY` 路由体（**[BLK-1 残余 #1]**）。
    - `src/background/worker-orchestrator.ts:473-494` — `SET_SLOT_STRATEGY` 路由体（**[BLK-1 残余 #2]**，`:484` / `:493`）。
  - **生产侧原子改写引用（Rev 4-B 核心；非占位；【Rev 5 · D17】含 `MatchStrategy`/`DEFAULT_STRATEGY` 全量引用点）**:
    - **【D17 类型/常量删除面】** `src/shared/types.ts:8/15`（**删类型 + 常量**）、`:54/164/183/191`（`MatchStrategy` 消费者改 `MatchRuleSettings`）；`src/shared/messages.ts:9`（import 改）、`:49/151/156`（payload 改）；`src/background/storage-repository.ts:18/26/615`（import 成员删 + 形参改）；`src/background/import-export-service.ts:17/23/103`（import 成员删 + `as MatchStrategy` 整行删）；`src/background/slot-service.ts:19/55`（import 成员删 + 形参改）；`src/ui/settings/App.tsx:16/138/141/142/202/1771/1795/1821/1838`（**9 处 `MatchStrategy` 标注全改**）。
    - `src/background/storage-repository.ts:26/74-81/171-179/615-620` — 默认形状 / **仅填新默认（无迁移、无回写）** / `setMatchSettings`。
    - `src/background/slot-service.ts:19/51-56/66-75/174-177/186/204/237-272` — **[BLK-1 残余 #3]** 签名 + 有效策略 + A/B 分支 + 回退路径**同次改写为 resolver**。
    - `src/background/import-export-service.ts:23/41-57/89-103/135-142/174-202` — **[X7]** 导出新形状 + 导入**只接受 `matchSettings`**（`:103` 的 `as MatchStrategy` 强转**删除**）。
    - `src/ui/import-preview/main.tsx:14` — `ImportPreview` 字面量（用 `DEFAULT_MATCH_SETTINGS`）。
    - `src/ui/shared/message-client.ts:245-251` — **[X1]** 客户端方法签名与 payload（**注：不含 `MatchStrategy` 字面量，属 X1 形状面**）。
    - `src/ui/settings/App.tsx:16/137-218/1623/1771/1795-1796/1821-1836/1838-1852/1896-1904` — **[BLK-1 残余 #4]** 三旋钮新语义 UI（**非占位**）。
  - **测试侧显式类型引用（`tsconfig.include` 含 `tests`）**：`tests/unit/shared/messages.test.ts:19/28-69/139/199-200/257`（**[X3] `DEFAULT_STRATEGY`** + **[X5] `assertNever` 补 case** + `SyncState` 夹具）；`tests/unit/ui/import-diagnostics.test.tsx:7/15`；`tests/integration/storage-repository.test.ts:22/30/74/96/100/126/129/139/142`（**[BLK-1 残余 #5]**）；`tests/integration/worker-orchestrator.test.ts:30`；`tests/integration/import-export-service.test.ts:187/398`；`tests/integration/slot-service.test.ts:135`（**[X4]**）；`tests/unit/ui/message-client.test.ts:56/62/88/193`（**[X2]**）；**【Rev 6 · BLOCKER-2】`tests/unit/ui/settings.test.tsx:96/109/122`**（三旋钮重写后必红）；**【Rev 6 · BLOCKER-1】`tests/ui-smoke/pages.smoke.test.tsx:103-111`**（`ImportPreview` 对象字面量 → **编译面** TS2353/TS2741）。**注**：`tests/unit/shared/messages.test.ts:174` 的 `RecoverySession` 夹具**不在 T1**（属 T6 / **X10**）。
  - ⭐ **【Rev 6 · A-2 定性】** 以上**全部 References 适配点（含 X1–X10 / 32 处 D17 / 残余 #1–#5 / BLOCKER-1、2）= 「预期命中参考（EXPECTED-HIT REFERENCE）—— 非完备性要求」**。**T1 验收边界 = `npm run typecheck` 0 error 且 `npm run test:unit` ALL PASS（A-1）**；若闭环报出上表未列点，按 **A-4** 纳入并报告。
  - **Test References**:
    - `tests/unit/shared/messages.test.ts` — 既有消息契约测试结构（扩展）。
    - `tests/integration/worker-orchestrator.test.ts:56` — `routeMessage` 私有访问范式。
    - `tests/integration/slot-service.test.ts:106-172` — 行为锚点（C5 授权重写；`:146/162` needs_recovery 断言**保留**）。
    - `tsconfig.json` — `include:["src","tests",…]`（typecheck 覆盖 tests）。
  - **WHY Each Reference Matters**: `types.ts:272-276` 是被 4 处测试锁定的契约，**4 变体冻结（不增不减）**；`KNOWN_ACTIONS:43-84` 是新增 action 可达性的唯一闸门（N4 明文提示不随 union 同步）；**Rev 4**：`slot-service.ts:186/204` 的 `MatchRuleSettings` 与 `'A'|'B'` 比较**必然** `TS2367`，`:69` / `worker-orchestrator.ts:484/493` 的 `string → MatchRuleSettings` **必然** `TS2322` —— 这两个实测错误正是「契约与派发骨架必须合并为原子任务」的**直接证据**（Rev 4-B）；`import-export-service.ts:89-103` 若不改，裁定 4（拒绝旧导出文件）**无法生效**（**X7**）。

  **Acceptance Criteria**:
  - [ ] ⭐**【Rev 6 · A-1 完成判据（闭环式，最高优先级）】** `npm run typecheck` → **0 error** **且** `npm run test:unit` → **ALL PASS**。**此两条命令的输出即权威适配清单**；卡内清单仅供首轮参考，**不作为完备性判据**。**执行收尾必须重复至两条同时成立**（A-3 闭环循环）。
  - [ ] **5 组 RED** 先运行 → **RED**（证据：`evidence/task-T1-red.txt` + `-resolver-red.txt` + `-defaults-red.txt` + `-import-reject-red.txt` + **`-d17-deadcode.txt`（Rev 5 · D17 RED ⑤）**）
  - [ ] `npx vitest run tests/unit/background/switch tests/unit/background/known-actions.test.ts tests/unit/shared/messages.test.ts` → ALL PASS
  - [ ] `npx vitest run tests/integration/storage-repository.test.ts tests/integration/import-export-service.test.ts tests/integration/slot-service.test.ts` → ALL PASS
  - [ ] `npm run test:unit` → ALL PASS（**含 `tests/unit/ui/settings.test.tsx` 三用例（Rev 6 · BLOCKER-2）**）
  - [ ] `npm run test:ui-smoke` → ALL PASS（**含 `tests/ui-smoke/pages.smoke.test.tsx`（Rev 6 · BLOCKER-1 形状适配）**）
  - [ ] **【Rev 6 · A-4】交付报告含「实际改动面清单」**：逐条列出闭环过程中纳入的**计划外编译 / 断言点**（文件:行 + TS 错误码 / 用例名 + 理由）；**无静默扩大范围**；**无自行变更已定契约**（若有 → 已停报）
  - [ ] **裁定核查**：`rg -n 'schemaVersion' src tests` → **0 命中**；`rg -n 'globalStrategy' src` → **0 命中**；`rg -n 'DEFAULT_STRATEGY' src tests` → **0 命中**
  - [ ] **【Rev 5 · D17 静态断言】** `rg -n 'MatchStrategy' src tests` → **0 命中**（**死类型已彻底删除**）；`rg -n 'DEFAULT_STRATEGY' src tests` → **0 命中**（**死常量已彻底删除**）
  - [ ] **【Rev 5 · D17 静态断言】** `rg -n 'DEFAULT_MATCH_SETTINGS' src tests` → **命中**（`types.ts` 定义 + 至少 1 处消费者）
  - [ ] **【Rev 5 · D17 载体核查】** A/B/C→新四格对照**仅**存在于 `design:146-154`（§3.1 markdown）；`src tests` 内**无**映射表/对照常量
  - [ ] **回归护栏**：`rg -n 'protected_blocked' src` → 0 命中（**性质 = 护栏**，非有效 RED，NIT-N1）

  **QA Scenarios**:
  ```
  Scenario: 新 action 可达（有效 RED ①）且消息 shape 正确
    Tool: Bash (test runner)
    Steps:
      1. 经私有访问 routeMessage({action:'SET_SWITCH_DIRECTION'}) → 断言不返回 UNKNOWN_ACTION（当前必失败 → 有效 RED）
      2. routeMessage({action:'POSITION_CURRENT_NEXT'}) → 同上
      3. routeMessage({action:'NOT_A_REAL_ACTION'}) → 断言 { success:false, errorCode:'UNKNOWN_ACTION' }（反例）
      4. 构造 SET_SLOT_AUTO_BIND { slotId:1, override:null } → 类型检查通过
    Expected Result: 6 新增 action 均可达且载荷合法（经 routeMessage，非直接调 isKnownAction）
    Failure Indicators: routeMessage 对 SET_SWITCH_DIRECTION 返回 UNKNOWN_ACTION（GAP-D 未登记）
    Evidence: evidence/task-T1-known-actions.txt

  Scenario: 四格 resolver 穷举（有效 RED ②）
    Tool: Bash (test runner)
    Steps:
      1. 组合 1 × priority∈{none,tabId,rule-check} 各断言目标
      2. 组合 2：binding 存活 → 切它；binding 亡 → needs_recovery（断言未查 URL）
      3. 组合 3：候选首；无候选 → needs_recovery
      4. 组合 4：游标==活动 → 步进；!= → 聚焦；缺失 → needs_recovery
    Expected Result: 四格互斥且可判定（模块不存在 → 修改前必失败）
    Failure Indicators: 组合 2 回退 URL；组合 3 与 4 语义重叠
    Evidence: evidence/task-T1-resolver.txt

  Scenario: 旧持久化数据被忽略 → 新默认归一（有效 RED ③，裁定 3）
    Tool: Bash (test runner)
    Steps:
      1. 预置 adapter.state.syncStorage['syncState'] = { configVersion:7, globalStrategy:'C', slots:[], rules:[] }
      2. await repo.initialize(); const sync = await repo.getSyncState()
      3. 断言 sync.matchSettings === {exists,match,tabId}；sync.switchDirection==='next'；sync.autoBindGlobal===true
      4. 断言 sync.configVersion===7（**不变**）；断言 'globalStrategy' in sync === false
    Expected Result: 旧字段被忽略、静默落新默认、无提示无备份（裁定 3）
    Failure Indicators: sync 仍含 globalStrategy；或 matchSettings 值非默认
    Evidence: evidence/task-T1-defaults.txt

  Scenario: 旧导出文件不再可导入（有效 RED ④，裁定 4）
    Tool: Bash (test runner)
    Steps:
      1. generatePreview(JSON.stringify({version:1, slots:[], rules:[], globalStrategy:'B', configVersion:3}))
      2. 断言 { success:false, errorCode:'IMPORT_INVALID' }
      3. 反例：含合法 matchSettings 的 JSON → 断言 success:true
    Expected Result: 仅新形状可导入
    Failure Indicators: 旧形状被接受（说明仍在读 globalStrategy）
    Evidence: evidence/task-T1-import-reject.txt

  Scenario: SwitchOutcome 4 变体不变（回归护栏，非 RED）
    Tool: Bash (test runner)
    Steps:
      1. 类型层断言 SwitchOutcome 仍含 'needs_recovery'、'switched'、'no_match'、'incognito_blocked'
      2. rg 'protected_blocked' src → 0 命中（护栏：修改前即成立）
      3. npx vitest run tests/integration/slot-service.test.ts → needs_recovery 两例通过
    Expected Result: 4 变体保留且无 protected_blocked（BLK-B / B2 + 裁定 6）
    Failure Indicators: needs_recovery 用例编译失败或断言失败；出现 protected_blocked
    Evidence: evidence/task-T1-outcome-preserved.txt

  Scenario: 死类型/死常量彻底删除（Rev 5 · D17；有效 RED ⑤）
    Tool: Bash (test runner + rg)
    Steps:
      1. 修改前：rg -n 'MatchStrategy' src tests → 命中（6 文件 / 25 行）→ 记录为 RED 基线
      2. 修改前：rg -n 'DEFAULT_STRATEGY' src tests → 命中（4 文件 / 9 行）→ 记录为 RED 基线
      3. 修改后：两条 rg 均 → 0 命中（GREEN）
      4. 修改后：rg -n 'DEFAULT_MATCH_SETTINGS' src tests → 命中（types.ts 定义 + storage-repository/import-export/settings/import-preview 消费者 + 测试）
      5. npx vitest run tests/unit/shared/messages.test.ts → 新 DEFAULT_MATCH_SETTINGS 用例通过（原 DEFAULT_STRATEGY 用例已改写）
      6. 断言 types.ts 内既无 'MatchStrategy' 亦无 'DEFAULT_STRATEGY' 残骸；A/B/C→四格对照仅存在于 design §3.1
    Expected Result: 死类型/死常量归零；DEFAULT_MATCH_SETTINGS 就位（D17 #1/#2/#3/#4）
    Failure Indicators: rg 'MatchStrategy' 或 'DEFAULT_STRATEGY' 仍命中（残留 import/强转/类型）；或 DEFAULT_MATCH_SETTINGS 未定义
    Evidence: evidence/task-T1-d17-deadcode.txt

  Scenario: ⭐ 编译器驱动闭环（Rev 6 · A-1，T1 完成判据的实证）
    Tool: Bash (test runner)
    Steps:
      1. 完成原子改写后，运行 `npm run typecheck` → 记录输出；**必须 0 error**（若报错 → 逐条修 → 重跑）
      2. 运行 `npm run test:unit` → 记录输出；**必须 ALL PASS**（若红 → 逐条修 → 重跑）
      3. 重复 1–2 直到两条同时成立（A-3 循环 ⑤）
      4. 额外运行 `npm run test:ui-smoke` → ALL PASS（Rev 6 · BLOCKER-1：pages.smoke 属 ui-smoke 项目）
      5. 记录「实际改动面清单」：闭环中纳入的每一处计划外编译/断言点（文件:行 + TS 错误码/用例名 + 理由）
    Expected Result: typecheck 0 error 且 test:unit ALL PASS —— T1 闭环完成；清单与 `git diff` 一致或为其忠实超集
    Failure Indicators: 存在未修 error / 未修红用例；或有改动未在清单中登记（静默扩大范围）
    Evidence: evidence/task-T1-closed-loop.txt
  ```

  **Commit**: YES (**独立为 Commit 1**，**不再与 T3 合并** —— T3 改为 Commit 2)；
  **Files（T1）**：`src/shared/types.ts`、`src/shared/messages.ts`、`src/background/switch/**`（新建 primitives + resolvers + resolve-switch）、`src/background/storage-repository.ts`、`src/background/slot-service.ts`、`src/background/import-export-service.ts`、`src/ui/import-preview/main.tsx`、`src/ui/shared/message-client.ts`、`src/ui/settings/App.tsx`、`src/background/worker-orchestrator.ts`（仅 `KNOWN_ACTIONS` + `SET_*_STRATEGY` payload 行）；
  **测试侧**：`tests/unit/background/switch/*`（新建）、`tests/unit/background/known-actions.test.ts`（新建）、`tests/unit/shared/messages.test.ts`、`tests/unit/ui/import-diagnostics.test.tsx`、`tests/unit/ui/message-client.test.ts`、**【Rev 6 · BLOCKER-2】`tests/unit/ui/settings.test.tsx`**（`:96/109/122` 三用例；授权例外-②）、`tests/integration/storage-repository.test.ts`、`tests/integration/worker-orchestrator.test.ts`、`tests/integration/import-export-service.test.ts`、`tests/integration/slot-service.test.ts`、`tests/integration/full-suite.test.ts`、**【Rev 6 · BLOCKER-1】`tests/ui-smoke/pages.smoke.test.tsx`（仅 `:103-111` 的 `ImportPreview` 形状；`:83-98` 归 T12b）**；
  **pre-commit（N-4 修正 + Rev 6）**：`npm run typecheck && npm run test:unit && npm run test:integration`（**`test:integration` 为 N-4 新增项**，因本任务改 `tests/integration/*` 多处）。**【Rev 6 · A-1】** 其中 `typecheck` + `test:unit` 构成 **T1 完成判据**（闭环式）；`test:integration` 为**超集要求**（不回退）。**【Rev 6 · BLOCKER-1】** `pages.smoke` 属 `ui-smoke` 项目 ⇒ 本任务须**额外**自跑 `npm run test:ui-smoke` 验证形状适配（**不加入 pre-commit 必需项**，但属 T1 Acceptance）。
  **【Rev 5 · D17 增补】** Files 不变（32 处引用点均落在上述既有文件内，**不新增文件**）；本任务额外承载 **D17 死代码删除**（`types.ts:8/15` 类型 + 常量删除、32 处引用点替换为 `MatchRuleSettings`/`DEFAULT_MATCH_SETTINGS`），静态断言 `rg 'MatchStrategy' src tests` = 0 且 `rg 'DEFAULT_STRATEGY' src tests` = 0；**T1 Profile**：`deep` + **允许独立 worktree** + **不可再拆**（见 Recommended Agent Profile）

- [x] ~~T2. 共享纯原语 `primitives.ts`~~ → **`ABSORBED` by T1（Rev 4-B）**

  > **处置**：原 T2 的 5 个纯原语（`ruleCheckTabMatch` / `findMatchCandidates` / `buildPositionRing` / `applyPriority` / `focusOrStep`）与对应单测（`tests/unit/background/switch/primitives.test.ts`）**全部并入 T1**（见 T1 What to do「新建 `primitives.ts`」+ RED ②）。
  > **原因**：无兼容层 ⇒ resolver 采用与 `slot-service` 分支改写必须与契约同一次提交；原语作为 resolver 的唯一依赖，必须同批落地（否则 T1 内 `resolve-switch.ts` 悬空 import）。
  > **原 T2 引用（已迁入 T1）**：`src/shared/url-utils.ts:408-415` / `:426-449`、`src/background/slot-service.ts:607-633`、`src/shared/types.ts:259-268`、`tests/integration/slot-service.test.ts:26-75`。
  > **原 T2 QA（已迁入 T1 RED ②）**：`applyPriority` 三档穷举 / `focusOrStep` 三态 / `buildPositionRing` 单窗范围 —— 证据文件名统一为 `evidence/task-T1-*`。

- [x] T3. **`file://` 加入 canonical 受保护前缀（重跑 `gen:prefixes`）**

  **What to do**:
  - `scripts/gen-protected-prefixes.mjs:43-52` 的 canonical 列表新增 `'file://'`。
  - 重跑 `npm run gen:prefixes` 生成两个产物：`src/shared/protected-prefixes.generated.ts`、`src/content/protected-prefixes.inline.generated.ts`。
  - **连带效应（用户已确认）**：`file://` 亦不可作 rule 改写目标（同一清单被 `rule-service` 复用）——`tests/unit/background/rule-service.test.ts:454` 的 dangerous 列表已含 `file://`，语义兼容，不会有断言冲突。
  - **【BLK-2 · 必须同步登记的既有断言（确定副作用）】**：`file://` 入 canonical 后，`tests/unit/shared/url-utils.test.ts:362-375` 的 `it('should have exactly the expected protected prefixes (no drift)')` 使用 `toEqual` **精确断言** 8 个前缀（`about:`/`brave://`/`chrome-extension://`/`chrome://`/`edge://`/`moz-extension://`/`opera://`/`vivaldi://`），**必失败**。**同步更新点 = 在该期望数组加入 `'file://'`**（`toEqual` 结构**保留不放宽** —— 精确清单的守护语义不得弱化，这正是「无 drift」的护栏）。这是 `file://` 入列的**确定副作用**，不是可选项。
  - **【NIT-N3 · 连带核验面补齐】**：同时核对 `tests/unit/background/rule-service.test.ts:454`（dangerous 已含 `file://`，语义兼容，**不需改**）**与** `tests/unit/shared/url-utils.test.ts:362-375`（**需同步更新期望数组**）——两者合起来构成 `file://` 入列的完整扩散面核验。
  - **RED 可构造性**：新增 `tests/unit/shared/protected-prefixes.test.ts`——断言 `PROTECTED_URL_PREFIXES` 含 `'file://'`，且 `isProtectedUrl('file:///etc/passwd') === true`（当前必失败）。**注意**：`url-utils.test.ts:362-375` 的 `toEqual` 在重跑生成物后**会先变成红**，须在同一次改动内同步更新期望数组（这本身也是「生成物已变」的有效信号）。

  **Must NOT do**:
  - 不手工编辑 `.generated.ts`（必须由脚本生成）。
  - 不改 `isProtectedUrl` 的实现（只改数据源）。
  - 不为 `file://` 新增权限或 host_permission。
  - 不改 `isSafeFaviconProtocol`（favicon 白名单独立，与 protected 前缀不同源）。

  **Recommended Agent Profile**:
  - **Category**: `quick` — 单点数据变更 + 重跑脚本。
  - **Skills**: [`sw-verification-before-completion`]

  **Parallelization**:
  - **Can Run In Parallel**: YES（**与 T1 无文件重叠**：仅 `scripts/` + 两个生成物 + 2 个测试文件）
  - **Parallel Group**: Wave 1 (with T1)
  - **Blocks**: T6（Open URL 特权拦截含 file://）
  - **Blocked By**: None

  **References**:
  - **Pattern References**:
    - `scripts/gen-protected-prefixes.mjs:43-52` — canonical 列表（唯一授权编辑点）。
    - `src/shared/protected-prefixes.generated.ts:11-20` — 现生成物（待重生成，禁手改）。
  - **API/Type References**:
    - `src/shared/url-utils.ts:639-642` — `isProtectedUrl`（读取生成清单）。
    - `tests/unit/background/rule-service.test.ts:454` — dangerous 已含 `file://`（兼容证据，**不需改**）。【NIT-N3】
    - `tests/unit/shared/url-utils.test.ts:362-375` — **精确前缀断言 `toEqual`（BLK-2 同步更新点：期望数组加 `'file://'`，结构不放宽）**。
  - **WHY Each Reference Matters**: 生成脚本头注释（`:6-13`）明示清单是**单一授权编辑点**，手工改生成物会在下次 `gen:prefixes` 被覆盖；`rule-service.test.ts:454` 证明 `file://` 在 rule 校验中已被视为危险，加入 protected 不会引入新的语义冲突；**`url-utils.test.ts:362-375` 是「无 drift」精确护栏**，`file://` 入列必然触发它 → 必须同步更新期望数组（保留 `toEqual`），否则 T3 无法通过自身验收。

  **Acceptance Criteria**:
  - [ ] `npm run gen:prefixes` → 两个产物含 `'file://'`
  - [ ] `tests/unit/shared/url-utils.test.ts:362-375` 期望数组**同步加入 `'file://'`**（`toEqual` 结构不放宽）→ `npx vitest run tests/unit/shared/url-utils.test.ts` → ALL PASS
  - [ ] `npx vitest run tests/unit/shared/protected-prefixes.test.ts` → ALL PASS
  - [ ] `npx vitest run tests/unit/background/rule-service.test.ts` → ALL PASS（连带核验：dangerous 兼容，无需改）
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios**:
  ```
  Scenario: file:// 被识别为受保护
    Tool: Bash (test runner)
    Steps:
      1. 断言 isProtectedUrl('file:///etc/passwd') === true
      2. 断言 PROTECTED_URL_PREFIXES.includes('file://') === true
    Expected Result: file:// 入列
    Failure Indicators: 断言失败（脚本未改或未重跑）
    Evidence: evidence/task-T3-file-prefix.txt

  Scenario: 反例 — 普通 https 不受影响
    Tool: Bash (test runner)
    Steps:
      1. 断言 isProtectedUrl('https://example.com') === false
    Expected Result: 仅新前缀被保护，未误伤
    Evidence: evidence/task-T3-neg.txt

  Scenario: 精确前缀断言同步（BLK-2，反例/护栏）
    Tool: Bash (test runner)
    Steps:
      1. 重跑 gen:prefixes 后运行 npx vitest run tests/unit/shared/url-utils.test.ts
      2. 期望 'should have exactly the expected protected prefixes (no drift)' 通过且期望数组含 'file://'
      3. 断言 toEqual 结构未被放宽（仍是精确集合比较，不是 toContain/subset）
    Expected Result: 9 个前缀精确匹配（8 + file://）
    Failure Indicators: 该用例红（期望数组未同步）；或用例被改成非精确比较（削弱无 drift 护栏）
    Evidence: evidence/task-T3-prefix-sync.txt
  ```

  **Commit**: YES (**Commit 2**，**独立提交** —— Rev 4 起 T3 不再与 T1 合并)；**Files**：`scripts/gen-protected-prefixes.mjs`、两个生成物、**`tests/unit/shared/url-utils.test.ts`（BLK-2 同步更新点）**、`tests/unit/shared/protected-prefixes.test.ts`（新建）；**pre-commit**：`npm run typecheck && npm run test:unit`

### 附录 — `ABSORBED` / `DELETED` 任务存根（保留编号以防交叉引用漂移）

> **【Rev 4 说明】** 本节原有的 T4（resolver）与 T5（迁移）**已不存在**。保留占位**仅为**保持 T6 / T8 / T9 / T10 / T11 / T12a / T12b 的编号与全文交叉引用**不漂移**（Rev 4-B 编号稳定性策略）。

- [x] ~~T4. 4 个 resolver + `resolve-switch.ts` 入口~~ → **`ABSORBED` by T1（Rev 4-B）**

  > **处置**：`combination-{1..4}.ts` + `resolve-switch.ts`（四格严格语义）+ `tests/unit/background/switch/resolvers.test.ts` **全部并入 T1**（见 T1 What to do「新建 `resolvers/`」+ RED ②）。
  > **原因**：`slot-service.switchSlot` 的 A/B/C 分支比较（`:186` / `:204`）与 resolver 采用**必须同一次提交** —— 否则 `TS2367`（实测）。**这是 Rev 4-B「契约 + 派发骨架合并」的直接后果。**
  > **原 T4 引用（已迁入 T1）**：`src/background/slot-service.ts:185-234`、`:236-273`、`design:132-137`（四格表）、`tests/integration/slot-service.test.ts:106-172`。
  > **原 T4 QA（已迁入 T1 RED ②）**：四格穷举 + 3 反例（组合 2 不回退 URL / 组合 4 游标缺失 / 组合 1 三档 priority）—— 证据统一为 `evidence/task-T1-resolver*.txt`。

- [x] ~~T5. 迁移纯函数 + `schemaVersion` + 读时回写（`storage-repository.ts`）~~ → **`DELETED`（Rev 4-A 裁定 2/3）**

  > **删除理由**：用户裁定 **删除 `schemaVersion`** + **不做迁移**（应用未公测、无用户历史）；D10 / C4 / A8 已 `SUPERSEDED`。**不存在迁移函数**，故本任务整体删除。
  > **替代安排（已并入 T1）**：`migrateSyncState` 改为**仅填新形状默认值**（不读旧字段、不回写、不递增 `configVersion`）；对应可断言用例 = **T1 RED ③**（旧形状 → 新默认 `exists+match+tabId`；`configVersion` 不变；`'globalStrategy' in sync === false`）。
  > **原 T5 的「迁移单测为强制项」**：**不再是强制项**（RK1 已 `CLOSED_NOT_APPLICABLE`）。
  > **原 T5 引用（部分迁入 T1）**：`src/background/storage-repository.ts:171-179`（`migrateSyncState`）、`:137-166`（hydrate 路径）、`:74-94`、`:596-620`；`tests/integration/storage-repository.test.ts`。

  **【原 T4 卡体已移除】** —— 内容并入 T1（见上）。**引用/QA/🔴RED 全部迁移，无悬空引用。**

  **【原 T5 卡体已移除】** —— 任务整体 `DELETED`（无迁移、无 `schemaVersion`）；替代安排并入 T1（`migrateSyncState` 仅填新默认 + RED ③）。**引用/QA 全部迁移或作废，无悬空引用。**

### Wave 2 — 服务层（`recovery-service.ts`；Rev 4：原 Wave 2 的解析层已并入 T1）

- [x] T6. **`recovery-service.ts` 改造（Prev/Next 游标 + Open URL 收敛 + session 扩展）**

  **What to do**:
  - `RecoverySession`（`src/shared/types.ts:116-125`）新增 `windowId: number`、`candidateCursor: number | null`（tabId 锚定，DT1/DT2）。
  - `openUrl`（`recovery-service.ts:49-86`）改造：
    - `urlMatch.type === 'regex'` 仍返回错误（不可开正则）。
    - **C2 缺口修复**：打开前 `isProtectedUrl(session.urlMatch.value)` 拦截 → 命中则**不打开**。**【修正 · BLK-B / B2】** 返回 **既有 domain error** `{ success: false, errorCode: 'PROTECTED_PAGE', message: 'This URL cannot be opened' }`（复用 `types.ts:247` 的 `PROTECTED_PAGE`；**不新增 `SwitchOutcome` 变体**、**不走 `applySwitchOutcome`**）。恢复窗据 `errorCode` 走**既有窗内报错**路径渲染（T12b）。
    - 成功后：`removeRecoverySession` + `setLastSuccessSlot` + 更新 binding；`autoBind` 由**载荷**决定（A12：background 以载荷为准），勾选才写 `tabId`。
    - 新增 `prevMatch` / 改造 `nextMatch`：**均不删 session、不关窗**（DT1/DT5 反向：浏览类留窗）；实时重查候选，按 `candidateCursor`(tabId) 定位，环绕（DT2）；更新 `candidateCursor`；无候选 → 返回可展示错误 `No matching tabs found at this time`（窗内展示，不跳转）。
  - `createRecovery`（`slot-service.ts:665-681` 的 `createRecoverySession`）补 `windowId`（窗口创建后端填）——**注意**：`windowId` 在 session 创建后由 worker 开窗时回填（A11），故 `addRecoverySession` 后可 `updateRecoverySession` 或先建 session 再记录窗 id。
  - **RED 可构造性**：扩展 `tests/integration/recovery-service.test.ts` + 新建 `tests/unit/background/recovery-cursor.test.ts`：
    - Prev/Next **不删 session**、可**连续调用**两次且位置递进（当前实现 `:129` 立即删 → 必失败）。
    - `openUrl` 对 `file://`/`chrome://` 拦截（当前 `:64` 直接 create → 必失败）；**断言返回 `{ success:false, errorCode:'PROTECTED_PAGE' }`**（BLK-B / B2：复用既有 domain error，不新增 outcome）。
    - 首次起点锚定：活动页在候选内 → 其后一个（DT2）。

  **Must NOT do**:
  - Prev/Next **不得**删除 session、不得关窗（DT1）。
  - 不得让 Prev/Next 更新 slot binding（A4b 浏览类）。
  - `openUrl` 不得跳过特权拦截（C2 缺口必修）。
  - **不得**为特权页拦截新增 `SwitchOutcome` 变体（BLK-B / B2：必须复用既有 `PROTECTED_PAGE` domain error）。
  - 不得缓存候选集（A14 实时查询）。
  - 不改 `dismiss` 语义（移除 session）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — 游标锚定/环绕/生命周期三态交织，DT1/DT2 细节密度最高。
  - **Skills**: [`sw-verification-before-completion`]

  **Parallelization**:
  - **Can Run In Parallel**: YES（**独占 `recovery-service.ts`**；与 T1（Wave 1）文件**不重叠**）
  - **Parallel Group**: Wave 2（Rev 4 重排：T6 提前至 Wave 2，因它只需 T1 + T3，且与 T1 无文件冲突）
  - **Blocks**: T9、T12b
  - **Blocked By**: T1（契约：`RecoverySession` 扩展落 `types.ts`）、T3（`file://` 前缀）

  **References**:
  - **Pattern References**:
    - `src/background/recovery-service.ts:49-86` — `openUrl`（待加特权拦截）。
    - `src/background/recovery-service.ts:91-140` — `nextMatch`（待改为不删 session + 游标）。
    - `src/background/recovery-service.ts:169-193` — `findCandidates`（跨窗查询，沿用 A14）。
    - `src/background/slot-service.ts:665-681` — `createRecoverySession`（待补 windowId）。
    - `src/background/slot-service.ts:340-442` — `nextMatchForSlot`/`prevMatchForSlot`（游标环绕范式可参照，但**语义不同**：slot 循环 vs recovery 会话）。
  - **API/Type References**:
    - `src/shared/types.ts:116-125` — `RecoverySession`（待扩展）。
    - `src/shared/types.ts:247` — **既有** `PROTECTED_PAGE` domain error（BLK-B / B2 拦截返回码；只读复用，不新增）。
    - `src/shared/url-utils.ts:639-642` — `isProtectedUrl`（拦截判据）。
    - `src/background/recovery-service.ts:49-52` — `openUrl` 现有返回签名 `{ success:false; errorCode: string; message: string }`（`PROTECTED_PAGE` 直接落此形状）。
  - **Test References**:
    - `tests/integration/recovery-service.test.ts:38-101` — 既有 happy path（`:55-56`「Session should be cleaned up」**将不再适用于 Prev/Next**；**授权例外-③**：C5 授权重写该语义用例）。
    - `tests/unit/shared/messages.test.ts:174-182` — `const session: RecoverySession = {…}`（**`RecoverySession` 扩展的测试侧适配**：新增必需字段 `windowId`/`candidateCursor` 后该显式类型夹具须补字段，属 T6 面；`tsconfig.include` 含 `tests` → 不补则 typecheck 红）。**【X10】同类显式标注（均须补字段）**：`tests/integration/storage-repository.test.ts:150-168`（`expiredSession` / `validSession`）、`tests/integration/recovery-service.test.ts:24-36`（`createSession` 工厂）；**生产侧**：`src/background/slot-service.ts:665-681`（`createRecoverySession` 构造体）。
  - **WHY Each Reference Matters**: `recovery-service.ts:109/129` 是 DT1 指出的**不兼容实现**（`candidates[0]` + 立即删 session），必须重写为游标式；`types.ts:116-125` 的 session 形状是 A11/DT1 的载体，缺 `windowId` 无法实现 create-or-focus；`recovery-service.test.ts:55-56` 的「Session cleaned up」断言与 DT1「浏览类留窗」**直接矛盾** → 属**授权例外-③**，重写为「Prev/Next 不删 session」，非越界。

  **Acceptance Criteria**:
  - [ ] `npx vitest run tests/integration/recovery-service.test.ts tests/unit/background/recovery-cursor.test.ts` → ALL PASS
  - [ ] `npm run test:integration` → ALL PASS
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios**:
  ```
  Scenario: Prev/Next 连点不关窗、位置递进
    Tool: Bash (test runner)
    Steps:
      1. 3 个候选 tab，session 存在
      2. nextMatch() → 断言切换到候选[1]，session 仍在（recoverySessions.length===1）
      3. 再 nextMatch() → 候选[2]，session 仍在
    Expected Result: 连续点击可环绕，session 不被消费
    Failure Indicators: 第一次调用后 session 被删（原 :129 行为）
    Evidence: evidence/task-T6-continuous.txt

  Scenario: Open URL 拦截特权页 → 既有 PROTECTED_PAGE domain error（反例）
    Tool: Bash (test runner)
    Steps:
      1. session.urlMatch={type:'exact', value:'file:///etc/passwd'}
      2. openUrl(recoveryId)
      3. 断言 adapter.calls 无 tabs.create
      4. 断言返回 { success:false, errorCode:'PROTECTED_PAGE' }（非 SwitchOutcome、非 protected_blocked）
    Expected Result: 不打开特权页，返回既有 domain error（BLK-B / B2）
    Failure Indicators: tabs.create 被调用（原 :64 无校验）；返回 protected_blocked 或 success:true
    Evidence: evidence/task-T6-protected-block.txt
  ```

  **Commit**: YES (**Commit 3**，Rev 4 重排后编号)

- [x] ~~T7. `import-export-service.ts` 导入映射 + 导出新形状（含 GAP-C）~~ → **`ABSORBED` by T1（Rev 4-B / Rev 4-D N-2）**

  > **处置**：`exportConfig` / `generatePreview` / `commitImport` 的新形状改造 **全部并入 T1**（见 T1 What to do「`import-export-service.ts`」+ **X7**）。
  > **语义变更（取代原设计）**：**不再有「旧格式兼容的第二入口」** —— 裁定 4：旧导出文件**不再可导入**（缺失/非法 `matchSettings` → `IMPORT_INVALID`，**不读旧 `globalStrategy`**）。**N-2「占位语义含糊」由此彻底消解**（无占位、无兼容）。
  > **原 T7 引用（已迁入 T1）**：`src/background/import-export-service.ts:37-63` / `:89-103` / `:101-145` / `:174-202`、`src/shared/types.ts:159-185`、`tests/integration/import-export-service.test.ts`、`tests/integration/full-suite.test.ts:110-138`。
  > **原 T7 QA（已迁入 T1 RED ④）**：旧导出文件**被拒**用例 + 新形状导出用例 + `full-suite.test.ts:110-138` 改为新形状/被拒 —— 证据文件名 `evidence/task-T1-import-reject.txt` / `-import-shape.txt`。

**【原 T7 卡体已移除】** —— 内容并入 T1。**无悬空引用。**

### Wave 3 — 编排采用（T8）+ 恢复窗 UI（T12b）（文件互不重叠）

- [x] T8. **`slot-service.ts`：Position 后端（`↑/↓`）+ 方向感知 + 其余编排（Rev 4 缩减版）**

  > **【Rev 4 缩减说明】** 原 T8 的「**采用 resolver + A/B/C 分支替换**」部分**已并入 T1**（必须与类型同一次改写，否则 `TS2367`/`TS2322`）。**本任务保留**：① Position 后端（`↑/↓`）；② 方向感知；③ `switchSlot` 组合 4 分支的 I/O 编排与 binding/游标更新；④ 既有循环路径的兼容编排。

  **What to do**:
  - **【与 T1 的边界】** T1 已完成 `switchSlot` 的**策略分派改写**（调 `resolveSwitch` + 执行 `activateTabById` / `createRecoverySession`）。**本任务不得重写策略分派**，只补：
    - **组合 4 分支的完整 I/O 编排**：以 `binding.tabId` 为起点，`buildPositionRing(tabs, currentWindow.id)` + `focusOrStep`；成功 → **更新 binding + 游标**（提交类）；游标缺失 → `needs_recovery`；步进方向读 `sync.switchDirection`（D6）。
  - 新增 **Position 后端**（供 `↑/↓`）：`positionPrev(anchorTabId?)` / `positionNext(anchorTabId?)`：
    - 环 = `tabs.query({currentWindow:true})` 按 index（A14）；起点 = **`anchorTabId ?? 当前活动页`**（BLK-A / A1 已裁决：侧边栏传入 `lockedTabId ?? currentTabId`，background **不读**侧边栏内存态）。
    - **`anchorTabId` 失效（tab 已关闭）→ 降级为以当前活动页为起点、不报错**（DT7 硬要求：`↑/↓` 用户的 Lock 页消失不是错误）。
    - 环仅 1 页 → 原地 no-op（DT4）。
    - **不更新 binding**（A4b 浏览类）。
  - **方向感知**：`nextMatch()`（`:280-332`）与组合 4 的步进读取 `sync.switchDirection`；侧边栏 `⤺/↻` 与 `NEXT/PREV_MATCH_SLOT` 不受影响（D6）。
  - **RED 可构造性**：新建 `tests/unit/background/position-*.test.ts` + 扩展 `tests/integration/slot-service.test.ts`：
    - 组合 4：游标==活动 → 步进（按 `switchDirection`）；游标!=活动 → 聚焦；游标缺失 → `needs_recovery`。
    - Position 环仅 1 页 → no-op 且无 binding 写（spy `setBinding` 未调用）。
    - **Position 起点**：`anchorTabId` 有效 → 以其为起点（含「锁定后切走再按 ↑/↓ 先聚焦回锚点」）；`anchorTabId` **失效（已关闭）→ 降级当前活动页、不报错**（DT7）；载荷 `{}`（无 anchor）→ 当前活动页。
    - 现有测试（`slot-service.test.ts:106-172`）语言从 A/B/C 改为组合——C5 授权重写**行为语义用例**，但 `needs_recovery` 两例（`:146/162`）**保留断言结构**。

  **Must NOT do**:
  - 不得在 `slotService` 内新增副作用（恢复窗/通知）——全部留 `applySwitchOutcome`（T9）。
  - 不得缓存环/候选（A14）。
  - `↑/↓`（Position）**不得**更新 binding（A4b）。
  - 不得移除 `needs_recovery` 返回路径（契约锁定）。
  - 不得让侧边栏 `⤺/↻` 受方向设置影响（D6）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — 解析层到 I/O 的接缝，且是 item1 一致性根基。
  - **Skills**: [`sw-verification-before-completion`]

  **Parallelization**:
  - **Can Run In Parallel**: YES（**独占 `slot-service.ts`**；与 T6 / T12b 文件不重叠）
  - **Parallel Group**: Wave 3 (with T12b)
  - **Blocks**: T9、T12a
  - **Blocked By**: **T1**（契约 + resolver + 策略分派已在 T1 落地；本任务在其上补 Position/方向）

  **References**:
  - **Pattern References**:
    - `src/background/slot-service.ts:165-273` — `switchSlot`（T1 已改策略分派；本任务补组合 4 编排）。
    - `src/background/slot-service.ts:280-332` — `nextMatch`（待方向感知）。
    - `src/background/slot-service.ts:340-442` — slot 循环（**绑定契约参照**：`:375-376`/`:432-433` 注释「不动 binding」）。
    - `src/background/slot-service.ts:607-654` — `findCandidates` / `activateTabById`（I/O 执行层）。
  - **API/Type References**:
    - `src/background/switch/resolve-switch.ts`（**T1**）— resolver 入口签名。
    - `src/background/switch/primitives.ts`（**T1**）— `buildPositionRing`/`focusOrStep`。
    - `src/shared/messages.ts`（T1 后）— `POSITION_CURRENT_PREV/NEXT` 载荷 `{ anchorTabId?: number }`（BLK-A / A1）。
    - `src/ui/sidebar/App.tsx:924-928`、`:1149-1151` — Lock 为侧边栏内存态（`lockedTabId`/`lockedTabRef`）→ **background 不读**，仅由载荷 `anchorTabId` 传入（BLK-A / A1 边界）。
  - **Test References**:
    - `tests/integration/slot-service.test.ts:106-172` — 行为锚点（C5 授权重写，但 `:146/162` needs_recovery 断言保留）。
    - `tests/integration/next-match-binding.test.ts` — 「循环不动 binding」既有回归守卫（**必须保持通过**）。
  - **WHY Each Reference Matters**: `next-match-binding.test.ts` 是 A4b「浏览类不更新 binding」的**既有护栏**，T8 重构不得破坏它；`slot-service.ts:375-376` 的注释是「有意行为」的证据，防止被当作遗漏修掉。

  **Acceptance Criteria**:
  - [ ] `npx vitest run tests/integration/slot-service.test.ts tests/unit/background/position-*.test.ts` → ALL PASS
  - [ ] `npx vitest run tests/integration/next-match-binding.test.ts` → ALL PASS（binding 契约未破）
  - [ ] `npm run test:integration` → ALL PASS

  **QA Scenarios**:
  ```
  Scenario: 组合 4 聚焦/步进/缺失三分支
    Tool: Bash (test runner)
    Steps:
      1. 环=[10,11,12]，binding=10，active=10，dir=next → positionNext 步进到 11
      2. 环同，binding=10，active=12 → 聚焦到 10
      3. binding=99（已关） → needs_recovery
    Expected Result: 三分支可测
    Failure Indicators: 游标缺失被当步进 / 聚焦方向错
    Evidence: evidence/task-T8-combo4.txt

  Scenario: ↑/↓ 单页环 no-op 且不写 binding（反例）
    Tool: Bash (test runner)
    Steps:
      1. 当前窗口仅 1 页 → positionNext()
      2. spy setBinding → 断言未调用；无 toast/错误
    Expected Result: 原地 no-op
    Failure Indicators: 抛错或写 binding
    Evidence: evidence/task-T8-single-ring.txt

  Scenario: Position 起点 anchorTabId 有效 / 失效 / 缺省（BLK-A / A1 + DT7）
    Tool: Bash (test runner)
    Steps:
      1. positionNext(anchorTabId=t10)，t10 存活且非活动 → 断言以 t10 起点判定（先聚焦/按环步进）
      2. positionNext(anchorTabId=t99)，t99 已关闭 → 断言降级为当前活动页为起点，**无错误/无 toast**
      3. positionNext()（无 anchor）→ 断言以当前活动页为起点
    Expected Result: 三分支行为确定且失效降级不报错
    Failure Indicators: t99 失效时抛错或返回 needs_recovery（违反 DT7）
    Evidence: evidence/task-T8-anchor-fallback.txt
  ```

  **Commit**: YES (**Commit 5**，Rev 4 重排后编号)

### Wave 4 — 编排层（独占 `worker-orchestrator.ts`，串行）

- [x] T9. **`applySwitchOutcome` + 新 action 路由（`worker-orchestrator.ts`）**

  **What to do**:
  - 新增 `applySwitchOutcome(outcome, context)`（置于 `worker-orchestrator`）——**唯一副作用映射点**（A1/A2）：
    - `needs_recovery` → **create-or-focus**（键 = `slotId`，D12/A11：查活跃 session 的 `windowId`，存在则 `windows.update(windowId,{focused:true})`，否则 `windows.create` 并记 `windowId`）+ `no_target` 通知（每动作至多 1 次）+ 诊断。
    - `switched + crossWindow` → `cross_window_switch` 通知 + 诊断；非跨窗 → 仅诊断。
    - `incognito_blocked` / `no_match` → 仅诊断。
    - **映射表只含既有 4 变体**（BLK-B / B2：**无** `protected_blocked` 行；特权页拦截在打开/导航路径返回 `PROTECTED_PAGE` domain error，**不经本函数**）。
    - **幂等**：同 `slotId` 复用一个窗；单次调用只跑一遍映射（不重复通知/诊断）。
    - 恢复窗 URL 参数新增 `slotId`、`matchType`（A12）。
  - `handleCommand`（`:230-260`）：`switch-slot-x` 抽出内联副作用（含 `:258` `diagnostics.record` / `:259` `return`），改为调 `applySwitchOutcome`。
  - `routeMessage`（`:356-357`）：`SWITCH_SLOT` 由「只回传」改为「回传 + 调 `applySwitchOutcome`」——**item1 修复点**。
  - 新增 action 路由：`SET_SWITCH_DIRECTION` / `SET_AUTO_BIND_GLOBAL` / `SET_SLOT_AUTO_BIND` / `POSITION_CURRENT_PREV` / `POSITION_CURRENT_NEXT` / `RECOVERY_PREV_MATCH`（均已在 T1 登记 `KNOWN_ACTIONS`）。
  - **【Rev 4 边界】** `SET_GLOBAL_STRATEGY` / `SET_SLOT_STRATEGY` 的<u>单行 payload 形状适配</u>**已在 T1**（`:468-471` / `:473-494`）完成；**本任务只需把** `SET_SWITCH_DIRECTION` / `SET_AUTO_BIND_GLOBAL` / `SET_SLOT_AUTO_BIND` **接到** `repo.setSwitchDirection` / `setAutoBindGlobal` / `setSlotAutoBindOverride`（**T1 已建 mutator**）。
  - **RED 可构造性**：新建 `tests/integration/apply-switch-outcome.test.ts`：
    - 映射表**逐行**断言（needs_recovery → 1 窗 + 1 通知；switched+crossWindow → 1 通知；incognito_blocked / no_match / switched 非跨窗 → 仅诊断；**4 变体全覆盖、无 `protected_blocked`**）。
    - 双路径一致性（SC1）：同 slot 同输入，`SWITCH_SLOT` 与 `switch-slot-x` 命令 → 断言 `windows.create` **均**被调 1 次、outcome 语义一致（当前 `SWITCH_SLOT` 不开窗 → 必失败）。
    - 幂等（SC2）：同 slot 触发两次 → `windows.create` 调用数 = 1（第二次走 focus）。
    - 新 action 路由可达（GAP-D）。

  **Must NOT do**:
  - 副作用**不得**下沉到 `slotService`（A1 否决项）。
  - 调用方（侧边栏等）**不得**自行开窗（D2）——本任务只改 background。
  - `applySwitchOutcome` 单次调用**不得**重复发通知/诊断（幂等）。
  - 不改 `SWITCH_SLOT` 的载荷形状（`{slotId}` 不变）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — item1 的唯一收敛点，两条路径合并 + 映射表 + 幂等，是本轮最关键的架构落点。
  - **Skills**: [`sw-verification-before-completion`, `sw-systematic-debugging`]
    - `sw-systematic-debugging`：双路径一致性是「同一意图不同入口」类问题，需系统化确认无第三条路径。

  **Parallelization**:
  - **Can Run In Parallel**: NO（独占 worker-orchestrator.ts，与 T10/T11 串行）
  - **Parallel Group**: Wave 4
  - **Blocks**: T10、T11、T12a
  - **Blocked By**: T1、T6、T8
  - **注**：**T12b 不再 `deps T9`**（Rev 4：恢复窗 payload 形状已在 T1 定型；T9 只做 background 路由，与 T12b 无编译耦合）

  **References**:
  - **Pattern References**:
    - `src/background/worker-orchestrator.ts:230-260` — `switch-slot-x` 内联副作用（待抽出；Rev 3 校正区间）。
    - `src/background/worker-orchestrator.ts:356-357` — `SWITCH_SLOT` 只回传（**item1 修复点**）。
    - `src/background/worker-orchestrator.ts:191-197` — `windows.create` 调用范式（恢复窗/冲突窗同构）。
    - `src/background/diagnostics-service.ts:109-148` — `NotificationService.notify` 策略（no_target / cross_window_switch）。
  - **API/Type References**:
    - `src/shared/messages.ts`（T1 后）— 新 action 载荷。
    - `src/background/recovery-service.ts`（T6）— session `windowId` 来源。
    - `_context-output/designs/2026-09-30-slot-switch-consistency-design.md:149-159` — 副作用映射表（**4 变体，无 `protected_blocked`**；BLK-B / B2 后行号已校正）。
  - **Test References**:
    - `tests/integration/worker-orchestrator.test.ts` — 路由/命令测试结构。
    - `tests/integration/save-notification.test.ts` — `notifications.create` 计数断言范式。
  - **WHY Each Reference Matters**: 设计 §3.2 的映射表是唯一真源；`:191-197` 的窗口创建范式保证恢复窗与冲突窗风格一致；`NotificationService.notify:113-115` 对 `crossWindow=false` 的 no-op 逻辑决定了「非跨窗不通知」无需额外分支。

  **Acceptance Criteria**:
  - [ ] `npx vitest run tests/integration/apply-switch-outcome.test.ts` → ALL PASS（映射逐行 + 双路径 + 幂等）
  - [ ] `npm run test:integration` → ALL PASS
  - [ ] `npm run typecheck` → 0 error

  **QA Scenarios**:
  ```
  Scenario: 双路径同副作用（SC1）
    Tool: Bash (test runner)
    Steps:
      1. 无候选 slot，route SWITCH_SLOT → 断言 windows.create 调 1 次
      2. 同 slot，emitCommand('switch-slot-1') → 断言 windows.create ✥ 仍 1 次（或复用聚焦）
    Expected Result: 两入口行为一致
    Failure Indicators: SWITCH_SLOT 不开窗（原 :356 只回传）
    Evidence: evidence/task-T9-dual-path.txt

  Scenario: 幂等 — 同 slot 触发两次仅 1 窗（SC2，反例）
    Tool: Bash (test runner)
    Steps:
      1. 触发 needs_recovery 一次 → windows.create=1
      2. 同 slot 再触发 → 断言 windows.create 仍=1（第二次 windows.update focus）
      3. 断言 no_target 通知总数 ≤ 2（每次动作至多 1）
    Expected Result: 复用不叠加
    Failure Indicators: windows.create=2（多窗）
    Evidence: evidence/task-T9-idempotent.txt
  ```

  **Commit**: YES (**Commit 6**，Rev 4 重排后编号)

### Wave 5 — 幂等与诊断

- [x] T10. **in-flight 合流（switch / open-page / recovery）+ 单创造者**

  **What to do**:
  - **background `OPEN_PAGE`**（`:668-689`）：按**目标 base-url 键**做 **in-flight 合流**——并发 await 同一 promise，只 `create` 一次；串行重复由 `openOrReusePage` 的「已存在即复用」收敛。
  - **`SWITCH_SLOT` 合流**（A10）：同 `slotId` 并发 `switchSlot` → 合流为一次（1 窗 / 1 通知 / 1 诊断 / 1 次 binding 写）。
  - **`RECOVERY_OPEN_URL` 合流 + 幂等消费**（A10）：同 `recoveryId` 并发 → 只建 1 tab；成功后 session 标**已消费**（重复调用返回「已完成」，不重复建 tab）。
  - **串行合法重触发仍允许**（不做全局限流）。
  - **RED 可构造性**：新建 `tests/integration/open-page-coalescing.test.ts` + `tests/integration/switch-coalescing.test.ts`：
    - 并发两次 `OPEN_PAGE`（同 url）→ `tabs.create` 调用数 = 1（当前无合流 → 必失败）。
    - 并发两次 `SWITCH_SLOT`（同 slot）→ `windows.create` = 1、通知 = 1。
    - 并发两次 `RECOVERY_OPEN_URL`（同 recoveryId）→ `tabs.create` = 1。
    - **【NIT-N2】** 合流不得让「新 action 可达性」回归：经 `routeMessage` 断言 **6** 个新 action **不**返回 `UNKNOWN_ACTION`、未知 action 返回 `UNKNOWN_ACTION`（`isKnownAction` 未 export，经 `routeMessage` 访问，沿用 `worker-orchestrator.test.ts:56` 范式）。

  **Must NOT do**:
  - 不得做**全局**串行化（会误伤不同 slot 的并发操作，A10 否决项）。
  - 不得移除侧边栏 fallback（B11b；T12a 处理其「有界重试」）。
  - `OPEN_PAGE` 合流键必须是 base-url（hash-insensitive），与 `openOrReusePage` 一致。
  - 合流不得吞掉真实错误（错误须传播给各 await 方）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — 并发合流的竞态对测试构造要求高，易假绿。
  - **Skills**: [`sw-verification-before-completion`, `sw-systematic-debugging`]

  **Parallelization**:
  - **Can Run In Parallel**: NO（独占 worker-orchestrator.ts）
  - **Parallel Group**: Wave 5
  - **Blocks**: T11, T12a
  - **Blocked By**: T9

  **References**:
  - **Pattern References**:
    - `src/background/worker-orchestrator.ts:664-689` — `OPEN_PAGE`（待加合流）。
    - `src/background/storage-repository.ts:108-111` — **既有的 write 串行队列范式**（`localWriteQueue` / `syncWriteQueue`）——合流的实现风格参照。
    - `src/shared/open-page.ts:34-51` — `openOrReusePage`（串行重复的收敛点）。
  - **API/Type References**:
    - `src/background/worker-orchestrator.ts:326-327` — `RESPONSE_TIMEOUT_MS` 响应预算（合流不得超预算静默失败）。
  - **Test References**:
    - `tests/integration/open-page-reuse.test.ts` — 既有 OPEN_PAGE 断言范式（`createCalls()` 计数）。
    - `tests/integration/worker-orchestrator.test.ts` — 路由测试结构。
  - **WHY Each Reference Matters**: `storage-repository.ts:108-111` 证明项目已有「按操作串行/合流」的成熟范式，可直接借鉴其「队列尾不吞错」的实现；`open-page-reuse.test.ts:40` 的 `createCalls()` 是断言「只创建 1 个」的现成手段。

  **Acceptance Criteria**:
  - [ ] `npx vitest run tests/integration/open-page-coalescing.test.ts tests/integration/switch-coalescing.test.ts tests/integration/open-page-reuse.test.ts` → ALL PASS
  - [ ] `npm run test:integration` → ALL PASS

  **QA Scenarios**:
  ```
  Scenario: 并发 OPEN_PAGE 只创建 1 个标签页（SC3）
    Tool: Bash (test runner)
    Steps:
      1. 无已开 settings tab
      2. Promise.all([route OPEN_PAGE, route OPEN_PAGE])（同 url）
      3. 断言 tabs.create 调用数 === 1
    Expected Result: 合流收敛
    Failure Indicators: tabs.create===2
    Evidence: evidence/task-T10-openpage-coalesce.txt

  Scenario: 串行合法重触发仍允许（反例，不做全局限流）
    Tool: Bash (test runner)
    Steps:
      1. OPEN_PAGE url → 完成
      2. 再次 OPEN_PAGE 另一 url → 断言新标签页被创建（不误合流）
    Expected Result: 不同目标各自生效
    Failure Indicators: 不同 url 被错误合流为 1
    Evidence: evidence/task-T10-serial-allowed.txt

  Scenario: 合流不破坏新 action 可达性（NIT-N2）
    Tool: Bash (test runner)
    Steps:
      1. 经私有访问 routeMessage({action:'SET_SWITCH_DIRECTION'}) → 断言不返回 UNKNOWN_ACTION
      2. routeMessage({action:'NOT_A_REAL_ACTION'}) → 断言 { success:false, errorCode:'UNKNOWN_ACTION' }
    Expected Result: 合流后已知 action 仍可达、未知 action 仍被拒（isKnownAction 未 export，经 routeMessage 访问）
    Failure Indicators: 合流逻辑误合并/误拒 action
    Evidence: evidence/task-T10-known-actions.txt
  ```

  **Commit**: YES (**Commit 7**，与 T11 合并；Rev 4 重排后编号)

- [x] T11. **item 2 根因定位：开页路径诊断记录**

  **What to do**:
  - 开页路径写**诊断记录**（沿用既有 `diagnostics` 结构，A9 字段）：`source`（`background` | `sidebar-fallback`）、`target`（base-url 或哈希）、`result`、`viaFallback`、`creates`、`reuses`。
  - **注意**：`DiagnosticsService.record`（`diagnostics-service.ts:33-41`）目前**只接受** `(errorCode, operationType)` 且 `isSanitized`（`:75-84`）拒绝含 `http/https`、`title`、`regex`/`pattern` 的 JSON。故开页诊断**不得**写入 URL/title 明文——用 `operationType` 编码（如 `open_page:background:create` / `open_page:sidebar-fallback:create`），或用固定枚举 token，保证 `isSanitized` 仍为 true。
  - **可复现判定**（A9「首要假设 vs 次要假设」）：诊断须能区分
    - **「两创造者竞速」**：同一 base-url 在**同一时刻**出现 `source=background,creates=1` **与** `source=sidebar-fallback,creates=1`（两条 create 记录，不同 source）。
    - **「同 handler 被调两次」**：同一 source 出现**两条 create** 记录。
  - **RED 可构造性**：新建 `tests/integration/open-page-diagnostics.test.ts`：
    - 制造竞速场景 → 断言诊断含两条不同 source 的 create 记录（可区分）。
    - 制造重复 handler → 断言同 source 两条记录。
    - 断言 `DiagnosticsService.isSanitized(entry) === true`（无 URL/title 泄漏）。

  **Must NOT do**:
  - **不得**在诊断中写入 URL / title / 页面内容（`isSanitized` 硬约束）。
  - 不改 `DiagnosticEntry` 形状（只增 `operationType` 的编码值）。
  - 不加新的诊断存储键。

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — 诊断编码 + 竞速复现构造。
  - **Skills**: [`sw-systematic-debugging`, `sw-verification-before-completion`]

  **Parallelization**:
  - **Can Run In Parallel**: NO（独占 worker-orchestrator.ts）
  - **Parallel Group**: Wave 5
  - **Blocks**: T12a
  - **Blocked By**: T10

  **References**:
  - **Pattern References**:
    - `src/background/diagnostics-service.ts:33-41` — `record`（唯一写入口）。
    - `src/background/diagnostics-service.ts:75-84` — `isSanitized`（**硬约束**：不得含 URL/title）。
    - `src/background/worker-orchestrator.ts:668-689` — `OPEN_PAGE`（诊断埋点）。
    - `src/background/worker-orchestrator.ts:239-258` — switch 路径诊断埋点对照。
  - **API/Type References**:
    - `src/shared/types.ts:150-155` — `DiagnosticEntry`（形状不变）。
  - **Test References**:
    - `tests/integration/diagnostics-service.test.ts:77-93` — `isSanitized` 断言范式。
  - **WHY Each Reference Matters**: `isSanitized:78-82` 会把含 `title` 子串、`regex`/`pattern`、`http(s)://` 的 entry 判为非净化——若诊断直接塞 URL 会让该既有测试（`:84`）变红；因此诊断必须用固定 token 编码，这是本任务最易踩的坑。

  **Acceptance Criteria**:
  - [ ] `npx vitest run tests/integration/open-page-diagnostics.test.ts tests/integration/diagnostics-service.test.ts` → ALL PASS
  - [ ] `npm run test:integration` → ALL PASS

  **QA Scenarios**:
  ```
  Scenario: 诊断可区分两创造者竞速 vs 重复 handler
    Tool: Bash (test runner)
    Steps:
      1. 模拟 background create + sidebar-fallback create → 断言两条记录的 operationType 前缀不同 source
      2. 模拟同 handler 二次 → 断言两条记录 source 相同
    Expected Result: 二者可诊断区分（item2 根因定位）
    Failure Indicators: 诊断无 source 维度（无法区分）
    Evidence: evidence/task-T11-root-cause.txt

  Scenario: 诊断不含敏感数据（反例）
    Tool: Bash (test runner)
    Steps:
      1. 触发开页诊断
      2. DiagnosticService.isSanitized(entry) === true
    Expected Result: 无 URL/title 泄漏
    Failure Indicators: isSanitized 返回 false
    Evidence: evidence/task-T11-sanitized.txt
  ```

  **Commit**: YES (**Commit 7**，与 T10 合并；Rev 4 重排后编号)

### Wave 6 — 侧边栏 UI（Rev 4：T12b 已提前至 Wave 3，T12c 已并入 T1）

- [x] T12a. **侧边栏 `sidebar/App.tsx`：`↑/↓` Position + 删除误导 toast + footer 有界重试**

  **What to do**:
  - **`↑/↓` Position 按钮**：Current Page 区在 `⤺/↻`（`:1610-1629`）**右侧**新增两按钮（D7）：
    - `Switch to previous position tab`（↑，`aria-label` 同上文本）/ `Switch to next position tab`（↓）。
    - `onClick` → `sendMessage('POSITION_CURRENT_PREV'/'POSITION_CURRENT_NEXT', { anchorTabId: state.lockedTabId ?? state.currentTabId })`（**BLK-A / A1 已裁决**：显式携带起点 `lockedTabId ?? currentTabId`；background 不读内存态；**不新增持久化字段**）。若两者皆 `null` → 省略字段（`{}`），由 background 取当前活动页。
    - **slot 行不新增** Position 按钮（保留 Match `⤺/↻`）。
  - **删除误导 toast**（D2）：`handleSwitch`（`:976-995`）删除 `needs_recovery` 分支的 `Slot x: opening recovery window` toast（`:986-988`）——恢复窗由 background 统一负责；侧边栏不再自行提示。
  - **footer 开页有界重试**（A9）：`openPage`（`:1157-1178`）catch 分支改为**先有界重试 `OPEN_PAGE`**；**仅当 `chrome.runtime.id` 不存在**（扩展上下文确已失效）才走直连 fallback。
  - **RED 可构造性**：新建 `tests/unit/ui/sidebar-position.test.tsx` + 扩展 `tests/unit/ui/sidebar-open-page.test.tsx`：
    - 断言 Current Page 存在 `Switch to next position tab` 且点击发出 `POSITION_CURRENT_NEXT`（含 `anchorTabId`）。
    - 断言 slot 行**无** position 按钮。
    - 断言无 Settings 标签时 `OPEN_PAGE` reject → **重试后成功**则不直连 create；`chrome.runtime.id` 缺失时才直连（`tabs.create` 1 次）。
    - 断言 `handleSwitch` 的 needs_recovery **不再**弹 `opening recovery window` toast。

  **Must NOT do**:
  - 不得让侧边栏自行开恢复窗（D2）。
  - `↑/↓` 不得更新 binding、**不得新增持久化字段**（D8/A4b；BLK-A / A1：Lock 仍为内存态，起点仅经载荷传入）。
  - **不得**把 `lockedTabId` 持久化或让 background 读取侧边栏内存态（BLK-A / A1 边界）。
  - 不改既有 `⤺/↻` 的 `aria-label`（`Switch to previous/next matching tab for current page`，`sidebar-prev-match`/`sidebar.test.tsx` 依赖）。
  - 不删除直连 fallback（B11b：SW 冷启时不得静默失效）——只改**触发条件**（有界重试优先）。
  - 不改 slot 行 `⤺/↻` 的 aria-label（`Switch to ... for slot N`，`sidebar.test.tsx:124`/`slot-action-button-sizing`/`sidebar-prev-match` 依赖）。

  **Recommended Agent Profile**:
  - **Category**: `deep` — 单文件但触碰 3 个关注点（按钮/删 toast/fallback 重试），且多个既有 aria-label 断言受约束。
  - **Skills**: [`sw-verification-before-completion`, `sw-ui-ux-review`]
    - `sw-ui-ux-review`：新按钮的可发现性/状态可见性属其维度。

  **Parallelization**:
  - **Can Run In Parallel**: YES（独占 sidebar/App.tsx）
  - **Parallel Group**: Wave 6（Rev 4：仅此一任务）
  - **Blocks**: F1–F5
  - **Blocked By**: T9、T10、T11

  **References**:
  - **Pattern References**:
    - `src/ui/sidebar/App.tsx:1610-1629` — Current Page `⤺/↻`（新按钮置于其右侧，沿用 `className="tbs-sidebar__match-btn"` 风格 + aria-label/title）。
    - `src/ui/sidebar/App.tsx:986-988` — **待删**的误导 toast。
    - `src/ui/sidebar/App.tsx:1157-1178` — `openPage` fallback（待加有界重试）。
    - `src/ui/sidebar/App.tsx:924-928`、`:1149-1151` — Lock 是 `lockedTabRef`/`lockedTabId` 内存态（BLK-A / A1 / DT7 依据：起点仅经载荷 `anchorTabId` 传出）。
  - **API/Type References**:
    - `src/shared/messages.ts`（T1 后）— `POSITION_CURRENT_PREV/NEXT` 载荷。
    - `src/ui/sidebar/App.tsx:41-65` — `createChromePageOpenApi`（fallback 唯一 `chrome.tabs` 触点）。
  - **Test References**:
    - `tests/unit/ui/sidebar-open-page.test.tsx:44-140` — 既有 footer 测试（**授权例外-⑤**：C5 可重写为「重试优先」语义）。
    - `tests/unit/ui/sidebar.test.tsx:124`、`tests/unit/ui/sidebar-prev-match.test.tsx:87` — slot 行 aria-label 护栏。
    - `tests/unit/ui/slot-action-button-sizing.test.tsx:134-142` — slot 按钮尺寸/标签断言。
  - **WHY Each Reference Matters**: `sidebar.test.tsx:124` 与 `sidebar-prev-match.test.tsx:87` 锁定 slot 行按钮的 aria-label，新增 Current Page position 按钮**不得**复用同名 label；`open-page.test.tsx` 的 `runtimeSendMessage.mockRejectedValue` 设置了「background 不可用」的既有前提，T12a 必须更新为「重试后可成功」的新语义（C5 授权），否则与其自身断言矛盾。

  **Acceptance Criteria**:
  - [ ] `npx vitest run tests/unit/ui/sidebar-position.test.tsx tests/unit/ui/sidebar-open-page.test.tsx` → ALL PASS
  - [ ] `npx vitest run tests/unit/ui/sidebar.test.tsx tests/unit/ui/sidebar-prev-match.test.tsx tests/unit/ui/slot-action-button-sizing.test.tsx` → ALL PASS（slot 行护栏）
  - [ ] `npm run test:ui-smoke` → ALL PASS
  - [ ] `rg -n 'opening recovery window' src` → 0 命中

  **QA Scenarios**:
  ```
  Scenario: ↑/↓ 发出 Position action 且 slot 行无位置按钮
    Tool: Bash (test runner)
    Steps:
      1. render sidebar → 断言 button 'Switch to next position tab' 存在
      2. click → 断言 runtimeSendMessage 收到 { action:'POSITION_CURRENT_NEXT', payload:{ anchorTabId:* } }
      3. 断言 slot 行不存在 'Switch to ... position tab for slot 1'
    Expected Result: Position 与 Match 在 UI 分离
    Failure Indicators: slot 行混入 position 按钮
    Evidence: evidence/task-T12a-position.txt

  Scenario: 开页有界重试不产生重复标签页（反例）
    Tool: Bash (test runner)
    Steps:
      1. OPEN_PAGE 首次 reject、第二次 resolve {success:true}
      2. click 'Open settings'
      3. 断言 tabs.create 未直接被调用为本轮直连（重试成功则无 create）
    Expected Result: 重试优先、直连仅在 runtime.id 缺失
    Failure Indicators: reject 后立即直连 create（两创造者竞速未消除）
    Evidence: evidence/task-T12a-retry.txt
  ```

  **Commit**: YES (**Commit 8**，Rev 4 重排后编号)

- [x] T12b. **恢复窗 `recovery/{App,main}.tsx`：Prev/Next + Open URL 收敛 + autoBind 复选框**

  **What to do**:
  - `recovery/App.tsx`：
    - 按钮集（DT8④）：`Open URL`（**仅** `matchType === 'exact'` 展示；`matchType` 由 URL 参数传入，A12）、`Switch to Previous Match`、`Switch to Next Match`、`Do Nothing`。
    - Prev/Next：**不关窗、不消费 session**（点后停留在窗内，可连点）；`onPrevMatch`/`onNextMatch` 回调处理「无候选」时窗内显示 `No matching tabs found at this time`（沿用既有串）。
    - `Open URL` 错误：**BLK-B / B2** —— background 返回 `{ success:false, errorCode:'PROTECTED_PAGE' }`；恢复窗据 `errorCode === 'PROTECTED_PAGE'` 走**既有窗内报错**路径渲染 `This URL cannot be opened`（**不**新增 `SwitchOutcome` 变体，**不**经 `applySwitchOutcome`）；成功后关窗（`main.tsx`）。
    - **autoBind 复选框**：`Auto-bind to this slot`（默认显示该槽**有效值**）；切换即 `SET_SLOT_AUTO_BIND` 持久化 + 动作载荷显式携带 `autoBind`（A12：background 以载荷为准）。
  - `recovery/main.tsx`：URL 参数解析新增 `slotId` / `matchType`；`RECOVERY_NEXT_MATCH` / `RECOVERY_OPEN_URL` 载荷加 `autoBind`；新增 `RECOVERY_PREV_MATCH` 处理器；Prev/Next 处理器**不再** `window.close()`（仅 Open URL/Do Nothing 关窗）。
  - **RED 可构造性**：重写 `tests/unit/ui/recovery-selector.test.tsx`（C5 授权自由重写）+ 新建 `tests/unit/ui/recovery-window.test.tsx`：
    - `matchType='regex'` → **不展示** `Open URL`；`exact` → 展示。
    - Prev/Next 点击后仍渲染窗（不关闭）；连点两次均触发回调。
    - 无候选 → 窗内错误文案，按钮仍可用。
    - **`RECOVERY_OPEN_URL` 返回 `{ success:false, errorCode:'PROTECTED_PAGE' }` → 窗内渲染 `This URL cannot be opened`**（BLK-B / B2；断言不依赖任何 `SwitchOutcome` 变体）。
    - autoBind 复选框切换 → 发出 `SET_SLOT_AUTO_BIND`；动作载荷含 `autoBind`。

  **Must NOT do**:
  - Prev/Next **不得**关窗（DT3：终止动作关窗、浏览动作留窗）。
  - 不得在 `regex` 下展示 `Open URL`（§3.5：仅 Exact）。
  - **不得**为特权页拦截引入 `SwitchOutcome` 变体渲染分支（BLK-B / B2：只认 `errorCode === 'PROTECTED_PAGE'`）。
  - 不得移除 `Do Nothing`。
  - 不改既有 `RecoveryWindow` 的 `role="dialog"`/标题 `Tab Not Found`（`recovery-selector.test.tsx` 既有语义）。
  - **【BLK-3 NIT 修正 · Rev 4 精度重述 + Rev 6-B 分工澄清（消除 v5 矛盾）】** `pages.smoke.test.tsx` 的「不得破坏」**仅指恢复窗渲染语义**，且**其实际断言范围比 v3 描述的更窄**：**该用例只断言 `getAllByRole('button').length > 0`（`:83-98`），没有标题断言、没有 `role="dialog"` 断言**。**`Tab Not Found` 标题 + `role="dialog"` 的实际锁定点是 `tests/unit/ui/recovery-selector.test.tsx`（经 `@ui/recovery/App`）**，而**不是** `pages.smoke`。
    - **本任务（T12b）只负责**：若 `<RecoveryWindow>` 新增 props（如 `matchType`/`slotId`），**同步更新 `pages.smoke.test.tsx:83-98` 的 props**（否则 `TS2322`）—— 属**授权例外-⑥**的形状适配，不视为破坏冒烟。
    - **`:103-111` 的 `ImportPreview` 字面量归 T1（Rev 6 · BLOCKER-1）** —— 该处为**对象字面量直传具体类型 prop**（TS2353 / TS2741），必须在 **Commit 1（T1）** 内适配完毕；**T12b 不再承担该处**。**两个行区间分属 Commit 1 / Commit 4，串行无冲突、无矛盾。**

  **Recommended Agent Profile**:
  - **Category**: `quick` — 组件级改造，边界明确。
  - **Skills**: [`sw-verification-before-completion`, `sw-ui-ux-review`]
    - `sw-ui-ux-review`：复选框/单选框的 a11y 与状态可见性。

  **Parallelization**:
  - **Can Run In Parallel**: YES（**独占 `recovery/*`**；与 T6 / T8 文件不重叠）
  - **Parallel Group**: Wave 3（Rev 4 重排：T12b 提前，因它只需 **T6**）
  - **Blocks**: F1–F5
  - **Blocked By**: **T6**（service 侧 `errorCode`/`autoBind` 契约已就绪）
  - **注**：**不再 `deps T9`**（Rev 4 D 项修正：Recovery payload 形状在 T1 已定型，T9 只做 background 路由，与 T12b 无编译耦合）

  **References**:
  - **Pattern References**:
    - `src/ui/recovery/App.tsx:79-100` — 现按钮区（待改造）。
    - `src/ui/recovery/main.tsx:16-53` — URL 参数解析 + 动作处理器（待扩展）。
    - `src/ui/shared/components.tsx:247-284` — `Toast` 范式（窗内错误可用 `role="alert"`，App.tsx:87 已有）。
  - **API/Type References**:
    - `src/shared/messages.ts`（T1 后）— Recovery 载荷（`autoBind`）。
    - `src/shared/types.ts:247` — **既有** `PROTECTED_PAGE` domain error（BLK-B / B2：窗内报错判据；不新增 outcome 变体）。
    - `_context-output/designs/2026-09-30-slot-switch-consistency-detail-interaction-copy-design.md:89-95` — 成品文案（DT8④⑤）。
  - **Test References**:
    - `tests/unit/ui/recovery-selector.test.tsx` — 既有 RecoveryWindow 测试（**授权例外-④**：C5 授权重写）。**注**：**该文件是 `Tab Not Found` 标题 + `role="dialog"` 的实际锁定点**（BLK-3 NIT 修正）。
    - `tests/ui-smoke/pages.smoke.test.tsx:83-98`（恢复窗 props；**实际断言仅 `getAllByRole('button').length > 0`**）— 冒烟（**授权例外-⑥**：仅限 props 形状适配）。**注**：`:104-111` 的 `ImportPreview` 字面量**已归 T1 处理**（Rev 6 · BLOCKER-1，Commit 1），**不是 T12b 的改动面**。
  - **WHY Each Reference Matters**: `main.tsx:47` 的 `window.close()` 是 Prev/Next 当前关窗行为的实现处，DT3 要求改为不关窗——必须精确区分「哪些动作关窗」；`detail:89-95` 是成品文案唯一来源，逐字对齐可避免文案漂移；**`pages.smoke.test.tsx:83-98` 只需在 `<RecoveryWindow>` 新增 props 时同步 props 形状（TS2322）**；同文件 `:103-111` 的 `ImportPreview` 字面量已在 **T1** 适配结束（**两行区间分工明确，无矛盾**）。

  **Acceptance Criteria**:
  - [ ] `npx vitest run tests/unit/ui/recovery-selector.test.tsx tests/unit/ui/recovery-window.test.tsx` → ALL PASS
  - [ ] `npm run test:ui-smoke` → ALL PASS（**BLK-3 NIT**：`pages.smoke` 仅断言「至少 1 个 button」；标题锁定在 `recovery-selector.test.tsx`；`pages.smoke:83-98` 的 props 已随新 props 同步）
  - [ ] `npm run test:unit` → ALL PASS
  - [ ] `npm run typecheck` → 0 error（**新 props 形状适配的编译验收**；**注**：`pages.smoke:103-111` 的 `ImportPreview` 形状已由 **T1** 适配，**不在本任务范围**）

  **QA Scenarios**:
  ```
  Scenario: Prev/Next 连点不关窗 + Open URL 仅 Exact
    Tool: Bash (test runner)
    Steps:
      1. render(matchType:'exact') → 断言 'Open saved URL in new tab' 存在
      2. render(matchType:'regex') → 断言该按钮不存在
      3. matchType:'exact'，点 Next Match 两次 → 断言 onNextMatch 被调 2 次且窗仍在（未调用 onDismiss/close）
    Expected Result: 浏览动作留窗、可连点
    Failure Indicators: 点一次即关窗（原 main.tsx:47）
    Evidence: evidence/task-T12b-prevnext.txt

  Scenario: Open URL 特权页 → 既有窗内报错路径（BLK-B / B2，反例）
    Tool: Bash (test runner)
    Steps:
      1. render(matchType:'exact')
      2. mock RECOVERY_OPEN_URL 返回 { success:false, errorCode:'PROTECTED_PAGE', message:'This URL cannot be opened' }
      3. 点 'Open URL' → 断言窗内出现 'This URL cannot be opened'，窗未关闭
    Expected Result: 走既有 errorCode 窗内报错路径渲染（不新增 outcome 变体）
    Failure Indicators: 无错误提示 / 渲染依赖 protected_blocked / 直接关窗
    Evidence: evidence/task-T12b-protected-error.txt

  Scenario: autoBind 复选框持久化 + 载荷携带（反例）
    Tool: Bash (test runner)
    Steps:
      1. 复选框初始显示有效值（如已勾选）
      2. 取消勾选 → 断言发出 SET_SLOT_AUTO_BIND { override:false }
      3. 点 Open URL → 断言 RECOVERY_OPEN_URL 载荷含 autoBind:false
    Expected Result: 立即持久化 + 载荷以所见为准（消除竞态 A12）
    Failure Indicators: 动作载荷缺 autoBind（background 回读持久化值）
    Evidence: evidence/task-T12b-autobind.txt
  ```

  **Commit**: YES (**Commit 4**，Rev 4 重排后编号)

- [x] ~~T12c. 设置页 `settings/App.tsx`：三旋钮 + 方向 + autoBind + 每槽一行~~ → **`ABSORBED` by T1（Rev 4-B / Rev 4-C #4）**

  > **处置**：`StrategySection` 重写（三旋钮 + 方向 + 全局 autoBind + 每槽一行）+ `loadState` / `handleGlobalChange` / `handleSlotChange` / props 传递**全部并入 T1**。
  > **依据**：user 明确「**#3/#4 不再是「占位死结」，而是必须在新任务里直接改为新语义（属合并任务的正当范围）**」。**per Rev 4-B**，无兼容层 ⇒ 设置页无法「先占位后替换」。
  > **原 T12c 引用（已迁入 T1）**：`src/ui/settings/App.tsx:16/137-218/1599-1640/1623/1771/1795-1796/1821-1852/1896-1904`、`detail:67-83`（DT8①②）、`tests/unit/ui/settings.test.tsx:96/109`。
  > **原 T12c 护栏保留**：`settings-loading-states.test.tsx`（三态 + 22 行命令表）**不得破坏**；`NAV_ITEMS` 的 `strategy` label 仍 `Global Strategy`；`src/ui` CJK 0。
  > **原 T12c QA（已迁入 T1）**：三旋钮默认值 / 方向默认 `Next Match` / autoBind 默认勾选 / 每槽一行 10 行 / `Custom` 展开 3 select / 三态 `override ∈ {true,false,null}` —— 证据文件名 `evidence/task-T1-settings-knobs.txt` / `-settings-autobind.txt`。

**【原 T12c 卡体已完全移除】** —— 内容并入 T1。**无悬空引用。**

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 5 个审查者并行；全部 PASS 后呈现给用户并取显式 okay。**未取 okay 前不得勾选 F1–F5。**

- [ ] F1. **Plan Compliance Audit**（recommended: `oracle`）
  - Must Have 逐条验证（读实现 + 跑测试）；Must NOT Have 反查（`rg`）；Evidence 齐全性；Deliverables 对照实现
  - Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | Evidence [N/N] | VERDICT`

- [ ] F2. **Code Quality Review**（recommended: `unspecified-high`）
  - `build:chrome|edge|firefox` 成功；lint **delta-0**（before/after JSON 差集新增 = 0）；`typecheck` 0
  - 模式检查：新增 `as any`/`@ts-ignore`/空 catch/生产 `console.log`
  - Output: `Build [PASS] | Lint-delta [0] | Typecheck [PASS] | Tests [N/N] | VERDICT`

- [ ] F3. **独立复验（MANDATORY，不采信执行者自审）**（recommended: `deep`，由**未参与实现**者执行）
  - 独立执行每个任务 QA 场景、独立重跑 RED/GREEN、独立读 `git diff`、独立复现「只弹 1 窗 / 只开 1 页 / 不关窗连点」
  - 必须含**独立复现命令与原始输出**；不得引用执行者证据文件作为通过依据
  - 重点复验上一轮盲区：副作用唯一性、`Open URL` 收敛、`↑/↓` 语义、设置页三态
  - **裁决专项（Rev 2）**：① BLK-A / A1 —— `↑/↓` 起点确由载荷 `anchorTabId` 决定，`anchorTabId` 失效时**降级当前活动页、不报错**，且**无新增持久化字段**；② BLK-B / B2 —— 源码 `rg 'protected_blocked'` 0 命中，特权页 `Open URL` 独立复现返回 `PROTECTED_PAGE` + 窗内 `This URL cannot be opened`
  - **复验专项（Rev 3）**：② BLK-2 —— 独立重跑 `tests/unit/shared/url-utils.test.ts:362-375`，确认期望数组含 `'file://'` 且 `toEqual` 结构**未放宽**；③ NIT-N1 —— 独立确认 T1 的**有效 RED** 来自 `routeMessage` known-actions / resolver 模块缺失 / 新默认归一 / 旧导出被拒（非「不含 protected_blocked」护栏）；④ NIT-N2 —— 独立经 `routeMessage` 复现 **6** 新 action 可达 + 未知 action 返回 `UNKNOWN_ACTION`
  - **复验专项（Rev 4）**：① **原子任务无红区** —— 独立重跑 Commit 1 的 `npm run typecheck`，确认 **0 error**（`TS2367` / `TS2322` 已在本任务内消除）；② **无兼容层** —— 独立 `rg -n 'schemaVersion|globalStrategy|DEFAULT_STRATEGY' src tests` → **0 命中**；③ **不读旧字段** —— 独立读 `migrateSyncState` 实现，确认**未**引用 `globalStrategy`；④ **旧导出被拒** —— 独立复现 `generatePreview(旧形状 JSON)` → `IMPORT_INVALID`；⑤ **N-4** —— 独立确认 Commit 1 pre-commit **含** `test:integration`
  - **复验专项（Rev 5 · D17）**：① **死代码归零** —— 独立复跑 `rg 'MatchStrategy' src tests` → **0 命中** 且 `rg 'DEFAULT_STRATEGY' src tests` → **0 命中**（**独立于执行者，不采信其证据文件**）；② **替代常量就位** —— 独立复跑 `rg 'DEFAULT_MATCH_SETTINGS' src tests` → **命中**（定义 + 消费者），并核对 `DEFAULT_MATCH_SETTINGS === { tabIdMode:'exists', ruleCheckMode:'match', priority:'tabId' }`；③ **对照表载体** —— 独立确认 A/B/C→四格对照**仅**在 `design:146-154`（§3.1），`src tests` 无映射表；④ ~~typecheck 破例复核 8/8 绿~~ → **【Rev 6 · A-5 更正】** **改为**：独立重跑 **Commit 1 边界的 `npm run typecheck`（0 error）与 `npm run test:unit`（ALL PASS）**，确认 **T1 闭环判据成立**（**Rev 4-F / Rev 5-E 的「8/8 已实测」结论已撤回**）；Commit 2–8 的绿由各自 **pre-commit** 独立复跑确认
  - **复验专项（Rev 6 · A/B 裁定）**：① **闭环判据真实性** —— 独立重跑 `npm run typecheck`（→ 0 error）与 `npm run test:unit`（→ ALL PASS），**不采信执行者证据文件**；② **BLOCKER-1** —— 独立确认 `pages.smoke.test.tsx:103-111` 已改为 `matchSettings`/`switchDirection`/`autoBindGlobal`（无 `globalStrategy`），且 `npm run test:ui-smoke` 通过；③ **BLOCKER-2** —— 独立确认 `settings.test.tsx:96/109/122` 三用例已按三旋钮语义重写且 `test:unit` 通过；④ **NIT-3** —— 独立复跑 `rg 'globalStrategy' tests/integration/rule-delivery-real-dom.test.ts tests/unit/background/sync-write-resilience.test.ts` → **0 命中**（确认悬空引用已去噪、未错误纳入）；⑤ **NIT-4** —— 独立确认读 `sync.matchSettings` 的实现路径含 `?? DEFAULT_MATCH_SETTINGS` 兜底，并**确认该兜底不读取 `globalStrategy`**（非兼容层）；⑥ **A-4 报告完整性** —— 独立核对交付报告的「实际改动面清单」是否为 `git diff` 的**忠实超集/等价**，**无静默扩大范围**
  - Output: `Scenarios [N/N] | Independent Repro [N/N] | Integration [N/N] | Verdict-A1/A2 [PASS] | Rev3 [PASS] | Rev4 [PASS] | Rev5-D17 [PASS] | Rev6-ClosedLoop [PASS] | Rev6-BLOCKERs [PASS] | Rev6-NITs [PASS] | VERDICT`

- [ ] F4. **Scope Fidelity Check**（recommended: `deep`）
  - 每任务对照 `git diff` 1:1 映射；无超标新增（无新依赖/无未授权文件）；Must NOT 合规；任务越界检测
  - **授权例外核对（Rev 3 / BLK-3 扩清单 + Rev 4 第 ⑧ 项）**：对照 `Must NOT Have` 的**显式枚举 8 项**（①`slot-service.test.ts`、②`settings.test.tsx`、③`recovery-service.test.ts`、④`recovery-selector.test.tsx`、⑤`sidebar-open-page.test.tsx`、⑥`pages.smoke.test.tsx`（仅 props/形状适配）、⑦全部 `globalStrategy/strategy` 夹具、**⑧ Rev 4 编译面形状适配专项：`message-client.test.ts` / `messages.test.ts` 的 `DEFAULT_STRATEGY`+`assertNever` / `slot-service.test.ts:135` / `full-suite.test.ts` / `RecoverySession` 显式夹具补字段（`messages.test.ts` / `storage-repository.test.ts` / `recovery-service.test.ts`）/ `worker-orchestrator.test.ts` / `import-export-service.test.ts`**）逐一判定 —— **须区分**：命中枚举 = 授权（非越界）；枚举之外被改 = 越界。**`pages.smoke` 的实际断言面**：`:83-98` **只断言 `getAllByRole('button').length > 0`**；标题锁定在 `recovery-selector.test.tsx`（BLK-3 NIT 修正）。且 `needs_recovery` 4 处锁定未被削弱
  - **Rev 4 越界核对（取代 Rev 3 的「占位越界」核对）**：**计划中已无「占位」概念** ⇒ 核对项改为：① T1 diff 中**不得出现**任何读取 `globalStrategy` 的代码、任何 `schemaVersion` 声明、任何迁移映射表；② `MatchStrategy` 不得出现在 `SyncState` / `SlotDefinition.strategy` / `ExportPayload` / `ImportPreview` / 任一消息 payload（**【Rev 5 · D17】类型定义/常量本身亦不得存在**）；③ T8 **不得**重写策略分派（属 T1）；④ T12b **不得**依赖 T9 的 background 路由（只依赖 T6 契约）
  - **【Rev 5 · D17】死代码越界核对**：T1 diff 中**不得**保留 `MatchStrategy` 类型定义（`types.ts:8`）、`DEFAULT_STRATEGY` 常量（`types.ts:15`）、任何 `import { MatchStrategy }`、任何 `as MatchStrategy` 强转、任何 A/B/C→四格映射表/对照常量；**且**不得把删除面「外溢」到 `design §3.1`（**对照表必须保留**，D17 明示其唯一载体）
  - **【Rev 6 · A-2/A-4】范围越界核对（新判据）**：**不得**以「T1 改动超出 v5 References 清单」为由判越界 —— **清单已降格为「预期命中参考（非完备性要求）」**（Rev 6-A-2）。判定改为：① T1 的**计划外**改动是否**全部**出现在交付报告的「实际改动面清单」中（**无静默扩大**）；② 是否存在**契约级变更**（`SwitchOutcome` 变体数 / A1 / B2 / `matchSettings` 字段集 / action 集合）**未经停报**；③ `?? DEFAULT_MATCH_SETTINGS` 兜底**不得**伴随 `globalStrategy` 读取（NIT-4 边界）
  - **【Rev 6 · BLOCKER 登记完整性】** 确认 `pages.smoke.test.tsx:103-111`（T1）与 `settings.test.tsx:96/109/122`（T1）**均已纳入 T1 改动面**，且 `pages.smoke.test.tsx:83-98` 归 T12b（**行区间分工清晰**）
  - Output: `Tasks [N/N compliant] | Contamination [CLEAN] | Unaccounted [CLEAN] | AuthException [8/8 matched] | NoCompatLayer [CLEAN] | DeadCode-Zero [CLEAN] | ScopeReport [FAITHFUL] | VERDICT`

- [ ] F5. **契约与形状专项审计**（recommended: `oracle`）— **Rev 4 更名**（原「契约与迁移专项」）+ **Rev 5 扩 D17 死代码专项**
  - `needs_recovery` 契约（`slot-service.test.ts:146/162`、`full-suite.test.ts:71/179`）独立复跑通过；**契约不缩减**且 **`SwitchOutcome` 仍为既有 4 变体**（无 `protected_blocked`）
  - **【Rev 4 取代「迁移零漂移」】** **无兼容层核查**：`rg -n 'schemaVersion|globalStrategy' src tests` → **0 命中**；`migrateSyncState` 实现**不读**任何旧字段
  - **【Rev 5 · D17 复核】** **死类型/死常量归零**：`rg -n 'MatchStrategy' src tests` → **0 命中**、`rg -n 'DEFAULT_STRATEGY' src tests` → **0 命中**、`rg -n 'DEFAULT_MATCH_SETTINGS' src tests` → **命中**；独立确认 `types.ts` **无** `MatchStrategy`/`DEFAULT_STRATEGY` 残骸（**注意 v4 曾允许「类型定义本身保留」，该豁免在 v5 已取消**）；A/B/C→四格对照**仅**在 `design:146-154`
  - **【Rev 4】新默认归一**：独立复现「旧形状 `syncState` → hydrate → `matchSettings === DEFAULT_MATCH_SETTINGS`、`configVersion` 不变、无 `globalStrategy`」
  - **GAP-C / GAP-D 复核**：导出/导入形状 `matchSettings`（无顶层 `globalStrategy`）+ **旧导出文件被拒**（`IMPORT_INVALID`）+ **经 `routeMessage` 断言** **6** 个新 action 不返回 `UNKNOWN_ACTION`（NIT-N2：`isKnownAction` 未 export，不直接调）（RED 证据齐备）
  - **BLK-2 复核**：`tests/unit/shared/url-utils.test.ts:362-375` 期望数组含 `'file://'` 且 `toEqual` 未放宽
  - **【Rev 4】无迁移义务确认**：无迁移单测（**非缺陷**）；RK1 状态 = `CLOSED_NOT_APPLICABLE`（`decisions.yaml`）；`needs_recovery` 4 处锁定 + 4 变体冻结为**唯一**仍需守护的跨层契约
  - Output: `Contract [PASS] | NoCompatLayer [PASS] | DeadCode-Zero [PASS] | NewDefaults [PASS] | GAP-C/D [PASS] | BLK2 [PASS] | RK1 [CLOSED] | VERDICT`

---

## Commit Strategy

```
Commit 1: feat(contracts)!: reshape SyncState to tri-knob model, drop globalStrategy/schemaVersion, delete MatchStrategy/DEFAULT_STRATEGY dead code, atomic switch/slot/settings/import rewrite (T1)
  Files: src/shared/types.ts, src/shared/messages.ts, src/background/switch/**（新建 primitives + resolvers + resolve-switch）,
         src/background/storage-repository.ts, src/background/slot-service.ts, src/background/import-export-service.ts,
         src/ui/import-preview/main.tsx, src/ui/shared/message-client.ts, src/ui/settings/App.tsx,
         src/background/worker-orchestrator.ts（仅 KNOWN_ACTIONS + SET_*_STRATEGY payload 行）,
         [测试侧] tests/unit/background/switch/*, tests/unit/background/known-actions.test.ts, tests/unit/shared/messages.test.ts,
                 tests/unit/ui/import-diagnostics.test.tsx, tests/unit/ui/message-client.test.ts,
                 tests/unit/ui/settings.test.tsx（Rev 6 · BLOCKER-2：:96/109/122）,
                 tests/ui-smoke/pages.smoke.test.tsx（Rev 6 · BLOCKER-1：仅 :103-111 的 ImportPreview 形状）,
                 tests/integration/storage-repository.test.ts, tests/integration/worker-orchestrator.test.ts,
                 tests/integration/import-export-service.test.ts, tests/integration/slot-service.test.ts, tests/integration/full-suite.test.ts
  Pre-commit: npm run typecheck && npm run test:unit && npm run test:integration
  ← 【N-4 修正】新增 test:integration；typecheck 保留（Rev 4：原子任务，无阶段性红、无占位）
  ← 【Rev 6 · A-1】T1 完成判据 = typecheck 0 error 且 test:unit ALL PASS（闭环式，由 tsc/vitest 定义权威清单）
  ← 【Rev 6 · BLOCKER-1】额外自跑 npm run test:ui-smoke（pages.smoke 属 ui-smoke 项目）
  ← 【Rev 5 · D17】同提交删除 MatchStrategy/DEFAULT_STRATEGY（32 处）；静态断言 rg 'MatchStrategy' src tests = 0、rg 'DEFAULT_STRATEGY' src tests = 0

Commit 2: chore(security): add file:// to canonical protected prefixes (T3)
  Files: scripts/gen-protected-prefixes.mjs, src/shared/protected-prefixes.generated.ts, src/content/protected-prefixes.inline.generated.ts,
         tests/unit/shared/url-utils.test.ts（BLK-2 同步更新点）, tests/unit/shared/protected-prefixes.test.ts
  Pre-commit: npm run typecheck && npm run test:unit

Commit 3: feat(recovery): prev/next cursor, exact-only Open URL, recovery window reuse (T6)
  Files: src/background/recovery-service.ts, src/shared/types.ts(RecoverySession 扩展面), src/background/slot-service.ts(createRecoverySession),
         tests/integration/recovery-service.test.ts, tests/unit/background/recovery-*.test.ts,
         tests/unit/shared/messages.test.ts（RecoverySession 夹具，X10）, tests/integration/storage-repository.test.ts（同上，X10）
  Pre-commit: npm run typecheck && npm run test:unit && npm run test:integration

Commit 4: fix(ui): recovery window redesign — prev/next without close, protected-page inline error (T12b)
  Files: src/ui/recovery/App.tsx, src/ui/recovery/main.tsx, tests/unit/ui/recovery-selector.test.tsx, tests/unit/ui/recovery-window.test.tsx,
         [BLK-3 授权例外-⑥] tests/ui-smoke/pages.smoke.test.tsx（仅 :83-98 的 RecoveryWindow props；:103-111 的 ImportPreview 形状已在 Commit 1/T1 完成）
  Pre-commit: npm run typecheck && npm run test:unit && npm run test:ui-smoke

Commit 5: feat(slot): position back-end (↑/↓) + direction awareness (T8)
  Files: src/background/slot-service.ts, tests/integration/slot-service.test.ts, tests/unit/background/position-*.test.ts
  Pre-commit: npm run typecheck && npm run test:integration

Commit 6: feat(worker): applySwitchOutcome + new action routing (T9)
  Files: src/background/worker-orchestrator.ts, tests/integration/apply-switch-outcome.test.ts
  Pre-commit: npm run typecheck && npm run test:integration

Commit 7: fix(worker): in-flight coalescing + single creator for page opening (T10, T11)
  Files: src/background/worker-orchestrator.ts, tests/integration/open-page-coalescing.test.ts, tests/integration/switch-coalescing.test.ts, tests/integration/open-page-diagnostics.test.ts
  Pre-commit: npm run typecheck && npm run test:integration

Commit 8: feat(ui): sidebar position buttons + idempotent footer (T12a)
  Files: src/ui/sidebar/App.tsx, tests/unit/ui/sidebar-position.test.tsx, tests/unit/ui/sidebar-open-page.test.tsx
  Pre-commit: npm run typecheck && npm run test:unit && npm run test:ui-smoke
```

> **【Rev 4 提交数】11 → 8**（原 Commit 1 与 T3 合并 → 现拆为 Commit 1 / Commit 2；原 Commit 2/3/5/11 消失 = 任务已并入 T1）。
> **【Commit 6/7 的 RecoverySession 与 slot-service 触碰说明】** Commit 3 触碰 `src/shared/types.ts`（`RecoverySession` 扩展）与 `src/background/slot-service.ts`（`createRecoverySession`），Commit 5 亦触碰 `slot-service.ts` —— **顺序上不冲突**（串行）。
> ⚠️ **【Rev 6 · A-5 更正（取代 v5 的「每次提交后 typecheck 均绿」断言语）】** **Commit 1 的绿由 T1 闭环判据（`typecheck` 0 error + `test:unit` ALL PASS）保证**；**Commit 2–8 的绿由各自 pre-commit 保证**（**不是**「已实测 8/8 绿」——该结论已撤回）。**Commit 4 触碰 `pages.smoke.test.tsx:83-98`（props）**，与 **Commit 1 触碰 `:103-111`（ImportPreview 形状）** 分属两次提交、**串行无冲突**。

---

## Success Criteria

### Verification Commands

```bash
npm run typecheck            # Expected: exit 0, 0 error
npm run lint                 # Expected: delta-0 vs before.json（新增 = 0）
npm run test:unit            # Expected: ALL PASS（含新增 resolver/原语/设置页/恢复窗用例）
npm run test:integration     # Expected: ALL PASS（映射表/合流/新默认归一/旧导出被拒）
npm run test:ui-smoke        # Expected: ALL PASS
npm run build:chrome         # Expected: exit 0
npm run build:edge           # Expected: exit 0
npm run build:firefox        # Expected: exit 0
npx vitest run tests/integration/slot-service.test.ts tests/integration/full-suite.test.ts  # needs_recovery 契约保留
npx vitest run tests/unit/shared/url-utils.test.ts   # Expected: ALL PASS（BLK-2：期望数组含 'file://'，toEqual 未放宽）
rg -n '[\u4e00-\u9fff]' src/ui   # Expected: 0 命中
rg -n 'eslint-disable' src       # Expected: 3（与基线一致，不增）
rg -n 'protected_blocked' src tests  # Expected: 0 命中（BLK-B / B2；性质=护栏，非 RED）
rg -n 'anchorTabId' src           # Expected: 命中（T1 载荷 / T8 消费 / T12a 传参）
# 【Rev 4 新增】
rg -n 'schemaVersion' src tests   # Expected: 0 命中（裁定 2）
rg -n 'globalStrategy' src tests  # Expected: 0 命中（裁定 1/3/4：读写皆无）
rg -n 'DEFAULT_STRATEGY' src tests # Expected: 0 命中（X3：已替换为 DEFAULT_MATCH_SETTINGS）
# 【Rev 5 · D17 新增】
rg "MatchStrategy" src tests      # Expected: 0 命中（死类型已彻底删除；不含文档面）
rg "DEFAULT_MATCH_SETTINGS" src tests # Expected: 命中（定义 + 消费者；D17 替代常量就位）
# 载体核查：A/B/C→四格对照仅存在于 design:146-154（§3.1 markdown），不进入代码/类型
# BLK-1 核对（Rev 4）：T1 为原子任务（无占位、无兼容层）；不存在 commit 级 typecheck 红区（设计意图）
# 【Rev 6 · A-1 完成判据（闭环式，权威）】
npm run typecheck                 # T1 完成判据 ① Expected: exit 0, 0 error
npm run test:unit                 # T1 完成判据 ② Expected: ALL PASS（vitest --project unit）
# Commit 1 的绿由上述两条保证；Commit 2–8 的绿由各自 pre-commit 保证
# 【Rev 6 · A-5】Rev 4-F / Rev 5-E 的「8/8 提交 typecheck 绿（已实测）」结论已撤回
# 【Rev 6 · NIT-3 悬空引用去噪核查】
rg "globalStrategy" tests/integration/rule-delivery-real-dom.test.ts tests/unit/background/sync-write-resilience.test.ts  # Expected: 0 命中
```

### Final Checklist

- [ ] All 「Must Have」present
- [ ] All 「Must NOT Have」absent
- [ ] 全任务完成（**9/9 实现/诊断：T1 / T3 / T6 / T8 / T9 / T10 / T11 / T12a / T12b**；T2/T4/T5/T7/T12c 标 `ABSORBED`/`DELETED`）
- [ ] 全测试通过
- [ ] 全 QA 场景执行并有证据
- [ ] F1–F5 全部 APPROVE（F3 独立复验）
- [ ] Rev 2 裁决落实：BLK-A/A1（`anchorTabId` 载荷 + 失效降级）与 BLK-B/B2（`PROTECTED_PAGE`，无 `protected_blocked`）
- [ ] Rev 3 落实：BLK-2（`url-utils.test.ts:362-375` 期望数组含 `file://`）/ BLK-3（授权例外显式枚举 7 项 + `pages.smoke` 语义澄清 + NIT 精度修正）/ N1–N4
- [ ] **Rev 4 裁定落实**：① 无 `globalStrategy`；② 无 `schemaVersion`；③ 旧数据被忽略、静默落新默认 `exists+match+tabId`；④ 旧导出文件被拒；⑤ D10/C4/A8 `SUPERSEDED`、RK1 `CLOSED_NOT_APPLICABLE`；⑥ 4 变体冻结 + `needs_recovery` 4 处锁定
- [ ] **Rev 4 结构性落实**：契约 + 派发骨架合并为 T1 原子任务（**无占位期**）；T8 缩减；T5 删除；N-1/N-2 自然消解；N-3 Matrix 一致；N-4 Commit 1 pre-commit 含 `test:integration`
- [ ] **Rev 4 自查项落实**：**X1–X10** 全部纳入 T1 / T6 / T12b（无悬空引用）
- [ ] **Rev 5 · D17 裁定落实**：① `MatchStrategy` 类型定义**已彻底删除**（不留死类型）；② `DEFAULT_STRATEGY` 常量**已彻底删除**（不留死常量）；③ `DEFAULT_MATCH_SETTINGS` 已新增取代；④ A/B/C→新四格对照**仅**为主设计 §3.1 markdown 表
- [ ] **Rev 5 · D17 静态断言**：`rg "MatchStrategy" src tests` → **0 命中**
- [ ] **Rev 5 · D17 静态断言**：`rg "DEFAULT_STRATEGY" src tests` → **0 命中**
- [ ] **Rev 5 · D17 静态断言**：`rg "DEFAULT_MATCH_SETTINGS" src tests` → **命中**（定义 + 消费者）
- [ ] **Rev 5 · D17 载体核查**：A/B/C→新四格对照表**未进入代码/类型**（仅 `design:146-154`）
- [ ] **Rev 5 执行安排落实**：T1 Profile = `deep` + 允许独立 worktree + 不可再拆（NO-FURTHER-SPLIT）；失败预案（计划外编译点可追加并逐条报告；契约变更须停报）已记录
- [ ] **Rev 5 悬空引用核查**：D17 删除面**无新增悬空引用**（32 处全在 T1）
- [ ] **【Rev 6 · A-1】判据落实**：T1 完成判据 = `npm run typecheck` → **0 error** 且 `npm run test:unit` → **ALL PASS**（**闭环式**）；卡内清单 = **预期命中参考（非完备性要求）**；T1 What to do 含**闭环执行循环**（改契约 → typecheck → test:unit → 修每一处 → 重复至全绿）
- [ ] **【Rev 6 · A-4】预案落实**：计划外编译/断言点**可就地纳入并逐条报告**（无静默扩大）；**契约级变更须停报**
- [ ] **【Rev 6 · A-5】错误结论已撤回**：Rev 4-F / Rev 5-E 的「8/8 提交 typecheck 绿（已实测）」已改为「**Commit 1 由 T1 闭环保证 / Commit 2–8 由各自 pre-commit 保证**」；`:735` vs `:1550` 的 `pages.smoke` 矛盾已消除
- [ ] **【Rev 6-B · BLOCKER-1】** `tests/ui-smoke/pages.smoke.test.tsx:103-111` 已纳入 T1 Files + What to do（补 `matchSettings`/`switchDirection`/`autoBindGlobal`，删 `globalStrategy`），定性 = 编译面
- [ ] **【Rev 6-B · BLOCKER-2】** `tests/unit/ui/settings.test.tsx:96/109/122` 三用例已显式登记（授权例外-②）
- [ ] **【Rev 6-B · NIT-3】** 悬空引用已删除（`rule-delivery-real-dom.test.ts:329`、`sync-write-resilience.test.ts:133/174/189`，实测 0 命中）
- [ ] **【Rev 6-B · NIT-4】** 读 `sync.matchSettings` 的实现含 `?? DEFAULT_MATCH_SETTINGS` 兜底（**且不读 `globalStrategy`**）
- [ ] **【Rev 6 必须保持】** 护栏 8 项 + `SwitchOutcome` 4 变体冻结 + A1/B2 + 不做迁移/无 `schemaVersion` + D17 + 任务数 9+F1–F5 + Wave 6+FINAL + 关键路径 + 8 提交 + 授权例外 8 项 + T1 Profile（deep / worktree / NO-FURTHER-SPLIT）**全部未回归**
- [ ] RK1 已记录为 `CLOSED_NOT_APPLICABLE`（不再是缓解项；`needs_recovery` 契约仍为唯一守护项）
- [ ] 用户显式批准
- [ ] Evidence 目录：`_context-output/evidence/` 已填充