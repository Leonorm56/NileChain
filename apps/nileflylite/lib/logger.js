const colors = {
  reset: "\x1b[0m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
};

function timestamp() {
  const now = new Date();
  return `${now.toISOString().slice(0, 19)}`;
}

function c(str, color) {
  return `${colors[color] || ""}${str}${colors.reset}`;
}

export const logger = {
  log(...args) {
    console.log(`[${c(timestamp(), "gray")}]`, ...args);
  },
  info(...args) {
    console.log(`[${c(timestamp(), "gray")}] ${c("[INFO]", "blue")}`, ...args);
  },
  success(...args) {
    console.log(`[${c(timestamp(), "gray")}] ${c("[OK]", "green")}`, ...args);
  },
  warn(...args) {
    console.log(`[${c(timestamp(), "gray")}] ${c("[WARN]", "yellow")}`, ...args);
  },
  error(...args) {
    console.error(`[${c(timestamp(), "gray")}] ${c("[ERR]", "red")}`, ...args);
  },
  keyValue(key, value) {
    console.log(`[${c(timestamp(), "gray")}]   ${c(key + ":", "cyan")} ${value}`);
  },
  newline() {
    console.log("");
  },
};
