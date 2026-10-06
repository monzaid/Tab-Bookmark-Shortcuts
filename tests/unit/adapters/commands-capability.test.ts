/**
 * T15 — `commands.update` and the Chrome/Edge capability difference (D4).
 *
 * Firefox exposes `commands.update`, so the shortcut dimension can be applied
 * automatically. Chrome/Edge do NOT, so that dimension is read-only there: the
 * UI shows the difference and guides a manual set-up, and the dimension offers
 * no overwrite mode (there is nothing to execute).
 *
 * The whole point (D4): an unsupported capability is reported AS a capability
 * gap — it must NOT surface as an import failure. `updateSupported()` lets the
 * UI branch without a try/catch; `update()` still throws a recognisable
 * `AdapterError` if called anyway.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMockAdapter } from '@adapters/mock-adapter';
import { createChromeAdapter } from '@adapters/chrome-adapter';
import { AdapterError } from '@adapters/contract';

describe('T15 — commands.update capability (Firefox vs Chrome/Edge)', () => {
  describe('Firefox: automatically applied', () => {
    it('reports the capability and applies the shortcut, recording the call', async () => {
      const adapter = createMockAdapter({ browserType: 'firefox' });

      expect(adapter.commands.updateSupported()).toBe(true);
      await adapter.commands.update('save-slot-1', 'Alt+1');

      expect(adapter.calls.some((c) => c.method === 'commands.update')).toBe(true);
    });

    it('resolves (a supported update is never a failure)', async () => {
      const adapter = createMockAdapter({ browserType: 'firefox' });
      await expect(adapter.commands.update('save-slot-1', 'Alt+1')).resolves.toBeUndefined();
    });
  });

  describe('Chrome/Edge: read-only', () => {
    it('reports unsupported for both', () => {
      expect(createMockAdapter({ browserType: 'chrome' }).commands.updateSupported()).toBe(false);
      expect(createMockAdapter({ browserType: 'edge' }).commands.updateSupported()).toBe(false);
    });

    it('update rejects with a recognisable AdapterError (not treated as an import failure)', async () => {
      const adapter = createMockAdapter({ browserType: 'chrome' });
      await expect(adapter.commands.update('save-slot-1', 'Alt+1')).rejects.toBeInstanceOf(AdapterError);
      // The capability probe is what drives the UI branch, so the caller never
      // has to interpret this rejection as "the import failed".
      expect(adapter.commands.updateSupported()).toBe(false);
    });
  });

  describe('the real chrome-adapter honours the browser type', () => {
    it('updateSupported() is true only for firefox', () => {
      expect(createChromeAdapter('firefox').commands.updateSupported()).toBe(true);
      expect(createChromeAdapter('chrome').commands.updateSupported()).toBe(false);
      expect(createChromeAdapter('edge').commands.updateSupported()).toBe(false);
    });

    it('chrome/edge update rejects without calling a browser API', async () => {
      const adapter = createChromeAdapter('edge');
      await expect(adapter.commands.update('save-slot-1', 'Alt+1')).rejects.toBeInstanceOf(AdapterError);
    });
  });

  describe('injectable capability (mock)', () => {
    it('can force unsupported even on firefox', async () => {
      const adapter = createMockAdapter({ browserType: 'firefox', commandsUpdateSupported: false });

      expect(adapter.commands.updateSupported()).toBe(false);
      await expect(adapter.commands.update('save-slot-1', 'Alt+1')).rejects.toBeInstanceOf(AdapterError);
    });

    it('reset() clears the override so it cannot leak into the next case (T15-A)', () => {
      // The leak repro: force it TRUE, then reset — the browser goes back to
      // chrome, so a surviving `true` would wrongly advertise the capability.
      const adapter = createMockAdapter({ browserType: 'chrome', commandsUpdateSupported: true });
      expect(adapter.commands.updateSupported()).toBe(true);

      adapter.reset();

      expect(adapter.state.commandsUpdateSupported).toBeUndefined();
      // chrome has no commands.update ⇒ false. A leaked `true` fails here.
      expect(adapter.commands.updateSupported()).toBe(false);
    });
  });

  describe('the null unbind value is normalised to "" (MDN, T15-B)', () => {
    it('mock stores "" rather than null', async () => {
      const adapter = createMockAdapter({ browserType: 'firefox' });
      await adapter.commands.update('save-slot-1', null);

      expect(adapter.state.commands.find((c) => c.name === 'save-slot-1')?.shortcut).toBe('');
    });

    it('the real chrome-adapter forwards "" to the browser API', async () => {
      const update = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('chrome', { commands: { update } });

      await createChromeAdapter('firefox').commands.update('save-slot-1', null);

      expect(update).toHaveBeenCalledWith({ name: 'save-slot-1', shortcut: '' });
      vi.unstubAllGlobals();
    });
  });
});