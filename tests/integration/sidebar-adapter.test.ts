import { describe, it, expect, beforeEach } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { SidebarAdapter, ToolbarActionHandler } from '@background/sidebar-adapter';

describe('T23: Toolbar entry and Chrome/Edge/Firefox sidebar adaptation', () => {
  const adapter = createMockAdapter();
  let sidebar: SidebarAdapter;
  let toolbar: ToolbarActionHandler;

  beforeEach(() => {
    adapter.reset();
    sidebar = new SidebarAdapter(adapter);
    toolbar = new ToolbarActionHandler(adapter);
  });

  describe('Happy path — Chromium and Firefox adaptation', () => {
    it('should detect side_panel capability for Chrome', () => {
      adapter.state.browserType = 'chrome';
      adapter.state.sidePanelSupported = true;

      const cap = sidebar.getCapability();
      expect(cap.supported).toBe(true);
      expect(cap.type).toBe('side_panel');
    });

    it('should detect side_panel capability for Edge', () => {
      adapter.state.browserType = 'edge';
      adapter.state.sidePanelSupported = true;

      const cap = sidebar.getCapability();
      expect(cap.supported).toBe(true);
      expect(cap.type).toBe('side_panel');
    });

    it('should detect sidebar_action capability for Firefox', () => {
      adapter.state.browserType = 'firefox';

      const cap = sidebar.getCapability();
      expect(cap.supported).toBe(true);
      expect(cap.type).toBe('sidebar_action');
    });

    it('should open side panel for Chromium', async () => {
      adapter.state.browserType = 'chrome';
      adapter.state.sidePanelSupported = true;

      const result = await sidebar.openSidebar(1);
      expect(result.success).toBe(true);

      const calls = adapter.calls.filter((c) => c.method === 'sidePanel.open');
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0]).toBe(1);
    });

    it('should return success for Firefox (browser handles sidebar toggle)', async () => {
      adapter.state.browserType = 'firefox';

      const result = await sidebar.openSidebar();
      expect(result.success).toBe(true);

      // No sidePanel.open call for Firefox
      const calls = adapter.calls.filter((c) => c.method === 'sidePanel.open');
      expect(calls).toHaveLength(0);
    });

    it('should use same sidebar URL for all browsers', () => {
      adapter.state.browserType = 'chrome';
      const chromeUrl = sidebar.getSidebarUrl();

      adapter.state.browserType = 'firefox';
      const firefoxUrl = sidebar.getSidebarUrl();

      expect(chromeUrl).toBe(firefoxUrl);
      expect(chromeUrl).toContain('src/ui/sidebar/index.html');
    });

    it('should configure side panel options for Chromium', async () => {
      adapter.state.browserType = 'chrome';
      adapter.state.sidePanelSupported = true;

      await sidebar.configure();

      const calls = adapter.calls.filter((c) => c.method === 'sidePanel.setOptions');
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0]).toEqual(expect.objectContaining({ enabled: true }));
    });

    it('should handle toolbar click via ToolbarActionHandler', async () => {
      adapter.state.browserType = 'chrome';
      adapter.state.sidePanelSupported = true;

      const result = await toolbar.handleToolbarClick(1);
      expect(result.success).toBe(true);
    });
  });

  describe('Error path — capability rejection, no popup fallback', () => {
    it('should return failure hint when side panel not supported', () => {
      adapter.state.browserType = 'chrome';
      adapter.state.sidePanelSupported = false;

      const cap = sidebar.getCapability();
      expect(cap.supported).toBe(false);
      expect(cap.type).toBe('none');
      expect(cap.failureHint).toContain('not supported');
    });

    it('should return error message when open fails', async () => {
      adapter.state.browserType = 'chrome';
      adapter.state.sidePanelSupported = false;

      const result = await sidebar.openSidebar();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.message).toContain('not supported');
      }
    });

    it('should handle API rejection gracefully', async () => {
      adapter.state.browserType = 'chrome';
      adapter.state.sidePanelSupported = true;
      adapter.state.nextError = { code: 'BROWSER_API_ERROR', message: 'Side panel open failed' };

      const result = await sidebar.openSidebar();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.message).toContain('Failed to open sidebar');
      }
    });

    it('should NOT fallback to popup', async () => {
      adapter.state.browserType = 'chrome';
      adapter.state.sidePanelSupported = false;

      const result = await sidebar.openSidebar();
      expect(result.success).toBe(false);
      // No popup-related calls
      const popupCalls = adapter.calls.filter((c) => c.method.includes('popup'));
      expect(popupCalls).toHaveLength(0);
    });
  });
});
