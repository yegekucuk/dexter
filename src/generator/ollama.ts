import {
  OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODELS,
  OLLAMA_MODEL_CHECK_TIMEOUT_MS,
  OLLAMA_REQUEST_TIMEOUT_MS,
  OLLAMA_WARMUP_TIMEOUT_MS,
} from "../config.js";
import {
  buildChatMessages,
  type OllamaMessage,
  DEXTER_SYSTEM_PROMPT,
  NO_INTERPRETER_RETRY_SYSTEM_PROMPT,
  type PromptHistoryTurn,
} from "./prompt.js";

interface OllamaGenerateResponse {
  message?: OllamaMessage;
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
  options?: {
    extraInstruction?: string;
    extraSystemPrompt?: string;
    history?: PromptHistoryTurn[];
  },
): Promise<string> {
  const timed = withTimeoutSignal(OLLAMA_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: buildChatMessages(userInput, {
          extraInstruction: options?.extraInstruction,
          extraSystemPrompt: options?.extraSystemPrompt,
          history: options?.history,
        }),
        stream: false,
      }),
      signal: timed.signal,
    });

    if (!response.ok) {
      throw new Error(`Model ${model} failed with status ${response.status}`);
    }

    const payload = (await response.json()) as OllamaGenerateResponse;
    const output = payload.message?.content?.trim();

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
  options?: {
    extraInstruction?: string;
    extraSystemPrompt?: string;
    history?: PromptHistoryTurn[];
  },
): Promise<string> {
  const errors: string[] = [];

  for (const model of models) {
    try {
      return await generateWithModel(
        model,
        userInput,
        {
          extraInstruction: options?.extraInstruction,
          extraSystemPrompt: options?.extraSystemPrompt,
          history: options?.history,
        },
      );
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

export async function generateWithoutInterpreters(
  userInput: string,
  models: string[] = [...DEFAULT_OLLAMA_MODELS],
  history?: PromptHistoryTurn[],
): Promise<string> {
  return await generateCommand(userInput, models, {
    extraInstruction:
      "Important: do not use python/python3/perl/ruby/node. Use shell tools and tee for file writes.",
    extraSystemPrompt: NO_INTERPRETER_RETRY_SYSTEM_PROMPT,
    history,
  });
}
