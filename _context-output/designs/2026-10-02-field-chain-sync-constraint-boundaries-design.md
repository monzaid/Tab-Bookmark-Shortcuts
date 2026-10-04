# Constraint Layer — Delivery Ownership, Retry, Privacy & Test Discipline

> **上游**：Goal（Q1–Q14，OPEN 0）
> **层**：🔒 Constraint
> **决策**：C1–C8（8 项），**OPEN：0**，**登记风险：1（RK-1）**
> **日期**：2026-10-02 · **基线**：HEAD `a3d6ab3`

---

## 1. 权限与能力红线

### C1 · 权限零扩张
**决定**：**不新增** permission / host_permission / command。本迭代所需能力全部落在既有权限内：
- 投递 → `tabs` + `scripting`（既有）
- 站点原值回报 → `tabs.sendMessage`（既有）
- 存储 → `storage.local`（既有）
**理由**：新增权限会触发用户重授权，破坏升级体验；本迭代无新能力需求。

---

## 2. 投递所有权与可靠性

### C2 · 内容脚本为投递的**唯一实现**（`executeScript` 仅作最小兜底）
**决定**（Q15=A）：`apply` / `clear` / `restore-site` 三种语义**只在内容脚本实现**。理由：Q6 的**页面作用域快照**（站点原值）只能活在**常驻上下文**里；`scripting.executeScript` 注入的函数**每次调用全新、无状态**，无法跨调用保存快照——否则"还原"必须把快照外送再回传（多一次往返 + 竞态窗口）。
**兜底**：`executeScript` 退化为**最小能力集（仅 apply）**，**不支持 restore**；命中兜底即在状态中标记 `degraded`。
**已消解的分叉**：现状"主路径 executeScript / fallback sendMessage"导致**能力集不同**（清除只在 executeScript 生效，侦察 #4）——本项将其消除。

### C3 · 有界重试 + 明确降级标记
**决定**（Q16=A）：
- 发消息失败（无 receiver，如页面尚未注入内容脚本）→ 进入**待投递队列**，在 `CONTENT_READY` 或下一次 `tabs.onUpdated(status==='complete')` 时**补投**
- **重试上限 7 次，间隔递增：1s / 2s / 3s / 5s / 10s / 20s / 30s**
- 超限 → **降级为 `executeScript`（仅 apply）**，并在该 tab 标记 **`degraded`**
- **呈现**：三视图与 Dashboard 在该行显示 **`Limited: can't restore the site value`**（**文案定稿见深挖② §4**；**取代**本行原写的 `Degraded — cannot restore the site value`）；**清除操作在降级页只做"停止改写"，不承诺还原原值**
**理由**：把"投递成功 / 降级"变成**可观察状态**，与"来源徽标 + 遮蔽"同一哲学（用户必须知道当前显示的可靠性）；有界重试避免"永久 pending"。
**备注**：`degraded` 标记**仅存内存**，随 tab 关闭 / 导航清除（无需持久化）。

### C4 · 节流 / 去重红线
**决定**（Q17=A）：
1. 同一 tab 的多次投递**合流为"最新一次"**（后到覆盖先到，**不排队重放**——投递幂等，只有最终态有意义）
2. 编辑动作 **~300ms 防抖**（合并连续输入）
3. **重试队列每 tab 至多一条**；新投递**重置**该 tab 的重试计数
4. 重试按 C3 时间表**逐 tab 独立**推进
**否决**：全部立即执行（规则命中 40 页时会放大到 40×7 在途任务，且**旧值可能覆盖新值**）；全局串行队列（新编辑排在旧编辑之后 → 最终值可能被旧值覆盖，**危险**）。

---

## 3. 受保护页面

### C5 · 集中在投递入口判定
**决定**（Q18=A）：
- `recomputeAndRedeliver` 入口**统一**做 `isProtectedUrl` 判定，**移除 tier-local 的分散判定** —— ⚠️**行号已更正**（原文把三处都写成同一批行号，实际跨两个文件）：`rule-service.ts:609`（`reapplyToMatchingTabs`）、`worker-orchestrator.ts:966`（`reapplyFieldsToBoundTab`）、`rule-service.ts:455`（`applyToTab`）
- 受保护页**不投递**；三视图该行标注 **`Can't rewrite this page`**（**文案定稿见深挖② §4**；**取代**本行原写的 `Cannot rewrite (protected page)`）
- `file://`：内容脚本需用户开启"允许访问文件网址"；未开启 → 自然走 C3 降级路径并标记 `degraded`
- **编辑本身仍允许**（值存于 override/slot，**投递不到**而已）
**理由**：一处判定 = 一处真相；用户必须**看得见**为什么没生效；且 slot 是**跨页面配置**，不应因"当前所在页是特权页"而拒绝保存（否决"UI 直接禁止编辑"）。

