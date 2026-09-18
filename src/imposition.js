'use strict';

/**
 * 骑马钉（saddle-stitch）小册子拼版核心逻辑。
 *
 * 规则：总页数 N 必须为 4 的倍数，共 N/4 张纸，每张纸正反两面、每面左右两版。
 * 第 i 张纸（1 起，最外层为第 1 张）的标准拼版为：
 *   正面：左版 = N - 2(i-1)，右版 = 2i - 1
 *   反面：左版 = 2i，        右版 = N - 2i + 1
 * 特性：每面左右页码之和 = N + 1；左版恒为偶数页、右版恒为奇数页；
 *       正面左版与反面右版同属一张书叶（连续页），正面右版与反面左版同理。
 */

const SIDES = ['front', 'back'];
const POSITIONS = ['left', 'right'];
const SIDE_LABEL = { front: '正面', back: '反面' };
const POS_LABEL = { left: '左版', right: '右版' };

const MAX_PAGES = 500;

/** 将页数补齐到 4 的倍数 */
function padToMultipleOf4(n) {
  const r = n % 4;
  return r === 0 ? n : n + (4 - r);
}

/** 第 sheetIndex 张纸（1 起）某面某版位的标准页码 */
function expectedPage(sheetIndex, side, position, totalPages) {
  const N = totalPages;
  const i = sheetIndex;
  if (side === 'front') {
    return position === 'left' ? N - 2 * (i - 1) : 2 * i - 1;
  }
  return position === 'left' ? 2 * i : N - 2 * i + 1;
}

/**
 * 生成标准拼版。
 * 版位内容为页码（1..pages）或 null（空白版位，即补齐出来的页）。
 */
function generateImposition(pages) {
  const totalPages = padToMultipleOf4(pages);
  const sheetCount = totalPages / 4;
  const sheets = [];
  for (let i = 1; i <= sheetCount; i++) {
    const sheet = { index: i, front: {}, back: {} };
    for (const side of SIDES) {
      for (const pos of POSITIONS) {
        const p = expectedPage(i, side, pos, totalPages);
        sheet[side][pos] = p <= pages ? p : null;
      }
    }
    sheets.push(sheet);
  }
  return { pages, totalPages, sheetCount, sheets };
}

/** 校验并规范化前端提交的状态；结构不合法时返回 null */
function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const pages = Number(raw.pages);
  const totalPages = Number(raw.totalPages);
  if (!Number.isInteger(pages) || pages < 1 || pages > MAX_PAGES) return null;
  if (!Number.isInteger(totalPages) || totalPages !== padToMultipleOf4(pages)) return null;
  if (!Array.isArray(raw.sheets) || raw.sheets.length !== totalPages / 4) return null;
  const sheets = [];
  for (let k = 0; k < raw.sheets.length; k++) {
    const s = raw.sheets[k];
    if (!s || typeof s !== 'object') return null;
    const sheet = { index: k + 1, front: {}, back: {} };
    for (const side of SIDES) {
      if (!s[side] || typeof s[side] !== 'object') return null;
      for (const pos of POSITIONS) {
        const v = s[side][pos];
        if (v === null || v === undefined) {
          sheet[side][pos] = null;
          continue;
        }
        const n = Number(v);
        if (!Number.isInteger(n)) return null;
        sheet[side][pos] = n;
      }
    }
    sheets.push(sheet);
  }
  return { pages, totalPages, sheetCount: totalPages / 4, sheets };
}

/**
 * 实时校验：
 *  - duplicates：重复出现的有内容页
 *  - missing：缺失的有内容页
 *  - outOfRange：超出 1..N 的页码
 *  - pairing：每张纸的正反配对异常（空白错位、奇偶、页码和、书叶配对、套帖顺序）
 * 返回 { valid, errors, slotErrors }；结构非法返回 null。
 */
