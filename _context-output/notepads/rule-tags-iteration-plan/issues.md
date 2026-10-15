# Issues — rule-tags-iteration-plan

## P7 中间红灯：计划"预期清单（完整，5 处）"不完整（实测记录）

T1 落地后 typecheck = **82 errors / 31 files**。全部为必填字段蔓延
（TS2741 59 / TS2345 15 / TS2322 6 / TS1360 2；缺 tags 38、缺 tagIds 21；
TS2578=0 ⇒ @ts-expect-error 有效）。但 src 侧实际有 **8 条**，超出计划的 5 项清单：

| # | 文件:行 | 性质 | 归属任务 |
|---|---|---|---|
| 1 | src/background/import-export-service.ts:448 | ImportDimensionOutcomes 缺 tags | T8 ✓ 清单项3 |
| 2 | src/shared/import-diff.ts:142 | DimensionPresence 缺 tags | T8 ✓ 清单项2 |
| 3 | src/ui/settings/App.tsx:3011 | DIMENSION_META 缺 tags | T14 ✓ 清单项4 |
| 4 | src/ui/settings/App.tsx:98 | emptyChain 的 SyncState 字面量缺 tags | T14（清单未列） |
| 5 | src/ui/settings/App.tsx:2456 | checked 状态 4 键 vs Record<keyof DimensionPresence> | T14（清单未列） |
| 6 | src/background/storage-repository.ts:80 | createDefaultSyncState 缺 tags | T6（清单未列）— 已修 |
| 7 | src/background/storage-repository.ts:253 | migrateSyncState 缺 tags | T6（清单未列）— 已修 |
| 8 | src/ui/sidebar/App.tsx:1032 | emptyChain 缺 tags | T13（清单未列） |

结论：错误**集合的性质** ⊆ 预期（全是必填蔓延，无实现引入的意外破坏），但
**枚举不全**。这些文件都有归属任务，不是孤儿 ⇒ 不阻断执行。已上报用户。

## T7 引入的第二处计划缺口：src/ui/shared/message-client.ts（无任务归属）

`src/ui/shared/message-client.ts:18` 持有 src/ 中**唯一**的
`ERROR_MESSAGES: Record<DomainErrorCode, string>` 穷尽表（实测 1 处）。
T7 按计划必须新增 5 个标签错误码 ⇒ 该表立即编译失败（TS2739）。
但**没有任何任务**的 Commit Files 声明该文件（计划只在 T13 引用其 :132-147 的
`sendRaw`）。若不处理，T14 的「src 侧 0 error」**不可能达成**。
处置：依 T1 先例（rule-service.ts 机械补缺）**在本任务内机械补齐** 5 个错误码文案，
不含任何标签业务逻辑。已上报用户 + F1/F4。

## tests/** 既有运行时锚点失效（归 T19，未在 T6/T7/T8 内修改）

| 文件:行 | 失效断言 | 原因 |
|---|---|---|
| tests/integration/storage-repository.test.ts:472 | `Object.keys(sync)` 恰为 6 键 | SyncState 增 tags ⇒ 7 键（T6 后失效） |
| tests/unit/shared/import-diff.test.ts:142 | `dimensions` deepEqual 4 键对象 | DimensionPresence 增 tags ⇒ 5 键（T8 后失效） |
| tests/unit/shared/messages.test.ts:79 | 穷尽 switch 的 assertNever | UiRequest 增 4 个标签动作无 case（T7 后失效） |

三者均为**适配**（新形状正确，仅期望值过时），非回归。依硬约束 #2（tests/** 迁移
归 T19 独占）与 T19 的「既有测试锚点对齐」职责，留给 T19。已在 T19 References 登记。

## 已修复：Rules 页表达式输入框的 onCreateTag 是桩（死控件）

`src/ui/settings/App.tsx` 的 `TagExpressionInput` 原接线为 **`onCreateTag={async () => null}`**，
即 G5/D-b 要求的「就地新建标签」**未接线**。

- 危害被**最大化**而非最小化：`tag-chip-input.tsx` 的创建入口
  **只在输入名不匹配任何既有标签时出现**（`canCreate = trimmed && !exactExists`）。
  ⇒ 用户恰好在最需要它生效的那一刻看到「Create tag X」，点击却**毫无反应**。
