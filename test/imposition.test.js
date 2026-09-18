'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  padToMultipleOf4,
  expectedPage,
  planSignatures,
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

/* ---------- 分帖模式 ---------- */

test('分帖方案：按容量 4M 切连续区间，仅末帖补空白', () => {
  // 10 页、每帖最多 2 张（容量 8）：第 1 帖 8 页，第 2 帖 2 页补齐到 4
  const plan = planSignatures(10, 2);
  assert.deepEqual(plan, [
    { sig: 1, sheetCount: 2, startPage: 1, endPage: 8, contentEndPage: 8 },
    { sig: 2, sheetCount: 1, startPage: 9, endPage: 12, contentEndPage: 10 },
  ]);

  // 恰好装满时末帖不补空白
  assert.deepEqual(
    planSignatures(16, 2).map((p) => [p.sig, p.sheetCount, p.startPage, p.endPage]),
    [
      [1, 2, 1, 8],
      [2, 2, 9, 16],
    ]
  );

  // 每页都能装满 8 帖
  const many = planSignatures(256, 8);
  assert.equal(many.length, 8);
  assert.equal(many[7].endPage, 256);
});

test('分帖生成：每帖内部独立拼版，页码映射为全局页码', () => {
  // 10 页、每帖 2 张
  const imp = generateImposition(10, 2);
  assert.equal(imp.signatureCount, 2);
  assert.equal(imp.sheetsPerSignature, 2);
  assert.equal(imp.totalPages, 12);

  const sig1 = imp.signatures[0];
  assert.deepEqual(sig1.sheets[0], {
    sig: 1,
    index: 1,
    front: { left: 8, right: 1 },
    back: { left: 2, right: 7 },
  });
  assert.deepEqual(sig1.sheets[1], {
    sig: 1,
    index: 2,
    front: { left: 6, right: 3 },
    back: { left: 4, right: 5 },
  });

  // 第 2 帖局部页码 1..4 映射到 9..12，11/12 为空白
  const sig2 = imp.signatures[1];
  assert.deepEqual(sig2.sheets[0], {
    sig: 2,
    index: 1,
    front: { left: null, right: 9 },
    back: { left: 10, right: null },
  });
});

test('分帖模式：标准拼版校验通过', () => {
  for (const [p, m] of [[10, 2], [16, 2], [20, 3], [9, 2], [256, 8]]) {
    const result = validateImposition(generateImposition(p, m));
    assert.equal(result.valid, true, `pages=${p} M=${m}`);
    assert.deepEqual(result.errors.duplicates, []);
    assert.deepEqual(result.errors.missing, []);
    assert.deepEqual(result.errors.crossSignature, []);
    assert.deepEqual(result.errors.pairing, []);
  }
});

test('分帖模式：容量足够时只有一帖，等价于单帖拼版（页码一致）', () => {
  const multi = generateImposition(8, 2);
  const single = generateImposition(8);
  assert.equal(multi.signatureCount, 1);
  assert.deepEqual(
    multi.signatures[0].sheets.map((s) => [s.front.left, s.front.right, s.back.left, s.back.right]),
    single.sheets.map((s) => [s.front.left, s.front.right, s.back.left, s.back.right])
  );
});

test('分帖模式：跨帖交换版位 → 检出跨帖连续性异常', () => {
  const imp = generateImposition(16, 2); // 第 1 帖 1~8，第 2 帖 9~16
  // 第 1 帖第 1 张正面左版 8 ↔ 第 2 帖第 1 张正面左版 16
  const s1 = imp.signatures[0].sheets[0];
  const s2 = imp.signatures[1].sheets[0];
  [s1.front.left, s2.front.left] = [s2.front.left, s1.front.left];
  const result = validateImposition(imp);
  assert.equal(result.valid, false);
  // 两页仅跨帖移动，全局仍无重复/缺失，由跨帖连续性规则捕获
  assert.deepEqual(result.errors.duplicates, []);
  assert.deepEqual(result.errors.missing, []);
  assert.ok(
    result.errors.crossSignature.some((c) => c.sig === 1 && c.page === 16),
    '第 1 帖应检出 16 页越界'
  );
  assert.ok(
    result.errors.crossSignature.some((c) => c.sig === 2 && c.page === 8),
    '第 2 帖应检出 8 页越界'
  );
  // 错误定位到帖、纸张、版位
  assert.ok(
    result.slotErrors.some(
      (se) => se.sig === 1 && se.sheet === 1 && se.side === 'front' && se.pos === 'left'
    )
  );
  assert.ok(
    result.slotErrors.some(
      (se) => se.sig === 2 && se.sheet === 1 && se.side === 'front' && se.pos === 'left'
    )
  );
});

