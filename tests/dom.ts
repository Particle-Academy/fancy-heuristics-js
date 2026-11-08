/**
 * A tiny element tree for target-resolution tests. No DOM library: just enough
 * of the Element surface the collector reads (tagName, attributes,
 * parentElement, childNodes, textContent, id).
 *
 * `textContent` concatenates descendant text with NO separator, exactly like
 * the real DOM. That is what turned the showcase header into
 * "Fancy UI Kitv0.5DocsLearn…", so the fixtures here reproduce it faithfully.
 */

export interface FakeText {
  nodeType: 3;
  textContent: string;
  parentElement: FakeElement | null;
}

export class FakeElement {
  readonly nodeType = 1;
  readonly tagName: string;
  readonly attrs = new Map<string, string>();
  readonly childNodes: Array<FakeElement | FakeText> = [];
  parentElement: FakeElement | null = null;

  constructor(tag: string, attrs: Record<string, string> = {}) {
    this.tagName = tag.toUpperCase();
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
  }

  get id(): string {
    return this.attrs.get("id") ?? "";
  }

  getAttribute(name: string): string | null {
    return this.attrs.has(name) ? (this.attrs.get(name) as string) : null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  getAttributeNames(): string[] {
    return [...this.attrs.keys()];
  }

  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((c): c is FakeElement => c.nodeType === 1);
  }
}

type Child = FakeElement | string;

/** `h("button", { "data-react-fancy-button": "" }, "Sign in")` */
export function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): FakeElement {
  const el = new FakeElement(tag, attrs);
  for (const c of children) {
    if (typeof c === "string") {
      el.childNodes.push({ nodeType: 3, textContent: c, parentElement: el });
    } else {
      c.parentElement = el;
      el.childNodes.push(c);
    }
  }
  return el;
}

/** Depth-first search for the first element matching a predicate. */
export function find(root: FakeElement, pred: (el: FakeElement) => boolean): FakeElement {
  const stack: FakeElement[] = [root];
  while (stack.length) {
    const el = stack.shift() as FakeElement;
    if (pred(el)) return el;
    stack.push(...el.children);
  }
  throw new Error("fixture element not found");
}

/** Find by exact own text (a text node directly under the element). */
export function byText(root: FakeElement, text: string): FakeElement {
  return find(root, (el) => el.childNodes.some((c) => c.nodeType === 3 && c.textContent === text));
}

/**
 * The showcase header as it renders today: brand, version chip, primary nav,
 * a command-palette hint, a react-fancy Button "Sign in", then the mobile
 * nav. Nothing in it carries an id, so the old resolver climbed five levels
 * and used the whole header's text.
 */
export function showcaseHeader(): FakeElement {
  const navLink = (label: string): FakeElement => h("li", {}, h("a", { href: `/${label.toLowerCase()}` }, h("span", {}, label)));
  return h(
    "header",
    { class: "site-header" },
    h("div", {}, h("a", { href: "/" }, h("span", {}, "Fancy UI Kit")), h("span", {}, "v0.5")),
    h(
      "nav",
      {},
      h("ul", {}, ...["Docs", "Learn", "Packages", "Features", "Use Cases", "Inspiration", "Showcase", "Leaderboard"].map(navLink)),
    ),
    h(
      "div",
      {},
      h(
        "div",
        {},
        h(
          "div",
          {},
          h("kbd", {}, "Ctrl"),
          h("kbd", {}, "K"),
          h(
            "button",
            { type: "button", "data-react-fancy-button": "", "data-react-fancy-action": "" },
            h("span", { "data-react-fancy-button-label": "" }, "Sign in"),
          ),
        ),
      ),
    ),
    h("div", {}, h("span", {}, "Docs"), h("span", {}, "Packages"), h("span", {}, "Features"), h("span", {}, "More"), h("span", {}, "Sign in")),
  );
}

/** react-fancy StreamingAudio as rendered in the showcase radio drawer. */
export function streamingAudio(): FakeElement {
  return h(
    "div",
    {
      id: "site-radio-player",
      role: "region",
      "aria-label": "Player",
      "data-react-fancy-streaming-audio": "",
      "data-streaming-station": "lofi",
    },
    h("div", {}, h("span", {}, "Lofi Radio"), h("span", {}, "Live"), h("span", {}, "Now playing: Something Long")),
    h(
      "div",
      {},
      h(
        "button",
        { type: "button", "aria-label": "Play", "data-streaming-control": "play", "data-react-fancy-button": "", "data-react-fancy-action": "" },
        h("svg", { "data-react-fancy-icon": "" }),
      ),
      h("input", { type: "range", "aria-label": "Volume", value: "80", "data-streaming-control": "volume" }),
    ),
  );
}
