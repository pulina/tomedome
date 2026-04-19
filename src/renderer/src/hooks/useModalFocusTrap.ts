import { RefObject, useEffect } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function listFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

export function useModalFocusTrap(containerRef: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return;
    const root = containerRef.current;
    if (!root) return;
    const trapRoot = root;

    const previous = document.activeElement as HTMLElement | null;
    const focusables = listFocusable(trapRoot);
    if (focusables.length > 0) {
      focusables[0]!.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const list = listFocusable(trapRoot);
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const cur = document.activeElement as Node | null;
      if (cur && !trapRoot.contains(cur)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    trapRoot.addEventListener('keydown', onKeyDown);
    return () => {
      trapRoot.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [active, containerRef]);
}
