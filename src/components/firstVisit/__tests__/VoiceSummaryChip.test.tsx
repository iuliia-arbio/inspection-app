import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VoiceSummaryChip } from '../SectionVoicePrompts';
import type { FirstVisitQuestion } from '@/lib/firstVisit/questions';

const question: FirstVisitQuestion = {
  slug: 'p1__summary',
  label: 'Summary (from voice)',
  description: '',
  scope: 'unit_category',
  mode: 'observe',
  type: 'text',
  options: [],
  required: false,
  repeater: false,
  pms_target: null,
  status: 'existing',
  verdict: null,
  notes: null,
  phase_id: '1',
  phase_label: 'Phase 1',
};

describe('VoiceSummaryChip', () => {
  it('renders a collapsed chip by default and expands to the full field on tap', () => {
    render(
      <VoiceSummaryChip
        question={question}
        inspectionId="i"
        targetId="t"
        areaKey="1"
        stepIndex={null}
        hubValue={undefined}
        answers={{}}
        onChange={vi.fn()}
        setNotes={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /summary — tap to view/i })).toBeInTheDocument();
    expect(screen.queryByText('Summary (from voice)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /summary — tap to view/i }));

    expect(screen.getByText('Summary (from voice)')).toBeInTheDocument();
  });
});
