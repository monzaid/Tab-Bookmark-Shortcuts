# Detail Layer ③ — 校验边界（D-e）、跳焦实现（D-b）、空态×delivery（D-g）

> **上游**：Goal（Q1–Q14）+ Constraint（C1–C8）+ Architecture（A1–A12 / A1-bis / A4-bis）+ ① UI deep-dive（S1–S4b）+ ② 四界面方向（D-1..D-21 / DT10–DT11）+ ③ 实现级（IMP-1..IMP-19）+ ① Detail（DT1–DT12）+ ② Detail 深挖②（CT1–CT4）
> **层**：📐 Detail 深挖③（对应「覆盖对账」的 **D-e 校验边界** + **D-b 跳焦实现** + **D-g 空态×delivery**）
> **日期**：2026-10-02 · **基线**：HEAD `a3d6ab3`
> **状态**：✅ **已完成** —— 决策 **E1 / E1-a..e / E2 / E3 / E3b / E4 / E5 / E5-a..e / F1 / F1b / F2 / G1**，**OPEN：0**

---

## 0.5 裁决总览（一页速览）

| ID | 问题 | 裁决 |
|---|---|---|
| **E1** | UI 是否复用后台校验原语 | ✅ **全量复用**（`validateRegex` + `isSafeFaviconProtocol` + `normalizeUrl`） |
| **E1-a** | 校验与保存的输入是否同一串 | ✅ **必须先 `wildcardToRegex` 再校验**（**修 ① N7**） |
| **E2** | 冲突检测是否实时 | ✅ **不实时**，提交后如实提示（+ 3 前提） |
| **E3** | 错误呈现形态 | ✅ **字段级内联 + 取消失败 toast**（复用既有表单级区） |
| **E3b** | 冲突错误归属 | ✅ **`Match URL` 字段内联** |
| **E4 / E5** | `normalizeUrl` 规范化 | ✅ **全局补"尾斜杠等同"**（含 5 条精确契约） |
| **F1** | 跳焦动作 | ✅ **滚到 + 高亮（不自动展开）** |
| **F1b** | 到达保证 | ✅ **回退链：目标行 → 表格第一行 → 搜索框**（回退**不高亮** + 如实说明） |
| **F2** | 高亮形态 | ✅ **临时高亮 ~2s**（+ `reduced-motion` 保留高亮 + **非视觉播报**） |
| **G1** | 有行但全不可投递 | ✅ **不新增态**，表格上方汇总句（**`unknown` 不计入**） |

---

## 0.6 须回填上游的清单（由 ③ 的裁决推出）

| # | 回填对象 | 内容 | 来源 |
|---|---|---|---|
| 1 | **① S4b / DT1 要素 2** | 校验收敛为 `validateRuleForm`，**输入必须已转换**（`validateRegex(wildcardToRegex(x).pattern)`） | E1 / E1-a |
| 2 | **五处裸 `new RegExp`** ⚠️**计数更正** | 全部删除 —— 实测 **5 处**（设计初稿曾写"四处"，**漏了 `settings:467`**）：`sidebar:617`、`sidebar:704`、`settings:467`、`settings:736`、`settings:938` | E1 |
| 3 | **② D-8 / D-11 的"错误提示"** | 统一为**字段级内联**；toast 收窄为「成功 + 批量结果」 | E3 / E3b |
| 4 | **② D-5（跳焦）** | 定稿为：滚到 + 2s 临时高亮 + **回退链** + **非视觉播报** | F1 / F1b / F2 |
| 5 | **IMP-5（单元格徽标 = 跳焦入口）** | 补"回退时不高亮 + 如实说明"（否则误导） | F1b-a/b |
| 6 | **IMP-10（四态空态）** | 增补"有行但全不可投递"的**汇总句**（不新增第 5 态）；**`unknown` 不计入** | G1 |
| 7 | **深挖② §5.5（空态文案）** | 补 Dashboard 的汇总句 `2 items · none can be applied here` | G1-d |
| 8 | **登记为「已发布匹配语义变更」** | `normalizeUrl` 尾斜杠等同 ⇒ 现有 exact 规则匹配面变宽（与 **RK-1** 同类）→ 须补前后对照单测 | E5-d |
| 9 | **登记：`RuleEditor.tsx` 的冲突检测能力不回补** | 随 Q13 删除后，该能力（`RuleEditor:131`）不迁移到活表单（E2 已接受） | E2 |
| 10 | **更正 A12 / ③ 的组件地图** | 增 `normalize` 相关说明不改结构；但**新增的 CSS 类**（`*--jump`）与**汇总句**需登记 | F2-a / G1 |

