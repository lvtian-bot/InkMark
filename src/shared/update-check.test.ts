import { describe, expect, it } from 'vitest';
import { evaluateLatestRelease } from './update-check';

describe('evaluateLatestRelease', () => {
  it('reports a newer stable release as available', () => {
    expect(
      evaluateLatestRelease('0.0.9', {
        tag_name: 'v0.1.0',
        html_url: 'https://github.com/lvtian-bot/InkMark/releases/tag/v0.1.0',
        name: 'InkMark 0.1.0',
      }),
    ).toEqual({
      status: 'available',
      currentVersion: '0.0.9',
      latestVersion: '0.1.0',
      releaseName: 'InkMark 0.1.0',
      releaseUrl: 'https://github.com/lvtian-bot/InkMark/releases/tag/v0.1.0',
    });
  });

  it('reports the current version as latest when tags are equal', () => {
    expect(
      evaluateLatestRelease('0.0.9', {
        tag_name: 'v0.0.9',
        html_url: 'https://github.com/lvtian-bot/InkMark/releases/tag/v0.0.9',
      }),
    ).toEqual({
      status: 'latest',
      currentVersion: '0.0.9',
      latestVersion: '0.0.9',
    });
  });

  it('rejects malformed release data instead of claiming the app is current', () => {
    expect(() => evaluateLatestRelease('0.0.9', { tag_name: '', html_url: '' })).toThrow(
      '无效的 GitHub Release 数据',
    );
  });
});
