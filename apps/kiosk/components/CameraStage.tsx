'use client';

import { useEffect, useRef, useState } from 'react';
import { LandmarkEngine, type CapturedFrame } from '@/lib/mediapipe/landmarks';
import type { PresenceState } from '@/lib/mediapipe/presence';

type Props = {
  onFrame: (frame: CapturedFrame) => void;
  onArrive: () => void;
  onDepart: () => void;
  presence: PresenceState;
  handsVisible: number;
};

const PRESENCE_LABEL: Record<PresenceState, string> = {
  absent: 'Waiting for someone',
  arriving: 'Someone is approaching',
  present: 'Ready',
  leaving: 'Session ending',
};

export function CameraStage({ onFrame, onArrive, onDepart, presence, handsVisible }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [message, setMessage] = useState('Loading recognition models');

  // Callbacks change every render; hold them in refs so the camera is not torn
  // down and re-acquired on each one (which makes the webcam LED strobe).
  const cbs = useRef({ onFrame, onArrive, onDepart });

  useEffect(() => {
    cbs.current = { onFrame, onArrive, onDepart };
  });

  useEffect(() => {
    const engine = new LandmarkEngine();
    let stream: MediaStream | undefined;
    let cancelled = false;

    (async () => {
      try {
        await engine.init();
        if (cancelled) return;

        setMessage('Requesting camera');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
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

    return () => {
      cancelled = true;
      engine.close();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
      <video
        ref={videoRef}
        muted
        playsInline
        // Mirrored so moving your right hand moves the right side of the image.
        // An unmirrored preview is genuinely disorienting to sign in front of.
        className="h-48 w-full scale-x-[-1] object-cover"
      />

      {status !== 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/95 p-4 text-center">
          <p className="text-sm text-slate-300">{message}</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-slate-700 px-3 py-2 text-xs">
        <span
          className={
            presence === 'present'
              ? 'font-semibold text-emerald-400'
              : presence === 'arriving'
                ? 'font-semibold text-amber-400'
                : 'text-slate-400'
          }
        >
          {PRESENCE_LABEL[presence]}
        </span>
        <span className="text-slate-400">
          {handsVisible > 0 ? `${handsVisible} hand${handsVisible > 1 ? 's' : ''} tracked` : 'No hands'}
        </span>
      </div>
    </div>
  );
}
