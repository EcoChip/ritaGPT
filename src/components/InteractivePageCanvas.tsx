import React, { useRef, useState } from "react";
import {
  AnswerAnnotation,
  HANDWRITING_FONTS,
  HandwritingFontOption,
  INK_COLORS,
  NormalizedBox,
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
import {
  Check,
  AlertTriangle,
  Scissors,
  Trash2,
  Sparkles,
  Copy,
  Crosshair,
} from "lucide-react";

type DragMode =
  | "move"
  | "resize-br"
  | "resize-r"
  | "resize-b"
  | "resize-t"
  | "resize-l";

interface InteractivePageCanvasProps {
  page: PdfPageData;
  annotations: AnswerAnnotation[];
  selectedAnnotationId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  onUpdateAnnotation: (id: string, patch: Partial<AnswerAnnotation>) => void;
  onDeleteAnnotation: (id: string) => void;
  onDuplicateAnnotation?: (id: string) => void;
  onSnapSingleAnnotation?: (id: string) => void;
  onAddAnnotationAtPoint: (
    pageNumber: number,
    xPercent: number,
    yPercent: number,
    drawnBox?: NormalizedBox
  ) => void;
  onRedrawSelectedBox?: (id: string, drawnBox: NormalizedBox) => void;
  isAddingMode: boolean;
  isRedrawingBoxMode?: boolean;
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
  onDuplicateAnnotation,
  onSnapSingleAnnotation,
  onAddAnnotationAtPoint,
  onRedrawSelectedBox,
  isAddingMode,
  isRedrawingBoxMode = false,
  styleSettings,
  allFonts = HANDWRITING_FONTS,
  zoom,
  showBoundingGuides,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const [dragState, setDragState] = useState<{
    id: string;
    mode: DragMode;
    startX: number;
    startY: number;
    initialBox: NormalizedBox;
  } | null>(null);

  const [drawBoxState, setDrawBoxState] = useState<{
    startXPercent: number;
    startYPercent: number;
    currentXPercent: number;
    currentYPercent: number;
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

  const isDrawingOrAdding = isAddingMode || isRedrawingBoxMode;

  const handleContainerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (
      e.target !== e.currentTarget &&
      !(e.target as HTMLElement).dataset.pageBg
    ) {
      return;
    }

    if (isDrawingOrAdding && containerRef.current) {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const rect = containerRef.current.getBoundingClientRect();
      const xPercent = Math.max(
        0.5,
        Math.min(99, ((e.clientX - rect.left) / rect.width) * 100)
      );
      const yPercent = Math.max(
        0.5,
        Math.min(99, ((e.clientY - rect.top) / rect.height) * 100)
      );
      setDrawBoxState({
        startXPercent: xPercent,
        startYPercent: yPercent,
        currentXPercent: xPercent,
        currentYPercent: yPercent,
      });
      return;
    }

    onSelectAnnotation(null);
  };

  const startDrag = (
    e: React.PointerEvent,
    ann: AnswerAnnotation,
    mode: DragMode
  ) => {
    if (isDrawingOrAdding) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectAnnotation(ann.id);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore if pointer capture not supported on synthetic event
    }
    setDragState({
      id: ann.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      initialBox: { ...ann.box },
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();

    if (drawBoxState) {
      e.preventDefault();
      const xPercent = Math.max(
        0.5,
        Math.min(99.5, ((e.clientX - rect.left) / rect.width) * 100)
      );
      const yPercent = Math.max(
        0.5,
        Math.min(99.5, ((e.clientY - rect.top) / rect.height) * 100)
      );
      setDrawBoxState((prev) =>
        prev
          ? {
              ...prev,
              currentXPercent: xPercent,
              currentYPercent: yPercent,
            }
          : null
      );
      return;
    }

    if (!dragState) return;
    e.preventDefault();

    const deltaXPercent = ((e.clientX - dragState.startX) / rect.width) * 100;
    const deltaYPercent = ((e.clientY - dragState.startY) / rect.height) * 100;
    const init = dragState.initialBox;

    if (dragState.mode === "move") {
      const nextX = Math.max(
        0,
        Math.min(100 - init.width, init.x + deltaXPercent)
      );
      const nextY = Math.max(
        0,
        Math.min(100 - init.height, init.y + deltaYPercent)
      );
      onUpdateAnnotation(dragState.id, {
        box: {
          ...init,
          x: Number(nextX.toFixed(2)),
          y: Number(nextY.toFixed(2)),
        },
      });
    } else if (dragState.mode === "resize-br") {
      const nextW = Math.max(
        4.5,
        Math.min(100 - init.x, init.width + deltaXPercent)
      );
      const nextH = Math.max(
        1.8,
        Math.min(100 - init.y, init.height + deltaYPercent)
      );
      onUpdateAnnotation(dragState.id, {
        box: {
          ...init,
          width: Number(nextW.toFixed(2)),
          height: Number(nextH.toFixed(2)),
        },
      });
    } else if (dragState.mode === "resize-r") {
      const nextW = Math.max(
        4.5,
        Math.min(100 - init.x, init.width + deltaXPercent)
      );
      onUpdateAnnotation(dragState.id, {
        box: {
          ...init,
          width: Number(nextW.toFixed(2)),
        },
      });
    } else if (dragState.mode === "resize-b") {
      const nextH = Math.max(
        1.8,
        Math.min(100 - init.y, init.height + deltaYPercent)
      );
      onUpdateAnnotation(dragState.id, {
        box: {
          ...init,
          height: Number(nextH.toFixed(2)),
        },
      });
    } else if (dragState.mode === "resize-t") {
      // Adjust top edge while keeping bottom edge (init.y + init.height) anchored!
      const bottomEdge = init.y + init.height;
      const maxTop = bottomEdge - 1.8;
      const nextY = Math.max(0, Math.min(maxTop, init.y + deltaYPercent));
      const nextH = Math.max(1.8, bottomEdge - nextY);
      onUpdateAnnotation(dragState.id, {
        box: {
          ...init,
          y: Number(nextY.toFixed(2)),
          height: Number(nextH.toFixed(2)),
        },
      });
    } else if (dragState.mode === "resize-l") {
      // Adjust left edge while keeping right edge (init.x + init.width) anchored!
      const rightEdge = init.x + init.width;
      const maxLeft = rightEdge - 4.5;
      const nextX = Math.max(0, Math.min(maxLeft, init.x + deltaXPercent));
      const nextW = Math.max(4.5, rightEdge - nextX);
      onUpdateAnnotation(dragState.id, {
        box: {
          ...init,
          x: Number(nextX.toFixed(2)),
          width: Number(nextW.toFixed(2)),
        },
      });
    }
  };

  const handlePointerUp = () => {
    if (drawBoxState) {
      const minX = Math.min(
        drawBoxState.startXPercent,
        drawBoxState.currentXPercent
      );
      const maxX = Math.max(
        drawBoxState.startXPercent,
        drawBoxState.currentXPercent
      );
      const minY = Math.min(
        drawBoxState.startYPercent,
        drawBoxState.currentYPercent
      );
      const maxY = Math.max(
        drawBoxState.startYPercent,
        drawBoxState.currentYPercent
      );
      const drawnW = maxX - minX;
      const drawnH = maxY - minY;

      setDrawBoxState(null);

      // If user dragged a meaningful box with their finger / Apple Pencil
      if (drawnW >= 3.2 && drawnH >= 1.4) {
        const customBox: NormalizedBox = {
          x: Number(minX.toFixed(2)),
          y: Number(minY.toFixed(2)),
          width: Number(drawnW.toFixed(2)),
          height: Number(drawnH.toFixed(2)),
        };
        if (
          isRedrawingBoxMode &&
          selectedAnnotationId &&
          onRedrawSelectedBox
        ) {
          onRedrawSelectedBox(selectedAnnotationId, customBox);
        } else {
          onAddAnnotationAtPoint(page.pageNumber, minX, minY, customBox);
        }
      } else {
        // User tapped a point without dragging: auto-detect cavity around point
        if (isAddingMode) {
          onAddAnnotationAtPoint(
            page.pageNumber,
            drawBoxState.startXPercent,
            drawBoxState.startYPercent
          );
        }
      }
      return;
    }

    if (dragState) {
      setDragState(null);
    }
  };

  const adjustFontSizeByStep = (
    ann: AnswerAnnotation,
    currentBasePt: number,
    deltaPt: number
  ) => {
    const nextSize = Math.max(
      8,
      Math.min(34, Number((currentBasePt + deltaPt).toFixed(1)))
    );
    onUpdateAnnotation(ann.id, {
      autoFitFont: false,
      manualFontSize: nextSize,
    });
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

      const variantsList =
        fontMeta.glyphVariantsMap?.[ch] ||
        fontMeta.glyphVariantsMap?.[lowerKey] ||
        fontMeta.glyphVariantsMap?.[ch.toUpperCase()] ||
        (fontMeta.glyphMap?.[ch] ? [fontMeta.glyphMap[ch]] : undefined) ||
        (fontMeta.glyphMap?.[lowerKey]
          ? [fontMeta.glyphMap[lowerKey]]
          : undefined);

      const scaleY = antiCloneEnabled
        ? 1 +
          (seededRandom(seed + occ * 19, cIdx + 1) - 0.5) *
            0.13 *
            Math.max(0.4, variationIntensity)
        : 1;
      const scaleX = antiCloneEnabled
        ? 1 +
          (seededRandom(seed + occ * 23, cIdx + 2) - 0.5) *
            0.1 *
            Math.max(0.4, variationIntensity)
        : 1;
      const yOff = antiCloneEnabled
        ? (seededRandom(seed + occ * 31, cIdx + 3) - 0.5) * 1.4
        : 0;
      const rotDeg = antiCloneEnabled
        ? (seededRandom(seed + occ * 37, cIdx + 4) - 0.5) * 3.2
        : 0;

      if (variantsList && variantsList.length > 0) {
        const chosenUrl =
          variantsList[Math.abs(seed + occ) % variantsList.length];
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
      onPointerCancel={handlePointerUp}
      style={{
        width: `${displayWidthPx}px`,
        height: `${displayHeightPx}px`,
        touchAction: isDrawingOrAdding ? "none" : "pan-x pan-y",
      }}
      className={`relative bg-white shadow-sm border border-slate-200 select-none overflow-visible transition-shadow ${
        isDrawingOrAdding
          ? "cursor-crosshair ring-3 ring-blue-600/50"
          : ""
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

      {/* Active Mode Banner inside Top of Page when Drawing/Redrawing with Finger */}
      {isDrawingOrAdding && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-blue-700/95 text-white px-4 py-2 rounded-full shadow-lg text-xs font-semibold flex items-center gap-2 z-40 pointer-events-none whitespace-nowrap">
          <Crosshair className="w-4 h-4 animate-pulse" />
          <span>
            {isRedrawingBoxMode
              ? "Arrastra el dedo o Apple Pencil sobre el hueco para redimensionar la caja seleccionada"
              : "Toca un recuadro o arrastra el dedo para dibujar el hueco exacto"}
          </span>
        </div>
      )}

      {/* Live Finger / Apple Pencil Drag-to-Draw Box Preview */}
      {drawBoxState && (
        <div
          style={{
            left: `${Math.min(drawBoxState.startXPercent, drawBoxState.currentXPercent)}%`,
            top: `${Math.min(drawBoxState.startYPercent, drawBoxState.currentYPercent)}%`,
            width: `${Math.max(1, Math.abs(drawBoxState.currentXPercent - drawBoxState.startXPercent))}%`,
            height: `${Math.max(1, Math.abs(drawBoxState.currentYPercent - drawBoxState.startYPercent))}%`,
          }}
          className="absolute border-2 border-blue-600 bg-blue-500/20 rounded-xs pointer-events-none z-40"
        />
      )}

      {/* Solving Overlay State */}
      {page.status === "solving" && (
        <div className="absolute inset-0 bg-white/75 backdrop-blur-[2px] flex flex-col items-center justify-center z-30">
          <div className="w-10 h-10 border-3 border-slate-200 border-t-blue-700 rounded-full animate-spin mb-3" />
          <p className="text-sm font-medium text-slate-900">
            ritaGPT analizando y resolviendo la página {page.pageNumber}...
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Detectando recuadros y ajustando respuestas al milímetro
          </p>
        </div>
      )}

      {/* Handwritten Annotations Layer */}
      {annotations.map((ann) => {
        const isSelected = ann.id === selectedAnnotationId;
        const boxWidthPt = (ann.box.width / 100) * page.widthPt;
        const boxHeightPt = (ann.box.height / 100) * page.heightPt;
        const isSmallCallout =
          !ann.isNotebookEntry &&
          (ann.subjectType === "short_blank" ||
            boxWidthPt < 150 ||
            boxHeightPt < 36);

        const baseFontSizePt = computeAutoFontSize(
          ann,
          boxWidthPt,
          boxHeightPt,
          styleSettings,
          allFonts
        );
        const scaledFontSizePx = baseFontSizePt * zoom;
        const activeText = getAnnotationActiveText(ann);
        const words = activeText.split(/(\s+)/);
        const charCounts: Record<string, number> = {};

        const boxTiltDeg =
          (seededRandom(ann.seed, 0) - 0.5) *
          (isSmallCallout ? 1.0 : 1.6) *
          variationIntensity;

        // Place floating toolbar below the box if the box is near the top edge of the page
        const placeToolbarBelow = ann.box.y < 11;
        const alignToolbarRight = ann.box.x > 52;

        return (
          <div
            key={ann.id}
            style={{
              left: `${ann.box.x}%`,
              top: `${ann.box.y}%`,
              width: `${ann.box.width}%`,
              height: `${ann.box.height}%`,
              touchAction: "none",
            }}
            onPointerDown={(e) => startDrag(e, ann, "move")}
            className={`group absolute flex transition-colors touch-none ${
              isSmallCallout ? "items-center" : "items-start"
            } ${
              isSelected
                ? "ring-2 ring-blue-600 bg-blue-50/25 z-30 cursor-move shadow-xs"
                : showBoundingGuides
                ? "border border-dashed border-blue-500/45 hover:border-blue-600 hover:bg-blue-50/15 z-10 cursor-grab"
                : "hover:ring-1 hover:ring-blue-500/50 z-10 cursor-grab"
            }`}
          >
            {/* Touch-Friendly Floating iPad Context Toolbar when Selected */}
            {isSelected && (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                style={{ touchAction: "manipulation" }}
                className={`absolute ${
                  placeToolbarBelow ? "-bottom-12" : "-top-12"
                } ${
                  alignToolbarRight ? "right-0" : "left-0"
                } flex items-center gap-1 bg-slate-900/95 backdrop-blur-xs text-white px-2 py-1.5 rounded-xl shadow-lg text-xs whitespace-nowrap z-40 border border-slate-700/80`}
              >
                <span className="font-mono-tabular font-semibold text-blue-300 px-1.5 border-r border-slate-700">
                  {ann.questionLabel} · {Math.round(baseFontSizePt)}pt
                </span>

                {/* Font Size - / + for instant touch sizing */}
                <button
                  type="button"
                  onClick={() => adjustFontSizeByStep(ann, baseFontSizePt, -1)}
                  title="Reducir letra"
                  className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 font-semibold text-slate-200 transition-transform"
                >
                  A-
                </button>
                <button
                  type="button"
                  onClick={() => adjustFontSizeByStep(ann, baseFontSizePt, 1)}
                  title="Aumentar letra"
                  className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 font-semibold text-slate-200 transition-transform"
                >
                  A+
                </button>
                {Math.round(baseFontSizePt) !== 19 && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateAnnotation(ann.id, {
                        autoFitFont: true,
                        manualFontSize: 19,
                      })
                    }
                    title="Restablecer tamaño a 19pt"
                    className="px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-95 text-[11px] font-bold text-white transition-transform"
                  >
                    19pt
                  </button>
                )}

                {/* 1-Tap Smart Snap to Cavity */}
                {!ann.isNotebookEntry && onSnapSingleAnnotation && (
                  <button
                    type="button"
                    onClick={() => onSnapSingleAnnotation(ann.id)}
                    title="Encajar automáticamente en el recuadro o hueco blanco"
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-medium transition-transform"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Encajar</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    onUpdateAnnotation(ann.id, {
                      useMistake: !ann.useMistake,
                      customText: null,
                    })
                  }
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg font-medium transition-colors active:scale-95 ${
                    ann.useMistake
                      ? "bg-amber-600 text-white"
                      : "bg-slate-800 hover:bg-slate-700 text-slate-200"
                  }`}
                >
                  {ann.useMistake ? (
                    <>
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Fallo</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Exacta</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onUpdateAnnotation(ann.id, { useCrossOut: !ann.useCrossOut })
                  }
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg font-medium transition-colors active:scale-95 ${
                    ann.useCrossOut
                      ? "bg-blue-600 text-white"
                      : "bg-slate-800 hover:bg-slate-700 text-slate-200"
                  }`}
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span>Tachón</span>
                </button>

                {onDuplicateAnnotation && (
                  <button
                    type="button"
                    onClick={() => onDuplicateAnnotation(ann.id)}
                    title="Duplicar caja"
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 active:scale-95 transition-transform"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onDeleteAnnotation(ann.id)}
                  title="Eliminar respuesta"
                  className="p-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-white active:scale-95 transition-transform ml-0.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Compact Inside-Corner Badge when Unselected (never overlaps adjacent boxes!) */}
            {!isSelected && showBoundingGuides && (
              <div className="absolute top-0 left-0 flex items-center gap-0.5 text-[9px] leading-none font-mono-tabular text-white bg-blue-600/80 px-1 py-0.5 rounded-br pointer-events-none whitespace-nowrap">
                <span>{ann.questionLabel}</span>
                {ann.useMistake && <span title="Fallo orgánico">·▲</span>}
                {ann.useCrossOut && <span title="Tachón">·✗</span>}
              </div>
            )}

            {/* Simulated Handwritten Content */}
            <div
              style={{
                fontFamily: fontMeta.cssFamily,
                fontWeight: fontMeta.baseWeight,
                fontSize: `${scaledFontSizePx}px`,
                lineHeight: isSmallCallout
                  ? Math.min(1.1, fontMeta.lineHeightMultiplier)
                  : fontMeta.lineHeightMultiplier,
                color: inkMeta.hex,
                letterSpacing: fontMeta.customLetterSpacing
                  ? `${fontMeta.customLetterSpacing}px`
                  : undefined,
                transform: `rotate(${boxTiltDeg.toFixed(2)}deg) skewX(${(-customSlantDeg).toFixed(1)}deg)`,
              }}
              className={`w-full px-1.5 py-0.5 break-words pointer-events-none overflow-hidden ${
                isSmallCallout && !ann.useCrossOut ? "text-center" : "text-left"
              }`}
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
                  (isSmallCallout ? 1.4 : 2.2) *
                  zoom *
                  variationIntensity;
                const rotDeg =
                  (seededRandom(ann.seed, idx * 5 + 2) - 0.5) *
                  (isSmallCallout ? 1.5 : 2.2) *
                  variationIntensity;
                const wordOpacity = Math.max(
                  0.72,
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

            {/* MULTI-DIRECTIONAL iPAD TOUCH RESIZE HANDLES WHEN SELECTED */}
            {isSelected && (
              <>
                {/* 1. TOP EDGE HANDLE (Trim top down below printed question) */}
                <div
                  onPointerDown={(e) => startDrag(e, ann, "resize-t")}
                  style={{ touchAction: "none" }}
                  title="Arrastrar borde superior (ideal para bajar el techo de la caja debajo del enunciado impreso)"
                  className="absolute -top-4 left-1/2 -translate-x-1/2 w-12 h-8 flex items-center justify-center cursor-ns-resize z-30 touch-none"
                >
                  <div className="w-7 h-2 rounded-full bg-blue-600 border border-white shadow-sm" />
                </div>

                {/* 2. BOTTOM EDGE HANDLE (Adjust height) */}
                <div
                  onPointerDown={(e) => startDrag(e, ann, "resize-b")}
                  style={{ touchAction: "none" }}
                  title="Arrastrar borde inferior para cambiar la altura"
                  className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-12 h-8 flex items-center justify-center cursor-ns-resize z-30 touch-none"
                >
                  <div className="w-7 h-2 rounded-full bg-blue-600 border border-white shadow-sm" />
                </div>

                {/* 3. LEFT EDGE HANDLE (Trim left past printed label/number) */}
                <div
                  onPointerDown={(e) => startDrag(e, ann, "resize-l")}
                  style={{ touchAction: "none" }}
                  title="Arrastrar borde izquierdo (ideal para esquivar texto impreso a la izquierda)"
                  className="absolute top-1/2 -left-4 -translate-y-1/2 w-8 h-10 flex items-center justify-center cursor-ew-resize z-30 touch-none"
                >
                  <div className="w-2 h-6 rounded-full bg-blue-600 border border-white shadow-sm" />
                </div>

                {/* 4. RIGHT EDGE HANDLE (Adjust width) */}
                <div
                  onPointerDown={(e) => startDrag(e, ann, "resize-r")}
                  style={{ touchAction: "none" }}
                  title="Arrastrar borde derecho para cambiar el ancho"
                  className="absolute top-1/2 -right-4 -translate-y-1/2 w-8 h-10 flex items-center justify-center cursor-ew-resize z-30 touch-none"
                >
                  <div className="w-2 h-6 rounded-full bg-blue-600 border border-white shadow-sm" />
                </div>

                {/* 5. BOTTOM-RIGHT CORNER HANDLE (44x44px hit target for 2D resize) */}
                <div
                  onPointerDown={(e) => startDrag(e, ann, "resize-br")}
                  style={{ touchAction: "none" }}
                  title="Arrastrar esquina para cambiar ancho y alto a la vez"
                  className="absolute -bottom-5 -right-5 w-11 h-11 flex items-center justify-center cursor-nwse-resize z-40 touch-none"
                >
                  <div className="w-4.5 h-4.5 rounded-full bg-blue-600 border-2 border-white shadow-md" />
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};
