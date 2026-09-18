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
 * 分帖模式：按成品页顺序把 1..N 切成若干连续区间（帖），除最后一帖外每帖
 * 容量均为 maxSheetsPerSection * 4 页（满帖）；仅最后一帖补空白至 4 的倍数。
 * 每帖内部独立按骑马钉规则拼版：帖首页相当于该帖的第 1 页，帖内第 j 张纸
 * 套用上述公式后再加上帖起始页偏移。由于帖容量是 4 的倍数，全局页码与帖内
 * 页码奇偶一致，「左偶右奇」「书叶连续」等规则在全局页码下同样成立。
 */

const SIDES = ['front', 'back'];
const POSITIONS = ['left', 'right'];
const SIDE_LABEL = { front: '正面', back: '反面' };
const POS_LABEL = { left: '左版', right: '右版' };

const MAX_PAGES = 500;
const MAX_SECTION_SHEETS = 8;

/** 将页数补齐到 4 的倍数 */
function padToMultipleOf4(n) {
  const r = n % 4;
  return r === 0 ? n : n + (4 - r);
}

/** 第 sheetIndex 张纸（1 起）某面某版位的标准页码（帖内局部页码） */
function expectedPage(sheetIndex, side, position, totalPages) {
  const N = totalPages;
  const i = sheetIndex;
  if (side === 'front') {
    return position === 'left' ? N - 2 * (i - 1) : 2 * i - 1;
  }
  return position === 'left' ? 2 * i : N - 2 * i + 1;
}

/**
 * 生成一张纸的四个版位。
 * localIndex 为帖内纸张序号（1 起），basePage 为该帖起始页（帖内第 1 页的全局页码），
 * sectionTotal 为该帖总页数（4 的倍数），pages 为成品页数（超出者为空白版位）。
 */
function buildSheet(localIndex, basePage, sectionTotal, pages) {
  const sheet = { index: localIndex, front: {}, back: {} };
  for (const side of SIDES) {
    for (const pos of POSITIONS) {
      const p = basePage + expectedPage(localIndex, side, pos, sectionTotal) - 1;
      sheet[side][pos] = p <= pages ? p : null;
    }
  }
  return sheet;
}

/**
 * 生成标准拼版。
 * 版位内容为页码（1..pages）或 null（空白版位，即补齐出来的页）。
 *
 * 单帖模式（不传 maxSheetsPerSection）：返回 { pages, totalPages, sheetCount, sheets }，
 * 与既有 API 完全兼容。
 *
 * 分帖模式（maxSheetsPerSection 为 1~8 的整数）：按成品页顺序切成容量为
 * maxSheetsPerSection * 4 页的连续区间，仅最后一帖补空白至 4 的倍数；
 * 额外返回 mode / maxSheetsPerSection / sectionCount / sections，
 * 每张纸带有 section（帖号）与 sectionIndex（帖内纸张序号），index 仍为全局序号。
 */
