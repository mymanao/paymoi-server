import {Elysia} from "elysia";
import {startListeners} from "./listeners.ts";
import {rateLimit} from 'elysia-rate-limit'
import {initDatabase} from "./db.ts";
import {isAddress} from "ethers";

const walletSocket = new Map<string, any>();
const sqlite = new Bun.SQL("sqlite://paymoi-data.db");
initDatabase()

const app = new Elysia();

app.use(rateLimit({
    max: 5,
    duration: 60000,
    scoping: "scoped"
}));

app.ws("/paymoi", {
    open() {
        console.log("connected");
    },
    message(ws, msg: any) {
        if (!msg || typeof msg !== "object" || !msg.wallet || !msg.type) return;
        if (msg.type === "register") {
            const wallet = msg.wallet.toLowerCase();
            if (!isAddress(wallet)) {
                ws.send({status: "error", error: "Invalid wallet address"});
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
        walletSocket.forEach((socket, wallet) => {
            if (socket === ws) {
                walletSocket.delete(wallet);
                console.log(`disconnected: ${wallet}`);
            }
        });
    }
});

app.get("/", () => {
    return "Online"
});

app.post("/v1/donate/pending", async ({body}: { body: any }) => {
    const {from, to, amount, donator, message, txhash} = body;
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

app.listen({ port: process.env.PORT ?? 6767, hostname: "127.0.0.1" }, ({port}) => {
    console.log(`listening on port ${port}`);
});

async function findPending(txhash: string) {
    return sqlite`
        SELECT * FROM pending_donations WHERE txhash = ${txhash}
    `.then((res) => res[0] || null);
}

async function deletePending(txhash: string) {
    return sqlite`
        DELETE FROM pending_donations WHERE txhash = ${txhash}
    `;
}

startListeners(walletSocket, async (_from, to, amount, txhash) => {
    const pending = await findPending(txhash);
    if (pending) {
        const info = pending;
        if (walletSocket.has(to)) {
            const ws = walletSocket.get(to);
            ws.send({
                event: "donation_received",
                donator: info?.donator,
                message: info?.message,
                amount,
                currency: "USDC",
                timestamp: new Date().toISOString()
            });
            console.log(`sent notification to ${to} about donation of ${amount} USDC`);
        }
        await deletePending(txhash);
    }
});

setInterval(async () => {
    const now = Date.now();
    await sqlite`
        DELETE FROM pending_donations WHERE timestamp < ${now - 1000 * 60 * 5}
    `
}, 1000 * 60);