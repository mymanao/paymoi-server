import { ethers } from "ethers";
import abi from "./abi.json";

const baseAddress =
  process.env.NODE_ENV === "production"
    ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    : "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const network = process.env.NODE_ENV === "production" ? "base" : "base-sepolia";
const wsUrl =
  process.env.NODE_ENV === "production"
    ? `wss://base-mainnet.infura.io/ws/v3/${process.env.API_KEY}`
    : `wss://base-sepolia.infura.io/ws/v3/${process.env.API_KEY}`;
export const provider = new ethers.WebSocketProvider(wsUrl, network);
export const contracts = new ethers.Contract(baseAddress, abi, provider);

export let decimals = 6;
