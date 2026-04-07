function stripCodeFences(input: string): string {
  return input
    .replace(/^```[a-zA-Z0-9_-]*\s*/, "")
    .replace(/\s*```$/, "");
}

function stripInlineNoise(input: string): string {
  return input
    .replace(/^Command\s*:\s*/i, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
}

export function normalizeCommand(raw: string): string {
  const withoutFences = stripCodeFences(raw.trim());
  const compact = withoutFences.replace(/[\r\n]+/g, " ").trim();
  return stripInlineNoise(compact);
}
