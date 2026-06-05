/**
 * Session identity. One id per tab/session, persisted in `sessionStorage` so a
 * reload keeps the same id but a fresh tab starts a new one. Generated without
 * `Math.random` where the platform allows (`crypto.randomUUID`), falling back to
 * `crypto.getRandomValues`, then a last-resort time+counter id.
 */

const SESSION_KEY = "fancy-heuristics:sid";

/** Minimal storage surface — lets tests inject a shim without a full DOM. */
export interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let fallbackCounter = 0;

/** Generate a fresh session id, preferring crypto over Math.random. */
export function generateSessionId(): string {
  const c: Crypto | undefined =
    typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;

  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }

  if (c && typeof c.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    // RFC-4122-ish v4 layout (best effort without randomUUID).
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex: string[] = [];
    for (let i = 0; i < 16; i++) hex.push(bytes[i]!.toString(16).padStart(2, "0"));
    return (
      hex.slice(0, 4).join("") +
      "-" +
      hex.slice(4, 6).join("") +
      "-" +
      hex.slice(6, 8).join("") +
      "-" +
      hex.slice(8, 10).join("") +
      "-" +
      hex.slice(10, 16).join("")
    );
  }

  // Last resort — deterministic-ish, no Math.random. Good enough to disambiguate.
  fallbackCounter = (fallbackCounter + 1) >>> 0;
  return `fh-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}

/**
 * Read the persisted session id, generating + persisting one if absent. A
 * `SessionStore` may be injected (tests); otherwise `sessionStorage` is used,
 * and if even that is unavailable the id is generated per call (no persistence).
 */
export function resolveSessionId(store?: SessionStore): string {
  const s = store ?? safeSessionStorage();
  if (!s) return generateSessionId();

  try {
    const existing = s.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh = generateSessionId();
    s.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return generateSessionId();
  }
}

function safeSessionStorage(): SessionStore | undefined {
  try {
    const ss = (globalThis as { sessionStorage?: SessionStore }).sessionStorage;
    if (!ss) return undefined;
    // Touch it — some environments throw on access (privacy mode).
    ss.getItem(SESSION_KEY);
    return ss;
  } catch {
    return undefined;
  }
}

export { SESSION_KEY };
