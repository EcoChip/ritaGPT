import { PDFDocument } from "pdf-lib";
import {
  AnswerAnnotation,
  HANDWRITING_FONTS,
  HandwritingFontOption,
  INK_COLORS,
  PdfPageData,
  StyleSettings,
} from "../types";
import {
  dataUrlToUint8Array,
  getCachedGlyphVariantImage,
} from "./customFontManager";
import { embedImageBytesSafe } from "./pdfLoader";

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
 * Picks which font family from a fused font pool to use for a specific character occurrence,
 * ensuring consecutive 'a's or 'e's never use the exact same glyph shape.
 */
export function pickCharacterCssFamily(
  fontMeta: HandwritingFontOption,
  char: string,
  occurrenceIndex: number,
  seed: number,
  antiCloneEnabled: boolean
): string {
  const pool =
    fontMeta.fusedCssFamilies && fontMeta.fusedCssFamilies.length > 1
      ? fontMeta.fusedCssFamilies
      : antiCloneEnabled && !fontMeta.isCustom
      ? [
          fontMeta.cssFamily,
          "'Caveat', cursive",
          "'Kalam', cursive",
          "'Patrick Hand', cursive",
        ]
      : [fontMeta.cssFamily];

  if (pool.length <= 1) return fontMeta.cssFamily;
  const charCode = char.charCodeAt(0) || 1;
  const idx = Math.abs(seed + charCode * 3 + occurrenceIndex * 7) % pool.length;
  return pool[idx];
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
  const globalTarget = style?.baseFontSize || 19;

  // If user disabled auto-fit for this specific box and adjusted manual size, respect it
  if (!ann.autoFitFont && ann.manualFontSize) {
    return ann.manualFontSize;
  }

  // When uniform font size is active (default: true, set to 19pt):
  // Every single answer remains strictly at the exact same handwriting size (19pt)
  if (!style || style.uniformFontSize !== false) {
    return globalTarget;
  }

  // Adaptive sizing fallback when user specifically disables uniform font size
  const fontMeta = resolveFontOption(style.fontId, allFonts);
  const activeText = getAnnotationActiveText(ann);
  const fullSampleText =
    ann.useCrossOut && ann.crossedOutWord
      ? `${ann.crossedOutWord}  ${activeText}`
      : activeText;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return globalTarget;

  const isSmallCallout =
    !ann.isNotebookEntry &&
    (ann.subjectType === "short_blank" ||
      boxWidthPx < 150 ||
      boxHeightPx < 36);

  const horizontalPad = isSmallCallout ? 8 : 14;
  const verticalPad = isSmallCallout ? 4 : 7;

  const usableWidth = Math.max(24, boxWidthPx - horizontalPad);
  const usableHeight = Math.max(12, boxHeightPx - verticalPad);

  const minSize = ann.isNotebookEntry ? 12.5 : isSmallCallout ? 9.5 : 11;
  const maxSize = Math.max(
    minSize,
    Math.min(
      globalTarget,
      Math.floor(usableHeight * (isSmallCallout ? 0.82 : 0.78))
    )
  );

  // Account for character spacing, anti-clone jitter & DOM rendering width (~9% buffer)
  const effectiveMaxWidth = usableWidth * 0.9;

  for (let size = Math.max(minSize, maxSize); size >= minSize; size -= 0.5) {
    ctx.font = `${fontMeta.baseWeight} ${size}px ${fontMeta.cssFamily}`;
    const lines = wrapTextLines(ctx, fullSampleText, effectiveMaxWidth);
    const lineHeight =
      size *
      (isSmallCallout
        ? Math.min(1.1, fontMeta.lineHeightMultiplier)
        : fontMeta.lineHeightMultiplier);
    const totalHeight = lines.length * lineHeight;
    const widestLine = Math.max(
      ...lines.map((l) => ctx.measureText(l).width),
      0
    );

    // For short callout boxes, strongly prefer fitting on 1 single line
    const fitsSingleLineWhenTiny =
      !isSmallCallout || boxHeightPx >= 30 || lines.length === 1 || size <= 11.0;

    if (
      totalHeight <= usableHeight &&
      widestLine <= usableWidth * 0.94 &&
      fitsSingleLineWhenTiny
    ) {
      return Number(size.toFixed(1));
    }
  }

  return minSize;
}

