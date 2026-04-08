#!/usr/bin/env node

import inquirer from "inquirer";
import { clearLine, cursorTo } from "node:readline";
import {
  COMMAND_EXEC_TIMEOUT_MS,
  DEXTER_CLEAR_KEY,
  DEFAULT_OLLAMA_KEEP_ALIVE,
  DEFAULT_OLLAMA_MODELS,
  DEXTER_EXIT_KEY,
  DEXTER_HELP_KEY,
  DEXTER_HISTORY_KEY,
  DEXTER_HISTORY_WINDOW,
} from "./config.js";
import { runCommand } from "./executor/run.js";
import {
  generateCommand,
  generateWithoutInterpreters,
  resolvePreferredModel,
  warmupModels,
} from "./generator/ollama.js";
import type { PromptHistoryTurn } from "./generator/prompt.js";
import { checkCommandSafety } from "./security/check.js";
import { normalizeCommand } from "./security/normalize.js";
import { rewriteRedirectionToTee } from "./security/redirection.js";

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isInterpreterBlocked(reasons: string[]): boolean {
  return reasons.some((reason) =>
    /Command '(python|python3|perl|ruby|node)' is blocked by policy\./i.test(reason)
  );
}

type SpinnerController = {
  stop: (message: string) => void;
};

interface CliOptions {
  warmupEnabled: boolean;
  keepAlive: string;
  models: string[];
  customModelsProvided: boolean;
  showHelp: boolean;
}

interface SessionTurn {
  request: string;
  command: string;
  status: string;
}

function parseModelValue(rawValue: string): string[] {
  return rawValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function startLoadingBanner(message: string): SpinnerController {
  const frames = ["[=     ]", "[==    ]", "[===   ]", "[ ==== ]", "[  === ]", "[   == ]", "[    = ]"];
  let index = 0;
  const useInteractiveRender = Boolean(process.stdout.isTTY);

  if (!useInteractiveRender) {
    console.log(`${frames[index]} ${message}`);

    return {
      stop(finalMessage: string): void {
        console.log(finalMessage);
      },
    };
  }

  const render = (text: string): void => {
    clearLine(process.stdout, 0);
    cursorTo(process.stdout, 0);
    process.stdout.write(text);
  };

  render(`${frames[index]} ${message}`);

  const timer = setInterval(() => {
    index = (index + 1) % frames.length;
    render(`${frames[index]} ${message}`);
  }, 120);

  let stopped = false;

  return {
    stop(finalMessage: string): void {
      if (stopped) {
        return;
      }

      stopped = true;
      clearInterval(timer);
      render(finalMessage);
      process.stdout.write("\n");
    },
  };
}

function parseCliOptions(argv: string[]): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    return {
      warmupEnabled: true,
      keepAlive: DEFAULT_OLLAMA_KEEP_ALIVE,
      models: [...DEFAULT_OLLAMA_MODELS],
      customModelsProvided: false,
      showHelp: true,
    };
  }

  let warmupEnabled = true;
  let keepAlive = DEFAULT_OLLAMA_KEEP_ALIVE;
  const selectedModels: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";

    if (arg === "--no-warmup") {
      warmupEnabled = false;
      continue;
    }

    if (arg.startsWith("--keep-alive=")) {
      const value = arg.slice("--keep-alive=".length).trim();
      if (!value) {
        throw new Error("Flag '--keep-alive' must include a non-empty value.");
      }

      keepAlive = value;
      continue;
    }

    if (arg === "--keep-alive") {
      const next = (argv[i + 1] ?? "").trim();
      if (!next || next.startsWith("-")) {
        throw new Error("Flag '--keep-alive' requires a value.");
      }

      keepAlive = next;
      i += 1;
      continue;
    }

    if (arg.startsWith("--model=")) {
      const value = arg.slice("--model=".length).trim();
      const parsed = parseModelValue(value);

      if (parsed.length === 0) {
        throw new Error("Flag '--model' must include at least one model value.");
      }

      selectedModels.push(...parsed);
      continue;
    }

    if (arg === "--model") {
      const next = (argv[i + 1] ?? "").trim();
      if (!next || next.startsWith("-")) {
        throw new Error("Flag '--model' requires a value.");
      }

      const parsed = parseModelValue(next);
      if (parsed.length === 0) {
        throw new Error("Flag '--model' must include at least one model value.");
      }

      selectedModels.push(...parsed);
      i += 1;
    }
  }

  const models = selectedModels.length > 0
    ? [...new Set(selectedModels)]
    : [...DEFAULT_OLLAMA_MODELS];

  return {
    warmupEnabled,
    keepAlive,
    models,
    customModelsProvided: selectedModels.length > 0,
    showHelp: false,
  };
}

