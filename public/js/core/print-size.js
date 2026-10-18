const FIELDS = Object.freeze(['pixelWidthRaw', 'pixelHeightRaw', 'widthMmRaw', 'targetPpiRaw']);
const RULES = Object.freeze([
  { limit: 6, grammar: /^[0-9]{1,6}$/, max: 100000n },
  { limit: 6, grammar: /^[0-9]{1,6}$/, max: 100000n },
  { limit: 8, grammar: /^[0-9]{1,5}(?:\.[0-9]{1,2})?$/, max: 1000000n },
  { limit: 4, grammar: /^[0-9]{1,4}$/, max: 2400n }
]);
const fail = (code, field) => ({ ok: false, error: { code, field } });
const ceilDiv = (n, d) => (n + d - 1n) / d;
const halfUp = (n, d) => (2n * n + d) / (2n * d);
const fixedTwo = value => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;

function safeInteger(value) {
  if (value < 0n || value > 9007199254740991n) throw new RangeError('integer_bound');
  return Number(value);
}

/** Exact, synchronous calculation. Only validated descriptor values are read. */
export function calculatePrintSize(request) {
  let descriptors;
  try {
    if (request === null || typeof request !== 'object' ||
        Object.getPrototypeOf(request) !== Object.prototype) {
      return fail('invalid_request', 'request');
    }
    const keys = Reflect.ownKeys(request);
    if (keys.length !== FIELDS.length || keys.some(key => !FIELDS.includes(key))) {
      return fail('invalid_schema', 'request');
    }
    descriptors = Object.getOwnPropertyDescriptors(request);
    for (const field of FIELDS) {
      const descriptor = descriptors[field];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') ||
          Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')) {
        return fail('invalid_schema', field);
      }
    }
  } catch {
    return fail('invalid_schema', 'request');
  }

  const values = [];
  for (let i = 0; i < FIELDS.length; i += 1) {
    const field = FIELDS[i];
    const raw = descriptors[field].value;
    const rule = RULES[i];
    if (typeof raw !== 'string') return fail('invalid_format', field);
    if (raw.length > rule.limit) return fail('raw_too_long', field);
    // The explicit end check also rejects a final newline ($ alone accepts it).
    if (!rule.grammar.test(raw) || /[^0-9.]/.test(raw)) return fail('invalid_format', field);
    let value;
    if (field === 'widthMmRaw') {
      const [whole, fraction = ''] = raw.split('.');
      value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    } else {
      value = BigInt(raw);
    }
    if (value < 1n || value > rule.max) return fail('out_of_range', field);
    values.push(value);
  }

  const [width, height, units, target] = values;
  try {
    return {
      ok: true,
      result: {
        schemaVersion: 1,
        pixelWidth: safeInteger(width),
        pixelHeight: safeInteger(height),
        widthMm: fixedTwo(units),
        heightMm: fixedTwo(halfUp(units * height, width)),
        targetPpi: safeInteger(target),
        effectivePpi: fixedTwo(halfUp(width * 254000n, units)),
        requiredPixelWidth: safeInteger(ceilDiv(units * target, 2540n)),
        requiredPixelHeight: safeInteger(ceilDiv(units * height * target, 2540n * width)),
        meetsTarget: width * 2540n >= target * units
      }
    };
  } catch {
    return fail('invalid_request', 'request');
  }
}
