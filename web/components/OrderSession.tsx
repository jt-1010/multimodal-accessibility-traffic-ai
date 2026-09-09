'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { CameraStage } from './CameraStage';
import { DetectionPanel } from './DetectionPanel';
import { CaptionPanel } from './CaptionPanel';
import { CartPanel, type Cart } from './CartPanel';
import { MenuGrid, type MenuItem } from './MenuGrid';
import { useSignSocket, type SignEvent } from '@/lib/sign/useSignSocket';
import { useGlossBuffer } from '@/lib/interaction/useGlossBuffer';
import { useSpeech, useSpeechRecognition } from '@/lib/interaction/useSpeech';
import type { CapturedFrame } from '@/lib/mediapipe/landmarks';
import {
  DEFAULT_THRESHOLDS,
  type PresenceState,
  type PresenceThresholds,
} from '@/lib/mediapipe/presence';

/**
 * One ordering session.
 *
 * The design principle worth stating: there is no "select your disability"
 * screen. When someone steps up, the terminal greets them out loud AND in large
 * captions AND shows the menu, then follows whichever channel they answer on.
 * Making a person declare a disability to a machine before it will serve them
 * is slow, and it is the wrong thing to build.
 *
 * Every input path -- sign, speech, touch -- becomes a tagged message to the
 * same agent, so the order stays one conversation no matter how it was placed.
 */

type Props = {
  sessionId: string;
  onSessionEnd: () => void;
};

