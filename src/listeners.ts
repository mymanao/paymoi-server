import {type BigNumberish, ContractEventPayload, formatUnits} from "ethers";
import {contracts, decimals} from "./contracts.ts";

export async function startListeners(walletSocket: Map<string, any>, cb: (from: string, to: string, amount: string, txhash: string) => void) {
    contracts.removeAllListeners();
    contracts.on(contracts.filters.Transfer!(null, null),
        (from: string, to: string, value: BigNumberish, event: ContractEventPayload) => {
            if (!walletSocket.has(to.toLowerCase())) return;
            return cb(from.toLowerCase(), to.toLowerCase(), formatUnits(value, decimals), event.log.transactionHash);
        });

    let reconnecting = false;
    contracts.runner?.provider?.on("error", () => {
        console.error("reconnecting to provider...");
        if (reconnecting) return;
        reconnecting = true;
        contracts.removeAllListeners();
        setTimeout(() => {
            startListeners(walletSocket, cb);
        }, 5000);
    })
}