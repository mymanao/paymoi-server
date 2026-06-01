import {Elysia} from "elysia";
import {startListeners} from "./listeners.ts";
import {rateLimit} from "elysia-rate-limit"
import {deletePending, findPending, initDatabase, sqlite} from "./db.ts";
import {isAddress, verifyMessage} from "ethers";
import type {PendingDonation, Message, Streamer, Donation} from "./types.ts";
import {cors} from "@elysiajs/cors"
import {S3Client, PutObjectCommand} from "@aws-sdk/client-s3"

const walletSocket = new Map<string, any>();
const overlaySocket = new Map<string, any>()
await initDatabase()

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    }
});

const app = new Elysia();

app.use(rateLimit({
    max: 5,
    duration: 60000,
    scoping: "scoped"
}));

app.use(cors({
    origin: ["http://localhost:5173", "https://paypoint.otternoon.com", "https://paymoi.otternoon.com"],
}))

app.ws("/paymoi", {
    open() {
        console.log("connected");
    },
    message(ws, msg: Message) {
        if (!msg || typeof msg !== "object" || !msg.type) return;
        if (msg.type === "test_alert") {
            const {wallet, event} = msg as any;
            if (!wallet || !isAddress(wallet)) {
                ws.send(JSON.stringify({status: "error", error: "Invalid wallet address"}));
                return;
            }
            const targetSocket = overlaySocket.get(wallet.toLowerCase());
            if (!targetSocket || targetSocket.readyState !== 1) {
                ws.send(JSON.stringify({status: "error", error: "Overlay not connected"}));
                return;
            }
            targetSocket.send(JSON.stringify(event));
            ws.send(JSON.stringify({status: "success", message: "Test alert sent"}));
            return;
        }
        ;
        if (msg.type === "overlay" && msg.wallet) {
            const wallet = (msg as any).wallet.toLowerCase()
            if (!isAddress(wallet)) {
                ws.send({status: "error", error: "Invalid wallet address"})
                return
            }
            overlaySocket.set(wallet, ws)
            ws.send({status: "success"})
        }
        if (msg.type === "register") {
            if (!msg.wallet || !msg.signature) return;
            const wallet = msg.wallet.toLowerCase();
            if (!isAddress(wallet)) {
                ws.send({status: "error", error: "Invalid wallet address"});
                return;
            }

            try {
                let timestamp = parseInt(msg.message.split("_")[1] || "0");
                if (Math.abs(Date.now() - timestamp) > 1000 * 60 * 5) {
                    ws.send({status: "error", error: "Signature expired"});
                    return;
                }
                const addr = verifyMessage(msg.message, msg.signature);
                if (addr.toLowerCase() !== wallet) {
                    ws.send({status: "error", error: "Invalid signature"});
                    return;
                }
            } catch (e) {
                ws.send({status: "error", error: "Invalid signature"});
                return;
            }

            const unclosed = walletSocket.get(wallet);
            if (unclosed && unclosed !== ws) {
                console.log(`closing old connection for ${wallet}`);
                try {
                    unclosed.close()
                } catch {
                    // no-op
                }
            }

            walletSocket.set(wallet, ws);
            ws.send({status: "success", wallet: msg.wallet});
            console.log(`registered ${msg.wallet}`);
        }
    },
    close(ws) {
        for (const map of [walletSocket, overlaySocket]) {
            map.forEach((socket, wallet) => {
                if (socket === ws) {
                    map.delete(wallet)
                    console.log(`disconnected: ${wallet}`)
                }
            })
        }
    }
});

app.get("/", () => {
    return "Online"
});

app.post("/v1/donate/pending", async ({body}: { body: any }) => {
    const {from, to, amount, donator, message, txhash} = body as PendingDonation;
    if (!from || !to || !amount || !txhash) {
        return {success: false, error: `Incomplete data`};
    }
    await sqlite`
        INSERT INTO pending_donations (txhash, donator, amount, message, timestamp)
        VALUES (${txhash}, ${donator || "Anonymous"}, ${amount}, ${message}, ${Date.now()}) ON CONFLICT(txhash) DO
        UPDATE SET
            donator=excluded.donator,
            amount=excluded.amount,
            message=excluded.message,
            timestamp =excluded.timestamp
    `

    console.log(`pending ${txhash}`);
    return {success: true, error: null};
});

app.post("/v1/streamers", async ({body}: { body: any }) => {
    const {
        wallet_addr,
        username,
        display_name,
        web_config,
        message,
        signature
    } = body as Omit<Streamer, "created_at"> & {
        message: string,
        signature: string
    };
    if (!wallet_addr || !username) {
        return {success: false, error: `Incomplete data`};
    }
    if (!isAddress(wallet_addr)) {
        return {success: false, error: `Invalid wallet address`};
    }
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
        return {success: false, error: `Invalid username`};
    }
    if (display_name && display_name.length > 128) {
        return {success: false, error: `Display name too long`};
    }
    if (!message || !signature) {
        return {success: false, error: `Invalid request, missing message or signature`};
    }
    try {
        let timestamp = parseInt(message.split("_")[1] || "0");
        if (Math.abs(Date.now() - timestamp) > 1000 * 60 * 5) {
            return {success: false, error: `Signature expired`};
        }
        const addr = verifyMessage(message, signature);
        if (addr.toLowerCase() !== wallet_addr.toLowerCase()) {
            return {success: false, error: `Invalid signature`};
        }
    } catch (e) {
        return {success: false, error: `Invalid signature`};
    }
    const existing = await sqlite`
        SELECT wallet_addr
        FROM streamers
        WHERE username = ${username}
    `.then(res => res[0] || null)

    if (existing && existing.wallet_addr !== wallet_addr.toLowerCase()) {
        return {success: false, error: 'Username already taken'}
    }
    await sqlite`
        INSERT INTO streamers (wallet_addr, username, display_name, web_config)
        VALUES (${wallet_addr.toLowerCase()}, ${username}, ${display_name ?? username},
                ${web_config ?? "{}"}) ON CONFLICT(wallet_addr) DO
        UPDATE SET
            username=excluded.username,
            display_name=excluded.display_name,
            web_config=excluded.web_config
    `
    return {success: true, error: null};
});

