import { useEffect } from 'react';
import { confirmDialog, isDialogOpen } from '../confirm-dialog';
import { t } from '../i18n';
import { getDiskSnapshot, setDiskSnapshot } from '../review/review-store';
import { useStore, type Tab } from '../stores/useStore';
import type { RecoveryDraft } from '../../../shared/draft-recovery';

let clearLiveDrafts: () => Promise<void> = async () => undefined;

export function clearRecoveryDraftsBeforeExit(): Promise<void> {
  return clearLiveDrafts();
}

export function useDraftRecovery(): void {
  useEffect(() => {
    let active = true;
    const ids = new Map<string, string>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const operations = new Map<string, Promise<void>>();
    let failureReported = false;
    let warningTimer: ReturnType<typeof setTimeout> | undefined;

    const reportSaveFailure = (): void => {
      if (!active || failureReported) return;
      if (isDialogOpen()) {
        if (!warningTimer)
          warningTimer = setTimeout(() => {
            warningTimer = undefined;
            reportSaveFailure();
          }, 500);
        return;
      }
      failureReported = true;
      void confirmDialog(t('confirm.saveFailed'), t('recovery.saveFailed'), [
        t('recovery.acknowledge'),
      ]);
    };

    const enqueue = (id: string, action: () => Promise<void>): void => {
      const previous = operations.get(id) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(action);
      operations.set(id, next);
      void next.catch(() => undefined);
    };

    const cancel = (tabId: string): void => {
      const timer = timers.get(tabId);
      if (timer) clearTimeout(timer);
      timers.delete(tabId);
    };

    const update = (tabs: Tab[], previousTabs: Tab[]): void => {
      const byId = new Map(tabs.map((tab) => [tab.id, tab]));
      for (const old of previousTabs) {
        if (!byId.has(old.id)) {
          cancel(old.id);
          const id = ids.get(old.id);
          if (id) enqueue(id, () => window.inkmark.removeRecoveryDraft(id));
          ids.delete(old.id);
        }
      }
      for (const tab of tabs) {
        const eligible =
          tab.isDirty && !tab.isStartPage && !tab.reviewSession && tab.pendingReviewCount === 0;
        if (!eligible) {
          cancel(tab.id);
          const id = ids.get(tab.id);
          if (id) {
            enqueue(id, () => window.inkmark.removeRecoveryDraft(id));
            ids.delete(tab.id);
          }
          continue;
        }
        if (!ids.has(tab.id)) ids.set(tab.id, crypto.randomUUID());
        if (timers.has(tab.id)) continue;
        const timer = setTimeout(() => {
          timers.delete(tab.id);
          const current = useStore.getState().tabs.find((item) => item.id === tab.id);
          const id = ids.get(tab.id);
          if (
            !current ||
            !id ||
            !current.isDirty ||
            current.reviewSession ||
            current.pendingReviewCount > 0
          )
            return;
          const baseline = getDiskSnapshot(current.id);
          const draft: RecoveryDraft = {
            id,
            filePath: current.filePath,
            fileMtime: current.fileMtime,
            baseContent: baseline?.content ?? null,
            content: current.sourceContent,
          };
          enqueue(id, async () => {
            try {
              await window.inkmark.saveRecoveryDraft(draft);
              failureReported = false;
              if (warningTimer) clearTimeout(warningTimer);
              warningTimer = undefined;
            } catch (error) {
              reportSaveFailure();
              throw error;
            }
          });
        }, 1000);
        timers.set(tab.id, timer);
      }
    };

    const unsubscribe = useStore.subscribe((state, previous) => update(state.tabs, previous.tabs));
    const clearOnExit = async (): Promise<void> => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const id of ids.values()) enqueue(id, () => window.inkmark.removeRecoveryDraft(id));
      ids.clear();
      await Promise.all(operations.values());
    };
    clearLiveDrafts = clearOnExit;
    update(useStore.getState().tabs, []);

    void (async () => {
      const drafts = await window.inkmark.listRecoveryDrafts();
      if (!active || drafts.length === 0) return;
      const choice = await confirmDialog(t('confirm.unsavedChanges'), t('recovery.found'), [
        t('recovery.restore'),
        t('recovery.later'),
      ]);
      if (!active || choice !== 0) return;
      for (const draft of drafts) {
        if (!active) return;
        let original: Awaited<ReturnType<typeof window.inkmark.openFilePath>> = null;
        if (draft.filePath) {
          try {
            original = await window.inkmark.openFilePath(draft.filePath);
          } catch {
            /* Restore as a new document. */
          }
        }
        if (!active) return;
        const file = original && !('status' in original) ? original : null;
        const alreadyOpen = useStore
          .getState()
          .tabs.some((tab) => tab.filePath === draft.filePath && draft.filePath !== null);
        const same =
          file &&
          !alreadyOpen &&
          draft.baseContent !== null &&
          file.mtime === draft.fileMtime &&
          file.content === draft.baseContent;
        if (file && !same && !alreadyOpen) {
          await confirmDialog(t('confirm.unsavedChanges'), t('recovery.changed'), [
            t('recovery.acknowledge'),
          ]);
          if (!active) return;
        }
        const tabId = useStore.getState().addTab({
          startPage: false,
          filePath: same ? file.path : null,
          fileMtime: same ? file.mtime : null,
          content: draft.content,
        });
        if (same) setDiskSnapshot(tabId, file.content, file.mtime);
        ids.set(tabId, draft.id);
        useStore.getState().updateTab(tabId, { isDirty: true });
      }
    })().catch(() => undefined);

    return () => {
      active = false;
      if (warningTimer) clearTimeout(warningTimer);
      if (clearLiveDrafts === clearOnExit) clearLiveDrafts = async () => undefined;
      unsubscribe();
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);
}
