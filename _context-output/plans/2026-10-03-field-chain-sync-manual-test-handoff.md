# 手工测试交接文档 — 2026-10-03

> 面向：执行下一轮手工测试的人（或接手的 AI）
> 目的：说清**每一项的当前真实状态**（已完成/未完成），避免把"已做好的"当成缺陷、或把"未做的"当成回归。

---

## 0.5 第二轮人工测试反馈（11 项）已全部修复

第一轮人工测试后的 11 项缺陷已全部处理，并按根因分类：

### 一、根因级缺陷（一处修，多处受益）

| 缺陷 | 真实根因 | 修复 |
|---|---|---|
| **2.5** 图标编辑器只能点 `Icon URL` | `FieldMode` **无法表达** Icon URL / Upload / Custom Icon 的区别，回环转换把子模式抹平 → 每次渲染都重置回 `Icon URL`，**另三个标签点了等于没点** | `field-editor.tsx` 用本地 `useIconFieldState` 持有富值，不再从 `FieldMode` 反推 |
| **1.1 / 2.6** 弹窗标题栏与按钮**盖住内容** | `.tbs-dialog` 自身是滚动容器，header/footer 在里面 `position: sticky` → 与正文**同一层**且被绘制在其上 | 改为**三段式 flex**：`.tbs-dialog__body` 独占滚动，header/footer 是普通兄弟节点，**结构上不可能重叠** |
| **2.3** `Use chain` 每层都显示 `—` | 侧边栏传入的是 `emptyChain()`（空链），从来没接真实链路 | 两个弹窗改传**真实链**：`titleChain`/`faviconChain`（Current Page）、`slotIconChain`（slot 所绑标签页） |

### 二、逐项修复

| # | 修复内容 |
|---|---|
| 1.1 | `Use chain` 标签页已启用；预览改为**通栏宽度**（96px 高）；复合编辑器的自带预览用 `hidePreview` 隐藏；弹窗三段式布局 |
| 1.2 | Change Icon 弹窗接入共享 `MaskedSummary`（计数 + 前 3 条 + `…and N more` 展开 + 逐条清除） |
| 1.3 | 弹窗 footer 新增 `Clear icon`（清空当前层图标，回落下层） |
| 2.1 | `RadioGroup` 新增 `inline`，Match Type **水平平铺** |
| 2.2 | 两个字段编辑器新增 `Title` / `Icon` 标题；`Use chain` 已启用且接真实链 |
| 2.3 | 同上（真实链） |
| 2.4 | `titleLastValue` 透传：切回 `Custom Title` **带出之前的文本** |
| 2.5 | 同上（子模式持久化） |
| 2.6 | 同上（三段式布局） |
| 3.1 | slot 图标徽标从**右上角浮层**改为**图标下方堆叠** |
| 4.1 | Current Page 标题/图标展示态**带源徽标**；标题编辑态有 `⊘` 清除层 + `MaskedSummary`；`↺` 改为复位到进入编辑时的值 |

**新增共享件**：`masked-summary.tsx`、`use-draft-state.ts`、`icon-mode-adapter.ts`（上一轮）。

**本轮测试**：`354 suites / 964 tests 全通过`（unit 724 + integration 235 + ui-smoke 5）。

---

## 0. 本轮已全部完成（14/14）

上一轮会话曾中断，故本轮的实现分布在两次提交窗口内。**两次的改动都已在磁盘上、已通过全量测试、已打进 `dist/`。**

**当前全量测试（本轮结束时）**：`354 suites / 963 tests 全通过`（unit 723 + integration 235 + ui-smoke 5）。

| 能力 | 落地位置 |
|---|---|
| 按维度合并写入（修 5.4） | `worker-orchestrator.ts`（`UPDATE_SLOT_UI_MARKER` merge）、`rule-service.ts:379-397` |
| 影响预览后端 | `GET_IMPACT_PREVIEW`（`worker-orchestrator.ts` 约 :785）、`src/shared/messages.ts` |
| 取 Match URL 对应值 | `RESOLVE_MATCH_URL`（新增，`worker-orchestrator.ts`、`src/shared/messages.ts`） |
| Dashboard 受管标签页 | `buildDashboard()` 的 `rule-hit` 分支（约 :1048） |
| 共享组件 | `src/ui/shared/`：`match-fields` · `priority-field` · `rule-form-submit` · `inline-editor-shell` · `chain-tier-list` · `impact-preview` · `icon-mode-adapter` · `use-draft-state` · `icon-field-editor` · `tabs` · `field-editor` · `rule-form-fields` |
| 新增测试 | `tests/integration/dashboard-rule-hit.test.ts`、`rule-apply-persistence.test.ts`（MERGE/null 用例）；`field-editor.test.tsx` 扩到 14 例（标签页契约、每层列出、6.1 隐藏） |

