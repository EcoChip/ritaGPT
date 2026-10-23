import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { PdfPageData } from "../types";

/**
 * Generates a realistic 1-page multi-subject exercise worksheet PDF (Math, Physics, English & General Science)
 * with explicit blank boxes and dotted response lines so users can immediately test the AI solver and handwriting engine.
 */
export async function generateSampleExercisePdf(): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait
  const { width, height } = page.getSize();

  const darkSlate = rgb(0.1, 0.14, 0.2);
  const mutedGray = rgb(0.42, 0.47, 0.54);
  const lineGray = rgb(0.75, 0.79, 0.84);
  const boxBg = rgb(0.985, 0.99, 0.995);

  // Header
  page.drawText("FICHA DE EJERCICIOS MULTIDISCIPLINAR — EVALUACION PRACTICA", {
    x: 45,
    y: height - 50,
    size: 13,
    font: fontBold,
    color: darkSlate,
  });

  page.drawText(
    "Matemáticas, Física, Inglés y Ciencias Naturales · Nivel Secundaria / Bachillerato",
    {
      x: 45,
      y: height - 67,
      size: 9.5,
      font: fontItalic,
      color: mutedGray,
    }
  );

  page.drawLine({
    start: { x: 45, y: height - 78 },
    end: { x: width - 45, y: height - 78 },
    thickness: 1.2,
    color: darkSlate,
  });

  // Section 1: Algebra & Math
  let y = height - 108;
  page.drawText("BLOQUE 1. ALGEBRA Y CALCULO MATEMATICO", {
    x: 45,
    y,
    size: 10.5,
    font: fontBold,
    color: darkSlate,
  });

  // Exercise 1a
  y -= 24;
  page.drawText(
    "1. Resuelve paso a paso la siguiente ecuación de primer grado:  3(2x - 4) + 6 = 18",
    {
      x: 45,
      y,
      size: 10,
      font: fontRegular,
      color: darkSlate,
    }
  );

  // Answer box 1
  y -= 52;
  page.drawRectangle({
    x: 45,
    y,
    width: width - 90,
    height: 42,
    borderColor: lineGray,
    borderWidth: 1,
    color: boxBg,
  });
  page.drawText("Desarrollo y solución:", {
    x: 52,
    y: y + 29,
    size: 7.5,
    font: fontItalic,
    color: mutedGray,
  });

  // Exercise 2
  y -= 26;
  page.drawText(
    "2. Calcula el área y la hipotenusa de un triángulo rectángulo cuyos catetos miden a = 6 cm y b = 8 cm.",
    {
      x: 45,
      y,
      size: 10,
      font: fontRegular,
      color: darkSlate,
    }
  );

  y -= 52;
  page.drawRectangle({
    x: 45,
    y,
    width: width - 90,
    height: 42,
    borderColor: lineGray,
    borderWidth: 1,
    color: boxBg,
  });
  page.drawText("Fórmulas y resultado:", {
    x: 52,
    y: y + 29,
    size: 7.5,
    font: fontItalic,
    color: mutedGray,
  });

  // Section 2: Physics
  y -= 34;
  page.drawText("BLOQUE 2. FISICA Y QUIMICA", {
    x: 45,
    y,
    size: 10.5,
    font: fontBold,
    color: darkSlate,
  });

  y -= 24;
  page.drawText(
    "3. Un vehículo circula a velocidad constante de 90 km/h (25 m/s). ¿Qué distancia recorre en 12 segundos?",
    {
      x: 45,
      y,
      size: 10,
      font: fontRegular,
      color: darkSlate,
    }
  );

  y -= 50;
  page.drawRectangle({
    x: 45,
    y,
    width: width - 90,
    height: 40,
    borderColor: lineGray,
    borderWidth: 1,
    color: boxBg,
  });
  page.drawText("Respuesta:", {
    x: 52,
    y: y + 27,
    size: 7.5,
    font: fontItalic,
    color: mutedGray,
  });

  // Section 3: English Grammar (Fill in the blanks)
  y -= 34;
  page.drawText("BLOQUE 3. ENGLISH GRAMMAR — COMPLETE THE SENTENCES", {
    x: 45,
    y,
    size: 10.5,
    font: fontBold,
    color: darkSlate,
  });

  y -= 26;
  page.drawText("4. If she had studied harder for the exam, she (pass) :", {
    x: 45,
    y,
    size: 10,
    font: fontRegular,
    color: darkSlate,
  });
  // Blank line next to question 4
  page.drawRectangle({
    x: 315,
    y: y - 6,
    width: 235,
    height: 24,
    borderColor: lineGray,
    borderWidth: 1,
    color: boxBg,
  });

  y -= 34;
  page.drawText("5. Neither the teacher nor the students (be / present) :", {
    x: 45,
    y,
    size: 10,
    font: fontRegular,
    color: darkSlate,
  });
  page.drawRectangle({
    x: 315,
    y: y - 6,
    width: 235,
    height: 24,
    borderColor: lineGray,
    borderWidth: 1,
    color: boxBg,
  });

  // Section 4: Biology & Open Question
  y -= 38;
  page.drawText("BLOQUE 4. BIOLOGIA Y CIENCIAS DE LA TIERRA", {
    x: 45,
    y,
    size: 10.5,
    font: fontBold,
    color: darkSlate,
  });

  y -= 24;
  page.drawText(
    "6. Explica brevemente qué es la fotosíntesis, en qué orgánulo celular ocurre y qué gas libera.",
    {
      x: 45,
      y,
      size: 10,
      font: fontRegular,
      color: darkSlate,
    }
  );

  y -= 68;
  page.drawRectangle({
    x: 45,
    y,
    width: width - 90,
    height: 56,
    borderColor: lineGray,
    borderWidth: 1,
    color: boxBg,
  });

  y -= 32;
  page.drawText(
    "7. Calcula la derivada de la función f(x) = 4x³ - 5x² + 2x - 7 y evalúa su valor en x = 2:",
    {
      x: 45,
      y,
      size: 10,
      font: fontRegular,
      color: darkSlate,
    }
  );

  y -= 56;
  page.drawRectangle({
    x: 45,
    y,
    width: width - 90,
    height: 44,
    borderColor: lineGray,
    borderWidth: 1,
    color: boxBg,
  });

  return await pdfDoc.save();
}