---

## 0. 本次新核实的事实（决定 D-e / D-b / D-g 的形态）

### 0.1 共享校验原语**已存在**，但**活表单几乎不用**（D-e 的核心证据）

| 原语（`src/shared/url-utils.ts`） | 能力 | 后台使用 | **UI 活表单** | 孤儿 `RuleEditor.tsx` |
|---|---|---|---|---|
| `normalizeUrl`（`:18`） | 忽略 hash / host 小写 / 去默认端口；path+query 严格 | ✅ | 仅 **import 未用**（`sidebar:499`、`settings:18` 只用了 `wildcardToRegex`/`matchesUrl`） | — |
| `validateRegex`（`:301`） | **500 字上限**（`MAX_REGEX_LENGTH:56`）+ `RegExp` 合法 + **REJECT 灾难性回溯** + 过宽风险警告 | ✅ `rule-service.ts:90`、`worker-orchestrator.ts:689`、`import-export-service.ts:268` | ❌ **只用裸 `new RegExp`**（`sidebar:616-620`、`settings:735-740`、`settings:936-943`） | ✅ `:115` |
| `detectRuleConflict`（`:493`） | BLOCK（同 URL / 同 regex）/ WARN（可能重叠） | ✅ `rule-service.ts:137,258` | ❌ **完全无**（两个活表单都不调） | ✅ `:131` |
| `isSafeFaviconProtocol`（`:607`） | 协议白名单（`http`/`https`/受限 `data:` 图片） | ✅ `rule-service.ts:103,231`、`worker-orchestrator.ts:588,657` | ❌ **完全无** | — |
| `isProtectedUrl` | 特权页判定 | ✅ | ✅（import） | ✅ |

**⇒ 由此确认 3 个实测缺陷（D-e 的靶子）**：
| # | 缺陷 | 后果 |
|---|---|---|
| **E-1** | **UI 缺 500 字上限与 ReDoS 拒绝** | 用户看到 `✓ Valid regex`，提交后被后台拒绝（错误信息与实时提示**矛盾**） |
| **E-2** | **UI 无冲突检测**（能力落在**孤儿组件**里） | 用户可创建**两条同 URL 的规则**；且 Q13 删孤儿后，该能力**彻底消失**（除非恢复） |
| **E-3** | **UI 无 favicon 协议校验** | 可填 `javascript:` 等；后台拒绝 → UI/后台不一致 |

### 0.2 跳焦（D-b）的既有可用机制

| 事实 | 证据 |
|---|---|
| 规则表格有**排序 + 搜索**（可按 URL / title 过滤） | `settings/App.tsx:855-872` |
| 行内编辑已有**展开机制**（`Set<string>`），可程序化展开 | `settings/App.tsx:649, 689-696` |
| `A10` 的 `anchor: TierOwner` **已定义**（`override→tabId` / `slot→slotId` / `rule-hit→ruleId`） | A1 `:16-20` |
| 现状**无任何跨面跳焦**（① D9 已记） | — |
| **无 CSS 高亮类**（需新增） | 需在 `settings.css` 增 `--highlight` 或临时类 |

### 0.3 空态 × `delivery`（D-g）的既有事实