- 既有测试为何没抓住：其余测试要么自带 `onCreateTag`，要么从不输入新名 ——
  创建入口正好落在未覆盖的路径上。
- 处置：接入与 `TagsSection` / sidebar 相同的 `CREATE_TAG` 通道 + 本段 `loadRules()`
  刷新（同一快照重读规则与标签表 ⇒ 新标签既成候选 chip 又可作表达式操作数）。
- 证据：`tests/ui-smoke/rules-tag-filter.test.tsx` 新增 2 例（成功 / 被拒双向）。
  **假验证**：把 `onCreateTag` 改回桩重跑 ⇒ 两例**均失败**（证明测试能钉住缺陷，非变更检测）。

## 登记（已获用户确认「接受并登记」）：本迭代 lint 净增 +14，全部为 no-unnecessary-condition

全仓 `npx eslint src tests` 实测：**HEAD 644 → 当前 658（净增 14）**，且**集中于
4 个文件、单一规则**（无第二种规则）：

| # | 文件 | 变化 | 位置性质 |
|---|---|---|---|
| 1 | src/shared/export-package.ts | 0 → 4 | `sync.tags ?? []` / `rule.tagIds ?? []` / `rule.tags ?? []` |
| 2 | src/ui/settings/App.tsx | 21 → 27 | 标签特性的防御性 `?.` / `??` |
| 3 | src/ui/sidebar/App.tsx | 96 → 99 | 同上（标签选择器接线） |
| 4 | src/background/storage-repository.ts | 18 → 19 | `migrateSyncState` 的 `??` |

**规则分布：14/14 均为 `@typescript-eslint/no-unnecessary-condition`。**

### 为什么登记而非修复（附一次失败尝试的实证）

`export-package.ts` 那 4 处曾按「类型必填、代码却按可选处理 = 自相矛盾」删除，
**结果破坏功能**：`tests/ui-smoke/export-flow.test.tsx` 的 3 个 T19 用例失败，
`data-testid="export-records-rules"` 整块不渲染（`.map` 内抛错 ⇒ 导出面板空白）。

- 根因：这些测试构造的是**手工 `SyncState` 字面量**（不带 `tags` / `tagIds`），
  **不经过** `migrateSyncState`。该文件**原有注释已预言此后果**
  （「keeps a missing field from throwing inside a `.map`」）。
- 判定方式：`git stash` 对照 —— 基线 **15/15 通过**，改动后 **3 失败**。
  ⇒ 4 处守卫已**全部回退**，并改写注释记录这一被证实的理由。

结论：该规则在本仓库为**假阳性**——其前提「类型必填 ⇒ 值必存在」在
「手工字面量 + 未更新的类型」这一测试惯例下不成立。删守卫等于**用功能换 lint 数字**。

### 归属

- 本次我的编辑（`handleCreateTag` + `tests/ui-smoke/rules-tag-filter.test.tsx`）
  净增 **0** 项；并**顺带消除 1 项**（RulesSection 原桩 `async () => null` 的 `require-await`）。
- 上表 14 项**全部**为本次迭代既有改动，**无一项由我的编辑引入**。

### 已排除的替代方案

- 放宽规则 / 全仓 `eslint-disable`：会让**真阳性**一并消失，代价大于收益。
- 把相关测试夹具迁移到 `migrateSyncState`（根治方向）：属测试夹具重构，
  超出本迭代范围，建议作为后续独立任务立项（届时可回收这 4 项）。

## 环境限制

- 本环境**无 agent 派生/Task 委派工具**（send_message 仅面向已存在 teammate 收件箱）。
  ⇒ 无法按技能要求的「delegate 给 sw-tdd-agent」执行；改为**直接执行 TDD 工作**，
  但完整保留 RED→GREEN 证据与独立验证纪律。已上报用户。
- Windows PowerShell：无 `rg`；`Select-String` 无 `-Recurse`；中文字面量在控制台
  显示为乱码（读写仍为 UTF-8，检索经工具而非控制台）。