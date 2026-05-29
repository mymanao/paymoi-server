import {AlchemyProvider, ethers} from "ethers";
import abi from "./abi.json";

const baseAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const provider = new ethers.AlchemyProvider("base", process.env.API_KEY);
export const contracts = new ethers.Contract(baseAddress, abi, provider);

export let decimals = await contracts.decimals!()
export const symbol = await contracts.symbol!();