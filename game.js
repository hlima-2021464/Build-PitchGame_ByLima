'use strict';
/* ECHO//LOOP — E_i(t) = P(t - tau_i). Sin IA: cada ECHO consulta el historial real del jugador. */

const DT = 1 / 60, EPS = 1e-9;
const CFG = {
  dur: 12,                 // duración activa de cada ECHO (s) — modificable (?dur=30)
  delays: [6, 13, 21],     // tau_i (s)
  on: [1, 1, 1],           // ECHOS habilitados (?on=100)
  speed: 260,              // px/s (unidades de arena)
  pr: 9, er: 11,           // radios de colisión jugador / ECHO
  cap: 1500,               // muestras del buffer circular (25 s a 60 Hz)
  aw: 960, ah: 600         // arena lógica
};
const WAIT = 'WAITING', ACT = 'ACTIVE', EXP = 'EXPIRED', OFF = 'DISABLED';

/* ---------- TemporalHistory: buffer circular (t, x, y) ---------- */
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

/* ---------- Simulación determinista (Player + Arena + EchoManager + CollisionSystem) ---------- */
function createSim(over) {
  const c = Object.assign({}, CFG, over);
  const hist = new TemporalHistory(c.cap);
  const maxDelay = (c.cap - 1) * DT;                        // retraso máximo cubierto por el buffer
  const tmp = { x: 0, y: 0 };
  const s = { cfg: c, hist, maxDelay, over: false, hit: -1 };

  s.reset = (aw, ah) => {
    if (aw) { c.aw = aw; c.ah = ah; }
    s.tick = 0; s.t = 0; s.over = false; s.hit = -1;
    s.px = s.ppx = s.sx = c.aw / 2;                         // (sx, sy) = P(0), origen de todos los ECHOS
    s.py = s.ppy = s.sy = c.ah / 2;
    hist.clear();
    hist.push(0, s.px, s.py);
    s.echoes = c.delays.map((delay, i) => ({
      i, delay, x: s.sx, y: s.sy, tq: 0,
      state: c.on[i] && delay <= maxDelay ? WAIT : OFF
    }));
  };

  s.step = (ix, iy) => {                                    // ix, iy en [-1,1]; un paso = 1/60 s
    if (s.over) return;
    const l = Math.hypot(ix, iy);
    if (l > 1) { ix /= l; iy /= l; }
    s.ppx = s.px; s.ppy = s.py;
    const r = c.pr, d = c.speed * DT;
    s.px = Math.min(c.aw - r, Math.max(r, s.px + ix * d));
    s.py = Math.min(c.ah - r, Math.max(r, s.py + iy * d));
    s.tick++;
    s.t = s.tick * DT;                                      // reloj entero: sin deriva acumulada
    hist.push(s.t, s.px, s.py);
    const rr = (c.pr + c.er) * (c.pr + c.er);
    for (const e of s.echoes) {
      if (e.state === OFF || e.state === EXP) continue;
      if (s.t >= e.delay + c.dur - EPS) { e.state = EXP; continue; }
      if (s.t >= e.delay - EPS) e.state = ACT;
      if (e.state !== ACT) continue;
      e.tq = s.t - e.delay;                                 // tiempo histórico consultado
      if (!hist.at(e.tq, tmp)) continue;
      e.x = tmp.x; e.y = tmp.y;
      const dx = e.x - s.px, dy = e.y - s.py;
      if (dx * dx + dy * dy < rr && !s.over) { s.over = true; s.hit = e.i; }
    }
  };

  s.reset();
  return s;
}

if (typeof module !== 'undefined') module.exports = { TemporalHistory, createSim, DT, CFG };

