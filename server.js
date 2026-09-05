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


// ============================================================
// CORS (permite uploads de qualquer origem: GitHub Pages, etc.)
// ============================================================
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});


// ============================================================
// UPLOADS — valida ANTES de salvar no disco (fileFilter)
// ============================================================
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "");
        cb(null, Date.now() + "-" + safe);
    }
});

const fileFilter = (_req, file, cb) => {
    const t = file.mimetype || "";
    if (
        t.startsWith("video/") ||
        t.startsWith("audio/") ||
        t.startsWith("image/")
    ) {
        cb(null, true);
    } else {
        cb(new Error("Envie apenas imagem, vídeo ou áudio."), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 300 * 1024 * 1024 }
});


app.use(express.static(publicDir));
app.use("/uploads", express.static(uploadsDir));


// ============================================================
// UPLOAD DE IMAGEM / VÍDEO / ÁUDIO
// ============================================================
app.post("/upload", (req, res) => {
    upload.single("media")(req, res, (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ error: "Nenhum arquivo enviado." });
        }
        res.json({
            url: `/uploads/${req.file.filename}`,
            type: req.file.mimetype
        });
    });
});


// ============================================================
// HTTP + WEBSOCKET
// ============================================================
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 * 1024 });


// ============================================================
// SALAS
// ============================================================
const rooms = new Map();

function getRoom(id) {
    if (!rooms.has(id)) {
        rooms.set(id, {
            id,
            host: null,
            clients: new Set(),
            state: {
                dayMode: "day",
                media: { type: "clear" },
                screenOwner: null
            }
        });
    }
    return rooms.get(id);
}


// ============================================================
// ENVIAR
// ============================================================
function send(ws, data) {
    try {
        if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify(data));
        }
    } catch (e) {}
}


// ============================================================
// BROADCAST
// ============================================================
function broadcast(room, data, except = null) {
    for (const client of room.clients) {
        if (client !== except) send(client, data);
    }
}


// ============================================================
// LISTA DOS JOGADORES
// ============================================================
function getPlayers(room, except = null) {
    return [...room.clients]
        .filter(c => c !== except)
        .map(c => ({
            playerId: c.pid,
            name: c.name
        }));
}


