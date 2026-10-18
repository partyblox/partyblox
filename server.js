const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");

let multer = null;
try { multer = require("multer"); } catch (_) { console.warn("[warn] multer ausente — rota /upload desativada."); }

const PORT = process.env.PORT || 3000;
const DISABLE_UPLOADS = process.env.DISABLE_UPLOADS === "1";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_PASSWORD_LEN = 40;
const DISCONNECT_GRACE_MS = 7000;

const app = express();
const publicDir = __dirname;

const uploadsBase    = process.env.UPLOADS_BASE || "/mnt/pendrive";
const uploadsDir     = path.join(uploadsBase, "uploads");
const chatDir        = path.join(uploadsBase, "uploads-chat");
const moviesDir      = path.join(uploadsDir, "movies");
const chunkUploadDir = path.join(uploadsDir, ".chunks");
const chatChunkDir   = path.join(chatDir, ".chunks");

if (!DISABLE_UPLOADS) {
    for (const d of [uploadsDir, chatDir, moviesDir, chunkUploadDir, chatChunkDir]) {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }
} else {
    if (!fs.existsSync(moviesDir)) fs.mkdirSync(moviesDir, { recursive: true });
}

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, X-Upload-Id, X-Chunk-Index, X-Total-Chunks, X-Original-Name, X-Mime-Type, X-Room-Id");
    res.header("Access-Control-Expose-Headers", "Content-Type");
    res.header("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

function getClientIp(req) {
    if (!req || !req.headers) return "?";
    return String(
        req.headers["cf-connecting-ip"] ||
        (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
        (req.socket && req.socket.remoteAddress) ||
        "?"
    );
}

const onlineIps = new Map();
const PRESENCE_TIMEOUT = 45 * 1000;

function updatePresence(ip) { if (!ip) return; onlineIps.set(ip, Date.now()); }
function getOnlineCount() {
    const now = Date.now();
    let count = 0;
    for (const [ip, ts] of onlineIps.entries()) {
        if (now - ts < PRESENCE_TIMEOUT) count++;
        else onlineIps.delete(ip);
    }
    return count;
}
setInterval(() => {
    const now = Date.now();
    for (const [ip, ts] of onlineIps.entries()) {
        if (now - ts >= PRESENCE_TIMEOUT) onlineIps.delete(ip);
    }
}, 60000);

app.post("/api/ping", (req, res) => {
    updatePresence(getClientIp(req));
    res.json({ ok: true, online: getOnlineCount() });
});

app.get("/health", (_req, res) => {
    res.json({ ok: true, version: "3.2-limite-fix", uptime: Math.floor(process.uptime()), rooms: rooms.size, online: getOnlineCount(), timestamp: Date.now() });
});

app.get("/api/movies", (_req, res) => {
    try {
        const allowed = new Set([".mp4", ".webm", ".m4v", ".mov", ".mkv", ".avi", ".mp3", ".m4a", ".ogg", ".wav", ".jpg", ".jpeg", ".png", ".webp", ".gif"]);
        if (!fs.existsSync(moviesDir)) return res.json({ movies: [], dir: moviesDir, exists: false });
        const files = fs.readdirSync(moviesDir, { withFileTypes: true })
            .filter(d => d.isFile() && allowed.has(path.extname(d.name).toLowerCase()))
            .map(d => { const full = path.join(moviesDir, d.name); const stat = fs.statSync(full); return { name: d.name, url: `/uploads/movies/${encodeURIComponent(d.name)}`, type: path.extname(d.name).toLowerCase(), size: stat.size, modified: stat.mtimeMs }; })
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
        res.set("Cache-Control", "no-store");
        res.json({ movies: files, dir: moviesDir, exists: true });
    } catch (err) { res.status(500).json({ error: "Erro ao listar filmes.", dir: moviesDir, details: err.message }); }
});

if (!DISABLE_UPLOADS) app.use("/uploads", express.static(uploadsDir, { setHeaders: res => { res.setHeader("Cache-Control", "no-store"); }}));
if (!DISABLE_UPLOADS) app.use("/uploads-chat", express.static(chatDir, { setHeaders: res => { res.setHeader("Cache-Control", "no-store"); }}));
app.use(express.static(publicDir));

if (multer) {
    const storage = multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, uploadsDir),
        filename: (_req, file, cb) => {
            const safeName = path.basename(file.originalname || "media").replace(/[^a-zA-Z0-9._-]/g, "") || "media";
            const rand = Math.random().toString(36).slice(2, 8);
            cb(null, Date.now() + "-" + rand + "-" + safeName);
        }
    });
    const fileFilter = (_req, file, cb) => {
        const t = (file.mimetype || "").toLowerCase();
        if (["video/", "audio/", "image/"].some(type => t.startsWith(type))) cb(null, true);
        else cb(new Error("Formato nao permitido."), false);
    };
    const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_UPLOAD_BYTES } });

    app.post("/upload", (req, res) => {
        upload.single("media")(req, res, (err) => {
            if (err) return res.status(400).json({ error: err.message });
            if (!req.file) return res.status(400).json({ error: "Nenhum arquivo." });
            const roomId = String(req.body.roomId || "").slice(0, 40);
            if (roomId) { const room = getRoom(roomId); if (!room.state.uploadedFiles) room.state.uploadedFiles = []; room.state.uploadedFiles.push("uploads/" + req.file.filename); }
            res.json({ url: `${buildBaseUrl(req)}/uploads/${req.file.filename}`, type: req.file.mimetype, name: req.file.originalname });
        });
    });
}

