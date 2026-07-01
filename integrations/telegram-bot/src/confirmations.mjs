const WRITE_COMMANDS = new Set(["move", "delete"]);

export function isWriteCommand(command) {
  return WRITE_COMMANDS.has(command);
}

export function writeCommandBlockedMessage(command) {
  return [
    `/${command} is recognized but not enabled yet.`,
    "The next gate will add explicit confirmation state before any TickTick write.",
  ].join("\n");
}
