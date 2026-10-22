import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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

  page.drawText("Matemáticas, Física, Inglés y Ciencias Naturales · Nivel Secundaria / Bachillerato", {
    x: 45,
    y: height - 67,
    size: 9.5,
    font: fontItalic,
    color: mutedGray,
  });

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
  page.drawText("1. Resuelve paso a paso la siguiente ecuación de primer grado:  3(2x - 4) + 6 = 18", {
    x: 45,
    y,
    size: 10,
    font: fontRegular,
    color: darkSlate,
  });

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
  page.drawText("2. Calcula el área y la hipotenusa de un triángulo rectángulo cuyos catetos miden a = 6 cm y b = 8 cm.", {
    x: 45,
    y,
    size: 10,
    font: fontRegular,
    color: darkSlate,
  });

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
  page.drawText("3. Un vehículo circula a velocidad constante de 90 km/h (25 m/s). ¿Qué distancia recorre en 12 segundos?", {
    x: 45,
    y,
    size: 10,
    font: fontRegular,
    color: darkSlate,
  });

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
  page.drawText("6. Explica brevemente qué es la fotosíntesis, en qué orgánulo celular ocurre y qué gas libera.", {
    x: 45,
    y,
    size: 10,
    font: fontRegular,
    color: darkSlate,
  });

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
  page.drawText("7. Calcula la derivada de la función f(x) = 4x³ - 5x² + 2x - 7 y evalúa su valor en x = 2:", {
    x: 45,
    y,
    size: 10,
    font: fontRegular,
    color: darkSlate,
  });

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
