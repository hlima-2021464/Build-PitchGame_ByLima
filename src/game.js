'use strict';
/* ECHO//LOOP. Un eco es P(t - tau): repite el recorrido, no lo inventa. */
const DT = 1 / 60, EPS = 1e-9, TAU = Math.PI * 2;
const ISO = 0, CON = 1, CYC = 8, WIN = 2, PRE = 1, SAFE = 1.2, DRAIN = 2;
const CFG = {
  dur: 12, delays: [6, 13, 21], on: [1, 1, 1],
  speed: 260, pr: 9, er: 11, cap: 1500,
  R: 360, cx: 400, cy: 400, nr: 30,
  nodes: [], gates: [], goal: 0, para: 0
};
/* nodo: [grados, radio, oscilador?, desfase]. compuerta: [g1, r1, g2, r2, 0 aislante / 1 conductor] */
const LEVELS = [
  { n: 'SINTONÍA', on: [1, 0, 0], g: 3, par: 15, nodes: [[210, .62], [330, .62]], gates: [], h: '' },
  { n: 'FASE', on: [1, 0, 0], g: 4, par: 16, h: 'La compuerta violeta deja al ECHO AISLANTE. Usa el hueco del oeste.',
    nodes: [[140, .64], [90, .66], [45, .64]], gates: [[158, .60, 18, .70, 0]] },
  { n: 'VENTANA', on: [1, 1, 0], g: 3, par: 21, h: 'El nodo amarillo solo cuenta 2 s cada 8. Llega con tu ECHO ya en el otro.',
    nodes: [[200, .60], [270, .66, 1, 0], [0, .62, 1, 4]], gates: [[150, .48, 30, .48, 0]] },
  { n: 'RELEVO DOBLE', on: [1, 1, 0], g: 3, par: 22, h: 'Cruza el violeta y después el cian. El atajo deja al ECHO aislante.',
    nodes: [[270, .66, 1, 0], [100, .62], [55, .60], [150, .58]],
    gates: [[165, .46, 25, .46, 0], [155, .60, 125, .58, 1]] },
  { n: 'PARADOJA', on: [1, 1, 0], g: 3, par: 19, para: 1, h: 'Visita el nodo, vete y vuelve: los dos ECHOS coinciden un instante y la carga se triplica.',
    nodes: [[230, .62], [340, .64, 1, 2], [90, .58, 1, 0], [20, .60, 1, 4], [160, .60, 1, 5]],
    gates: [[140, .42, 40, .42, 0]] }
];
const WAIT = 'WAITING', ACT = 'ACTIVE', EXP = 'EXPIRED', OFF = 'DISABLED';
const E_SPAWN = 0, E_EXPIRE = 1, E_NODE = 2, E_SYNC = 3, E_HIT = 4, E_WIN = 5, E_PHASE = 6, E_OPEN = 7, E_PARA = 8;
const side = (px, py, ax, ay, bx, by) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
const crossed = (x0, y0, x1, y1, ax, ay, bx, by) => {
  const s0 = side(x0, y0, ax, ay, bx, by), s1 = side(x1, y1, ax, ay, bx, by);
  if (s0 * s1 >= 0) return false;
  const s2 = side(ax, ay, x0, y0, x1, y1), s3 = side(bx, by, x0, y0, x1, y1);
  return s2 * s3 < 0;
};

/* Buffer circular. Al llenarse pisa la muestra más vieja. */
class TemporalHistory {
  constructor(cap) {
    this.cap = cap;
    this.t = new Float64Array(cap);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.clear();
  }
  clear() { this.w = 0; this.n = 0; }                       // w = próxima escritura, n = muestras válidas
  push(t, x, y) {
    const w = this.w;
    this.t[w] = t; this.x[w] = x; this.y[w] = y;
    this.w = (w + 1) % this.cap;
    if (this.n < this.cap) this.n++;                        // lleno: sobrescribe la más antigua
  }
  idx(i) { return (this.w - this.n + i + this.cap) % this.cap; } // índice lógico (0 = más antigua) -> físico
  oldest() { return this.n ? this.t[this.idx(0)] : NaN; }
  newest() { return this.n ? this.t[this.idx(this.n - 1)] : NaN; }
  /* Posición en el tiempo histórico q con interpolación lineal. false si q es anterior a lo almacenado. */
  at(q, o) {
    const n = this.n;
    if (!n) return false;
    const t0 = this.t[this.idx(0)];
    if (q < t0 - EPS) return false;
    if (q < t0) q = t0;
    let hi = n - 1;
    if (q >= this.t[this.idx(hi)]) {
      const k = this.idx(hi); o.x = this.x[k]; o.y = this.y[k]; return true;
    }
    let lo = 0;                                             // mayor lo con t[lo] <= q (lo < hi garantizado)
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.t[this.idx(m)] <= q) lo = m; else hi = m;
    }
    const a = this.idx(lo), b = this.idx(hi), ta = this.t[a];
    const f = Math.min(1, Math.max(0, (q - ta) / (this.t[b] - ta)));
    o.x = this.x[a] + (this.x[b] - this.x[a]) * f;
    o.y = this.y[a] + (this.y[b] - this.y[a]) * f;
    return true;
  }
}

