export const ALLOWED_OPERATORS = ["&&", "|"] as const;

/**
 * Commands that are ALWAYS banned, even with /sudo flag.
 * Includes shells, interpreters, filesystem mutation, system shutdown, and user management.
 */
export const ALWAYS_BANNED_BASE_COMMANDS = new Set([
  // Shells and interpreters
  "bash",
  "sh",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "command",
  "builtin",
  "enable",
  "nohup",
  "time",
  "xargs",
  "env",
  "eval",
  "exec",
  "source",
  "su",
  // Filesystem and system mutation
  "chmod",
  "chown",
  "chattr",
  "dd",
  "mount",
  "umount",
  // System shutdown and reboot
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  // Process control
  "kill",
  "killall",
  "pkill",
  // Firewall
  "iptables",
  "nft",
  // User and group management
  "useradd",
  "usermod",
  "userdel",
  "passwd",
  "adduser",
  "addgroup",
  "groupadd",
  "groupdel",
  // Interpreters (always banned, even in /sudo mode)
  "python",
  "python3",
  "perl",
  "ruby",
  "node",
]);

/**
 * Commands that are banned in normal mode but allowed with /sudo flag.
 * Includes privilege escalation, package managers, and container tools.
 */
export const CONDITIONALLY_BANNED_BASE_COMMANDS = new Set([
  "sudo",
  "apt",
  "apt-get",
  "yum",
  "dnf",
  "pacman",
  "zypper",
  "apk",
  "snap",
  "flatpak",
  "docker",
  "podman",
  "systemctl",
]);

/**
 * For backwards compatibility and tests, expose merged set as BANNED_BASE_COMMANDS.
 * Default behavior treats all banned commands (both always and conditionally) as blocked.
 */
export const BANNED_BASE_COMMANDS = new Set([
  ...ALWAYS_BANNED_BASE_COMMANDS,
  ...CONDITIONALLY_BANNED_BASE_COMMANDS,
]);

/**
 * Prefixes that are always banned (e.g. mkfs.ext4, mkfs.btrfs).
 */
export const BANNED_PREFIXES = ["mkfs"];

/**
 * Critical system paths that should never be recursively deleted.
 */
export const CRITICAL_SYSTEM_PATHS = ["/", "/etc", "/boot"];

/**
 * Dangerous rm target patterns (applies in all modes, even with /sudo).
 * Extended to block recursive deletes on critical system paths.
 */
export const DANGEROUS_RM_TARGET_PATTERNS = [
  /^\/$/,
  /^\//,
  /^~($|\/)/,
  /^\$HOME($|\/)/,
  /^\.$/,
  /^\.\.$/,
  /^\.\//,
  /^\.\.\//,
  /^\*$/,
  /^\.\*$/,
];
