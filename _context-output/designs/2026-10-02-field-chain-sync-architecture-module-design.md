# Architecture Layer — Field Chain, Delivery Coordination & Contracts

> **上游**：Goal（Q1–Q14）+ Constraint（C1–C8 / RK-1）
> **层**：🏗️ Architecture
> **决策**：A1–A12（12 项），**OPEN：0**
> **日期**：2026-10-02 · **基线**：HEAD `a3d6ab3`

---

## A1 · `src/shared/field-chain.ts`（读侧唯一真源）

**决定**（Q5 + Q22=A）：纯函数，**title 与 icon 各调用一次**（Q13：两条独立链，不共享）。

```ts
// 跳焦目标的统一寻址
export type TierOwner =
  | { kind: 'override'; tabId: number }
  | { kind: 'slot'; slotId: number }
  | { kind: 'rule'; ruleId: string }
  | { kind: 'site' };

export type TierValue = {
  value: string | null;      // 该层设置的值（null = 未设置）
  owner: TierOwner;          // 徽标点击 → 跳焦定位
  known: boolean;            // Q14：site 层未捕获 → false（UI 显示 —）
};

export type ChainResult = {
  winner: { value: string | null; source: 'override' | 'slot' | 'rule' | 'site' };
  tiers: { override?: TierValue; slot?: TierValue; rule?: TierValue; site: TierValue };
  masked: TierOwner[];       // 有值但被上层盖住（驱动"一键清除遮蔽"）
};

export function resolveFieldChain(
  field: 'title' | 'favicon',
  input: { sync: SyncState; local: LocalState; tabId: number; tabUrl: string },
): ChainResult;
```

**规则**：`override > slot > rule > site`；rule 胜出复用既有 `sortRulesByPriority` / `selectWinningRule`（`url-utils.ts:457-471`）——**消灭散落 3 处的重复排序**。
**理由**：一处实现 ⇒「视图显示值 = 实际投递值」成为**构造保证**；`owner` 使"徽标跳焦"数据驱动；`known` 承载未捕获态；`masked` 驱动清除遮蔽（推导遮蔽 = 链的下游知识，不应下放给三个视图）。

### A1-bis · 三层"设定值"判定与「清除」语义（Detail DT6/DT7 回填）

**"某层的值"如何判定为已设定**：

| 出现形式 | 判定 | 依据 |
|---|---|---|
| `undefined` | **未设定** | 既有 `PageRule.title?: string` 语义 |
| `null` | **未设定**（**不是"钉住空值"**） | 既有 `SET_TAB_OVERRIDE { favicon: null }` = 清图标（`sidebar/App.tsx:1299`） |
| `''`（空串） | **未设定** | 既有 `applyEditTitle` 的落空逻辑 |
| 非空字符串 / `IconSource` | **已设定** | — |

**写入侧一元化（DT11 裁决）**：写入**统一用 `null`**；**删除** slot 侧 `{ type:'url', value:'' }` 空字符串路径（`settings/App.tsx:1296,1317,1341,1447`、`sidebar/App.tsx:1385`）。
**读取侧保留三种容错**（上表）——**不可**因写入侧一元化而收紧读侧：云同步可能残留旧格式（`import-export` 兼容见四界面方向文档 §8）。

**据此：「清除」= 各层写回未设定值，不需要任何 tombstone / 哨兵。**
- "清除"因此**不是** A1 契约的扩张，而是**既有形状的既有语义**：`override` 层写 `null`、`slot.uiMarker.customTitle` 置空、`rule.title` 置 `undefined`。

**但「清哪些层」不由 `field-chain` 决定，也不由写入方各自决定** —— 否则又回到"各写入方自理"（本迭代要消灭的缺陷来源）。收敛为**两条清除作用域**（Q6 已给语义，此处只补"清哪些层"）：

| 作用域 | 清哪些层 | 入口 | 语义 |
|---|---|---|---|
| **本层清除** | 仅本层 | DT6 的第三选项 **`Use chain`**（IMP-17b 改名；原名 `Site original value` 已撤销）| **回落下一层**（Q6） |
| **整链清除** | **本层 + 其下所有层** | DT7 的 `Clear` 按钮 | 直达 `site`；`site` 亦无值 → 还原站点原值 |

