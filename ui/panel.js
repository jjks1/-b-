/* 打卡面板：只显示进度与结果，动作全部转给主进程 */

const statusEl = document.getElementById('status');
const reportEl = document.getElementById('report');

window.api.onProgress((text) => {
  statusEl.textContent = text;
});

window.api.onResult((data) => {
  statusEl.textContent = data.success ? '打卡完成，即将跳转到 B 站…' : '打卡未完成，请查看下方原因';
  reportEl.textContent = data.report || '';
});

document.getElementById('btnClose').addEventListener('click', () => window.api.closePanel());
document.getElementById('btnDone').addEventListener('click', () => window.api.closePanel());
document.getElementById('btnOpenBili').addEventListener('click', () => window.api.openBili());
document.getElementById('btnRetry').addEventListener('click', async () => {
  const r = await window.api.retryFromPanel();
  // 上一轮还没跑完时会被闸门挡住，必须给用户一句反馈，否则点了像没反应
  if (r && r.started === false) statusEl.textContent = '上一轮还在进行，请稍候…';
});
