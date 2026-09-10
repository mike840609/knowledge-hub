import { randomUUID } from "node:crypto";
import { createIsolatedDatabase, dropIsolatedDatabase, type IsolatedDatabaseHandle } from "./migrate";

export function isolatedDatabaseName(kind: "test" | "e2e"): string {
  const prefix = kind === "test" ? "hcm_km_test_" : "hcm_km_e2e_";
  return `${prefix}${process.pid}_${randomUUID().slice(0, 8)}`.toLowerCase();
}

export async function provisionIsolatedDatabase(kind: "test" | "e2e"): Promise<IsolatedDatabaseHandle> {
  const databaseName = isolatedDatabaseName(kind);
  return createIsolatedDatabase(kind, databaseName);
}

export async function disposeIsolatedDatabase(handle: IsolatedDatabaseHandle): Promise<void> {
  await dropIsolatedDatabase(handle);
}
