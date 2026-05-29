import {Elysia} from "elysia";
import {startListeners} from "./listeners.ts";

const walletSocket = new Map<string, any>();

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
}).listen(4700);

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