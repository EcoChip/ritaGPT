import { AnswerAnnotation, NormalizedBox } from "../types";

export interface PagePixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  paperLum: number;
}

/**
 * Loads a data URL or image URL into an offscreen canvas at a normalized analysis resolution
 * and returns the 2D pixel buffer + estimated paper background luminance.
 */
export async function loadPagePixelsForAnalysis(
  imageDataUrl: string
): Promise<PagePixelBuffer | null> {
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
    const maxAnalysisDim = 1100;
    const scale = Math.min(1, maxAnalysisDim / Math.max(naturalW, naturalH));
    const width = Math.max(240, Math.round(naturalW * scale));
    const height = Math.max(240, Math.round(naturalH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // Estimate paper background luminance (85th percentile of sampled pixels)
    const samples: number[] = [];
    const step = Math.max(4, Math.floor((width * height) / 1200));
    for (let i = 0; i < width * height; i += step) {
      const idx = i * 4;
      const lum =
        0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      samples.push(lum);
    }
    samples.sort((a, b) => a - b);
    const paperLum =
      samples.length > 0
        ? Math.max(220, samples[Math.floor(samples.length * 0.85)])
        : 248;

    return {
      width,
      height,
      data,
      paperLum,
    };
  } catch {
    return null;
  }
}

/**
 * Returns perceived luminance (0..255) at pixel (x, y).
 */
function getLum(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number
): number {
  const idx = (y * width + x) * 4;
  return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
}

/**
 * Returns true if the pixel is darker than the paper background by at least `contrastDelta`
 * (catches black ink, grey printed text, and grey diagram box borders).
 */
function isInkOrBorderPixel(
  pixels: PagePixelBuffer,
  x: number,
  y: number,
  contrastDelta: number = 30
): boolean {
  const lum = getLum(pixels.data, pixels.width, x, y);
  return lum < pixels.paperLum - contrastDelta;
}

/**
 * Returns true if the pixel is clean writable paper background.
 */
function isWritablePaperPixel(
  pixels: PagePixelBuffer,
  x: number,
  y: number,
  tolerance: number = 24
): boolean {
  const lum = getLum(pixels.data, pixels.width, x, y);
  return lum >= pixels.paperLum - tolerance;
}

/**
 * Checks whether horizontal row `y` between `[x0, x1]` looks like a continuous horizontal box border line.
 */
function getHorizontalBorderStrength(
  pixels: PagePixelBuffer,
  y: number,
  x0: number,
  x1: number
): number {
  const span = x1 - x0;
  if (span <= 8 || y < 1 || y >= pixels.height - 1) return 0;
  let borderPixels = 0;
  for (let x = x0; x <= x1; x++) {
    // Check y or y±1 to tolerate slight 1px tilt/anti-aliasing
    if (
      isInkOrBorderPixel(pixels, x, y, 24) ||
      isInkOrBorderPixel(pixels, x, Math.max(0, y - 1), 28) ||
      isInkOrBorderPixel(pixels, x, Math.min(pixels.height - 1, y + 1), 28)
    ) {
      borderPixels++;
    }
  }
  return borderPixels / (span + 1);
}

/**
 * Checks whether vertical column `x` between `[y0, y1]` looks like a continuous vertical box border line.
 */
function getVerticalBorderStrength(
  pixels: PagePixelBuffer,
  x: number,
  y0: number,
  y1: number
): number {
  const span = y1 - y0;
  if (span <= 6 || x < 1 || x >= pixels.width - 1) return 0;
  let borderPixels = 0;
  for (let y = y0; y <= y1; y++) {
    if (
      isInkOrBorderPixel(pixels, x, y, 24) ||
      isInkOrBorderPixel(pixels, Math.max(0, x - 1), y, 28) ||
      isInkOrBorderPixel(pixels, Math.min(pixels.width - 1, x + 1), y, 28)
    ) {
      borderPixels++;
    }
  }
  return borderPixels / (span + 1);
}

/**
 * Measures how clean/white the interior of a candidate rectangle `[x0, y0, x1, y1]` is,
 * ignoring the left 20% where a small printed number (like "1.", "4.", "8.") might sit.
 */
function getInteriorWhitespaceRatio(
  pixels: PagePixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 12 || h < 8) return 0;

  const padXStart = Math.round(w * 0.2);
  const padXEnd = Math.max(3, Math.round(w * 0.05));
  const padY = Math.max(2, Math.round(h * 0.18));

  const sx0 = Math.min(x1 - 2, x0 + padXStart);
  const sx1 = Math.max(sx0 + 2, x1 - padXEnd);
  const sy0 = Math.min(y1 - 2, y0 + padY);
  const sy1 = Math.max(sy0 + 2, y1 - padY);

  let white = 0;
  let total = 0;
  for (let y = sy0; y <= sy1; y += 2) {
    for (let x = sx0; x <= sx1; x += 2) {
      total++;
      if (isWritablePaperPixel(pixels, x, y, 22)) {
        white++;
      }
    }
  }
  return total > 0 ? white / total : 0;
}

