export class RateLimiter {
  constructor({ windowMs, maxCommands }) {
    this.windowMs = windowMs;
    this.maxCommands = maxCommands;
    this.events = new Map();
  }

  check(key, now = Date.now()) {
    const cutoff = now - this.windowMs;
    const recent = (this.events.get(key) || []).filter((time) => time >= cutoff);
    if (recent.length >= this.maxCommands) {
      this.events.set(key, recent);
      return { ok: false, retryAfterMs: recent[0] + this.windowMs - now };
    }
    recent.push(now);
    this.events.set(key, recent);
    return { ok: true, remaining: this.maxCommands - recent.length };
  }
}