function buildBaseUrl(req) {
    const xfp = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
    let proto = xfp || req.protocol || "http";
    const host = req.get("host") || "";
    if (/trycloudflare\.com|cloudflare|\.dev$|\.app$/i.test(host)) proto = "https";
    return `${proto}://${host}`;
}

const CHUNK_UPLOAD_SIZE = 10 * 1024 * 1024;
const PROGRESSIVE_START_PERCENT = 12;
const PROGRESSIVE_MIN_BYTES = 20 * 1024 * 1024;

function safeChunkId(value) { return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100); }
function safeOriginalName(value) { try { value = decodeURIComponent(String(value || "media")); } catch (_) {} return path.basename(value).replace(/[^a-zA-Z0-9._-]/g, "") || "media"; }

function readUploadMeta(uploadId, isChat) {
    const metaPath = path.join(isChat ? chatChunkDir : chunkUploadDir, uploadId, "meta.json");
    if (!fs.existsSync(metaPath)) return null;
    try { return JSON.parse(fs.readFileSync(metaPath, "utf8")); } catch (_) { return null; }
}
function writeUploadMeta(meta, isChat) {
    const dir = path.join(isChat ? chatChunkDir : chunkUploadDir, meta.uploadId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
}

function appendPart(partPath, finalPath) {
    return new Promise((resolve, reject) => {
        const input = fs.createReadStream(partPath); const output = fs.createWriteStream(finalPath, { flags: "a" });
        let done = false; const fail = err => { if (done) return; done = true; input.destroy(); output.destroy(); reject(err); };
        input.on("error", fail); output.on("error", fail); output.on("finish", () => { if (done) return; done = true; resolve(); }); input.pipe(output);
    });
}

const uploadLocks = new Map();
async function withUploadLock(uploadId, fn) {
    const key = String(uploadId);
    while (uploadLocks.has(key)) {
        try { await uploadLocks.get(key); } catch (_) {}
    }
    let release;
    const lock = new Promise(r => { release = r; });
    uploadLocks.set(key, lock);
    try { return await fn(); }
    finally { uploadLocks.delete(key); release(); }
}

async function publishAvailableChunks(meta, isChat) {
    const dir = path.join(isChat ? chatChunkDir : chunkUploadDir, meta.uploadId);
    const targetDir = isChat ? chatDir : uploadsDir;
    const finalPath = path.join(targetDir, meta.finalName);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(finalPath)) fs.closeSync(fs.openSync(finalPath, "a"));

    while (meta.nextPublish < meta.totalChunks) {
        const partPath = path.join(dir, `${meta.nextPublish}.part`);
        if (!fs.existsSync(partPath)) break;
        await appendPart(partPath, finalPath);
        const partSize = fs.statSync(partPath).size;
        meta.publishedBytes += partSize;
        meta.publishedChunks++;
        meta.nextPublish++;
        try { fs.unlinkSync(partPath); } catch (_) {}
        writeUploadMeta(meta, isChat);
    }
    meta.readyPercent = computeUploadPercent(meta);
    return meta;
}

