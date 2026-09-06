const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const multer = require("multer");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const app = express();

app.set("trust proxy", true);

const publicDir = __dirname;
const uploadsDir = path.join(publicDir, "uploads");

fs.mkdirSync(uploadsDir, { recursive: true });


// ============================================================
// CORS
// Permite uploads vindos do site hospedado em outra origem.
// ============================================================
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, X-Requested-With"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});


// ============================================================
// UPLOADS
// ============================================================
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadsDir);
    },

    filename: (_req, file, cb) => {
        const safe = path
            .basename(file.originalname)
            .replace(/[^a-zA-Z0-9._-]/g, "");

        cb(null, Date.now() + "-" + safe);
    }
});


// ============================================================
// TIPOS ACEITOS
// ============================================================
const fileFilter = (_req, file, cb) => {
    const type = file.mimetype || "";

    if (
        type.startsWith("video/") ||
        type.startsWith("audio/") ||
        type.startsWith("image/")
    ) {
        cb(null, true);
    } else {
        cb(
            new Error(
                "Envie apenas imagem, vídeo ou áudio."
            ),
            false
        );
    }
};


// ============================================================
// CONFIGURAÇÃO DO MULTER
// ============================================================
const upload = multer({
    storage,
    fileFilter,

    limits: {
        fileSize: 300 * 1024 * 1024
    }
});


// ============================================================
// HEALTH CHECK
// Usado para confirmar que o servidor correto está online.
// ============================================================
app.get("/health", (_req, res) => {
    res.status(200).json({
        ok: true,
        service: "partyblox",
        upload: true
    });
});


// ============================================================
// UPLOAD DE IMAGEM / VÍDEO / ÁUDIO
// ============================================================
app.post("/upload", (req, res) => {

    upload.single("media")(req, res, (err) => {

        // Erro do Multer
        if (err) {
            return res.status(400).json({
                error: err.message
            });
        }

        // Nenhum arquivo recebido
        if (!req.file) {
            return res.status(400).json({
                error: "Nenhum arquivo enviado."
            });
        }

        // Detecta HTTPS no Render / proxy
        const forwardedProto = String(
            req.headers["x-forwarded-proto"] || ""
        )
            .split(",")[0]
            .trim();

        const proto =
            forwardedProto ||
            req.protocol ||
            "http";

        const base =
            `${proto}://${req.get("host")}`;

        // Retorna SEMPRE JSON
        return res.status(200).json({
            url:
                `${base}/uploads/${req.file.filename}`,

            type:
                req.file.mimetype,

            name:
                req.file.originalname
        });
    });
});


// ============================================================
// ARQUIVOS PÚBLICOS
// ============================================================
app.use(express.static(publicDir));


// ============================================================
// PASTA DE UPLOADS
// ============================================================
app.use(
    "/uploads",

    (req, res, next) => {
        res.header(
            "Access-Control-Allow-Origin",
            "*"
        );

        next();
    },

    express.static(uploadsDir)
);


// ============================================================
// ERRO HTTP
// Garante resposta JSON em vez de página HTML.
// ============================================================
app.use((err, _req, res, _next) => {

    console.error(
        "[HTTP ERROR]",
        err
    );

    if (res.headersSent) {
        return;
    }

    res.status(500).json({
        error:
            err && err.message
                ? err.message
                : "Erro interno do servidor."
    });
});


// ============================================================
// HTTP + WEBSOCKET
// ============================================================
const server =
    http.createServer(app);

const wss =
    new WebSocketServer({
        server,
        maxPayload: 16 * 1024 * 1024
    });


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

                media: {
                    type: "clear"
                },

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

        if (
            ws &&
            ws.readyState === 1
        ) {

            ws.send(
                JSON.stringify(data)
            );
        }

    } catch (e) {}
}


// ============================================================
// BROADCAST
// ============================================================
function broadcast(
    room,
    data,
    except = null
) {

    for (
        const client
        of room.clients
    ) {

        if (client !== except) {

            send(
                client,
                data
            );
        }
    }
}


// ============================================================
// LISTA DOS JOGADORES
// ============================================================
function getPlayers(
    room,
    except = null
) {

    return [
        ...room.clients
    ]

        .filter(
            c => c !== except
        )

        .map(c => ({

            playerId:
                c.pid,

            name:
                c.name
        }));
}


