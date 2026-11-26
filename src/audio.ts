import { clamp } from './math';

export class StormAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private volume = 0.65;

  public unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.volume;
    this.masterGain.connect(this.ctx.destination);

    // Continuous synthesized jet engine roar (filtered noise + low turbine hum)
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuf = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'bandpass';
    this.engineFilter.frequency.value = 180;
    this.engineFilter.Q.value = 0.9;

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.0;

    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 58;
    const oscGain = this.ctx.createGain();
    oscGain.gain.value = 0.14;

    noise.connect(this.engineFilter);
    this.engineOsc.connect(oscGain);
    oscGain.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    noise.start();
    this.engineOsc.start();
  }

  public setVolume(v: number): void {
    this.volume = clamp(v, 0, 1);
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
    }
  }

  public updateEngine(active: boolean, speedRatio: number, boosting: boolean): void {
    if (!this.ctx || !this.engineGain || !this.engineFilter || !this.engineOsc) return;
    const now = this.ctx.currentTime;
    const targetGain = active ? (boosting ? 0.22 : 0.09 + speedRatio * 0.08) : 0;
    const targetFreq = boosting ? 480 : 140 + speedRatio * 220;
    const targetPitch = boosting ? 92 : 48 + speedRatio * 34;

    this.engineGain.gain.setTargetAtTime(targetGain, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(targetFreq, now, 0.08);
    this.engineOsc.frequency.setTargetAtTime(targetPitch, now, 0.08);
  }

  private tone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType,
    gainPeak: number
  ): void {
    if (!this.ctx || !this.masterGain || this.volume <= 0.01) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);
    }
    g.gain.setValueAtTime(gainPeak, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  public playUiClick(): void {
    this.tone(540, 760, 0.05, 'square', 0.08);
  }

  public playUiHover(): void {
    this.tone(360, 420, 0.03, 'triangle', 0.04);
  }

  public playCannon(): void {
    this.tone(240 + Math.random() * 60, 68, 0.055, 'sawtooth', 0.11);
  }

  public playMissile(): void {
    this.tone(180, 620, 0.26, 'sawtooth', 0.14);
    this.tone(90, 45, 0.3, 'triangle', 0.14);
  }

  public playExplosion(near: boolean): void {
    this.tone(near ? 130 : 90, 26, near ? 0.42 : 0.24, 'sawtooth', near ? 0.24 : 0.09);
  }

  public playHit(kill: boolean): void {
    if (kill) {
      this.tone(620, 1240, 0.14, 'square', 0.14);
    } else {
      this.tone(880, 520, 0.045, 'square', 0.09);
    }
  }

  public playFlare(): void {
    this.tone(920, 320, 0.16, 'triangle', 0.12);
  }

  public playAbility(): void {
    this.tone(340, 980, 0.22, 'triangle', 0.14);
  }

  public playLockTick(locked: boolean): void {
    this.tone(locked ? 1320 : 880, locked ? 1320 : 880, 0.045, 'square', locked ? 0.09 : 0.05);
  }

  public playWarning(): void {
    this.tone(1040, 720, 0.11, 'sawtooth', 0.12);
  }

  public playLaunch(): void {
    this.tone(140, 560, 0.35, 'sawtooth', 0.18);
  }
}
