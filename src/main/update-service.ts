import type { UpdateState } from '../shared/update-state';
import type { MessageKey } from '../shared/i18n';
import type { Translate } from './image-storage';

interface UpdateInfo {
  version: string;
  releaseName?: string | null;
}

interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
}

type UpdateEvent =
  'update-available' | 'update-not-available' | 'download-progress' | 'update-downloaded' | 'error';

export interface UpdateAdapter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: () => void;
  on: (event: UpdateEvent, listener: (payload?: unknown) => void) => void;
}

interface CreateUpdateServiceOptions {
  adapter: UpdateAdapter;
  currentVersion: string;
  supported: boolean;
  t: Translate;
  onStateChange?: (state: UpdateState) => void;
}

export interface UpdateService {
  getState: () => UpdateState;
  check: () => Promise<UpdateState>;
  download: () => Promise<UpdateState>;
  install: () => boolean;
}

function asUpdateInfo(payload: unknown): UpdateInfo | null {
  if (typeof payload !== 'object' || payload === null || !('version' in payload)) return null;
  const version = payload.version;
  if (typeof version !== 'string' || version.trim() === '') return null;
  const releaseName = 'releaseName' in payload ? payload.releaseName : undefined;
  return {
    version,
    releaseName: typeof releaseName === 'string' ? releaseName : undefined,
  };
}

function asProgress(payload: unknown): DownloadProgress | null {
  if (typeof payload !== 'object' || payload === null) return null;
  if (!('percent' in payload) || !('transferred' in payload) || !('total' in payload)) return null;
  const { percent, transferred, total } = payload;
  if (typeof percent !== 'number' || typeof transferred !== 'number' || typeof total !== 'number') {
    return null;
  }
  return {
    percent: Math.min(100, Math.max(0, percent)),
    transferred: Math.max(0, transferred),
    total: Math.max(0, total),
  };
}

function errorKey(payload: unknown): MessageKey {
  const message = payload instanceof Error ? payload.message : '';
  if (/checksum|sha512|signature|integrity/i.test(message)) return 'update.errorChecksum';
  if (/network|fetch|connect|timeout|ENOTFOUND|ECONN/i.test(message)) {
    return 'update.errorNetwork';
  }
  return 'update.errorGeneric';
}

export function createUpdateService(options: CreateUpdateServiceOptions): UpdateService {
  const { adapter, currentVersion, supported, t, onStateChange } = options;
  adapter.autoDownload = false;
  adapter.autoInstallOnAppQuit = false;

  let state: UpdateState = supported
    ? { status: 'idle', currentVersion }
    : { status: 'unsupported', currentVersion, message: t('update.unsupportedMessage') };
  let checkPromise: Promise<UpdateState> | null = null;
  let resolveCheck: ((next: UpdateState) => void) | null = null;
  let downloadPromise: Promise<UpdateState> | null = null;
  let resolveDownload: ((next: UpdateState) => void) | null = null;
  let latestVersion = currentVersion;

  const setState = (next: UpdateState): void => {
    state = next;
    onStateChange?.(next);
  };
  const finishCheck = (next: UpdateState): void => {
    setState(next);
    resolveCheck?.(next);
    resolveCheck = null;
    checkPromise = null;
  };
  const finishDownload = (next: UpdateState): void => {
    setState(next);
    resolveDownload?.(next);
    resolveDownload = null;
    downloadPromise = null;
  };

  adapter.on('update-available', (payload) => {
    const info = asUpdateInfo(payload);
    if (!info) return;
    latestVersion = info.version;
    finishCheck({
      status: 'available',
      currentVersion,
      latestVersion,
      releaseName: info.releaseName?.trim() || `InkMark ${latestVersion}`,
    });
  });
  adapter.on('update-not-available', (payload) => {
    const info = asUpdateInfo(payload);
    finishCheck({
      status: 'latest',
      currentVersion,
      latestVersion: info?.version ?? currentVersion,
    });
  });
  adapter.on('download-progress', (payload) => {
    const progress = asProgress(payload);
    if (!progress) return;
    setState({ status: 'downloading', currentVersion, latestVersion, ...progress });
  });
  adapter.on('update-downloaded', (payload) => {
    const info = asUpdateInfo(payload);
    if (info) latestVersion = info.version;
    finishDownload({ status: 'downloaded', currentVersion, latestVersion });
  });
  adapter.on('error', (payload) => {
    const next: UpdateState = {
      status: 'error',
      currentVersion,
      message: t(errorKey(payload)),
    };
    if (downloadPromise) finishDownload(next);
    else finishCheck(next);
  });

  return {
    getState: () => state,
    check: async () => {
      if (!supported) return state;
      if (checkPromise) return checkPromise;
      if (state.status === 'downloading' || state.status === 'downloaded') return state;

      setState({ status: 'checking', currentVersion });
      checkPromise = new Promise<UpdateState>((resolve) => {
        resolveCheck = resolve;
      });
      void adapter.checkForUpdates().catch((error: unknown) => {
        finishCheck({ status: 'error', currentVersion, message: t(errorKey(error)) });
      });
      return checkPromise;
    },
    download: async () => {
      if (!supported || state.status !== 'available') return state;
      if (downloadPromise) return downloadPromise;

      setState({
        status: 'downloading',
        currentVersion,
        latestVersion,
        percent: 0,
        transferred: 0,
        total: 0,
      });
      downloadPromise = new Promise<UpdateState>((resolve) => {
        resolveDownload = resolve;
      });
      void adapter.downloadUpdate().catch((error: unknown) => {
        finishDownload({ status: 'error', currentVersion, message: t(errorKey(error)) });
      });
      return downloadPromise;
    },
    install: () => {
      if (state.status !== 'downloaded') return false;
      try {
        adapter.quitAndInstall();
        return true;
      } catch {
        setState({
          status: 'error',
          currentVersion,
          message: t('update.errorInstall'),
        });
        return false;
      }
    },
  };
}
