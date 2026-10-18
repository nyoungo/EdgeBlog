/**
 * Inject raw HTML into the live document.
 *
 * `element.innerHTML = html` never executes <script> tags — the browser parses
 * them as inert. To make configured head/footer HTML (analytics snippets,
 * verification tags, embeds) actually work we parse the markup with a
 * <template>, re-create any <script> element, and append the nodes. Previously
 * injected nodes are tagged and removed first so the DOM stays in sync with the
 * current configuration.
 */

const MARKER = 'data-eb-injected';

function revive(node: Node): Node | null {
  // Drop whitespace-only text nodes produced by pretty-printed HTML.
  if (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').trim()) return null;

  if (node.nodeName === 'SCRIPT') {
    const src = node as HTMLScriptElement;
    const script = document.createElement('script');
    for (const attr of Array.from(src.attributes)) script.setAttribute(attr.name, attr.value);
    script.text = src.text;
    return script;
  }

  return node.cloneNode(true);
}

export function parseHtml(html: string): Node[] {
  const template = document.createElement('template');
  template.innerHTML = html;
  const nodes: Node[] = [];
  for (const child of Array.from(template.content.childNodes)) {
    const node = revive(child);
    if (node) nodes.push(node);
  }
  return nodes;
}

/** Replace the nodes we previously injected into `parent` with a fresh parse of `html`. */
export function injectInto(parent: HTMLElement, html: string): void {
  parent.querySelectorAll(`:scope > [${MARKER}]`).forEach((node) => node.remove());
  if (!html) return;
  for (const node of parseHtml(html)) {
    if (node.nodeType === Node.ELEMENT_NODE) (node as Element).setAttribute(MARKER, '');
    parent.appendChild(node);
  }
}
