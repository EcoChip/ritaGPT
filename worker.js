/**
 * Cloudflare Pages & Cloudflare Workers Edge Entry Point (_worker.js)
 * Automatically copied into `dist/_worker.js` by Vite during `npm run build`.
 * - Handles `POST /api/solve-page` on Cloudflare Workers / Pages using `env.GEMINI_API_KEY` (or `env.VITE_GEMINI_API_KEY`).
 * - Delegates all static asset requests to `env.ASSETS.fetch(request)`.
 */

const WORKSHEET_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    requiresSeparateNotebook: {
      type: "BOOLEAN",
      description:
        "True ONLY if the page is a dense textbook page with no blank spaces and answers must go on a separate notebook sheet.",
    },
    pageSummary: {
      type: "STRING",
      description: "Short title of the page topic",
    },
    exercises: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          questionLabel: { type: "STRING" },
          questionSummary: { type: "STRING" },
          subjectType: {
            type: "STRING",
            enum: ["math", "fill_blank", "open_text", "short_blank"],
          },
          correctAnswer: { type: "STRING" },
          organicMistakeAnswer: { type: "STRING" },
          mistakeExplanation: { type: "STRING" },
          crossedOutWord: { type: "STRING" },
          blankBox2d: {
            type: "ARRAY",
            items: { type: "INTEGER" },
          },
        },
        required: [
          "questionLabel",
          "questionSummary",
          "subjectType",
          "correctAnswer",
          "organicMistakeAnswer",
          "mistakeExplanation",
          "crossedOutWord",
          "blankBox2d",
        ],
      },
    },
  },
  required: ["requiresSeparateNotebook", "pageSummary", "exercises"],
};

