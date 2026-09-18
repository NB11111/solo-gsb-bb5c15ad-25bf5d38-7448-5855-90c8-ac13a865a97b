'use strict';

const path = require('path');
const express = require('express');
const {
  MAX_PAGES,
  MAX_SECTION_SHEETS,
  generateImposition,
  validateImposition,
  buildCsv,
} = require('./src/imposition');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/** 生成标准拼版；传入 maxSheetsPerSection（1~8）时为分帖模式 */
app.post('/api/generate', (req, res) => {
  const body = req.body || {};
  const pages = Number(body.pages);
  if (!Number.isInteger(pages) || pages < 1 || pages > MAX_PAGES) {
    return res.status(400).json({ error: `成品页数必须是 1~${MAX_PAGES} 的整数` });
  }
  let maxSheetsPerSection = null;
  if (body.maxSheetsPerSection !== undefined && body.maxSheetsPerSection !== null) {
    maxSheetsPerSection = Number(body.maxSheetsPerSection);
    if (
      !Number.isInteger(maxSheetsPerSection) ||
      maxSheetsPerSection < 1 ||
      maxSheetsPerSection > MAX_SECTION_SHEETS
    ) {
      return res
        .status(400)
        .json({ error: `每帖最多纸张数必须是 1~${MAX_SECTION_SHEETS} 的整数` });
    }
  }
  res.json(generateImposition(pages, maxSheetsPerSection));
});

/** 实时校验当前拼版状态 */
app.post('/api/validate', (req, res) => {
  const result = validateImposition(req.body);
  if (!result) {
    return res.status(400).json({ error: '拼版数据格式不正确' });
  }
  res.json(result);
});

/** 校验通过后导出 CSV；存在错误时拒绝导出 */
app.post('/api/export', (req, res) => {
  const result = validateImposition(req.body);
  if (!result) {
    return res.status(400).json({ error: '拼版数据格式不正确' });
  }
  if (!result.valid) {
    return res.status(400).json({ error: '存在拼版错误，已禁止导出', errors: result.errors });
  }
  const csv = buildCsv(req.body);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="imposition-${req.body.totalPages}p.csv"`
  );
  res.send(csv);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`骑马钉拼版检查工具已启动: http://localhost:${PORT}`);
});
