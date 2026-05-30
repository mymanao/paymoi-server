import {initDatabase} from "./src/db.ts";

await initDatabase();
await import("./src/server.ts");