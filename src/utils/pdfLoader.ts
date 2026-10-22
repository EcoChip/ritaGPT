import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import { PdfPageData } from "../types";

// Ensure Map.prototype.getOrInsertComputed is defined in the current JS realm
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
    mapProto.getOrInsertComputed = function (key: any, callbackFn: (k: any) => any) {
      if (!this.has(key)) {
        this.set(key, callbackFn(key));
      }
      return this.get(key);
    };
  }
}

// Configure PDF.js legacy worker (includes core-js polyfills for Safari/older browsers)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

/**
 * Renders every page of a PDF ArrayBuffer into high-resolution data URLs
 * and captures each page's point dimensions (widthPt, heightPt).
 */
export async function renderPdfToPageImages(
  pdfBytes: Uint8Array | ArrayBuffer,
  renderScale: number = 2.0
): Promise<PdfPageData[]> {
  const dataCopy =
    pdfBytes instanceof Uint8Array
      ? new Uint8Array(pdfBytes)
      : new Uint8Array(pdfBytes.slice(0));

  const loadingTask = pdfjsLib.getDocument({ data: dataCopy });
  const pdfDocument = await loadingTask.promise;
  const numPages = pdfDocument.numPages;

  const pages: PdfPageData[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDocument.getPage(pageNum);
    const viewport1x = page.getViewport({ scale: 1.0 });
    const viewportHiRes = page.getViewport({ scale: renderScale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewportHiRes.width);
    canvas.height = Math.floor(viewportHiRes.height);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("No se pudo inicializar el contexto 2D para renderizar el PDF.");
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
      imageDataUrl: canvas.toDataURL("image/jpeg", 0.92),
      widthPt: viewport1x.width,
      heightPt: viewport1x.height,
      status: "idle",
    });
  }

  return pages;
}

/**
 * Converts one or more uploaded images or camera photos into a valid PDF document
 * so they can be analyzed, annotated, previewed, and exported identically to native PDFs.
 */
export async function convertImageFilesToPdfBytes(files: File[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  for (const file of files) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Error leyendo la imagen."));
      reader.readAsDataURL(file);
    });

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const imageEl = new Image();
      imageEl.onload = () => resolve(imageEl);
      imageEl.onerror = () => reject(new Error("No se pudo decodificar la imagen."));
      imageEl.src = dataUrl;
    });

    // Normalize image onto a high-res canvas (max 1600px on longest side) and encode as JPEG
    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const targetW = Math.max(100, Math.round(img.width * scale));
    const targetH = Math.max(100, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo crear el lienzo para procesar la foto.");

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const embeddedJpg = await pdfDoc.embedJpg(jpegDataUrl);

    // Fit nicely into an A4-scaled page preserving aspect ratio
    const basePageWidth = 595.28;
    const aspect = targetH / targetW;
    const pageHeight = Math.max(420, Math.min(1050, basePageWidth * aspect));

    const page = pdfDoc.addPage([basePageWidth, pageHeight]);
    page.drawImage(embeddedJpg, {
      x: 0,
      y: 0,
      width: basePageWidth,
      height: pageHeight,
    });
  }

  return await pdfDoc.save();
}