function printHelp(): void {
  console.log(`dexter - secure Linux command generator

Usage:
  dexter [options]

Options:
  --help, -h              Show this help message
  --no-warmup             Skip model preloading on startup
  --model <name[,name]>   Use custom model(s), in fallback order
  --keep-alive <string>   Pass keep_alive directly to Ollama warmup (default: ${DEFAULT_OLLAMA_KEEP_ALIVE})

Examples:
  dexter
  dexter --no-warmup
  dexter --model gemma4:e2b
  dexter --model gemma4:e2b,qwen3.5:0.8b
  dexter --keep-alive 15m
  dexter --keep-alive="2h"

Session commands:
  ${DEXTER_HELP_KEY}                  Show available session commands
  ${DEXTER_HISTORY_KEY}               Show in-memory conversation log
  ${DEXTER_CLEAR_KEY}                 Clear in-memory conversation log
  ${DEXTER_EXIT_KEY}                  Quit Dexter
`);
}

async function warmupOnStartup(options: CliOptions): Promise<void> {
  if (!options.warmupEnabled) {
    console.log("Skipping model warmup (--no-warmup).\n");
    return;
  }

  const spinner = startLoadingBanner(
    `Dexter is loading Ollama models into RAM (keep_alive: ${options.keepAlive}, models: ${options.models.join(", ")})...`,
  );

  const results = await warmupModels(options.models, options.keepAlive);
  const okCount = results.filter((item) => item.ok).length;

  if (okCount === results.length) {
    spinner.stop("[READY ] Models loaded into RAM.");
    return;
  }

  spinner.stop("[WARN  ] Some models could not be preloaded.");
  for (const result of results) {
    if (!result.ok) {
      console.log(`- ${result.model}: ${result.error ?? "Unknown error"}`);
    }
  }
  console.log("");
}

async function resolveModelsForSession(options: CliOptions): Promise<string[]> {
  if (options.customModelsProvided) {
    return options.models;
  }

  const [primaryModel, fallbackModel] = options.models;
  if (!primaryModel || !fallbackModel) {
    return options.models;
  }

  const spinner = startLoadingBanner("Checking Ollama model availability...");

  try {
    const resolved = await resolvePreferredModel(primaryModel, fallbackModel);

    if (resolved.selected === primaryModel) {
      spinner.stop(`[READY ] Using primary model: ${primaryModel}`);
    } else {
      spinner.stop(`[READY ] Primary unavailable. Using fallback model: ${fallbackModel}`);
    }

    return [resolved.selected];
  } catch (error) {
    spinner.stop("[ERROR ] Unable to resolve a usable model.");
    throw error;
  }
}

async function promptInput(): Promise<string> {
  const answer = await inquirer.prompt<{ request: string }>([
    {
      type: "input",
      name: "request",
      message: `Describe the Linux command you need (${DEXTER_EXIT_KEY} to quit):`,
    },
  ]);

  return answer.request.trim();
}

function buildPromptHistoryWindow(history: SessionTurn[]): PromptHistoryTurn[] {
  if (history.length <= DEXTER_HISTORY_WINDOW) {
    return history;
  }

  return history.slice(history.length - DEXTER_HISTORY_WINDOW);
}

function printSessionHistory(history: SessionTurn[]): void {
  if (history.length === 0) {
    console.log("No session history yet.\n");
    return;
  }

  console.log("\nSession history:\n");

  history.forEach((turn, index) => {
    console.log(`[${index + 1}] request: ${turn.request}`);
    console.log(`    command: ${turn.command}`);
    console.log(`    status: ${turn.status}`);
  });

  console.log("");
}

function printSessionCommands(): void {
  console.log("\nSession commands:\n");
  console.log(`${DEXTER_HELP_KEY}                  Show available session commands`);
  console.log(`${DEXTER_HISTORY_KEY}               Show in-memory conversation log`);
  console.log(`${DEXTER_CLEAR_KEY}                 Clear in-memory conversation log`);
  console.log(`${DEXTER_EXIT_KEY}                  Quit Dexter`);
  console.log("");
}

