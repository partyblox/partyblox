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

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

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
        const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "");
        cb(null, Date.now() + "-" + safeName);
    }
});

const fileFilter = (req, file, cb) => {
    const t = (file.mimetype || "").toLowerCase();
    const validTypes = ["video/", "audio/", "image/"];
    if (validTypes.some(type => t.startsWith(type))) cb(null, true);
    else cb(new Error("Formato não permitido."), false);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 900 * 1024 * 1024 } });
const chatUpload = multer({ storage, fileFilter, limits: { fileSize: 300 * 1024 * 1024 } });


app.use(express.static(publicDir));
app.use("/uploads", express.static(uploadsDir));

app.post("/upload", (req, res) => {
    upload.single("media")(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: "Arquivo muito grande." });
            return res.status(400).json({ error: err.message });
        }
        if (!req.file) return res.status(400).json({ error: "Nenhum arquivo." });
        const forwardedProto = String(req.headers["x-forwarded-proto"] || " ").split(",")[0].trim();
        const proto = forwardedProto || req.protocol || "http";
        const base = `${proto}://${req.get("host")}`;
        res.json({
            url: `${base}/uploads/${req.file.filename}`,
            type: req.file.mimetype,
            name: req.file.originalname
        });
    });
});

app.post("/upload-chat", (req, res) => {
    chatUpload.single("media")(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: "Arquivo do chat muito grande. Limite: 300MB." });
            return res.status(400).json({ error: err.message });
        }
        if (!req.file) return res.status(400).json({ error: "Nenhum arquivo." });
        const forwardedProto = String(req.headers["x-forwarded-proto"] || " ").split(",")[0].trim();
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
        rooms.set(id, {
            id,
            hosts: new Set(),      // MÚLTIPLOS HOSTS (playerIds)
            founder: null,         // primeiro host (master)
            clients: new Set(),
            state: { media: { type: "clear" }, screenOwner: null }
        });
    }
    return rooms.get(id);
}

function send(ws, data) {
    try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(data)); } catch (e) {}
}

function broadcast(room, data, except = null) {
    for (const client of room.clients) {
        if (client !== except) send(client, data);
    }
}

function getPlayers(room, except = null) {
    return [...room.clients].filter(c => c !== except).map(c => ({ 
        playerId: c.pid, name: c.name,
        id: c.pid  // compat com cliente
    }));
}

function hasClient(room, pid) {
    for (const c of room.clients) if (c.pid === pid) return true;
    return false;
}

function broadcastHosts(room) {
    const hosts = [...room.hosts];
    for (const client of room.clients) {
        send(client, {
            kind: "hostsChanged",
            hosts,
            founder: room.founder,
            playerId: client.pid
        });
    }
}

