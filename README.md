# ECHO//LOOP

Arcade de supervivencia temporal para Build & Play (Open2.io). Controlas una esfera; tras `τ` segundos aparecen **ECHOS** que reproducen exactamente tu recorrido pasado:

```
E_i(t) = P(t - τ_i)        τ = 6 s, 13 s, 21 s
```

Sin IA: los ECHOS no persiguen, no corrigen ni aceleran; solo consultan el historial real del jugador.

## Controles

- Mover: `WASD` o flechas (en táctil, arrastrar sobre el canvas).
- `F3`: diagnóstico (tiempo, posición, muestras, estado/posición/retraso/`tq` de cada ECHO).
- `R` o botón: reiniciar tras la derrota.

## Ejecutar

Página estática, sin compilación. Abre `index.html` o sirve la carpeta con cualquier servidor estático.

Experimentos por URL: `?dur=30` (duración activa de cada ECHO) y `?on=100` (ECHOS habilitados).
Valores por defecto en `CFG` al inicio de `game.js` (`dur: 12`, `delays: [6, 13, 21]`, `cap: 1500`).

## Arquitectura (`game.js`)

- `TemporalHistory`: buffer circular (`Float64Array` tiempo, `Float32Array` x/y; 1500 muestras a 60 Hz ≈ 25 s) con consulta interpolada linealmente.
- `createSim`: simulación determinista a paso fijo 1/60 (jugador, arena, ECHOS WAITING/ACTIVE/EXPIRED/DISABLED, colisión circular). El reloj es un contador entero de ticks (sin deriva) y no usa temporizadores.
- Navegador (`boot`): acumulador de tiempo con máximo de 5 pasos por frame, pausa al ocultar la pestaña, render Canvas 2D, HUD y diagnóstico.
- Un ECHO con `τ` mayor que la cobertura del buffer (~24,98 s) queda `DISABLED`.

## Pruebas

```
node tests/sim.test.js
```

Sin dependencias. Compara cada posición de ECHO contra una referencia independiente con trayectorias circular, rectangular, zigzag, sinusoidal, quieto, cambios bruscos y contra los límites, con buffer lleno y sobrescrito, retrasos enteros y fraccionarios, ciclo de vida, colisión y reinicio.

## Despliegue en Vercel

Framework Preset: **Other** · Root Directory: raíz · Build/Install Command: vacío · Output Directory: raíz.

## Presupuesto de descarga (límite 32 KB, objetivo 28 KB)

Medido en local (Chrome, caché desactivada, recarga completa, servidor con gzip):

| Recurso | Original (B) | Transferido (B) |
|---|---|---|
| `index.html` | 845 | 811 |
| `style.css` | 2154 | 1271 |
| `game.js` | 14154 | 5604 |
| Favicon (data URI) | 0 | 0 |
| **Total (3 solicitudes)** | **17153** | **7686** |

Pendiente: repetir la medición en la URL desplegada de Vercel.
