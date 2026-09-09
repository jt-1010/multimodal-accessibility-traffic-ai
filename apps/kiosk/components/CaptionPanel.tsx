'use client';

type Props = {
  assistantText: string;
  understood: string | null;
  pendingGlosses: string[];
  thinking: boolean;
};

/**
 * The conversation, rendered for someone who cannot hear it.
 *
 * Captions are not a transcript pane. They are the primary output channel for
 * a Deaf user, which is why the assistant's current line gets display-size
 * type and the highest contrast on the page, and why what the system THINKS it
 * understood is shown separately -- a misrecognised sign should be visible and
 * correctable, not silently acted on.
 */
export function CaptionPanel({ assistantText, understood, pendingGlosses, thinking }: Props) {
  return (
    <section aria-label="Conversation" className="flex flex-col gap-4">
      <div
        aria-live="polite"
        aria-atomic="true"
        className="min-h-[9rem] rounded-2xl border border-slate-700 bg-slate-900 px-7 py-6"
      >
        <p className="text-xs uppercase tracking-widest text-slate-500">Kiosk</p>
        <p className="mt-2 text-3xl font-medium leading-snug text-white">
          {assistantText || (thinking ? 'One moment…' : 'Step up to begin.')}
          {thinking && assistantText && (
            <span className="ml-1 inline-block animate-pulse text-emerald-400">▌</span>
          )}
        </p>
      </div>

      <div className="min-h-[4.5rem] rounded-2xl border border-slate-800 bg-slate-950 px-7 py-4">
        <p className="text-xs uppercase tracking-widest text-slate-500">Understood</p>
        {pendingGlosses.length > 0 ? (
          <p className="mt-1 flex flex-wrap gap-2">
            {pendingGlosses.map((g, i) => (
              <span
                key={`${g}-${i}`}
                className="rounded-md bg-emerald-500/15 px-2.5 py-1 font-mono text-lg text-emerald-300"
              >
                {g}
              </span>
            ))}
            <span className="self-center text-sm text-slate-500">…still signing</span>
          </p>
        ) : (
          <p className="mt-1 text-lg text-slate-300">{understood ?? '—'}</p>
        )}
      </div>
    </section>
  );
}