app.get("/v1/streamers/wallet/:addr", async ({params}) => {
    const {addr} = params;
    if (!addr) {
        return {success: false, error: `Incomplete data`};
    }
    if (!isAddress(addr)) {
        return {success: false, error: `Invalid wallet address`};
    }
    const streamer = await sqlite`
        SELECT wallet_addr, username, display_name, web_config, created_at
        FROM streamers
        WHERE wallet_addr = ${addr.toLowerCase()}
    `.then((res) => res[0] || null);
    if (!streamer) {
        return {success: false, error: `Streamer not found`};
    }
    return {success: true, error: null, streamer};
});

app.get("/v1/streamers/:name", async ({params}) => {
    const {name} = params;
    if (!name) {
        return {success: false, error: `Incomplete data`};
    }
    const streamer = await sqlite`
        SELECT wallet_addr, username, display_name, web_config, created_at
        FROM streamers
        WHERE username = ${name}
    `.then((res) => res[0] || null);
    if (!streamer) {
        return {success: false, error: `Streamer not found`};
    }
    return {success: true, error: null, streamer};
});

app.post("/v1/donations", async ({body, set}) => {
    const {tx_hash, streamer_wallet_addr, donator_wallet_addr, donator_name, amount, message} = body as Donation

    if (!tx_hash || !streamer_wallet_addr || !donator_wallet_addr || !amount) {
        set.status = 400
        return {success: false, error: "Incomplete data"}
    }
    if (!isAddress(streamer_wallet_addr) || !isAddress(donator_wallet_addr)) {
        set.status = 400
        return {success: false, error: "Invalid wallet address"}
    }

    await sqlite`
        INSERT INTO donations (id, tx_hash, streamer_wallet_addr, donator_wallet_addr, donator_name, amount, message)
        VALUES (${crypto.randomUUID()}, ${tx_hash}, ${streamer_wallet_addr.toLowerCase()},
                ${donator_wallet_addr.toLowerCase()}, ${donator_name ?? "Anonymous"}, ${amount},
                ${message ?? ""}) ON CONFLICT(tx_hash) DO NOTHING
    `
    return {success: true, error: null}
})

app.get("/v1/donations/:username", async ({params, set}) => {
    const {username} = params

    const streamer = await sqlite`
        SELECT wallet_addr
        FROM streamers
        WHERE username = ${username}
    `.then(res => res[0] || null)

    if (!streamer) {
        set.status = 404
        return {success: false, error: "Streamer not found"}
    }

    const donations = await sqlite`
        SELECT donator_name, amount, message, created_at
        FROM donations
        WHERE streamer_wallet_addr = ${streamer.wallet_addr}
        ORDER BY created_at DESC LIMIT 50
    `
    return {success: true, error: null, donations}
})

app.post("/v1/streamers/upload/:type", async ({params, body, set}) => {
    const {type} = params
    if (type !== "avatar" && type !== "banner") {
        set.status = 400
        return {success: false, error: "Invalid type"}
    }

    const {file, wallet_addr, message, signature} = body as {
        file: File,
        wallet_addr: string,
        message: string,
        signature: string
    }

    if (!file || !wallet_addr || !message || !signature) {
        return {success: false, error: "Incomplete data"}
    }
    if (!isAddress(wallet_addr)) {
        return {success: false, error: "Invalid wallet address"}
    }

    try {
        const timestamp = parseInt(message.split("_")[1] || "0")
        if (Math.abs(Date.now() - timestamp) > 1000 * 60 * 5) {
            return {success: false, error: "Signature expired"}
        }
        const addr = verifyMessage(message, signature)
        if (addr.toLowerCase() !== wallet_addr.toLowerCase()) {
            return {success: false, error: "Invalid signature"}
        }
    } catch {
        return {success: false, error: "Invalid signature"}
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        return {success: false, error: "Invalid file type"}
    }
    if (file.size > 12 * 1024 * 1024) {
        return {success: false, error: "File too large"}
    }

    const ext = file.type.split("/")[1]
    const key = `${type}/${wallet_addr.toLowerCase()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    await r2.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET!,
        Key: key,
        Body: buffer,
        ContentType: file.type,
    }))

    const url = `https://pawmi.otternoon.com/${key}`
    return {success: true, url}
})

app.listen({port: process.env.PORT ?? 6767, hostname: "0.0.0.0"}, ({port}) => {
    console.log(`listening on port ${port}`);
});

startListeners(walletSocket, async (_from, to, amount, txhash) => {
    const pending = await findPending(txhash);
    if (pending) {
        const info = pending;
        for (const map of [walletSocket, overlaySocket]) {
            if (map.has(to)) {
                map.get(to).send({
                    event: "donation_received",
                    donator: info?.donator,
                    message: info?.message,
                    amount,
                    currency: "USDC",
                    timestamp: new Date().toISOString()
                })
            }
        }
        await deletePending(txhash);
    }
});

setInterval(async () => {
    const now = Date.now();
    await sqlite`
        DELETE
        FROM pending_donations
        WHERE timestamp < ${now - 1000 * 60 * 5}
    `
}, 1000 * 60);