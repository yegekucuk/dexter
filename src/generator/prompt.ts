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

export function buildUserPrompt(input: string, extraInstruction?: string): string {
  const lines = [
    "User request:",
    input.trim(),
    "Output only the command.",
  ];

  if (extraInstruction?.trim()) {
    lines.push(extraInstruction.trim());
  }

  return lines.join("\n");
}
