/** Fixed trusted server personas. Browser inputs never select or modify these claims. */
export const PHASE3_PERSONAS = {
  owner: { suffix: "101", groups: ["phase3-creators"] },
  nonCreator: { suffix: "102", groups: [] },
  admin: { suffix: "103", groups: [] },
  editor: { suffix: "104", groups: [] },
  viewer: { suffix: "105", groups: [] },
  groupAdmin: { suffix: "106", groups: ["phase3-admins"] },
  groupEditor: { suffix: "107", groups: ["phase3-editors"] },
  mixedEditor: { suffix: "108", groups: ["phase3-viewers"] },
} as const;
export type Phase3Persona = keyof typeof PHASE3_PERSONAS;
export const phase3PersonaNames = Object.keys(PHASE3_PERSONAS) as Phase3Persona[];
export const PHASE3_TEAM_ID = "0199f300-0000-7000-8000-000000000001";
export const PHASE3_PROVIDER = "phase3-fixture";
export function phase3UserId(persona: Phase3Persona): string {
  return `0199f300-0000-7000-8000-000000000${PHASE3_PERSONAS[persona].suffix}`;
}
export function phase3Session(persona: Phase3Persona) {
  return {
    subject: `phase3-${persona}`, emp_id: `P3-${PHASE3_PERSONAS[persona].suffix}`,
    name: `Phase3 ${persona}`, org_code: "E2E", externalGroupIds: [...PHASE3_PERSONAS[persona].groups],
  };
}
export function phase3Origin(persona: Phase3Persona): string {
  return `http://127.0.0.1:${Number(process.env.KM_E2E_PORT ?? "3101") + 1 + phase3PersonaNames.indexOf(persona)}`;
}

/** Ordinary production build, deliberately lacking a trusted Company SSO reader. */
export function phase3UnconfiguredOrigin(): string {
  return `http://127.0.0.1:${Number(process.env.KM_E2E_PORT ?? "3101") + 1 + phase3PersonaNames.length}`;
}
