'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type SignEvent = {
  type: 'sign';
  label: string;
  confidence: number;
  motion: number;
  latencyMs: number;
  model: string;
};

export type SignStatus = {
  /** Which predictor the service loaded: "onnx", "stub", or "none". */
  model: string;
  /** False until a real model is trained. The UI must not imply otherwise. */
  ready: boolean;
};

const WS_URL =
  process.env.NEXT_PUBLIC_SIGN_WS_URL ?? 'ws://127.0.0.1:8000/ws/sign';

/**
 * Streams landmark frames to the recognition service.
 *
 * Two things this deliberately does NOT do:
 *
 * - It does not queue. If the socket is congested we drop the frame instead of
 *   buffering it. A sign recognised from three-second-old landmarks is worse
 *   than no recognition -- the person has already moved on, and stale
 *   predictions are how a terminal starts arguing with someone about an item they
 *   signed ten seconds ago.
 *
 * - It does not retry forever silently. The UI needs to be able to say the
 *   recogniser is offline, because "signing does nothing" with no explanation
 *   is the worst possible experience for the exact user this is built for.
 */
export function useSignSocket(onSign: (e: SignEvent) => void) {
  const [connected, setConnected] = useState(false);
  const [droppedFrames, setDroppedFrames] = useState(0);
  const [status, setStatus] = useState<SignStatus>({ model: 'unknown', ready: false });
  const socketRef = useRef<WebSocket | null>(null);
  const onSignRef = useRef(onSign);
  const retryRef = useRef(0);

  // Assigned after render, not during it.
  useEffect(() => {
    onSignRef.current = onSign;
  });

  useEffect(() => {
    // Scoped to THIS effect run, not to the component. React StrictMode mounts
    // effects twice in development (mount, clean up, mount again) and a ref
    // would survive that cleanup -- leaving the flag stuck true so the second
    // mount never reconnects, and the terminal reports the recogniser offline
    // while it is running perfectly.
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (cancelled) return;

      const ws = new WebSocket(WS_URL);
      socketRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retryRef.current = 0;
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === 'sign') onSignRef.current(data as SignEvent);
          else if (data.type === 'status') setStatus({ model: data.model, ready: data.ready });
          else if (data.type === 'error') console.warn('[sign] service error:', data.message);
        } catch {
          console.warn('[sign] unparseable message', ev.data);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (cancelled) return;
        // Back off to 5s. The service is often just not started yet in dev.
        const delay = Math.min(5000, 500 * 2 ** retryRef.current++);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, []);

  const send = useCallback((lm: number[]) => {
    const ws = socketRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;

    // ~600 bytes/frame at 30fps is nothing, but if the socket is genuinely
    // backed up, skipping is the correct response.
    if (ws.bufferedAmount > 32_000) {
      setDroppedFrames((n) => n + 1);
      return;
    }

    ws.send(JSON.stringify({ lm }));
  }, []);

  const reset = useCallback(() => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'reset' }));
  }, []);

  return { connected, send, reset, droppedFrames, status };
}
