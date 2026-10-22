import { PDFDocument } from "pdf-lib";
import {
  AnswerAnnotation,
  HANDWRITING_FONTS,
  HandwritingFontOption,
  INK_COLORS,
  PdfPageData,
  StyleSettings,
} from "../types";
import { getCachedGlyphImage } from "./customFontManager";

/**
 * Deterministic pseudo-random number generator in [0, 1] from an integer seed
 */
export function seededRandom(seed: number, step: number = 0): number {
  const x = Math.sin(seed * 9973 + step * 1013) * 10000;
  return x - Math.floor(x);
}

/**
 * Returns the active display string for an annotation (excluding the crossed-out prefix).
 */
export function getAnnotationActiveText(ann: AnswerAnnotation): string {
  if (ann.customText !== null && ann.customText.trim().length > 0) {
    return ann.customText;
  }
  return ann.useMistake ? ann.organicMistakeAnswer : ann.correctAnswer;
}

/**
 * Resolves a font option from the combined built-in + custom font list.
 */
export function resolveFontOption(
  fontId: string,
  allFonts: HandwritingFontOption[] = HANDWRITING_FONTS
): HandwritingFontOption {
  return (
    allFonts.find((f) => f.id === fontId) ||
    HANDWRITING_FONTS.find((f) => f.id === fontId) ||
    HANDWRITING_FONTS[0]
  );
}

/**
 * Word-wraps text to fit inside `maxWidthPx` given a 2D canvas context.
 */
export function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidthPx: number
): string[] {
  const paragraphs = text.split(/\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let currentLine = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${currentLine} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidthPx) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        currentLine = words[i];
      }
    }
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Automatically calculates the ideal handwriting font size (in px) so that the answer
 * (plus any crossed-out word) fits naturally inside the target blank bounding box.
 */
export function computeAutoFontSize(
  ann: AnswerAnnotation,
  boxWidthPx: number,
  boxHeightPx: number,
  style: StyleSettings,
  allFonts: HandwritingFontOption[] = HANDWRITING_FONTS
): number {
  if (!ann.autoFitFont) {
    return ann.manualFontSize;
  }

  const fontMeta = resolveFontOption(style.fontId, allFonts);
  const activeText = getAnnotationActiveText(ann);
  const fullSampleText =
    ann.useCrossOut && ann.crossedOutWord
      ? `${ann.crossedOutWord}  ${activeText}`
      : activeText;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 18;

  const usableWidth = Math.max(36, boxWidthPx - 12);
  const usableHeight = Math.max(18, boxHeightPx - 6);

  const minSize = 11;
  const maxSize = Math.min(34, Math.floor(usableHeight * 0.78));

  for (let size = Math.max(minSize, maxSize); size >= minSize; size -= 1) {
    ctx.font = `${fontMeta.baseWeight} ${size}px ${fontMeta.cssFamily}`;
    const lines = wrapTextLines(ctx, fullSampleText, usableWidth);
    const totalHeight = lines.length * size * fontMeta.lineHeightMultiplier;
    const widestLine = Math.max(...lines.map((l) => ctx.measureText(l).width), 0);

    if (totalHeight <= usableHeight && widestLine <= usableWidth * 1.05) {
      return size;
    }
  }

  return minSize;
}

/**
 * Helper to draw a word on canvas, supporting both standard/uploaded FontFace
 * and character-by-character custom drawn glyphs tinted with the selected ink color.
 */
function drawWordWithFontOrGlyphs(
  ctx: CanvasRenderingContext2D,
  word: string,
  fontMeta: HandwritingFontOption,
  fontSizePx: number,
  rgbColor: [number, number, number],
  alpha: number
) {
  const [r, g, b] = rgbColor;
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;

  if (fontMeta.customType === "drawn_glyphs" && fontMeta.glyphMap) {
    let charX = 0;
    const extraSpacing = (fontMeta.customLetterSpacing || 0) * (fontSizePx / 20);
    for (const ch of word) {
      const glyphImg =
        getCachedGlyphImage(fontMeta.id, ch) ||
        getCachedGlyphImage(fontMeta.id, ch.toLowerCase()) ||
        getCachedGlyphImage(fontMeta.id, ch.toUpperCase());

      if (glyphImg) {
        const glyphW = fontSizePx * 0.68;
        const glyphH = fontSizePx * 1.05;

        // Tint the drawn glyph to match the ink color
        const off = document.createElement("canvas");
        off.width = Math.max(1, Math.round(glyphW * 2));
        off.height = Math.max(1, Math.round(glyphH * 2));
        const offCtx = off.getContext("2d");
        if (offCtx) {
          offCtx.drawImage(glyphImg, 0, 0, off.width, off.height);
          offCtx.globalCompositeOperation = "source-in";
          offCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
          offCtx.fillRect(0, 0, off.width, off.height);
          ctx.drawImage(off, charX, 0, glyphW, glyphH);
        }
        charX += glyphW * 0.82 + extraSpacing;
      } else {
        ctx.fillText(ch, charX, 0);
        charX += ctx.measureText(ch).width + extraSpacing;
      }
    }
  } else {
    ctx.fillText(word, 0, 0);
  }
}

