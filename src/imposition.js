'use strict';

/**
 * 骑马钉（saddle-stitch）小册子拼版核心逻辑。
 *
 * 单帖模式：总页数 N 必须为 4 的倍数，共 N/4 张纸，每张纸正反两面、每面左右两版。
 * 第 i 张纸（1 起，最外层为第 1 张）的标准拼版为：
 *   正面：左版 = N - 2(i-1)，右版 = 2i - 1
 *   反面：左版 = 2i，        右版 = N - 2i + 1
 * 特性：每面左右页码之和 = N + 1；左版恒为偶数页、右版恒为奇数页；
 *       正面左版与反面右版同属一张书叶（连续页），正面右版与反面左版同理。
 *
 * 分帖模式：用户设置每帖最多纸张数 M（1~8），每帖容量为 4M 个成品页，
 * 成品页按顺序切成容量 4M 的连续区间（最后一帖取剩余页）；
 * 每个区间即一帖，帖内按上述骑马钉公式独立拼版（局部页码映射到全局页码），
 * 仅最后一帖把剩余页补空白至 4 的倍数。跨帖页码必须连续、无重复、无缺失。
 */

const SIDES = ['front', 'back'];
const POSITIONS = ['left', 'right'];
const SIDE_LABEL = { front: '正面', back: '反面' };
const POS_LABEL = { left: '左版', right: '右版' };

const MAX_PAGES = 500;
const MAX_SHEETS_PER_SIGNATURE = 8;

/** 将页数补齐到 4 的倍数 */
function padToMultipleOf4(n) {
  const r = n % 4;
  return r === 0 ? n : n + (4 - r);
}

/** 第 sheetIndex 张纸（1 起）某面某版位在「帖内局部页码」下的标准页码 */
function expectedPage(sheetIndex, side, position, totalPages) {
  const N = totalPages;
  const i = sheetIndex;
  if (side === 'front') {
    return position === 'left' ? N - 2 * (i - 1) : 2 * i - 1;
  }
  return position === 'left' ? 2 * i : N - 2 * i + 1;
}

/**
 * 分帖方案：按成品页顺序切分为容量 4M 的连续区间，仅最后一帖补空白至 4 的倍数。
 * 返回 [{ sig, sheetCount, startPage, endPage, contentEndPage }]：
 *   sig            帖号（1 起）
 *   sheetCount     本帖纸张数（补齐至 4 的倍数后）
 *   startPage      本帖起始成品页（全局页码）
 *   endPage        本帖补齐后的末页页码（含空白页位）
 *   contentEndPage 本帖最后一张有内容成品页的页码
 */
function planSignatures(pages, maxSheetsPerSignature) {
  const capacity = 4 * maxSheetsPerSignature;
  const plan = [];
  let remaining = pages;
  let start = 1;
  let sig = 1;
  while (remaining > 0) {
    const take = Math.min(remaining, capacity); // 本帖承载的成品页数
    const padded = padToMultipleOf4(take); // 非末帖 take=capacity 必为 4 的倍数
    plan.push({
      sig,
      sheetCount: padded / 4,
      startPage: start,
      endPage: start + padded - 1,
      contentEndPage: start + take - 1,
    });
    start += take;
    remaining -= take;
    sig += 1;
  }
  return plan;
}

/**
 * 构建一帖的纸张拼版（局部页码按骑马钉公式生成后映射为全局页码）。
 * startPage 本帖起始全局页码；localN 本帖补齐后总页数；contentCount 本帖有内容页数。
 * sigIndex 为 null 时构建旧单帖结构（纸张不带 sig 字段，保持 API 兼容）。
 */
function buildSheets(startPage, localN, contentCount, sigIndex) {
  const sheets = [];
  for (let i = 1; i <= localN / 4; i++) {
    const sheet = sigIndex == null
      ? { index: i, front: {}, back: {} }
      : { sig: sigIndex, index: i, front: {}, back: {} };
    for (const side of SIDES) {
      for (const pos of POSITIONS) {
        const localPage = expectedPage(i, side, pos, localN);
        const globalPage = startPage - 1 + localPage;
        sheet[side][pos] = localPage <= contentCount ? globalPage : null;
      }
    }
    sheets.push(sheet);
  }
  return sheets;
}

