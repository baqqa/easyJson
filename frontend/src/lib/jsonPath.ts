export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];

export type PathSegment = string | number;
export type JsonPath = PathSegment[];

export type ParseError = {
  message: string;
  position?: number;
  line?: number;
  col?: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  // JSON editor values are JSON-only, so stringify/parse cloning is safe.
  // (structuredClone can be used too, but this keeps compatibility.)
  return JSON.parse(JSON.stringify(value)) as T;
}

function indexToLineCol(text: string, index: number) {
  // JSON.parse reports a character position (0-based) in many JS engines.
  // We convert that to line/col for a better UX.
  const before = text.slice(0, index);
  const lines = before.split(/\r?\n/);
  const line = lines.length; // 1-based
  const col = lines[lines.length - 1].length + 1; // 1-based
  return { line, col };
}

export function parseJsonWithLocation(text: string): { ok: true; value: unknown } | { ok: false; error: ParseError } {
  try {
    const value = JSON.parse(text);
    return { ok: true, value };
  } catch (e) {
    const err = e as Error & { message?: string };
    const message = err.message || "Invalid JSON";
    // V8 message often includes "... at position 123"
    const m = message.match(/position\s+(\d+)/i);
    const position = m ? Number(m[1]) : undefined;
    const loc = typeof position === "number" ? indexToLineCol(text, position) : undefined;
    const parseErr: ParseError = { message };
    if (typeof position === "number") parseErr.position = position;
    if (loc) {
      parseErr.line = loc.line;
      parseErr.col = loc.col;
    }
    return { ok: false, error: parseErr };
  }
}

export function formatJson(value: unknown, indent = 2): string {
  return JSON.stringify(value, null, indent);
}

export function getAtPath(root: unknown, path: JsonPath): unknown {
  let cur = root as unknown;
  for (const seg of path) {
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) throw new TypeError("Expected array while traversing path");
      cur = cur[seg];
    } else {
      if (!isPlainObject(cur)) throw new TypeError("Expected object while traversing path");
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

export function setAtPathImmutable(root: unknown, path: JsonPath, value: unknown): unknown {
  if (path.length === 0) return value;

  const [head, ...tail] = path;
  if (typeof head === "number") {
    if (!Array.isArray(root)) throw new TypeError("Expected array at path parent");
    const next = root.slice();
    next[head] = setAtPathImmutable(root[head], tail, value);
    return next;
  }

  if (!isPlainObject(root)) throw new TypeError("Expected object at path parent");
  return {
    ...(root as Record<string, unknown>),
    [head]: setAtPathImmutable((root as Record<string, unknown>)[head], tail, value),
  };
}

export function deleteAtPathImmutable(root: unknown, path: JsonPath): unknown {
  if (path.length === 0) return {}; // reset root

  const [head, ...tail] = path;
  if (tail.length === 0) {
    if (typeof head === "number") {
      if (!Array.isArray(root)) throw new TypeError("Expected array at delete parent");
      const next = root.slice();
      next.splice(head, 1);
      return next;
    }
    if (!isPlainObject(root)) throw new TypeError("Expected object at delete parent");
    const next = { ...(root as Record<string, unknown>) };
    delete next[head];
    return next;
  }

  const existingChild = getAtPath(root, [head, ...[]]);
  // existingChild isn't actually used; keep traversal purely for types safety
  void existingChild;

  if (typeof head === "number") {
    if (!Array.isArray(root)) throw new TypeError("Expected array at delete parent");
    const next = root.slice();
    next[head] = deleteAtPathImmutable(root[head], tail);
    return next;
  }

  if (!isPlainObject(root)) throw new TypeError("Expected object at delete parent");
  return {
    ...(root as Record<string, unknown>),
    [head]: deleteAtPathImmutable((root as Record<string, unknown>)[head], tail),
  };
}

export function insertIntoArrayImmutable(arrayRoot: unknown, arrayPath: JsonPath, index: number, value: unknown): unknown {
  const arr = getAtPath(arrayRoot, arrayPath);
  if (!Array.isArray(arr)) throw new TypeError("Target is not an array");
  const next = arr.slice();
  const safeIndex = Math.max(0, Math.min(index, next.length));
  next.splice(safeIndex, 0, value);
  return setAtPathImmutable(arrayRoot, arrayPath, next);
}

export function insertDefaultObjectAtArrayImmutable(arrayRoot: unknown, arrayPath: JsonPath, index: number): unknown {
  return insertIntoArrayImmutable(arrayRoot, arrayPath, index, {});
}

export function duplicateArrayItemImmutable(arrayRoot: unknown, arrayPath: JsonPath, index: number): unknown {
  const arr = getAtPath(arrayRoot, arrayPath);
  if (!Array.isArray(arr)) throw new TypeError("Target is not an array");
  if (index < 0 || index >= arr.length) throw new RangeError("Index out of bounds");
  const next = arr.slice();
  next.splice(index + 1, 0, deepClone(arr[index]));
  return setAtPathImmutable(arrayRoot, arrayPath, next);
}

export function renameKeyAtPathImmutable(
  root: unknown,
  path: JsonPath,
  newKey: string
): unknown {
  if (path.length === 0) return root;

  const last = path[path.length - 1];
  if (typeof last !== "string") {
    // Only object keys can be renamed; array indices (numbers) are not supported.
    return root;
  }
  if (last === newKey) return root;

  const parentPath = path.slice(0, -1);

  if (parentPath.length === 0) {
    if (!isPlainObject(root)) throw new TypeError("Expected object at rename parent");
    const next = { ...(root as Record<string, unknown>) };
    const value = (next as Record<string, unknown>)[last];
    delete (next as Record<string, unknown>)[last];
    (next as Record<string, unknown>)[newKey] = value;
    return next;
  }

  const parentVal = getAtPath(root, parentPath);
  if (!isPlainObject(parentVal)) throw new TypeError("Expected object at rename parent");

  const nextParent = { ...(parentVal as Record<string, unknown>) };
  const value = nextParent[last];
  delete nextParent[last];
  nextParent[newKey] = value;

  return setAtPathImmutable(root, parentPath, nextParent);
}

