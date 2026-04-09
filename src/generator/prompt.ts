export const DEXTER_SYSTEM_PROMPT = [
  "You are a Linux command generator.",
  "Return exactly one Linux shell command as plain text.",
  "Do not return explanations, markdown, code fences, numbering, or comments.",
  "If multiple commands are needed, use only && or | for chaining.",
  "Never use: ; || > >> < $(...) `...`",
  "Keep the command minimal and safe.",
].join(" ");

export const NO_INTERPRETER_RETRY_SYSTEM_PROMPT = [
  "Never use interpreter commands: python, python3, perl, ruby, node.",
  "For file writing requests, generate shell-only commands using tee (or tee -a).",
  "Prefer printf or cat piped to tee when writing file content.",
].join(" ");

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PromptHistoryTurn {
  request: string;
  command: string;
  status: string;
  output?: string;
}

export interface BuildChatOptions {
  extraInstruction?: string;
  extraSystemPrompt?: string;
  history?: PromptHistoryTurn[];
}

export function buildChatMessages(
  input: string,
  options?: BuildChatOptions
): OllamaMessage[] {
  const messages: OllamaMessage[] = [];

  const systemContent = [DEXTER_SYSTEM_PROMPT, options?.extraSystemPrompt]
    .filter(Boolean)
    .join(" ");

  messages.push({ role: "system", content: systemContent });

  const history = options?.history ?? [];

  for (const turn of history) {
    messages.push({ role: "user", content: `User request: ${turn.request}` });

    if (turn.command !== "-") {
      messages.push({ role: "assistant", content: turn.command });
    }

    const outputText = turn.output?.trim() ? `\nOutput:\n${turn.output.trim()}` : "";
    messages.push({
      role: "user",
      content: `Command execution status: ${turn.status}${outputText}`,
    });
  }

  const currentUserContent = [
    `User request:\n${input.trim()}`,
    "Output only the command.",
    options?.extraInstruction?.trim(),
  ].filter(Boolean).join("\n");

  messages.push({ role: "user", content: currentUserContent });

  return messages;
}
