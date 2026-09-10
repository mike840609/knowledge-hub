import "dotenv/config";

export type DatabaseConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
};

function value(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export function databaseConfig(kind: "dev" | "test" | "e2e" = "dev"): DatabaseConfig {
  const prefix = kind === "dev" ? "KM_DB" : kind === "test" ? "KM_TEST_DB" : "KM_E2E_DB";
  const portName = `${prefix}_PORT`;
  const defaultDatabase = kind === "dev" ? "hcm_km_dev" : kind === "test" ? "hcm_km_test_local" : "hcm_km_e2e_local";
  return {
    host: value(`${prefix}_HOST`, kind === "dev" ? "127.0.0.1" : value("KM_TEST_DB_HOST", "127.0.0.1")),
    port: Number(value(portName, value("KM_TEST_DB_PORT", "3307"))),
    user: value(`${prefix}_USER`, value("KM_TEST_DB_USER", kind === "dev" ? "hcm_km" : "root")),
    password: value(`${prefix}_PASSWORD`, value("KM_TEST_DB_PASSWORD", kind === "dev" ? "hcm_km_dev" : "hcm_km_root")),
    database: value(`${prefix}_NAME`, defaultDatabase),
    connectionLimit: 10,
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
