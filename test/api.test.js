const test = require('node:test');
const assert = require('node:assert');
const { judgeSuccess, parseTasks } = require('../src/api');
const { buildReport } = require('../src/report');

test('四项任务全「—」且经验 +0 时判失败（这是修掉假成功的关键）', () => {
  assert.equal(judgeSuccess(true, false, 0, false), false);
});

test('登录态无效时一律失败，哪怕接口返回过成功码', () => {
  assert.equal(judgeSuccess(false, true, 15, true), false);
});

test('确实做成某件事 / 经验增加 / 任务本来就完成，三者任一即成功', () => {
  assert.equal(judgeSuccess(true, true, 0, false), true);
  assert.equal(judgeSuccess(true, false, 5, false), true);
  assert.equal(judgeSuccess(true, false, 0, true), true);
});

test('今天的经验只认数字，字符串也给算出来', () => {
  const t = parseTasks({ login: true, watch: false, share: 1, coins: 0, today_exp: '3' });
  assert.equal(t.login, true);
  assert.equal(t.watch, false);
  assert.equal(t.share, true, '接口返回 1 也应视为已完成');
  assert.equal(t.coin, false, '接口字段叫 coins，映射到 coin');
  assert.equal(t.todayExp, 3);
});

test('没有任务数据时全部给默认值，不抛异常', () => {
  const t = parseTasks(null);
  assert.deepEqual(t, { login: false, watch: false, share: false, coin: false, todayExp: 0 });
});

test('报告格式：抬头 / 账号 / 明细 / 日期', () => {
  const text = buildReport(
    { success: true, uname: 'bili_59006335087', lines: ['• 登录态有效：x（LV1，硬币 2）'] },
    '2026-11-08'
  );
  const rows = text.split('\n');
  assert.equal(rows[0], '✅ 今日打卡完成');
  assert.equal(rows[1], '账号：bili_59006335087');
  assert.equal(rows[2], '• 登录态有效：x（LV1，硬币 2）');
  assert.equal(rows[rows.length - 1], '日期：2026-11-08');
});

test('失败报告抬头是「打卡未完成」，不会伪装成成功', () => {
  const text = buildReport({ success: false, uname: '', lines: ['• 分享：失败'] }, '2026-11-08');
  assert.equal(text.split('\n')[0], '❌ 打卡未完成');
});
