'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  onSend: (text: string) => void;
  onSpeak: () => void;
  onStopListening: () => void;
  listening: boolean;
  speechSupported: boolean;
  disabled: boolean;
};

/**
 * Type, or talk. Both reach the same agent.
 *
 * Typing is not a developer convenience -- it is a primary accessibility path.
 * Someone who cannot speak and does not sign (or whose signs we cannot yet
 * recognise, which is everyone today) still has to be able to order. A system
 * that only accepts speech and ASL has quietly excluded people with a speech
 * impairment who never learned to sign, people signing a variant we do not
 * cover, and anyone standing in a room too loud for a microphone.
 *
 * It is also the honest fallback: when a modality is unavailable, the answer
 * is another way in, never a dead end.
 */
export function Composer({
  onSend,
  onSpeak,
  onStopListening,
  listening,
  speechSupported,
  disabled,
}: Props) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus on mount so a keyboard-only user can type immediately without
  // tabbing past the camera. Screen-reader users land on a labelled field.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit() {
    const value = text.trim();
    if (!value || disabled) return;
    setText('');
    onSend(value);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="rounded-2xl border border-slate-700 bg-slate-900 p-3"
    >
      <label htmlFor="composer" className="sr-only">
        Type your order
      </label>

      <div className="flex items-end gap-2">
        <textarea
          id="composer"
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter makes a new line.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Type what you would like…"
          disabled={disabled}
          className="max-h-32 min-h-[3rem] flex-1 resize-none rounded-xl bg-slate-950 px-4 py-3 text-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50"
        />

        <button
          type="button"
          onClick={listening ? onStopListening : onSpeak}
          disabled={!speechSupported || disabled}
          aria-pressed={listening}
          title={speechSupported ? 'Order by voice' : 'Voice input is not available in this browser'}
          className={`flex min-h-[3rem] min-w-[3rem] items-center justify-center rounded-xl border px-4 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-40 ${
            listening
              ? 'border-emerald-400 bg-emerald-600 text-white'
              : 'border-slate-600 text-slate-200 hover:bg-slate-800'
          }`}
        >
          {listening ? 'Listening…' : 'Speak'}
        </button>

        <button
          type="submit"
          disabled={disabled || text.trim().length === 0}
          className="min-h-[3rem] rounded-xl bg-emerald-600 px-6 font-semibold text-white transition hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-40"
        >
          Send
        </button>
      </div>

      <p className="mt-2 px-1 text-xs text-slate-500">
        Type, speak, sign, or tap the menu — whichever suits you.
      </p>
    </form>
  );
}
