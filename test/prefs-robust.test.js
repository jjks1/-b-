const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Prefs } = require('../src/prefs');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bili-robust-'));

test('第二次保存会留下 .bak 备份', () => {
  const p = new Prefs(tmpDir());
  p.set('uname', 'first');
  p.set('uname', 'second');
  assert.equal(fs.existsSync(p.file + '.bak'), true);
  assert.equal(JSON.parse(fs.readFileSync(p.file, 'utf8')).uname, 'second');
});

test('主文件被写坏时，从 .bak 恢复登录态而不是当作没登录', () => {
  const p = new Prefs(tmpDir());
  p.data.cookie = 'SESSDATA=s; bili_jct=j; DedeUserID=1';
  p.set('uname', 'a');                  // 第一次保存：主文件里有 Cookie
  p.set('uname', 'someone');            // 第二次保存：.bak 留下上一版（含 Cookie）
  fs.writeFileSync(p.file, '{"cookie": "SESSDATA=s; bili_jct=j', 'utf8');  // 半截 JSON

  const again = new Prefs(p.dir);
  assert.equal(again.loggedIn(), true, '登录态必须能从备份里救回来');
  assert.equal(again.get('uname'), 'a');
});

test('残缺 Cookie（缺 bili_jct）不会覆盖已有的有效登录态', () => {
  const p = new Prefs(tmpDir());
  p.setSession('SESSDATA=s; bili_jct=j; DedeUserID=1', 'ok_user');
  const r = p.setSession('SESSDATA=other; DedeUserID=2', 'bad_user');
  assert.equal(r, false);
  assert.equal(p.get('uname'), 'ok_user');
  assert.match(p.get('cookie'), /bili_jct=j/);
});

test('保存后不会残留 .tmp 临时文件', () => {
  const p = new Prefs(tmpDir());
  p.set('uname', 'x');
  assert.equal(fs.existsSync(p.file + '.tmp'), false);
});

test('换账号时清掉旧账号的投币日期（否则新账号当天投不了币）', () => {
  const p = new Prefs(fs.mkdtempSync(path.join(os.tmpdir(), 'bili-switch-')));
  p.setSession('SESSDATA=old; bili_jct=j; DedeUserID=1', 'old_user');
  p.set('coinDate', '2026-11-09');
  p.setSession('SESSDATA=new; bili_jct=j; DedeUserID=2', 'new_user');
  assert.equal(p.get('coinDate'), '', '换号后必须清空投币日期');
  assert.equal(p.get('lastDate'), '');
});

test('clearSession 清掉凭据与当日标记，但保留失败报告供查看', () => {
  const p = new Prefs(fs.mkdtempSync(path.join(os.tmpdir(), 'bili-clear-')));
  p.setSession('SESSDATA=a; bili_jct=b; DedeUserID=1', 'someone');
  p.set('lastDate', '2026-11-09');
  p.setLastReport('❌ 登录态无效');
  p.clearSession();
  assert.equal(p.get('cookie'), '');
  assert.equal(p.get('uname'), '');
  assert.equal(p.get('lastDate'), '');
  assert.equal(p.loggedIn(), false);
  assert.equal(p.get('lastReport'), '❌ 登录态无效');
});

test('主文件损坏时不拿坏文件覆盖好备份（坏数据不能污染 .bak）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-bak-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file + '.bak', JSON.stringify({ cookie: 'SESSDATA=good; bili_jct=j; DedeUserID=1', uname: 'good' }));
  fs.writeFileSync(file, '{"cookie": "SESSDATA=go');   // 半截文件，模拟断电

  const p = new Prefs(dir);
  assert.equal(p.get('uname'), 'good', '应能从备份恢复');
  p.set('lastDate', '2026-11-09');                      // 触发保存
  fs.writeFileSync(file, '{"broken"');                  // 再制造一次主文件损坏

  const p2 = new Prefs(dir);
  assert.equal(p2.get('uname'), 'good', '备份没被坏文件覆盖，仍能恢复');
});
