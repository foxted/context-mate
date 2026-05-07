export type BucketKind =
  | "array"
  | "object"
  | "string"
  | "number"
  | "boolean"
  | "null";

export interface BucketItem {
  label: string;
  bytes: number;
}

export interface Bucket {
  key: string;
  bytes: number;
  kind: BucketKind;
  /** Length for arrays, key count for objects, character count for strings. */
  count?: number;
  /** Per-item byte breakdown, only populated for arrays. */
  items?: BucketItem[];
}

export interface PayloadSummary {
  /** Sum of JSON.stringify byte cost of every top-level value. Slightly less than the row's raw byte length because it excludes the outer braces, commas, and key names. */
  bucketBytes: number;
  buckets: Bucket[];
}

const LABEL_KEYS = [
  "relativeWorkspacePath",
  "path",
  "fsPath",
  "filePath",
  "uri",
  "url",
  "name",
  "title",
  "label",
  "id",
  "composerId",
  "key",
] as const;

const MAX_LABEL_LEN = 80;

export function redactPathsInJsonString(raw: string): string {
  const pathLike =
    /(\/Users\/[^"'\\\s]+|\/home\/[^"'\\\s]+|[A-Za-z]:\\[^"'\\\s]+)/g;
  return raw.replace(pathLike, "[path]");
}

function byteSize(value: unknown): number {
  if (value === undefined) return 0;
  const json = JSON.stringify(value);
  if (json === undefined) return 0;
  return Buffer.byteLength(json, "utf8");
}

function truncate(s: string, max = MAX_LABEL_LEN): string {
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function pickLabel(value: unknown, index: number): string {
  if (typeof value === "string") {
    const trimmed = value.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (parsed !== null && typeof parsed === "object") {
          return pickLabel(parsed, index);
        }
      } catch {
        /* not JSON, fall through */
      }
    }
    return truncate(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const k of LABEL_KEYS) {
      const candidate = obj[k];
      if (typeof candidate === "string" && candidate.length > 0) {
        return truncate(candidate);
      }
    }
    const keys = Object.keys(obj);
    if (keys.length > 0) {
      return `{${keys.slice(0, 3).join(",")}${keys.length > 3 ? ",..." : ""}}`;
    }
  }
  return `[${index}]`;
}

function drillArray(arr: unknown[]): BucketItem[] {
  const items: BucketItem[] = arr.map((value, index) => ({
    label: pickLabel(value, index),
    bytes: byteSize(value),
  }));
  items.sort((a, b) => b.bytes - a.bytes);
  return items;
}

function kindOf(value: unknown): BucketKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "null";
}

function countOf(value: unknown): number | undefined {
  if (Array.isArray(value)) return value.length;
  if (value !== null && typeof value === "object") {
    return Object.keys(value as object).length;
  }
  if (typeof value === "string") return value.length;
  return undefined;
}

export function summarizeParsedRecord(
  record: Record<string, unknown>,
): PayloadSummary | null {
  const buckets: Bucket[] = [];
  let bucketBytes = 0;

  for (const [key, value] of Object.entries(record)) {
    const bytes = byteSize(value);
    bucketBytes += bytes;
    const bucket: Bucket = {
      key,
      bytes,
      kind: kindOf(value),
    };
    const count = countOf(value);
    if (count !== undefined) bucket.count = count;
    // drillArray is expensive (JSON.stringify per element) and items are not
    // included in the dashboard API response — skip during normal ingestion.
    buckets.push(bucket);
  }

  buckets.sort((a, b) => b.bytes - a.bytes);
  return { bucketBytes, buckets };
}

export function summarizeJsonPayload(jsonStr: string): PayloadSummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr) as unknown;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return summarizeParsedRecord(parsed as Record<string, unknown>);
}