/**
 * 生成标准拼版。
 *  - generateImposition(pages)：单帖模式（兼容旧调用），
 *    版位内容为页码（1..pages）或 null（空白版位）。
 *  - generateImposition(pages, maxSheetsPerSignature)：分帖模式，
 *    返回 signatures 分组，每帖纸张带 sig / index，区间外版位为 null。
 */
function generateImposition(pages, maxSheetsPerSignature) {
  const totalPages = padToMultipleOf4(pages);

  if (maxSheetsPerSignature === undefined || maxSheetsPerSignature === null) {
    const sheets = buildSheets(1, totalPages, pages, null);
    return { pages, totalPages, sheetCount: totalPages / 4, sheets };
  }

  const M = Number(maxSheetsPerSignature);
  if (!Number.isInteger(M) || M < 1 || M > MAX_SHEETS_PER_SIGNATURE) {
    throw new RangeError(`每帖最多纸张数必须是 1~${MAX_SHEETS_PER_SIGNATURE} 的整数`);
  }

  const plan = planSignatures(pages, M);
  const signatures = plan.map((p) => ({
    sig: p.sig,
    sheetCount: p.sheetCount,
    startPage: p.startPage,
    endPage: p.endPage,
    sheets: buildSheets(
      p.startPage,
      p.endPage - p.startPage + 1,
      p.contentEndPage - p.startPage + 1,
      p.sig
    ),
  }));

  return {
    pages,
    totalPages,
    sheetCount: totalPages / 4,
    signatureCount: plan.length,
    sheetsPerSignature: M,
    signatures,
  };
}

/** 读取并规范化一张纸；结构不合法返回 null */
function readSheet(rawSheet, sig, index) {
  if (!rawSheet || typeof rawSheet !== 'object') return null;
  if (sig != null) {
    if (Number(rawSheet.sig) !== sig || Number(rawSheet.index) !== index) return null;
  }
  const sheet = sig == null
    ? { index, front: {}, back: {} }
    : { sig, index, front: {}, back: {} };
  for (const side of SIDES) {
    if (!rawSheet[side] || typeof rawSheet[side] !== 'object') return null;
    for (const pos of POSITIONS) {
      const v = rawSheet[side][pos];
      if (v === null || v === undefined) {
        sheet[side][pos] = null;
        continue;
      }
      const n = Number(v);
      if (!Number.isInteger(n)) return null;
      sheet[side][pos] = n;
    }
  }
  return sheet;
}

/** 校验并规范化前端提交的状态；结构不合法时返回 null */
function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const pages = Number(raw.pages);
  if (!Number.isInteger(pages) || pages < 1 || pages > MAX_PAGES) return null;
  const totalPages = Number(raw.totalPages);
  if (!Number.isInteger(totalPages) || totalPages !== padToMultipleOf4(pages)) return null;

  // 分帖模式
  if (Array.isArray(raw.signatures)) {
    const M = Number(raw.sheetsPerSignature);
    if (!Number.isInteger(M) || M < 1 || M > MAX_SHEETS_PER_SIGNATURE) return null;
    if (!Number.isInteger(raw.signatureCount) || !Number.isInteger(raw.sheetCount)) return null;
    if (raw.sheetCount !== totalPages / 4) return null;

    const plan = planSignatures(pages, M);
    if (raw.signatureCount !== plan.length) return null;
    if (raw.signatures.length !== plan.length) return null;

    const signatures = [];
    const flatSheets = [];
    for (let k = 0; k < plan.length; k++) {
      const piece = plan[k];
      const rawSig = raw.signatures[k];
      if (!rawSig || typeof rawSig !== 'object') return null;
      if (Number(rawSig.sig) !== piece.sig) return null;
      if (Number(rawSig.sheetCount) !== piece.sheetCount) return null;
      if (Number(rawSig.startPage) !== piece.startPage) return null;
      if (Number(rawSig.endPage) !== piece.endPage) return null;
      if (!Array.isArray(rawSig.sheets) || rawSig.sheets.length !== piece.sheetCount) return null;

      const sheets = [];
      for (let i = 0; i < piece.sheetCount; i++) {
        const sheet = readSheet(rawSig.sheets[i], piece.sig, i + 1);
        if (!sheet) return null;
        sheets.push(sheet);
        flatSheets.push(sheet);
      }
      signatures.push({
        sig: piece.sig,
        sheetCount: piece.sheetCount,
        startPage: piece.startPage,
        endPage: piece.endPage,
        sheets,
      });
    }

    return {
      pages,
      totalPages,
      sheetCount: totalPages / 4,
      mode: 'multi',
      sheetsPerSignature: M,
      signatureCount: plan.length,
      signatures,
      sheets: flatSheets,
    };
  }

  // 单帖模式（兼容旧状态结构）
  if (!Array.isArray(raw.sheets) || raw.sheets.length !== totalPages / 4) return null;
  const sheets = [];
  for (let k = 0; k < raw.sheets.length; k++) {
    const sheet = readSheet(raw.sheets[k], null, k + 1);
    if (!sheet) return null;
    sheets.push(sheet);
  }
  return { pages, totalPages, sheetCount: totalPages / 4, mode: 'single', sheets };
}

