export interface RecoveryDraft {
  id: string;
  filePath: string | null;
  fileMtime: number | null;
  baseContent: string | null;
  content: string;
}
