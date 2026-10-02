/** Geometry may be arbitrary; type, rhythm and surface tokens may not. */
export const designContractRule = {
  meta: { type: "problem", schema: [], messages: {
    token: "Use a named design token instead of {{utility}} (design contract §3).",
    field: "Use Input, Select or Textarea. Purpose-built editor/search fields require a documented exception (design contract §3).",
  } },
  create(context) {
    const check = (node, value) => {
      if (typeof value !== "string") return;
      const pattern = /\b(?:text|rounded(?:-[trblse]{1,2})?|shadow|duration|ease|p[trblxyse]?|m[trblxyse]?|gap(?:-[xy])?|space-[xy])-\[[^\]]+\]/g;
      for (const match of value.matchAll(pattern)) context.report({ node, messageId: "token", data: { utility: match[0] } });
    };
    const fieldExceptions = [
      "/components/ui/input.tsx", "/components/ui/select.tsx", "/components/ui/textarea.tsx",
      // Unframed text surfaces belonging to a document, palette or tree rather than a form field.
      "/components/knowledge/document-composer.tsx", "/components/search/quick-search.tsx",
      "/components/knowledge/tree-filter.tsx", "/components/knowledge/move-dialog.tsx",
    ];
    return {
      Literal(node) { check(node, node.value); },
      TemplateElement(node) { check(node, node.value.raw); },
      JSXOpeningElement(node) {
        if (!["input", "select", "textarea"].includes(node.name.name)) return;
        if (fieldExceptions.some(path => context.filename.replaceAll("\\", "/").endsWith(path))) return;
        const attributes = node.attributes.filter(attr => attr.type === "JSXAttribute");
        if (attributes.some(attr => attr.name.name === "hidden" || (attr.name.name === "type" && ["checkbox", "radio"].includes(attr.value?.value)))) return;
        context.report({ node, messageId: "field" });
      },
    };
  },
};
