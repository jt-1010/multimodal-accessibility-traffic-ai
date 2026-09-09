'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Collects recognised signs into a phrase before sending it to the agent.
 *
 * Sending each sign the moment it is recognised would be a mistake. "BURGER"
 * alone is ambiguous - the person may be about to sign "TWO", or "NO CHEESE".
 * Firing on the first sign means the agent commits to an interpretation
 * halfway through the sentence and then has to be argued out of it.
 *
 * So we wait for a gap. Signers pause between phrases the same way speakers do,
 * and that pause is the natural sentence boundary. Terminator signs jump the
 * queue because a person who has just signed FINISH should not have to wait
 * out a timer.
 */

const PHRASE_GAP_MS = 1800;
const TERMINATORS = new Set(['FINISH', 'DONE', 'THAT-ALL', 'THANK-YOU']);

export function useGlossBuffer(onPhrase: (glosses: string[]) => void) {
  const [glosses, setGlosses] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferRef = useRef<string[]>([]);
  const onPhraseRef = useRef(onPhrase);

  useEffect(() => {
    onPhraseRef.current = onPhrase;
  });

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;

    const phrase = bufferRef.current;
    bufferRef.current = [];
    setGlosses([]);
    if (phrase.length > 0) onPhraseRef.current(phrase);
  }, []);

  const add = useCallback(
    (label: string) => {
      bufferRef.current = [...bufferRef.current, label];
      setGlosses(bufferRef.current);

      if (timerRef.current) clearTimeout(timerRef.current);

      if (TERMINATORS.has(label)) {
        flush();
        return;
      }

      timerRef.current = setTimeout(flush, PHRASE_GAP_MS);
    },
    [flush],
  );

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    bufferRef.current = [];
    setGlosses([]);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { glosses, add, flush, clear };
}
