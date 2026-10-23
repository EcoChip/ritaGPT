import {
  AnswerAnnotation,
  NotebookPaperStyle,
  PdfPageData,
} from "../types";

/**
 * Generates a realistic A4 Notebook Page image (Cuadrícula escolar, Rayas horizontales, o Blanco con margen)
 * so exercises from textbook pages ("Realiza la actividad en tu cuaderno") can be solved on separate notebook sheets.
 */
export function generateNotebookBackgroundDataUrl(
  paperStyle: NotebookPaperStyle = "grid",
  pageTitle: string = "Ejercicios resueltos en el cuaderno",
  notebookSheetIndex: number = 1
): { imageDataUrl: string; widthPt: number; heightPt: number } {
  const widthPt = 595.28; // A4 width in points
  const heightPt = 841.89; // A4 height in points
  const scale = 2.0;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(widthPt * scale);
  canvas.height = Math.round(heightPt * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { imageDataUrl: "", widthPt, heightPt };
  }

  // Warm paper background
  ctx.fillStyle = "#FCFBF7";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const topHeaderMargin = 58 * scale;
  const leftMarginX = 52 * scale;

  if (paperStyle === "grid") {
    // 4mm school grid in soft cyan-blue
    const gridStep = 14.5 * scale;
    ctx.strokeStyle = "rgba(125, 175, 225, 0.36)";
    ctx.lineWidth = 1;

    for (let x = leftMarginX; x < canvas.width - 24 * scale; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x, topHeaderMargin);
      ctx.lineTo(x, canvas.height - 28 * scale);
      ctx.stroke();
    }
    for (let y = topHeaderMargin; y < canvas.height - 28 * scale; y += gridStep) {
      ctx.beginPath();
      ctx.moveTo(leftMarginX, y);
      ctx.lineTo(canvas.width - 24 * scale, y);
      ctx.stroke();
    }
  } else if (paperStyle === "lined") {
    // Horizontal ruled notebook lines
    const lineStep = 22 * scale;
    ctx.strokeStyle = "rgba(135, 175, 215, 0.48)";
    ctx.lineWidth = 1.2;

    for (let y = topHeaderMargin + lineStep; y < canvas.height - 30 * scale; y += lineStep) {
      ctx.beginPath();
      ctx.moveTo(28 * scale, y);
      ctx.lineTo(canvas.width - 28 * scale, y);
      ctx.stroke();
    }
  }

  // Classic left vertical red/coral margin line & top header line
  ctx.strokeStyle = "rgba(220, 95, 95, 0.45)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(leftMarginX, 0);
  ctx.lineTo(leftMarginX, canvas.height);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, topHeaderMargin);
  ctx.lineTo(canvas.width, topHeaderMargin);
  ctx.stroke();

  // Notebook spiral holes on the left edge
  ctx.fillStyle = "#E2E8F0";
  for (let y = 42 * scale; y < canvas.height - 30 * scale; y += 28 * scale) {
    ctx.beginPath();
    ctx.arc(18 * scale, y, 5.5 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  // Subtle notebook header text
  ctx.fillStyle = "#64748B";
  ctx.font = `500 ${10 * scale}px 'DM Sans', sans-serif`;
  ctx.fillText(
    `${pageTitle} · Hoja de Cuaderno #${notebookSheetIndex}`,
    leftMarginX + 10 * scale,
    topHeaderMargin - 14 * scale
  );

  return {
    imageDataUrl: canvas.toDataURL("image/jpeg", 0.9),
    widthPt,
    heightPt,
  };
}

/**
 * Takes raw exercises extracted from a textbook page (like Lope de Vega - La dama boba, Ej. 54–62)
 * and lays them out neatly across one or more generated Notebook Pages ("En tu cuaderno aparte"),
 * returning both the generated PdfPageData[] and properly positioned AnswerAnnotation[] items.
 */
export function buildNotebookPagesForExercises(
  rawExercises: any[],
  startingPageNumber: number,
  sourcePageNumber: number,
  pageTitle: string,
  paperStyle: NotebookPaperStyle
): {
  notebookPages: PdfPageData[];
  notebookAnnotations: AnswerAnnotation[];
} {
  const notebookPages: PdfPageData[] = [];
  const notebookAnnotations: AnswerAnnotation[] = [];

  if (rawExercises.length === 0) {
    return { notebookPages, notebookAnnotations };
  }

  let currentSheetIdx = 1;
  let currentPageNum = startingPageNumber;
  let currentYPercent = 9.0; // Start below notebook header

  const createSheet = (sheetIdx: number, pageNum: number): PdfPageData => {
    const bg = generateNotebookBackgroundDataUrl(paperStyle, pageTitle, sheetIdx);
    return {
      pageNumber: pageNum,
      imageDataUrl: bg.imageDataUrl,
      widthPt: bg.widthPt,
      heightPt: bg.heightPt,
      status: "solved",
      pageSummary: `Cuaderno Aparte (${pageTitle}) — Hoja ${sheetIdx}`,
      isNotebookPage: true,
      sourcePageNumber,
    };
  };

  notebookPages.push(createSheet(currentSheetIdx, currentPageNum));

  rawExercises.forEach((ex, index) => {
    const label = String(ex.questionLabel || `Ej. ${index + 1}`).trim();
    const rawCorrect = String(ex.correctAnswer || "").trim();
    const rawMistake = String(ex.organicMistakeAnswer || rawCorrect).trim();

    // Prefix the exercise label (e.g., "54) ") so on the separate notebook sheet it is clear which exercise is being answered
    const formattedCorrect = rawCorrect.startsWith(label)
      ? rawCorrect
      : `${label}) ${rawCorrect}`;
    const formattedMistake = rawMistake.startsWith(label)
      ? rawMistake
      : `${label}) ${rawMistake}`;

    // Estimate height needed on the notebook page based on character length
    const charLen = Math.max(formattedCorrect.length, 60);
    const estimatedLines = Math.max(2, Math.ceil(charLen / 58));
    const boxHeightPercent = Math.min(26, Math.max(7.5, estimatedLines * 2.9 + 2.2));

    // If this exercise would overflow the bottom of the current notebook sheet, add a new notebook sheet
    if (currentYPercent + boxHeightPercent > 93.5) {
      currentSheetIdx += 1;
      currentPageNum += 1;
      currentYPercent = 9.0;
      notebookPages.push(createSheet(currentSheetIdx, currentPageNum));
    }

    notebookAnnotations.push({
      id: `nb-p${sourcePageNumber}-ex${index + 1}-${Date.now()}`,
      pageNumber: currentPageNum,
      questionLabel: label,
      questionSummary: ex.questionSummary || "Actividad de cuaderno",
      subjectType: ex.subjectType || "open_text",
      correctAnswer: formattedCorrect,
      organicMistakeAnswer: formattedMistake,
      mistakeExplanation: String(
        ex.mistakeExplanation || "Pequeña imprecisión de estudiante en el cuaderno"
      ).trim(),
      crossedOutWord: String(ex.crossedOutWord || "").trim(),
      customText: null,
      box: {
        x: 10.5, // Right after the red notebook margin line
        y: Number(currentYPercent.toFixed(2)),
        width: 84.5,
        height: Number(boxHeightPercent.toFixed(2)),
      },
      useMistake: false,
      useCrossOut: false,
      autoFitFont: true,
      manualFontSize: 16,
      seed: sourcePageNumber * 200 + index * 23 + 3,
      isNotebookEntry: true,
    });

    currentYPercent += boxHeightPercent + 2.0;
  });

  return { notebookPages, notebookAnnotations };
}
