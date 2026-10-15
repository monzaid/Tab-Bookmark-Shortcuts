# Rule Tags 迭代 — 主设计文档

> 日期：2026-10-10 / 11
> 主题：rule-tags
> 状态：4 层全部闭合（**42 项 RESOLVED / 7 项回溯修订 / 0 项 OPEN**）
> 分册：`goal-scope` / `constraint-boundaries` / `architecture-module` / `detail-interaction-copy`
> 决策清单：`2026-10-10-rule-tags-decisions.yaml`
> 设计权威：`2026-10-02-field-chain-sync-*`、`2026-10-04-import-export-*`、`2026-07-14-tab-bookmark-shortcuts-ui-ux-design`
> 原话诉求：「迭代 rules 特性，支持 tag 标签系统，新增 rule 时可以指定多个 tag（也可以不指定），可以在 Page Rewrite Rules 界面通过 tag 筛选 rule，这个是必要的，为了管理更多的规则而设计。」

---

## 1. Overview

### 1.1 目标

为规则引入**标签**，使 50–300 条规模下的规则**可被找到**。标签是**纯组织维度**：不影响规则的匹配、优先级、启用状态，**规则执行行为与今天完全一致**。

### 1.2 范围（原诉求 → 实际范围）

| 诉求 | 落地 |
|---|---|
| 新增 rule 时可指定多个 tag（可不指定） | ✅ 新建 + 单条编辑两处入口（G3） |
| Rules 页可通过 tag 筛选 | ✅ **升级为完整布尔表达式**（AND / OR / NOT / 括号优先级，G4/G5） |
| 「为了管理更多的规则」 | ✅ 追加**独立 Tags 管理页**（第 7 个 section，D-a） |
| —— | ✅ 追加 `tags` 作为**第 5 个导入导出维度**（D-0/S5） |

### 1.3 复杂度来源（诚实登记）

本迭代的主要复杂度**不在标签本身**（`string[]` 的引用），而在这三处：

1. **表达式引擎**（G4/G5）—— 语义中枢，落在 `src/shared/tag-expression.ts`（A2）；
2. **实体生命周期**（D-a/D-f/S4）—— 重命名传播、删除的引用完整性与撤销；
3. **颜色属性带来的跨层扩展**（S1）—— 推翻并重开了 C1 与 A4。

---

## 2. Architecture

### 2.1 模块边界

```
src/shared/tag-expression.ts      ← 纯模块：AST + 解析 + 求值 + 实体解析   (A2, D1)
src/shared/types.ts               ← TagDefinition / PortableTag / 第 5 维度模型 (C1, A6, S5)
src/shared/export-package.ts      ← PortableTag / RULE_KEYS.tags / 自洽判定    (A3, S3)

src/background/tag-service.ts     ← CREATE_TAG / RENAME_TAG / DELETE_TAG / SET_RULE_TAGS (A1)
       ↑ 不持有任何投递入口 ⇒ 「标签不影响行为」由模块边界保证 (A-a)
src/background/rule-service.ts    ← 不感知标签表 (A1)

src/ui/settings/App.tsx
  ├── RulesSection     ← chip 构建器 + Tags 列(默认收起) (D-c, D-d)
  ├── TagsSection      ← 第 7 个 section：增删改查 / 孤立标签 (D-a)
  └── ImportExportSection ← 第 5 维度卡片 + 两处不自洽弹窗 (S4, D-e)
```

### 2.2 数据流

**打标（写）**

```
chip 输入 → 就地新建? ──CREATE_TAG──▶ TagService ──┐
                                                  ├─ mutateSync（同一 mutator，原子） (A-g)
规则表单保存 ──SET_RULE_TAGS/CREATE_RULE──────────┘
                                                  ↓
                                    PageRule.tagIds: string[]
                                    ※ 绝不经过 applyToMatchingTabs (A1/F2)
```

**筛选（读）**

```
chip 序列 ──▶ parse ──▶ AST ──(仅解析成功才作用于列表, C6)──▶
                            │
            标签表(tags: TagDefinition[]) ──名字↔id 解析──▶ evaluate ──▶ 规则子集
                            ※ 全部在 UI 内存中完成，无消息往返 (A2/D)
```

**删除标签（破坏性 + 可撤销）**

