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
  const [tab, setTab] = useState<"create" | "upload" | "saved">("create");
  const [fontName, setFontName] = useState<string>("Mi Letra Personal");
  const [baseTemplateId, setBaseTemplateId] = useState<string>("caveat");
  const [slantDeg, setSlantDeg] = useState<number>(2);
  const [letterSpacing, setLetterSpacing] = useState<number>(0.5);
  const [strokeWidth, setStrokeWidth] = useState<number>(4);

  // Drawn glyphs state
  const [activeChar, setActiveChar] = useState<string>("a");
  const [glyphMap, setGlyphMap] = useState<Record<string, string>>({});
  const [isDrawing, setIsDrawing] = useState<boolean>(false);

  // Upload font state
  const [uploadedFontDataUrl, setUploadedFontDataUrl] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>("");
  const [uploadName, setUploadName] = useState<string>("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fontFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    clearCanvasOnly();
  }, [activeChar, isOpen]);

  if (!isOpen) return null;

  const clearCanvasOnly = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleClearActiveGlyph = () => {
    clearCanvasOnly();
    setGlyphMap((prev) => {
      const copy = { ...prev };
      delete copy[activeChar];
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
    setGlyphMap((prev) => ({
      ...prev,
      [activeChar]: dataUrl,
    }));
  };

  const handleSaveCreatedFont = async () => {
    const baseFont =
      HANDWRITING_FONTS.find((f) => f.id === baseTemplateId) ||
      HANDWRITING_FONTS[0];
    const newFont: HandwritingFontOption = {
      id: `custom-drawn-${Date.now()}`,
      name: fontName.trim() || "Mi Letra ritaGPT",
      cssFamily: baseFont.cssFamily,
      description: `Creada en el estudio (${Object.keys(glyphMap).length} trazos propios · inclinación ${slantDeg}°)`,
      baseWeight: baseFont.baseWeight,
      lineHeightMultiplier: baseFont.lineHeightMultiplier,
      isCustom: true,
      customType: "drawn_glyphs",
      glyphMap: { ...glyphMap },
      customSlantDeg: slantDeg,
      customLetterSpacing: letterSpacing,
    };

    await preloadFontResources(newFont);
    onSaveFont(newFont);
    setStatusMsg("¡Tu fuente personalizada se ha guardado y activado!");
    setTimeout(() => {
      setStatusMsg(null);
      onClose();
    }, 700);
  };

  const handleFontFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFileName(file.name);
    const cleanTitle = file.name.replace(/\.(ttf|otf|woff2?|eot)$/i, "");
    if (!uploadName) setUploadName(cleanTitle);

    const reader = new FileReader();
    reader.onload = () => {
      setUploadedFontDataUrl(String(reader.result));
    };
    reader.readAsDataURL(file);
  };

  const handleSaveUploadedFont = async () => {
    if (!uploadedFontDataUrl) return;
    const uniqueFamily = `RitaCustomFont_${Date.now()}`;
    const newFont: HandwritingFontOption = {
      id: `custom-file-${Date.now()}`,
      name: uploadName.trim() || uploadedFileName || "Fuente Subida",
      cssFamily: `'${uniqueFamily}', 'Caveat', cursive`,
      description: `Archivo de fuente propio (${uploadedFileName})`,
      baseWeight: 400,
      lineHeightMultiplier: 1.14,
      isCustom: true,
      customType: "uploaded_file",
      fontDataUrl: uploadedFontDataUrl,
    };

    await preloadFontResources(newFont);
    onSaveFont(newFont);
    setStatusMsg("¡Archivo de fuente cargado y guardado en tu navegador!");
    setTimeout(() => {
      setStatusMsg(null);
      onClose();
    }, 700);
  };

  const baseFontPreview =
    HANDWRITING_FONTS.find((f) => f.id === baseTemplateId) || HANDWRITING_FONTS[0];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Estudio de Caligrafía Propia — ritaGPT
            </h2>
            <p className="text-xs text-slate-500">
              Dibuja tu propia letra o sube un archivo .TTF / .OTF / .WOFF. Se guarda automáticamente en tu navegador.
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
        <div className="px-6 pt-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
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
            <span>Crear y Dibujar mi Letra</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("upload")}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
              tab === "upload"
                ? "border-blue-700 text-blue-700 bg-white"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Subir Archivo Font (.TTF / .OTF)</span>
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

          {tab === "create" && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              {/* Left Column: Drawing Pad & Character Picker */}
              <div className="md:col-span-7 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                    1. Selecciona una letra o número y dibújalo con tu trazo (opcional, puedes dibujar los que quieras):
                  </label>
                  <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto p-2 bg-slate-50 border border-slate-200 rounded-lg">
                    {SAMPLE_CHARS.map((ch) => {
                      const hasDrawn = Boolean(glyphMap[ch]);
                      const isCurrent = activeChar === ch;
                      return (
                        <button
                          key={ch}
                          type="button"
                          onClick={() => setActiveChar(ch)}
                          className={`w-7 h-7 rounded text-xs font-mono-tabular font-semibold transition-colors cursor-pointer flex items-center justify-center ${
                            isCurrent
                              ? "bg-blue-700 text-white"
                              : hasDrawn
                              ? "bg-emerald-100 text-emerald-900 border border-emerald-300"
                              : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          {ch}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Canvas Pad */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col items-center">
                  <div className="w-full flex items-center justify-between mb-2 text-xs text-slate-600">
                    <span>
                      Dibujando carácter:{" "}
                      <strong className="font-mono-tabular text-slate-900 text-sm">
                        "{activeChar}"
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={handleClearActiveGlyph}
                      className="inline-flex items-center gap-1 text-slate-500 hover:text-red-600 cursor-pointer"
                    >
                      <Eraser className="w-3.5 h-3.5" />
                      <span>Borrar trazo</span>
                    </button>
                  </div>

                  <div className="relative bg-white border-2 border-dashed border-slate-300 rounded-xl overflow-hidden shadow-2xs">
                    {/* Guide baseline */}
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
                  <p className="text-[11px] text-slate-500 mt-2 text-center">
                    Usa el dedo, Apple Pencil o ratón. Los caracteres que no dibujes usarán automáticamente la plantilla base calibrada.
                  </p>
                </div>
              </div>

              {/* Right Column: Calibration & Live Preview */}
              <div className="md:col-span-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Nombre de tu fuente:
                  </label>
                  <input
                    type="text"
                    value={fontName}
                    onChange={(e) => setFontName(e.target.value)}
                    placeholder="Ej: Letra de Rita"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                    Plantilla base para caracteres restantes:
                  </label>
                  <select
                    value={baseTemplateId}
                    onChange={(e) => setBaseTemplateId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-900 bg-white"
                  >
                    {HANDWRITING_FONTS.map((f) => (
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
                      Separación entre letras:
                    </span>
                    <span className="font-mono-tabular text-slate-900">
                      {letterSpacing}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-1}
                    max={4}
                    step={0.5}
                    value={letterSpacing}
                    onChange={(e) => setLetterSpacing(Number(e.target.value))}
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

                {/* Live Preview Box */}
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-[11px] text-slate-500 mb-1.5">
                    Vista previa en vivo:
                  </div>
                  <div
                    style={{
                      fontFamily: baseFontPreview.cssFamily,
                      letterSpacing: `${letterSpacing}px`,
                      transform: `skewX(${-slantDeg}deg)`,
                      color: "#183B8C",
                    }}
                    className="text-2xl leading-snug"
                  >
                    {"3x + 6 = 18 -> x = 4".split("").map((ch, idx) =>
                      glyphMap[ch] ? (
                        <img
                          key={idx}
                          src={glyphMap[ch]}
                          alt={ch}
                          className="inline-block h-6 w-auto align-middle"
                        />
                      ) : (
                        <span key={idx}>{ch}</span>
                      )
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSaveCreatedFont}
                  className="w-full py-2.5 px-4 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Guardar mi Letra en ritaGPT</span>
                </button>
              </div>
            </div>
          )}

          {tab === "upload" && (
            <div className="max-w-lg mx-auto space-y-4 py-2">
              <input
                ref={fontFileInputRef}
                type="file"
                accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
                onChange={handleFontFileChange}
                className="hidden"
              />

              <div
                onClick={() => fontFileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-blue-600 rounded-xl p-8 text-center cursor-pointer transition-colors bg-slate-50/70"
              >
                <Upload className="w-8 h-8 text-blue-700 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-900">
                  Haz clic para subir tu archivo de fuente (.TTF, .OTF, .WOFF)
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  ¿Hiciste tu letra en Calligraphr, iFontMaker o descargaste una fuente manuscrita? Súbela aquí y quedará guardada en tu navegador.
                </p>
                {uploadedFileName && (
                  <p className="mt-3 text-xs font-mono-tabular text-emerald-700 font-semibold">
                    Archivo seleccionado: {uploadedFileName}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1">
                  Nombre para identificar tu fuente:
                </label>
                <input
                  type="text"
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder="Ej: Mi Caligrafía Real"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-900"
                />
              </div>

              <button
                type="button"
                disabled={!uploadedFontDataUrl}
                onClick={handleSaveUploadedFont}
                className="w-full py-2.5 px-4 bg-blue-700 hover:bg-blue-800 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Instalar y Guardar Fuente en la Web
              </button>
            </div>
          )}

          {tab === "saved" && (
            <div className="space-y-3">
              {customFonts.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500">
                  Aún no has guardado fuentes personalizadas. Crea una en la pestaña "Crear y Dibujar mi Letra" o sube un archivo `.ttf` / `.otf`.
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
