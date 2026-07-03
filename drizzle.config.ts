import "./src/db/loadDotenvLocal";

import { defineConfig } from "drizzle-kit";

// drizzle-kit reads DATABASE_URL from the environment. Loaded from .env.local
// in development; set in Vercel project settings for production.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
