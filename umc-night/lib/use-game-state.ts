"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type GameState } from "./client";

export function useGameState(view: "host" | "team" | "screen") {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  const pending = useRef<Promise<void> | null>(null);
  async function refresh() {
    if (pending.current) return pending.current;
    const task = (async () => {
      const began = Date.now();
      try {
        const value = await api<GameState>(`/api/state?view=${view}`);
        setOffset(new Date(value.serverNow).getTime() - Math.round((began + Date.now()) / 2));
        setState(value); setError(null);
      } catch (cause) {
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) setState(null);
        setError(cause instanceof Error ? cause.message : "연결에 실패했습니다.");
      }
    })();
    pending.current = task;
    try { await task; } finally { if (pending.current === task) pending.current = null; }
  }
  useEffect(() => {
    void refresh();
    const resume = () => { if (view === "screen" || document.visibilityState === "visible") void refresh(); };
    const poll = window.setInterval(resume, 2000);
    const tick = window.setInterval(() => setClock(Date.now()), 250);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume); window.addEventListener("online", resume);
    return () => { window.clearInterval(poll); window.clearInterval(tick); document.removeEventListener("visibilitychange", resume); window.removeEventListener("focus", resume); window.removeEventListener("online", resume); };
  }, [view]);
  return { state, error, clock: clock + offset, refresh };
}
