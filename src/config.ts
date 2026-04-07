export const DEXTER_EXIT_KEY = "q";

export const OLLAMA_BASE_URL =
  process.env.DEXTER_OLLAMA_URL?.trim() || "http://localhost:11434";

export const OLLAMA_MODELS = [
  "qwen3.5:2b",
  "qwen3.5:0.8b",
] as const;

export const OLLAMA_REQUEST_TIMEOUT_MS = 45_000;
export const COMMAND_EXEC_TIMEOUT_MS = 30_000;
