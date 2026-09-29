import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RecoveryWindow } from './App';
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

// ─── Action handlers ────────────────────────────────────────────────────────

async function handleOpenUrl(id: string): Promise<void> {
  const response = await sendMessage('RECOVERY_OPEN_URL', { recoveryId: id }) as {
    result?: { success: boolean };
    success?: boolean;
  };
  const result = response?.result ?? response;
  if (!result?.success) {
    throw new Error('Failed to open URL');
  }
  // Close this popup window after successful action
  window.close();
}

async function handleNextMatch(id: string): Promise<void> {
  const response = await sendMessage('RECOVERY_NEXT_MATCH', { recoveryId: id }) as {
    result?: { success: boolean };
    success?: boolean;
  };
  const result = response?.result ?? response;
  if (!result?.success) {
    throw new Error('No matching tabs found');
  }
  window.close();
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
        onOpenUrl={handleOpenUrl}
        onNextMatch={handleNextMatch}
        onDismiss={handleDismiss}
      />
    </StrictMode>,
  );
}