/**
 * Renders all annotations for a single page onto a transparent high-DPI canvas.
 * Used both for pixel-accurate PDF export and high-res rendering.
 */
export function renderAnnotationsToCanvas(
  pageWidthPt: number,
  pageHeightPt: number,
  annotations: AnswerAnnotation[],
  style: StyleSettings,
  scaleFactor: number = 2.5,
  allFonts: HandwritingFontOption[] = HANDWRITING_FONTS
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(pageWidthPt * scaleFactor);
  canvas.height = Math.round(pageHeightPt * scaleFactor);

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const fontMeta = resolveFontOption(style.fontId, allFonts);
  const inkMeta =
    INK_COLORS.find((i) => i.id === style.inkId) || INK_COLORS[0];

  const variationIntensity = style.organic.enabled
    ? style.organic.strokeVariationPercent / 100
    : 0;
  const customSlantRad = ((fontMeta.customSlantDeg || 0) * Math.PI) / 180;

  for (const ann of annotations) {
    const boxX = (ann.box.x / 100) * canvas.width;
    const boxY = (ann.box.y / 100) * canvas.height;
    const boxW = (ann.box.width / 100) * canvas.width;
    const boxH = (ann.box.height / 100) * canvas.height;

    const baseFontSize = computeAutoFontSize(
      ann,
      (ann.box.width / 100) * pageWidthPt,
      (ann.box.height / 100) * pageHeightPt,
      style,
      allFonts
    );
    const fontSizePx = baseFontSize * scaleFactor;
    const lineHeightPx = fontSizePx * fontMeta.lineHeightMultiplier;

    ctx.save();
    ctx.font = `${fontMeta.baseWeight} ${fontSizePx}px ${fontMeta.cssFamily}`;
    ctx.textBaseline = "top";

    const [r, g, b] = inkMeta.rgb;
    const activeText = getAnnotationActiveText(ann);

    let cursorX = boxX + 4 * scaleFactor;
    let cursorY = boxY + 2 * scaleFactor;

    const fullTextForWrap =
      ann.useCrossOut && ann.crossedOutWord
        ? `${ann.crossedOutWord}   ${activeText}`
        : activeText;
    const wrappedPreview = wrapTextLines(
      ctx,
      fullTextForWrap,
      Math.max(40, boxW - 8 * scaleFactor)
    );
    const totalTextHeight = wrappedPreview.length * lineHeightPx;
    if (totalTextHeight < boxH * 0.72) {
      cursorY = boxY + Math.max(2 * scaleFactor, (boxH - totalTextHeight) * 0.42);
    }

    // 1. If useCrossOut is active, draw the crossed-out word first with realistic pen scratch strokes
    if (ann.useCrossOut && ann.crossedOutWord.trim().length > 0) {
      const crossWord = ann.crossedOutWord.trim();
      const crossWidth = ctx.measureText(crossWord).width;

      const wordTilt =
        customSlantRad +
        (seededRandom(ann.seed, 1) - 0.5) * 0.045 * variationIntensity;
      const wordAlpha =
        inkMeta.opacityBase - seededRandom(ann.seed, 2) * 0.12 * variationIntensity;

      ctx.save();
      ctx.translate(cursorX, cursorY);
      ctx.rotate(wordTilt);
      drawWordWithFontOrGlyphs(
        ctx,
        crossWord,
        fontMeta,
        fontSizePx,
        inkMeta.rgb,
        wordAlpha
      );

      // Draw 2 organic ballpoint pen scratch lines over the crossed-out word
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(0.98, wordAlpha + 0.06).toFixed(3)})`;
      ctx.lineWidth = Math.max(1.3, baseFontSize * 0.085) * scaleFactor;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const midY = fontSizePx * 0.54;
      ctx.beginPath();
      ctx.moveTo(-2 * scaleFactor, midY + 1.5 * scaleFactor);
      ctx.quadraticCurveTo(
        crossWidth * 0.5,
        midY - 2.5 * scaleFactor,
        crossWidth + 3 * scaleFactor,
        midY - 0.5 * scaleFactor
      );
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-1 * scaleFactor, midY - 1.8 * scaleFactor);
      ctx.quadraticCurveTo(
        crossWidth * 0.48,
        midY + 2.8 * scaleFactor,
        crossWidth + 2 * scaleFactor,
        midY + 1.2 * scaleFactor
      );
      ctx.stroke();

      ctx.restore();

      cursorX += crossWidth + 10 * scaleFactor;
    }

    // 2. Draw the main answer word-by-word with organic baseline jitter, slant, and ink pressure
    const paragraphs = activeText.split(/\n/);
    let wordStep = 10;
    const rightLimit = boxX + boxW - 4 * scaleFactor;

    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      const words = paragraphs[pIdx].split(/\s+/).filter(Boolean);
      for (let wIdx = 0; wIdx < words.length; wIdx++) {
        const word = words[wIdx];
        const wordWidth = ctx.measureText(word).width;
        const spaceWidth = ctx.measureText(" ").width * 0.92;

        if (cursorX + wordWidth > rightLimit && cursorX > boxX + 10 * scaleFactor) {
          cursorX =
            boxX +
            4 * scaleFactor +
            (seededRandom(ann.seed, wordStep + 1) - 0.3) *
              4 *
              scaleFactor *
              variationIntensity;
          cursorY += lineHeightPx;
        }

        const yJitter =
          (seededRandom(ann.seed, wordStep + 2) - 0.5) *
          3.2 *
          scaleFactor *
          variationIntensity;
        const angleRad =
          customSlantRad +
          (seededRandom(ann.seed, wordStep + 3) - 0.5) *
            0.055 *
            variationIntensity;
        const pressureAlpha = Math.max(
          0.68,
          Math.min(
            0.98,
            inkMeta.opacityBase +
              (seededRandom(ann.seed, wordStep + 4) - 0.5) * 0.18 * variationIntensity
          )
        );

        ctx.save();
        ctx.translate(cursorX, cursorY + yJitter);
        ctx.rotate(angleRad);
        drawWordWithFontOrGlyphs(
          ctx,
          word,
          fontMeta,
          fontSizePx,
          inkMeta.rgb,
          pressureAlpha
        );
        ctx.restore();

        cursorX +=
          wordWidth +
          spaceWidth *
            (1 + (seededRandom(ann.seed, wordStep + 5) - 0.45) * 0.28 * variationIntensity);
        wordStep += 7;
      }

      if (pIdx < paragraphs.length - 1) {
        cursorX = boxX + 4 * scaleFactor;
        cursorY += lineHeightPx;
      }
    }

    ctx.restore();
  }

  return canvas;
}

/**
 * Exports the original PDF document with all handwritten answers, organic mistakes,
 * and crossed-out corrections stamped onto their exact locations.
 */
export async function exportAnnotatedPdfBytes(
  originalPdfBytes: ArrayBuffer | Uint8Array,
  pagesData: PdfPageData[],
  annotations: AnswerAnnotation[],
  style: StyleSettings,
  allFonts: HandwritingFontOption[] = HANDWRITING_FONTS
): Promise<Uint8Array> {
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  const pdfDoc = await PDFDocument.load(originalPdfBytes);
  const pdfPages = pdfDoc.getPages();

  for (let i = 0; i < pdfPages.length; i++) {
    const pageNumber = i + 1;
    const pageAnns = annotations.filter((a) => a.pageNumber === pageNumber);
    if (pageAnns.length === 0) continue;

    const pdfPage = pdfPages[i];
    const { width, height } = pdfPage.getSize();
    const pageMeta = pagesData.find((p) => p.pageNumber === pageNumber);

    const overlayCanvas = renderAnnotationsToCanvas(
      pageMeta?.widthPt || width,
      pageMeta?.heightPt || height,
      pageAnns,
      style,
      2.5,
      allFonts
    );

    const pngDataUrl = overlayCanvas.toDataURL("image/png");
    const pngImage = await pdfDoc.embedPng(pngDataUrl);

    pdfPage.drawImage(pngImage, {
      x: 0,
      y: 0,
      width,
      height,
    });
  }

  return await pdfDoc.save();
}
