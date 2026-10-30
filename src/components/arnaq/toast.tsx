"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { DoneRing } from "./motion";

interface ToastApi {
  /** A short confirmation ("Saved"). One at a time: a new one replaces the old. */
  toast: (message: string) => void;
}

const Ctx = createContext<ToastApi>({ toast: () => {} });
export const useToast = () => useContext(Ctx);

const SHOW_MS = 2600;

/** The one place confirmations appear, so every action can answer "did that work?" the same way. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ id: number; message: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<number[]>([]);
  const next = useRef(1);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const toast = useCallback((message: string) => {
    clear();
    setLeaving(false);
    setCurrent({ id: next.current++, message });
    timers.current.push(window.setTimeout(() => setLeaving(true), SHOW_MS));
    timers.current.push(window.setTimeout(() => setCurrent(null), SHOW_MS + 350));
  }, []);

  useEffect(() => clear, []);
  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] z-50 flex justify-center px-4 @min-[900px]/app:bottom-8"
      >
        {current && (
          <div
            key={current.id}
            className={`toast glass flex items-center gap-2.5 rounded-full py-2.5 pr-5 pl-3 text-[15px] font-semibold shadow-lg ${leaving ? "toast-out" : ""}`}
          >
            <DoneRing className="size-6" />
            {current.message}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
