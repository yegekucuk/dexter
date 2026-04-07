import { copyFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface RedirectionRewrite {
  operator: ">" | ">>";
  sourceTarget: string;
  finalTarget: string;
  clonedToTmp: boolean;
  backupTarget?: string;
}

export interface RedirectionRewriteResult {
  command: string;
  rewrites: RedirectionRewrite[];
}

function isLikelyLiteralPath(value: string): boolean {
  return !/[`*?]/.test(value);
}

function parseQuotedToken(input: string, start: number): { token: string; end: number } {
  const quote = input[start] ?? "";
  let index = start + 1;

  while (index < input.length) {
    const char = input[index] ?? "";
    if (char === "\\") {
      index += 2;
      continue;
    }

    if (char === quote) {
      return {
        token: input.slice(start, index + 1),
        end: index + 1,
      };
    }

    index += 1;
  }

  return {
    token: input.slice(start),
    end: input.length,
  };
}

function parseTargetToken(input: string, start: number): { token: string; end: number } {
  const first = input[start] ?? "";

  if (first === "'" || first === '"') {
    return parseQuotedToken(input, start);
  }

  let index = start;
  let escaped = false;
  while (index < input.length) {
    const char = input[index] ?? "";

    if (escaped) {
      escaped = false;
      index += 1;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      index += 1;
      continue;
    }

    if (/\s/.test(char) || char === "|" || char === "&" || char === ";" || char === ">") {
      break;
    }
    index += 1;
  }

  return {
    token: input.slice(start, index),
    end: index,
  };
}

function decodeTargetToken(token: string): { rawPath: string; quote: "" | "'" | '"' } {
  const trimmed = token.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "'" || first === '"') && first === last) {
      return {
        rawPath: trimmed.slice(1, -1),
        quote: first as "'" | '"',
      };
    }
  }

  let decoded = "";
  let escaped = false;

  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i] ?? "";
    if (escaped) {
      decoded += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    decoded += char;
  }

  return {
    rawPath: decoded,
    quote: "",
  };
}

function encodeTargetToken(rawPath: string, quote: "" | "'" | '"'): string {
  if (quote === "'") {
    return `'${rawPath.replace(/'/g, "'\"'\"'")}'`;
  }

  if (quote === '"') {
    return `"${rawPath.replace(/["\\$`]/g, "\\$&")}"`;
  }

  if (/\s/.test(rawPath)) {
    return `'${rawPath.replace(/'/g, "'\"'\"'")}'`;
  }

  return rawPath;
}

function resolvePathForStat(rawPath: string, cwd: string): string | null {
  if (rawPath.includes("$(") || rawPath.includes("`")) {
    return null;
  }

  const home = homedir();
  const normalized = rawPath.trim();

  if (normalized === "~") {
    return home;
  }

  if (normalized.startsWith("~/")) {
    return path.join(home, normalized.slice(2));
  }

  if (normalized.startsWith("$HOME/")) {
    return path.join(home, normalized.slice("$HOME/".length));
  }

  if (normalized.startsWith("${HOME}/")) {
    return path.join(home, normalized.slice("${HOME}/".length));
  }

  if (normalized.includes("$")) {
    return null;
  }

  return path.isAbsolute(normalized) ? normalized : path.resolve(cwd, normalized);
}

function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  const push = (): void => {
    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  };

  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i] ?? "";

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && !inSingle) {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && /\s/.test(char)) {
      push();
      continue;
    }

    current += char;
  }

  push();
  return tokens;
}

function resolveCdTargetPath(rawTarget: string | undefined, cwd: string): string | null {
  const home = homedir();

  if (!rawTarget || rawTarget === "~") {
    return home;
  }

  if (rawTarget === "-") {
    return null;
  }

  if (rawTarget.startsWith("~/")) {
    return path.join(home, rawTarget.slice(2));
  }

  if (rawTarget.startsWith("$HOME/")) {
    return path.join(home, rawTarget.slice("$HOME/".length));
  }

  if (rawTarget.startsWith("${HOME}/")) {
    return path.join(home, rawTarget.slice("${HOME}/".length));
  }

  if (rawTarget.includes("$") || rawTarget.includes("$(") || rawTarget.includes("`")) {
    return null;
  }

  return path.isAbsolute(rawTarget) ? rawTarget : path.resolve(cwd, rawTarget);
}

