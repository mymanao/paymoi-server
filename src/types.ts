export interface Donation {
  id: string;
  tx_hash: string;
  streamer_wallet_addr: string;
  donator_wallet_addr: string;
  donator_name: string;
  amount: string;
  message: string;
  signMessage: string;
  signature: string;
  status: "pending" | "confirmed" | "failed";
  created_at: Date;
}

export interface Message {
  wallet: string;
  type: string;
  message: string;
  signature: string;
}

export interface Streamer {
  wallet_addr: string;
  username: string;
  display_name: string;
  web_config: string;
  created_at: Date;
}
