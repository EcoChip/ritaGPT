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

function getGeminiClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// Fallback chain of free/fast multimodal Gemini models in case one experiences 503 high demand
const CANDIDATE_MODELS = [
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "gemini-3.1-flash-lite",
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithFallback(ai: GoogleGenAI, params: Omit<Parameters<typeof ai.models.generateContent>[0], "model">) {
  let lastError: any = null;

  for (let attempt = 0; attempt < CANDIDATE_MODELS.length * 2; attempt++) {
    const modelName = CANDIDATE_MODELS[attempt % CANDIDATE_MODELS.length];
    try {
      const response = await ai.models.generateContent({
        ...params,
        model: modelName,
      });
      return response;
    } catch (err: any) {
      lastError = err;
      const errMsg = String(err?.message || err || "");
      const isTransient =
        errMsg.includes("503") ||
        errMsg.includes("UNAVAILABLE") ||
        errMsg.includes("high demand") ||
        errMsg.includes("overloaded") ||
        errMsg.includes("429") ||
        errMsg.includes("RESOURCE_EXHAUSTED") ||
        err?.status === 503 ||
        err?.status === 429;

      console.warn(
        `[Gemini] Intento ${attempt + 1} con modelo ${modelName} falló (${errMsg.slice(0, 120)}).`
      );

      if (!isTransient && attempt >= CANDIDATE_MODELS.length - 1) {
        break;
      }

      // Wait briefly before trying the next model in the fallback chain
      await sleep(600 + attempt * 400);
    }
  }

  throw lastError;
}

app.post("/api/solve-page", async (req, res) => {
  try {
    const { imageBase64, mimeType, pageNumber, customInstructions } = req.body;

    if (!imageBase64) {
      res.status(400).json({ error: "No se proporcionó la imagen de la página del PDF." });
      return;
    }

    const ai = getGeminiClient();

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const prompt = `Analiza esta página de una hoja de ejercicios o examen (Página ${pageNumber || 1}).
Tu tarea es:
1. Detectar TODOS los ejercicios, preguntas, problemas matemáticos, tablas, huecos para rellenar ("fill in the blanks") o zonas de respuesta en blanco presentes en la página.
2. Resolver cada ejercicio de forma rigurosa y precisa en el mismo idioma que pide el ejercicio (español, inglés, etc.).
   - Si es un problema matemático o físico, incluye los pasos clave de forma concisa (ej. "2x + 4 = 14 -> 2x = 10 -> x = 5") usando notación legible a mano (usa símbolos como √, ², ³, π, ±, ≠, ÷, ×, →, fracciones a/b).
   - Si es de rellenar un hueco corto, devuelve únicamente la palabra o expresión que va en ese hueco.
   - Si es una pregunta abierta, redacta una respuesta natural de estudiante que encaje bien en el espacio disponible.
3. Para el "Modo Orgánico" (que simula que un humano real hizo la tarea), genera también:
   - "organicMistakeAnswer": una variante de la respuesta con un pequeño desliz o fallo humano plausible de estudiante (por ejemplo, un pequeño error aritmético al final como "2x = 10 -> x = 4", una confusión sutil de vocabulario o un dato ligeramente impreciso).
   - "crossedOutWord": una palabra corta, número o inicio de fórmula (de 2 a 8 caracteres, ej. "x=6", "24m", "was", "H2O2") que un estudiante habría empezado a escribir por error y luego tachado antes de escribir la respuesta definitiva al lado.
4. Determina con máxima precisión las coordenadas de la ZONA EN BLANCO (línea punteada, recuadro vacío, hueco entre palabras o espacio libre debajo/al lado del enunciado) donde el estudiante debe escribir la respuesta.
   - Devuelve las coordenadas en escala normalizada de 0 a 1000: [ymin, xmin, ymax, xmax].
   - ¡IMPORTANTE!: El rectángulo [ymin, xmin, ymax, xmax] debe cubrir EXCLUSIVAMENTE la zona blanca o línea donde se escribe la respuesta, NUNCA debe tapar el texto impreso del enunciado de la pregunta.
   - Si hay una línea horizontal o recuadro para responder, sitúa ymin justo encima de la línea o dentro del recuadro para que el texto escrito se apoye de forma natural.
${customInstructions ? `\nInstrucciones adicionales del usuario: ${customInstructions}` : ""}`;

    const response = await generateWithFallback(ai, {
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || "image/png",
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
          "Eres un experto profesor multidisciplinar (matemáticas, ciencias, lengua, idiomas, historia) y analista espacial de documentos PDF. Resuelves hojas de ejercicios con precisión y localizas con exactitud milimétrica las zonas en blanco donde un alumno escribiría a mano sus respuestas sin pisar el enunciado original.",
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            pageSummary: {
              type: Type.STRING,
              description: "Resumen breve del tema o asignatura detectada en la página.",
            },
            exercises: {
              type: Type.ARRAY,
              description: "Lista de todos los ejercicios y huecos en blanco detectados en la página.",
              items: {
                type: Type.OBJECT,
                properties: {
                  questionLabel: {
                    type: Type.STRING,
                    description: "Identificador corto del ejercicio (ej. 'Ej. 1a', 'Pregunta 2', 'Hueco 3').",
                  },
                  questionSummary: {
                    type: Type.STRING,
                    description: "Texto resumido del enunciado o pregunta detectada.",
                  },
                  subjectType: {
                    type: Type.STRING,
                    description: "Tipo de ejercicio: 'math' | 'short_blank' | 'open_text' | 'multiple_choice'",
                  },
                  correctAnswer: {
                    type: Type.STRING,
                    description: "La respuesta 100% correcta lista para escribirse a mano en el hueco.",
                  },
                  organicMistakeAnswer: {
                    type: Type.STRING,
                    description: "Respuesta alternativa con un error leve y realista de estudiante.",
                  },
                  mistakeExplanation: {
                    type: Type.STRING,
                    description: "Explicación breve de cuál es el fallo humano simulado en organicMistakeAnswer.",
                  },
                  crossedOutWord: {
                    type: Type.STRING,
                    description: "Fragmento corto erróneo (1 palabra o número) para aparecer tachado al inicio.",
                  },
                  blankBox2d: {
                    type: Type.ARRAY,
                    description: "Coordenadas [ymin, xmin, ymax, xmax] de 0 a 1000 de la zona en blanco donde escribir la respuesta.",
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
          required: ["pageSummary", "exercises"],
        },
      },
    });

    const rawText = response.text || "{}";
    const parsed = JSON.parse(rawText);
    res.json(parsed);
  } catch (error: any) {
    console.error("Error in /api/solve-page:", error);
    res.status(500).json({
      error:
        "Los servidores de Gemini están experimentando alta demanda temporal (503). Por favor, pulsa 'Resolver con IA' de nuevo en unos segundos.",
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
