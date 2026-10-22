# ManuscritIA — Resolutor y Rellenador Orgánico de Ejercicios en PDF

Una estación de trabajo interactiva que analiza hojas de ejercicios en PDF mediante visión artificial con Gemini (`gemini-3.8-flash`), resuelve problemas de cualquier materia (texto, idiomas y matemáticas) y escribe las respuestas directamente sobre los espacios en blanco del documento simulando caligrafía humana realista, con previsualización interactiva y descarga inmediata en PDF.

---

## Revisión del Usuario y Decisiones Confirmadas

> [!IMPORTANT]
> Estas decisiones recogen tus respuestas confirmadas y definen el comportamiento central de la aplicación antes de construirla.

- **Soporte Multidisciplinar (Texto y Matemáticas)**: El motor analizará tanto preguntas de desarrollo, test y rellenar huecos como problemas matemáticos y fórmulas, adaptando la notación para que luzca natural al escribirse a mano.
- **Modo Orgánico Triple**: Cuando se active el Modo Orgánico, la aplicación aplicará tres efectos combinables y configurables:
  1. **Tasa de Fallo Humano (10%–15% configurable)**: Introducción deliberada de pequeños deslices de cálculo o imprecisiones plausibles de estudiante en un porcentaje de preguntas.
  2. **Tachones Simulados y Correcciones**: Algunas respuestas incluirán una palabra o cifra inicial tachada con trazos de bolígrafo y la respuesta corregida escrita justo al lado.
  3. **Variación Caligráfica de Trazo**: Ligera oscilación línea a línea y palabra a palabra en la inclinación (`rotate`), desplazamiento de línea base (`baseline jitter`), opacidad/presión de tinta y grosor del trazo.
- **Editor Interactivo sobre la Previsualización del PDF**: Antes de descargar el PDF modificado, podrás arrastrar las cajas de respuesta libremente sobre cada página, redimensionarlas, editar el texto o el tachón, ajustar el tamaño de fuente individualmente o añadir nuevas anotaciones haciendo clic en cualquier espacio en blanco.

---

## 1. Visión General y Concepto Principal

- **Qué Hace**: Recibe un archivo PDF con ejercicios (o permite cargar una hoja de ejercicios de demostración lista para probar al instante), renderiza cada página en alta resolución, detecta automáticamente las coordenadas exactas de los espacios en blanco o líneas de respuesta junto a cada enunciado, calcula las soluciones y las estampa con tipografías manuscritas autenticadas y trazos orgánicos.
- **Público Objetivo**: Estudiantes y docentes que buscan resolver hojas de trabajo completas y obtener un documento PDF con acabado manuscrito natural, listo para revisar, ajustar en pantalla y exportar.
- **Valor Principal**: Ahorra el proceso manual de transcribir respuestas o editar cajas de texto rígidas en editores de PDF tradicionales, logrando un ajuste automático del tamaño de letra dentro del hueco disponible y una estética de bolígrafo real sobre el papel original.

---

## 2. Experiencia de Usuario y Diseño Visual

### Flujos de Usuario Principales
1. **Carga o Plantilla de Prueba**: El usuario arrastra su archivo PDF al lienzo o pulsa *"Cargar PDF de Ejemplo (Matemáticas y Lengua)"* para probar el flujo inmediatamente sin archivos externos.
2. **Configuración del Modo Orgánico y Caligrafía**: En el panel lateral de control, el usuario elige el estilo de letra manuscrita (Cuaderno Escolar, Apuntes Rápidos, Trazo Fluido o Letra de Imprenta), el color de tinta (Azul Bolígrafo BIC, Negro Gel, Grafito Lápiz o Rojo Corrección) y activa/ajusta el **Modo Orgánico** (porcentaje de errores humanos, frecuencia de tachones y nivel de variación de trazo).
3. **Resolución y Detección Espacial con IA**: Al pulsar *"Resolver y Rellenar PDF"*, el sistema convierte las páginas en imágenes de alta nitidez y las envía al servidor con Gemini Vision (`gemini-3.8-flash`), que devuelve cada ejercicio resuelto junto con las coordenadas normalizadas `[ymin, xmin, ymax, xmax]` de la zona en blanco correspondiente.
4. **Previsualización Interactiva y Ajuste Manual**: El visor central muestra el PDF original con la capa manuscrita superpuesta en tiempo real:
   - El tamaño de fuente se auto-escala para encajar en el ancho y alto de la zona en blanco detectada.
   - El usuario puede arrastrar cualquier respuesta, cambiar su tamaño, editar su contenido, activar/desactivar un tachón puntual o alternar entre la respuesta con fallo orgánico y la respuesta 100% correcta.
