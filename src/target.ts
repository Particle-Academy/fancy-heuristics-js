/**
 * Resolve what a click activated, as handles rather than page text.
 *
 * The v1 resolver climbed five ancestors looking for an id and, finding none,
 * read the fifth ancestor's `textContent`. On the showcase that was the whole
 * header, stored as "Fancy UI Kitv0.5DocsLearn…" because `textContent` joins
 * text with no separator. This resolver:
 *
 * 1. finds the closest interactive control (native control, ARIA control
 *    role) and stops there, with no fixed depth;
 * 2. takes `component` from react-fancy's `data-react-fancy-<x>` markers;
 * 3. takes `part` from a `data-<x>-control` / `data-<x>-part` attribute;
 * 4. takes `instance` from `data-heuristics-id` / `data-fancy-id` / `id`, only
 *    inside the component (never `data-testid`, which production builds drop);
 * 5. takes `name` from the control's accessible name only: `aria-label`,
 *    `aria-labelledby`, its own text if 60 characters or fewer, then `title`.
 *    A container's text is never used, and form values are never read.
 */
import type { EventTarget2 } from "./types.ts";

const MAX_NAME = 60;
const MAX_HANDLE = 128;
const MAX_TEXT_NODES = 200;

const FANCY_PREFIX = "data-react-fancy-";

/** Markers that say "this is a generic primitive", preferred last. */
const GENERIC_MARKERS = new Set(["action"]);

const CONTROL_ROLES = new Set([
  "button",
  "link",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "switch",
  "checkbox",
  "radio",
  "slider",
  "combobox",
  "textbox",
  "searchbox",
  "spinbutton",
  "treeitem",
]);

const FORM_FIELDS = new Set(["INPUT", "SELECT", "TEXTAREA"]);

/** The slice of the Element surface this module reads. */
interface ElementLike {
  tagName?: string;
  parentElement?: ElementLike | null;
  childNodes?: ArrayLike<NodeLike>;
  textContent?: string | null;
  getAttribute?(name: string): string | null;
  getAttributeNames?(): string[];
  attributes?: ArrayLike<{ name: string }>;
}

interface NodeLike {
  nodeType?: number;
  textContent?: string | null;
}

export interface ResolveTargetOptions {
  /** `"none"` drops accessible names. Default `"control"`. */
  labels?: "control" | "none";
}

export function resolveTarget(el: Element | null | undefined, opts: ResolveTargetOptions = {}): EventTarget2 | undefined {
  if (!el) return undefined;

  // The path from the clicked element up to (not including) body/html.
  const path: ElementLike[] = [];
  for (let n: ElementLike | null | undefined = el as unknown as ElementLike; n; n = n.parentElement) {
    const tag = upper(n.tagName);
    if (tag === "BODY" || tag === "HTML") break;
    path.push(n);
  }
  if (path.length === 0) return { component: "none" };

  const controlIndex = path.findIndex(isControl);
  const control = controlIndex >= 0 ? path[controlIndex] : undefined;
  const from = controlIndex >= 0 ? controlIndex : 0;

  // A part marker (e.g. data-streaming-control="play") means the element it
  // sits on is a primitive used as a part of a larger component, so the
  // component is the nearest marked element ABOVE the part.
  let partIndex = -1;
  let part: string | undefined;
  for (let i = 0; i < path.length; i++) {
    const p = partOf(path[i]!);
    if (p) {
      partIndex = i;
      part = p;
      break;
    }
  }

  let componentIndex = -1;
  if (partIndex >= 0) {
    componentIndex = findMarked(path, partIndex + 1);
    if (componentIndex < 0 && markersOf(path[partIndex]!).length) componentIndex = partIndex;
  } else {
    componentIndex = findMarked(path, from);
  }

  const out: EventTarget2 = {
    component: componentIndex >= 0 ? (pickMarker(markersOf(path[componentIndex]!)) ?? "none") : "none",
  };
  if (part) out.part = bound(part, MAX_HANDLE);

  // Instance: from the control (or the clicked element) up to the component
  // root, inclusive. Without a component, only the control itself.
  const last = componentIndex >= from ? componentIndex : from;
  for (let i = from; i <= last; i++) {
    const id = instanceOf(path[i]!);
    if (id) {
      out.instance = bound(id, MAX_HANDLE);
      break;
    }
  }

  if (control) {
    const role = roleOf(control);
    if (role) out.role = role;
    if (opts.labels !== "none") {
      const name = accessibleName(control);
      if (name) out.name = name;
    }
  }

  return out;
}

// ── helpers ────────────────────────────────────────────────────────────────

function upper(tag: string | undefined): string {
  return typeof tag === "string" ? tag.toUpperCase() : "";
}

