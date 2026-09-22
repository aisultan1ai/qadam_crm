import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveState } from "@/components/lib/SaveIndicator";

type SaveFn<T> = (value: T) => Promise<unknown>;

export function useAutoSave<T>({
  value,
  onSave,
  delay = 600,
  enabled = true,
  compare,
}: {
  value: T;
  onSave: SaveFn<T>;
  delay?: number;
  enabled?: boolean;
  compare?: (a: T, b: T) => boolean;
}): {
  state: SaveState;
  errorMsg: string | null;
  flush: () => Promise<void>;
  retry: () => void;
} {
  const [state, setState] = useState<SaveState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const lastSavedRef = useRef<T>(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<unknown> | null>(null);

  const eq = useCallback(
    (a: T, b: T) => (compare ? compare(a, b) : Object.is(a, b)),
    [compare],
  );

  const doSave = useCallback(
    async (v: T) => {
      setState("saving");
      setErrorMsg(null);
      try {
        const p = onSave(v);
        inFlightRef.current = p;
        await p;
        if (inFlightRef.current !== p) return;
        lastSavedRef.current = v;
        setState("saved");
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setState("idle"), 1800);
      } catch (e: any) {
        setState("error");
        setErrorMsg(e?.message || "Не удалось сохранить");
      } finally {
        inFlightRef.current = null;
      }
    },
    [onSave],
  );

  useEffect(() => {
    if (!enabled) return;
    if (eq(value, lastSavedRef.current)) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      doSave(value);
    }, delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, delay, enabled, eq, doSave]);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (eq(value, lastSavedRef.current)) return;
    await doSave(value);
  }, [value, eq, doSave]);

  const retry = useCallback(() => {
    doSave(value);
  }, [value, doSave]);

  return { state, errorMsg, flush, retry };
}

export default useAutoSave;