/**
 * Once a small diagram callout box's outer border `[leftX, topY, rightX, bottomY]` is found,
 * checks if there is a small printed number/label on the left inside edge (e.g. "1.", "4.", "8.")
 * and returns an adjusted `leftX` that starts right after the printed number.
 */
function skipPrintedNumberInsideLeftOfCalloutBox(
  pixels: PagePixelBuffer,
  leftX: number,
  topY: number,
  rightX: number,
  bottomY: number
): number {
  const boxW = rightX - leftX;
  const boxH = bottomY - topY;
  if (boxW < 24 || boxH < 8) return leftX;

  const innerY0 = topY + Math.max(3, Math.round(boxH * 0.2));
  const innerY1 = bottomY - Math.max(3, Math.round(boxH * 0.2));
  if (innerY1 <= innerY0) return leftX;

  // Scan from 3px inside the left border up to 26% of the box width
  const startOffset = Math.max(3, Math.round(boxW * 0.03));
  const maxScanOffset = Math.min(Math.round(boxW * 0.26), 42);

  let lastInkOffset = -1;
  let inkCols = 0;

  for (let dx = startOffset; dx <= maxScanOffset; dx++) {
    const cx = leftX + dx;
    let darkCount = 0;
    for (let cy = innerY0; cy <= innerY1; cy++) {
      if (isInkOrBorderPixel(pixels, cx, cy, 32)) {
        darkCount++;
      }
    }
    if (darkCount >= 2) {
      inkCols++;
      lastInkOffset = dx;
    }
  }

  // If we found a compact cluster of dark pixels (like "4." or "8.") followed by white space
  if (inkCols >= 2 && lastInkOffset > startOffset) {
    const shiftedLeft = leftX + lastInkOffset + Math.max(3, Math.round(pixels.width * 0.004));
    if (rightX - shiftedLeft >= boxW * 0.65) {
      return shiftedLeft;
    }
  }

  return leftX;
}

/**
 * For small diagram callout boxes (like cell labels, anatomy labels, map boxes),
 * searches around the AI's predicted box for an actual dark-bordered rectangular frame
 * with a white interior, and snaps cleanly inside its borders.
 */