**注意**：自动化测试全绿**不等于**这些交互没问题 —— 本轮 14 项大多是表现层/交互层，仍需人工逐项确认。

---

## 0.97 第六轮反馈（4 项细节）

| # | 诉求 | 根因与实现 |
|---|---|---|
| 1 | New Global Page Rule 弹窗 Icon 子组件 `reset` 没效果 | **根因**：图标维度有两份状态。`↺` 只还原父级的 `FieldMode`+`iconConfig`，而选择器真正显示的 `iconField`（哪个 tab、哪个子模式、预览）是 `FieldEditor` 里的本地 state，从未被触碰 → 界面纹丝不动。修法：`FieldEditor` 额外快照 **`baseline` 对应的 `IconFieldValue`**，`resetIconEdit()` 一并还原并把结果上报父级/草稿。 |
| 2 | New Global Page Rule 与 Dashboard Edit 的 Icon 子组件**有两个遮蔽提示** | **根因**：`FieldEditor` 渲染了一个 `MaskedSummary`，而它委托的 `IconFieldEditor` 内部**又渲染了一个**（同样来自 `chain.nodes`）→ 同一列表打印两遍。删掉外层那一份，保留图标组件自己的（它才是拥有图标面板的组件）。 |
| 3 | 标题编辑时点击遮蔽提示（含 `…and N more`）会**退出编辑** | **根因**：遮蔽提示位于打开中的编辑器内部，而输入框靠 `blur` 提交——鼠标一按下按钮/切换，焦点离开输入框，`blur` 提交并收起编辑器。修法：`MaskedSummary` 的容器/摘要/列表/两个按钮全部 `onMouseDown` 取消默认并阻止冒泡（按钮仅供"跳转"与"展开"，不应中断编辑）。 |
| 4 | 来源浮窗**看不全**：左边被界面截断、被标题栏/Current Page 覆盖 | **根因**：浮窗是包裹层的绝对定位子节点，因此身处 `.tbs-sidebar`（`overflow: hidden`）+ 滚动槽列表 + sticky 头部之内 —— 既被侧栏边界裁掉，又被后续兄弟层绘制在其上。修法：浮窗改为 **portal 到 `<body>`**，`position: fixed` + `z-index: 2147483000`，坐标由触发行 `getBoundingClientRect()` 计算并做视口夹取；上方空间不足时自动翻到下方。因为 portal 已脱离包裹层子树，CSS `:hover` 够不到它，显隐改由 React 的 `onMouseEnter/Leave/Focus/Blur` 驱动。 |

**本轮测试**：`120 suites / 1025 tests 全通过`；三浏览器 `dist` 已重建。

**新增回归测试**：
- `field-editor.test.tsx`：图标/标题各自**只渲染一个** `.tbs-masked`（#2）；图标 `↺` 会把原始值上报父级（#1）；
- `sidebar-title-commit.test.tsx`：遮蔽提示的容器/摘要/列表/展开按钮 `mousedown` 均被取消（#3）；
- `sidebar-source-hover.test.tsx`：浮窗**渲染在 `document.body` 上、不在 `.tbs-sidebar` 内**（#4 的结构保证），且悬停出现、移开消失；
- `shared-component-styles.test.ts`：`.tbs-source-popover` 必须是 `position: fixed` + 顶层 z-index，且旧的 `.tbs-source-hover__popover` 规则已不存在。

> 同前一轮的诚实说明：jsdom 不会因 `mousedown` 转移焦点，所以 #3 的测试断言的是**修复机制**（`fireEvent.mouseDown` 返回 `false`）而非真实 blur 竞争；#4 的 jsdom 无排版引擎，断言的是 **portal 结构**而非实际像素位置。这两点都需真机确认。

---

## 0.96 第五轮反馈（8 项细节）与一处数据模型修正

