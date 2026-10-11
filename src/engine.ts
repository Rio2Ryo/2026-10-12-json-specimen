export type Mode = 'observed' | 'dominant';
export type Policy = { mode: Mode; required: 'all' | 'majority'; closed: boolean };
export const DEFAULT_POLICY: Policy = { mode: 'observed', required: 'all', closed: false };
// An absent type is intentional: {} is JSON Schema's unconstrained schema.
export type Schema = { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; additionalProperties?: boolean };
export type Field = { path: string; types: Record<string, number>; present: number; total: number; values: { index: number; present: boolean; type: string; value: unknown }[] };
export const DEMO: Record<string, unknown>[] = [
  { id: 101, profile: { name: '葵', timezone: 'Asia/Tokyo' }, tasks: [{ title: '見積書を確認', done: true }, { title: '発送予約', done: false }] },
  { id: 102, profile: { name: 'Leo', timezone: 'Europe/Paris' }, tasks: [{ title: 'Review invoice', done: false, due: '2026-10-15' }] },
  { id: 'guest-7', profile: { name: 'Mina' }, tasks: [] },
  { id: 104, profile: { name: 'Ren' } },
];
const own = (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const kind = (v: unknown): string => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
const escape = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');
const pointer = (parts: string[]) => parts.length ? '/' + parts.map(escape).join('/') : '';
const label = (path: string) => path || '""（ルート）';
function fail(path: string, message: string): never { throw new Error(`${label(path)}: ${message}`); }
const TYPE_ORDER = ['object', 'array', 'number', 'string', 'boolean', 'null'];

/** Validate descriptors before reading values: debug callers cannot smuggle getters or sparse arrays. */
function bounded(value: unknown, maxDepth = 8, textLimit = true, maxNodes = 4000, maxKeys = 160, maxText = 20000): void {
  let nodes = 0;
  const ancestors = new Set<object>();
  function walk(v: unknown, depth: number, path: string): void {
    if (++nodes > maxNodes) fail(path, `ノード数は${maxNodes}以下にしてください`);
    if (depth > maxDepth) fail(path, `深さは${maxDepth}以下にしてください`);
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) fail(path, '有限の数値が必要です'); return; }
    if (typeof v !== 'object') fail(path, 'JSONで表現できない値です');
    const container = v as object;
    if (ancestors.has(container)) fail(path, '循環参照は使えません');
    const array = Array.isArray(container);
    const proto = Object.getPrototypeOf(container);
    if (array && proto !== Array.prototype) fail(path, '通常のJSON配列が必要です');
    if (!array && proto !== Object.prototype && proto !== null) fail(path, '通常のJSONオブジェクトが必要です');
    const keys = Reflect.ownKeys(container);
    if (keys.some(k => typeof k === 'symbol')) fail(path, 'Symbolキーは使えません');
    const names = keys as string[];
    if (!array && names.length > maxKeys) fail(path, `キー数は${maxKeys}以下にしてください`);
    if (array && (names.length !== (container as unknown[]).length + 1 || (container as unknown[]).length > maxNodes)) fail(path, '疎な配列・追加プロパティは使えません');
    ancestors.add(container);
    for (const k of names) {
      if (array && k === 'length') continue;
      if (array && (!/^(0|[1-9]\d*)$/.test(k) || Number(k) >= (container as unknown[]).length)) fail(path, '配列キーが不正です');
      if (!array && k.length > 80) fail(path, 'キー長は80以下にしてください');
      const d = Object.getOwnPropertyDescriptor(container, k)!;
      if (!own(d, 'value') || !d.enumerable) fail(path, 'アクセサ・非列挙プロパティは使えません');
      walk(d.value, depth + 1, path + '/' + escape(k));
    }
    ancestors.delete(container);
  }
  walk(value, 0, '');
  if (textLimit && JSON.stringify(value).length > maxText) fail('', `JSONは${maxText} UTF-16文字以下にしてください`);
}
function parse(text: string, specimenEnvelope = false): unknown {
  if (typeof text !== 'string' || text.length > 20000) fail('', '入力は20000 UTF-16文字以下の文字列が必要です');
  let value: unknown;
  try { value = JSON.parse(text); } catch { fail('', 'JSONの構文が正しくありません'); }
  if (specimenEnvelope && Array.isArray(value)) bounded(value, 9, false, 4001);
  else bounded(value, 8, false);
  return value;
}
export function validateRecords(input: unknown): Record<string, unknown>[] {
  // Dataset brackets are transport, not specimen depth, node or text payload.
  bounded(input, 9, true, 4001, 160, 20002);
  if (!Array.isArray(input) || input.length < 1 || input.length > 40 || !input.every(object)) fail('', '1〜40件のオブジェクト配列が必要です');
  return input as Record<string, unknown>[];
}
export function parseSpecimens(text: string): Record<string, unknown>[] {
  const value = parse(text, true);
  return validateRecords(object(value) ? [value] : value);
}
export function parseProbe(text: string): unknown { return parse(text); }
export function validatePolicy(input: unknown): Policy {
  bounded(input);
  if (!object(input) || Object.keys(input).length !== 3 || !['mode', 'required', 'closed'].every(k => own(input, k)) || !['observed', 'dominant'].includes(input.mode as string) || !['all', 'majority'].includes(input.required as string) || typeof input.closed !== 'boolean') fail('', 'ポリシーはmode・required・closedの正しい値が必要です');
  return { mode: input.mode as Mode, required: input.required as Policy['required'], closed: input.closed as boolean };
}
export function infer(records: Record<string, unknown>[], policy: Policy): Schema {
  validateRecords(records);
  const p = validatePolicy(policy);
  function derive(values: unknown[]): Schema {
    if (!values.length) return {};
    const counts = new Map<string, number>();
    for (const v of values) counts.set(kind(v), (counts.get(kind(v)) ?? 0) + 1);
    let types = TYPE_ORDER.filter(t => counts.has(t));
    if (p.mode === 'dominant') {
      const threshold = types.filter(t => counts.get(t)! / values.length >= 0.6);
      const max = Math.max(...counts.values());
      types = threshold.length ? threshold : types.filter(t => counts.get(t) === max);
    }
    const result: Schema = { type: types.length === 1 ? types[0] : types };
    if (types.includes('object')) {
      const objects = values.filter(object);
      const keys = [...new Set(objects.flatMap(v => Object.keys(v)))].sort();
      result.properties = Object.fromEntries(keys.map(k => [k, derive(objects.filter(o => own(o, k)).map(o => o[k]))]));
      result.required = keys.filter(k => objects.filter(o => own(o, k)).length / objects.length >= (p.required === 'all' ? 1 : 0.6));
      result.additionalProperties = !p.closed;
    }
    if (types.includes('array')) result.items = derive(values.filter(Array.isArray).flat());
    return result;
  }
  return derive(records);
}
export function inspect(records: Record<string, unknown>[]): Field[] {
  validateRecords(records);
  const paths = new Map<string, string[]>();
  function discover(o: Record<string, unknown>, parts: string[]) {
    for (const k of Object.keys(o)) {
      const next = [...parts, k]; paths.set(pointer(next), next);
      if (object(o[k])) discover(o[k], next);
    }
  }
  records.forEach(r => discover(r, []));
  return [...paths.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, parts]) => {
    const values = records.map((r, index) => {
      let value: unknown = r; let present = true;
      for (const k of parts) {
        if (!object(value) || !own(value, k)) { present = false; value = undefined; break; }
        value = value[k];
      }
      return { index, present, type: present ? kind(value) : 'missing', value };
    });
    const counts = new Map<string, number>();
    for (const v of values) if (v.present) counts.set(v.type, (counts.get(v.type) ?? 0) + 1);
    return { path, values, types: Object.fromEntries(counts), present: values.filter(v => v.present).length, total: records.length };
  });
}
export function validateProbe(value: unknown, schema: Schema): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  try {
    bounded(value);
    // Schema keyword wrappers are not specimen nodes; allow the bounded expansion of 4000 input nodes.
    bounded(schema, 32, false, 40000, 4000);
    function checkSchema(s: unknown): asserts s is Schema {
      if (!object(s)) fail('', 'スキーマはオブジェクトが必要です');
      if (s.type !== undefined) {
        const types = Array.isArray(s.type) ? s.type : [s.type];
        if (!types.length || types.some(t => typeof t !== 'string' || ![...TYPE_ORDER, 'integer'].includes(t))) fail('', 'スキーマ型が不正です');
      }
      if (s.required !== undefined && (!Array.isArray(s.required) || s.required.some(k => typeof k !== 'string'))) fail('', 'requiredが不正です');
      if (s.additionalProperties !== undefined && typeof s.additionalProperties !== 'boolean') fail('', 'additionalPropertiesが不正です');
      if (s.properties !== undefined) {
        if (!object(s.properties)) fail('', 'propertiesが不正です');
        Object.values(s.properties).forEach(checkSchema);
      }
      if (s.items !== undefined) checkSchema(s.items);
    }
    checkSchema(schema);
    function visit(v: unknown, s: Schema, path: string) {
      const types = s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type];
      if (types.length && !types.some(t => t === kind(v) || t === 'integer' && typeof v === 'number' && Number.isInteger(v))) {
        errors.push(`${label(path)}: 型${kind(v)}は許可されていません（${types.join(' / ')}）`); return;
      }
      if (object(v)) {
        for (const k of s.required ?? []) if (!own(v, k)) errors.push(`${label(path + '/' + escape(k))}: 必須フィールドがありません`);
        for (const k of Object.keys(v)) {
          if (s.properties && own(s.properties, k)) visit(v[k], s.properties[k], path + '/' + escape(k));
          else if (s.additionalProperties === false) errors.push(`${label(path + '/' + escape(k))}: 未定義のフィールドです`);
        }
      }
      if (Array.isArray(v) && s.items) v.forEach((item, i) => visit(item, s.items!, path + '/' + i));
    }
    visit(value, schema, '');
  } catch (error) { errors.push(error instanceof Error ? error.message : '検証に失敗しました'); }
  return { valid: errors.length === 0, errors };
}
