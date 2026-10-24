import { spawnSync } from "node:child_process";

const dryRun = process.argv.slice(2).includes("--dry-run");
const isProduction = process.env.VERCEL_ENV === "production";
const migrate = isProduction && process.env.KM_MIGRATE_ON_BUILD !== "0";
const directUrl = (process.env.KM_DB_MIGRATE_URL ?? "").trim();
const appUrl = (process.env.KM_DB_URL ?? "").trim();
const migrateUrl = directUrl || appUrl;
const migrationUrlSource = directUrl ? "direct" : appUrl ? "app" : "none";
const identityProvider = process.env.KM_IDENTITY_PROVIDER ?? "local";
// Test/harness hook only; never honor it on Vercel, where the project
// environment must not be able to replace the build entrypoint.
const buildScript = (!process.env.VERCEL && (process.env.KM_VERCEL_BUILD_SCRIPT ?? "").trim()) || "scripts/build.mjs";

function googleAuthErrors() {
  if (identityProvider !== "google") return [];
  const errors = [];
  for (const name of ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "AUTH_URL", "KM_PUBLIC_ORIGIN"]) {
    if (!(process.env[name] ?? "").trim()) errors.push(name);
  }
  const authUrl = (process.env.AUTH_URL ?? "").trim();
  const publicOrigin = (process.env.KM_PUBLIC_ORIGIN ?? "").trim();
  if (authUrl && publicOrigin) {
    try {
      if (new URL(authUrl).origin !== new URL(publicOrigin).origin) {
        errors.push("AUTH_URL must match KM_PUBLIC_ORIGIN");
      }
    } catch {
      errors.push("AUTH_URL and KM_PUBLIC_ORIGIN must be absolute URLs");
    }
  }
  return errors;
}

const authErrors = googleAuthErrors();

if (dryRun) {
  console.log(JSON.stringify({
    build: true,
    buildScript,
    migrate,
    migrationUrlSource,
    authProvider: identityProvider,
    authErrors,
  }));
  process.exit(authErrors.length > 0 || (migrate && !migrateUrl) ? 1 : 0);
}

if (authErrors.length > 0) {
  console.error(`vercel-build: invalid Google auth configuration: ${authErrors.join(", ")}`);
  process.exit(1);
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) {
    console.error(`vercel-build: ${result.error.message}`);
    process.exit(1);
  }
  return result.status ?? 1;
}

// Build first: the old deployment keeps serving until promotion, and a failed
// build must leave the schema untouched. Migrations run only after a green
// build, so the "new schema + old code" window is migrate → promote.
console.log("vercel-build: building.");
const buildStatus = run(process.execPath, [buildScript]);
if (buildStatus !== 0) process.exit(buildStatus);

if (!migrate) {
  const reason = isProduction ? "KM_MIGRATE_ON_BUILD=0" : `VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}`;
  console.log(`vercel-build: migrations skipped (${reason}).`);
  process.exit(0);
}

if (!migrateUrl) {
  console.error("vercel-build: production migration requested but neither KM_DB_MIGRATE_URL nor KM_DB_URL is set.");
  process.exit(1);
}
if (!directUrl) {
  console.warn("vercel-build: KM_DB_MIGRATE_URL is unset; falling back to KM_DB_URL. Session locks may not hold through a pooler.");
}
console.log("vercel-build: applying database migrations.");
process.exit(run("npm", ["run", "db:migrate"], { ...process.env, KM_DB_URL: migrateUrl }));
