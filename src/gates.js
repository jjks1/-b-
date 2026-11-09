/**
 * 开机（登录 Windows 后）是否该执行打卡的四道闸门。
 * 抽成纯函数便于单测：这四条判定决定了「会不会擅自帮用户跑任务」。
 */
function bootGate(state, today) {
  if (!state.disclaimerAccepted) return { ok: false, reason: '未同意免责条款' };
  if (!state.bootEnabled) return { ok: false, reason: '用户关闭了开机自启' };
  if (!state.loggedIn) return { ok: false, reason: '尚未登录' };
  if (state.lastDate === today) return { ok: false, reason: '今天已经打过卡' };
  return { ok: true, reason: '' };
}

const { cookieValue, hasFullSession } = require('./cookies');

/**
 * 登录窗口轮询一次该做什么。
 * 这里挡的是两个曾经踩过的坑：
 *   1. 三项 Cookie 齐全 ≠ 有效：过期 Cookie 也凑得出三项，直接关窗会「一闪而过」
 *   2. 重新登录时 SESSDATA 没变就关窗，用户根本没机会换号
 * @param {string} header 当前网页会话的 Cookie 头
 * @param {{force?:boolean, baseline?:string, nav?:{ok:boolean, net?:boolean, uname?:string, message?:string}}} ctx
 * @returns {{action:'wait'|'clear'|'check'|'ok', reason?:string, uname?:string}}
 */
function loginVerdict(header, ctx = {}) {
  const { force = false, baseline = '', nav = null } = ctx;
  if (!hasFullSession(header)) return { action: 'wait', reason: '登录信息还不完整' };
  const sess = cookieValue(header, 'SESSDATA');
  if (force && sess === baseline) return { action: 'wait', reason: '还没有换新的登录态' };
  if (!nav) return { action: 'check' };

  if (!nav.ok && nav.net) return { action: 'wait', reason: '网络问题，等下一轮' };
  if (!nav.ok) return { action: 'clear', reason: nav.message || '登录态无效' };
  return { action: 'ok', uname: nav.uname || '' };
}

/**
 * 自动投币是否该执行：用户开了开关，且今天还没有投过。
 * 重试、面板「重新打卡」都会再跑一次 checkIn，靠这条守住「一天最多花一枚硬币」。
 */
function shouldAutoCoin(setting, coinDate, today) {
  return Boolean(setting) && coinDate !== today;
}

module.exports = { bootGate, loginVerdict, shouldAutoCoin };
