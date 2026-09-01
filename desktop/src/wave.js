// ============================================================
// A assinatura do Mulla Cord — a linha de sinal.
// Uma waveform que reage ao estado real do app: silêncio quando
// a sala está quieta, uma onda que viaja a cada mensagem, amplitude
// alta enquanto tem gente na call. "Your community, in tune."
// ============================================================

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

export class SignalWave {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{thickness?:number, level?:number, density?:number, glow?:boolean, tune?:boolean}} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.thickness = opts.thickness ?? 1.5;
    this.baseLevel = opts.level ?? 0.16;   // amplitude de repouso (0..1)
    this.level = this.baseLevel;
    this.density = opts.density ?? 9;      // nº de ondulações na largura
    this.glow = opts.glow ?? true;
    this.tune = opts.tune ? 1 : 0;         // ruído de "sintonizando" que decai
    this.ripples = [];                     // { born, strength }
    this.running = false;
    this._t0 = performance.now();
    this._onResize = () => this._resize();
    addEventListener("resize", this._onResize);
    if (typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(canvas);
    }
    this._resize();
  }

  _resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _signalColor() {
    const s = getComputedStyle(document.documentElement);
    return (s.getPropertyValue("--signal") || s.getPropertyValue("--accent") || "#FACC15").trim();
  }

  /** Uma mensagem chegou / algo aconteceu: manda uma onda viajando. */
  pulse(strength = 1) {
    this.ripples.push({ born: performance.now(), strength: Math.min(2, strength) });
    if (this.ripples.length > 20) this.ripples.shift();
    if (!this.running) { this.start(); this._autostop(); }
  }

  /** Amplitude sustentada — ex.: 0 sozinho, ~0.6 com a call cheia. */
  setLevel(target) {
    this._levelTarget = Math.max(this.baseLevel, Math.min(1, target));
    if (!this.running) this.start();
  }

  /** Sequência de abertura: começa como ruído e resolve numa senoide limpa. */
  retune() { this.tune = 1; this.start(); }

  start() {
    if (this.running) return;
    this._resize();
    this.running = true;
    this._loop();
  }

  /** chamar quando o canvas passa de escondido para visível */
  refresh() { this._resize(); this.start(); }

  stop() { this.running = false; }

  destroy() { this.stop(); removeEventListener("resize", this._onResize); }

  // com reduced-motion a linha é estática: desenha uma vez e para
  _autostop() {
    if (!REDUCED) return;
    clearTimeout(this._idleT);
    this._idleT = setTimeout(() => this.stop(), 120);
  }

  _loop() {
    if (!this.running) return;
    const now = performance.now();
    const t = (now - this._t0) / 1000;
    const { ctx, w, h } = this;
    const mid = h / 2;

    ctx.clearRect(0, 0, w, h);

    // aproxima level do alvo
    const tgt = this._levelTarget ?? this.baseLevel;
    this.level += (tgt - this.level) * 0.06;
    if (this.tune > 0) this.tune = Math.max(0, this.tune - 0.014);

    const amp = h * 0.5 * this.level;
    const col = this._signalColor();
    ctx.lineWidth = this.thickness;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = col;
    if (this.glow) { ctx.shadowColor = col; ctx.shadowBlur = 7; }

    ctx.beginPath();
    const step = 2;
    for (let x = 0; x <= w; x += step) {
      const p = x / w;
      let y = mid;
      const slow = REDUCED ? 0.35 : 1;
      y += Math.sin(p * this.density + t * 1.3) * amp * slow;
      y += Math.sin(p * this.density * 2.6 - t * 2.1) * amp * 0.32;
      if (this.tune > 0) y += (Math.random() - 0.5) * h * 0.85 * this.tune;
      for (const rp of this.ripples) {
        const age = (now - rp.born) / 1000;
        const c = age * 0.85;               // centro viaja da esquerda p/ direita
        const d = p - c;
        const env = Math.exp(-(d * d) / 0.0016);
        const decay = Math.max(0, 1 - age / 1.5);
        y += Math.sin(d * 90 - age * 16) * env * decay * h * 0.4 * rp.strength;
      }
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    this.ripples = this.ripples.filter((r) => now - r.born < 1700);
    requestAnimationFrame(() => this._loop());
    this._autostop();
  }
}

// registro simples: app.js pulsa todas as linhas visíveis de uma vez
const waves = new Set();
export function registerWave(w) { waves.add(w); return w; }
export function unregisterWave(w) { waves.delete(w); }
export function pulseSignal(strength = 1) { for (const w of waves) w.pulse(strength); }
export function setSignalLevel(level) { for (const w of waves) w.setLevel(level); }
export function refreshWaves() { for (const w of waves) w.refresh(); }