/**
 * Draws a single word onto a 2D canvas, alternating across fused fonts and/or multiple drawn glyph variants
 * character-by-character so two 'a's never look identical.
 */
function drawWordWithFusedFontsOrGlyphs(
  ctx: CanvasRenderingContext2D,
  word: string,
  fontMeta: HandwritingFontOption,
  fontSizePx: number,
  rgbColor: [number, number, number],
  alpha: number,
  seed: number,
  charOccurrenceCounter: Record<string, number>,
  antiCloneEnabled: boolean,
  variationIntensity: number
) {
  const [r, g, b] = rgbColor;
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;

  let charX = 0;
  const extraSpacing = (fontMeta.customLetterSpacing || 0) * (fontSizePx / 20);

  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    const lowerKey = ch.toLowerCase();
    const occ = (charOccurrenceCounter[lowerKey] =
      (charOccurrenceCounter[lowerKey] || 0) + 1);

    const glyphImg = getCachedGlyphVariantImage(fontMeta.id, ch, occ + seed);

    // Subtle per-character anti-clone variation (scale, y-offset, micro-tilt)
    const charScaleY = antiCloneEnabled
      ? 1 + (seededRandom(seed + occ * 19, i + 1) - 0.5) * 0.13 * Math.max(0.4, variationIntensity)
      : 1;
    const charScaleX = antiCloneEnabled
      ? 1 + (seededRandom(seed + occ * 23, i + 2) - 0.5) * 0.1 * Math.max(0.4, variationIntensity)
      : 1;
    const charYOffset = antiCloneEnabled
      ? (seededRandom(seed + occ * 31, i + 3) - 0.5) * (fontSizePx * 0.08)
      : 0;
    const charRot = antiCloneEnabled
      ? (seededRandom(seed + occ * 37, i + 4) - 0.5) * 0.06
      : 0;

    if (glyphImg) {
      const glyphW = fontSizePx * 0.68;
      const glyphH = fontSizePx * 1.05;

      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.round(glyphW * 2));
      off.height = Math.max(1, Math.round(glyphH * 2));
      const offCtx = off.getContext("2d");
      if (offCtx) {
        offCtx.drawImage(glyphImg, 0, 0, off.width, off.height);
        offCtx.globalCompositeOperation = "source-in";
        offCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
        offCtx.fillRect(0, 0, off.width, off.height);

        ctx.save();
        ctx.translate(charX, charYOffset);
        ctx.rotate(charRot);
        ctx.scale(charScaleX, charScaleY);
        ctx.drawImage(off, 0, 0, glyphW, glyphH);
        ctx.restore();
      }
      charX += glyphW * 0.82 * charScaleX + extraSpacing;
    } else {
      const charFontFamily = pickCharacterCssFamily(
        fontMeta,
        ch,
        occ,
        seed,
        antiCloneEnabled
      );
      ctx.save();
      ctx.font = `${fontMeta.baseWeight} ${fontSizePx}px ${charFontFamily}`;
      ctx.translate(charX, charYOffset);
      ctx.rotate(charRot);
      ctx.scale(charScaleX, charScaleY);
      ctx.fillText(ch, 0, 0);
      const chWidth = ctx.measureText(ch).width;
      ctx.restore();

      charX += chWidth * charScaleX + extraSpacing;
    }
  }
}

/**
 * Renders all annotations for a single page onto a transparent high-DPI canvas.
 */