```
Confirm(报出「将被 N 条规则摘除」) (C4)
   ↓ 关闭
单笔 mutateSync：删实体 + 从所有规则摘除引用 (A-g)
   ↓ 提交
弹出 UndoBar（原子批量快照：实体 + N 条引用）5s (C5, g2 串行)
```

**导出（自洽或不自洽）**

```
逐标签勾选 (A5/B) ──▶ 差集 = union(被导出规则的名字) \ 已勾选标签
                        │
                  差集非空 ⇒ 弹窗（后果式措辞, D-e）
                        ├── 补足：并入根级词汇表（颜色取自本机实体）
                        └── 丢弃：从规则内联名中减去差集
                        ↓
                  落盘文件恒自洽 (S3)
```

**导入（两处裁决点）**

```
1. overwrite 判定 (S4/B)：级联摘除 vs 转 incremental
2. 语义不自洽判定 (S5)：补足最小集 vs 丢弃悬空 tags
        │
   悬空名字 → 按名字查目标机标签表 (A-e)
        ├── 命中 ⇒ 复用（用本机颜色）
        └── 未命中 ⇒ 以默认外观创建 + 结果报出「N 个标签以默认外观创建」(S6/A)
```

---

## 3. Data Model

```ts
// 本机实体（同步区）
interface TagDefinition {
  id: string;
  name: string;              // 身份：trim 后逐字节相等 (C2)
  backgroundColor: string;   // 与 recipe 图标同形 (S1)
  textColor: string;
}
interface PageRule {
  tagIds: string[];          // ≤8 (C3)；引用方向：规则说自己的事 (A6)
}

// 包（一次性传输）
interface PortableTag { name: string; backgroundColor: string; textColor: string }  // 无 id (A4)
interface PortableRule { tags: string[] }                                          // 内联名字 (A3)

// 第 5 维度（同步 4 处模型）(S5)
ExportScope.tags?: boolean;  ExportScope.excludedTagNames?: string[];
DimensionPresence.tags: boolean;
ImportIntent.dimensionModes.tags: DimensionMode;
ImportDimensionOutcomes.tags: ImportDimensionOutcome;
```

**不变量**

| # | 不变量 |
|---|---|
| I1 | 标签不进执行链：不出现在 `resolveFieldChain` / `selectWinningRule` / 投递路径 |
| I2 | 标签 id 引用**永不悬空**（规则侧）：任意写入路径持久化前剥离悬空 id（D3，落点 TagService） |
| I3 | 导出的文件**恒自洽**（`union(规则名) ⊆ 根级词汇表`）(S3) |
| I4 | 名字唯一性 = trim 后逐字节相等；**颜色不参与**身份判定 (C2/S1) |
| I5 | 解析/求值**不得因输入深度崩溃**（迭代实现）(D1) |

---

## 4. Error Handling

| 情形 | 行为 | 来源 |
|---|---|---|
| 本机存档缺 `tags` / `tagIds` | **宽容补齐**（`?? []`，与既有顶层字段同形） | C9-①（修订） |
| 导入包缺标签字段 | **严格拒绝**（校验失败） | C9-② |
| 表达式为空 / 半成品 / 括号未闭合 | **一律不筛选**（显示全部）+ 框边轻提示 | C6 |
| 表达式引用的标签已被删除 | 保留 chip，**表达式暂停生效** + **点名**提示；chip 显示后备名 | C7 / D2 |
| 标签名 trim 后重复 | 拒绝 | C2 |
| 超过 8 个标签 / 名字超 32 字符 | 拒绝 | C3 |
| 删除标签 | `Confirm` 报影响数 → 级联摘除 → `UndoBar` | C4 / C5 |
| 导出不自洽 | 弹窗（后果式措辞），两选项等权 | A5 / D-e |
| 导入 `overwrite` | 用户选择：级联 / 转 incremental | S4 |
| 导入语义不自洽 | 用户选择：补足最小集 / 丢弃悬空 | S5 |
| 悬空名字本机也没有 | 以**默认外观**创建 + 结果报出数量 | S6 |

---

## 5. Testing Strategy

