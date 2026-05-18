import { readJsonIfExists, writeJson } from "./session";

export type Snapshot = {
  time: string;
  last_price?: number;
  oi?: number;
  average_price?: number;
};

export type SnapshotsDb = Record<string, Snapshot>; // key: EXCHANGE:TRADINGSYMBOL

const DEFAULT_PATH = "data/snapshots.json";

export async function readSnapshots(path = DEFAULT_PATH): Promise<SnapshotsDb> {
  return (await readJsonIfExists<SnapshotsDb>(path)) ?? {};
}

export async function writeSnapshots(db: SnapshotsDb, path = DEFAULT_PATH): Promise<void> {
  await writeJson(path, db);
}

export function upsertSnapshot(db: SnapshotsDb, key: string, snap: Snapshot): SnapshotsDb {
  return { ...db, [key]: snap };
}
