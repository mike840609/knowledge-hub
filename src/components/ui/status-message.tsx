import type { ReactNode } from "react";

/**
 * The shape every error and not-found state takes: a heading, one line of
 * explanation, and an optional action. It exists so that the boundaries added
 * for `/search`, `/sources` and `/settings` cannot each invent their own
 * spelling the way the knowledge boundary and the document not-found page had
 * already begun to.
 *
 * It sits in the reading column so the message lines up with the content it
 * replaced, rather than introducing another container width.
 */
export function StatusMessage({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="kh-reading-column py-16">
      <h1 className="text-heading font-semibold text-kh-text">{title}</h1>
      <p className="mt-2 text-body text-kh-text-muted">{description}</p>
      {action ? <div className="mt-6 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}
