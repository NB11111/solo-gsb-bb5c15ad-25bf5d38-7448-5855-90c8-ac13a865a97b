'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_SECTION_SHEETS,
  generateImposition,
  validateImposition,
  buildCsv,
} = require('../src/imposition');

test('分帖生成：按成品页顺序切成容量为每帖纸张数四倍的连续区间', () => {
  const imp = generateImposition(20, 2); // 容量 8 页/帖 → [1..8] [9..16] [17..20]
  assert.equal(imp.mode, 'sections');
  assert.equal(imp.maxSheetsPerSection, 2);
  assert.equal(imp.totalPages, 20);
  assert.equal(imp.sectionCount, 3);
  assert.equal(imp.sheetCount, 5);
  assert.deepEqual(
    imp.sections.map((s) => [s.index, s.startPage, s.endPage, s.totalPages, s.sheetCount, s.sheetStart]),
    [
      [1, 1, 8, 8, 2, 1],
      [2, 9, 16, 8, 2, 3],
      [3, 17, 20, 4, 1, 5],
    ]
  );
  // 第 2 帖第 1 张：正面[16, 9] 反面[10, 15]
  assert.deepEqual(imp.sheets[2], {
    index: 3,
    front: { left: 16, right: 9 },
    back: { left: 10, right: 15 },
    section: 2,
    sectionIndex: 1,
  });
  // 第 3 帖第 1 张：正面[20, 17] 反面[18, 19]
  assert.deepEqual(imp.sheets[4].front, { left: 20, right: 17 });
  assert.deepEqual(imp.sheets[4].back, { left: 18, right: 19 });
});

test('分帖生成：仅最后一帖补空白至 4 的倍数', () => {
  const imp = generateImposition(18, 2); // [1..8] [9..16] [17..20]，第 19、20 页为空白
  assert.equal(imp.totalPages, 20);
  assert.equal(imp.sectionCount, 3);
  for (const s of imp.sheets.slice(0, 4)) {
    for (const side of ['front', 'back']) {
      assert.notEqual(s[side].left, null);
      assert.notEqual(s[side].right, null);
    }
  }
  const last = imp.sheets[4];
  assert.equal(last.front.left, null); // 第 20 页为空白
  assert.equal(last.front.right, 17);
  assert.equal(last.back.left, 18);
  assert.equal(last.back.right, null); // 第 19 页为空白
});

test('分帖生成：页数正好是帖容量倍数时不产生空白', () => {
  const imp = generateImposition(16, 2);
  assert.equal(imp.sectionCount, 2);
  assert.equal(imp.sheetCount, 4);
  for (const s of imp.sheets) {
    for (const side of ['front', 'back']) {
      assert.notEqual(s[side].left, null);
      assert.notEqual(s[side].right, null);
    }
  }
});

test('分帖生成：每帖 1 张纸（容量 4 页）', () => {
  const imp = generateImposition(8, 1);
  assert.equal(imp.sectionCount, 2);
  assert.deepEqual(
    imp.sections.map((s) => [s.startPage, s.endPage]),
    [
      [1, 4],
      [5, 8],
    ]
  );
  assert.deepEqual(imp.sheets[0].front, { left: 4, right: 1 });
  assert.deepEqual(imp.sheets[0].back, { left: 2, right: 3 });
  assert.deepEqual(imp.sheets[1].front, { left: 8, right: 5 });
  assert.deepEqual(imp.sheets[1].back, { left: 6, right: 7 });
});

test('单帖模式响应结构保持不变（API 兼容）', () => {
  const imp = generateImposition(6);
  assert.deepEqual(Object.keys(imp).sort(), ['pages', 'sheetCount', 'sheets', 'totalPages']);
  assert.deepEqual(Object.keys(imp.sheets[0]).sort(), ['back', 'front', 'index']);
});

test('标准分帖校验通过', () => {
  const cases = [
    [1, 1],
    [4, 1],
    [5, 1],
    [6, 2],
    [8, 8],
    [16, 2],
    [18, 3],
    [20, 2],
    [33, MAX_SECTION_SHEETS],
  ];
  for (const [p, m] of cases) {
    const result = validateImposition(generateImposition(p, m));
    assert.equal(result.valid, true, `pages=${p} max=${m}`);
    assert.deepEqual(result.errors.crossSection, []);
    assert.deepEqual(result.errors.duplicates, []);
    assert.deepEqual(result.errors.missing, []);
  }
});