/**
 * 实时校验：
 *  - duplicates：重复出现的有内容页
 *  - missing：缺失的有内容页
 *  - outOfRange：超出 1..N 的页码
 *  - crossSignature（仅分帖模式）：页码出现在错误的帖区间，跨帖页码不连续
 *  - pairing：每张纸的正反配对异常（空白错位、奇偶、页码和、书叶配对、套帖顺序）
 * 单帖错误定位到纸张/面/版位；分帖错误额外定位到帖。
 * 返回 { valid, errors, slotErrors }；结构非法返回 null。
 */
function validateImposition(raw) {
  const state = normalizeState(raw);
  if (!state) return null;
  const { pages: P, totalPages: N, mode, sheets } = state;
  const multi = mode === 'multi';

  const errors = { duplicates: [], missing: [], outOfRange: [] };
  if (multi) errors.crossSignature = [];
  errors.pairing = [];
  const slotErrors = [];
  const addSlot = (sig, sheet, side, pos, message) => {
    const entry = { sheet, side, pos, message };
    if (multi) entry.sig = sig;
    slotErrors.push(entry);
  };

  // 统计每个页码出现的位置
  const occurrences = new Map();
  for (const s of sheets) {
    for (const side of SIDES) {
      for (const pos of POSITIONS) {
        const v = s[side][pos];
        if (v === null) continue;
        if (!occurrences.has(v)) occurrences.set(v, []);
        occurrences.get(v).push({ sig: s.sig ?? null, sheet: s.index, side, pos });
      }
    }
  }

  // 页码超范围
  const out = [...occurrences.keys()].filter((p) => p < 1 || p > N).sort((a, b) => a - b);
  errors.outOfRange = out;
  for (const p of out) {
    for (const ref of occurrences.get(p)) {
      addSlot(ref.sig, ref.sheet, ref.side, ref.pos, `页码 ${p} 超出有效范围 1~${N}`);
    }
  }

  // 重复页（仅统计有内容页 1..P）
  for (const [p, refs] of occurrences) {
    if (p >= 1 && p <= P && refs.length > 1) {
      errors.duplicates.push(p);
      for (const ref of refs) {
        addSlot(ref.sig, ref.sheet, ref.side, ref.pos, `第 ${p} 页重复出现 ${refs.length} 次`);
      }
    }
  }
  errors.duplicates.sort((a, b) => a - b);

  // 缺页
  for (let p = 1; p <= P; p++) {
    if (!occurrences.has(p)) errors.missing.push(p);
  }

  // 待校验的帖：单帖视为起始页为 1 的唯一一帖
  const groups = multi
    ? state.signatures
    : [{ sig: null, startPage: 1, endPage: N, sheets }];

  // 分帖模式：为缺页定位到应排该页的帖/纸张/版位（标准位置若为空白，配对检查已覆盖）
  if (multi) {
    for (const p of errors.missing) {
      const g = state.signatures.find((sg) => p >= sg.startPage && p <= sg.endPage);
      if (!g) continue;
      const localN = g.endPage - g.startPage + 1;
      const base = g.startPage - 1;
      for (const s of g.sheets) {
        let hit = false;
        for (const side of SIDES) {
          for (const pos of POSITIONS) {
            if (s[side][pos] !== null) continue;
            if (base + expectedPage(s.index, side, pos, localN) === p) {
              addSlot(g.sig, s.index, side, pos, `缺失第 ${p} 页：此版位应排第 ${p} 页`);
              hit = true;
              break;
            }
          }
          if (hit) break;
        }
        if (hit) break;
      }
    }
  }

  // 每帖内部拼版规则检查
  for (const g of groups) {
    const base = g.startPage - 1;
    const localN = g.endPage - g.startPage + 1;
    const contentEnd = Math.min(P, g.endPage); // 本帖最后一张有内容页（全局页码）

    for (const s of g.sheets) {
      const i = s.index;
      const msgs = [];
      const exp = {
        front: { left: expectedPage(i, 'front', 'left', localN), right: expectedPage(i, 'front', 'right', localN) },
        back: { left: expectedPage(i, 'back', 'left', localN), right: expectedPage(i, 'back', 'right', localN) },
      };

      // 空白/实页错位检查，并计算用于规则校验的有效页码（空白版位按其应有页码参与）
      const eff = { front: {}, back: {} };
      let usable = true;
      for (const side of SIDES) {
        for (const pos of POSITIONS) {
          const v = s[side][pos];
          const eGlobal = base + exp[side][pos];
          const label = `${SIDE_LABEL[side]}${POS_LABEL[pos]}`;
          if (v === null) {
            if (eGlobal <= P) {
              msgs.push(`${label}应排第 ${eGlobal} 页，当前为空白`);
              addSlot(g.sig, i, side, pos, `应排第 ${eGlobal} 页，当前为空白`);
              usable = false;
            } else {
              eff[side][pos] = eGlobal;
            }
          } else {
            if (eGlobal > P) {
              msgs.push(`${label}应为空白版位，当前排了第 ${v} 页`);
              addSlot(g.sig, i, side, pos, '此版位应为空白');
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
        const targetSum = g.startPage + g.endPage;

        // 奇偶规则：左版为偶数页，右版为奇数页（帖起点偏移为 4 的倍数，奇偶性与帖内一致）
        for (const side of SIDES) {
          const L = eff[side].left;
          const R = eff[side].right;
          if (L % 2 !== 0) {
            msgs.push(`${SIDE_LABEL[side]}左版应为偶数页，当前为第 ${L} 页`);
            addSlot(g.sig, i, side, 'left', '左版应为偶数页');
          }
          if (R % 2 !== 1) {
            msgs.push(`${SIDE_LABEL[side]}右版应为奇数页，当前为第 ${R} 页`);
            addSlot(g.sig, i, side, 'right', '右版应为奇数页');
          }
        }

        // 每面左右页码之和 = 帖起点 + 帖末页
        for (const side of SIDES) {
          const sum = eff[side].left + eff[side].right;
          if (sum !== targetSum) {
            msgs.push(`${SIDE_LABEL[side]}左右页码之和应为 ${targetSum}，当前为 ${sum}`);
            addSlot(g.sig, i, side, 'left', `左右页码之和应为 ${targetSum}`);
            addSlot(g.sig, i, side, 'right', `左右页码之和应为 ${targetSum}`);
          }
        }

        // 书叶配对：正面左↔反面右、正面右↔反面左 应为连续页（同一张书叶的正反）
        const mates = (a, b) => Math.abs(a - b) === 1 && Math.min(a, b) % 2 === 1;
        if (!mates(FL, BR)) {
          msgs.push(`正面左版（第 ${FL} 页）与反面右版（第 ${BR} 页）应同属一张书叶（连续页）`);
          addSlot(g.sig, i, 'front', 'left', '与反面右版书叶配对异常');
          addSlot(g.sig, i, 'back', 'right', '与正面左版书叶配对异常');
        }
        if (!mates(FR, BL)) {
          msgs.push(`正面右版（第 ${FR} 页）与反面左版（第 ${BL} 页）应同属一张书叶（连续页）`);
          addSlot(g.sig, i, 'front', 'right', '与反面左版书叶配对异常');
          addSlot(g.sig, i, 'back', 'left', '与正面右版书叶配对异常');
        }

        // 套帖顺序：本张纸的页码组合应与其在帖内的嵌套位置一致
        const want = [exp.front.left, exp.front.right, exp.back.left, exp.back.right]
          .map((x) => base + x)
          .sort((a, b) => a - b);
        const got = [FL, FR, BL, BR].slice().sort((a, b) => a - b);
        if (want.some((w, k) => got[k] !== w)) {
          msgs.push(`本张纸页码组合应为 {${want.join(', ')}}，当前为 {${got.join(', ')}}（套帖顺序异常）`);
          for (const side of SIDES) {
            for (const pos of POSITIONS) addSlot(g.sig, i, side, pos, '纸张页码组合与套帖顺序不符');
          }
        }
      }

      if (msgs.length) {
        const entry = { sheet: i, messages: msgs };
        if (multi) entry.sig = g.sig;
        errors.pairing.push(entry);
      }
    }

    // 跨帖连续性：本帖所有有内容版位必须落在本帖连续区间内
    if (multi) {
      const reported = new Set();
      for (const s of g.sheets) {
        for (const side of SIDES) {
          for (const pos of POSITIONS) {
            const v = s[side][pos];
            if (v === null) continue;
            if (v < g.startPage || v > contentEnd) {
              addSlot(
                g.sig,
                s.index,
                side,
                pos,
                `第 ${v} 页不属于第 ${g.sig} 帖区间（第 ${g.startPage}～${contentEnd} 页），跨帖页码不连续`
              );
              if (!reported.has(v)) {
                reported.add(v);
                errors.crossSignature.push({
                  sig: g.sig,
                  page: v,
                  message: `第 ${v} 页出现在第 ${g.sig} 帖，但本帖应为第 ${g.startPage}～${contentEnd} 页的连续区间`,
                });
              }
            }
          }
        }
      }
    }
  }

  if (multi) errors.crossSignature.sort((a, b) => a.sig - b.sig || a.page - b.page);

  const valid =
    errors.duplicates.length === 0 &&
    errors.missing.length === 0 &&
    errors.outOfRange.length === 0 &&
    (!multi || errors.crossSignature.length === 0) &&
    errors.pairing.length === 0;

  return { valid, errors, slotErrors };
}

/** 生成 CSV（带 BOM，Excel 友好）；结构非法返回 null */
function buildCsv(raw) {
  const state = normalizeState(raw);
  if (!state) return null;
  const cell = (v) => (v === null ? '空白' : String(v));

  // 单帖模式：保持旧 CSV 格式
  if (state.mode === 'single') {
    const rows = [['纸张序号', '面别', '左版页码', '右版页码']];
    for (const s of state.sheets) {
      for (const side of SIDES) {
        rows.push([String(s.index), SIDE_LABEL[side], cell(s[side].left), cell(s[side].right)]);
      }
    }
    return '﻿' + rows.map((r) => r.join(',')).join('\r\n') + '\r\n';
  }

  // 分帖模式：新增帖号与帖内纸张序号
  const rows = [['帖号', '帖内纸张序号', '面别', '左版页码', '右版页码']];
  for (const g of state.signatures) {
    for (const s of g.sheets) {
      for (const side of SIDES) {
        rows.push([
          String(g.sig),
          String(s.index),
          SIDE_LABEL[side],
          cell(s[side].left),
          cell(s[side].right),
        ]);
      }
    }
  }
  return '﻿' + rows.map((r) => r.join(',')).join('\r\n') + '\r\n';
}

module.exports = {
  MAX_PAGES,
  MAX_SHEETS_PER_SIGNATURE,
  padToMultipleOf4,
  expectedPage,
  planSignatures,
  generateImposition,
  normalizeState,
  validateImposition,
  buildCsv,
};