// ============================================================
// WEBSOCKET
// ============================================================
wss.on("connection", ws => {
    ws.room = null;
    ws.name = "Player";
    ws.pid = null;


    // ========================================================
    // RECEBER MENSAGEM
    // ========================================================
    ws.on("message", raw => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch (e) {
            return;
        }


        // ====================================================
        // JOIN
        // ====================================================
        if (msg.kind === "join") {
            const roomId = String(msg.room || "Praca-VIP").slice(0, 40);
            const room = getRoom(roomId);

            ws.room = room;
            ws.name = String(msg.name || "Player").slice(0, 20);
            ws.pid = String(msg.playerId || "").slice(0, 40);

            room.clients.add(ws);

            if (!room.host) {
                room.host = ws;
            }

            // Envia estado completo para quem entrou
            send(ws, {
                kind: "roomState",
                host: room.host === ws,
                state: room.state,
                players: getPlayers(room, ws),
                playerCount: room.clients.size
            });

            // Avisa os outros
            broadcast(room, {
                kind: "playerJoined",
                name: ws.name,
                playerId: ws.pid
            }, ws);

            // Se já existe uma transmissão de tela, peça ao dono para
            // criar imediatamente uma conexão WebRTC com o novo jogador.
            if (room.state.screenOwner) {
                const owner = [...room.clients].find(c => c.pid === room.state.screenOwner);
                if (owner && owner !== ws) {
                    send(owner, {
                        kind: "rtc",
                        action: "screenRequest",
                        from: ws.pid,
                        to: owner.pid
                    });
                }
            }

            return;
        }


        // ====================================================
        // IGNORAR SE NÃO ESTÁ EM UMA SALA
        // ====================================================
        const room = ws.room;
        if (!room) return;


        // ====================================================
        // TROCA DE HOST
        // ====================================================
        if (msg.kind === "claimHost") {
            if (!room.host || !room.clients.has(room.host)) {
                room.host = ws;
            }
            if (room.host === ws) {
                send(ws, {
                    kind: "roomState",
                    host: true,
                    state: room.state,
                    players: getPlayers(room, ws),
                    playerCount: room.clients.size
                });
            }
            return;
        }

        // ====================================================
        // MÍDIA
        // ====================================================
        if (msg.kind === "media") {
            if (ws !== room.host) return;

            room.state.media = msg.state || { type: "clear" };

            broadcast(room, {
                kind: "media",
                state: room.state.media
            });
            return;
        }


        // ====================================================
        // DIA / NOITE
        // ====================================================
        if (msg.kind === "dayNight") {
            if (ws !== room.host) return;

            room.state.dayMode = msg.mode === "night" ? "night" : "day";

            broadcast(room, {
                kind: "dayNight",
                mode: room.state.dayMode
            });
            return;
        }


        // ====================================================
        // CHAT
        // ====================================================
        if (msg.kind === "chat") {
            const text = String(msg.text || "").slice(0, 200);
            if (!text) return;


            // ------------------------------------------------
            // MENSAGEM PRIVADA
            // ------------------------------------------------
            if (msg.to) {
                let target = null;
                for (const client of room.clients) {
                    if (
                        client.name === msg.to ||
                        client.pid === String(msg.to)
                    ) {
                        target = client;
                        break;
                    }
                }

                if (target) {
                    // Envia apenas para o destinatário
                    // (o remetente já adicionou a mensagem localmente)
                    send(target, {
                        kind: "chat",
                        name: ws.name,
                        text: text,
                        pid: ws.pid,
                        to: msg.to
                    });
                }
                return;
            }


            // ------------------------------------------------
            // CHAT PÚBLICO (sem eco pro remetente)
            // ------------------------------------------------
            broadcast(room, {
                kind: "chat",
                name: ws.name,
                text: text,
                pid: ws.pid
            }, ws);  // 👈 exceto quem enviou
            return;
        }


        // ====================================================
        // REAÇÕES
        // ====================================================
        if (msg.kind === "reaction") {
            const emoji = String(msg.emoji || "").slice(0, 8);
            if (!emoji) return;

            broadcast(room, {
                kind: "reaction",
                playerId: ws.pid,
                name: ws.name,
                emoji: emoji
            }, ws);
            return;
        }


        // ====================================================
        // POSIÇÃO
        // ====================================================
        if (msg.kind === "position") {
            broadcast(room, {
                kind: "position",
                playerId: ws.pid,
                name: ws.name,
                x: Number(msg.x) || 0,
                y: Number(msg.y) || 0,
                z: Number(msg.z) || 0,
                ry: Number(msg.ry) || 0
            }, ws);
            return;
        }


        // ====================================================
        // EMOTE
        // ====================================================
        if (msg.kind === "emote") {
            const id = String(msg.id || "").slice(0, 40);
            if (!id) return;

            broadcast(room, {
                kind: "emote",
                playerId: ws.pid,
                id: id,
                name: ws.name
            }, ws);
            return;
        }


        // ====================================================
        // WEBRTC (sinalização)
        // ====================================================
        if (msg.kind === "rtc") {
            const action = msg.action;


            // ----------------------------------------------
            // Começou compartilhamento de tela
            // ----------------------------------------------
            if (action === "screenStarted") {
                room.state.screenOwner = ws.pid;

                broadcast(room, {
                    kind: "rtc",
                    action: "screenStarted",
                    from: ws.pid,
                    name: ws.name
                }, ws);
                return;
            }


            // ----------------------------------------------
            // Parou compartilhamento de tela
            // ----------------------------------------------
            if (action === "screenStopped") {
                if (room.state.screenOwner === ws.pid) {
                    room.state.screenOwner = null;
                }

                broadcast(room, {
                    kind: "rtc",
                    action: "screenStopped",
                    from: ws.pid,
                    name: ws.name
                }, ws);
                return;
            }


            // ----------------------------------------------
            // Offer / Answer / ICE Candidate
            // ----------------------------------------------
            const targetId = String(msg.to || "");
            if (!targetId) return;

            for (const client of room.clients) {
                if (client.pid === targetId) {
                    send(client, {
                        ...msg,
                        from: ws.pid
                    });
                    break;
                }
            }
            return;
        }
    });


    // ========================================================
    // PLAYER SAIU
    // ========================================================
    ws.on("close", () => {
        const room = ws.room;
        if (!room) return;

        room.clients.delete(ws);


        // Se estava compartilhando tela
        if (room.state.screenOwner === ws.pid) {
            room.state.screenOwner = null;
            broadcast(room, {
                kind: "rtc",
                action: "screenStopped",
                from: ws.pid
            });
        }


        // Avisa que saiu
        broadcast(room, {
            kind: "playerLeft",
            name: ws.name,
            playerId: ws.pid
        });


        // Troca de host
        if (room.host === ws) {
            room.host = room.clients.values().next().value || null;
            if (room.host) {
                send(room.host, {
                    kind: "roomState",
                    host: true,
                    state: room.state,
                    players: getPlayers(room, room.host),
                    playerCount: room.clients.size
                });
            }
        }


        // Apaga sala vazia
        if (room.clients.size === 0) {
            rooms.delete(room.id);
        }
    });
});


// ============================================================
// INICIAR SERVIDOR
// ============================================================
server.listen(PORT, () => {
    console.log(`OpenVerse online em http://localhost:${PORT}`);
});
