# 主设计文档 — Field Chain Correctness, Three-View Sync & Rewrite UI Redesign

> **合并自**（9 份子文档）：
> - Goal：`2026-10-02-...-goal-scope-design.md`（Q1–Q14）
> - Constraint：`...-constraint-boundaries-design.md`（C1–C8 / RK-1）
> - Architecture：`...-architecture-module-design.md`（A1–A12 / A1-bis / A4-bis）
> - Architecture 深挖①：`...-architecture-ui-deepdive-design.md`（S1–S4b）
> - Architecture 深挖②：`...-architecture-four-surfaces-ui-direction-design.md`（D-1..D-21 / DT10 / DT11）
> - Architecture 深挖③：`...-architecture-three-surfaces-implementation-direction-design.md`（IMP-1..IMP-19）
> - Detail：`...-detail-interaction-copy-design.md`（DT1–DT12）
> - Detail 深挖②：`...-detail-copy-a11y-design.md`（CT1–CT4）
> - Detail 深挖③：`...-detail-validation-focus-empty-design.md`（E1–G1）
>
> **日期**：2026-10-02 · **基线**：HEAD `a3d6ab3` · **状态**：四层收敛，**OPEN 0**（**裁决 140 项** + **侦察不一致 19 项**；**1 项归入计划**：D-d 测试分层）

---

## 1. Overview

### 1.1 Mission
让 **title / icon 的优先级链成为「唯一真源 + 唯一实现 + 可解释可清除」**，彻底消除「改了不生效」这一类用户可感知缺陷；同时让 Current Page / slot / Data Dashboard 三视图**按同一链派生**、能显示来源与遮蔽、并提供一键清除。

### 1.2 侦察证据（19 项实测不一致）
`field-chain` 现状有**两份实现**（UI 手抄且漏协议校验）、**排序三份**、**注释与代码相反**、**4 条写入路径"改了不投递"**，另有 19 项具体不一致（详见 Goal §6 + 后续深挖新增 #14–#16）。

### 1.3 范围
**IN**：A 正确性 + B 优先级与重应用 + C 流程 + D 界面（单一整体迭代）。
**OUT**：不新增 npm 依赖 / permission / command；不改 incognito 与特权页拦截模型；不改槽位匹配策略模型（上一迭代的三旋钮四格）；不做 i18n（统一英文）；不改 Lock 的内存态语义。

---

## 2. Architecture

### 2.1 读侧唯一真源（A1 / A1-bis）
`src/shared/field-chain.ts` 纯函数：`resolveFieldChain(field, { sync, local, tabId, tabUrl }) → ChainResult`。
- **title 与 icon 各调用一次**（两条独立链，Q13）
- 链序 **`override > slot > rule > site`**；rule 胜出复用既有 `sortRulesByPriority` / `selectWinningRule`
- `ChainResult = { winner, tiers: { override?, slot?, rule?, site }, masked }`；`TierValue = { value, owner: TierOwner, known }`

**「设定值」判定**：`undefined` / `null` / `''` **一律未设定**；非空值 = 已设定（→ **「清除」= 写回未设定，无需 tombstone**）。
**写入侧一元化（DT11）**：统一用 `null`；删除 slot 侧 `{type:'url', value:''}` 路径；**读取侧保留三种容错**。

### 2.2 写侧唯一协调者（A2 / A3）
`src/background/field-delivery-service.ts`，注入 `RuleService` + `SlotService` + `StorageRepository` + `BrowserAdapter`。
- `recomputeAndRedeliver(tabIds: number[]): Promise<DeliveryReport>`
- **受影响集合按维度**：override → 唯一 tabId；slot → `binding.tabId` 或 `resolveSwitch` 推算；rule → 多命中列表

### 2.3 投递协议（A4 / A4-bis）
逐字段三态：`{ kind:'set'; value }` / `{ kind:'restore' }` / `{ kind:'none' }`；**协议层不可表达"清空"**。
**内容脚本是唯一实现**（C2）：`apply` / `restore` 只在内容脚本（持有页面作用域快照）；`executeScript` 退化为**仅 apply** 的最小兜底，命中即标 `degraded`。

### 2.4 调度（A5）
**单一入口 + leading/trailing**：`tabs.onUpdated` / `CONTENT_NAVIGATION` / `CONTENT_READY` 全路由到 `recomputeAndRedeliver([tabId])`；同一 tab 多次投递**合流为最新一次**；**删除 `force`**（投递恒为"写入当前链状态"，幂等）→ 修掉侦察 #11。

