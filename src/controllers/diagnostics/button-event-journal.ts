import type { ControllerButtonTransition } from "../types";

const BUTTON_COUNT = 16;
const DEFAULT_CAPACITY = 128;

/**
 * Session-scoped journal for decoded controller button packets.
 *
 * The journal records transitions before the diagnostics UI applies its own
 * rendering throttle, so a quick Down -> Up pair remains observable even when
 * both packets arrive in a single Serial read callback.
 */
export class ControllerButtonEventJournal {
  private readonly held = Array.from(
    { length: BUTTON_COUNT },
    () => false,
  );
  private events: ControllerButtonTransition[] = [];
  private sequence = 0;
  private observationSequence = 0;

  constructor(private readonly capacity = DEFAULT_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("Button event journal capacity must be a positive integer.");
    }
  }

  observe(
    mask: number,
    event: number,
    receivedAt: number,
  ): ControllerButtonTransition[] {
    const normalizedMask = mask & 0xffff;
    const appended: ControllerButtonTransition[] = [];
    const observationSequence = ++this.observationSequence;

    for (let index = 0; index < BUTTON_COUNT; index += 1) {
      if ((normalizedMask & (1 << index)) === 0) continue;

      let phase: ControllerButtonTransition["phase"] | null = null;
      if (event === 1 || event === 2) {
        if (!this.held[index]) phase = "down";
        this.held[index] = true;
      } else if (event === 3) {
        if (this.held[index]) phase = "up";
        this.held[index] = false;
      }

      if (phase === null) continue;
      const entry: ControllerButtonTransition = {
        sequence: ++this.sequence,
        observationSequence,
        buttonNumber: index + 1,
        buttonId: `button_bit_${index}`,
        phase,
        at: receivedAt,
      };
      this.events.push(entry);
      appended.push({ ...entry });
    }

    if (this.events.length > this.capacity) {
      this.events = this.events.slice(-this.capacity);
    }
    return appended;
  }

  snapshot(): ControllerButtonTransition[] {
    return this.events.map((entry) => ({ ...entry }));
  }

  pressedSnapshot(): boolean[] {
    return [...this.held];
  }

  reset(): void {
    this.events = [];
    this.sequence = 0;
    this.observationSequence = 0;
    this.held.fill(false);
  }
}
