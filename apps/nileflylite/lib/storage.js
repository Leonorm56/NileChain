import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const ACCOUNTS_PATH = path.resolve("accounts.json");
const CONFIG_PATH = path.resolve("config.json");

let _accounts = [];
let _config = null;

export function readAccounts() {
  try {
    const raw = fs.readFileSync(ACCOUNTS_PATH, "utf-8");
    const data = JSON.parse(raw);
    _accounts = data.accounts || [];
    return _accounts;
  } catch {
    return [];
  }
}

export async function writeAccounts(accounts) {
  _accounts = accounts;
  const tmp = ACCOUNTS_PATH + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify({ accounts }, null, 2));
  await fsp.rename(tmp, ACCOUNTS_PATH);
}

export function findAccount(userId) {
  const accounts = readAccounts();
  return accounts.find((a) => a.id === userId) || null;
}

export function upsertAccount(account) {
  const accounts = readAccounts();
  const idx = accounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) {
    accounts[idx] = { ...accounts[idx], ...account };
  } else {
    accounts.push(account);
  }
  _accounts = accounts;
}

export function readConfig() {
  if (_config) return _config;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    _config = JSON.parse(raw);
    return _config;
  } catch {
    return {
      server: { port: 3000, apiKey: "" },
      telegram: { botToken: "", chatId: "", threadId: "" },
    };
  }
}

export function getConfig() {
  return readConfig();
}
