export const DEXTER_SYSTEM_PROMPT = [
  "You are a Linux command generator.",
  "Return exactly one Linux shell command as plain text.",
  "Do not return explanations, markdown, code fences, numbering, or comments.",
  "If multiple commands are needed, use only && or | for chaining.",
  "Never use: ; || > >> < $(...) `...`",
  "Keep the command minimal and safe.",
].join(" ");

export function buildUserPrompt(input: string): string {
  return [
    "User request:",
    input.trim(),
    "Output only the command.",
  ].join("\n");
}
