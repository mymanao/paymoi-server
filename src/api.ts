import type {Elysia} from "elysia";
import {sqlite} from "./db.ts";
import {PutObjectCommand, S3Client} from "@aws-sdk/client-s3";
import {isAddress, verifyMessage} from "ethers";
import type {Donation, PendingDonation, Streamer} from "./types.ts";
import {addTxListener} from "./listener.ts";

const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    }
});

export function registerAPI(app: Elysia) {
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
        addTxListener(wallet_addr);
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
}