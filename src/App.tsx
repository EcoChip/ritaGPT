import React, { useState, useRef, useEffect } from "react";
import {
  AnswerAnnotation,
  HANDWRITING_FONTS,
  HandwritingFontOption,
  INK_COLORS,
  NotebookPaperStyle,
  PdfPageData,
  SolveTargetMode,
  SolvingProgressState,
  StyleSettings,
} from "./types";
import {
  isPdfByteSignature,
  loadImagesDirectlyAsPagesAndPdf,
  renderPdfToPageImages,
} from "./utils/pdfLoader";
import { generateSampleWorksheetDirect } from "./utils/samplePdf";
import {
  buildNotebookPagesForExercises,
  generateNotebookBackgroundDataUrl,
} from "./utils/notebookGenerator";
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
import { refinePageAnnotationsWithPixels } from "./utils/blankRefiner";
import {
  getBuildTimeGeminiKey,
  solvePageViaDirectRestApi,
} from "./utils/geminiClientSolver";
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
  BookOpen,
  Layers,
} from "lucide-react";

const ATTACHED_BOOK_IMAGE_PATH = "/assets/aistudio/IMG_7476_d8d95cb2.jpeg";

function formatFriendlyErrorMessage(err: any, fallback: string): string {
  const raw = String(err?.message || err || "").trim();
  if (!raw) return fallback;
  if (/expected pattern|syntaxerror|getorinsertcomputed/i.test(raw)) {
    return "Archivo o imagen procesada en modo compatible. Pulsa 'Resolver con IA' de nuevo.";
  }
  return raw;
}