function generateImposition(pages, maxSheetsPerSection) {
  const totalPages = padToMultipleOf4(pages);

  if (maxSheetsPerSection === undefined || maxSheetsPerSection === null) {
    const sheetCount = totalPages / 4;
    const sheets = [];
    for (let i = 1; i <= sheetCount; i++) {
      sheets.push(buildSheet(i, 1, totalPages, pages));
    }
    return { pages, totalPages, sheetCount, sheets };
  }

  const capacity = maxSheetsPerSection * 4;
  const sections = [];
  const sheets = [];
  let startPage = 1;
  while (startPage <= totalPages) {
    const secTotal = Math.min(capacity, totalPages - startPage + 1);
    const secSheetCount = secTotal / 4;
    const section = {
      index: sections.length + 1,
      startPage,
      endPage: startPage + secTotal - 1,
      totalPages: secTotal,
      sheetCount: secSheetCount,
      sheetStart: sheets.length + 1,
    };
    sections.push(section);
    for (let j = 1; j <= secSheetCount; j++) {
      const sheet = buildSheet(j, startPage, secTotal, pages);
      sheet.index = sheets.length + 1;
      sheet.section = section.index;
      sheet.sectionIndex = j;
      sheets.push(sheet);
    }
    startPage += secTotal;
  }
  return {
    mode: 'sections',
    pages,
    totalPages,
    sheetCount: sheets.length,
    maxSheetsPerSection,
    sectionCount: sections.length,
    sections,
    sheets,
  };
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

  // 帖结构：单帖模式视为一个覆盖全部页的帖
  let mode = 'single';
  if (raw.mode === 'sections' || (raw.mode === undefined && raw.sections !== undefined)) {
    mode = 'sections';
  } else if (raw.mode !== undefined && raw.mode !== 'single') {
    return null;
  }

  let sections;
  if (mode === 'sections') {
    if (!Array.isArray(raw.sections) || raw.sections.length < 1) return null;
    sections = [];
    let expectStart = 1;
    let expectSheetStart = 1;
    let fullSectionPages = null; // 非最后一帖的容量（页）
    for (let k = 0; k < raw.sections.length; k++) {
      const s = raw.sections[k];
      if (!s || typeof s !== 'object') return null;
      const startPage = Number(s.startPage);
      const secTotal = Number(s.totalPages);
      if (!Number.isInteger(startPage) || startPage !== expectStart) return null;
      if (!Number.isInteger(secTotal) || secTotal < 4 || secTotal % 4 !== 0) return null;
      if (k < raw.sections.length - 1) {
        // 非最后一帖必须满帖且容量一致
        if (fullSectionPages === null) fullSectionPages = secTotal;
        if (secTotal !== fullSectionPages) return null;
      } else if (fullSectionPages !== null && secTotal > fullSectionPages) {
        return null; // 最后一帖不得超过满帖容量
      }
      const secSheetCount = secTotal / 4;
      sections.push({
        index: k + 1,
        startPage,
        endPage: startPage + secTotal - 1,
        totalPages: secTotal,
        sheetCount: secSheetCount,
        sheetStart: expectSheetStart,
      });
      expectStart += secTotal;
      expectSheetStart += secSheetCount;
    }
    if (expectStart - 1 !== totalPages) return null;
    if (expectSheetStart - 1 !== sheets.length) return null;
    if (fullSectionPages !== null && fullSectionPages > MAX_SECTION_SHEETS * 4) return null;
  } else {
    sections = [
      {
        index: 1,
        startPage: 1,
        endPage: totalPages,
        totalPages,
        sheetCount: sheets.length,
        sheetStart: 1,
      },
    ];
  }

  // 把帖归属写到每张纸上，便于校验与导出定位
  for (const sec of sections) {
    for (let j = 0; j < sec.sheetCount; j++) {
      const sheet = sheets[sec.sheetStart - 1 + j];
      sheet.section = sec.index;
      sheet.sectionIndex = j + 1;
    }
  }

  const maxSheetsPerSection = Number(raw.maxSheetsPerSection);
  return {
    mode,
    pages,
    totalPages,
    sheetCount: sheets.length,
    sheets,
    sections,
    sectionCount: sections.length,
    maxSheetsPerSection: Number.isInteger(maxSheetsPerSection) ? maxSheetsPerSection : null,
  };
}

/**
 * 实时校验：
 *  - duplicates：重复出现的有内容页
 *  - missing：缺失的有内容页
 *  - outOfRange：超出 1..N 的页码
 *  - crossSection：跨帖页码不连续（某帖出现了属于其他帖的有内容页，定位到帖/纸张/版位）
 *  - pairing：每帖内每张纸的正反配对异常（空白错位、奇偶、页码和、书叶配对、套帖顺序）
 * 返回 { valid, errors, slotErrors }；结构非法返回 null。
 */
