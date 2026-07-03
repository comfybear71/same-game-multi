import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Next.js loads `.env.local` automatically; standalone scripts (tsx, drizzle-kit)
// do not. Call this once at the top of any CLI entrypoint that needs local env.
const localPath = resolve(process.cwd(), ".env.local");
if (existsSync(localPath)) {
  config({ path: localPath });
} else {
  config();
}
