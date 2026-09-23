// The dialog of W0-02 section 9 item 3 on the native <dialog> element with showModal(): focus moves into it on
// open, the browser traps Tab inside a modal dialog, focus returns to the invoking control on close, and Escape
// closes it unless the caller declares unsaved input, in which case it asks first. A radio group is one tab stop
// whose entry is its checked radio, so when the first control is a radio the dialog opens on the checked one and
// the backward wrap fires from it (Chromium otherwise lets Shift+Tab leave a modal dialog for the browser UI).

import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { useLocale } from '../i18n/locale-provider.js';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

/** The first tab stop: the checked radio of the first control's group when that control is a radio, else itself. */
function entryOf(root: HTMLElement, items: HTMLElement[]): HTMLElement | undefined {
  const first = items[0];
  if (first instanceof HTMLInputElement && first.type === 'radio' && first.name !== '') {
    const checked = root.querySelector<HTMLInputElement>(
      `input[type="radio"][name="${CSS.escape(first.name)}"]:checked`,
    );
    if (checked !== null) return checked;
  }
  return first;
}

export interface DialogProps {
  open: boolean;
  /** Id of the heading element inside `children`, for aria-labelledby. */
  labelledBy: string;
  onClose: () => void;
  /** When true, Escape asks for confirmation before discarding the input. */
  hasUnsavedInput?: boolean;
  /** Extra class on the <dialog>, e.g. `dialog-wide`. */
  className?: string;
  children: ReactNode;
}

export function Dialog({
  open,
  labelledBy,
  onClose,
  hasUnsavedInput = false,
  className,
  children,
}: DialogProps): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<Element | null>(null);
  const { t } = useLocale();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      openerRef.current = document.activeElement;
      dialog.showModal();
      entryOf(dialog, focusables(dialog))?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      // Restore focus here, synchronously, and nowhere else: the browser's own restoration and a `close` listener
      // both run later as queued tasks, and a second restoration landing after the caller has already moved focus
      // (W1-06: to the next slot's Change button) would snap it back to the previous opener.
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    const onCancel = (event: Event): void => {
      // Escape: the browser fires `cancel` before closing; we decide.
      event.preventDefault();
      if (hasUnsavedInput && !window.confirm(t('dialog.discard_confirm'))) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      // Tab wraps inside the dialog (section 9 item 3) instead of leaving the document for the browser chrome.
      if (event.key !== 'Tab') return;
      const items = focusables(dialog);
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      const entry = entryOf(dialog, items) ?? first;
      const active = document.activeElement;
      if (event.shiftKey && (active === entry || active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        entry.focus();
      }
    };
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('keydown', onKeyDown);
    };
  }, [hasUnsavedInput, onClose, t]);

  return (
    <dialog
      ref={ref}
      className={className === undefined ? 'dialog' : `dialog ${className}`}
      aria-labelledby={labelledBy}
      aria-modal={true}
    >
      {children}
    </dialog>
  );
}
