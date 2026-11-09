'use strict';
// Ejecutar: node tests/sim.test.js   (sin dependencias; no se carga desde el navegador)
const assert = require('assert');
const { TemporalHistory, createSim, DT } = require('../game.js');

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
    assert(s.px >= s.cfg.pr && s.px <= s.cfg.aw - s.cfg.pr && s.py >= 0 && s.py <= s.cfg.ah, 'fuera de la arena');
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

console.log(`\n${tests} pruebas OK, ${checks} comparaciones de posición.`);
