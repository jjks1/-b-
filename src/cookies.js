/**
 * 把 Electron 的 Cookie 列表合并成一条 Cookie 请求头。
 *
 * 为什么不能直接用最后一条：B 站把同名 Cookie 分散在 www / passport / api 三个域，
 * 逐个域比对整串会漏掉「同名不同域」的情况，这里统一按 key 去重。
 */
const DOMAIN_PRIORITY = ['.bilibili.com', 'www.bilibili.com', 'passport.bilibili.com', 'api.bilibili.com', 'api.live.bilibili.com'];

function rank(domain) {
  const i = DOMAIN_PRIORITY.indexOf(domain);
  return i < 0 ? DOMAIN_PRIORITY.length : i;
}

/**
 * @param {Array<{name:string,value:string,domain:string}>} cookies
 * @returns {string} 形如 "SESSDATA=xxx; bili_jct=yyy"
 */
function mergeCookies(cookies) {
  const byKey = new Map();
  // rank 越小优先级越高；排序让高优先级的域最后写入，从而覆盖同名的低优先级值
  const sorted = [...cookies].sort((a, b) => rank(b.domain) - rank(a.domain));
  for (const c of sorted) {
    if (!c || !c.name) continue;
    byKey.set(c.name, c.value);
  }
  return [...byKey.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

const SESSION_KEYS = ['SESSDATA', 'bili_jct', 'DedeUserID'];

/** 从 Cookie 头里取指定 key 的值，取不到返回空串 */
function cookieValue(cookieHeader, key) {
  if (!cookieHeader) return '';
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === key) return part.slice(i + 1).trim();
  }
  return '';
}

/** 三项齐全才算登录完成 */
function hasFullSession(cookieHeader) {
  return SESSION_KEYS.every((k) => cookieValue(cookieHeader, k));
}

module.exports = { mergeCookies, cookieValue, hasFullSession, SESSION_KEYS };
