import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getPackageJson } from "./get-package-json.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SKIPPED_DIRECTORIES = new Set(["node_modules"]);
const HTML_REFERENCE = /(?:src|href)="(\/[^"]+)"/g;

/** Every file in the package, as posix-style paths relative to the root. */
function listFiles(dir) {
  const files = [];

  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        walk(path.join(current, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.isFile()) {
        files.push(`${prefix}${entry.name}`);
      }
    }
  };

  walk(dir, "");
  return files;
}

/** Parses a file the way the browser will: syntax only, nothing executed. */
function parses(file) {
  try {
    execFileSync(process.execPath, ["--check", file], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    return null;
  } catch (error) {
    const output = String(error.stderr ?? error.message);
    const firstLine = output.split("\n").find((line) => line.trim().length > 0);
    return firstLine?.trim() ?? "unknown syntax error";
  }
}

function checkPath(problems, present, what, target) {
  if (!target) return;
  if (!present.has(target)) {
    problems.push(`${what} points at "${target}" but the file is missing`);
  }
}

/**
 * Inspects a built extension directory. Returns the problems found rather than
 * throwing, so callers can report all of them at once.
 */
export function inspectExtensionPackage(dir, { expectedVersion } = {}) {
  const problems = [];
  const stats = { files: 0, bytes: 0, javascriptFiles: 0 };

  if (!fs.existsSync(dir)) {
    problems.push(`${dir} does not exist — the package was never built`);
    return { problems, stats };
  }

  const files = listFiles(dir);
  const present = new Set(files);
  stats.files = files.length;

  for (const file of files) {
    const size = fs.statSync(path.join(dir, file)).size;
    stats.bytes += size;

    if (!file.endsWith(".js")) continue;
    stats.javascriptFiles += 1;

    if (size === 0) {
      problems.push(`${file} is empty`);
      continue;
    }

    const parseError = parses(path.join(dir, file));
    if (parseError) problems.push(`${file} does not parse: ${parseError}`);
  }

  // --- manifest ---------------------------------------------------------
  const manifestPath = path.join(dir, "manifest.json");
  let manifest = null;

  if (!fs.existsSync(manifestPath)) {
    problems.push("manifest.json is missing");
  } else {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (error) {
      problems.push(`manifest.json is not valid JSON: ${error.message}`);
    }
  }

  if (manifest) {
    if (expectedVersion && manifest.version !== expectedVersion) {
      problems.push(
        `manifest.json version ${manifest.version} does not match package.json version ${expectedVersion}`
      );
    }

    checkPath(
      problems,
      present,
      "background.service_worker",
      manifest.background?.service_worker
    );
    checkPath(problems, present, "action.default_popup", manifest.action?.default_popup);
    checkPath(problems, present, "side_panel.default_path", manifest.side_panel?.default_path);

    for (const [size, icon] of Object.entries(manifest.icons ?? {})) {
      checkPath(problems, present, `icons.${size}`, icon);
    }

    (manifest.declarative_net_request?.rule_resources ?? []).forEach((rule, index) => {
      checkPath(
        problems,
        present,
        `declarative_net_request.rule_resources[${index}].path`,
        rule.path
      );
    });

    (manifest.content_scripts ?? []).forEach((script, index) => {
      for (const js of script.js ?? []) {
        checkPath(problems, present, `content_scripts[${index}].js`, js);
      }
      for (const css of script.css ?? []) {
        checkPath(problems, present, `content_scripts[${index}].css`, css);
      }
    });

    for (const entry of manifest.web_accessible_resources ?? []) {
      for (const resource of entry.resources ?? []) {
        if (resource.includes("*")) continue;
        checkPath(problems, present, "web_accessible_resources", resource);
      }
    }
  }

  // --- the page users actually see --------------------------------------
  const indexPath = path.join(dir, "index.html");

  if (!fs.existsSync(indexPath)) {
    problems.push("index.html is missing");
  } else {
    const html = fs.readFileSync(indexPath, "utf8");

    if (!/id="root"/.test(html)) {
      problems.push("index.html has no #root mount point");
    }

    for (const [, reference] of html.matchAll(HTML_REFERENCE)) {
      const target = reference.replace(/^\//, "");
      if (!present.has(target)) {
        problems.push(`index.html references "${reference}" but the file is missing`);
      }
    }
  }

  return { problems: [...new Set(problems)], stats };
}

/** Throws when the package is not loadable. */
export function checkExtensionPackage(dir, { expectedVersion } = {}) {
  const { problems, stats } = inspectExtensionPackage(dir, { expectedVersion });

  if (problems.length > 0) {
    const error = new Error(
      `packaged extension is not loadable:\n  - ${problems.join("\n  - ")}`
    );
    error.problems = problems;
    throw error;
  }

  return stats;
}

/** `node scripts/check-packaged-extension.js [dir]` */
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const target = path.resolve(process.argv[2] ?? path.join(__dirname, "../dist-extension"));
  const { version } = getPackageJson();
  const { problems, stats } = inspectExtensionPackage(target, { expectedVersion: version });

  console.log(
    `${path.relative(process.cwd(), target)}: ${stats.files} files, ` +
      `${stats.javascriptFiles} scripts, ${(stats.bytes / 1024 / 1024).toFixed(1)} MiB`
  );

  for (const problem of problems) console.error(`  ✖ ${problem}`);

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s) — this build would load broken.`);
    process.exit(1);
  }

  console.log("  ✔ packaged extension looks loadable");
}
