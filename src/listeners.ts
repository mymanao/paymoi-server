import {type BigNumberish, formatUnits} from "ethers";
import {contracts, decimals} from "./contracts.ts";

export async function startListeners(cb: (to: string, amount: string) => void) {
    await contracts.on("Transfer", async (_from: string, to: string, value: BigNumberish) => {
        const amount = formatUnits(value, decimals);
        return cb(to.toLowerCase(), amount);
    });
}