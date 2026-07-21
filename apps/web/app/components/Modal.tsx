'use client';

import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Prístupný modál (WCAG 2.4.3 / 4.1.2): role=dialog + aria-modal, Escape zatvára,
 * fokus sa presunie dovnútra a po zatvorení sa vráti na spúšťač, Tab cyklí v rámci
 * dialógu (focus-trap). Klik na pozadie zatvára. Vizuál preberá z children.
 */
export function Modal({
  onClose,
  labelledBy,
  maxWidth = 440,
  children,
}: {
  onClose: () => void;
  labelledBy?: string;
  maxWidth?: number;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    prevFocus.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && panel) {
        const f = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (f.length === 0) return;
        const firstEl = f[0]!;
        const lastEl = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prevFocus.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        background: 'rgba(10,14,20,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        animation: 'slideIn 0.2s ease',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface-primary)',
          border: '1px solid var(--border-primary)',
          borderRadius: '18px',
          boxShadow: 'var(--shadow-lg)',
          width: '100%',
          maxWidth,
          maxHeight: '90vh',
          overflow: 'auto',
          outline: 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
}
