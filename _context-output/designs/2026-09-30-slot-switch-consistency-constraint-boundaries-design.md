# Constraint Layer — Boundaries, Red Lines & Non-Functionals

> **上游**：Goal 层 `2026-09-30-slot-switch-consistency-goal-core-scope-design.md`（D1–D16，OPEN 0）
> **层**：🔒 Constraint
> **决策**：C1–C7（7 项），**OPEN：0**，**登记风险：1**（见 §4）
> **日期**：2026-09-30

---

## 1. 权限红线（已核实，非推测）

**既有 manifest 权限集**（`manifests/base.json`，实测）：

```
permissions:      tabs, windows, storage, notifications, commands, sidePanel, scripting
host_permissions: <all_urls>
incognito:        "not_allowed"
commands:         save-slot-1..10, switch-slot-1..10, next-match（共 21 条）
```

### C1 · 权限不扩张
**决定**：本迭代**不新增任何 permission / host_permission / 新 command**。所需能力（tabs 查询与激活、windows 聚焦、storage 持久化、popup 创建）**全部落在既有权限内**。
**理由**：位置环（D11）用 `tabs.query({ currentWindow: true })`、聚焦用 tabs/windows 激活、恢复窗用 `windows.create`、持久化用 storage——均已有权限；新增权限会触发用户重授权，破坏升级体验。
**影响**：方向设置（D6）复用既有 `next-match` / `switch-slot-x` 命令，**不新增快捷键命令**。

---

## 2. 安全与隐私红线

### C2 · 特权页：分动作区别对待
**决定**（源自 Q17）：
- **打开/导航类**（恢复窗 `Open URL` 新建；`openOrReusePage` 的导航）→ **必须拦截**特权页，沿用 `isProtectedUrl`；命中 → **窗内报错、不打开**。
- **激活类**（Position 步进/聚焦；恢复窗 Prev/Next 切换已存在标签页）→ **放行**；且**环包含**特权页（环 = 用户所见 tab strip，D11 前提）。
- **`file://` 等同特权页**。
**已确认的真实缺口**：`recovery-service.openUrl`（`:64`）当前直接 `tabs.create({ url: session.urlMatch.value })`，**未做协议校验** → 本迭代必须补上。
**否决**：全拦截（环排除特权页会破坏"环 = tab strip"，`↑/↓` 跳过用户可见标签页）。
**影响**：`Open URL` 与 `openOrReusePage` 的导航路径必须过 `isProtectedUrl`；激活路径不得过（否则合法标签页无法切）。

### C3 · incognito 授权统一沿用
**决定**（源自 Q18）：凡动作会「激活/聚焦 incognito 标签页」或「在 incognito 上下文新建标签页」→ 均需 `incognito.isAllowed()`；未授权 → **不执行**，返回 `incognito_blocked` 语义，UI 如实提示。与既有 `switchSlot` 完全一致。
**否决**：更严（已授权仍拒激活 = 能力回退）；更松（削弱 `not_allowed` 默认下的隐私承诺）。
**影响**：需 gating 的三类新动作 = 聚焦跨窗、恢复窗 Prev/Next 候选、`Open URL` 新建。（D11 限定环为当前窗口，故非 incognito 窗口的**当前窗口环**天然不含 incognito 标签页。）

---

## 3. 数据与兼容红线

### C4 · 读时升级并回写 + 独立 `schemaVersion`
**决定**（源自 Q19）：加载时检测旧形状（存在 `globalStrategy: 'A'|'B'|'C'`）→ 按 D10 映射为新形状 → **持久化替换**；引入**独立的 `schemaVersion`** 用于未来迁移，**不复用 `configVersion`**。旧**导出文件**导入时同样映射。
**理由**：这是 D10「行为零漂移」唯一可验证的工程形态（迁移成为一次确定性、可断言的操作）；`schemaVersion`（数据形状）与 `configVersion`（乐观并发，已被 B9 系列依赖）必须解耦。
**否决**：仅内存映射不回写（新旧格式长期并存、不可测）；不兼容重置（与 D10 冲突）。

