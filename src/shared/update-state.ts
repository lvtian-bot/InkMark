export type UpdateState =
  | { status: 'idle'; currentVersion: string }
  | { status: 'checking'; currentVersion: string }
  | { status: 'latest'; currentVersion: string; latestVersion: string }
  | {
      status: 'available';
      currentVersion: string;
      latestVersion: string;
      releaseName: string;
    }
  | {
      status: 'downloading';
      currentVersion: string;
      latestVersion: string;
      percent: number;
      transferred: number;
      total: number;
    }
  | { status: 'downloaded'; currentVersion: string; latestVersion: string }
  | { status: 'error'; currentVersion: string; message: string }
  | { status: 'unsupported'; currentVersion: string; message: string };
