/**
 * Universal client-side fallback solver for static deployments (GitHub Pages, Cloudflare Pages static, Netlify, Vercel)
 * when `/api/solve-page` is not served by a Node/Worker runtime or when the key was injected at build time.
 * Uses pure XMLHttpRequest to `generativelanguage.googleapis.com` to avoid any Safari WebKit `fetch`/`Request` pattern bugs.
 */

declare const __BUILD_GEMINI_API_KEY__: string | undefined;

export function getBuildTimeGeminiKey(): string {
  const candidates: (string | undefined)[] = [
    typeof __BUILD_GEMINI_API_KEY__ !== "undefined"
      ? __BUILD_GEMINI_API_KEY__
      : undefined,
    typeof import.meta !== "undefined" && (import.meta as any).env
      ? (import.meta as any).env.VITE_GEMINI_API_KEY ||
        (import.meta as any).env.GEMINI_API_KEY
      : undefined,
  ];

  for (const raw of candidates) {
    if (typeof raw === "string") {
      const cleaned = raw.trim().replace(/[\r\n\s]+/g, "");
      if (cleaned.length > 10 && cleaned !== "undefined" && cleaned !== "null") {
        return cleaned;
      }
    }
  }
  return "";
}

export function buildWorksheetPrompt(
  pageNumber: number = 1,
  customInstructions?: string
): string {
  const customDirective =
    customInstructions && customInstructions.trim().length > 0
      ? `\nINSTRUCCIONES PERSONALIZADAS DEL USUARIO (PRIORIDAD MÁXIMA):\n"${customInstructions.trim()}"\nAplica estrictamente estas indicaciones al resolver los ejercicios.\n`
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
   - "subjectType": "math", "fill_blank", "open_text" o "short_blank" (usa "short_blank" para etiquetas cortas de esquemas/diagramas o huecos de 1-2 palabras).
   - "correctAnswer": La respuesta correcta en el mismo idioma del documento, adaptada al tamaño del hueco (1-2 palabras si es "short_blank"; 1 o 2 frases claras y concisas si es un recuadro de pregunta abierta en ficha; respuesta completa si requiresSeparateNotebook=true). No repitas el enunciado dentro de la respuesta.
   - "organicMistakeAnswer": Una variante con un pequeño desliz humano realista (ej. en matemáticas un pequeño fallo en el último paso; en texto una confusión leve de término cercano).
   - "mistakeExplanation": Breve explicación del desliz simulado.
   - "crossedOutWord": UNA sola palabra corta (máximo 6 letras) que el alumno empezó a escribir, tachó y corrigió antes de poner la respuesta definitiva.
   - "blankBox2d": [ymin, xmin, ymax, xmax] en coordenadas normalizadas de 0 a 1000 indicando EXCLUSIVAMENTE el espacio blanco vacío donde irá escrita la respuesta.`;
}

export const WORKSHEET_RESPONSE_SCHEMA = {
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

const FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
];

/**
 * Calls the Gemini REST API directly via XMLHttpRequest using a build-time API key.
 */
export async function solvePageViaDirectRestApi(params: {
  apiKey: string;
  imageBase64: string;
  mimeType: string;
  pageNumber: number;
  customInstructions?: string;
}): Promise<any> {
  const cleanKey = params.apiKey.trim().replace(/[\r\n\s]+/g, "");
  if (!cleanKey) {
    throw new Error(
      "Falta configurar la variable de entorno GEMINI_API_KEY en tu despliegue de Cloudflare / GitHub."
    );
  }

  const commaIdx = params.imageBase64.indexOf(",");
  const rawBase64 = (
    commaIdx >= 0 ? params.imageBase64.slice(commaIdx + 1) : params.imageBase64
  ).replace(/\s+/g, "");

  const promptText = buildWorksheetPrompt(
    params.pageNumber,
    params.customInstructions
  );

  const requestBody = JSON.stringify({
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: params.mimeType || "image/jpeg",
              data: rawBase64,
            },
          },
          {
            text: promptText,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: WORKSHEET_RESPONSE_SCHEMA,
    },
  });

  let lastErrorMsg = "No se pudo conectar con Gemini.";

  for (const modelName of FALLBACK_MODELS) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(
        cleanKey
      )}`;

      const { status, responseText } = await new Promise<{
        status: number;
        responseText: string;
      }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", endpoint, true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.timeout = 45000;
        xhr.onload = () =>
          resolve({ status: xhr.status, responseText: xhr.responseText || "" });
        xhr.onerror = () => reject(new Error("Network error calling Gemini REST API"));
        xhr.ontimeout = () => reject(new Error("Timeout calling Gemini REST API"));
        xhr.send(requestBody);
      });

      if (status >= 200 && status < 300) {
        const outer = JSON.parse(responseText);
        const textContent =
          outer?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        return JSON.parse(textContent);
      } else {
        let errDetail = responseText;
        try {
          const parsedErr = JSON.parse(responseText);
          errDetail = parsedErr?.error?.message || responseText;
        } catch {
          // ignore
        }
        lastErrorMsg = `Error (${status}) con ${modelName}: ${errDetail}`;
      }
    } catch (err: any) {
      lastErrorMsg = String(err?.message || err || lastErrorMsg);
    }
  }

  throw new Error(lastErrorMsg);
}
