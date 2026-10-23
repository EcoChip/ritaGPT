// Ensure Map.prototype.getOrInsertComputed is defined BEFORE pdfjs-dist runs
if (typeof Map !== "undefined") {
  const mapProto = Map.prototype as any;
  if (!mapProto.getOrInsert) {
    mapProto.getOrInsert = function (key: any, defaultValue: any) {
      if (!this.has(key)) {
        this.set(key, defaultValue);
      }
      return this.get(key);
    };
  }
  if (!mapProto.getOrInsertComputed) {
    mapProto.getOrInsertComputed = function (
      key: any,
      callbackFn: (k: any) => any
    ) {
      if (!this.has(key)) {
        this.set(key, callbackFn(key));
      }
      return this.get(key);
    };
  }
}

import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
// @ts-ignore - worker module has no separate .d.ts file
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { PDFDocument } from "pdf-lib";
import { PdfPageData } from "../types";
import { dataUrlToUint8Array } from "./customFontManager";

// Register WorkerMessageHandler on globalThis so PDF.js runs in the main-thread realm
// (where Map.prototype.getOrInsertComputed is polyfilled) without spawning a module Worker
// or failing Safari URL pattern checks.
if (typeof globalThis !== "undefined") {
  (globalThis as any).pdfjsWorker = pdfjsWorker;
}

/**
 * Checks whether a byte buffer has the %PDF- magic header within the first 1024 bytes.
 */
export function isPdfByteSignature(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - 4, 1024);
  for (let i = 0; i <= limit; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 // F
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Helper to embed image bytes into a pdf-lib PDFDocument by inspecting magic header bytes
 * (0x89 0x50 = PNG, 0xFF 0xD8 = JPEG) so it never mismatches format.
 */
export async function embedImageBytesSafe(
  pdfDoc: PDFDocument,
  bytes: Uint8Array
) {
  const isPng =
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  if (isPng) {
    return await pdfDoc.embedPng(bytes);
  }
  return await pdfDoc.embedJpg(bytes);
}

/**
 * Renders every page of a PDF ArrayBuffer into high-resolution data URLs
 * and captures each page's point dimensions (widthPt, heightPt).
 */
export async function renderPdfToPageImages(
  pdfBytes: Uint8Array | ArrayBuffer,
  renderScale: number = 1.75
): Promise<PdfPageData[]> {
  const dataCopy =
    pdfBytes instanceof Uint8Array
      ? new Uint8Array(pdfBytes)
      : new Uint8Array(pdfBytes.slice(0));

  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";

  const loadingTask = pdfjsLib.getDocument({
    data: dataCopy,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    useWasm: false,
    verbosity: 0,
    standardFontDataUrl: origin
      ? `${origin}/pdfjs-standard-fonts/`
      : undefined,
    cMapUrl: origin ? `${origin}/pdfjs-cmaps/` : undefined,
    cMapPacked: true,
    wasmUrl: origin ? `${origin}/pdfjs-wasm/` : undefined,
    iccUrl: origin ? `${origin}/pdfjs-iccs/` : undefined,
  } as any);

  const pdfDocument = await loadingTask.promise;
  const numPages = pdfDocument.numPages;

  const pages: PdfPageData[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDocument.getPage(pageNum);
    const viewport1x = page.getViewport({ scale: 1.0 });
    const viewportHiRes = page.getViewport({ scale: renderScale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(100, Math.floor(viewportHiRes.width));
    canvas.height = Math.max(100, Math.floor(viewportHiRes.height));

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error(
        "No se pudo inicializar el contexto 2D para renderizar el PDF."
      );
    }

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport: viewportHiRes,
      canvas,
    }).promise;

    pages.push({
      pageNumber: pageNum,
      imageDataUrl: canvas.toDataURL("image/jpeg", 0.86),
      widthPt: viewport1x.width,
      heightPt: viewport1x.height,
      status: "idle",
    });
  }

  return pages;
}