function snapSmallCalloutBoxToBorderedCavity(
  box: NormalizedBox,
  pixels: PagePixelBuffer,
  claimedRects: NormalizedBox[]
): NormalizedBox {
  const { width: W, height: H } = pixels;

  const origX0 = Math.max(2, Math.min(W - 6, Math.round((box.x / 100) * W)));
  const origY0 = Math.max(2, Math.min(H - 6, Math.round((box.y / 100) * H)));
  const origX1 = Math.max(
    origX0 + 12,
    Math.min(W - 2, Math.round(((box.x + box.width) / 100) * W))
  );
  const origY1 = Math.max(
    origY0 + 8,
    Math.min(H - 2, Math.round(((box.y + box.height) / 100) * H))
  );

  const origMidX = Math.round((origX0 + origX1) / 2);
  const origMidY = Math.round((origY0 + origY1) / 2);
  const origW = origX1 - origX0;

  // Search vertically within ±4.8% of page height and horizontally within ±4% of page width
  // for candidate interior seed points (cx, cy) that sit inside a bordered white rectangle
  const searchRadiusY = Math.max(12, Math.round(H * 0.048));
  const searchRadiusX = Math.max(10, Math.round(W * 0.04));

  const minCavityH = Math.max(10, Math.round(H * 0.016));
  const maxCavityH = Math.max(24, Math.round(H * 0.068));
  const minCavityW = Math.max(28, Math.round(W * 0.055));
  const maxCavityW = Math.max(80, Math.round(W * 0.30));

  let bestCandidate: {
    score: number;
    rect: NormalizedBox;
  } | null = null;

  const stepY = Math.max(3, Math.round(H * 0.004));
  const stepX = Math.max(6, Math.round(W * 0.01));

  for (let dy = -searchRadiusY; dy <= searchRadiusY; dy += stepY) {
    const seedY = origMidY + dy;
    if (seedY < 6 || seedY >= H - 6) continue;

    for (let dx = -searchRadiusX; dx <= searchRadiusX; dx += stepX) {
      const seedX = origMidX + dx;
      if (seedX < 8 || seedX >= W - 8) continue;

      if (!isWritablePaperPixel(pixels, seedX, seedY, 20)) continue;

      // Expand UP and DOWN from (seedX, seedY) until hitting a horizontal border line
      const probeHalfW = Math.max(10, Math.round(origW * 0.25));
      const probeX0 = Math.max(2, seedX - probeHalfW);
      const probeX1 = Math.min(W - 3, seedX + probeHalfW);

      let topY = seedY;
      while (
        seedY - topY < maxCavityH &&
        topY > 3 &&
        getHorizontalBorderStrength(pixels, topY - 1, probeX0, probeX1) < 0.45
      ) {
        topY--;
      }

      let bottomY = seedY;
      while (
        bottomY - topY < maxCavityH &&
        bottomY < H - 4 &&
        getHorizontalBorderStrength(pixels, bottomY + 1, probeX0, probeX1) < 0.45
      ) {
        bottomY++;
      }

      const cavH = bottomY - topY;
      if (cavH < minCavityH || cavH > maxCavityH) continue;

      // Check top and bottom border strength
      const topBorderStr = getHorizontalBorderStrength(
        pixels,
        topY - 1,
        probeX0,
        probeX1
      );
      const bottomBorderStr = getHorizontalBorderStrength(
        pixels,
        bottomY + 1,
        probeX0,
        probeX1
      );

      // Must have at least a recognizable top or bottom border
      if (topBorderStr < 0.38 && bottomBorderStr < 0.38) continue;

      // Expand LEFT and RIGHT within [topY + 2, bottomY - 2] to find the vertical borders
      const vProbeY0 = Math.min(bottomY - 1, topY + 2);
      const vProbeY1 = Math.max(vProbeY0 + 2, bottomY - 2);

      let leftX = seedX;
      while (
        seedX - leftX < maxCavityW &&
        leftX > 3 &&
        getVerticalBorderStrength(pixels, leftX - 1, vProbeY0, vProbeY1) < 0.48
      ) {
        leftX--;
      }

      let rightX = seedX;
      while (
        rightX - leftX < maxCavityW &&
        rightX < W - 4 &&
        getVerticalBorderStrength(pixels, rightX + 1, vProbeY0, vProbeY1) < 0.48
      ) {
        rightX++;
      }

      const cavW = rightX - leftX;
      if (cavW < minCavityW || cavW > maxCavityW) continue;

      // Verify full-width horizontal border strength and vertical border strength
      const fullTopStr = getHorizontalBorderStrength(
        pixels,
        topY - 1,
        leftX,
        rightX
      );
      const fullBottomStr = getHorizontalBorderStrength(
        pixels,
        bottomY + 1,
        leftX,
        rightX
      );
      const leftStr = getVerticalBorderStrength(
        pixels,
        leftX - 1,
        vProbeY0,
        vProbeY1
      );
      const rightStr = getVerticalBorderStrength(
        pixels,
        rightX + 1,
        vProbeY0,
        vProbeY1
      );

      const borderConfidence =
        (fullTopStr + fullBottomStr) * 0.35 + (leftStr + rightStr) * 0.15;
      if (borderConfidence < 0.36) continue;

      // Verify interior is clean white paper
      const whiteRatio = getInteriorWhitespaceRatio(
        pixels,
        leftX,
        topY,
        rightX,
        bottomY
      );
      if (whiteRatio < 0.8) continue;

      // Adjust leftX if there is a small printed number ("1.", "4.", "8.") inside the left edge
      const adjustedLeftX = skipPrintedNumberInsideLeftOfCalloutBox(
        pixels,
        leftX,
        topY,
        rightX,
        bottomY
      );

      const padXPercent = 0.28;
      const padYPercent = 0.18;
      const candRect: NormalizedBox = {
        x: Number(Math.max(0.5, (adjustedLeftX / W) * 100 + padXPercent).toFixed(2)),
        y: Number(Math.max(0.5, (topY / H) * 100 + padYPercent).toFixed(2)),
        width: Number(
          Math.max(
            5.0,
            ((rightX - adjustedLeftX) / W) * 100 - padXPercent * 2
          ).toFixed(2)
        ),
        height: Number(
          Math.max(1.8, ((bottomY - topY) / H) * 100 - padYPercent * 2).toFixed(2)
        ),
      };

      // Check if this rectangle is already claimed by another annotation on the same page
      const alreadyClaimed = claimedRects.some((claimed) => {
        const overlapX =
          Math.min(claimed.x + claimed.width, candRect.x + candRect.width) -
          Math.max(claimed.x, candRect.x);
        const overlapY =
          Math.min(claimed.y + claimed.height, candRect.y + candRect.height) -
          Math.max(claimed.y, candRect.y);
        return (
          overlapX > Math.min(claimed.width, candRect.width) * 0.5 &&
          overlapY > Math.min(claimed.height, candRect.height) * 0.5
        );
      });
      if (alreadyClaimed) continue;

      // Penalize distance from Gemini's predicted center so it snaps to the closest matching box
      const candCenterX = ((leftX + rightX) / 2 / W) * 100;
      const candCenterY = ((topY + bottomY) / 2 / H) * 100;
      const origCenterX = box.x + box.width / 2;
      const origCenterY = box.y + box.height / 2;
      const distPercent = Math.hypot(
        candCenterX - origCenterX,
        (candCenterY - origCenterY) * 1.35
      );

      const totalScore =
        borderConfidence * 1.4 + whiteRatio * 0.8 - distPercent * 0.12;

      if (!bestCandidate || totalScore > bestCandidate.score) {
        bestCandidate = {
          score: totalScore,
          rect: candRect,
        };
      }
    }
  }

  if (bestCandidate && bestCandidate.score > 0.72) {
    claimedRects.push(bestCandidate.rect);
    return bestCandidate.rect;
  }

  // Fallback: even if no 4-sided border was found, strip any printed number at the left or printed text at the top
  return stripPrintedQuestionFromTopOfBox(box, pixels);
}

