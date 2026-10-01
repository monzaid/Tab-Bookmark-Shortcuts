# Goal Layer — Slot Switch Consistency & Strategy Model Redesign

> **迭代范围**：单一整体迭代 = 「1 + 2 行为一致性 bug 修复」+「3 + 4 功能重设计」→ 单一设计文档 → 单一计划
> **日期**：2026-09-30
> **层**：🔍 Goal（使命 / 成功判据 / 终止条件）
> **决策**：D1–D16（16 项），**OPEN：0**
> **基线**：HEAD `d1f1f1d`（UI/UX 修复已提交）；项目为 MV3 跨浏览器扩展（TS strict + React 18 + Vite 6 + Vitest 2）
> **关联既有设计**：`2026-07-14-tab-bookmark-shortcuts-design.md`、`-goal-core-scope-design.md`、`-goal-multwindow-rules-design.md`、`-architecture-mv3-dataflows-design.md`、`-detail-ui-validation-design.md`、`-ui-ux-design.md`

---

## 1. Mission（为什么做）

消除「同一意图、不同入口、行为不一致」；并把「匹配策略」从 A/B/C 黑盒升级为**可组合、可解释、可预期**的三旋钮模型，同时让恢复窗（Tab Not Found）成为**有补救手段**的交互面板。

两个子目标：

| # | 子目标 | 类型 | 用户可见病症 |
|---|--------|------|-------------|
| 1+2 | 行为一致性 + 开页/开窗**幂等** | bug 修复 | 侧边栏点 vs 快捷键行为不同；Tab Not Found 弹 2 次；Open URL 开 2 个窗；Settings 生成 2 个标签页 |
| 3+4 | 策略模型重设计 + 恢复窗 UX 迭代 | 功能重设计 | 策略语义黑盒；恢复窗按钮无法完成"换一个匹配"的任务 |

---

## 2. Scope

### IN
- item 1：侧边栏点击与快捷键执行**行为一致**；`Tab Not Found` **只弹 1 次**
- item 2：无 Settings 标签页时点击底部任一入口**不产生重复标签页**（并追根因）
- item 3：`Global Matching Strategy` 由 A/B/C 重构为三旋钮模型（`tabIdMode` / `ruleCheckMode` / `priority`）+ 新增**方向设置**（Previous Match / **Next Match(default)**）+ 侧边栏 Current Page 新增 `↑/↓` 位置步进
- item 4：恢复窗按钮改造（`Open URL` 仅 Exact 展示；`Next Match` 拆为 `Previous Match` / `Next Match`；点击**不关窗**；`Do Nothing` 保持）+ 新增**自动绑定复选框**（持久化、可在设置页查看/编辑）

### OUT（明确不做）
- 不引入 i18n / locale 框架（界面仍统一英文）
- 不新增 npm 依赖
- 不改 incognito 授权模型本身（仅在既有 `isAllowed()` 语义内沿用 gating）
- 不改 protected page 拦截策略本身（沿用 `isProtectedUrl`）
- 不把方向设置做成"每条快捷键独立配置"（C 选项已否决）
- 不做策略的**逐字段继承**（Q16 已否决）

---

## 3. Success Criteria（可测）

| ID | 判据 | 验证方式（下层细化） |
|----|------|---------------------|
| SC1 | 同一 slot 的"侧边栏点击"与"快捷键"产生**同一 `SwitchOutcome` 语义**（同一目标 tab / 同一 needs_recovery） | 双路径同输入 → 断言 background 返回与副作用一致 |
| SC2 | 一次切换动作只产生**至多 1 个**恢复窗；重复触发收敛为 1 | 触发两次 → 断言窗口数 = 1（复用/聚焦） |
| SC3 | 任意入口重复触发开页，**至多 1 个**目标标签页 | 触发两次 → 断言目标页标签数 = 1 |
| SC4 | 新模型四格组合**严格按定义执行**（尤其组合 2 不得回退 URL 查找、组合 4 严格走位置环） | 每格独立用例 + 反例（"不应回退"）用例 |
| SC5 | 旧 A/B/C 升级后**行为零漂移** | 迁移映射用例（A/B/C → 新模型 → 行为等价断言） |
| SC6 | 组合 4 的 聚焦/步进/缺失 三分支可测（含"游标 tab 缺失 → Tab Not Found"） | 用例覆盖三态 |
| SC7 | 恢复窗：`Open URL` 仅 `Match Type=Exact URL` 出现；Prev/Next 点击后**窗不关**且可连续点击 | 用例覆盖 exact/regex 与连续点击 |
| SC8 | 自动绑定复选框：三态覆盖可持久化、设置页可查看/编辑、生效于 3 个动作 | 用例覆盖继承/强制开/强制关 |
| SC9 | 既有测试无回归；lint delta-0；typecheck 0；三浏览器构建通过 | 门禁 |

