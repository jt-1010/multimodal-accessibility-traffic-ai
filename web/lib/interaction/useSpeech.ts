'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * Text-to-speech and speech-to-text via the Web Speech API.
 *
 * TTS speaks sentence by sentence as the response streams, rather than waiting
 * for the whole message. On a two-sentence reply that is roughly a second of
 * perceived latency removed for a blind user, who has nothing to look at while
 * the text fills in -- for them the spoken output IS the interface, so its
 * latency is the system's latency.
 */

// The Web Speech API is not in TypeScript's DOM lib. Minimal shapes only.
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

/**
 * Capability detection that survives server rendering.
 *
 * `typeof window` checks during render cause a hydration mismatch, and setting
 * the flag in an effect causes a cascading render. useSyncExternalStore exists
 * for exactly this: it hands React a different snapshot on the server (false)
 * and the client (the real answer) without either problem.
 */
const NEVER_CHANGES = () => () => {};
const serverFalse = () => false;

/** Split off complete sentences, leaving any trailing partial behind. */
function completeSentences(text: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  const re = /[^.!?]+[.!?]+[\s"')\]]*/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    sentences.push(m[0].trim());
    lastIndex = re.lastIndex;
  }

  return { sentences, rest: text.slice(lastIndex) };
}

export function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const spokenUpTo = useRef(0);

  const supported = useSyncExternalStore(
    NEVER_CHANGES,
    () => 'speechSynthesis' in window,
    serverFalse,
  );

  const enqueue = useCallback((text: string) => {
    if (!text.trim() || typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.02;
    utterance.pitch = 1.0;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(window.speechSynthesis.pending);
    window.speechSynthesis.speak(utterance);
  }, []);

  /**
   * Feed the growing assistant message. Speaks each sentence once, the moment
   * it is complete.
   */
  const speakStreaming = useCallback(
    (fullText: string) => {
      const pending = fullText.slice(spokenUpTo.current);
      const { sentences, rest } = completeSentences(pending);
      if (sentences.length === 0) return;

      spokenUpTo.current = fullText.length - rest.length;
      for (const s of sentences) enqueue(s);
    },
    [enqueue],
  );

  /** Flush whatever is left when the stream ends mid-sentence. */
  const flush = useCallback(
    (fullText: string) => {
      const rest = fullText.slice(spokenUpTo.current).trim();
      spokenUpTo.current = fullText.length;
      if (rest) enqueue(rest);
    },
    [enqueue],
  );

  const reset = useCallback(() => {
    spokenUpTo.current = 0;
  }, []);

  const cancel = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  return { speakStreaming, flush, reset, cancel, speaking, supported };
}

export function useSpeechRecognition(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(onTranscript);

  // Written after render, never during it: a ref mutated mid-render can be
  // read by a concurrent render that then sees a stale callback.
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  });

  const supported = useSyncExternalStore(
    NEVER_CHANGES,
    () => Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition),
    serverFalse,
  );

  useEffect(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;

    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      const text = last?.[0]?.transcript?.trim();
      if (text) onTranscriptRef.current(text);
    };
    rec.onerror = (e) => {
      // 'no-speech' and 'aborted' are routine, not failures worth logging.
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('[speech] recognition error:', e.error);
      }
    };
    rec.onend = () => setListening(false);

    recRef.current = rec;
    return () => rec.abort();
  }, []);

  const start = useCallback(() => {
    if (!recRef.current || listening) return;
    try {
      recRef.current.start();
      setListening(true);
    } catch {
      // start() throws if already running; harmless.
    }
  }, [listening]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  return { start, stop, listening, supported };
}
