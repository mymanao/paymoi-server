export interface Donations {
    from: string;
    to: string;
    amount: string;
    donator: string;
    message: string;
    txhash: string;
}

export interface Message {
    wallet: string,
    type: string,
}

export interface Streamers {
    wallet_addr: string;
    username: string;
    display_name: string;
    web_config: string;
    created_at: Date;
}
