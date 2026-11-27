import { readdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { AGENT_SKILLS } from "@/components/task-knowledge/agent-skills";

it("lists every skill the CLI installs, and no other", () => {
  const shipped = readdirSync(path.join(process.cwd(), "tools/knowledge-hub/agent"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "opencode").map((entry) => entry.name).sort();
  expect(AGENT_SKILLS.map((skill) => skill.name).sort()).toEqual(shipped);
});
