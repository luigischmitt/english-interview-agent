import type { PracticeGroup } from "./practice-store";

type SyncResult =
  | { ok: true; value: { themes: PracticeGroup[]; remaining: boolean } }
  | { ok: false; message: string };

export function syncPracticeGroupsUntilDone(
  themes: PracticeGroup[],
  options: {
    maxBatches: number;
    sync: (themes: PracticeGroup[]) => Promise<SyncResult>;
    onBatch?: (result: SyncResult, batch: number) => void;
    shouldContinue?: () => boolean;
  },
): Promise<void>;
