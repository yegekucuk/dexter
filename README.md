# Dexter

Dexter is a secure Linux command generator CLI powered by Ollama.

## Features

- Turns natural-language Linux requests into shell commands.
- Uses `qwen3.5:2b` with fallback to `qwen3.5:0.8b`.
- Preloads both models into RAM at startup with configurable `keep_alive`.
- Normalizes model output to a single command string.
- Applies strict security checks before execution.
- Requires explicit user confirmation before running a command.
- Exits after one confirmed execution, or exits immediately on `q`.

## Security defaults

- Allowed chain operators: `&&`, `|`
- Blocked operators/syntax: `;`, `||`, `>`, `>>`, `<`, backticks, `$(...)`, background `&`
- Strict blocked command classes:
  - privilege/escalation commands (`sudo`, `su`)
  - filesystem/system mutation (`dd`, `mkfs*`, `mount`, `umount`, `chmod`, `chown`, `chattr`)
  - process/system shutdown control (`kill*`, `shutdown`, `reboot`, `poweroff`, `halt`)
  - user/firewall management (`useradd`, `usermod`, `passwd`, `iptables`, `nft`)
  - package/container management (`apt`, `yum`, `dnf`, `pacman`, `docker`, `podman`, etc.)
  - dangerous `rm -rf` targets

## Requirements

- Node.js 22+
- Ollama running locally on `http://localhost:11434`
- Installed model: `qwen3.5:2b` (fallback model optional)

## Install

```bash
npm install
```

## Run

```bash
npm run dev
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

On startup, Dexter calls Ollama `/api/generate` for each configured model with:

```json
{
  "model": "<configured-model>",
  "keep_alive": "<keep-alive-flag-or-default>"
}
```

Defaults to `10m`, configurable via `--keep-alive <string>`, and sent as-is to Ollama.
