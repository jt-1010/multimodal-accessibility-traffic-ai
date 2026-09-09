'use client';

import { useCallback, useState } from 'react';
import { OrderSession } from './OrderSession';

/**
 * Owns the session lifetime.
 *
 * The base id comes from the server, so there is nothing random generated
 * during render and nothing to reconcile at hydration. Ending a session just
 * bumps a counter: the derived id changes, `key` changes, and React discards
 * the whole subtree - conversation, captions, cart, camera state - in one go.
 * No teardown logic to keep in sync with the state it is meant to clear.
 */
export function SessionShell({
  baseSessionId,
  tuning = false,
}: {
  baseSessionId: string;
  tuning?: boolean;
}) {
  const [generation, setGeneration] = useState(0);
  const sessionId = `${baseSessionId}-${generation}`;

  const startNewSession = useCallback(() => setGeneration((g) => g + 1), []);

  return (
    <OrderSession
      key={sessionId}
      sessionId={sessionId}
      onSessionEnd={startNewSession}
      tuning={tuning}
    />
  );
}
