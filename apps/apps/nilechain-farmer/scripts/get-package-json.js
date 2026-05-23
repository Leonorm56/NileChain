import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Get package.json
 */
export function getPackageJson() {
  const name = process.env["npm_package_name"];
  const version = process.env["npm_package_version"];
  if (name && version) return { name, version };
  const dir = fileURLToPath(new URL(".", import.meta.url));
  return JSON.parse(readFileSync(resolve(dir, "../package.json"), "utf8"));
}
