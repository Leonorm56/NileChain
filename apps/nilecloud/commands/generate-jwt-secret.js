import crypto from "crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * @param {import("commander").Command} program
 * @param {typeof import("inquirer").default} inquirer
 * @param {typeof import("chalk").default} chalk
 */
export default (program, inquirer, chalk) => {
  program
    .command("generate-jwt-secret")
    .description("Generate JWT Secret")
    .action(async () => {
      const secret = crypto.randomBytes(32).toString("hex");
      const envPath = path.resolve(__dirname, "../.env");
      const examplePath = path.resolve(__dirname, "../.env.example");

      /** Ensure .env exists */
      if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
        fs.copyFileSync(examplePath, envPath);
      }

      let content = "";
      if (fs.existsSync(envPath)) {
        content = fs.readFileSync(envPath, "utf8");
      }

      if (/^JWT_SECRET_KEY\s*=/m.test(content)) {
        content = content.replace(
          /^JWT_SECRET_KEY\s*=.*$/m,
          `JWT_SECRET_KEY="${secret}"`,
        );
      } else {
        content += `\nJWT_SECRET_KEY="${secret}"\n`;
      }

      fs.writeFileSync(envPath, content, "utf8");

      console.log(chalk.green.bold("Secret Generated and Saved to .env"));
      console.log(chalk.blue(secret));
    });
};