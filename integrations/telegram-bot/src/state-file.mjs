import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SessionStore } from "./session-store.mjs";

function readState(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export class FileSessionStore extends SessionStore {
  constructor(path) {
    super(readState(path));
    this.path = path;
  }

  persist() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(this.snapshot(), null, 2)}\n`, "utf8");
  }
}

export function createSessionStore(config) {
  return config.operational.stateFile
    ? new FileSessionStore(config.operational.stateFile)
    : new SessionStore();
}
