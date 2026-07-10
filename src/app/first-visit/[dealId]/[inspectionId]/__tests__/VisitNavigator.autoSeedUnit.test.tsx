import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VisitNavigator from '../VisitNavigator';
import { localDb } from '@/lib/firstVisit/db';

// Keep the sync engine inert — these tests are about the auto-seeded child
// unit that every new property must start with, not the outbox.
vi.mock('@/lib/firstVisit/useSyncEngine', () => ({
  useSyncEngine: () => ({
    pending: 0,
    stuck: 0,
    lastError: undefined,
    syncing: false,
    syncNow: vi.fn().mockResolvedValue(undefined),
  }),
  useOnlineStatus: () => true,
}));
vi.mock('@/lib/firstVisit/sync', () => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
  ensureInspectionQueued: vi.fn().mockResolvedValue(undefined),
  pendingCountForInspection: vi.fn().mockResolvedValue(0),
}));
vi.mock('@/lib/firstVisit/analytics', () => ({ track: vi.fn() }));
vi.mock('@/lib/firstVisit/export', () => ({ downloadInspectionZip: vi.fn() }));

import { enqueue } from '@/lib/firstVisit/sync';

const INSPECTION = 'insp-seed';
const DEAL = 'deal-seed';

// Route the global fetch by URL: the deal snapshot GET plus the two hub POST
// endpoints the add-property / add-unit flows hit.
function stubFetch(snapshot: {
  locations: { id: string; display_name?: string }[];
  units: { id: string; location_id?: string; custom_name?: string }[];
}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/snapshot')) {
      return { ok: true, json: async () => ({ deal: { id: DEAL }, ...snapshot }) };
    }
    if (/\/locations\/[^/]+\/units$/.test(url)) {
      return { ok: true, json: async () => ({ unit: { id: 'uc-created' } }) };
    }
    if (url.endsWith('/locations')) {
      return { ok: true, json: async () => ({ location: { id: 'loc-created' } }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

async function seedInspection() {
  await localDb.targets.clear();
  await localDb.answers.clear();
  await localDb.inspections.clear();
  await localDb.inspections.put({
    id: INSPECTION,
    deal_id: DEAL,
    status: 'draft',
  } as Parameters<typeof localDb.inspections.put>[0]);
}

async function unitsInDexie() {
  const rows = await localDb.targets.where('inspection_id').equals(INSPECTION).toArray();
  return {
    properties: rows.filter((t) => t.kind === 'property'),
    units: rows.filter((t) => t.kind === 'unit'),
  };
}

describe('VisitNavigator auto-seeds one unit per new property', () => {
  beforeEach(async () => {
    await seedInspection();
  });

  it('hub property with hub units: seeds the FIRST hub unit (real identity + hub name)', async () => {
    stubFetch({
      locations: [{ id: 'loc-hub', display_name: 'Hub House' }],
      units: [
        { id: 'unit-hub-1', location_id: 'loc-hub', custom_name: 'Apt 5' },
        { id: 'unit-hub-2', location_id: 'loc-hub', custom_name: 'Apt 6' },
      ],
    });
    render(<VisitNavigator dealId={DEAL} inspectionId={INSPECTION} visitTitle="T" />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Add property' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Hub House' }));

    await waitFor(async () => {
      const { units } = await unitsInDexie();
      expect(units).toHaveLength(1);
    });
    const { properties, units } = await unitsInDexie();
    expect(properties).toHaveLength(1);
    expect(units[0]).toMatchObject({
      parent_id: properties[0].id,
      unit_category_id: 'unit-hub-1',
      label: 'Apt 5',
      created_on_site: false,
    });
    // Openable: label present. Enqueued exactly like a manual add.
    expect(units[0].label.trim().length).toBeGreaterThan(0);
    expect(enqueue).toHaveBeenCalledWith(
      'target_upsert',
      expect.objectContaining({ kind: 'unit', unit_category_id: 'unit-hub-1' }),
    );
    // The unit renders in the tree.
    expect(await screen.findByText('Apt 5')).toBeInTheDocument();
  });

  it('hub property WITHOUT hub units: creates a hub-backed "Unit 1" default', async () => {
    const calls = stubFetch({
      locations: [{ id: 'loc-hub', display_name: 'Hub House' }],
      units: [],
    });
    render(<VisitNavigator dealId={DEAL} inspectionId={INSPECTION} visitTitle="T" />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Add property' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Hub House' }));

    await waitFor(async () => {
      const { units } = await unitsInDexie();
      expect(units).toHaveLength(1);
    });
    const { properties, units } = await unitsInDexie();
    expect(units[0]).toMatchObject({
      parent_id: properties[0].id,
      unit_category_id: 'uc-created',
      label: 'Unit 1',
      created_on_site: true,
    });
    // The default unit was minted on the hub first, so it has sync identity.
    expect(
      calls.some(
        (c) => /\/locations\/loc-hub\/units$/.test(c.url) && c.init?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('on-site property: seeds a hub-backed "Unit 1" under the freshly created location', async () => {
    const calls = stubFetch({ locations: [], units: [] });
    render(<VisitNavigator dealId={DEAL} inspectionId={INSPECTION} visitTitle="T" />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Add property' }));
    fireEvent.change(screen.getByPlaceholderText('Property name'), {
      target: { value: 'New Site' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(async () => {
      const { units } = await unitsInDexie();
      expect(units).toHaveLength(1);
    });
    const { properties, units } = await unitsInDexie();
    expect(properties[0]).toMatchObject({ label: 'New Site', location_id: 'loc-created' });
    expect(units[0]).toMatchObject({
      parent_id: properties[0].id,
      unit_category_id: 'uc-created',
      label: 'Unit 1',
      created_on_site: true,
    });
    expect(
      calls.some(
        (c) => /\/locations\/loc-created\/units$/.test(c.url) && c.init?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('does not seed when the hub unit POST fails — property still lands, no broken unit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/snapshot')) {
          return {
            ok: true,
            json: async () => ({
              deal: { id: DEAL },
              locations: [{ id: 'loc-hub', display_name: 'Hub House' }],
              units: [],
            }),
          };
        }
        if (/\/units$/.test(url)) return { ok: false, json: async () => ({}) };
        return { ok: true, json: async () => ({}) };
      }),
    );
    render(<VisitNavigator dealId={DEAL} inspectionId={INSPECTION} visitTitle="T" />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Add property' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Hub House' }));

    await waitFor(async () => {
      const { properties } = await unitsInDexie();
      expect(properties).toHaveLength(1);
    });
    const { units } = await unitsInDexie();
    expect(units).toHaveLength(0);
  });
});
