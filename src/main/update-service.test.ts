import { describe, expect, it, vi } from 'vitest';
import { createUpdateService, type UpdateAdapter } from './update-service';
import type { MessageKey } from '../shared/i18n';

const t = (key: MessageKey): string => key;

function createAdapter(): UpdateAdapter & {
  emit: (event: string, payload?: unknown) => void;
} {
  const listeners = new Map<string, Array<(payload?: unknown) => void>>();
  return {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
    on: (event, listener) => {
      const current = listeners.get(event) ?? [];
      current.push(listener);
      listeners.set(event, current);
    },
    emit: (event, payload) => {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
  };
}

describe('update service', () => {
  it('checks manually without automatically downloading an available update', async () => {
    const adapter = createAdapter();
    const service = createUpdateService({ adapter, currentVersion: '0.1.0', supported: true, t });

    const pending = service.check();
    adapter.emit('update-available', { version: '0.2.0', releaseName: 'InkMark 0.2.0' });
    await pending;

    expect(service.getState()).toEqual({
      status: 'available',
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      releaseName: 'InkMark 0.2.0',
    });
    expect(adapter.downloadUpdate).not.toHaveBeenCalled();
    expect(adapter.autoDownload).toBe(false);
    expect(adapter.autoInstallOnAppQuit).toBe(false);
  });

  it('deduplicates repeated checks while one check is active', async () => {
    const adapter = createAdapter();
    const service = createUpdateService({ adapter, currentVersion: '0.1.0', supported: true, t });

    const first = service.check();
    const second = service.check();
    adapter.emit('update-not-available', { version: '0.1.0' });
    await Promise.all([first, second]);

    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('installs only after an update has finished downloading', async () => {
    const adapter = createAdapter();
    const service = createUpdateService({ adapter, currentVersion: '0.1.0', supported: true, t });

    expect(service.install()).toBe(false);
    adapter.emit('update-available', { version: '0.2.0' });
    adapter.emit('update-downloaded', { version: '0.2.0' });

    expect(service.install()).toBe(true);
    expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('reports a failed installer launch without claiming installation started', () => {
    const adapter = createAdapter();
    adapter.quitAndInstall = vi.fn(() => {
      throw new Error('installer launch failed');
    });
    const service = createUpdateService({ adapter, currentVersion: '0.1.0', supported: true, t });
    adapter.emit('update-downloaded', { version: '0.2.0' });

    expect(service.install()).toBe(false);
    expect(service.getState()).toEqual({
      status: 'error',
      currentVersion: '0.1.0',
      message: 'update.errorInstall',
    });
  });

  it('does not invoke the adapter in unsupported builds', async () => {
    const adapter = createAdapter();
    const service = createUpdateService({ adapter, currentVersion: '0.1.0', supported: false, t });

    await service.check();
    await service.download();

    expect(service.getState().status).toBe('unsupported');
    expect(adapter.checkForUpdates).not.toHaveBeenCalled();
    expect(adapter.downloadUpdate).not.toHaveBeenCalled();
  });
});
