const test = require('node:test');
const assert = require('node:assert');
const { mergeCookies, cookieValue, hasFullSession } = require('../src/cookies');

test('同一 Cookie 名出现在三个域时，按域优先级取，而不是整串比对', () => {
  const list = [
    { name: 'buvid3', value: 'from-api', domain: 'api.bilibili.com' },
    { name: 'buvid3', value: 'from-www', domain: 'www.bilibili.com' },
    { name: 'buvid3', value: 'from-root', domain: '.bilibili.com' },
    { name: 'SESSDATA', value: 's1', domain: '.bilibili.com' }
  ];
  const header = mergeCookies(list);
  assert.match(header, /buvid3=from-root/);
  assert.match(header, /SESSDATA=s1/);
  assert.equal(header.split('buvid3=').length, 2, '同一个 key 只能出现一次');
});

test('不同域的 Cookie 会被合到一起，不会互相覆盖', () => {
  const header = mergeCookies([
    { name: 'SESSDATA', value: 'a', domain: 'www.bilibili.com' },
    { name: 'bili_jct', value: 'b', domain: 'api.bilibili.com' },
    { name: 'DedeUserID', value: 'c', domain: 'passport.bilibili.com' }
  ]);
  assert.equal(cookieValue(header, 'SESSDATA'), 'a');
  assert.equal(cookieValue(header, 'bili_jct'), 'b');
  assert.equal(cookieValue(header, 'DedeUserID'), 'c');
});

test('三项齐全才算登录完成，缺 bili_jct 不算', () => {
  assert.equal(hasFullSession('SESSDATA=a; bili_jct=b; DedeUserID=c'), true);
  assert.equal(hasFullSession('SESSDATA=a; DedeUserID=c'), false);
  assert.equal(hasFullSession(''), false);
});

test('cookieValue 不会把 DedeUserID 和 SESSDATA 之类的子串搞混', () => {
  const header = 'SESSDATA=abc; bili_jct=def; DedeUserID=123';
  assert.equal(cookieValue(header, 'DedeUserID'), '123');
  assert.equal(cookieValue(header, 'SESSDATA'), 'abc');
  assert.equal(cookieValue(header, '不存在'), '');
});