wss.on("connection", ws => {
    ws.room = null; ws.name = "Player"; ws.pid = null;

    ws.on("message", raw => {
        let msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }

        // ===== JOIN =====
        if (msg.kind === "join") {
            const roomId = String(msg.room || "Sala-Publica").slice(0, 40);
            const room = getRoom(roomId);
            ws.room = room;
            ws.name = String(msg.name || "Player").slice(0, 20);
            ws.pid = String(msg.playerId || "").slice(0, 40);
            room.clients.add(ws);
            
            if (room.hosts.size === 0 || msg.creator === true) {
                room.hosts.add(ws.pid);
                if (!room.founder) room.founder = ws.pid;
            }

            send(ws, { 
                kind: "roomState",
                hosts: [...room.hosts],
                founder: room.founder,
                host: room.hosts.has(ws.pid),   // backward compat
                hostId: room.founder,            // backward compat
                state: room.state,
                playerCount: room.clients.size,
                players: getPlayers(room, ws)
            });
            
            if (room.state.screenOwner && room.state.screenOwner !== ws.pid) {
                const owner = [...room.clients].find(c => c.pid === room.state.screenOwner);
                if (owner) send(owner, { kind: "rtc", action: "screenRequest", from: ws.pid, to: room.state.screenOwner });
            }
            broadcast(room, { kind: "playerJoined", name: ws.name, playerId: ws.pid }, ws);
            return;
        }

        const room = ws.room;
        if (!room) return;

        // ===== CLAIM HOST (adiciona-se como host) =====
        if (msg.kind === "claimHost") {
            if (room.hosts.size === 0) {
                room.hosts.add(ws.pid);
                if (!room.founder) room.founder = ws.pid;
                broadcastHosts(room);
            }
            return;
        }

        // ===== TRANSFER HOST (adiciona outro como host - NÃO remove quem transferiu) =====
        if (msg.kind === "transferHost") {
            if (!room.hosts.has(ws.pid)) return;
            const targetId = String(msg.targetId || "").slice(0, 40);
            if (!targetId || !hasClient(room, targetId)) return;
            room.hosts.add(targetId);
            broadcastHosts(room);
            return;
        }

        // ===== REMOVE HOST (retira host de outro player) =====
        if (msg.kind === "removeHost") {
            if (!room.hosts.has(ws.pid)) return;
            const targetId = String(msg.targetId || "").slice(0, 40);
            if (!targetId || targetId === ws.pid) return; // não pode tirar de si
            if (!room.hosts.has(targetId)) return;
            room.hosts.delete(targetId);
            broadcastHosts(room);
            return;
        }

        if (msg.kind === "ping") { send(ws, { kind: "pong", timestamp: Date.now() }); return; }

        // ===== MEDIA (qualquer host pode) =====
        if (msg.kind === "media") {
            if (!room.hosts.has(ws.pid)) return;
            room.state.media = msg.state || { type: "clear" };
            if (room.state.media.type === "screen" && room.state.media.active) {
                room.state.screenOwner = ws.pid;
            } else if (room.state.media.type === "clear" && room.state.screenOwner === ws.pid) {
                room.state.screenOwner = null;
            }
            broadcast(room, { kind: "media", state: room.state.media, screenOwner: room.state.screenOwner }, ws);
            return;
        }

        // ===== CHAT =====
        if (msg.kind === "chat") {
            const text = String(msg.text || "").slice(0, 300);
            if (!text) return;
            const payload = {
                kind: "chat", name: ws.name, text, pid: ws.pid,
                to: msg.to, media: msg.media || null, system: !!msg.system
            };
            if (msg.to) {
                for (const client of room.clients) {
                    if (client.name === msg.to || client.pid === String(msg.to)) {
                        send(client, payload);
                        break;
                    }
                }
                return;
            }
            broadcast(room, payload, ws);
            return;
        }

        if (msg.kind === "reaction") {
            const emoji = String(msg.emoji || "").slice(0, 8);
            if (!emoji) return;
            broadcast(room, { kind: "reaction", playerId: ws.pid, name: ws.name, emoji }, ws);
            return;
        }

        if (msg.kind === "emote") {
            const id = String(msg.id || "").slice(0, 40);
            const label = String(msg.label || "").slice(0, 30);
            if (!id) return;
            broadcast(room, { kind: "emote", playerId: ws.pid, id, label, name: ws.name }, ws);
            return;
        }

        // ===== GAME JOIN / GAME EVENT (CRUCIAL para multiplayer!) =====
        if (msg.kind === "game_join" || msg.kind === "game_event") {
            const gameId = String(msg.game || "").slice(0, 40);
            if (!gameId) return;
            broadcast(room, { ...msg, playerId: ws.pid, name: ws.name }, ws);
            return;
        }

        // ===== RTC =====
        if (msg.kind === "rtc") {
            const action = msg.action;
            if (action === "screenStarted") {
                room.state.screenOwner = ws.pid;
                broadcast(room, { kind: "rtc", action: "screenStarted", from: ws.pid, name: ws.name }, ws);
                return;
            }
            if (action === "screenStopped") {
                if (room.state.screenOwner === ws.pid) room.state.screenOwner = null;
                broadcast(room, { kind: "rtc", action: "screenStopped", from: ws.pid, name: ws.name }, ws);
                return;
            }
            const targetId = String(msg.to || "");
            if (!targetId) return;
            for (const client of room.clients) {
                if (client.pid === targetId) {
                    send(client, { ...msg, from: ws.pid });
                    break;
                }
            }
            return;
        }
    });

    ws.on("close", () => {
        const room = ws.room;
        if (!room) return;
        room.clients.delete(ws);
        
        if (room.state.screenOwner === ws.pid) {
            room.state.screenOwner = null;
            broadcast(room, { kind: "rtc", action: "screenStopped", from: ws.pid });
        }
        
        broadcast(room, { kind: "playerLeft", name: ws.name, playerId: ws.pid });
        
        // Se o host saiu, remove do set
        if (room.hosts.has(ws.pid)) {
            room.hosts.delete(ws.pid);
            if (room.founder === ws.pid) {
                // Promove o host mais antigo restante ou primeiro cliente
                room.founder = room.hosts.size > 0 
                    ? [...room.hosts][0] 
                    : (room.clients.size > 0 ? room.clients.values().next().value?.pid : null);
                if (room.founder && room.hosts.size === 0) {
                    room.hosts.add(room.founder);
                }
            }
            broadcastHosts(room);
        }
        
        if (room.clients.size === 0) rooms.delete(room.id);
    });
});

server.listen(PORT, () => {
    console.log(`🎬 PartyBlox Server online em http://localhost:${PORT}`);
    console.log(`📡 WebSocket pronto em ws://localhost:${PORT}`);
});