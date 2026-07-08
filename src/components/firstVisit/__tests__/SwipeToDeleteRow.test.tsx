import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SwipeToDeleteRow } from '../SwipeToDeleteRow';

function swipe(el: Element, dir: 'left' | 'right') {
  const startX = dir === 'left' ? 200 : 50;
  const endX = dir === 'left' ? 50 : 200;
  fireEvent.touchStart(el, { touches: [{ clientX: startX, clientY: 0 }] });
  fireEvent.touchMove(el, { touches: [{ clientX: endX, clientY: 0 }] });
  fireEvent.touchEnd(el, { touches: [] });
}

describe('SwipeToDeleteRow', () => {
  it('requires a swipe-left before the delete button is reachable, then a second tap to confirm', () => {
    const onDelete = vi.fn();
    render(
      <SwipeToDeleteRow onDelete={onDelete}>
        <div>Row content</div>
      </SwipeToDeleteRow>,
    );

    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    swipe(screen.getByText('Row content').parentElement!, 'left');

    fireEvent.click(deleteButton);
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('swiping right resets an open, unconfirmed delete button', () => {
    const onDelete = vi.fn();
    render(
      <SwipeToDeleteRow onDelete={onDelete}>
        <div>Row content</div>
      </SwipeToDeleteRow>,
    );

    const content = screen.getByText('Row content').parentElement!;
    swipe(content, 'left');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    swipe(content, 'right');

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
