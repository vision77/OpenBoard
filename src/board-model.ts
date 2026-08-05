export const boardTools = [
  "SELECT",
  "HAND",
  "PEN",
  "HIGHLIGHTER",
  "TEXT",
  "STICKY",
  "RECTANGLE",
  "ELLIPSE",
  "DIAMOND",
  "LINE",
  "ARROW",
  "FRAME",
  "ERASER",
] as const;

export type BoardTool = (typeof boardTools)[number];
export type BoardElementType = Exclude<BoardTool, "SELECT" | "HAND" | "ERASER">;

export type BoardElement = {
  readonly id: string;
  readonly type: BoardElementType;
  readonly pageId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly text: string;
  readonly fontSize: number;
  readonly points: readonly number[];
};

export const createElement = (
  type: BoardElementType,
  pageId: string,
  x: number,
  y: number,
): BoardElement => ({
  id: crypto.randomUUID(),
  type,
  pageId,
  x,
  y,
  width: type === "TEXT" ? 240 : type === "FRAME" ? 960 : 180,
  height: type === "TEXT" ? 56 : type === "FRAME" ? 540 : 120,
  rotation: 0,
  fill: type === "STICKY" ? "#fff3c9" : "#ffffff",
  stroke: "#46536a",
  strokeWidth: type === "PEN" ? 4 : 2,
  text: type === "STICKY" ? "Write something useful" : type === "TEXT" ? "Text" : "",
  fontSize: type === "STICKY" ? 20 : 24,
  points: [],
});

export const drawingWidth = (
  type: Extract<BoardElementType, "PEN" | "HIGHLIGHTER">,
  pressure: number,
): number => {
  const normalized = Math.max(0.05, Math.min(1, pressure));
  const base = type === "HIGHLIGHTER" ? 18 : 4;
  return Math.round(base * (0.82 + normalized * 0.4) * 100) / 100;
};