| # | 诉求 | 实现 |
|---|---|---|
| 1 | 图标编辑器 `Use chain` 点击某层时，预览展示该层图标 | `ChainTierList.onSelectNode` → `IconFieldEditor.previewOwner`；预览在有选中时取该节点值，并加一行 `Previewing Slot 3` 说明。选择**只改预览**，不写任何数据。 |
| 2 | 遮蔽提示列出全部同 tabId 节点；文案带含义；**去掉 clear the layer** | `MaskedSummary` 改为吃 `nodes`（全量记录），每行 `badge + 说明 + 值`；不再渲染任何 clear 按钮（清除职责归 `Use chain`）。 |
| 3 | Change Icon 的 reset：还原首次进入的数据（tab/子模式/值）、刷新预览、**不关闭弹窗** | 弹窗内保存 `openedSource`（打开那一刻的 `IconFieldValue`），`Reset` 还原它并保留弹窗；原实现是 `onReset(); onCancel()`，即"关窗"。 |
| 4 | 标题编辑：`↺` 只重置输入框且**不提交**；`⊘` 要真正清除当前层 | **根因**：输入框 `onBlur` 提交，而两个按钮在 `mousedown` 时就抢走焦点 → `blur` 提交先于 `click` 执行：`↺` 把要丢弃的文本存了回去、`⊘` 清完又被 draft 立刻写回（所以"没效果"）。修法：按钮 `onMouseDown` 取消默认（焦点不离输入框）+ 一次性 commit 抑制位。 |
| 5 | 遮蔽提示是**整条链的所有节点**（Page1/Page2/slot1/slot2…） | 同 #2，按 tabId 汇聚全部记录，不再按层折叠成一条。 |
| 6 | 同层可有多个节点（多 override/slot/rule/site） | `ChainResult` 新增 **`nodes: ChainNode[]`**（每层 N 个记录）。见下方"数据模型要点"。 |
| 7 | 浮层在 `Double click…` 提示左侧；来源即自身节点时不展示；文案要说明含义 | 浮层改为**值左对齐上方**（原来是偏右，会被邻列挡住，`z-index` 提到 40）；`shouldShowSource()` 在"赢家就是本行记录"时**不渲染**；文案由 `source-description.ts` 统一产出，Page 记录带 `tab 42`，并有整句解释。 |
| 8 | New Global Page Rule 的 `Use chain` 增加应用按钮；Icon 子组件增加 reset | `ChainTierList` 的 `Use` 改为**每一层只要有权值就出现（含 rule）**；`RuleFormFields` 把 `onApplyTier` 接到规则草稿；`FieldEditor` 为图标维度补 `onReset`。 |

### 数据模型要点（#6 —— 重要）

`ChainNode[]` 的前提是"同一 tabId 上可存在多条记录"。核对后确认：

- **`bindings` 以 `slotId` 为键**（`setBinding` 只替换同一 slotId 的项）→ **多个 slot 可绑同一 tabId**，这是真实可发生的；
- 规则：所有 URL 匹配且启用的规则都是候选 → **多条 rule**；
- **`tabOverrides` 以 `tabId` 为键**、**`siteSnapshot` 每 tabId 一条** → override / site **天然各只有一条**。

所以：slot / rule 两层确实多节点，override / site 是"结构上就是单条"（不是漏列）。`ChainTierList` 也据此对无记录的层渲染一行占位，避免列表"凭空变短"。

> 另外把 **`rule` 移出 `masked`**：规则命中是"规则作用于页面后"的值，把它标成 masked（被遮蔽、看不到）与事实相反，也正好造成"我在 Edit Rule，却被提示规则被遮蔽"的困惑。

---

## 0.95 第四轮反馈（验收通过后的 3 项体验调整）

用户对第三轮修复的验收结论是**通过**，并追加 3 项体验调整。三项都已实现并各自补了回归测试。

| # | 诉求 | 实现 |
|---|---|---|
| 1 | Data Dashboard 修改 rule 命中项成功后，**视觉聚焦**到对应的受管标签页行 | `focusAfterWrite()` → 复用 `use-jump-to-row` 的同一个高亮类：`scrollIntoView` + 2s 高亮。**关键点**：目标**按 render 时的 DOM 解析**，而不是写入时刻的 `entries` 快照——rule-hit 写入后行 id 从 `hit-N` 变成 `cp-N`，用快照会指向一个已不存在的行（这条一开始写错，被新增测试抓出来）。 |
| 2 | Data Dashboard 的 Edit 子组件 Title/Icon 改为**左右布局**（对齐 New Rule / Edit Rule） | `InlineEditorShell` 的 `grid=false` 改为 `grid`；`.tbs-settings__rule-form-grid` 与 `.tbs-rule-form-fields__pair` **行为对齐**（`repeat(2, minmax(0,1fr))` + `align-items: start`，`max-width: 559px` 折为一列）。 |
| 3 | 侧边栏 Current Page / slot 的浮层改为**在图标/标题上真实悬浮** | 删除 `tbs-source-hover__trigger` 圆点，`SlotSourceBadge` 改为**包住值本身**（`variant="icon"|"title"`），`:hover` / `:focus-within` 打开浮层；Current Page 的 favicon 本身已是焦点位，故 `triggerFocusable={false}`，避免嵌套焦点。 |

