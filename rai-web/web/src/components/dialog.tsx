// W1-07 (Lane B): the dialog of W0-02 section 9 item 3 on the native <dialog> element with showModal(): focus
// moves into it on open, the browser traps Tab inside a modal dialog, focus returns to the invoking control on
// close, and Escape closes it unless the caller declares unsaved input, in which case it asks first. Reused by the
// sign-out confirmation here and by the W1-06 N/A-reason dialog.

import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { useLocale } from '../i18n/locale-provider.js';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

export interface DialogProps {
  open: boolean;
  /** Id of the heading element inside `children`, for aria-labelledby. */
  labelledBy: string;
  onClose: () => void;
  /** When true, Escape asks for confirmation before discarding the input. */
  hasUnsavedInput?: boolean;
  children: ReactNode;
}

export function Dialog({
  open,
  labelledBy,
  onClose,
  hasUnsavedInput = false,
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
      focusables(dialog)[0]?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
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
    const onClosed = (): void => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      // Tab wraps inside the dialog (section 9 item 3) instead of leaving the document for the browser chrome.
      if (event.key !== 'Tab') return;
      const items = focusables(dialog);
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onClosed);
    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClosed);
      dialog.removeEventListener('keydown', onKeyDown);
    };
  }, [hasUnsavedInput, onClose, t]);

  return (
    <dialog ref={ref} className={'dialog'} aria-labelledby={labelledBy} aria-modal={true}>
      {children}
    </dialog>
  );
}
