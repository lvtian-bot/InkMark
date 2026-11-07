import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { RecoveryDraft } from '../shared/draft-recovery';

const MAX_DRAFT_BYTES = 20 * 1024 * 1024;
const VALID_ID = /^[a-zA-Z0-9-]{1,100}$/;

function isDraft(value: unknown): value is RecoveryDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.id === 'string' &&
    VALID_ID.test(draft.id) &&
    (draft.filePath === null || typeof draft.filePath === 'string') &&
    (draft.fileMtime === null ||
      (typeof draft.fileMtime === 'number' && Number.isFinite(draft.fileMtime))) &&
    (draft.baseContent === null ||
      (typeof draft.baseContent === 'string' &&
        Buffer.byteLength(draft.baseContent, 'utf8') <= MAX_DRAFT_BYTES)) &&
    typeof draft.content === 'string' &&
    Buffer.byteLength(draft.content, 'utf8') <= MAX_DRAFT_BYTES
  );
}

export function createDraftRecovery(directory: string) {
  function pathFor(id: string): string {
    if (!VALID_ID.test(id)) throw new Error('Invalid draft identifier');
    return join(directory, `${id}.json`);
  }

  return {
    save(value: unknown): void {
      if (!isDraft(value)) throw new Error('Invalid recovery draft');
      mkdirSync(directory, { recursive: true });
      const target = pathFor(value.id);
      const temporary = join(directory, `${randomUUID()}.tmp`);
      try {
        writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
        renameSync(temporary, target);
      } finally {
        try {
          unlinkSync(temporary);
        } catch {
          /* Already moved or never created. */
        }
      }
    },
    remove(id: string): void {
      try {
        unlinkSync(pathFor(id));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },
    list(): RecoveryDraft[] {
      let entries: string[];
      try {
        entries = readdirSync(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
      const drafts: RecoveryDraft[] = [];
      for (const entry of entries) {
        if (!entry.endsWith('.json') || !VALID_ID.test(entry.slice(0, -5))) continue;
        try {
          const value: unknown = JSON.parse(readFileSync(join(directory, entry), 'utf8'));
          if (isDraft(value) && `${value.id}.json` === entry) drafts.push(value);
        } catch {
          /* Preserve unreadable files for manual recovery. */
        }
      }
      return drafts;
    },
  };
}
