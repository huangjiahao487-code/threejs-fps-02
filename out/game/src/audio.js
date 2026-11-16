// Every sound is synthesized with Web Audio: no audio files, no network. One shared
// noise buffer, one master gain; each effect is a few oscillators or a filtered burst.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let unlocked = false;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 0.5);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
      unlocked = true;
    } catch {
      ctx = null;
    }
    return !!ctx;
  }

  function unlock() {
    if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function noise(dur, filterFreq, filterType, gain, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t, Math.random() * 0.2);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, type, gain, slideTo = 0, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // distance 0 (own gun) to 1 (far away): quieter and duller with distance.
  function shot(kind, distance = 0) {
    if (!ensure()) return;
    const vol = 0.55 * (1 - distance * 0.75);
    if (kind === 'dmr') {
      noise(0.22, 900, 'lowpass', vol);
      tone(140, 0.18, 'sine', vol * 0.9, 45);
    } else if (kind === 'smg') {
      noise(0.09, 2400, 'bandpass', vol * 0.8);
      tone(220, 0.07, 'square', vol * 0.25, 90);
    } else if (kind === 'pistol') {
      noise(0.11, 1800, 'bandpass', vol * 0.9);
      tone(180, 0.09, 'sine', vol * 0.5, 70);
    } else {
      noise(0.14, 1500, 'bandpass', vol);
      tone(160, 0.12, 'sine', vol * 0.6, 55);
    }
  }

  return {
    unlock,
    shot,
    dryFire() { tone(1200, 0.03, 'square', 0.08); },
    reload() {
      tone(500, 0.05, 'square', 0.12);
      tone(700, 0.05, 'square', 0.12, 0, 0.18);
      tone(900, 0.06, 'square', 0.14, 0, 0.45);
    },
    hit() { tone(1500, 0.05, 'sine', 0.2); },
    headshot() { tone(1900, 0.09, 'sine', 0.25); tone(2400, 0.07, 'sine', 0.15, 0, 0.05); },
    kill() { tone(660, 0.08, 'triangle', 0.2); tone(990, 0.12, 'triangle', 0.2, 0, 0.07); },
    hurt() { noise(0.12, 500, 'lowpass', 0.3); tone(110, 0.15, 'sine', 0.25, 60); },
    step() { noise(0.05, 700, 'lowpass', 0.05); },
    plantTick(final) { tone(final ? 1400 : 950, 0.06, 'sine', 0.18); },
    beep() { tone(1100, 0.09, 'sine', 0.2); },
    explosion() {
      noise(0.9, 300, 'lowpass', 0.9);
      tone(60, 0.8, 'sine', 0.8, 28);
      noise(0.3, 3000, 'highpass', 0.25);
    },
    flash() { noise(0.4, 5000, 'highpass', 0.4); tone(2400, 0.3, 'sine', 0.12, 1200); },
    roundWin() { [523, 659, 784].forEach((f, i) => tone(f, 0.16, 'triangle', 0.2, 0, i * 0.11)); },
    roundLose() { [392, 330, 262].forEach((f, i) => tone(f, 0.18, 'triangle', 0.18, 0, i * 0.12)); },
    buy() { tone(880, 0.06, 'sine', 0.15); tone(1320, 0.08, 'sine', 0.12, 0, 0.06); },
    denied() { tone(220, 0.12, 'square', 0.12); },
    click() { tone(700, 0.04, 'sine', 0.12); },
  };
}
