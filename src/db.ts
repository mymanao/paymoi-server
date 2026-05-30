import {startListeners} from "./listeners.ts";

export const sqlite = new Bun.SQL("sqlite://paymoi-data.db");

export async function initDatabase() {
    await sqlite`PRAGMA foreign_keys = ON;`
    await sqlite`
        CREATE TABLE IF NOT EXISTS pending_donations (
            txhash TEXT PRIMARY KEY,
            donator TEXT,
            amount TEXT,
            message TEXT,
            timestamp INTEGER
        )
    `;
    await sqlite`
        CREATE TABLE IF NOT EXISTS streamers (
            wallet_addr TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            display_name TEXT,
            web_config TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `
    await sqlite`
        CREATE TABLE IF NOT EXISTS donations (
            id TEXT PRIMARY KEY,
            tx_hash TEXT UNIQUE NOT NULL,
            streamer_wallet_addr TEXT REFERENCES streamers(wallet_addr) ON DELETE CASCADE,
            donator_wallet_addr TEXT NOT NULL,
            donator_name TEXT NOT NULL,
            amount TEXT NOT NULL,
            message TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `
    await sqlite`
        CREATE INDEX IF NOT EXISTS idx_donations_streamer_wallet_addr ON donations(streamer_wallet_addr);
    `
    await sqlite`
        CREATE INDEX IF NOT EXISTS idx_donations_tx_hash ON donations(tx_hash);
    `
}

export async function findPending(txhash: string) {
    return sqlite`
        SELECT * FROM pending_donations WHERE txhash = ${txhash}
    `.then((res) => res[0] || null);
}

export async function deletePending(txhash: string) {
    return sqlite`
        DELETE FROM pending_donations WHERE txhash = ${txhash}
    `;
}