function validateImposition(raw) {
  const state = normalizeState(raw);
  if (!state) return null;
  const { pages: P, totalPages: N, sheets } = state;

  const errors = { duplicates: [], missing: [], outOfRange: [], pairing: [] };
  const slotErrors = [];
  const addSlot = (sheet, side, pos, message) => slotErrors.push({ sheet, side, pos, message });

  // 统计每个页码出现的位置
  const occurrences = new Map();
  for (const s of sheets) {
    for (const side of SIDES) {
      for (const pos of POSITIONS) {
        const v = s[side][pos];
        if (v === null) continue;
        if (!occurrences.has(v)) occurrences.set(v, []);
        occurrences.get(v).push({ sheet: s.index, side, pos });
      }
    }
  }

  // 页码超范围
  const out = [...occurrences.keys()].filter((p) => p < 1 || p > N).sort((a, b) => a - b);
  errors.outOfRange = out;
  for (const p of out) {
    for (const ref of occurrences.get(p)) {
      addSlot(ref.sheet, ref.side, ref.pos, `页码 ${p} 超出有效范围 1~${N}`);
    }
  }

  // 重复页（仅统计有内容页 1..P）
  for (const [p, refs] of occurrences) {
    if (p >= 1 && p <= P && refs.length > 1) {
      errors.duplicates.push(p);
      for (const ref of refs) {
        addSlot(ref.sheet, ref.side, ref.pos, `第 ${p} 页重复出现 ${refs.length} 次`);
      }
    }
  }
  errors.duplicates.sort((a, b) => a - b);

  // 缺页
  for (let p = 1; p <= P; p++) {
    if (!occurrences.has(p)) errors.missing.push(p);
  }

  // 同张纸正反配对检查
  for (const s of sheets) {
    const i = s.index;
    const msgs = [];
    const exp = {
      front: { left: expectedPage(i, 'front', 'left', N), right: expectedPage(i, 'front', 'right', N) },
      back: { left: expectedPage(i, 'back', 'left', N), right: expectedPage(i, 'back', 'right', N) },
    };

    // 空白/实页错位检查，并计算用于规则校验的有效页码（空白版位按其应有页码参与）
    const eff = { front: {}, back: {} };
    let usable = true;
    for (const side of SIDES) {
      for (const pos of POSITIONS) {
        const v = s[side][pos];
        const e = exp[side][pos];
        const label = `${SIDE_LABEL[side]}${POS_LABEL[pos]}`;
        if (v === null) {
          if (e <= P) {
            msgs.push(`${label}应排第 ${e} 页，当前为空白`);
            addSlot(i, side, pos, `应排第 ${e} 页，当前为空白`);
            usable = false;
          } else {
            eff[side][pos] = e;
          }
        } else {
          if (e > P) {
            msgs.push(`${label}应为空白版位，当前排了第 ${v} 页`);
            addSlot(i, side, pos, '此版位应为空白');
          }
          eff[side][pos] = v;
        }
      }
    }

    if (usable) {
      const FL = eff.front.left;
      const FR = eff.front.right;
      const BL = eff.back.left;
      const BR = eff.back.right;

      // 奇偶规则：左版为偶数页，右版为奇数页
      for (const side of SIDES) {
        const L = eff[side].left;
        const R = eff[side].right;
        if (L % 2 !== 0) {
          msgs.push(`${SIDE_LABEL[side]}左版应为偶数页，当前为第 ${L} 页`);
          addSlot(i, side, 'left', '左版应为偶数页');
        }
        if (R % 2 !== 1) {
          msgs.push(`${SIDE_LABEL[side]}右版应为奇数页，当前为第 ${R} 页`);
          addSlot(i, side, 'right', '右版应为奇数页');
        }
      }

      // 每面左右页码之和 = N + 1
      for (const side of SIDES) {
        const sum = eff[side].left + eff[side].right;
        if (sum !== N + 1) {
          msgs.push(`${SIDE_LABEL[side]}左右页码之和应为 ${N + 1}，当前为 ${sum}`);
          addSlot(i, side, 'left', `左右页码之和应为 ${N + 1}`);
          addSlot(i, side, 'right', `左右页码之和应为 ${N + 1}`);
        }
      }

      // 书叶配对：正面左↔反面右、正面右↔反面左 应为连续页（同一张书叶的正反）
      const mates = (a, b) => Math.abs(a - b) === 1 && Math.min(a, b) % 2 === 1;
      if (!mates(FL, BR)) {
        msgs.push(`正面左版（第 ${FL} 页）与反面右版（第 ${BR} 页）应同属一张书叶（连续页）`);
        addSlot(i, 'front', 'left', '与反面右版书叶配对异常');
        addSlot(i, 'back', 'right', '与正面左版书叶配对异常');
      }
      if (!mates(FR, BL)) {
        msgs.push(`正面右版（第 ${FR} 页）与反面左版（第 ${BL} 页）应同属一张书叶（连续页）`);
        addSlot(i, 'front', 'right', '与反面左版书叶配对异常');
        addSlot(i, 'back', 'left', '与正面右版书叶配对异常');
      }

      // 套帖顺序：本张纸的页码组合应与嵌套位置一致
      const want = [exp.front.left, exp.front.right, exp.back.left, exp.back.right].sort((a, b) => a - b);
      const got = [FL, FR, BL, BR].slice().sort((a, b) => a - b);
      if (want.some((w, k) => got[k] !== w)) {
        msgs.push(`本张纸页码组合应为 {${want.join(', ')}}，当前为 {${got.join(', ')}}（套帖顺序异常）`);
        for (const side of SIDES) {
          for (const pos of POSITIONS) addSlot(i, side, pos, '纸张页码组合与套帖顺序不符');
        }
      }
    }

    if (msgs.length) errors.pairing.push({ sheet: i, messages: msgs });
  }

  const valid =
    errors.duplicates.length === 0 &&
    errors.missing.length === 0 &&
    errors.outOfRange.length === 0 &&
    errors.pairing.length === 0;

  return { valid, errors, slotErrors };
}

/** 生成 CSV（带 BOM，Excel 友好）；结构非法返回 null */
function buildCsv(raw) {
  const state = normalizeState(raw);
  if (!state) return null;
  const cell = (v) => (v === null ? '空白' : String(v));
  const rows = [['纸张序号', '面别', '左版页码', '右版页码']];
  for (const s of state.sheets) {
    for (const side of SIDES) {
      rows.push([String(s.index), SIDE_LABEL[side], cell(s[side].left), cell(s[side].right)]);
    }
  }
  return '\uFEFF' + rows.map((r) => r.join(',')).join('\r\n') + '\r\n';
}

module.exports = {
  MAX_PAGES,
  padToMultipleOf4,
  expectedPage,
  generateImposition,
  normalizeState,
  validateImposition,
  buildCsv,
};
