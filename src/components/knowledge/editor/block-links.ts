import { codeBlockSchema, paragraphSchema } from "@milkdown/kit/preset/commonmark";
import { extendListItemSchemaForTask } from "@milkdown/kit/preset/gfm";
import { Plugin } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { NodeSchema, MarkdownNode } from "@milkdown/kit/transformer";
import { blockLinkMarker, isBlockId } from "@/shared/markdown/remark-block-links";

function markdownId(node: MarkdownNode): string | null {
  const id = (node.data as { hProperties?: { id?: unknown } } | undefined)?.hProperties?.id;
  return isBlockId(id) ? id : null;
}

function anchoredBlock(spec: NodeSchema, parse: NodeSchema["parseMarkdown"]["runner"]): NodeSchema {
  return {
    ...spec,
    attrs: { ...spec.attrs, blockId: { default: null } },
    parseMarkdown: { ...spec.parseMarkdown, runner: parse },
    toMarkdown: {
      ...spec.toMarkdown,
      runner: (state, node) => {
        if (isBlockId(node.attrs.blockId)) state.addNode("html", undefined, blockLinkMarker(node.attrs.blockId));
        spec.toMarkdown.runner(state, node);
      },
    },
  };
}

export const linkedParagraph = paragraphSchema.extendSchema(previous => ctx => {
  const spec = previous(ctx);
  return anchoredBlock(spec, (state, node, type) => {
    const blockId = markdownId(node);
    if (!blockId) return spec.parseMarkdown.runner(state, node, type);
    state.openNode(type, { blockId }).next(node.children).closeNode();
  });
});

export const linkedCodeBlock = codeBlockSchema.extendSchema(previous => ctx => {
  const spec = previous(ctx);
  return anchoredBlock(spec, (state, node, type) => {
    const blockId = markdownId(node);
    if (!blockId) return spec.parseMarkdown.runner(state, node, type);
    state.openNode(type, { blockId, language: node.lang ?? "" });
    if (typeof node.value === "string" && node.value) state.addText(node.value);
    state.closeNode();
  });
});

export const linkedListItem = extendListItemSchemaForTask.extendSchema(previous => ctx => {
  const spec = previous(ctx);
  return {
    ...spec,
    attrs: { ...spec.attrs, blockId: { default: null } },
    parseMarkdown: {
      ...spec.parseMarkdown,
      runner(state, node, type) {
        const blockId = markdownId(node);
        if (!blockId) return spec.parseMarkdown.runner(state, node, type);
        const label = node.label != null ? `${node.label}.` : "•";
        const listType = node.label != null ? "ordered" : "bullet";
        const checked = node.checked == null ? null : Boolean(node.checked);
        state.openNode(type, { blockId, label, listType, checked, spread: node.spread ?? true }).next(node.children).closeNode();
      },
    },
    toMarkdown: {
      ...spec.toMarkdown,
      runner(state, node) {
        const { blockId, label, listType, spread, checked } = node.attrs;
        if (!isBlockId(blockId)) return spec.toMarkdown.runner(state, node);
        const paragraph = node.firstChild!;
        const trailingBreak = paragraph.lastChild?.type.name === "hardbreak" ? paragraph.lastChild.nodeSize : 0;
        const content = paragraph.content.cut(0, paragraph.content.size - trailingBreak);
        state.openNode("listItem", undefined, { label, listType, spread, checked });
        state.openNode("paragraph");
        if (content.size) state.next(content);
        else state.addNode("html", undefined, "<br />");
        state.addNode("html", undefined, blockLinkMarker(blockId)).closeNode();
        state.next(node.content.cut(paragraph.nodeSize)).closeNode();
      },
    },
  };
});

export const blockLinkPlugin = $prose(() => new Plugin({
  props: {
    decorations(state) {
      const ids: Decoration[] = [];
      state.doc.descendants((node, pos) => {
        if (isBlockId(node.attrs.blockId)) ids.push(Decoration.node(pos, pos + node.nodeSize, { id: node.attrs.blockId }));
      });
      return ids.length ? DecorationSet.create(state.doc, ids) : null;
    },
  },
  // ProseMirror can carry attrs to both sides of a split. Keep the existing target, using the
  // previous node start to distinguish it from any newly generated fragment.
  appendTransaction(transactions, previous, state) {
    if (!transactions.some(tr => tr.docChanged)) return null;
    const links = new Map<string, number[]>();
    state.doc.descendants((node, pos) => {
      if (isBlockId(node.attrs.blockId)) {
        const positions = links.get(node.attrs.blockId) ?? [];
        positions.push(pos);
        links.set(node.attrs.blockId, positions);
      }
    });
    const duplicates = [...links].filter(([, positions]) => positions.length > 1);
    if (!duplicates.length) return null;
    const originals = new Map<string, number>();
    previous.doc.descendants((node, pos) => {
      if (isBlockId(node.attrs.blockId)) originals.set(node.attrs.blockId, transactions.reduce((at, tr) => tr.mapping.map(at), pos));
    });
    const tr = state.tr;
    for (const [id, positions] of duplicates) {
      const original = originals.get(id);
      const keep = original !== undefined && positions.includes(original) ? original : positions[0];
      for (const pos of positions) if (pos !== keep) {
        const node = tr.doc.nodeAt(pos)!;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: null });
      }
    }
    return tr;
  },
}));
