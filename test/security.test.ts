import { describe, expect, test } from "vitest";
import { checkCommandSafety } from "../src/security/check.js";
import { normalizeCommand } from "../src/security/normalize.js";

describe("normalizeCommand", () => {
  test("strips code fences and command prefix", () => {
    const raw = "```bash\nCommand: ls -la\n```";
    const normalized = normalizeCommand(raw);
    expect(normalized).toBe("ls -la");
  });

  test("compacts multiline output", () => {
    const raw = "du -h\n/var\n";
    const normalized = normalizeCommand(raw);
    expect(normalized).toBe("du -h /var");
  });
});

describe("checkCommandSafety", () => {
  test("allows a simple read-only command", () => {
    const result = checkCommandSafety("df -h");
    expect(result.safe).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  test("allows && and pipe chains", () => {
    const result = checkCommandSafety("ps aux | grep ssh && whoami");
    expect(result.safe).toBe(true);
  });

  test("blocks banned base command", () => {
    const result = checkCommandSafety("sudo ls /root");
    expect(result.safe).toBe(false);
    expect(result.reasons.join(" ")).toContain("blocked by policy");
  });

  test("blocks || operator", () => {
    const result = checkCommandSafety("ls || whoami");
    expect(result.safe).toBe(false);
    expect(result.reasons.join(" ")).toContain("'||'");
  });

  test("blocks redirection operators", () => {
    const result = checkCommandSafety("echo test > file.txt");
    expect(result.safe).toBe(false);
    expect(result.reasons.join(" ")).toContain("Redirection");
  });

  test("blocks subshell expansion inside double quotes", () => {
    const result = checkCommandSafety('echo "$(whoami)"');
    expect(result.safe).toBe(false);
    expect(result.reasons.join(" ")).toContain("Subshell");
  });

  test("blocks dangerous rm -rf path", () => {
    const result = checkCommandSafety("rm -rf /");
    expect(result.safe).toBe(false);
    expect(result.reasons.join(" ")).toContain("Dangerous 'rm -rf'");
  });

  test("blocks mkfs prefix", () => {
    const result = checkCommandSafety("mkfs.ext4 /dev/sda");
    expect(result.safe).toBe(false);
    expect(result.reasons.join(" ")).toContain("blocked by policy");
  });
});
