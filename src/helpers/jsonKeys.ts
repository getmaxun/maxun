/**
 * Developer-friendly keys for the JSON download of captured data:
 * "Plan Name" -> "plan_name". 
 * "2026 Product" -> "2026_product"
 *
 * Only the downloaded file changes. Tables in the app keep the readable
 * names.
 * Stored runs keep the original labels; only API responses are converted.
 */

export function toSnakeCaseKey(label: string): string {
  const key = String(label ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .replace(/['’]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    // Letters of any script survive ("価格" stays "価格"); everything else becomes _.
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return key || 'field';
}

/**
 * One mapping for every row, so a column keeps the same key throughout.
 * Labels that would collide ("Price" and "price") get _2, _3 suffixes.
 */
function buildKeyMap(rows: Record<string, unknown>[]): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const row of rows) {
    for (const label of Object.keys(row)) {
      if (map.has(label)) continue;
      const base = toSnakeCaseKey(label);
      let key = base;
      for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
      used.add(key);
      map.set(label, key);
    }
  }
  return map;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Renames the keys of captured rows (an array of rows or a single row); values are unchanged. */
export function withSnakeCaseKeys<T>(data: T): T {
  const rows: Record<string, unknown>[] = Array.isArray(data)
    ? data.filter(isPlainObject)
    : isPlainObject(data) ? [data] : [];
  if (rows.length === 0) return data;

  const keyMap = buildKeyMap(rows);
  const rename = (row: unknown) => (isPlainObject(row)
    ? Object.fromEntries(Object.entries(row).map(([label, value]) => [keyMap.get(label) || label, value]))
    : row);

  return (Array.isArray(data) ? data.map(rename) : rename(data)) as T;
}

/**
 * Converts captured text/list output as stored on a run:
 * - grouped: { "Texts": [rows], "List 1": [rows] } -> each group's rows converted, group names kept
 * - flat: [rows] -> rows converted
 * - single row: { "Plan Name": "ABC" } -> converted
 */
export function withSnakeCaseCapturedKeys<T>(output: T): T {
  if (Array.isArray(output)) return withSnakeCaseKeys(output);
  if (!isPlainObject(output)) return output;

  // No array values means it's a single row of captured fields.
  if (!Object.values(output).some(Array.isArray)) return withSnakeCaseKeys(output);

  // Grouped: convert each group's rows, keep group names and any non-row entries as they are.
  return Object.fromEntries(Object.entries(output).map(([group, rows]) => [
    group, Array.isArray(rows) ? withSnakeCaseKeys(rows) : rows,
  ])) as T;
}

/** Copy of a run's serializableOutput with captured text/list row keys converted. */
export function withSnakeCaseOutput<T extends Record<string, any> | null | undefined>(serializableOutput: T): T {
  if (!isPlainObject(serializableOutput)) return serializableOutput;
  const output: Record<string, any> = { ...serializableOutput };
  if (output.scrapeSchema) output.scrapeSchema = withSnakeCaseCapturedKeys(output.scrapeSchema);
  if (output.scrapeList) output.scrapeList = withSnakeCaseCapturedKeys(output.scrapeList);
  return output as T;
}