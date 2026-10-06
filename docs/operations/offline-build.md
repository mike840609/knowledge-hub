# Offline production builds

Install dependencies before disconnecting:

```sh
npm ci
npm run build:offline
```

The offline command removes `.next` and runs a production build with operating-system network isolation. macOS uses `sandbox-exec`; Linux uses a network namespace through `unshare` (non-root users need passwordless `sudo` for that command). Unsupported platforms or unavailable isolation fail rather than running a build with network access. All build subprocesses inherit the isolation.

`npm run build` disables Next.js telemetry but does not restrict the network. Use `npm run build:offline` when network isolation is required. CI installs dependencies first and runs the build with network isolation.

Inter is included locally with its license. Dependencies must include the Next.js SWC binary for the build machine's OS and architecture. Install dependencies on that platform; do not copy `node_modules` from another platform. Missing compiler packages cannot be downloaded during the offline build.

This covers production compilation, not dependency installation, application runtime, or the entire CI workflow. `npm ci`, GitHub Actions setup, browser installation, and artifact uploads may require network access. Provision or cache those resources separately for a fully disconnected environment.
