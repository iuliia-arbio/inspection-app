import { describe, it, expect, beforeEach } from 'vitest';
import { localDb, type LocalMedia } from '../db';
import { deleteMedia } from '../useMediaCapture';

function seedMedia(overrides: Partial<LocalMedia> = {}): LocalMedia {
  return {
    id: 'm1',
    inspection_id: 'i1',
    target_id: 't1',
    area_key: 'a1',
    kind: 'photo',
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    content_hash: 'hash',
    size_bytes: 1,
    captured_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('deleteMedia', () => {
  beforeEach(async () => {
    await localDb.media.clear();
    await localDb.outbox.clear();
  });

  it('deletes the row AND enqueues media_delete when uploaded', async () => {
    await localDb.media.put(
      seedMedia({ id: 'm1', uploaded_at: new Date().toISOString() }),
    );

    await deleteMedia('m1');

    expect(await localDb.media.get('m1')).toBeUndefined();
    const jobs = await localDb.outbox.toArray();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].kind).toBe('media_delete');
    // inspection_id lets the soft submit gate attribute this job to its visit.
    expect(jobs[0].payload).toEqual({ id: 'm1', inspection_id: 'i1' });
  });

  it('deletes the row but does NOT enqueue when never uploaded', async () => {
    await localDb.media.put(seedMedia({ id: 'm2', uploaded_at: undefined }));

    await deleteMedia('m2');

    expect(await localDb.media.get('m2')).toBeUndefined();
    const jobs = await localDb.outbox.toArray();
    expect(jobs).toHaveLength(0);
  });
});
