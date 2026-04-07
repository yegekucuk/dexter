import { spawn } from "node:child_process";

export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

export async function runCommand(
  command: string,
  timeoutMs: number,
): Promise<RunResult> {
  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], {
      stdio: "inherit",
    });

    let timedOut = false;
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
      reject(error);
    });

    child.on("exit", (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({
        exitCode,
        signal,
        timedOut,
      });
    });
  });
}
