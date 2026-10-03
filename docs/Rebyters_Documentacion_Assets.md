# Rebyters — Documentación de assets

Fecha: 3 de octubre de 2026 · Versión 1.0

Documento de referencia para producir los 58 Rebyters, sus hábitats y sus animaciones. Recoge la estrategia conversada y autorizada para documentación. Los presupuestos técnicos son objetivos iniciales pendientes de validar con modelos reales; no representan resultados ya obtenidos.

## 1. Objetivo y alcance

Crear 58 criaturas originales con estética consistente, aptas para un visor Three.js en app móvil, webapp y sitio web. Generar los modelos con Meshy, optimizarlos y almacenar los recursos finales en Irys.

Objetivo de peso: aproximadamente 300 KB por GLB cuando sea viable. La calidad visual y las deformaciones se validan antes de imponer ese límite a todas las anatomías. Las animaciones de objetos, como comida, quedan para una etapa posterior.

Referencias visuales de la conversación:

- image(20261003-150022).png: interfaz actual, con personaje pequeño y demasiado espacio vacío superior.
- image(20261003-150032).png: objetivo de composición; personaje protagonista, plataforma y escena integrada. Los modelos finales se producirán con Meshy.
- image(20261003-150119).png: atlas de 58 formas. La captura muestra 1 origen, 4 Bytes, 12 Kylos, 22 Megas, 13 Gigas y 6 Teras.

La mejora visual depende también de cámara, escala, suelo e iluminación; no solamente de sustituir el personaje por un GLB.

## 2. Principio de producción

Completar un Rebyter dentro del juego antes de producir los otros 57. El primer piloto establece el estándar artístico, la viabilidad del rig, las animaciones, el tamaño final y el rendimiento móvil.

No generar los 58 modelos de forma independiente antes de validar el flujo. Producir por lotes de anatomía, revisando la coherencia de cada línea evolutiva.

## 3. Dirección artística

Estética: anime retro con geometría low-poly y texturas pintadas sencillas; inspiración general en criaturas coleccionables tipo Pokémon/Digimon, con diseños originales propios.

- Siluetas reconocibles en tamaño pequeño.
- Cabezas expresivas, ojos grandes y extremidades simplificadas.
- Pelaje mediante volúmenes y manchas de color, sin pelos individuales.
- Entre tres y cinco colores protagonistas por criatura.
- Materiales mayormente mates.
- Orejas, cuernos, colas y garras legibles después de reducir polígonos.
- Evoluciones más imponentes por silueta y proporciones, sin depender de microdetalles.
- Combinar facetas en cuernos, armaduras y rocas con sombreado más suave en cuerpos y caras cuando convenga.

Low-poly no exige que toda la criatura parezca una piedra facetada.

Antes de Meshy, aprobar imágenes de diseño contra una referencia maestra. Repetir un prompt ayuda, pero no garantiza consistencia entre generaciones. Preparar vistas frontal, lateral y tres cuartos coherentes: fondo neutro, cuerpo completo, extremidades separadas, sin escenario ni efectos integrados.

## 4. Grupos técnicos por anatomía

Estos grupos organizan assets y rigs; no modifican las familias ni las reglas evolutivas del juego.

| Grupo | Ejemplos | Estrategia |
|---|---|---|
| Compactos | Origen y Bytes | Movimientos simples y pocos huesos |
| Cuadrúpedos | Wolf, Cat, Fox, Deer | Base común con ajustes de proporción |
| Robustos | Bear, Elephant, Mammoth | Rig adaptado al volumen y peso |
| Bípedos o semibípedos | Monkey, Ape, Titan Ape | Base propia |
| Voladores | Bat, Bloodwing | Alas articuladas |
| Acuáticos | Seal, Dolphin, Whale | Cuerpo, aletas y cola; variantes según anatomía |

Meshy documenta auto-rigging para humanoides y cuadrúpedos y recomienda remesh antes del rig. No asumir que resuelve automáticamente esqueletos especiales, expresiones faciales complejas o colas particulares. Validar pronto un volador o acuático; puede requerir rig o correcciones adicionales fuera de Meshy.

## 5. Presupuesto técnico inicial

