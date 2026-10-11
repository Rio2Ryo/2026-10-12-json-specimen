import { readFileSync } from 'node:fs';
import { DEFAULT_POLICY, DEMO, infer, parseProbe, parseSpecimens, validatePolicy, validateProbe } from '../src/engine';

function main(args: string[]) {
  const allowed = new Set(['input', 'probe', 'mode', 'required', 'closed']);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(args[i]);
    if (!match || !allowed.has(match[1])) throw new Error(`不明な引数: ${args[i]}`);
    const key = match[1];
    if (options.has(key)) throw new Error(`引数が重複しています: --${key}`);
    const value = match[2] ?? args[++i];
    if (!value || value.startsWith('--')) throw new Error(`値がありません: --${key}`);
    options.set(key, value);
  }
  const closed = options.get('closed');
  if (closed !== undefined && closed !== 'true' && closed !== 'false') throw new Error('--closedはtrueまたはfalseです');
  const policy = validatePolicy({
    mode: options.get('mode') ?? DEFAULT_POLICY.mode,
    required: options.get('required') ?? DEFAULT_POLICY.required,
    closed: closed === undefined ? DEFAULT_POLICY.closed : closed === 'true',
  });
  const records = options.has('input') ? parseSpecimens(readFileSync(options.get('input')!, 'utf8')) : DEMO;
  const schema = infer(records, policy);
  const output: { schema: typeof schema; probe?: ReturnType<typeof validateProbe> } = { schema };
  if (options.has('probe')) output.probe = validateProbe(parseProbe(readFileSync(options.get('probe')!, 'utf8')), schema);
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}
try { main(process.argv.slice(2)); }
catch (error) {
  process.stderr.write((error instanceof Error ? error.message : '実行に失敗しました') + '\n');
  process.exitCode = 1;
}
