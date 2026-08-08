import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { serve } from "@hono/node-server";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { type WebSocket, WebSocketServer } from "ws";
import { z } from "zod";

const dataDirectory = process.env["OPENBOARD_DATA_DIR"] ?? join(import.meta.dirname, "..", "data");
mkdirSync(join(dataDirectory, "blobs"), { recursive: true });
const database = new DatabaseSync(join(dataDirectory, "openboard.sqlite"));
database.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, password TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, title TEXT NOT NULL, owner_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members (board_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY(board_id, user_id));
CREATE TABLE IF NOT EXISTS share_links (token TEXT PRIMARY KEY, board_id TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS board_events (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, actor_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, author_id TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS elements (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, color TEXT NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL, updated_at TEXT NOT NULL);`);

type User = { readonly id: string; readonly name: string };
type Board = {
  readonly id: string;
  readonly title: string;
  readonly ownerId: string;
  readonly updatedAt: string;
};
type Element = {
  readonly id: string;
  readonly kind: string;
  readonly content: string;
  readonly color: string;
  readonly x: number;
  readonly y: number;
};
const userInput = z.object({
  name: z.string().trim().min(2).max(60),
  password: z.string().min(8).max(128),
});
const boardInput = z.object({ title: z.string().trim().min(1).max(120) });
const commentInput = z.object({ message: z.string().trim().min(1).max(2000) });
const elementInput = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum([
    "STICKY",
    "TEXT",
    "RECTANGLE",
    "ELLIPSE",
    "DIAMOND",
    "LINE",
    "ARROW",
    "FRAME",
    "PEN",
    "HIGHLIGHTER",
  ]),
  content: z.string().max(20000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  x: z.number().int(),
  y: z.number().int(),
});
const updateInput = elementInput.extend({ id: z.string().uuid() });
const rooms = new Map<string, Set<WebSocket>>();
const id = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();
const recordEvent = (boardId: string, actorId: string, type: string, payload: object): void => {
  database
    .prepare("INSERT INTO board_events VALUES (?, ?, ?, ?, ?, ?)")
    .run(id(), boardId, actorId, type, JSON.stringify(payload), now());
};
const hash = async (value: string): Promise<string> =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
const userForSession = (session: string | undefined): User | null => {
  if (!session) return null;
  return database
    .prepare(
      "SELECT users.id, users.name FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ?",
    )
    .get(session) as User | null;
};
const boardForUser = (boardId: string, userId: string): Board | null =>
  database
    .prepare(
      "SELECT boards.id, boards.title, boards.owner_id AS ownerId, boards.updated_at AS updatedAt FROM boards JOIN members ON members.board_id = boards.id WHERE boards.id = ? AND members.user_id = ?",
    )
    .get(boardId, userId) as Board | null;
const broadcast = (boardId: string, message: object): void => {
  const payload = JSON.stringify(message);
  for (const socket of rooms.get(boardId) ?? [])
    if (socket.readyState === socket.OPEN) socket.send(payload);
};
const app = new Hono();
app.get("/api/health", (context) => context.json({ status: "ok" }));
app.get("/api/setup", (context) =>
  context.json({ required: database.prepare("SELECT id FROM users LIMIT 1").get() === undefined }),
);
app.post("/api/auth/register", zValidator("json", userInput), async (context) => {
  const input = context.req.valid("json");
  if (database.prepare("SELECT id FROM users WHERE name = ?").get(input.name))
    return context.json({ error: "That name is already in use." }, 409);
  const user = { id: id(), name: input.name };
  const session = id();
  database
    .prepare("INSERT INTO users VALUES (?, ?, ?, ?)")
    .run(user.id, user.name, await hash(input.password), now());
  database.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(session, user.id, now());
  setCookie(context, "openboard_session", session, { httpOnly: true, sameSite: "Lax", path: "/" });
  return context.json({ user }, 201);
});
app.post("/api/auth/login", zValidator("json", userInput), async (context) => {
  const input = context.req.valid("json");
  const account = database
    .prepare("SELECT id, name, password FROM users WHERE name = ?")
    .get(input.name) as
    | { readonly id: string; readonly name: string; readonly password: string }
    | undefined;
  if (!account || account.password !== (await hash(input.password)))
    return context.json({ error: "Invalid credentials." }, 401);
  const session = id();
  database.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(session, account.id, now());
  setCookie(context, "openboard_session", session, { httpOnly: true, sameSite: "Lax", path: "/" });
  return context.json({ user: { id: account.id, name: account.name } });
});
app.get("/api/me", (context) => {
  const user = userForSession(getCookie(context, "openboard_session"));
  return user ? context.json({ user }) : context.json({ error: "Authentication required." }, 401);
});
app.get("/api/boards", (context) => {
  const user = userForSession(getCookie(context, "openboard_session"));
  if (!user) return context.json({ error: "Authentication required." }, 401);
  return context.json({
    boards: database
      .prepare(
        "SELECT boards.id, boards.title, boards.owner_id AS ownerId, boards.updated_at AS updatedAt FROM boards JOIN members ON members.board_id = boards.id WHERE members.user_id = ? ORDER BY boards.updated_at DESC",
      )
      .all(user.id) as Board[],
  });
});
app.post("/api/boards", zValidator("json", boardInput), (context) => {
  const user = userForSession(getCookie(context, "openboard_session"));
  if (!user) return context.json({ error: "Authentication required." }, 401);
  const timestamp = now();
  const board: Board = {
    id: id(),
    title: context.req.valid("json").title,
    ownerId: user.id,
    updatedAt: timestamp,
  };
  database
    .prepare("INSERT INTO boards VALUES (?, ?, ?, ?, ?)")
    .run(board.id, board.title, board.ownerId, timestamp, timestamp);
  database.prepare("INSERT INTO members VALUES (?, ?, ?)").run(board.id, user.id, "manage");
  recordEvent(board.id, user.id, "board.created", { title: board.title });
  return context.json({ board }, 201);
});
app.put("/api/boards/:boardId", zValidator("json", boardInput), (context) => {
  const user = userForSession(getCookie(context, "openboard_session"));
  const board = user ? boardForUser(context.req.param("boardId"), user.id) : null;
  if (!board || !user) return context.json({ error: "Board not found." }, 404);
  const title = context.req.valid("json").title;
  const updatedAt = now();
  database
    .prepare("UPDATE boards SET title = ?, updated_at = ? WHERE id = ?")
    .run(title, updatedAt, board.id);
  recordEvent(board.id, user.id, "board.renamed", { title });
  return context.json({ board: { ...board, title, updatedAt } });
});
app.get("/api/boards/:boardId", (context) => {
  const user = userForSession(getCookie(context, "openboard_session"));
  const board = user ? boardForUser(context.req.param("boardId"), user.id) : null;
  if (!board || !user) return context.json({ error: "Board not found." }, 404);
  return context.json({
    board,
    elements: database
      .prepare(
        "SELECT id, kind, content, color, x, y FROM elements WHERE board_id = ? ORDER BY updated_at",
      )
      .all(board.id) as Element[],
  });
});
app.post("/api/boards/:boardId/share", (context) => {
  const user = userForSession(getCookie(context, "openboard_session"));
  const board = user ? boardForUser(context.req.param("boardId"), user.id) : null;
  if (!board || !user) return context.json({ error: "Board not found." }, 404);
  const existing = database
    .prepare(
      "SELECT token FROM share_links WHERE board_id = ? AND created_by = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(board.id, user.id) as { readonly token: string } | undefined;
  const token = existing?.token ?? id();
  if (!existing)
    database
      .prepare("INSERT INTO share_links VALUES (?, ?, ?, ?)")
      .run(token, board.id, user.id, now());
  return context.json({ token });
});
app.post("/api/shares/:token/accept", (context) => {
  const user = userForSession(getCookie(context, "openboard_session"));
  if (!user) return context.json({ error: "Authentication required." }, 401);
  const share = database
    .prepare("SELECT board_id AS boardId FROM share_links WHERE token = ?")
    .get(context.req.param("token")) as { readonly boardId: string } | undefined;
  if (!share) return context.json({ error: "Share link not found." }, 404);
  database
    .prepare("INSERT OR IGNORE INTO members VALUES (?, ?, ?)")
    .run(share.boardId, user.id, "edit");
  recordEvent(share.boardId, user.id, "member.joined", {});
  return context.json({ boardId: share.boardId });
});
app.get("/api/boards/:boardId/history", (context) => {
  const user = userForSession(getCookie(context, "openboard_session"));
  const board = user ? boardForUser(context.req.param("boardId"), user.id) : null;
  if (!board) return context.json({ error: "Board not found." }, 404);
  return context.json({
    events: database
      .prepare(
        "SELECT board_events.id, board_events.type, board_events.payload, board_events.created_at AS createdAt, users.name AS actorName FROM board_events JOIN users ON users.id = board_events.actor_id WHERE board_events.board_id = ? ORDER BY board_events.created_at DESC LIMIT 100",
      )
      .all(board.id),
  });
});
app.get("/api/boards/:boardId/comments", (context) => {
  const user = userForSession(getCookie(context, "openboard_session"));
  const board = user ? boardForUser(context.req.param("boardId"), user.id) : null;
  if (!board) return context.json({ error: "Board not found." }, 404);
  return context.json({
    comments: database
      .prepare(
        "SELECT comments.id, comments.message, comments.created_at AS createdAt, users.name AS authorName FROM comments JOIN users ON users.id = comments.author_id WHERE comments.board_id = ? ORDER BY comments.created_at DESC LIMIT 100",
      )
      .all(board.id),
  });
});
app.post("/api/boards/:boardId/comments", zValidator("json", commentInput), (context) => {
  const user = userForSession(getCookie(context, "openboard_session"));
  const board = user ? boardForUser(context.req.param("boardId"), user.id) : null;
  if (!board || !user) return context.json({ error: "Board not found." }, 404);
  const comment = {
    id: id(),
    message: context.req.valid("json").message,
    createdAt: now(),
    authorName: user.name,
  };
  database
    .prepare("INSERT INTO comments VALUES (?, ?, ?, ?, ?)")
    .run(comment.id, board.id, user.id, comment.message, comment.createdAt);
  recordEvent(board.id, user.id, "comment.created", { commentId: comment.id });
  broadcast(board.id, { type: "comment.created", comment });
  return context.json({ comment }, 201);
});
app.post("/api/boards/:boardId/elements", zValidator("json", elementInput), (context) => {
  const user = userForSession(getCookie(context, "openboard_session"));
  const board = user ? boardForUser(context.req.param("boardId"), user.id) : null;
  if (!board || !user) return context.json({ error: "Board not found." }, 404);
  const { id: clientId, ...input } = context.req.valid("json");
  const element: Element = { id: clientId ?? id(), ...input };
  database
    .prepare("INSERT INTO elements VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      element.id,
      board.id,
      element.kind,
      element.content,
      element.color,
      element.x,
      element.y,
      now(),
    );
  recordEvent(board.id, user.id, "element.created", { elementId: element.id, kind: element.kind });
  broadcast(board.id, { type: "element.created", element });
  return context.json({ element }, 201);
});
app.put("/api/boards/:boardId/elements/:elementId", zValidator("json", updateInput), (context) => {
  const user = userForSession(getCookie(context, "openboard_session"));
  const board = user ? boardForUser(context.req.param("boardId"), user.id) : null;
  const input = context.req.valid("json");
  const existing = board
    ? database
        .prepare("SELECT id FROM elements WHERE id = ? AND board_id = ?")
        .get(input.id, board.id)
    : undefined;
  if (!board || !user || !existing || input.id !== context.req.param("elementId"))
    return context.json({ error: "Element not found." }, 404);
  const element: Element = { ...input };
  database
    .prepare(
      "UPDATE elements SET kind = ?, content = ?, color = ?, x = ?, y = ?, updated_at = ? WHERE id = ?",
    )
    .run(element.kind, element.content, element.color, element.x, element.y, now(), element.id);
  recordEvent(board.id, user.id, "element.updated", { elementId: element.id, kind: element.kind });
  broadcast(board.id, { type: "element.updated", element });
  return context.json({ element });
});
app.delete("/api/boards/:boardId/elements/:elementId", (context) => {
  const user = userForSession(getCookie(context, "openboard_session"));
  const board = user ? boardForUser(context.req.param("boardId"), user.id) : null;
  const elementId = context.req.param("elementId");
  const existing = board
    ? database
        .prepare("SELECT id FROM elements WHERE id = ? AND board_id = ?")
        .get(elementId, board.id)
    : undefined;
  if (!board || !existing) return context.json({ error: "Element not found." }, 404);
  database.prepare("DELETE FROM elements WHERE id = ?").run(elementId);
  broadcast(board.id, { type: "element.deleted", elementId });
  return context.body(null, 204);
});
const server = serve({ fetch: app.fetch, port: Number(process.env["OPENBOARD_PORT"] ?? 8787) });
const websocketServer = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  const match = new URL(request.url ?? "", "http://localhost").pathname.match(
    /^\/ws\/([0-9a-f-]{36})$/,
  );
  const session = request.headers.cookie?.match(/openboard_session=([^;]+)/)?.[1];
  const user = userForSession(session);
  const boardId = match?.[1];
  if (!boardId || !user || !boardForUser(boardId, user.id)) {
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(request, socket, head, (websocket) => {
    const peers = rooms.get(boardId) ?? new Set<WebSocket>();
    peers.add(websocket);
    rooms.set(boardId, peers);
    broadcast(boardId, { type: "presence", count: peers.size });
    websocket.on("close", () => {
      peers.delete(websocket);
      broadcast(boardId, { type: "presence", count: peers.size });
    });
  });
});
