// Browser-safe: the comment renderer imports this, so it must not reach node-only modules (review-mention.ts pulls in uuidv7).
import { linkify } from "@/lib/linkify";

/** A person a comment's `@name` may stand for. */
export type MentionedPerson = { name: string; nameEn: string | null; empId: string };
/** A run of comment text; `people` is set only on a mention occurrence, whose `text` is `@` + name. */
export type MentionPart = { text: string; people?: MentionedPerson[] };

/**
 * Where in `text` an `@` may start a mention: not after an ASCII letter, digit, `_` or `@`
 * (`請@王` and `(@Amy` do, `name@example` does not), and not inside a link as `linkify` draws one
 * (`https://medium.com/@john` is; in `https://x.test/a"@Ann` the link ended at `"`). The composer's
 * trigger, its pick count and this splitter share it. `linkify` runs once per text, not per `@`.
 */
export function mentionStarts(text: string): (at: number) => boolean {
  const links: [start: number, end: number][] = [];
  if (text.includes("://")) {
    let cursor = 0;
    for (const part of linkify(text)) {
      if (part.href) links.push([cursor, cursor + part.text.length]);
      cursor += part.text.length;
    }
  }
  return at => !(at > 0 && /[A-Za-z0-9_@]/.test(text[at - 1])) && !links.some(([start, end]) => start <= at && at < end);
}

/**
 * Splits text into plain runs and `@name` occurrences of the given people. The `@` must start a
 * mention (`mentionStarts`), the name must end the text or be followed by whitespace or
 * punctuation (the composer's whole-name rule), and the longest name wins. People sharing a name
 * share every occurrence. Joining the parts gives the text back. The renderer splits each run
 * between `linkify`'s links: such a run holds no link and never starts with an `@` the link left,
 * so it is judged as the whole body is.
 */
export function splitMentions(text: string, people: readonly MentionedPerson[]): MentionPart[] {
  const byName = new Map<string, MentionedPerson[]>();
  for (const person of people) byName.set(person.name, [...(byName.get(person.name) ?? []), person]);
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const parts: MentionPart[] = [];
  let plainFrom = 0;
  const starts = mentionStarts(text);
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    const name = names.find(n => text.startsWith(n, at + 1) && endsName(text[at + 1 + n.length]));
    if (name === undefined || !starts(at)) continue;
    if (at > plainFrom) parts.push({ text: text.slice(plainFrom, at) });
    parts.push({ text: `@${name}`, people: byName.get(name) });
    plainFrom = at + 1 + name.length;
    at = plainFrom - 1;
  }
  if (plainFrom < text.length) parts.push({ text: text.slice(plainFrom) });
  return parts;
}

const endsName = (next: string | undefined) => next === undefined || /[\s\p{P}]/u.test(next);