function validateImposition(raw) {
  const state = normalizeState(raw);
  if (!state) return null;
  const { pages: P, totalPages: N, sheets, sections } = state;

  const errors = { duplicates: [], missing: [], outOfRange: [], crossSection: [], pairing: [] };
  const slotErrors = [];
  const addSlot = (sheet, side, pos, message) =>
    slotErrors.push({
      sheet: sheet.index,
      section: sheet.section,
      sectionIndex: sheet.sectionIndex,
      side,
      pos,
      message,
    });

  // 统计每个页码出现的位置
  const occurrences = new Map();
  for (const s of sheets) {
    for (const side of SIDES) {
      for (const pos of POSITIONS) {
        const v = s[side][pos];
        if (v === null) continue;
        if (!occurrences.has(v)) occurrences.set(v, []);
        occurrences.get(v).push({ sheet: s, side, pos });
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

  // 跨帖页码连续：每个有内容页必须出现在它所属的帖内
  for (const s of sheets) {
    const sec = sections[s.section - 1];
    const contentEnd = Math.min(sec.endPage, P);
    for (const side of SIDES) {
      for (const pos of POSITIONS) {
        const v = s[side][pos];
        if (v === null || v < 1 || v > P) continue; // 超范围页由 outOfRange / 配对检查处理
        if (v < sec.startPage || v > contentEnd) {
          const owner = sections.find((t) => v >= t.startPage && v <= t.endPage);
          const where = `第 ${sec.index} 帖第 ${s.sectionIndex} 张纸`;
          errors.crossSection.push({
            section: sec.index,
            sheet: s.index,
            sectionIndex: s.sectionIndex,
            page: v,
            message: owner
              ? `${where}出现第 ${v} 页，该页应属于第 ${owner.index} 帖（跨帖页码不连续）`
              : `${where}出现第 ${v} 页，该页不属于任何帖`,
          });
          addSlot(
            s,
            side,
            pos,
            `第 ${v} 页不属于第 ${sec.index} 帖（本帖页码范围 ${sec.startPage}~${contentEnd}）`
          );
        }
      }
    }
  }

  // 逐帖、逐张纸的正反配对检查
  for (const sec of sections) {
    const base = sec.startPage; // 帖起始页（帖内第 1 页的全局页码）
    const M = sec.totalPages;
    const faceSum = sec.startPage + sec.endPage; // 每面左右页码之和（单帖时即 N + 1）
    for (let j = 1; j <= sec.sheetCount; j++) {
      const s = sheets[sec.sheetStart - 1 + j - 1];
      const msgs = [];
      const exp = {
        front: {
          left: base + expectedPage(j, 'front', 'left', M) - 1,
          right: base + expectedPage(j, 'front', 'right', M) - 1,
        },
        back: {
          left: base + expectedPage(j, 'back', 'left', M) - 1,
          right: base + expectedPage(j, 'back', 'right', M) - 1,
        },
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
              addSlot(s, side, pos, `应排第 ${e} 页，当前为空白`);
              usable = false;
            } else {
              eff[side][pos] = e;
            }
          } else {
            if (e > P) {
              msgs.push(`${label}应为空白版位，当前排了第 ${v} 页`);
              addSlot(s, side, pos, '此版位应为空白');
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

        // 奇偶规则：左版为偶数页，右版为奇数页（帖容量为 4 的倍数，全局页码与帖内页码奇偶一致）
        for (const side of SIDES) {
          const L = eff[side].left;
          const R = eff[side].right;
          if (L % 2 !== 0) {
            msgs.push(`${SIDE_LABEL[side]}左版应为偶数页，当前为第 ${L} 页`);
            addSlot(s, side, 'left', '左版应为偶数页');
          }
          if (R % 2 !== 1) {
            msgs.push(`${SIDE_LABEL[side]}右版应为奇数页，当前为第 ${R} 页`);
            addSlot(s, side, 'right', '右版应为奇数页');
          }
        }

        // 每面左右页码之和 = 帖起始页 + 帖末页（单帖时即 N + 1）
        for (const side of SIDES) {
          const sum = eff[side].left + eff[side].right;
          if (sum !== faceSum) {
            msgs.push(`${SIDE_LABEL[side]}左右页码之和应为 ${faceSum}，当前为 ${sum}`);
            addSlot(s, side, 'left', `左右页码之和应为 ${faceSum}`);
            addSlot(s, side, 'right', `左右页码之和应为 ${faceSum}`);
          }
        }

        // 书叶配对：正面左↔反面右、正面右↔反面左 应为连续页（同一张书叶的正反）
        const mates = (a, b) => Math.abs(a - b) === 1 && Math.min(a, b) % 2 === 1;
        if (!mates(FL, BR)) {
          msgs.push(`正面左版（第 ${FL} 页）与反面右版（第 ${BR} 页）应同属一张书叶（连续页）`);
          addSlot(s, 'front', 'left', '与反面右版书叶配对异常');
          addSlot(s, 'back', 'right', '与正面左版书叶配对异常');
        }
        if (!mates(FR, BL)) {
          msgs.push(`正面右版（第 ${FR} 页）与反面左版（第 ${BL} 页）应同属一张书叶（连续页）`);
          addSlot(s, 'front', 'right', '与反面左版书叶配对异常');
          addSlot(s, 'back', 'left', '与正面右版书叶配对异常');
        }

        // 套帖顺序：本张纸的页码组合应与帖内嵌套位置一致
        const want = [exp.front.left, exp.front.right, exp.back.left, exp.back.right].sort(
          (a, b) => a - b
        );
        const got = [FL, FR, BL, BR].slice().sort((a, b) => a - b);
        if (want.some((w, k) => got[k] !== w)) {
          msgs.push(`本张纸页码组合应为 {${want.join(', ')}}，当前为 {${got.join(', ')}}（套帖顺序异常）`);
          for (const side of SIDES) {
            for (const pos of POSITIONS) addSlot(s, side, pos, '纸张页码组合与套帖顺序不符');
          }
        }
      }

      if (msgs.length) {
        errors.pairing.push({
          sheet: s.index,
          section: sec.index,
          sectionIndex: j,
          messages: msgs,
        });
      }
    }
  }

  const valid =
    errors.duplicates.length === 0 &&
    errors.missing.length === 0 &&
    errors.outOfRange.length === 0 &&
    errors.crossSection.length === 0 &&
    errors.pairing.length === 0;

  return { valid, errors, slotErrors };
}

/** 生成 CSV（带 BOM，Excel 友好）；结构非法返回 null。分帖模式含帖号与帖内纸张序号。 */
function buildCsv(raw) {
  const state = normalizeState(raw);
  if (!state) return null;
  const cell = (v) => (v === null ? '空白' : String(v));
  const sectioned = state.mode === 'sections';
  const rows = [
    sectioned
      ? ['帖号', '帖内纸张序号', '面别', '左版页码', '右版页码']
      : ['纸张序号', '面别', '左版页码', '右版页码'],
  ];
  for (const s of state.sheets) {
    for (const side of SIDES) {
      rows.push(
        sectioned
          ? [
              String(s.section),
              String(s.sectionIndex),
              SIDE_LABEL[side],
              cell(s[side].left),
              cell(s[side].right),
            ]
          : [String(s.index), SIDE_LABEL[side], cell(s[side].left), cell(s[side].right)]
      );
    }
  }
  return '\uFEFF' + rows.map((r) => r.join(',')).join('\r\n') + '\r\n';
}

module.exports = {
  MAX_PAGES,
  MAX_SECTION_SHEETS,
  padToMultipleOf4,
  expectedPage,
  generateImposition,
  normalizeState,
  validateImposition,
  buildCsv,
};
