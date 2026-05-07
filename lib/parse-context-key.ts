/** messageRequestContext:<composerId>:<bubbleId-or-sentinel> */
const MSG_CTX_RE = /^messageRequestContext:([^:]+):(.+)$/;

export interface MessageRequestContextIds {
  composerId: string;
  bubbleId: string;
}

export function parseMessageRequestContextKey(
  key: string,
): MessageRequestContextIds | null {
  const m = MSG_CTX_RE.exec(key);
  if (!m) return null;
  return { composerId: m[1], bubbleId: m[2] };
}

export function isWarmSubmitContextKey(key: string): boolean {
  return parseMessageRequestContextKey(key)?.bubbleId === "WARM_SUBMIT";
}