| Elemento | Objetivo de partida |
|---|---|
| Byte | 600–1.200 triángulos |
| Kylo / Mega | 1.200–2.500 triángulos |
| Giga / Tera | 2.000–4.000 triángulos |
| Materiales | Uno cuando sea posible |
| Textura de color | Una de 256 o 512 px |
| Huesos | Los mínimos necesarios; probar 12–24 en cuerpos sencillos |
| Peso final | Intentar 200–400 KB; referencia aproximada de 300 KB |

Son presupuestos propuestos, no garantías ni límites definitivos. Permitir excepciones justificadas por anatomía y calidad.

Empezar con una textura de color, sin mapas adicionales de normales, metal o rugosidad. Considerar colores por vértice si alcanzan la calidad visual buscada. Reducir triángulos no basta si siguen existiendo texturas grandes o pistas de animación innecesarias.

Tras exportar, inspeccionar y optimizar con glTF Transform: retirar datos sobrantes, optimizar pistas y comprimir geometría/texturas. Evaluar Meshopt o Draco para geometría y WebP o KTX2 para texturas según tamaño, calidad y compatibilidad. Configurar los decodificadores requeridos por el visor; no asumir que cualquier GLB comprimido se carga sin configuración.

El peso de descarga no equivale al consumo de memoria. Probar el archivo cargado y animado en dispositivos reales.

## 6. Animaciones

Estrategia híbrida: clips esqueléticos para movimientos articulados y código del frontend para reacciones simples, efectos y ambientación.

| Acción | Personaje | Frontend |
|---|---|---|
| Idle | Respiración, balanceo, cabeza o cola | Mirada ocasional y reacción al toque |
| Feed | Inclinarse y masticar | Comida y partículas en una fase posterior |
| Play | Salto o gesto alegre | Efectos de respuesta |
| Train | Esfuerzo o ataque corto | Impacto, polvo o contador |
| Care | Gesto de disfrute | Corazones o brillo |
| Rest | Pose de descanso y respiración | Ambiente nocturno |
| Evolve | Pose breve opcional | Luz, partículas y sustitución del modelo |

El rig y los clips pueden vivir dentro del GLB. El frontend decide cuándo reproducirlos, mezclarlos y acompañarlos con efectos. Verificar que la exportación de Meshy incluya realmente los clips elegidos.

Un Byte puede funcionar con rebote y balanceo programados. Un Wolf necesita articulación para comer o caminar de manera convincente.

Las animaciones por código no pesan literalmente cero: evitan algunas pistas del GLB, pero requieren código y partes o huesos controlables.

Para el piloto, incluir pocos clips dentro de cada GLB. Compartir bibliotecas de animación será una optimización posterior, después de demostrar compatibilidad entre al menos dos modelos. Nombres de huesos iguales no bastan: también importan jerarquía, pose base, orientación y proporciones; puede requerirse retargeting.

## 7. Hábitats y composición del visor

Construir pequeños escenarios 2.5D reutilizables:

- Fondo ilustrado o degradado con profundidad.
- Suelo o plataforma low-poly en 3D.
- Pocos elementos ambientales: piedras, plantas o cristales.
- Sombra sencilla debajo del personaje.
- Iluminación consistente entre criatura y entorno.

Posibles variantes: bosque, costa, cueva y espacio digital. Son propuestas, no un catálogo final aprobado.

No incorporar el hábitat dentro de cada GLB de criatura. Cargarlo como recurso separado y reutilizarlo.

El personaje debería ocupar aproximadamente el 55–65 % de la altura útil de la escena, con margen para saltos, orejas y alas. Ajustar cámara y escala por criatura: una ballena y un conejo no se encuadran igual. Evitar que el personaje quede pequeño, demasiado abajo o separado visualmente del suelo.

## 8. Distribución de recursos

| Recurso | Ubicación lógica |
|---|---|
| Malla, textura, rig | GLB de la criatura |
| Clips propios | Dentro del GLB al inicio |
| Fondos y elementos de hábitat | Recursos independientes reutilizables |
| Cámara, luces, transiciones y efectos | Frontend |
| Asociación entre especie y recursos | Catálogo/JSON |
| Estado individual del compañero | Sistema de estado del juego; separado del asset compartido |

