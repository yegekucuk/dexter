import {
  OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODELS,
  OLLAMA_MODEL_CHECK_TIMEOUT_MS,
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

interface OllamaTagItem {
  name?: string;
  model?: string;
}

interface OllamaTagsResponse {
  models?: OllamaTagItem[];
}

export interface ResolvedModelSelection {
  selected: string;
  primaryAvailable: boolean;
  fallbackAvailable: boolean;
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

export async function resolvePreferredModel(
  primaryModel: string,
  fallbackModel: string,
): Promise<ResolvedModelSelection> {
  const timed = withTimeoutSignal(OLLAMA_MODEL_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: "GET",
      signal: timed.signal,
    });

    if (!response.ok) {
      throw new Error(`Unable to check available models: status ${response.status}`);
    }

    const payload = (await response.json()) as OllamaTagsResponse;
    const listed = (payload.models ?? [])
      .flatMap((entry) => [entry.name, entry.model])
      .filter((item): item is string => Boolean(item))
      .map((item) => item.trim().toLowerCase());

    const availableSet = new Set(listed);
    const primaryLower = primaryModel.trim().toLowerCase();
    const fallbackLower = fallbackModel.trim().toLowerCase();

    const primaryAvailable = availableSet.has(primaryLower);
    const fallbackAvailable = availableSet.has(fallbackLower);

    if (primaryAvailable) {
      return {
        selected: primaryModel,
        primaryAvailable,
        fallbackAvailable,
      };
    }

    if (fallbackAvailable) {
      return {
        selected: fallbackModel,
        primaryAvailable,
        fallbackAvailable,
      };
    }

    throw new Error(
      `Neither primary model '${primaryModel}' nor fallback model '${fallbackModel}' is available in Ollama.`
    );
  } finally {
    timed.clear();
  }
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
