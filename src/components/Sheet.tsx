import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Panneau modal : glisse depuis le bas sur mobile, centré sur grand écran. */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    const first = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel;
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key !== "Tab" || !panel) return;
      const items = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea, select, a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!items.length) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="anim-fade absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="anim-sheet relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[30px] bg-surface px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+20px)] outline-none sm:max-w-md sm:rounded-[30px] sm:pt-5"
      >
        <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line sm:hidden" />
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-xl font-semibold tracking-tight">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="-mr-1 grid size-10 shrink-0 place-items-center rounded-full bg-raised text-muted hover:text-ink"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmSheet({
  open,
  onClose,
  title,
  message,
  confirmLabel,
  onConfirm,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  loading?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p className="mb-6 text-[15px] text-muted">{message}</p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          data-autofocus
          disabled={loading}
          onClick={onConfirm}
          className="h-12 rounded-2xl bg-danger font-semibold text-white disabled:opacity-60"
        >
          {loading ? "Suppression…" : confirmLabel}
        </button>
        <button type="button" onClick={onClose} className="h-12 rounded-2xl bg-raised font-semibold">
          Annuler
        </button>
      </div>
    </Sheet>
  );
}
