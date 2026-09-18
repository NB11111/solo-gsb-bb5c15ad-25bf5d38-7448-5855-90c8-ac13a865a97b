'use strict';

const els = {
  pagesInput: document.getElementById('pagesInput'),
  generateBtn: document.getElementById('generateBtn'),
  resetBtn: document.getElementById('resetBtn'),
  exportBtn: document.getElementById('exportBtn'),
  swapModeBtn: document.getElementById('swapModeBtn'),
  editModeBtn: document.getElementById('editModeBtn'),
  modeHint: document.getElementById('modeHint'),
  summary: document.getElementById('summary'),
  sheets: document.getElementById('sheets'),
  errors: document.getElementById('errors'),
  emptyTip: document.getElementById('emptyTip'),
  nestTip: document.getElementById('nestTip'),
};

const SIDE_LABEL = { front: '正面', back: '反面' };
const POS_LABEL = { left: '左版', right: '右版' };
const MODE_HINT = {
  swap: '交换模式：依次点击两个版位，即可交换它们的页码（再次点击已选中的版位可取消选择）。',
  edit: '编辑模式：点击任意版位，可直接输入页码或设为空白。',
};

let state = null; // 当前拼版状态 { pages, totalPages, sheetCount, sheets }
let original = null; // 初始标准拼版（用于重置）
let mode = 'swap'; // 'swap' | 'edit'
let selected = null; // 交换模式下已选中的版位 { sheet, side, pos }
let validateTimer = null;

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败（HTTP ${res.status}）`);
  return data;
}

function getSlot(ref) {
  return state.sheets[ref.sheet - 1][ref.side][ref.pos];
}

function setSlot(ref, value) {
  state.sheets[ref.sheet - 1][ref.side][ref.pos] = value;
}

/* ---------- 生成 / 重置 ---------- */

async function generate() {
  const pages = Number(els.pagesInput.value);
  try {
    const data = await api('/api/generate', { pages });
    state = data;
    original = structuredClone(data);
    selected = null;
    render();
    scheduleValidate();
  } catch (e) {
    alert(e.message);
  }
}

function reset() {
  if (!original) return;
  state = structuredClone(original);
  selected = null;
  render();
  scheduleValidate();
}

/* ---------- 渲染 ---------- */

function render() {
  if (!state) return;
  els.emptyTip.hidden = true;
  els.nestTip.hidden = false;
  els.summary.textContent =
    `成品 ${state.pages} 页 → 补齐至 ${state.totalPages} 页` +
    `（空白 ${state.totalPages - state.pages} 页） · 共 ${state.sheetCount} 张纸 · 每张正反 2 面、每面左右 2 版`;

  els.sheets.innerHTML = '';
  state.sheets.forEach((sheet, idx) => {
    const card = document.createElement('section');
    card.className = 'sheet';
    card.style.setProperty('--indent', idx);
    card.dataset.sheet = sheet.index;

    const nestLabel =
      idx === 0 ? '最外层' : idx === state.sheets.length - 1 && idx > 0 ? '最内层' : '';
    const header = document.createElement('header');
    header.innerHTML = `<strong>第 ${sheet.index} 张纸</strong>` +
      (nestLabel ? `<span class="nest">${nestLabel}</span>` : '');
    card.appendChild(header);

    for (const side of ['front', 'back']) {
      const row = document.createElement('div');
      row.className = 'side';
      const label = document.createElement('span');
      label.className = 'side-label';
      label.textContent = SIDE_LABEL[side];
      row.appendChild(label);
      for (const pos of ['left', 'right']) {
        row.appendChild(renderSlot(sheet.index, side, pos, sheet[side][pos]));
      }
      card.appendChild(row);
    }
    els.sheets.appendChild(card);
  });

  els.resetBtn.disabled = false;
  updateModeUI();
}

function renderSlot(sheetIndex, side, pos, value) {
  const slot = document.createElement('div');
  slot.className = 'slot' + (value === null ? ' blank' : '');
  slot.dataset.sheet = sheetIndex;
  slot.dataset.side = side;
  slot.dataset.pos = pos;
  slot.setAttribute('role', 'button');
  slot.tabIndex = 0;

  const posEl = document.createElement('span');
  posEl.className = 'pos';
  posEl.textContent = POS_LABEL[pos];
  const pageEl = document.createElement('span');
  pageEl.className = 'page';
  pageEl.textContent = value === null ? '空白' : `第 ${value} 页`;
  slot.append(posEl, pageEl);

  if (selected && selected.sheet === sheetIndex && selected.side === side && selected.pos === pos) {
    slot.classList.add('selected');
  }
  slot.addEventListener('click', () => onSlotClick(sheetIndex, side, pos, slot));
  return slot;
}

/* ---------- 交互：交换 / 编辑 ---------- */

function onSlotClick(sheetIndex, side, pos, el) {
  if (el.classList.contains('editing')) return;

  if (mode === 'edit') {
    openEditor(sheetIndex, side, pos, el);
    return;
  }

  // 交换模式
  if (!selected) {
    selected = { sheet: sheetIndex, side, pos };
    el.classList.add('selected');
    return;
  }
  if (selected.sheet === sheetIndex && selected.side === side && selected.pos === pos) {
    selected = null;
    el.classList.remove('selected');
    return;
  }
  const target = { sheet: sheetIndex, side, pos };
  const tmp = getSlot(selected);
  setSlot(selected, getSlot(target));
  setSlot(target, tmp);
  selected = null;
  render();
  scheduleValidate();
}

function openEditor(sheetIndex, side, pos, el) {
  const ref = { sheet: sheetIndex, side, pos };
  const current = getSlot(ref);
  el.classList.add('editing');
  el.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'slot-editor';
  wrap.addEventListener('click', (e) => e.stopPropagation());

  const input = document.createElement('input');
  input.type = 'number';
  input.min = 1;
  input.max = state.pages;
  input.placeholder = `1~${state.pages}`;
  if (current !== null) input.value = current;

  const btns = document.createElement('div');
  btns.className = 'btns';
  const okBtn = document.createElement('button');
  okBtn.textContent = '确定';
  const blankBtn = document.createElement('button');
  blankBtn.textContent = '空白';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '取消';
  btns.append(okBtn, blankBtn, cancelBtn);
  wrap.append(input, btns);
  el.appendChild(wrap);
  input.focus();
  input.select();

  const commit = (value) => {
    setSlot(ref, value);
    render();
    scheduleValidate();
  };
  okBtn.addEventListener('click', () => {
    const raw = input.value.trim();
    if (raw === '') {
      commit(null);
      return;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > state.pages) {
      alert(`页码须为 1~${state.pages} 的整数，或留空表示空白版位`);
      return;
    }
    commit(n);
  });
  blankBtn.addEventListener('click', () => commit(null));
  cancelBtn.addEventListener('click', () => render());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') okBtn.click();
    if (e.key === 'Escape') cancelBtn.click();
  });
}

function updateModeUI() {
  els.swapModeBtn.classList.toggle('active', mode === 'swap');
  els.editModeBtn.classList.toggle('active', mode === 'edit');
  els.modeHint.textContent = MODE_HINT[mode];
}

/* ---------- 校验 ---------- */

function scheduleValidate() {
  clearTimeout(validateTimer);
  validateTimer = setTimeout(validateNow, 200);
}

async function validateNow() {
  if (!state) return;
  try {
    const result = await api('/api/validate', state);
    renderErrors(result);
    markSlotErrors(result.slotErrors || []);
    els.exportBtn.disabled = !result.valid;
  } catch (e) {
    els.errors.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = `校验请求失败：${e.message}`;
    els.errors.appendChild(p);
    els.exportBtn.disabled = true;
  }
}

function renderErrors(result) {
  els.errors.innerHTML = '';
  if (result.valid) {
    const p = document.createElement('p');
    p.className = 'ok';
    p.textContent = '✓ 校验通过：页码无重复、无缺失，各纸张正反配对正确，可以导出 CSV。';
    els.errors.appendChild(p);
    return;
  }
  const e = result.errors;
  if (e.duplicates.length) {
    addErrGroup(`重复页：${e.duplicates.map((p) => `第 ${p} 页`).join('、')}`);
  }
  if (e.missing.length) {
    addErrGroup(`缺页：${e.missing.map((p) => `第 ${p} 页`).join('、')}`);
  }
  if (e.outOfRange.length) {
    addErrGroup(`页码超出范围：${e.outOfRange.map((p) => `第 ${p} 页`).join('、')}`);
  }
  for (const p of e.pairing) {
    const div = document.createElement('div');
    div.className = 'err-group';
    const title = document.createElement('strong');
    title.textContent = `第 ${p.sheet} 张纸配对异常：`;
    const ul = document.createElement('ul');
    for (const m of p.messages) {
      const li = document.createElement('li');
      li.textContent = m;
      ul.appendChild(li);
    }
    div.append(title, ul);
    els.errors.appendChild(div);
  }
}

function addErrGroup(text) {
  const div = document.createElement('div');
  div.className = 'err-group';
  const strong = document.createElement('strong');
  strong.textContent = text;
  div.appendChild(strong);
  els.errors.appendChild(div);
}

function markSlotErrors(slotErrors) {
  els.sheets.querySelectorAll('.slot.error').forEach((el) => {
    el.classList.remove('error');
    el.removeAttribute('title');
  });
  els.sheets.querySelectorAll('.sheet.has-error').forEach((el) => el.classList.remove('has-error'));

  const byKey = new Map();
  for (const se of slotErrors) {
    const key = `${se.sheet}|${se.side}|${se.pos}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(se.message);
  }
  for (const [key, messages] of byKey) {
    const [sheet, side, pos] = key.split('|');
    const el = els.sheets.querySelector(
      `.slot[data-sheet="${sheet}"][data-side="${side}"][data-pos="${pos}"]`
    );
    if (!el) continue;
    el.classList.add('error');
    el.title = [...new Set(messages)].join('\n');
    const card = el.closest('.sheet');
    if (card) card.classList.add('has-error');
  }
}

/* ---------- 导出 ---------- */

async function exportCsv() {
  if (!state) return;
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || '导出失败');
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `imposition-${state.totalPages}p.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- 事件绑定 ---------- */

els.generateBtn.addEventListener('click', generate);
els.resetBtn.addEventListener('click', reset);
els.exportBtn.addEventListener('click', exportCsv);
els.pagesInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') generate();
});
els.swapModeBtn.addEventListener('click', () => {
  mode = 'swap';
  selected = null;
  render();
});
els.editModeBtn.addEventListener('click', () => {
  mode = 'edit';
  selected = null;
  render();
});

updateModeUI();
