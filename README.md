# Openboard

Openboard is a local-first collaborative whiteboard. It runs entirely on your computer with SQLite, local files, and WebSockets.

## Requirements

- Node.js 22 or later

## Run locally

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173` in two browser windows to test live collaboration. The first run asks for a local account. Data is stored under `data/` and is never uploaded by the application.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

## Product boundaries

- SQLite stores users, sessions, boards, membership, public links, and canvas elements.
- `data/blobs/` stores uploaded board assets on the local filesystem.
- The server exposes a local HTTP API and per-board WebSocket rooms.
- No cloud provider, remote database, hosted identity service, or external analytics is required.