**判定规则（`field-chain` 输出，供 UI 与 `field-chain` 自身共用）**：
`clearChain(field, entry)` 返回**有序的待写层清单**（如 Dashboard override 项 → `[override, slot, rule]`；**位置槽** → `[slot, rule]` —— `override` 是 tabId 私有、某 tab 的 override 改不了槽位的定义，故不参与）。**`field-chain` 保持纯函数**（只做读取与判定）；**写入由 A2 的 `FieldDeliveryService` 执行**。

---

## A2 · `FieldDeliveryService`（写侧唯一协调者）

**决定**（Q23=C）：**新建** `src/background/field-delivery-service.ts`，**注入** `RuleService` + `SlotService` + `StorageRepository` + `BrowserAdapter`；作为**唯一投递协调者**。

**职责**：
1. 计算受影响集合（按维度，见 A3）
2. 对每个 tab 走 A5 的 leading/trailing 调度
3. 调 `field-chain.resolveFieldChain` 算逐层贡献 → 生成 A4 的指令
4. 经由 A6 的通道投递，并维护 `degraded` 状态

**否决**：放 `RuleService` 内并自行解析 slot→tabId（造服务环或迫使 `resolveSwitch` 上移 shared）。

---

## A3 · 受影响集合（按维度）

| 写入来源 | 维度 | 受影响 tabIds 算法 |
|---|---|---|
| Current Page 编辑 override | **唯一 tabId** | 直接 `[tabId]` |
| slot 标题/图标/URL 编辑 | **唯一 tabId** | 有 binding → `binding.tabId`；否则 → `resolveSwitch` 推算（`candidates[0]`）；**位置槽 → 已记录 binding**（Q3） |
| rule 创建/更新/删除 | **多命中** | 该 rule 的 `matchesUrl` 命中列表（复用既有匹配查询） |
| Dashboard 编辑/清除 | 按其 `kind` 走上面三者 | — |

**契约**：`FieldDeliveryService.recomputeAndRedeliver(tabIds: number[]): Promise<DeliveryReport>`；`DeliveryReport` 含每 tab 的 `ok | degraded | protected | unknown`（驱动 Q8 的**权威汇总**与该行 `delivery` 展示）。

---

## A4 · 投递协议（每字段三态）

**决定**（Q24=A）：**逐字段独立**指令；"清空"在协议层**不可表达**（不再有"写空字符串"这条路）。

```ts
export type FieldDirective =
  | { kind: 'set'; value: string }   // 写入链的胜出值
  | { kind: 'restore' }              // 链无扩展值且站点原值已知 → 还原站点原值
  | { kind: 'none' };                // 站点原值未知（known:false）→ 不动，UI 显示 —
export type FieldApplyMessage = {
  type: 'FIELD_APPLY';
  title?: FieldDirective;
  favicon?: FieldDirective;
};
```

**语义对齐 Q6**：清除 = **先删存储值 → 重算链 → 投递链结果**（因此协议**不需要** `clear` 模式）。
**`restore` 的实现**：标题 ← 页面作用域快照；favicon ← 删除我们插入的 `<link>`，**天然回落**站点原 link（从不删除原 link）。
**A4-bis（Detail DT7 回填）**：`restore` 覆盖"**整链清除**后 `site` 亦无值"的情形（DT7 的 `Clear`）；"**本层清除**"（DT6 的 `use-chain`）通常落回 `set`（下层有值）或 `restore`（下层皆空）——**两者共用同一协议，无需扩展**。

---

## A5 · 投递调度：single entry + leading / trailing

**决定**（Q25=A）：三个触发源（`tabs.onUpdated`、`CONTENT_NAVIGATION`、`CONTENT_READY`）**全部路由到同一入口** `recomputeAndRedeliver([tabId])`。

```
入口(tabId):
  若该 tab 无在途投递 → 立即执行（leading）
  否则 → 标记 pending（不排队重放中间态）
  在途完成后：若有 pending → 用【最新状态】再跑一次（trailing），清除 pending
```

