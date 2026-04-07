export const DEXTER_EXIT_KEY = "q";

export const OLLAMA_BASE_URL =
  process.env.DEXTER_OLLAMA_URL?.trim() || "http://localhost:11434";

export const DEFAULT_OLLAMA_MODELS = [
  "gemma4:e2b",
  "qwen3.5:0.8b",
] as const;

export const DEFAULT_OLLAMA_KEEP_ALIVE = "10m";
export const OLLAMA_WARMUP_TIMEOUT_MS = 60_000;
export const OLLAMA_REQUEST_TIMEOUT_MS = 45_000;
export const COMMAND_EXEC_TIMEOUT_MS = 30_000;
