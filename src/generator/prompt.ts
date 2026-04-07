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

export interface PromptHistoryTurn {
  request: string;
  command: string;
  status: string;
}

interface BuildUserPromptOptions {
  extraInstruction?: string;
  history?: PromptHistoryTurn[];
}

function compactLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function buildUserPrompt(input: string, options?: BuildUserPromptOptions): string {
  const lines = [
    "User request:",
    input.trim(),
    "Output only the command.",
  ];

  const history = options?.history ?? [];

  if (history.length > 0) {
    lines.push("Recent session context (oldest to newest):");

    history.forEach((turn, index) => {
      const request = compactLine(turn.request);
      const command = compactLine(turn.command);
      const status = compactLine(turn.status);
      lines.push(`${index + 1}. request: ${request}`);
      lines.push(`   command: ${command}`);
      lines.push(`   status: ${status}`);
    });
  }

  if (options?.extraInstruction?.trim()) {
    lines.push(options.extraInstruction.trim());
  }

  return lines.join("\n");
}
