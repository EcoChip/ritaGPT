export type HandwritingFontId = string;

export interface HandwritingFontOption {
  id: HandwritingFontId;
  name: string;
  cssFamily: string;
  description: string;
  baseWeight: number;
  lineHeightMultiplier: number;
  isCustom?: boolean;
  customType?: "uploaded_file" | "drawn_glyphs" | "fused_fonts";
  /** Base64 data URL for a single uploaded TTF/OTF/WOFF font */
  fontDataUrl?: string;
  /** Multiple uploaded font data URLs when fusing several uploaded font files */
  fusedFontDataUrls?: { familyName: string; dataUrl: string; fileName: string }[];
  /** List of CSS font-family strings to alternate character-by-character so repeated letters (e.g. 'a') never look identical */
  fusedCssFamilies?: string[];
  /** Map of character -> single PNG data URL (legacy compatibility) */
  glyphMap?: Record<string, string>;
  /** Map of character -> array of PNG data URLs (multiple hand-drawn variants per letter, e.g. a1, a2, a3) */
  glyphVariantsMap?: Record<string, string[]>;
  /** Custom slant in degrees */
  customSlantDeg?: number;
  /** Custom letter spacing in px */
  customLetterSpacing?: number;
}

export type InkColorId = "bic-blue" | "gel-black" | "graphite" | "red-pen";

export interface InkColorOption {
  id: InkColorId;
  name: string;
  hex: string;
  rgb: [number, number, number];
  opacityBase: number;
}

export type NotebookPaperStyle = "grid" | "lined" | "blank";
export type SolveTargetMode = "auto" | "in_place" | "notebook";

export interface OrganicSettings {
  enabled: boolean;
  /** Percentage of answers that deliberately include a subtle human mistake (0 - 50) */
  mistakeRatePercent: number;
  /** Percentage of answers that include a realistic crossed-out word/number before the answer (0 - 60) */
  crossOutRatePercent: number;
  /** Intensity of stroke angle, baseline jitter, and ink pressure variation (0 - 100) */
  strokeVariationPercent: number;
  /** Ensures repeated letters (e.g. multiple 'a's) vary in font/shape/scale so they are never identical */
  antiCloneLetterVariation: boolean;
}

export interface StyleSettings {
  fontId: HandwritingFontId;
  inkId: InkColorId;
  organic: OrganicSettings;
  solveTargetMode: SolveTargetMode;
  notebookPaperStyle: NotebookPaperStyle;
  /** Global handwriting font size in pt (default 19pt) */
  baseFontSize: number;
  /** When true (default), all handwriting answers are kept at the same uniform font size (19pt) */
  uniformFontSize: boolean;
}

export interface NormalizedBox {
  /** Percentage 0 - 100 from left of page */
  x: number;
  /** Percentage 0 - 100 from top of page */
  y: number;
  /** Percentage 0 - 100 of page width */
  width: number;
  /** Percentage 0 - 100 of page height */
  height: number;
}

export interface AnswerAnnotation {
  id: string;
  pageNumber: number;
  questionLabel: string;
  questionSummary: string;
  subjectType: "math" | "short_blank" | "open_text" | "multiple_choice";
  correctAnswer: string;
  organicMistakeAnswer: string;
  mistakeExplanation: string;
  crossedOutWord: string;
  /** Editable override text when user edits manually; null means use correctAnswer or organicMistakeAnswer */
  customText: string | null;
  /** Normalized bounding box in percentage (0-100) of page dimensions */
  box: NormalizedBox;
  /** Whether this specific exercise currently displays the organic human mistake */
  useMistake: boolean;
  /** Whether this specific exercise displays a crossed-out word at the start */
  useCrossOut: boolean;
  /** Whether font size automatically adapts to box dimensions */
  autoFitFont: boolean;
  /** Manual font size in px (at 1x base scale) when autoFitFont is false */
  manualFontSize: number;
  /** Deterministic seed for organic jitter, slant, and ink pressure */
  seed: number;
  /** True if this annotation is placed on a generated notebook page ("En tu cuaderno") */
  isNotebookEntry?: boolean;
}

export interface PdfPageData {
  pageNumber: number;
  /** High-DPI data URL of the rendered PDF page */
  imageDataUrl: string;
  /** Original PDF width in points */
  widthPt: number;
  /** Original PDF height in points */
  heightPt: number;
  status: "idle" | "solving" | "solved" | "error";
  pageSummary?: string;
  errorMessage?: string;
  /** True if this page is an automatically generated separate notebook sheet */
  isNotebookPage?: boolean;
  /** Source page number that generated this notebook sheet */
  sourcePageNumber?: number;
}

export interface SolvingProgressState {
  active: boolean;
  currentPage: number;
  totalPages: number;
  completedPages: number;
  statusText: string;
}

export const HANDWRITING_FONTS: HandwritingFontOption[] = [
  {
    id: "fused-natural-mix",
    name: "Fusión Orgánica Multi-Letra (3 Fuentes)",
    cssFamily: "'Caveat', cursive",
    fusedCssFamilies: [
      "'Caveat', cursive",
      "'Kalam', cursive",
      "'Patrick Hand', cursive",
    ],
    description:
      "Alterna automáticamente varias caligrafías letra a letra para que dos 'a' nunca sean iguales",
    baseWeight: 500,
    lineHeightMultiplier: 1.14,
    customType: "fused_fonts",
  },
  {
    id: "caveat",
    name: "Cuaderno Fluido",
    cssFamily: "'Caveat', cursive",
    description: "Letra ligada natural y rápida de estudiante",
    baseWeight: 600,
    lineHeightMultiplier: 1.08,
  },
  {
    id: "kalam",
    name: "Bolígrafo Natural",
    cssFamily: "'Kalam', cursive",
    description: "Trazo firme con inclinación orgánica ideal para ciencias",
    baseWeight: 400,
    lineHeightMultiplier: 1.15,
  },
  {
    id: "patrick",
    name: "Letra Clara",
    cssFamily: "'Patrick Hand', cursive",
    description: "Caligrafía limpia y redondeada, excelente para fórmulas",
    baseWeight: 400,
    lineHeightMultiplier: 1.12,
  },
  {
    id: "indie",
    name: "Apuntes Desenfadados",
    cssFamily: "'Indie Flower', cursive",
    description: "Trazo abierto con variación espontánea entre letras",
    baseWeight: 400,
    lineHeightMultiplier: 1.15,
  },
  {
    id: "shadows",
    name: "Trazo Rápido",
    cssFamily: "'Shadows Into Light', cursive",
    description: "Escritura ágil ligeramente estilizada",
    baseWeight: 400,
    lineHeightMultiplier: 1.15,
  },
];

export const INK_COLORS: InkColorOption[] = [
  {
    id: "bic-blue",
    name: "Azul Bolígrafo",
    hex: "#183B8C",
    rgb: [24, 59, 140],
    opacityBase: 0.91,
  },
  {
    id: "gel-black",
    name: "Negro Tinta Gel",
    hex: "#1E242B",
    rgb: [30, 36, 43],
    opacityBase: 0.93,
  },
  {
    id: "graphite",
    name: "Lápiz Grafito HB",
    hex: "#4A525D",
    rgb: [74, 82, 93],
    opacityBase: 0.82,
  },
  {
    id: "red-pen",
    name: "Rojo Corrección",
    hex: "#A82020",
    rgb: [168, 32, 32],
    opacityBase: 0.9,
  },
];