| 事实 | 证据 |
|---|---|
| `delivery` 目前**尚无实现**（A10 待建）；现状 Dashboard 不区分"生效/受保护/未就绪" | ① D3/D10 已记 |
| `degraded` 标记**仅存内存**（C3），随 tab 关闭/导航清除 | C3 |
| `protected` 是**可静态判定**的（`isProtectedUrl`），不依赖投递 | C5 |
| `unknown` 对应 `site` 层未捕获（`known:false`） | Q14 / A7 |

---

## 1. D-e · 校验边界

### ✅ OPEN-E1 · UI **全量复用**后台校验原语（用户裁决 ①）

**决定**：UI **与后台调用同一函数**：`validateRegex` + `isSafeFaviconProtocol`（+ `normalizeUrl`）。
**⇒ 从构造上消除"实时提示与真实结果相反"**（DT1 要素 2「单一校验」的兑现）。

**必须一并定死「同输入」（否则仍会相反）**：
| # | 约束 | 说明 |
|---|---|---|
| **E1-a** | **必须先转换、再校验** | 现状 UI 校验**原始输入**（`sidebar:704`、`settings:938` 用裸 `new RegExp(url.trim())`），而保存用 **`wildcardToRegex` 转换后**的值（`sidebar:610-614`、`settings:730-733`）⇒ **两个不同的串**。**本裁决要求：`validateRegex(wildcardToRegex(input).pattern)`** —— 校验的串与保存的串**必须同一个**（**这条直接修掉 ① N7**） |
| **E1-b** | **过宽警告不阻断** | `validateRegex` 的 WARN（可能过宽）**不阻断提交**（它是建议），只有 `valid === false`（TOO_LONG / 非法 / ReDoS）才阻断 → 与 OPEN-CT4 的"无效即禁用 Save"一致 |
| **E1-c** | **favicon 校验的时机** | `isSafeFaviconProtocol` 需在 **`Icon URL` 模式**下校验**输入值**；`Custom Icon` 模式产出的是 `data:` URI → **也须过同一函数**（`data:image/*` 白名单）；`Use chain` 无值不校验 |
| **E1-d** | **`normalizeUrl` 用于 exact 匹配校验** | `Match Type = Exact URL` 时，需校验输入是**可解析的 URL**（`normalizeUrl` 的 try/catch 语义；`url-utils.ts:18-45` 失败时**原样返回**⇒ UI 需额外判定"是否被规范化过"，见 **OPEN-E4**） |
| **E1-e** | **收敛为共享纯函数** | 三者的组合收敛为 `validateRuleForm(value)`（DT1 要素 2 的落点），**四个入口只调它** |

**连带撤销**：现状的裸 `new RegExp` **全部删除** —— ⚠️**实测 5 处**（原设计写"四处"，**漏 `settings:467`**，由规划期复核发现）：`sidebar:617`、`sidebar:704`、`settings:467`、`settings:736`、`settings:938`。

### ✅ OPEN-E2 · 冲突检测 = **② 不做实时检测，仅在提交失败时如实提示**（用户裁决）

**决定**：不在表单内实时检测冲突；用户在**提交后**看到如实错误（后台已有通路）。

**⚠️ 先更正本裁决所依据的一条错误陈述（诚实记录）**：
我在提问时写"侧边栏弹窗现在不加载规则列表（可能要新查询）"—— **实测该陈述错误**：`SyncState.rules: PageRule[]`（`types.ts:237`）已在 sync 中，且侧边栏**正在用**（`sidebar/App.tsx:1518`、`:1764` 的 `state.sync.rules`）。
**⇒ 实时检测（①）实际也是零额外查询成本**（纯客户端调用 `detectRuleConflict`）。
**但 ② 仍成立**：① 与 ② 的真实差异是"**当场阻截 vs 提交后提示**"（体验差异），与查询成本无关。
> **（可选）若希望改选 ①，回复"改实时检测"即可** —— 成本已探明为零。

**② 成立必须补的 3 个前提（否则"如实提示"落不了地，实测）**：

