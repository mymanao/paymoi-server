import { type ContractEventPayload, formatUnits, type Listener } from "ethers";
import { contracts, decimals } from "./contracts.ts";
import { overlaySocket, walletSocket } from "./socket.ts";
import { confirmPending, findPending } from "./db.ts";
import type { Donation } from "./types.ts";

const listeners = new Map<string, Listener>();

async function cbTransaction(ev: ContractEventPayload) {
  const [from, to, value] = ev.args;
  const txhash = ev.log.transactionHash;
  const amount = formatUnits(value, decimals);
  const pending = (await findPending(txhash)) as Donation;

  if (pending) {
    if (pending.status !== "pending") return;
    const info = pending;
    if (
      from.toLowerCase() !== pending.donator_wallet_addr.toLowerCase() ||
      to.toLowerCase() !== pending.streamer_wallet_addr.toLowerCase()
    ) {
      return;
    }
    for (const map of [walletSocket, overlaySocket]) {
      if (map.has(to.toLowerCase())) {
        map.get(to.toLowerCase()).send({
          event: "donation_received",
          donator: info?.donator_name,
          message: info?.message,
          amount,
          currency: "USDC",
          timestamp: new Date().toISOString(),
        });
      }
    }
    await confirmPending(txhash);
  }
}

export function addTxListener(wallet_addr: string): void {
  if (listeners.has(wallet_addr)) return;
  let listener = cbTransaction;
  contracts.on(
    contracts.filters.Transfer!(null, wallet_addr.toLowerCase()),
    listener,
  );
  listeners.set(wallet_addr.toLowerCase(), listener);
}

export function removeTxListener(wallet_addr: string): void {
  let listener = listeners.get(wallet_addr.toLowerCase());
  if (!listener) return;
  contracts.off(
    contracts.filters.Transfer!(null, wallet_addr.toLowerCase()),
    listener,
  );
  listeners.delete(wallet_addr.toLowerCase());
}
