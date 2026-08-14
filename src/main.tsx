import type Konva from "konva";
import {
  ArrowRight,
  ChevronLeft,
  Circle as CircleIcon,
  FileText,
  Hand,
  History,
  LayoutTemplate,
  Menu,
  MessageSquare,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Search,
  Share2,
  Sparkles,
  Square,
  StickyNote,
  Type,
  Undo2,
  Users,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Arrow, Circle, Group, Layer, Line, Rect, Stage, Text } from "react-konva";
import "./styles.css";

type User = { readonly id: string; readonly name: string };
type Board = {
  readonly id: string;
  readonly title: string;
  readonly ownerId: string;
  readonly updatedAt: string;
};
type ServerElement = {
  readonly id: string;
  readonly kind: ObjectKind;
  readonly content: string;
  readonly color: string;
  readonly x: number;
  readonly y: number;
};
type Tool = "select" | "hand" | "sticky" | "text" | "rectangle" | "ellipse" | "arrow" | "pen";
type ObjectKind = "sticky" | "text" | "rectangle" | "ellipse" | "arrow" | "pen";
type BoardObject = {
  readonly id: string;
  readonly kind: ObjectKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
  readonly color: string;
  readonly points?: number[];
};
type BoardComment = {
  readonly id: string;
  readonly message: string;
  readonly createdAt: string;
  readonly authorName: string;
};
type HistoryEvent = {
  readonly id: string;
  readonly type: string;
  readonly createdAt: string;
  readonly actorName: string;
};
type Screen =
  | { readonly kind: "setup" }
  | { readonly kind: "login" }
  | { readonly kind: "library" }
  | { readonly kind: "editor"; readonly boardId: string };
type LibraryFilter = "all" | "owned" | "shared" | "archive";

const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok)
    throw new Error(
      (
        (await response.json().catch(() => ({ error: "Request failed." }))) as {
          readonly error?: string;
        }
      ).error ?? "Request failed.",
    );
  return response.json() as Promise<T>;
};
const toolItems: readonly {
  readonly id: Tool;
  readonly icon: typeof MousePointer2;
  readonly label: string;
}[] = [
  { id: "select", icon: MousePointer2, label: "Select" },
  { id: "hand", icon: Hand, label: "Hand" },
  { id: "sticky", icon: StickyNote, label: "Sticky note" },
  { id: "pen", icon: Pencil, label: "Draw" },
  { id: "text", icon: Type, label: "Text" },
  { id: "rectangle", icon: Square, label: "Shape" },
  { id: "arrow", icon: ArrowRight, label: "Arrow" },
  { id: "ellipse", icon: CircleIcon, label: "Ellipse" },
];
const elementPayload = (object: BoardObject): string =>
  JSON.stringify({
    kind: object.kind,
    width: object.width,
    height: object.height,
    text: object.text,
    color: object.color,
    points: object.points,
  });
const readElement = (element: ServerElement): BoardObject => {
  try {
    const payload = JSON.parse(element.content) as Omit<BoardObject, "id" | "x" | "y">;
    return { ...payload, id: element.id, x: element.x, y: element.y };
  } catch {
    return {
      id: element.id,
      kind: "sticky",
      x: element.x,
      y: element.y,
      width: 220,
      height: 160,
      text: element.content,
      color: element.color,
    };
  }
};

function Authentication({
  mode,
  onReady,
  onModeChange,
}: {
  readonly mode: "setup" | "login";
  readonly onReady: (user: User) => void;
  readonly onModeChange: (mode: "setup" | "login") => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      const result = await api<{ readonly user: User }>(
        `/api/auth/${mode === "setup" ? "register" : "login"}`,
        { method: "POST", body: JSON.stringify({ name, password }) },
      );
      onReady(result.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request failed.");
    }
  };
  return (
    <main className="auth">
      <section className="auth-card">
        <p className="eyebrow">OPENBOARD LOCAL</p>
        <h1>{mode === "setup" ? "Create your workspace" : "Welcome back"}</h1>
        <p>Boards and assets remain on this computer.</p>
        <form onSubmit={submit}>
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              minLength={2}
              required
            />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              minLength={8}
              required
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit">{mode === "setup" ? "Create workspace" : "Sign in"}</button>
        </form>
        <button
          className="auth-switch"
          type="button"
          onClick={() => onModeChange(mode === "setup" ? "login" : "setup")}
        >
          {mode === "setup" ? "Already have an account? Sign in" : "Create a new local account"}
        </button>
      </section>
    </main>
  );
}

