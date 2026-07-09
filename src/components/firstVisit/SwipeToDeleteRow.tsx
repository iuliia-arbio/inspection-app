'use client';

import { useState } from 'react';
import { useSwipeable } from 'react-swipeable';

const REVEAL_PX = 88;

export function SwipeToDeleteRow({
  children,
  onDelete,
}: {
  children: React.ReactNode;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handlers = useSwipeable({
    onSwipedLeft: () => setOpen(true),
    onSwipedRight: () => {
      setOpen(false);
      setConfirming(false);
    },
    trackMouse: false,
  });

  const handleTap = () => {
    if (confirming) {
      onDelete();
      setConfirming(false);
      setOpen(false);
    } else {
      setConfirming(true);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-lg">
      <div
        {...handlers}
        className="transition-transform duration-150 ease-out"
        style={{ transform: open ? `translateX(-${REVEAL_PX}px)` : 'translateX(0)' }}
      >
        {children}
      </div>
      <button
        type="button"
        onClick={handleTap}
        aria-label={confirming ? 'Confirm delete' : 'Delete'}
        style={{ width: REVEAL_PX }}
        className={`absolute right-0 top-0 flex h-full items-center justify-center text-sm font-medium text-white ${
          confirming ? 'bg-red-800' : 'bg-red-600'
        }`}
      >
        {confirming ? 'Confirm?' : 'Delete'}
      </button>
    </div>
  );
}