### 2.5 `siteSnapshot`（A7）
`local` 新增，**严格封闭**（不进 sync / 导出 / 诊断 / 诊断）：字段仅 `{ title, faviconHref }`；**首次改写前惰性捕获**（内容脚本回报）；**每次导航重新捕获**；链不再改写 → 丢弃；tab 关闭 → 丢弃；扩展重载 → 保留。

### 2.6 契约清理（A9）与 Dashboard 契约（A10）
删除：`PageRule.mode` + `RuleMode`、`APPLY_RULE_TO_TAB`、`GET_CANDIDATES`、`content/index.ts:229` 的每 URL guard；同步清理 `KNOWN_ACTIONS` / `messages.ts`。
`GET_DASHBOARD` → `DashboardRow[]`（`kind: 'override'|'slot'|'rule-hit'`，含 `chain` 与 `delivery`，`anchor` 承载跳焦）。

### 2.7 模块结构（A12 + 深挖②③ 新增）
```
src/shared/field-chain.ts              # A1 读侧唯一真源
src/background/field-delivery-service.ts
src/background/site-snapshot-store.ts
src/background/apply-fields.ts         # 退化为 executeScript 最小兜底（仅 apply）
src/content/index.ts                   # apply / restore / 惰性捕获（唯一实现）
src/ui/shared/field-editor.tsx         # S4a 字段编辑器（Title / Icon 维度）
src/ui/shared/rule-form-fields.tsx     # S4b 规则表单字段集
src/ui/shared/undo-bar.tsx             # IMP-6 泛化撤销条
src/ui/shared/empty-state.tsx          # IMP-10 四态空态
src/ui/shared/use-expand-row.ts        # IMP-15 行展开唯一实现
```

### 2.8 四界面形状（深挖②③ 定稿）
| 界面 | 容器 | 提交模型 | 备注 |
|---|---|---|---|
| 侧边栏弹窗 | **保留 `Dialog`**（~288px 单列、常驻展开） | 草稿（`Save`） | 全产品**唯一**保留的模态弹窗 |
| Rules · New Rule | **顶部内联表单**（位置差异**有意**保留） | 草稿（`Save Rule`） | 与行内编辑**字段集统一**（`RuleFormFields` create/edit） |
| Rules · Inline Edit | **行内展开**（`useExpandRow`，可多行） | 草稿（`Update Rule`） | — |
| Dashboard · Edit | **行内展开**（与 Inline 同形状，可多行） | **草稿（统一 `Save`）** | DT10 的 A3 混合：Dashboard 草稿、侧边栏/slot 立即提交 |

---

## 3. Data Flow

1. **用户编辑**（override / slot / rule / Dashboard）→ 写入**它所属的那一层**（无跨层写传播）
2. → `FieldDeliveryService.recomputeAndRedeliver(affectedTabIds)`
3. → 每 tab 走 A5 的 leading/trailing 调度 → `resolveFieldChain` 算逐层贡献 → 生成 A4 指令
4. → 经内容脚本投递（或降级为 `executeScript` 仅 apply）
5. → 三视图与 Dashboard **从链重算显示值**（不跨层写入），并按 `onChanged` 刷新

**清除语义（Q6 / A1-bis / DT7 / DT9）**：
- **本层清除**（`Use chain`）→ 回落下一层
- **整链清除**（`Clear`）→ `field-chain` 输出有序待写层清单 → 直达 `site`；`site` 亦无值 → `restore` 站点原值
- `Clear` **免确认** + `UndoBar` 5s（泛化共享组件）；`Undo` 为**原子批次恢复** + 重新投递

---

## 4. Error Handling

- **有界重试**（C3）：7 次，1/2/3/5/10/20/30s；超限 → 降级 + 标 `degraded`（仅内存）
- **受保护页**（C5 / A8）：`isProtectedUrl` **只在投递入口判定一次**；不投递 + `delivery='protected'`；**edit 仍允许**
- **节流/去重**（C4）：同 tab 合流最新一次；编辑 ~300ms 防抖；重试队列每 tab 唯一
- **校验（深挖③ E1–E5）**：UI **全量复用**后台原语（`validateRegex` + `isSafeFaviconProtocol` + `normalizeUrl`）；**必须先 `wildcardToRegex` 再校验**（修 ① N7）
- **错误归属路由表（E3/E3b）**：字段级内联（正则 / 空值 / 冲突）+ 表单级区（版本冲突 / IPC）；**toast 收窄为「成功 + 批量结果」**
- **空态四态（IMP-10）**：`empty` / `no-match` / `error-first` / `error-stale`，`empty` 优先；「有行但全不可投递」= 汇总句（**`unknown` 不计入**）

---

## 5. Testing Strategy

