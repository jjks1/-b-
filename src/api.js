/**
 * 哔哩哔哩网页端接口封装（纯 Node 内置库，无第三方依赖）。
 *
 * 登录态全部来自网页版 Cookie：SESSDATA / bili_jct / DedeUserID
 *  - SESSDATA：登录态
 *  - bili_jct：CSRF token，所有写操作必带
 *  - DedeUserID：账号 uid
 *
 * 重要：share/add 与 heartbeat 用无效 Cookie 也会返回 code:0，
 * 所以这两个任务必须以「回查任务列表」为准，不能拿返回码当成功。
 */
const https = require('https');
const http = require('http');
const { URL, URLSearchParams } = require('url');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const REFERER = 'https://www.bilibili.com/';

const URLS = {
  nav: 'https://api.bilibili.com/x/web-interface/nav',
  reward: 'https://api.bilibili.com/x/member/web/exp/reward',
  share: 'https://api.bilibili.com/x/web-interface/share/add',
  coin: 'https://api.bilibili.com/x/web-interface/coin/add',
  liveSign: 'https://api.live.bilibili.com/xlive/web-ucenter/v1/sign/DoSign',
  ranking: 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all',
  pagelist: 'https://api.bilibili.com/x/player/pagelist',
  heartbeat: 'https://api.bilibili.com/x/click-interface/web/heartbeat',
  login: 'https://passport.bilibili.com/login'
};

// ---------------------------------------------------------------- 网络底层

