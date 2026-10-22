import { HandwritingFontOption } from "../types";

const STORAGE_KEY = "ritagpt_custom_fonts_v1";

// Cache of preloaded HTMLImageElement for hand-drawn glyphs so canvas rendering is synchronous
const glyphImageCache: Record<string, Record<string, HTMLImageElement>> = {};

export function getCachedGlyphImage(
  fontId: string,
  char: string
): HTMLImageElement | null {
  return glyphImageCache[fontId]?.[char] || null;
}

export async function preloadFontResources(font: HandwritingFontOption): Promise<void> {
  // 1. If it's an uploaded font file (.ttf, .otf, .woff, .woff2), register with FontFace API
  if (font.isCustom && font.customType === "uploaded_file" && font.fontDataUrl) {
    const familyClean = font.cssFamily.replace(/['"]/g, "").split(",")[0].trim();
    try {
      const fontFace = new FontFace(familyClean, `url(${font.fontDataUrl})`);
      const loadedFace = await fontFace.load();
      document.fonts.add(loadedFace);
    } catch (err) {
      console.warn("No se pudo registrar FontFace personalizado:", err);
    }
  }

  // 2. If it has hand-drawn glyphs, preload HTMLImageElements into cache
  if (font.isCustom && font.glyphMap) {
    if (!glyphImageCache[font.id]) {
      glyphImageCache[font.id] = {};
    }
    const entries = Object.entries(font.glyphMap);
    await Promise.all(
      entries.map(
        ([char, dataUrl]) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              glyphImageCache[font.id][char] = img;
              resolve();
            };
            img.onerror = () => resolve();
            img.src = dataUrl;
          })
      )
    );
  }
}

export async function loadSavedCustomFonts(): Promise<HandwritingFontOption[]> {
  try {
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
    console.warn("No se pudo guardar en localStorage (posible límite de espacio):", err);
  }
}
