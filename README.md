# ECHO//LOOP — PARADOX PROTOCOL

> Your past is not chasing you. It is completing what you started.

Puzzle arcade temporal para Build & Play (Open2.io). Un único objetivo: **estabilizar el núcleo**.

## Cómo se juega

`E_i(t) = P(t - τ_i)` con τ = 6, 13 y 21 s. El ECHO repite tu recorrido; no lo modifica.

1. **Rutea.** La compuerta violeta lo vuelve AISLANTE y la cian, CONDUCTOR. La trayectoria no cambia. Tú no tienes fase: la compuerta actúa cuando el ECHO reproduce el cruce.
2. **Sincroniza.** El núcleo carga a `(k-1)` por segundo con dos o más nodos a la vez. El nodo amarillo solo cuenta 2 s cada 8.
3. **Arriesga.** Dos ECHOS conductores en el mismo nodo triplican la carga durante 1.2 s. Si siguen, el núcleo se descarga.

Si un ECHO te toca, el tiempo se rompe.

Cinco niveles. El 5 usa solo los ECHOS de 6 s y 13 s: el de 21 s no entra, porque una partida resuelta termina antes y su cuenta atrás confundía. Cada nivel se puntúa por tiempo (S/A/B/C) y guarda el mejor (`localStorage`, clave `el2`).

## Controles

| Acción | Tecla |
|---|---|
| Mover | `WASD` / flechas (táctil: arrastrar) |
| Pausa | `P` / `Esc` (también al ocultar la pestaña) |
| Reiniciar nivel | `R` |
| Silencio | `M` (el botón VOL cicla el volumen) |
| Diagnóstico | `F3` |

## Ejecutar

Página estática sin compilación: abre `index.html` o sirve la carpeta con cualquier servidor estático.

Parámetros de URL para pruebas: `?lv=3` abre directamente el nivel 3; `?dur=30` hace que los ECHOS expiren tras 30 s activos (por defecto no expiran en los niveles).

## Arquitectura (`game.js`)

- `TemporalHistory`: buffer circular (1500 muestras a 60 Hz, `Float64Array` tiempo + `Float32Array` x/y) con consulta interpolada linealmente.
- `createSim`: simulación determinista a paso fijo 1/60 con reloj entero de ticks (sin deriva). Jugador (velocidad constante, diagonal normalizada, arena circular), ECHOS (WAITING/ACTIVE/EXPIRED/DISABLED), colisión circular, resonancia de nodos y carga del núcleo. Emite eventos (`ev`) que el navegador convierte en efectos y sonido, sin afectar a la simulación.
- `boot`: acumulador con máximo de 5 pasos por frame, render Canvas 2D (arena, núcleo, ECHOS, estelas, partículas en pools), audio procedural Web Audio, HUD y diagnóstico.
- Un ECHO con `τ` mayor que la cobertura del buffer (~24,98 s) queda `DISABLED`.
- La velocidad del jugador es instantánea a propósito: el ECHO repite posiciones, y la precisión del recorrido es la mecánica. El "feel" se consigue con estiramiento, estelas y partículas.

## Pruebas

```
node tests/sim.test.js
```

Sin dependencias. Cubre historial, interpolación y sobrescritura del buffer; reproducción exacta de ECHOS con trayectorias circular, rectangular, zigzag, sinusoidal, quieto, cambios bruscos y contra los límites; retrasos enteros y fraccionarios; ciclo de vida; colisión determinista; reinicio; límite circular; geometría de niveles; carga de resonancia (`k=1,2,3`); victoria; determinismo; y un bot que verifica que **cada nivel es ganable**.

## Despliegue en Vercel

Framework Preset: **Other** · Root Directory: raíz · Build/Install Command: vacío · Output Directory: raíz.

## Presupuesto de descarga (límite 32 KB, objetivo 28 KB)

Medido en local (Chrome, caché desactivada, recarga completa, servidor con brotli, 3 solicitudes, sin favicon externo):

| Recurso | Original (B) | Transferido (B) |
|---|---|---|
| `index.html` | 2166 | 1139 |
| `style.css` | 7767 | 2513 |
| `game.js` | 40225 | 12352 |
| **Total** | **50158** | **16004** |

Pendiente: repetir la medición en la URL desplegada en Vercel.
