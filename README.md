# ECHO//LOOP

Arcade temporal. Tu recorrido queda grabado y, unos segundos después, vuelve a recorrerse solo.

## Cómo se juega

Mueves una esfera dentro de una arena. A los 6, 13 y 21 segundos aparecen ecos de tu propio camino. No te persiguen: repiten lo que hiciste.

El núcleo se estabiliza cuando dos o más nodos resuenan a la vez. Un eco en fase conductora puede mantener un nodo por ti. Si atraviesa una compuerta violeta pasa a aislante y deja de activarlos; la compuerta cian lo devuelve a conductor. El camino no cambia.

Algunos nodos solo cuentan durante una ventana. Si dos ecos conductores coinciden en el mismo nodo, la carga se triplica un instante. Si se quedan, el núcleo se descarga. Tocar un eco termina la partida.

Hay cinco niveles. El tiempo decide el rango, de S a C.

## Controles

| Acción | Teclado | Táctil |
|---|---|---|
| Mover | WASD o flechas | Arrastrar |
| Pausa | P o Esc | Botón PAUSA |
| Reiniciar | R | Botón de la pantalla final |
| Volumen | M silencia. El botón VOL cambia el nivel | Igual |

## Tecnologías

HTML, CSS y JavaScript, sin librerías. El dibujo es Canvas 2D y el sonido se genera con Web Audio.

## Jugar

Abre `index.html`. El sitio publicado es el despliegue estático de este repositorio.