function computeUploadPercent(meta) {
    if (!meta) return 0;
    if (meta.size > 0) return Math.min(100, Math.round((meta.publishedBytes / meta.size) * 100));
    if (meta.totalChunks > 0) return Math.min(99, Math.round((meta.publishedChunks / meta.totalChunks) * 100));
    return 0;
}

function progressiveReady(meta) {
    if (!meta) return false;
    if (meta.publishedBytes >= PROGRESSIVE_MIN_BYTES) return true;
    if (meta.size > 0) return (meta.publishedBytes / meta.size) * 100 >= PROGRESSIVE_START_PERCENT;
    if (meta.totalChunks > 0) return (meta.publishedChunks / meta.totalChunks) * 100 >= PROGRESSIVE_START_PERCENT;
    return false;
}

function rememberRoomUpload(meta, isChat) {
    if (!meta.roomId) return;
    const room = getRoom(meta.roomId);
    if (!room.state.uploadedFiles) room.state.uploadedFiles = [];
    const rel = (isChat ? "uploads-chat/" : "uploads/") + meta.finalName;
    if (!room.state.uploadedFiles.includes(rel)) room.state.uploadedFiles.push(rel);
}

function broadcastProgressiveMedia(meta) {
    if (!meta.roomId || !progressiveReady(meta)) return;
    const now = Date.now();
    if (meta._lastBroadcastAt && now - meta._lastBroadcastAt < 2000) return;
    meta._lastBroadcastAt = now;
    const room = rooms.get(meta.roomId);
    if (!room || !room.clients.size) return;
    const url = `${meta.baseUrl}/uploads/${encodeURIComponent(meta.finalName)}`;
    const state = {
        type: meta.mime.startsWith("video/") ? "video" : meta.mime.startsWith("audio/") ? "audio" : "image",
        url,
        name: meta.originalName,
        uploading: !meta.complete,
        uploadedBytes: meta.publishedBytes,
        totalBytes: meta.size || (meta.totalChunks * CHUNK_UPLOAD_SIZE),
        uploadPercent: computeUploadPercent(meta),
        updatedAt: Date.now()
    };
    room.state.media = state;
    broadcast(room, { kind: "media", state, screenOwner: room.state.screenOwner });
}