/**
 * For open-answer boxes that contain a printed question prompt inside the top of the rectangle
 * (e.g., "a. ¿De qué tipo de célula se trata? ¿Por qué lo sabes?", "b. ¿Qué función...", "c. ¿Para qué sirven las fimbrias?"),
 * detects printed text rows in any horizontal sub-segment (including short questions on the left!)
 * and shifts `box.y` down so handwriting sits strictly in the clean white space underneath!
 */
function stripPrintedQuestionFromTopOfBox(
  box: NormalizedBox,
  pixels: PagePixelBuffer
): NormalizedBox {
  const { width: W, height: H } = pixels;

  let x0 = Math.max(2, Math.min(W - 6, Math.round((box.x / 100) * W)));
  let y0 = Math.max(2, Math.min(H - 6, Math.round((box.y / 100) * H)));
  let x1 = Math.max(
    x0 + 20,
    Math.min(W - 2, Math.round(((box.x + box.width) / 100) * W))
  );
  let y1 = Math.max(
    y0 + 14,
    Math.min(H - 2, Math.round(((box.y + box.height) / 100) * H))
  );

  const boxW = x1 - x0;
  const boxH = y1 - y0;
  if (boxW < 28 || boxH < 14) return box;

  // 1. If the box is near a wide rectangular frame (top/bottom horizontal borders), align y0 and y1 inside those borders first
  const midX0 = x0 + Math.round(boxW * 0.12);
  const midX1 = x1 - Math.round(boxW * 0.12);
  const borderSearchPx = Math.max(6, Math.round(H * 0.012));

  for (let dy = -borderSearchPx; dy <= borderSearchPx; dy++) {
    const ty = y0 + dy;
    if (
      ty > 2 &&
      ty < y1 - 12 &&
      getHorizontalBorderStrength(pixels, ty, midX0, midX1) >= 0.62
    ) {
      y0 = ty + 2;
      break;
    }
  }

  for (let dy = borderSearchPx; dy >= -borderSearchPx; dy--) {
    const by = y1 + dy;
    if (
      by > y0 + 12 &&
      by < H - 2 &&
      getHorizontalBorderStrength(pixels, by, midX0, midX1) >= 0.62
    ) {
      y1 = by - 2;
      break;
    }
  }

  // Ignore left/right vertical border strokes
  const scanX0 = Math.min(x1 - 8, x0 + Math.max(5, Math.round(boxW * 0.025)));
  const scanX1 = Math.max(scanX0 + 12, x1 - Math.max(5, Math.round(boxW * 0.025)));
  const scanWidth = scanX1 - scanX0;

  // Skip the very top and bottom border strokes (3-4px)
  const borderSkip = Math.max(3, Math.round(H * 0.004));
  const innerStart = y0 + borderSkip;
  const innerEnd = y1 - borderSkip;
  const innerHeight = innerEnd - innerStart;
  if (innerHeight < 12) return box;

  // Divide the horizontal span into overlapping windows (e.g. ~110px wide)
  // so a short printed question on the left (like "c. ¿Para qué sirven las fimbrias?")
  // is detected with high sensitivity even when the right 65% of the wide box is blank!
  const windowWidth = Math.max(36, Math.min(scanWidth, Math.round(W * 0.14)));
  const windowStep = Math.max(18, Math.floor(windowWidth / 2));

  const rowHasPrintedCharacters: boolean[] = new Array(innerHeight).fill(false);

  for (let r = 0; r < innerHeight; r++) {
    const py = innerStart + r;

    // Also check if this entire row is just a solid horizontal line (> 72% dark with very few transitions)
    let fullRowDark = 0;
    let fullRowTrans = 0;
    let prevD = false;
    for (let px = scanX0; px <= scanX1; px++) {
      const d = isInkOrBorderPixel(pixels, px, py, 26);
      if (d) fullRowDark++;
      if (d !== prevD) {
        fullRowTrans++;
        prevD = d;
      }
    }
    const fullDarkRatio = fullRowDark / scanWidth;
    if (fullDarkRatio > 0.68 && fullRowTrans < scanWidth * 0.04) {
      // Solid horizontal rule line, not printed text characters
      continue;
    }

    // Check horizontal sub-windows across the row
    for (
      let wx0 = scanX0;
      wx0 <= Math.max(scanX0, scanX1 - windowWidth + windowStep);
      wx0 += windowStep
    ) {
      const wx1 = Math.min(scanX1, wx0 + windowWidth);
      const wSpan = wx1 - wx0;
      if (wSpan < 20) continue;

      let darkCount = 0;
      let transitions = 0;
      let prevDark = false;

      for (let px = wx0; px <= wx1; px++) {
        const dark = isInkOrBorderPixel(pixels, px, py, 25);
        if (dark) darkCount++;
        if (dark !== prevDark) {
          transitions++;
          prevDark = dark;
        }
      }

      const darkRatio = darkCount / wSpan;
      // Printed text in a window has at least 4% ink pixels and at least 4 ink-to-paper transitions (letters)
      if (darkRatio >= 0.038 && darkRatio <= 0.65 && transitions >= 4) {
        rowHasPrintedCharacters[r] = true;
        break;
      }
    }
  }

  // Check if the lower 32% of the box is mostly clean writable space
  const lowerStartIdx = Math.floor(innerHeight * 0.66);
  let lowerPrintedRows = 0;
  for (let r = lowerStartIdx; r < innerHeight; r++) {
    if (rowHasPrintedCharacters[r]) lowerPrintedRows++;
  }
  const lowerBusyRatio =
    innerHeight - lowerStartIdx > 0
      ? lowerPrintedRows / (innerHeight - lowerStartIdx)
      : 0;

  if (lowerBusyRatio <= 0.3) {
    // Find the lowest printed character row in the top 68% of the box
    const maxTopScanIdx = Math.floor(innerHeight * 0.68);
    let lastPrintedRowIdx = -1;
    let printedRowCount = 0;

    for (let r = 0; r < maxTopScanIdx; r++) {
      if (rowHasPrintedCharacters[r]) {
        printedRowCount++;
        lastPrintedRowIdx = r;
      }
    }

    // Require at least 3 rows of printed characters so a tiny dust speck is ignored
    if (printedRowCount >= 3 && lastPrintedRowIdx >= 2) {
      const safetyPaddingPx = Math.max(3, Math.round(H * 0.004));
      const newTopPx = innerStart + lastPrintedRowIdx + safetyPaddingPx;
      const newBottomPx = y1 - Math.max(2, Math.round(H * 0.002));
      const newHeightPx = newBottomPx - newTopPx;

      if (newHeightPx >= Math.max(11, Math.round(H * 0.019))) {
        return {
          ...box,
          y: Number(((newTopPx / H) * 100).toFixed(2)),
          height: Number(((newHeightPx / H) * 100).toFixed(2)),
        };
      }
    }
  }

  return box;
}

