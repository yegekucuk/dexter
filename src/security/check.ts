import {
  BANNED_BASE_COMMANDS,
  BANNED_PREFIXES,
  DANGEROUS_RM_TARGET_PATTERNS,
} from "./policy.js";

export interface SecurityCheckResult {
  safe: boolean;
  reasons: string[];
}

interface SplitCommandResult {
  segments: string[];
  reasons: string[];
}

interface ParsedSegment {
  commandName: string;
  commandIndex: number;
  tokens: string[];
}

function uniqueReasons(reasons: string[]): string[] {
  return [...new Set(reasons)];
}

function pushSegmentOrReason(current: string, segments: string[], reasons: string[]): void {
  const segment = current.trim();

  if (!segment) {
    reasons.push("Command has an empty segment around a chain operator.");
    return;
  }

  segments.push(segment);
}

function splitByAllowedOperators(command: string): SplitCommandResult {
  const segments: string[] = [];
  const reasons: string[] = [];
  let current = "";

  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i] ?? "";
    const next = command[i + 1] ?? "";

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && !inSingle) {
      escaped = true;
      current += char;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      current += char;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      current += char;
      continue;
    }

    if (!inSingle) {
      if (char === "`") {
        reasons.push("Backtick subshell syntax is not allowed.");
      }

      if (char === "$" && next === "(") {
        reasons.push("Subshell syntax '$(...)' is not allowed.");
      }
    }

    if (!inSingle && !inDouble) {
      if (char === "&" && next === "&") {
        pushSegmentOrReason(current, segments, reasons);
        current = "";
        i += 1;
        continue;
      }

      if (char === "|") {
        if (next === "|") {
          reasons.push("Operator '||' is not allowed.");
          i += 1;
          continue;
        }

        pushSegmentOrReason(current, segments, reasons);
        current = "";
        continue;
      }

      if (char === "&") {
        reasons.push("Background operator '&' is not allowed.");
      }

      if (char === ";") {
        reasons.push("Operator ';' is not allowed.");
      }

      if (char === "<" || char === ">") {
        reasons.push("Redirection operators are not allowed.");
      }
    }

    current += char;
  }

  if (inSingle || inDouble) {
    reasons.push("Command has unbalanced quotes.");
  }

  if (current.trim()) {
    segments.push(current.trim());
  } else if (segments.length > 0) {
    reasons.push("Command ends with an invalid chain operator.");
  }

  return {
    segments,
    reasons: uniqueReasons(reasons),
  };
}

function tokenizeSegment(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";

  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  const pushToken = (): void => {
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
      pushToken();
      continue;
    }

    current += char;
  }

  pushToken();
  return tokens;
}

function normalizeCommandName(rawCommand: string): string {
  const lowered = rawCommand.toLowerCase();
  const parts = lowered.split("/").filter(Boolean);
  return parts.length > 0 ? (parts[parts.length - 1] ?? lowered) : lowered;
}

function parseSegment(segment: string): ParsedSegment | null {
  const tokens = tokenizeSegment(segment);

  if (tokens.length === 0) {
    return null;
  }

  let commandIndex = 0;
  const assignmentPattern = /^[A-Za-z_][A-Za-z0-9_]*=.*/;

  while (
    commandIndex < tokens.length &&
    assignmentPattern.test(tokens[commandIndex] ?? "")
  ) {
    commandIndex += 1;
  }

  if (commandIndex >= tokens.length) {
    return null;
  }

  const commandName = normalizeCommandName(tokens[commandIndex] ?? "");

  return {
    commandName,
    commandIndex,
    tokens,
  };
}

function isDangerousRm(segment: ParsedSegment): boolean {
  if (segment.commandName !== "rm") {
    return false;
  }

  const args = segment.tokens.slice(segment.commandIndex + 1);
  let sawRecursive = false;
  let sawForce = false;
  let afterDoubleDash = false;
  const targets: string[] = [];

  for (const arg of args) {
    if (!afterDoubleDash && arg === "--") {
      afterDoubleDash = true;
      continue;
    }

    if (!afterDoubleDash && arg.startsWith("-")) {
      const option = arg.toLowerCase();

      if (option === "-r" || option === "-rf" || option === "-fr") {
        sawRecursive = true;
        if (option.includes("f")) {
          sawForce = true;
        }
      }

      if (option === "-f") {
        sawForce = true;
      }

      if (option.includes("r")) {
        sawRecursive = true;
      }

      if (option.includes("f")) {
        sawForce = true;
      }

      if (option === "--recursive") {
        sawRecursive = true;
      }

      if (option === "--force") {
        sawForce = true;
      }

      continue;
    }

    targets.push(arg);
  }

  if (!(sawRecursive && sawForce)) {
    return false;
  }

  if (targets.length === 0) {
    return true;
  }

  return targets.some((target) => {
    if (/[*?]/.test(target)) {
      return true;
    }

    return DANGEROUS_RM_TARGET_PATTERNS.some((pattern) => pattern.test(target));
  });
}

function validateSegment(segment: string): string[] {
  const reasons: string[] = [];
  const parsed = parseSegment(segment);

  if (!parsed) {
    return ["Unable to parse a valid command from one of the segments."];
  }

  if (!parsed.commandName) {
    return ["Unable to determine the command name."];
  }

  if (BANNED_BASE_COMMANDS.has(parsed.commandName)) {
    reasons.push(`Command '${parsed.commandName}' is blocked by policy.`);
  }

  for (const prefix of BANNED_PREFIXES) {
    if (parsed.commandName.startsWith(prefix)) {
      reasons.push(`Command '${parsed.commandName}' is blocked by policy.`);
      break;
    }
  }

  if (isDangerousRm(parsed)) {
    reasons.push("Dangerous 'rm -rf' target is blocked by policy.");
  }

  return reasons;
}

export function checkCommandSafety(command: string): SecurityCheckResult {
  const trimmed = command.trim();

  if (!trimmed) {
    return {
      safe: false,
      reasons: ["Generated command is empty after normalization."],
    };
  }

  const splitResult = splitByAllowedOperators(trimmed);
  const reasons = [...splitResult.reasons];

  if (splitResult.segments.length === 0) {
    reasons.push("No executable command segment was found.");
  }

  for (const segment of splitResult.segments) {
    reasons.push(...validateSegment(segment));
  }

  const unique = uniqueReasons(reasons);
  return {
    safe: unique.length === 0,
    reasons: unique,
  };
}