---

## 4. Terminology（术语，后续层统一使用）

| 术语 | 定义 |
|------|------|
| **Match** | 基于 slot 的 `urlMatch`（Exact / Regex / Wildcard）的候选匹配 |
| **Position** | 基于**浏览器标签页顺序**（当前窗口 tab strip 的 index）的相邻移动 |
| **聚焦 / Focus** | 游标 tab ≠ 当前活动 tab → 切到游标 tab |
| **步进 / Step** | 游标 tab == 当前活动 tab → 在环内按方向移到相邻标签页 |
| **环 / Ring** | 当前窗口存活标签页按 index 排序构成的有序环 |
| **游标 / Cursor** | 该 slot/卡片的"上次成功切换的标签页"，是 Position 的**起点**（非装饰） |
| **恢复窗 / Recovery Window** | 标题含 `Tab Not Found` 的 popup 窗口 |

---

## 5. Decisions（D1–D16）

### D1 · 迭代组织
**决定**：单一整体迭代（1+2 修复 + 3+4 重设计），单一设计文档 → 单一计划。
**否决**：拆分（1+2 与 3+4 分两轮）——1 与 3 深度耦合（3 重新定义"匹配结果"语义，直接决定三者行为一致性）；4 依赖 3 的结果语义；2 的根因不修则 3/4 新增的开窗/开页动作会继续出双份。
**影响**：所有层文档合并为一份；计划为单计划。

### D2 · 恢复窗打开职责
**决定**：**background 统一负责**。`SWITCH_SLOT` 结果为 `needs_recovery` → background 开窗；侧边栏/快捷键/任何调用方**都不自行开窗**。侧边栏删除误导性 toast（现文案 `Slot x: opening recovery window` 与实际行为不符）。
**否决**：调用方各自负责——一致性靠两处"碰巧同步"，正是本轮 bug 的成因模式；3/4 新增窗口逻辑会在多处重复。
**影响**：一致性由构造保证（single source of truth）；"只弹 1 次"去重收敛到唯一位置。

### D3 · 四格组合 4 的定义
**决定**：**Position（忽略 Match URL）**——不再查询 URL/正则。
**否决**：URL 候选集 + 顺序选第几个（与组合 3 语义重叠，失去区分意义）；等同全局"下一个标签页"命令（丢失 slot 语义）。
**影响**：四格互斥可判定；组合 4 下 Match URL 不参与切换（仅显示）。

### D4 · 组合 4 的起点与失败条件（与 D5 合为「聚焦或步进」）
**决定**：环 = **当前窗口**全部存活标签页；起点 = **slot 上次成功切换的标签页**（其 Prev–Next 游标）。游标页已关闭 → **Tab Not Found**；首次从未切换过 → 以当前活动标签页为起点。
**否决**：活动页起点（无视游标，使"slot 保有自身游标"失去作用）；binding 起点（组合 4 前提即 binding 失效 → 退化为"永远 Tab Not Found"）。
**影响**：slot 游标成为真正有用的切点；产生可测的失败路径。

### D5 · 组合 4 的「聚焦 / 步进」二分
**决定**：
- 游标 tab == 当前活动 tab → **步进**（环内按方向移到相邻；浏览器标签页成环，末尾的 Next = 首个）
- 游标 tab ≠ 当前活动 tab → **聚焦**（切到游标 tab）
- 游标 tab 缺失 → Tab Not Found
- 成功切换后更新该 slot 数据（binding + 游标）
**影响**：回答并保留"slot 仍是独立槽位"——保有自身绑定/图标/标题/游标，动作"只影响 Slot 5"。

### D6 · 方向设置的适用范围
**决定**：仅作用于**快捷键的两处**：① `Switch to next matching tab`；② `Switch to slot x` 且该槽有效策略 = 组合 4。侧边栏**保留**独立 `⤺ Previous / ↻ Next`（不受设置影响）。
**否决**：全局方向开关翻转所有入口（用户将失去直接反向能力）；每条快捷键各自配置（无需求支撑）。
**影响**：方向设置同时决定组合 4 的步进方向。

### D7 · 侧边栏 Current Page 位置按钮
**决定**：Current Page 区新增 `Switch to previous position tab (↑)` / `Switch to next position tab (↓)`，置于 `⤺/↻` 右侧；**slot 行不新增**（slot 行仅保留一对 Match 按钮）。
**影响**：Position 与 Match 在 UI 上分离且互补。

