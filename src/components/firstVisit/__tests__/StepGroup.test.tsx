import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepGroup } from '../StepGroup';
import { makeQuestion } from './_fixtures';
import type { LocalAnswer } from '@/lib/firstVisit/db';

const baseQ = makeQuestion({ slug: 'q1', label: 'Step description', type: 'text' });
const groupQuestions = [
  makeQuestion({ ...baseQ, slug: 'q1', label: 'Action' }),
  makeQuestion({ ...baseQ, slug: 'q2', label: 'Notes' }),
];

function setup(answers: Record<string, LocalAnswer> = {}) {
  const onChange = vi.fn(async () => undefined);
  const setNotes = vi.fn();
  render(
    <StepGroup
      groupId="check_in_step"
      questions={groupQuestions}
      inspectionId="i1"
      targetId="t1"
      areaKey="p1"
      hubValueLookup={() => undefined}
      answers={answers}
      onChange={onChange}
      setNotes={setNotes}
    />,
  );
  return { onChange, setNotes };
}

beforeEach(() => {
  // jsdom: confirm + scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
  window.confirm = vi.fn(() => true);
});

describe('StepGroup', () => {
  it('initial render shows one empty block, no remove button, no "+ Add step" missing', () => {
    setup();
    expect(screen.getByText('Step 1')).toBeInTheDocument();
    expect(screen.queryByText('Step 2')).toBeNull();
    expect(screen.getByRole('button', { name: '+ Add step' })).toBeInTheDocument();
    // Only one block → remove button should not appear.
    expect(screen.queryByRole('button', { name: /Remove Step/ })).toBeNull();
  });

  it('renders a passed title + intro as a group header', () => {
    const onChange = vi.fn(async () => undefined);
    const setNotes = vi.fn();
    render(
      <StepGroup
        groupId="finding"
        groupLabel="Findings"
        intro="List items that need repair."
        itemNoun="Finding"
        questions={groupQuestions}
        inspectionId="i1"
        targetId="t1"
        areaKey="p1"
        hubValueLookup={() => undefined}
        answers={{}}
        onChange={onChange}
        setNotes={setNotes}
      />,
    );
    expect(screen.getByText('Findings')).toBeInTheDocument();
    expect(screen.getByText('List items that need repair.')).toBeInTheDocument();
    // Blocks read "Finding 1" when itemNoun='Finding'.
    expect(screen.getByText('Finding 1')).toBeInTheDocument();
    expect(screen.queryByText('Step 1')).toBeNull();
  });

  it('clicking "+ Add step" adds a second block', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: '+ Add step' }));
    expect(screen.getByText('Step 1')).toBeInTheDocument();
    expect(screen.getByText('Step 2')).toBeInTheDocument();
  });

  it('"×" remove button appears once there are 2+ blocks and triggers confirm', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({
      // Seed: two blocks with values for slug q1 at step 0 and step 1.
      't1::p1::q1': {
        id: 'a1',
        inspection_id: 'i1',
        target_id: 't1',
        scope: 'location',
        question_key: 'q1',
        area_key: 'p1',
        step_index: 0,
        value: 'first',
        was_prefilled: false,
        was_accepted_as_is: false,
        created_at: '2026-06-01',
        updated_at: '2026-06-01',
      } as LocalAnswer,
      't1::p1::q1::1': {
        id: 'a2',
        inspection_id: 'i1',
        target_id: 't1',
        scope: 'location',
        question_key: 'q1',
        area_key: 'p1',
        step_index: 1,
        value: 'second',
        was_prefilled: false,
        was_accepted_as_is: false,
        created_at: '2026-06-01',
        updated_at: '2026-06-01',
      } as LocalAnswer,
    });

    const removeBtns = screen.getAllByRole('button', { name: /Remove Step/ });
    expect(removeBtns.length).toBeGreaterThanOrEqual(2);
    await user.click(removeBtns[1]);
    expect(window.confirm).toHaveBeenCalled();
    // Soft-delete writes happen for the questions with answers in the removed step.
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('adding after a soft-remove allocates a fresh step_index past the tombstones', async () => {
    const user = userEvent.setup();
    const answer = (id: string, slug: string, stepIndex: number, value: unknown): LocalAnswer =>
      ({
        id,
        inspection_id: 'i1',
        target_id: 't1',
        scope: 'location',
        question_key: slug,
        area_key: 'p1',
        step_index: stepIndex,
        value,
        was_prefilled: false,
        was_accepted_as_is: false,
        created_at: '2026-06-01',
        updated_at: '2026-06-01',
      }) as LocalAnswer;
    // Seed: block 0 answered, block 1 soft-removed (tombstone rows persist with
    // the '__removed' marker — removeBlock never hard-deletes them).
    const removed = { __skipped: true, reason: '__removed' };
    const { onChange } = setup({
      't1::p1::q1': answer('a1', 'q1', 0, 'first'),
      't1::p1::q1::1': answer('a2', 'q1', 1, removed),
      't1::p1::q2::1': answer('a3', 'q2', 1, removed),
    });

    // The tombstoned block stays hidden.
    expect(screen.getByText('Step 1')).toBeInTheDocument();
    expect(screen.queryByText('Step 2')).toBeNull();

    await user.click(screen.getByRole('button', { name: '+ Add step' }));
    expect(screen.getByText('Step 2')).toBeInTheDocument();

    // The new block's fields are empty and editable (not swallowed by the
    // '__removed' tombstones at step_index 1).
    const inputs = screen.getAllByRole('textbox');
    // Block 0 renders q1 ('first') + q2; the new block adds two more.
    const newInputs = inputs.slice(-2);
    for (const el of newInputs) {
      expect((el as HTMLTextAreaElement).value).toBe('');
      expect(el).toBeEnabled();
    }

    // Typing in the new block writes at step_index 2, NOT the tombstoned 1.
    await user.type(newInputs[0], 'x');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const calls = onChange.mock.calls as unknown[][];
    expect(calls[calls.length - 1][2]).toBe(2);
  });
});