function handleUploadChunk(isChat) {
    return (req, res) => {
        if (DISABLE_UPLOADS) return res.status(503).json({ error: "Uploads desativados." });
        const uploadId = safeChunkId(req.headers["x-upload-id"]);
        const index = Number.parseInt(req.headers["x-chunk-index"], 10);
        const totalChunks = Number.parseInt(req.headers["x-total-chunks"], 10);
        const roomId = String(req.headers["x-room-id"] || "").slice(0, 40);
        const originalName = safeOriginalName(req.headers["x-original-name"] || "media");
        const mime = String(req.headers["x-mime-type"] || "application/octet-stream").toLowerCase();

        if (!uploadId || !Number.isInteger(index) || !Number.isInteger(totalChunks) || index < 0 || totalChunks < 1 || index >= totalChunks) return res.status(400).json({ error: "Bloco inválido." });
        if (!(mime.startsWith("video/") || mime.startsWith("audio/") || mime.startsWith("image/"))) return res.status(400).json({ error: "Tipo não permitido." });

        const dir = path.join(isChat ? chatChunkDir : chunkUploadDir, uploadId);
        fs.mkdirSync(dir, { recursive: true });

        let meta = readUploadMeta(uploadId, isChat);
        if (!meta) {
            const finalName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${originalName}`;
            meta = {
                uploadId, roomId, originalName, mime, totalChunks,
                size: 0, finalName, baseUrl: buildBaseUrl(req),
                publishedBytes: 0, publishedChunks: 0, nextPublish: 0, readyPercent: 0,
                complete: false, isChat: !!isChat
            };
            writeUploadMeta(meta, isChat);
        }

        const partPath = path.join(dir, `${index}.part`);
        const output = fs.createWriteStream(partPath);
        let bytes = 0, finished = false;
        req.on("data", chunk => { bytes += chunk.length; });
        req.on("error", () => { if (!finished) { finished = true; output.destroy(); } });
        output.on("error", () => {
            if (!finished) { finished = true; req.destroy(); if (!res.headersSent) res.status(500).json({ error: "Falha ao gravar." }); }
        });
        output.on("finish", async () => {
            if (finished) return;
            finished = true;
            try {
                await withUploadLock(uploadId, async () => {
                    const freshMeta = readUploadMeta(uploadId, isChat) || meta;
                    meta = freshMeta;
                    if (meta.nextPublish > index) {
                        try { fs.unlinkSync(partPath); } catch (_) {}
                    } else {
                        await publishAvailableChunks(meta, isChat);
                        writeUploadMeta(meta, isChat);
                        if (!isChat && progressiveReady(meta)) {
                            rememberRoomUpload(meta, false);
                            broadcastProgressiveMedia(meta);
                        }
                    }
                });
                const url = isChat
                    ? `${meta.baseUrl}/uploads-chat/${encodeURIComponent(meta.finalName)}`
                    : (progressiveReady(meta) ? `${meta.baseUrl}/uploads/${encodeURIComponent(meta.finalName)}` : null);
                res.json({
                    ok: true, index, totalChunks, bytes,
                    uploadedBytes: meta.publishedBytes,
                    uploadPercent: computeUploadPercent(meta),
                    progressiveReady: !isChat && progressiveReady(meta),
                    url, type: meta.mime, name: meta.originalName
                });
            } catch (err) {
                if (!res.headersSent) res.status(500).json({ error: "Falha ao publicar." });
            }
        });
        req.pipe(output);
    };
}

app.post("/upload-chunk", handleUploadChunk(false));
app.post("/upload-chunk-chat", handleUploadChunk(true));

app.post("/upload-complete", express.json({ limit: "1mb" }), async (req, res) => {
    if (DISABLE_UPLOADS) return res.status(503).json({ error: "Uploads desativados." });
    const uploadId = safeChunkId(req.body.uploadId);
    const roomId = String(req.body.roomId || "").slice(0, 40);
    const originalName = safeOriginalName(req.body.name);
    const mime = String(req.body.type || "").toLowerCase();
    const size = Number(req.body.size);
    const isChat = req.body.isChat === true;

    if (!uploadId || !Number.isSafeInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) return res.status(400).json({ error: "Tamanho inválido." });

    try {
        const result = await withUploadLock(uploadId, async () => {
            let meta = readUploadMeta(uploadId, isChat);
            if (!meta) return { error: "Upload não encontrado.", status: 404 };
            meta.roomId = roomId || meta.roomId;
            meta.originalName = originalName || meta.originalName;
            meta.mime = mime || meta.mime;
            meta.size = size;
            meta.totalChunks = Math.ceil(size / CHUNK_UPLOAD_SIZE);
            await publishAvailableChunks(meta, isChat);
            if (meta.publishedChunks !== meta.totalChunks || meta.publishedBytes !== size) {
                return { error: "Faltam blocos.", status: 409, uploadedBytes: meta.publishedBytes, totalBytes: size };
            }
            meta.complete = true;
            meta.readyPercent = 100;
            writeUploadMeta(meta, isChat);
            rememberRoomUpload(meta, isChat);
            return { meta };
        });

        if (result.error) return res.status(result.status).json({ error: result.error, uploadedBytes: result.uploadedBytes, totalBytes: result.totalBytes });
        const meta = result.meta;
        const url = `${meta.baseUrl}/${isChat ? 'uploads-chat' : 'uploads'}/${encodeURIComponent(meta.finalName)}`;
        if (!isChat && roomId) {
            const room = rooms.get(roomId);
            if (room) {
                const state = {
                    type: meta.mime.startsWith("video/") ? "video" : meta.mime.startsWith("audio/") ? "audio" : "image",
                    url, name: meta.originalName, uploading: false,
                    uploadedBytes: size, totalBytes: size, uploadPercent: 100, updatedAt: Date.now()
                };
                room.state.media = state;
                broadcast(room, { kind: "media", state, screenOwner: room.state.screenOwner });
            }
        }
        fs.rmSync(path.join(isChat ? chatChunkDir : chunkUploadDir, uploadId), { recursive: true, force: true });
        return res.json({ url, type: meta.mime, name: meta.originalName, uploading: false, uploadPercent: 100 });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
});

const server = http.createServer(app);
server.on("error", (err) => { console.error("[server] erro:", err && err.message || err); });

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 * 1024 });
const rooms = new Map();

function getRoom(id) {
    if (!rooms.has(id)) rooms.set(id, {
        id, hosts: new Set(), founder: null, clients: new Set(),
        pendingDisconnects: new Map(), password: "", maxUsers: 50, typing: new Map(),
        state: { media: { type: "clear" }, screenOwner: null, uploadedFiles: [] }
    });
    return rooms.get(id);
}

function send(ws, data) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(data)); } catch (_) {} }
function broadcast(room, data, except = null) { for (const client of room.clients) { if (client !== except) send(client, data); } }
function getPlayers(room, except = null) { return [...room.clients].filter(c => c !== except).map(c => ({ playerId: c.pid, name: c.name, id: c.pid })); }
function hasClient(room, pid) { for (const c of room.clients) if (c.pid === pid) return true; return false; }
function broadcastHosts(room) { const hosts = [...room.hosts]; for (const client of room.clients) send(client, { kind: "hostsChanged", hosts, founder: room.founder, playerId: client.pid }); }

function broadcastTyping(room) {
    const now = Date.now();
    for (const [pid, ts] of room.typing.entries()) {
        if (now - ts > 2500) room.typing.delete(pid);
    }
    const typers = [...room.typing.keys()].map(pid => {
        const c = [...room.clients].find(x => x.pid === pid);
        return c ? c.name : null;
    }).filter(Boolean);
    broadcast(room, { kind: "typing", users: typers });
}

setInterval(() => {
    for (const room of rooms.values()) {
        if (room.typing.size > 0) broadcastTyping(room);
    }
}, 1000);

function cleanupRoomFiles(room) {
    for (const rel of (room.state.uploadedFiles || [])) fs.unlink(path.join(uploadsBase, rel), () => {});
    room.state.uploadedFiles = [];
    for (const base of [chunkUploadDir, chatChunkDir]) {
        try {
            if (!fs.existsSync(base)) continue;
            const isChat = base === chatChunkDir;
            for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const meta = readUploadMeta(entry.name, isChat);
                if (meta && meta.roomId === room.id) fs.rmSync(path.join(base, entry.name), { recursive: true, force: true });
            }
        } catch (_) {}
    }
}

function finalizeDisconnect(ws, reason = "disconnect") {
    if (!ws || ws._finalized) return;
    const room = ws.room;
    if (!room) { ws._finalized = true; return; }
    const pending = room.pendingDisconnects.get(ws.pid);
    if (pending && pending.ws === ws) room.pendingDisconnects.delete(ws.pid);
    ws._finalized = true;
    room.clients.delete(ws);
    room.typing.delete(ws.pid);
    if (room.state.screenOwner === ws.pid) {
        room.state.screenOwner = null;
        broadcast(room, { kind: "rtc", action: "screenStopped", from: ws.pid });
    }
    broadcast(room, { kind: "playerLeft", name: ws.name, playerId: ws.pid, playerCount: room.clients.size });
    if (room.hosts.has(ws.pid)) {
        room.hosts.delete(ws.pid);
        if (room.founder === ws.pid) {
            room.founder = room.hosts.size > 0
                ? [...room.hosts][0]
                : (room.clients.size > 0 ? room.clients.values().next().value.pid : null);
            if (room.founder && room.hosts.size === 0) room.hosts.add(room.founder);
        }
        broadcastHosts(room);
    }
    if (room.clients.size === 0) { cleanupRoomFiles(room); rooms.delete(room.id); }
}

wss.on("connection", (ws, req) => {
    updatePresence(getClientIp(req));
    ws.room = null; ws.name = "Player"; ws.pid = null;

    ws.on("message", raw => {
        let msg; try { msg = JSON.parse(raw); } catch (_) { return; }

        if (msg.kind === "join") {
            const roomId = String(msg.room || "Sala-Publica").slice(0, 40);
            const isCreator = msg.creator === true;
            const providedPassword = String(msg.password || "").slice(0, MAX_PASSWORD_LEN);
            const requestedMaxUsers = Number(msg.maxUsers);
            const maxUsers = Number.isFinite(requestedMaxUsers)
                ? Math.max(1, Math.min(10000, Math.trunc(requestedMaxUsers)))
                : 1;

            // Uma sala só pode ser criada pelo botão "Criar Sala".
            // Entrar por link/nome nunca deve criar uma sala vazia implicitamente.
            if (!isCreator && !rooms.has(roomId)) {
                return send(ws, { kind: "joinRejected", roomId, message: `A sala "${roomId}" não existe ou já foi encerrada.` });
            }

            if (isCreator && rooms.has(roomId)) {
                const existing = rooms.get(roomId);
                if (existing.clients.size > 0) return send(ws, { kind: "roomExists", roomId, message: `A sala "${roomId}" ja existe.` });
            }
            const room = getRoom(roomId);
            if (isCreator) {
                room.password = providedPassword;
                // O limite é total de participantes, incluindo quem criou a sala.
                // 0 e 1 significam sala privada para uma única pessoa.
                room.maxUsers = maxUsers;
            } else {
                if (room.password && providedPassword !== room.password) return send(ws, { kind: "wrongPassword", roomId, message: `Senha incorreta.` });
            }

            ws.room = room;
            ws.name = String(msg.name || "Player").slice(0, 20);
            ws.pid = String(msg.playerId || "").slice(0, 40);
            ws._finalized = false;

            const wasPending = room.pendingDisconnects.has(ws.pid);
            const wasInClients = [...room.clients].some(c => c.pid === ws.pid);
            const isReconnect = wasPending || wasInClients;

            if (!isReconnect && room.clients.size >= room.maxUsers) {
                return send(ws, { kind: "kicked", message: "A sala está cheia." });
            }

            const pending = room.pendingDisconnects.get(ws.pid);
            if (pending && pending.ws) {
                clearTimeout(pending.timer);
                room.pendingDisconnects.delete(ws.pid);
                pending.ws._replacedByReconnect = true;
                room.clients.delete(pending.ws);
            }
            const existingSamePid = [...room.clients].find(c => c !== ws && c.pid === ws.pid);
            if (existingSamePid) {
                existingSamePid._replacedByReconnect = true;
                room.clients.delete(existingSamePid);
            }
            room.clients.add(ws);

            const onlyOne = room.clients.size === 1;
            if (isCreator || room.hosts.size === 0 || onlyOne) {
                if (onlyOne && !isCreator) room.hosts.clear();
                room.hosts.add(ws.pid);
                if (!room.founder || !room.hosts.has(room.founder)) room.founder = ws.pid;
            }
            send(ws, {
                kind: "roomState", hosts: [...room.hosts], founder: room.founder,
                host: room.hosts.has(ws.pid), hostId: room.founder,
                state: room.state, playerCount: room.clients.size, maxUsers: room.maxUsers,
                players: getPlayers(room, ws)
            });
            if (room.state.screenOwner && room.state.screenOwner !== ws.pid) {
                const owner = [...room.clients].find(c => c.pid === room.state.screenOwner);
                if (owner) send(owner, { kind: "rtc", action: "screenRequest", from: ws.pid, to: room.state.screenOwner });
            }
            if (!isReconnect) broadcast(room, { kind: "playerJoined", name: ws.name, playerId: ws.pid }, ws);
            return;
        }

        const room = ws.room;
        if (!room) return;

        if (msg.kind === "typing") {
            if (ws.pid && room.clients.has(ws)) {
                room.typing.set(ws.pid, Date.now());
                broadcastTyping(room);
            }
            return;
        }
        if (msg.kind === "stopTyping") {
            if (ws.pid) room.typing.delete(ws.pid);
            broadcastTyping(room);
            return;
        }

        if (msg.kind === "leave") {
            finalizeDisconnect(ws, "leave");
            try { ws.close(1000, "leave"); } catch (_) {}
            return;
        }

        if (msg.kind === "claimHost") {
            if (room.hosts.size === 0) { room.hosts.add(ws.pid); if (!room.founder) room.founder = ws.pid; broadcastHosts(room); }
            return;
        }
        if (msg.kind === "transferHost") {
            if (!room.hosts.has(ws.pid)) return;
            const targetId = String(msg.targetId || "").slice(0, 40);
            if (!targetId || !hasClient(room, targetId)) return;
            room.hosts.add(targetId);
            broadcastHosts(room);
            return;
        }
        if (msg.kind === "removeHost") {
            if (!room.hosts.has(ws.pid)) return;
            const targetId = String(msg.targetId || "").slice(0, 40);
            if (!targetId || targetId === ws.pid || !room.hosts.has(targetId)) return;
            room.hosts.delete(targetId);
            broadcastHosts(room);
            return;
        }
        if (msg.kind === "ping") { send(ws, { kind: "pong", timestamp: Date.now() }); return; }

        if (msg.kind === "media") {
            if (!room.hosts.has(ws.pid)) return;
            room.state.media = msg.state || { type: "clear" };
            if (room.state.media.type === "screen" && room.state.media.active) room.state.screenOwner = ws.pid;
            else if (room.state.media.type === "clear" && room.state.screenOwner === ws.pid) room.state.screenOwner = null;
            broadcast(room, { kind: "media", state: room.state.media, screenOwner: room.state.screenOwner }, ws);
            return;
        }
        if (msg.kind === "mediaHeartbeat") {
            if (!room.hosts.has(ws.pid)) return;
            if (msg.state) room.state.media = msg.state;
            return;
        }
        if (msg.kind === "syncRequest") {
            if (room.hosts.has(ws.pid)) return;
            for (const host of room.clients) {
                if (room.hosts.has(host.pid)) send(host, { kind: "syncRequest", requesterId: ws.pid, playerId: ws.pid });
            }
            return;
        }
        if (msg.kind === "syncState") {
            if (!room.hosts.has(ws.pid)) return;
            const state = msg.state || null; if (!state) return;
            room.state.media = state;
            const targetId = String(msg.targetId || "").slice(0, 40);
            if (targetId) {
                for (const c of room.clients) {
                    if (c.pid === targetId) { send(c, { kind: "sync", state, timestamp: Date.now() }); break; }
                }
            } else broadcast(room, { kind: "media", state, screenOwner: room.state.screenOwner }, ws);
            return;
        }
        if (msg.kind === "sync") {
            if (!room.hosts.has(ws.pid)) return;
            const state = msg.state || room.state.media;
            room.state.media = state;
            broadcast(room, { kind: "sync", state, timestamp: Date.now() }, ws);
            return;
        }

        if (msg.kind === "chat") {
            const text = String(msg.text || "").slice(0, 300);
            if (!text) return;
            room.typing.delete(ws.pid);
            const payload = { kind: "chat", name: ws.name, text, pid: ws.pid, playerId: ws.pid, to: msg.to, media: msg.media || null, system: !!msg.system, color: msg.color || null };
            if (msg.to) {
                let delivered = false;
                for (const client of room.clients) {
                    if (client.name === msg.to || client.pid === String(msg.to)) {
                        send(client, payload);
                        send(ws, { ...payload, _echo: true });
                        delivered = true;
                        break;
                    }
                }
                if (!delivered) send(ws, { kind: "chat", name: "Sistema", pid: "system", playerId: "system", text: `⚠️ "${msg.to}" não está na sala.`, system: true });
                return;
            }
            broadcast(room, payload, ws);
            return;
        }

        if (msg.kind === "kickPlayer") {
            if (!room.hosts.has(ws.pid)) return;
            const targetId = String(msg.targetId || "").slice(0, 40);
            if (!targetId || targetId === ws.pid || targetId === room.founder) return;
            const target = [...room.clients].find(c => c.pid === targetId);
            if (!target) return;
            send(target, { kind: "kicked", message: "Host removeu você." });
            target._kicked = true;
            finalizeDisconnect(target, "kicked");
            try { target.close(4001, "kicked"); } catch (_) {}
            return;
        }
        if (msg.kind === "reaction") {
            const emoji = String(msg.emoji || "").slice(0, 8);
            if (!emoji) return;
            broadcast(room, { kind: "reaction", playerId: ws.pid, name: ws.name, emoji }, ws);
            return;
        }
        if (msg.kind === "game_join" || msg.kind === "game_event") {
            const gameId = String(msg.game || "").slice(0, 40);
            if (!gameId) return;
            broadcast(room, { ...msg, playerId: ws.pid, name: ws.name }, ws);
            return;
        }
        if (msg.kind === "rtc") {
            if (msg.action === "screenStarted") {
                room.state.screenOwner = ws.pid;
                broadcast(room, { kind: "rtc", action: "screenStarted", from: ws.pid, name: ws.name }, ws);
                return;
            }
            if (msg.action === "screenStopped") {
                if (room.state.screenOwner === ws.pid) room.state.screenOwner = null;
                broadcast(room, { kind: "rtc", action: "screenStopped", from: ws.pid, name: ws.name }, ws);
                return;
            }
            const targetId = String(msg.to || "");
            if (!targetId) return;
            for (const client of room.clients) {
                if (client.pid === targetId) { send(client, { ...msg, from: ws.pid }); break; }
            }
            return;
        }
    });

    ws.on("close", () => {
        const room = ws.room;
        if (!room || ws._finalized || ws._replacedByReconnect) return;
        if (ws._kicked) { finalizeDisconnect(ws, "kicked"); return; }
        const oldPending = room.pendingDisconnects.get(ws.pid);
        if (oldPending) clearTimeout(oldPending.timer);
        const timer = setTimeout(() => {
            const pending = room.pendingDisconnects.get(ws.pid);
            if (!pending || pending.ws !== ws) return;
            room.pendingDisconnects.delete(ws.pid);
            finalizeDisconnect(ws, "timeout de reconexao");
        }, DISCONNECT_GRACE_MS);
        room.pendingDisconnects.set(ws.pid, { ws, timer });
    });
    ws.on("error", () => {});
});

server.listen(PORT, () => {
    console.log("=================================================");
    console.log("  PartyBlox Server v3.2-limite-fix");
    console.log("  Online em http://localhost:" + PORT);
    console.log("=================================================");
});