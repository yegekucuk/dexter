import {
  OLLAMA_BASE_URL,
  OLLAMA_MODELS,
  OLLAMA_REQUEST_TIMEOUT_MS,
} from "../config.js";
import { buildUserPrompt, DEXTER_SYSTEM_PROMPT } from "./prompt.js";

interface OllamaGenerateResponse {
  response?: string;
}

async function generateWithModel(
  model: string,
  userInput: string,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_REQUEST_TIMEOUT_MS);

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
      signal: controller.signal,
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
    clearTimeout(timeout);
  }
}

export async function generateCommand(userInput: string): Promise<string> {
  const errors: string[] = [];

  for (const model of OLLAMA_MODELS) {
    try {
      return await generateWithModel(model, userInput);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
    }
  }

  throw new Error(
    `Unable to generate command from Ollama. Tried models: ${OLLAMA_MODELS.join(
      ", ",
    )}. Errors: ${errors.join(" | ")}`,
  );
}