### D8 · `↑/↓` 的起点
**决定**：**复用现有 Lock**——起点 = 锁定 tab；未锁定 → 当前活动标签页（退化为普通相邻步进）。锁定后切走再按 `↑/↓` → 先**聚焦**回锁定 tab，再步进。
**否决**：新增独立 Current Page 游标（与 Lock 语义重叠，同一卡片并存两个锚点）；恒为当前活动页（"记录"名不副实）。
**影响**：不新增持久化字段；"锁定"与"以该页为起点"语义统一。

### D9 · 组合 1 的 `priority` 语义
**决定**：**字面偏好序 + 回退**：
- `none`：绑定 tab 存活**且** URL 仍匹配 → 切它；否则用 URL/正则候选（取首个）。（= **旧默认 B 行为**）
- `tabId`：绑定 tab 存活 → 切它（**不校验 URL**）；否则用 URL/正则候选。
- `rule check`：先用 URL/正则候选；无匹配 → **回退**切绑定 tab。
**否决**：三档皆强制 URL 校验（会使 `tabId` 与 `none` 几无差别，失去该档意义）。
**影响**：⚠️ 新默认（组合 1 + `priority=tabId`）**≠** 现默认 B（组合 1 + `priority=none`）——"URL 已变但 tab 存活"时默认行为变为"直接切该 tab"，属可感知变更（由 D10 的迁移策略约束）。

### D10 · 默认值与迁移策略
**决定**：**迁移保行为 + 新默认仅新装**。无损映射：旧 `A` → 组合 2；旧 `B` → 组合 1/`none`；旧 `C` → 组合 3。老用户行为**零变化**。新默认 `exists + match + priority=tabId` 仅用于全新安装或用户主动重选。
**否决**：升级即重置为新默认（静默破坏老用户切换行为）。
**依据**：旧 A/B/C 与演进表**一一对应**，可零歧义映射。

### D11 · 「位置 / Position」的环范围
**决定**：**仅当前窗口**（按 index 排序）；步进不跨窗；聚焦可跨窗。
**否决**：全窗口合并——`↑/↓` 或 slot 步进会莫名跳窗，难预期难测；且跨窗口能力未丢失（Focus 路径仍在）。
**影响**：环的定义稳定、可测。

### D12 · 恢复窗生命周期
**决定**：**每 slot 至多一个**——该 slot 已有恢复窗 → **聚焦复用，绝不新建**；不同 slot 各自一个窗。与 D2 合流为「以 slot 为键的 create-or-focus」原子操作。
**否决**：全局单例（不同 slot 互相顶掉）；每次触发新建（多窗叠加）。
**影响**：一次性消除"弹 2 次"（item 1）与"开 2 个窗"（item 2 的窗口实例）。

### D13 · 自动绑定复选框的作用域
**决定**：**全局默认 + 槽位可覆盖**。设置页配全局默认；单槽可覆盖；弹窗显示该槽**有效值**并写入**槽位覆盖**。
**否决**：全局单值（原"一个选项"字面可支持，但用户明确要求可覆盖）；每 slot 独立、无需全局（全局默认形同虚设）。
**影响**：需引入覆盖层（见 D14）。

### D14 · 覆盖的表示与撤销
**决定**：**三态覆盖**——槽位存 `autoBindOverride?: boolean`（`undefined` = 继承全局）。弹窗复选框显示**有效值**，切换即写入强制值；设置页在该槽提供三态（`Follow global` / `Always on` / `Always off`）以**撤销覆盖**。
**否决**：布尔覆盖无继承（全局默认对存量槽失效，自相矛盾）；仅能覆盖"开"（无法表达"全局开、此槽关"）。
**影响**：全局默认 = **开（勾选）**；新槽默认 = **继承**；首次在弹窗切换即产生显式覆盖。

### D15 · 恢复窗 `Previous/Next Match` 的候选来源
**决定**：**Match（URL/正则候选）**——在该槽 `urlMatch` 的候选集内按方向循环；无候选 → 窗内报错、**不跳转**。
**否决**：Position（按钮名 `Match` 名不副实，且与同屏 `Open URL` 语义不一致）；自适应按有效策略（同一按钮语义随配置漂移）。
**影响**：与 `↑/↓`（Position）互补；与组合 3 的 resolve 同源。

