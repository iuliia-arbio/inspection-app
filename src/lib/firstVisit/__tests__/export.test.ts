import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { localDb } from '../db';
import { exportInspection } from '../export';

describe('exportInspection', () => {
  it('produces a zip with answers.csv (no manifest.json), including human-readable question text', async () => {
    await localDb.inspections.clear();
    await localDb.answers.clear();
    await localDb.media.clear();
    await localDb.inspections.put({
      id: 'i', deal_id: 'd', status: 'draft',
      inspector_email: 'a@arbio.com', started_at: '2026-05-22T00:00:00Z',
    });
    await localDb.answers.put({
      id: 'a', inspection_id: 'i', target_id: 'i', scope: 'deal',
      question_key: 'fv_visit_date', area_key: '1',
      value: '2026-07-08', was_prefilled: false, was_accepted_as_is: false,
      created_at: '', updated_at: '',
    });
    const blob = await exportInspection('i');
    const zip = await JSZip.loadAsync(blob);
    expect(zip.file('manifest.json')).toBeNull();
    expect(zip.file('answers.csv')).not.toBeNull();
    const csv = await zip.file('answers.csv')!.async('string');
    expect(csv).toContain('question_key,question_text,area_key,value');
    expect(csv).toContain('fv_visit_date,');
    const dataLine = csv.split('\n').find((l) => l.includes('fv_visit_date'));
    expect(dataLine).toBeTruthy();
    expect(csv.startsWith('﻿')).toBe(true);
  });

  it('renders boolean answers as Yes/No instead of true/false', async () => {
    await localDb.inspections.clear();
    await localDb.answers.clear();
    await localDb.inspections.put({
      id: 'i2', deal_id: 'd', status: 'draft',
      inspector_email: 'a@arbio.com', started_at: '2026-05-22T00:00:00Z',
    });
    await localDb.answers.put({
      id: 'a2', inspection_id: 'i2', target_id: 'i2', scope: 'deal',
      question_key: 'fv_wifi_present', area_key: '7',
      value: true, was_prefilled: false, was_accepted_as_is: false,
      created_at: '', updated_at: '',
    });
    const blob = await exportInspection('i2');
    const zip = await JSZip.loadAsync(blob);
    const csv = await zip.file('answers.csv')!.async('string');
    expect(csv).toContain('Yes');
    expect(csv).not.toMatch(/,true,/);
  });
});
