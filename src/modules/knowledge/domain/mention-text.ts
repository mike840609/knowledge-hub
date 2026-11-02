// Browser-safe: the comment renderer imports this, so it must not reach node-only modules (review-mention.ts pulls in uuidv7).
/** A person a comment's `@name` may stand for. */
export type MentionedPerson = { name: string; nameEn: string | null; empId: string };
/** A run of comment text; `people` is set only on a mention occurrence, whose `text` is `@` + name. */
export type MentionPart = { text: string; people?: MentionedPerson[] };

/**
 * Whether the `@` at `at` may start a mention: it does not follow an ASCII letter, digit, `_` or
 * `@` (`請@王` and `(@Amy` do, `name@example` does not), and it is not inside a URL
 * (`https://medium.com/@john`). The composer's trigger, its pick count and this splitter share it.
 */
export function startsMention(text: string, at: number): boolean {
  if (at > 0 && /[A-Za-z0-9_@]/.test(text[at - 1])) return false;
  // Inside a URL when the last `://` before it has no whitespace after it. Native searches only:
  // a regex over everything before `at`, once per `@`, made a 3000-character comment take a second.
  const url = at >= 3 ? text.lastIndexOf("://", at - 3) : -1;
  return url === -1 || /\s/.test(text.slice(url, at));
}

/**
 * Splits text into plain runs and `@name` occurrences of the given people. The `@` must start a
 * mention (`startsMention`), judged against `before + text` so a renderer that splits a run cut
 * out of a longer body judges it as the server does; the name must end the text or be followed by
 * whitespace or punctuation (the composer's whole-name rule), and the longest name wins. People
 * sharing a name share every occurrence. Joining the parts gives the text back.
 */
export function splitMentions(text: string, people: readonly MentionedPerson[], before = ""): MentionPart[] {
  const byName = new Map<string, MentionedPerson[]>();
  for (const person of people) byName.set(person.name, [...(byName.get(person.name) ?? []), person]);
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const parts: MentionPart[] = [];
  let plainFrom = 0;
  const whole = before + text;
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    const name = names.find(n => text.startsWith(n, at + 1) && endsName(text[at + 1 + n.length]));
    if (name === undefined || !startsMention(whole, before.length + at)) continue;
    if (at > plainFrom) parts.push({ text: text.slice(plainFrom, at) });
    parts.push({ text: `@${name}`, people: byName.get(name) });
    plainFrom = at + 1 + name.length;
    at = plainFrom - 1;
  }
  if (plainFrom < text.length) parts.push({ text: text.slice(plainFrom) });
  return parts;
}

const endsName = (next: string | undefined) => next === undefined || /[\s\p{P}]/u.test(next);
