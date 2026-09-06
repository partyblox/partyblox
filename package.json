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

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "");
        cb(null, Date.now() + "-" + safe);
    }
});

const fileFilter = (_req, file, cb) => {
    const t = file.mimetype || "";
    if (t.startsWith("video/") || t.startsWith("audio/") || t.startsWith("image/")) {
        cb(null, true);
    } else {
        cb(new Error("Envie apenas imagem, vídeo ou áudio."), false);
    }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 300 * 1024 * 1024 } });

app.use(express.static(publicDir));
app.use("/uploads", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    next();
}, express.static(uploadsDir));

app.post("/upload", (req, res) => {
    upload.single("media")(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado." });
        
        const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
        const proto = forwardedProto || req.protocol || "http";
        const base = `${proto}://${req.get("host")}`;
        
        res.json({
            url: `${base}/uploads/${req.file.filename}`,
            type: req.file.mimetype,
            name: req.file.originalname
        });
    });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 * 1024 });
const rooms = new Map();

function getRoom(id) {
    if (!rooms.has(id)) {
        rooms.set(id, { id, host: null, clients: new Set(), state: { media: { type: "clear" }, screenOwner: null } });
    }
    return rooms.get(id);
}

function send(ws, data) {
    try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(data)); } catch (e) {}
}

function broadcast(room, data, except = null) {
    for (const client of room.clients) { if (client !== except) send(client, data); }
}

function getPlayers(room, except = null) {
    return [...room.clients].filter(c => c !== except).map(c => ({ playerId: c.pid, name: c.name }));
}

wss.on("connection", ws => {
    ws.room = null; ws.name = "Player"; ws.pid = null;

    ws.on("message", raw => {
        let msg; try { msg = JSON.parse(raw); } catch (e) { return; }

        if (msg.kind === "join") {
            const roomId = String(msg.room || "Praca-VIP").slice(0, 40);
            const room = getRoom(roomId);
            ws.room = room; ws.name = String(msg.name || "Player").slice(0, 20); ws.pid = String(msg.playerId || "").slice(0, 40);
            room.clients.add(ws);
            if (!room.host) room.host = ws;

            send(ws, { kind: "roomState", host: room.host === ws, state: room.state, playerCount: room.clients.size, players: getPlayers(room, ws) });
            
            if (room.state.screenOwner && room.state.screenOwner !== ws.pid) {
                const owner = [...room.clients].find(c => c.pid === room.state.screenOwner);
                if (owner) send(owner, { kind: "rtc", action: "screenRequest", from: ws.pid, to: room.state.screenOwner });
            }
            broadcast(room, { kind: "playerJoined", name: ws.name, playerId: ws.pid }, ws);
            return;
        }

        const room = ws.room; if (!room) return;

        if (msg.kind === "media") {
            if (ws !== room.host) return;
            room.state.media = msg.state || { type: "clear" };
            if (room.state.media.type === "screen" && room.state.media.active) room.state.screenOwner = ws.pid;
            else if (room.state.media.type === "clear" && room.state.screenOwner === ws.pid) room.state.screenOwner = null;
            broadcast(room, { kind: "media", state: room.state.media }); return;
        }
        if (msg.kind === "claimHost") {
            if (!room.host || !room.clients.has(room.host)) {
                room.host = ws; send(ws, { kind: "roomState", host: true, state: room.state, playerCount: room.clients.size, players: getPlayers(room, ws) });
            } return;
        }
        if (msg.kind === "chat") {
            const text = String(msg.text || "").slice(0, 200); if (!text) return;
            if (msg.to) {
                let target = [...room.clients].find(c => c.name === msg.to || c.pid === String(msg.to));
                if (target) send(target, { kind: "chat", name: ws.name, text, pid: ws.pid, to: msg.to });
                return;
            }
            broadcast(room, { kind: "chat", name: ws.name, text, pid: ws.pid }, ws); return;
        }
        if (msg.kind === "reaction") {
            broadcast(room, { kind: "reaction", playerId: ws.pid, name: ws.name, emoji: String(msg.emoji || "").slice(0, 8) }, ws); return;
        }
        if (msg.kind === "emote") {
            broadcast(room, { kind: "emote", playerId: ws.pid, id: String(msg.id || "").slice(0, 40), name: ws.name }, ws); return;
        }
        if (msg.kind === "rtc") {
            if (msg.action === "screenStarted") { room.state.screenOwner = ws.pid; broadcast(room, { kind: "rtc", action: "screenStarted", from: ws.pid }, ws); return; }
            if (msg.action === "screenStopped") { if (room.state.screenOwner === ws.pid) room.state.screenOwner = null; broadcast(room, { kind: "rtc", action: "screenStopped", from: ws.pid }, ws); return; }
            const targetId = String(msg.to || ""); if (!targetId) return;
            const target = [...room.clients].find(c => c.pid === targetId);
            if (target) send(target, { ...msg, from: ws.pid });
        }
    });

    ws.on("close", () => {
        const room = ws.room; if (!room) return;
        room.clients.delete(ws);
        if (room.state.screenOwner === ws.pid) { room.state.screenOwner = null; broadcast(room, { kind: "rtc", action: "screenStopped", from: ws.pid }); }
        broadcast(room, { kind: "playerLeft", name: ws.name, playerId: ws.pid });
        if (room.host === ws) {
            room.host = room.clients.values().next().value || null;
            if (room.host) send(room.host, { kind: "roomState", host: true, state: room.state, playerCount: room.clients.size, players: getPlayers(room, room.host) });
        }
        if (room.clients.size === 0) rooms.delete(room.id);
    });
});

server.listen(PORT, () => console.log(`PartyBlox Server online na porta ${PORT}`));
