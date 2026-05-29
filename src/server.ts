import {Elysia} from "elysia";
import {startListeners} from "./listeners.ts";

const walletSocket = new Map<string, any>();
const pending = new Map<string, {
    donator: string,
    amount: string,
    message: string,
    timestamp: number,
}>()

const app = new Elysia();

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

app.post("/donate/pending", ({body}: { body: any }) => {
    const {from, to, amount, donator, message} = body;
    if (!from || !to || !amount) {
        return {success: false, error: `Incomplete data`};
    }
    pending.set(`${to.toLowerCase()}-${Date.now()}`, {
        donator: donator || "Anonymous",
        message,
        amount,
        timestamp: Date.now(),
    });

    console.log(`pending ${to.toLowerCase()}-${Date.now()}`);
    return { success: true, error: null };
});

app.listen(6767);

await startListeners((to, amount) => {
    if (walletSocket && walletSocket.has(to)) {
        const ws = walletSocket.get(to);
        ws.send({
            event: "donation_received",
            amount,
            currency: "USDC",
            timestamp: new Date().toISOString()
        });
        console.log(`sent notification to ${to} about donation of ${amount} USDC`);
    }
});