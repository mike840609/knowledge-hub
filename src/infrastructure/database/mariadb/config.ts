import "dotenv/config";

export type DatabaseSslMode = "off" | "verify" | "trust";

export type DatabaseSsl = false | { rejectUnauthorized: boolean };

export type DatabaseConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
  connectTimeout?: number;
  acquireTimeout?: number;
  ssl?: DatabaseSsl;
};

export type ParsedConnectionUrl = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

const CONNECTION_URL_ERROR = "KM_DB_URL must be a mysql:// or mariadb:// URL with a host and database name.";

/**
 * Parse the Layerbase connection string. Only the two MySQL-wire protocols are
 * accepted. Errors deliberately never include the raw value: it carries the
 * database password.
 */
export function parseConnectionUrl(raw: string): ParsedConnectionUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(CONNECTION_URL_ERROR);
  }
  if (url.protocol !== "mysql:" && url.protocol !== "mariadb:") throw new Error(CONNECTION_URL_ERROR);
  const host = url.hostname;
  let database: string;
  let user: string;
  let password: string;
  try {
    database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new Error(CONNECTION_URL_ERROR);
  }
  if (!host || !database) throw new Error(CONNECTION_URL_ERROR);
  const port = url.port ? Number(url.port) : 3306;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(CONNECTION_URL_ERROR);
  return { host, port, user, password, database };
}

export function sslOption(mode: string): DatabaseSsl {
  switch (mode) {
    case "off": return false;
    case "verify": return { rejectUnauthorized: true };
    case "trust": return { rejectUnauthorized: false };
    default: throw new Error("KM_DB_SSL must be off, verify, or trust.");
  }
}

function value(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function connectionLimit(): number {
  return positiveInt("KM_DB_POOL_SIZE", process.env.VERCEL ? 2 : 10);
}

function connectTimeout(): number {
  return positiveInt("KM_DB_CONNECT_TIMEOUT_MS", 30_000);
}

function acquireTimeout(): number {
  return positiveInt("KM_DB_ACQUIRE_TIMEOUT_MS", 35_000);
}

function configuredSsl(defaultMode?: DatabaseSslMode): DatabaseSsl {
  const raw = (process.env.KM_DB_SSL ?? "").trim();
  if (!raw) return defaultMode ? sslOption(defaultMode) : false;
  return sslOption(raw);
}

export function databaseConfig(kind: "dev" | "test" | "e2e" = "dev"): DatabaseConfig {
  const remoteUrl = kind === "dev" ? (process.env.KM_DB_URL ?? "").trim() : "";
  if (remoteUrl) {
    return {
      ...parseConnectionUrl(remoteUrl),
      connectionLimit: connectionLimit(),
      connectTimeout: connectTimeout(),
      acquireTimeout: acquireTimeout(),
      ssl: configuredSsl("verify"),
    };
  }

  const prefix = kind === "dev" ? "KM_DB" : kind === "test" ? "KM_TEST_DB" : "KM_E2E_DB";
  const portName = `${prefix}_PORT`;
  const defaultDatabase = kind === "dev" ? "hcm_km_dev" : kind === "test" ? "hcm_km_test_local" : "hcm_km_e2e_local";
  return {
    host: value(`${prefix}_HOST`, kind === "dev" ? "127.0.0.1" : value("KM_TEST_DB_HOST", "127.0.0.1")),
    port: Number(value(portName, value("KM_TEST_DB_PORT", "3307"))),
    user: value(`${prefix}_USER`, value("KM_TEST_DB_USER", kind === "dev" ? "hcm_km" : "root")),
    password: value(`${prefix}_PASSWORD`, value("KM_TEST_DB_PASSWORD", kind === "dev" ? "hcm_km_dev" : "hcm_km_root")),
    database: value(`${prefix}_NAME`, defaultDatabase),
    connectionLimit: connectionLimit(),
    connectTimeout: connectTimeout(),
    acquireTimeout: acquireTimeout(),
    ssl: configuredSsl(),
  };
}

export function adminDatabaseConfig(kind: "test" | "e2e"): DatabaseConfig {
  const base = databaseConfig(kind);
  return {
    ...base,
    user: process.env.KM_TEST_DB_ADMIN_USER ?? "root",
    password: process.env.KM_TEST_DB_ADMIN_PASSWORD ?? process.env.KM_TEST_DB_PASSWORD ?? "hcm_km_root",
    database: process.env.KM_TEST_ADMIN_DATABASE ?? "mysql",
  };
}
