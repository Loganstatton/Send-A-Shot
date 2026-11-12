export type SnapshotQueryable = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};
export const FORMAT: string;
export function exportSnapshot(q: SnapshotQueryable): Promise<{ data: Buffer; rowCount: number }>;
export function restoreSnapshot(
  q: SnapshotQueryable,
  buffer: Buffer
): Promise<{ rowCount: number; tableCount: number; skippedTables: string[]; snapshotCreatedAt: string }>;
export function parseSnapshot(buffer: Buffer): { format: string; created_at: string; migrations: string[]; tables: Record<string, any[]> };