function buildPrompt(pageNumber = 1, customInstructions = "") {
  const customDirective =
    customInstructions && String(customInstructions).trim().length > 0
      ? `\nINSTRUCCIONES PERSONALIZADAS DEL USUARIO (PRIORIDAD MÁXIMA):\n"${String(
          customInstructions
        ).trim()}"\nAplica estrictamente estas indicaciones al resolver los ejercicios.\n`
      : "";

  return `Eres un estudiante brillante resolviendo la página ${pageNumber} de una ficha de ejercicios, examen o libro de texto escolar/universitario.
${customDirective}
Analiza cuidadosamente la imagen de la página y sigue estas reglas:

1. DETECCIÓN DE MODO ("EN LA PROPIA FICHA" vs "EN TU CUADERNO APARTE"):
   - Pon "requiresSeparateNotebook": false si la página es una ficha de trabajo (worksheet) o examen que TIENE huecos en blanco, recuadros vacíos, etiquetas de diagramas/esquemas para rellenar, tablas o líneas punteadas para escribir directamente en la hoja.
   - Pon "requiresSeparateNotebook": true ÚNICAMENTE si la página es una hoja de libro de texto densa (como Lectura y comentario, Literatura, Historia, Filosofía) donde NO hay recuadros ni huecos físicos para responder en la hoja y las preguntas deben contestarse en una hoja de cuaderno aparte.

2. REGLAS CRÍTICAS DE PRECISIÓN MILIMÉTRICA PARA LOS HUECOS ("blankBox2d" = [ymin, xmin, ymax, xmax] en escala 0 a 1000):
   - REGLA DE ORO Nº 1 (RECUADROS GRANDES CON PREGUNTA IMPRESA DENTRO): Muchos ejercicios (ej. apartados "a.", "b.", "c.") tienen un gran recuadro rectangular donde la parte superior dentro del propio recuadro contiene el enunciado impreso (ej. "a. ¿De qué tipo de célula se trata? ¿Por qué lo sabes?", "b. ¿Qué función desempeña...?", "c. ¿Para qué sirven...?") y DEBAJO de ese texto impreso está la mitad inferior blanca para escribir la respuesta. En estos casos:
     * PROHIBIDO devolver el recuadro completo desde su borde superior.
     * "ymin" DEBE empezar ESTRICTAMENTE EN LA MITAD INFERIOR BLANCA (al menos 22 a 32 puntos por debajo del borde superior del recuadro), justo debajo de la línea de texto impreso de la pregunta.
   - REGLA DE ORO Nº 2 (ESQUEMAS, CÉLULAS, MAPAS Y DIAGRAMAS CON RECUADROS): Si hay un dibujo o esquema (ej. una célula procariota/eucariota, aparato del cuerpo, mapa, circuito) con recuadros vacíos alrededor unidos por flechas o líneas:
     * Revisa TODOS los recuadros vacíos de la izquierda, derecha y parte inferior sin saltarte ninguno.
     * Presta especial atención a los recuadros de la parte inferior del dibujo (a menudo numerados como 6, 7, 8, 9): localiza con exactitud los 4 bordes de cada recuadro rectangular y NO desplaces las cajas hacia el espacio vacío debajo de ellos.
     * Si el recuadro tiene un numerito impreso a la izquierda (ej. "4.", "8."), haz que "xmin" empiece justo a la derecha del numerito impreso.
     * Para cada recuadro vacío del esquema, usa SIEMPRE "subjectType": "short_blank".
     * "correctAnswer" para un recuadro de esquema ("short_blank") debe ser ÚNICAMENTE el nombre corto del elemento (1 o 2 palabras máximo, ej. "Flagelo", "Citoplasma", "Ribosomas", "Nucleoide", "Cápsula", "Pared bacteriana", "Membrana plasmática", "Fimbrias"), NUNCA una frase larga ni el número del recuadro.
   - REGLA DE ORO Nº 3 (LÍNEAS EN BLANCO JUNTO A TEXTO): Si el hueco está a la derecha de un texto impreso (ej. "Nombre: _______"), "xmin" debe empezar justo a la derecha de donde termina el texto impreso, nunca encima de las letras impresas.

3. Para CADA ejercicio o hueco detectado, devuelve en "exercises":
   - "questionLabel": Identificador corto ("1", "2", "a)", "b)", etc.).
   - "questionSummary": Resumen breve de qué pide este hueco o pregunta.
   - "subjectType": "math", "fill_blank", "open_text" o "short_blank".
   - "correctAnswer": La respuesta correcta en el mismo idioma del documento, adaptada al tamaño del hueco. No repitas el enunciado dentro de la respuesta.
   - "organicMistakeAnswer": Una variante con un pequeño desliz humano realista.
   - "mistakeExplanation": Breve explicación del desliz simulado.
   - "crossedOutWord": UNA sola palabra corta (máximo 6 letras) que el alumno empezó a escribir, tachó y corrigió.
   - "blankBox2d": [ymin, xmin, ymax, xmax] en coordenadas normalizadas de 0 a 1000 indicando EXCLUSIVAMENTE el espacio blanco vacío donde irá escrita la respuesta.`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return new Response(JSON.stringify({ status: "ok", runtime: "cloudflare-worker" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/solve-page" && request.method === "POST") {
      try {
        const rawKey =
          (env && (env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY || env.GOOGLE_API_KEY)) ||
          "";
        const apiKey = String(rawKey).trim().replace(/[\r\n\s]+/g, "");

        if (!apiKey) {
          return new Response(
            JSON.stringify({
              error:
                "Falta la variable GEMINI_API_KEY en Cloudflare Workers / Pages (Settings -> Variables and Secrets).",
              missingKey: true,
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        const body = await request.json();
        const { imageBase64, mimeType, pageNumber, customInstructions } = body || {};

        if (!imageBase64 || typeof imageBase64 !== "string") {
          return new Response(
            JSON.stringify({ error: "No se recibió la imagen de la página." }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        const commaIdx = imageBase64.indexOf(",");
        const rawBase64 = (
          commaIdx >= 0 ? imageBase64.slice(commaIdx + 1) : imageBase64
        ).replace(/\s+/g, "");

        const promptText = buildPrompt(pageNumber || 1, customInstructions);
        const modelsToTry = [
          "gemini-2.5-flash",
          "gemini-3-flash-preview",
          "gemini-3.1-flash-lite-preview",
        ];

        let lastErr = "Error al conectar con Gemini desde Cloudflare Worker.";

        for (const modelName of modelsToTry) {
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(
            apiKey
          )}`;

          const geminiRes = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      inlineData: {
                        mimeType: mimeType || "image/jpeg",
                        data: rawBase64,
                      },
                    },
                    { text: promptText },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0.2,
                responseMimeType: "application/json",
                responseSchema: WORKSHEET_RESPONSE_SCHEMA,
              },
            }),
          });

          const geminiText = await geminiRes.text();
          if (geminiRes.ok) {
            const outer = JSON.parse(geminiText);
            const jsonText =
              outer?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
            const parsed = JSON.parse(jsonText);
            return new Response(JSON.stringify(parsed), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          } else {
            lastErr = `Gemini (${modelName}) HTTP ${geminiRes.status}: ${geminiText.slice(0, 220)}`;
          }
        }

        return new Response(JSON.stringify({ error: lastErr }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({
            error: String(err?.message || err || "Error interno en Cloudflare Worker"),
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};
