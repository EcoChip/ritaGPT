import { AnswerAnnotation } from "../types";

/**
 * Loads a data URL or image URL into an offscreen canvas at a normalized analysis resolution
 * and returns the 2D context + pixel data for fast blank-box refinement.
 */
async function loadPagePixelsForAnalysis(imageDataUrl: string): Promise<{
  width: number;
  height: number;
  data: Uint8ClampedArray;
} | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = "anonymous";
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Image decode error"));
      el.src = imageDataUrl;
    });

    const naturalW = img.naturalWidth || img.width || 800;
    const naturalH = img.naturalHeight || img.height || 1100;
    const maxAnalysisDim = 1000;
    const scale = Math.min(1, maxAnalysisDim / Math.max(naturalW, naturalH));
    const width = Math.max(200, Math.round(naturalW * scale));
    const height = Math.max(200, Math.round(naturalH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const imgData = ctx.getImageData(0, 0, width, height);
    return {
      width,
      height,
      data: imgData.data,
    };
  } catch {
    return null;
  }
}

/**
 * Returns perceived luminance (0..255) at pixel (x, y).
 */
function getPixelLuminance(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number
): number {
  const idx = (y * width + x) * 4;
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Returns true if the pixel is dark printed text or a dark line (not white paper or a very pale tint).
 */
function isDarkPrintedPixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  threshold: number = 172
): boolean {
  const idx = (y * width + x) * 4;
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum < threshold;
}

/**
 * Returns true if the pixel is clean white/near-white writable background.
 */
function isCleanWhitePixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number
): boolean {
  const idx = (y * width + x) * 4;
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];
  return r > 228 && g > 228 && b > 224;
}

/**
 * For small diagram callout boxes (like cell labels, anatomy labels, map boxes),
 * finds the exact interior white rectangle bounded by the callout box borders
 * so the handwritten word sits strictly inside the box.
 */
