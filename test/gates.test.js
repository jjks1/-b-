const test = require('node:test');
const assert = require('node:assert');
const { bootGate } = require('../src/gates');

const base = { disclaimerAccepted: true, bootEnabled: true, loggedIn: true, lastDate: '' };

test('四道闸门全部满足才放行', () => {
  const r = bootGate(base, '2026-11-08');
  assert.equal(r.ok, true);
});

test('没同意免责条款就不打卡（界面之外的后台入口也要挡）', () => {
  const r = bootGate({ ...base, disclaimerAccepted: false }, '2026-11-08');
  assert.equal(r.ok, false);
  assert.match(r.reason, /免责/);
});

test('用户关闭开机自启后不打卡', () => {
  const r = bootGate({ ...base, bootEnabled: false }, '2026-11-08');
  assert.equal(r.ok, false);
});

test('未登录不打卡', () => {
  const r = bootGate({ ...base, loggedIn: false }, '2026-11-08');
  assert.equal(r.ok, false);
});

test('今天已打过卡就跳过（每天只跑一次）', () => {
  const r = bootGate({ ...base, lastDate: '2026-11-08' }, '2026-11-08');
  assert.equal(r.ok, false);
  assert.match(r.reason, /已经/);
});

test('昨天打过卡不影响今天', () => {
  const r = bootGate({ ...base, lastDate: '2026-11-07' }, '2026-11-08');
  assert.equal(r.ok, true);
});
