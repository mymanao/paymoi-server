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