**回归测试**：`dashboard.test.tsx`（左右布局 / 写后高亮 / rule-hit 提升后跟随新行 id）、新增 `sidebar-source-hover.test.tsx`（8 例：无触发点、浮层与值同容器、不新增焦点位、样式表侧 `:hover` 规则）、`shared-component-styles.test.ts`（两栏可折、无遗留 trigger 规则）。

**本轮测试**：`120 suites / 1022 tests 全通过`；三浏览器 `dist` 已重建。

**本轮新增/更新的关键测试**：
- `tests/unit/shared/field-chain.test.ts`：同层多 slot 全部列出、赢家/遮蔽判定、不被重复计入、节点顺序、override/site 单条；
- `tests/unit/ui/sidebar-source-hover.test.tsx`：赢家=本行记录时**不渲染**浮层、Page 记录带 tabId、文案模块（badge/description/sameOwner/shouldShowSource）、浮层双行结构、样式表 `z-index`/`white-space`；
- `tests/unit/ui/sidebar-title-commit.test.tsx`（新）：`↺`/`⊘` 的 `mousedown` 被取消（`fireEvent.mouseDown` 返回 false）、stray commit 被忽略一次、真实编辑仍会保存、`⊘` 发出空 title 写入；
- `tests/unit/ui/field-editor.test.tsx`：遮蔽提示改为"列出全部记录 + 说明文案"。

> 诚实说明：`sidebar-title-commit.test.tsx` 的注释里写明了 jsdom **不会**因 `mousedown` 转移焦点，因此它验证的是"修复机制"（取消默认 + 一次性抑制位）而非真实 blur 竞争本身；真实浏览器行为仍需人工确认。

---

## 0.9 第三轮反馈（rule-hit 更新不生效）根因与修复

**症状**：Data Dashboard 里对一条 `rule-hit`（rule 命中页）项目改标题/图标 → 提示 `Tab x updated` → 但该行、对应标签页都不变；手动刷新反而把标题重置回 site 值。用户期望等价于"把 rule 层提升为 override 层"，即 Sidebar 编辑 Current Page 的效果。

**根因（不是逻辑缺陷，而是产物状态错误）**：
`dist/`（20:55 构建）里**含** rule-hit 写入路径，但 `src/ui/settings/App.tsx`（21:05 被改）是一份**残缺源文件**——80 行源文件只存在于 dist、不存在于 src，恰好覆盖：
- `applyDraft` 的 `kind === 'rule-hit'` 分支（**这就是"提示成功但什么都没写"的直接原因**：旧分支只匹配 `override`/`slot`，rule-hit 落空，随后无条件弹成功 toast）；
- `clearMaskingOwner` / `applyTierValue` / `clearChainTier` 三个函数（第二、三轮反馈里"clear the layer 无效"的成因）；
- `FieldEditor` 上的 `onClearMaskingOverride` / `onApplyTier` / `onClearTier` 接线（同批 UI 改动因此丢失）；
- `InlineRuleEditor` 的 `allowUseChain={false}`（第 7 项"Edit Rule 不需要 Use chain"）。

**修复**：以 `dist` sourcemap 中保存的完整源码为准恢复 `src/ui/settings/App.tsx`（已核对：除该文件外，dist 映射的 60 个 src 文件与磁盘**完全一致**），并重建三浏览器 `dist`。

**新增回归测试**（本轮真正缺失的覆盖）：
- `tests/unit/ui/dashboard.test.tsx`：
  - `rule-hit Save promotes the tab to a Page-level override` — 断言必须发出 `SET_TAB_OVERRIDE{tabId,title}`；
  - `rule-hit Clear disables the rule that drives the managed tab` — 断言发出 `UPDATE_RULE{ruleId,enabled:false}`。

> 教训：**"文案说成功"与"真的写入"必须分别断言**。缺这两个用例时，"忘了写 rule-hit 分支"能一路绿到人工验收。

---

## 1. 构建产物与加载方式