export function OrderSession({ sessionId, onSessionEnd }: Props) {
  const [presence, setPresence] = useState<PresenceState>('absent');
  const [handsVisible, setHandsVisible] = useState(0);
  const [shoulderWidth, setShoulderWidth] = useState<number | null>(null);
  const [heldMs, setHeldMs] = useState(0);
  const [thresholds, setThresholds] = useState<PresenceThresholds>(DEFAULT_THRESHOLDS);
  const [showOverlay, setShowOverlay] = useState(true);
  const [cart, setCart] = useState<Cart | null>(null);
  const [menu, setMenu] = useState<Record<string, MenuItem[]>>({});
  const [understood, setUnderstood] = useState<string | null>(null);
  const [lastSign, setLastSign] = useState<SignEvent | null>(null);
  const [muted, setMuted] = useState(false);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/agent', body: { sessionId } }),
    [sessionId],
  );

  // Held in a ref so `onFinish` always runs the latest handler. The Chat
  // instance captures its callbacks once, so a plain closure here would go on
  // reading the `muted` value from the render where the chat was created.
  const finishRef = useRef<(finalText: string) => void>(() => {});

  const { messages, sendMessage, status, error } = useChat({
    transport,
    onFinish: ({ message }) => {
      const text = message.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('');
      finishRef.current(text);
    },
  });
  const speech = useSpeech();
  const greetedRef = useRef(false);

  // --- The assistant's current line, for captions and TTS -------------------
  const assistantText = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!last) return '';
    return last.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('');
  }, [messages]);

  const send = useCallback(
    (text: string) => {
      speech.cancel();
      speech.reset();
      sendMessage({ text });
    },
    [sendMessage, speech],
  );

  // --- Sign input ----------------------------------------------------------
  const glossBuffer = useGlossBuffer(
    useCallback(
      (glosses: string[]) => {
        const phrase = glosses.join(' ');
        setUnderstood(`Signed: ${phrase}`);
        send(`[SIGN] ${phrase}`);
      },
      [send],
    ),
  );

  const sign = useSignSocket(
    useCallback(
      (event: SignEvent) => {
        setLastSign(event);
        glossBuffer.add(event.label);
      },
      [glossBuffer],
    ),
  );

  // --- Speech input --------------------------------------------------------
  const recognition = useSpeechRecognition(
    useCallback(
      (text: string) => {
        setUnderstood(`Heard: ${text}`);
        send(`[SPEECH] ${text}`);
      },
      [send],
    ),
  );

  // --- Camera frames -------------------------------------------------------
  const handleFrame = useCallback(
    (frame: CapturedFrame) => {
      setPresence(frame.presence);
      setHandsVisible(frame.handsVisible);
      setShoulderWidth(frame.shoulderWidth);
      setHeldMs(frame.heldMs);
      // Only stream landmarks while someone is actually there. Feeding an empty
      // frame to the recogniser all day is wasted CPU and wasted bandwidth.
      if (frame.presence === 'present') sign.send(frame.lm);
    },
    [sign],
  );

  const handleArrive = useCallback(() => {
    if (greetedRef.current) return;
    greetedRef.current = true;
    send('[PRESENCE] A customer has just stepped up to the counter.');
  }, [send]);

  const handleDepart = useCallback(() => {
    glossBuffer.clear();
    speech.cancel();
    onSessionEnd();
  }, [glossBuffer, speech, onSessionEnd]);

  const updateThresholds = useCallback(
    (next: Partial<PresenceThresholds>) => setThresholds((t) => ({ ...t, ...next })),
    [],
  );

  // --- Speak the response as it streams ------------------------------------
  useEffect(() => {
    if (muted || !assistantText) return;
    speech.speakStreaming(assistantText);
  }, [assistantText, muted, speech]);

  // --- On turn end: finish speaking, refresh the cart -----------------------
  const refreshCart = useCallback(async () => {
    try {
      const res = await fetch(`/api/cart?sessionId=${encodeURIComponent(sessionId)}`);
      if (res.ok) setCart(await res.json());
    } catch {
      // Non-fatal: the caption already told the person what happened.
    }
  }, [sessionId]);

  // Reacting to the finish EVENT rather than to a `status === 'ready'`
  // transition. The turn ending is a real thing that happens once; watching a
  // derived state for it means re-running on every unrelated re-render that
  // lands while the status happens to be 'ready'.
  useEffect(() => {
    finishRef.current = (finalText: string) => {
      if (!muted && finalText) speech.flush(finalText);
      void refreshCart();
    };
  });

  // --- Menu ----------------------------------------------------------------
  useEffect(() => {
    fetch('/api/menu')
      .then((r) => r.json())
      .then((d) => setMenu(d.categories ?? {}))
      .catch(() => setMenu({}));
  }, []);

  const busy = status === 'submitted' || status === 'streaming';

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
      {/* ---------------------------------------------------------------
          Main column. The camera leads: this is a system a person stands in
          front of and signs at, so seeing yourself tracked matters far more
          than browsing a menu. Touch is the fallback path, not the headline,
          and it is sized that way.
         --------------------------------------------------------------- */}
      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <CameraStage
            onFrame={handleFrame}
            onArrive={handleArrive}
            onDepart={handleDepart}
            presence={presence}
            thresholds={thresholds}
            showOverlay={showOverlay}
          />

          <DetectionPanel
            presence={presence}
            shoulderWidth={shoulderWidth}
            heldMs={heldMs}
            handsVisible={handsVisible}
            thresholds={thresholds}
            onChange={updateThresholds}
            showOverlay={showOverlay}
            onToggleOverlay={setShowOverlay}
          />
        </div>

        <CaptionPanel
          assistantText={assistantText}
          understood={understood}
          pendingGlosses={glossBuffer.glosses}
          thinking={busy}
        />

        {error && (
          <p role="alert" className="rounded-xl border border-red-800 bg-red-950 px-5 py-3 text-red-200">
            Something went wrong: {error.message}
          </p>
        )}

        {/* --- Input channels --- */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900 px-5 py-4">
          <button
            type="button"
            onClick={recognition.listening ? recognition.stop : recognition.start}
            disabled={!recognition.supported || busy}
            className="min-h-[3rem] rounded-xl bg-emerald-600 px-6 font-semibold text-white transition hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-40"
          >
            {recognition.listening ? 'Stop listening' : 'Speak'}
          </button>
          <button
            type="button"
            onClick={() => {
              setMuted((m) => !m);
              speech.cancel();
            }}
            aria-pressed={muted}
            className="min-h-[3rem] rounded-xl border border-slate-600 px-5 font-semibold text-slate-200 transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>

          <div className="ml-auto flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <StatusRow
              label="Signs"
              ok={sign.connected}
              okText={lastSign ? `${lastSign.label} · ${lastSign.latencyMs}ms` : 'listening'}
              badText="offline"
            />
            <StatusRow
              label="Voice in"
              ok={recognition.supported}
              okText={recognition.listening ? 'listening' : 'ready'}
              badText="unsupported"
            />
            <StatusRow
              label="Voice out"
              ok={speech.supported && !muted}
              okText={speech.speaking ? 'speaking' : 'ready'}
              badText={muted ? 'muted' : 'unsupported'}
            />
          </div>
        </div>

        {/* --- Touch fallback: present, but deliberately secondary --- */}
        <details className="rounded-2xl border border-slate-800 bg-slate-950/60">
          <summary className="cursor-pointer px-5 py-3 text-sm font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-200">
            Browse the menu instead
          </summary>
          <div className="max-h-80 overflow-y-auto px-5 pb-5">
            <MenuGrid
              categories={menu}
              disabled={busy}
              onPick={(item) => {
                setUnderstood(`Tapped: ${item.name}`);
                send(`[TOUCH] Add one ${item.name}.`);
              }}
            />
          </div>
        </details>
      </div>

      {/* --- Right rail: the order --- */}
      <CartPanel cart={cart} />
    </div>
  );
}


function StatusRow({
  label,
  ok,
  okText,
  badText,
}: {
  label: string;
  ok: boolean;
  okText: string;
  badText: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className={ok ? 'text-emerald-400' : 'text-amber-400'}>
        <span aria-hidden="true">{ok ? '●' : '○'} </span>
        {ok ? okText : badText}
      </span>
    </div>
  );
}
