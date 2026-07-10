'use client';
import { useCallback } from 'react';
import { localDb } from './db';
import { enqueue } from './sync';
import { track } from './analytics';

export async function sha256(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Deletes a media row from Dexie and — only if it had already been uploaded —
 * enqueues a server-side delete. A never-uploaded local blob has no server
 * counterpart, so no outbox job is needed.
 */
export async function deleteMedia(id: string): Promise<void> {
  const row = await localDb.media.get(id);
  if (!row) return;
  await localDb.media.delete(id);
  if (row.uploaded_at) {
    // inspection_id is not used by the delete handler (it queries by id) but
    // lets pendingCountForInspection attribute the job to its visit.
    await enqueue('media_delete', { id, inspection_id: row.inspection_id });
  }
}

export function useMediaCapture(inspectionId: string) {
  const persist = useCallback(
    async (blob: Blob, kind: 'photo'|'video'|'audio', meta: { target_id: string; area_key: string; question_key?: string; answer_id?: string }) => {
      const id = crypto.randomUUID();
      const content_hash = await sha256(blob);
      await localDb.media.put({
        id,
        inspection_id: inspectionId,
        target_id: meta.target_id,
        answer_id: meta.answer_id,
        area_key: meta.area_key,
        question_key: meta.question_key,
        kind,
        blob,
        content_hash,
        size_bytes: blob.size,
        captured_at: new Date().toISOString(),
      });
      track('media_captured', { kind, inspection_id: inspectionId });
      await enqueue('media_upload', {
        media_id: id, inspection_id: inspectionId, kind, content_hash, size_bytes: blob.size,
      });
      return id;
    },
    [inspectionId],
  );
  const remove = useCallback((id: string) => deleteMedia(id), []);
  return { persist, remove };
}
