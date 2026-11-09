const test = require('node:test');
const assert = require('node:assert');
const { isAutoStartCommand } = require('../src/autostart');

const PATH = 'C:\\Users\\张三\\每日自动打卡\\每日自动打卡.exe';
const CMD = `"${PATH}" --boot`;

test('完全一致 → 认为已登记', () => {
  assert.equal(isAutoStartCommand(CMD, CMD), true);
});

test('空值 → 未登记', () => {
  assert.equal(isAutoStartCommand('', CMD), false);
});

test('换了个路径 → 不算一致（需要重写）', () => {
  const other = '"C:\\Other\\app.exe" --boot';
  assert.equal(isAutoStartCommand(other, CMD), false);
});

test('中文路径被解码成乱码时退化为弱校验，不误判成失败', () => {
  // reg query 在中文系统按 OEM 输出，用 UTF-8 解码得到的正是这种带 U+FFFD 的串
  const garbled = '"C:\\Users\\\uFFFD\uFFFD\uFFFD\\\uFFFD\uFFFD.exe" --boot';
  assert.equal(isAutoStartCommand(garbled, CMD), true);
});

test('乱码里连 --boot 都没有 → 仍判未登记', () => {
  assert.equal(isAutoStartCommand('"\uFFFD\uFFFD\uFFFD.exe"', CMD), false);
});