test('跨帖交换页码 → 检出跨帖页码不连续并定位到帖/纸张/版位', () => {
  const imp = generateImposition(16, 1); // 4 帖，每帖 1 张 4 页
  // 第 1 帖第 1 张正面左版 = 4；第 2 帖第 1 张正面右版 = 5，互换
  imp.sheets[0].front.left = 5;
  imp.sheets[1].front.right = 4;
  const result = validateImposition(imp);
  assert.equal(result.valid, false);
  // 全局无重复、无缺失
  assert.deepEqual(result.errors.duplicates, []);
  assert.deepEqual(result.errors.missing, []);
  // 跨帖错误定位到帖与帖内纸张
  assert.equal(result.errors.crossSection.length, 2);
  const c5 = result.errors.crossSection.find((c) => c.page === 5);
  const c4 = result.errors.crossSection.find((c) => c.page === 4);
  assert.deepEqual([c5.section, c5.sheet, c5.sectionIndex], [1, 1, 1]);
  assert.deepEqual([c4.section, c4.sheet, c4.sectionIndex], [2, 2, 1]);
  // slotErrors 定位到具体版位
  const se = result.slotErrors.find(
    (e) => e.sheet === 1 && e.side === 'front' && e.pos === 'left'
  );
  assert.ok(se);
  assert.equal(se.section, 1);
  assert.equal(se.sectionIndex, 1);
  assert.ok(se.message.includes('不属于第 1 帖'));
});

test('帖内交换左右版 → 帖内配对异常（带帖号），无跨帖错误', () => {
  const imp = generateImposition(16, 2);
  const f = imp.sheets[0].front; // 第 1 帖第 1 张 正面[8, 1]
  [f.left, f.right] = [f.right, f.left];
  const result = validateImposition(imp);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.crossSection, []);
  assert.equal(result.errors.pairing[0].section, 1);
  assert.equal(result.errors.pairing[0].sectionIndex, 1);
  assert.equal(result.errors.pairing[0].sheet, 1);
});

test('跨帖的重复页与缺页仍可检出', () => {
  const imp = generateImposition(16, 2);
  imp.sheets[2].front.right = null; // 第 2 帖第 1 张正面右版（第 9 页）置空
  const r1 = validateImposition(imp);
  assert.equal(r1.valid, false);
  assert.deepEqual(r1.errors.missing, [9]);
  assert.deepEqual(r1.errors.duplicates, []);

  const imp2 = generateImposition(16, 2);
  imp2.sheets[2].front.right = 1; // 第 9 页改成第 1 页 → 第 1 页重复、第 9 页缺失
  const r2 = validateImposition(imp2);
  assert.equal(r2.valid, false);
  assert.deepEqual(r2.errors.duplicates, [1]);
  assert.deepEqual(r2.errors.missing, [9]);
  // 第 1 页出现在第 2 帖 → 跨帖错误
  assert.ok(r2.errors.crossSection.some((c) => c.page === 1 && c.section === 2));
});

test('分帖 CSV 包含帖号与帖内纸张序号', () => {
  const csv = buildCsv(generateImposition(20, 2));
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '﻿帖号,帖内纸张序号,面别,左版页码,右版页码');
  assert.equal(lines[1], '1,1,正面,8,1');
  assert.equal(lines[2], '1,1,反面,2,7');
  assert.equal(lines[3], '1,2,正面,6,3');
  assert.equal(lines[5], '2,1,正面,16,9');
  assert.equal(lines[9], '3,1,正面,20,17');
  assert.equal(lines[10], '3,1,反面,18,19');
});

test('单帖 CSV 格式保持不变', () => {
  const csv = buildCsv(generateImposition(6));
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '﻿纸张序号,面别,左版页码,右版页码');
  assert.equal(lines[1], '1,正面,空白,1');
});

test('非法分帖结构返回 null', () => {
  const imp = generateImposition(16, 2);
  // 帖区间不连续
  const bad1 = structuredClone(imp);
  bad1.sections[1].startPage = 10;
  assert.equal(validateImposition(bad1), null);
  // 非最后一帖不满帖
  const bad2 = structuredClone(imp);
  bad2.sections[0].totalPages = 4;
  bad2.sections[0].sheetCount = 1;
  assert.equal(validateImposition(bad2), null);
  // 声明分帖但缺少 sections
  assert.equal(
    validateImposition({ mode: 'sections', pages: 16, totalPages: 16, sheets: imp.sheets }),
    null
  );
  // 未知模式
  const bad4 = generateImposition(16);
  bad4.mode = 'weird';
  assert.equal(validateImposition(bad4), null);
});

test('分帖状态可完整往返（generate → validate → CSV）', () => {
  const imp = generateImposition(18, 3);
  const result = validateImposition(imp);
  assert.equal(result.valid, true);
  const csv = buildCsv(imp);
  assert.ok(csv.includes('帖号,帖内纸张序号'));
  // 每张纸在 CSV 中出现两行（正/反）
  const rows = csv.trim().split('\r\n').slice(1);
  assert.equal(rows.length, imp.sheetCount * 2);
});
