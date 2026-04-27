# Dexter

Dexter is a secure Linux command generator CLI powered by Ollama.

## Features

- Turns natural-language Linux requests into shell commands.
- Uses `gemma4:e2b` with fallback to `qwen3.5:0.8b`.
- Supports custom model selection via `--model`.
- Checks model availability and preloads only the selected runtime model.
- Normalizes model output to a single command string.
- Rewrites `>` / `>>` writes to `tee` / `tee -a` before security checks.
- For non-empty existing files, Dexter backs up old content to `<file>.tmp` and still writes new content to the original file.
- If a blocked interpreter command is generated (python/node/perl/ruby), Dexter retries once with shell-only + `tee` guidance.
- Supports `/help` (or `/?`) to list session commands, `/history` to inspect session memory, `/clear` to reset it, and `/sudo` to enable privileged commands.
- Applies strict security checks before execution.
- Requires explicit user confirmation before running a command.
- Runs as an interactive multi-turn session until you exit with `/bye`.
- Keeps an in-memory session log (request, generated command, execution status).
- Sends the last 12 turns (configurable via `--history-limit`) of session context to Ollama for follow-up prompts.
- Supports `/help` (or `/?`) to list session commands, `/history` to inspect session memory, and `/clear` to reset it.

## Security defaults

- Allowed chain operators: `&&`, `|`
- Blocked operators/syntax: `;`, `||`, `>`, `>>`, `<`, backticks, `$(...)`, background `&`
- Always blocked (even with `/sudo`):
  - shells and interpreters (`bash`, `sh`, `python`, `node`, `perl`, `ruby`, etc.)
  - filesystem/system mutation (`dd`, `mkfs*`, `mount`, `umount`, `chmod`, `chown`, `chattr`)
  - process/system shutdown control (`kill*`, `shutdown`, `reboot`, `poweroff`, `halt`)
  - user/firewall management (`useradd`, `usermod`, `passwd`, `iptables`, `nft`)
  - dangerous `rm -rf` targets and critical system paths (`/`, `/etc`, `/boot`)
- Normally blocked, allowed with `/sudo`:
  - privilege escalation (`sudo`)
  - package managers (`apt`, `apt-get`, `yum`, `dnf`, `pacman`, `zypper`, `apk`, `snap`, `flatpak`)
  - container management (`docker`, `podman`)
  - system control (`systemctl`)

## Requirements

- Node.js 22+
- Ollama running locally on `http://localhost:11434`
- Installed model: `gemma4:e2b` (fallback model optional)

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

Install as global `dexter` command:

```bash
npm run link:global
```

Then run:

```bash
dexter
```

Session commands while running:

```text
/help              Show available session commands
/?                 Show available session commands
/sudo <request>    Run request with sudo/privileged commands enabled
/history           Show in-memory conversation log
/clear             Clear in-memory conversation log
/bye               Quit Dexter
```

Show help:

```bash
dexter --help
```

Use custom model order (primary -> fallback):

```bash
dexter --model gemma4:e2b,qwen3.5:0.8b
```

or repeat the flag:

```bash
dexter --model gemma4:e2b --model qwen3.5:0.8b
```

Remove global link:

```bash
npm run unlink:global
```

Skip warmup:

```bash
npm run dev -- --no-warmup
```

Pass keep-alive directly as a string:

```bash
npm run dev -- --keep-alive 15m
```

or:

```bash
npm run dev -- --keep-alive="2h"
```

Set session context window limit:

```bash
dexter --history-limit 20
```

Production build:

```bash
npm run build
npm start
```

## Tests

```bash
npm test
```

## Optional environment variables

- `DEXTER_OLLAMA_URL`: override Ollama base URL (default: `http://localhost:11434`)

## Startup warmup

On startup, Dexter first checks Ollama `/api/tags` for default model availability.

- If both default models exist, Dexter selects the primary model.
- If primary is missing and fallback exists, Dexter selects fallback.
- If neither exists, Dexter exits with an error.

Then Dexter calls Ollama `/api/generate` for the selected runtime model with:

```json
{
  "model": "<selected-runtime-model>",
  "keep_alive": "<keep-alive-flag-or-default>"
}
```

Defaults to `10m`, configurable via `--keep-alive <string>`, and sent as-is to Ollama.

## Model selection

By default, Dexter uses:

1. `gemma4:e2b`
2. `qwen3.5:0.8b`

You can override this order with `--model`.

## License

Developed by Yunus Ege Küçük. Licensed under [MIT](LICENSE).
