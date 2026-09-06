import type { FlightState } from "./flight-model";

const clamp = (value: number, maximum = 1) => Number.isFinite(value) ? Math.max(0, Math.min(maximum, value)) : 0;

export function flightAudioLevels(flight: FlightState, windStrength: number, active: boolean) {
  const rotor = active ? clamp(flight.rotorSpeed) : 0;
  const speed = active ? clamp(Math.hypot(flight.velocity.x, flight.velocity.z) / 4) : 0;
  return {
    rotor,
    pitch: 65 + rotor * 155 + clamp(flight.velocity.y, 3) * 9,
    wind: active && flight.position.y > 0.1 ? clamp(windStrength * 0.75 + speed * 0.3) : 0,
  };
}

/** Local synthesis: no recording download, microphone, or paid audio service. */
export class FlightAudioEngine {
  private readonly master: GainNode;
  private readonly rotorGain: GainNode;
  private readonly airGain: GainNode;
  private readonly windGain: GainNode;
  private readonly windFilter: BiquadFilterNode;
  private readonly oscillators: OscillatorNode[] = [];
  private readonly noise: AudioBufferSourceNode;
  private readonly nodes: AudioNode[] = [];
  private readonly impacts = new Set<OscillatorNode>();
  private disposed = false;

  constructor(private readonly context: AudioContext) {
    this.master = context.createGain();
    this.master.gain.value = 0.38;
    this.master.connect(context.destination);
    this.rotorGain = context.createGain();
    this.rotorGain.gain.value = 0;
    const rotorFilter = context.createBiquadFilter();
    rotorFilter.type = "lowpass";
    rotorFilter.frequency.value = 1600;
    rotorFilter.Q.value = 0.4;
    this.rotorGain.connect(rotorFilter).connect(this.master);
    for (const detune of [-21, -7, 9, 24]) {
      const oscillator = context.createOscillator();
      oscillator.type = "sawtooth";
      oscillator.frequency.value = 65;
      oscillator.detune.value = detune;
      oscillator.connect(this.rotorGain);
      oscillator.start();
      this.oscillators.push(oscillator);
    }
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    this.noise = context.createBufferSource();
    this.noise.buffer = buffer;
    this.noise.loop = true;
    const airFilter = context.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.frequency.value = 950;
    airFilter.Q.value = 0.5;
    this.airGain = context.createGain();
    this.airGain.gain.value = 0;
    this.noise.connect(airFilter).connect(this.airGain).connect(this.master);
    this.windFilter = context.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = 380;
    this.windFilter.Q.value = 0.4;
    this.windGain = context.createGain();
    this.windGain.gain.value = 0;
    this.noise.connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.noise.start();
    this.nodes.push(this.master, this.rotorGain, rotorFilter, airFilter, this.airGain, this.windFilter, this.windGain);
  }

  async resume() {
    if (this.disposed) return;
    await this.context.resume();
    if (!this.disposed && this.context.state !== "running") throw new Error("Audio playback is unavailable");
  }

  async suspend() {
    if (!this.disposed && this.context.state === "running") await this.context.suspend();
  }

  update(flight: FlightState, windStrength: number, active: boolean) {
    if (this.disposed) return;
    const levels = flightAudioLevels(flight, windStrength, active);
    const now = this.context.currentTime;
    this.rotorGain.gain.setTargetAtTime(levels.rotor * 0.055, now, 0.12);
    this.airGain.gain.setTargetAtTime(levels.rotor * 0.1, now, 0.15);
    this.windGain.gain.setTargetAtTime(levels.wind * 0.32, now, 0.3);
    this.windFilter.frequency.setTargetAtTime(300 + levels.wind * 750, now, 0.3);
    for (const oscillator of this.oscillators) oscillator.frequency.setTargetAtTime(levels.pitch, now, 0.12);
  }

  touchdown(strength: number) {
    if (this.disposed || this.context.state !== "running") return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(105, now);
    oscillator.frequency.exponentialRampToValueAtTime(42, now + 0.17);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18 * clamp(strength), now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.connect(gain).connect(this.master);
    this.impacts.add(oscillator);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      this.impacts.delete(oscillator);
    };
    oscillator.start();
    oscillator.stop(now + 0.2);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.value = 0;
    for (const oscillator of [...this.oscillators, ...this.impacts]) {
      oscillator.stop();
      oscillator.disconnect();
    }
    this.noise.stop();
    this.noise.disconnect();
    for (const node of this.nodes) node.disconnect();
    void this.context.close().catch(() => {});
  }
}
