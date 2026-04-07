import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkCommandSafety } from "../src/security/check.js";
import { normalizeCommand } from "../src/security/normalize.js";
import { rewriteRedirectionToTee } from "../src/security/redirection.js";

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

describe("rewriteRedirectionToTee", () => {
  test("rewrites basic overwrite redirection", async () => {
    const rewritten = await rewriteRedirectionToTee("echo hello > file.txt", process.cwd());
    expect(rewritten.command).toBe("echo hello | tee file.txt");
    expect(rewritten.rewrites).toHaveLength(1);
    expect(rewritten.rewrites[0]?.clonedToTmp).toBe(false);
  });

  test("rewrites append redirection with tee -a", async () => {
    const rewritten = await rewriteRedirectionToTee("echo hello >> file.txt", process.cwd());
    expect(rewritten.command).toBe("echo hello | tee -a file.txt");
    expect(rewritten.rewrites).toHaveLength(1);
  });

  test("clones non-empty existing file to .tmp target", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dexter-redir-"));
    const target = path.join(dir, "file.txt");

    await writeFile(target, "existing\n", "utf8");

    const rewritten = await rewriteRedirectionToTee("echo hello > file.txt", dir);
    expect(rewritten.command).toBe("echo hello | tee file.txt");
    expect(rewritten.rewrites[0]?.clonedToTmp).toBe(true);
    expect(rewritten.rewrites[0]?.backupTarget).toBe("file.txt.tmp");

    const copied = await readFile(path.join(dir, "file.txt.tmp"), "utf8");
    expect(copied).toBe("existing\n");
  });

  test("keeps empty existing file as original target", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dexter-redir-empty-"));
    const target = path.join(dir, "file.txt");

    await writeFile(target, "", "utf8");

    const rewritten = await rewriteRedirectionToTee("echo hello > file.txt", dir);
    expect(rewritten.command).toBe("echo hello | tee file.txt");
    expect(rewritten.rewrites[0]?.clonedToTmp).toBe(false);
  });

  test("respects previous cd segment when resolving relative file target", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dexter-redir-cd-"));
    const target = path.join(dir, "file.txt");

    await writeFile(target, "existing\n", "utf8");

    const rewritten = await rewriteRedirectionToTee(
      `cd ${dir} && echo hello > file.txt`,
      process.cwd(),
    );

    expect(rewritten.command).toBe(`cd ${dir} && echo hello | tee file.txt`);
    expect(rewritten.rewrites[0]?.clonedToTmp).toBe(true);
    expect(rewritten.rewrites[0]?.backupTarget).toBe("file.txt.tmp");

    const copied = await readFile(path.join(dir, "file.txt.tmp"), "utf8");
    expect(copied).toBe("existing\n");
  });
});
