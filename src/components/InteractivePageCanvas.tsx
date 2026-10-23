import React, { useRef, useState } from "react";
import {
  AnswerAnnotation,
  HANDWRITING_FONTS,
  HandwritingFontOption,
  INK_COLORS,
  PdfPageData,
  StyleSettings,
} from "../types";
import {
  computeAutoFontSize,
  getAnnotationActiveText,
  pickCharacterCssFamily,
  resolveFontOption,
  seededRandom,
} from "../utils/handwritingRenderer";
import { Check, AlertTriangle, Scissors, Trash2 } from "lucide-react";

interface InteractivePageCanvasProps {
  page: PdfPageData;
  annotations: AnswerAnnotation[];
  selectedAnnotationId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  onUpdateAnnotation: (id: string, patch: Partial<AnswerAnnotation>) => void;
  onDeleteAnnotation: (id: string) => void;
  onAddAnnotationAtPoint: (pageNumber: number, xPercent: number, yPercent: number) => void;
  isAddingMode: boolean;
  styleSettings: StyleSettings;
  allFonts?: HandwritingFontOption[];
  zoom: number;
  showBoundingGuides: boolean;
}

export const InteractivePageCanvas: React.FC<InteractivePageCanvasProps> = ({
  page,
  annotations,
  selectedAnnotationId,
  onSelectAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onAddAnnotationAtPoint,
  isAddingMode,
  styleSettings,
  allFonts = HANDWRITING_FONTS,
  zoom,
  showBoundingGuides,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    id: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    initialBox: AnswerAnnotation["box"];
  } | null>(null);

  const fontMeta = resolveFontOption(styleSettings.fontId, allFonts);
  const inkMeta =
    INK_COLORS.find((i) => i.id === styleSettings.inkId) || INK_COLORS[0];

  const displayWidthPx = Math.round(page.widthPt * zoom);
  const displayHeightPx = Math.round(page.heightPt * zoom);

  const variationIntensity = styleSettings.organic.enabled
    ? styleSettings.organic.strokeVariationPercent / 100
    : 0;
  const antiCloneEnabled =
    styleSettings.organic.antiCloneLetterVariation ||
    fontMeta.customType === "fused_fonts" ||
    Boolean(fontMeta.fusedCssFamilies && fontMeta.fusedCssFamilies.length > 1);
  const customSlantDeg = fontMeta.customSlantDeg || 0;

  const handleContainerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.pageBg) {
      return;
    }

    if (isAddingMode && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const xPercent = Math.max(
        2,
        Math.min(82, ((e.clientX - rect.left) / rect.width) * 100)
      );
      const yPercent = Math.max(
        2,
        Math.min(92, ((e.clientY - rect.top) / rect.height) * 100)
      );
      onAddAnnotationAtPoint(page.pageNumber, xPercent, yPercent);
      return;
    }

    onSelectAnnotation(null);
  };

  const startDrag = (
    e: React.PointerEvent,
    ann: AnswerAnnotation,
    mode: "move" | "resize"
  ) => {
    e.stopPropagation();
    e.preventDefault();
    onSelectAnnotation(ann.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragState({
      id: ann.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      initialBox: { ...ann.box },
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const deltaXPercent = ((e.clientX - dragState.startX) / rect.width) * 100;
    const deltaYPercent = ((e.clientY - dragState.startY) / rect.height) * 100;

    if (dragState.mode === "move") {
      const nextX = Math.max(
        0,
        Math.min(100 - dragState.initialBox.width, dragState.initialBox.x + deltaXPercent)
      );
      const nextY = Math.max(
        0,
        Math.min(100 - dragState.initialBox.height, dragState.initialBox.y + deltaYPercent)
      );
      onUpdateAnnotation(dragState.id, {
        box: {
          ...dragState.initialBox,
          x: Number(nextX.toFixed(2)),
          y: Number(nextY.toFixed(2)),
        },
      });
    } else {
      const nextW = Math.max(
        6,
        Math.min(100 - dragState.initialBox.x, dragState.initialBox.width + deltaXPercent)
      );
      const nextH = Math.max(
        2.5,
        Math.min(100 - dragState.initialBox.y, dragState.initialBox.height + deltaYPercent)
      );
      onUpdateAnnotation(dragState.id, {
        box: {
          ...dragState.initialBox,
          width: Number(nextW.toFixed(2)),
          height: Number(nextH.toFixed(2)),
        },
      });
    }
  };

  const handlePointerUp = () => {
    if (dragState) {
      setDragState(null);
    }
  };

  /**
   * Renders a word character-by-character so that repeated letters (e.g. multiple 'a's)
   * alternate across fused fonts / drawn glyph variants and have subtle anti-clone variation.
   */
  const renderTokenWithFusedCharacters = (
    token: string,
    sizePx: number,
    seed: number,
    charCounts: Record<string, number>
  ) => {
    return token.split("").map((ch, cIdx) => {
      const lowerKey = ch.toLowerCase();
      const occ = (charCounts[lowerKey] = (charCounts[lowerKey] || 0) + 1);

      // 1. Check if custom drawn glyph variants exist for this character
      const variantsList =
        fontMeta.glyphVariantsMap?.[ch] ||
        fontMeta.glyphVariantsMap?.[lowerKey] ||
        fontMeta.glyphVariantsMap?.[ch.toUpperCase()] ||
        (fontMeta.glyphMap?.[ch] ? [fontMeta.glyphMap[ch]] : undefined) ||
        (fontMeta.glyphMap?.[lowerKey] ? [fontMeta.glyphMap[lowerKey]] : undefined);

      const scaleY = antiCloneEnabled
        ? 1 + (seededRandom(seed + occ * 19, cIdx + 1) - 0.5) * 0.13 * Math.max(0.4, variationIntensity)
        : 1;
      const scaleX = antiCloneEnabled
        ? 1 + (seededRandom(seed + occ * 23, cIdx + 2) - 0.5) * 0.1 * Math.max(0.4, variationIntensity)
        : 1;
      const yOff = antiCloneEnabled
        ? (seededRandom(seed + occ * 31, cIdx + 3) - 0.5) * 1.4
        : 0;
      const rotDeg = antiCloneEnabled
        ? (seededRandom(seed + occ * 37, cIdx + 4) - 0.5) * 3.2
        : 0;

      if (variantsList && variantsList.length > 0) {
        const chosenUrl = variantsList[Math.abs(seed + occ) % variantsList.length];
        return (
          <img
            key={cIdx}
            src={chosenUrl}
            alt={ch}
            referrerPolicy="no-referrer"
            style={{
              height: `${sizePx * 1.05}px`,
              width: "auto",
              display: "inline-block",
              verticalAlign: "middle",
              marginRight: `${fontMeta.customLetterSpacing || 0}px`,
              transform: `translateY(${yOff.toFixed(1)}px) rotate(${rotDeg.toFixed(1)}deg) scale(${scaleX.toFixed(2)}, ${scaleY.toFixed(2)})`,
            }}
          />
        );
      }

      const charFontFamily = pickCharacterCssFamily(
        fontMeta,
        ch,
        occ,
        seed,
        antiCloneEnabled
      );

      return (
        <span
          key={cIdx}
          style={{
            fontFamily: charFontFamily,
            display: "inline-block",
            transform: antiCloneEnabled
              ? `translateY(${yOff.toFixed(1)}px) rotate(${rotDeg.toFixed(1)}deg) scale(${scaleX.toFixed(2)}, ${scaleY.toFixed(2)})`
              : undefined,
          }}
        >
          {ch}
        </span>
      );
    });
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={handleContainerPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        width: `${displayWidthPx}px`,
        height: `${displayHeightPx}px`,
      }}
      className={`relative bg-white shadow-sm border border-slate-200 select-none overflow-hidden transition-shadow ${
        isAddingMode ? "cursor-crosshair ring-2 ring-blue-600/40" : ""
      }`}
    >
      {/* Original PDF or Generated Notebook Page Image */}
      <img
        src={page.imageDataUrl}
        alt={`Página ${page.pageNumber}`}
        data-page-bg="true"
        referrerPolicy="no-referrer"
        draggable={false}
        className="w-full h-full object-contain pointer-events-none select-none"
      />

      {/* Solving Overlay State */}
      {page.status === "solving" && (
        <div className="absolute inset-0 bg-white/75 backdrop-blur-[2px] flex flex-col items-center justify-center z-30">
          <div className="w-10 h-10 border-3 border-slate-200 border-t-blue-700 rounded-full animate-spin mb-3" />
          <p className="text-sm font-medium text-slate-900">
            ritaGPT analizando y resolviendo la página {page.pageNumber}...
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Detectando actividades y preparando escritura manuscrita
          </p>
        </div>
      )}

      {/* Handwritten Annotations Layer */}
      {annotations.map((ann) => {
        const isSelected = ann.id === selectedAnnotationId;
        const baseFontSizePt = computeAutoFontSize(
          ann,
          (ann.box.width / 100) * page.widthPt,
          (ann.box.height / 100) * page.heightPt,
          styleSettings,
          allFonts
        );
        const scaledFontSizePx = baseFontSizePt * zoom;
        const activeText = getAnnotationActiveText(ann);
        const words = activeText.split(/(\s+)/);
        const charCounts: Record<string, number> = {};

        const boxTiltDeg =
          (seededRandom(ann.seed, 0) - 0.5) * 1.8 * variationIntensity;

        return (
          <div
            key={ann.id}
            style={{
              left: `${ann.box.x}%`,
              top: `${ann.box.y}%`,
              width: `${ann.box.width}%`,
              height: `${ann.box.height}%`,
            }}
            onPointerDown={(e) => startDrag(e, ann, "move")}
            className={`group absolute flex items-start transition-colors ${
              isSelected
                ? "ring-2 ring-blue-600 bg-blue-50/20 z-20 cursor-move"
                : showBoundingGuides
                ? "border border-dashed border-blue-500/45 hover:border-blue-600 hover:bg-blue-50/15 z-10 cursor-grab"
                : "hover:ring-1 hover:ring-blue-500/50 z-10 cursor-grab"
            }`}
          >
            {/* Floating Mini Toolbar when Selected */}
            {isSelected && (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute -top-9 left-0 flex items-center gap-1 bg-slate-900 text-white px-2 py-1 rounded-md shadow-md text-[11px] whitespace-nowrap z-30"
              >
                <span className="font-mono-tabular text-slate-300 pr-1 border-r border-slate-700">
                  {ann.questionLabel} · {Math.round(baseFontSizePt)}pt
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateAnnotation(ann.id, {
                      useMistake: !ann.useMistake,
                      customText: null,
                    })
                  }
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
                    ann.useMistake
                      ? "bg-amber-600 text-white"
                      : "hover:bg-slate-800 text-slate-200"
                  }`}
                >
                  {ann.useMistake ? (
                    <>
                      <AlertTriangle className="w-3 h-3" />
                      <span>Fallo Orgánico</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Correcta</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateAnnotation(ann.id, { useCrossOut: !ann.useCrossOut })
                  }
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
                    ann.useCrossOut
                      ? "bg-blue-600 text-white"
                      : "hover:bg-slate-800 text-slate-200"
                  }`}
                >
                  <Scissors className="w-3 h-3" />
                  <span>Tachón</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteAnnotation(ann.id)}
                  title="Eliminar respuesta"
                  className="p-0.5 hover:bg-red-600/80 rounded text-slate-300 hover:text-white transition-colors ml-0.5"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Subtle Corner Status Indicator when Guides are visible */}
            {!isSelected && showBoundingGuides && (
              <div className="absolute -top-4 left-0 flex items-center gap-1 text-[10px] font-mono-tabular text-slate-600 bg-white/90 px-1 rounded border border-slate-200 pointer-events-none whitespace-nowrap">
                <span>{ann.questionLabel}</span>
                {ann.useMistake && (
                  <span className="text-amber-700 font-medium">· ▲ Fallo</span>
                )}
                {ann.useCrossOut && (
                  <span className="text-blue-700 font-medium">· Tachón</span>
                )}
              </div>
            )}

            {/* Simulated Handwritten Content */}
            <div
              style={{
                fontFamily: fontMeta.cssFamily,
                fontWeight: fontMeta.baseWeight,
                fontSize: `${scaledFontSizePx}px`,
                lineHeight: fontMeta.lineHeightMultiplier,
                color: inkMeta.hex,
                letterSpacing: fontMeta.customLetterSpacing
                  ? `${fontMeta.customLetterSpacing}px`
                  : undefined,
                transform: `rotate(${boxTiltDeg.toFixed(2)}deg) skewX(${(-customSlantDeg).toFixed(1)}deg)`,
              }}
              className="w-full px-1.5 py-0.5 break-words pointer-events-none"
            >
              {/* Crossed-out prefix word if enabled */}
              {ann.useCrossOut && ann.crossedOutWord && (
                <span className="relative inline-block mr-2.5 align-baseline">
                  <span style={{ opacity: inkMeta.opacityBase * 0.88 }}>
                    {renderTokenWithFusedCharacters(
                      ann.crossedOutWord,
                      scaledFontSizePx,
                      ann.seed,
                      charCounts
                    )}
                  </span>
                  <svg
                    viewBox="0 0 100 32"
                    preserveAspectRatio="none"
                    className="absolute inset-0 w-full h-full overflow-visible pointer-events-none"
                  >
                    <path
                      d="M -4 19 Q 48 11 104 15"
                      fill="none"
                      stroke={inkMeta.hex}
                      strokeWidth="3.2"
                      strokeLinecap="round"
                      opacity={0.94}
                    />
                    <path
                      d="M -2 13 Q 52 23 102 18"
                      fill="none"
                      stroke={inkMeta.hex}
                      strokeWidth="2.8"
                      strokeLinecap="round"
                      opacity={0.9}
                    />
                  </svg>
                </span>
              )}

              {/* Words with subtle organic jitter and per-character font fusion */}
              {words.map((token, idx) => {
                if (/^\s+$/.test(token)) {
                  return <span key={idx}>{token}</span>;
                }
                const yShiftPx =
                  (seededRandom(ann.seed, idx * 5 + 1) - 0.5) *
                  2.4 *
                  zoom *
                  variationIntensity;
                const rotDeg =
                  (seededRandom(ann.seed, idx * 5 + 2) - 0.5) *
                  2.4 *
                  variationIntensity;
                const wordOpacity = Math.max(
                  0.7,
                  Math.min(
                    0.99,
                    inkMeta.opacityBase +
                      (seededRandom(ann.seed, idx * 5 + 3) - 0.5) *
                        0.18 *
                        variationIntensity
                  )
                );
                return (
                  <span
                    key={idx}
                    style={{
                      display: "inline-block",
                      transform: `translateY(${yShiftPx.toFixed(1)}px) rotate(${rotDeg.toFixed(2)}deg)`,
                      opacity: wordOpacity,
                    }}
                  >
                    {renderTokenWithFusedCharacters(
                      token,
                      scaledFontSizePx,
                      ann.seed + idx * 7,
                      charCounts
                    )}
                  </span>
                );
              })}
            </div>

            {/* Bottom-Right Resize Handle */}
            {(isSelected || showBoundingGuides) && (
              <div
                onPointerDown={(e) => startDrag(e, ann, "resize")}
                title="Arrastrar para cambiar el tamaño del hueco (auto-ajusta la letra)"
                className={`absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 rounded-sm border border-white shadow cursor-nwse-resize transition-transform hover:scale-125 ${
                  isSelected ? "bg-blue-600" : "bg-blue-500/70"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
