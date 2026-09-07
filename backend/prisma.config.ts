import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Host-side runs (npm run db:*, prisma studio outside Docker) need the root
// .env loaded manually; inside containers compose's env_file already put
// these vars in process.env, so this is a no-op there.
loadEnv({ path: join(__dirname, "..", ".env") });

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    // DATABASE_URL here is always the host-reachable (localhost) form :
    // compose overrides it to the container form (host "db") for the
    // backend/studio containers via an explicit environment: entry.
    url: process.env.DATABASE_URL ?? "",
  },
  // Prisma 7 reads seed/migration settings from this file only : a `prisma`
  // block in package.json is ignored, which is why `prisma db seed` needs the
  // command declared here rather than alongside the npm scripts.
  migrations: {
    path: "./prisma/migrations",
    seed: "ts-node --transpile-only --project tsconfig.json prisma/seed.ts",
  },
});