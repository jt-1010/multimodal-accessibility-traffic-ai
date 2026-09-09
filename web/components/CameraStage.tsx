'use client';

import { useEffect, useRef, useState } from 'react';
import { LandmarkEngine, type CapturedFrame } from '@/lib/mediapipe/landmarks';
import type { PresenceState, PresenceThresholds } from '@/lib/mediapipe/presence';

type Props = {
  onFrame: (frame: CapturedFrame) => void;
  onArrive: () => void;
  onDepart: () => void;
  presence: PresenceState;
  thresholds: PresenceThresholds;
  showOverlay: boolean;
};

const PRESENCE_LABEL: Record<PresenceState, string> = {
  absent: 'Waiting for someone',
  arriving: 'Someone is approaching',
  present: 'Ready — go ahead',
  leaving: 'Session ending',
};

const PRESENCE_COLOR: Record<PresenceState, string> = {
  absent: 'text-slate-400',
  arriving: 'text-amber-400',
  present: 'text-emerald-400',
  leaving: 'text-amber-400',
};

/**
 * Pose connections worth drawing: the upper body the classifier actually uses.
 * MediaPipe emits 33 pose points; the legs tell us nothing about signing.
 */
const POSE_EDGES: [number, number][] = [
  [11, 12], // shoulders
  [11, 13],
  [13, 15], // left arm
  [12, 14],
  [14, 16], // right arm
  [11, 23],
  [12, 24],
  [23, 24], // torso
];

/** MediaPipe hand topology: wrist to each fingertip. */
const HAND_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

export function CameraStage({
  onFrame,
  onArrive,
  onDepart,
  presence,
  thresholds,
  showOverlay,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<LandmarkEngine | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [message, setMessage] = useState('Loading recognition models');

  // Callbacks change every render; hold them in refs so the camera is not torn
  // down and re-acquired on each one (which makes the webcam LED strobe).
  const cbs = useRef({ onFrame, onArrive, onDepart, showOverlay });

  useEffect(() => {
    cbs.current = { onFrame, onArrive, onDepart, showOverlay };
  });

  // Push threshold edits into the running tracker without restarting anything.
  useEffect(() => {
    engineRef.current?.setThresholds(thresholds);
  }, [thresholds]);

  useEffect(() => {
    const engine = new LandmarkEngine();
    engineRef.current = engine;
    let stream: MediaStream | undefined;
    let cancelled = false;

    (async () => {
      try {
        await engine.init();
        if (cancelled) return;

        setMessage('Requesting camera');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        engine.start(video, (frame) => {
          cbs.current.onFrame(frame);
          if (cbs.current.showOverlay) draw(frame);
          if (frame.arrived) cbs.current.onArrive();
          if (frame.departed) cbs.current.onDepart();
        });

        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        const denied = err instanceof DOMException && err.name === 'NotAllowedError';
        setStatus(denied ? 'denied' : 'error');
        setMessage(
          denied
            ? 'Camera access was blocked. Sign language input needs the camera.'
            : `Could not start the camera: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();

    function draw(frame: CapturedFrame) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video || !video.videoWidth) return;

      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);

      const { pose, left, right } = frame.overlay;

      const line = (
        pts: { x: number; y: number }[],
        edges: [number, number][],
        color: string,
        lw: number,
      ) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';
        for (const [a, b] of edges) {
          const p = pts[a];
          const q = pts[b];
          if (!p || !q) continue;
          ctx.beginPath();
          ctx.moveTo(p.x * w, p.y * h);
          ctx.lineTo(q.x * w, q.y * h);
          ctx.stroke();
        }
      };

      const dots = (pts: { x: number; y: number }[], color: string, r: number) => {
        ctx.fillStyle = color;
        for (const p of pts) {
          if (!p) continue;
          ctx.beginPath();
          ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
          ctx.fill();
        }
      };

      if (pose) {
        const ok = frame.presence === 'present';
        line(pose, POSE_EDGES, ok ? '#34d399' : '#fbbf24', 5);
        dots(
          [11, 12, 13, 14, 15, 16, 23, 24, 0].map((i) => pose[i]).filter(Boolean),
          ok ? '#6ee7b7' : '#fcd34d',
          6,
        );

        // The shoulder line is the presence signal, so draw it as the measurement.
        const l = pose[11];
        const r = pose[12];
        if (l && r) {
          ctx.strokeStyle = ok ? '#34d399' : '#fbbf24';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 6]);
          ctx.beginPath();
          ctx.moveTo(l.x * w, l.y * h);
          ctx.lineTo(r.x * w, r.y * h);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Hands in a distinct colour: this is what the sign classifier reads.
      if (left) {
        line(left, HAND_EDGES, '#60a5fa', 3);
        dots(left, '#93c5fd', 3.5);
      }
      if (right) {
        line(right, HAND_EDGES, '#c084fc', 3);
        dots(right, '#d8b4fe', 3.5);
      }
    }

    return () => {
      cancelled = true;
      engine.close();
      engineRef.current = null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
      {/*
        Mirrored so moving your right hand moves the right side of the image.
        An unmirrored preview is genuinely disorienting to sign in front of.
        The canvas is mirrored with it so the skeleton stays on the body.
      */}
      <div className="relative aspect-video w-full scale-x-[-1]">
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
        {showOverlay && (
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0 h-full w-full"
          />
        )}
      </div>

      {status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/95 p-6 text-center">
          <p className="max-w-sm text-slate-300">{message}</p>
        </div>
      )}

      <div
        aria-live="polite"
        className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-3 bg-gradient-to-t from-slate-950/95 to-transparent px-5 pb-4 pt-10"
      >
        <span className={`text-lg font-semibold ${PRESENCE_COLOR[presence]}`}>
          <span aria-hidden="true">{presence === 'present' ? '●' : '○'} </span>
          {PRESENCE_LABEL[presence]}
        </span>
      </div>
    </div>
  );
}
