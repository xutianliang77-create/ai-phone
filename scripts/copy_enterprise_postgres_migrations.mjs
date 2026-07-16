import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = `${root}services/api-server/src/infrastructure/postgres/migrations`;
const destination = `${root}services/api-server/dist/infrastructure/postgres/migrations`;

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
