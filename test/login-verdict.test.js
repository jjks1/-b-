const test = require('node:test');
const assert = require('node:assert');
const { loginVerdict } = require('../src/gates');

const FULL = 'SESSDATA=A; bili_jct=B; DedeUserID=C';

test('三项不齐 → 继续等，不关窗', () => {
  const v = loginVerdict('SESSDATA=A; DedeUserID=C', {});
  assert.equal(v.action, 'wait');
});

test('齐全但服务端说没登录 → 清 Cookie 让用户重新登（不能一闪而过）', () => {
  const v = loginVerdict(FULL, { nav: { ok: false, net: false, message: '账号未登录' } });
  assert.equal(v.action, 'clear');
});

test('齐全且服务端确认有效 → 保存并关窗', () => {
  const v = loginVerdict(FULL, { nav: { ok: true, uname: 'someone' } });
  assert.equal(v.action, 'ok');
  assert.equal(v.uname, 'someone');
});

test('网络不通 → 继续等，不能当成登录失败', () => {
  const v = loginVerdict(FULL, { nav: { ok: false, net: true } });
  assert.equal(v.action, 'wait');
});

test('重新登录时 SESSDATA 没变 → 继续等，给用户换号的机会', () => {
  const v = loginVerdict(FULL, { force: true, baseline: 'A' });
  assert.equal(v.action, 'wait');
});

test('重新登录且 SESSDATA 已变 → 主流程去做真实校验', () => {
  const v = loginVerdict(FULL, { force: true, baseline: 'old' });
  assert.equal(v.action, 'check');
});