**附加（C4 红线）**：
- 同一 tab 多次投递**合流为最新一次**
- 编辑动作 **~300ms 防抖**
- **重试队列每 tab 唯一**（新投递重置计数）；重试间隔 **1/2/3/5/10/20/30s**（7 次），超限 → 降级
- `coalesce`（`worker-orchestrator.ts:272-282`）**可复用**其"per-key in-flight 去重"骨架

**删除 `force`**：投递恒为"写入当前链状态"（幂等）——顺带消灭一处名不副实的概念（侦察：主路径从未读取 `force`）。
**收益**：修掉侦察 #11（无按-tab 排序 → 旧值可能后写覆盖新值），并保证**最后一次编辑必然生效**。

---

## A6 · 内容脚本为唯一实现 + 兜底

**决定**（C2）：`apply` / `restore` 只在**内容脚本**（常驻、持有页面作用域快照）实现；`scripting.executeScript` 退化为**仅 apply** 的最小兜底，命中即标 `degraded`。
**降级呈现**：该行 `delivery='degraded'` → UI **`Limited: can't restore the site value`**（**定稿见深挖② §4**）；清除在降级页**只做"停止改写"**。

---

## A7 · `siteSnapshot`（站点原值，local）

**决定**（Q19/Q20/Q28）：
```ts
// local 新增，严格封闭（不进 sync / 导出 / 诊断）
interface SiteSnapshotEntry { tabId: number; title: string | null; faviconHref: string | null; capturedAt: string; }
```
- **捕获时机**：**首次改写前惰性捕获**（内容脚本在首个 `FIELD_APPLY` 前抓 `document.title` + 现存 favicon link，随即回报 background）
- **生命周期**：**每次导航后重新捕获**；**链不再产生改写 → 丢弃**；**tab 关闭 → 丢弃**（防 tabId 复用串值）；**扩展重载 → 保留**（local 持久）
- **字段仅** `{ title, faviconHref }`（**不存 URL、不存页面内容**）；**只读**（`site` 节点不可编辑）

---

## A8 · 受保护页集中判定

**决定**（C5）：`isProtectedUrl` **只在投递入口**判定一次；**移除**三处分散判定 —— ⚠️**行号已更正**（原文三处同号，实际跨两文件）：`rule-service.ts:609`（`reapplyToMatchingTabs`）/ `worker-orchestrator.ts:966`（`reapplyFieldsToBoundTab`）/ `rule-service.ts:455`（`applyToTab`）。受保护页 → **不投递** + `delivery='protected'`（UI **`Can't rewrite this page`**，**定稿见深挖② §4**）；**edit 仍允许**。

---

## A9 · 契约清理（Q27=A）

| 对象 | 处置 |
|---|---|
| `PageRule.mode` + `RuleMode` 类型 | **删除**（规则一律参与链，仅 `enabled` 控制） |
| `APPLY_RULE_TO_TAB` | **删除**（绕过链 + UI 不可达） |
| `GET_CANDIDATES` + `message-client.getCandidates` | **删除**（无调用方） |
| `KNOWN_ACTIONS` 白名单 / `messages.ts` 联合类型 | **同步清理**（防"编译通过但运行被拒"） |
| `content/index.ts:229` 的**每 URL 一次** guard | **删除**（由 A5 的 leading/trailing 取代） |

---

## A10 · Dashboard 契约（`GET_DASHBOARD` 演进）

**决定**（Q26=A）：
```ts
type DashboardRow = {
  id: string;
  kind: 'override' | 'slot' | 'rule-hit';
  label: string; url: string | null;
  anchor: TierOwner | null;                      // 跳焦目标
  tabId?: number; slotId?: number; ruleId?: string;
  chain: { title: ChainResult; favicon: ChainResult };   // A1 形状，title/icon 各一份
  delivery: 'ok' | 'degraded' | 'protected' | 'unknown';
};
```
- **受管配置清单** = `override` 项 + 显式设置过标题/图标的 `slot` 项 + **被 rule 遮蔽的页面**（Q10）
- **折叠的「受管标签页视图」** = rule 命中页（按 tab 行）；**可编辑 → 追加为受管配置项**
- **`anchor` 承载跳焦**：`override→tabId`、`slot→slotId`、`rule-hit→ruleId`（rule 节点跳到 **Page Rewrite Rules** 的对应行）
- **`chain` + `delivery` 由后台一处算好**（避免"前端拼一份"的同型分叉；`degraded`/`protected` 只有后台知道）

