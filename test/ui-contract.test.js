/**
 * 界面层与前后端脚本之间的“契约”测试：
 *  - 页面脚本引用的元素 id 必须在对应 HTML 里真实存在（拼错一个字母就会静默失效）
 *  - 界面调用的 window.api.* 必须在 preload 里暴露
 *  - preload 里 invoke 的 IPC 通道必须在主进程有对应的 handle
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const pages = [
  { js: 'ui/renderer.js', html: 'ui/index.html' },
  { js: 'ui/panel.js', html: 'ui/panel.html' },
  { js: 'ui/disclaimer.js', html: 'ui/disclaimer.html' }
];

for (const { js, html } of pages) {
  test(`${js} 引用的元素在 ${html} 里都存在`, () => {
    const src = read(js);
    const ids = [...src.matchAll(/(?:el|document\.getElementById)\(\s*['"]([^'"]+)['"]\s*\)/g)]
      .map((m) => m[1]);
    assert.ok(ids.length > 0, `${js} 没解析到元素引用，测试本身可能失效`);
    const page = read(html);
    const missing = ids.filter((id) => !page.includes(`id="${id}"`));
    assert.deepEqual(missing, [], `${js} 引用了 HTML 里不存在的 id: ${missing.join(', ')}`);
  });
}

test('界面调用的 window.api 方法都在 preload 里暴露', () => {
  const preload = read('src/preload.js');
  const exposed = new Set([...preload.matchAll(/^\s{2}([A-Za-z]\w*)\s*:/gm)].map((m) => m[1]));
  assert.ok(exposed.size >= 10, 'preload 解析失败');

  const used = new Set();
  for (const { js } of pages) {
    for (const m of read(js).matchAll(/window\.api\.([A-Za-z]\w*)/g)) used.add(m[1]);
  }
  assert.ok(used.size > 0, '没解析到界面里的 api 调用');
  const missing = [...used].filter((k) => !exposed.has(k));
  assert.deepEqual(missing, [], `界面调用了未暴露的接口: ${missing.join(', ')}`);
});

test('preload 里的 IPC 通道都在主进程注册了 handle', () => {
  const preload = read('src/preload.js');
  const channels = [...preload.matchAll(/ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const main = read('src/main.js');
  const missing = channels.filter((ch) => !main.includes(`ipcMain.handle('${ch}'`));
  assert.deepEqual(missing, [], `主进程缺少对应的 ipcMain.handle: ${missing.join(', ')}`);
});
