import { calculatePrintSize } from './core/print-size.js';

const form = document.getElementById('print-form');
let ready = false;
let revision = 0;
let result = null;

// First event registration; cancellation is synchronous even before readiness.
form?.addEventListener('submit', event => {
  event.preventDefault();
  if (!ready) return;
  calculate();
}, { capture: true });

let fields;
let ui;
const english = document.documentElement.lang === 'en';
const copy = english ? {
  fields: { pixelWidthRaw: 'Image pixel width', pixelHeightRaw: 'Image pixel height', widthMmRaw: 'Print width', targetPpiRaw: 'Target PPI' },
  fix: {
    pixelWidthRaw: 'Enter 1–100000 using up to 6 ASCII digits, with no spaces.',
    pixelHeightRaw: 'Enter 1–100000 using up to 6 ASCII digits, with no spaces.',
    widthMmRaw: 'Enter 0.01–10000.00 mm using a decimal point and up to 2 decimal places (for example, 254.5). No spaces or commas.',
    targetPpiRaw: 'Enter 1–2400 using up to 4 ASCII digits, with no spaces.'
  },
  tooLong: 'The entry is too long. ',
  below: 'Below your selected PPI target',
  meets: 'Meets your selected PPI target',
  updated: 'Inputs changed. Calculate again to see the current result.',
  clear: 'Clearing removes the current inputs and result. Clear them now?',
  language: 'Changing language clears the current inputs and result. Continue?',
  clearAction: 'Clear', switchAction: 'Clear and switch', cancel: 'Cancel', stay: 'Stay here',
  done: 'Calculation ready.', cleared: 'Inputs and result cleared. Target PPI reset to 300.',
  invalid: 'Check this field. ', generic: 'Check the input fields and calculate again.'
} : {
  fields: { pixelWidthRaw: '圖片像素寬', pixelHeightRaw: '圖片像素高', widthMmRaw: '列印寬度', targetPpiRaw: '目標 PPI' },
  fix: {
    pixelWidthRaw: '請輸入 1–100000，最多 6 位 ASCII 數字，不含空白。',
    pixelHeightRaw: '請輸入 1–100000，最多 6 位 ASCII 數字，不含空白。',
    widthMmRaw: '請輸入 0.01–10000.00 mm，以句點分隔、最多兩位小數（例如 254.5），不含空白或逗號。',
    targetPpiRaw: '請輸入 1–2400，最多 4 位 ASCII 數字，不含空白。'
  },
  tooLong: '輸入超過長度限制。',
  below: '未達所選 PPI 目標', meets: '達到所選 PPI 目標',
  updated: '輸入已修改，請重新試算以查看目前結果。',
  clear: '清除會移除目前輸入和結果。要清除嗎？',
  language: '切換語言會清除目前輸入和結果。要繼續嗎？',
  clearAction: '清除', switchAction: '清除並切換', cancel: '取消', stay: '留在此頁',
  done: '試算結果已就緒。', cleared: '已清除輸入和結果，目標 PPI 已重設為 300。',
  invalid: '請修正此欄位。', generic: '請檢查輸入欄位後重新試算。'
};

function requireNode(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error('initialization');
  return node;
}

function clearError() {
  ui.error.hidden = true;
  ui.error.textContent = '';
  for (const [field, input] of Object.entries(fields)) {
    input.removeAttribute('aria-invalid');
    requireNode(`${field}-error`).textContent = '';
  }
}

function invalidate(announce = true) {
  revision += 1;
  const hadResult = result !== null;
  result = null;
  ui.result.hidden = true;
  for (const node of ui.outputs) node.textContent = '';
  ui.targetStatus.textContent = '';
  ui.targetStatus.removeAttribute('data-state');
  ui.status.textContent = announce && hadResult ? copy.updated : '';
  clearError();
}

function hasWork() {
  return fields.pixelWidthRaw.value !== '' || fields.pixelHeightRaw.value !== '' ||
    fields.widthMmRaw.value !== '' || fields.targetPpiRaw.value !== '300' || result !== null;
}

function reset(announce = false) {
  invalidate(false);
  fields.pixelWidthRaw.value = '';
  fields.pixelHeightRaw.value = '';
  fields.widthMmRaw.value = '';
  fields.targetPpiRaw.value = '300';
  ui.status.textContent = announce ? copy.cleared : '';
}

