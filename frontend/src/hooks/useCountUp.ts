import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

type Options = {
  duration?: number;
  delay?: number;
  enabled?: boolean;
};

/**
 * Плавно анимирует число от предыдущего значения к target на requestAnimationFrame.
 * При смене target — интерполирует от текущего отображаемого значения, а не с нуля.
 * При prefers-reduced-motion — сразу выдаёт target.
 */
export function useCountUp(target: number, opts: Options = {}): number {
  const { duration = 1000, delay = 0, enabled = true } = opts;
  const reduced = useReducedMotion();
  const [value, setValue] = useState<number>(reduced || !enabled ? target : 0);
  const fromRef = useRef<number>(reduced || !enabled ? target : 0);
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);

    if (reduced || !enabled) {
      fromRef.current = target;
      setValue(target);
      return;
    }

    const from = fromRef.current;
    const to = target;
    if (from === to) return;

    const start = () => {
      const startTime = performance.now();
      const tick = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(1, elapsed / duration);
        const eased = easeOutCubic(t);
        const current = from + (to - from) * eased;
        setValue(current);
        if (t < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          fromRef.current = to;
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    if (delay > 0) {
      timeoutRef.current = window.setTimeout(start, delay);
    } else {
      start();
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [target, duration, delay, enabled, reduced]);

  return Math.round(value);
}