5. **Exportación Instantánea**: Al pulsar *"Descargar PDF Resuelto"*, el sistema rasteriza los trazos manuscritos, variaciones de presión y tachones directamente sobre las páginas del documento original y descarga el archivo `.pdf` final al instante.

### Identidad Visual y Tema
- **Dirección Estética**: *Estudio Editorial y Mesa de Trabajo Analógica-Digital* — combina la precisión limpia de un visor técnico de documentos con la calidez táctil del papel y la tinta de bolígrafo.
- **Paleta de Colores (Regla 60-30-10)**:
  - **60% Lienzo Dominante**: Gris piedra cálido suave (`#F8FAFC` / `slate-50`) para la mesa de trabajo donde descansa la hoja del PDF en blanco puro (`#FFFFFF`).
  - **30% Superficies Estructurales**: Paneles de control en blanco limpio con bordes capilares (`#E2E8F0` / `slate-200`) y tipografía secundaria en pizarra (`#475569` / `slate-600`).
  - **10% Acento Focal**: Azul Tinta Profundo (`#1D4ED8` / `blue-700`) para acciones principales y selección activa, acompañado de estados semánticos claros con icono + etiqueta (`#059669` para respuestas correctas, `#D97706` para fallos orgánicos deliberados).
- **Tipografía y Jerarquía**:
  - *Interfaz y Encabezados (2+1)*: `Plus Jakarta Sans` para títulos y navegación estructurada; `DM Sans` para controles densos; `JetBrains Mono` (`tabular-nums`) para coordenadas, porcentajes, escalas de zoom y numeración de páginas.
  - *Fuentes Manuscritas Embebidas para el PDF*: Colección de tipografías caligráficas de Google Fonts (`Caveat`, `Indie Flower`, `Shadows Into Light`, `Patrick Hand`) cargadas en el navegador y renderizadas en alta resolución para soportar acentos en español, símbolos matemáticos (`√`, `π`, `²`, `±`, `≠`, fracciones) y trazos de tachado.
- **Disposición Espacial (2-Zone Sandbox Layout)**:
  - Barra superior en una sola fila con 3 zonas: Marca a la izquierda, indicadores de vista central y botón de exportación PDF a la derecha.
  - Escenario dividido: **70% Izquierda (Mesa de Previsualización Interactiva del PDF)** con controles de zoom, navegación de páginas y cajas manuscritas arrastrables; **30% Derecha (Panel de Control Caligráfico, Modo Orgánico y Lista de Ejercicios Detectados)**.

---

## 3. Decisiones Clave de Producto y Compromisos Técnicos

- **Decisión 1: Renderizado Caligráfico de Alta Fidelidad al Exportar el PDF**
  - *Enfoque Elegido*: Usar `pdfjs-dist` en el cliente para renderizar las páginas del PDF y estampar cada bloque de texto manuscrito (con su fuente caligráfica real, rotación por línea, variación de opacidad/presión y trazos de tachón curvos en SVG/Canvas) sobre el PDF exportado mediante `pdf-lib` / lienzo de alta densidad (2x DPI).
  - *Por qué*: Las fuentes estándar de PDF no soportan caligrafía humana con jitter orgánico, presión variable ni tachones irregulares de bolígrafo. Este enfoque garantiza que el PDF descargado sea **100% idéntico píxel a píxel** a lo que el usuario ve y ajusta en la previsualización interactiva.
  - *Alternativas Descartadas*: Escribir texto plano con `StandardFonts.Helvetica` en `pdf-lib`, ya que destruiría el efecto de escritura a mano y fallaría con símbolos matemáticos o acentos.
- **Decisión 2: Detección Espacial + Resolución Dual (Correcta vs. Orgánica) en una Sola Llamada Server-Side**
  - *Enfoque Elegido*: El endpoint `/api/solve-page` utiliza `@google/genai` con el modelo gratuito/rápido `gemini-3.8-flash` y un esquema JSON estructurado (`responseSchema`) que devuelve para cada ejercicio: la pregunta detectada, la respuesta correcta, una variante con pequeño error humano plausible, un texto corto erróneo para tachar (`crossedOutText`) y el rectángulo delimitador `[ymin, xmin, ymax, xmax]` del espacio en blanco.
  - *Por qué*: Permite al usuario activar o desactivar el "Modo Orgánico" o los "Tachones" en tiempo real en la vista previa sin tener que volver a llamar a la IA ni esperar tiempos de carga adicionales.

---

## 4. Arquitectura Técnica y Estrategia de Datos