export default function App() {
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
    fontId: "fused-natural-mix",
    inkId: "bic-blue",
    solveTargetMode: "auto",
    notebookPaperStyle: "grid",
    organic: {
      enabled: true,
      mistakeRatePercent: 15,
      crossOutRatePercent: 25,
      strokeVariationPercent: 65,
      antiCloneLetterVariation: true,
    },
  });

  const universalFileInputRef = useRef<HTMLInputElement>(null);
  const allFonts: HandwritingFontOption[] = [...customFonts, ...HANDWRITING_FONTS];

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
      setStyleSettings((prev) => ({ ...prev, fontId: "fused-natural-mix" }));
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

      const renderedPages = await renderPdfToPageImages(bytes, 1.8);
      setPages(renderedPages);
      setCurrentPage(1);
      setAnnotations([]);
      setSelectedAnnotationId(null);
    } catch (err: any) {
      setErrorBanner(
        formatFriendlyErrorMessage(err, "No se pudo leer el documento.")
      );
    } finally {
      setIsLoadingPdf(false);
    }
  };

  /**
   * Loads the user's attached textbook photo (Lope de Vega — La dama boba) with 1 click
   * and sets mode to auto/notebook so it solves exercises 54–62 on a separate notebook sheet.
   */
  const handleLoadAttachedBookPhoto = async (autoSolveNow: boolean = false) => {
    setShowLanding(false);
    setIsLoadingPdf(true);
    setErrorBanner(null);
    try {
      const result = await loadImagesDirectlyAsPagesAndPdf([
        ATTACHED_BOOK_IMAGE_PATH,
      ]);
      setPdfBytes(result.pdfBytes);
      setPdfFileName("Lope_de_Vega_La_dama_boba.pdf");
      setPages(result.pages);
      setCurrentPage(1);
      setAnnotations([]);
      setSelectedAnnotationId(null);

      if (autoSolveNow) {
        setTimeout(() => {
          solveSourcePages(result.pages, "notebook");
        }, 120);
      }
    } catch (err: any) {
      setErrorBanner(
        formatFriendlyErrorMessage(
          err,
          "No se pudo cargar la imagen del libro de literatura."
        )
      );
    } finally {
      setIsLoadingPdf(false);
    }
  };

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
      const firstBuffer = await firstFile.arrayBuffer();
      const firstBytes = new Uint8Array(firstBuffer);
      const isRealPdf = isPdfByteSignature(firstBytes);

      if (isRealPdf) {
        await loadPdfFromBytes(firstBytes, firstFile.name);
      } else {
        const result = await loadImagesDirectlyAsPagesAndPdf(files);
        const baseTitle = firstFile.name.replace(/\.[^.]+$/, "") || "documento";
        setPdfBytes(result.pdfBytes);
        setPdfFileName(`${baseTitle}.pdf`);
        setPages(result.pages);
        setCurrentPage(1);
        setAnnotations([]);
        setSelectedAnnotationId(null);
      }
    } catch (err: any) {
      setErrorBanner(
        formatFriendlyErrorMessage(
          err,
          "No se pudo procesar el archivo o imagen seleccionada."
        )
      );
    } finally {
      setIsLoadingPdf(false);
    }
  };

  const handleCapturedPhotoFile = async (photoFile: File) => {
    setShowLanding(false);
    setIsLoadingPdf(true);
    setErrorBanner(null);
    try {
      const result = await loadImagesDirectlyAsPagesAndPdf([photoFile]);
      setPdfBytes(result.pdfBytes);
      setPdfFileName(photoFile.name.replace(/\.jpg$/i, ".pdf"));
      setPages(result.pages);
      setCurrentPage(1);
      setAnnotations([]);
      setSelectedAnnotationId(null);
    } catch (err: any) {
      setErrorBanner(
        formatFriendlyErrorMessage(
          err,
          "No se pudo procesar la foto capturada."
        )
      );
    } finally {
      setIsLoadingPdf(false);
    }
  };

  const handleLoadSamplePdf = async (autoSolve: boolean = false) => {
    setIsLoadingPdf(true);
    setErrorBanner(null);
    try {
      const { pdfBytes: sampleBytes, pages: samplePages } =
        await generateSampleWorksheetDirect();
      setPdfBytes(sampleBytes);
      setPdfFileName("ficha_ejercicios_demo.pdf");
      setPages(samplePages);
      setCurrentPage(1);
      setAnnotations([]);
      setSelectedAnnotationId(null);
      if (autoSolve) {
        setTimeout(() => {
          solveSourcePages(samplePages);
        }, 100);
      }
    } catch (err: any) {
      console.error("Error generating sample worksheet:", err);
    } finally {
      setIsLoadingPdf(false);
    }
  };

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

    // Only place crossed-out words ("tachones") in boxes wide enough to fit both the crossed-out word and the answer
    // Never place a crossed-out word inside a tiny diagram label box (short_blank or narrow box < 24% width)
    const eligibleForCrossOut = items
      .map((item, idx) => ({
        idx,
        eligible:
          Boolean(item.isNotebookEntry) ||
          (item.subjectType !== "short_blank" &&
            item.box.width >= 24 &&
            item.box.height >= 4.2),
        score: seededRandom(item.seed + extraSeedOffset, 29),
      }))
      .filter((x) => x.eligible)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.idx);

    const mistakeSet = new Set(indicesByMistake.slice(0, targetMistakes));
    const crossOutSet = new Set(
      eligibleForCrossOut.slice(
        0,
        Math.min(targetCrossOuts, eligibleForCrossOut.length)
      )
    );

    return items.map((ann, idx) => ({
      ...ann,
      seed: ann.seed + extraSeedOffset,
      useMistake: mistakeSet.has(idx),
      useCrossOut: crossOutSet.has(idx),
    }));
  };

  /**
   * Calls /api/solve-page (served by Express in AI Studio Preview or by public/_worker.js on Cloudflare Pages/Workers).
   * If deployed on a pure static host (e.g. GitHub Pages or static Cloudflare build without Worker runtime)
   * where /api/solve-page returns 404/405/missingKey, automatically falls back to calling Gemini REST API directly
   * with the build-time environment variable (GEMINI_API_KEY / VITE_GEMINI_API_KEY).
   */
  const fetchPageSolutionFromApi = async (pageObj: PdfPageData) => {
    const isJpeg = pageObj.imageDataUrl.startsWith("data:image/jpeg");
    const mimeType = isJpeg ? "image/jpeg" : "image/png";
    const payload = JSON.stringify({
      imageBase64: pageObj.imageDataUrl,
      mimeType,
      pageNumber: pageObj.pageNumber,
      customInstructions: customInstructions.trim() || undefined,
    });

    let serverStatus = 0;
    let rawText = "";
    let networkFailed = false;

    try {
      const res = await new Promise<{ status: number; rawText: string }>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/solve-page", true);
          xhr.setRequestHeader("Content-Type", "application/json");
          xhr.timeout = 45000;
          xhr.onload = () => {
            resolve({
              status: xhr.status,
              rawText: xhr.responseText || "",
            });
          };
          xhr.onerror = () => {
            reject(new Error("Network error"));
          };
          xhr.ontimeout = () => {
            reject(
              new Error(
                "Tiempo de espera agotado al analizar la página. Pulsa 'Resolver con IA' de nuevo."
              )
            );
          };
          xhr.send(payload);
        }
      );
      serverStatus = res.status;
      rawText = res.rawText;
    } catch {
      networkFailed = true;
    }

    let data: any = null;
    if (!networkFailed && rawText) {
      try {
        data = JSON.parse(rawText);
      } catch {
        data = null;
      }
    }

    // Success from /api/solve-page (Express server.ts or Cloudflare _worker.js)
    if (
      !networkFailed &&
      serverStatus >= 200 &&
      serverStatus < 300 &&
      data &&
      Array.isArray(data.exercises)
    ) {
      return data;
    }

    // If /api/solve-page returned 404, 405, non-JSON HTML (static hosting), or missing runtime key,
    // try the build-time key fallback (VITE_GEMINI_API_KEY / GEMINI_API_KEY)
    const buildTimeKey = getBuildTimeGeminiKey();
    if (buildTimeKey) {
      return await solvePageViaDirectRestApi({
        apiKey: buildTimeKey,
        imageBase64: pageObj.imageDataUrl,
        mimeType,
        pageNumber: pageObj.pageNumber,
        customInstructions: customInstructions.trim() || undefined,
      });
    }

    if (serverStatus === 404 || serverStatus === 405 || !data) {
      throw new Error(
        "En Cloudflare Workers/Pages o GitHub: asegúrate de subir el último commit (con public/_worker.js y wrangler.toml) y añadir la variable GEMINI_API_KEY en Settings → Variables and Secrets."
      );
    }

    throw new Error(
      data?.error ||
        "Error al resolver la página. En Cloudflare/GitHub verifica que GEMINI_API_KEY esté configurada en Variables and Secrets."
    );
  };

  /**
   * Re-runs the pixel-level blank refiner on the active page's annotations with 1 click
   * so boxes snap cleanly into empty white spaces and never overlap printed question lines.
   */
  const handleAutoRefineCurrentPageBoxes = async () => {
    const activePageObj = pages.find((p) => p.pageNumber === currentPage);
    if (!activePageObj || activePageObj.isNotebookPage) return;

    const pageAnns = annotations.filter((a) => a.pageNumber === currentPage);
    if (pageAnns.length === 0) return;

    const refined = await refinePageAnnotationsWithPixels(
      activePageObj.imageDataUrl,
      pageAnns
    );
    setAnnotations((prev) =>
      prev.map((ann) => {
        if (ann.pageNumber !== currentPage) return ann;
        return refined.find((r) => r.id === ann.id) || ann;
      })
    );
  };

  /**
   * Solves all original source pages (ignoring already-generated notebook pages)
   * and either places answers in-place OR generates separate notebook pages ("En tu cuaderno aparte").
   */
  const solveSourcePages = async (
    overrideSourcePages?: PdfPageData[],
    forceMode?: SolveTargetMode
  ) => {
    const baseSourcePages = (overrideSourcePages || pages).filter(
      (p) => !p.isNotebookPage
    );
    if (baseSourcePages.length === 0 || isSolvingAll) return;

    const activeTargetMode = forceMode || styleSettings.solveTargetMode;
    setIsSolvingAll(true);
    setErrorBanner(null);

    // Reset any previously generated notebook pages before re-solving
    setPages(baseSourcePages.map((p) => ({ ...p, status: "idle" })));

    const total = baseSourcePages.length;
    setSolvingProgress({
      active: true,
      currentPage: 1,
      totalPages: total,
      completedPages: 0,
      statusText: `Analizando página 1 de ${total} con ritaGPT...`,
    });

    try {
      let currentPagesList: PdfPageData[] = [...baseSourcePages];
      let accumulatedAnnotations: AnswerAnnotation[] = [];
      let firstCreatedNotebookPageNum: number | null = null;

      for (let i = 0; i < baseSourcePages.length; i++) {
        const pageObj = baseSourcePages[i];
        setCurrentPage(pageObj.pageNumber);
        setPages((prev) =>
          prev.map((p) =>
            p.pageNumber === pageObj.pageNumber ? { ...p, status: "solving" } : p
          )
        );

        setSolvingProgress({
          active: true,
          currentPage: i + 1,
          totalPages: total,
          completedPages: i,
          statusText: `Resolviendo página ${i + 1} de ${total} · Analizando ejercicios y ajustando huecos...`,
        });

        const data = await fetchPageSolutionFromApi(pageObj);
        const rawExercises = Array.isArray(data.exercises) ? data.exercises : [];
        const pageTitle = data.pageSummary || `Página ${pageObj.pageNumber}`;

        const useSeparateNotebook =
          activeTargetMode === "notebook" ||
          (activeTargetMode === "auto" && Boolean(data.requiresSeparateNotebook));

        if (useSeparateNotebook && rawExercises.length > 0) {
          // Build separate notebook page(s) for this textbook page!
          const nextPageNumber = currentPagesList.length + 1;
          const { notebookPages, notebookAnnotations } =
            buildNotebookPagesForExercises(
              rawExercises,
              nextPageNumber,
              pageObj.pageNumber,
              pageTitle,
              styleSettings.notebookPaperStyle
            );

          if (firstCreatedNotebookPageNum === null && notebookPages.length > 0) {
            firstCreatedNotebookPageNum = notebookPages[0].pageNumber;
          }

          const distributed = applyOrganicDistribution(notebookAnnotations);
          currentPagesList = currentPagesList
            .map((p) =>
              p.pageNumber === pageObj.pageNumber
                ? { ...p, status: "solved" as const, pageSummary: pageTitle }
                : p
            )
            .concat(notebookPages);

          accumulatedAnnotations = [...accumulatedAnnotations, ...distributed];
          setPages([...currentPagesList]);
          setAnnotations([...accumulatedAnnotations]);
        } else {
          // Place answers directly in the blank spaces of the worksheet
          const inPlaceAnnotations: AnswerAnnotation[] = rawExercises.map(
            (ex: any, index: number) => {
              const box2d =
                Array.isArray(ex.blankBox2d) && ex.blankBox2d.length === 4
                  ? ex.blankBox2d
                  : [150 + index * 110, 80, 210 + index * 110, 850];

              const [ymin, xmin, ymax, xmax] = box2d;
              const rawW = (xmax - xmin) / 10;
              const rawH = (ymax - ymin) / 10;
              const isSmallLabel =
                ex.subjectType === "short_blank" ||
                (rawW <= 26 && rawH <= 6.5);

              const xPercent = Math.max(0.8, Math.min(93, xmin / 10));
              const yPercent = Math.max(0.8, Math.min(95, ymin / 10));
              const widthPercent = Math.max(
                isSmallLabel ? 5.5 : 8,
                Math.min(96.5 - xPercent, rawW)
              );
              const heightPercent = Math.max(
                isSmallLabel ? 1.9 : 2.6,
                Math.min(32, rawH)
              );

              return {
                id: `p${pageObj.pageNumber}-ex${index + 1}-${Date.now()}`,
                pageNumber: pageObj.pageNumber,
                questionLabel: ex.questionLabel || `Ej. ${index + 1}`,
                questionSummary: ex.questionSummary || "Ejercicio detectado",
                subjectType: isSmallLabel
                  ? "short_blank"
                  : ex.subjectType || "open_text",
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
                manualFontSize: 15,
                seed: pageObj.pageNumber * 100 + index * 17 + 1,
              };
            }
          );

          // Refine every box against the actual worksheet pixels so diagram boxes snap to their white cavity
          // and open-text boxes with a printed question line inside the top border shift below the printed question!
          const pixelRefined = await refinePageAnnotationsWithPixels(
            pageObj.imageDataUrl,
            inPlaceAnnotations
          );
          const distributed = applyOrganicDistribution(pixelRefined);

          currentPagesList = currentPagesList.map((p) =>
            p.pageNumber === pageObj.pageNumber
              ? { ...p, status: "solved" as const, pageSummary: pageTitle }
              : p
          );
          accumulatedAnnotations = [...accumulatedAnnotations, ...distributed];
          setPages([...currentPagesList]);
          setAnnotations([...accumulatedAnnotations]);
        }

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

      // If separate notebook sheets were generated, automatically jump to the first notebook page so the user sees the handwritten answers immediately!
      if (firstCreatedNotebookPageNum !== null) {
        setCurrentPage(firstCreatedNotebookPageNum);
      }

      setActiveSidebarTab("exercises");
    } catch (err: any) {
      setErrorBanner(
        formatFriendlyErrorMessage(
          err,
          "No se pudieron resolver los ejercicios. Inténtalo de nuevo."
        )
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

  /**
   * Updates the background paper style of any existing generated notebook pages in real time
   */
  const handleChangeNotebookPaperStyle = (nextPaper: NotebookPaperStyle) => {
    setStyleSettings((prev) => ({
      ...prev,
      notebookPaperStyle: nextPaper,
    }));

    setPages((prev) => {
      let nbCounter = 0;
      return prev.map((p) => {
        if (!p.isNotebookPage) return p;
        nbCounter += 1;
        const bg = generateNotebookBackgroundDataUrl(
          nextPaper,
          p.pageSummary || "Cuaderno ritaGPT",
          nbCounter
        );
        return {
          ...p,
          imageDataUrl: bg.imageDataUrl,
        };
      });
    });
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
      correctAnswer: "Respuesta escrita a mano",
      organicMistakeAnswer: "Respuesta con leve fallo",
      mistakeExplanation: "Variante manual editable",
      crossedOutWord: "error",
      customText: null,
      box: {
        x: Number(xPercent.toFixed(2)),
        y: Number(yPercent.toFixed(2)),
        width: 38,
        height: 6,
      },
      useMistake: false,
      useCrossOut:
        styleSettings.organic.enabled &&
        styleSettings.organic.crossOutRatePercent >= 30,
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

  const handleDownloadPdf = async (onlyNotebook: boolean = false) => {
    if (pages.length === 0 || isExporting) return;
    setIsExporting(true);
    setErrorBanner(null);
    try {
      const modifiedBytes = await exportAnnotatedPdfBytes(
        pdfBytes || new Uint8Array(0),
        pages,
        annotations,
        styleSettings,
        allFonts,
        onlyNotebook
      );
      const blob = new Blob([modifiedBytes as unknown as BlobPart], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const baseName = pdfFileName.replace(/\.pdf$/i, "");
      link.href = url;
      link.download = onlyNotebook
        ? `${baseName}_cuaderno_aparte_ritaGPT.pdf`
        : `${baseName}_ritaGPT_manuscrito.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorBanner(
        formatFriendlyErrorMessage(
          err,
          "Error al generar el archivo PDF final."
        )
      );
    } finally {
      setIsExporting(false);
    }
  };

  const activePageData =
    pages.find((p) => p.pageNumber === currentPage) || pages[0];
  const currentPageAnnotations = annotations.filter(
    (a) => a.pageNumber === currentPage
  );
  const hasNotebookPages = pages.some((p) => p.isNotebookPage);

  const totalMistakesCount = annotations.filter((a) => a.useMistake).length;
  const totalCrossOutsCount = annotations.filter((a) => a.useCrossOut).length;

  const progressPercentage =
    solvingProgress.totalPages > 0
      ? Math.round(
          ((solvingProgress.completedPages +
            (isSolvingAll &&
            solvingProgress.completedPages < solvingProgress.totalPages
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
        accept="application/pdf,image/jpeg,image/png,image/webp,image/*,.pdf,.jpg,.jpeg,.png"
        onChange={handleUniversalFilesSelected}
        className="hidden"
      />

      {/* Custom Font Creator & Multi-Font Fusion Modal */}
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
        {/* Zone 1: Brand Title */}
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
            onClick={() => handleLoadAttachedBookPhoto(true)}
            className="hover:text-blue-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Ejemplo Libro en Cuaderno
          </button>
          <button
            type="button"
            onClick={() => setIsFontStudioOpen(true)}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Fusionar Mis Fuentes
          </button>
          <button
            type="button"
            onClick={() => {
              setShowLanding(false);
              solveSourcePages();
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
              onClick={() => handleDownloadPdf(false)}
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
                Página {solvingProgress.currentPage} de{" "}
                {solvingProgress.totalPages} (
                {solvingProgress.totalPages - solvingProgress.completedPages}{" "}
                restantes)
              </span>
            </div>
            <div className="flex items-center gap-3 sm:w-64">
              <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  style={{
                    width: `${Math.min(100, Math.max(8, progressPercentage))}%`,
                  }}
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
                  Rellenador de PDFs · Cuaderno Aparte para Libros · Fusión de Fuentes Anti-Clon
                </div>

                <h1
                  style={{ fontSize: "clamp(3.25rem, 6vw, 5.25rem)" }}
                  className="font-display font-bold tracking-tight text-slate-900 leading-none"
                >
                  ritaGPT
                </h1>

                <p className="text-base sm:text-lg text-slate-600 max-w-2xl leading-relaxed">
                  Sube una <strong>ficha con huecos</strong> o la <strong>foto de una página de libro</strong> (como literatura o historia). ritaGPT detecta si debe escribir sobre los huecos o generar <strong>hojas de cuaderno aparte</strong> con todas las respuestas a mano, fusionando varias fuentes para que dos letras repetidas (como dos <em>"a"</em>) nunca sean iguales.
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
                    onClick={() => handleLoadAttachedBookPhoto(true)}
                    className="px-4 py-3.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl transition-colors duration-75 flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <BookOpen className="w-4 h-4 text-blue-300" />
                    <span>Resolver Foto "La dama boba" en Cuaderno</span>
                  </button>
                </div>
              </div>

              {/* Right Interactive Preview Card */}
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <span className="text-xs font-semibold text-slate-900">
                    Fusión Multi-Fuente + Cuaderno Aparte
                  </span>
                  <span className="text-xs font-mono-tabular text-slate-500">
                    Anti-Clon Activo
                  </span>
                </div>

                {/* Notebook Grid Preview */}
                <div className="bg-[#FCFBF7] border border-slate-200 rounded-xl p-4 space-y-2 relative overflow-hidden">
                  <div className="text-[11px] font-mono-tabular text-slate-500 border-b border-red-200 pb-1">
                    Lope de Vega: La dama boba · Actividades en el cuaderno
                  </div>
                  <p className="text-xl text-[#183B8C] leading-snug pt-1">
                    {"54) El teatro dependía de la clase social; hoy depende del precio de la entrada.".split(
                      ""
                    ).map((ch, idx) => {
                      const families = [
                        "'Caveat', cursive",
                        "'Kalam', cursive",
                        "'Patrick Hand', cursive",
                      ];
                      return (
                        <span
                          key={idx}
                          style={{
                            fontFamily: families[idx % families.length],
                          }}
                        >
                          {ch}
                        </span>
                      );
                    })}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => setIsFontStudioOpen(true)}
                    className="text-xs font-semibold text-blue-700 hover:underline flex items-center gap-1.5 cursor-pointer"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Subir y fusionar varias fuentes →</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCameraModalOpen(true)}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Hacer Foto</span>
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
                  onClick={() => handleLoadAttachedBookPhoto(true)}
                  className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 flex flex-col justify-between cursor-pointer transition-colors"
                >
                  <div>
                    <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center mb-3">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <h3 className="font-display text-sm font-bold text-slate-900 mb-1.5">
                      01. Hojas de Libro → Cuaderno Aparte
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Si subes una foto de un libro cuyos ejercicios dicen "Hazlo en tu cuaderno", ritaGPT crea hojas de cuaderno cuadriculadas o rayadas aparte con todas las respuestas numeradas.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-100 text-xs font-semibold text-blue-700 flex items-center justify-between">
                    <span>Probar con "La dama boba"</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </div>

                {/* Card 2 */}
                <div
                  onClick={() => setIsFontStudioOpen(true)}
                  className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 flex flex-col justify-between cursor-pointer transition-colors"
                >
                  <div>
                    <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center mb-3">
                      <Layers className="w-4 h-4" />
                    </div>
                    <h3 className="font-display text-sm font-bold text-slate-900 mb-1.5">
                      02. Fusión de Varias Fuentes (Anti-Clon)
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Sube varias fuentes (.TTF/.OTF) o dibuja hasta 3 variantes de cada letra para fusionarlas. Así ninguna letra "a" repetida tendrá el mismo trazo.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-100 text-xs font-semibold text-blue-700 flex items-center justify-between">
                    <span>Fusionar mis fuentes</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </div>

                {/* Card 3 */}
                <div
                  onClick={() => universalFileInputRef.current?.click()}
                  className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 flex flex-col justify-between cursor-pointer transition-colors"
                >
                  <div>
                    <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center mb-3">
                      <ImageIcon className="w-4 h-4" />
                    </div>
                    <h3 className="font-display text-sm font-bold text-slate-900 mb-1.5">
                      03. PDFs, Fotos y Cámara Apple
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Abre el menú nativo de tu dispositivo (Fototeca, Hacer Foto o Archivos). Rellena huecos directamente encima de fichas o genera hojas de cuaderno.
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-100 text-xs font-semibold text-blue-700 flex items-center justify-between">
                    <span>Subir archivo o foto</span>
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
        /* VIEW 2: FULL WORKSPACE (PDF & PHOTO EDITOR + SEPARATE NOTEBOOK + FUSED HANDWRITING) */
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* LEFT ZONE (70%): Interactive PDF Preview & Canvas Stage */}
          <main className="flex-1 flex flex-col bg-slate-100/80 overflow-hidden">
            {/* Workspace Sub-Toolbar */}
            <div className="bg-white border-b border-slate-200 px-5 py-2.5 flex flex-wrap items-center justify-between gap-4">
              {/* Left: File & Page Metadata */}
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="font-medium text-slate-900 truncate max-w-[170px]">
                  {pdfFileName}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">
                  Pág. {currentPage}/{pages.length}
                </span>
                {activePageData?.isNotebookPage && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-blue-700">
                      Hoja de Cuaderno Aparte
                    </span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">
                  {annotations.length} respuestas
                </span>
              </div>

              {/* Right: Canvas Manipulation Controls */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => universalFileInputRef.current?.click()}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Subir PDF / Foto</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleLoadAttachedBookPhoto(false)}
                  title="Cargar la foto del libro La dama boba para resolver en cuaderno aparte"
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5 text-blue-700" />
                  <span>Foto Libro Demo</span>
                </button>

                <button
                  type="button"
                  onClick={() => solveSourcePages()}
                  disabled={isSolvingAll || pages.length === 0}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>
                    {isSolvingAll
                      ? `Resolviendo (${solvingProgress.currentPage}/${solvingProgress.totalPages})...`
                      : annotations.length > 0
                      ? "Re-Analizar"
                      : "Resolver con IA"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => solveSourcePages(undefined, "notebook")}
                  disabled={isSolvingAll || pages.length === 0}
                  title="Resuelve todos los ejercicios de la imagen en hojas de cuaderno aparte"
                  className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 disabled:opacity-50 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Resolver en Cuaderno Aparte</span>
                </button>

                {annotations.some(
                  (a) => a.pageNumber === currentPage && !a.isNotebookEntry
                ) && (
                  <button
                    type="button"
                    onClick={handleAutoRefineCurrentPageBoxes}
                    title="Encaja automáticamente las cajas en los huecos blancos sin pisar las preguntas impresas"
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Sliders className="w-3.5 h-3.5 text-blue-700" />
                    <span>Ajustar Huecos</span>
                  </button>
                )}

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
                  <span>{isAddingMode ? "Clic en hoja..." : "Añadir Caja"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowBoundingGuides((v) => !v)}
                  title="Mostrar u ocultar recuadros delimitadores"
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

            {/* Page Switcher Bar when multiple pages or Notebook sheets exist */}
            {pages.length > 1 && (
              <div className="bg-slate-200/70 border-b border-slate-200 px-5 py-2 flex items-center justify-between gap-4">
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  {pages.map((p) => {
                    const isCurrent = p.pageNumber === currentPage;
                    return (
                      <button
                        key={p.pageNumber}
                        type="button"
                        onClick={() => setCurrentPage(p.pageNumber)}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                          isCurrent
                            ? "bg-slate-900 text-white shadow-2xs"
                            : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200"
                        }`}
                      >
                        {p.isNotebookPage ? (
                          <>
                            <BookOpen className="w-3 h-3 text-blue-400" />
                            <span>Cuaderno (Pág. {p.pageNumber})</span>
                          </>
                        ) : (
                          <span>Hoja Original {p.pageNumber}</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {hasNotebookPages && (
                  <button
                    type="button"
                    onClick={() => handleDownloadPdf(true)}
                    disabled={isExporting}
                    className="px-3 py-1 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-md whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    <span>Descargar Solo Cuaderno (PDF)</span>
                  </button>
                )}
              </div>
            )}

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
                  {annotations.length === 0 && activePageData.status === "idle" && (
                    <div className="mb-4 max-w-2xl w-full bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
                      <div className="text-xs text-slate-600">
                        <span className="font-semibold text-slate-900">
                          Documento cargado:
                        </span>{" "}
                        Elige si quieres rellenar los huecos encima o resolver
                        las actividades en hojas de cuaderno aparte.
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => solveSourcePages()}
                          className="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-md whitespace-nowrap cursor-pointer"
                        >
                          Resolver Automático
                        </button>
                        <button
                          type="button"
                          onClick={() => solveSourcePages(undefined, "notebook")}
                          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md whitespace-nowrap cursor-pointer"
                        >
                          Resolver en Cuaderno Aparte
                        </button>
                      </div>
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
              ) : null}
            </div>
          </main>

          {/* RIGHT ZONE (30%): Control Deck */}
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
                  <span>Cuaderno, Fuentes y Modo</span>
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
                  {/* Section 0: Solve Mode (In-place vs Separate Notebook) */}
                  <div>
                    <h2 className="font-display text-sm font-semibold text-slate-900 mb-2">
                      01. Modo de Resolución (Hoja vs Cuaderno Aparte)
                    </h2>
                    <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg mb-3">
                      {[
                        { id: "auto", label: "Automático" },
                        { id: "notebook", label: "En Cuaderno" },
                        { id: "in_place", label: "En la Hoja" },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            setStyleSettings((prev) => ({
                              ...prev,
                              solveTargetMode: opt.id as SolveTargetMode,
                            }))
                          }
                          className={`py-1.5 px-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                            styleSettings.solveTargetMode === opt.id
                              ? "bg-white text-slate-900 shadow-2xs"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    {/* Notebook Paper Style Selector */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600">
                        Papel del cuaderno aparte:
                      </span>
                      <div className="flex items-center gap-1">
                        {[
                          { id: "grid", label: "Cuadrícula" },
                          { id: "lined", label: "Rayas" },
                          { id: "blank", label: "Blanco" },
                        ].map((pStyle) => (
                          <button
                            key={pStyle.id}
                            type="button"
                            onClick={() =>
                              handleChangeNotebookPaperStyle(
                                pStyle.id as NotebookPaperStyle
                              )
                            }
                            className={`px-2 py-1 rounded text-[11px] font-medium border cursor-pointer ${
                              styleSettings.notebookPaperStyle === pStyle.id
                                ? "bg-blue-50 border-blue-600 text-blue-800"
                                : "bg-white border-slate-200 text-slate-600"
                            }`}
                          >
                            {pStyle.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <hr className="border-slate-200" />

                  {/* Section 1: Handwriting Typography + Multi-Font Fusion Button */}
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <h2 className="font-display text-sm font-semibold text-slate-900">
                        02. Tipografía y Fusión Anti-Clon
                      </h2>
                      <button
                        type="button"
                        onClick={() => setIsFontStudioOpen(true)}
                        className="text-xs font-semibold text-blue-700 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>Subir / Fusionar Fonts</span>
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
                              La dama boba
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
                      03. Tinta y Bolígrafo
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

                  {/* Section 3: Organic Mode (Human Imperfections & Anti-Clone) */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h2 className="font-display text-sm font-semibold text-slate-900">
                          04. Modo Orgánico Humano
                        </h2>
                        <p className="text-xs text-slate-500">
                          Variación de letras repetidas, tachones y deslices
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
                        {/* Anti-Clone Toggle */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-800">
                            Variar letras repetidas (ej. cada "a" distinta):
                          </span>
                          <input
                            type="checkbox"
                            checked={
                              styleSettings.organic.antiCloneLetterVariation
                            }
                            onChange={(e) =>
                              handleUpdateOrganicSettings(
                                { antiCloneLetterVariation: e.target.checked },
                                false
                              )
                            }
                            className="w-4 h-4 accent-blue-700 cursor-pointer"
                          />
                        </div>

                        {/* Slider 1: Mistakes */}
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
                        </div>

                        {/* Slider 2: Cross-outs */}
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
                            <span>
                              Re-sortear qué ejercicios tienen fallo o tachón
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                /* EXERCISES & MANUAL EDITOR TAB */
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-slate-600">
                      Haz clic en cualquier respuesta para ir a su hoja, moverla
                      o editarla.
                    </div>
                  </div>

                  {annotations.length === 0 ? (
                    <div className="border border-slate-200 rounded-lg p-6 text-center bg-slate-50/50 space-y-3">
                      <p className="text-xs text-slate-600">
                        Aún no se han generado respuestas para este documento.
                      </p>
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => solveSourcePages()}
                          disabled={isSolvingAll || pages.length === 0}
                          className="w-full py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-md transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Wand2 className="w-3.5 h-3.5" />
                          <span>Resolver Automático con ritaGPT</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => solveSourcePages(undefined, "notebook")}
                          disabled={isSolvingAll || pages.length === 0}
                          className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-md transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          <span>Resolver en Hojas de Cuaderno Aparte</span>
                        </button>
                      </div>
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
                                  {ann.isNotebookEntry
                                    ? `Cuaderno (Pág. ${ann.pageNumber})`
                                    : `Pág. ${ann.pageNumber}`}
                                </span>
                                <span
                                  aria-hidden="true"
                                  className="text-slate-400"
                                >
                                  ·
                                </span>
                                <span className="font-mono-tabular text-slate-500">
                                  {computedSize}pt
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

                            <p className="text-xs text-slate-500 line-clamp-1 mb-2.5">
                              {ann.questionSummary}
                            </p>

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

                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100"
                            >
                              <div className="flex items-center gap-1.5">
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
                                      <span>● Exacta</span>
                                    </>
                                  )}
                                </button>

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
                                  {ann.autoFitFont ? "Fijar tamaño" : "Auto"}
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
                                    <span>Restaurar original</span>
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
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
              {hasNotebookPages ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleDownloadPdf(true)}
                    disabled={isExporting}
                    className="flex-1 py-2.5 px-3 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Descargar Cuaderno</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadPdf(false)}
                    disabled={isExporting}
                    className="py-2.5 px-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>Hoja + Cuaderno</span>
                  </button>
                </>
              ) : (
                <>
                  <div className="text-xs text-slate-600">
                    <div className="font-semibold text-slate-900">
                      Exportación en PDF
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Fusión de letra y tachones
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDownloadPdf(false)}
                    disabled={!pdfBytes || isExporting || pages.length === 0}
                    className="px-4 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>{isExporting ? "Exportando..." : "Descargar PDF"}</span>
                  </button>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
