import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_POLICY, DEMO, infer, inspect, parseProbe, parseSpecimens, validatePolicy, validateProbe, validateRecords } from './engine';

describe('JSON specimen engine', () => {
  it('infers recursive unions and optional fields', () => {
    const s = infer(DEMO, DEFAULT_POLICY);
    expect(s.properties?.id.type).toEqual(['number', 'string']);
    expect(s.properties?.profile.required).toContain('name');
    expect(s.properties?.profile.required).not.toContain('timezone');
    expect(s.properties?.tasks.items?.type).toBe('object');
    expect(validateProbe(DEMO[0], s).valid).toBe(true);
    expect(validateProbe({ profile: { name: 3 } }, s).valid).toBe(false);
  });
  it('uses eligible objects for nested required and flattens array items', () => {
    const s = infer([{ a: { x: 1 }, list: [1, 'a'] }, { a: null, list: [] }, {}], DEFAULT_POLICY);
    expect(s.properties?.a.type).toEqual(['object', 'null']);
    expect(s.properties?.a.required).toEqual(['x']);
    expect(s.properties?.list.items?.type).toEqual(['number', 'string']);
    expect(infer([{ a: [] }], DEFAULT_POLICY).properties?.a.items).toEqual({});
  });
  it('dominant selects 60 percent and ties when no type reaches threshold', () => {
    const p = { ...DEFAULT_POLICY, mode: 'dominant' as const, required: 'majority' as const, closed: true };
    const s = infer([{ id: 1, x: true }, { id: 2, x: false }, { id: '3' }], p);
    expect(s.properties?.id.type).toBe('number');
    expect(s.required).toEqual(['id', 'x']);
    expect(validateProbe({ id: '4', x: true }, s).valid).toBe(false);
    expect(validateProbe({ id: 4, x: true, extra: 1 }, s).errors.join()).toContain('/extra');
    expect(validateProbe({ id: 4, x: true }, s).valid).toBe(true);
    expect(infer([{ a: 1 }, { a: 's' }, { a: true }], p).properties?.a.type).toEqual(['number', 'string', 'boolean']);
  });
  it('handles escaped, prototype and collision-prone keys safely', () => {
    const r = parseSpecimens('[{"__proto__":{"polluted":true},"constructor":1,"a/b":{"~x":2},"a":{"b":3}}]');
    const s = infer(r, { ...DEFAULT_POLICY, closed: true });
    expect(Object.hasOwn(s.properties!, '__proto__')).toBe(true);
    expect(validateProbe(r[0], s).valid).toBe(true);
    const fields = inspect(r);
    expect(fields.map(f => f.path)).toContain('/a~1b/~0x');
    expect(fields.map(f => f.path)).toContain('/a/b');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('tracks presence per root including null vs missing', () => {
    const f = inspect([{ a: { b: null } }, { a: {} }, { a: null }]).find(f => f.path === '/a/b')!;
    expect(f.present).toBe(1); expect(f.total).toBe(3);
    expect(f.types).toEqual({ null: 1 });
    expect(f.values.map(v => v.present)).toEqual([true, false, false]);
  });
  it('parses root objects / nonempty record arrays and any probe JSON', () => {
    expect(parseSpecimens('{}')).toEqual([{}]);
    for (const text of ['[]', 'null', '[null]', '[1]', '{', 'true']) expect(() => parseSpecimens(text)).toThrow();
    for (const text of ['null', 'false', '3', '"x"', '[]']) expect(() => parseProbe(text)).not.toThrow();
  });
  it('enforces boundary sizes, depth, nodes and keys', () => {
    expect(validateRecords(Array.from({ length: 40 }, () => ({})))).toHaveLength(40);
    expect(() => validateRecords(Array.from({ length: 41 }, () => ({})))).toThrow();
    expect(() => parseProbe(' '.repeat(19996) + 'null')).not.toThrow();
    expect(() => parseProbe(' '.repeat(19997) + 'null')).toThrow();
    expect(() => parseProbe('['.repeat(8) + '0' + ']'.repeat(8))).not.toThrow();
    expect(() => parseProbe('['.repeat(9) + '0' + ']'.repeat(9))).toThrow();
    expect(() => parseProbe(JSON.stringify(Array(3999).fill(0)))).not.toThrow();
    expect(() => parseProbe(JSON.stringify(Array(4000).fill(0)))).toThrow();
    expect(() => validateRecords([Object.fromEntries(Array.from({ length: 161 }, (_, i) => [String(i), 0]))])).toThrow();
    expect(() => validateRecords([{ ['x'.repeat(81)]: 0 }])).toThrow();
  });
  it('rejects non-JSON debug values without executing getters', () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const getter = Object.defineProperty({}, 'x', { enumerable: true, get() { throw new Error('executed'); } });
    for (const value of [null, [], [null], [{ x: NaN }], [{ x: Infinity }], [{ x: undefined }], [{ x: 1n }], [{ x: () => 0 }], [{ x: new Date() }], [{ x: Array(2) }], [cycle], [getter], [{ [Symbol('s')]: 1 }]]) {
      expect(() => validateRecords(value)).toThrow();
    }
    expect(validateProbe({ x: NaN }, {}).valid).toBe(false);
    expect(validateProbe(Array(1), {}).valid).toBe(false);
  });
  it('accepts expanded inferred properties without weakening specimen bounds', () => {
    const records = [0, 1].map(n => Object.fromEntries(Array.from({ length: 160 }, (_, i) => [`k${n}_${i}`, i])));
    const schema = infer(records, DEFAULT_POLICY);
    expect(Object.keys(schema.properties!)).toHaveLength(320);
    expect(validateProbe(records[0], schema).valid).toBe(true);
  });
  it('keeps an eight-level root object usable through parsing, inference and probing', () => {
    const text = '{"a":'.repeat(8) + '0' + '}'.repeat(8);
    const records = parseSpecimens(text);
    expect(validateProbe(records[0], infer(records, DEFAULT_POLICY)).valid).toBe(true);
    expect(() => validateRecords([JSON.parse('{"a":'.repeat(9) + '0' + '}'.repeat(9))])).toThrow();
  });
  it('keeps declared text/depth/node maxima closed across the specimen envelope', () => {
    const raw = JSON.stringify({ note: '界'.repeat(19989) });
    expect(raw.length).toBe(20000);
    const records = parseSpecimens(raw);
    expect(infer(records, DEFAULT_POLICY).type).toBe('object');
    expect(validateProbe(records[0], infer(records, DEFAULT_POLICY)).valid).toBe(true);
    expect(() => parseSpecimens(raw + ' ')).toThrow();
    const depth8 = '{"a":'.repeat(8) + '0' + '}'.repeat(8);
    for (const text of [depth8, '[' + depth8 + ']']) {
      const samples = parseSpecimens(text);
      expect(validateProbe(samples[0], infer(samples, DEFAULT_POLICY)).valid).toBe(true);
    }
    const maxNodes = [{ a: Array(3998).fill(0) }];
    expect(() => infer(parseSpecimens(JSON.stringify(maxNodes)), DEFAULT_POLICY)).not.toThrow();
    expect(() => validateRecords([{ a: Array(3999).fill(0) }])).toThrow();
  });
  it('strictly validates policies and schemas', () => {
    expect(validatePolicy(DEFAULT_POLICY)).toEqual(DEFAULT_POLICY);
    for (const p of [null, {}, { ...DEFAULT_POLICY, closed: 'false' }, { ...DEFAULT_POLICY, mode: 'bad' }, { ...DEFAULT_POLICY, required: 'bad' }, { ...DEFAULT_POLICY, extra: 1 }]) expect(() => validatePolicy(p)).toThrow();
    expect(validateProbe(3, { type: 'banana' }).valid).toBe(false);
    expect(validateProbe({}, { type: 'object', required: ['constructor'] }).valid).toBe(false);
    expect(validateProbe({ a: [null] }, { type: 'object', properties: { a: { type: 'array', items: { type: 'number' } } } }).errors.join()).toContain('/a/0');
  });
});

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = (args: string[]) => spawnSync(process.execPath, [join(app, 'node_modules/tsx/dist/cli.mjs'), join(app, 'scripts/scenario.ts'), ...args], { encoding: 'utf8' });
describe('scenario CLI', () => {
  it('outputs DEMO schema and handles both flag forms', () => {
    const defaults = cli([]);
    expect(defaults.status).toBe(0);
    expect(JSON.parse(defaults.stdout).schema.properties.id.type).toEqual(['number', 'string']);
    const a = cli(['--mode=dominant', '--required=majority', '--closed=true']);
    const b = cli(['--mode', 'dominant', '--required', 'majority', '--closed', 'true']);
    expect(a.status).toBe(0); expect(b.status).toBe(0); expect(a.stdout).toBe(b.stdout);
    expect(JSON.parse(a.stdout).schema.properties.id.type).toBe('number');
    expect(JSON.parse(a.stdout).schema.additionalProperties).toBe(false);
  });
  it('rejects unknown / duplicate / missing / invalid arguments', () => {
    for (const args of [['--unknown=x'], ['--mode'], ['--mode='], ['--mode', '--closed=true'], ['--closed=0'], ['--closed=false', '--closed', 'true'], ['--mode=oops'], ['--required=oops'], ['plain']]) {
      const result = cli(args); expect(result.status, args.join(' ')).toBe(1); expect(result.stderr).not.toBe(''); expect(result.stdout).toBe('');
    }
  });
  it('reads actual input and probes passing / failing policies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'json-specimen-cli-'));
    try {
      const input = join(dir, 'input.json'); const probe = join(dir, 'probe.json');
      writeFileSync(input, JSON.stringify([{ id: 1 }, { id: 2 }, { id: 'guest' }]));
      writeFileSync(probe, '{"id":"guest","extra":true}');
      const args = ['--input', input, `--probe=${probe}`];
      const observed = cli(args); const dominant = cli([...args, '--mode=dominant']);
      const closed = cli([...args, '--closed=true']);
      expect(observed.status).toBe(0); expect(JSON.parse(observed.stdout).probe.valid).toBe(true);
      expect(dominant.status).toBe(0); expect(JSON.parse(dominant.stdout).probe.valid).toBe(false);
      expect(JSON.parse(closed.stdout).probe.errors.join()).toContain('/extra');
      writeFileSync(probe, '{bad'); expect(cli(args).status).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
