import { localDb } from './db';
import { enqueue } from './sync';
import { restoreFromCloud } from './restore';
import { pickCanonicalInspection } from './canonicalInspection';
import { track } from './analytics';

// Each deal has exactly ONE shared inspection across all staff (2026-07-09
// decision — 13 dupes on one prod deal came from resolving against local Dexie
// only). Resolution order:
//   1. Best-effort hub hydration (restoreFromCloud) so a cold/evicted/second
//      device and a deep-linked /first-visit/new see every hub visit WITH its
//      targets and answers — offline, the throw is swallowed and we resolve
//      against whatever this device already has.
//   2. Pick the canonical non-discarded inspection for the deal (submitted >
//      draft, then earliest started_at, then lowest id) — deterministic on
//      every device, tolerant of pre-cleanup duplicates. Submitted visits are
//      REOPENABLE: selecting the deal resumes them for editing.
//   3. Create only when hub AND local have none. A simultaneous create on two
//      devices can still race; the canonical rule reconverges every later
//      selection onto one winner and the loser is cleaned up out-of-band.
export async function resumeOrStartVisit(
  dealId: string,
): Promise<{ id: string; resumed: boolean }> {
  await restoreFromCloud().catch(() => {}); // offline / expired session → local-only
  const existing = await localDb.inspections.where('deal_id').equals(dealId).toArray();
  const canonical = pickCanonicalInspection(existing);
  if (canonical) return { id: canonical.id, resumed: true };

  const id = crypto.randomUUID();
  const inspection = {
    id,
    deal_id: dealId,
    status: 'draft' as const,
    inspector_email: '', // filled server-side from session
    started_at: new Date().toISOString(),
  };
  await localDb.inspections.put(inspection);
  await enqueue('inspection_upsert', inspection);
  track('first_visit_started', { inspection_id: id, deal_id: dealId });
  return { id, resumed: false };
}
