import { loadEnv } from "./config/env.js";
import { buildApp } from "./app.js";

const env = loadEnv();
const app = await buildApp();

await app.listen({ port: env.apiPort, host: "0.0.0.0" });
