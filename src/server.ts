import { Elysia } from "elysia";
import { initDatabase, sqlite } from "./db.ts";
import { isAddress, verifyMessage } from "ethers";
import type { Message } from "./types.ts";
import { cors } from "@elysiajs/cors";
import { registerAPI } from "./api.ts";
import { connectedIp, overlaySocket, walletSocket } from "./socket.ts";
import { addTxListener } from "./listener.ts";
import { rateLimit } from "elysia-rate-limit";

await initDatabase();

const app = new Elysia();

app.use(
  rateLimit({
    scoping: "global",
    duration: 60 * 1000,
    max: 60,
  }),
);

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://paypoint.otternoon.com",
      "https://paymoi.otternoon.com",
    ],
  }),
);

app.ws("/paymoi", {
  open() {
    console.log("connected");
  },
  message(ws, msg: Message) {
    const ip = ws.remoteAddress;
    const now = Date.now();
    const limit = 60;
    let data = connectedIp.get(ip);

    if (!data || now > data.end) {
      data = { req: 1, end: now + 60 * 1000 };
    } else {
      if (data.req >= limit) {
        ws.send(
          JSON.stringify({ status: "error", error: "Too many requests" }),
        );
        return;
      }
      data.req++;
    }
    connectedIp.set(ip, data);

    if (!msg || typeof msg !== "object" || !msg.type) return;
    if (msg.type === "test_alert") {
      const { wallet, event } = msg as any;
      if (!wallet || !isAddress(wallet)) {
        ws.send(
          JSON.stringify({ status: "error", error: "Invalid wallet address" }),
        );
        return;
      }
      const targetSocket = overlaySocket.get(wallet.toLowerCase());
      if (!targetSocket || targetSocket.readyState !== 1) {
        ws.send(
          JSON.stringify({ status: "error", error: "Overlay not connected" }),
        );
        return;
      }
      targetSocket.send(JSON.stringify(event));
      ws.send(
        JSON.stringify({ status: "success", message: "Test alert sent" }),
      );
      return;
    }
    if (msg.type === "overlay" && msg.wallet) {
      const wallet = (msg as any).wallet.toLowerCase();
      if (!isAddress(wallet)) {
        ws.send({ status: "error", error: "Invalid wallet address" });
        return;
      }
      overlaySocket.set(wallet, ws);
      ws.send({ status: "success" });
    }
    if (msg.type === "register") {
      if (!msg.wallet || !msg.signature) return;
      const wallet = msg.wallet.toLowerCase();
      if (!isAddress(wallet)) {
        ws.send({ status: "error", error: "Invalid wallet address" });
        return;
      }

      try {
        let timestamp = parseInt(msg.message.split("_")[1] || "0");
        if (Math.abs(Date.now() - timestamp) > 1000 * 60 * 5) {
          ws.send({ status: "error", error: "Signature expired" });
          return;
        }
        const addr = verifyMessage(msg.message, msg.signature);
        if (addr.toLowerCase() !== wallet) {
          ws.send({ status: "error", error: "Invalid signature" });
          return;
        }
      } catch (e) {
        ws.send({ status: "error", error: "Invalid signature" });
        return;
      }

      const unclosed = walletSocket.get(wallet);
      if (unclosed && unclosed !== ws) {
        console.log(`closing old connection for ${wallet}`);
        try {
          unclosed.close();
        } catch {
          // no-op
        }
      }

      walletSocket.set(wallet, ws);
      ws.send({ status: "success", wallet: msg.wallet });
      console.log(`registered ${msg.wallet}`);
    }
  },
  close(ws) {
    for (const map of [walletSocket, overlaySocket]) {
      map.forEach((socket, wallet) => {
        if (socket === ws) {
          map.delete(wallet);
          console.log(`disconnected: ${wallet}`);
        }
      });
    }
  },
});

registerAPI(app);

app.listen(
  { port: process.env.PORT ?? 6767, hostname: "0.0.0.0" },
  ({ port }) => {
    console.log(`listening on port ${port}`);
  },
);

const streamers = (await sqlite`SELECT wallet_addr
                                FROM streamers`) as Array<{
  wallet_addr: string;
}>;
streamers.forEach((s) => {
  addTxListener(s.wallet_addr);
});

setInterval(async () => {
  const now = Date.now();
  await sqlite`
        DELETE
        FROM pending_donations
        WHERE timestamp < ${now - 1000 * 60 * 5}
    `;
}, 1000 * 60);

setInterval(
  () => {
    const now = Date.now();
    for (const [ip, data] of connectedIp) {
      if (now > data.end) connectedIp.delete(ip);
    }
  },
  1000 * 60 * 3,
);