test('分帖模式：帖内交换同面左右 → 仅检出该帖配对异常', () => {
  const imp = generateImposition(20, 2); // 第 1 帖 1~8，第 2 帖 9~16，第 3 帖 17~20
  const f = imp.signatures[1].sheets[0].front;
  [f.left, f.right] = [f.right, f.left]; // 第 2 帖第 1 张 [16,9] → [9,16]
  const result = validateImposition(imp);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.crossSignature, []);
  assert.equal(result.errors.pairing.length, 1);
  assert.equal(result.errors.pairing[0].sig, 2);
  assert.equal(result.errors.pairing[0].sheet, 1);
});

test('分帖模式：末帖缺页定位到帖/纸张/版位', () => {
  const imp = generateImposition(10, 2);
  imp.signatures[1].sheets[0].back.left = null; // 第 10 页消失
  const result = validateImposition(imp);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.missing, [10]);
  assert.ok(
    result.slotErrors.some(
      (se) => se.sig === 2 && se.sheet === 1 && se.side === 'back' && se.pos === 'left'
    )
  );
});

test('分帖模式：非末帖出现空白 → 同时检出跨帖与配对异常', () => {
  const imp = generateImposition(10, 2); // 第 1 帖 1~8，第 2 帖 9~10（11/12 空白）
  imp.signatures[0].sheets[0].front.right = null; // 第 1 页从第 1 帖消失
  imp.signatures[1].sheets[0].front.left = 1; // 挪入第 2 帖的空白版位（帖内局部第 4 页位）
  const result = validateImposition(imp);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.missing, []);
  assert.deepEqual(result.errors.duplicates, []);
  assert.ok(
    result.errors.crossSignature.some((c) => c.sig === 2 && c.page === 1),
    '第 2 帖不应出现第 1 页'
  );
  assert.ok(result.errors.pairing.some((p) => p.sig === 1 && p.sheet === 1));
});

test('分帖模式：非法 M 参数', () => {
  assert.throws(() => generateImposition(10, 0));
  assert.throws(() => generateImposition(10, 9));
  assert.throws(() => generateImposition(10, 2.5));
});

test('分帖模式：结构不匹配返回 null', () => {
  const imp = generateImposition(10, 2);
  // 帖数不符
  assert.equal(validateImposition({ ...imp, sheetsPerSignature: 3 }), null);
  // 篡改帖元信息
  assert.equal(
    validateImposition({
      ...imp,
      signatures: imp.signatures.map((s) => ({ ...s, startPage: s.startPage + 1 })),
    }),
    null
  );
  // 纸张缺少 sig 字段
  const bad = JSON.parse(JSON.stringify(imp));
  delete bad.signatures[0].sheets[0].sig;
  assert.equal(validateImposition(bad), null);
});

test('分帖 CSV：包含帖号与帖内纸张序号', () => {
  const csv = buildCsv(generateImposition(10, 2));
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '﻿帖号,帖内纸张序号,面别,左版页码,右版页码');
  assert.equal(lines[1], '1,1,正面,8,1');
  assert.equal(lines[2], '1,1,反面,2,7');
  assert.equal(lines[3], '1,2,正面,6,3');
  assert.equal(lines[4], '1,2,反面,4,5');
  assert.equal(lines[5], '2,1,正面,空白,9');
  assert.equal(lines[6], '2,1,反面,10,空白');
});

test('旧单帖状态结构仍可校验与导出（API 兼容）', () => {
  const imp = generateImposition(6);
  assert.equal(imp.signatures, undefined);
  assert.equal(imp.sheetCount, 2);
  const result = validateImposition(imp);
  assert.equal(result.valid, true);
  assert.equal(result.errors.crossSignature, undefined);
  assert.ok(result.slotErrors.every((se) => se.sig === undefined));

  // 旧结构缺 totalPages 等字段时仍然非法
  assert.equal(validateImposition({ pages: 6, sheets: [] }), null);
});