**归入计划阶段（D-d）**，方向已定：
- `field-chain` **穷举单测**（RK-1 缓解）
- **`normalizeUrl` 前后对照单测**（E5-d：尾斜杠等同属**已发布匹配语义变更**）
- 投递调度（leading/trailing / 重试 / 降级）
- `RuleFormFields` / `FieldEditor` 等价测试（DT1 三要素）
- 契约清理 + UI
- C7 允许**自由重写**行为语义测试（须登记 RK-1）

---

## 6. Trade-offs

| 取舍 | 选择 | 代价（已登记） |
|---|---|---|
| 链的实现位置 | **共享纯函数**（UI 内存计算，无往返） | 无（消灭两份实现） |
| 清除语义 | **回落 + 站点原值还原** | 需两种投递模式 |
| 共享编辑器边界 | **两层**（`RuleFormFields` + `FieldEditor`） | props 面变大；`Enabled` 面特异 |
| 提交模型 | **A3 混合** | 同一面板"改值等 `Save`、`Clear` 立即生效"需视觉区分 |
| 多行草稿 | **不持久** | **刷新/他行保存会静默冲掉草稿且无提示**（IMP-13 代价，IMP-14 撤销后**无缓解**） |
| `Clear` 确认 | **免确认 + UndoBar** | **全局配置（`slot.uiMarker` / `rule.title`）可逆性依赖 5s 窗口** |
| 跳焦 | **滚到 + 临时高亮**（不自动展开） | 目标被筛掉时走**回退链**（非目标本身） |
| 冲突检测 | **不实时**（提交后提示） | 能力随 `RuleEditor.tsx` 删除**不回补** |
| `normalizeUrl` | **全局补尾斜杠等同** | **匹配面静默变宽**（与 RK-1 同类） |

---

## 7. 登记风险

| ID | 风险 | 缓解 |
|---|---|---|
| **RK-1** | 核心解析语义与投递协议同时重构，行为漂移失去完整证据 | `field-chain` 独立穷举单测；显式携带本风险 |
| **RK-2** | `normalizeUrl` 匹配面变宽 = **已发布匹配语义变更** | `normalizeUrl` 前后对照单测（E5-d） |
| **RK-3** | `Clear` 免确认 + 5s 过期 ⇒ **全局配置不可逆丢失** | 预览**默认展开**且以"将被删除的全局配置"为**第一信息**（DT9） |
| **RK-4** | 多行草稿**无任何未保存指示** ⇒ 静默丢失 | （IMP-19 已接受）仅保留每行 `Save.disabled` 信号 |

---

## 8. Open Questions

**0 项**（全部已裁决）。**1 项归入计划**：**D-d 测试分层与 RED 可构造性**。

### 8.1 Act 3 后补登的 3 项（规划期复核发现）

| # | 项 | 处置 | 性质 |
|---|---|---|---|
| **D-13** | `selectedIds` 与可见集关系 | ✅ 裁决 = **(a) 自动裁剪**（消除 N8） | **Act 3 自审漏登**（主文档曾误写 OPEN 0） |
| **G-2** | `FormScene` 是否建独立模块 | ✅ 裁决 = **不建**；`canClearChain` 由 `RuleFormFields.variant` 单点派生 | **Act 3 自审漏登**（保留"待确认"字样） |
| **G-3** | 裸 `new RegExp` 计数 | ⚠️ **更正为 5 处**（原写 4 处，**漏 `settings:467`**） | **事实性错误**（规划期实测发现） |

> 前两项为**流程瑕疵**（自审不彻底），已补裁决并同步 YAML/子文档；第三项为**事实性偏差**，已更正。**均无设计层面的开放问题**。

---

## 9. 决策索引（140 项裁决 + 19 项侦察证据）

| 层 | 决策 | 数量 |
|---|---|---|
| 🔍 Goal | Q1–Q14 | 14 |
| 🔒 Constraint | C1–C8 + RK-1 | 8 + 1 |
| 🏗️ Architecture | A1–A12 + A1-bis + A4-bis | 14 |
| 🏗️ 深挖① | S1–S4b | 4 |
| 🏗️ 深挖② | D-1..D-21 + DT10 + DT11 | 23 |
| 🏗️ 深挖③ | IMP-1..IMP-19（含 IMP-17b/18/19） | 21 |
| 📐 Detail | DT1–DT12 | 12 |
| 📐 深挖② | D-a-1 + CT1 / CT2 / CT3-a / CT3-b / CT3-g / CT4 | 7 |
| 📐 深挖③ | E1 / E1-a..e / E2 / E3 / E3b / E4 / E5 / E5-a..e / F1 / F1b / F2 / G1 | 17 |
| — | 侦察不一致（#1–#19） | 19 |
| **合计** | | **140 项裁决 + 19 项证据**（明细见 `2026-10-02-field-chain-sync-decisions.yaml`） |