function snapSmallCalloutBoxToWhiteCavity(
  box: { x: number; y: number; width: number; height: number },
  pixels: { width: number; height: number; data: Uint8ClampedArray }
): { x: number; y: number; width: number; height: number } {
  const { width: W, height: H, data } = pixels;

  const origX0 = Math.max(2, Math.min(W - 4, Math.round((box.x / 100) * W)));
  const origY0 = Math.max(2, Math.min(H - 4, Math.round((box.y / 100) * H)));
  const origX1 = Math.max(
    origX0 + 8,
    Math.min(W - 2, Math.round(((box.x + box.width) / 100) * W))
  );
  const origY1 = Math.max(
    origY0 + 6,
    Math.min(H - 2, Math.round(((box.y + box.height) / 100) * H))
  );

  const midX = Math.round((origX0 + origX1) / 2);
  const midY = Math.round((origY0 + origY1) / 2);

  // Search near (midX, midY) vertically within ±2.2% of page height to find a clean white horizontal strip
  const searchRadiusY = Math.max(6, Math.round(H * 0.022));
  let bestSeedY = midY;
  let bestWhiteScore = -1;

  const stripHalfW = Math.max(8, Math.round((origX1 - origX0) * 0.28));
  for (let dy = -searchRadiusY; dy <= searchRadiusY; dy++) {
    const candidateY = midY + dy;
    if (candidateY < 4 || candidateY >= H - 4) continue;

    let whiteCount = 0;
    let totalCount = 0;
    for (
      let sx = Math.max(2, midX - stripHalfW);
      sx <= Math.min(W - 3, midX + stripHalfW);
      sx += 2
    ) {
      totalCount++;
      if (isCleanWhitePixel(data, W, sx, candidateY)) {
        whiteCount++;
      }
    }
    const ratio = totalCount > 0 ? whiteCount / totalCount : 0;
    // Prefer candidates closer to original midY when both are pure white
    const distancePenalty = (Math.abs(dy) / searchRadiusY) * 0.08;
    const score = ratio - distancePenalty;
    if (score > bestWhiteScore) {
      bestWhiteScore = score;
      bestSeedY = candidateY;
    }
  }

  // Only snap if we found a genuinely white interior strip
  if (bestWhiteScore < 0.78) {
    return box;
  }

  // Expand UP and DOWN from bestSeedY until hitting a border row (where white ratio drops < 0.65)
  const maxExpandUp = Math.max(10, Math.round(H * 0.045));
  const maxExpandDown = Math.max(10, Math.round(H * 0.045));

  const isRowWhite = (ry: number): boolean => {
    let white = 0;
    let count = 0;
    for (
      let sx = Math.max(2, midX - stripHalfW);
      sx <= Math.min(W - 3, midX + stripHalfW);
      sx += 2
    ) {
      count++;
      if (isCleanWhitePixel(data, W, sx, ry)) white++;
    }
    return count > 0 && white / count >= 0.72;
  };

  let topY = bestSeedY;
  while (topY > Math.max(2, bestSeedY - maxExpandUp) && isRowWhite(topY - 1)) {
    topY--;
  }

  let bottomY = bestSeedY;
  while (
    bottomY < Math.min(H - 3, bestSeedY + maxExpandDown) &&
    isRowWhite(bottomY + 1)
  ) {
    bottomY++;
  }

  const cavityH = bottomY - topY;
  const cavityHPercent = (cavityH / H) * 100;

  // Verify vertical cavity is a plausible callout box height (1.6% to 6.8% of page height)
  if (cavityHPercent < 1.5 || cavityHPercent > 7.0) {
    return box;
  }

  // Now expand LEFT and RIGHT within [topY + 2, bottomY - 2] to find the vertical borders of the callout box
  const innerTop = Math.min(bottomY, topY + 2);
  const innerBottom = Math.max(innerTop, bottomY - 2);
  const maxExpandX = Math.max(25, Math.round(W * 0.16));

  const isColWhite = (cx: number): boolean => {
    let white = 0;
    let count = 0;
    for (let sy = innerTop; sy <= innerBottom; sy += 2) {
      count++;
      if (isCleanWhitePixel(data, W, cx, sy)) white++;
    }
    return count > 0 && white / count >= 0.72;
  };

  let leftX = midX;
  while (leftX > Math.max(2, midX - maxExpandX) && isColWhite(leftX - 1)) {
    leftX--;
  }

  let rightX = midX;
  while (
    rightX < Math.min(W - 3, midX + maxExpandX) &&
    isColWhite(rightX + 1)
  ) {
    rightX++;
  }

  const cavityW = rightX - leftX;
  const cavityWPercent = (cavityW / W) * 100;

  // Apply vertical snap always if valid, and horizontal snap if plausible callout box width (5% to 28%)
  const padYPercent = 0.22;
  const snappedY = Math.max(0.5, (topY / H) * 100 + padYPercent);
  const snappedH = Math.max(
    1.8,
    Math.min(6.5, cavityHPercent - padYPercent * 2)
  );

  if (cavityWPercent >= 5.0 && cavityWPercent <= 28.0) {
    const padXPercent = 0.35;
    const snappedX = Math.max(0.5, (leftX / W) * 100 + padXPercent);
    const snappedW = Math.max(
      5.5,
      Math.min(28.0, cavityWPercent - padXPercent * 2)
    );
    return {
      x: Number(snappedX.toFixed(2)),
      y: Number(snappedY.toFixed(2)),
      width: Number(snappedW.toFixed(2)),
      height: Number(snappedH.toFixed(2)),
    };
  }

  return {
    ...box,
    y: Number(snappedY.toFixed(2)),
    height: Number(snappedH.toFixed(2)),
  };
}

/**
 * For open-answer boxes that contain a printed question prompt inside the top of the rectangle
 * (e.g., "a. ¿De qué tipo de célula se trata? ¿Por qué lo sabes?" printed along the top inside a bordered box),
 * detects the printed text rows at the top and shifts `box.y` down so handwriting starts in the clean white space underneath!
 */
