"use client";

import { usePathname, useSearchParams } from "next/navigation";

const SHARE_PATH = /^\/s\/([^/]+)/;

/**
 * The share not-found page's one line into the Hub (named-recipient share spec, "Where a NAMED share
 * is read"). Shown for every token, dead or named alike, so it says nothing about the link. The not-found
 * page gets no params, so the token comes from the path; a folder page's `?d=` goes along.
 * A plain anchor: the open route is protected, and a full navigation lets the Gateway sign the reader in.
 */
export function OpenInHubHint() {
  const pathname = usePathname();
  const documentId = useSearchParams()?.get("d");
  const token = pathname ? SHARE_PATH.exec(pathname)?.[1] : undefined;
  if (!token) return null;
  const href = `/s/${token}/open${documentId ? `?${new URLSearchParams({ d: documentId })}` : ""}`;
  return (
    <a href={href} className="rounded-md text-body text-kh-link underline underline-offset-4 kh-focus-ring">
      如果這是分享給你的，請在 Hub 中開啟
    </a>
  );
}