function rawRequest(urlString, { cookie = '', method = 'GET', form = null, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(urlString);
    } catch (e) {
      return reject(e);
    }
    const lib = target.protocol === 'http:' ? http : https;
    const headers = {
      'User-Agent': UA,
      'Referer': REFERER,
      'Origin': 'https://www.bilibili.com',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    };
    if (cookie) headers['Cookie'] = cookie;
    let payload = null;
    if (form) {
      payload = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = lib.request(
      { protocol: target.protocol, hostname: target.hostname, port: target.port, path: target.pathname + target.search, method, headers },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.setTimeout(timeout, () => { req.destroy(new Error('TIMEOUT')); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** 发请求并解析 JSON；网络层异常返回 { error }，业务层异常返回 { code, message } */
async function requestJson(urlString, opts = {}) {
  try {
    const { status, body } = await rawRequest(urlString, opts);
    let json = null;
    try {
      json = JSON.parse(body);
    } catch (_) {
      return { status, error: 'NOT_JSON', body: (body || '').slice(0, 120) };
    }
    return { status, json, error: null };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return { error: 'NET', netError: msg };
  }
}

// ---------------------------------------------------------------- 单项接口

async function fetchNav(cookie) {
  const r = await requestJson(URLS.nav, { cookie });
  if (r.error) return { ok: false, net: true, message: r.netError || r.error };
  const j = r.json || {};
  if (j.code !== 0) return { ok: false, net: false, message: j.message || `code ${j.code}` };
  const d = j.data || {};
  if (!d.isLogin) return { ok: false, net: false, message: '账号未登录' };
  return {
    ok: true,
    uname: d.uname || '',
    level: d.level_info ? d.level_info.current_level : 0,
    coins: typeof d.money === 'number' ? d.money : 0,
    mid: d.mid || 0
  };
}

async function fetchReward(cookie) {
  const r = await requestJson(URLS.reward, { cookie });
  if (r.error || !r.json) return { ok: false, data: null, message: r.netError || r.error };
  const j = r.json;
  if (j.code !== 0) return { ok: false, data: null, message: j.message || `code ${j.code}` };
  return { ok: true, data: j.data || {} };
}

/** 从 reward.data 里读出四项任务的完成标记与今日经验 */
function parseTasks(data) {
  if (!data) {
    return { login: false, watch: false, share: false, coin: false, todayExp: 0 };
  }
  return {
    login: Boolean(data.login),
    watch: Boolean(data.watch),
    share: Boolean(data.share),
    coin: Boolean(data.coins),
    todayExp: Number(data.today_exp || 0)
  };
}

async function doShare(cookie, aid, csrf) {
  return requestJson(URLS.share, { cookie, method: 'POST', form: { aid: String(aid), csrf } });
}

async function doCoin(cookie, aid, csrf) {
  return requestJson(URLS.coin, {
    cookie,
    method: 'POST',
    form: { aid: String(aid), multiply: '1', select_like: '0', cross_domain: 'true', csrf }
  });
}

async function doLiveSign(cookie, csrf) {
  const url = `${URLS.liveSign}?csrf=${encodeURIComponent(csrf)}`;
  return requestJson(url, { cookie });
}

async function fetchRanking(cookie) {
  const r = await requestJson(URLS.ranking, { cookie });
  if (r.error || !r.json) return { ok: false, items: [] };
  const j = r.json;
  if (j.code !== 0) return { ok: false, items: [] };
  const list = (j.data && j.data.list) || [];
  return {
    ok: true,
    items: list.map((it) => ({ aid: it.aid, bvid: it.bvid, title: it.title || '' })).filter((x) => x.aid)
  };
}

async function fetchCid(cookie, aid) {
  const r = await requestJson(`${URLS.pagelist}?aid=${encodeURIComponent(aid)}&jsonp=jsonp`, { cookie });
  if (r.error || !r.json) return { ok: false, cid: 0 };
  const j = r.json;
  const arr = Array.isArray(j.data) ? j.data : null;
  if (j.code !== 0 || !arr || !arr.length) return { ok: false, cid: 0 };
  return { ok: true, cid: arr[0].cid || 0 };
}

/** 发一次观看心跳；返回接口原始结果，不在这里下结论 */
async function heartbeat(cookie, { aid, cid, playedTime, csrf, mid, startTs }) {
  return requestJson(URLS.heartbeat, {
    cookie,
    method: 'POST',
    form: {
      aid: String(aid),
      cid: String(cid),
      played_time: String(playedTime),
      realtime: String(playedTime),
      // 同一轮观看的三次心跳必须是同一个开始时间，否则服务端会当成三次独立播放
      start_ts: String(startTs || (Math.floor(Date.now() / 1000) - playedTime)),
      type: '3',
      sub_type: '0',
      dt: '2',
      csrf,
      mid: String(mid || '')
    }
  });
}

// ---------------------------------------------------------------- 组合打卡

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 执行一次完整打卡。
 * @param {string} cookie 完整 Cookie 头
 * @param {object} opts {autoCoin, liveSign, onStep}
 * @returns {Promise<{success:boolean, uname:string, lines:string[], retryable:boolean}>}
 */
async function checkIn(cookie, opts = {}) {
  const { autoCoin = false, liveSign = true, onStep = () => {} } = opts;
  const lines = [];
  const csrf = cookieValueOf(cookie, 'bili_jct');
  let retryable = false;
  let coinSpent = false;
  let navOk = false;   // 登录态是否真的有效（供主进程判断要不要清掉本地凭据）
  let netErr = false;  // 失败是否为网络问题（网络问题不能清凭据）

  // ① 登录态
  onStep('正在校验登录态…');
  const nav = await fetchNav(cookie);
  if (!nav.ok && nav.net) retryable = true;
  let uname = nav.ok ? nav.uname : '';
  if (nav.ok) {
    lines.push(`• 登录态有效：${uname}（LV${nav.level}，硬币 ${nav.coins}）`);
  } else {
    lines.push(`• 登录态校验失败：${nav.message}`);
  }

  // 登录态明确失效（不是网络问题）就别往下跑了：
  // share/add 在无效 Cookie 下同样返回 code 0，继续跑会得出「分享已提交」的假结论。
  if (!nav.ok && !nav.net) {
    return { success: false, uname: '', lines, retryable: false };
  }

  // ② 今日任务
  onStep('正在查询今日任务…');
  const reward = await fetchReward(cookie);
  if (!reward.ok && reward.message && /网络|TIMEOUT|NET/.test(String(reward.message))) retryable = true;
  const tasks = parseTasks(reward.data);
  if (reward.ok) {
    const mark = (b) => (b ? '✓' : '—');
    lines.push(
      `• 今日任务：登录 ${mark(tasks.login)} | 观看 ${mark(tasks.watch)} | ` +
      `分享 ${mark(tasks.share)} | 投币 ${mark(tasks.coin)} | 今日经验 +${tasks.todayExp}`
    );
  } else {
    lines.push(`• 今日任务查询失败：${reward.message || '未知错误'}`);
  }

  navOk = true;
  let didSomething = false;
  const ranked = await fetchRanking(cookie);
  const firstAid = ranked.ok && ranked.items.length ? ranked.items[0].aid : 0;

  // ③ 分享（回查确认）
  if (!tasks.share && firstAid) {
    onStep('正在提交分享任务…');
    const r = await doShare(cookie, firstAid, csrf);
    if (r.error) {
      lines.push(`• 分享：请求失败（${r.netError || r.error}）`);
      retryable = true;
    } else if (r.json && r.json.code === 0) {
      const again = await fetchReward(cookie);
      const nowShare = parseTasks(again.data).share;
      if (nowShare) {
        lines.push('• 分享：已完成 ✓');
        didSomething = true;
      } else {
        lines.push('• 分享已提交，服务端暂未计入（接口返回 0 不等于生效）');
      }
    } else {
      const msg = r.json ? r.json.message : '未知错误';
      lines.push(`• 分享：失败（${msg}）`);
    }
  } else if (tasks.share) {
    lines.push('• 分享：今天已完成过');
  } else if (!firstAid) {
    lines.push('• 分享：没取到可用视频，已跳过（排行榜接口未返回数据）');
  }

  // ④ 观看（三次心跳 + 回查）
  if (!tasks.watch && firstAid) {
    onStep('正在完成观看任务…');
    const cidRes = await fetchCid(cookie, firstAid);
    if (!cidRes.ok) {
      lines.push('• 观看：没取到可用视频，已跳过');
    } else {
      let accepted = 0;
      let lastMsg = '';
      const plays = [3, 9, 18];
      const watchStartTs = Math.floor(Date.now() / 1000) - plays[0];
      for (let i = 0; i < plays.length; i++) {
        if (i > 0) await sleep(3000); // 留出真实观看间隔，避免像刷量
        onStep(`正在完成观看任务…（${i + 1}/3）`);
        const hb = await heartbeat(cookie, {
          aid: firstAid,
          cid: cidRes.cid,
          playedTime: plays[i],
          csrf,
          mid: cookieValueOf(cookie, 'DedeUserID'),
          startTs: watchStartTs
        });
        if (hb.json && hb.json.code === 0) accepted++;
        else lastMsg = hb.json ? hb.json.message : (hb.netError || hb.error);
      }
      const again = await fetchReward(cookie);
      const nowWatch = parseTasks(again.data).watch;
      if (nowWatch) {
        lines.push('• 观看：已完成 ✓');
        didSomething = true;
      } else if (accepted > 0) {
        lines.push(`• 观看已上报 ${accepted}/3 次心跳，服务端暂未显示完成（可能需几分钟才计入，稍后复检）`);
      } else {
        lines.push(`• 观看：失败（${lastMsg || '心跳未通过'}）`);
        if (!lastMsg || /TIMEOUT|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(String(lastMsg))) {
          retryable = true;
        }
      }
    }
  } else if (tasks.watch) {
    lines.push('• 观看：今天已完成过');
  }

  // ⑤ 投币（默认关闭，消耗真实硬币）
  if (!tasks.coin && autoCoin) {
    const coins = nav.ok ? nav.coins : 0;
    if (!reward.ok) {
      // 查不到今天投币状态时不做投币：宁可少一次经验，也不能重复扣硬币
      lines.push('• 投币：跳过（今日任务状态未知，为避免重复消耗硬币不做操作）');
    } else if (coins >= 1 && firstAid) {
      onStep('正在投币…');
      const r = await doCoin(cookie, firstAid, csrf);
      if (r.json && r.json.code === 0) {
        lines.push('• 投币：成功 1 枚（+10 经验）');
        coinSpent = true;
        didSomething = true;
      } else {
        lines.push(`• 投币：失败（${r.json ? r.json.message : (r.netError || '网络错误')}）`);
      }
    } else {
      lines.push(`• 投币：跳过（硬币不足，当前 ${coins} 枚）`);
    }
  } else if (tasks.coin) {
    lines.push('• 投币：今天已完成过');
  } else if (opts.coinSkipNote) {
    // 今天已经投过（记录在本机），不再重复消耗硬币
    lines.push('• 投币：今天已经投过，不再重复扣硬币');
  }

  // ⑥ 直播签到
  if (liveSign) {
    onStep('正在直播签到…');
    const r = await doLiveSign(cookie, csrf);
    if (r.json && r.json.code === 0) {
      lines.push('• 直播签到：成功 ✓');
      didSomething = true;
    } else {
      const msg = r.json ? (r.json.message || `code ${r.json.code}`) : (r.netError || '网络错误');
      lines.push(`• 直播签到：${msg}`);
    }
  }

  // ⑦ 复检今日总经验
  onStep('正在复检今日经验…');
  const after = await fetchReward(cookie);
  const afterExp = parseTasks(after.data).todayExp;
  lines.push(`• 打卡后今日经验：+${afterExp}`);

  const tasksAlreadyDone = tasks.coin || tasks.watch || tasks.share;
  const success = judgeSuccess(nav.ok, didSomething, afterExp, tasksAlreadyDone);
  return { success, uname, lines, retryable, coinSpent, navOk, net: netErr };
}

/**
 * 成功判据（与安卓版一致，抽成纯函数便于单测）：
 *   登录态必须有效，并且「确实做成了某件事 / 今日经验 > 0 / 任务本来就已完成」至少满足一条。
 * 四项全「—」且经验 +0 一律判失败——这是修掉「假成功」的关键。
 */
function judgeSuccess(navOk, didSomething, todayExp, tasksAlreadyDone) {
  if (!navOk) return false;
  return Boolean(didSomething) || Number(todayExp) > 0 || Boolean(tasksAlreadyDone);
}

function cookieValueOf(cookieHeader, key) {
  if (!cookieHeader) return '';
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === key) return part.slice(i + 1).trim();
  }
  return '';
}

// ---------------------------------------------------------------- 网络自检

/** 网络检测：逐个目标报 HTTP 状态码或异常类型，供「页面报错时先点这个」使用 */
async function netProbe(hosts = ['api.bilibili.com', 'passport.bilibili.com', 'www.bilibili.com']) {
  const out = [];
  for (const h of hosts) {
    const started = Date.now();
    try {
      const { status } = await rawRequest(`https://${h}/`, { timeout: 8000 });
      out.push({ host: h, status, ms: Date.now() - started, ok: status > 0 });
    } catch (e) {
      out.push({ host: h, status: 0, ms: Date.now() - started, ok: false, error: e.message || String(e) });
    }
  }
  return out;
}

module.exports = {
  URLS,
  checkIn,
  fetchNav,
  fetchReward,
  fetchRanking,
  fetchCid,
  heartbeat,
  doShare,
  doCoin,
  doLiveSign,
  parseTasks,
  netProbe,
  judgeSuccess,
  rawRequest,
  cookieValueOf,
  sleep
};
