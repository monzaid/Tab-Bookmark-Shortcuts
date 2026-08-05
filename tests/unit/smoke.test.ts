import { describe, it, expect } from 'vitest';

describe('Test infrastructure smoke', () => {
  it('should run a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('should have chrome mock available', () => {
    expect(chrome).toBeDefined();
    expect(chrome.storage).toBeDefined();
    expect(chrome.tabs).toBeDefined();
    expect(chrome.windows).toBeDefined();
    expect(chrome.commands).toBeDefined();
    expect(chrome.runtime).toBeDefined();
  });

  it('should have storage mock functional', async () => {
    await chrome.storage.sync.set({ testKey: 'testValue' });
    const result = await chrome.storage.sync.get('testKey');
    expect(result).toEqual({ testKey: 'testValue' });
  });
});
