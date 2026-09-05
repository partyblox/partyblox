const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const multer = require("multer");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const app = express();
const publicDir = __dirname;
const uploadsDir = path.join(publicDir, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "");
    cb(null, Date.now() + "-" + safe);
  }
});
const upload = multer({ storage, limits: { fileSize: 300 * 1024 * 1024 } });

app.use(express.static(publicDir));
app.use("/uploads", express.static(uploadsDir));

app.post("/upload", upload.single("media"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });
  const type = req.file.mimetype || "";
  if (!type.startsWith("video/") && !type.startsWith("audio/") && !type.startsWith("image/")) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Envie apenas imagem, vídeo ou áudio." });
  }
  res.json({ url: `/uploads/${req.file.filename}`, type });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const rooms = new Map();

function getRoom(id) {
  if (!rooms.has(id)) {
    rooms.set(id, {
      host: null,
      clients: new Set(),
      state: {
        dayMode: "day",
        media: { type: "clear" },
        mediaTime: 0,
        mediaPlaying: false,
        mediaStartedAt: 0
      }
    });
  }
  return rooms.get(id);
}

function send(ws, payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function broadcast(room, payload, except = null) {
  for (const client of room.clients) {
    if (client !== except) send(client, payload);
  }
}

wss.on("connection", (ws) => {
  ws.room = null;
  ws.name = "Player";
  ws.id = Math.random().toString(36).slice(2, 10);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.kind === "join") {
      const roomId = String(msg.room || "Praca-VIP").slice(0, 40);
      const room = getRoom(roomId);
      ws.room = room;
      ws.name = String(msg.name || "Player").slice(0, 20);
      ws.avatar = msg.avatar || null;
      room.clients.add(ws);
      if (!room.host) room.host = ws;

      send(ws, {
        kind: "roomState",
        host: room.host === ws,
        state: room.state,
        myId: ws.id
      });

      broadcast(room, { kind: "chat", name: "Sistema", text: `${ws.name} entrou na sala.` }, ws);
      broadcast(room, { kind: "playerJoin", id: ws.id, name: ws.name, avatar: ws.avatar }, ws);

      const players = [];
      for (const c of room.clients) {
        players.push({ id: c.id, name: c.name, avatar: c.avatar });
      }
      send(ws, { kind: "playerList", players });
      return;
    }

    const room = ws.room;
    if (!room) return;

    if (msg.kind === "avatar") {
      ws.avatar = msg.avatar || null;
      broadcast(room, { kind: "playerAvatar", id: ws.id, avatar: ws.avatar }, ws);
      return;
    }

    if (msg.kind === "move") {
      broadcast(room, { kind: "playerMove", id: ws.id, pos: msg.pos, rot: msg.rot }, ws);
      return;
    }

    if (msg.kind === "media") {
      if (ws !== room.host) return;
      room.state.media = msg.state || { type: "clear" };
      room.state.mediaTime = msg.time || 0;
      room.state.mediaPlaying = !!msg.playing;
      room.state.mediaStartedAt = Date.now();
      broadcast(room, {
        kind: "media",
        state: room.state.media,
        time: room.state.mediaTime,
        playing: room.state.mediaPlaying,
        startedAt: room.state.mediaStartedAt
      });
      return;
    }

    if (msg.kind === "mediaControl") {
      if (ws !== room.host) return;
      if (msg.action === "play") room.state.mediaPlaying = true;
      if (msg.action === "pause") room.state.mediaPlaying = false;
      if (typeof msg.time === "number") room.state.mediaTime = msg.time;
      room.state.mediaStartedAt = Date.now();
      broadcast(room, {
        kind: "mediaControl",
        action: msg.action,
        time: room.state.mediaTime,
        playing: room.state.mediaPlaying,
        startedAt: room.state.mediaStartedAt
      });
      return;
    }

    if (msg.kind === "dayNight") {
      if (ws !== room.host) return;
      room.state.dayMode = msg.mode === "night" ? "night" : "day";
      broadcast(room, { kind: "dayNight", mode: room.state.dayMode });
      return;
    }

    if (msg.kind === "emote") {
      const id = String(msg.id || "").slice(0, 40);
      if (!id) return;
      broadcast(room, { kind: "emote", id, name: ws.name, playerId: ws.id }, ws);
      return;
    }

    if (msg.kind === "dm") {
      const to = String(msg.to || "");
      const text = String(msg.text || "").slice(0, 500);
      if (!text || !to) return;
      for (const c of room.clients) {
        if (c.id === to) {
          send(c, { kind: "dm", from: ws.id, fromName: ws.name, text });
          break;
        }
      }
      send(ws, { kind: "dm", from: ws.id, fromName: ws.name, text, echo: true });
      return;
    }

    if (msg.kind === "chat") {
      const text = String(msg.text || "").slice(0, 300);
      if (!text) return;
      broadcast(room, { kind: "chat", name: ws.name, text });
      return;
    }

    if (msg.kind === "reaction") {
      const emoji = String(msg.emoji || "").slice(0, 4);
      if (!emoji) return;
      broadcast(room, { kind: "reaction", name: ws.name, emoji });
      return;
    }
  });

  ws.on("close", () => {
    const room = ws.room;
    if (!room) return;
    room.clients.delete(ws);
    broadcast(room, { kind: "playerLeave", id: ws.id, name: ws.name });

    if (room.host === ws) {
      room.host = room.clients.values().next().value || null;
      if (room.host) {
        send(room.host, { kind: "roomState", host: true, state: room.state, myId: room.host.id });
        broadcast(room, { kind: "chat", name: "Sistema", text: `${room.host.name} virou o novo Host 👑` });
      }
    }
    if (room.clients.size === 0) {
      for (const [key, r] of rooms) if (r === room) rooms.delete(key);
    }
  });
});

server.listen(PORT, () => {
  console.log(`✨ OpenVerse Party online em http://localhost:${PORT}`);
});