export function renderAnnotationsToCanvas(
  pageWidthPt: number,
  pageHeightPt: number,
  annotations: AnswerAnnotation[],
  style: StyleSettings,
  scaleFactor: number = 2.4,
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
  const antiCloneEnabled =
    style.organic.antiCloneLetterVariation ||
    fontMeta.customType === "fused_fonts" ||
    Boolean(fontMeta.fusedCssFamilies && fontMeta.fusedCssFamilies.length > 1);
  const customSlantRad = ((fontMeta.customSlantDeg || 0) * Math.PI) / 180;

  for (const ann of annotations) {
    const boxX = (ann.box.x / 100) * canvas.width;
    const boxY = (ann.box.y / 100) * canvas.height;
    const boxW = (ann.box.width / 100) * canvas.width;
    const boxH = (ann.box.height / 100) * canvas.height;

    const boxWidthPt = (ann.box.width / 100) * pageWidthPt;
    const boxHeightPt = (ann.box.height / 100) * pageHeightPt;

    const isSmallCallout =
      !ann.isNotebookEntry &&
      (ann.subjectType === "short_blank" ||
        boxWidthPt < 145 ||
        boxHeightPt < 34);

    const baseFontSize = computeAutoFontSize(
      ann,
      boxWidthPt,
      boxHeightPt,
      style,
      allFonts
    );
    const fontSizePx = baseFontSize * scaleFactor;
    const effectiveLineMultiplier = isSmallCallout
      ? Math.min(1.12, fontMeta.lineHeightMultiplier)
      : fontMeta.lineHeightMultiplier;
    const lineHeightPx = fontSizePx * effectiveLineMultiplier;

    ctx.save();

    // Clip to a generous safety boundary around the box on worksheet pages so text never spills into adjacent boxes
    if (!ann.isNotebookEntry) {
      ctx.beginPath();
      ctx.rect(
        boxX - 4 * scaleFactor,
        boxY - 4 * scaleFactor,
        boxW + 12 * scaleFactor,
        boxH + 12 * scaleFactor
      );
      ctx.clip();
    }

    ctx.font = `${fontMeta.baseWeight} ${fontSizePx}px ${fontMeta.cssFamily}`;
    ctx.textBaseline = "top";

    const [r, g, b] = inkMeta.rgb;
    const activeText = getAnnotationActiveText(ann);
    const charOccurrenceCounter: Record<string, number> = {};

    const padLeftPx = (isSmallCallout ? 3 : 4.5) * scaleFactor;
    const fullTextForWrap =
      ann.useCrossOut && ann.crossedOutWord
        ? `${ann.crossedOutWord}   ${activeText}`
        : activeText;
    const wrappedPreview = wrapTextLines(
      ctx,
      fullTextForWrap,
      Math.max(24, boxW - padLeftPx * 2)
    );
    const totalTextHeight = wrappedPreview.length * lineHeightPx;

    let startX = boxX + padLeftPx;
    let cursorY = boxY + 2 * scaleFactor;

    if (!ann.isNotebookEntry) {
      if (totalTextHeight < boxH * 0.82) {
        cursorY =
          boxY + Math.max(1.5 * scaleFactor, (boxH - totalTextHeight) * 0.42);
      }
      // For small 1-line diagram callout boxes, gently center horizontally inside the box
      if (isSmallCallout && wrappedPreview.length === 1 && !ann.useCrossOut) {
        const singleLineWidth = ctx.measureText(wrappedPreview[0]).width * 1.04;
        if (singleLineWidth < boxW - padLeftPx * 2) {
          const centeredOffset = (boxW - singleLineWidth) * 0.38;
          startX = boxX + Math.max(padLeftPx, centeredOffset);
        }
      }
    }

    let cursorX = startX;

    // 1. Crossed-out prefix word if enabled
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
      drawWordWithFusedFontsOrGlyphs(
        ctx,
        crossWord,
        fontMeta,
        fontSizePx,
        inkMeta.rgb,
        wordAlpha,
        ann.seed,
        charOccurrenceCounter,
        antiCloneEnabled,
        variationIntensity
      );

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

      cursorX += crossWidth + 8 * scaleFactor;
    }

    // 2. Main answer word-by-word
    const paragraphs = activeText.split(/\n/);
    let wordStep = 10;
    const rightLimit = boxX + boxW - padLeftPx * 0.8;

    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      const words = paragraphs[pIdx].split(/\s+/).filter(Boolean);
      for (let wIdx = 0; wIdx < words.length; wIdx++) {
        const word = words[wIdx];
        const wordWidth = ctx.measureText(word).width;
        const spaceWidth = ctx.measureText(" ").width * 0.9;

        if (
          cursorX + wordWidth > rightLimit &&
          cursorX > boxX + padLeftPx + 4 * scaleFactor
        ) {
          cursorX =
            boxX +
            padLeftPx +
            (seededRandom(ann.seed, wordStep + 1) - 0.3) *
              3 *
              scaleFactor *
              variationIntensity;
          cursorY += lineHeightPx;
        }

        const yJitter =
          (seededRandom(ann.seed, wordStep + 2) - 0.5) *
          (isSmallCallout ? 1.4 : 2.8) *
          scaleFactor *
          variationIntensity;
        const angleRad =
          customSlantRad +
          (seededRandom(ann.seed, wordStep + 3) - 0.5) *
            (isSmallCallout ? 0.03 : 0.05) *
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
        drawWordWithFusedFontsOrGlyphs(
          ctx,
          word,
          fontMeta,
          fontSizePx,
          inkMeta.rgb,
          pressureAlpha,
          ann.seed + wordStep,
          charOccurrenceCounter,
          antiCloneEnabled,
          variationIntensity
        );
        ctx.restore();

        cursorX +=
          wordWidth +
          spaceWidth *
            (1 + (seededRandom(ann.seed, wordStep + 5) - 0.45) * 0.25 * variationIntensity);
        wordStep += 7;
      }

      if (pIdx < paragraphs.length - 1) {
        cursorX = boxX + padLeftPx;
        cursorY += lineHeightPx;
      }
    }

    ctx.restore();
  }

  return canvas;
}

