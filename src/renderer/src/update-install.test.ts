import { describe, expect, it, vi } from 'vitest';
import { requestUpdateInstall } from './update-install';

describe('requestUpdateInstall', () => {
  it('does not install when document close protection is cancelled', async () => {
    const prepareToClose = vi.fn(async () => false);
    const install = vi.fn(async () => true);
    const resumeRecoveryDrafts = vi.fn();

    expect(await requestUpdateInstall({ prepareToClose, install, resumeRecoveryDrafts })).toBe(
      false,
    );
    expect(install).not.toHaveBeenCalled();
    expect(resumeRecoveryDrafts).not.toHaveBeenCalled();
  });

  it('installs once after document close protection succeeds', async () => {
    const prepareToClose = vi.fn(async () => true);
    const install = vi.fn(async () => true);
    const resumeRecoveryDrafts = vi.fn();

    expect(await requestUpdateInstall({ prepareToClose, install, resumeRecoveryDrafts })).toBe(
      true,
    );
    expect(install).toHaveBeenCalledTimes(1);
    expect(resumeRecoveryDrafts).not.toHaveBeenCalled();
  });

  it('安装未启动或抛错时恢复草稿保护', async () => {
    const prepareToClose = vi.fn(async () => true);
    const resumeRecoveryDrafts = vi.fn();
    expect(
      await requestUpdateInstall({
        prepareToClose,
        install: async () => false,
        resumeRecoveryDrafts,
      }),
    ).toBe(false);
    expect(resumeRecoveryDrafts).toHaveBeenCalledTimes(1);
    await expect(
      requestUpdateInstall({
        prepareToClose,
        install: async () => {
          throw new Error('failed');
        },
        resumeRecoveryDrafts,
      }),
    ).rejects.toThrow('failed');
    expect(resumeRecoveryDrafts).toHaveBeenCalledTimes(2);
  });
});
