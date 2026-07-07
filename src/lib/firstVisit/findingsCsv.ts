import { listTypeFor } from './findingsResolution';

// Re-exported for existing importers (and tests) that pulled listTypeFor from
// here. The implementation + the resolution→list-type map now live in
// findingsResolution.ts, shared with questions.ts's picker options.
export { listTypeFor };

export type FindingRow = {
  unit_identifier: string; item_name: string; category: string;
  location_in_unit: string | null; resolution: string; quantity: number | null;
  cost_estimate_eur: number | null; urgency: string | null; notes: string | null;
  media_links: string[];
};

const HEADER = ['unit_identifier','list_type','item_name','category','location_in_unit',
  'resolution','quantity','cost_estimate_eur','urgency','notes','media_links'];

function cell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// UTF-8 BOM so Excel on Windows detects the encoding — without it, BOM-less
// UTF-8 opens as Windows-1252 and umlauts garble (Küche → KÃ¼che). The BOM
// sits before the header, outside any quoted cell; the route serves the
// string as-is so it is never duplicated.
const BOM = '\uFEFF';

export function buildFindingsCsv(rows: FindingRow[]): string {
  const body = rows.map((r) => [
    r.unit_identifier, listTypeFor(r.resolution), r.item_name, r.category,
    r.location_in_unit, r.resolution, r.quantity, r.cost_estimate_eur,
    r.urgency, r.notes, r.media_links.join(';'),
  ].map(cell).join(','));
  return BOM + [HEADER.join(','), ...body].join('\n');
}
