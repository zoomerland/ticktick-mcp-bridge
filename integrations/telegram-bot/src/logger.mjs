const SECRET_PATTERNS = [
  /([A-Za-z0-9_-]*token[A-Za-z0-9_-]*=)[^\s]+/gi,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]+/g,
];

export function redact(value) {
  let text = String(value);
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "$1[redacted]");
  }
  return text;
}

export function createLogger({ level = "info" } = {}) {
  const enabled = new Set(["debug", "info", "warn", "error"]);
  const order = ["debug", "info", "warn", "error"];
  const min = order.indexOf(enabled.has(level) ? level : "info");

  function log(method, args) {
    if (order.indexOf(method) < min) return;
    console[method](...args.map(redact));
  }

  return {
    debug: (...args) => log("debug", args),
    info: (...args) => log("info", args),
    warn: (...args) => log("warn", args),
    error: (...args) => log("error", args),
  };
}
