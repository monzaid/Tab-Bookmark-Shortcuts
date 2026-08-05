import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock chrome.runtime before importing content script
const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockAddListener = vi.fn();

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: { addListener: mockAddListener },
  },
});

// Mock window.location
const mockLocation = { href: 'https://example.com/page' };
vi.stubGlobal('window', {
  location: mockLocation,
  addEventListener: vi.fn(),
});

// Mock document with full API surface needed by content script
const mockTitle = { value: '' };
const mockHeadAppendChild = vi.fn();
const mockQuerySelectorAll = vi.fn().mockReturnValue([]);
const mockQuerySelector = vi.fn().mockReturnValue(null);
const mockCreateElement = vi.fn().mockReturnValue({ rel: '', href: '', type: '' });
const mockDocAddEventListener = vi.fn();

vi.stubGlobal('document', {
  get title() { return mockTitle.value; },
  set title(v: string) { mockTitle.value = v; },
  head: { appendChild: mockHeadAppendChild },
  querySelector: mockQuerySelector,
  querySelectorAll: mockQuerySelectorAll,
  createElement: mockCreateElement,
  addEventListener: mockDocAddEventListener,
  readyState: 'loading',
});

// Mock history
const mockHistory = {
  pushState: vi.fn(),
  replaceState: vi.fn(),
};
vi.stubGlobal('history', mockHistory);

describe('T11: Content script — document_start, single rewrite protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation.href = 'https://example.com/page';
    mockTitle.value = '';
    mockQuerySelectorAll.mockReturnValue([]);
    mockQuerySelector.mockReturnValue(null);
  });

  describe('Happy path — navigation reporting and rewrite', () => {
    it('should report initial navigation once per URL', async () => {
      const { reportNavigation, reportedUrls } = await import('@content/index');
      reportedUrls.clear();
      mockSendMessage.mockClear();

      reportNavigation('initial');
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CONTENT_NAVIGATION',
          payload: expect.objectContaining({
            url: 'https://example.com/page',
            navigationType: 'initial',
          }),
        })
      );

      // Second call with same URL should not report again
      reportNavigation('initial');
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    it('should report different URLs separately', async () => {
      const { reportNavigation, reportedUrls } = await import('@content/index');
      reportedUrls.clear();

      reportNavigation('initial');
      mockLocation.href = 'https://example.com/other';
      reportNavigation('pushstate');

      expect(mockSendMessage).toHaveBeenCalledTimes(2);
    });

    it('should apply title and favicon rewrite once per URL', async () => {
      const { applyRewrite, appliedUrls } = await import('@content/index');
      appliedUrls.clear();

      applyRewrite('Custom Title', 'https://example.com/icon.png');
      expect(mockTitle.value).toBe('Custom Title');

      // Second apply should be ignored (once per URL)
      applyRewrite('Another Title', 'https://other.com/icon.png');
      expect(mockTitle.value).toBe('Custom Title'); // unchanged
    });

    it('should handle APPLY_REWRITE message', async () => {
      const { handleMessage, appliedUrls } = await import('@content/index');
      appliedUrls.clear();

      handleMessage({
        type: 'APPLY_REWRITE',
        payload: { title: 'Message Title', favicon: 'https://example.com/fav.ico' },
      });

      expect(mockTitle.value).toBe('Message Title');
    });

    it('should allow forced re-application bypassing once-per-URL (Problem 3)', async () => {
      const { applyRewrite, appliedUrls } = await import('@content/index');
      appliedUrls.clear();
      mockLocation.href = 'https://example.com/page';

      // First apply
      applyRewrite('First Title');
      expect(mockTitle.value).toBe('First Title');

      // Normal second apply is blocked
      applyRewrite('Second Title');
      expect(mockTitle.value).toBe('First Title');

      // Forced apply bypasses the once-per-URL guard
      applyRewrite('Forced Title', undefined, true);
      expect(mockTitle.value).toBe('Forced Title');
    });

    it('should handle APPLY_REWRITE with force flag (Problem 3)', async () => {
      const { handleMessage, appliedUrls } = await import('@content/index');
      appliedUrls.clear();
      mockLocation.href = 'https://example.com/force-test';

      handleMessage({
        type: 'APPLY_REWRITE',
        payload: { title: 'Initial' },
      });
      expect(mockTitle.value).toBe('Initial');

      handleMessage({
        type: 'APPLY_REWRITE',
        payload: { title: 'Updated', force: true },
      });
      expect(mockTitle.value).toBe('Updated');
    });

    it('should remove all existing favicon links and create new one', async () => {
      const { applyRewrite, appliedUrls } = await import('@content/index');
      appliedUrls.clear();
      mockLocation.href = 'https://example.com/favicon-test';

      const mockOldLink1 = { remove: vi.fn() };
      const mockOldLink2 = { remove: vi.fn() };
      mockQuerySelectorAll.mockReturnValue([mockOldLink1, mockOldLink2]);

      applyRewrite(undefined, 'data:image/png;base64,abc123');

      // Should remove all old links
      expect(mockQuerySelectorAll).toHaveBeenCalledWith('link[rel*="icon"]');
      expect(mockOldLink1.remove).toHaveBeenCalled();
      expect(mockOldLink2.remove).toHaveBeenCalled();

      // Should create new link
      expect(mockCreateElement).toHaveBeenCalledWith('link');
      expect(mockHeadAppendChild).toHaveBeenCalled();
    });
  });

  describe('Error path — protected URLs and invalid messages', () => {
    it('should not report navigation for protected URLs', async () => {
      const { reportNavigation, reportedUrls } = await import('@content/index');
      reportedUrls.clear();
      mockLocation.href = 'chrome://settings';

      reportNavigation('initial');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('should not apply rewrite to protected URLs', async () => {
      const { applyRewrite, appliedUrls } = await import('@content/index');
      appliedUrls.clear();
      mockLocation.href = 'chrome://extensions';

      applyRewrite('Hacked Title');
      expect(mockTitle.value).toBe(''); // unchanged
    });

    it('should ignore invalid messages', async () => {
      const { handleMessage, appliedUrls } = await import('@content/index');
      appliedUrls.clear();

      handleMessage(null);
      handleMessage(undefined);
      handleMessage('string');
      handleMessage({ type: 'UNKNOWN_TYPE' });

      expect(mockTitle.value).toBe(''); // no changes
    });

    it('should not access document body', async () => {
      const { applyRewrite, appliedUrls } = await import('@content/index');
      appliedUrls.clear();
      mockLocation.href = 'https://safe.com/page';

      applyRewrite('Title Only');
      expect(mockTitle.value).toBe('Title Only');
    });
  });
});
