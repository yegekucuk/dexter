import {
  OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODELS,
  OLLAMA_REQUEST_TIMEOUT_MS,
  OLLAMA_WARMUP_TIMEOUT_MS,
} from "../config.js";
import { buildUserPrompt, DEXTER_SYSTEM_PROMPT } from "./prompt.js";

interface OllamaGenerateResponse {
  response?: string;
}

interface WarmupResult {
  model: string;
  ok: boolean;
  error?: string;
}

function withTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

async function pingModelKeepAlive(model: string, keepAlive: string): Promise<void> {
  const timed = withTimeoutSignal(OLLAMA_WARMUP_TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        keep_alive: keepAlive,
      }),
      signal: timed.signal,
    });

    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }
  } finally {
    timed.clear();
  }
}

export async function warmupModels(
  models: string[],
  keepAlive: string,
): Promise<WarmupResult[]> {
  const results: WarmupResult[] = [];

  for (const model of models) {
    try {
      await pingModelKeepAlive(model, keepAlive);
      results.push({ model, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ model, ok: false, error: message });
    }
  }

  return results;
}

async function generateWithModel(
  model: string,
  userInput: string,
): Promise<string> {
  const timed = withTimeoutSignal(OLLAMA_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: buildUserPrompt(userInput),
        system: DEXTER_SYSTEM_PROMPT,
        stream: false,
      }),
      signal: timed.signal,
    });

    if (!response.ok) {
      throw new Error(`Model ${model} failed with status ${response.status}`);
    }

    const payload = (await response.json()) as OllamaGenerateResponse;
    const output = payload.response?.trim();

    if (!output) {
      throw new Error(`Model ${model} returned empty response`);
    }

    return output;
  } finally {
    timed.clear();
  }
}

export async function generateCommand(
  userInput: string,
  models: string[] = [...DEFAULT_OLLAMA_MODELS],
): Promise<string> {
  const errors: string[] = [];

  for (const model of models) {
    try {
      return await generateWithModel(model, userInput);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
    }
  }

  throw new Error(
    `Unable to generate command from Ollama. Tried models: ${models.join(
      ", ",
    )}. Errors: ${errors.join(" | ")}`,
  );
}
