import { type ContractEventPayload, formatUnits, type Listener } from "ethers";
import { contracts, decimals } from "./contracts.ts";
import { deletePending, findPending } from "./db.ts";
import { overlaySocket, walletSocket } from "./socket.ts";

const listeners = new Map<string, Listener>();

async function cbTransaction(ev: ContractEventPayload) {
  const [_from, to, value] = ev.args;
  const txhash = ev.log.transactionHash;
  const amount = formatUnits(value, decimals);
  const pending = await findPending(txhash.toLowerCase());
  if (pending) {
    const info = pending;
    for (const map of [walletSocket, overlaySocket]) {
      if (map.has(to.toLowerCase())) {
        map.get(to.toLowerCase()).send({
          event: "donation_received",
          donator: info?.donator,
          message: info?.message,
          amount,
          currency: "USDC",
          timestamp: new Date().toISOString(),
        });
      }
    }
    await deletePending(txhash.toLowerCase());
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
