import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrintSize } from '../public/js/core/print-size.js';

const request = (pixelWidthRaw = '3000', pixelHeightRaw = '2000', widthMmRaw = '254', targetPpiRaw = '300') =>
  ({ pixelWidthRaw, pixelHeightRaw, widthMmRaw, targetPpiRaw });
const failure = (code, field) => ({ ok: false, error: { code, field } });
const resultKeys = ['schemaVersion', 'pixelWidth', 'pixelHeight', 'widthMm', 'heightMm', 'targetPpi', 'effectivePpi', 'requiredPixelWidth', 'requiredPixelHeight', 'meetsTarget'];

// ACCEPTANCE.md C01–C15: expected outputs are independently specified constants.
const cases = [
  ['C01', ['3000','2000','254','300'], [3000,2000,'254.00','169.33',300,'300.00',3000,2000,true]],
  ['C02', ['3000','2000','300','300'], [3000,2000,'300.00','200.00',300,'254.00',3544,2363,false]],
  ['C03', ['3000','2000','152.4','300'], [3000,2000,'152.40','101.60',300,'500.00',1800,1200,true]],
  ['C04', ['3000','2000','100','300'], [3000,2000,'100.00','66.67',300,'762.00',1182,788,true]],
  ['C05', ['3000','2000','500','300'], [3000,2000,'500.00','333.33',300,'152.40',5906,3938,false]],
  ['C06', ['800','600','50.8','300'], [800,600,'50.80','38.10',300,'400.00',600,450,true]],
  ['C07', ['1','1','0.01','1'], [1,1,'0.01','0.01',1,'2540.00',1,1,true]],
  ['C08', ['2','1','100.01','1'], [2,1,'100.01','50.01',1,'0.51',4,2,false]],
  ['C09', ['100000','100000','8466.67','300'], [100000,100000,'8466.67','8466.67',300,'300.00',100001,100001,false]],
  ['C10', ['100000','100000','8466.66','300'], [100000,100000,'8466.66','8466.66',300,'300.00',100000,100000,true]],
  ['C11', ['3000','2000','254','600'], [3000,2000,'254.00','169.33',600,'300.00',6000,4000,false]],
  ['C12', ['1600','1200','203.2','200'], [1600,1200,'203.20','152.40',200,'200.00',1600,1200,true]],
  ['C13', ['1','100000','0.01','2400'], [1,100000,'0.01','1000.00',2400,'2540.00',1,94489,true]],
  ['C14', ['100000','1','10000','1'], [100000,1,'10000.00','0.10',1,'254.00',394,1,true]],
  ['C15', ['1','100000','10000','2400'], [1,100000,'10000.00','1000000000.00',2400,'0.00',944882,94488188977,false]]
];
for (const [id, args, expected] of cases) {
  test(`${id}: exact result shape and all output values`, () => {
    const input = request(...args);
    const before = structuredClone(input);
    const expectedResult = Object.fromEntries(resultKeys.map((key, i) => [key, [1, ...expected][i]]));
    const output = calculatePrintSize(input);
    assert.deepEqual(output, { ok: true, result: expectedResult });
    assert.deepEqual(Object.keys(output.result), resultKeys);
    assert.deepEqual(JSON.parse(JSON.stringify(output)), output);
    assert.deepEqual(input, before);
  });
}

const invalidCases = [
  ['C16','pixelWidthRaw','1e3','invalid_format'],
  ['C17','pixelHeightRaw','100001','out_of_range'],
  ['C18','widthMmRaw','0.001','invalid_format'],
  ['C19','widthMmRaw','10000.01','out_of_range'],
  ['C20','targetPpiRaw','2401','out_of_range'],
  ['C21','widthMmRaw',' 254','invalid_format'],
  ['C22','targetPpiRaw','３００','invalid_format'],
  ['C23','widthMmRaw','0','out_of_range'],
  ['C24','widthMmRaw','123456789','raw_too_long']
];
for (const [id, field, value, code] of invalidCases) {
  test(`${id}: ${field} returns only ${code}`, () => {
    const input = { ...request(), [field]: value };
    const before = structuredClone(input);
    assert.deepEqual(calculatePrintSize(input), failure(code, field));
    assert.deepEqual(input, before);
    if (id === 'C21') assert.deepEqual(calculatePrintSize({ ...request(), widthMmRaw: '254,0' }), failure(code, field));
  });
}

