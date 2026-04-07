#!/usr/bin/env node

import inquirer from "inquirer";
import {
  COMMAND_EXEC_TIMEOUT_MS,
  DEFAULT_OLLAMA_KEEP_ALIVE,
  DEFAULT_OLLAMA_MODELS,
  DEXTER_EXIT_KEY,
} from "./config.js";
import { runCommand } from "./executor/run.js";
import {
  generateCommand,
  resolvePreferredModel,
  warmupModels,
} from "./generator/ollama.js";
import { checkCommandSafety } from "./security/check.js";
import { normalizeCommand } from "./security/normalize.js";
import { rewriteRedirectionToTee } from "./security/redirection.js";

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function parseModelValue(rawValue: string): string[] {
  return rawValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function startLoadingBanner(message: string): SpinnerController {
  const frames = ["[=     ]", "[==    ]", "[===   ]", "[ ==== ]", "[  === ]", "[   == ]", "[    = ]"];
  let index = 0;

  process.stdout.write(`${frames[index]} ${message}`);

  const timer = setInterval(() => {
    index = (index + 1) % frames.length;
    process.stdout.write(`\r${frames[index]} ${message}`);
  }, 120);

  return {
    stop(finalMessage: string): void {
      clearInterval(timer);
      process.stdout.write(`\r${finalMessage}\n`);
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
      message: "Describe the Linux command you need (or q to quit):",
    },
  ]);

  return answer.request.trim();
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

  while (true) {
    const request = await promptInput();

    if (!request) {
      console.log("Please provide a request or type q to exit.\n");
      continue;
    }

    if (request.toLowerCase() === DEXTER_EXIT_KEY) {
      console.log("Bye.");
      return;
    }

    let rawCommand: string;
    try {
      rawCommand = await generateCommand(request, sessionOptions.models);
    } catch (error) {
      console.log(`Command generation failed: ${formatError(error)}\n`);
      continue;
    }

    const normalizedCommand = normalizeCommand(rawCommand);
    const rewritten = await rewriteRedirectionToTee(normalizedCommand);
    const candidateCommand = rewritten.command;
    const safety = checkCommandSafety(candidateCommand);

    if (!safety.safe) {
      console.log("Command blocked by security policy:");
      for (const reason of safety.reasons) {
        console.log(`- ${reason}`);
      }
      console.log("");
      continue;
    }

    if (rewritten.rewrites.length > 0) {
      console.log("Rewrote file redirection to tee:");
      for (const change of rewritten.rewrites) {
        if (change.clonedToTmp && change.backupTarget) {
          console.log(
            `- ${change.operator} ${change.sourceTarget} => ${change.finalTarget} (old content backed up to ${change.backupTarget})`,
          );
          continue;
        }

        console.log(`- ${change.operator} ${change.sourceTarget} => ${change.finalTarget}`);
      }
      console.log("");
    }

    const confirmed = await promptConfirmation(candidateCommand);
    if (!confirmed) {
      console.log("Command discarded.\n");
      continue;
    }

    console.log("Executing command...\n");

    try {
      const result = await runCommand(candidateCommand, COMMAND_EXEC_TIMEOUT_MS);

      if (result.timedOut) {
        console.log(`\nCommand timed out after ${COMMAND_EXEC_TIMEOUT_MS}ms.`);
      } else if (result.exitCode === 0) {
        console.log("\nCommand completed successfully.");
      } else {
        console.log(
          `\nCommand finished with exit code ${String(result.exitCode)}${
            result.signal ? ` (signal: ${result.signal})` : ""
          }.`,
        );
      }
    } catch (error) {
      console.log(`\nCommand execution failed: ${formatError(error)}`);
    }

    console.log("Exiting after one execution.");
    return;
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
