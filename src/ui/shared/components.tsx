/**
 * Accessible base components for Tab Bookmark Shortcuts UI.
 * All components follow WCAG 2.1 AA basics:
 * - Visible focus indicators
 * - ARIA labels/roles
 * - Keyboard navigation
 * - Color is never the only status indicator (always paired with text/icon)
 */

import React, { useRef, useEffect, useCallback } from 'react';

// ─── Button ──────────────────────────────────────────────────────────────────

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

/**
 * `forwardRef` so callers that must move focus to a button (the generalized
 * `UndoBar`, which takes focus on open and returns it on dismissal) can hold a
 * ref to the real DOM node.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, children, disabled, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`tbs-btn tbs-btn--${variant} tbs-btn--${size} ${className ?? ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <span className="tbs-btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
});

// ─── Icon Button ─────────────────────────────────────────────────────────────

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required accessible label since icon buttons have no visible text */
  'aria-label': string;
  size?: 'sm' | 'md' | 'lg';
}

export function IconButton({
  size = 'md',
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      className={`tbs-icon-btn tbs-icon-btn--${size} ${className ?? ''}`}
      {...props}
    >
      {children}
    </button>
  );
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

export interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({ content, children, position = 'top' }: TooltipProps) {
  const id = useRef(`tooltip-${Math.random().toString(36).slice(2)}`).current;

  return (
    <span className="tbs-tooltip-wrapper" aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className={`tbs-tooltip tbs-tooltip--${position}`}
      >
        {content}
      </span>
    </span>
  );
}

// ─── Dialog ──────────────────────────────────────────────────────────────────

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Optional footer actions */
  footer?: React.ReactNode;
  /**
   * F4: element to restore focus to when the dialog closes.
   *
   * Capturing `document.activeElement` is not enough when the dialog is opened
   * from a transient menu: the clicked `role="menuitem"` is unmounted in the
   * same commit, so the browser has already dropped focus to `<body>` and the
   * user is returned to the top of the document. Callers therefore pass the
   * durable trigger (e.g. the `⋯` button) explicitly.
   */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * N7: durable element to fall back to when the trigger does not survive.
   *
   * A dialog action can REMOVE its own trigger after the close (deleting a slot
   * unbinds it, which unmounts that slot's `⋯` button). The trigger still looks
   * focusable on the close frame, so focus is applied to it and then silently
   * decays to `<body>` when React removes it. When provided, this element is
   * re-checked one tick after the restore and takes over if focus was lost.
   */
  focusFallbackRef?: React.RefObject<HTMLElement | null>;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  returnFocusRef,
  focusFallbackRef,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      previousFocus.current = returnFocusRef?.current ?? (document.activeElement as HTMLElement);
      // Focus first focusable element in dialog
      const focusable = dialogRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      focusable?.focus();
    } else {
      const target = previousFocus.current;
      target?.focus();
      const fallback = focusFallbackRef?.current;
      if (!fallback) return;

      const restoreIfLost = (): void => {
        const active = document.activeElement;
        const lost =
          active === null ||
          active === document.body ||
          (target !== null && !document.contains(target));
        if (lost) fallback.focus();
      };

      // A destructive action (e.g. Delete Slot) removes its own trigger
      // asynchronously, AFTER this close frame: the trigger still looks
      // focusable here, so focus is applied to it and would then silently
      // decay to `<body>`. The removal normally takes this dialog down with it
      // (the trigger lives in the same actions section), so it is observable
      // twice — here, and when React runs this effect's cleanup on unmount.
      // Re-assert a perceivable focus target at both moments.
      restoreIfLost();
      return restoreIfLost;
    }
  }, [open, returnFocusRef, focusFallbackRef]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      // Trap focus within dialog
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose]
  );

  // F1 regression guard: a modal is a hard interaction boundary. Whatever
  // houses the dialog (e.g. a clickable `.tbs-slot-row`), a click on the
  // overlay means "cancel the modal" and must never reach the underlying
  // content — otherwise cancelling also triggers the host's own click action.
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose]
  );

  if (!open) return null;

  return (
    <div className="tbs-dialog-overlay" onClick={handleOverlayClick}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="tbs-dialog"
        onClick={(e) => { e.stopPropagation(); }}
        onKeyDown={handleKeyDown}
      >
        <div className="tbs-dialog__header">
          <h2 className="tbs-dialog__title">{title}</h2>
          <IconButton aria-label="Close dialog" onClick={onClose} size="sm">
            ✕
          </IconButton>
        </div>
        <div className="tbs-dialog__body">{children}</div>
        {footer && <div className="tbs-dialog__footer">{footer}</div>}
      </div>
    </div>
  );
}

// ─── Toast / Alert ───────────────────────────────────────────────────────────

export type ToastVariant = 'success' | 'warning' | 'error' | 'info';

