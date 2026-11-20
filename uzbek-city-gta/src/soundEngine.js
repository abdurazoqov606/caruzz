// Offline Web Audio API + MP3 ovoz tizimi (qotishsiz va internetsiz ishlaydi)
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.radioAudio = null;
    this.radioOn = false;
    this.radioBeatTimer = null;
    this.unlocked = false;
  }

  unlock() {
    if (this.unlocked) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    this.unlocked = true;
    this._initEngineLoop();
  }

  _initEngineLoop() {
    if (!this.ctx || this.engineOsc) return;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.value = 52;
    filter.type = 'lowpass';
    filter.frequency.value = 180;
    gain.gain.value = 0.0;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();

    this.engineOsc = osc;
    this.engineFilter = filter;
    this.engineGain = gain;
  }

  updateEngine(speedAbs, maxSpeed, isDriving, isGas) {
    if (!this.ctx || !this.engineOsc || !this.engineGain) return;
    const now = this.ctx.currentTime;
    if (!isDriving) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
      return;
    }
    const ratio = Math.min(1, speedAbs / Math.max(1, maxSpeed));
    const targetFreq = 48 + ratio * 135 + (isGas ? 18 : 0);
    const targetFilter = 170 + ratio * 650;
    const targetVol = 0.045 + ratio * 0.065;

    this.engineOsc.frequency.setTargetAtTime(targetFreq, now, 0.06);
    this.engineFilter.frequency.setTargetAtTime(targetFilter, now, 0.08);
    this.engineGain.gain.setTargetAtTime(targetVol, now, 0.08);
  }

  playHorn() {
    this.unlock();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [340, 425].forEach((freq) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.11, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.34);
    });
  }

  playCrash(strength = 1) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(115, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.25);
    gain.gain.setValueAtTime(Math.min(0.25, 0.12 * strength), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  playDoor() {
    this.unlock();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.09);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  playFootstep() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.05);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  setRadioTracks(mp3Url) {
    if (mp3Url) {
      this.radioAudio = new Audio(mp3Url);
      this.radioAudio.loop = true;
      this.radioAudio.volume = 0.55;
    }
  }

  toggleRadio(forceState = null) {
    this.unlock();
    this.radioOn = forceState !== null ? forceState : !this.radioOn;
    if (this.radioOn) {
      if (this.radioAudio) {
        this.radioAudio.play().catch(() => this._startSynthBeat());
      } else {
        this._startSynthBeat();
      }
    } else {
      if (this.radioAudio) this.radioAudio.pause();
      this._stopSynthBeat();
    }
    return this.radioOn;
  }

  _startSynthBeat() {
    if (this.radioBeatTimer || !this.ctx) return;
    let step = 0;
    const bassNotes = [55, 55, 65.4, 73.4, 55, 55, 82.4, 65.4];
    this.radioBeatTimer = setInterval(() => {
      if (!this.radioOn || !this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = step % 2 === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(bassNotes[step % bassNotes.length], now);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
      step++;
    }, 260);
  }

  _stopSynthBeat() {
    if (this.radioBeatTimer) {
      clearInterval(this.radioBeatTimer);
      this.radioBeatTimer = null;
    }
  }
}