`dist/` 已用**当前源码**重建（三浏览器 + 三个 zip）：

```
dist/chrome/     dist/edge/     dist/firefox/
dist/packages/tab-bookmark-shortcuts-v1.0.0-{chrome,edge,firefox}.zip
```

- 三份清单均通过校验：`manifest_version=3, commands=21`
- Firefox 变体为 `background.scripts`（无 `side_panel`），符合预期
- 加载：Chrome/Edge → `chrome://extensions` 开发者模式「加载已解压的扩展程序」选 `dist/chrome`（或 `dist/edge`）；Firefox → `about:debugging` 临时载入 `dist/firefox/manifest.json`

> `dist/*/src/ui/*/index.html` 是 Vite 的 entry 相对路径产物（清单靠它加载侧边栏），**不是**陈旧目录，请勿删。

---

## 2. 逐项状态总览

图例：**✅ 已完成（待人工验证）** ｜ **⚠️ 部分完成** ｜ **❌ 未完成（待开发）**

> **本轮已全部实现（14/14）。** 下表为最终状态；每项的"改了什么 / 怎么验"见 §3。

| # | 需求 | 状态 | 实现要点 |
|---|---|---|---|
| 1 | 各界面 UI 样式/布局美化 | ✅ | 新增共享件全部有 CSS；修复了 `InlineEditorShell` 把单个 `RuleFormFields` 塞进 2 列网格的挤压缺陷；`RuleFormFields` 的双编辑器在 ≥560px 并排、窄栏堆叠 |
| 2 | Change Icon 五功能标签页 + 可复用 | ✅ | `IconFieldEditor` 现渲染 `Icon URL / Upload / Custom Icon / Use chain` 互斥标签页 + 实时预览 + 完整链路；**所有图标入口统一复用它** |
| 3.1 | Title 子组件改标签页 + 空输入框 + ↺ 移到输入框右侧 | ✅ | Title 改为标签页；`↺` 图标按钮移到输入框**右侧**（与 Match URL 同款）；切回 `Custom Title` 时带出旧值 |
| 3.2 | Icon 子组件用 Change Icon 抽象件 | ✅ | `FieldEditor` 的 icon 维度整体委托给 `IconFieldEditor` |
| 3.3 | 弹窗各子组件抽成可复用的列 | ✅ | 拆为 `MatchFields` / `FieldEditor`（Title、Icon）/ `PriorityField`，由 `RuleFormFields` 组合 |
| 4 | Current Page 新增「更多」按钮 + URL 双击编辑 | ✅ | `⋯` 在 `↓` 右侧，菜单与 slot 一致（`Rename Title… / Change Icon… / Edit URL…`）；URL 双击可编辑且带 `↺`、无 Match Type；保存写回该 tabId 的地址栏 |
| 5.1 | slot url 编辑补 ↺ 按钮 | ✅ | URL 输入框右侧新增 `↺`，复位到打开编辑时的值 |
| 5.2 | 遮蔽提示 + 来源徽标 + 逐条清除入口 | ✅ | 展示态图标/标题各带**来源徽标**；编辑态显示遮蔽说明；每层有「清除该层」入口（`⊘`） |
| 5.3a | 菜单文案改 `Rename Title…` / `Clear Slot Data` | ✅ | 菜单项、确认弹窗标题与按钮（`Clear`）均已改名 |
| 5.3b | slot 缺失 Shortcut 文案 | ✅ | 代码路径已通（`tbs-command-row__shortcut`，Bound 右侧）；仍建议人工确认数据到位 |
| 5.4 | 改图标重置标题 / 改标题重置图标 | ✅ | 后端已按维度合并；两条链独立，互不重置 |
| 6.1 | New Rule 去 Use chain + 新增「取 Match URL 对应标题/图标」按钮 | ✅ | 新建态隐藏 `Use chain`（由 `variant` 单点派生）；新增 `Use matched title` / `Use matched icon`，经新后端动作 `RESOLVE_MATCH_URL` 取当前链路值 |
| 6.2 | New Rule / Edit Rule 保存影响提示 | ✅ | 新共享件 `ImpactPreview`：`Matches N tabs · M masked` + 前 3 条 + 展开；已接在 New Rule 与 Edit Rule |
| 6.3 | 首次进 Edit Rule 影响提示 | ✅ | `impactDefaultExpanded`，打开即显示 |
| 7.1 | Dashboard 展示 rule 命中的「受管标签页视图」 | ✅ | 后端产出 `rule-hit` 行；该行的 **Edit 写入 Page 级 override（chain 顶层）、Clear 禁用该规则**；见 §0.9 根因说明 |

