/**
 * How rendered Markdown is typeset. The reader (`MarkdownRenderer`) and the
 * composer's rendered editor both put these on the element that holds the
 * content, so they cannot drift apart. Composer spec §11.4.
 */
export const MARKDOWN_PROSE =
  "min-w-0 text-reading text-kh-text [&_h1]:mt-6 [&_h1]:text-display [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-6 [&_h2]:text-heading [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-5 [&_h3]:text-title [&_h3]:font-semibold [&_h4]:mt-4 [&_h4]:text-body [&_h4]:font-semibold [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_td]:border-t [&_td]:border-kh-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:bg-kh-bg-subtle [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_tr]:border-kh-border [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:border-kh-border [&_blockquote]:pl-4 [&_blockquote]:text-kh-text-muted [&_code]:rounded-md [&_code]:bg-kh-bg-subtle [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-body-sm [&_hr]:my-6 [&_hr]:border-kh-border";