async function promptConfirmation(command: string): Promise<boolean> {
  console.log(`\nGenerated command:\n${command}\n`);

  const answer = await inquirer.prompt<{ confirm: boolean }>([
    {
      type: "confirm",
      name: "confirm",
      message: "Execute this command?",
      default: false,
    },
  ]);

  return answer.confirm;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  if (options.showHelp) {
    printHelp();
    return;
  }

  let sessionModels: string[];

  try {
    sessionModels = await resolveModelsForSession(options);
  } catch (error) {
    console.error(`Model resolution failed: ${formatError(error)}`);
    process.exit(1);
  }

  const sessionOptions: CliOptions = {
    ...options,
    models: sessionModels,
  };

  await warmupOnStartup(sessionOptions);
  const sessionHistory: SessionTurn[] = [];

  while (true) {
    const request = await promptInput();

    if (!request) {
      console.log(`Please provide a request or type ${DEXTER_EXIT_KEY} to exit.\n`);
      continue;
    }

    const loweredRequest = request.toLowerCase();

    if (loweredRequest === DEXTER_EXIT_KEY) {
      console.log("Bye.");
      return;
    }

    if (loweredRequest === DEXTER_HISTORY_KEY) {
      printSessionHistory(sessionHistory);
      continue;
    }

    if (loweredRequest === DEXTER_HELP_KEY) {
      printSessionCommands();
      continue;
    }

    if (loweredRequest === DEXTER_CLEAR_KEY) {
      sessionHistory.length = 0;
      console.log("Session history cleared.\n");
      continue;
    }

    const modelHistory = buildPromptHistoryWindow(sessionHistory);
    let turn: SessionTurn = {
      request,
      command: "-",
      status: "generation_failed",
    };

    let rawCommand: string;
    try {
      rawCommand = await generateCommand(request, sessionOptions.models, {
        history: modelHistory,
      });
    } catch (error) {
      turn.status = `generation_failed: ${formatError(error)}`;
      sessionHistory.push(turn);
      console.log(`Command generation failed: ${formatError(error)}\n`);
      continue;
    }

    let normalizedCommand = normalizeCommand(rawCommand);
    let rewritten = await rewriteRedirectionToTee(normalizedCommand);
    let candidateCommand = rewritten.command;
    turn.command = candidateCommand;
    let safety = checkCommandSafety(candidateCommand);

    if (!safety.safe && isInterpreterBlocked(safety.reasons)) {
      console.log("Blocked interpreter command generated. Retrying with shell-only + tee instructions...\n");

      try {
        const retryRaw = await generateWithoutInterpreters(
          request,
          sessionOptions.models,
          modelHistory,
        );
        normalizedCommand = normalizeCommand(retryRaw);
        rewritten = await rewriteRedirectionToTee(normalizedCommand);
        candidateCommand = rewritten.command;
        turn.command = candidateCommand;
        safety = checkCommandSafety(candidateCommand);
      } catch (error) {
        turn.status = `retry_generation_failed: ${formatError(error)}`;
        sessionHistory.push(turn);
        console.log(`Retry generation failed: ${formatError(error)}\n`);
        continue;
      }
    }

    if (!safety.safe) {
      turn.status = `blocked: ${safety.reasons.join(" | ")}`;
      sessionHistory.push(turn);
      console.log("Command blocked by security policy:");
      for (const reason of safety.reasons) {
        console.log(`- ${reason}`);
      }
      console.log("");
      continue;
    }

    const confirmed = await promptConfirmation(candidateCommand);
    if (!confirmed) {
      turn.status = "discarded";
      sessionHistory.push(turn);
      console.log("Command discarded.\n");
      continue;
    }

    console.log("Executing command...\n");

    try {
      const result = await runCommand(candidateCommand, COMMAND_EXEC_TIMEOUT_MS);

      if (result.timedOut) {
        turn.status = "timeout";
        console.log(`\nCommand timed out after ${COMMAND_EXEC_TIMEOUT_MS}ms.`);
      } else if (result.exitCode === 0) {
        turn.status = "success";
        console.log("\nCommand completed successfully.");
      } else {
        turn.status = `failed(exit=${String(result.exitCode)}${
          result.signal ? `,signal=${result.signal}` : ""
        })`;
        console.log(
          `\nCommand finished with exit code ${String(result.exitCode)}${
            result.signal ? ` (signal: ${result.signal})` : ""
          }.`,
        );
      }
    } catch (error) {
      turn.status = `execution_error: ${formatError(error)}`;
      console.log(`\nCommand execution failed: ${formatError(error)}`);
    }

    sessionHistory.push(turn);
    console.log("");
  }
}

main().catch((error) => {
  const message = formatError(error);
  if (message.toLowerCase().includes("force closed")) {
    console.log("\nBye.");
    process.exit(0);
  }

  console.error(`Unexpected error: ${message}`);
  process.exit(1);
});
