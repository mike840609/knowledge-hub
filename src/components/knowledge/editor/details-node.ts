type ElementData = { hName?: string; hProperties?: { open?: boolean } };
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { $node, $prose, $remark } from '@milkdown/kit/utils';
import { remarkDetailsSubset } from '@/shared/markdown/remark-html-subset';
import { escapeSummaryText } from './details-toggle';

export const detailsRemark = $remark('khDetails', () => remarkDetailsSubset);
const details = $node('details', () => ({
  group: 'block', content: 'details_summary details_body', defining: true,
  attrs: { open: { default: false } },
  parseDOM: [{ tag: 'details', getAttrs: dom => ({ open: (dom as HTMLDetailsElement).open }) }],
  toDOM: node => ['details', { class: 'kh-editor-details', ...(node.attrs.open ? { open: '' } : {}) }, 0],
  parseMarkdown: {
    match: node => node.type === 'khElement' && (node.data as ElementData | undefined)?.hName === 'details',
    runner: (state, node, type) => { state.openNode(type, { open: Boolean((node.data as ElementData | undefined)?.hProperties?.open) }).next(node.children).closeNode(); },
  },
  toMarkdown: {
    match: node => node.type.name === 'details',
    runner: (state, node) => {
      state.addNode('html', undefined, `${node.attrs.open ? '<details open>' : '<details>'}\n<summary>${escapeSummaryText(node.firstChild!.textContent)}</summary>`);
      state.next(node.lastChild!.content);
      state.addNode('html', undefined, '</details>');
    },
  },
}));
const summary = $node('details_summary', () => ({
  content: 'text*', marks: '', defining: true,
  parseDOM: [{ tag: 'summary' }],
  toDOM: () => ['summary', { class: 'kh-focus-ring', 'data-placeholder': 'Details' }, 0],
  parseMarkdown: {
    match: node => node.type === 'khElement' && (node.data as ElementData | undefined)?.hName === 'summary',
    runner: (state, node, type) => {
      state.openNode(type);
      const text = (node.children ?? []).map(child => String(child.value ?? "")).join("");
      if (text) state.addText(text);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: node => node.type.name === 'details_summary',
    runner: (state, node) => { state.addNode('html', undefined, `<summary>${escapeSummaryText(node.textContent)}</summary>`); },
  },
}));
const body = $node('details_body', () => ({
  content: 'block+', defining: true,
  parseDOM: [{ tag: 'div[data-details-body]' }],
  toDOM: () => ['div', { 'data-details-body': '' }, 0],
  parseMarkdown: {
    match: node => node.type === 'khElement' && (node.data as ElementData | undefined)?.hName === 'div',
    runner: (state, node, type) => {
      state.openNode(type);
      if (node.children?.length) state.next(node.children);
      else state.addNode(state.schema.nodes.paragraph);
      state.closeNode();
    },
  },
  toMarkdown: { match: node => node.type.name === 'details_body', runner: (state, node) => { state.next(node.content); } },
}));

// The native disclosure owns its visual state; reflect the user's click in the document so
// save/undo agree with it. Clicking summary text edits it; only its chevron toggles.
const interaction = $prose(() => new Plugin({
  props: {
    handleDOMEvents: {
      mousedown(view, event) {
        const target = event.target as HTMLElement;
        const summary = target.closest("summary");
        const disclosure = summary?.parentElement;
        if (event.button !== 0 || !summary || disclosure?.tagName !== "DETAILS" || !view.dom.contains(summary)) return false;
        if (event.clientX > summary.getBoundingClientRect().left + 20) return false;
        event.preventDefault();
        if (!view.editable) return true;
        const start = view.posAtDOM(disclosure, 0) - 1;
        const node = view.state.doc.nodeAt(start);
        if (node?.type.name !== "details") return false;
        const tr = view.state.tr.setNodeMarkup(start, undefined, { open: !node.attrs.open });
        tr.setSelection(TextSelection.near(tr.doc.resolve(start + 2)));
        view.dispatch(tr);
        view.focus();
        return true;
      },
      click(view, event) {
        const summary = (event.target as HTMLElement).closest("summary");
        if (!summary || !view.dom.contains(summary)) return false;
        // Native click toggling would bypass the document and undo history.
        event.preventDefault();
        return true;
      },
    },
    handleKeyDown(view, event) {
      const { $from } = view.state.selection;
      if (!view.editable || $from.parent.type.name !== 'details_summary' || event.key !== 'Enter' || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return false;
      const start = $from.before($from.depth - 1);
      const node = $from.node($from.depth - 1);
      const tr = view.state.tr.setNodeMarkup(start, undefined, { open: true });
      tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1 + node.firstChild!.nodeSize + 2)));
      view.dispatch(tr.scrollIntoView());
      return true;
    },
  },
}));
export const detailsPlugins = [details, summary, body, interaction];