function stripPrintedQuestionFromTopOfBox(
  box: { x: number; y: number; width: number; height: number },
  pixels: { width: number; height: number; data: Uint8ClampedArray }
): { x: number; y: number; width: number; height: number } {
  const { width: W, height: H, data } = pixels;

  const x0 = Math.max(2, Math.min(W - 4, Math.round((box.x / 100) * W)));
  const y0 = Math.max(2, Math.min(H - 4, Math.round((box.y / 100) * H)));
  const x1 = Math.max(
    x0 + 16,
    Math.min(W - 2, Math.round(((box.x + box.width) / 100) * W))
  );
  const y1 = Math.max(
    y0 + 12,
    Math.min(H - 2, Math.round(((box.y + box.height) / 100) * H))
  );

  const boxW = x1 - x0;
  const boxH = y1 - y0;
  if (boxW < 30 || boxH < 18) return box;

  // Ignore left/right box border lines (inset by 3.5% of box width or at least 6px)
  const scanX0 = Math.min(x1 - 4, x0 + Math.max(6, Math.round(boxW * 0.035)));
  const scanX1 = Math.max(scanX0 + 8, x1 - Math.max(6, Math.round(boxW * 0.035)));
  const scanWidth = scanX1 - scanX0;

  // Ignore the very top border stroke (first 3-5 pixels)
  const borderTopSkip = Math.max(3, Math.round(H * 0.0045));
  const borderBottomSkip = Math.max(3, Math.round(H * 0.0045));

  const innerStart = y0 + borderTopSkip;
  const innerEnd = y1 - borderBottomSkip;
  const innerHeight = innerEnd - innerStart;
  if (innerHeight < 14) return box;

  // Measure dark printed pixel density on each horizontal row
  // Note: Printed text lines have moderate dark ink density (2% to 42%) with high horizontal transitions,
  // whereas solid horizontal border lines have > 65% density.
  const rowTextScores: number[] = new Array(innerHeight).fill(0);

  for (let r = 0; r < innerHeight; r++) {
    const py = innerStart + r;
    let darkCount = 0;
    let transitions = 0;
    let prevDark = false;

    for (let px = scanX0; px <= scanX1; px++) {
      const dark = isDarkPrintedPixel(data, W, px, py, 170);
      if (dark) darkCount++;
      if (dark !== prevDark) {
        transitions++;
        prevDark = dark;
      }
    }

    const darkRatio = darkCount / scanWidth;
    const transitionRatio = transitions / scanWidth;

    // A row containing printed characters has both dark ink pixels AND frequent ink-to-paper transitions
    if (darkRatio >= 0.014 && darkRatio <= 0.58 && transitionRatio >= 0.025) {
      rowTextScores[r] = darkRatio;
    }
  }

  // Check if the lower 40% of the box is mostly empty writable space
  const lowerStartIdx = Math.floor(innerHeight * 0.58);
  let lowerPrintedRows = 0;
  for (let r = lowerStartIdx; r < innerHeight; r++) {
    if (rowTextScores[r] > 0.018) lowerPrintedRows++;
  }
  const lowerBusyRatio =
    innerHeight - lowerStartIdx > 0
      ? lowerPrintedRows / (innerHeight - lowerStartIdx)
      : 0;

  // If the lower part of the box is clean white space (or faint lines),
  // find the lowest printed text row in the top 62% of the box
  if (lowerBusyRatio < 0.25) {
    const maxTopScanIdx = Math.floor(innerHeight * 0.62);
    let lastPrintedRowIdx = -1;
    let printedRowCount = 0;

    for (let r = 0; r < maxTopScanIdx; r++) {
      if (rowTextScores[r] > 0.016) {
        printedRowCount++;
        lastPrintedRowIdx = r;
      }
    }

    // Require at least 3 rows of printed text characters so a single dust speck isn't treated as a line
    if (printedRowCount >= 3 && lastPrintedRowIdx >= 2) {
      const newTopPx = innerStart + lastPrintedRowIdx + Math.max(4, Math.round(H * 0.005));
      const newBottomPx = innerEnd;
      const newHeightPx = newBottomPx - newTopPx;

      if (newHeightPx >= Math.max(12, Math.round(H * 0.022))) {
        const newYPercent = (newTopPx / H) * 100;
        const newHeightPercent = (newHeightPx / H) * 100;
        return {
          ...box,
          y: Number(newYPercent.toFixed(2)),
          height: Number(newHeightPercent.toFixed(2)),
        };
      }
    }
  }

  return box;
}

/**
 * For inline single-line blanks where Gemini accidentally included printed label text on the left side
 * (e.g., "Nombre: [________]"), shifts `box.x` to start after the printed text on the left.
 */
function stripPrintedPrefixFromLeftOfInlineBox(
  box: { x: number; y: number; width: number; height: number },
  pixels: { width: number; height: number; data: Uint8ClampedArray }
): { x: number; y: number; width: number; height: number } {
  // Only apply to relatively wide, single-line boxes
  if (box.height > 5.8 || box.width < 22) return box;

  const { width: W, height: H, data } = pixels;
  const x0 = Math.max(2, Math.min(W - 4, Math.round((box.x / 100) * W)));
  const y0 = Math.max(2, Math.min(H - 4, Math.round((box.y / 100) * H)));
  const x1 = Math.max(
    x0 + 20,
    Math.min(W - 2, Math.round(((box.x + box.width) / 100) * W))
  );
  const y1 = Math.max(
    y0 + 8,
    Math.min(H - 2, Math.round(((box.y + box.height) / 100) * H))
  );

  const boxW = x1 - x0;
  const boxH = y1 - y0;
  const innerY0 = y0 + Math.max(2, Math.round(boxH * 0.18));
  const innerY1 = y1 - Math.max(2, Math.round(boxH * 0.22));
  if (innerY1 <= innerY0) return box;

  // Check if right half of the box is clean white space
  let rightDarkCols = 0;
  const midOffset = Math.floor(boxW * 0.48);
  for (let cx = x0 + midOffset; cx < x1 - 4; cx++) {
    let darkPixels = 0;
    for (let cy = innerY0; cy <= innerY1; cy++) {
      if (isDarkPrintedPixel(data, W, cx, cy, 165)) darkPixels++;
    }
    if (darkPixels >= 2) rightDarkCols++;
  }
  const rightBusyRatio = rightDarkCols / Math.max(1, boxW - midOffset);
  if (rightBusyRatio > 0.15) return box;

  // Scan left 45% for printed text columns
  const maxLeftScan = Math.floor(boxW * 0.45);
  let lastBusyColOffset = -1;
  let busyCols = 0;
  for (let offset = 4; offset < maxLeftScan; offset++) {
    const cx = x0 + offset;
    let darkPixels = 0;
    for (let cy = innerY0; cy <= innerY1; cy++) {
      if (isDarkPrintedPixel(data, W, cx, cy, 165)) darkPixels++;
    }
    if (darkPixels >= 2) {
      busyCols++;
      lastBusyColOffset = offset;
    }
  }

  if (busyCols >= 6 && lastBusyColOffset > 6) {
    const newX0 = x0 + lastBusyColOffset + Math.max(5, Math.round(W * 0.008));
    const newW = x1 - newX0;
    if ((newW / W) * 100 >= 10) {
      return {
        ...box,
        x: Number(((newX0 / W) * 100).toFixed(2)),
        width: Number(((newW / W) * 100).toFixed(2)),
      };
    }
  }

  return box;
}

