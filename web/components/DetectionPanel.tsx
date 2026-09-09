'use client';

import type { PresenceState, PresenceThresholds } from '@/lib/mediapipe/presence';

type Props = {
  presence: PresenceState;
  shoulderWidth: number | null;
  heldMs: number;
  handsVisible: number;
  bodyDetected: boolean;
  rawDropouts: number;
  thresholds: PresenceThresholds;
  onChange: (next: Partial<PresenceThresholds>) => void;
  showOverlay: boolean;
  onToggleOverlay: (v: boolean) => void;
};

/**
 * Live view of the presence detector, with its thresholds exposed.
 *
 * These numbers cannot be derived from first principles. How wide a person's
 * shoulders appear depends on the lens, the camera height, and how far back
 * the counter is -- so the defaults in the code are guesses, and the only way
 * to get them right is to stand in front of the real camera and watch the
 * measurement. This panel is that instrument.
 *
 * The bar is the whole point: it shows the measured shoulder width against
 * the threshold in real time, so "it didn't notice me" becomes "I read 0.09
 * standing where I stand, and the gate is at 0.12."
 */
export function DetectionPanel({
  presence,
  shoulderWidth,
  heldMs,
  handsVisible,
  bodyDetected,
  rawDropouts,
  thresholds,
  onChange,
  showOverlay,
  onToggleOverlay,
}: Props) {
  const measured = shoulderWidth ?? 0;
  // Scaled against 3x the threshold so the marker sits mid-bar at typical range.
  const pct = Math.min(100, (measured / (thresholds.minShoulderWidth * 3)) * 100);
  const gatePct = Math.min(100, (1 / 3) * 100);
  const over = shoulderWidth !== null && measured >= thresholds.minShoulderWidth;

  // How far through the enter/exit dwell timer we are.
  const dwellTarget =
    presence === 'arriving' ? thresholds.enterMs : presence === 'leaving' ? thresholds.exitMs : 0;
  const dwellPct = dwellTarget ? Math.min(100, (heldMs / dwellTarget) * 100) : 0;

  return (
    <section
      aria-label="Person detection"
      className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 px-5 py-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
          Person detection
        </h2>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={showOverlay}
            onChange={(e) => onToggleOverlay(e.target.checked)}
            className="h-4 w-4 accent-emerald-500"
          />
          Skeleton
        </label>
      </div>

      {/*
        Raw model output vs. what we act on.

        This exists to answer "why not just use the model directly?" with
        evidence instead of assertion. Stand still and watch: the raw row
        flickers as tracking drops on a turn, a raised hand, or a backlit
        frame. Every one of those flickers, acted on directly, would be a
        cleared cart.
      */}
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-950 p-3 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500">Raw model</p>
          <p className={bodyDetected ? 'font-mono text-slate-200' : 'font-mono text-slate-500'}>
            {bodyDetected ? 'body found' : 'no body'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {rawDropouts === 0 ? 'steady' : `${rawDropouts} dropouts / 30s`}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500">After gating</p>
          <p
            className={
              presence === 'present' ? 'font-mono text-emerald-400' : 'font-mono text-slate-400'
            }
          >
            {presence}
          </p>
          <p className="mt-1 text-xs text-slate-500">what the terminal acts on</p>
        </div>
      </div>

      {/* --- the measurement --- */}
      <div>
        <div className="mb-1 flex items-baseline justify-between text-sm">
          <span className="text-slate-400">Shoulder width</span>
          <span className={`tabular-nums ${over ? 'text-emerald-400' : 'text-slate-300'}`}>
            {shoulderWidth === null ? 'no body detected' : measured.toFixed(3)}
          </span>
        </div>
        <div className="relative h-3 overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full transition-[width] duration-100 ${
              over ? 'bg-emerald-500' : 'bg-slate-500'
            }`}
            style={{ width: `${pct}%` }}
          />
          {/* The gate itself, drawn on the bar rather than described in text. */}
          <div
            className="absolute inset-y-0 w-0.5 bg-amber-400"
            style={{ left: `${gatePct}%` }}
            aria-hidden="true"
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Amber line is the threshold. Bar must pass it for the terminal to see you.
        </p>
      </div>

      {/* --- the dwell timer --- */}
      {dwellTarget > 0 && (
        <div>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="text-slate-400">
              {presence === 'arriving' ? 'Confirming arrival' : 'Confirming departure'}
            </span>
            <span className="tabular-nums text-slate-300">
              {(heldMs / 1000).toFixed(1)}s / {(dwellTarget / 1000).toFixed(1)}s
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full bg-amber-400" style={{ width: `${dwellPct}%` }} />
          </div>
        </div>
      )}

      <dl className="flex justify-between text-sm">
        <div>
          <dt className="text-slate-500">State</dt>
          <dd className="font-mono text-slate-200">{presence}</dd>
        </div>
        <div className="text-right">
          <dt className="text-slate-500">Hands tracked</dt>
          <dd className="font-mono text-slate-200">{handsVisible} / 2</dd>
        </div>
      </dl>

      {/* --- the knobs --- */}
      <div className="space-y-3 border-t border-slate-800 pt-3">
        <Slider
          label="Detect at"
          hint="lower = notices people further away"
          value={thresholds.minShoulderWidth}
          min={0.04}
          max={0.4}
          step={0.005}
          format={(v) => v.toFixed(3)}
          onChange={(minShoulderWidth) => onChange({ minShoulderWidth })}
        />
        <Slider
          label="Greet after"
          hint="higher = ignores people walking past"
          value={thresholds.enterMs}
          min={0}
          max={5000}
          step={100}
          format={(v) => `${(v / 1000).toFixed(1)}s`}
          onChange={(enterMs) => onChange({ enterMs })}
        />
        <Slider
          label="End after"
          hint="higher = survives tracking dropouts"
          value={thresholds.exitMs}
          min={1000}
          max={15000}
          step={500}
          format={(v) => `${(v / 1000).toFixed(1)}s`}
          onChange={(exitMs) => onChange({ exitMs })}
        />
      </div>
    </section>
  );
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="tabular-nums text-emerald-400">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-emerald-500"
      />
      <span className="text-xs text-slate-500">{hint}</span>
    </label>
  );
}
