import {type BigNumberish, formatUnits} from "ethers";
import {contracts, decimals} from "./contracts.ts";

export async function startListeners(cb: (from: string, to: string, amount: string) => void) {
    await contracts.on("Transfer", async (from: string, to: string, value: BigNumberish) => {
        const amount = formatUnits(value, decimals);
        return cb(from.toLowerCase(), to.toLowerCase(), amount);
    });
}