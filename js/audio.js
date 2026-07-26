// FOUR IN A ROWBOAT — tiny procedural WebAudio sounds. No audio files.
// Everything is synthesized: a watery plop when a buoy lands, a little
// fanfare for the winner, a foghorn shrug for a draw.

const LS_MUTED = 'four-in-a-rowboat-muted';

let ctx = null;
let muted = localStorage.getItem(LS_MUTED) === '1';

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, { type = 'sine', gain = 0.16, slide = 0 } = {}) {
  const a = ac();
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export const sound = {
  get muted() {
    return muted;
  },
  toggleMuted() {
    muted = !muted;
    localStorage.setItem(LS_MUTED, muted ? '1' : '0');
    return muted;
  },
  /** Buoy lands — deeper plop the lower the row (row 0 = bottom). */
  plop(row) {
    if (muted) return;
    const base = 300 - row * 28;
    tone(base, 0, 0.12, { type: 'sine', slide: -base * 0.55, gain: 0.22 });
    tone(base * 2.7, 0, 0.05, { type: 'triangle', gain: 0.07 });
  },
  win() {
    if (muted) return;
    [392, 494, 587, 784].forEach((f, i) => tone(f, i * 0.11, 0.24, { type: 'triangle', gain: 0.18 }));
    tone(784, 0.44, 0.5, { type: 'triangle', gain: 0.14 });
  },
  lose() {
    if (muted) return;
    [330, 262, 196].forEach((f, i) => tone(f, i * 0.14, 0.26, { type: 'triangle', gain: 0.15 }));
  },
  draw() {
    if (muted) return;
    tone(220, 0, 0.5, { type: 'sawtooth', gain: 0.06, slide: -40 });
    tone(224, 0, 0.5, { type: 'sawtooth', gain: 0.06, slide: -40 });
  },
};