/* ---------- Navegador: entrada, bucle, render, HUD, diagnóstico ---------- */
function boot() {
  const q = new URLSearchParams(location.search);
  if (+q.get('dur') > 0) CFG.dur = +q.get('dur');
  if (q.get('on')) CFG.on = CFG.delays.map((_, i) => +(q.get('on')[i] === '1'));

  const $ = id => document.getElementById(id);
  const cv = $('c'), ctx = cv.getContext('2d');
  const hud = $('h'), tm = $('tm'), chips = [...hud.querySelectorAll('span')];
  const ov = $('o'), ovT = $('t'), ovM = $('m'), btn = $('b'), dbg = $('g');
  const sim = createSim();
  window.ECHOLOOP = sim;

  let mode = 'menu', S = 1, ox = 0, oy = 0, dpr = 1, acc = 0, last = 0, lock = 0, fps = 60, steps = 0, debug = false;
  const K = {}, tv = { x: 0, y: 0 }, tmp = { x: 0, y: 0 }, tmp2 = { x: 0, y: 0 };

  /* partículas ligeras (solo visual, no afectan a la simulación) */
  const NP = 160, P = new Float32Array(NP * 6); let pn = 0;
  const emit = (x, y, type, n, sp) => {
    for (let i = 0; i < n; i++) {
      const k = (pn++ % NP) * 6, a = Math.random() * 6.283, v = Math.random() * sp;
      P[k] = x; P[k + 1] = y; P[k + 2] = Math.cos(a) * v; P[k + 3] = Math.sin(a) * v; P[k + 4] = 1; P[k + 5] = type;
    }
  };
  const fxStep = () => {
    for (let k = 0; k < NP * 6; k += 6) if (P[k + 4] > 0) {
      P[k] += P[k + 2] * DT; P[k + 1] += P[k + 3] * DT;
      P[k + 2] *= .96; P[k + 3] *= .96; P[k + 4] -= DT * 1.5;
    }
  };

  const dims = () => innerHeight > innerWidth * 1.1 ? [600, 960] : [960, 600];
  const layout = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    const hh = 56 * dpr, m = 20 * dpr, aw = sim.cfg.aw, ah = sim.cfg.ah;
    S = Math.min((cv.width - 2 * m) / aw, (cv.height - hh - 2 * m) / ah);
    ox = (cv.width - aw * S) / 2; oy = hh + (cv.height - hh - ah * S) / 2;
    if (mode === 'menu') sim.reset(...dims());
  };
  addEventListener('resize', layout);

  const show = (title, msg, label) => {
    ovT.innerHTML = title; ovM.textContent = msg; btn.textContent = label;
    ov.hidden = false; btn.focus();
  };
  const start = () => {
    if (mode === 'play' || performance.now() < lock) return;
    mode = 'menu'; layout();                                 // layout reinicia la simulación con las dimensiones actuales
    mode = 'play'; acc = 0; last = 0; ov.hidden = true; btn.blur();
  };
  btn.onclick = start;

  addEventListener('keydown', e => {
    if (e.code === 'F3') { e.preventDefault(); debug = !debug; dbg.hidden = !debug; return; }
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    K[e.code] = 1;
    if (e.code === 'KeyR' && mode === 'dead') start();
  });
  addEventListener('keyup', e => { K[e.code] = 0; });
  addEventListener('blur', () => { for (const k in K) K[k] = 0; });
  document.addEventListener('visibilitychange', () => { last = 0; acc = 0; });   // pausa al ocultar pestaña

  let t0 = null;                                            // joystick táctil
  cv.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') t0 = [e.clientX, e.clientY]; });
  cv.addEventListener('pointermove', e => {
    if (!t0) return;
    const x = (e.clientX - t0[0]) / 40, y = (e.clientY - t0[1]) / 40, l = Math.hypot(x, y);
    tv.x = l < .25 ? 0 : x / Math.max(1, l); tv.y = l < .25 ? 0 : y / Math.max(1, l);
  });
  const tEnd = () => { t0 = null; tv.x = tv.y = 0; };
  cv.addEventListener('pointerup', tEnd); cv.addEventListener('pointercancel', tEnd);

  const input = () => [
    (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0) || tv.x,
    (K.KeyS || K.ArrowDown ? 1 : 0) - (K.KeyW || K.ArrowUp ? 1 : 0) || tv.y
  ];

  const tick = () => {
    if (mode === 'play') {
      const [ix, iy] = input();
      sim.step(ix, iy);
      if (sim.tick % 2 === 0 && (sim.px !== sim.ppx || sim.py !== sim.ppy)) emit(sim.px, sim.py, 0, 1, 25);
      for (const e of sim.echoes) if (e.state === ACT && sim.tick % 3 === 0) emit(e.x, e.y, 1, 1, 20);
      if (sim.over) {
        mode = 'dead'; lock = performance.now() + 500;
        const e = sim.echoes[sim.hit];
        emit(sim.px, sim.py, 0, 60, 220); emit(e.x, e.y, 1, 40, 160);
        show('DERROTA', `ECHO ${sim.hit + 1} te alcanzó a los ${sim.t.toFixed(2)} s`, 'VOLVER A JUGAR');
      }
    }
    fxStep();
  };

  /* ---------- render ---------- */
  const glow = (c, b) => { ctx.shadowColor = c; ctx.shadowBlur = b * S; };
  const ball = (x, y, r, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); };

  const draw = alpha => {
    const aw = sim.cfg.aw, ah = sim.cfg.ah, h = sim.hist;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#080B12'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(S, 0, 0, S, ox, oy);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    ctx.fillStyle = '#0B1019'; ctx.fillRect(0, 0, aw, ah);
    ctx.strokeStyle = 'rgba(160,190,255,.05)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 40; x < aw; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, ah); }
    for (let y = 40; y < ah; y += 40) { ctx.moveTo(0, y); ctx.lineTo(aw, y); }
    ctx.stroke();
    glow('#37E6F2', 10); ctx.strokeStyle = 'rgba(55,230,242,.45)'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, aw, ah);
    ctx.shadowBlur = 0;

    const rt = sim.t + alpha * DT;
    for (const e of sim.echoes) {
      if (e.state === WAIT && sim.t > e.delay - 2) {         // aviso: dónde aparecerá (P(0))
        const k = e.delay - sim.t;
        ctx.strokeStyle = `rgba(182,92,255,${.7 - k * .3})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sim.sx, sim.sy, 11 + k * 14, 0, 6.2832); ctx.stroke();
      }
      if (e.state !== ACT) continue;
      const tq = rt - e.delay;
      if (!h.at(tq, tmp)) continue;
      let px = tmp.x, py = tmp.y;
      ctx.lineWidth = 6;
      for (let j = 1; j <= 8; j++) {                         // estela = posiciones históricas anteriores
        if (!h.at(tq - j * .05, tmp2)) break;
        ctx.strokeStyle = `rgba(182,92,255,${.4 * (1 - j / 9)})`;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tmp2.x, tmp2.y); ctx.stroke();
        px = tmp2.x; py = tmp2.y;
      }
      glow('#B65CFF', 22); ball(tmp.x, tmp.y, sim.cfg.er, '#B65CFF');
      ctx.shadowBlur = 0; ball(tmp.x, tmp.y, sim.cfg.er * .55, '#3a1566');
      ctx.fillStyle = '#E9D2FF'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(e.i + 1, tmp.x, tmp.y + 4);
    }

    for (let k = 0; k < NP * 6; k += 6) if (P[k + 4] > 0) {
      ctx.globalAlpha = P[k + 4];
      ctx.fillStyle = P[k + 5] ? '#B65CFF' : '#37E6F2';
      ctx.fillRect(P[k] - 1.5, P[k + 1] - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;

    if (mode !== 'dead') {
      const x = sim.ppx + (sim.px - sim.ppx) * alpha, y = sim.ppy + (sim.py - sim.ppy) * alpha;
      let tx = x, ty = y;
      ctx.lineWidth = 7;
      for (let j = 1; j <= 12; j++) {                        // estela del jugador desde el historial
        const i = h.n - 1 - j * 2; if (i < 0) break;
        const k = h.idx(i);
        ctx.strokeStyle = `rgba(55,230,242,${.5 * (1 - j / 13)})`;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(h.x[k], h.y[k]); ctx.stroke();
        tx = h.x[k]; ty = h.y[k];
      }
      glow('#37E6F2', 20); ball(x, y, sim.cfg.pr, '#37E6F2');
      ctx.shadowBlur = 0; ball(x, y, sim.cfg.pr * .45, '#E8FEFF');
    }
  };

  /* ---------- HUD y diagnóstico ---------- */
  const f = (n, d = 2) => n.toFixed(d);
  const updateUI = () => {
    const ts = f(sim.t, 1) + ' s';
    if (tm.textContent !== ts) tm.textContent = ts;
    sim.echoes.forEach((e, i) => {
      const c = chips[i];
      let txt = 'E' + (i + 1) + ' ';
      if (e.state === WAIT) txt += 'en ' + f(e.delay - sim.t, 1) + 's';
      else if (e.state === ACT) txt += 'activo ' + f(e.delay + sim.cfg.dur - sim.t, 1) + 's';
      else txt += e.state === EXP ? 'expirado' : 'off';
      if (c.textContent !== txt) c.textContent = txt;
      if (c.dataset.s !== e.state) c.dataset.s = e.state;
    });
    if (!debug) return;
    const h = sim.hist, c = sim.cfg;
    const L = [
      `modo=${mode}  fps=${f(fps, 0)}  pasos/frame=${steps}`,
      `t=${f(sim.t, 3)}  tick=${sim.tick}  dt=1/60`,
      `jugador=(${f(sim.px, 1)}, ${f(sim.py, 1)})`,
      `historial=${h.n}/${h.cap}  [${f(h.oldest(), 2)} .. ${f(h.newest(), 2)}]`,
      `duración=${c.dur}s`
    ];
    for (const e of sim.echoes) L.push(
      `E${e.i + 1} ${e.state}  retraso=${e.delay}s  tq=${e.state === ACT ? f(e.tq, 3) : '-'}  pos=` +
      (e.state === ACT ? `(${f(e.x, 1)}, ${f(e.y, 1)})` : '-'));
    dbg.textContent = L.join('\n');
  };

  const frame = now => {
    requestAnimationFrame(frame);
    if (!last) last = now;
    const dt = Math.min(now - last, 250) / 1000; last = now;
    fps += (1 / Math.max(dt, 1e-4) - fps) * .05;
    acc += dt; steps = 0;
    while (acc >= DT && steps < 5) { tick(); acc -= DT; steps++; }
    if (acc >= DT) acc = 0;                                  // límite de pasos: descarta el retraso excesivo
    draw(mode === 'play' ? acc / DT : 0);
    updateUI();
  };

  layout();
  show('ECHO<i>//</i>LOOP', 'Tu pasado es tu enemigo. Sobrevive a tus propios ECHOS.', 'JUGAR');
  requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') boot();
