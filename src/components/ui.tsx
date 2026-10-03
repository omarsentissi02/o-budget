import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 active:brightness-95",
  secondary: "bg-raised text-ink hover:brightness-[0.97] dark:hover:brightness-125",
  ghost: "text-ink hover:bg-raised",
  danger: "bg-danger-soft text-danger hover:brightness-[0.97] dark:hover:brightness-125",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "md" | "lg";
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, block, className = "", children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition select-none disabled:opacity-50 disabled:cursor-not-allowed ${
        size === "lg" ? "h-14 px-6 text-[17px]" : "h-11 px-4 text-[15px]"
      } ${block ? "w-full" : ""} ${variants[variant]} ${className}`}
      {...rest}
    >
      {loading && <LoaderCircle size={18} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export const inputClass =
  "h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[16px] text-ink placeholder:text-faint outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15";

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className = "", ...rest },
  ref,
) {
  return <input ref={ref} className={`${inputClass} ${className}`} {...rest} />;
});

/** Garde uniquement chiffres et une virgule, deux décimales max. */
export function sanitizeAmount(raw: string): string {
  let s = raw.replace(/\./g, ",").replace(/[^\d,]/g, "");
  const i = s.indexOf(",");
  if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/,/g, "").slice(0, 2);
  return s.replace(/^0+(?=\d)/, "").slice(0, 10);
}

interface AmountInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onChange: (v: string) => void;
  large?: boolean;
}

export const AmountInput = forwardRef<HTMLInputElement, AmountInputProps>(function AmountInput(
  { value, onChange, large, className = "", ...rest },
  ref,
) {
  return (
    <div className={`relative ${className}`}>
      <input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        placeholder="0,00"
        value={value}
        onChange={(e) => onChange(sanitizeAmount(e.target.value))}
        className={`${inputClass} num pr-10 text-right font-semibold ${large ? "h-16 text-3xl" : ""}`}
        {...rest}
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 font-semibold text-faint ${large ? "text-2xl" : ""}`}
      >
        €
      </span>
    </div>
  );
});

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-2xl bg-raised p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition ${
            value === o.value ? "bg-surface text-ink shadow-sm shadow-black/5" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Panel({ children, className = "", as: Tag = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div"; "aria-labelledby"?: string }) {
  return (
    <Tag className={`rounded-[26px] bg-surface p-5 ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export function SectionTitle({ children, id, action }: { children: ReactNode; id?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 id={id} className="text-[17px] font-semibold tracking-tight">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-raised ${className}`} />;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-[26px] bg-surface p-6 text-center">
      <p className="text-[15px] text-muted">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  );
}

export function useFieldId(prefix: string) {
  return `${prefix}-${useId().replace(/:/g, "")}`;
}
