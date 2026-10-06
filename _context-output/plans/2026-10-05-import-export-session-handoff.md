# Import/Export 迭代 · 会话交接（2026-10-05 收工）

> 用户指示"先暂停，明天再搞"。本文档用于**明日无缝恢复**。
> 权威决策/判据在 `_context-output/designs/2026-10-04-import-export-decisions.yaml`（含 `implementation_log`）；
> 任务与门禁在 `_context-output/plans/2026-10-04-import-export-iteration-plan.md`（含"实施期追加任务" + T14"实施期修正"）。

## 一、当前仓库状态（收工时 —— 已由 T15 提交固化）

- **HEAD**：`f9e26ad`（`feat(adapters): add commands.update + Chrome/Edge capability reporting (T15)`）
- **本地领先 `origin/main`**：**28 commits，未推送**
- **工作区（`src/` + `tests/`）**：**✅ 干净**
- **`src/ui/settings/App.tsx` 旧动作**：**0 命中**（T19 已移除 `EXPORT_CONFIG` 调用点）
- 源码基线：`tsc --noEmit` **0 error**；全量 **146 suites / 1180 tests / 0 fail**（T15 时点，明日复核）
- `eslint src/ui/settings/App.tsx`：**21 errors（pre-existing，零新增）**

> 收工点 = T15 提交（executor 越过了两次停令；T15 本身完整、非半成品，故**采信并归档**，但已**硬性叫停**后续 T20）。

## 二、已闭合任务（勿重做）

| 任务 | 提交 | 说明 |
|---|---|---|
| FIX-A Undo 保真 | `0e381f7` + `95446fd` | 快照存原始 `IconSource`（`canonicalIconSource`）+ 物化 mock + 删 `rule` 变体 |
| FIX-B override 物化 | `177593c` + `d00629a` | `resolveLocalIconReferences` 落 `getLocalState()`；sidebar raw 覆盖删除；strip 纯函数；B6 快照隔离 |
| FIX-C 反向源感知 | `bbf7ce4` + `db299c9` + `6ef2f00` | `iconSourceToDraft`/`iconSourceForOwner`；`InlineRuleEditor`；`matchesLocal` 全字段；移除 `IconConfig.url`；编辑往返/链上 Use |
| #2 prefill 守卫 | `4d8843a` | 修恒真断言（`__img` + `data-mode`） |
| T11 图标槽清空 | `8520a95` | `clearAndWriteWithCompensation` |
| T13 textColor | `31ae75c` | 回归固化 |
| T14a 协议加性 | `16df278` | 三新动作契约 + 白名单（旧动作共存） |
| T17 路由接线 + F4 | `788c9f9` | 三 case + `exportPackage`/`inspect` 服务方法 + 强制 `configVersion` |
| T17 双编译期守卫 | `7e1db9e` | `as const satisfies` + 双 `Exclude` + `_exhaustive: never` + 差集测试 |
| T18 导入 UI | `eb478d0` | 维度模式 + 量化确认 + 真实 hidden input + `importApply(...,expectedVersion)` |
| 对称哨兵 | `7594b08` | `expect(declared.size).toBe(50)` |

## 三、T19 已完成（`44835b1`）✅

**状态**：已提交，工作区 clean。验收要点（executor 报告，明日复核）：
- **独立导出 section**（`settings/App.tsx` 内，Q2=B-2）：4 维度复选框 `export-dim-{slots|rules|settings|shortcuts}`；
- **空选择拦截**：`export-submit` disabled + 可见原因 `export-empty-reason`；
- **先展示包摘要 → 再单独点 Download**（D1/D13）；下载沿用 `Blob + createObjectURL` + `tab-bookmarks-config-YYYY-MM-DD.json`；
- **旧导出 UI 移除**：`<h3>Export</h3>` + "Export Configuration" 按钮 + `EXPORT_CONFIG` 调用点全删 ⇒ settings 旧动作 **0** ✓；
- 导入确认弹窗的「导出备份」改为 **`EXPORT_PACKAGE(all)`**（A11），仍为**并列兄弟、不应用**（A9）；
- **未删**后台 case/白名单（T14b）。
- RED→GREEN：`export-flow.test.tsx` **2/2**（四复选框 + 空选择禁用；勾选后 `EXPORT_PACKAGE` scope 正确 + **摘要先于下载**）。

**收敛数字**：`src/` 旧动作 **15 行 = 14 代码 + 1 注释**（settings 0）⇒ T14b 清零（代码面）。