### 第六轮（§0.97）人工验收关注点

1. **#4 浮窗位置**（最需要真机确认）：视图缩到侧栏很窄时，悬停第一个 slot 的图标/标题，
   浮窗应**完整可见**、不被侧栏右/左边界裁掉，也不被 "Current Page" 头部或上方行遮住；
   靠近顶部时浮窗应自动落到值**下方**。滚动槽列表时浮窗应跟随（已监听 capture 阶段 scroll）。
2. **#1 Reset**：New Global Page Rule 里把 Icon 切到 `Icon URL` 并输入一个地址，再点 `↺ Reset`，
   **预览与输入框**都应回到打开时的值，且没有写入发生在你点 Save 之前。
3. **#2**：New Global Page Rule 与 Dashboard 的 Edit 面板里，Icon 子组件下方**只能有一个**遮蔽提示。
4. **#3**：编辑标题时点遮蔽提示的 `…and N more`，编辑框应**保持打开**、输入框内容不变、
   不产生任何写入。

### 第五轮（§0.96）人工验收关注点

1. **#6 多节点**要在真机上造出来：把**两个 slot 绑到同一个标签页**（slot 1、slot 3 都指向同一 tab），再打开任一编辑器的 `Use chain` 与遮蔽提示 —— 应看到**两条 Slot 记录**，且阻塞提示里两条都列出。
2. **#4 的真实 blur 竞争**只有真实浏览器才有（jsdom 测不到），务必手动点一次 `↺` 和 `⊘`：
   - `↺`：输入框**保持打开**且回到进入时的文本，且**不产生任何写入**；
   - `⊘`：产生 `SET_TAB_OVERRIDE{title:''}`，且**不会**被立刻写回。
3. **#7 浮层位置**：slot 行里图标/标题的浮层应落在文字**左上方**，不被右侧的操作按钮/邻列挡住；slot 8 的来源是 slot 8 时**不应出现**浮层；来源是 Page 时应显示 `Page · tab N`。
4. **#3 Reset**：Change Icon 弹窗点 `Reset` 后弹窗**不关闭**，且 tab 选中项、子模式、值与"首次打开"一致。

---

## 3. 逐项验收步骤（手工测试清单）

### ✅ 5.4 · slot 图标/标题互不重置（重点回归，已修）

链路是 `override > slot > rule > site`，**title 与 icon 是两条独立链**。

1. 槽 1 绑定某标签页 → 双击改标题为 `AAA` → 再改图标（`⋯` → Change Icon… → 选颜色/文字 → Apply）
2. **期望**：标题仍是 `AAA`（修复前会被重置）
3. 反向：先改图标 → 再改标题 → **期望**图标仍在
4. 在 Current Page 重复上述两步（走 `SET_TAB_OVERRIDE`）→ **期望**同样互不影响
5. Clear 图标（Change Icon 弹窗 → Reset）→ **期望**只清图标，标题保留

> 若第 4 步失败，说明前端 Current Page 路径有问题（后端已确认正确）。

### ✅ 7.1 · Dashboard 受管标签页视图

1. 打开几个标签页（如 `example.com/page`）
2. Page Rules 建一条规则匹配它（enabled）
3. 打开 Data Dashboard
4. **期望**：出现一条 `Tab <id>` 行、来源徽标为 `rule`，标题/图标显示规则的值
5. 点该行来源徽标 → **期望**跳到 Page Rules 对应规则
6. 点该行 `Edit` → 改标题/图标 → `Save` → **期望**该标签页立刻变成该标题/图标，且该行来源徽标由 `rule` 变为 `override`（编辑即把 rule 层提升为 Page 级 override，等价于 Sidebar 编辑 Current Page）；**期望**对应标签页无需刷新即更新
6b. 反向验证：先给该标签页在 Sidebar 设一个 Current Page 标题，再回 Dashboard → **期望**该 tab 行变为 `override` 行（rule-hit 不再重复出现）
7. 点该行 `Clear` → 确认 → **期望**该规则被**禁用**（`enabled: false`），提示 `Rule disabled — … is no longer managed`，刷新后该行消失
8. 注意：`Clear All` / `Clear selected` **有意跳过** `rule-hit` 行（那需要禁用用户规则，破坏性大得多，不在"清除已存 override/marker"的语义内）

### ✅ 2 · Change Icon 弹窗（标签页 + 可复用）