/**
 * Exports the PDF document with all handwritten answers stamped onto their exact locations.
 * Supports exporting:
 * - Full document (original pages + any appended separate notebook sheets)
 * - Notebook-only PDF (when onlyNotebookPages is true)
 */
export async function exportAnnotatedPdfBytes(
  originalPdfBytes: ArrayBuffer | Uint8Array,
  pagesData: PdfPageData[],
  annotations: AnswerAnnotation[],
  style: StyleSettings,
  allFonts: HandwritingFontOption[] = HANDWRITING_FONTS,
  onlyNotebookPages: boolean = false
): Promise<Uint8Array> {
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  let pdfDoc: PDFDocument;
  let existingPdfPages: ReturnType<PDFDocument["getPages"]> = [];

  if (
    onlyNotebookPages ||
    !originalPdfBytes ||
    originalPdfBytes.byteLength < 32
  ) {
    pdfDoc = await PDFDocument.create();
  } else {
    try {
      pdfDoc = await PDFDocument.load(originalPdfBytes);
      existingPdfPages = pdfDoc.getPages();
    } catch {
      pdfDoc = await PDFDocument.create();
      existingPdfPages = [];
    }
  }

  for (let i = 0; i < pagesData.length; i++) {
    const pageMeta = pagesData[i];
    const pageNumber = pageMeta.pageNumber;
    const pageAnns = annotations.filter((a) => a.pageNumber === pageNumber);

    if (onlyNotebookPages && !pageMeta.isNotebookPage) {
      continue;
    }

    let targetPdfPage = !pageMeta.isNotebookPage ? existingPdfPages[i] : undefined;

    // If this is a generated Separate Notebook Page (or if we are creating a fresh page), add it to pdfDoc
    if (!targetPdfPage) {
      targetPdfPage = pdfDoc.addPage([pageMeta.widthPt, pageMeta.heightPt]);
      if (pageMeta.imageDataUrl) {
        const bgBytes = dataUrlToUint8Array(pageMeta.imageDataUrl);
        if (bgBytes.length > 16) {
          const bgImg = await embedImageBytesSafe(pdfDoc, bgBytes);
          targetPdfPage.drawImage(bgImg, {
            x: 0,
            y: 0,
            width: pageMeta.widthPt,
            height: pageMeta.heightPt,
          });
        }
      }
    }

    if (pageAnns.length === 0) continue;

    const { width, height } = targetPdfPage.getSize();
    const overlayCanvas = renderAnnotationsToCanvas(
      pageMeta.widthPt || width,
      pageMeta.heightPt || height,
      pageAnns,
      style,
      2.4,
      allFonts
    );

    const pngDataUrl = overlayCanvas.toDataURL("image/png");
    const pngBytes = dataUrlToUint8Array(pngDataUrl);
    if (pngBytes.length > 16) {
      const pngImage = await embedImageBytesSafe(pdfDoc, pngBytes);
      targetPdfPage.drawImage(pngImage, {
        x: 0,
        y: 0,
        width,
        height,
      });
    }
  }

  return await pdfDoc.save();
}