/**
 * Prevents any two annotations on the same page from colliding vertically or horizontally.
 */
export function resolveAnnotationCollisions(
  annotations: AnswerAnnotation[]
): AnswerAnnotation[] {
  if (annotations.length <= 1) return annotations;

  const cloned = annotations.map((a) => ({
    ...a,
    box: { ...a.box },
  }));

  // Sort top-to-bottom, then left-to-right
  const indices = cloned
    .map((_, idx) => idx)
    .sort((ia, ib) => {
      const a = cloned[ia].box;
      const b = cloned[ib].box;
      if (Math.abs(a.y - b.y) > 1.2) return a.y - b.y;
      return a.x - b.x;
    });

  for (let i = 0; i < indices.length; i++) {
    const idxA = indices[i];
    const boxA = cloned[idxA].box;

    for (let j = i + 1; j < indices.length; j++) {
      const idxB = indices[j];
      const boxB = cloned[idxB].box;

      // Check horizontal overlap
      const horizOverlap =
        Math.min(boxA.x + boxA.width, boxB.x + boxB.width) -
        Math.max(boxA.x, boxB.x);
      const minWidth = Math.min(boxA.width, boxB.width);

      if (horizOverlap > minWidth * 0.35) {
        // They share a horizontal column; ensure boxA doesn't spill into boxB below it
        const bottomA = boxA.y + boxA.height;
        if (bottomA > boxB.y - 0.25) {
          const availableH = boxB.y - 0.3 - boxA.y;
          if (availableH >= 2.0) {
            boxA.height = Number(availableH.toFixed(2));
          } else {
            // Shift boxB slightly down if they were almost on top of each other
            boxB.y = Number(Math.min(95, boxA.y + boxA.height + 0.35).toFixed(2));
          }
        }
      }
    }
  }

  return cloned;
}

/**
 * Main entry point: refines all in-place worksheet annotations on a page using actual image pixel analysis
 * so that:
 * 1. Small diagram label boxes snap cleanly to their white rectangular interior.
 * 2. Open-answer boxes with printed questions inside the top border shift below the printed question line.
 * 3. Inline blanks don't overwrite printed prefix words on the left.
 * 4. Adjacent boxes never overlap or collide.
 */
export async function refinePageAnnotationsWithPixels(
  imageDataUrl: string,
  annotations: AnswerAnnotation[]
): Promise<AnswerAnnotation[]> {
  if (annotations.length === 0) return annotations;

  const pixels = await loadPagePixelsForAnalysis(imageDataUrl);
  if (!pixels) {
    return resolveAnnotationCollisions(annotations);
  }

  const refined = annotations.map((ann) => {
    if (ann.isNotebookEntry) return ann;

    let nextBox = { ...ann.box };

    const isSmallDiagramOrShortBox =
      ann.subjectType === "short_blank" ||
      (nextBox.width <= 28 && nextBox.height <= 6.8);

    if (isSmallDiagramOrShortBox) {
      nextBox = snapSmallCalloutBoxToWhiteCavity(nextBox, pixels);
    } else {
      // Check if there is a printed question line inside the top of this answer box
      nextBox = stripPrintedQuestionFromTopOfBox(nextBox, pixels);
      // And check if there is printed prefix text on the left of a single-line box
      nextBox = stripPrintedPrefixFromLeftOfInlineBox(nextBox, pixels);
    }

    return {
      ...ann,
      box: nextBox,
    };
  });

  return resolveAnnotationCollisions(refined);
}
