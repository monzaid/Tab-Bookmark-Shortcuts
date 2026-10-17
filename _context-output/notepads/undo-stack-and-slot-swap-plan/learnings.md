# Learnings — undo-stack-and-slot-swap-plan (Wave 4)

## Baseline (verified before Wave 4)
- `npx tsc --noEmit` = 0 errors (exit 0).
- Contract count = 52 (`messages-import-export-contract.test.ts:105,109`); T13 raises to 53.
- Full suite baseline reported by prior waves: 610 files / 1745 tests / 0 failed.
- Single workspace on branch `main` (no git worktrees in this repo); prior waves' edits are uncommitted working-tree changes.

## V2 pre-check (plan-mandated, T11 first step) — RESOLVED
- Import path **DOES** validate slot range: `src/background/domain-rules.ts:37-38` (`VALID_SLOT_MIN=1`, `VALID_SLOT_MAX=10`) and `:64-70` rejects non-integer / out-of-range slot ids.
- Conclusion: `swapSlots`' out-of-range check follows A4 as written (`SLOT_NOT_FOUND`); **no extra defence layer** (Metis Over-Validation guardrail). No import-side comment needed beyond A4.

## Key source facts (verified)
- `SlotService` ctor = `(adapter, repo)` only — no delivery dep. Delivery precedent for services: `RuleService.setDelivery(fn)` (`rule-service.ts:381-385`).
- `writeSync(expectedVersion, updater)` — optimistic check + **unconditional** `configVersion+1` (`storage-repository.ts:482-496`). ⇒ empty↔empty MUST short-circuit (A7).
- `writeLocal(updater)` — no version check, serialised queue (`:779-794`).
- `PendingUndoSnapshot` already discriminated `kind:'single'|'swap'` (`storage-repository.ts:66-95`); `setPendingUndo` appends; `getPendingUndo(captureId?)`; `clearPendingUndo(slotId?, captureId?)` filters.
- `restoreSlot(slotId, captureId)` already dispatches on `kind`; `restoreSwapSnapshot` skeleton exists (`slot-service.ts:674-780`) — T3 landed it.
- `nextCaptureId()` module counter (`slot-service.ts:40-44`) — globally unique.
- `LocalState` derived fields: `cycleCursors` (has slotId), `recoverySessions` (slotId), `recoverySnapshots` (slotId), `lastSuccessSlotId`.
- Delivery re-read precedent: `worker-orchestrator.ts:789-790` (`UPDATE_SLOT_URL` → read binding → `delivery.recomputeAndRedeliver`).

## Test harness facts
- Integration test device: `tests/integration/slot-service.test.ts` uses `createMockAdapter()` + real `StorageRepository` + `SlotService`; seeds sync via `repo.saveSlot(slot, version)`.
- Mock failure injection: `adapter.failStorageSet(area, key?)` (persistent, key-scoped), `failNextStorageSet(area, key?)` (one-shot), `failStorageSetQuota(...)`.
- `adapter.calls` logs `{method, args}` — used to count `storage.set('local', {localState})` writes.
- Shell: PowerShell 5.1; CLIXML noise on stderr is harmless.

---

# Wave 5 (T15/T16/T18/T19 — 交换前端) — 2026-10-16

## Baseline re-verified before Wave 5
- `tsc --noEmit` = 0；契约计数 = **53**（T13 已落地）；全量 = 181 文件 / 1762 用例 / 0 失败。
- Wave 5 **不改变**契约计数（纯前端）。

## 关键实现事实（本批新增）
- **jsdom 的 `fireEvent.dragStart(el)` 不带 `dataTransfer`** → 若行根 `handleDragStart` 直接
  `e.dataTransfer.setData(...)`，会抛 `Cannot read properties of undefined (reading 'setData')`
  并被 vitest 记为 **Unhandled Error（不计入 failed，但会让 `Errors: N errors`）**。
  两条都要做：(1) 生产侧对 `dataTransfer` 做一次 re-type + 早退；
  (2) 测试侧手写 `DataTransfer` 并显式传入 `{ dataTransfer: stub }`（照 `tag-chip-input.test.tsx:1064-1069`）。
- **`setDragImage` 的可选链 vs eslint 冲突**：DOM 类型把 `DataTransfer.setDragImage` 声明为非空，
  直接写 `?.` 会触发 `@typescript-eslint/no-unnecessary-condition`（"Unnecessary optional chain"）。
  解法（沿用项目既有手法，见 `openPage` 对 `chrome.runtime` 的 re-type）：文件内声明
  `interface DragTransfer { setData; getData; effectAllowed; dropEffect; setDragImage?: (...) }`
  + `function dragTransferOf(e: React.DragEvent): DragTransfer | undefined`，使 `?.` 成为真实判空。
- **`fireEvent.dragStart(titleEl)` 的事件会冒泡到行根**：React 会调用传播路径上所有处理器，
  且 `preventDefault()` **不阻断**传播。所以 D9/A8 的效果是"文本取消默认行为（保住选中），
  行根处理器照常运行但无事发生"。断言 `fireEvent.dragStart(...) === false`（defaultPrevented）。
- **对话框内 input 的 onKeyDown 不要整体 `stopPropagation()`**：会吞掉 `Escape`，
  使 `Dialog` 的关闭处理器收不到（实测 RED）。只对需要拦截的键（Enter）调 stopPropagation；
  Escape 明确留给 Dialog。
- **类名状态覆盖守卫**：`tests/unit/ui/shared-component-styles.test.ts` 与
  `settings-class-css.test.ts` 要求每个 `tbs-*` 类名必须**有对应 CSS**。本批新增
  `tbs-slot-row--swap-source/--swap-target`、`tbs-slot-swap__refs/__ref/__input/__error/__actions`
  —— 全部同步补进 `src/ui/styles/sidebar.css`。
- **CSS 结构断言的 helper 陷阱**：`ruleBody(css, '.tbs-slot-row')` 若用朴素字符串匹配，
  会被 `.tbs-slot-row--bound { ... }` 满足（基础规则断言通过但看的是修饰符的规则体）。
  必须加前缀守卫 `(?<![\w-])` 并先剥注释。

## 本批验证结果
- `tsc --noEmit` = 0；契约计数 = 53（未变）。
- 全量 `npx vitest run` = **181 files / 1782 tests / 0 failed / 无 Errors**。
- 回归：`sidebar-slot-doubleclick-no-switch` 绿；菜单相关 7 套件绿；
  `no-cjk-in-ui` / `shared-component-styles` / `settings-class-css` / `undo-bar` / `a11y-confirm-undo` 绿。
- `eslint src/ui/sidebar/App.tsx`：改造前 101 → 改造后 97（净 −4，改动区间 0 新增）。
- 两个新测试文件 eslint = 0 problems。