| 层 | 重点 |
|---|---|
| `vitest --project unit` | `tag-expression.ts` **纯函数穷举**：优先级、括号、NOT 结合、元数、**深嵌套不崩（D1）**；实体验解析（名字↔id）；`TagService` 的上限/trim/去重/级联（含原子性：一次写入完成实体+引用） |
| `integration` | 导入导出的**对称性**：导出→导入往返后标签与颜色一致；两处裁决点的分支；`overwrite` 的两条路径 |
| `ui-smoke` | chip 点选/删除/就地新建；Tags 列默认收起与切换；表达式暂停生效的两种提示；弹窗措辞含数字与名字 |
| `settings-class-css` 同类结构守卫 | 新类的定义完整性；chips 的**键盘可删 + 可访问名称**（R6） |

---

## 6. Trade-offs（显式登记）

| 取舍 | 接受的理由 |
|---|---|
| 容量问题**不在本次范围**（300 条为界面目标） | 单条目 8KB 上限是先存问题；标签只是让它更早暴露。拆 key 会破坏「单条目原子写 + `configVersion` 乐观锁」 | 
| 表达式**不设上限** ⇒ 极端情况工具栏被推出视口 | 可见且可理解，不是故障；换取「完全信任用户」 |
| 第 7 个导航项略长 | 标签虽低频，但实体定位准确（删除影响跨规则） |
| Tags 列**默认收起** ⇒ 打标后不在表内即时可见 | 避免挤掉 URL Pattern 列；反馈由 Tags 页与行内编辑器承担 |
| 就地新建的标签在**取消表单后留下** | 「回车即建即选中」不可做成假承诺；孤立标签由 Tags 页可见（C3） |
| 导入侧「补足」与导出侧**不对称** | **有据的不对称**：导入侧无颜色来源，未命中的只能给默认外观（S6） |
| 删除标签**不做软删除/归档** | 避免第三态在每处读取分支 |

---

## 7. Open Questions

**无（0 项 OPEN）。** 本迭代所有决策均已 RESOLVED。

**实现期需同步的既有文档/注释（记录以免遗漏）：**

| # | 位置 | 动作 |
|---|---|---|
| 1 | `src/shared/types.ts:223` | 注释「The four dimensions are FIXED (D5)」→ 改为 5 个维度 |
| 2 | `src/ui/settings/App.tsx:2997-3016` | `DIMENSION_LABELS` / `DIMENSION_META` 增 `tags` 项（R5 对称性） |
| 3 | `src/ui/settings/App.tsx:4090` | `isRecordDimension` 的分类注释需说明标签走**部件型**管线 |
| 4 | `_context-output/designs/2026-10-02-field-chain-sync-detail-copy-a11y-design.md` §0.2 | 术语表增 `tag` / `expression` / `predicate` / `chip` / `vocabulary` |
| 5 | 本迭代 S4 与 C4 的关系 | 实现时须保证 `overwrite` 的删除**经 diff 披露**，不得绕过 C4 的保护 |

---

## 8. 回溯修订索引（7 项）

| # | 修订 | 文档位置 |
|---|---|---|
| S1 | C1：`{id,name}` → `{id,name,backgroundColor,textColor}`；颜色**不参与**身份 | constraint §C1 |
| S2 | A4：包内 `string[]` → `PortableTag[]`（仍**无 id**）；规则侧仍内联名字 | architecture §A4 |
| S3 | A3/A5：导出侧消灭不自洽（**优于**原建议，已采纳） | architecture §A3 |
| S4 | A5/新：`tags` **提供 `incremental`/`overwrite`**；`overwrite` 的删除可由用户改判为 `incremental` | architecture §A5 |
| S5 | D-0/新：`tags` 为**独立第 5 维度**，同步 4 处模型 | detail §0 |
| S6 | 新：导入侧悬空名字未命中 ⇒ **默认外观创建 + 结果披露数量** | architecture §A5 / 本文 §2.2 |
| S7 | C9-① 措辞：「存档缺字段 ⇒ 视为损坏并拒绝」→ **「本机读取宽容补齐；严格性只施加于导入包」** | constraint §C9（含冲突证据） |

> **S7 的来源**：不是新决策，而是**措辞修订**。规划期的高精度审查发现原措辞与 `storage-repository.ts:252-261` `migrateSyncState` 的既有统一形态冲突（它对**每个**顶层字段都用 `??` 兜底，且不做规则级深规范化）。经用户批准（2026-10-11）修订为分层表述——「不兼容」的准确含义是**不写迁移分支**，而非**读取必须严格**。计划层的 P2 由此与设计一致，不再是「计划覆盖设计」。