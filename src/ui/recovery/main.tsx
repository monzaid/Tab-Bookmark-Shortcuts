import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RecoveryWindow, parseAutoBindParam } from './App';
import type { RecoveryMatchType } from './App';
import { getMessageClient } from '@ui/shared/message-client';

// Import styles
import '@ui/styles/base.css';
import '@ui/styles/recovery.css';

// ─── Message client (B11: all cross-context messaging goes through here) ────

async function sendMessage(action: string, payload?: unknown): Promise<unknown> {
  return getMessageClient().sendRaw(action, payload);
}

// ─── Parse URL params ───────────────────────────────────────────────────────

const params = new URLSearchParams(window.location.search);
const recoveryId = params.get('recoveryId') ?? '';
const slotTitle = params.get('title') ?? 'Saved page';
const slotUrl = params.get('url') ?? '';
/** A12: match type is passed by the worker so Open URL shows only for exact. */
const matchType: RecoveryMatchType = params.get('matchType') === 'regex' ? 'regex' : 'exact';
/** FIX-2: the worker sends the effective auto-bind value for this slot. */
const autoBind = parseAutoBindParam(params.get('autoBind'));

interface ActionResponse {
  result?: { success: boolean; errorCode?: string };
  success?: boolean;
  errorCode?: string;
}

function unwrap(response: unknown): { success: boolean; errorCode?: string } {
  const r = response as ActionResponse;
  const inner = r?.result ?? r;
  return { success: Boolean(inner?.success), errorCode: inner?.errorCode };
}

// ─── Action handlers ────────────────────────────────────────────────────────

async function handleOpenUrl(id: string, autoBind: boolean): Promise<void> {
  const { success, errorCode } = unwrap(await sendMessage('RECOVERY_OPEN_URL', { recoveryId: id, autoBind }));
  if (!success) {
    // BLK-B / B2: privileged pages surface the existing errorCode so the window
    // renders "This URL cannot be opened" instead of closing.
    throw new Error(errorCode === 'PROTECTED_PAGE' ? 'PROTECTED_PAGE' : 'Failed to open URL');
  }
  // Open URL is a terminal action → close this window.
  window.close();
}

async function handleNextMatch(id: string, autoBind: boolean): Promise<void> {
  const { success } = unwrap(await sendMessage('RECOVERY_NEXT_MATCH', { recoveryId: id, autoBind }));
  if (!success) {
    throw new Error('No matching tabs found at this time');
  }
  // DT3: browsing keeps the window open (no window.close()).
}

async function handlePrevMatch(id: string, autoBind: boolean): Promise<void> {
  const { success } = unwrap(await sendMessage('RECOVERY_PREV_MATCH', { recoveryId: id, autoBind }));
  if (!success) {
    throw new Error('No matching tabs found at this time');
  }
  // DT3: browsing keeps the window open.
}

async function handleAutoBindChange(enabled: boolean): Promise<void> {
  // Persist the per-slot override immediately (A12 / DT8④).
  await sendMessage('SET_SLOT_AUTO_BIND', { slotId: Number(params.get('slotId') ?? 0), override: enabled });
}

async function handleDismiss(id: string): Promise<void> {
  await sendMessage('RECOVERY_DISMISS', { recoveryId: id });
  window.close();
}

// ─── Render ─────────────────────────────────────────────────────────────────

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <RecoveryWindow
        recoveryId={recoveryId}
        slotTitle={slotTitle}
        slotUrl={slotUrl}
        matchType={matchType}
        autoBind={autoBind}
        onOpenUrl={handleOpenUrl}
        onNextMatch={handleNextMatch}
        onPrevMatch={handlePrevMatch}
        onAutoBindChange={(enabled) => { void handleAutoBindChange(enabled); }}
        onDismiss={handleDismiss}
      />
    </StrictMode>,
  );
}