---

## A11 · 消息清单（本迭代）

| 动作 | 变更 | 说明 |
|---|---|---|
| `FIELD_APPLY`（内容脚本方向） | **新增** | A4 每字段三态指令 |
| `SITE_SNAPSHOT_REPORT`（内容脚本 → background） | **新增** | A7 惰性捕获回报 |
| `GET_DASHBOARD` | **重塑** | A10 的 `DashboardRow[]` |
| `SET_TAB_OVERRIDE` / `REMOVE_TAB_OVERRIDE` | 载荷可能**扩展**（按字段清除语义） | 需与 A4 对齐 |
| `UPDATE_SLOT_UI_MARKER` / `UPDATE_SLOT_URL` | **不变**（但落存储后**必须**触发 A3 的投递） | 修侦察 #7 |
| `CREATE_RULE` / `UPDATE_RULE` / `DELETE_RULE` | 载荷 **去掉 `mode`** | Q27 |
| `APPLY_RULE_TO_TAB` / `GET_CANDIDATES` | **删除** | A9 |
| `CONTENT_NAVIGATION` / `CONTENT_READY` | **不变**（但路由到 A5 单一入口） | — |
| `APPLY_REWRITE`（旧协议） | **被 `FIELD_APPLY` 取代** | 旧协议能力集不同（侦察 #4） |

---

## A12 · 模块结构

```
src/shared/
  └── field-chain.ts                 # A1 读侧唯一真源（background + UI 共用）
src/background/
  ├── field-delivery-service.ts      # A2 写侧唯一协调者（注入 Rule/Slot/Repo/Adapter）
  ├── site-snapshot-store.ts         # A7 local 记录（可并入 storage-repository）
  └── apply-fields.ts                # 退化为 executeScript 最小兜底（仅 apply）
src/content/
  └── index.ts                       # apply / restore / 惰性捕获 / 回报（唯一实现）
src/ui/shared/
  ├── field-editor.tsx               # S4a 字段编辑器（Title/Icon 维度；三选项 + Reset this edit + Clear + 徽标/遮蔽/预览）
  ├── rule-form-fields.tsx           # S4b（DT8）规则表单字段集（Match URL + Match Type + FieldEditor + Priority）
  ├── undo-bar.tsx                   # IMP-6：泛化后的撤销条（批次快照 + 文案 + 影响 tab 数），侧边栏 + 设置页共用
  ├── empty-state.tsx                # IMP-10：四态空态（empty / no-match / error-first / error-stale）
  └── use-expand-row.ts              # IMP-15：行展开唯一实现（展开集 + Escape + 焦点移入/回归）
```

---

## 遗留至 Detail

| 项 | 说明 |
|---|---|
| 英文成品文案 | ✅ **已定稿（深挖②）** —— 徽标四态（`Page` / `Slot N` / `Rule` / `Site`）、`Overridden by Slot 5`、`Clear the page setting`、`Can't rewrite this page`、`Limited: can't restore the site value`、`—`（unknown）、`Matches 12 tabs · 3 masked`、`…and 9 more` → `detail-copy-a11y-design.md` §0–§5 |
| 共享编辑器边界 | 哪些字段/校验/预览复用；4 个入口（Current Page 双击、slot 行菜单、Rules 内联、Dashboard 编辑）的一致性验收 |
| `New Global Page Rule` 改造点 | 去掉 `mode`；影响面预览接入；与 Rules 页创建表单的关系（是否复用） |
| 跳焦机制 | 跨页定位到规则行的实现方式与可见高亮 |
| 受影响集合上限 | Q9 的"前 3 条 + 折叠"具体阈值与渲染 |
| 测试分层 | `field-chain` 穷举单测（RK-1 缓解）、投递调度（leading/trailing/重试/降级）、契约清理、UI |