1. slot `⋯` → Change Icon…（或 Current Page 双击图标 → 或 `⋯` → Change Icon…）
2. **期望**：顶部标签页 `Icon URL / Upload / Custom Icon / Use chain`，下方实时预览
3. 切到 `Use chain` → **期望**列出 `Page / Slot / Rule / Site` **四层**（即使某层无值也列出），胜出层徽标高亮，点徽标可跳转
4. 切到 `Custom Icon` → 复合编辑器（背景色/文字/文字色）→ Apply → **期望**写入成功
5. 点 `Icon URL` 留空 → Apply → **期望**清空该层图标（fallback 到下一层）
6. **复用面验证**：`New Global Page Rule` 弹窗 / `+ New Rule` / 行内 `Edit Rule` / Dashboard `Edit` 中的图标修改，**都应是同一套五标签页组件**（同一个 `IconFieldEditor`）
7. `Upload` 标签页选一张图 → Apply → **期望**以 data URI 写入

### ✅ 3 · New Global Page Rule 弹窗

1. 侧边栏 Current Page `＋` → 打开弹窗
2. **期望（3.1）**：Title 是**标签页** `Custom Title / Use chain`
3. **期望（3.1）**：先填一个 title → 切到 `Use chain` → 再切回 `Custom Title` → **期望**刚才的值**还在**（不再空白）
4. **期望（3.1）**：`↺` 位于**输入框右侧**、仅图标，与 Match URL 的 `↺` 同款；无改动时禁用
5. **期望（3.2）**：Icon 是五标签页组件；切到 `Use chain` 看四层链路
6. **期望（3.3）**：同一组子组件（`MatchFields` / Title / Icon / `PriorityField`）在 `New Rule`、`Edit Rule`、Dashboard `Edit` 中复用
7. **布局**：288px 窄栏下 Title/Icon 应**上下堆叠**不挤压；设置页宽屏下并排

### ✅ 4 · Current Page 「更多」按钮

1. **期望**：`↓`（Switch to next position tab）右侧有 `⋯`，菜单为 `Rename Title… / Change Icon… / Edit URL…`
2. 点 `Rename Title…` → **期望**进入标题行内编辑；点 `Change Icon…` → **期望**打开图标弹窗
3. 点 `Edit URL…`（或**双击 URL**）→ **期望**进入 URL 编辑，输入框右侧有 `↺`，**无 Match Type**
4. 改 URL 后回车 → **期望**该 tabId 的标签页地址被改写，提示 `URL updated`
5. 点 `↺` → **期望**恢复为进入编辑时的 URL

### ✅ 5.1 / 5.2 / 5.3 · slot 槽

1. **5.1**：slot URL 双击编辑 → **期望**输入框右侧有 `↺`，可复位；`Exact / Regex` 单选仍在
2. **5.2 展示态**：绑定且链上有值 → **期望**标题右侧、图标右上各有一个**来源徽标**（`Page` / `Slot N` / `Rule` / `Site`）
3. **5.2 编辑态**：双击标题进入编辑 → **期望**输入框右侧除了 `↺` 还有 `⊘`（清除该层），下方显示遮蔽说明
4. 点 `⊘` → **期望**只清 **slot 层**（该维度回落下一层），**另一维度不受影响**
5. **5.3a**：菜单为 `Rename Title…` / `Clear Slot Data`；确认弹窗标题也是 `Clear Slot Data`、按钮为 `Clear`
6. **5.3b**：Bound 文案右侧应显示 Shortcut；若仍未显示，确认 `GET_COMMANDS` 是否返回该快捷键

### ✅ 6 · Page Rewrite Rules

1. **6.1**：`+ New Rule` 的 Title / Icon **不应有 `Use chain` 标签**（只有 `Custom Title` / `Custom Icon` 等）
2. **6.1**：应有 `Use matched title` / `Use matched icon` 按钮 → 填入 Match URL 后点击 → **期望**取到当前链路解析出的值；无匹配标签页时给出明确提示
3. **6.2**：New Rule 填 Match URL → **期望**出现 `Matches N tabs · M masked`，列出前 3 条，可展开
4. **6.3**：进入行内 `Edit Rule` → **期望****无需操作**即显示影响提示
5. **6.2/6.3**：改动 Match URL → **期望**数字随之刷新

### ✅ 1 · UI 样式与布局（横向扫一遍）