// ============================================================
// WEBSOCKET
// ============================================================
wss.on(
    "connection",
    ws => {

        ws.room = null;

        ws.name = "Player";

        ws.pid = null;


        // ====================================================
        // RECEBER MENSAGEM
        // ====================================================
        ws.on(
            "message",
            raw => {

                let msg;

                try {

                    msg =
                        JSON.parse(raw);

                } catch (e) {

                    return;
                }


                // ====================================================
                // JOIN
                // ====================================================
                if (
                    msg.kind === "join"
                ) {

                    const roomId =
                        String(
                            msg.room ||
                            "Praca-VIP"
                        )
                        .slice(0, 40);

                    const room =
                        getRoom(roomId);


                    ws.room =
                        room;

                    ws.name =
                        String(
                            msg.name ||
                            "Player"
                        )
                        .slice(0, 20);

                    ws.pid =
                        String(
                            msg.playerId ||
                            ""
                        )
                        .slice(0, 40);


                    room.clients.add(ws);


                    // Primeiro jogador vira Host
                    if (!room.host) {

                        room.host =
                            ws;
                    }


                    // Envia estado completo
                    // para quem entrou
                    send(
                        ws,
                        {
                            kind:
                                "roomState",

                            host:
                                room.host === ws,

                            state:
                                room.state,

                            playerCount:
                                room.clients.size,

                            players:
                                getPlayers(
                                    room,
                                    ws
                                )
                        }
                    );


                    // =================================================
                    // COMPARTILHAMENTO DE TELA
                    // =================================================
                    if (
                        room.state.screenOwner &&
                        room.state.screenOwner !== ws.pid
                    ) {

                        const owner =
                            [
                                ...room.clients
                            ].find(
                                c =>
                                    c.pid ===
                                    room.state.screenOwner
                            );


                        if (owner) {

                            send(
                                owner,
                                {
                                    kind:
                                        "rtc",

                                    action:
                                        "screenRequest",

                                    from:
                                        ws.pid,

                                    to:
                                        room.state.screenOwner
                                }
                            );
                        }
                    }


                    // Avisa os outros jogadores
                    broadcast(
                        room,

                        {
                            kind:
                                "playerJoined",

                            name:
                                ws.name,

                            playerId:
                                ws.pid
                        },

                        ws
                    );


                    return;
                }


                // ====================================================
                // IGNORA SE NÃO ESTÁ EM SALA
                // ====================================================
                const room =
                    ws.room;

                if (!room) {
                    return;
                }


                // ====================================================
                // MÍDIA
                // ====================================================
                if (
                    msg.kind === "media"
                ) {

                    // Somente Host
                    if (
                        ws !== room.host
                    ) {

                        return;
                    }


                    room.state.media =
                        msg.state ||
                        {
                            type:
                                "clear"
                        };


                    if (
                        room.state.media.type ===
                            "screen" &&
                        room.state.media.active
                    ) {

                        room.state.screenOwner =
                            ws.pid;

                    }

                    else if (
                        room.state.media.type ===
                            "clear" &&
                        room.state.screenOwner ===
                            ws.pid
                    ) {

                        room.state.screenOwner =
                            null;
                    }


                    broadcast(
                        room,

                        {
                            kind:
                                "media",

                            state:
                                room.state.media
                        }
                    );


                    return;
                }


                // ====================================================
                // RECUPERAR HOST
                // ====================================================
                if (
                    msg.kind ===
                    "claimHost"
                ) {

                    if (
                        !room.host ||
                        !room.clients.has(
                            room.host
                        )
                    ) {

                        room.host =
                            ws;


                        send(
                            ws,

                            {
                                kind:
                                    "roomState",

                                host:
                                    true,

                                state:
                                    room.state,

                                playerCount:
                                    room.clients.size,

                                players:
                                    getPlayers(
                                        room,
                                        ws
                                    )
                            }
                        );
                    }

                    return;
                }


                // ====================================================
                // DIA / NOITE
                // ====================================================
                if (
                    msg.kind ===
                    "dayNight"
                ) {

                    if (
                        ws !== room.host
                    ) {

                        return;
                    }


                    room.state.dayMode =
                        msg.mode ===
                            "night"
                            ? "night"
                            : "day";


                    broadcast(
                        room,

                        {
                            kind:
                                "dayNight",

                            mode:
                                room.state.dayMode
                        }
                    );


                    return;
                }


                // ====================================================
                // CHAT
                // ====================================================
                if (
                    msg.kind ===
                    "chat"
                ) {

                    const text =
                        String(
                            msg.text ||
                            ""
                        )
                        .slice(0, 200);


                    if (!text) {
                        return;
                    }


                    // =================================================
                    // MENSAGEM PRIVADA
                    // =================================================
                    if (msg.to) {

                        let target =
                            null;


                        for (
                            const client
                            of room.clients
                        ) {

                            if (
                                client.name ===
                                    msg.to ||

                                client.pid ===
                                    String(
                                        msg.to
                                    )
                            ) {

                                target =
                                    client;

                                break;
                            }
                        }


                        if (target) {

                            send(
                                target,

                                {
                                    kind:
                                        "chat",

                                    name:
                                        ws.name,

                                    text:
                                        text,

                                    pid:
                                        ws.pid,

                                    to:
                                        msg.to
                                }
                            );
                        }


                        return;
                    }


                    // =================================================
                    // CHAT PÚBLICO
                    // =================================================
                    broadcast(
                        room,

                        {
                            kind:
                                "chat",

                            name:
                                ws.name,

                            text:
                                text,

                            pid:
                                ws.pid
                        },

                        ws
                    );


                    return;
                }


                // ====================================================
                // REAÇÕES
                // ====================================================
                if (
                    msg.kind ===
                    "reaction"
                ) {

                    const emoji =
                        String(
                            msg.emoji ||
                            ""
                        )
                        .slice(0, 8);


                    if (!emoji) {
                        return;
                    }


                    broadcast(
                        room,

                        {
                            kind:
                                "reaction",

                            playerId:
                                ws.pid,

                            name:
                                ws.name,

                            emoji:
                                emoji
                        },

                        ws
                    );


                    return;
                }


                // ====================================================
                // POSIÇÃO
                // ====================================================
                if (
                    msg.kind ===
                    "position"
                ) {

                    broadcast(
                        room,

                        {
                            kind:
                                "position",

                            playerId:
                                ws.pid,

                            name:
                                ws.name,

                            x:
                                Number(
                                    msg.x
                                ) || 0,

                            y:
                                Number(
                                    msg.y
                                ) || 0,

                            z:
                                Number(
                                    msg.z
                                ) || 0,

                            ry:
                                Number(
                                    msg.ry
                                ) || 0
                        },

                        ws
                    );


                    return;
                }


                // ====================================================
                // EMOTE
                // ====================================================
                if (
                    msg.kind ===
                    "emote"
                ) {

                    const id =
                        String(
                            msg.id ||
                            ""
                        )
                        .slice(0, 40);


                    if (!id) {
                        return;
                    }


                    broadcast(
                        room,

                        {
                            kind:
                                "emote",

                            playerId:
                                ws.pid,

                            id:
                                id,

                            name:
                                ws.name
                        },

                        ws
                    );


                    return;
                }


                // ====================================================
                // WEBRTC / SINALIZAÇÃO
                // ====================================================
                if (
                    msg.kind ===
                    "rtc"
                ) {

                    const action =
                        msg.action;


                    // ----------------------------------------------
                    // Começou compartilhamento de tela
                    // ----------------------------------------------
                    if (
                        action ===
                        "screenStarted"
                    ) {

                        room.state.screenOwner =
                            ws.pid;


                        broadcast(
                            room,

                            {
                                kind:
                                    "rtc",

                                action:
                                    "screenStarted",

                                from:
                                    ws.pid,

                                name:
                                    ws.name
                            },

                            ws
                        );


                        return;
                    }


                    // ----------------------------------------------
                    // Parou compartilhamento
                    // ----------------------------------------------
                    if (
                        action ===
                        "screenStopped"
                    ) {

                        if (
                            room.state.screenOwner ===
                            ws.pid
                        ) {

                            room.state.screenOwner =
                                null;
                        }


                        broadcast(
                            room,

                            {
                                kind:
                                    "rtc",

                                action:
                                    "screenStopped",

                                from:
                                    ws.pid,

                                name:
                                    ws.name
                            },

                            ws
                        );


                        return;
                    }


                    // ----------------------------------------------
                    // Offer / Answer / ICE
                    // ----------------------------------------------
                    const targetId =
                        String(
                            msg.to ||
                            ""
                        );


                    if (!targetId) {
                        return;
                    }


                    for (
                        const client
                        of room.clients
                    ) {

                        if (
                            client.pid ===
                            targetId
                        ) {

                            send(
                                client,

                                {
                                    ...msg,

                                    from:
                                        ws.pid
                                }
                            );


                            break;
                        }
                    }


                    return;
                }
            }
        );


        // ========================================================
        // PLAYER SAIU
        // ========================================================
        ws.on(
            "close",
            () => {

                const room =
                    ws.room;


                if (!room) {
                    return;
                }


                room.clients.delete(
                    ws
                );


                // Se estava compartilhando tela
                if (
                    room.state.screenOwner ===
                    ws.pid
                ) {

                    room.state.screenOwner =
                        null;


                    broadcast(
                        room,

                        {
                            kind:
                                "rtc",

                            action:
                                "screenStopped",

                            from:
                                ws.pid
                        }
                    );
                }


                // Avisa que saiu
                broadcast(
                    room,

                    {
                        kind:
                            "playerLeft",

                        name:
                            ws.name,

                        playerId:
                            ws.pid
                    }
                );


                // =================================================
                // TROCA AUTOMÁTICA DE HOST
                // =================================================
                if (
                    room.host === ws
                ) {

                    room.host =
                        room.clients
                            .values()
                            .next()
                            .value ||
                        null;


                    if (room.host) {

                        send(
                            room.host,

                            {
                                kind:
                                    "roomState",

                                host:
                                    true,

                                state:
                                    room.state,

                                playerCount:
                                    room.clients.size,

                                players:
                                    getPlayers(
                                        room,
                                        room.host
                                    )
                            }
                        );
                    }
                }


                // =================================================
                // APAGA SALA VAZIA
                // =================================================
                if (
                    room.clients.size ===
                    0
                ) {

                    rooms.delete(
                        room.id
                    );
                }
            }
        );
    }
);


// ============================================================
// INICIAR SERVIDOR
// ============================================================
server.listen(
    PORT,
    () => {

        console.log(
            `OpenVerse online em http://localhost:${PORT}`
        );
    }
);
