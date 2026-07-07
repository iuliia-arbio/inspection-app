import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/firstVisit/hubSupabase', () => ({ getHubSupabase: vi.fn() }));

import { GET, parseFindingMediaStep } from '../route';
import { getHubSupabase } from '@/lib/firstVisit/hubSupabase';

const asMock = (fn: unknown) => fn as never as ReturnType<typeof vi.fn>;

// Build a query-builder stub whose terminal `.in()` / `.eq()` resolves to the
// row set for a given table. The route reads three tables:
//   first_visit_answers  -> .select().eq(inspection).in(question_key)  (awaited)
//   first_visit_targets  -> .select().eq(inspection)                   (awaited)
//   first_visit_media    -> .select().eq(inspection)                   (awaited)
function makeClient(opts: {
  answers: unknown[];
  targets: unknown[];
  media: unknown[];
  createSignedUrl: ReturnType<typeof vi.fn>;
}) {
  const from = vi.fn((table: string) => {
    let rows: unknown[] = [];
    if (table === 'first_visit_answers') rows = opts.answers;
    else if (table === 'first_visit_targets') rows = opts.targets;
    else if (table === 'first_visit_media') rows = opts.media;
    const result = { data: rows, error: null };
    const builder: Record<string, unknown> = {
      select: () => builder,
      in: () => Promise.resolve(result),
      // .eq() must be awaitable (targets/media: .select().eq() is the terminal
      // call) AND chainable into .in() (answers: .select().eq().in()). Return a
      // thenable promise that also exposes .in().
      eq: () => {
        const p = Promise.resolve(result) as Promise<typeof result> & {
          in: () => Promise<typeof result>;
        };
        p.in = () => Promise.resolve(result);
        return p;
      },
    };
    return builder;
  });
  const storage = {
    from: vi.fn(() => ({ createSignedUrl: opts.createSignedUrl })),
  };
  return {
    from,
    storage,
    auth: { getUser: () => ({ data: { user: { email: 'a@arbio.com' } } }) },
  };
}

const makeParams = (inspectionId: string) => Promise.resolve({ inspectionId });

describe('parseFindingMediaStep', () => {
  it('extracts step index from issue_media::N', () => {
    expect(parseFindingMediaStep('issue_media::3')).toBe(3);
    expect(parseFindingMediaStep('issue_media::0')).toBe(0);
  });
  it('extracts step index from the building log prop_issue_media::N', () => {
    expect(parseFindingMediaStep('prop_issue_media::3')).toBe(3);
    expect(parseFindingMediaStep('prop_issue_media::0')).toBe(0);
  });
  it('returns null for non-matching keys', () => {
    expect(parseFindingMediaStep('issue_media')).toBeNull();
    expect(parseFindingMediaStep('issue_name')).toBeNull();
    expect(parseFindingMediaStep('issue_media::x')).toBeNull();
    expect(parseFindingMediaStep('prop_issue_media')).toBeNull();
  });
});

