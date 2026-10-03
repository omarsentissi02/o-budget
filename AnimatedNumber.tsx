import { useEffect, useRef, useState } from "react";
import { formatEUR } from "../../shared/money";
import { useReducedMotion } from "../hooks/useReducedMotion";

/** Montant qui « compte » jusqu'à sa nouvelle valeur lorsqu'il change. */
export function AnimatedNumber({ cents, className = "" }: { cents: number; className?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(cents);
  const from = useRef(cents);

  useEffect(() => {
    if (reduced || from.current === cents) {
      from.current = cents;
      setShown(cents);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    const duration = 550;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(origin + (cents - origin) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = cents;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      from.current = cents;
    };
  }, [cents, reduced]);

  return (
    <span className={`num ${className}`} aria-label={formatEUR(cents)}>
      <span aria-hidden>{formatEUR(shown)}</span>
    </span>
  );
}