function Library({
  user,
  open,
}: {
  readonly user: User;
  readonly open: (id: string) => void;
}): React.JSX.Element {
  const [boards, setBoards] = useState<readonly Board[]>([]);
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [createError, setCreateError] = useState("");
  useEffect(() => {
    void api<{ readonly boards: readonly Board[] }>("/api/boards").then((result) =>
      setBoards(result.boards),
    );
  }, []);
  const visible = useMemo(() => {
    const matchesFilter = (board: Board): boolean => {
      if (filter === "owned") return board.ownerId === user.id;
      if (filter === "shared") return board.ownerId !== user.id;
      return filter !== "archive";
    };
    return boards.filter(
      (board) => matchesFilter(board) && board.title.toLowerCase().includes(query.toLowerCase()),
    );
  }, [boards, filter, query, user.id]);
  const create = async (): Promise<void> => {
    try {
      const result = await api<{ readonly board: Board }>("/api/boards", {
        method: "POST",
        body: JSON.stringify({ title: title.trim() || "Untitled whiteboard" }),
      });
      setCreateError("");
      open(result.board.id);
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : "Unable to create a whiteboard.");
    }
  };
  return (
    <main className="library">
      <header className="app-header">
        <div className="brand">
          <button aria-label="Back" className="icon-button">
            <ChevronLeft size={20} />
          </button>
          <div>
            <strong>Openboard</strong>
            <small>Local workspace</small>
          </div>
        </div>
        <div className="header-status">
          <span>
            <Users size={14} /> Private local access
          </span>
          <button className="icon-button" aria-label="Refresh" onClick={() => location.reload()}>
            ↻
          </button>
        </div>
      </header>
      <section className="library-content">
        <div className="library-title">
          <div>
            <p className="overline">LOCAL WORKSPACE</p>
            <h1>Whiteboards</h1>
            <p>Shared boards, templates, and live collaboration on your local network.</p>
          </div>
          <div className="create-control">
            <input
              aria-label="Board name"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Board name"
            />
            <button onClick={() => void create()}>
              <Plus size={19} /> New whiteboard
            </button>
            {createError ? <p className="create-error">{createError}</p> : null}
          </div>
        </div>
        <section className="workspace-notice">
          <span className="notice-icon">
            <FileText size={23} />
          </span>
          <div>
            <strong>{user.name}'s workspace</strong>
            <p>New whiteboards are private by default. Invite collaborators when you are ready.</p>
          </div>
          <span className="notice-badge">Local only</span>
        </section>
        <div className="library-filters">
          <nav>
            <button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}>
              All whiteboards
            </button>
            <button
              className={filter === "owned" ? "selected" : ""}
              onClick={() => setFilter("owned")}
            >
              Created by me
            </button>
            <button
              className={filter === "shared" ? "selected" : ""}
              onClick={() => setFilter("shared")}
            >
              Shared with me
            </button>
            <button
              className={filter === "archive" ? "selected" : ""}
              onClick={() => setFilter("archive")}
            >
              Archive
            </button>
          </nav>
          <label className="search">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search whiteboards"
            />
          </label>
        </div>
        <section className="board-gallery">
          {visible.length ? (
            visible.map((board) => (
              <button className="board-preview" key={board.id} onClick={() => open(board.id)}>
                <div className="preview-canvas">
                  <Pencil size={36} />
                </div>
                <div className="preview-copy">
                  <strong>{board.title}</strong>
                  <p>1 page · 0 elements</p>
                  <span>
                    <Users size={13} /> Private access
                  </span>
                  <small>Updated {new Date(board.updatedAt).toLocaleDateString()}</small>
                </div>
              </button>
            ))
          ) : (
            <div className="empty-library">
              <LayoutTemplate size={28} />
              <h2>Start with a blank board</h2>
              <p>Create a board to begin mapping ideas together.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function CanvasObject({
  object,
  selected,
  onSelect,
  onMove,
  onEdit,
}: {
  readonly object: BoardObject;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onMove: (id: string, x: number, y: number) => void;
  readonly onEdit: (id: string) => void;
}): React.JSX.Element {
  const select = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void => {
    event.cancelBubble = true;
    onSelect();
  };
  const common = {
    x: object.x,
    y: object.y,
    draggable: true,
    onClick: select,
    onTap: select,
    onDblClick: () => onEdit(object.id),
    onDragEnd: (event: { target: { x: () => number; y: () => number } }) =>
      onMove(object.id, event.target.x(), event.target.y()),
  };
  if (object.kind === "ellipse")
    return (
      <Circle
        {...common}
        radiusX={object.width / 2}
        radiusY={object.height / 2}
        fill={object.color}
        stroke={selected ? "#635bff" : "#46536a"}
        strokeWidth={selected ? 3 : 2}
      />
    );
  if (object.kind === "arrow")
    return (
      <Arrow
        {...common}
        points={[0, 0, object.width, object.height]}
        stroke="#46536a"
        fill="#46536a"
        pointerLength={9}
        pointerWidth={9}
        strokeWidth={2}
      />
    );
  if (object.kind === "pen")
    return (
      <Line
        {...common}
        points={object.points ?? [0, 0, object.width, object.height]}
        stroke="#635bff"
        strokeWidth={3}
        lineCap="round"
        lineJoin="round"
      />
    );
  if (object.kind === "rectangle")
    return (
      <Rect
        {...common}
        width={object.width}
        height={object.height}
        fill={object.color}
        cornerRadius={8}
        stroke={selected ? "#635bff" : "#46536a"}
        strokeWidth={selected ? 3 : 2}
      />
    );
  if (object.kind === "text")
    return (
      <Text
        {...common}
        text={object.text}
        fontSize={24}
        fill="#25324a"
        width={object.width}
        height={object.height}
      />
    );
  return (
    <Group {...common}>
      <Rect
        width={object.width}
        height={object.height}
        fill={object.color}
        cornerRadius={4}
        shadowColor="#111827"
        shadowOpacity={0.08}
        shadowBlur={8}
        shadowOffset={{ x: 0, y: 3 }}
      />
      <Text
        x={16}
        y={18}
        text={object.text}
        fontSize={18}
        fill="#344054"
        width={object.width - 32}
        height={object.height - 32}
        wrap="word"
      />
      {selected ? (
        <Rect
          x={-4}
          y={-4}
          width={object.width + 8}
          height={object.height + 8}
          stroke="#635bff"
          strokeWidth={2}
          dash={[5, 4]}
        />
      ) : null}
    </Group>
  );
}

function Editor({
  boardId,
  onBack,
}: {
  readonly boardId: string;
  readonly onBack: () => void;
}): React.JSX.Element {
  const stageRef = useRef<Konva.Stage>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [objects, setObjects] = useState<readonly BoardObject[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState("");
  const [scale, setScale] = useState(0.64);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [undoStack, setUndoStack] = useState<readonly (readonly BoardObject[])[]>([]);
  const [redoStack, setRedoStack] = useState<readonly (readonly BoardObject[])[]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const [shareNotice, setShareNotice] = useState("");
  const [panel, setPanel] = useState<"comments" | "history" | null>(null);
  const [comments, setComments] = useState<readonly BoardComment[]>([]);
  const [history, setHistory] = useState<readonly HistoryEvent[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [presence, setPresence] = useState(1);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [mobilePagesOpen, setMobilePagesOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const updateSize = (): void =>
      setCanvasSize({ width: surface.clientWidth, height: surface.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let socket: WebSocket | undefined;
    void Promise.all([
      api<{ readonly board: Board; readonly elements: readonly ServerElement[] }>(
        `/api/boards/${boardId}`,
      ),
      api<{ readonly comments: readonly BoardComment[] }>(`/api/boards/${boardId}/comments`),
      api<{ readonly events: readonly HistoryEvent[] }>(`/api/boards/${boardId}/history`),
    ]).then(([result, commentResult, historyResult]) => {
      setBoard(result.board);
      setObjects(result.elements.map(readElement));
      setComments(commentResult.comments);
      setHistory(historyResult.events);
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/${boardId}`,
      );
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as {
          readonly type: string;
          readonly element?: ServerElement;
          readonly elementId?: string;
          readonly count?: number;
          readonly comment?: BoardComment;
        };
        if (message.type === "presence") {
          setPresence(message.count ?? 1);
          return;
        }
        if (message.type === "comment.created" && message.comment) {
          setComments((current) => [message.comment!, ...current]);
          return;
        }
        const remoteElement = message.element;
        if (!remoteElement) return;
        if (message.type === "element.created")
          setObjects((current) =>
            current.some((item) => item.id === remoteElement.id)
              ? current
              : [...current, readElement(remoteElement)],
          );
        if (message.type === "element.updated")
          setObjects((current) =>
            current.map((item) =>
              item.id === remoteElement.id ? readElement(remoteElement) : item,
            ),
          );
        if (message.type === "element.deleted" && message.elementId)
          setObjects((current) => current.filter((item) => item.id !== message.elementId));
      };
    });
    return () => socket?.close();
  }, [boardId]);
  const saveObject = (object: BoardObject): void => {
    void api<{ readonly element: ServerElement }>(`/api/boards/${boardId}/elements`, {
      method: "POST",
      body: JSON.stringify({
        id: object.id,
        kind: object.kind.toUpperCase(),
        content: elementPayload(object),
        color: object.color,
        x: object.x,
        y: object.y,
      }),
    });
  };
  const updateObject = (object: BoardObject): void => {
    void api<unknown>(`/api/boards/${boardId}/elements/${object.id}`, {
      method: "PUT",
      body: JSON.stringify({
        id: object.id,
        kind: object.kind.toUpperCase(),
        content: elementPayload(object),
        color: object.color,
        x: object.x,
        y: object.y,
      }),
    });
  };
  const persistSnapshot = (
    previous: readonly BoardObject[],
    next: readonly BoardObject[],
  ): void => {
    const priorIds = new Set(previous.map((object) => object.id));
    const nextIds = new Set(next.map((object) => object.id));
    for (const object of previous)
      if (!nextIds.has(object.id))
        void api<unknown>(`/api/boards/${boardId}/elements/${object.id}`, { method: "DELETE" });
    for (const object of next) {
      if (priorIds.has(object.id)) updateObject(object);
      else saveObject(object);
    }
  };
  const create = (
    kind: ObjectKind,
    x: number,
    y: number,
    overrides: Partial<Pick<BoardObject, "text" | "color">> = {},
  ): void => {
    const object: BoardObject = {
      id: crypto.randomUUID(),
      kind,
      x,
      y,
      width: kind === "arrow" ? 160 : 220,
      height: kind === "text" ? 60 : 150,
      text: kind === "sticky" ? "Write something useful" : kind === "text" ? "Text" : "",
      color: kind === "sticky" ? "#fff3c9" : "#e7ecff",
      ...overrides,
    };
    setUndoStack((current) => [...current, objects]);
    setRedoStack([]);
    setObjects((current) => [...current, object]);
    setSelected(object.id);
    saveObject(object);
  };
  const handleCanvasClick = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void => {
    if (event.target !== event.currentTarget) return;
    if (tool === "select" || tool === "hand") {
      setSelected("");
      return;
    }
    const stage = stageRef.current;
    const point = stage?.getPointerPosition();
    if (!stage || !point) return;
    create(
      tool,
      Math.round((point.x - stage.x()) / scale),
      Math.round((point.y - stage.y()) / scale),
    );
  };
  const updatePosition = (id: string, x: number, y: number): void => {
    const nextX = Math.round(x);
    const nextY = Math.round(y);
    setObjects((current) => {
      setUndoStack((history) => [...history, current]);
      setRedoStack([]);
      return current.map((object) => {
        if (object.id !== id) return object;
        const next = { ...object, x: nextX, y: nextY };
        updateObject(next);
        return next;
      });
    });
  };
  const undo = (): void => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setRedoStack((current) => [...current, objects]);
    setObjects(previous);
    setUndoStack((current) => current.slice(0, -1));
    persistSnapshot(objects, previous);
  };
  const redo = (): void => {
    const next = redoStack.at(-1);
    if (!next) return;
    setUndoStack((current) => [...current, objects]);
    setObjects(next);
    setRedoStack((current) => current.slice(0, -1));
    persistSnapshot(objects, next);
  };
  const editText = (id: string): void => {
    const current = objects.find((object) => object.id === id);
    if (!current || (current.kind !== "sticky" && current.kind !== "text")) return;
    const text = window.prompt("Edit text", current.text);
    if (text === null) return;
    const next = { ...current, text };
    setUndoStack((history) => [...history, objects]);
    setRedoStack([]);
    setObjects((items) => items.map((item) => (item.id === id ? next : item)));
    updateObject(next);
  };
  const removeSelected = useCallback((): void => {
    if (!selected) return;
    const next = objects.filter((object) => object.id !== selected);
    setUndoStack((history) => [...history, objects]);
    setRedoStack([]);
    setObjects(next);
    setSelected("");
    persistSnapshot(objects, next);
  }, [objects, selected]);
  const share = async (): Promise<void> => {
    const result = await api<{ readonly token: string }>(`/api/boards/${boardId}/share`, {
      method: "POST",
    });
    const link = new URL(location.href);
    link.hash = `share=${result.token}`;
    await navigator.clipboard.writeText(link.toString());
    setShareNotice("Local link copied");
    window.setTimeout(() => setShareNotice(""), 1800);
  };
  const postComment = async (): Promise<void> => {
    if (!commentDraft.trim()) return;
    const result = await api<{ readonly comment: BoardComment }>(
      `/api/boards/${boardId}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ message: commentDraft }),
      },
    );
    setComments((current) =>
      current.some((item) => item.id === result.comment.id)
        ? current
        : [result.comment, ...current],
    );
    setCommentDraft("");
  };
  const saveTitle = async (): Promise<void> => {
    const title = titleDraft.trim();
    if (!board || !title || title === board.title) {
      setRenaming(false);
      return;
    }
    const result = await api<{ readonly board: Board }>(`/api/boards/${boardId}`, {
      method: "PUT",
      body: JSON.stringify({ title }),
    });
    setBoard(result.board);
    setRenaming(false);
  };
  useEffect(() => {
    const removeWithKeyboard = (event: KeyboardEvent): void => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      event.preventDefault();
      removeSelected();
    };
    window.addEventListener("keydown", removeWithKeyboard);
    return () => window.removeEventListener("keydown", removeWithKeyboard);
  }, [removeSelected]);
  return (
    <main className="editor">
      <header className="app-header editor-header">
        <div className="brand">
          <button onClick={onBack} className="icon-button" aria-label="Back">
            <ChevronLeft size={20} />
          </button>
          <div>
            <strong>Openboard</strong>
            <small>Local workspace</small>
          </div>
        </div>
        <div className="header-status">
          <span>
            <Users size={14} /> Private local access
          </span>
          <button className="icon-button" aria-label="Refresh" onClick={() => location.reload()}>
            ↻
          </button>
        </div>
      </header>
      <section
        className={`editor-shell ${railCollapsed ? "rail-collapsed" : ""} ${mobilePagesOpen ? "mobile-pages-open" : ""}`}
      >
        <aside className="page-rail">
          <div className="page-heading">
            <button
              aria-label={
                mobilePagesOpen ? "Close pages" : railCollapsed ? "Expand pages" : "Collapse pages"
              }
              onClick={() => {
                if (mobilePagesOpen) setMobilePagesOpen(false);
                else setRailCollapsed((value) => !value);
              }}
            >
              <ChevronLeft className={railCollapsed ? "rail-expand-icon" : ""} size={18} />
            </button>
            <strong>Pages</strong>
          </div>
          <div className="page-item active">
            <span>1</span> Page 1
          </div>
        </aside>
        <section className="canvas-area">
          <header className="board-header">
            <div>
              <button aria-label="Open pages" onClick={() => setMobilePagesOpen((value) => !value)}>
                <Menu size={20} />
              </button>
              {renaming ? (
                <input
                  className="board-title-input"
                  value={titleDraft}
                  autoFocus
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={() => setRenaming(false)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveTitle();
                    if (event.key === "Escape") {
                      setRenaming(false);
                    }
                  }}
                />
              ) : (
                <button
                  className="board-title"
                  aria-label="Rename board"
                  onClick={() => {
                    setTitleDraft(board?.title ?? "");
                    setRenaming(true);
                  }}
                >
                  {board?.title ?? "Loading board"}
                </button>
              )}
            </div>
            <div className="board-actions">
              <span className="synced">◌ Synced</span>
              <span>{presence} online</span>
              <span className="save-state">Auto-saved</span>
              <button
                aria-label="Comments"
                onClick={() => setPanel(panel === "comments" ? null : "comments")}
              >
                <MessageSquare size={18} />
              </button>
              <button
                aria-label="Version history"
                onClick={() => setPanel(panel === "history" ? null : "history")}
              >
                <History size={18} />
              </button>
              <button onClick={() => void share()}>
                <Share2 size={17} /> Share
              </button>
              {shareNotice ? <span className="share-notice">{shareNotice}</span> : null}
            </div>
          </header>
          {panel ? (
            <aside className="collaboration-panel">
              <header>
                <strong>{panel === "comments" ? "Comments" : "Version history"}</strong>
                <button onClick={() => setPanel(null)}>×</button>
              </header>
              {panel === "comments" ? (
                <>
                  <div className="comment-list">
                    {comments.map((comment) => (
                      <article key={comment.id}>
                        <strong>{comment.authorName}</strong>
                        <p>{comment.message}</p>
                        <small>{new Date(comment.createdAt).toLocaleString()}</small>
                      </article>
                    ))}
                  </div>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void postComment();
                    }}
                  >
                    <input
                      value={commentDraft}
                      onChange={(event) => setCommentDraft(event.target.value)}
                      placeholder="Write a comment"
                    />
                    <button type="submit">Send</button>
                  </form>
                </>
              ) : (
                <div className="history-list">
                  {history.map((event) => (
                    <article key={event.id}>
                      <strong>{event.actorName}</strong>
                      <p>{event.type.replace(".", " ")}</p>
                      <small>{new Date(event.createdAt).toLocaleString()}</small>
                    </article>
                  ))}
                </div>
              )}
            </aside>
          ) : null}
          <aside className="tool-rail">
            <button
              className="magic-button"
              onClick={() => setTemplateOpen(true)}
              aria-label="Templates"
            >
              <Sparkles size={20} />
            </button>
            <hr />
            {toolItems.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                className={tool === id ? "tool-selected" : ""}
                onClick={() => setTool(id)}
                aria-label={label}
              >
                <Icon size={20} />
              </button>
            ))}
            <hr />
            <button aria-label="Undo" onClick={undo} disabled={undoStack.length === 0}>
              <Undo2 size={19} />
            </button>
            <button aria-label="Redo" onClick={redo} disabled={redoStack.length === 0}>
              <Redo2 size={19} />
            </button>
          </aside>
          <div className="konva-surface" ref={surfaceRef}>
            <Stage
              ref={stageRef}
              width={canvasSize.width}
              height={canvasSize.height}
              scaleX={scale}
              scaleY={scale}
              onClick={handleCanvasClick}
              onTap={handleCanvasClick}
              draggable={tool === "hand"}
            >
              <Layer>
                {objects.map((object) => (
                  <CanvasObject
                    key={object.id}
                    object={object}
                    selected={selected === object.id}
                    onSelect={() => setSelected(object.id)}
                    onMove={updatePosition}
                    onEdit={editText}
                  />
                ))}
              </Layer>
            </Stage>
          </div>
          {templateOpen ? (
            <section className="template-dock">
              <button className="close-dock" onClick={() => setTemplateOpen(false)}>
                ×
              </button>
              <strong>Quick start</strong>
              <p>Choose a template to place it directly on this whiteboard</p>
              <div>
                {[
                  { name: "Brainstorm", text: "What if we tried…", color: "#fff2c6" },
                  { name: "Project planning", text: "Goal · owner · next step", color: "#ddebff" },
                  { name: "Flowchart", text: "Start → decide → ship", color: "#d9f7e9" },
                  { name: "Team retrospective", text: "Keep · improve · try", color: "#eee3ff" },
                ].map((template, index) => (
                  <button
                    key={template.name}
                    onClick={() => {
                      create("sticky", 380 + index * 32, 220 + index * 28, template);
                      setTemplateOpen(false);
                    }}
                  >
                    <span className={`template-color color-${index}`}>
                      <StickyNote size={23} />
                    </span>
                    <strong>{template.name}</strong>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <div className="zoom-control">
            <button onClick={() => setScale((value) => Math.max(0.25, value - 0.08))}>
              <ZoomOut size={18} />
            </button>
            <span>{Math.round(scale * 100)}%</span>
            <button onClick={() => setScale((value) => Math.min(1.8, value + 0.08))}>
              <ZoomIn size={18} />
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}

function App(): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [shareToken] = useState(() => new URLSearchParams(location.hash.slice(1)).get("share"));
  const [screen, setScreen] = useState<Screen>(() => {
    const boardId = new URLSearchParams(location.hash.slice(1)).get("board");
    return boardId ? { kind: "editor", boardId } : { kind: "login" };
  });
  const acceptShare = async (): Promise<void> => {
    if (!shareToken) return;
    const result = await api<{ readonly boardId: string }>(`/api/shares/${shareToken}/accept`, {
      method: "POST",
    });
    location.hash = `board=${result.boardId}`;
    setScreen({ kind: "editor", boardId: result.boardId });
  };
  useEffect(() => {
    void Promise.all([
      api<{ readonly required: boolean }>("/api/setup"),
      api<{ readonly user: User }>("/api/me").catch(() => null),
    ]).then(([setup, session]) => {
      if (session) {
        setUser(session.user);
        if (shareToken) void acceptShare();
        else setScreen((current) => (current.kind === "editor" ? current : { kind: "library" }));
      } else setScreen({ kind: setup.required ? "setup" : "login" });
    });
  }, []);
  if (!user && (screen.kind === "setup" || screen.kind === "login"))
    return (
      <Authentication
        mode={screen.kind}
        onReady={(next) => {
          setUser(next);
          if (shareToken) void acceptShare();
          else setScreen({ kind: "library" });
        }}
        onModeChange={(mode) => setScreen({ kind: mode })}
      />
    );
  if (!user) return <main className="auth">Loading local workspace...</main>;
  return screen.kind === "editor" ? (
    <Editor
      boardId={screen.boardId}
      onBack={() => {
        location.hash = "";
        setScreen({ kind: "library" });
      }}
    />
  ) : (
    <Library
      user={user}
      open={(boardId) => {
        location.hash = `board=${boardId}`;
        setScreen({ kind: "editor", boardId });
      }}
    />
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("The application root is unavailable.");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
