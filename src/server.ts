import {Elysia} from "elysia";
import {startListeners} from "./listeners.ts";
import {rateLimit} from 'elysia-rate-limit'

const walletSocket = new Map<string, any>();
const pending = new Map<string, {
    donator: string,
    amount: string,
    message: string,
    timestamp: number,
}>()

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
        if (!msg) return;
        if (msg.type === "register" && msg.wallet) {
            walletSocket.set(msg.wallet.toLowerCase(), ws);
        }
        ws.send({status: "success", wallet: msg.wallet});
        console.log(`registered ${msg.wallet}`);
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

app.post("/v1/donate/pending", ({body}: { body: any }) => {
    const {from, to, amount, donator, message, txhash} = body;
    if (!from || !to || !amount || !txhash) {
        return {success: false, error: `Incomplete data`};
    }
    pending.set(txhash, {
        donator: donator || "Anonymous",
        message,
        amount,
        timestamp: Date.now(),
    });

    console.log(`pending ${txhash}`);
    return {success: true, error: null};
});

app.listen(6767, ({port}) => {
    console.log(`listening on port ${port}`);
});

await startListeners(walletSocket, (from, to, amount, txhash) => {
    if (pending.has(txhash)) {
        const info = pending.get(txhash);
        if (walletSocket && walletSocket.has(to)) {
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
        pending.delete(txhash);
    }
});

setInterval(() => {
    const now = Date.now();
    pending.forEach((info, key) => {
        if (now - info.timestamp > 1000 * 60 * 5) {
            pending.delete(key);
            console.log(`removed expired pending donation: ${key}`);
        }
    });
}, 1000 * 60);