/* Simulación a 1/60. El reloj es el número de tick, así que no acumula error. */
function createSim(over) {
  const c = Object.assign({}, CFG, over);
  const hist = new TemporalHistory(c.cap);
  const maxDelay = (c.cap - 1) * DT;                        // retraso máximo cubierto por el buffer
  const tmp = { x: 0, y: 0 };
  const s = { cfg: c, hist, maxDelay, over: false, won: false, hit: -1, charge: 0, k: 0, bonus: 0, danger: 0, ev: [], nodes: [], gates: [], echoes: [] };
  const near = (x, y, n) => (x - n.x) * (x - n.x) + (y - n.y) * (y - n.y) < c.nr * c.nr;
  const pol = (deg, f) => {
    const a = deg * Math.PI / 180;
    return [c.cx + Math.cos(a) * c.R * f, c.cy + Math.sin(a) * c.R * f];
  };

  s.reset = () => {
    s.tick = 0; s.t = 0; s.over = s.won = false; s.hit = -1; s.charge = 0; s.k = 0; s.bonus = s.danger = 0; s.ev.length = 0;
    s.px = s.ppx = s.sx = c.cx;                             // (sx, sy) = P(0), origen de todos los ECHOS
    s.py = s.ppy = s.sy = c.cy;
    hist.clear();
    hist.push(0, s.px, s.py);
    s.nodes = c.nodes.map(([deg, f, osc, ph]) => {
      const p = pol(deg, f), cyc = (((ph || 0) % CYC) + CYC) % CYC;
      return { x: p[0], y: p[1], osc: osc || 0, ph: ph || 0, by: 0, open: !osc || cyc < WIN, pre: 0, pt: 0, pc: 0 };
    });
    s.gates = (c.gates || []).map(([d1, f1, d2, f2, type]) => {
      const p = pol(d1, f1), q = pol(d2, f2);
      return { x1: p[0], y1: p[1], x2: q[0], y2: q[1], type };
    });
    s.echoes = c.delays.map((delay, i) => ({
      i, delay, x: s.sx, y: s.sy, tq: 0, ph: CON,
      state: c.on[i] && delay <= maxDelay ? WAIT : OFF
    }));
  };

  s.load = (i, dur) => {
    const L = LEVELS[i];
    c.on = L.on; c.nodes = L.nodes; c.gates = L.gates || []; c.goal = L.g; c.para = L.para || 0; c.dur = dur || Infinity;
    s.reset();
  };

  s.step = (ix, iy) => {                                    // ix, iy en [-1,1]; un paso = 1/60 s
    if (s.over || s.won) return;
    const l = Math.hypot(ix, iy);
    if (l > 1) { ix /= l; iy /= l; }
    s.ppx = s.px; s.ppy = s.py;
    let x = s.px + ix * c.speed * DT, y = s.py + iy * c.speed * DT;
    const dx = x - c.cx, dy = y - c.cy, m = c.R - c.pr, d = Math.hypot(dx, dy);
    if (d > m) { x = c.cx + dx * m / d; y = c.cy + dy * m / d; } // límite circular
    s.px = x; s.py = y;
    s.tick++;
    s.t = s.tick * DT;                                      // reloj entero: sin deriva acumulada
    hist.push(s.t, x, y);
    const rr = (c.pr + c.er) * (c.pr + c.er);
    for (const e of s.echoes) {
      if (e.state === OFF || e.state === EXP) continue;
      if (s.t >= e.delay + c.dur - EPS) { e.state = EXP; s.ev.push([E_EXPIRE, e.i]); continue; }
      if (e.state === WAIT && s.t >= e.delay - EPS) { e.state = ACT; e.ph = CON; s.ev.push([E_SPAWN, e.i]); }
      if (e.state !== ACT) continue;
      e.tq = s.t - e.delay;                                 // tiempo histórico consultado
      if (!hist.at(e.tq, tmp)) continue;
      const ox = e.x, oy = e.y;
      e.x = tmp.x; e.y = tmp.y;
      for (const g of s.gates) if (crossed(ox, oy, e.x, e.y, g.x1, g.y1, g.x2, g.y2) && e.ph !== g.type) {
        e.ph = g.type; s.ev.push([E_PHASE, e.i, g.type]);   // el jugador no tiene fase; la compuerta actúa al reproducir el cruce
      }
      const ex = e.x - x, ey = e.y - y;
      if (ex * ex + ey * ey < rr && !s.over) { s.over = true; s.hit = e.i; s.ev.push([E_HIT, e.i]); }
    }
    if (s.over) return;
    let k = 0, bonus = false, danger = false;
    s.nodes.forEach((n, j) => {
      const cyc = (((s.t + n.ph) % CYC) + CYC) % CYC, open = !n.osc || cyc < WIN;
      n.pre = n.osc && cyc >= CYC - PRE;
      if (open && !n.open) s.ev.push([E_OPEN, j]);
      n.open = open;
      let by = near(x, y, n) && open ? 1 : 0, cons = 0;
      for (const e of s.echoes) if (e.state === ACT && e.ph === CON && open && near(e.x, e.y, n)) {
        cons++; by |= 2 << e.i;
      }
      if (c.para && cons >= 2) {
        n.pt += DT;
        if (n.pt <= SAFE + EPS) bonus = true; else danger = true;
        if (n.pc < 2) s.ev.push([E_PARA, j, 0]);
        else if (n.pt > SAFE && n.pt - DT <= SAFE + EPS) s.ev.push([E_PARA, j, 1]);
      } else if (n.pt) { n.pt = 0; s.ev.push([E_PARA, j, 2]); }
      n.pc = cons;
      if (by !== n.by) { s.ev.push([E_NODE, j, by, n.by]); n.by = by; }
      if (by) k++;
    });
    if (k >= 2 && s.k < 2) s.ev.push([E_SYNC, k]);
    s.k = k; s.bonus = bonus; s.danger = danger;
    if (danger) s.charge = Math.max(0, s.charge - DRAIN * DT);
    else if (c.goal && k >= 2) {                            // k nodos vivos cargan (k-1)/s; paradoja segura ×3
      s.charge += (k - 1) * DT * (bonus ? 3 : 1);
      if (s.charge >= c.goal - EPS) { s.charge = c.goal; s.won = true; s.ev.push([E_WIN]); }
    }
  };

  s.reset();
  return s;
}

if (typeof module !== 'undefined') module.exports = { TemporalHistory, createSim, DT, CFG, LEVELS, crossed, ISO, CON, E_PHASE, E_OPEN, E_PARA, SAFE };

/* A partir de aquí solo corre en el navegador: dibujo, audio y menús. */
const C = { bg: '#070910', b2: '#0C1220', cy: '#43E8F5', vi: '#A56BFF', mg: '#F15BCB', ye: '#FFE58A', tx: '#F0F4FF' };
const EC = ['#A56BFF', '#D264E8', '#F15BCB'];               // color de cada ECHO
const PC = [C.cy, '#A56BFF', '#D264E8', C.mg, C.ye, C.tx];  // paleta de partículas

