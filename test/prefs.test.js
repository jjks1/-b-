const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Prefs } = require('../src/prefs');
const { setAutoStart, readAutoStart } = require('../src/autostart');

function tempPrefs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-prefs-'));
  return new Prefs(dir);
}

test('首次运行使用默认值：开机自启开、自动投币关', () => {
  const p = tempPrefs();
  assert.equal(p.get('bootEnabled'), true);
  assert.equal(p.get('autoCoin'), false);
  assert.equal(p.get('openBili'), true);
  assert.equal(p.get('liveSign'), true);
  assert.equal(p.get('disclaimerAccepted'), false);
  assert.equal(p.loggedIn(), false);
});

test('设置写入后能读回（落盘到 config.json）', () => {
  const p = tempPrefs();
  p.set('autoCoin', true);
  const again = new Prefs(p.dir);
  assert.equal(again.get('autoCoin'), true);
});

test('换账号时清掉旧账号的今日标记与旧报告', () => {
  const p = tempPrefs();
  p.data.cookie = 'SESSDATA=old; bili_jct=j; DedeUserID=1';
  p.data.uname = 'old_user';
  p.setLastDate('2026-11-08');
  p.setLastReport('✅ 旧账号的报告');

  const switched = p.setSession('SESSDATA=new; bili_jct=j2; DedeUserID=2', 'new_user');
  assert.equal(switched, true);
  assert.equal(p.get('lastDate'), '');
  assert.equal(p.get('lastReport'), '');
  assert.equal(p.get('uname'), 'new_user');
});

test('同一账号重新登录时保留今日标记（不清空已完成状态）', () => {
  const p = tempPrefs();
  p.data.cookie = 'SESSDATA=same; bili_jct=j; DedeUserID=1';
  p.setLastDate('2026-11-08');
  const switched = p.setSession('SESSDATA=same; bili_jct=j; DedeUserID=1', 'same_user');
  assert.equal(switched, false);
  assert.equal(p.get('lastDate'), '2026-11-08');
});

test('今天取本地日期，格式 yyyy-MM-dd', () => {
  const p = tempPrefs();
  assert.match(p.today(), /^\d{4}-\d{2}-\d{2}$/);
});

test('非 Windows 平台不写注册表，返回明确错误而不是静默失败', () => {
  if (process.platform === 'win32') {
    assert.ok(true, 'Windows 下跳过该断言');
    return;
  }
  const r = setAutoStart(true, '/tmp/fake.exe');
  assert.equal(r.ok, false);
  assert.match(r.error, /Windows/);
  assert.equal(readAutoStart(), '');
});
