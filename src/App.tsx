import React, { useState, useRef, useEffect } from "react";
import {
  AnswerAnnotation,
  HANDWRITING_FONTS,
  HandwritingFontOption,
  INK_COLORS,
  PdfPageData,
  SolvingProgressState,
  StyleSettings,
} from "./types";
import {
  convertImageFilesToPdfBytes,
  renderPdfToPageImages,
} from "./utils/pdfLoader";
import { generateSampleExercisePdf } from "./utils/samplePdf";
import {
  computeAutoFontSize,
  exportAnnotatedPdfBytes,
  getAnnotationActiveText,
  seededRandom,
} from "./utils/handwritingRenderer";
import {
  loadSavedCustomFonts,
  saveCustomFontsToStorage,
} from "./utils/customFontManager";
import { InteractivePageCanvas } from "./components/InteractivePageCanvas";
import { CustomFontStudioModal } from "./components/CustomFontStudioModal";
import { CameraCaptureModal } from "./components/CameraCaptureModal";
import {
  Upload,
  FileText,
  Download,
  Wand2,
  Plus,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Sliders,
  Check,
  AlertTriangle,
  Scissors,
  Shuffle,
  Eye,
  EyeOff,
  Trash2,
  RotateCcw,
  Camera,
  PenTool,
  ArrowRight,
  Image as ImageIcon,
  FolderOpen,
} from "lucide-react";

