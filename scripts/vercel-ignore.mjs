// Vercel runs this before installing dependencies. Exit 0 cancels the build,
// exit 1 continues. Preview deployments have no database credentials and would
// deploy successfully and then 500 on every page, so only production builds.
const env = process.env.VERCEL_ENV;
if (env && env !== "production") {
  console.log(`vercel-ignore: VERCEL_ENV=${env}; skipping build.`);
  process.exit(0);
}
console.log(`vercel-ignore: ${env ? `VERCEL_ENV=${env}` : "no VERCEL_ENV"}; building.`);
process.exit(1);