describe('GET /api/first-visit/[inspectionId]/findings.csv', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when getHubRouteContext returns null', async () => {
    asMock(getHubSupabase).mockReturnValue(null);
    const res = await GET(new Request('http://x/findings.csv'), {
      params: makeParams('i1'),
    });
    expect(res.status).toBe(401);
  });

  it('returns text/csv with the header row', async () => {
    const createSignedUrl = vi.fn();
    asMock(getHubSupabase).mockReturnValue(
      makeClient({ answers: [], targets: [], media: [], createSignedUrl }),
    );
    const res = await GET(new Request('http://x/findings.csv'), {
      params: makeParams('i1'),
    });
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    // Check raw bytes: res.text() strips a leading BOM per the UTF-8 decode
    // spec, but the downloaded file must carry it (Excel needs it for umlauts),
    // exactly once so it can't leak into the first cell.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder().decode(bytes); // default decode strips the leading BOM
    expect(body.startsWith('unit_identifier,list_type,item_name')).toBe(true);
    expect(body.includes('\uFEFF')).toBe(false);
  });

  it('uses "Building / common" for a location-scoped finding', async () => {
    const createSignedUrl = vi.fn();
    asMock(getHubSupabase).mockReturnValue(
      makeClient({
        answers: [
          { target_id: 't1', scope: 'location', question_key: 'issue_name', step_index: 0, value: 'Leak' },
          { target_id: 't1', scope: 'location', question_key: 'issue_resolution', step_index: 0, value: 'Repair' },
        ],
        targets: [{ id: 't1', label: 'Apt 2', kind: 'unit' }],
        media: [],
        createSignedUrl,
      }),
    );
    const res = await GET(new Request('http://x/findings.csv'), {
      params: makeParams('i1'),
    });
    const body = await res.text();
    expect(body).toContain('Building / common');
  });

  it('includes building-log issues (prop_issue_*) mapped to canonical columns', async () => {
    const createSignedUrl = vi
      .fn()
      .mockResolvedValue({ data: { signedUrl: 'https://signed/lobby' }, error: null });
    asMock(getHubSupabase).mockReturnValue(
      makeClient({
        answers: [
          { target_id: 'loc1', scope: 'location', question_key: 'prop_issue_name', step_index: 0, value: 'Broken lobby light' },
          { target_id: 'loc1', scope: 'location', question_key: 'prop_issue_area', step_index: 0, value: 'Lobby' },
          { target_id: 'loc1', scope: 'location', question_key: 'prop_issue_resolution', step_index: 0, value: 'Fix' },
        ],
        targets: [{ id: 'loc1', label: 'Main building', kind: 'property' }],
        media: [
          { target_id: 'loc1', question_key: 'prop_issue_media::0', storage_path: 'i1/lobby.jpg', kind: 'photo' },
        ],
        createSignedUrl,
      }),
    );
    const res = await GET(new Request('http://x/findings.csv'), {
      params: makeParams('i1'),
    });
    const body = await res.text();
    // Building issues are labelled "Building / common" and prop_issue_area
    // lands in the location_in_unit column.
    expect(body).toContain('Building / common');
    expect(body).toContain('Broken lobby light');
    expect(body).toContain('Lobby');
    expect(body).toContain('https://signed/lobby');
    expect(createSignedUrl).toHaveBeenCalledWith('i1/lobby.jpg', 60 * 60 * 24 * 7);
  });

  it('signs each media row once and includes the URL in the row', async () => {
    const createSignedUrl = vi
      .fn()
      .mockResolvedValue({ data: { signedUrl: 'https://signed/url1' }, error: null });
    asMock(getHubSupabase).mockReturnValue(
      makeClient({
        answers: [
          { target_id: 't1', scope: 'unit_category', question_key: 'issue_name', step_index: 2, value: 'Chair' },
          { target_id: 't1', scope: 'unit_category', question_key: 'issue_resolution', step_index: 2, value: 'Replace' },
        ],
        targets: [{ id: 't1', label: 'Apt 2', kind: 'unit' }],
        media: [
          { target_id: 't1', question_key: 'issue_media::2', storage_path: 'i1/abc.jpg', kind: 'photo' },
        ],
        createSignedUrl,
      }),
    );
    const res = await GET(new Request('http://x/findings.csv'), {
      params: makeParams('i1'),
    });
    const body = await res.text();
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(createSignedUrl).toHaveBeenCalledWith('i1/abc.jpg', 60 * 60 * 24 * 7);
    expect(body).toContain('https://signed/url1');
    expect(body).toContain('Apt 2');
  });

  it('renders an individually skipped field as an empty cell, not [object Object]', async () => {
    const createSignedUrl = vi.fn();
    asMock(getHubSupabase).mockReturnValue(
      makeClient({
        answers: [
          { target_id: 't1', scope: 'unit_category', question_key: 'issue_name', step_index: 0, value: 'Chair' },
          { target_id: 't1', scope: 'unit_category', question_key: 'issue_resolution', step_index: 0, value: 'Replace' },
          // SkipAffordance sentinel — skipped with a reason.
          { target_id: 't1', scope: 'unit_category', question_key: 'issue_notes', step_index: 0, value: { __skipped: true, reason: 'Owner absent' } },
        ],
        targets: [{ id: 't1', label: 'Apt 2', kind: 'unit' }],
        media: [],
        createSignedUrl,
      }),
    );
    const res = await GET(new Request('http://x/findings.csv'), {
      params: makeParams('i1'),
    });
    const body = await res.text();
    expect(body).toContain('Chair');
    expect(body).not.toContain('[object Object]');
    expect(body).not.toContain('Owner absent');
  });

  it('emits no row for a removed repeater block (all fields carry the __removed sentinel)', async () => {
    const createSignedUrl = vi.fn();
    const removed = { __skipped: true, reason: '__removed' };
    asMock(getHubSupabase).mockReturnValue(
      makeClient({
        answers: [
          // Step 0 was removed via StepGroup.removeBlock — every answered
          // question of the block holds the sentinel.
          { target_id: 't1', scope: 'unit_category', question_key: 'issue_name', step_index: 0, value: removed },
          { target_id: 't1', scope: 'unit_category', question_key: 'issue_type', step_index: 0, value: removed },
          { target_id: 't1', scope: 'unit_category', question_key: 'issue_resolution', step_index: 0, value: removed },
          // Step 1 is a live issue and must survive.
          { target_id: 't1', scope: 'unit_category', question_key: 'issue_name', step_index: 1, value: 'Lamp' },
          { target_id: 't1', scope: 'unit_category', question_key: 'issue_resolution', step_index: 1, value: 'Fix' },
        ],
        targets: [{ id: 't1', label: 'Apt 2', kind: 'unit' }],
        media: [],
        createSignedUrl,
      }),
    );
    const res = await GET(new Request('http://x/findings.csv'), {
      params: makeParams('i1'),
    });
    const body = await res.text();
    const lines = body.split('\n');
    expect(lines).toHaveLength(2); // header + the surviving issue only
    expect(body).toContain('Lamp');
    expect(body).not.toContain('[object Object]');
  });

  it('ignores answers with the step_index -1 "not a repeater row" sentinel', async () => {
    const createSignedUrl = vi.fn();
    asMock(getHubSupabase).mockReturnValue(
      makeClient({
        answers: [
          { target_id: 't1', scope: 'unit_category', question_key: 'issue_name', step_index: -1, value: 'Stray' },
          { target_id: 't1', scope: 'unit_category', question_key: 'issue_name', step_index: 0, value: 'Chair' },
          { target_id: 't1', scope: 'unit_category', question_key: 'issue_resolution', step_index: 0, value: 'Replace' },
        ],
        targets: [{ id: 't1', label: 'Apt 2', kind: 'unit' }],
        media: [],
        createSignedUrl,
      }),
    );
    const res = await GET(new Request('http://x/findings.csv'), {
      params: makeParams('i1'),
    });
    const body = await res.text();
    const lines = body.split('\n');
    expect(lines).toHaveLength(2); // header + the real issue row
    expect(body).toContain('Chair');
    expect(body).not.toContain('Stray');
  });
});
