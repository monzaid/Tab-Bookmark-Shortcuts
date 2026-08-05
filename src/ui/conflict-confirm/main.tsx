import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConflictConfirm } from './App';
import type { ConflictInfo } from './App';

// Import styles
import '@ui/styles/base.css';
import '@ui/styles/conflict-confirm.css';

// ─── Message client ─────────────────────────────────────────────────────────

async function sendMessage(action: string, payload?: unknown): Promise<unknown> {
  return chrome.runtime.sendMessage({ requestId: `conflict-${Date.now()}`, action, payload });
}

// ─── Parse URL params ───────────────────────────────────────────────────────

const params = new URLSearchParams(window.location.search);
const conflict: ConflictInfo = {
  slotId: parseInt(params.get('slotId') ?? '0', 10),
  oldTitle: params.get('oldTitle') ?? '',
  oldUrl: params.get('oldUrl') ?? '',
  newTitle: params.get('newTitle') ?? '',
  newUrl: params.get('newUrl') ?? '',
};

// Captured tab data from background (at shortcut trigger time)
const capturedTabId = parseInt(params.get('tabId') ?? '0', 10);
const capturedFavIconUrl = params.get('favIconUrl') ?? '';

// ─── Action handlers ────────────────────────────────────────────────────────

async function handleOverwrite(): Promise<void> {
  // Use CONFLICT_OVERWRITE with captured tab data to avoid saving the popup's own tab
  await sendMessage('CONFLICT_OVERWRITE', {
    slotId: conflict.slotId,
    tabId: capturedTabId,
    url: conflict.newUrl,
    title: conflict.newTitle,
    favIconUrl: capturedFavIconUrl,
  });
}

async function handleCancel(): Promise<void> {
  await sendMessage('CONFLICT_CANCEL', { slotId: conflict.slotId });
}

// ─── Render ─────────────────────────────────────────────────────────────────

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <ConflictConfirm
        conflict={conflict}
        onOverwrite={handleOverwrite}
        onCancel={handleCancel}
      />
    </StrictMode>,
  );
}
