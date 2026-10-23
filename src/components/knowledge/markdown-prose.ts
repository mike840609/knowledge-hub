/**
 * How rendered Markdown is typeset. The reader (`MarkdownRenderer`) and the
 * composer's rendered editor both put these on the element that holds the
 * content, so they cannot drift apart. Composer spec §11.4.
 *
 * Running text is held to the measure while tables and code keep the whole column, and the
 * headings step 24 / 20 / 17 / 15, none smaller than the text under it (reader-measure spec).
 * Inline code's chip is for inline code only: on a block's <code> its padding indented the first line.
 */
export const MARKDOWN_PROSE =
  "min-w-0 text-reading text-kh-text [&_:is(p,ul,ol,dl,blockquote,h1,h2,h3,h4,h5,h6)]:max-w-measure [&_:is(h1,h2,h3,h4,h5,h6)]:scroll-mt-16 [&_h1]:mt-6 [&_h1]:text-display [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-6 [&_h2]:text-heading [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-5 [&_h3]:text-subheading [&_h3]:font-semibold [&_h4]:mt-4 [&_h4]:text-reading [&_h4]:font-semibold [&_h5]:mt-4 [&_h5]:text-reading [&_h5]:font-semibold [&_h6]:mt-4 [&_h6]:text-reading [&_h6]:font-semibold [&_h6]:text-kh-text-muted [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_td]:border-t [&_td]:border-kh-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:bg-kh-bg-subtle [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_tr]:border-kh-border [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:border-kh-border [&_blockquote]:pl-4 [&_blockquote]:text-kh-text-muted [&_:not(pre)>code]:rounded-md [&_:not(pre)>code]:bg-kh-bg-subtle [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-body-sm [&_hr]:my-6 [&_hr]:border-kh-border";