/**
 * For inline single-line blanks where Gemini accidentally included printed label text on the left side
 * (e.g., "Nombre: [________]" or "a) [________]"), shifts `box.x` to start after the printed text on the left.
 */
function stripPrintedPrefixFromLeftOfInlineBox(
  box: NormalizedBox,
  pixels: PagePixelBuffer
): NormalizedBox {
  if (box.height > 6.2 || box.width < 18) return box;

  const { width: W, height: H } = pixels;
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
      if (isInkOrBorderPixel(pixels, cx, cy, 28)) darkPixels++;
    }
    if (darkPixels >= 2) rightDarkCols++;
  }
  const rightBusyRatio = rightDarkCols / Math.max(1, boxW - midOffset);
  if (rightBusyRatio > 0.16) return box;

  // Scan left 45% for printed text columns
  const maxLeftScan = Math.floor(boxW * 0.45);
  let lastBusyColOffset = -1;
  let busyCols = 0;
  for (let offset = 4; offset < maxLeftScan; offset++) {
    const cx = x0 + offset;
    let darkPixels = 0;
    for (let cy = innerY0; cy <= innerY1; cy++) {
      if (isInkOrBorderPixel(pixels, cx, cy, 28)) darkPixels++;
    }
    if (darkPixels >= 2) {
      busyCols++;
      lastBusyColOffset = offset;
    }
  }

  if (busyCols >= 5 && lastBusyColOffset > 5) {
    const newX0 = x0 + lastBusyColOffset + Math.max(5, Math.round(W * 0.008));
    const newW = x1 - newX0;
    if ((newW / W) * 100 >= 8) {
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

      const horizOverlap =
        Math.min(boxA.x + boxA.width, boxB.x + boxB.width) -
        Math.max(boxA.x, boxB.x);
      const minWidth = Math.min(boxA.width, boxB.width);

      if (horizOverlap > minWidth * 0.35) {
        const bottomA = boxA.y + boxA.height;
        if (bottomA > boxB.y - 0.2) {
          const availableH = boxB.y - 0.25 - boxA.y;
          if (availableH >= 1.9) {
            boxA.height = Number(availableH.toFixed(2));
          } else {
            boxB.y = Number(
              Math.min(95, boxA.y + boxA.height + 0.3).toFixed(2)
            );
          }
        }
      }
    }
  }

  return cloned;
}

