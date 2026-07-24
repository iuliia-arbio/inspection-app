'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { track } from '@/lib/firstVisit/analytics';
import { resumeOrStartVisit } from '@/lib/firstVisit/resumeOrStartVisit';

export default function DealPicker({ deals }: { deals: { id: string; name: string }[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [formType, setFormType] = useState<'care' | 'greenfield'>('care');
  const [submitting, setSubmitting] = useState(false);
  const [picking, setPicking] = useState<string | null>(null); // deal id being resolved
  const [dealSearch, setDealSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pickDeal = async (dealId: string, created: boolean) => {
    setPicking(dealId);
    setError(null);
    try {
      const { id, resumed } = await resumeOrStartVisit(dealId);
      track('deal_selected', { deal_id: dealId, created, resumed });
      router.push(`/first-visit/${dealId}/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e; // let the create path reset its own submitting state
    } finally {
      setPicking(null);
    }
  };

  const create = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/first-visit/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), form_type: formType }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const { deal } = await res.json();
      await pickDeal(deal.id, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  const filteredDeals = dealSearch.trim()
    ? deals.filter((d) => d.name.toLowerCase().includes(dealSearch.toLowerCase()))
    : deals;

  return (
    <div className="mt-4 flex flex-col gap-4">
      {error && !creating && <p className="text-xs text-red-600">{error}</p>}
      {deals.length === 0 ? (
        <p className="text-sm text-gray-500">No existing deals (or offline).</p>
      ) : (
        <>
          {deals.length > 5 && (
            <input
              type="text"
              value={dealSearch}
              onChange={(e) => setDealSearch(e.target.value)}
              placeholder="Search deals…"
              className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
            />
          )}
          <ul className="flex flex-col gap-2">
            {filteredDeals.length === 0 && dealSearch.trim() ? (
              <li className="px-1 py-2 text-sm text-gray-400">
                No deals matching &ldquo;{dealSearch.trim()}&rdquo;
              </li>
            ) : (
              filteredDeals.map((d) => (
                <li key={d.id}>
                  <button
                    onClick={() => void pickDeal(d.id, false).catch(() => {})}
                    disabled={picking !== null}
                    className="block w-full rounded border border-gray-200 p-3 text-left hover:bg-gray-50 disabled:opacity-50"
                  >
                    <div className="text-sm font-medium">{d.name}</div>
                    <div className="text-xs text-gray-500">
                      {picking === d.id ? 'Opening visit…' : d.id}
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      )}

      <div className="border-t border-gray-200 pt-4">
        {!creating ? (
          <button
            onClick={() => setCreating(true)}
            className="w-full rounded border border-dashed border-gray-300 p-3 text-sm text-gray-700 hover:bg-gray-50"
          >
            + Create a new deal
          </button>
        ) : (
          <div className="flex flex-col gap-3 rounded border border-gray-200 p-3">
            <div className="text-sm font-medium">New deal</div>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-gray-600">Deal name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Berlin Mitte 12"
                className="rounded border border-gray-300 px-2 py-1 text-sm"
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-gray-600">Form type</span>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value as 'care' | 'greenfield')}
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="care">Care</option>
                <option value="greenfield">Greenfield</option>
              </select>
              <span className="text-gray-400">
                {formType === 'care'
                  ? 'Existing property \u2014 inspect current condition and inventory.'
                  : 'New property \u2014 document setup requirements and initial state.'}
              </span>
            </label>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={create}
                disabled={submitting}
                className="flex-1 rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {submitting ? 'Creating…' : 'Create + start visit'}
              </button>
              <button
                onClick={() => {
                  setCreating(false);
                  setError(null);
                }}
                disabled={submitting}
                className="rounded border border-gray-300 px-3 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