- 侧边栏 `New Global Page Rule` 弹窗、Current Page 区、slot 行
- Page Rewrite Rules 的 `+ New Rule` 表单、行内 `Edit Rule`
- Data Dashboard 的表格与行内 `Edit`
- 重点看：是否有**未定义 class 导致的裸样式**、字段换行/错位、窄栏下溢出、按钮对齐
- 新共享件样式：`base.css`（`.tbs-tabs*` / `.tbs-icon-field*` / `.tbs-chain-tiers*` / `.tbs-impact*` / `.tbs-field-editor*` / `.tbs-rule-form-fields*`）；侧边栏新增样式在 `sidebar.css`（`.tbs-slot-row__source` / `.tbs-slot-row__masking` / `.tbs-sidebar__current-url-edit` / `.tbs-sidebar__current-menu`）

---

## 4. 关键实现坐标（便于后续修改）

| 需求 | 主要改动点 |
|---|---|
| 3.1 Title 标签页 + ↺ 入框 + 旧值 | `src/ui/shared/field-editor.tsx`（`Tabs`、输入框内嵌 `↺`）、`RuleFormFields` 传 `lastValue` |
| 2 / 3.2 Icon 复用 | `field-editor.tsx` 的 icon 维度整体委托 `IconFieldEditor`；`icon-mode-adapter.ts` 做两种模型互转 |
| 2 Use chain / 四层链路 | `chain-tier-list.tsx`（Title 与 Icon **共用**同一实现）；`icon-field-editor.tsx` 的 `allowUseChain` |
| 4 Current Page 更多 + URL | `sidebar/App.tsx`：`currentMenuOpen` / `editingCurrentUrl` / `startCurrentUrlEdit` / `handleCurrentUrlSave`（写 `chrome.tabs.update`） |
| 5.1 slot URL ↺ | `sidebar/App.tsx` 的 `tbs-slot-row__url-edit` + `urlInitial` |
| 5.2 来源徽标 / 遮蔽 | `SlotSourceBadge` / `SlotRowMasking`（`sidebar/App.tsx`）；`onClearLayer` → `handleSlotClearLayer` |
| 5.3 文案 | 菜单项 + `Confirm` 的 `title` / `confirmLabel` |
| 6.1 取 Match URL 值 | 后端 `RESOLVE_MATCH_URL`（`worker-orchestrator.ts`）；前端 `resolveMatchUrlInto`（`settings/App.tsx`） |
| 6.2 / 6.3 影响提示 | `impact-preview.tsx`（`ImpactPreview` + `useImpactPreview`）；后端 `GET_IMPACT_PREVIEW` |
| 7.1 rule-hit Edit/Clear | `settings/App.tsx`：`applyDraft` / `resetEntry` 的 `kind === 'rule-hit'` 分支 |
| 1 布局 | `inline-editor-shell.tsx`（`grid` 默认改为 `false`）；`base.css` 的 `.tbs-rule-form-fields__pair` |

---

## 5. 已知风险 / 提醒

1. **全量测试全绿 ≠ 交互无问题**：本轮 14 项大多是表现层/交互层，自动化覆盖不到，务必人工过一遍 §3。
2. **`Clear All` / `Clear selected` 有意跳过 `rule-hit`**：禁用用户规则是比"清空已存 override/marker"破坏性大得多的操作，故只在**单行 `Clear`** 上提供。
3. **`↺` 的双重语义（有意保留）**：在**行内编辑**里是"复位到进入编辑时的值"（同 Match URL 的 `↺`）；在 `Use chain` 的**逐层**列表里是"清除该层"。两者都在 §3 可验。
4. **仓库有未提交改动**：`worker-orchestrator.ts` / `messages.ts` / `IconEditor.tsx` / `settings/App.tsx` / `sidebar/App.tsx` / `rule-form-fields.tsx` / 三个 css / 多个测试文件，以及 `src/ui/shared/` 下 10 个新增共享件。**请人工测试通过后再决定提交**。
5. **CSS 警告已清**：`sidebar.css` 四处 `-webkit-line-clamp` 已补标准 `line-clamp`（`read_lints` = 0）。
6. **文案不要中文**：仓库有 `no-cjk-in-ui` 守卫（`tests/unit/ui/no-cjk-in-ui.test.tsx`），任何 UI 文案/CSS 注释**不得含中文**，否则测试红。
7. **`message-client.ts` 有 14 个既有 lint 错误**（`no-unsafe-*` / `no-unnecessary-condition`），与 HEAD 完全一致，**不是本轮引入**。全库 `npm run lint` 因此仍非全绿。