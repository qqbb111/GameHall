import { useEffect, useRef } from 'react';

// A disabled move button loses native focus. Only restore it when the player
// was operating this board with the keyboard and has not moved elsewhere.
export function useBoardKeyboardContinuity(active: boolean, target: string | null) {
  const boardRef = useRef<HTMLDivElement>(null);
  const keyboardBoard = useRef(false);

  useEffect(() => {
    const leaveOnFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !boardRef.current?.contains(event.target)) keyboardBoard.current = false;
    };
    const leaveOnPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !boardRef.current?.contains(event.target)) keyboardBoard.current = false;
    };
    document.addEventListener('focusin', leaveOnFocus);
    document.addEventListener('pointerdown', leaveOnPointer);
    return () => {
      document.removeEventListener('focusin', leaveOnFocus);
      document.removeEventListener('pointerdown', leaveOnPointer);
    };
  }, []);

  useEffect(() => {
    if (!active || !keyboardBoard.current || !target) return;
    const board = boardRef.current;
    const focused = document.activeElement;
    if (!board || (focused !== document.body && !board.contains(focused))) {
      keyboardBoard.current = false;
      return;
    }
    const button = board.querySelector<HTMLButtonElement>(target);
    if (button && !button.disabled && focused !== button) button.focus();
  });

  return {
    boardRef,
    onKeyDownCapture(event: React.KeyboardEvent<HTMLDivElement>) {
      if (event.key === 'Tab') keyboardBoard.current = false;
      else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) keyboardBoard.current = true;
    },
    onPointerDownCapture() { keyboardBoard.current = false; },
  };
}