## 四、待办任务（按序）

0. 🔴 **T18-D7 HIGH（第一件事，必修）** —— 见"五之补"（`deletionCounts` 按当前 intent 重算 + 测试改真实 `computeDiff`）。
1. ✅ **T15 已完成**（`f9e26ad`）—— 适配层 `commands.update()` + Chrome/Edge 能力报告；**UI shortcuts 分支归 T22**（裁定）；`manifests/` 未改；未用 `as any`（窄局部形状 + 运行时探测）。
2. **T20**（`ImportPreviewTable` 演进为维度分组 + 字段级展开；含**组件保留但类型迁移**到 `ImportInspection`，见计划 T20 增补）。
3. **T21**（收口）—— **含 T14b**：删旧三动作（契约/case/白名单/`message-client` 封装）+ 迁移测试锚点 + **语义翻转** + 孤儿页入口处置。判据见下"W5 锚点"。
4. **T22**（结果清单呈现：成功/宽容/域违规/缺失/重合/快捷键引导）。
5. **终验波**（F1–F4，4 review agents 并行；须用户显式"okay"才算完成）。

## 五、W5 锚点（T14b/T21 收口判据，已冻结）

**机械化锚点（排除注释，实测饱和度 = 25 = src/ 17→15→14 + tests/ 8）**：
```
rg -n --glob '*.ts' --glob '*.tsx' "^[^*/]*\b(EXPORT_CONFIG|IMPORT_PREVIEW|IMPORT_COMMIT)\b" src/ tests/
```
**同族旧类型锚点**（`\b` 防误匹配 `ImportPreviewTable`）：
```
rg -n "\b(ExportConfigRequest|ExportConfigResponse|ImportPreviewRequest|ImportPreviewResponse|ImportCommitRequest|ImportSlotConflict|ImportSlotDecision|ExportPayload|ImportPreview)\b" src/   → 0
```
**服务方法名兜底锚点**：
```
rg "\.(exportConfig|generatePreview|commitImport)\(" src/   → 0
```
**豁免**：`ImportPreviewTable` / `ImportPreviewProps`（组件保留，T20 演进）；**注释命中不归零**。
**语义翻转清单**（非清零）：
| 位置 | T14b 应做 |
|---|---|
| `contract.test.ts:50` `LEGACY_ACTIONS` + `:59-63` 断言 | 翻转为"legacy 已删"（`claimed===false`） |
| `messages.test.ts:58-60`（`assertNever` 的 legacy case） | **同批删**（删后 `assertNever` 会再次报错），删完 `tsc` 仍须 0 |
| `messages.test.ts:279/305` | 翻转为不含 legacy |
| `routing.test.ts:10/79` | **保留**（纯注释，历史对照） |
| 孤儿页 `ui/import-preview/` 入口（`main.tsx`/`index.html`/`vite.config.ts:36`） | T20 定稿时默认删除入口 |

> **T14b 开工当日须重跑 + 逐行分类**（数字会漂，本迭代已多次证实）。

## 五之补、🔴 **T18 复审遗留 HIGH（明日必修，未关闭）**

> reviewer 于收工后提交（`eb478d0`/`7594b08` 复审）。我**已独立复核确认成立**，**今日不修**（用户暂停），明日**优先修**。

### HIGH：D7 量化未按"最终生效的选择"重算
- **设计原文**（`decisions.yaml` D7）："量化须按**最终生效的选择**计算，并由服务端重算后校对"；且设计**专门否决**"按模式开关显示会漏报"。
- **实现**（`settings/App.tsx:2291-2299`）：`deletionCounts` 直接遍历 **`inspection.diff.records`** 的 `status==='deleted'`；而 `inspection` 来自 `IMPORT_INSPECT`，`inspect()`（`import-export-service.ts:128`）用 **`defaultImportIntent()`** 计算 ⇒ 该 `status` 是**默认 intent（incremental）下**的结果。
- **UI 从不重算**（实测：`src/ui` 内 `import-diff`/`computeDiff`/`applyIntent`/`deletesFileMissing` **0 引用**）。
- **后果（严重）**：`deletesFileMissing`（`import-diff.ts:85-89`）在 `incremental` 下对 file-missing 返 **false** ⇒ 默认 **deleted 计数恒 0** ⇒ 用户把维度切到 **`overwrite`**（真会删该维度全部 file-missing 记录）后，弹窗仍说 **"delete no records, and cannot be undone"** ⇒ **最需要警示时给出最误导文案**，直接违背 D7。
- **修法（二选一）**：
  1. `deletionCounts` 按**当前 `intent`** 重算 —— 复用 `src/shared/import-diff.ts` 的 `deletesFileMissing(intent.dimensionModes[kind], overrideFor(...))`（UI 可 import）；或
  2. 改用服务端 `applyIntent` 的 destructive summary。