---

## 4. 隐私与数据边界

### C6 · `siteSnapshot` 严格封闭
**决定**（Q19=A + Q20=A）：
- **只存 `local`**；**不进 `sync`、不进导出、不进诊断**、不进除三视图外的任何持久化
- **字段仅** `{ title, faviconHref }`（**不存 URL、不存页面内容**）
- **按 tabId** 记录；**只读**（`site` 节点不可编辑——原值属于站点，不属于扩展）
- **生命周期**：**每次导航后重新捕获**（链路生效期间）；**链不再产生改写 → 丢弃**；**tab 关闭 → 丢弃**（防 Chrome **tabId 复用**串值）；**扩展重载 → 保留**（`local` 持久）
**否决**：随导出（原值无跨设备意义，且属对浏览内容的推断，扩大扩散面）；仅内存（MV3 SW 约 30s 空闲即可能回收 → `site` 节点会频繁显示 `—`）。
**已消解的两处冲突**：① "不随导航失效"**不等于**保留旧值——导航后**重新捕获**，否则会显示/还原**上一页**的标题；② tab 关闭**必须丢弃**（tabId 可被新 tab 复用）。

---

## 5. 测试与工程纪律

### C7 · 既有测试处置：**完全自由重写**（用户裁决）+ 显式登记风险
**决定**（Q21=B）：允许**删改判据**以适配新结构；**必须显式登记 RK**。
**实测代价面**：
| 测试 | 锁定语义 | 本轮变化 |
|---|---|---|
| `rule-apply-persistence.test.ts` | 链的权威证据 | 语义**不变**，表示形式受"共享纯函数"改造影响 |
| `tab-override-fix.test.ts` | override merge / 立即投递 | 语义保留；**投递路径**改走内容脚本 → 断言重写 |
| `rule-save-chain.test.ts` | 含 manual 不投递 | **语义消失**（Q11 取消 manual） |
| `rule-delivery-robust.test.ts` | executeScript→sendMessage 回退 | **主备反转**（C2）→ 断言颠倒 |
| `url-utils.test.ts:271-301` | 排序/冲突矩阵 | 保留（Q5 改为复用该共享函数） |
| `sidebar-slot-tier-display.test.tsx` | 视图 = worker 一致 | 由"锁步测试"升级为**构造保证**（Q5） |
| `rule-editor.test.tsx` / `dual-cards.test.tsx` | 孤儿组件 | **随组件删除**（Q13） |

### C8 · 工程基线（沿用）
- **不新增 npm 依赖**；不放宽 `eslint.config.mjs` 严格度、不新增 `eslint-disable`
- **lint 判据 = delta-0**；`typecheck` 0 error；三浏览器 build（chrome/edge/firefox）通过
- 界面**统一英文**；`src/ui` CJK 守卫保持 0 命中
- 新增控件满足 **WCAG 2.1 AA**（可见焦点、非仅颜色、可键盘操作）

---

## 6. ⚠️ 登记风险

### RK-1 · 核心解析语义与投递协议同时重构，行为漂移失去完整证据
**成因**：C7 允许自由重写行为语义测试，而本轮同时改动**清除语义**（Q6）、**取消 manual**（Q11）、**投递主备反转**（C2）、**共享编辑器**（Q13）。
**影响**：**"链优先级未发生意外漂移"不再有完整的可执行证据**。
**缓解（建议，非强制）**：
1. **`field-chain.ts` 保留独立穷举单测** —— 纯输入→输出，不依赖旧断言（迁移成本最低、证据最强）
2. 计划中**显式携带本风险**
3. 交付前可补一组"链优先级前后等价"对照用例（针对 title / icon 两条链分别）

---

## 7. 遗留至下层

| 归属层 | 遗留项 |
|--------|--------|
| 🏗️ Architecture | `field-chain.ts` 形状与**两条独立链**的返回结构；`recomputeAndRedeliver` 的**位置、闸门与受影响集合计算**；`apply`/`clear`/`restore-site` 的**消息协议**；**每 tab 投递排序/去重**（修侦察 #11）；`siteSnapshot` 的 `local` 形状与**重捕获触发点**；`degraded` 标记的存放（内存）与查询方式；`mode` 字段删除 + `APPLY_RULE_TO_TAB` 收敛；Dashboard 数据源（配置 + 链）；**跳焦机制**（跨页定位规则行）；`GET_DASHBOARD` 形状演进 |
| 📐 Detail | ✅ **已全部关闭** —— 文案（深挖②）、校验边界 / 跳焦 / 空态×delivery（深挖③）、4 入口一致性（IMP-3/7 例外登记）；仅**测试分层与 RED 可构造性**归入计划阶段 |