export type UpdateCheckResult =
  | {
      status: 'latest';
      currentVersion: string;
      latestVersion: string;
    }
  | {
      status: 'available';
      currentVersion: string;
      latestVersion: string;
      releaseName: string;
      releaseUrl: string;
    }
  | {
      status: 'error';
      currentVersion: string;
      message: string;
    };

function parseVersion(version: string): number[] {
  const normalized = version.trim().replace(/^v/i, '').split('-', 1)[0];
  if (!/^\d+(\.\d+)*$/.test(normalized)) {
    throw new Error(`无效的版本号：${version}`);
  }
  return normalized.split('.').map(Number);
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function evaluateLatestRelease(currentVersion: string, release: unknown): UpdateCheckResult {
  if (
    typeof release !== 'object' ||
    release === null ||
    !('tag_name' in release) ||
    !('html_url' in release) ||
    typeof release.tag_name !== 'string' ||
    release.tag_name.trim() === '' ||
    typeof release.html_url !== 'string' ||
    !/^https:\/\/github\.com\/lvtian-bot\/InkMark\/releases\//i.test(release.html_url)
  ) {
    throw new Error('无效的 GitHub Release 数据');
  }

  const latestVersion = release.tag_name.replace(/^v/i, '');
  const releaseName = 'name' in release ? release.name : undefined;
  if (compareVersions(latestVersion, currentVersion) <= 0) {
    return { status: 'latest', currentVersion, latestVersion };
  }

  return {
    status: 'available',
    currentVersion,
    latestVersion,
    releaseName:
      typeof releaseName === 'string' && releaseName.trim() !== ''
        ? releaseName
        : `InkMark ${latestVersion}`,
    releaseUrl: release.html_url,
  };
}
