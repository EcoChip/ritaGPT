import { HandwritingFontOption } from "../types";

const STORAGE_KEY = "ritagpt_custom_fonts_v3";

// Cache of preloaded HTMLImageElement arrays for hand-drawn glyph variants
const glyphVariantImageCache: Record<string, Record<string, HTMLImageElement[]>> = {};

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < BASE64_CHARS.length; i++) {
  BASE64_LOOKUP[BASE64_CHARS.charCodeAt(i)] = i;
}

/**
 * Pure JavaScript base64 / Data URL to ArrayBuffer decoder.
 * Never calls browser `atob()` or `fetch(dataUrl)`, eliminating WebKit/Safari's
 * `DOMException: The string did not match the expected pattern` completely.
 */
export function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  if (!dataUrl || typeof dataUrl !== "string") {
    return new ArrayBuffer(0);
  }
  const commaIdx = dataUrl.indexOf(",");
  const rawBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;

  // Normalize URL-safe base64 (- and _) and strip non-base64 chars
  const clean = rawBase64
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/[^A-Za-z0-9+/=]/g, "");

  if (clean.length === 0) {
    return new ArrayBuffer(0);
  }

  let padding = 0;
  if (clean.endsWith("==")) padding = 2;
  else if (clean.endsWith("=")) padding = 1;

  const byteLength = Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
  const bytes = new Uint8Array(byteLength);

  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const encoded1 = BASE64_LOOKUP[clean.charCodeAt(i)] || 0;
    const encoded2 = BASE64_LOOKUP[clean.charCodeAt(i + 1)] || 0;
    const encoded3 = BASE64_LOOKUP[clean.charCodeAt(i + 2)] || 0;
    const encoded4 = BASE64_LOOKUP[clean.charCodeAt(i + 3)] || 0;

    if (p < byteLength) bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (p < byteLength) bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    if (p < byteLength) bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
  }

  return bytes.buffer;
}

export function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  return new Uint8Array(dataUrlToArrayBuffer(dataUrl));
}

export function getCachedGlyphVariantImage(
  fontId: string,
  char: string,
  occurrenceSeed: number = 0
): HTMLImageElement | null {
  const fontCache = glyphVariantImageCache[fontId];
  if (!fontCache) return null;
  const list =
    fontCache[char] ||
    fontCache[char.toLowerCase()] ||
    fontCache[char.toUpperCase()];
  if (!list || list.length === 0) return null;
  const idx = Math.abs(occurrenceSeed) % list.length;
  return list[idx] || list[0];
}

async function registerSingleFontDataUrl(
  familyName: string,
  dataUrl: string
): Promise<void> {
  // Ensure family name is strictly alphabetic so Safari's CSS FontFace parser never rejects it
  const stripped = familyName.replace(/[^A-Za-z]/g, "");
  const cleanFamily = stripped.startsWith("RitaFont")
    ? stripped
    : `RitaFont${stripped || "Custom"}`;
  if (!cleanFamily || typeof FontFace === "undefined") return;
  try {
    const buffer = dataUrlToArrayBuffer(dataUrl);
    if (buffer.byteLength < 64) return;
    const fontFace = new FontFace(cleanFamily, buffer);
    const loadedFace = await fontFace.load();
    document.fonts.add(loadedFace);
  } catch (err) {
    console.warn(`No se pudo registrar FontFace (${cleanFamily}):`, err);
  }
}

export async function preloadFontResources(
  font: HandwritingFontOption
): Promise<void> {
  // 1. Single uploaded font file (.ttf, .otf, .woff, .woff2)
  if (font.isCustom && font.fontDataUrl) {
    const familyClean = font.cssFamily
      .split(",")[0]
      .replace(/['"]/g, "")
      .trim();
    await registerSingleFontDataUrl(familyClean, font.fontDataUrl);
  }

  // 2. Multiple fused uploaded font files
  if (font.isCustom && Array.isArray(font.fusedFontDataUrls)) {
    for (const item of font.fusedFontDataUrls) {
      await registerSingleFontDataUrl(item.familyName, item.dataUrl);
    }
  }

  // 3. Preload hand-drawn glyph variants (supports both glyphVariantsMap and legacy glyphMap)
  const combinedVariants: Record<string, string[]> = {};
  if (font.glyphMap) {
    for (const [ch, url] of Object.entries(font.glyphMap)) {
      if (url) combinedVariants[ch] = [url];
    }
  }
  if (font.glyphVariantsMap) {
    for (const [ch, urls] of Object.entries(font.glyphVariantsMap)) {
      if (Array.isArray(urls) && urls.length > 0) {
        combinedVariants[ch] = urls;
      }
    }
  }

  if (Object.keys(combinedVariants).length > 0) {
    if (!glyphVariantImageCache[font.id]) {
      glyphVariantImageCache[font.id] = {};
    }
    for (const [char, urlList] of Object.entries(combinedVariants)) {
      const loadedImgs: HTMLImageElement[] = [];
      for (const dataUrl of urlList) {
        if (!dataUrl || !dataUrl.startsWith("data:image/")) continue;
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            loadedImgs.push(img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = dataUrl;
        });
      }
      if (loadedImgs.length > 0) {
        glyphVariantImageCache[font.id][char] = loadedImgs;
      }
    }
  }
}

export async function loadSavedCustomFonts(): Promise<HandwritingFontOption[]> {
  try {
    // Clean up legacy storage keys that might hold malformed font family names
    localStorage.removeItem("ritagpt_custom_fonts_v1");
    localStorage.removeItem("ritagpt_custom_fonts_v2");

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: HandwritingFontOption[] = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    await Promise.all(parsed.map((f) => preloadFontResources(f)));
    return parsed;
  } catch (err) {
    console.warn("Error leyendo fuentes guardadas:", err);
    return [];
  }
}

export function saveCustomFontsToStorage(fonts: HandwritingFontOption[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fonts));
  } catch (err) {
    console.warn("No se pudo guardar en localStorage:", err);
  }
}
