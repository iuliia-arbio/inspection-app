import JSZip from 'jszip';
import { localDb } from './db';
import { track } from './analytics';

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function exportInspection(inspectionId: string): Promise<Blob> {
  const zip = new JSZip();

  const inspection = await localDb.inspections.get(inspectionId);
  const answers = await localDb.answers.where('inspection_id').equals(inspectionId).toArray();
  const media = await localDb.media.where('inspection_id').equals(inspectionId).toArray();

  // CSV
  const header = [
    'question_key','area_key','value','notes',
    'was_prefilled','was_accepted_as_is','hub_suggestion_snapshot','captured_at',
  ].join(',');
  const rows = answers.map((a) => [
    a.question_key, a.area_key, a.value, a.notes ?? '',
    a.was_prefilled, a.was_accepted_as_is,
    a.hub_suggestion_snapshot ?? '', a.created_at,
  ].map(csvCell).join(','));
  // UTF-8 BOM so Excel on Windows opens the CSV as UTF-8 (umlauts intact).
  zip.file('answers.csv', '\uFEFF' + [header, ...rows].join('\n'));

  // Manifest
  zip.file('manifest.json', JSON.stringify({ inspection, media_count: media.length }, null, 2));

  // Media
  for (const m of media) {
    const folder = `${m.kind}s`;
    const ext = m.kind === 'photo' ? 'jpg' : m.kind === 'video' ? 'mp4' : 'webm';
    const safeArea = m.area_key.replace(/[^a-z0-9_-]/gi, '_');
    const safeQuestion = (m.question_key ?? 'general').replace(/[^a-z0-9_-]/gi, '_');
    zip.file(`${folder}/${safeArea}_${safeQuestion}_${m.id}.${ext}`, m.blob);
  }

  return zip.generateAsync({ type: 'blob' });
}

export async function downloadInspectionZip(inspectionId: string): Promise<void> {
  const blob = await exportInspection(inspectionId);
  track('export_generated', { inspection_id: inspectionId });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `first-visit-${inspectionId}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
