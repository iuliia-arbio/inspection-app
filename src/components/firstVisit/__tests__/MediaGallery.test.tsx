import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MediaGallery } from '../MediaGallery';
import { localDb, type LocalMedia } from '@/lib/firstVisit/db';
import { clearRemoteMediaCache } from '@/lib/firstVisit/remoteMedia';

const INSPECTION = 'insp-1';
const TARGET = 'target-1';
const AREA = 'kitchen';
const QUESTION = 'overall';

function makeMedia(over: Partial<LocalMedia> & Pick<LocalMedia, 'id' | 'kind'>): LocalMedia {
  return {
    inspection_id: INSPECTION,
    target_id: TARGET,
    area_key: AREA,
    question_key: QUESTION,
    blob: new Blob(['x'], { type: over.kind === 'video' ? 'video/mp4' : 'image/jpeg' }),
    content_hash: `hash-${over.id}`,
    size_bytes: 1,
    captured_at: new Date().toISOString(),
    ...over,
  };
}

describe('MediaGallery', () => {
  beforeEach(async () => {
    // jsdom doesn't implement object URLs.
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi
      .fn()
      .mockReturnValue('blob:mock');
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
    clearRemoteMediaCache();
    // Remote listing is exercised in its own describe below; default to none.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ media: [] }) }),
    );
    await localDb.media.clear();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await localDb.media.clear();
  });

  it('renders one thumbnail per row and an accurate count', async () => {
    await localDb.media.bulkPut([
      makeMedia({ id: 'm-photo', kind: 'photo' }),
      makeMedia({ id: 'm-video', kind: 'video' }),
    ]);

    render(
      <MediaGallery
        inspectionId={INSPECTION}
        targetId={TARGET}
        areaKey={AREA}
        questionKey={QUESTION}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/2 files?/i)).toBeInTheDocument();
    });
    // A photo uses an <img>, a video uses a <video>.
    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(document.querySelector('video')).toBeTruthy();
  });

  it('deleting an item drops the count and removes the row', async () => {
    await localDb.media.bulkPut([
      makeMedia({ id: 'm-photo', kind: 'photo' }),
      makeMedia({ id: 'm-video', kind: 'video' }),
    ]);

    render(
      <MediaGallery
        inspectionId={INSPECTION}
        targetId={TARGET}
        areaKey={AREA}
        questionKey={QUESTION}
      />,
    );

    await waitFor(() => expect(screen.getByText(/2 files?/i)).toBeInTheDocument());

    const delPhoto = screen.getByRole('button', { name: /delete photo/i });
    await userEvent.click(delPhoto);

    await waitFor(() => expect(screen.getByText(/1 file/i)).toBeInTheDocument());
    expect(await localDb.media.get('m-photo')).toBeUndefined();
    expect(await localDb.media.get('m-video')).toBeDefined();
  });

  it('ignores rows for other tuples', async () => {
    await localDb.media.bulkPut([
      makeMedia({ id: 'mine', kind: 'photo' }),
      makeMedia({ id: 'other-q', kind: 'photo', question_key: 'different' }),
      makeMedia({ id: 'other-area', kind: 'photo', area_key: 'bathroom' }),
    ]);

    render(
      <MediaGallery
        inspectionId={INSPECTION}
        targetId={TARGET}
        areaKey={AREA}
        questionKey={QUESTION}
      />,
    );

    await waitFor(() => expect(screen.getByText(/1 file/i)).toBeInTheDocument());
  });

  describe('upload status indicator', () => {
    it('shows an uploading state before uploaded_at is set', async () => {
      await localDb.media.put(makeMedia({ id: 'm1', kind: 'photo' }));

      render(
        <MediaGallery
          inspectionId={INSPECTION}
          targetId={TARGET}
          areaKey={AREA}
          questionKey={QUESTION}
        />,
      );

      expect(await screen.findByLabelText(/uploading/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/^uploaded$/i)).not.toBeInTheDocument();
    });

    it('shows an uploaded checkmark once uploaded_at is set', async () => {
      await localDb.media.put(
        makeMedia({ id: 'm2', kind: 'photo', uploaded_at: new Date().toISOString() }),
      );

      render(
        <MediaGallery
          inspectionId={INSPECTION}
          targetId={TARGET}
          areaKey={AREA}
          questionKey={QUESTION}
        />,
      );

      expect(await screen.findByLabelText(/^uploaded$/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/uploading/i)).not.toBeInTheDocument();
    });
  });

  describe('remote media (captured on another device)', () => {
    const remoteRow = {
      id: 'remote-1',
      inspection_id: INSPECTION,
      target_id: TARGET,
      answer_id: null,
      area_key: AREA,
      question_key: QUESTION,
      kind: 'photo',
      captured_at: '2026-07-09T08:00:00.000Z',
      url: null,
      thumb_url: 'https://hub/signed/remote-1-thumb.jpg',
      view_url: 'https://hub/signed/remote-1-view.jpg',
    };

    it('renders remote rows view-only and counts them', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            media: [
              remoteRow,
              // Different tuple — must not render here.
              { ...remoteRow, id: 'remote-2', area_key: 'bathroom' },
            ],
          }),
        }),
      );

      render(
        <MediaGallery
          inspectionId={INSPECTION}
          targetId={TARGET}
          areaKey={AREA}
          questionKey={QUESTION}
        />,
      );

      await waitFor(() => expect(screen.getByText(/1 file/i)).toBeInTheDocument());
      // Tile shows the small thumbnail, not a full-res image.
      expect(screen.getByRole('img')).toHaveAttribute('src', remoteRow.thumb_url);
      // Remote rows are uploaded by definition and not deletable from here.
      expect(screen.getByLabelText(/^uploaded$/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    });

    it('renders a remote video as a placeholder, not an eager <video>', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            media: [
              {
                ...remoteRow,
                id: 'remote-vid',
                kind: 'video',
                url: 'https://hub/signed/remote-vid.mp4',
                thumb_url: null,
                view_url: null,
              },
            ],
          }),
        }),
      );

      render(
        <MediaGallery
          inspectionId={INSPECTION}
          targetId={TARGET}
          areaKey={AREA}
          questionKey={QUESTION}
        />,
      );

      await waitFor(() => expect(screen.getByText(/1 file/i)).toBeInTheDocument());
      // No <video> is mounted in the gallery for a remote video (avoids buffering).
      expect(document.querySelector('video')).toBeNull();
      // The tile is still openable.
      expect(screen.getByRole('button', { name: /open video/i })).toBeInTheDocument();
    });

    it('prefers the local copy when the same id exists on this device', async () => {
      await localDb.media.put(
        makeMedia({ id: 'remote-1', kind: 'photo', uploaded_at: new Date().toISOString() }),
      );
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ media: [remoteRow] }) }),
      );

      render(
        <MediaGallery
          inspectionId={INSPECTION}
          targetId={TARGET}
          areaKey={AREA}
          questionKey={QUESTION}
        />,
      );

      await waitFor(() => expect(screen.getByText(/1 file/i)).toBeInTheDocument());
      // Local blob wins: renders the object URL, stays deletable.
      expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:mock');
      expect(screen.getByRole('button', { name: /delete photo/i })).toBeInTheDocument();
    });
  });
});
