import { diffLines } from 'diff';

export interface ConflictDiffPart {
  kind: 'added' | 'removed' | 'unchanged';
  value: string;
}

export function buildConflictDiff(
  diskMarkdown: string,
  currentMarkdown: string,
): ConflictDiffPart[] {
  return diffLines(diskMarkdown, currentMarkdown).map((part) => ({
    kind: part.added ? 'added' : part.removed ? 'removed' : 'unchanged',
    value: part.value,
  }));
}