/**
 * Loads an image File or URL string into an HTMLImageElement safely across Safari/iOS/Chrome.
 */
async function loadSourceImageElement(
  src: File | string
): Promise<HTMLImageElement> {
  if (typeof src === "string") {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const imageEl = new Image();
      imageEl.crossOrigin = "anonymous";
      imageEl.onload = () => resolve(imageEl);
      imageEl.onerror = () =>
        reject(new Error("No se pudo cargar la imagen seleccionada."));
      imageEl.src = src;
    });
  }

  // First try fast ObjectURL loading
  const objectUrl = URL.createObjectURL(src);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const imageEl = new Image();
      imageEl.onload = () => resolve(imageEl);
      imageEl.onerror = () => reject(new Error("ObjectURL decode error"));
      imageEl.src = objectUrl;
    });
    URL.revokeObjectURL(objectUrl);
    return img;
  } catch {
    URL.revokeObjectURL(objectUrl);
    // Fallback to FileReader DataURL with normalized MIME type
    const rawDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("FileReader error"));
      reader.readAsDataURL(src);
    });
    const commaIdx = rawDataUrl.indexOf(",");
    const b64Payload = commaIdx >= 0 ? rawDataUrl.slice(commaIdx + 1) : rawDataUrl;
    const normalizedDataUrl = `data:image/jpeg;base64,${b64Payload.replace(/\s+/g, "")}`;

    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const imageEl = new Image();
      imageEl.onload = () => resolve(imageEl);
      imageEl.onerror = () =>
        reject(
          new Error(
            "No se pudo decodificar la imagen. Usa un archivo JPG, PNG o PDF."
          )
        );
      imageEl.src = normalizedDataUrl;
    });
  }
}

/**
 * Directly converts one or more image files or URLs into both PdfPageData[] (instant preview without needing PDF.js)
 * and a valid PDF Uint8Array (for exporting later).
 */
export async function loadImagesDirectlyAsPagesAndPdf(
  sources: (File | string)[]
): Promise<{ pdfBytes: Uint8Array; pages: PdfPageData[] }> {
  const pdfDoc = await PDFDocument.create();
  const pages: PdfPageData[] = [];

  for (let idx = 0; idx < sources.length; idx++) {
    const src = sources[idx];
    const img = await loadSourceImageElement(src);

    // Normalize image onto a crisp canvas (max 1350px on longest side for fast AI vision upload)
    const naturalW = img.naturalWidth || img.width || 900;
    const naturalH = img.naturalHeight || img.height || 1200;
    const maxDim = 1350;
    const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
    const targetW = Math.max(200, Math.round(naturalW * scale));
    const targetH = Math.max(200, Math.round(naturalH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("No se pudo crear el lienzo para procesar la imagen.");
    }

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const basePageWidth = 595.28;
    const aspect = targetH / targetW;
    const pageHeight = Math.max(
      420,
      Math.min(980, Number((basePageWidth * aspect).toFixed(2)))
    );

    const page = pdfDoc.addPage([basePageWidth, pageHeight]);
    try {
      const imgBytes = dataUrlToUint8Array(jpegDataUrl);
      if (imgBytes.length > 32) {
        const embeddedImg = await embedImageBytesSafe(pdfDoc, imgBytes);
        page.drawImage(embeddedImg, {
          x: 0,
          y: 0,
          width: basePageWidth,
          height: pageHeight,
        });
      }
    } catch {
      // If embedding during preview is skipped, exportAnnotatedPdfBytes embeds from imageDataUrl on export
    }

    pages.push({
      pageNumber: idx + 1,
      imageDataUrl: jpegDataUrl,
      widthPt: basePageWidth,
      heightPt: pageHeight,
      status: "idle",
    });
  }

  let pdfBytes: Uint8Array = new Uint8Array(0);
  try {
    pdfBytes = await pdfDoc.save();
  } catch {
    pdfBytes = new Uint8Array(0);
  }
  return { pdfBytes, pages };
}
