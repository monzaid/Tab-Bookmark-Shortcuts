# Decisions & Deviations — rule-tags-iteration-plan

## 遵守的硬约束（4 条）
1. **P7 中间红灯是预期的**：T1 后 typecheck 82 errors，全部为必填蔓延；
   `src/` 侧收口点 T14 达成（0），全仓 0 由 T19 达成。**未**把 `tagIds` 改可选。
2. **同文件串行**：Wave 2 内 `T7 → T8`（types.ts）；Wave 4 内 `T15 → T16 → T17`
   （settings/App.tsx + settings.css），严格串行执行。T19 独占 tests/** 既有 fixture 迁移。
3. **三个机械守卫**：I1（链文件 tagIds：field-chain 0 / field-delivery 0 /
   rule-service 仅 1 处机械空数组）；A-a（tag-service 0 投递符号）；C0（SYNC_KEY 13、
   deps 恰 2 项）——全部保持。
4. **测试纪律**：断言不变式（configVersion 恰 +1 / 差集为空 / 无悬空 id /
   三枚举键集合相等）；jsdom 断言结构（flex-wrap 属性、列不在 DOM）；
   D1 真实 5000 层构造；C6 与 C7 两条独立断言。

## 与计划的偏差（全部已上报）
1. **计划「预期清单（完整，5 处）」不全**：src 侧实际 8 条，多出
   `storage-repository.ts:80,253`、`sidebar/App.tsx:1032`、`settings/App.tsx:98,2456`。
   均有归属任务，非孤儿 ⇒ 未阻断。
2. **`src/ui/shared/message-client.ts` 无任务归属**：持有 src/ 唯一
   `Record<DomainErrorCode,string>` 穷尽表，T7 新增错误码使其编译失败。
   依 T1 先例机械补缺（T7 内）。
3. **T11 签名细化**：`computeExportSelfConsistency(pkg, localTags)`——计划的验收
   （补足取本机颜色）在单参形式下不可满足（被排除的标签不在包内）。
4. **R8 过度概括两处**：导出摘要 `<li>` 清单与「N of 4 parts」页脚是手写字面量，
   非 `DIMENSION_LABELS.map`，需手改（已改为派生）。
5. **`npm run lint` 基线即失败**：HEAD 上 644 problems（642 errors/2 warnings），
   计划 DoD「lint → 0 warning」在迭代前即不可满足。本迭代增量已归零（新源/测试文件
   eslint 全绿），既有 644 项未动（避免范围蔓延）。
6. **fixture 面 ~51 文件 / 277 点**，非计划的「63 文件」；实际面由编译器枚举。
7. **环境无 agent 派生工具** ⇒ 直接执行 TDD，保留完整 RED→GREEN 与独立验证。

## 执行中发现并修复的真实缺陷（7 个，均在 src 侧修复，非改断言）
1. T9 撤销重放顺序错误（union 顺序）→ 按快照原序重放。
2. T10 `resolveImportedTags` 未容错缺失 `tags` → `names ?? []`。
3. T13 sidebar `handleSave` 依赖数组漏 `tagIds`（闭包捕获空数组，标签永不提交）。
4. T14/T17 `syncStateToPackage` / `applyResult.dimensions[dim]` 对缺失字段崩溃 →
   容错降级为「此处无内容」。
5. T19 `no-cjk-in-ui`：我在 App.tsx 注释中残留 1 个中文字符 → 移除。
6. T19 `shared-component-styles`：`.tbs-tag-selector` 被使用但未定义 → 补定义。
7. T18 类守卫的 `sourcesUsingPrefix` 未随 CLASS_TOKEN 扩展 → 新前缀文件未被扫描
   （植入未定义类也不失败）→ 改为由 CLASS_TOKEN 派生。

## 终审结论（F1–F4，均为 APPROVE）
- F1 计划合规：Must Have 19/19，Must NOT Have 13/13，§7 5/5，证据 50 文件非空。
- F2 代码质量：typecheck 0、三浏览器构建成功、1507 测试全绿、本迭代 lint 增量 0、
  无本项目特有反模式。
- F3 真实 QA：21/21 任务场景、3/3 跨任务链路、8 类边界用例。
- F4 范围保真：21/21 合规、42 决策落地、无污染、2 处未登记改动均已披露。