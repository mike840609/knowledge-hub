import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// `next dev` compiles src/instrumentation.ts for the edge runtime too. Production
// builds and every e2e run hide the failure, so the shape is checked here.
it("imports Node-only start-up code only inside a NEXT_RUNTIME === \"nodejs\" block", () => {
  const source = readFileSync("src/instrumentation.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  expect(source).toMatch(/if \(process\.env\.NEXT_RUNTIME === "nodejs"\) \{[^}]*import\(/);
  expect(source).not.toMatch(/NEXT_RUNTIME !== "nodejs"/);
  expect(source).not.toMatch(/^import .*server\/blob-store/m);
});