export interface ToastProps {
  variant: ToastVariant;
  message: string;
  /** Optional action button */
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  /** Auto-dismiss timeout in ms. 0 = no auto-dismiss. */
  duration?: number;
}

export function Toast({ variant, message, action, onDismiss, duration = 5000 }: ToastProps) {
  useEffect(() => {
    if (duration > 0 && onDismiss) {
      const timer = setTimeout(onDismiss, duration);
      return () => { clearTimeout(timer); };
    }
  }, [duration, onDismiss]);

  // Icon per variant — status is never conveyed by color alone
  const icons: Record<ToastVariant, string> = {
    success: '✓',
    warning: '⚠',
    error: '✕',
    info: 'ℹ',
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={`tbs-toast tbs-toast--${variant}`}
    >
      <span className="tbs-toast__icon" aria-hidden="true">{icons[variant]}</span>
      <span className="tbs-toast__message">{message}</span>
      {action && (
        <button className="tbs-toast__action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {onDismiss && (
        <IconButton aria-label="Dismiss notification" onClick={onDismiss} size="sm">
          ✕
        </IconButton>
      )}
    </div>
  );
}

// ─── Confirm Dialog ──────────────────────────────────────────────────────────

export interface ConfirmProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
  /** F4: durable trigger element to focus on close (see `DialogProps`). */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * N7: durable element to fall back to when the trigger does not survive the
   * confirmed action (see `DialogProps`).
   */
  focusFallbackRef?: React.RefObject<HTMLElement | null>;
}

export function Confirm({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
  returnFocusRef,
  focusFallbackRef,
}: ConfirmProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const openedAt = useRef(0);

  useEffect(() => {
    if (open) {
      // CT3-b4: a short protection window so the keypress that OPENED the dialog
      // cannot immediately activate the confirm button.
      openedAt.current = Date.now();
      confirmRef.current?.focus();
    }
  }, [open]);

  const guard = useCallback((run: () => void) => {
    // CT3-b4: ignore activation inside the ~120ms protection window.
    if (Date.now() - openedAt.current < 120) return;
    run();
  }, []);

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      returnFocusRef={returnFocusRef}
      focusFallbackRef={focusFallbackRef}
      footer={
        // CT3-b: DOM order is confirmation → cancellation, so the dialog's
        // default "focus the first focusable element" lands on the confirm
        // button rather than on Cancel.
        <>
          <Button
            ref={confirmRef}
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={() => { guard(onConfirm); }}
          >
            {confirmLabel}
          </Button>
          <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
        </>
      }
    >
      <p>{message}</p>
    </Dialog>
  );
}

// ─── Form Field ──────────────────────────────────────────────────────────────

/**
 * IMP-12 / CT3-d: `FormField` is the PUBLIC API for the described-by wiring.
 *
 * `errorId` / `hintId` are exported so a caller can point its own input at the
 * error node (with `role="alert"`) and the hint node, rather than each call site
 * inventing the ids. (The un-bound list is registered as a follow-up rather than
 * fixed in this iteration.)
 */
export interface FormFieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}

/** The ids `FormField` renders for a given input id (IMP-12 public API). */
export function formFieldIds(htmlFor: string): { errorId: string; hintId: string } {
  return { errorId: `${htmlFor}-error`, hintId: `${htmlFor}-hint` };
}

export function FormField({ label, htmlFor, error, hint, required, children }: FormFieldProps) {
  const { errorId, hintId } = formFieldIds(htmlFor);

  return (
    <div className="tbs-form-field">
      <label htmlFor={htmlFor} className="tbs-form-field__label">
        {label}
        {required && <span aria-hidden="true" className="tbs-form-field__required"> *</span>}
      </label>
      {hint && (
        <span id={hintId} className="tbs-form-field__hint">{hint}</span>
      )}
      {children}
      {error && (
        <span id={errorId} role="alert" className="tbs-form-field__error">
          <span aria-hidden="true">⚠ </span>{error}
        </span>
      )}
    </div>
  );
}

// ─── Focus Ring Utility ──────────────────────────────────────────────────────

/**
 * CSS class names for focus-visible styling.
 * Applied via global stylesheet — components use these class names.
 */
export const focusClasses = {
  /** Apply to any interactive element for consistent focus ring */
  focusRing: 'tbs-focus-ring',
  /** Inset focus ring for contained elements */
  focusRingInset: 'tbs-focus-ring--inset',
} as const;

// ─── Status Badge (color + text/icon, never color alone) ─────────────────────

export interface StatusBadgeProps {
  status: 'active' | 'inactive' | 'error' | 'pending';
  label: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const icons: Record<string, string> = {
    active: '●',
    inactive: '○',
    error: '✕',
    pending: '◐',
  };

  return (
    <span className={`tbs-status-badge tbs-status-badge--${status}`}>
      <span aria-hidden="true" className="tbs-status-badge__icon">{icons[status]}</span>
      <span className="tbs-status-badge__label">{label}</span>
    </span>
  );
}
