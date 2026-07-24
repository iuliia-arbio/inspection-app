import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttachAffordance } from '../AttachAffordance';
import { localDb, type LocalMedia } from '@/lib/firstVisit/db';

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

// The header badge ("Attachments · N") is split across nested spans, so match
// the wrapper span by its combined text content rather than a single text node.
const headerBadge = () =>
  screen.getByText(
    (_content, el) => el?.tagName === 'SPAN' && /Attachments/.test(el.textContent ?? ''),
  );

describe('AttachAffordance', () => {
  beforeEach(async () => {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi
      .fn()
      .mockReturnValue('blob:mock');
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
    await localDb.media.clear();
  });

  afterEach(async () => {
    await localDb.media.clear();
  });

  it('header badge count equals the gallery file count', async () => {
    await localDb.media.bulkPut([
      makeMedia({ id: 'm-photo', kind: 'photo' }),
      makeMedia({ id: 'm-video', kind: 'video' }),
    ]);

    render(
      <AttachAffordance
        inspectionId={INSPECTION}
        targetId={TARGET}
        areaKey={AREA}
        questionKey={QUESTION}
        onNotesChange={() => {}}
      />,
    );

    // Gallery reports "2 files"; the header badge must read "· 2". The badge
    // lives in the parent, which re-renders one tick after the gallery's onCount,
    // so wait for it rather than asserting synchronously.
    await waitFor(() => expect(screen.getByText(/2 files?/i)).toBeInTheDocument());
    await waitFor(() => expect(headerBadge()).toHaveTextContent(/·\s*2/));
  });

  it('after a delete BOTH the badge and the gallery reflect the new count', async () => {
    await localDb.media.bulkPut([
      makeMedia({ id: 'm-photo', kind: 'photo' }),
      makeMedia({ id: 'm-video', kind: 'video' }),
    ]);

    render(
      <AttachAffordance
        inspectionId={INSPECTION}
        targetId={TARGET}
        areaKey={AREA}
        questionKey={QUESTION}
        onNotesChange={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByText(/2 files?/i)).toBeInTheDocument());
    await waitFor(() => expect(headerBadge()).toHaveTextContent(/·\s*2/));

    await userEvent.click(screen.getByRole('button', { name: /delete photo/i }));

    // Gallery drops to "1 file" AND the badge drops to "· 1" — no divergence.
    await waitFor(() => expect(screen.getByText(/1 file/i)).toBeInTheDocument());
    await waitFor(() => expect(headerBadge()).toHaveTextContent(/·\s*1/));
  });

  it('with no note and no media renders the compact attach button', async () => {
    render(
      <AttachAffordance
        inspectionId={INSPECTION}
        targetId={TARGET}
        areaKey={AREA}
        questionKey={QUESTION}
        onNotesChange={() => {}}
      />,
    );

    expect(
      await screen.findByRole('button', { name: /attach note, photo, or video/i }),
    ).toBeInTheDocument();
  });

  describe('hideMedia', () => {
    it('does not render photo/video buttons or the gallery when hideMedia is true', async () => {
      await localDb.media.bulkPut([makeMedia({ id: 'm-photo', kind: 'photo' })]);

      render(
        <AttachAffordance
          inspectionId={INSPECTION}
          targetId={TARGET}
          areaKey={AREA}
          questionKey={QUESTION}
          notes="an existing note keeps the panel expanded"
          onNotesChange={() => {}}
          hideMedia
        />,
      );

      // notes is non-empty so the panel starts expanded (not the compact
      // "+ Attach" trigger) — assert the media affordances are absent while
      // the note capability remains usable.
      expect(await screen.findByPlaceholderText(/note/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /photo/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /video/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/\d+ files?/i)).not.toBeInTheDocument();
    });

    it('renders photo/video buttons and the gallery by default', async () => {
      await localDb.media.bulkPut([makeMedia({ id: 'm-photo', kind: 'photo' })]);

      render(
        <AttachAffordance
          inspectionId={INSPECTION}
          targetId={TARGET}
          areaKey={AREA}
          questionKey={QUESTION}
          notes=""
          onNotesChange={() => {}}
        />,
      );

      await waitFor(() => expect(screen.getByText(/1 file/i)).toBeInTheDocument());
    });
  });
});
