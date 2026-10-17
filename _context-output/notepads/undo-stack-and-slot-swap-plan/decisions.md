# Decisions — undo-stack-and-slot-swap-plan (Wave 4)

## T11 + T12 merged in one method (plan-mandated)
- `swapSlots` contains both T11 (four combinations, short-circuit, D14 sequence) and
  T12 (A6 single `writeLocal` derived-state purge). Plan says "合并实现，但两条都要有独立 QA 证据" —
  delivered: T11-swap-slots-service.txt and T12-derived-state-purge.txt are separate.

## Delivery hook on SlotService (design choice)
- `SlotService` receives the delivery entry via `setDelivery(fn)`, mirroring
  `RuleService.setDelivery` (`rule-service.ts:381-385`) — NOT a constructor dependency.
  The worker wires it in its constructor (`slotService.setDelivery(...)`).
- Default is a resolved-Promise no-op (avoids the `require-await` lint error that the
  pre-existing `RuleService` field carries).

## D2 content/config split implementation
- `configAt(existing)` pulls `strategy`/`autoBindOverride` from whatever record OCCUPIES
  the number (or `'inherit'` when empty); `contentOf(existing)` carries everything else.
- Net effect: a record moves but adopts the TARGET number's strategy — the D2 trade-off,
  asserted as expected in T14.

## Z1 undo capture inside swapSlots
- `captureId = nextCaptureId(); repo.setPendingUndo({ kind:'swap', ... })` right after the
  local write succeeds. Cleanup timer calls `clearPendingUndo(sourceSlotId, captureId)`
  (captureId is the only identity valid for a swap entry — it has no singular `slotId`).

## A10 channel reused for the swap response
- `SwapSlotsResponse.result` carries `captureId?: number` (like `SaveSlotResponse`).
  It is a Response → does NOT touch `_bidirectional` nor the 53 contract count.