function attr(el: ElementLike, name: string): string | null {
  try {
    return typeof el.getAttribute === "function" ? el.getAttribute(name) : null;
  } catch {
    return null;
  }
}

function attrNames(el: ElementLike): string[] {
  try {
    if (typeof el.getAttributeNames === "function") return el.getAttributeNames();
    if (el.attributes) return Array.from(el.attributes, (a) => a.name);
  } catch {
    /* fall through */
  }
  return [];
}

function isControl(el: ElementLike): boolean {
  const tag = upper(el.tagName);
  if (tag === "BUTTON" || tag === "SUMMARY" || FORM_FIELDS.has(tag)) return true;
  if (tag === "A" && attr(el, "href") !== null) return true;
  const role = attr(el, "role");
  return role !== null && CONTROL_ROLES.has(role);
}

function markersOf(el: ElementLike): string[] {
  const out: string[] = [];
  for (const n of attrNames(el)) {
    if (n.startsWith(FANCY_PREFIX) && n.length > FANCY_PREFIX.length) out.push(n.slice(FANCY_PREFIX.length));
  }
  return out;
}

function pickMarker(markers: string[]): string | undefined {
  return markers.find((m) => !GENERIC_MARKERS.has(m)) ?? markers[0];
}

function findMarked(path: ElementLike[], from: number): number {
  for (let i = from; i < path.length; i++) {
    if (markersOf(path[i]!).length) return i;
  }
  return -1;
}

function partOf(el: ElementLike): string | undefined {
  for (const n of attrNames(el)) {
    if (!n.startsWith("data-") || n.startsWith(FANCY_PREFIX)) continue;
    if (n.endsWith("-control") || n.endsWith("-part")) {
      const v = attr(el, n);
      if (v) return v;
    }
  }
  return undefined;
}

function instanceOf(el: ElementLike): string | undefined {
  return attr(el, "data-heuristics-id") || attr(el, "data-fancy-id") || attr(el, "id") || undefined;
}

function roleOf(el: ElementLike): string | undefined {
  const explicit = attr(el, "role");
  if (explicit) return explicit;
  switch (upper(el.tagName)) {
    case "BUTTON":
    case "SUMMARY":
      return "button";
    case "A":
      return "link";
    case "SELECT":
      return "combobox";
    case "TEXTAREA":
      return "textbox";
    case "INPUT": {
      const type = (attr(el, "type") ?? "text").toLowerCase();
      if (type === "checkbox" || type === "radio") return type;
      if (type === "range") return "slider";
      if (type === "button" || type === "submit" || type === "reset" || type === "image") return "button";
      return "textbox";
    }
  }
  return undefined;
}

function accessibleName(el: ElementLike): string | undefined {
  const aria = normalise(attr(el, "aria-label"));
  if (aria) return bound(aria, MAX_NAME);

  const labelledBy = attr(el, "aria-labelledby");
  if (labelledBy && typeof document !== "undefined" && document && typeof document.getElementById === "function") {
    const parts: string[] = [];
    for (const id of labelledBy.split(" ")) {
      if (!id) continue;
      const ref = document.getElementById(id) as unknown as ElementLike | null;
      if (ref) parts.push(ownText(ref));
    }
    const joined = normalise(parts.join(" "));
    if (joined) return bound(joined, MAX_NAME);
  }

  // Never read what a form field contains.
  if (!FORM_FIELDS.has(upper(el.tagName))) {
    const text = normalise(ownText(el));
    if (text && text.length <= MAX_NAME) return text;
  }

  const title = normalise(attr(el, "title"));
  return title ? bound(title, MAX_NAME) : undefined;
}

/**
 * The element's text with a space between child elements, so "Kit" and
 * "v0.5" in two spans read "Kit v0.5". Skips `aria-hidden` subtrees and stops
 * after a fixed number of nodes.
 */
function ownText(el: ElementLike): string {
  if (!el.childNodes) return el.textContent ?? "";
  const parts: string[] = [];
  let budget = MAX_TEXT_NODES;
  const walk = (node: ElementLike): void => {
    const kids = node.childNodes;
    if (!kids) return;
    for (let i = 0; i < kids.length && budget > 0; i++) {
      const k = kids[i] as NodeLike & ElementLike;
      budget--;
      if (k.nodeType === 3) {
        parts.push(k.textContent ?? "");
      } else if (k.nodeType === 1 && attr(k, "aria-hidden") !== "true") {
        parts.push(" ");
        walk(k);
        parts.push(" ");
      }
    }
  };
  walk(el);
  return parts.join("");
}

function normalise(s: string | null | undefined): string {
  return s ? s.replace(/\s+/g, " ").trim() : "";
}

function bound(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