Esta documentación define la producción visual; no cambia las instrucciones del programa ni las reglas de evolución.

## 9. Irys y carga en la aplicación

58 modelos de 300 KB sumarían aproximadamente 17,4 MB, sin fondos ni miniaturas. Es una estimación aritmética, no una medición de assets existentes ni una cotización.

Todos los NFT de una misma especie pueden referenciar el mismo GLB. No subir una copia por ejemplar. El estado individual determina qué recurso se presenta y cómo se comporta.

Cotizar los archivos finales en la red de Irys elegida antes de presupuestar costos. Publicar versiones aprobadas, conservar originales editables y evitar subir cada prueba. Al cambiar un recurso publicado, actualizar su referencia en el sistema correspondiente.

En el cliente:

- Cargar únicamente al compañero activo.
- Utilizar miniaturas para el atlas, no 58 visores 3D simultáneos.
- Reutilizar y cachear hábitats y recursos.
- Pausar el render cuando la escena no esté visible.
- Liberar recursos del modelo anterior cuando dejen de ser necesarios.

## 10. Orden de ejecución

1. Aprobar Fangbit como referencia artística: proporciones, cara, textura y acabado.
2. Crear un hábitat base con plataforma, fondo azul profundo e iluminación definitiva.
3. Completar Fangbit: diseño → Meshy → reducción/limpieza → textura → rig → animaciones → exportación → optimización → integración.
4. Probar dentro de la app y en un iPhone real: encuadre, carga, deformaciones, peso y fluidez.
5. Producir Wolf para validar un cuadrúpedo con acciones más claras.
6. Producir Bat o Dolphin para resolver una anatomía distinta.
7. Ajustar los presupuestos a partir de mediciones y producir los demás por lotes de anatomía.

Primer entregable esperado: Fangbit terminado dentro del juego, atractivo, con idle, reacción al toque, Feed, Train y Rest; acompañado por un hábitat funcional. Después completar y validar el conjunto de acciones necesario.

## 11. Validación antes de escalar

- Estética consistente con la referencia maestra.
- Silueta y cara legibles al tamaño real del visor.
- Articulaciones sin deformaciones graves ni extremidades fusionadas.
- Clips y transiciones adecuados para las acciones del juego.
- Peso final medido, desglosando geometría, texturas y animaciones cuando sea necesario.
- Carga correcta con los decodificadores del frontend.
- Prueba de rendimiento y memoria en móvil real.
- Recurso original editable conservado antes de comprimir/publicar.

Pendiente de decidir mediante el piloto: presupuesto definitivo por anatomía, método de compresión, cantidad de huesos y clips, viabilidad de rigs compartidos, catálogo inicial de hábitats y costo real de publicación.

## 12. Fuentes técnicas consultadas

Consultadas durante la conversación del 3 de octubre de 2026; verificar cambios del proveedor antes de ejecutar el flujo.

- Meshy, Rigging: https://docs.meshy.ai/en/webapp/guides/3d-model/rigging
- Meshy, Animate: https://docs.meshy.ai/en/webapp/guides/animate
- glTF Transform, CLI: https://gltf-transform.dev/cli
- Three.js, GLTFLoader: https://threejs.org/docs/pages/GLTFLoader.html
- Three.js, DRACOLoader: https://threejs.org/docs/pages/DRACOLoader.html

## Historial

- 1.0 — 2026-10-03: estrategia inicial de assets registrada a pedido de Nicolás. Producción y mediciones del piloto aún pendientes.

## Actualización — taller implementado, 2026-10-03

Rest se representa apagando el visor y mostrando un indicador de sueño. No requiere pose de acostarse ni clip esquelético. La instrucción existente de descanso se conserva.

El flujo de importación GLB, mapeo de rig, clips básicos, compresión, thumbnail y vinculación con el borrador del atlas se implementó en `/admin/design-lab`. Ver `docs/design-lab.md` para uso, pruebas y límites reales. La calidad del rig de Caniform todavía debe validarse con su GLB exportado de Meshy.
