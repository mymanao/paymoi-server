import {type BigNumberish, formatUnits} from "ethers";
import {contracts, decimals} from "./contracts.ts";

export async function startListeners(walletSocket: Map<string, any>, cb: (from: string, to: string, amount: string) => void) {
    contracts.on(contracts.filters.Transfer!(null, null),
        (from: string, to: string, value: BigNumberish) => {
            if (!walletSocket.has(to.toLowerCase())) return;
            return cb(from.toLowerCase(), to.toLowerCase(), formatUnits(value, decimals));
        });
}