| # | 前提 | 实测问题 |
|---|---|---|
| **E2-a** | **`conflictingRuleId` 必须传到 UI** | 后台返回 `{success:false, errorCode:'RULE_CONFLICT_BLOCK', message, conflict}`（`rule-service.ts:138-144`），但 UI **只取 `message`**（`sidebar:1316`）⇒ **"是哪条规则冲突"的信息丢失**，无法提示"去那条规则看看" |
| **E2-b** | **修掉"双重告警"**（① N6） | 失败时**同时**写入弹窗内 `saveError`（`sidebar:793-795`）与全局 toast（`:1323-1326`）⇒ 同一错误播报两次 |
| **E2-c** | **两条冲突文案须统一** | 后台**有两层检测、两条文案**：`DUPLICATE_RULE` → `A rule with the same match pattern already exists.`（`rule-service.ts:132`）；`RULE_CONFLICT_BLOCK` → `A rule with the same URL already exists`（`url-utils.ts:506`）⇒ 同义不同句，须统一 |

**登记（后果）**：`RuleEditor.tsx` 的冲突检测能力（`:131`）**随 Q13 删除后不回补** —— 这不违背 D8（该能力本就不在活表单），但**必须登记**，避免后续被当作"新发现的缺失"。

### OPEN-E3 · 校验失败的**呈现**统一形态（见下方裁决）

### OPEN-E4 · `normalizeUrl` 的规范化规则是否够用

## 2. D-b · 跳焦实现

### ✅ OPEN-F1 · 跳焦动作 = **② 滚到 + 高亮（不自动展开）**（用户裁决）

**决定**：跳焦只做**定位**（滚动到目标 + 高亮），**不**自动展开行内编辑、**不**改用户的展开/筛选状态。

**理由（用户偏好）**：副作用最小、可预测 —— 用户自行决定是否展开编辑。

**⚠️ 本裁决**未解决**的一个难点（必须补，见 OPEN-F1b）**：**目标行被搜索/排序筛掉时，"滚过去"到不了**（行不在 DOM 中）⇒ 用户点徽标后**可能什么都没发生**，与 ② D-8「能点但没反应」同族。

### ✅ OPEN-F1b · 到达保证 = **回退链：目标行 → 表格第一行 → 搜索框**（用户裁决）

**决定**（保持 F1 的"不改用户状态"，仅用**回退**保证"必有落点"）：

| 情形 | 落点 |
|---|---|
| 目标行**可见** | 滚动到该行 + 高亮（正常路径） |
| 目标行**不可见**（被搜索筛掉等），但表格**有行** | 滚动到**表格第一行** |
| 表格**无行** | 聚焦**搜索框** |

**✅ 与 F1 的一致性**：不清搜索、不改排序、不展开 —— **不改任何用户状态**（零副作用，与 F1 ② 完全一致）。

**⚠️ 必须补的 2 条（否则会制造新的困惑，与 E3「如实提示」同源）**：

| # | 约束 | 理由 |
|---|---|---|
| **F1b-a** | **回退到"第一行"时绝不能高亮**（高亮 = "这就是目标"的语义） | 否则用户会以为**第一条规则**就是他找的那条 → 误导比"没反应"更糟 |
| **F1b-b** | **回退时必须给一句如实说明**（靠近落点，`role="status"`） | 文案建议：**`The target rule is hidden by the current search — showing all matches instead.`**（落点在搜索框时：**`No rules to show — try clearing the search.`**） |

**⇒ 净效果**：任何情况下**都有可见落点**（消灭"点了没反应"，与 ② D-8 同族），且**如实告知**为何不是目标本身。

## 3. D-g · 空态 × `delivery`

### ✅ OPEN-G1 · "有行但全部不可投递" = **③ 不新增态，但在表格上方加一句汇总说明**（用户裁决）

**决定**：保持 **IMP-10 的四态不变**（`empty` / `no-match` / `error-first` / `error-stale`，`empty` 优先）；在有行且**存在不可投递项**时，表格上方补一句汇总（不阻断表格）。

**⚠️ 必须补的 4 条约束（否则该汇总句会"恒真"或"不稳定"）**：

