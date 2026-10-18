// node:util for the browser demo: parseArgs and format, the two sys1grep.mjs and options.mjs import. parseArgs
// follows Node's own (lib/internal/util/parse_args) for what sys1grep uses: string/boolean, short, multiple, default,
// allowPositionals, allowNegative, strict, tokens. tests/demo-shims.mjs compares it with node:util on many argvs.
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);
const longOf = (short, options) => Object.keys(options).find(k => own(options[k], 'short') === short) ?? short;
const typeOf = (options, name) => (Object.hasOwn(options, name) ? options[name].type : undefined);

class ParseError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const unknown = (raw, allowPositionals) => new ParseError('ERR_PARSE_ARGS_UNKNOWN_OPTION', `Unknown option '${raw}'${allowPositionals ? `. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- ${JSON.stringify(raw)}` : ''}`);
const invalid = message => new ParseError('ERR_PARSE_ARGS_INVALID_OPTION_VALUE', message);

function tokenize(args, options, allowNegative) {
  const tokens = [], rest = [...args];
  let index = -1, group = 0;
  const option = (name, rawName, value, inlineValue, negated) => {
    const t = { kind: 'option', name, rawName, index, value, inlineValue };
    if (negated) Object.defineProperty(t, 'negated', { value: true });
    tokens.push(t);
  };
  const negate = name => (allowNegative && name.startsWith('no-') ? [name.slice(3), true] : [name, false]);
  while (rest.length) {
    const arg = rest.shift(), next = rest[0];
    if (group > 0) group--; else index++;
    if (arg === '--') {
      tokens.push({ kind: 'option-terminator', index });
      for (const value of rest) tokens.push({ kind: 'positional', index: ++index, value });
      break;
    }
    if (arg.length === 2 && arg[0] === '-' && arg[1] !== '-') {
      const name = longOf(arg[1], options);
      if (typeOf(options, name) === 'string' && next != null) { option(name, arg, rest.shift(), false); index++; }
      else option(name, arg, undefined, undefined);
      continue;
    }
    if (arg.length > 2 && arg[0] === '-' && arg[1] !== '-') {
      if (typeOf(options, longOf(arg[1], options)) !== 'string') { // a group: -abc is -a -b -c, -abfFILE is -a -b -fFILE
        const expanded = [];
        for (let i = 1; i < arg.length; i++) {
          if (typeOf(options, longOf(arg[i], options)) !== 'string' || i === arg.length - 1) expanded.push(`-${arg[i]}`);
          else { expanded.push(`-${arg.slice(i)}`); break; }
        }
        rest.unshift(...expanded);
        group = expanded.length;
        continue;
      }
      option(longOf(arg[1], options), `-${arg[1]}`, arg.slice(2), true);
      continue;
    }
    if (arg.length > 2 && arg.startsWith('--')) {
      const eq = arg.indexOf('=', 3); // from 3, as in Node: --=x is an option named "=x"
      if (eq < 0) {
        const [name, negated] = negate(arg.slice(2));
        if (!negated && typeOf(options, name) === 'string' && next != null) { option(name, arg, rest.shift(), false); index++; }
        else option(name, arg, undefined, undefined, negated);
      } else option(arg.slice(2, eq), arg.slice(0, eq), arg.slice(eq + 1), true);
      continue;
    }
    tokens.push({ kind: 'positional', index, value: arg });
  }
  return tokens;
}

export function parseArgs({ args, options = {}, strict = true, allowPositionals = !strict, allowNegative = false, tokens: wantTokens = false } = {}) {
  const tokens = tokenize(args, options, allowNegative);
  const values = { __proto__: null }, positionals = [];
  for (const t of tokens) {
    if (t.kind === 'option') {
      if (strict) {
        // --no-X=V names X in the check (and so "does not take an argument"), though it is stored as no-X
        const base = t.name.slice(3), name = !Object.hasOwn(options, t.name) && allowNegative && t.name.startsWith('no-') && typeOf(options, base) === 'boolean' ? base : t.name;
        if (!Object.hasOwn(options, name) || (t.negated && options[name].type !== 'boolean')) throw unknown(t.rawName, allowPositionals);
        const short = own(options[name], 'short'), both = `${short ? `-${short}, ` : ''}--${name}`;
        if (options[name].type === 'string' && typeof t.value !== 'string') throw invalid(`Option '${both} <value>' argument missing`);
        if (options[name].type === 'boolean' && t.value != null) throw invalid(`Option '${both}' does not take an argument`);
        if (!t.inlineValue && typeof t.value === 'string' && t.value.length > 1 && t.value[0] === '-') {
          const example = t.rawName.startsWith('--') ? `'${t.rawName}=-XYZ'` : `'--${t.name}=-XYZ' or '${t.rawName}-XYZ'`;
          throw invalid(`Option '${t.rawName}' argument is ambiguous.\nDid you forget to specify the option argument for '${t.rawName}'?\nTo specify an option argument starting with a dash use ${example}.`);
        }
      }
      if (t.name === '__proto__') continue;
      const v = t.negated ? false : t.value ?? true;
      if (own(options[t.name] ?? {}, 'multiple')) (values[t.name] ??= []).push(v);
      else values[t.name] = v;
    } else if (t.kind === 'positional') {
      if (!allowPositionals) throw new ParseError('ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL', `Unexpected argument '${t.value}'. This command does not take positional arguments`);
      positionals.push(t.value);
    }
  }
  for (const [k, o] of Object.entries(options)) if (o.default !== undefined && values[k] === undefined) values[k] = o.default;
  return wantTokens ? { values, positionals, tokens } : { values, positionals };
}

const show = a => (typeof a === 'string' ? a : typeof a === 'object' && a !== null ? (a instanceof Error ? a.stack ?? String(a) : JSON.stringify(a)) : String(a));
export function format(first, ...rest) {
  if (typeof first !== 'string') return [first, ...rest].map(show).join(' ');
  let i = 0;
  const head = first.replace(/%[sdifjoO%]/g, m => {
    if (m === '%%') return '%';
    if (i >= rest.length) return m;
    const a = rest[i++];
    return m === '%d' || m === '%i' ? String(m === '%i' ? parseInt(a) : Number(a)) : m === '%f' ? String(parseFloat(a)) : m === '%j' ? JSON.stringify(a) : show(a);
  });
  return [head, ...rest.slice(i).map(show)].join(' ');
}
