/* 设置页逻辑：只负责显示状态与转发操作，所有网络动作都在主进程里做 */

const el = (id) => document.getElementById(id);

let lastState = null;

function render(state) {
  lastState = state;
  const account = el('accountText');
  const badge = el('loginBadge');

  if (state.sessionProblem && state.sessionProblem !== '尚未登录') {
    account.textContent = state.uname || '未知账号';
    badge.textContent = '登录信息不完整';
    badge.className = 'badge warn';
  } else if (state.loggedIn) {
    account.textContent = state.uname || '已登录';
    badge.textContent = '已登录';
    badge.className = 'badge ok';
  } else {
    account.textContent = '未登录';
    badge.textContent = '未登录';
    badge.className = 'badge';
  }

  el('lastDate').textContent = state.lastDate || '—';

  const hint = el('loginHint');
  if (state.sessionProblem && state.sessionProblem !== '尚未登录') {
    hint.textContent = state.sessionProblem + '，请重新登录一次。';
    hint.classList.remove('hidden');
  } else {
    hint.classList.add('hidden');
  }
  el('reportBox').textContent = state.lastReport || '暂无打卡记录。点「立即打卡」跑一次。';

  el('swBoot').checked = Boolean(state.bootEnabled);
  el('swOpenApp').checked = Boolean(state.openBili);
  el('swCoin').checked = Boolean(state.autoCoin);
  el('swLive').checked = Boolean(state.liveSign);

  el('btnLogin').textContent = state.loggedIn ? '重新登录' : '登录哔哩哔哩';

  const autostart = state.autostartRegistered ? '已在注册表登记' : '未登记';
  const pack = state.packaged ? '免安装版' : '开发模式（自启动不写入注册表）';
  el('envInfo').textContent =
    `系统：${state.platform === 'win32' ? 'Windows' : state.platform}  ·  ${pack}\n` +
    `开机自启动：${autostart}  ·  今天：${state.today}`;

  // 开关开着、程序却是免安装版、注册表里却没有：只写一行「未登记」用户根本不会注意，
  // 结果每天都不自动跑。这种「看起来开了、实际没生效」必须显式警告。
  const bootHint = el('bootHint');
  const bootBroken = Boolean(state.packaged && state.bootEnabled && !state.autostartRegistered);
  bootHint.textContent = bootBroken
    ? '⚠️ 开机自启动没有写进注册表：可能被安全软件拦截。请把本程序加入白名单，然后重新打开一次本页面。'
    : '';
  bootHint.classList.toggle('hidden', !bootBroken);
}

async function refresh() {
  render(await window.api.state());
  // 打卡结束后主进程会推一次 refresh，这里顺手把按钮恢复可用，
  // 不依赖 2 秒定时器（长任务跑 30 秒时按钮不该一直是灰的）
  const btn = el('btnCheck');
  if (btn) btn.disabled = false;
}

// ---------------- 登录
el('btnLogin').addEventListener('click', async () => {
  const btn = el('btnLogin');
  btn.disabled = true;
  btn.textContent = '请在登录窗口里完成登录…';
  try {
    const r = await window.api.login(Boolean(lastState && lastState.loggedIn));
    if (!r.ok) {
      alert(r.reason === 'busy'
        ? '登录窗口已经开着，请在里面完成登录。'
        : '登录窗口已关闭，未检测到有效登录态。若你已完成登录，请再点一次「立即打卡」确认。');
      return;
    }
    if (r.ok) {
      await refresh();
      const box = el('reportBox');
      box.textContent = r.switched
        ? '已切换到新账号，旧账号的今日标记与旧报告已清空。'
        : (box.textContent || '');
    }
  } finally {
    btn.disabled = false;
    await refresh();
  }
});

// ---------------- 打卡
el('btnCheck').addEventListener('click', async () => {
  const r = await window.api.checkNow();
  if (!r.started) {
    const map = {
      running: '正在打卡中，请稍等',
      login: '还没登录，先点「登录哔哩哔哩」',
      disclaimer: '请先同意免责声明'
    };
    alert(map[r.reason] || r.reason);
    return;
  }
  // 打卡窗口会自己推进度，这里只把按钮短暂置灰，避免连点
  const btn = el('btnCheck');
  btn.disabled = true;
  setTimeout(() => { btn.disabled = false; refresh(); }, 2000);
});

// ---------------- 网络检测
el('btnNet').addEventListener('click', async () => {
  const btn = el('btnNet');
  const box = el('netResult');
  btn.disabled = true;
  box.classList.remove('hidden');
  box.textContent = '检测中…';
  try {
    const results = await window.api.netTest();
    const now = new Date().toLocaleTimeString();
    box.textContent = results
      .map((r) => r.ok
        ? `${r.host}  →  HTTP ${r.status}（${r.ms} ms）`
        : `${r.host}  →  失败：${r.error || '无响应'}（${r.ms} ms）`)
      .join('\n') + `\n检测时间：${now}`;
  } catch (e) {
    box.textContent = '检测失败：' + (e && e.message ? e.message : String(e));
  } finally {
    btn.disabled = false;
  }
});

// ---------------- 开关
for (const [id, key] of [
  ['swBoot', 'bootEnabled'],
  ['swOpenApp', 'openBili'],
  ['swCoin', 'autoCoin'],
  ['swLive', 'liveSign']
]) {
  el(id).addEventListener('change', async (e) => {
    const state = await window.api.setPref(key, e.target.checked);
    render(state);
  });
}

// ---------------- 其它
el('btnDisclaimer').addEventListener('click', () => window.api.showDisclaimer());
el('btnDataDir').addEventListener('click', () => window.api.openDataDir());

window.api.onRefresh(refresh);

refresh();
