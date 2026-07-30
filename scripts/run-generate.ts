import { config } from "dotenv";
config({ path: ".env.local" });

import { generatePredictions } from "../src/lib/predictions/generate";

const gameId = Number(process.argv[2] ?? 169);

async function main() {
  const result = await generatePredictions(gameId);
  console.log(result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
