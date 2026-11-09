/* 免责条款页动作：同意写入配置并继续，不同意直接退出程序 */
document.getElementById('agree').addEventListener('click', () => {
  window.api.acceptDisclaimer();
});
document.getElementById('exit').addEventListener('click', () => {
  window.api.rejectDisclaimer();
});
