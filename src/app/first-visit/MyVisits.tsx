'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { localDb, type LocalInspection, type LocalAnswer } from '@/lib/firstVisit/db';
import { restoreFromCloud } from '@/lib/firstVisit/restore';
import { createHandlers } from '@/lib/firstVisit/handlers';
import { useSyncEngine } from '@/lib/firstVisit/useSyncEngine';
import { SyncBadge } from '@/components/firstVisit/SyncBadge';

type DealRow = { id: string; name?: string };

// One row per visit — every inspection, any inspector, draft or submitted.
// Visits are shared across staff, so the list hydrates from the hub on load
// (restoreFromCloud) and then renders from the local store; offline it simply
// shows whatever this device already has. Collapsing to one latest-per-deal
// row is exactly what hid a submitted visit behind a fresh empty draft in the
// 2026-07-09 "my data disappeared" incident — never again.
type Row = {
  deal_id: string;
  deal_name?: string;
  inspection: LocalInspection;
  lastActivity: string; // ISO
};

async function latestAnswerTs(inspectionId: string): Promise<string | null> {
  const rows: LocalAnswer[] = await localDb.answers
    .where('inspection_id')
    .equals(inspectionId)
    .toArray();
  if (rows.length === 0) return null;
  return rows.reduce((acc, r) => (r.updated_at > acc ? r.updated_at : acc), '');
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const opts: Intl.DateTimeFormatOptions = sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' };
  return d.toLocaleString(undefined, opts);
}

export default function MyVisits() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [offline, setOffline] = useState(false);
  // Full engine, not a one-shot drain: jobs enqueued elsewhere (DealPicker's
  // inspection_upsert, deletes made in the navigator) used to sit until a
  // survey opened; the engine's on-mount drain + 30 s interval + focus/online
  // triggers retry them from the list too. drainOutbox is single-flight, so
  // this second engine can't double-drain against an open navigator.
  const handlers = useMemo(() => createHandlers(), []);
  const { pending, stuck, lastError, syncNow } = useSyncEngine(handlers);

  const load = useCallback(async () => {
    // Hydrate from the hub first so this device has every staff visit, then
    // render from the local store. Hydration failing (offline, expired
    // session) is fine — we fall back to what's already on the device.
    const hydrated = await restoreFromCloud().then(
      () => true,
      () => false,
    );
    setOffline(!hydrated);

    const [insps, dealsRes] = await Promise.all([
      localDb.inspections.toArray(),
      fetch('/api/first-visit/deals')
        .then((r) => (r.ok ? r.json() : { deals: [] }))
        .catch(() => ({ deals: [] })),
    ]);
    const deals: DealRow[] = dealsRes.deals ?? [];
    const dealNameById = new Map(deals.map((d) => [d.id, d.name]));

    const out: Row[] = await Promise.all(
      insps
        .filter((i) => i.status !== 'discarded')
        .map(async (inspection) => {
          const answersTs = await latestAnswerTs(inspection.id);
          const lastActivity =
            answersTs ?? inspection.submitted_at ?? inspection.started_at;
          return {
            deal_id: inspection.deal_id,
            deal_name: dealNameById.get(inspection.deal_id),
            inspection,
            lastActivity,
          };
        }),
    );
    out.sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1));
    setRows(out);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (rows === null) {
    return <p className="mt-2 text-sm text-gray-500">Loading…</p>;
  }
  return (
    <div className="mt-2">
      <div className="mb-2 flex justify-end">
        <SyncBadge pending={pending} stuck={stuck} lastError={lastError} onRetry={syncNow} />
      </div>
      {offline && (
        <p className="mb-2 text-xs text-amber-600">
          Couldn’t reach the hub — showing visits stored on this device.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No visits yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.inspection.id}
              className="rounded border border-gray-200 p-3 hover:bg-gray-50"
            >
              <Link
                href={`/first-visit/${r.deal_id}/${r.inspection.id}`}
                className="block"
              >
                <div className="text-sm font-medium">
                  {r.deal_name ?? `Deal ${r.deal_id.slice(0, 8)}…`}
                </div>
                <div className="text-xs text-gray-500">
                  {r.inspection.status}
                  {r.inspection.inspector_email
                    ? ` · ${r.inspection.inspector_email}`
                    : ''}
                  {' · last activity '}
                  {formatWhen(r.lastActivity)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