- **锚点/反例**：改 `slots` 模式 → `incremental` ↔ `overwrite` → 弹窗文案须**随之变化**（`overwrite` 须含该维度删除数）。

### 同因 · 测试假绿（与 FIX-A 那次同族）
`tests/ui-smoke/import-flow.test.tsx:22-38` 的 `INSPECTION` **手工**把 slot1/2、rule r1/r2/r3 全标 `status:'deleted'`（`dimensions.slots=true`），而按 `defaultImportIntent`（slots 仍 **incremental**）真实 `computeDiff` 会给出 **0 deleted** ⇒ **fixture 与任何单一 intent 的真实输出都不一致**。
⇒ `:141` 断言 `delete 2 slots and 3 rules` 只验证「**UI 读 fixture 的 status**」，**结构上测不出**"切 mode 后计数不变"。
**修法**：测试改用**真实 `computeDiff(...)` 输出**，并**加用例**：`slots: overwrite` ⇒ 文案含该维度删除数（RED→GREEN 自证）。

### 判定
**T18「有条件通过」** —— 除 D7 外全部达成（F4 前置判定被 reviewer 独立确认"正确且必要"；A11/D12、A9、A2/A1/A4、D7 恒定弹窗、哨兵均通过）。
⇒ **T18 未闭合**；**D7 明日必修**（T19 已提交、工作区干净 ⇒ **D7 是明日第一件事**，同文件 `settings/App.tsx`）。**此 HIGH 优先于 T15**。

## 六、未决/残留（非阻断，均已有裁定）

- `missingIcons` 生产者 → T11/T20/T22（已裁定归 APPLY 路径，读取侧不生产，见 `C11-missing-list-producer`）；
- 链上 Use（`applyTierValue`/`onApplyTier`）**具名残留**（本轮仅记录）；
- `CreateRuleModal` 及其调用方（`handleSlotAddToGlobal`）**具名残留**（`startsWith('data:')`）；
- MEDIUM-C 缓存高频 `clear()` —— 已接受，本轮不修；
- **eslint repo 级债**（`settings/App.tsx` 21 / `message-client.ts` 14，**pre-existing**，`--max-warnings 0` 不通过）—— 单独立项，本批不背；
- `dist/` 未重建（已 `.gitignore`）。

## 七、协作门禁（本迭代积累，恢复后继续适用）

**「守卫可信度」同族 9 次问题 → 原则**：
1. 守卫/锚点须**真能失败**，**失败条件据实质而非措辞**判定；
2. 锚点以「语义族 + 全同族载体（类型名/方法名/字面量）+ 全目录（`src/` + `tests/`）+ **可执行代码为界（注释/文档不算）**」为界；
3. 声明形式不得擦除判别信息（`as const` 而非宽注解）；
4. 注释须随实现**同批**更新（防假注释）；
5. 守卫自身须能过门禁（`void` 未读 const、`includes` 加宽转）；
6. 复审一律以 **`git rev-parse HEAD` + `git show HEAD:`** 真值为准（消"提交 vs 工作区"混淆）；
7. 必要时建 **5 行探针实跑**代替字面推断。

**R2/C1 铁律**：派生渲染值**不得**升格为持久真值（`type:'template'` 的 `value` 读取时物化、持久态恒 `''`；写边界三处 strip：`writeSync`/`mutateSync`/`writeLocal`）。

## 八、恢复时的第一步（checklist）

> ⚠️ 恢复顺序：**先修 T18-D7 HIGH**（同文件 `settings/App.tsx`，与 T19 WIP 同处）⇒ 再处置 T19 ⇒ 再 T15。

- [ ] `git rev-parse HEAD`（应为 `f9e26ad`）与 `git status`（应为 clean）
- [ ] `npx tsc --noEmit`（应 0）
- [ ] 处置 T19（提交 or 补完）
- [ ] 拉起队友（`ie-executor-wave2` / `ie-logic-review`），并把本文档要点作为其任务简报
- [ ] 继续 T15 → T20 → T21（含 T14b）→ T22 → 终验波