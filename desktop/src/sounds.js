// Sons curtos de conexão — sintetizados na hora (WebAudio), sem arquivos.
// Discord-style: entrar/sair de call, alguém entrou/saiu, mutar, ensurdecer,
// conectar/cair do gateway.

let ctx = null;
function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

const KEY = "mula.sounds.off";
export function soundsEnabled() {
  try { return localStorage.getItem(KEY) !== "1"; } catch { return true; }
}
export function setSoundsEnabled(on) {
  try { on ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, "1"); } catch {}
}

// toca uma sequência de tons (freq em Hz), cada um com `dur` segundos
function seq(freqs, { dur = 0.12, type = "sine", gain = 0.16, gap = 0.72 } = {}) {
  if (!soundsEnabled()) return;
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + 0.001;
  freqs.forEach((f, i) => {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.value = f;
    const start = t0 + i * dur * gap;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(a.destination);
    o.start(start);
    o.stop(start + dur + 0.03);
  });
}

export const sfx = {
  joinCall:   () => seq([392, 523, 659], { dur: 0.13 }),
  leaveCall:  () => seq([659, 494, 349], { dur: 0.13 }),
  peerJoin:   () => seq([523, 784], { dur: 0.10, gain: 0.13 }),
  peerLeave:  () => seq([622, 392], { dur: 0.11, gain: 0.13 }),
  mute:       () => seq([340], { dur: 0.06, type: "square", gain: 0.10 }),
  unmute:     () => seq([520], { dur: 0.06, type: "square", gain: 0.10 }),
  deafen:     () => seq([320, 226], { dur: 0.08, type: "square", gain: 0.10 }),
  undeafen:   () => seq([300, 452], { dur: 0.08, type: "square", gain: 0.10 }),
  connect:    () => seq([587, 880], { dur: 0.09, gain: 0.12 }),
  disconnect: () => seq([494, 311], { dur: 0.12, gain: 0.13 }),
  screenOn:   () => seq([700, 940], { dur: 0.08, gain: 0.10 }),
  screenOff:  () => seq([940, 700], { dur: 0.08, gain: 0.10 }),
};
