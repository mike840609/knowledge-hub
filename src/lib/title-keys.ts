/**
 * Whether the caret of a wrapping title `<textarea>` is on its last visual line. The text before the
 * caret is laid out in a clone of the field: when it is as tall as the whole text, no line is below.
 */
export function caretOnLastLine(field: HTMLTextAreaElement): boolean {
  if (field.selectionStart !== field.selectionEnd) return false;
  if (field.selectionStart >= field.value.length) return true;
  const clone = field.cloneNode(false) as HTMLTextAreaElement;
  const style = getComputedStyle(field);
  clone.removeAttribute("id");
  clone.setAttribute("aria-hidden", "true");
  clone.tabIndex = -1;
  clone.style.cssText = `${style.cssText};position:absolute;visibility:hidden;pointer-events:none;height:0;min-height:0;overflow:hidden;width:${field.clientWidth}px`;
  field.parentElement?.appendChild(clone);
  try {
    clone.value = field.value;
    const total = clone.scrollHeight;
    clone.value = field.value.slice(0, field.selectionStart);
    return clone.scrollHeight >= total;
  } finally {
    clone.remove();
  }
}
