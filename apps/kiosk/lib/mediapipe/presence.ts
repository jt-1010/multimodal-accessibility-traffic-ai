import { PRESENCE } from './featureSpec';

/**
 * "Is someone standing at the kiosk?"
 *
 * Pose detection does double duty here: the same model that gives us shoulder
 * and wrist landmarks for signing also tells us a person is there, so we do not
 * pay for a third model just to notice someone walked up.
 *
 * The two timers are the whole design. Greeting on the first detected frame
 * means greeting everyone who walks past; ending the session on the first
 * missed frame means the kiosk gives up every time tracking blinks. Requiring
 * sustained presence to enter and sustained absence to leave makes both stable.
 */
export type PresenceState = 'absent' | 'arriving' | 'present' | 'leaving';

export class PresenceTracker {
  private state: PresenceState = 'absent';
  private since = 0;

  /**
   * @param shoulderWidth normalised distance between shoulders, or null if no
   *   pose was detected this frame. Doubles as a proximity proxy: a person
   *   across the room has narrow shoulders in normalised coordinates.
   */
  update(shoulderWidth: number | null, now = performance.now()): PresenceState {
    const seen = shoulderWidth !== null && shoulderWidth >= PRESENCE.minShoulderWidth;

    switch (this.state) {
      case 'absent':
        if (seen) this.transition('arriving', now);
        break;

      case 'arriving':
        if (!seen) this.transition('absent', now);
        else if (now - this.since >= PRESENCE.enterMs) this.transition('present', now);
        break;

      case 'present':
        if (!seen) this.transition('leaving', now);
        break;

      case 'leaving':
        if (seen) this.transition('present', now);
        else if (now - this.since >= PRESENCE.exitMs) this.transition('absent', now);
        break;
    }

    return this.state;
  }

  /** True on the single frame where a person becomes established. */
  private justArrived = false;
  private justLeft = false;

  private transition(next: PresenceState, now: number) {
    if (next === 'present' && this.state === 'arriving') this.justArrived = true;
    if (next === 'absent' && this.state === 'leaving') this.justLeft = true;
    this.state = next;
    this.since = now;
  }

  /** Consume the arrival edge. Returns true once per arrival. */
  takeArrival(): boolean {
    const v = this.justArrived;
    this.justArrived = false;
    return v;
  }

  /** Consume the departure edge. Returns true once per departure. */
  takeDeparture(): boolean {
    const v = this.justLeft;
    this.justLeft = false;
    return v;
  }

  get current(): PresenceState {
    return this.state;
  }

  reset() {
    this.state = 'absent';
    this.since = 0;
    this.justArrived = false;
    this.justLeft = false;
  }
}
