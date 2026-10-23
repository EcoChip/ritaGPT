import React, { useState, useRef, useEffect } from "react";
import { HANDWRITING_FONTS, HandwritingFontOption } from "../types";
import { preloadFontResources } from "../utils/customFontManager";
import {
  X,
  Upload,
  PenTool,
  Check,
  Eraser,
  Trash2,
  Sparkles,
  Layers,
} from "lucide-react";

interface CustomFontStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  customFonts: HandwritingFontOption[];
  onSaveFont: (newFont: HandwritingFontOption) => void;
  onDeleteFont: (fontId: string) => void;
}

const SAMPLE_CHARS = [
  "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
  "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "-", "=",
];

export const CustomFontStudioModal: React.FC<CustomFontStudioModalProps> = ({
  isOpen,
  onClose,
  customFonts,
  onSaveFont,
  onDeleteFont,
}) => {
  const [tab, setTab] = useState<"fuse" | "create" | "saved">("fuse");

  // Drawn glyphs with up to 3 variants per character (e.g. a1, a2, a3)
  const [fontName, setFontName] = useState<string>("Mi Letra Multi-Variante");
  const [baseTemplateId, setBaseTemplateId] = useState<string>("caveat");
  const [slantDeg, setSlantDeg] = useState<number>(2);
  const [letterSpacing, setLetterSpacing] = useState<number>(0.5);
  const [strokeWidth, setStrokeWidth] = useState<number>(4);
  const [activeChar, setActiveChar] = useState<string>("a");
  const [activeVariantIdx, setActiveVariantIdx] = useState<number>(0); // 0, 1, or 2
  const [glyphVariantsMap, setGlyphVariantsMap] = useState<Record<string, string[]>>({});
  const [isDrawing, setIsDrawing] = useState<boolean>(false);

  // Multi-Font Upload & Fusion state
  const [uploadedFontItems, setUploadedFontItems] = useState<
    { familyName: string; dataUrl: string; fileName: string }[]
  >([]);
  const [selectedExistingFontIds, setSelectedExistingFontIds] = useState<string[]>([
    "caveat",
    "kalam",
  ]);
  const [fusionName, setFusionName] = useState<string>("Mi Fusión Anti-Clon");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fontFileInputRef = useRef<HTMLInputElement>(null);

  const allAvailableToFuse = [
    ...customFonts,
    ...HANDWRITING_FONTS.filter((f) => f.customType !== "fused_fonts"),
  ];

  useEffect(() => {
    if (!isOpen) return;
    clearCanvasOnly();
  }, [activeChar, activeVariantIdx, isOpen]);

  if (!isOpen) return null;

  const clearCanvasOnly = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleClearActiveGlyphVariant = () => {
    clearCanvasOnly();
    setGlyphVariantsMap((prev) => {
      const existing = [...(prev[activeChar] || [])];
      existing.splice(activeVariantIdx, 1);
      const copy = { ...prev };
      if (existing.length === 0) {
        delete copy[activeChar];
      } else {
        copy[activeChar] = existing;
      }
      return copy;
    });
  };

  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDrawing(true);

    ctx.strokeStyle = "#183B8C";
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const moveDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const endDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    setGlyphVariantsMap((prev) => {
      const list = [...(prev[activeChar] || [])];
      list[activeVariantIdx] = dataUrl;
      return {
        ...prev,
        [activeChar]: list.filter(Boolean),
      };
    });
  };

  const handleSaveCreatedFont = async () => {
    const baseFont =
      HANDWRITING_FONTS.find((f) => f.id === baseTemplateId) ||
      HANDWRITING_FONTS[1];
    const totalVariants = Object.values(glyphVariantsMap).reduce(
      (acc: number, arr: string[]) => acc + arr.length,
      0
    );
    const newFont: HandwritingFontOption = {
      id: `custom-drawn-${Date.now()}`,
      name: fontName.trim() || "Mi Letra Multi-Variante",
      cssFamily: baseFont.cssFamily,
      fusedCssFamilies: [
        baseFont.cssFamily,
        "'Caveat', cursive",
        "'Kalam', cursive",
      ],
      description: `Creada a mano (${totalVariants} variantes dibujadas · anti-clon activo)`,
      baseWeight: baseFont.baseWeight,
      lineHeightMultiplier: baseFont.lineHeightMultiplier,
      isCustom: true,
      customType: "drawn_glyphs",
      glyphVariantsMap: { ...glyphVariantsMap },
      customSlantDeg: slantDeg,
      customLetterSpacing: letterSpacing,
    };

    await preloadFontResources(newFont);
    onSaveFont(newFont);
    setStatusMsg("¡Tu fuente con variantes de letra se ha guardado y activado!");
    setTimeout(() => {
      setStatusMsg(null);
      onClose();
    }, 700);
  };

  /**
   * Allows uploading 1 or MULTIPLE font files (.ttf, .otf, .woff, .woff2) at once to fuse them!
   */
  const handleMultipleFontFilesChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files: File[] = Array.from(fileList);
    e.target.value = "";

    const loadedItems: { familyName: string; dataUrl: string; fileName: string }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const randomSuffix = Array.from({ length: 6 })
        .map(() => letters[Math.floor(Math.random() * letters.length)])
        .join("");
      const idxChar = letters[i % letters.length];
      const safeFamily = `RitaFontCustom${idxChar}${randomSuffix}`;
      loadedItems.push({
        familyName: safeFamily,
        dataUrl,
        fileName: file.name,
      });
    }

    setUploadedFontItems((prev) => [...prev, ...loadedItems]);
    if (files.length === 1 && fusionName === "Mi Fusión Anti-Clon") {
      setFusionName(files[0].name.replace(/\.(ttf|otf|woff2?)$/i, ""));
    } else if (files.length > 1) {
      setFusionName(`Fusión de ${files.length} Fuentes Propias`);
    }
  };

  const toggleExistingFontSelection = (id: string) => {
    setSelectedExistingFontIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSaveFusedOrUploadedFont = async () => {
    const uploadedFamilies = uploadedFontItems.map(
      (item) => `'${item.familyName}', cursive`
    );
    const chosenExistingFamilies = selectedExistingFontIds
      .map((id) => allAvailableToFuse.find((f) => f.id === id)?.cssFamily)
      .filter(Boolean) as string[];

    // If user uploaded font files, prioritize their uploaded files; if they only uploaded 1 and also checked existing ones or want fusion, combine them
    const combinedFamilies =
      uploadedFamilies.length > 0
        ? uploadedFamilies.length > 1
          ? uploadedFamilies
          : [...uploadedFamilies, ...chosenExistingFamilies.slice(0, 2)]
        : chosenExistingFamilies;

    if (combinedFamilies.length === 0) return;

    const primaryFamily = combinedFamilies[0];
    const isMulti = combinedFamilies.length > 1;

    const newFont: HandwritingFontOption = {
      id: `custom-fused-${Date.now()}`,
      name:
        fusionName.trim() ||
        (uploadedFontItems.length > 0
          ? uploadedFontItems.map((u) => u.fileName).join(" + ")
          : "Fuente Fusionada"),
      cssFamily: primaryFamily,
      fusedCssFamilies: combinedFamilies,
      fusedFontDataUrls:
        uploadedFontItems.length > 0 ? [...uploadedFontItems] : undefined,
      fontDataUrl:
        uploadedFontItems.length === 1 ? uploadedFontItems[0].dataUrl : undefined,
      description: isMulti
        ? `Fusión de ${combinedFamilies.length} fuentes (alterna cada letra 'a', 'e', 'o' automáticamente)`
        : `Archivo de fuente propio (${uploadedFontItems[0]?.fileName || "Personalizada"})`,
      baseWeight: 400,
      lineHeightMultiplier: 1.14,
      isCustom: true,
      customType: isMulti ? "fused_fonts" : "uploaded_file",
    };

    await preloadFontResources(newFont);
    onSaveFont(newFont);
    setStatusMsg(
      isMulti
        ? `¡Fusión de ${combinedFamilies.length} fuentes creada! Ninguna letra repetida será igual.`
        : "¡Tu fuente se ha instalado y guardado en el navegador!"
    );
    setTimeout(() => {
      setStatusMsg(null);
      onClose();
    }, 750);
  };

  const currentCharVariants = glyphVariantsMap[activeChar] || [];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Estudio y Fusión de Fuentes — ritaGPT
            </h2>
            <p className="text-xs text-slate-500">
              Sube y fusiona varias fuentes (.TTF/.OTF) o dibuja múltiples variantes de cada letra para que dos "a" nunca sean idénticas.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 pt-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTab("fuse")}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
              tab === "fuse"
                ? "border-blue-700 text-blue-700 bg-white"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Subir y Fusionar Fuentes (.TTF / .OTF)</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("create")}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
              tab === "create"
                ? "border-blue-700 text-blue-700 bg-white"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <PenTool className="w-3.5 h-3.5" />
            <span>Dibujar Variantes de Mi Letra (a₁, a₂, a₃)</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("saved")}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
              tab === "saved"
                ? "border-blue-700 text-blue-700 bg-white"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>Mis Fuentes Guardadas ({customFonts.length})</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {statusMsg && (
            <div className="mb-4 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-medium text-emerald-800 flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>{statusMsg}</span>
            </div>
          )}

          {tab === "fuse" && (
            <div className="space-y-5">
              <input
                ref={fontFileInputRef}
                type="file"
                multiple
                accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
                onChange={handleMultipleFontFilesChange}
                className="hidden"
              />

              {/* Multi-file dropzone */}
              <div
                onClick={() => fontFileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-blue-600 rounded-xl p-6 text-center cursor-pointer transition-colors bg-slate-50/70"
              >
                <Upload className="w-7 h-7 text-blue-700 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-900">
                  Sube 1 o varios archivos de fuente (.TTF, .OTF, .WOFF) a la vez
                </p>
                <p className="text-xs text-slate-500 mt-1 max-w-xl mx-auto">
                  Si subes 2 o más archivos (por ejemplo, dos plantillas hechas en Calligraphr o iFontMaker), ritaGPT las fusionará automáticamente alternando las letras repetidas para que ninguna "a" sea igual a la anterior.
                </p>

                {uploadedFontItems.length > 0 && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="mt-4 flex flex-wrap items-center justify-center gap-2"
                  >
                    {uploadedFontItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="px-3 py-1 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-900 flex items-center gap-2"
                      >
                        <span className="font-mono-tabular font-medium">
                          {item.fileName}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setUploadedFontItems((prev) =>
                              prev.filter((_, i) => i !== idx)
                            )
                          }
                          className="text-blue-500 hover:text-red-600"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Combine with existing / uploaded fonts */}
              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-2">
                  O selecciona qué fuentes quieres mezclar/fusionar con tus archivos:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {allAvailableToFuse.map((f) => {
                    const isChecked = selectedExistingFontIds.includes(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => toggleExistingFontSelection(f.id)}
                        className={`px-3 py-2 rounded-lg border text-left flex items-center justify-between transition-colors cursor-pointer ${
                          isChecked
                            ? "border-blue-600 bg-blue-50/40"
                            : "border-slate-200 hover:border-slate-300 bg-white"
                        }`}
                      >
                        <div>
                          <div className="text-xs font-semibold text-slate-900">
                            {f.name}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {isChecked ? "Incluida en la fusión" : "Clic para incluir"}
                          </div>
                        </div>
                        <span
                          style={{ fontFamily: f.cssFamily, color: "#183B8C" }}
                          className="text-lg"
                        >
                          La dama boba
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live preview of fused character alternation */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                  <span>
                    Vista previa Anti-Clon (observa cómo cada "a" en "La dama boba" alterna su trazo):
                  </span>
                </div>
                <div className="text-2xl text-[#183B8C] tracking-normal">
                  {"La dama boba — Lope de Vega (Acto I)".split("").map((ch, idx) => {
                    const families =
                      selectedExistingFontIds.length > 0
                        ? selectedExistingFontIds.map(
                            (id) =>
                              allAvailableToFuse.find((f) => f.id === id)
                                ?.cssFamily || "'Caveat', cursive"
                          )
                        : ["'Caveat', cursive", "'Kalam', cursive"];
                    const fam = families[idx % families.length];
                    const rot = ((idx * 17) % 5) - 2;
                    return (
                      <span
                        key={idx}
                        style={{
                          fontFamily: fam,
                          display: ch === " " ? "inline" : "inline-block",
                          transform:
                            ch === " " ? undefined : `rotate(${rot * 0.7}deg)`,
                        }}
                      >
                        {ch}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Nombre de la fuente o fusión:
                  </label>
                  <input
                    type="text"
                    value={fusionName}
                    onChange={(e) => setFusionName(e.target.value)}
                    placeholder="Ej: Mi Fusión de 3 Letras"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-900"
                  />
                </div>
                <button
                  type="button"
                  disabled={
                    uploadedFontItems.length === 0 &&
                    selectedExistingFontIds.length === 0
                  }
                  onClick={handleSaveFusedOrUploadedFont}
                  className="px-5 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                >
                  <Layers className="w-4 h-4" />
                  <span>Guardar y Activar Fusión en ritaGPT</span>
                </button>
              </div>
            </div>
          )}

          {tab === "create" && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              {/* Left Column: Drawing Pad & Character + Variant Picker */}
              <div className="md:col-span-7 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                    1. Elige una letra y dibuja hasta 3 variantes distintas (ej. a₁, a₂, a₃):
                  </label>
                  <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto p-2 bg-slate-50 border border-slate-200 rounded-lg">
                    {SAMPLE_CHARS.map((ch) => {
                      const count = glyphVariantsMap[ch]?.length || 0;
                      const isCurrent = activeChar === ch;
                      return (
                        <button
                          key={ch}
                          type="button"
                          onClick={() => {
                            setActiveChar(ch);
                            setActiveVariantIdx(0);
                          }}
                          className={`w-8 h-7 rounded text-xs font-mono-tabular font-semibold transition-colors cursor-pointer flex items-center justify-center gap-0.5 ${
                            isCurrent
                              ? "bg-blue-700 text-white"
                              : count > 0
                              ? "bg-emerald-100 text-emerald-900 border border-emerald-300"
                              : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          <span>{ch}</span>
                          {count > 0 && (
                            <span className="text-[9px] opacity-80">×{count}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Variant 1 / 2 / 3 Selector */}
                <div className="flex items-center justify-between bg-slate-100 p-1.5 rounded-lg">
                  {[0, 1, 2].map((vIdx) => {
                    const hasThisVariant = Boolean(currentCharVariants[vIdx]);
                    return (
                      <button
                        key={vIdx}
                        type="button"
                        onClick={() => setActiveVariantIdx(vIdx)}
                        className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                          activeVariantIdx === vIdx
                            ? "bg-white text-slate-900 shadow-2xs"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        <span>
                          Variante {vIdx + 1} de "{activeChar}"
                        </span>
                        {hasThisVariant && (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Canvas Pad */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col items-center">
                  <div className="w-full flex items-center justify-between mb-2 text-xs text-slate-600">
                    <span>
                      Dibujando{" "}
                      <strong className="font-mono-tabular text-slate-900">
                        "{activeChar}" (Variante {activeVariantIdx + 1})
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={handleClearActiveGlyphVariant}
                      className="inline-flex items-center gap-1 text-slate-500 hover:text-red-600 cursor-pointer"
                    >
                      <Eraser className="w-3.5 h-3.5" />
                      <span>Borrar variante</span>
                    </button>
                  </div>

                  <div className="relative bg-white border-2 border-dashed border-slate-300 rounded-xl overflow-hidden shadow-2xs">
                    <div className="absolute inset-x-0 top-2/3 border-b border-blue-200 pointer-events-none" />
                    <span className="absolute inset-0 flex items-center justify-center text-7xl text-slate-100 font-display pointer-events-none select-none">
                      {activeChar}
                    </span>
                    <canvas
                      ref={canvasRef}
                      width={200}
                      height={160}
                      onPointerDown={startDrawing}
                      onPointerMove={moveDrawing}
                      onPointerUp={endDrawing}
                      className="relative z-10 touch-none cursor-crosshair"
                    />
                  </div>
                </div>
              </div>

              {/* Right Column: Calibration & Save */}
              <div className="md:col-span-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Nombre de tu fuente:
                  </label>
                  <input
                    type="text"
                    value={fontName}
                    onChange={(e) => setFontName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Plantilla base para letras no dibujadas:
                  </label>
                  <select
                    value={baseTemplateId}
                    onChange={(e) => setBaseTemplateId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-900 bg-white"
                  >
                    {HANDWRITING_FONTS.filter(
                      (f) => f.customType !== "fused_fonts"
                    ).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-slate-700">
                      Inclinación personal:
                    </span>
                    <span className="font-mono-tabular text-slate-900">
                      {slantDeg}°
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-12}
                    max={16}
                    step={1}
                    value={slantDeg}
                    onChange={(e) => setSlantDeg(Number(e.target.value))}
                    className="w-full accent-blue-700"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-slate-700">
                      Grosor de trazo al dibujar:
                    </span>
                    <span className="font-mono-tabular text-slate-900">
                      {strokeWidth}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={8}
                    step={1}
                    value={strokeWidth}
                    onChange={(e) => setStrokeWidth(Number(e.target.value))}
                    className="w-full accent-blue-700"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSaveCreatedFont}
                  className="w-full py-2.5 px-4 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Guardar mi Letra con Variantes</span>
                </button>
              </div>
            </div>
          )}

          {tab === "saved" && (
            <div className="space-y-3">
              {customFonts.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500">
                  Aún no has guardado fuentes personalizadas. Usa la pestaña "Subir y Fusionar Fuentes" o "Dibujar Variantes".
                </div>
              ) : (
                customFonts.map((f) => (
                  <div
                    key={f.id}
                    className="p-3.5 border border-slate-200 rounded-xl flex items-center justify-between gap-4"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-900">
                        {f.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {f.description}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteFont(f.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                      title="Eliminar fuente guardada"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
