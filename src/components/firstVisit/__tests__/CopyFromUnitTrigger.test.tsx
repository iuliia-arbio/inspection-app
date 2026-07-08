import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CopyFromUnitTrigger } from '../CopyFromUnitTrigger';
import { localDb, type LocalTarget, type LocalAnswer } from '@/lib/firstVisit/db';

const PHASE_ID = 'p9';
const PHASE_QUESTIONS = [
  { slug: 'q1', label: 'Question one' },
  { slug: 'q2', label: 'Question two' },
  { slug: 'q3', label: 'Question three' },
];

function unit(id: string, label: string, inspection_id = 'i1'): LocalTarget {
  return {
    id,
    inspection_id,
    kind: 'unit',
    parent_id: 'prop-1',
    unit_category_id: `uc-${id}`,
    label,
    created_on_site: false,
    order: 0,
  };
}

function answer(target_id: string, slug: string, value: unknown, area_key = PHASE_ID): LocalAnswer {
  return {
    id: `${target_id}-${area_key}-${slug}`,
    inspection_id: 'i1',
    target_id,
    scope: 'unit_category',
    question_key: slug,
    area_key,
    value,
    was_prefilled: false,
    was_accepted_as_is: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe('CopyFromUnitTrigger', () => {
  beforeEach(async () => {
    await localDb.targets.clear();
    await localDb.answers.clear();
  });

  afterEach(async () => {
    await localDb.targets.clear();
    await localDb.answers.clear();
  });

  it('renders the closed icon trigger by default', () => {
    render(
      <CopyFromUnitTrigger
        inspectionId="i1"
        currentUnitId="u1"
        phaseId={PHASE_ID}
        phaseQuestions={PHASE_QUESTIONS}
        onCopy={async () => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /copy from another unit/i })).toBeInTheDocument();
  });

  it('scopes sibling answer counts to the current phase only', async () => {
    await localDb.targets.bulkPut([unit('u1', 'Current'), unit('u2', 'Studio A')]);
    await localDb.answers.bulkPut([
      answer('u2', 'q1', 'val', PHASE_ID),
      // Answer in a different phase must not count toward this phase's total.
      answer('u2', 'q2', 'other-phase-val', 'some-other-phase'),
    ]);

    render(
      <CopyFromUnitTrigger
        inspectionId="i1"
        currentUnitId="u1"
        phaseId={PHASE_ID}
        phaseQuestions={PHASE_QUESTIONS}
        onCopy={async () => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /copy from another unit/i }));

    const item = await screen.findByRole('button', { name: /Studio A/i });
    expect(item.textContent).toContain('1 answer');
  });

  it('copy all answers calls onCopy with no questionKeys filter', async () => {
    await localDb.targets.bulkPut([unit('u1', 'Current'), unit('u2', 'Studio A')]);
    await localDb.answers.bulkPut([answer('u2', 'q1', 'val')]);

    const onCopy = vi.fn().mockResolvedValue(undefined);
    render(
      <CopyFromUnitTrigger
        inspectionId="i1"
        currentUnitId="u1"
        phaseId={PHASE_ID}
        phaseQuestions={PHASE_QUESTIONS}
        onCopy={onCopy}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /copy from another unit/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Studio A/i }));
    await userEvent.click(await screen.findByRole('button', { name: /copy all answers/i }));

    expect(onCopy).toHaveBeenCalledWith('u2');
  });

  it('copy selected answers only sends the checked question slugs', async () => {
    await localDb.targets.bulkPut([unit('u1', 'Current'), unit('u2', 'Studio A')]);
    await localDb.answers.bulkPut([
      answer('u2', 'q1', 'val'),
      answer('u2', 'q2', 'val2'),
    ]);

    const onCopy = vi.fn().mockResolvedValue(undefined);
    render(
      <CopyFromUnitTrigger
        inspectionId="i1"
        currentUnitId="u1"
        phaseId={PHASE_ID}
        phaseQuestions={PHASE_QUESTIONS}
        onCopy={onCopy}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /copy from another unit/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Studio A/i }));
    await userEvent.click(await screen.findByRole('button', { name: /copy selected answers/i }));

    // Only q1/q2 have meaningful values on the source unit for this phase — q3 must not appear.
    expect(await screen.findByText('Question one')).toBeInTheDocument();
    expect(screen.getByText('Question two')).toBeInTheDocument();
    expect(screen.queryByText('Question three')).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('checkbox')[0]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /copy 1 selected/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: /copy 1 selected/i }));

    expect(onCopy).toHaveBeenCalledWith('u2', ['q1']);
  });
});
