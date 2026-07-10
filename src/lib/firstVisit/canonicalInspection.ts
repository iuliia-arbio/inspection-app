// The ONE shared visit per deal: every device must resolve the same inspection
// for a deal, deterministically, even while prod still holds pre-cleanup
// duplicates. Rule: submitted beats draft (a submitted visit holds the real
// data), then earliest started_at (dupes are later cold-device re-creations),
// then lowest id as a total-order tiebreak. Discarded rows never win.
export function pickCanonicalInspection<
  T extends { id: string; status: 'draft' | 'submitted' | 'discarded'; started_at: string },
>(inspections: T[]): T | undefined {
  return inspections
    .filter((i) => i.status !== 'discarded')
    .sort(
      (a, b) =>
        (a.status === 'submitted' ? 0 : 1) - (b.status === 'submitted' ? 0 : 1) ||
        a.started_at.localeCompare(b.started_at) ||
        a.id.localeCompare(b.id),
    )[0];
}
