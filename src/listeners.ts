import {ContractEventPayload, formatUnits} from "ethers";
import {contracts, decimals} from "./contracts.ts";

export function startListeners(walletSocket: Map<string, any>, overlaySocket: Map<string, any>, cb: (from: string, to: string, amount: string, txhash: string) => void) {
    contracts.removeAllListeners();
    const address = Array.from(new Set([
        ...walletSocket.keys(),
        ...overlaySocket.keys()
    ]));

    address.forEach(addr => {
        contracts.on(contracts.filters.Transfer!(null, addr),
            (event: ContractEventPayload) => {
                const [from, to, value] = event.args
                return cb(from.toLowerCase(), to!.toLowerCase(), formatUnits(value, decimals), event.log.transactionHash);
            });
    })

    let reconnecting = false;
    contracts.runner?.provider?.on("error", () => {
        console.error("reconnecting to provider...");
        if (reconnecting) return;
        reconnecting = true;
        contracts.removeAllListeners();
        setTimeout(() => {
            reconnecting = false;
            startListeners(walletSocket, overlaySocket, cb);
            ;
        }, 5000);
    })
}