'use strict';
// Ejecutar: node tests/sim.test.js   (sin dependencias; no se carga desde el navegador)
const assert = require('assert');
const { TemporalHistory, createSim, DT } = require(process.env.GAME || '../src/game.js');

let checks = 0, tests = 0;
const near = (a, b, m) => { checks++; assert(Math.abs(a - b) < 2e-3, `${m}: ${a} != ${b}`); };

/* Verdad de referencia independiente: interpola el registro de posiciones del test. */
function truth(log, q) {
  const k = Math.floor(q / DT + 1e-7), f = Math.min(1, Math.max(0, q / DT - k));
  const a = log[k], b = log[Math.min(k + 1, log.length - 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/* Ejecuta un recorrido y compara cada ECHO ACTIVE con la verdad en cada paso. */
function run(name, path, ticks, over = {}) {
  tests++;
  const s = createSim(Object.assign({ pr: 0, er: 0 }, over)); // radios 0: sin colisión
  const log = [[s.px, s.py]];
  let active = 0;
  for (let i = 0; i < ticks; i++) {
    const [ix, iy] = path(i);
    s.step(ix, iy);
    log.push([s.px, s.py]);
    assert(Math.hypot(s.px - s.cfg.cx, s.py - s.cfg.cy) <= s.cfg.R - s.cfg.pr + 1e-6, 'fuera de la arena circular');
    for (const e of s.echoes) if (e.state === 'ACTIVE') {
      const [x, y] = truth(log, s.t - e.delay);
      near(e.x, x, `${name} E${e.i + 1}.x t=${s.t.toFixed(3)}`);
      near(e.y, y, `${name} E${e.i + 1}.y t=${s.t.toFixed(3)}`);
      active++;
    }
  }
  assert(active > 0, name + ': ningún ECHO se activó');
  console.log(`ok  ${name.padEnd(34)} ticks=${ticks} hist=${s.hist.n} comprobaciones activas=${active}`);
  return s;
}

const seg = (a, n) => i => a[Math.floor(i / n) % a.length];
const paths = {
  circular: i => [Math.cos(i * .05), Math.sin(i * .05)],
  rectangular: seg([[1, 0], [0, 1], [-1, 0], [0, -1]], 90),
  zigzag: seg([[1, 1], [1, -1]], 25),
  sinusoidal: i => [1, Math.sin(i * .08)],
  quieto: () => [0, 0],
  bruscos: (() => { let r = 12345, d = [0, 0], c = 0; return () => {
    if (c-- <= 0) { r = (r * 1103515245 + 12345) & 0x7fffffff; const a = (r % 8) * Math.PI / 4; d = [Math.cos(a), Math.sin(a)]; c = 2 + (r >> 8) % 8; }
    return d; }; })(),
  contraLimites: () => [1, 0.3]
};
const delaysSets = { 'retrasos 6/13/21': [6, 13, 21], 'retrasos fraccionarios': [6.0083, 13.0141, 20.9917] };

for (const [dn, delays] of Object.entries(delaysSets))
  for (const [pn, p] of Object.entries(paths)) {
    // 3000 ticks (50 s) => buffer de 1500 muestras lleno y sobrescrito más de una vez
    const s = run(`${pn} / ${dn}`, p, 3000, { delays });
    assert.strictEqual(s.hist.n, 1500);
    near(s.hist.oldest(), (3000 - 1499) * DT, 'más antigua tras sobrescritura');
  }

/* TemporalHistory aislado */
(() => {
  tests++;
  const h = new TemporalHistory(4), o = {};
  for (let i = 0; i < 6; i++) h.push(i, i * 10, i * -10);   // t=0..5; conserva 2..5
  assert.strictEqual(h.n, 4); near(h.oldest(), 2, 'oldest'); near(h.newest(), 5, 'newest');
  assert.strictEqual(h.at(1.9, o), false, 'antes de lo almacenado');
  assert(h.at(2, o)); near(o.x, 20, 'borde antiguo');
  assert(h.at(3.25, o)); near(o.x, 32.5, 'interp x'); near(o.y, -32.5, 'interp y');
  assert(h.at(4.999, o)); near(o.x, 49.99, 'interp cerca del final');
  assert(h.at(9, o)); near(o.x, 50, 'más allá: última muestra');
  h.clear(); assert.strictEqual(h.at(0, o), false, 'vacío');
  h.push(1, 5, 5); assert(h.at(1, o)); near(o.x, 5, 'una muestra');
  console.log('ok  TemporalHistory (wrap, interpolación)');
})();

/* El ECHO reproduce el recorrido anterior, no la posición actual */
(() => {
  tests++;
  const s = createSim({ pr: 0, er: 0 });
  for (let i = 0; i < 360; i++) s.step(1, 0);               // 6 s hacia la derecha
  const x0 = s.sx; let ex = [];
  for (let i = 0; i < 120; i++) { s.step(-1, 0); ex.push(s.echoes[0].x); }
  assert(s.px < s.echoes[0].x, 'el jugador va a la izquierda');
  assert(ex[119] > ex[0], 'el ECHO avanza a la derecha (pasado), no sigue al jugador');
  near(ex[0], x0 + 260 * DT, 'primer paso del recorrido original');
  console.log('ok  ECHO reproduce el pasado, no el presente');
})();

/* Ciclo de vida */
(() => {
  tests++;
  const s = createSim({ pr: 0, er: 0 });
  const st = n => { while (s.tick < n) s.step(0, 0); return s.echoes.map(e => e.state[0]).join(''); };
  // E1 activo [6,18) s, E2 [13,25) s, E3 [21,33) s  =>  ticks 360/1080, 780/1500, 1260/1980
  const seq = [[359, 'WWW'], [360, 'AWW'], [779, 'AWW'], [780, 'AAW'], [1079, 'AAW'], [1080, 'EAW'],
    [1259, 'EAW'], [1260, 'EAA'], [1499, 'EAA'], [1500, 'EEA'], [1979, 'EEA'], [1980, 'EEE']];
  for (const [n, exp] of seq) assert.strictEqual(st(n), exp, 'tick ' + n);
  console.log('ok  ciclo de vida WAITING -> ACTIVE -> EXPIRED');
})();

/* Retraso fuera de la cobertura del buffer => DISABLED; ECHO deshabilitado por config */
(() => {
  tests++;
  const s = createSim({ delays: [6, 30], on: [0, 1] });
  assert.deepStrictEqual(s.echoes.map(e => e.state), ['DISABLED', 'DISABLED']);
  console.log('ok  DISABLED (config y retraso > cobertura)');
})();

/* Colisión: quieto en el punto de aparición => derrota exacta en t = 6 s, reproducible */
(() => {
  tests++;
  const hits = [0, 1].map(() => { const s = createSim(); for (let i = 0; i < 600 && !s.over; i++) s.step(0, 0); return [s.tick, s.hit]; });
  assert.deepStrictEqual(hits[0], [360, 0]); assert.deepStrictEqual(hits[0], hits[1]);
  const s = createSim(); for (let i = 0; i < 400; i++) s.step(0, 0);
  assert.strictEqual(s.tick, 360, 'tras la derrota la simulación se congela');
  console.log('ok  colisión determinista (tick 360, ECHO 1)');
})();

/* Sin colisión si el jugador se aleja; los ECHOS no colisionan entre sí ni persiguen */
(() => {
  tests++;
  const s = createSim();
  for (let i = 0; i < 400 && !s.over; i++) s.step(1, 0);    // el jugador queda en el borde derecho; ECHO 1 nace en el centro
  assert(!s.over, 'no debería colisionar lejos del origen');
  console.log('ok  sin colisión lejos del punto de aparición');
})();

/* Reinicio: elimina el historial anterior */
(() => {
  tests++;
  const s = createSim({ pr: 0, er: 0 });
  for (let i = 0; i < 2000; i++) s.step(Math.cos(i * .1), 1);
  s.reset();
  assert.strictEqual(s.hist.n, 1); assert.strictEqual(s.tick, 0); assert.strictEqual(s.hist.newest(), 0);
  assert(s.echoes.every(e => e.state === 'WAITING'));
  const log = [[s.px, s.py]];
  for (let i = 0; i < 800; i++) { s.step(-1, 0.2); log.push([s.px, s.py]); const e = s.echoes[0];
    if (e.state === 'ACTIVE') { const [x, y] = truth(log, s.t - 6); near(e.x, x, 'post-reinicio x'); near(e.y, y, 'post-reinicio y'); } }
  console.log('ok  reinicio limpia el historial y reproduce solo la partida nueva');
})();

/* Velocidad constante y diagonal normalizada */
(() => {
  tests++;
  const a = createSim({ speed: 260 }), b = createSim({ speed: 260 });
  a.step(1, 0); b.step(1, 1);
  const da = Math.hypot(a.px - a.ppx, a.py - a.ppy), db = Math.hypot(b.px - b.ppx, b.py - b.ppy);
  near(da, db, 'diagonal = recta'); near(da, 260 * DT, 'velocidad');
  console.log('ok  velocidad constante, diagonal normalizada');
})();

/* ======================= Resonancia (PARADOX ENGINE) ======================= */
const { LEVELS, CFG } = require(process.env.GAME || '../src/game.js');
const steer = (s, tx, ty) => { const dx = tx - s.px, dy = ty - s.py, d = Math.hypot(dx, dy); return d < 3 ? [0, 0, true] : [dx / d, dy / d, false]; };
const toward = (s, n, max = 600) => { for (let i = 0; i < max && !s.over; i++) { const [ix, iy, ok] = steer(s, n.x, n.y); if (ok) return true; s.step(ix, iy); } return false; };
const sameSim = (a, b) => a.tick === b.tick && a.px === b.px && a.py === b.py && a.charge === b.charge && a.k === b.k && a.over === b.over && a.won === b.won;

/* Geometría de niveles: nodos dentro de la arena, separados y fuera del punto de aparición */
(() => {
  tests++;
  for (const [i, L] of LEVELS.entries()) {
    const s = createSim(); s.load(i);
    assert(L.g > 0 && L.par > 0 && L.on.some(Boolean), `nivel ${i + 1}: configuración`);
    assert(s.nodes.length >= 2, `nivel ${i + 1}: al menos 2 nodos`);
    s.nodes.forEach((n, a) => {
      assert(Math.hypot(n.x - s.cfg.cx, n.y - s.cfg.cy) + s.cfg.nr + s.cfg.pr < s.cfg.R, `nivel ${i + 1}: nodo ${a} dentro de la arena`);
      assert(Math.hypot(n.x - s.sx, n.y - s.sy) > 100, `nivel ${i + 1}: nodo ${a} lejos del punto de aparición`);
      s.nodes.slice(a + 1).forEach(m => assert(Math.hypot(n.x - m.x, n.y - m.y) > 2 * s.cfg.nr + 40, `nivel ${i + 1}: nodos separados`));
    });
    assert.strictEqual(s.cfg.dur, Infinity, 'los ECHOS de nivel no expiran');
  }
  console.log(`ok  geometría de ${LEVELS.length} niveles`);
})();

/* El jugador sintoniza un nodo y emite el evento; solo con ECHO + jugador hay sincronía */
(() => {
  tests++;
  const s = createSim(); s.load(0);
  assert(toward(s, s.nodes[0]));
  assert.strictEqual(s.nodes[0].by, 1, 'jugador sobre el nodo');
  assert(s.ev.some(e => e[0] === 2 && e[1] === 0 && e[2] === 1), 'evento de nodo');
  for (let i = 0; i < 120; i++) s.step(0, 0);
  assert.strictEqual(s.k, 1); assert.strictEqual(s.charge, 0, 'un solo nodo no carga');
  console.log('ok  nodo sintonizado por el jugador (sin carga con k=1)');
})();

/* Carga a (k-1)/s y victoria: ECHO 1 mantiene el nodo A mientras el jugador toma B */
(() => {
  tests++;
  const s = createSim(); s.load(0);
  const [A, B] = s.nodes;
  assert(toward(s, A));
  while (s.t < 5.9) s.step(0, 0);                          // el jugador mantiene A hasta justo antes de 6 s
  assert(toward(s, B));                                     // y pasa a B
  const c0 = s.charge;                                      // la carga ya puede haber empezado al entrar en B
  let ticks = 0, sync = 0, win = 0;
  for (const e of s.ev) { sync += e[0] === 3; }
  s.ev.length = 0;
  while (!s.won && !s.over && s.t < 30) {
    s.step(...steer(s, B.x, B.y).slice(0, 2));
    if (s.k >= 2) assert.strictEqual(s.k, 2);
    ticks += s.k >= 2;
    for (const e of s.ev) { sync += e[0] === 3; win += e[0] === 5; }
    s.ev.length = 0;
  }
  assert(!s.over, 'sin colisión con el ECHO'); assert(s.won, 'núcleo estabilizado');
  assert.strictEqual(sync, 1, 'un evento de sincronía'); assert.strictEqual(win, 1, 'un evento de victoria');
  near(s.charge, s.cfg.goal, 'carga final = objetivo');
  assert(Math.abs(ticks * DT - (s.cfg.goal - c0)) <= DT + 1e-6, 'k=2 carga 1 por segundo');
  const t = s.tick; s.step(1, 0); assert.strictEqual(s.tick, t, 'tras la victoria la simulación se congela');
  console.log(`ok  ECHO mantiene un nodo mientras el jugador toma otro: victoria a ${s.t.toFixed(2)} s`);
})();

/* Tasa de carga (k-1) por tick con k=1,2,3 en un escenario guionizado de 3 nodos y 2 ECHOS */
(() => {
  tests++;
  const s = createSim({ delays: [2, 4], on: [1, 1], nodes: [[0, .3], [120, .3], [240, .3]], goal: 99 });
  // El jugador deja N0 antes de t=2 (nacimiento de ECHO 1 en el núcleo). Entre 4,42 s y 5,2 s:
  // ECHO 2 en N0 (P(t-4)), ECHO 1 en N1 (P(t-2)) y el jugador en N2 => k=3. A 5,6 s aún no llega ECHO 1 a N2.
  const plan = [[0, 1.4], [1, 3.2], [2, 99]];                // [nodo, mantener hasta t]
  let p = 0, prev = 0; const seen = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 5.6 * 60 && !s.over; i++) {
    const [ix, iy, ok] = steer(s, s.nodes[plan[p][0]].x, s.nodes[plan[p][0]].y);
    if (ok && s.t >= plan[p][1]) p++;
    s.step(ok ? 0 : ix, ok ? 0 : iy);
    near(s.charge - prev, s.k >= 2 ? (s.k - 1) * DT : 0, 'delta de carga tick ' + s.tick); prev = s.charge;
    if (s.k) seen[s.k]++;
  }
  assert(!s.over, 'el guion no debe colisionar');
  assert(seen[1] > 0 && seen[2] > 0 && seen[3] > 0, 'se alcanzaron k=1,2,3: ' + JSON.stringify(seen));
  console.log('ok  tasa de carga (k-1)/s verificada para k=1,2,3 ' + JSON.stringify(seen));
})();

/* Determinismo: mismas entradas => mismo estado; reinicio => estado inicial */
(() => {
  tests++;
  const inp = i => [Math.cos(i * .031), Math.sin(i * .047)];
  const a = createSim(), b = createSim(); a.load(2); b.load(2);
  for (let i = 0; i < 2500; i++) { a.step(...inp(i)); b.step(...inp(i)); assert(sameSim(a, b), 'divergencia en tick ' + i); if (a.over) break; }
  a.load(2);
  assert.strictEqual(a.tick, 0); assert.strictEqual(a.charge, 0); assert.strictEqual(a.k, 0); assert.strictEqual(a.ev.length, 0);
  assert(a.nodes.every(n => n.by === 0)); assert.strictEqual(a.hist.n, 1);
  console.log('ok  determinismo y reinicio completo (nodos, carga, eventos)');
})();

/* Límite circular: nunca fuera, incluso empujando en diagonal contra el borde */
(() => {
  tests++;
  const s = createSim({ pr: 0, er: 0 });
  for (let i = 0; i < 900; i++) { s.step(1, 1); assert(Math.hypot(s.px - s.cfg.cx, s.py - s.cfg.cy) <= s.cfg.R - s.cfg.pr + 1e-6); }
  near(Math.hypot(s.px - s.cfg.cx, s.py - s.cfg.cy), s.cfg.R - s.cfg.pr, 'apoyado en el borde');
  console.log('ok  límite circular de la arena');
})();

/* El nivel 1 sigue teniendo un relé simple. Los demás no se resuelven repitiendo nodos al azar. */
(() => {
  tests++;
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const play = (li, plan) => {
    const s = createSim(); s.load(li);
    let p = 0, hold = 0;
    for (let i = 0; i < 100 * 60 && !s.over && !s.won; i++) {
      const [n, w] = plan[p % plan.length], node = s.nodes[n % s.nodes.length];
      const [ix, iy, ok] = steer(s, node.x, node.y);
      if (ok || hold > 0) { hold++; if (hold >= w * 60) { hold = 0; p++; } s.step(0, 0); } else s.step(ix, iy);
      if (ok && hold === 0) hold = 1;
    }
    return s;
  };
  let best = null;
  for (let tried = 0; tried < 30000 && !best; tried++) {
    const plan = Array.from({ length: 2 + Math.floor(rnd() * 5) }, () => [Math.floor(rnd() * 2), +(0.2 + rnd() * 7).toFixed(1)]);
    const s = play(0, plan);
    if (s.won) best = s.t;
  }
  assert(best && best < LEVELS[0].par, 'nivel 1 resoluble por relé');
  for (const li of [1, 2, 3, 4]) {
    let wins = 0;
    for (let t = 0; t < 250; t++) {
      const n0 = LEVELS[li].nodes.length;
      const plan = Array.from({ length: 2 + (t % 5) }, () => [Math.floor(rnd() * n0), 0.3 + rnd() * 6]);
      if (play(li, plan).won) wins++;
    }
    assert(wins <= 2, `nivel ${li + 1}: el ciclo aleatorio sigue siendo estrategia dominante (${wins}/250)`);
  }
  console.log('ok  nivel 1 resoluble; niveles 2-5 no caen ante 250 planes cíclicos');
})();

const W = (x, y, until) => ({ x, y, until });
function route(li, steps, limit = 40) {
  const s = createSim(); s.load(li);
  let i = 0, phases = 0, peak = 0;
  while (s.t < limit && !s.over && !s.won) {
    const step = steps[Math.min(i, steps.length - 1)];
    const target = step.n != null ? s.nodes[step.n] : step;
    const [ix, iy, ok] = steer(s, target.x, target.y);
    const before = s.charge;
    s.step(ok ? 0 : ix, ok ? 0 : iy);
    if (s.charge - before > peak) peak = s.charge - before;
    for (const e of s.ev) if (e[0] === 6) phases++;
    s.ev.length = 0;
    if (ok && s.t >= step.until && i < steps.length - 1) i++;
  }
  return Object.assign(s, { phases, peak });
}

/* Compuerta: el cruce real cambia la fase una sola vez; el atajo recto aísla y no carga */
(() => {
  tests++;
  const bad = route(1, [{ n: 0, until: 5.5 }, { n: 1, until: 12 }], 13);
  assert.strictEqual(bad.echoes[0].ph, 0, 'el atajo deja al ECHO aislante');
  assert.strictEqual(bad.phases, 1, 'un cruce, una activación');
  assert(bad.charge < 0.2, 'un ECHO aislante no carga');
  const good = route(1, [W(145, 400, 0), W(170, 520, 0), { n: 0, until: 5.5 }, { n: 1, until: 20 }]);
  assert(good.won, 'el hueco oeste mantiene al ECHO conductor');
  assert.strictEqual(good.echoes[0].ph, 1);
  console.log('ok  compuerta: un cruce, fase persistente, atajo aislante');
})();

/* Ventanas: 2 s abiertas cada 8, preaviso en el último segundo, mismo reloj siempre */
(() => {
  tests++;
  const s = createSim({ pr: 0, er: 0 }); s.load(2);
  const n = s.nodes[1];
  const openAt = t => { while (s.t < t && !s.over) s.step(0, 0); return n.open; };
  assert.strictEqual(openAt(1), true, 'ventana inicial');
  assert.strictEqual(openAt(3), false);
  assert.strictEqual(openAt(7.4), false); assert(n.pre, 'preaviso');
  assert.strictEqual(openAt(8.2), true, 'segunda ventana');
  assert.strictEqual(openAt(10.5), false);
  const a = createSim(), b = createSim(); a.load(2); b.load(2);
  for (let i = 0; i < 500; i++) { a.step(0, 0); b.step(0, 0); }
  assert.strictEqual(a.nodes[1].open, b.nodes[1].open);
  const solved = route(2, [
    W(145, 500, 0), { n: 0, until: 5.6 }, W(110, 240, 6.6), { n: 1, until: 10.05 },
    W(560, 210, 12.6), W(400, 590, 14.9), { n: 1, until: 18.2 }
  ]);
  assert(solved.won, 'guion del nivel 3');
  console.log('ok  ventanas deterministas y nivel 3 resoluble en ' + solved.t.toFixed(1) + ' s');
})();

/* Dos fases: el corredor violeta+cian conduce; el atajo aísla. Paradoja ×3 y descarga. */
(() => {
  tests++;
  const good = route(3, [
    W(160, 430, 0), W(250, 560, 0), { n: 1, until: 5.0 },
    W(150, 430, 6.3), W(240, 230, 7.5), { n: 0, until: 10.05 },
    W(560, 240, 14.6), W(470, 100, 15.95), { n: 0, until: 18.2 }
  ]);
  assert(good.won, 'corredor conductor');
  assert(good.echoes[0].ph === 1 && good.echoes[1].ph === 1);
  const bad = route(3, [W(520, 560, 0), { n: 1, until: 5.2 }, { n: 0, until: 16 }], 16);
  assert(!bad.won && bad.echoes[0].ph === 0, 'atajo aislante');
  const px = route(4, [
    { n: 0, until: 2.45 }, W(400, 140, 7.15), W(400, 100, 7.5), W(170, 200, 8.75), { n: 0, until: 10.3 },
    W(500, 340, 12.6), { n: 1, until: 16.6 }
  ]);
  assert(px.won, 'paradoja resoluble');
  assert(px.peak > 2 * DT, 'el solape supera la carga normal');
  const s = createSim({ para: 1, delays: [3, 4], on: [1, 1, 0], nodes: [[30, .55], [80, .55]], gates: [], goal: 99 });
  let guard = 0;
  while (s.t < 3.15 && !s.over) { const [ix, iy, ok] = steer(s, s.nodes[0].x, s.nodes[0].y); s.step(ok ? 0 : ix, ok ? 0 : iy); if (++guard > 500) break; }
  let max = 0, fell = false;
  while (s.t < 9 && !s.over) {
    const [ix, iy, ok] = steer(s, s.nodes[1].x, s.nodes[1].y);
    s.step(ok ? 0 : ix, ok ? 0 : iy);
    if (s.charge > max + 1e-9) max = s.charge; else if (max > 1 && s.charge < max - 0.15) fell = true;
  }
  assert(fell, 'pasado 1.2 s el solape descarga');
  s.load(4);
  assert.strictEqual(s.charge, 0); assert(s.nodes.every(n => n.pt === 0 && n.by === 0));
  assert(s.echoes.every(e => e.ph === 1 && e.state !== 'ACTIVE'));
  console.log('ok  fases, paradoja x' + (px.peak / DT).toFixed(1) + ' y descarga');
})();

console.log(`\n${tests} pruebas OK, ${checks} comparaciones de posición.`);