function boot() {
  const q = new URLSearchParams(location.search);
  const DUR = +q.get('dur') > 0 ? +q.get('dur') : Infinity;
  const $ = id => document.getElementById(id);
  const cv = $('c'), ctx = cv.getContext('2d');
  const sim = createSim(), cfg = sim.cfg;
  const mn = $('mn'), rs = $('rs'), hud = $('h'), tm = $('tm'), lv = $('lv'), cf = $('cf'), cp = $('cp'), hn = $('hn'),
    tt = $('tt'), sn = $('sn'), lvs = $('lvs'), chips = [...$('ec').children];

  let SV = { u: 0, b: [] };
  try { Object.assign(SV, JSON.parse(localStorage.el2)); } catch (e) { }
  const save = () => { try { localStorage.el2 = JSON.stringify(SV); } catch (e) { } };
  if (+q.get('lv')) SV.u = Math.min(LEVELS.length - 1, +q.get('lv') - 1);

  let mode = 'menu', level = 0, S = 1, ox = 0, oy = 0, dpr = 1, acc = 0, last = 0, an = 0, rt = 0, steps = 0,
    shake = 0, flash = 0, fc = C.tx, touched = 0, seen = 0, sync1 = 0, en = 0, vi = 2, pvi = 2, t0 = null;
  const K = {}, tv = { x: 0, y: 0 }, vv = { x: 0, y: 0 }, o1 = { x: 0, y: 0 }, o2 = { x: 0, y: 0 }, nl = [0, 0, 0, 0, 0];

  /* ---------- audio procedural (Web Audio) ---------- */
  const VOL = [0, .3, .6, 1];
  let ac, mg, hum;
  const au = () => {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      mg = ac.createGain(); mg.gain.value = VOL[vi] * .5; mg.connect(ac.destination);
      hum = ac.createGain(); hum.gain.value = 0; hum.connect(mg);
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = 110; o.connect(hum); o.start(); hum.o = o;
    } catch (e) { ac = 0; }
  };
  const tone = (f, d, ty, v, f2, dl) => {
    if (!ac || !VOL[vi]) return;
    const t = ac.currentTime + (dl || 0), o = ac.createOscillator(), g = ac.createGain();
    o.type = ty || 'sine'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .01); g.gain.exponentialRampToValueAtTime(1e-4, t + d);
    o.connect(g); g.connect(mg); o.start(t); o.stop(t + d + .05);
  };
  const noise = (d, v) => {
    if (!ac || !VOL[vi]) return;
    const b = ac.createBuffer(1, ac.sampleRate * d, ac.sampleRate), a = b.getChannelData(0);
    for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / a.length);
    const s = ac.createBufferSource(), g = ac.createGain(); s.buffer = b; g.gain.value = v; s.connect(g); g.connect(mg); s.start();
  };
  const setVol = v => {
    vi = v; sn.textContent = vi ? 'VOL ' + vi + '/3' : 'MUTE';
    if (mg) mg.gain.value = VOL[vi] * .5;
    if (vi) pvi = vi;
  };
  setVol(vi);

  /* ---------- partículas y ondas (pools reutilizados, solo visual) ---------- */
  const NP = 200, PX = new Float32Array(NP * 8), NR = 14, RG = new Float32Array(NR * 6);
  let pn = 0, rn = 0;
  const emit = (x, y, col, n, sp, life = 1, size = 2.5) => {
    for (let i = 0; i < n; i++) {
      const k = (pn++ % NP) * 8, a = Math.random() * TAU, v = sp * (.25 + Math.random() * .75);
      PX[k] = x; PX[k + 1] = y; PX[k + 2] = Math.cos(a) * v; PX[k + 3] = Math.sin(a) * v;
      PX[k + 4] = 1; PX[k + 5] = 1 / (life * (.6 + Math.random() * .4)); PX[k + 6] = size; PX[k + 7] = col;
    }
  };
  const ring = (x, y, col, r, vr, w = 3) => {
    const k = (rn++ % NR) * 6;
    RG[k] = x; RG[k + 1] = y; RG[k + 2] = r; RG[k + 3] = vr; RG[k + 4] = 1; RG[k + 5] = col + w * 10;
  };
  const fxStep = () => {
    for (let k = 0; k < NP * 8; k += 8) if (PX[k + 4] > 0) {
      PX[k] += PX[k + 2] * DT; PX[k + 1] += PX[k + 3] * DT;
      PX[k + 2] *= .965; PX[k + 3] *= .965; PX[k + 4] -= PX[k + 5] * DT;
    }
    for (let k = 0; k < NR * 6; k += 6) if (RG[k + 4] > 0) { RG[k + 2] += RG[k + 3] * DT; RG[k + 4] -= DT * 1.3; }
    shake = Math.max(0, shake - DT * 1.6); flash = Math.max(0, flash - DT * 1.8);
  };

  /* ---------- sprites de halo (se generan una vez) ---------- */
  const spr = {};
  const halo = col => spr[col] || (spr[col] = (() => {
    const k = document.createElement('canvas'); k.width = k.height = 64;
    const g = k.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, '#fff'); r.addColorStop(.16, col); r.addColorStop(.5, col + '55'); r.addColorStop(1, col + '00');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); return k;
  })());
  const glow = (x, y, r, col, a) => { ctx.globalAlpha = a; ctx.drawImage(halo(col), x - r, y - r, r * 2, r * 2); };
  const arc = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); };
  const poly = (x, y, r, n, a) => {
    for (let i = 0; i <= n; i++) { const t = a + i * TAU / n; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(t) * r, y + Math.sin(t) * r); }
  };
  const dash = (a, off) => { ctx.setLineDash(a); ctx.lineDashOffset = off; };
  /* estela: get(j, o) entrega el punto j-ésimo hacia atrás; segmentos con alfa y ancho decrecientes */
  const ribbon = (x, y, get, n, col, w, a) => {
    ctx.strokeStyle = col;
    for (let j = 1; j <= n; j++) {
      if (!get(j, o2)) break;
      const f = 1 - j / (n + 1);
      ctx.globalAlpha = a * f; ctx.lineWidth = w * f;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(o2.x, o2.y); ctx.stroke();
      x = o2.x; y = o2.y;
    }
  };

  /* ---------- dibujo ---------- */
  const motes = () => {
    ctx.fillStyle = C.cy;
    for (let i = 0; i < 40; i++) {
      const a = i * 2.39996 + an * (.02 + (i % 5) * .006), r = cfg.R * (.95 + ((i * 53) % 97) / 97 * 2.3);
      ctx.globalAlpha = .06 + .2 * Math.abs(Math.sin(an * 1.1 + i));
      ctx.fillStyle = i % 6 ? C.cy : C.vi;
      ctx.fillRect(cfg.cx + Math.cos(a) * r - 1.2, cfg.cy + Math.sin(a) * r - 1.2, 2.4, 2.4);
    }
  };

  const arena = () => {
    const R = cfg.R, X = cfg.cx, Y = cfg.cy, sp = 1 + en * 2;
    const g = ctx.createRadialGradient(X, Y, 0, X, Y, R);
    g.addColorStop(0, '#13203A'); g.addColorStop(.65, C.b2); g.addColorStop(1, '#080B14');
    ctx.globalAlpha = 1; ctx.fillStyle = g; arc(X, Y, R); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(135,147,172,.11)'; ctx.beginPath();   // grid polar de profundidad
    for (let i = 1; i <= 4; i++) { ctx.moveTo(X + R * i / 4, Y); ctx.arc(X, Y, R * i / 4, 0, TAU); }
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; ctx.moveTo(X + Math.cos(a) * R * .2, Y + Math.sin(a) * R * .2); ctx.lineTo(X + Math.cos(a) * R, Y + Math.sin(a) * R); }
    ctx.stroke();
    ctx.lineWidth = 2;                                      // anillos de energía que reaccionan a la sincronía
    for (let i = 0; i < 3; i++) {
      const r = R * (.4 + i * .2), d = i % 2 ? 1 : -1;
      dash([r * .55, r * .4 + i * 14], an * (14 + i * 8) * sp * d);
      ctx.strokeStyle = C.cy; ctx.globalAlpha = .13 + i * .03; arc(X, Y, r); ctx.stroke();
      ctx.strokeStyle = C.ye; ctx.globalAlpha = .3 * en; arc(X, Y, r); ctx.stroke();
    }
    dash([], 0);
    ctx.lineWidth = 1.5; ctx.strokeStyle = C.vi; ctx.globalAlpha = .2;                // polígonos de referencia
    ctx.beginPath(); poly(X, Y, R * .3, 6, an * .12 * sp); ctx.stroke();
    ctx.globalAlpha = .1; ctx.beginPath(); poly(X, Y, R * .86, 3, -an * .06 * sp); ctx.stroke();
    ctx.globalAlpha = .4; ctx.strokeStyle = C.cy; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < 120; i++) { const a = i * TAU / 120, l = i % 5 ? 5 : 11; ctx.moveTo(X + Math.cos(a) * (R - 3), Y + Math.sin(a) * (R - 3)); ctx.lineTo(X + Math.cos(a) * (R - 3 - l), Y + Math.sin(a) * (R - 3 - l)); }
    ctx.stroke();
    for (const g of sim.gates) {                           // compuertas: cian conduce, violeta aísla
      ctx.strokeStyle = g.type ? C.cy : C.vi; ctx.globalAlpha = .9; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(g.x1, g.y1); ctx.lineTo(g.x2, g.y2); ctx.stroke();
      ctx.globalAlpha = .35; ctx.lineWidth = 14; ctx.stroke();
    }
    ctx.globalAlpha = .75; ctx.lineWidth = 3; ctx.strokeStyle = en > .5 ? C.ye : C.cy;
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 16 * S; arc(X, Y, R); ctx.stroke(); ctx.shadowBlur = 0;
  };

  const nodesBeams = () => {
    const X = cfg.cx, Y = cfg.cy;
    sim.nodes.forEach((n, j) => {
      const by = n.by, l = nl[j] += ((by ? 1 : 0) - nl[j]) * .18;
      ctx.globalAlpha = (n.osc && !n.open ? .04 : .05) + .14 * l; ctx.fillStyle = C.ye; arc(n.x, n.y, cfg.nr); ctx.fill();
      ctx.strokeStyle = n.osc && !n.open ? '#6a623c' : C.ye; ctx.globalAlpha = n.open || !n.osc ? .35 + .65 * l : .3 + (n.pre ? .35 : 0);
      ctx.lineWidth = 2 + l * 2; arc(n.x, n.y, cfg.nr - 2); ctx.stroke();
      if (n.osc) {
        const cyc = (((sim.t + n.ph) % 8) + 8) % 8, u = n.open ? cyc / 2 : n.pre ? (cyc - 7) : 0;
        ctx.strokeStyle = C.ye; ctx.globalAlpha = n.open ? .95 : n.pre ? .4 + .5 * u : .2; ctx.lineWidth = n.open ? 3 : 1.5;
        ctx.beginPath(); ctx.arc(n.x, n.y, cfg.nr + 10, -Math.PI / 2, -Math.PI / 2 + TAU * (n.open ? 1 - u : u)); ctx.stroke();
      }
      if (n.pt > 0) {
        ctx.strokeStyle = n.pt > 1.2 ? C.mg : '#F15BCB'; ctx.globalAlpha = 1; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(n.x, n.y, cfg.nr + 18, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, n.pt / 1.2)); ctx.stroke();
      }
      ctx.lineWidth = 1.5; dash([5, 7], an * 14 * (j % 2 ? 1 : -1)); ctx.globalAlpha = .5; arc(n.x, n.y, cfg.nr - 11); ctx.stroke(); dash([], 0);
      ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(an * 1.2 + j); ctx.globalAlpha = .45 + .5 * l; ctx.fillStyle = C.ye; ctx.fillRect(-3, -3, 6, 6); ctx.restore();
    });
    ctx.globalCompositeOperation = 'lighter';
    const lit = sim.nodes.filter(n => n.by);
    sim.nodes.forEach((n, j) => {
      if (nl[j] < .02) return;
      const by = n.by || 1, col = n.by & 1 ? C.cy : n.by ? EC[by & 2 ? 0 : by & 4 ? 1 : 2] : C.ye;
      glow(n.x, n.y, cfg.nr * 2.4 * (.6 + nl[j] * .4), col, .6 * nl[j]);
    });
    if (lit.length) {
      ctx.lineWidth = 2.5;
      for (const n of lit) {
        ctx.strokeStyle = n.by & 1 ? C.cy : EC[n.by & 2 ? 0 : n.by & 4 ? 1 : 2]; ctx.globalAlpha = .55;
        ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(X, Y); ctx.stroke();
        const f = (an * .9 + n.x * .01) % 1; ctx.globalAlpha = .9; ctx.fillStyle = C.tx;
        ctx.fillRect(n.x + (X - n.x) * f - 2, n.y + (Y - n.y) * f - 2, 4, 4);
      }
      if (lit.length > 1) {                                 // red de sincronía entre nodos
        ctx.beginPath(); lit.forEach((n, i) => ctx[i ? 'lineTo' : 'moveTo'](n.x, n.y)); if (lit.length > 2) ctx.closePath();
        ctx.fillStyle = 'rgba(255,229,138,.07)'; ctx.globalAlpha = 1; if (lit.length > 2) ctx.fill();
        ctx.strokeStyle = C.ye; ctx.lineWidth = 3; ctx.globalAlpha = .8; ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  const core = () => {
    const X = cfg.cx, Y = cfg.cy, p = cfg.goal ? sim.charge / cfg.goal : 0, w = mode === 'win' ? 1 : 0,
      col = sim.danger ? C.mg : `hsl(${w ? 48 : 318 - 132 * p},88%,66%)`, pu = Math.sin(an * 3) * .5 + .5;
    ctx.globalCompositeOperation = 'lighter';
    glow(X, Y, 78 + pu * 12 + p * 36, w ? C.ye : p > .5 ? C.cy : C.mg, .55 + .3 * en);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 2; ctx.strokeStyle = col;
    for (let i = 0; i < 3; i++) { ctx.globalAlpha = .85 - i * .2; ctx.beginPath(); poly(X, Y, 24 + i * 9, 3 + i, an * (i % 2 ? -.8 : .8) * (1 + p)); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.fillStyle = col; arc(X, Y, 9 + pu * 3); ctx.fill(); ctx.fillStyle = '#fff'; arc(X, Y, 4); ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(135,147,172,.22)'; arc(X, Y, 58); ctx.stroke();
    if (p > 0) { ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(X, Y, 58, -Math.PI / 2, -Math.PI / 2 + TAU * p); ctx.stroke(); }
    if (p < 1 && !w) {                                      // inestabilidad: púas que se calman con la carga
      ctx.strokeStyle = C.mg; ctx.lineWidth = 1.5; ctx.globalAlpha = .75 * (1 - p); ctx.beginPath();
      for (let i = 0; i < 9; i++) {
        const a = i * TAU / 9 + an * .3, l = 64 + (Math.sin(an * 17 + i * 5) * .5 + .5) * 16 * (1 - p);
        ctx.moveTo(X + Math.cos(a) * 63, Y + Math.sin(a) * 63); ctx.lineTo(X + Math.cos(a) * l, Y + Math.sin(a) * l);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  const drawP = (x, y, vx, vy, a) => {
    const sp = Math.min(1, Math.hypot(vx, vy) / cfg.speed), ang = Math.atan2(vy, vx), r = cfg.pr;
    ctx.globalCompositeOperation = 'lighter';
    glow(x, y, 36 + sp * 10, C.cy, .9 * a);
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(1 + sp * .4, 1 - sp * .15);
    ctx.globalAlpha = a; ctx.fillStyle = C.cy; arc(0, 0, r * 1.15); ctx.fill(); ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a; ctx.fillStyle = '#EFFFFF'; arc(x, y, r * .55); ctx.fill();
    ctx.fillStyle = C.cy;
    for (let i = 0; i < 3; i++) { const t = an * 3.2 + i * TAU / 3; arc(x + Math.cos(t) * (r + 7), y + Math.sin(t) * (r + 7), 1.8); ctx.fill(); }
  };

  const drawE = (i, x, y, a, lbl = 1, ph = 1) => {
    const col = ph ? EC[i] : '#D5E2F0', r = cfg.er;
    ctx.globalCompositeOperation = 'lighter'; glow(x, y, 40, col, .8 * a);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = .9 * a; ctx.fillStyle = '#0E0818'; arc(x, y, r); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2.5; if (i === 1) dash([4, 3], an * 10); arc(x, y, r); ctx.stroke(); dash([], 0);
    if (i === 2) { ctx.lineWidth = 1; ctx.globalAlpha = .6 * a; arc(x, y, r + 3.5); ctx.stroke(); }
    ctx.globalAlpha = a; ctx.fillStyle = col; arc(x, y, 3); ctx.fill();
    for (let k = 0; k <= i; k++) { const t = an * 2.2 + k * TAU / (i + 1); arc(x + Math.cos(t) * (r + 8), y + Math.sin(t) * (r + 8), 1.9); ctx.fill(); }
    if (!lbl) return;
    ctx.globalAlpha = .55 * a; ctx.font = '600 10px system-ui'; ctx.textAlign = 'center';
    ctx.fillText((ph ? '' : 'AIS ') + '-' + cfg.delays[i] + 's', x, y + r + 22);
  };

  const echoes = alpha => {
    const h = sim.hist, rt2 = sim.t + alpha * DT;
    for (const e of sim.echoes) {
      if (e.state === WAIT && e.delay - sim.t < 3) {        // aviso: aparecerá en P(0)
        const k = e.delay - sim.t;
        ctx.strokeStyle = EC[e.i]; ctx.lineWidth = 2; ctx.globalAlpha = .9 - k * .25; arc(sim.sx, sim.sy, 14 + k * 22); ctx.stroke();
        ctx.fillStyle = EC[e.i]; ctx.font = '600 13px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('ECO ' + (e.i + 1) + '  ' + k.toFixed(1), sim.sx, sim.sy + 92 + e.i * 16);
      }
      if (e.state !== ACT) continue;
      const age = sim.t - e.delay, f = Math.min(1, age / .5) * Math.min(1, (cfg.dur - age) / .5), tq = rt2 - e.delay;
      if (!h.at(tq, o1)) continue;
      ctx.globalCompositeOperation = 'lighter';
      const col = e.ph ? EC[e.i] : '#D5E2F0';
      ribbon(o1.x, o1.y, (j, o) => h.at(tq - j * .05, o), 12, col, 8, .6 * f);
      ctx.globalCompositeOperation = 'source-over';
      drawE(e.i, o1.x, o1.y, f * (e.ph ? 1 : .75), 1, e.ph);
    }
  };

  const player = alpha => {
    const h = sim.hist, x = sim.ppx + (sim.px - sim.ppx) * alpha, y = sim.ppy + (sim.py - sim.ppy) * alpha;
    vv.x += ((sim.px - sim.ppx) / DT - vv.x) * .3; vv.y += ((sim.py - sim.ppy) / DT - vv.y) * .3;
    ctx.globalCompositeOperation = 'lighter';
    ribbon(x, y, (j, o) => { const i = h.n - 1 - j * 2; if (i < 0) return false; const k = h.idx(i); o.x = h.x[k]; o.y = h.y[k]; return true; }, 14, C.cy, 9, .6);
    ctx.globalCompositeOperation = 'source-over';
    drawP(x, y, vv.x, vv.y, 1);
  };

  const fxDraw = () => {
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < NR * 6; k += 6) if (RG[k + 4] > 0) {
      const c = RG[k + 5], w = (c / 10 | 0) || 3, col = PC[c % 10];
      ctx.globalAlpha = RG[k + 4] * .8; ctx.strokeStyle = col; ctx.lineWidth = w; arc(RG[k], RG[k + 1], RG[k + 2]); ctx.stroke();
    }
    for (let k = 0; k < NP * 8; k += 8) if (PX[k + 4] > 0) {
      const s = PX[k + 6] * (.4 + PX[k + 4] * .6);
      ctx.globalAlpha = PX[k + 4]; ctx.fillStyle = PC[PX[k + 7]]; ctx.fillRect(PX[k] - s / 2, PX[k + 1] - s / 2, s, s);
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  const draw = alpha => {
    const w = cv.width, h = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * .75);
    g.addColorStop(0, C.b2); g.addColorStop(1, C.bg); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const sx = shake ? (Math.random() - .5) * 18 * shake : 0, sy = shake ? (Math.random() - .5) * 18 * shake : 0;
    ctx.setTransform(S, 0, 0, S, ox - cfg.cx * S + sx * S, oy - cfg.cy * S + sy * S);
    ctx.lineCap = ctx.lineJoin = 'round';
    en += ((sim.k >= 2 ? 1 : 0) - en) * .08;
    ctx.globalCompositeOperation = 'lighter'; motes(); ctx.globalCompositeOperation = 'source-over';
    arena(); nodesBeams(); core();
    if (mode !== 'menu') { echoes(alpha); if (mode !== 'dead') player(alpha); }
    fxDraw();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    if (mode === 'dead' && rt < 1.6) {                      // ruptura temporal: franjas desplazadas
      for (let i = 0; i < 7; i++) {
        const y = Math.random() * h, hh = 8 + Math.random() * 46, o = (Math.random() - .5) * 90 * (1.6 - rt) * dpr;
        ctx.drawImage(cv, 0, y, w, hh, o, y, w, hh);
      }
    }
    if (flash > 0) { ctx.globalAlpha = flash * .4; ctx.fillStyle = fc; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
  };

  /* ---------- UI ---------- */
  const rk = (t, p) => t <= p ? 'S' : t <= p * 1.4 ? 'A' : t <= p * 2 ? 'B' : 'C';
  const toast = m => { tt.textContent = m; tt.classList.remove('s'); void tt.offsetWidth; tt.classList.add('s'); };
  const fade = (el, on) => {
    if (on) { el.hidden = false; requestAnimationFrame(() => el.classList.remove('x')); }
    else { el.classList.add('x'); setTimeout(() => { if (el.classList.contains('x')) el.hidden = true; }, 350); }
  };
  const res = (cls, title, sub, stats, btns) => {
    rs.className = 'ov ' + cls;
    $('rt').textContent = title; $('rb').textContent = sub; $('rst').innerHTML = stats;
    const bs = [$('r1'), $('r2'), $('r3')];
    bs.forEach((b, i) => { const d = btns[i]; b.hidden = !d; if (d) { b.textContent = d[0]; b.onclick = d[1]; } });
    fade(rs, true); bs[0].focus();
  };
  const chipsInit = () => {
    lvs.innerHTML = '';
    LEVELS.forEach((L, i) => {
      const b = document.createElement('button'), t = SV.b[i];
      b.className = 'ch'; b.disabled = i > SV.u; b.title = L.n;
      b.innerHTML = (i + 1) + '<small>' + (t ? rk(t, L.par) : '-') + '</small>';
      b.onclick = () => go(i); lvs.appendChild(b);
    });
  };
  const go = i => {
    level = i; sim.load(i, DUR);
    nl.fill(0); vv.x = vv.y = 0; PX.fill(0); RG.fill(0); shake = flash = rt = 0; touched = seen = sync1 = 0;
    mode = 'play'; acc = 0; last = 0; fade(mn, false); fade(rs, false); hud.hidden = false;
    lv.textContent = 'NIVEL ' + (i + 1) + ' / ' + LEVELS[i].n;
    chips.forEach((c, k) => { c.hidden = sim.echoes[k].state === OFF; });
    au(); toast('NIVEL ' + (i + 1) + '  ' + LEVELS[i].n); document.activeElement.blur();
  };
  const menu = () => {
    mode = 'menu'; sim.load(0, DUR); nl.fill(0); en = 0; fade(rs, false); hud.hidden = true; hum && (hum.gain.value = 0);
    chipsInit(); fade(mn, true); $('pl').focus();
  };
  const pause = () => {
    if (mode !== 'play') return;
    mode = 'pause'; res('ps', 'PAUSA', 'La simulación está detenida.', '', [['CONTINUAR', resume], ['REINICIAR', () => go(level)], ['MENÚ', menu]]);
  };
  const resume = () => { mode = 'play'; acc = 0; last = 0; fade(rs, false); document.activeElement.blur(); };
  const fin = () => {
    const t = sim.t, L = LEVELS[level], best = SV.b[level];
    if (!best || t < best) SV.b[level] = t;
    SV.u = Math.max(SV.u, Math.min(LEVELS.length - 1, level + 1)); save();
    const end = level === LEVELS.length - 1, stats = `<span>TIEMPO <b>${t.toFixed(1)} s</b></span><span>RANGO <b>${rk(t, L.par)}</b></span><span>MEJOR <b>${SV.b[level].toFixed(1)} s</b></span>`;
    res('win', end ? 'SISTEMA ESTABILIZADO' : 'NÚCLEO ESTABILIZADO', end ? 'Tu pasado completó lo que empezaste.' : 'Nivel ' + (level + 1) + ' completado. Rango S: menos de ' + L.par + ' s.', stats,
      end ? [['REPETIR NIVEL', () => go(level)], ['MENÚ', menu]] : [['SIGUIENTE NIVEL', () => go(level + 1)], ['REPETIR', () => go(level)], ['MENÚ', menu]]);
  };
  const lose = () => res('lose', 'RUPTURA TEMPORAL', `ECHO ${sim.hit + 1} te alcanzó: era tu propio recorrido de hace ${cfg.delays[sim.hit]} s.`,
    `<span>TIEMPO <b>${sim.t.toFixed(1)} s</b></span><span>CARGA <b>${Math.round(sim.charge / cfg.goal * 100)}%</b></span>`, [['REINTENTAR', () => go(level)], ['MENÚ', menu]]);

  /* ---------- eventos de simulación -> efectos y sonido ---------- */
  const onEv = e => {
    const E = sim.echoes[e[1]];
    switch (e[0]) {
      case E_SPAWN:
        ring(sim.sx, sim.sy, 1 + e[1], 20, 260); ring(sim.sx, sim.sy, 4, 10, 140, 2); emit(sim.sx, sim.sy, 1 + e[1], 26, 200, .9);
        tone(90 + e[1] * 25, .7, 'sawtooth', .07, 260 + e[1] * 40); tone(520 + e[1] * 90, .5, 'sine', .06, 0, .1); toast('ECHO ' + (e[1] + 1) + '  -' + cfg.delays[e[1]] + 's'); break;
      case E_EXPIRE: ring(E.x, E.y, 1 + e[1], 10, -60); emit(E.x, E.y, 1 + e[1], 20, 140, .8); break;
      case E_NODE: {
        const n = sim.nodes[e[1]], add = e[2] & ~e[3];
        if (add & 1) { touched = 1; ring(n.x, n.y, 0, 14, 120, 2); emit(n.x, n.y, 0, 8, 110, .6); tone(500 + e[1] * 70, .14, 'triangle', .12); }
        if (add >> 1) {
          ring(n.x, n.y, 4, 14, 190); emit(n.x, n.y, 4, 16, 170, .8); tone(330, .45, 'sine', .13, 660); tone(990, .3, 'sine', .05, 0, .08);
          if (!seen) { seen = 1; flash = .5; fc = C.vi; shake = .2; toast('TU PASADO LO MANTIENE'); }
        }
        break;
      }
      case E_SYNC:
        ring(cfg.cx, cfg.cy, 4, 30, 320); emit(cfg.cx, cfg.cy, 4, 22, 220, .9);
        [440, 554, 659, 880].slice(0, e[1] + 1).forEach((f, i) => tone(f, .55, 'triangle', .07, 0, i * .04));
        if (!sync1) { sync1 = 1; toast('SINCRONÍA'); } break;
      case E_HIT:
        mode = 'dead'; rt = 0; shake = 1; flash = 1; fc = C.mg;
        emit(sim.px, sim.py, 0, 56, 300, 1.2, 3); emit(E.x, E.y, 3, 36, 220, 1); ring(sim.px, sim.py, 3, 10, 420, 4); ring(sim.px, sim.py, 0, 6, 260, 2);
        noise(.5, .22); tone(320, .8, 'sawtooth', .12, 40); break;
      case E_PHASE: {
        const ec = sim.echoes[e[1]], on = e[2] === CON;
        ring(ec.x, ec.y, on ? 0 : 5, 14, 180, 3); emit(ec.x, ec.y, on ? 0 : 5, 18, 150, .7);
        tone(on ? 740 : 180, .24, on ? 'triangle' : 'sine', .11, on ? 980 : 120);
        toast(on ? 'CONDUCTOR' : 'AISLANTE'); break;
      }
      case E_OPEN: {
        const n = sim.nodes[e[1]]; ring(n.x, n.y, 4, 18, 150, 2); tone(988, .16, 'triangle', .08); break;
      }
      case E_PARA:
        if (!e[2]) { tone(150, .28, 'sawtooth', .07, 360); toast('PARADOJA'); }
        else if (e[2] === 1) { noise(.18, .14); tone(80, .45, 'sawtooth', .1, 40); toast('DESCARGA'); flash = .4; fc = C.mg; }
        break;
      case E_WIN:
        mode = 'win'; rt = 0; shake = .4; flash = .8; fc = C.ye;
        for (let i = 0; i < 3; i++) ring(cfg.cx, cfg.cy, 4 - (i & 1) * 4, 20 + i * 18, 260 + i * 120, 4);
        emit(cfg.cx, cfg.cy, 4, 80, 360, 1.5, 3.2); emit(cfg.cx, cfg.cy, 0, 50, 260, 1.4);
        [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, .9, 'sine', .1, 0, i * .09)); break;
    }
  };

  const hint = () => {
    if (mode !== 'play') return '';
    if (sim.danger) return 'Paradoja inestable: sal, el núcleo se descarga';
    if (sim.bonus) return 'Paradoja x3: sal antes de 1.2 s';
    if (sim.k >= 2) return 'Sincronía: el núcleo se estabiliza' + (sim.k > 2 ? '  x' + sim.k : '');
    if (level === 0) {
      const e = sim.echoes[0];
      if (!touched) return 'Entra en un nodo de resonancia';
      if (e.state === WAIT) return 'Tu ECHO nacerá en el núcleo en ' + (e.delay - sim.t).toFixed(1) + ' s y repetirá tu recorrido';
      return 'Ocupa el otro nodo mientras tu ECHO mantiene el primero';
    }
    return LEVELS[level].h;
  };

  /* ---------- entrada ---------- */
  const layout = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    const top = 56 * dpr, bot = 96 * dpr, m = 14;
    S = Math.min(cv.width, cv.height - top - bot) / (2 * (cfg.R + m));
    ox = cv.width / 2; oy = top + (cv.height - top - bot) / 2;
  };
  addEventListener('resize', layout);
  addEventListener('keydown', e => {
    au();
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    if (!e.repeat) {
      if (e.code === 'KeyM') setVol(vi ? 0 : pvi);
      if (e.code === 'Escape' || e.code === 'KeyP') mode === 'play' ? pause() : mode === 'pause' && resume();
      if (e.code === 'KeyR' && (mode === 'play' || mode === 'dead' || mode === 'win')) go(level);
    }
    K[e.code] = 1;
  });
  addEventListener('keyup', e => { K[e.code] = 0; });
  addEventListener('blur', () => { for (const k in K) K[k] = 0; });
  document.addEventListener('visibilitychange', () => { last = 0; acc = 0; if (document.hidden) pause(); });
  cv.addEventListener('pointerdown', e => { au(); if (e.pointerType !== 'mouse') t0 = [e.clientX, e.clientY]; });
  cv.addEventListener('pointermove', e => {
    if (!t0) return;
    const x = (e.clientX - t0[0]) / 40, y = (e.clientY - t0[1]) / 40, l = Math.hypot(x, y);
    tv.x = l < .25 ? 0 : x / Math.max(1, l); tv.y = l < .25 ? 0 : y / Math.max(1, l);
  });
  const tEnd = () => { t0 = null; tv.x = tv.y = 0; };
  cv.addEventListener('pointerup', tEnd); cv.addEventListener('pointercancel', tEnd);
  $('pl').onclick = () => go(SV.u);
  $('ct').onclick = () => $('kp').classList.toggle('on');
  $('ps').onclick = () => { pause(); document.activeElement.blur(); };
  sn.onclick = () => { au(); setVol((vi + 1) % 4); document.activeElement.blur(); };

  const input = () => [
    (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0) || tv.x,
    (K.KeyS || K.ArrowDown ? 1 : 0) - (K.KeyW || K.ArrowUp ? 1 : 0) || tv.y
  ];

  const tick = () => {
    if (mode === 'play') {
      const [ix, iy] = input();
      sim.step(ix, iy);
      if (sim.tick % 2 === 0 && (sim.px !== sim.ppx || sim.py !== sim.ppy)) emit(sim.px, sim.py, 0, 1, 30, .5, 2);
      for (const e of sim.echoes) if (e.state === ACT && sim.tick % 4 === 0) emit(e.x, e.y, e.ph ? 1 + e.i : 5, 1, 24, .6, 2);
      for (const e of sim.ev) onEv(e);
      sim.ev.length = 0;
    }
    fxStep();
  };

  const f = (n, d = 2) => n.toFixed(d);
  const ui = () => {
    const ts = f(sim.t, 1);
    if (tm.textContent !== ts) tm.textContent = ts;
    const p = cfg.goal ? sim.charge / cfg.goal : 0, pt = 'NÚCLEO ' + Math.round(p * 100) + '%';
    cf.style.transform = 'scaleX(' + p.toFixed(3) + ')'; if (cp.textContent !== pt) cp.textContent = pt;
    const h = hint(); if (hn.textContent !== h) hn.textContent = h;
    sim.echoes.forEach((e, i) => {
      const c = chips[i]; if (c.hidden) return;
      const u = c.lastChild, txt = e.state === WAIT ? 'en ' + f(e.delay - sim.t, 1) + ' s' : e.state === ACT ? (e.ph ? 'CON' : 'AIS') : 'fin';
      if (u.textContent !== txt) u.textContent = txt;
      if (c.dataset.s !== e.state) c.dataset.s = e.state;
      if (c.dataset.p !== String(e.ph)) c.dataset.p = e.ph;
    });
    if (hum && ac) {
      hum.gain.setTargetAtTime(mode === 'play' && sim.k >= 2 ? .05 * Math.min(sim.k - 1, 3) : 0, ac.currentTime, .08);
      hum.o.frequency.setTargetAtTime(80 + p * 140 + sim.k * 18, ac.currentTime, .1);
    }
  };

  const frame = now => {
    requestAnimationFrame(frame);
    if (!last) last = now;
    const dt = Math.min(now - last, 250) / 1000; last = now;
    an += dt;
    steps = 0;
    if (mode !== 'pause') {
      acc += dt;
      while (acc >= DT && steps < 5) { tick(); acc -= DT; steps++; }
      if (acc >= DT) acc = 0;                               // límite de pasos: descarta el retraso excesivo
    }
    if (mode === 'dead' || mode === 'win') {
      rt += dt;
      if (rt > (mode === 'win' ? 2.2 : 1.1) && rs.hidden) mode === 'win' ? fin() : lose();
    }
    draw(mode === 'play' ? acc / DT : 0);
    ui();
  };

  layout(); chipsInit(); sim.load(0, DUR);
  chips.forEach((c, i) => { c.innerHTML = `<b>E${i + 1}</b><i>-${cfg.delays[i]}s</i><u></u>`; });
  requestAnimationFrame(frame);
  if (q.get('lv')) go(SV.u);
}

if (typeof document !== 'undefined') boot();
