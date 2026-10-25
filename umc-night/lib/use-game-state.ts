"use client";
import { useEffect, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { api, ApiError, type GameState } from "./client";
import { prepareImage, preparedImage } from "./client-images";
import { SyncedClock, type ClockSample } from "./synced-clock";

export function useGameState(view: "host" | "team" | "screen") {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [clockReady, setClockReady] = useState(false);
  const [clockErrorMs, setClockErrorMs] = useState(Infinity);
  const [realtime, setRealtime] = useState(false);
  const timer = useRef(new SyncedClock());
  const pending = useRef<Promise<void> | null>(null);
  const queued = useRef(false);
  const generation = useRef(0);
  const lastRequest = useRef(0);
  const alive = useRef(true);
  const connected = useRef(false);
  const nextImage = useRef<string | null>(null);
  async function warmNextImage(value: GameState) {
    if (view !== "host" || !value.nextImageUrl || nextImage.current === value.nextImageUrl) return;
    nextImage.current = value.nextImageUrl;
    const image = await prepareImage(value.nextImageUrl);
    if (!image) { if (nextImage.current === value.nextImageUrl) nextImage.current = null; return; }
    if (alive.current && "BroadcastChannel" in window) {
      const channel = new BroadcastChannel("umc-night-state");
      channel.postMessage({ type: "image-preload", path: image.path, blob: image.blob }); channel.close();
    }
  }

  function applyState(value: GameState) {
    generation.current++;
    setState(value); setError(null); void warmNextImage(value);
  }
  async function refresh() {
    if (!alive.current) return;
    if (pending.current) { queued.current = true; return pending.current; }
    const sequence = ++generation.current;
    lastRequest.current = performance.now();
    const task = (async () => {
      try {
        const value = await api<GameState>(`/api/state?view=${view}`);
        if (alive.current && sequence === generation.current) { setState(value); setError(null); void warmNextImage(value); }
      } catch (cause) {
        if (!alive.current || sequence !== generation.current) return;
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) setState(null);
        setError(cause instanceof Error ? cause.message : "연결에 실패했습니다.");
      }
    })();
    pending.current = task;
    try { await task; } finally {
      if (pending.current === task) pending.current = null;
      if (queued.current && alive.current) { queued.current = false; void refresh(); }
    }
  }
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let live: SupabaseClient | null = null;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let syncPending = false;
    const active = () => view === "screen" || document.visibilityState === "visible";
    const signal = () => {
      if (!active() || disposed || debounce) return;
      debounce = setTimeout(() => { debounce = undefined; void refresh(); }, 25);
    };
    async function syncClock() {
      if (syncPending || disposed || !active()) return;
      syncPending = true;
      try {
        const sent = performance.now();
        const sample = await api<ClockSample>("/api/clock");
        const received = performance.now();
        if (!disposed && timer.current.add(sample, sent, received)) {
          setClock(timer.current.now(received)); setClockReady(true); setClockErrorMs(timer.current.uncertaintyMs);
        }
      } catch { /* Keep the last monotonic anchor while the connection recovers. */ }
      finally { syncPending = false; }
    }
    void refresh();
    void (async () => { for (let i = 0; i < 3 && !disposed; i++) await syncClock(); })();
    void (async () => {
      try {
        const config = await api<{ url: string | null; key: string | null }>("/api/live");
        if (disposed || !config.url || !config.key) return;
        live = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
        live.channel(`game-state-${view}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "game_events" }, signal)
          .subscribe(status => { if (disposed) return; connected.current = status === "SUBSCRIBED"; setRealtime(connected.current); if (connected.current) signal(); });
      } catch { /* Short polling remains active if Realtime cannot connect. */ }
    })();
    const channel = "BroadcastChannel" in window ? new BroadcastChannel("umc-night-state") : null;
    if (channel) {
      channel.onmessage = event => {
        const data = event.data;
        if (data?.type === "image-preload") {
          if (view === "screen" && typeof data.path === "string" && data.blob instanceof Blob) void prepareImage(data.path, data.blob);
        } else if (data?.type === "image-cache-request") {
          const image = view === "host" && nextImage.current ? preparedImage(nextImage.current) : null;
          if (image) channel.postMessage({ type: "image-preload", path: image.path, blob: image.blob });
        } else signal();
      };
      if (view === "screen") channel.postMessage({ type: "image-cache-request" });
    }
    const resume = () => { if (active()) { signal(); void syncClock(); } };
    const poll = window.setInterval(() => {
      if (active() && performance.now() - lastRequest.current >= (connected.current ? 10_000 : 750)) void refresh();
    }, 250);
    const tick = window.setInterval(() => { if (active()) setClock(timer.current.now(performance.now())); }, 50);
    const resync = window.setInterval(() => void syncClock(), 15_000);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume); window.addEventListener("online", resume);
    window.addEventListener("umc-night:changed", signal);
    return () => {
      disposed = true; alive.current = false; generation.current++; connected.current = false;
      window.clearInterval(poll); window.clearInterval(tick); window.clearInterval(resync);
      if (debounce) clearTimeout(debounce);
      channel?.close();
      if (live) { void live.removeAllChannels(); void live.realtime.disconnect(); }
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume); window.removeEventListener("online", resume);
      window.removeEventListener("umc-night:changed", signal);
    };
  }, [view]);
  return { state, error, clock, clockReady, clockErrorMs, realtime, refresh, applyState };
}