| # | 约束 | 理由 |
|---|---|---|
| **G1-a** | 🔴 **`unknown` 不计入"不可投递"统计** | `unknown` = `site` 层未捕获（Q14），**它是常态**（很多页面永远捕不到）⇒ 若计入，则**几乎每个 Dashboard 都会显示"都不可投递"**，汇总句失去意义。**只统计 `protected` + `degraded`** |
| **G1-b** | **注明该汇总的流动性**：`degraded` 仅存内存（C3）⇒ **扩展重载/浏览器重启后它会消失**（不会误报，但会"静默消失"） | 用户可能在重载前后看到汇总句有无变化，需在文档中登记以免被当 bug |
| **G1-c** | **`protected` 是静态可判定的**（`isProtectedUrl`），故"全是受保护页"时汇总句**稳定存在** | 这是该汇总额外有用的场景（用户确实需要知道"这几页改不了"） |
| **G1-d** | **文案须含单复数与零值处理** | 见下（`1 item` / `2 items`；`none can be applied` 仅在计数 > 0 时出现） |

**文案（成品）**：

| 情形 | 文案 |
|---|---|
| 有行，且存在 `protected` / `degraded` | **`2 items · none can be applied here`**（单数：`1 item`） |
| 有行，全部可投递（`ok` 或 `unknown`） | **（不显示）** |
| 无行 | → 走 `empty`（IMP-10 优先） |

**与既有裁决的一致性**：
- **不新增第 5 态** ⇒ 不改 IMP-10 的四态模型；
- **行内 `delivery` 徽标仍保留**（IMP-5 已定"单元格只放胜出值 + 来源徽标"；`delivery` 由行内徽标/状态列表达，深挖② §4）⇒ 本汇总句是**额外的一眼可见汇总**，不是替代；
- **不阻断** ⇒ 与 `empty` 优先无冲突。

---

## 4. 裁决记录（原待裁决项）

### ✅ OPEN-E3 · 校验失败的呈现 = **① 字段级内联 + 取消 toast**（用户裁决）

**决定**：所有校验错误与提交失败**一律内联**（归到出错字段旁；跨字段错误复用一个**已存在**的表单级错误区）；**取消**失败时的全局 toast（消灭 ① N6 的双重告警）。

**✅ 核实结论：不需要新增容器** —— 现状**已有**表单级错误区：
| 位置 | 既有容器 |
|---|---|
| `settings/App.tsx:522-524` | `<h3>Edit Rule</h3>` 之后的 `{error && <p role="alert">}` |
| `sidebar/App.tsx:793-795` | 弹窗 body 末尾的 `saveError`（`role="alert"`） |

### ✅ OPEN-E3b · 冲突类错误 = **① 放字段内联**（`Match URL` 旁）（用户裁决）

**理由**：冲突是该**字段的值**导致的 → 定位精准；且 **E2-a** 要求把 `conflictingRuleId` 传上来，放在字段旁时可直接跟一条操作链接。

**⇒ 最终「错误归属路由表」（E2 + E3 的落点，四入口统一）**：

| 错误 | 归属 | 文案 / 载体 |
|---|---|---|
| 正则非法 / 超长(>500) / ReDoS | **`Match URL` 字段内联** | 复用 `validateRegex` 的 `message` |
| 正则过宽（WARN，**不阻断**） | **`Match URL` 字段内联** | 建议性提示（非红色；须有文字/图标，C8） |
| exact URL 不可解析 | **`Match URL` 字段内联** | `Enter a full URL (https://…)`（**E5-c**：`normalizeUrl` 解析失败时原样返回，UI 须额外判定"是否可解析"） |
| **规则冲突**（`RULE_CONFLICT_BLOCK`） | **`Match URL` 字段内联** | **`A rule with the same URL already exists`** + **`View the existing rule`**（跳焦，用 F1/F2 机制） |
| **重复规则**（`DUPLICATE_RULE`） | **`Match URL` 字段内联** | **同上一条文案**（E2-c：两条合并为一句；二者都指向 `Match URL`，文案一致即无需区分） |
| `Custom Title` 为空（CT4） | **Title 字段内联** | `Enter a title, or choose Use chain` |
| `Custom Icon` 为空（CT4） | **Icon 字段内联** | `Pick colors and text, or choose Icon URL / Use chain` |
| `Icon URL` 非法协议（E1-c） | **Icon 字段内联** | `Use an http(s) or data: image URL` |
| **版本冲突**（`VERSION_CONFLICT`） | **表单级区** | `This rule was modified elsewhere. Refresh and try again.`（**保留**现状，`settings:507`） |
| **IPC / 网络失败** | **表单级区** | `Couldn't save the rule` |
| **提交成功** | **toast（保留）** | `Rule created` / `Rule updated`（**仅成功用 toast**） |

