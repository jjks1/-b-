const test = require('node:test');
const assert = require('node:assert');
const { shouldAutoCoin } = require('../src/gates');

test('开关关着 → 不投币', () => {
  assert.equal(shouldAutoCoin(false, '', '2026-11-09'), false);
});

test('开关开着且今天没投过 → 投币', () => {
  assert.equal(shouldAutoCoin(true, '2026-11-08', '2026-11-09'), true);
});

test('开关开着但今天已经投过 → 不再投（重试/重打卡都不会重复扣）', () => {
  assert.equal(shouldAutoCoin(true, '2026-11-09', '2026-11-09'), false);
});

test('从未投过（记录为空）→ 允许投', () => {
  assert.equal(shouldAutoCoin(true, '', '2026-11-09'), true);
});