test('C25: unknown key is rejected without reading its value', () => {
  let reads = 0;
  const input = request();
  Object.defineProperty(input, 'debug', { get() { reads += 1; throw new Error('must_not_read'); }, enumerable: true });
  assert.deepEqual(calculatePrintSize(input), failure('invalid_schema','request'));
  assert.equal(reads, 0);
});
test('C26: known accessor is rejected without getter execution', () => {
  let reads = 0;
  const input = request();
  Object.defineProperty(input, 'pixelWidthRaw', { get() { reads += 1; return '3000'; }, enumerable: true });
  assert.deepEqual(calculatePrintSize(input), failure('invalid_schema','pixelWidthRaw'));
  assert.equal(reads, 0);
});
test('C27: fixed field validation order', () => {
  assert.deepEqual(calculatePrintSize(request('x','0')), failure('invalid_format','pixelWidthRaw'));
});
test('C28: number values are never coerced', () => {
  assert.deepEqual(calculatePrintSize(request(3000)), failure('invalid_format','pixelWidthRaw'));
});
test('C29: extra, symbol, missing and descriptor violations have stable locations', () => {
  const extra = { ...request(), debug: 'private_fixture' };
  const symbol = { ...request(), [Symbol('extra')]: 1 };
  const hidden = request(); Object.defineProperty(hidden, 'extra', { value: 1 });
  const missing = request(); delete missing.targetPpiRaw;
  for (const input of [extra, symbol, hidden, missing]) assert.deepEqual(calculatePrintSize(input), failure('invalid_schema','request'));
  for (const descriptor of [{ get() { throw new Error('never'); }, enumerable: true }, { value: '300', enumerable: false }, { set(_) {}, enumerable: true }]) {
    const input = request(); Object.defineProperty(input, 'targetPpiRaw', descriptor);
    assert.deepEqual(calculatePrintSize(input), failure('invalid_schema','targetPpiRaw'));
  }
});
test('C30: only plain Object.prototype roots are accepted', () => {
  for (const input of [null, [], new Date(0), Object.create({}), Object.create(null), 'x', 300, undefined, () => {}]) {
    assert.deepEqual(calculatePrintSize(input), failure('invalid_request','request'));
  }
});
test('C31: frozen requests remain unchanged and outputs JSON round-trip', () => {
  const input = Object.freeze(request());
  const before = Object.getOwnPropertyDescriptors(input);
  const output = calculatePrintSize(input);
  assert.equal(output.ok, true);
  assert.deepEqual(Object.getOwnPropertyDescriptors(input), before);
  assert.deepEqual(JSON.parse(JSON.stringify(output)), output);
});

test('strict raw grammar, lengths, lower and upper bounds on every field', () => {
  for (const field of Object.keys(request())) {
    const limit = {pixelWidthRaw:6,pixelHeightRaw:6,widthMmRaw:8,targetPpiRaw:4}[field];
    for (const raw of ['', ' ', '+1', '-1', '1e2', '1E2', '1,0', '１', '١', '1\n', '1\r', '1\t', '.5', '1.']) {
      const code = raw.length > limit ? 'raw_too_long' : 'invalid_format';
      assert.deepEqual(calculatePrintSize({...request(),[field]:raw}), failure(code,field));
    }
    assert.deepEqual(calculatePrintSize({...request(),[field]:'x'.repeat(limit+1)}), failure('raw_too_long',field));
    assert.deepEqual(calculatePrintSize({...request(),[field]:'0'}), failure('out_of_range',field));
    for (const raw of [null, undefined, 1, 1n, false, {}, new String('1')]) {
      assert.deepEqual(calculatePrintSize({...request(),[field]:raw}), failure('invalid_format',field));
    }
  }
  assert.equal(calculatePrintSize(request('000001','000001','00000.01','0001')).ok, true);
  assert.equal(calculatePrintSize(request('100000','100000','10000.00','2400')).ok, true);
  assert.equal(calculatePrintSize(request('1','1','0.5','1')).result.widthMm, '0.50');
  assert.equal(calculatePrintSize(request('1','1','0001.25','1')).result.widthMm, '1.25');
});
test('reflection failures produce fixed schema error without exception details', () => {
  for (const trap of ['getPrototypeOf','ownKeys','getOwnPropertyDescriptor']) {
    const input = new Proxy(request(), { [trap]() { throw new Error('private_fixture'); } });
    assert.deepEqual(calculatePrintSize(input), failure('invalid_schema','request'));
  }
  const revocable = Proxy.revocable(request(), {}); revocable.revoke();
  assert.deepEqual(calculatePrintSize(revocable.proxy), failure('invalid_schema','request'));
});
test('schema descriptors are validated before any field format', () => {
  const input = request('x');
  Object.defineProperty(input, 'targetPpiRaw', { value: '300', enumerable: false });
  assert.deepEqual(calculatePrintSize(input), failure('invalid_schema','targetPpiRaw'));
});
test('ceil outputs are minimal sufficient positive dimensions across bounded samples', () => {
  for (const [w,h,u,t] of [[1n,100000n,1000000n,2400n],[3000n,2000n,25400n,300n],[99871n,77n,33n,23n],[13n,17n,1717n,601n],[9n,1n,1n,1n]]) {
    const mm = `${u / 100n}.${(u % 100n).toString().padStart(2,'0')}`;
    const output = calculatePrintSize(request(String(w),String(h),mm,String(t))).result;
    const rw = BigInt(output.requiredPixelWidth), rh = BigInt(output.requiredPixelHeight);
    assert(rw * 2540n >= u * t && (rw - 1n) * 2540n < u * t);
    assert(rh * 2540n * w >= u * h * t && (rh - 1n) * 2540n * w < u * h * t);
    assert.equal(output.meetsTarget, w * 2540n >= t * u);
    assert.match(output.heightMm, /^[0-9]+\.[0-9]{2}$/);
    assert.match(output.effectivePpi, /^[0-9]+\.[0-9]{2}$/);
    assert(Number.isSafeInteger(output.requiredPixelHeight));
  }
});