function calculate() {
  const calculationRevision = revision;
  clearError();
  const request = {
    pixelWidthRaw: fields.pixelWidthRaw.value,
    pixelHeightRaw: fields.pixelHeightRaw.value,
    widthMmRaw: fields.widthMmRaw.value,
    targetPpiRaw: fields.targetPpiRaw.value
  };
  const response = calculatePrintSize(request);
  if (revision !== calculationRevision) return;
  if (!response.ok) {
    invalidate(false);
    const { field, code } = response.error;
    const message = copy.fix[field] ? `${code === 'raw_too_long' ? copy.tooLong : ''}${copy.fix[field]}` : copy.generic;
    ui.error.textContent = `${copy.invalid}${copy.fields[field] ?? ''}: ${message}`;
    ui.error.hidden = false;
    if (fields[field]) {
      requireNode(`${field}-error`).textContent = message;
      fields[field].setAttribute('aria-invalid', 'true');
      fields[field].focus();
    }
    return;
  }
  result = response.result;
  const values = {
    'result-pixels': `${result.pixelWidth} × ${result.pixelHeight} px`,
    'result-size': `${result.widthMm} × ${result.heightMm} mm`,
    'result-ppi': result.effectivePpi,
    'result-target': `${result.targetPpi} PPI`,
    'result-required': `${result.requiredPixelWidth} × ${result.requiredPixelHeight} px`
  };
  for (const [id, value] of Object.entries(values)) requireNode(id).textContent = value;
  ui.targetStatus.textContent = `${result.meetsTarget ? '✓' : '!'} ${result.meetsTarget ? copy.meets : copy.below}`;
  ui.targetStatus.dataset.state = result.meetsTarget ? 'meets' : 'below';
  ui.result.hidden = false;
  ui.status.textContent = copy.done;
}

let pendingAction = null;
let returnFocus = null;

function closeConfirmation() {
  pendingAction = null;
  ui.dialog.close();
  returnFocus?.focus();
  returnFocus = null;
}

function confirmAction(kind, trigger) {
  if (!hasWork()) {
    if (kind === 'language') window.location.assign(english ? '/index.html' : '/en/index.html');
    else { reset(true); fields.pixelWidthRaw.focus(); }
    return;
  }
  pendingAction = kind;
  returnFocus = trigger;
  ui.confirmMessage.textContent = kind === 'language' ? copy.language : copy.clear;
  ui.confirmProceed.textContent = kind === 'language' ? copy.switchAction : copy.clearAction;
  ui.confirmCancel.textContent = kind === 'language' ? copy.stay : copy.cancel;
  ui.dialog.showModal();
  ui.confirmCancel.focus();
}

try {
  if (!form || !['en', 'zh-Hant'].includes(document.documentElement.lang)) throw new Error('initialization');
  fields = Object.fromEntries(['pixelWidthRaw', 'pixelHeightRaw', 'widthMmRaw', 'targetPpiRaw'].map(id => [id, requireNode(id)]));
  ui = {
    fieldset: requireNode('inputs'), calculate: requireNode('calculate'), clear: requireNode('clear'),
    decimal: requireNode('insert-decimal'), language: requireNode('language'),
    error: requireNode('error-summary'), result: requireNode('result'), status: requireNode('status'),
    targetStatus: requireNode('target-status'), init: requireNode('init-status'),
    dialog: requireNode('confirmation'), confirmMessage: requireNode('confirm-message'),
    confirmProceed: requireNode('confirm-proceed'), confirmCancel: requireNode('confirm-cancel'),
    outputs: ['result-pixels', 'result-size', 'result-ppi', 'result-target', 'result-required'].map(requireNode)
  };
  for (const [field, input] of Object.entries(fields)) {
    requireNode(`${field}-error`);
    input.addEventListener('input', () => invalidate());
  }
  ui.clear.addEventListener('click', () => confirmAction('clear', ui.clear));
  ui.language.addEventListener('click', event => {
    event.preventDefault();
    if (ready) confirmAction('language', ui.language);
  });
  ui.confirmCancel.addEventListener('click', closeConfirmation);
  ui.dialog.addEventListener('cancel', event => { event.preventDefault(); closeConfirmation(); });
  ui.confirmProceed.addEventListener('click', () => {
    const action = pendingAction;
    closeConfirmation();
    reset(action === 'clear');
    if (action === 'language') window.location.assign(english ? '/index.html' : '/en/index.html');
    else fields.pixelWidthRaw.focus();
  });
  ui.decimal.addEventListener('click', () => {
    const input = fields.widthMmRaw;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    if (input.value.length - (end - start) + 1 <= input.maxLength) {
      input.setRangeText('.', start, end, 'end');
      invalidate();
    }
    input.focus();
  });
  window.addEventListener('pagehide', () => { if (ui.dialog.open) closeConfirmation(); reset(); });
  window.addEventListener('pageshow', event => { if (event.persisted) reset(); });
  reset();
  ready = true;
  ui.init.hidden = true;
  ui.fieldset.disabled = false;
  for (const control of [ui.calculate, ui.clear, ui.decimal, ui.language, ui.confirmProceed, ui.confirmCancel]) control.disabled = false;
} catch {
  ready = false;
  if (ui) {
    ui.fieldset.disabled = true;
    for (const control of [ui.calculate, ui.clear, ui.decimal, ui.language, ui.confirmProceed, ui.confirmCancel]) control.disabled = true;
  }
  // The fixed initial notice remains visible; exceptions and inputs are never logged.
}
