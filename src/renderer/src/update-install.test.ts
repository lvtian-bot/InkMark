import { describe, expect, it, vi } from 'vitest';
import { requestUpdateInstall } from './update-install';

describe('requestUpdateInstall', () => {
  it('does not install when document close protection is cancelled', async () => {
    const prepareToClose = vi.fn(async () => false);
    const install = vi.fn(async () => true);

    expect(await requestUpdateInstall({ prepareToClose, install })).toBe(false);
    expect(install).not.toHaveBeenCalled();
  });

  it('installs once after document close protection succeeds', async () => {
    const prepareToClose = vi.fn(async () => true);
    const install = vi.fn(async () => true);

    expect(await requestUpdateInstall({ prepareToClose, install })).toBe(true);
    expect(install).toHaveBeenCalledTimes(1);
  });
});