**⇒ toast 的职责被收窄为「成功 + 批量结果」**（`Deleted 3 of 5 · 2 failed` 属批量结果，仍用 toast，见深挖② §5.5）。

**连带改动**：
| # | 位置 | 改动 |
|---|---|---|
| 1 | `sidebar/App.tsx:1323-1326` | 失败时**不再** `setToast({ variant:'error' })` |
| 2 | `sidebar/App.tsx:793-795` | 保留为**表单级区**，只接收"跨字段"错误 |
| 3 | `settings/App.tsx:522-524` | 同上（Inline 已有；**New Rule 需补同位置**） |
| 4 | 四处内联提示（`sidebar:697-709`、`settings:936-943` 等） | 收敛为**共享 `FieldError`**（`errorId` 绑定见 CT3-d / IMP-12） |

### ✅ OPEN-E4 / OPEN-E5 · `normalizeUrl` 规范化 = **A 全局改 `normalizeUrl`（补"尾斜杠等同"）**（用户裁决）

**决定**：修改 `normalizeUrl`（`url-utils.ts:18-45`），**全局生效（含投递匹配）**。

**✅ 好处：1 处修改、4 处受益**（语义一致，无"两套比较规则"）：
| 受益处 | 位置 |
|---|---|
| 投递匹配 | `matchesUrl`（`:408`）→ slot / rule 匹配 |
| 冲突检测 | `detectRuleConflict`（`:503`） |
| 重复检测 | `rule-service.ts:124, 246` |
| 导入去重 | `storage-repository.ts:515` |

**⚠️ 精确契约（必须写死，否则会引发新的不一致）**：
| # | 规则 | 说明 |
|---|---|---|
| **E5-a** | **只在"非根路径"时去尾斜杠** | 根路径的特殊性：`new URL('https://a.com')` 的 `pathname` 就是 **`'/'`** → 若统一"去尾斜杠"会得到 `''`，破坏正常化结果。⇒ **规则：`pathname !== '/' && pathname.endsWith('/')` 时去掉**（**只去一层**，最小改动） |
| **E5-b** | **query 与 hash 语义不变** | 仍**保留 query 原序**（`?a=1&b=2` ≠ `?b=2&a=1`）、仍忽略 hash。**本裁决只动尾斜杠**（不扩大到大小写 path / query 排序） |
| **E5-c** | **解析失败仍原样返回**（`:43`） | 但 UI 需**额外判定"是否可解析"**（否则非法 URL 会被当字符串直接比较 → 误判"重复"）→ 见 E1-d |
| **E5-d** | **登记为「已发布匹配语义变更」** | 现有 exact 规则 `https://site.com/page` 将**开始命中** `https://site.com/page/`（**匹配面静默变宽**）。与 **RK-1** 同类（行为漂移失去完整证据）→ 须补一组"normalizeUrl 前后对照"单测（RK-1 缓解措施同源） |
| **E5-e** | **`./` 与 `../` 的归一由 `new URL()` 负责** | `new URL` 会解析 `./` 与 `../`（pathname 已归一）⇒ 本裁决**不重复实现**该逻辑 |

