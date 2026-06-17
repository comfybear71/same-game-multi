// Pure constants, no DB imports — safe to import from client components
// (lib/predictions/suggest.ts pulls in the DB client and is server-only).
export const MIN_LEGS = 1;
export const MAX_LEGS = 25;
export const DEFAULT_LEGS = 3;