async function updateCwdFromCdSegment(segment: string, cwd: string): Promise<string> {
  const trimmed = segment.trim();
  if (!trimmed) {
    return cwd;
  }

  const tokens = tokenizeSegment(trimmed);
  if (tokens[0] !== "cd") {
    return cwd;
  }

  const targetPath = resolveCdTargetPath(tokens[1], cwd);
  if (!targetPath) {
    return cwd;
  }

  try {
    const info = await stat(targetPath);
    return info.isDirectory() ? targetPath : cwd;
  } catch {
    return cwd;
  }
}

async function resolveWriteTarget(
  token: string,
  cwd: string,
): Promise<{
  finalToken: string;
  clonedToTmp: boolean;
  finalRawPath: string;
  backupToken?: string;
}> {
  const decoded = decodeTargetToken(token);
  const normalizedPath = decoded.rawPath.trim();

  if (!normalizedPath || !isLikelyLiteralPath(normalizedPath)) {
    return {
      finalToken: token,
      clonedToTmp: false,
      finalRawPath: normalizedPath,
    };
  }

  const absolute = resolvePathForStat(normalizedPath, cwd);

  if (!absolute) {
    return {
      finalToken: token,
      clonedToTmp: false,
      finalRawPath: normalizedPath,
    };
  }

  try {
    const info = await stat(absolute);
    if (!info.isFile() || info.size <= 0) {
      return {
        finalToken: token,
        clonedToTmp: false,
        finalRawPath: normalizedPath,
      };
    }

    const tmpRawPath = `${normalizedPath}.tmp`;
    const tmpAbsolute = `${absolute}.tmp`;

    await copyFile(absolute, tmpAbsolute);

    return {
      finalToken: token,
      clonedToTmp: true,
      finalRawPath: normalizedPath,
      backupToken: encodeTargetToken(tmpRawPath, decoded.quote),
    };
  } catch {
    return {
      finalToken: token,
      clonedToTmp: false,
      finalRawPath: normalizedPath,
    };
  }
}

export async function rewriteRedirectionToTee(
  command: string,
  cwd: string = process.cwd(),
): Promise<RedirectionRewriteResult> {
  const rewrites: RedirectionRewrite[] = [];
  let rebuilt = "";
  let segmentOriginal = "";
  let effectiveCwd = cwd;

  let index = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  while (index < command.length) {
    const char = command[index] ?? "";
    const next = command[index + 1] ?? "";

    if (escaped) {
      rebuilt += char;
      escaped = false;
      index += 1;
      continue;
    }

    if (char === "\\" && !inSingle) {
      escaped = true;
      rebuilt += char;
      index += 1;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      rebuilt += char;
      index += 1;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      rebuilt += char;
      index += 1;
      continue;
    }

    if (!inSingle && !inDouble && char === ">") {
      const operator: ">" | ">>" = next === ">" ? ">>" : ">";
      const operatorLength = operator.length;

      let targetStart = index + operatorLength;
      while (targetStart < command.length && /\s/.test(command[targetStart] ?? "")) {
        targetStart += 1;
      }

      if (targetStart >= command.length) {
        rebuilt += char;
        index += 1;
        continue;
      }

      const parsedTarget = parseTargetToken(command, targetStart);
      if (!parsedTarget.token.trim()) {
        rebuilt += char;
        index += 1;
        continue;
      }

      segmentOriginal += command.slice(index, parsedTarget.end);
      const resolved = await resolveWriteTarget(parsedTarget.token, effectiveCwd);

      rebuilt = rebuilt.trimEnd();
      const teeCommand = operator === ">>"
        ? ` | tee -a ${resolved.finalToken}`
        : ` | tee ${resolved.finalToken}`;
      rebuilt += teeCommand;

      rewrites.push({
        operator,
        sourceTarget: parsedTarget.token,
        finalTarget: resolved.finalToken,
        clonedToTmp: resolved.clonedToTmp,
        backupTarget: resolved.backupToken,
      });

      index = parsedTarget.end;
      continue;
    }

    if (!inSingle && !inDouble && char === "&" && next === "&") {
      effectiveCwd = await updateCwdFromCdSegment(segmentOriginal, effectiveCwd);
      segmentOriginal = "";
      rebuilt += "&&";
      index += 2;
      continue;
    }

    if (!inSingle && !inDouble && char === "|") {
      segmentOriginal = "";
      if (next === "|") {
        rebuilt += "||";
        index += 2;
      } else {
        rebuilt += "|";
        index += 1;
      }
      continue;
    }

    rebuilt += char;
    segmentOriginal += char;
    index += 1;
  }

  return {
    command: rebuilt.trim(),
    rewrites,
  };
}