### Diagrama de Arquitectura y Componentes

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        Barra Superior (3 Zonas)                            │
│  [ManuscritIA]        [Cargar PDF · PDF Demo · Añadir Caja]  [Descargar]   │
└──────────────────────────────────────┬─────────────────────────────────────┘
                                       │
         ┌─────────────────────────────┴─────────────────────────────┐
         ▼                                                           ▼
┌─────────────────────────────────────────┐ ┌────────────────────────────────┐
│   Visor y Editor PDF (70% Viewport)     │ │ Panel de Control y Ejercicios  │
│                                         │ │         (30% Viewport)         │
│  ┌───────────────────────────────────┐  │ │ ┌────────────────────────────┐ │
│  │ Lienzo PDF (pdf.js @ 2x DPI)      │  │ │ │ Estilo de Letra y Tinta    │ │
│  │                                   │  │ │ │ - Fuente, Color, Grosor    │ │
│  │  ┌─────────────────────────────┐  │  │ │ └────────────────────────────┘ │
│  │  │ Caja Manuscrita Interactiva │  │  │ │ ┌────────────────────────────┐ │
│  │  │ [~~x=4~~] x = 5 (Auto-fit)  │◄─┼──┼─┤ │ Modo Orgánico (Sliders)    │ │
│  │  │ (Arrastrar / Redimensionar) │  │  │ │ │ - % Fallos (10-15%)        │ │
│  │  └─────────────────────────────┘  │  │ │ │ - % Tachones Simulados     │ │
│  └───────────────────────────────────┘  │ │ │ - Jitter / Presión Trazo   │ │
│  [◄ Página 1 de N ►]   [Zoom: 100% -/+] │ │ └────────────────────────────┘ │
└─────────────────────────────────────────┘ │ ┌────────────────────────────┐ │
                                            │ │ Lista de Respuestas IA     │ │
                                            │ │ - Alternar Correcta/Fallo  │ │
                                            │ │ - Editar texto y tachón    │ │
                                            │ └──────────────┬─────────────┘ │
                                            └────────────────┼───────────────┘
                                                             │
                                                  POST /api/solve-page
                                                             ▼
                                            ┌────────────────────────────────┐
                                            │  Servidor Express (server.ts)  │
                                            │  SDK @google/genai             │
                                            │  Modelo: gemini-3.8-flash      │
                                            │  Vision + JSON Schema Espacial │
                                            └────────────────────────────────┘
```

### Modelo de Datos y Estado en el Cliente
- **`PdfPageData`**: Número de página, imagen renderizada en base64 de alta resolución, dimensiones originales en puntos PDF (`width`, `height`) y estado de análisis (`idle`, `analyzing`, `solved`, `error`).
- **`AnswerAnnotation`**:
  - `id`, `pageNumber`, `questionSummary` (resumen del enunciado detectado).
  - `correctAnswer` (solución exacta) y `organicMistakeAnswer` (solución con error leve de cálculo/concepto).
  - `crossedOutWord` (fragmento breve que aparece tachado al inicio si tiene tachón activo).
  - `box`: `{ x, y, width, height }` en porcentajes normalizados (`0` a `100`) respecto a la página para permitir zoom fluido y exportación exacta.
  - `fontSize`: Calculado automáticamente en función del área de `box` y la longitud del texto, con opción de ajuste manual (`autoFit: boolean`).
  - `useMistake`: Booleano que indica si esta respuesta muestra el fallo orgánico o la respuesta correcta.
  - `useCrossOut`: Booleano que indica si incluye un tachón simulado al principio.
  - `seed`: Semilla numérica para generar variaciones deterministas de inclinación, presión de tinta y desplazamiento de línea.

### Mapeo de Interacciones y Estados
- **Algoritmo de Auto-Ajuste de Fuente (`computeAutoFontSize`)**: Mide la longitud del texto (incluyendo el fragmento tachado si está activo) y las dimensiones de la caja blanca detectada para asignar automáticamente el tamaño de fuente óptimo (entre `11px` y `28px`) que rellene el hueco sin desbordarse.
- **Manipulación Directa en el Lienzo**: Al seleccionar una respuesta en el PDF, muestra tiradores discretos para arrastrar (`onPointerDown` / `onPointerMove`) o redimensionar la caja, actualizando el auto-ajuste de fuente en vivo.
- **Generador de PDF de Ejemplo Integrado**: Incluye un generador en cliente que crea al instante un PDF de ejercicios variados (Álgebra, Física básica, Inglés y Comprensión Lectora con huecos y cajas en blanco) para poder probar todas las funciones con un clic.
