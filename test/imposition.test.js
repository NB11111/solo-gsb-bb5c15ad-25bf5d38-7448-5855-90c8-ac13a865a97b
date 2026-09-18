'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  padToMultipleOf4,
  expectedPage,
  generateImposition,
  validateImposition,
  buildCsv,
} = require('../src/imposition');

test('页数补齐为 4 的倍数', () => {
  assert.equal(padToMultipleOf4(1), 4);
  assert.equal(padToMultipleOf4(4), 4);
  assert.equal(padToMultipleOf4(5), 8);
  assert.equal(padToMultipleOf4(6), 8);
  assert.equal(padToMultipleOf4(16), 16);
});

test('标准拼版页码公式', () => {
  // N = 8：第 1 张 正面[8,1] 反面[2,7]；第 2 张 正面[6,3] 反面[4,5]
  assert.equal(expectedPage(1, 'front', 'left', 8), 8);
  assert.equal(expectedPage(1, 'front', 'right', 8), 1);
  assert.equal(expectedPage(1, 'back', 'left', 8), 2);
  assert.equal(expectedPage(1, 'back', 'right', 8), 7);
  assert.equal(expectedPage(2, 'front', 'left', 8), 6);
  assert.equal(expectedPage(2, 'back', 'right', 8), 5);
});

test('生成 6 页成品：补齐至 8 页并产生空白版位', () => {
  const imp = generateImposition(6);
  assert.equal(imp.totalPages, 8);
  assert.equal(imp.sheetCount, 2);
  assert.deepEqual(imp.sheets[0], {
    index: 1,
    front: { left: null, right: 1 }, // 第 8 页为空白
    back: { left: 2, right: null }, // 第 7 页为空白
  });
  assert.deepEqual(imp.sheets[1], {
    index: 2,
    front: { left: 6, right: 3 },
    back: { left: 4, right: 5 },
  });
});

test('标准拼版校验通过', () => {
  for (const p of [4, 6, 8, 12, 20]) {
    const result = validateImposition(generateImposition(p));
    assert.equal(result.valid, true, `pages=${p}`);
    assert.deepEqual(result.errors.duplicates, []);
    assert.deepEqual(result.errors.missing, []);
    assert.deepEqual(result.errors.pairing, []);
  }
});

test('交换同面左右版位 → 检出配对异常', () => {
  const imp = generateImposition(8);
  const f = imp.sheets[0].front;
  [f.left, f.right] = [f.right, f.left]; // [8,1] → [1,8]
  const result = validateImposition(imp);
  assert.equal(result.valid, false);
  assert.ok(result.errors.pairing.some((p) => p.sheet === 1));
  assert.deepEqual(result.errors.duplicates, []);
  assert.deepEqual(result.errors.missing, []);
});

test('整纸交换位置 → 检出套帖顺序异常', () => {
  const imp = generateImposition(8);
  [imp.sheets[0], imp.sheets[1]] = [imp.sheets[1], imp.sheets[0]];
  imp.sheets.forEach((s, i) => (s.index = i + 1));
  const result = validateImposition(imp);
  assert.equal(result.valid, false);
  assert.ok(result.errors.pairing.length >= 1);
});

test('重复页与缺页', () => {
  const imp = generateImposition(8);
  imp.sheets[1].back.right = 1; // 第 5 页被改为第 1 页
  const result = validateImposition(imp);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.duplicates, [1]);
  assert.deepEqual(result.errors.missing, [5]);
});

test('空白错位：应有内容的版位被置为空白', () => {
  const imp = generateImposition(8);
  imp.sheets[0].front.right = null; // 第 1 页消失
  const result = validateImposition(imp);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.missing, [1]);
  assert.ok(result.errors.pairing.some((p) => p.sheet === 1));
});

test('页码超出范围', () => {
  const imp = generateImposition(8);
  imp.sheets[0].front.left = 99;
  const result = validateImposition(imp);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.outOfRange, [99]);
});

test('非法结构返回 null', () => {
  assert.equal(validateImposition(null), null);
  assert.equal(validateImposition({ pages: 3, totalPages: 8, sheets: [] }), null);
  assert.equal(validateImposition({ pages: 8, totalPages: 8, sheets: [{}] }), null);
});

test('CSV 输出包含纸张序号、面别与左右页码', () => {
  const csv = buildCsv(generateImposition(6));
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '﻿纸张序号,面别,左版页码,右版页码');
  assert.equal(lines[1], '1,正面,空白,1');
  assert.equal(lines[2], '1,反面,2,空白');
  assert.equal(lines[3], '2,正面,6,3');
  assert.equal(lines[4], '2,反面,4,5');
});
