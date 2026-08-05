/**
 * Toolbar Entry & Sidebar Adapter — Chrome/Edge/Firefox sidebar adaptation.
 *
 * - Toolbar action: Chromium opens/focuses Side Panel tab, Firefox opens/focuses Sidebar
 * - Shared sidebar React entry
 * - Adapter layer handles capability detection and failure hints
 *
 * Does NOT: set default_popup, write browser branches outside adapter layer
 */

import type { BrowserAdapter } from '@adapters/contract';

// ─── Sidebar Adapter ─────────────────────────────────────────────────────────

export interface SidebarCapability {
  supported: boolean;
  type: 'side_panel' | 'sidebar_action' | 'none';
  failureHint?: string;
}

export class SidebarAdapter {
  constructor(private adapter: BrowserAdapter) {}

  /**
   * Detect sidebar capability for current browser.
   */
  getCapability(): SidebarCapability {
    const browserType = this.adapter.getBrowserType();

    if (browserType === 'firefox') {
      // Firefox uses sidebar_action (declared in manifest)
      return { supported: true, type: 'sidebar_action' };
    }

    // Chromium-based: check sidePanel API availability
    if (this.adapter.sidePanel.isSupported()) {
      return { supported: true, type: 'side_panel' };
    }

    return {
      supported: false,
      type: 'none',
      failureHint: 'Side panel is not supported in this browser version. Please update your browser.',
    };
  }

  /**
   * Open/focus the sidebar.
   * Called when toolbar action is clicked.
   */
  async openSidebar(windowId?: number): Promise<{ success: true } | { success: false; message: string }> {
    const capability = this.getCapability();

    if (!capability.supported) {
      return { success: false, message: capability.failureHint ?? 'Sidebar not supported' };
    }

    try {
      if (capability.type === 'side_panel') {
        await this.adapter.sidePanel.open(windowId);
      }
      // Firefox sidebar_action is toggled by the browser automatically
      // when the toolbar button is clicked (manifest-declared)
      return { success: true };
    } catch (e) {
      return {
        success: false,
        message: 'Failed to open sidebar. Please try clicking the toolbar icon again.',
      };
    }
  }

  /**
   * Configure side panel options (Chromium only).
   */
  async configure(): Promise<void> {
    const capability = this.getCapability();
    if (capability.type === 'side_panel') {
      try {
        await this.adapter.sidePanel.setOptions({
          path: 'src/ui/sidebar/index.html',
          enabled: true,
        });
      } catch {
        // Non-critical — sidebar will still work via manifest declaration
      }
    }
  }

  /**
   * Get the sidebar UI URL (same for all browsers).
   */
  getSidebarUrl(): string {
    return this.adapter.runtime.getURL('src/ui/sidebar/index.html');
  }
}

// ─── Toolbar Action Handler ──────────────────────────────────────────────────

export class ToolbarActionHandler {
  private sidebarAdapter: SidebarAdapter;

  constructor(private adapter: BrowserAdapter) {
    this.sidebarAdapter = new SidebarAdapter(adapter);
  }

  /**
   * Initialize toolbar action handling.
   * In Chromium: action.onClicked → open side panel
   * In Firefox: sidebar_action handles it automatically via manifest
   */
  async initialize(): Promise<void> {
    await this.sidebarAdapter.configure();

    const browserType = this.adapter.getBrowserType();

    if (browserType !== 'firefox') {
      // Chromium: listen for action click to open side panel
      // The action.onClicked event fires when no popup is set
      // We use runtime message from action or commands
      this.adapter.runtime.onMessage((message, _sender, sendResponse) => {
        const msg = message as { action?: string };
        if (msg?.action === 'OPEN_SIDEBAR') {
          void this.sidebarAdapter.openSidebar().then((result) => {
            sendResponse(result);
          });
          return true;
        }
        return false;
      });
    }
  }

  /**
   * Handle toolbar click (called from Worker command handler or action listener).
   */
  async handleToolbarClick(windowId?: number): Promise<{ success: boolean; message?: string }> {
    return this.sidebarAdapter.openSidebar(windowId);
  }
}