export default function App() {
  // Landing vs Workspace view (instant 0.1s transition)
  const [showLanding, setShowLanding] = useState<boolean>(true);

  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string>("ejercicios.pdf");
  const [pages, setPages] = useState<PdfPageData[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [annotations, setAnnotations] = useState<AnswerAnnotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  const [customFonts, setCustomFonts] = useState<HandwritingFontOption[]>([]);
  const [isFontStudioOpen, setIsFontStudioOpen] = useState<boolean>(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState<boolean>(false);

  const [zoom, setZoom] = useState<number>(1.05);
  const [showBoundingGuides, setShowBoundingGuides] = useState<boolean>(true);
  const [isAddingMode, setIsAddingMode] = useState<boolean>(false);
  const [activeSidebarTab, setActiveSidebarTab] = useState<"style" | "exercises">("style");
  const [customInstructions, setCustomInstructions] = useState<string>("");

  const [isLoadingPdf, setIsLoadingPdf] = useState<boolean>(false);
  const [isSolvingAll, setIsSolvingAll] = useState<boolean>(false);
  const [solvingProgress, setSolvingProgress] = useState<SolvingProgressState>({
    active: false,
    currentPage: 0,
    totalPages: 0,
    completedPages: 0,
    statusText: "",
  });
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [styleSettings, setStyleSettings] = useState<StyleSettings>({
    fontId: "caveat",
    inkId: "bic-blue",
    organic: {
      enabled: true,
      mistakeRatePercent: 15,
      crossOutRatePercent: 25,
      strokeVariationPercent: 65,
    },
  });

  // Universal file input (opens Apple iOS/macOS panel: Fototeca, Hacer foto, Seleccionar archivos)
  const universalFileInputRef = useRef<HTMLInputElement>(null);
  // Dedicated native mobile camera input
  const nativeCameraInputRef = useRef<HTMLInputElement>(null);

  const allFonts: HandwritingFontOption[] = [...customFonts, ...HANDWRITING_FONTS];

  // Load saved custom fonts & preload sample PDF in the background on mount
  useEffect(() => {
    loadSavedCustomFonts().then((loaded) => {
      if (loaded.length > 0) {
        setCustomFonts(loaded);
        setStyleSettings((prev) => ({ ...prev, fontId: loaded[0].id }));
      }
    });
    handleLoadSamplePdf(false);
  }, []);

  const handleSaveCustomFont = (newFont: HandwritingFontOption) => {
    setCustomFonts((prev) => {
      const updated = [newFont, ...prev];
      saveCustomFontsToStorage(updated);
      return updated;
    });
    setStyleSettings((prev) => ({
      ...prev,
      fontId: newFont.id,
    }));
  };

  const handleDeleteCustomFont = (fontId: string) => {
    setCustomFonts((prev) => {
      const updated = prev.filter((f) => f.id !== fontId);
      saveCustomFontsToStorage(updated);
      return updated;
    });
    if (styleSettings.fontId === fontId) {
      setStyleSettings((prev) => ({ ...prev, fontId: "caveat" }));
    }
  };

  const loadPdfFromBytes = async (bytes: Uint8Array, name: string) => {
    setIsLoadingPdf(true);
    setErrorBanner(null);
    try {
      const copyForExport = new Uint8Array(bytes.length);
      copyForExport.set(bytes);
      setPdfBytes(copyForExport);
      setPdfFileName(name);

      const renderedPages = await renderPdfToPageImages(bytes, 2.0);
      setPages(renderedPages);
      setCurrentPage(1);
      setAnnotations([]);
      setSelectedAnnotationId(null);
    } catch (err: any) {
      console.error("Error loading PDF:", err);
      setErrorBanner(err?.message || "No se pudo leer el documento.");
    } finally {
      setIsLoadingPdf(false);
    }
  };

  /**
   * Handles both PDF files AND one or more Image/Photo files from the Apple sheet or desktop picker.
   */
  const handleUniversalFilesSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files: File[] = Array.from(fileList);
    e.target.value = "";

    setShowLanding(false);
    setIsLoadingPdf(true);
    setErrorBanner(null);

    try {
      const firstFile = files[0];
      const isPdf =
        firstFile.type === "application/pdf" ||
        firstFile.name.toLowerCase().endsWith(".pdf");

      if (isPdf) {
        const buffer = await firstFile.arrayBuffer();
        await loadPdfFromBytes(new Uint8Array(buffer), firstFile.name);
      } else {
        // Convert 1 or more images/photos into a multi-page PDF document
        const imageFiles = files.filter(
          (f) =>
            f.type.startsWith("image/") ||
            /\.(jpe?g|png|webp|heic|bmp)$/i.test(f.name)
        );
        if (imageFiles.length === 0) {
          throw new Error(
            "Selecciona un archivo PDF o una imagen (JPG, PNG, WEBP, HEIC)."
          );
        }
        const convertedBytes = await convertImageFilesToPdfBytes(imageFiles);
        const baseTitle = imageFiles[0].name.replace(/\.[^.]+$/, "");
        await loadPdfFromBytes(convertedBytes, `${baseTitle}.pdf`);
      }
    } catch (err: any) {
      console.error("Error procesando archivos:", err);
      setErrorBanner(
        err?.message || "No se pudo procesar el archivo o imagen seleccionada."
      );
      setIsLoadingPdf(false);
    }
  };

  const handleCapturedPhotoFile = async (photoFile: File) => {
    setShowLanding(false);
    setIsLoadingPdf(true);
    setErrorBanner(null);
    try {
      const convertedBytes = await convertImageFilesToPdfBytes([photoFile]);
      await loadPdfFromBytes(convertedBytes, photoFile.name.replace(/\.jpg$/i, ".pdf"));
    } catch (err: any) {
      setErrorBanner(err?.message || "No se pudo procesar la foto capturada.");
      setIsLoadingPdf(false);
    }
  };

  const handleLoadSamplePdf = async (autoSolve: boolean = false) => {
    setIsLoadingPdf(true);
    setErrorBanner(null);
    try {
      const sampleBytes = await generateSampleExercisePdf();
      await loadPdfFromBytes(sampleBytes, "ficha_ejercicios_demo.pdf");
      if (autoSolve) {
        setTimeout(() => {
          solveAllPagesInternal(sampleBytes);
        }, 100);
      }
    } catch (err: any) {
      setErrorBanner("Error al generar el PDF de ejemplo.");
      setIsLoadingPdf(false);
    }
  };

  /**
   * Assigns organic mistakes and cross-outs across a list of annotations
   * according to the current organic settings.
   */
  const applyOrganicDistribution = (
    items: AnswerAnnotation[],
    organicConfig = styleSettings.organic,
    extraSeedOffset = 0
  ): AnswerAnnotation[] => {
    if (!organicConfig.enabled) {
      return items.map((ann) => ({
        ...ann,
        useMistake: false,
        useCrossOut: false,
      }));
    }

    const total = items.length;
    if (total === 0) return items;

    const targetMistakes =
      organicConfig.mistakeRatePercent > 0
        ? Math.max(
            total >= 4 && organicConfig.mistakeRatePercent >= 10 ? 1 : 0,
            Math.round((total * organicConfig.mistakeRatePercent) / 100)
          )
        : 0;

    const targetCrossOuts =
      organicConfig.crossOutRatePercent > 0
        ? Math.max(
            total >= 3 && organicConfig.crossOutRatePercent >= 15 ? 1 : 0,
            Math.round((total * organicConfig.crossOutRatePercent) / 100)
          )
        : 0;

    const indicesByMistake = items
      .map((item, idx) => ({
        idx,
        score: seededRandom(item.seed + extraSeedOffset, 11),
      }))
      .sort((a, b) => a.score - b.score)
      .map((x) => x.idx);

    const indicesByCrossOut = items
      .map((item, idx) => ({
        idx,
        score: seededRandom(item.seed + extraSeedOffset, 29),
      }))
      .sort((a, b) => a.score - b.score)
      .map((x) => x.idx);

    const mistakeSet = new Set(indicesByMistake.slice(0, targetMistakes));
    const crossOutSet = new Set(indicesByCrossOut.slice(0, targetCrossOuts));

    return items.map((ann, idx) => ({
      ...ann,
      seed: ann.seed + extraSeedOffset,
      useMistake: mistakeSet.has(idx),
      useCrossOut: crossOutSet.has(idx),
    }));
  };

  const solveSinglePage = async (pageObj: PdfPageData): Promise<AnswerAnnotation[]> => {
    setPages((prev) =>
      prev.map((p) =>
        p.pageNumber === pageObj.pageNumber
          ? { ...p, status: "solving", errorMessage: undefined }
          : p
      )
    );

    const isJpeg = pageObj.imageDataUrl.startsWith("data:image/jpeg");

    const response = await fetch("/api/solve-page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64: pageObj.imageDataUrl,
        mimeType: isJpeg ? "image/jpeg" : "image/png",
        pageNumber: pageObj.pageNumber,
        customInstructions: customInstructions.trim() || undefined,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Error al resolver la página con Gemini.");
    }

    const rawExercises = Array.isArray(data.exercises) ? data.exercises : [];
    const createdAnnotations: AnswerAnnotation[] = rawExercises.map(
      (ex: any, index: number) => {
        const box2d =
          Array.isArray(ex.blankBox2d) && ex.blankBox2d.length === 4
            ? ex.blankBox2d
            : [150 + index * 110, 80, 210 + index * 110, 850];

        const [ymin, xmin, ymax, xmax] = box2d;
        const xPercent = Math.max(1, Math.min(92, xmin / 10));
        const yPercent = Math.max(1, Math.min(94, ymin / 10));
        const widthPercent = Math.max(8, Math.min(96 - xPercent, (xmax - xmin) / 10));
        const heightPercent = Math.max(2.8, Math.min(30, (ymax - ymin) / 10));

        return {
          id: `p${pageObj.pageNumber}-ex${index + 1}-${Date.now()}`,
          pageNumber: pageObj.pageNumber,
          questionLabel: ex.questionLabel || `Ej. ${index + 1}`,
          questionSummary: ex.questionSummary || "Ejercicio detectado",
          subjectType: ex.subjectType || "open_text",
          correctAnswer: String(ex.correctAnswer || "").trim(),
          organicMistakeAnswer: String(
            ex.organicMistakeAnswer || ex.correctAnswer || ""
          ).trim(),
          mistakeExplanation: String(
            ex.mistakeExplanation || "Pequeño desliz humano simulado"
          ).trim(),
          crossedOutWord: String(ex.crossedOutWord || "").trim(),
          customText: null,
          box: {
            x: Number(xPercent.toFixed(2)),
            y: Number(yPercent.toFixed(2)),
            width: Number(widthPercent.toFixed(2)),
            height: Number(heightPercent.toFixed(2)),
          },
          useMistake: false,
          useCrossOut: false,
          autoFitFont: true,
          manualFontSize: 16,
          seed: pageObj.pageNumber * 100 + index * 17 + 1,
        };
      }
    );

    const distributed = applyOrganicDistribution(createdAnnotations);

    setPages((prev) =>
      prev.map((p) =>
        p.pageNumber === pageObj.pageNumber
          ? {
              ...p,
              status: "solved",
              pageSummary: data.pageSummary || "Hoja de ejercicios resuelta",
            }
          : p
      )
    );

    return distributed;
  };

  const solveAllPagesInternal = async (_overrideBytes?: Uint8Array) => {
    if (pages.length === 0 || isSolvingAll) return;
    setIsSolvingAll(true);
    setErrorBanner(null);

    const total = pages.length;
    setSolvingProgress({
      active: true,
      currentPage: 1,
      totalPages: total,
      completedPages: 0,
      statusText: `Analizando página 1 de ${total} con ritaGPT...`,
    });

    try {
      let accumulated: AnswerAnnotation[] = [
        ...annotations.filter((a) => !pages.some((p) => p.pageNumber === a.pageNumber)),
      ];

      for (let i = 0; i < pages.length; i++) {
        const pageObj = pages[i];
        setCurrentPage(pageObj.pageNumber);
        setSolvingProgress({
          active: true,
          currentPage: i + 1,
          totalPages: total,
          completedPages: i,
          statusText: `Resolviendo página ${i + 1} de ${total} · Detectando zonas en blanco...`,
        });

        const pageSolved = await solveSinglePage(pageObj);
        accumulated = [
          ...accumulated.filter((a) => a.pageNumber !== pageObj.pageNumber),
          ...pageSolved,
        ];
        setAnnotations([...accumulated]);

        setSolvingProgress({
          active: true,
          currentPage: i + 1,
          totalPages: total,
          completedPages: i + 1,
          statusText:
            i + 1 === total
              ? `¡Completado! ${total} de ${total} páginas resueltas.`
              : `Página ${i + 1} de ${total} completada`,
        });
      }

      setActiveSidebarTab("exercises");
    } catch (err: any) {
      console.error("Error solving PDF:", err);
      setErrorBanner(
        err?.message || "No se pudieron resolver los ejercicios. Inténtalo de nuevo."
      );
      setPages((prev) =>
        prev.map((p) => (p.status === "solving" ? { ...p, status: "error" } : p))
      );
    } finally {
      setIsSolvingAll(false);
      setTimeout(() => {
        setSolvingProgress((prev) => ({ ...prev, active: false }));
      }, 900);
    }
  };

  const handleSolveCurrentPage = async () => {
    const pageObj = pages.find((p) => p.pageNumber === currentPage);
    if (!pageObj || isSolvingAll) return;
    setIsSolvingAll(true);
    setErrorBanner(null);
    setSolvingProgress({
      active: true,
      currentPage: 1,
      totalPages: 1,
      completedPages: 0,
      statusText: `Resolviendo página ${currentPage} con ritaGPT...`,
    });

    try {
      const pageSolved = await solveSinglePage(pageObj);
      setAnnotations((prev) => [
        ...prev.filter((a) => a.pageNumber !== currentPage),
        ...pageSolved,
      ]);
      setSolvingProgress({
        active: true,
        currentPage: 1,
        totalPages: 1,
        completedPages: 1,
        statusText: `Página ${currentPage} completada`,
      });
      setActiveSidebarTab("exercises");
    } catch (err: any) {
      setErrorBanner(err?.message || "Error al resolver esta página.");
      setPages((prev) =>
        prev.map((p) =>
          p.pageNumber === currentPage ? { ...p, status: "error" } : p
        )
      );
    } finally {
      setIsSolvingAll(false);
      setTimeout(() => {
        setSolvingProgress((prev) => ({ ...prev, active: false }));
      }, 900);
    }
  };

  const handleUpdateAnnotation = (
    id: string,
    patch: Partial<AnswerAnnotation>
  ) => {
    setAnnotations((prev) =>
      prev.map((ann) => (ann.id === id ? { ...ann, ...patch } : ann))
    );
  };

  const handleDeleteAnnotation = (id: string) => {
    setAnnotations((prev) => prev.filter((ann) => ann.id !== id));
    if (selectedAnnotationId === id) {
      setSelectedAnnotationId(null);
    }
  };

  const handleAddAnnotationAtPoint = (
    pageNumber: number,
    xPercent: number,
    yPercent: number
  ) => {
    const newId = `manual-${Date.now()}`;
    const pageCount = annotations.filter((a) => a.pageNumber === pageNumber).length;
    const newAnn: AnswerAnnotation = {
      id: newId,
      pageNumber,
      questionLabel: `Nota ${pageCount + 1}`,
      questionSummary: "Respuesta añadida manualmente",
      subjectType: "open_text",
      correctAnswer: "x = 12 (Respuesta manual)",
      organicMistakeAnswer: "x = 11",
      mistakeExplanation: "Variante manual editable",
      crossedOutWord: "x=10",
      customText: null,
      box: {
        x: Number(xPercent.toFixed(2)),
        y: Number(yPercent.toFixed(2)),
        width: 34,
        height: 5.5,
      },
      useMistake: false,
      useCrossOut: styleSettings.organic.enabled && styleSettings.organic.crossOutRatePercent >= 30,
      autoFitFont: true,
      manualFontSize: 16,
      seed: Math.floor(Math.random() * 1000) + 1,
    };

    setAnnotations((prev) => [...prev, newAnn]);
    setSelectedAnnotationId(newId);
    setIsAddingMode(false);
    setActiveSidebarTab("exercises");
  };

  const handleUpdateOrganicSettings = (
    patch: Partial<StyleSettings["organic"]>,
    redistribute: boolean = true
  ) => {
    const nextOrganic = { ...styleSettings.organic, ...patch };
    setStyleSettings((prev) => ({
      ...prev,
      organic: nextOrganic,
    }));

    if (redistribute && annotations.length > 0) {
      setAnnotations((prev) => applyOrganicDistribution(prev, nextOrganic));
    }
  };

  const handleReshuffleOrganic = () => {
    if (annotations.length === 0) return;
    const randomOffset = Math.floor(Math.random() * 500) + 7;
    setAnnotations((prev) =>
      applyOrganicDistribution(prev, styleSettings.organic, randomOffset)
    );
  };

  const handleDownloadPdf = async () => {
    if (!pdfBytes || pages.length === 0 || isExporting) return;
    setIsExporting(true);
    setErrorBanner(null);
    try {
      const modifiedBytes = await exportAnnotatedPdfBytes(
        pdfBytes,
        pages,
        annotations,
        styleSettings,
        allFonts
      );
      const blob = new Blob([modifiedBytes as unknown as BlobPart], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const baseName = pdfFileName.replace(/\.pdf$/i, "");
      link.href = url;
      link.download = `${baseName}_ritaGPT_manuscrito.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Export error:", err);
      setErrorBanner(err?.message || "Error al generar el archivo PDF final.");
    } finally {
      setIsExporting(false);
    }
  };

  const activePageData = pages.find((p) => p.pageNumber === currentPage) || pages[0];
  const currentPageAnnotations = annotations.filter(
    (a) => a.pageNumber === currentPage
  );

  const totalMistakesCount = annotations.filter((a) => a.useMistake).length;
  const totalCrossOutsCount = annotations.filter((a) => a.useCrossOut).length;

  const progressPercentage =
    solvingProgress.totalPages > 0
      ? Math.round(
          ((solvingProgress.completedPages +
            (isSolvingAll && solvingProgress.completedPages < solvingProgress.totalPages
              ? 0.35
              : 0)) /
            solvingProgress.totalPages) *
            100
        )
      : 0;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Universal File & Apple Media Sheet Input (PDFs + Photos + Camera Roll + Files) */}
      <input
        ref={universalFileInputRef}
        type="file"
        multiple
        accept="application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.heic,.webp"
        onChange={handleUniversalFilesSelected}
        className="hidden"
      />

      {/* Direct Mobile Camera Capture Input */}
      <input
        ref={nativeCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleUniversalFilesSelected}
        className="hidden"
      />

      {/* Custom Font Creator & Uploader Modal */}
      <CustomFontStudioModal
        isOpen={isFontStudioOpen}
        onClose={() => setIsFontStudioOpen(false)}
        customFonts={customFonts}
        onSaveFont={handleSaveCustomFont}
        onDeleteFont={handleDeleteCustomFont}
      />

      {/* Live Camera Capture Modal */}
      <CameraCaptureModal
        isOpen={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        onCaptureFile={handleCapturedPhotoFile}
      />

      {/* Top Bar Contract: Strictly 3 zones separated by gap-8 */}
      <header className="h-15 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8 shrink-0 z-30">
        {/* Zone 1: Brand Title (single text element wordmark) */}
        <a
          href="#ritaGPT"
          onClick={(e) => {
            e.preventDefault();
            setShowLanding((v) => !v);
          }}
          className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          ritaGPT
        </a>

        {/* Zone 2: 4 concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <button
            type="button"
            onClick={() => universalFileInputRef.current?.click()}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Subir PDF o Foto
          </button>
          <button
            type="button"
            onClick={() => setIsCameraModalOpen(true)}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Hacer Foto
          </button>
          <button
            type="button"
            onClick={() => setIsFontStudioOpen(true)}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Mi Propia Fuente
          </button>
          <button
            type="button"
            onClick={() => {
              setShowLanding(false);
              solveAllPagesInternal();
            }}
            disabled={isSolvingAll || pages.length === 0}
            className="hover:text-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isSolvingAll ? "Resolviendo..." : "Resolver con IA"}
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action Button */}
        <div className="flex items-center shrink-0">
          {showLanding ? (
            <button
              type="button"
              onClick={() => setShowLanding(false)}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-transform duration-75 active:scale-95 flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
            >
              <span>Entrar al Estudio</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={!pdfBytes || isExporting || pages.length === 0}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>
                {isExporting ? "Generando PDF..." : "Descargar PDF Resuelto"}
              </span>
            </button>
          )}
        </div>
      </header>

      {/* Global Visual Progress Bar when solving pages with AI */}
      {(isSolvingAll || solvingProgress.active) && (
        <div className="bg-slate-900 text-white px-6 py-2.5 border-b border-slate-800 z-30">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-3 text-xs">
              <div className="w-3.5 h-3.5 border-2 border-slate-500 border-t-blue-400 rounded-full animate-spin shrink-0" />
              <span className="font-medium text-white">
                {solvingProgress.statusText}
              </span>
              <span aria-hidden="true" className="text-slate-500">
                ·
              </span>
              <span className="font-mono-tabular text-blue-300">
                Página {solvingProgress.currentPage} de {solvingProgress.totalPages} (
                {solvingProgress.totalPages - solvingProgress.completedPages} restantes)
              </span>
            </div>
            <div className="flex items-center gap-3 sm:w-64">
              <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  style={{ width: `${Math.min(100, Math.max(8, progressPercentage))}%` }}
                  className="h-full bg-blue-500 transition-all duration-200 rounded-full"
                />
              </div>
              <span className="text-xs font-mono-tabular text-slate-300 w-9 text-right">
                {Math.min(100, progressPercentage)}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Error Alert Banner if any */}
      {errorBanner && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2.5 flex items-center justify-between text-xs text-red-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="font-medium underline hover:text-red-950 whitespace-nowrap"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* VIEW 1: ritaGPT INSTANT LANDING EXPERIENCE */}
      {showLanding ? (
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-6 py-12 lg:py-16">
            {/* Hero Split */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center pb-14 border-b border-slate-200">
              <div className="lg:col-span-7 space-y-6">
                <div className="text-xs font-medium text-slate-500">
                  Resolución Espacial con Gemini Vision · Caligrafía Humana Orgánica · Exportación PDF
                </div>

                <h1
                  style={{ fontSize: "clamp(3.25rem, 6vw, 5.25rem)" }}
                  className="font-display font-bold tracking-tight text-slate-900 leading-none"
                >
                  ritaGPT
                </h1>

                <p className="text-base sm:text-lg text-slate-600 max-w-2xl leading-relaxed">
                  Sube cualquier hoja de ejercicios en <strong>PDF</strong>, selecciona una <strong>imagen de tu galería</strong> o <strong>haz una foto al instante</strong>. ritaGPT resuelve cada ejercicio y escribe las respuestas directamente sobre los huecos en blanco con tu propia letra manuscrita, fallos humanos opcionales y tachones naturales.
                </p>

                {/* Instant 0.1s Entry CTA + Secondary Quick Actions */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowLanding(false)}
                    className="px-6 py-3.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-xl shadow-sm transition-transform duration-75 active:scale-95 flex items-center gap-2.5 cursor-pointer whitespace-nowrap"
                  >
                    <span>Entrar a ritaGPT</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => universalFileInputRef.current?.click()}
                    className="px-5 py-3.5 bg-white hover:bg-slate-100 text-slate-900 border border-slate-200 text-sm font-semibold rounded-xl transition-colors duration-75 flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <FolderOpen className="w-4 h-4 text-blue-700" />
                    <span>Subir PDF / Fotos / Archivos</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsCameraModalOpen(true)}
                    className="px-4 py-3.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-200 text-sm font-medium rounded-xl transition-colors duration-75 flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <Camera className="w-4 h-4 text-slate-700" />
                    <span>Hacer Foto</span>
                  </button>
                </div>
              </div>

              {/* Right Interactive Preview Card */}
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <span className="text-xs font-semibold text-slate-900">
                    Demostración Caligráfica en Vivo
                  </span>
                  <span className="text-xs font-mono-tabular text-slate-500">
                    Auto-Fit · Modo Orgánico
                  </span>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                  <p className="text-xs text-slate-700 font-medium">
                    1. Resuelve la ecuación: 3(2x - 4) + 6 = 18
                  </p>
                  <div className="bg-white border border-dashed border-blue-400 rounded-lg p-3">
                    <p
                      style={{
                        fontFamily: "'Caveat', cursive",
                        color: "#183B8C",
                        fontSize: "23px",
                        transform: "rotate(-0.7deg)",
                      }}
                      className="leading-tight"
                    >
                      <span className="line-through opacity-75 mr-2">6x=18</span>
                      6x - 12 + 6 = 18 → 6x = 24 → x = 4
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => setIsFontStudioOpen(true)}
                    className="text-xs font-semibold text-blue-700 hover:underline flex items-center gap-1.5 cursor-pointer"
                  >
                    <PenTool className="w-3.5 h-3.5" />
                    <span>Crear o subir mi propia letra →</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowLanding(false);
                      solveAllPagesInternal();
                    }}
                    className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    Probar Demo Ahora
                  </button>
                </div>
              </div>
            </div>

            {/* 4 Core Capabilities Grid */}
            <div className="pt-12">
              <h2 className="font-display text-lg font-bold text-slate-900 mb-6">
                Todo lo que puedes hacer en ritaGPT
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {/* Card 1 */}
                <div
                  onClick={() => {
                    setShowLanding(false);
                  }}
                  className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 flex flex-col justify-between cursor-pointer transition-colors"
                >
                  <div>
                    <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center mb-3">
                      <Wand2 className="w-4 h-4" />
                    </div>
                    <h3 className="font-display text-sm font-bold text-slate-900 mb-1.5">
                      01. Resolver PDFs con IA
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Detecta automáticamente las coordenadas de las zonas en blanco en matemáticas, física, inglés o historia y escribe la respuesta con auto-ajuste de fuente.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-100 text-xs font-semibold text-blue-700 flex items-center justify-between">
                    <span>Abrir visor PDF</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </div>

                {/* Card 2 */}
                <div
                  onClick={() => universalFileInputRef.current?.click()}
                  className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 flex flex-col justify-between cursor-pointer transition-colors"
                >
                  <div>
                    <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center mb-3">
                      <ImageIcon className="w-4 h-4" />
                    </div>
                    <h3 className="font-display text-sm font-bold text-slate-900 mb-1.5">
                      02. Fotos, Cámara y Panel Apple
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Abre el menú nativo de tu dispositivo (Fototeca, Hacer Foto en directo o Archivos de iCloud/Drive). Convierte fotos de cuadernos o exámenes en PDF al instante.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-100 text-xs font-semibold text-blue-700 flex items-center justify-between">
                    <span>Subir imagen o hacer foto</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </div>

                {/* Card 3 */}
                <div
                  onClick={() => setIsFontStudioOpen(true)}
                  className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 flex flex-col justify-between cursor-pointer transition-colors"
                >
                  <div>
                    <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center mb-3">
                      <PenTool className="w-4 h-4" />
                    </div>
                    <h3 className="font-display text-sm font-bold text-slate-900 mb-1.5">
                      03. Creador y Subida de Tu Fuente
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Dibuja tus propias letras y números directamente en la web o sube tu archivo `.TTF` / `.OTF`. Se guarda en la memoria del navegador para todos tus ejercicios.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-100 text-xs font-semibold text-blue-700 flex items-center justify-between">
                    <span>Abrir estudio de letra</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </div>

                {/* Card 4 */}
                <div
                  onClick={() => {
                    setShowLanding(false);
                    setActiveSidebarTab("style");
                  }}
                  className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 flex flex-col justify-between cursor-pointer transition-colors"
                >
                  <div>
                    <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center mb-3">
                      <Scissors className="w-4 h-4" />
                    </div>
                    <h3 className="font-display text-sm font-bold text-slate-900 mb-1.5">
                      04. Modo Orgánico y Tachones
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Simula un 10–15% de fallos humanos leves, palabras tachadas a bolígrafo con corrección al lado y variación realista de presión e inclinación.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-100 text-xs font-semibold text-blue-700 flex items-center justify-between">
                    <span>Configurar modo orgánico</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      ) : (
        /* VIEW 2: FULL WORKSPACE (PDF & PHOTO EDITOR + ORGANIC HANDWRITING) */
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* LEFT ZONE (70%): Interactive PDF Preview & Canvas Stage */}
          <main className="flex-1 flex flex-col bg-slate-100/80 overflow-hidden">
            {/* Workspace Sub-Toolbar */}
            <div className="bg-white border-b border-slate-200 px-5 py-2.5 flex flex-wrap items-center justify-between gap-4">
              {/* Left: File & Page Metadata (unboxed clean text with · separators) */}
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="font-medium text-slate-900 truncate max-w-[180px]">
                  {pdfFileName}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">
                  {pages.length} {pages.length === 1 ? "página" : "páginas"}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">
                  {annotations.length} respuestas
                </span>
                {styleSettings.organic.enabled && annotations.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular text-amber-700">
                      {totalMistakesCount} fallos
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular text-blue-700">
                      {totalCrossOutsCount} tachones
                    </span>
                  </>
                )}
              </div>

              {/* Right: Canvas Manipulation Controls */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => universalFileInputRef.current?.click()}
                  title="Abre el selector de archivos, Fototeca o cámara de tu dispositivo"
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Subir PDF / Foto</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsCameraModalOpen(true)}
                  title="Hacer foto a una hoja de ejercicios"
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Hacer Foto</span>
                </button>

                <button
                  type="button"
                  onClick={() => solveAllPagesInternal()}
                  disabled={isSolvingAll || pages.length === 0}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>
                    {isSolvingAll
                      ? `Resolviendo (${solvingProgress.currentPage}/${solvingProgress.totalPages})...`
                      : annotations.length > 0
                      ? "Re-Analizar Hoja"
                      : "Resolver con IA"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsAddingMode((v) => !v)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                    isAddingMode
                      ? "bg-blue-50 border-blue-600 text-blue-700"
                      : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isAddingMode ? "Haz clic en la hoja..." : "Añadir Caja"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowBoundingGuides((v) => !v)}
                  title="Mostrar u ocultar recuadros delimitadores para ver el resultado limpio"
                  className="p-1.5 text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-md transition-colors cursor-pointer"
                >
                  {showBoundingGuides ? (
                    <Eye className="w-4 h-4" />
                  ) : (
                    <EyeOff className="w-4 h-4" />
                  )}
                </button>

                {/* Zoom Controls */}
                <div className="flex items-center border border-slate-200 rounded-md bg-white">
                  <button
                    type="button"
                    onClick={() =>
                      setZoom((z) => Math.max(0.6, Number((z - 0.15).toFixed(2))))
                    }
                    className="p-1.5 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                    title="Alejar"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="px-2 text-xs font-mono-tabular text-slate-700">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setZoom((z) => Math.min(2.0, Number((z + 0.15).toFixed(2))))
                    }
                    className="p-1.5 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                    title="Acercar"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Interactive PDF Viewport */}
            <div className="flex-1 overflow-auto p-6 flex flex-col items-center">
              {isLoadingPdf ? (
                <div className="my-auto flex flex-col items-center justify-center p-12 text-center">
                  <div className="w-9 h-9 border-3 border-slate-300 border-t-slate-900 rounded-full animate-spin mb-3" />
                  <p className="text-sm font-medium text-slate-800">
                    Preparando páginas del documento en alta definición...
                  </p>
                </div>
              ) : activePageData ? (
                <>
                  {/* Contextual Callout if no answers solved yet */}
                  {annotations.length === 0 && activePageData.status === "idle" && (
                    <div className="mb-4 max-w-2xl w-full bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-center justify-between gap-4 shadow-2xs">
                      <div className="text-xs text-slate-600">
                        <span className="font-semibold text-slate-900">
                          Hoja lista en ritaGPT:
                        </span>{" "}
                        Pulsa{" "}
                        <strong className="text-slate-900">Resolver con IA</strong>{" "}
                        para detectar los espacios en blanco y escribir las
                        respuestas a mano automáticamente.
                      </div>
                      <button
                        type="button"
                        onClick={() => solveAllPagesInternal()}
                        className="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Resolver Ahora
                      </button>
                    </div>
                  )}

                  <InteractivePageCanvas
                    page={activePageData}
                    annotations={currentPageAnnotations}
                    selectedAnnotationId={selectedAnnotationId}
                    onSelectAnnotation={(id) => {
                      setSelectedAnnotationId(id);
                      if (id) setActiveSidebarTab("exercises");
                    }}
                    onUpdateAnnotation={handleUpdateAnnotation}
                    onDeleteAnnotation={handleDeleteAnnotation}
                    onAddAnnotationAtPoint={handleAddAnnotationAtPoint}
                    isAddingMode={isAddingMode}
                    styleSettings={styleSettings}
                    allFonts={allFonts}
                    zoom={zoom}
                    showBoundingGuides={showBoundingGuides}
                  />

                  {/* Page Navigation Bar if multiple pages */}
                  {pages.length > 1 && (
                    <div className="mt-5 flex items-center gap-3 bg-white border border-slate-200 px-4 py-1.5 rounded-lg shadow-2xs">
                      <button
                        type="button"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage <= 1}
                        className="p-1 text-slate-600 hover:text-slate-900 disabled:opacity-40"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="text-xs font-mono-tabular text-slate-700">
                        Página {currentPage} de {pages.length}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setCurrentPage((p) => Math.min(pages.length, p + 1))
                        }
                        disabled={currentPage >= pages.length}
                        className="p-1 text-slate-600 hover:text-slate-900 disabled:opacity-40"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="my-auto max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center">
                  <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                  <h2 className="font-display text-base font-semibold text-slate-900">
                    Sube tu PDF, Imagen o Haz una Foto
                  </h2>
                  <p className="text-xs text-slate-500 mt-1 mb-5">
                    Detectamos los espacios en blanco con IA y escribimos las
                    respuestas simulando tu letra a mano.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => universalFileInputRef.current?.click()}
                      className="px-4 py-2 bg-blue-700 text-white text-xs font-semibold rounded-lg hover:bg-blue-800 cursor-pointer"
                    >
                      Subir PDF o Foto
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCameraModalOpen(true)}
                      className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-200 cursor-pointer"
                    >
                      Usar Cámara
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLoadSamplePdf(false)}
                      className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-200 cursor-pointer"
                    >
                      Ficha Demo
                    </button>
                  </div>
                </div>
              )}
            </div>
          </main>

          {/* RIGHT ZONE (30%): Control Deck (Handwriting Style, Custom Font Studio, Organic Mode & Exercise Inspector) */}
          <aside className="w-full lg:w-[410px] xl:w-[440px] bg-white border-t lg:border-t-0 lg:border-l border-slate-200 flex flex-col shrink-0 overflow-hidden">
            {/* Segmented Control Tabs */}
            <div className="p-3 border-b border-slate-200 bg-slate-50/60">
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-200/75 rounded-lg">
                <button
                  type="button"
                  onClick={() => setActiveSidebarTab("style")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
                    activeSidebarTab === "style"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Letra y Modo Orgánico</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSidebarTab("exercises")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
                    activeSidebarTab === "exercises"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Respuestas ({annotations.length})</span>
                </button>
              </div>
            </div>

            {/* Tab Content Area */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {activeSidebarTab === "style" ? (
                <>
                  {/* Section 1: Handwriting Typography + Custom Font Creator Button */}
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <h2 className="font-display text-sm font-semibold text-slate-900">
                        01. Tipografía Manuscrita
                      </h2>
                      <button
                        type="button"
                        onClick={() => setIsFontStudioOpen(true)}
                        className="text-xs font-semibold text-blue-700 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <PenTool className="w-3 h-3" />
                        <span>Crear / Subir mi Font</span>
                      </button>
                    </div>

                    <div className="space-y-2">
                      {allFonts.map((font) => {
                        const isSelected = styleSettings.fontId === font.id;
                        return (
                          <button
                            key={font.id}
                            type="button"
                            onClick={() =>
                              setStyleSettings((prev) => ({
                                ...prev,
                                fontId: font.id,
                              }))
                            }
                            className={`w-full text-left px-3.5 py-2.5 rounded-lg border transition-colors flex items-center justify-between gap-3 cursor-pointer ${
                              isSelected
                                ? "border-blue-600 bg-blue-50/40"
                                : "border-slate-200 hover:border-slate-300 bg-white"
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-slate-900 truncate">
                                {font.name}
                                {font.isCustom && (
                                  <span className="ml-1.5 text-[10px] font-normal text-blue-700">
                                    · Personalizada
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate">
                                {font.description}
                              </div>
                            </div>
                            <span
                              style={{
                                fontFamily: font.cssFamily,
                                fontWeight: font.baseWeight,
                                color:
                                  INK_COLORS.find(
                                    (i) => i.id === styleSettings.inkId
                                  )?.hex || "#183B8C",
                              }}
                              className="text-lg whitespace-nowrap shrink-0"
                            >
                              2x + 4 = 10
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <hr className="border-slate-200" />

                  {/* Section 2: Ink Color */}
                  <div>
                    <h2 className="font-display text-sm font-semibold text-slate-900 mb-2.5">
                      02. Tinta y Bolígrafo
                    </h2>
                    <div className="grid grid-cols-2 gap-2">
                      {INK_COLORS.map((ink) => {
                        const isSelected = styleSettings.inkId === ink.id;
                        return (
                          <button
                            key={ink.id}
                            type="button"
                            onClick={() =>
                              setStyleSettings((prev) => ({
                                ...prev,
                                inkId: ink.id,
                              }))
                            }
                            className={`px-3 py-2 rounded-lg border text-left flex items-center gap-2.5 transition-colors cursor-pointer ${
                              isSelected
                                ? "border-blue-600 bg-blue-50/40 font-semibold text-slate-900"
                                : "border-slate-200 hover:border-slate-300 text-slate-700"
                            }`}
                          >
                            <span
                              style={{ backgroundColor: ink.hex }}
                              className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/10"
                            />
                            <span className="text-xs truncate">{ink.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <hr className="border-slate-200" />

                  {/* Section 3: Organic Mode (Human Imperfections) */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h2 className="font-display text-sm font-semibold text-slate-900">
                          03. Modo Orgánico Humano
                        </h2>
                        <p className="text-xs text-slate-500">
                          Simula imperfecciones naturales de estudiante
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={styleSettings.organic.enabled}
                        onClick={() =>
                          handleUpdateOrganicSettings({
                            enabled: !styleSettings.organic.enabled,
                          })
                        }
                        className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                          styleSettings.organic.enabled
                            ? "bg-blue-700 text-white"
                            : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {styleSettings.organic.enabled ? "ACTIVO" : "DESACTIVADO"}
                      </button>
                    </div>

                    {styleSettings.organic.enabled && (
                      <div className="mt-4 space-y-4 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                        {/* Slider 1: Subtle Calculation / Answer Mistakes */}
                        <div>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <label
                              htmlFor="slider-mistakes"
                              className="font-medium text-slate-800"
                            >
                              Frecuencia de fallos leves:
                            </label>
                            <span className="font-mono-tabular font-semibold text-amber-700">
                              {styleSettings.organic.mistakeRatePercent}%
                            </span>
                          </div>
                          <input
                            id="slider-mistakes"
                            type="range"
                            min={0}
                            max={45}
                            step={5}
                            value={styleSettings.organic.mistakeRatePercent}
                            onChange={(e) =>
                              handleUpdateOrganicSettings({
                                mistakeRatePercent: Number(e.target.value),
                              })
                            }
                            className="w-full accent-blue-700 cursor-pointer"
                          />
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Introduce algún desliz de cálculo o respuesta (10–15%
                            recomendado) para mayor realismo.
                          </p>
                        </div>

                        {/* Slider 2: Simulated Cross-outs (Tachones) */}
                        <div>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <label
                              htmlFor="slider-crossouts"
                              className="font-medium text-slate-800"
                            >
                              Tachones con corrección al lado:
                            </label>
                            <span className="font-mono-tabular font-semibold text-blue-700">
                              {styleSettings.organic.crossOutRatePercent}%
                            </span>
                          </div>
                          <input
                            id="slider-crossouts"
                            type="range"
                            min={0}
                            max={60}
                            step={5}
                            value={styleSettings.organic.crossOutRatePercent}
                            onChange={(e) =>
                              handleUpdateOrganicSettings({
                                crossOutRatePercent: Number(e.target.value),
                              })
                            }
                            className="w-full accent-blue-700 cursor-pointer"
                          />
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Escribe un inicio dubitativo tachado a bolígrafo antes
                            de la solución.
                          </p>
                        </div>

                        {/* Slider 3: Stroke Slant & Pressure Variation */}
                        <div>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <label
                              htmlFor="slider-jitter"
                              className="font-medium text-slate-800"
                            >
                              Variación de inclinación y presión:
                            </label>
                            <span className="font-mono-tabular font-semibold text-slate-800">
                              {styleSettings.organic.strokeVariationPercent}%
                            </span>
                          </div>
                          <input
                            id="slider-jitter"
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={styleSettings.organic.strokeVariationPercent}
                            onChange={(e) =>
                              handleUpdateOrganicSettings(
                                {
                                  strokeVariationPercent: Number(e.target.value),
                                },
                                false
                              )
                            }
                            className="w-full accent-blue-700 cursor-pointer"
                          />
                        </div>

                        {annotations.length > 0 && (
                          <button
                            type="button"
                            onClick={handleReshuffleOrganic}
                            className="w-full py-1.5 px-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <Shuffle className="w-3.5 h-3.5" />
                            <span>Re-sortear qué ejercicios tienen fallo o tachón</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <hr className="border-slate-200" />

                  {/* Section 4: Optional AI Instructions */}
                  <div>
                    <label
                      htmlFor="custom-ai-prompt"
                      className="block font-display text-sm font-semibold text-slate-900 mb-1"
                    >
                      04. Instrucciones para ritaGPT (Opcional)
                    </label>
                    <p className="text-xs text-slate-500 mb-2">
                      Indica el nivel académico o cómo prefieres que desarrolle las
                      respuestas antes de resolver.
                    </p>
                    <textarea
                      id="custom-ai-prompt"
                      rows={2}
                      value={customInstructions}
                      onChange={(e) => setCustomInstructions(e.target.value)}
                      placeholder="Ej: Usa respuestas cortas y directas, nivel 4º ESO..."
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </>
              ) : (
                /* EXERCISES & MANUAL EDITOR TAB */
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-slate-600">
                      Haz clic en cualquier respuesta sobre el PDF para moverla,
                      ajustar su hueco o editar su contenido.
                    </div>
                    {pages.length > 1 && (
                      <button
                        type="button"
                        onClick={handleSolveCurrentPage}
                        disabled={isSolvingAll}
                        className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0"
                      >
                        Resolver pág. {currentPage}
                      </button>
                    )}
                  </div>

                  {annotations.length === 0 ? (
                    <div className="border border-slate-200 rounded-lg p-6 text-center bg-slate-50/50">
                      <p className="text-xs text-slate-600 mb-3">
                        Aún no se han generado respuestas para este documento.
                      </p>
                      <button
                        type="button"
                        onClick={() => solveAllPagesInternal()}
                        disabled={isSolvingAll || pages.length === 0}
                        className="px-3.5 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-md transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        <span>Resolver Ejercicios con ritaGPT</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {annotations.map((ann) => {
                        const isSelected = ann.id === selectedAnnotationId;
                        const pageMeta =
                          pages.find((p) => p.pageNumber === ann.pageNumber) ||
                          pages[0];
                        const computedSize = pageMeta
                          ? computeAutoFontSize(
                              ann,
                              (ann.box.width / 100) * pageMeta.widthPt,
                              (ann.box.height / 100) * pageMeta.heightPt,
                              styleSettings,
                              allFonts
                            )
                          : ann.manualFontSize;

                        return (
                          <div
                            key={ann.id}
                            onClick={() => {
                              setSelectedAnnotationId(ann.id);
                              if (ann.pageNumber !== currentPage) {
                                setCurrentPage(ann.pageNumber);
                              }
                            }}
                            className={`p-3.5 rounded-lg border transition-colors cursor-pointer ${
                              isSelected
                                ? "border-blue-600 bg-blue-50/25"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            {/* Top Metadata Row (Zero-Pill clean text with · separators) */}
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <div className="flex items-center gap-1.5 text-xs">
                                <span className="font-semibold text-slate-900">
                                  {ann.questionLabel}
                                </span>
                                <span
                                  aria-hidden="true"
                                  className="text-slate-400"
                                >
                                  ·
                                </span>
                                <span className="font-mono-tabular text-slate-500">
                                  Pág. {ann.pageNumber}
                                </span>
                                <span
                                  aria-hidden="true"
                                  className="text-slate-400"
                                >
                                  ·
                                </span>
                                <span className="font-mono-tabular text-slate-500">
                                  {computedSize}pt{" "}
                                  {ann.autoFitFont ? "(Auto)" : "(Manual)"}
                                </span>
                              </div>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteAnnotation(ann.id);
                                }}
                                title="Eliminar respuesta"
                                className="text-slate-400 hover:text-red-600 p-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Question summary */}
                            <p className="text-xs text-slate-500 line-clamp-1 mb-2.5">
                              {ann.questionSummary}
                            </p>

                            {/* Editable Answer Textarea */}
                            <div className="mb-2.5">
                              <textarea
                                rows={2}
                                value={getAnnotationActiveText(ann)}
                                onChange={(e) =>
                                  handleUpdateAnnotation(ann.id, {
                                    customText: e.target.value,
                                  })
                                }
                                onClick={(e) => e.stopPropagation()}
                                className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                              />
                            </div>

                            {/* Organic Mode Controls per Exercise */}
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100"
                            >
                              <div className="flex items-center gap-1.5">
                                {/* Toggle Correct vs Mistake */}
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateAnnotation(ann.id, {
                                      useMistake: !ann.useMistake,
                                      customText: null,
                                    })
                                  }
                                  className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 border transition-colors cursor-pointer ${
                                    ann.useMistake
                                      ? "bg-amber-50 border-amber-300 text-amber-800"
                                      : "bg-emerald-50/70 border-emerald-200 text-emerald-800"
                                  }`}
                                >
                                  {ann.useMistake ? (
                                    <>
                                      <AlertTriangle className="w-3 h-3 text-amber-600" />
                                      <span>▲ Fallo Humano</span>
                                    </>
                                  ) : (
                                    <>
                                      <Check className="w-3 h-3 text-emerald-600" />
                                      <span>● Respuesta Exacta</span>
                                    </>
                                  )}
                                </button>

                                {/* Toggle Cross-out */}
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateAnnotation(ann.id, {
                                      useCrossOut: !ann.useCrossOut,
                                    })
                                  }
                                  className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 border transition-colors cursor-pointer ${
                                    ann.useCrossOut
                                      ? "bg-blue-50 border-blue-300 text-blue-800"
                                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                  }`}
                                >
                                  <Scissors className="w-3 h-3" />
                                  <span>Tachón</span>
                                </button>
                              </div>

                              {/* Font Size Auto/Manual Switch */}
                              <div className="flex items-center gap-1 text-[11px]">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateAnnotation(ann.id, {
                                      autoFitFont: !ann.autoFitFont,
                                      manualFontSize: computedSize,
                                    })
                                  }
                                  className="text-slate-500 hover:text-slate-900 underline mr-1"
                                >
                                  {ann.autoFitFont
                                    ? "Fijar tamaño"
                                    : "Auto-ajustar"}
                                </button>
                                {!ann.autoFitFont && (
                                  <input
                                    type="number"
                                    min={9}
                                    max={38}
                                    value={ann.manualFontSize}
                                    onChange={(e) =>
                                      handleUpdateAnnotation(ann.id, {
                                        manualFontSize:
                                          Number(e.target.value) || 14,
                                      })
                                    }
                                    className="w-12 px-1 py-0.5 border border-slate-200 rounded font-mono-tabular text-center text-xs"
                                  />
                                )}
                              </div>
                            </div>

                            {/* Extra details when selected: Mistake explanation & Crossed-out word input */}
                            {isSelected && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="mt-2.5 pt-2.5 border-t border-slate-200/80 space-y-2 text-[11px]"
                              >
                                {ann.useMistake && ann.mistakeExplanation && (
                                  <div className="text-amber-800 bg-amber-50/70 px-2.5 py-1.5 rounded border border-amber-200/80">
                                    <strong>Detalle del fallo orgánico:</strong>{" "}
                                    {ann.mistakeExplanation}
                                  </div>
                                )}

                                {ann.useCrossOut && (
                                  <div className="flex items-center gap-2">
                                    <label className="text-slate-600 whitespace-nowrap">
                                      Texto tachado inicial:
                                    </label>
                                    <input
                                      type="text"
                                      value={ann.crossedOutWord}
                                      onChange={(e) =>
                                        handleUpdateAnnotation(ann.id, {
                                          crossedOutWord: e.target.value,
                                        })
                                      }
                                      className="flex-1 px-2 py-1 border border-slate-200 rounded bg-white text-slate-800"
                                    />
                                  </div>
                                )}

                                {ann.customText !== null && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUpdateAnnotation(ann.id, {
                                        customText: null,
                                      })
                                    }
                                    className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                    <span>
                                      Restaurar respuesta original de ritaGPT
                                    </span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Sticky Sidebar Action Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-600">
                <div className="font-semibold text-slate-900">
                  Exportación directa en PDF
                </div>
                <div className="text-[11px] text-slate-500">
                  Estampa tu letra y tachones en alta resolución
                </div>
              </div>
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={!pdfBytes || isExporting || pages.length === 0}
                className="px-4 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>{isExporting ? "Exportando..." : "Descargar PDF"}</span>
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