/**
 * Renders the sample worksheet directly onto an HTML5 Canvas as well as generating the PDF bytes,
 * so initial startup never depends on Web Workers or PDF.js initialization.
 */
export async function generateSampleWorksheetDirect(): Promise<{
  pdfBytes: Uint8Array;
  pages: PdfPageData[];
}> {
  const pdfBytes = await generateSampleExercisePdf();
  const widthPt = 595.28;
  const heightPt = 841.89;
  const s = 1.8;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(widthPt * s);
  canvas.height = Math.round(heightPt * s);
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return {
      pdfBytes,
      pages: [
        {
          pageNumber: 1,
          imageDataUrl: "",
          widthPt,
          heightPt,
          status: "idle",
        },
      ],
    };
  }

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const drawBox = (x: number, topY: number, w: number, h: number, label?: string) => {
    ctx.fillStyle = "#FBFCFE";
    ctx.strokeStyle = "#BFC9D6";
    ctx.lineWidth = 1 * s;
    ctx.fillRect(x * s, topY * s, w * s, h * s);
    ctx.strokeRect(x * s, topY * s, w * s, h * s);
    if (label) {
      ctx.fillStyle = "#6B788A";
      ctx.font = `italic ${7.5 * s}px Helvetica, Arial, sans-serif`;
      ctx.fillText(label, (x + 7) * s, (topY + 13) * s);
    }
  };

  // Header
  ctx.fillStyle = "#1A2433";
  ctx.font = `bold ${13 * s}px Helvetica, Arial, sans-serif`;
  ctx.fillText(
    "FICHA DE EJERCICIOS MULTIDISCIPLINAR — EVALUACION PRACTICA",
    45 * s,
    50 * s
  );

  ctx.fillStyle = "#6B788A";
  ctx.font = `italic ${9.5 * s}px Helvetica, Arial, sans-serif`;
  ctx.fillText(
    "Matemáticas, Física, Inglés y Ciencias Naturales · Nivel Secundaria / Bachillerato",
    45 * s,
    67 * s
  );

  ctx.strokeStyle = "#1A2433";
  ctx.lineWidth = 1.2 * s;
  ctx.beginPath();
  ctx.moveTo(45 * s, 78 * s);
  ctx.lineTo((widthPt - 45) * s, 78 * s);
  ctx.stroke();

  // Section 1
  ctx.fillStyle = "#1A2433";
  ctx.font = `bold ${10.5 * s}px Helvetica, Arial, sans-serif`;
  ctx.fillText("BLOQUE 1. ALGEBRA Y CALCULO MATEMATICO", 45 * s, 108 * s);

  ctx.font = `${10 * s}px Helvetica, Arial, sans-serif`;
  ctx.fillText(
    "1. Resuelve paso a paso la siguiente ecuación de primer grado:  3(2x - 4) + 6 = 18",
    45 * s,
    132 * s
  );
  drawBox(45, 142, widthPt - 90, 42, "Desarrollo y solución:");

  ctx.fillStyle = "#1A2433";
  ctx.font = `${10 * s}px Helvetica, Arial, sans-serif`;
  ctx.fillText(
    "2. Calcula el área y la hipotenusa de un triángulo rectángulo cuyos catetos miden a = 6 cm y b = 8 cm.",
    45 * s,
    210 * s
  );
  drawBox(45, 220, widthPt - 90, 42, "Fórmulas y resultado:");

  // Section 2
  ctx.fillStyle = "#1A2433";
  ctx.font = `bold ${10.5 * s}px Helvetica, Arial, sans-serif`;
  ctx.fillText("BLOQUE 2. FISICA Y QUIMICA", 45 * s, 296 * s);

  ctx.font = `${10 * s}px Helvetica, Arial, sans-serif`;
  ctx.fillText(
    "3. Un vehículo circula a velocidad constante de 90 km/h (25 m/s). ¿Qué distancia recorre en 12 segundos?",
    45 * s,
    320 * s
  );
  drawBox(45, 330, widthPt - 90, 40, "Respuesta:");

  // Section 3
  ctx.fillStyle = "#1A2433";
  ctx.font = `bold ${10.5 * s}px Helvetica, Arial, sans-serif`;
  ctx.fillText(
    "BLOQUE 3. ENGLISH GRAMMAR — COMPLETE THE SENTENCES",
    45 * s,
    404 * s
  );

  ctx.font = `${10 * s}px Helvetica, Arial, sans-serif`;
  ctx.fillText(
    "4. If she had studied harder for the exam, she (pass) :",
    45 * s,
    430 * s
  );
  drawBox(315, 412, 235, 24);

  ctx.fillStyle = "#1A2433";
  ctx.font = `${10 * s}px Helvetica, Arial, sans-serif`;
  ctx.fillText(
    "5. Neither the teacher nor the students (be / present) :",
    45 * s,
    464 * s
  );
  drawBox(315, 446, 235, 24);

  // Section 4
  ctx.fillStyle = "#1A2433";
  ctx.font = `bold ${10.5 * s}px Helvetica, Arial, sans-serif`;
  ctx.fillText("BLOQUE 4. BIOLOGIA Y CIENCIAS DE LA TIERRA", 45 * s, 502 * s);

  ctx.font = `${10 * s}px Helvetica, Arial, sans-serif`;
  ctx.fillText(
    "6. Explica brevemente qué es la fotosíntesis, en qué orgánulo celular ocurre y qué gas libera.",
    45 * s,
    526 * s
  );
  drawBox(45, 538, widthPt - 90, 56);

  ctx.fillStyle = "#1A2433";
  ctx.font = `${10 * s}px Helvetica, Arial, sans-serif`;
  ctx.fillText(
    "7. Calcula la derivada de la función f(x) = 4x³ - 5x² + 2x - 7 y evalúa su valor en x = 2:",
    45 * s,
    626 * s
  );
  drawBox(45, 638, widthPt - 90, 44);

  return {
    pdfBytes,
    pages: [
      {
        pageNumber: 1,
        imageDataUrl: canvas.toDataURL("image/jpeg", 0.88),
        widthPt,
        heightPt,
        status: "idle",
      },
    ],
  };
}