### D16 · 槽位策略覆盖粒度
**决定**：**整块继承**——`slot.strategy = 'inherit' | { tabIdMode, ruleCheckMode, priority }`；inherit → 三字段全跟全局；自定义 → 三字段全自定（**不支持部分覆盖**）。
**否决**：逐字段继承——表达力更强但无真实诉求，UI 与测试成本翻倍（YAGNI）。
**影响**：与既有 `slot.strategy: 'inherit'` 结构同构，改动最小。

### 已按现状记录（非问答项，如有异议在闸门处提出）
- **方向设置**：**全局单值**（用户原话仅指向 `Global Matching Strategy` 设置）
- **autoBind**：全局默认（开）+ 槽位三态覆盖（D13/D14）
- **strategy**：全局 + 槽位整块 inherit（D16）
- **弹窗内改动复选框**：**立即**写入持久化（默认）

---

## 6. Canonical 四格组合表（下层实现的唯一真源）

旋钮：`tabIdMode ∈ {exists, no exists}` × `ruleCheckMode ∈ {match, no match}` × `priority ∈ {tabId, rule check, none}`（`priority` **仅在组合 1 有效**）。
**新默认**：`exists + match + priority=tabId`（组合 1）。

| # | tabIdMode | ruleCheckMode | 行为 |
|---|-----------|---------------|------|
| **1** | exists | match | 绑定 tab 存活？→ 依 `priority`：<br>• `none`：存活**且 URL 仍匹配** → 切它；否则用 URL/正则候选（首个）<br>• `tabId`：存活 → 切它（**不校验 URL**）；否则用 URL/正则候选<br>• `rule check`：先用 URL/正则候选；无匹配 → 回退切绑定 tab<br>**两者皆无 → Tab Not Found** |
| **2** | exists | no match | 绑定 tab 存活 → 切它（**忽略 Match URL**）；<br>**否则 → Tab Not Found**（**不回退** URL 查找） |
| **3** | no exists | match | 忽略 tabId，仅按 URL/正则候选 → 切首个；无候选 → Tab Not Found |
| **4** | no exists | no match | **Position**：环 = 当前窗口存活标签页；起点 = 该槽游标<br>• 游标缺失 → Tab Not Found<br>• 游标 == 当前活动 → **步进**（方向 = 方向设置）<br>• 游标 ≠ 当前活动 → **聚焦**<br>• 首次从未切换 → 以当前活动为起点 → 步进<br>成功后更新该槽数据（binding + 游标） |

**旧值 → 新模型（D10 迁移表）**

| 旧 | 语义 | 新 | 行为 |
|----|------|----|------|
| A | tabId 存在即切换 | 组合 2 | ✅ 一致 |
| B | tabId 存在且 URL 匹配 | 组合 1 / `none` | ✅ 一致 |
| C | 忽略 tabId，仅 URL/正则 | 组合 3 | ✅ 一致 |

---

## 7. 遗留至下层（不在此层展开，但**不得遗漏**）

| 归属层 | 遗留项 |
|--------|--------|
| 🔒 Constraint | incognito 授权 gating 在 Position 环/新动作上的沿用；protected page 拦截（`Open URL` 必须拦截 `chrome://` 等）；不新增依赖；`SyncState` 形状变更的**向后兼容**与迁移时点；性能（环查询在超大窗口/多窗口下的开销）；a11y（新按钮/复选框/三态控件的 WCAG） |
| 🏗️ Architecture | 新三旋钮的类型与 `SyncState`/`LocalState` 归属（**sync vs local**：策略应 sync；游标/绑定/autoBind 覆盖应 local？）；方向设置与 autoBind 全局默认的持久化键；新消息 action 清单（策略、方向、autoBind、Position Prev/Next、聚焦）；**canonical switch 解析收敛到 `slot-service` 单一入口**；`SwitchOutcome` 是否需扩展（区分 focus/step/占位）；create-or-focus（恢复窗 + 开页）的原子化与 in-flight 去重；item 2 的**根因定位方法**与证据；设置页 Global Matching Strategy 区重构；迁移的触发点（启动时版本比对） |
| 📐 Detail | `↑/↓` 与组合 4 的**边界行为**（环仅 1 页 = 自己；环 0 存活页的理论边界）；组合 4 下 slot 行 `⤺/↻`（Match 按钮）在"Match URL 被忽略"时的**实际语义**（潜在不一致，须裁决）；恢复窗 5 分钟 TTL 过期后"复用同一窗 vs 新开"及窗内文案刷新；会话过期与 D12 复用的交互；选项文案成品（英文）；三态控件文案（`Follow global` / `Always on` / `Always off`）；`Open URL` 在 `Match Type=Regex` 时的展示判据；测试分层（unit/integration/RED 可构造性） |