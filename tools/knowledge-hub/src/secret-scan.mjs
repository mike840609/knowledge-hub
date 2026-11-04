// A safety net, not a guarantee: a few high-signal patterns plus the token
// this key is configured with. Only the rule name is ever reported.
const RULES = [
  ["pem-private-key", /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/],
  ["aws-access-key-id", /\bAKIA[0-9A-Z]{16}\b/],
  ["github-token", /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})/],
];

/** The first rule the text matches, or null. */
export function secretRule(text, configuredToken) {
  if (configuredToken && text.includes(configuredToken)) return "configured-export-token";
  for (const [name, pattern] of RULES) if (pattern.test(text)) return name;
  return null;
}