**影响面（须复核）**：因 `matchesUrl` 是 slot 匹配 / 规则匹配 / Dashboard 行 / 候选排序的共用实现 ⇒ 上述"匹配面变宽"会体现在**这四个消费者**上（不只是冲突提示）。

### ✅ OPEN-F1 · 跳焦动作 = **② 滚到 + 高亮（不自动展开）**（用户裁决）

见 §2。

### ✅ OPEN-F2 · 高亮形态 = **① 临时高亮（~2s 后自动消失，带过渡）**（用户裁决）

**决定**：目标行加**临时高亮**，约 **2 秒**后自动移除（带过渡动画）。

**⚠️ 必须补的 4 条约束**：

| # | 约束 | 理由 |
|---|---|---|
| **F2-a** | **新增 CSS 类**（与既有 `tbs-settings__row--disabled`（`settings:1107`）同族命名，如 `tbs-settings__row--jump`）+ **只用既有 token**（`--color-*` / `--duration-*`，`tokens.css`） | 保持设计 token 唯一源（② N2 已登记"旧 token 体系需清理"） |
| **F2-b** | 🔴 **`prefers-reduced-motion` 降级时：去掉过渡动画，但保留高亮** | `tokens.css:139-151` 已有降级规则。**不能把高亮一起降掉**，否则降级用户**看不到任何反馈**（F1 已定不自动展开 ⇒ 高亮是唯一识别手段） |
| **F2-c** | 🔴 **必须补非视觉播报**（`role="status"`，**不抢焦点**） | 本裁决**没有**焦点移入（那是 F2 的 ③）⇒ **键盘 / 屏幕阅读器用户无法知道"跳到了哪"**（高亮是纯视觉）⇒ 需**播报**（如 `Jumped to the rule`），与 F1b-b 的说明同机制。**这样既保持"不改焦点"，又消除 a11y 缺口** |
| **F2-d** | **重复跳焦须重置计时器** | 连续点两个徽标时，第二个的 2 秒不能被第一个的定时器提前清除 |
| **F2-e** | **回退场景（F1b-a）不套用本高亮** | 回退到"第一行"时**不高亮**（已定）；**仅**滚动 + F1b-b 的如实说明 |

**接受代价（已登记）**：2 秒对动作慢的用户可能太短 → 缓解靠**滚动动画 + F2-c 的播报**（播报无时长限制，sr 用户不受 2 秒约束）。

### ✅ OPEN-F1b · 到达保证 = **回退链：目标行 → 表格第一行 → 搜索框**（用户裁决）

见 §2。

### ✅ OPEN-G1 · 空态 × `delivery` = **③ 不新增态 + 表格上方汇总句**（用户裁决）

见 §3。

---

## 5. 遗留与回填

| 项 | 说明 | 状态 |
|---|---|---|
| 回填 ① S4b / DT1 要素 2 | 校验收敛为 `validateRuleForm`（**输入须已转换**） | ⬜ |
| 回填 **五处**裸 `new RegExp`（计数已更正） | 全部删除 | ⬜ |
| 回填 ② D-8 / D-11 | 错误统一为字段级内联；toast 收窄为「成功 + 批量结果」 | ⬜ |
| 回填 ② D-5 | 跳焦定稿（滚到 + 2s 高亮 + 回退链 + 播报） | ⬜ |
| 回填 IMP-5 | 补"回退时不高亮 + 如实说明" | ⬜ |
| 回填 IMP-10 | 增补"有行但全不可投递"汇总句（`unknown` 不计入） | ⬜ |
| 回填 深挖② §5.5 | 补 Dashboard 汇总句文案 | ⬜ |
| 登记 | `normalizeUrl` 匹配面变宽（与 RK-1 同类）→ 须补前后对照单测 | ⬜ |
| 登记 | `RuleEditor.tsx` 冲突检测能力**不回补**（E2 已接受） | ⬜ |
| 登记 | 新增 CSS 类 `*--jump` + 汇总句 | ⬜ |
| **D-d 测试分层** | **仍开放** → 建议归入计划阶段（规划者负责 RED 可构造性） | ⏸️ |