/**
 * Refines a single annotation box against the worksheet pixels (used when the user taps "Encajar" on a selected box).
 */
export async function refineSingleAnnotationWithPixels(
  imageDataUrl: string,
  annotation: AnswerAnnotation,
  otherPageAnnotations: AnswerAnnotation[] = []
): Promise<NormalizedBox> {
  if (annotation.isNotebookEntry) return annotation.box;
  const pixels = await loadPagePixelsForAnalysis(imageDataUrl);
  if (!pixels) return annotation.box;

  const claimedRects = otherPageAnnotations
    .filter((a) => a.id !== annotation.id)
    .map((a) => a.box);

  const isSmallDiagramOrShortBox =
    annotation.subjectType === "short_blank" ||
    (annotation.box.width <= 30 && annotation.box.height <= 6.8);

  if (isSmallDiagramOrShortBox) {
    return snapSmallCalloutBoxToBorderedCavity(
      annotation.box,
      pixels,
      claimedRects
    );
  }

  let nextBox = stripPrintedQuestionFromTopOfBox(annotation.box, pixels);
  nextBox = stripPrintedPrefixFromLeftOfInlineBox(nextBox, pixels);
  return nextBox;
}

/**
 * Detects a bordered box or whitespace cavity around a tap point `(xPercent, yPercent)` on the page.
 * Used when the user taps on the page in "Añadir Caja" mode on iPad.
 */
