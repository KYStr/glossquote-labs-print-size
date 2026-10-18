// Offline DOM doubles cover synchronous/failure branches only. They are not
// evidence for a real browser, screen reader, physical keyboard or BFCache.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ROOT } from '../scripts/lib.mjs';

const html = await readFile(join(ROOT, 'public/index.html'), 'utf8');
const core = (await readFile(join(ROOT, 'public/js/core/print-size.js'), 'utf8')).replace('export function calculatePrintSize', 'function calculatePrintSize');
const app = (await readFile(join(ROOT, 'public/js/app.js'), 'utf8')).replace(/^import \{ calculatePrintSize \} from '.\/core\/print-size.js';\n/, '');

function fixture(missing = null) {
  const nodes = new Map();
  const document = { documentElement: { lang: 'zh-Hant' }, activeElement: null, getElementById: id => nodes.get(id) ?? null };
  function emitter(object) {
    object.handlers = new Map();
    object.addEventListener = (type, callback, options) => {
      const handlers = object.handlers.get(type) ?? [];
      handlers.push({ callback, options }); object.handlers.set(type, handlers);
    };
    object.emit = (type, extra = {}) => {
      const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const { callback } of object.handlers.get(type) ?? []) callback(event);
      return event;
    };
    return object;
  }
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const id = match[1];
    if (id === missing) continue;
    const attributes = new Map();
    const node = emitter({ id, value: id === 'targetPpiRaw' ? '300' : '', textContent: '', hidden: /\bhidden\b/.test(match[0]), disabled: /\bdisabled\b/.test(match[0]), open: false, dataset: {}, maxLength: id === 'widthMmRaw' ? 8 : 6, selectionStart: 0, selectionEnd: 0 });
    node.setAttribute = (name, value) => attributes.set(name, value);
    node.getAttribute = name => attributes.get(name) ?? null;
    node.removeAttribute = name => { attributes.delete(name); if (name === 'data-state') delete node.dataset.state; };
    node.focus = () => { document.activeElement = node; };
    node.showModal = () => { node.open = true; };
    node.close = () => { node.open = false; };
    node.setRangeText = (text, start, end) => { node.value = node.value.slice(0,start) + text + node.value.slice(end); node.selectionStart = start + text.length; node.selectionEnd = node.selectionStart; };
    nodes.set(id,node);
  }
  const navigations = [];
  const window = emitter({ location: { assign: path => navigations.push(path) } });
  runInNewContext(`${core}\n${app}`, { document, window }, { timeout: 1000 });
  const fill = (id, value) => { const node=nodes.get(id); node.value=value; node.emit('input'); };
  const calculate = () => nodes.get('print-form').emit('submit');
  const valid = () => { fill('pixelWidthRaw','3000'); fill('pixelHeightRaw','2000'); fill('widthMmRaw','254'); fill('targetPpiRaw','300'); calculate(); };
  return { nodes, document, window, navigations, fill, calculate, valid };
}

test('initialization failure stays disabled; first submit capture cancels before readiness', () => {
  const f=fixture('targetPpiRaw-error');
  assert.equal(f.nodes.get('inputs').disabled,true);
  for (const id of ['calculate','clear','insert-decimal','language','confirm-proceed','confirm-cancel']) assert.equal(f.nodes.get(id).disabled,true);
  assert.equal(f.nodes.get('init-status').hidden,false);
  const handler=f.nodes.get('print-form').handlers.get('submit')[0];
  assert.equal(handler.options.capture,true);
  assert.equal(f.calculate().defaultPrevented,true);
  assert.equal(f.navigations.length,0);
});
test('all four input events invalidate result and target text synchronously', () => {
  const f=fixture();
  for (const [id,value] of [['pixelWidthRaw','3001'],['pixelHeightRaw','2001'],['widthMmRaw','255'],['targetPpiRaw','600']]) {
    f.valid(); assert.equal(f.nodes.get('result').hidden,false);
    f.fill(id,value);
    assert.equal(f.nodes.get('result').hidden,true);
    assert.equal(f.nodes.get('target-status').textContent,'');
    for (const output of ['result-pixels','result-size','result-ppi','result-target','result-required']) assert.equal(f.nodes.get(output).textContent,'');
  }
});
test('initial default is not work; raw target deviations require confirmation', () => {
  const f=fixture();
  f.nodes.get('clear').emit('click'); assert.equal(f.nodes.get('confirmation').open,false);
  f.nodes.get('language').emit('click'); assert.deepEqual(f.navigations,['/en/index.html']);
  f.fill('targetPpiRaw','0300'); f.nodes.get('clear').emit('click');
  assert.equal(f.nodes.get('confirmation').open,true);
  f.nodes.get('confirm-cancel').emit('click'); assert.equal(f.nodes.get('targetPpiRaw').value,'0300');
  assert.equal(f.document.activeElement.id,'clear');
});
test('clear and language cancellation preserve data; confirmed reset clears everything', () => {
  const f=fixture(); f.valid();
  const before=f.nodes.get('result-size').textContent;
  for (const id of ['clear','language']) {
    f.nodes.get(id).emit('click'); f.nodes.get('confirm-cancel').emit('click');
    assert.equal(f.nodes.get('result-size').textContent,before);
    assert.equal(f.nodes.get('pixelWidthRaw').value,'3000');
    assert.equal(f.navigations.length,0);
  }
  f.nodes.get('clear').emit('click'); f.nodes.get('confirm-proceed').emit('click');
  for (const id of ['pixelWidthRaw','pixelHeightRaw','widthMmRaw']) assert.equal(f.nodes.get(id).value,'');
  assert.equal(f.nodes.get('targetPpiRaw').value,'300'); assert.equal(f.nodes.get('result').hidden,true);
  f.valid(); f.nodes.get('language').emit('click'); f.nodes.get('confirm-proceed').emit('click');
  assert.deepEqual(f.navigations,['/en/index.html']); assert.equal(f.nodes.get('pixelWidthRaw').value,'');
});
test('pagehide and persisted pageshow clear inputs, results and open confirmation', () => {
  const f=fixture(); f.valid(); f.nodes.get('clear').emit('click');
  f.window.emit('pagehide');
  assert.equal(f.nodes.get('confirmation').open,false);
  assert.equal(f.nodes.get('pixelWidthRaw').value,''); assert.equal(f.nodes.get('result-size').textContent,'');
  assert.equal(f.nodes.get('targetPpiRaw').value,'300');
  f.valid(); f.window.emit('pageshow',{persisted:true});
  assert.equal(f.nodes.get('result').hidden,true); assert.equal(f.nodes.get('widthMmRaw').value,'');
  assert.equal(f.nodes.get('targetPpiRaw').value,'300');
});
test('decimal helper inserts at selection, preserves caret and respects raw length cap', () => {
  const f=fixture(); const input=f.nodes.get('widthMmRaw');
  f.fill('widthMmRaw','2545'); input.selectionStart=3; input.selectionEnd=3;
  f.nodes.get('insert-decimal').emit('click');
  assert.equal(input.value,'254.5'); assert.equal(input.selectionStart,4); assert.equal(input.selectionEnd,4);
  assert.equal(f.document.activeElement.id,'widthMmRaw');
  f.fill('widthMmRaw','10000.00'); input.selectionStart=8; input.selectionEnd=8;
  f.nodes.get('insert-decimal').emit('click'); assert.equal(input.value,'10000.00');
});
