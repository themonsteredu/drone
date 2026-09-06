import type { FlightState } from "./flight-model";

export interface TouchdownSignal {
  sequence: number;
  strength: number;
}

/** Presentation feedback observes ground contact without changing flight physics. */
export class FlightFeedbackTracker {
  private airborne = false;
  private previousDescent = 0;
  private signal: TouchdownSignal = { sequence: 0, strength: 0 };

  reset() {
    this.airborne = false;
    this.previousDescent = 0;
  }

  update(flight: FlightState): TouchdownSignal {
    if (flight.phase === "ARMING") {
      this.reset();
      return this.signal;
    }
    if (flight.position.y > 0.2) this.airborne = true;
    if (this.airborne && flight.position.y <= 0.02) {
      this.signal = {
        sequence: this.signal.sequence + 1,
        strength: Math.max(0.18, Math.min(1, this.previousDescent / 1.5)),
      };
      this.airborne = false;
    }
    if (flight.phase === "READY") this.reset();
    this.previousDescent = Math.max(0, -flight.velocity.y);
    return this.signal;
  }

  getSignal(): TouchdownSignal { return this.signal; }
}

/** A few millimetres of settling; gear never sinks into the landing surface. */
export function touchdownSettlingOffset(ageSeconds: number, strength: number): number {
  if (ageSeconds < 0 || ageSeconds >= 0.65) return 0;
  return Math.sin((ageSeconds / 0.65) * Math.PI) * Math.exp(-ageSeconds * 6) * 0.035 * Math.max(0, Math.min(1, strength));
}