export async function detectBlankBoxAtPoint(
  imageDataUrl: string,
  xPercent: number,
  yPercent: number
): Promise<NormalizedBox> {
  const defaultBox: NormalizedBox = {
    x: Number(Math.max(1, Math.min(82, xPercent - 8)).toFixed(2)),
    y: Number(Math.max(1, Math.min(93, yPercent - 1.8)).toFixed(2)),
    width: 22,
    height: 3.8,
  };

  const pixels = await loadPagePixelsForAnalysis(imageDataUrl);
  if (!pixels) return defaultBox;

  const probeSeedBox: NormalizedBox = {
    x: Math.max(1, xPercent - 7),
    y: Math.max(1, yPercent - 1.6),
    width: 16,
    height: 3.2,
  };

  const snapped = snapSmallCalloutBoxToBorderedCavity(
    probeSeedBox,
    pixels,
    []
  );
  return snapped;
}

/**
 * Main entry point: refines all in-place worksheet annotations on a page using actual image pixel analysis
 * so that:
 * 1. Small diagram label boxes snap cleanly to their dark-bordered rectangular interior (and skip printed numbers like "4.").
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

  const claimedRects: NormalizedBox[] = [];

  const refined = annotations.map((ann) => {
    if (ann.isNotebookEntry) return ann;

    let nextBox = { ...ann.box };

    const isSmallDiagramOrShortBox =
      ann.subjectType === "short_blank" ||
      (nextBox.width <= 30 && nextBox.height <= 6.8);

    if (isSmallDiagramOrShortBox) {
      nextBox = snapSmallCalloutBoxToBorderedCavity(
        nextBox,
        pixels,
        claimedRects
      );
    } else {
      nextBox = stripPrintedQuestionFromTopOfBox(nextBox, pixels);
      nextBox = stripPrintedPrefixFromLeftOfInlineBox(nextBox, pixels);
    }

    return {
      ...ann,
      box: nextBox,
    };
  });

  return resolveAnnotationCollisions(refined);
}