### C5 · 测试处置纪律 —— ⚠️ 已裁决为「自由重写」（风险已登记）
**决定**（用户裁决，推翻选项 A）：**按新模型自由重写**，允许删改既有判据以适配新结构。
**实测代价面（检索证据）**：
- **行为语义锚点**（D10 的证据）：`tests/integration/slot-service.test.ts:107`（strategy B 的 URL 失配回退）、`:133`（strategy C 忽略 tabId）
- **UI 结构锚点**：`tests/unit/ui/settings.test.tsx:96`（global strategy radios + B checked）、`:109`（10 per-slot strategy selects）
- **夹具面**：**30 个测试文件**引用 `globalStrategy` / `strategy`
- **锁定仍保留的结果契约**（非策略语义，须保留）：`SwitchOutcome.type === 'needs_recovery'` 被 `slot-service.test.ts:146/162`、`full-suite.test.ts:71/179` 断言 → 新模型**不得移除该 outcome 类型**
**影响**：见 §4 登记风险。

---

## 4. ⚠️ 登记风险（C5 的必然结果，须在计划中显式携带）

| ID | 风险 | 影响 | 缓解（不改变裁决，仅降低受害面） |
|----|------|------|--------------------------------|
| **RK1** | **老用户切换行为变更将无测试可证** | 新默认 = 组合 1 + `priority=tabId`（D9）在"URL 已变但 tab 存活"时**不等价**于旧 B（组合 1 + `none`）。因 C5 允许自由重写行为语义用例，**D10 的"零漂移"失去可执行证据**，退化为口头承诺。 | ① 迁移函数（D10 映射）本身仍应有**独立单测**（迁移是纯函数，可不依赖旧 A/B/C 行为用例）——**建议但非强制**；② 在设计/计划文档中**显式携带本风险**；③ 若后续需要证据，可在交付前补一组"迁移前后行为等价"对照用例。 |

**说明**：本风险由用户在 C5 主动接受，设计不擅自回退裁决；仅按要求**显式登记**。

---

## 5. 工程质量红线（既有基线，沿用）

| ID | 约束 |
|----|------|
| **C6** | **不新增 npm 依赖**（焦点/弹窗/控件全部复用既有实现） |
| **C7** | **不放宽 `eslint.config.mjs` 严格度**、不新增 `eslint-disable`；**lint 判据 = delta-0**（基线红，见既往 Lint 基线说明）；**`typecheck` = 0 error**；**三浏览器 build（chrome/edge/firefox）全部通过** |
| **C6b** | 新增 a11y 控件（`↑/↓`、恢复窗单选框、设置页三态选择、新方向设置）须满足 **WCAG 2.1 AA 基线**：可见焦点指示、状态不单靠颜色、可键盘操作（与 `components.tsx` 既有信条一致） |
| **C6c** | 界面文案**统一英文**（延续 D-UIUX `DR1`）；不得引入 CJK；`src/ui` CJK 守卫测试须保持 0 命中 |
| **C6d** | 既有护栏继续生效：不引入 `as any`/`@ts-ignore` 新增、生产代码不得新增 `console.log`、不得触碰 `.md` 交付文档之外的越界文件 |

---

## 6. 下层遗留（Constraint → Architecture）

| 归属 | 遗留项 |
|------|--------|
| 🏗️ Architecture | ① `isProtectedUrl` 的**实际集合**需在下层读码核对（并确认 `file://` 是否需补入）；② `schemaVersion` 的落点与迁移触发点（启动比对 / 读时）；③ 迁移函数的纯函数化与单测落点（见 RK1）；④ `incognito_blocked` 在新动作上的 outcome 表达（是否复用 `SwitchOutcome` 或新增）；⑤ 方向设置 / autoBind 全局默认 / autoBind 槽位覆盖 的持久化键与 **sync vs local** 归属；⑥ 环查询的窗口作用域判定（`currentWindow` 在侧边栏上下文的行为） |
| 📐 Detail | ① `Open URL` 拦截特权页时的**窗内错误文案**（成品英文）；② `incognito_blocked` 的 UI 提示文案与呈现位置（toast / 窗内 alert）；③ 三态控件与方向设置的**标签文案**；④ 迁移后**导入旧导出文件**的失败态（形状非法时）文案 |