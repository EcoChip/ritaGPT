import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Increase payload limit to accept high-res page images
app.use(express.json({ limit: "35mb" }));

// Serve pdfjs-dist static font, cmap, wasm, and icc assets so PDF rendering never fails or triggers missing-url errors
app.use(
  "/pdfjs-standard-fonts",
  express.static(path.join(__dirname, "node_modules/pdfjs-dist/standard_fonts"))
);
app.use(
  "/pdfjs-cmaps",
  express.static(path.join(__dirname, "node_modules/pdfjs-dist/cmaps"))
);
app.use(
  "/pdfjs-wasm",
  express.static(path.join(__dirname, "node_modules/pdfjs-dist/wasm"))
);
app.use(
  "/pdfjs-iccs",
  express.static(path.join(__dirname, "node_modules/pdfjs-dist/iccs"))
);

function getGeminiClient() {
  const rawKey =
    process.env.GEMINI_API_KEY ||
    process.env.VITE_GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    "";
  const cleanKey = rawKey.trim().replace(/[\r\n\s]+/g, "");
  return new GoogleGenAI({
    apiKey: cleanKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// Fast fallback chain of multimodal Gemini models (verified < 2s latency)
const CANDIDATE_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithFallback(
  ai: GoogleGenAI,
  params: Omit<Parameters<typeof ai.models.generateContent>[0], "model">
) {
  let lastError: any = null;

  for (let attempt = 0; attempt < CANDIDATE_MODELS.length; attempt++) {
    const modelName = CANDIDATE_MODELS[attempt];
    try {
      const modelConfig =
        modelName === "gemini-2.5-flash"
          ? {
              ...params.config,
              thinkingConfig: { thinkingBudget: 0 },
            }
          : params.config;

      const response = await Promise.race([
        ai.models.generateContent({
          ...params,
          model: modelName,
          config: modelConfig,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout after 16s on ${modelName}`)),
            16000
          )
        ),
      ]);
      return response;
    } catch (err: any) {
      lastError = err;
      const errMsg = String(err?.message || err || "");
      console.warn(
        `[ritaGPT] Intento ${attempt + 1} con ${modelName} falló: ${errMsg.slice(0, 120)}`
      );
      await sleep(150);
    }
  }

  throw lastError;
}

app.post("/api/solve-page", async (req, res) => {
  try {
    const { imageBase64, mimeType, pageNumber, customInstructions } = req.body;

    if (!imageBase64 || typeof imageBase64 !== "string") {
      res
        .status(400)
        .json({ error: "No se proporcionó la imagen de la página." });
      return;
    }

    const ai = getGeminiClient();

    // Canonicalize base64 via Node Buffer so it is guaranteed valid and properly padded
    const stripped = imageBase64
      .replace(/^data:[^,]+,/, "")
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .replace(/[^A-Za-z0-9+/=]/g, "");
    const cleanBase64 = Buffer.from(stripped, "base64").toString("base64");

    if (!cleanBase64 || cleanBase64.length < 32) {
      res
        .status(400)
        .json({ error: "La imagen de la página está vacía o incompleta." });
      return;
    }

    const safeMimeType =
      mimeType && /^image\/(png|jpeg|webp)$/i.test(mimeType)
        ? mimeType
        : "image/jpeg";

    const prompt = `Analiza esta página de una hoja de ejercicios, libro de texto o examen (Página ${pageNumber || 1}).
Tu tarea es:
1. Detectar TODOS los ejercicios, actividades numeradas, preguntas, problemas matemáticos, etiquetas de esquemas/diagramas o huecos para rellenar presentes en la página.
2. Determinar si esta página es una HOJA DE LIBRO DE TEXTO SIN ESPACIO EN BLANCO para responder en la propia hoja (por ejemplo, actividades de literatura/historia/ciencias que dicen "Realiza la actividad en tu cuaderno", o páginas de libro donde las preguntas están juntas al final sin huecos blancos):
   - Si no hay espacio físico en blanco junto a las preguntas o pide hacerlo en el cuaderno, marca "requiresSeparateNotebook": true.
   - Si es una ficha con huecos en blanco, etiquetas de diagramas, líneas o recuadros para rellenar encima de la misma hoja, marca "requiresSeparateNotebook": false.
3. REGLAS CRÍTICAS DE PRECISIÓN PARA LOS HUECOS ("blankBox2d" = [ymin, xmin, ymax, xmax] de 0 a 1000):
   - REGLA DE ORO Nº 1 (RECUADROS CON PREGUNTA IMPRESA DENTRO): Muchos ejercicios (ej. apartados "a.", "b.", "c.") tienen un recuadro rectangular donde la PRIMERA línea dentro del propio recuadro contiene el enunciado impreso (ej. "a. ¿De qué tipo de célula se trata? ¿Por qué lo sabes?") y DEBAJO de ese texto impreso está el espacio en blanco para responder. En estos casos, "ymin" DEBE empezar ESTRICTAMENTE DEBAJO de la línea de texto impreso de la pregunta (nunca incluyas el texto impreso de la pregunta dentro de blankBox2d).
   - REGLA DE ORO Nº 2 (ESQUEMAS, CÉLULAS, MAPAS Y DIAGRAMAS CON RECUADROS): Si hay un dibujo o esquema (ej. una célula procariota/eucariota, anatomía, mapa) con recuadros vacíos alrededor unidos por líneas/flechas:
     * Revisa TODOS los recuadros vacíos de la columna izquierda y TODOS los de la columna derecha (de arriba abajo) sin saltarte ninguno.
     * Para cada recuadro vacío del esquema, usa "subjectType": "short_blank".
     * "blankBox2d" debe ceñirse exactamente al interior blanco de ese recuadro individual, sin invadir recuadros vecinos.
     * "correctAnswer" para un recuadro de esquema ("short_blank") debe ser ÚNICAMENTE el término corto (1 o 2 palabras máximo, ej. "Flagelo", "Citoplasma", "Ribosomas", "Nucleoide", "Cápsula", "Pared bacteriana", "Membrana plasmática", "Fimbrias"), NUNCA una frase larga ni el número del hueco.
   - REGLA DE ORO Nº 3 (LÍNEAS EN BLANCO JUNTO A TEXTO): Si el hueco está a la derecha de un texto impreso (ej. "Nombre: _______"), "xmin" debe empezar justo a la derecha de donde termina el texto impreso.
4. Resolver cada ejercicio de forma rigurosa y adaptada al tamaño del hueco (concisa si el recuadro es pequeño; completa si requiresSeparateNotebook=true). No repitas el enunciado de la pregunta dentro de la respuesta.
5. Para el "Modo Orgánico", genera también:
   - "organicMistakeAnswer": una variante de la respuesta con un pequeño desliz realista de estudiante.
   - "crossedOutWord": UNA sola palabra corta (de 2 a 6 letras) que un estudiante habría empezado a escribir y luego tachado.
${customInstructions ? `\nInstrucciones adicionales del usuario: ${customInstructions}` : ""}`;

    const response = await generateWithFallback(ai, {
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: safeMimeType,
              data: cleanBase64,
            },
          },
          {
            text: prompt,
          },
        ],
      },
      config: {
        systemInstruction:
          "Eres ritaGPT, un experto profesor multidisciplinar y analista visual de fichas escolares. Delimitas con precisión milimétrica los huecos en blanco sin pisar nunca el texto impreso de las preguntas.",
        temperature: 0.25,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            pageSummary: {
              type: Type.STRING,
              description:
                "Título o tema detectado en la página (ej. 'Lope de Vega — La dama boba (Acto I)').",
            },
            requiresSeparateNotebook: {
              type: Type.BOOLEAN,
              description:
                "True si es una página de libro sin huecos en blanco donde los ejercicios deben escribirse en una hoja de cuaderno aparte.",
            },
            exercises: {
              type: Type.ARRAY,
              description:
                "Lista de todos los ejercicios o actividades detectadas en la página.",
              items: {
                type: Type.OBJECT,
                properties: {
                  questionLabel: {
                    type: Type.STRING,
                    description:
                      "Número o identificador del ejercicio (ej. 'Ej. 54', 'Ej. 55', 'Ej. 1a').",
                  },
                  questionSummary: {
                    type: Type.STRING,
                    description:
                      "Enunciado resumido de la actividad o pregunta.",
                  },
                  subjectType: {
                    type: Type.STRING,
                    description:
                      "Tipo de ejercicio: 'math' | 'short_blank' | 'open_text' | 'multiple_choice'",
                  },
                  correctAnswer: {
                    type: Type.STRING,
                    description:
                      "La respuesta completa y bien redactada lista para escribirse a mano.",
                  },
                  organicMistakeAnswer: {
                    type: Type.STRING,
                    description:
                      "Respuesta alternativa con un pequeño desliz o fallo leve de estudiante.",
                  },
                  mistakeExplanation: {
                    type: Type.STRING,
                    description:
                      "Explicación breve de cuál es el fallo humano simulado.",
                  },
                  crossedOutWord: {
                    type: Type.STRING,
                    description:
                      "Palabra corta o cifra inicial que aparecerá tachada a bolígrafo al principio.",
                  },
                  blankBox2d: {
                    type: Type.ARRAY,
                    description:
                      "Coordenadas [ymin, xmin, ymax, xmax] de 0 a 1000.",
                    items: {
                      type: Type.NUMBER,
                    },
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
          required: ["pageSummary", "requiresSeparateNotebook", "exercises"],
        },
      },
    });

    const rawText = (response.text || "{}")
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(rawText);
    res.json(parsed);
  } catch (error: any) {
    console.error("Error in /api/solve-page:", error);
    res.status(500).json({
      error:
        error?.message ||
        "No se pudo completar el análisis con IA. Por favor, inténtalo de nuevo.",
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
