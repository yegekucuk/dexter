import { spawn } from "node:child_process";

export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  output?: string;
}

export async function runCommand(
  command: string,
  timeoutMs: number,
): Promise<RunResult> {
  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], {
      stdio: ["inherit", "pipe", "pipe"],
    });

    let outputStr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      outputStr += chunk.toString("utf8");
      if (outputStr.length > 10000) outputStr = outputStr.slice(-2000);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      outputStr += chunk.toString("utf8");
      if (outputStr.length > 10000) outputStr = outputStr.slice(-2000);
    });

    let timedOut = false;
    let settled = false;
    let exitCode: number | null = null;
    let signal: NodeJS.Signals | null = null;

    const resolveOnce = (result: RunResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };

    const rejectOnce = (error: unknown): void => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");

      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 1_000).unref();
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectOnce(error);
    });

    child.on("exit", (code, sig) => {
      exitCode = code;
      signal = sig;
    });

    child.on("close", (code, sig) => {
      clearTimeout(timeout);
      resolveOnce({
        exitCode: exitCode ?? code,
        signal: signal ?? sig,
        timedOut,
        output: outputStr.length > 2000 ? outputStr.slice(-2000) : outputStr,
      });
    });
  });
}
