import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function loadEnvFile(fileName) {
  const filePath = path.join(rootDir, fileName);
  if (!existsSync(filePath)) {
    return;
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1].startsWith("#")) {
      continue;
    }

    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[match[1]]) {
      process.env[match[1]] = value;
    }
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const migrationArg =
  process.argv[2] ?? "supabase/migrations/202604290001_create_user_alerts.sql";
const migrationPath = path.resolve(rootDir, migrationArg);
const rawDbUrl = process.env.SUPABASE_DB_URL;

if (!rawDbUrl) {
  console.error("SUPABASE_DB_URL is missing. Add the Postgres connection URI to .env first.");
  process.exit(1);
}

if (!existsSync(migrationPath)) {
  console.error(`Migration file not found: ${migrationArg}`);
  process.exit(1);
}

function normalizePostgresUrl(value) {
  const bracketedPassword = value.match(/^((?:postgres|postgresql):\/\/[^:/?#]+):\[(.*)\]@(.+)$/);
  if (bracketedPassword) {
    return `${bracketedPassword[1]}:${encodeURIComponent(bracketedPassword[2])}@${bracketedPassword[3]}`;
  }

  try {
    new URL(value);
    return value;
  } catch {
    const urlPrefix = value.match(/^((?:postgres|postgresql):\/\/[^:/?#]+):(.+)$/);
    if (!urlPrefix) {
      throw new Error("SUPABASE_DB_URL is not a valid Postgres URI.");
    }

    const atIndex = urlPrefix[2].lastIndexOf("@");
    if (atIndex === -1) {
      throw new Error("SUPABASE_DB_URL is not a valid Postgres URI.");
    }

    const password = urlPrefix[2].slice(0, atIndex);
    const tail = urlPrefix[2].slice(atIndex + 1);
    return `${urlPrefix[1]}:${encodeURIComponent(password)}@${tail}`;
  }
}

function sanitizeOutput(value, secrets) {
  let output = value;
  for (const secret of secrets) {
    if (secret) {
      output = output.split(secret).join("[redacted]");
    }
  }
  return output;
}

let dbUrl;
try {
  dbUrl = normalizePostgresUrl(rawDbUrl);
  new URL(dbUrl);
} catch (error) {
  console.error(error instanceof Error ? error.message : "SUPABASE_DB_URL is invalid.");
  process.exit(1);
}

const npxArgs = [
  "-y",
  "supabase@latest",
  "db",
  "query",
  "--db-url",
  dbUrl,
];

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let singleQuote = false;
  let doubleQuote = false;
  let lineComment = false;
  let blockComment = false;
  let dollarQuote = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      current += char;
      if (char === "\n") {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }

    if (dollarQuote) {
      current += char;
      if (sql.startsWith(dollarQuote, index)) {
        current += sql.slice(index + 1, index + dollarQuote.length);
        index += dollarQuote.length - 1;
        dollarQuote = null;
      }
      continue;
    }

    if (!singleQuote && !doubleQuote && char === "-" && next === "--") {
      current += char + next;
      index += 1;
      lineComment = true;
      continue;
    }

    if (!singleQuote && !doubleQuote && char === "/" && next === "*") {
      current += char + next;
      index += 1;
      blockComment = true;
      continue;
    }

    if (!singleQuote && !doubleQuote && char === "$") {
      const tag = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (tag) {
        dollarQuote = tag[0];
        current += dollarQuote;
        index += dollarQuote.length - 1;
        continue;
      }
    }

    if (!doubleQuote && char === "'" && sql[index - 1] !== "\\") {
      singleQuote = !singleQuote;
      current += char;
      continue;
    }

    if (!singleQuote && char === '"') {
      doubleQuote = !doubleQuote;
      current += char;
      continue;
    }

    if (!singleQuote && !doubleQuote && char === ";") {
      const statement = current.trim();
      if (statement) {
        statements.push(`${statement};`);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing) {
    statements.push(trailing);
  }

  return statements;
}

const secrets = [rawDbUrl, dbUrl];
const statements = splitSqlStatements(readFileSync(migrationPath, "utf8"));
const tempDir = mkdtempSync(path.join(os.tmpdir(), "monterun-supabase-migration-"));

try {
  for (let index = 0; index < statements.length; index += 1) {
    const statementPath = path.join(tempDir, `statement-${index + 1}.sql`);
    writeFileSync(statementPath, statements[index], "utf8");

    const command =
      process.platform === "win32"
        ? {
            file: "powershell.exe",
            args: [
              "-NoProfile",
              "-ExecutionPolicy",
              "Bypass",
              "npx",
              ...npxArgs,
              "--file",
              statementPath,
            ],
          }
        : {
            file: "npx",
            args: [...npxArgs, "--file", statementPath],
          };
    const result = spawnSync(command.file, command.args, {
      cwd: rootDir,
      encoding: "utf8",
    });

    if (result.error) {
      console.error(result.error.message);
      process.exit(1);
    }

    if (result.stdout) {
      process.stdout.write(sanitizeOutput(result.stdout, secrets));
    }
    if (result.stderr) {
      process.stderr.write(sanitizeOutput(result.stderr, secrets));
    }

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

process.exit(0);
