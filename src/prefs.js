/**
 * 本地配置存储：%APPDATA%/每日自动打卡/config.json
 * 只存 Cookie、开关、今日标记、上次报告，不存任何其它东西。
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  cookie: '',              // 完整 Cookie 串（SESSDATA / bili_jct / DedeUserID 等）
  uname: '',               // 昵称
  lastDate: '',            // 上次成功打卡的日期 yyyy-MM-dd
  lastReport: '',          // 上次打卡报告全文
  bootEnabled: true,       // 开机（登录 Windows 后）自启动
  openBili: true,          // 打卡后自动打开 B 站
  autoCoin: false,         // 自动投币（消耗真实硬币，默认关）
  liveSign: true,          // 直播间签到
  coinDate: '',            // 最近一次真正消耗硬币的日期（保证一天最多一枚）
  disclaimerAccepted: false
};

class Prefs {
  constructor(dir) {
    this.dir = dir || path.join(
      process.env.APPDATA || (process.env.HOME || '.'), '每日自动打卡'
    );
    this.file = path.join(this.dir, 'config.json');
    this.data = Object.assign({}, DEFAULTS);
    this.load();
  }

  load() {
    // 主文件读不出来时再试备份：只有「两个都坏」才回落默认值
    for (const file of [this.file, this.file + '.bak']) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const k of Object.keys(DEFAULTS)) {
          if (parsed[k] !== undefined && typeof parsed[k] === typeof DEFAULTS[k]) {
            this.data[k] = parsed[k];
          }
        }
        return;
      } catch (_) {
        // 换下一个候选
      }
    }
  }

  save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const text = JSON.stringify(this.data, null, 2);
      // 先写临时文件再原子替换：直接覆盖写，遇到断电/崩溃会留下半截 JSON，
      // 下次启动读不出来就等于把登录态弄丢了。
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, text, 'utf8');
      try {
        // 只有「旧主文件本身是可解析的 JSON」才拿来做备份。
        // 否则崩溃留下的半截文件会被当成备份写进去，把好好的备份覆盖成坏数据，
        // 下次启动就两个都读不出来。
        JSON.parse(fs.readFileSync(this.file, 'utf8'));
        fs.copyFileSync(this.file, this.file + '.bak');
      } catch (_) {
        // 首次保存（没有旧文件）或旧文件已损坏：跳过备份，保留上一份好的 .bak
      }
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[prefs] 写入失败:', e.message);
    }
  }

  get(key) { return this.data[key]; }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  /** 今天的日期字符串，固定用本地时区，避免跨时区漂移 */
  today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  loggedIn() {
    return cookieHasAll(this.data.cookie);
  }

  /**
   * 保存登录态。换号（SESSDATA 变了）时清掉旧账号派生数据，
   * 否则新账号会被「今天已完成」的旧标记挡住。
   */
  setSession(cookie, uname) {
    // 残缺的 Cookie 宁可不用，也不要把已有的有效登录态覆盖掉
    if (!cookieHasAll(cookie)) return false;
    const oldSession = cookieValue(this.data.cookie, 'SESSDATA');
    const newSession = cookieValue(cookie, 'SESSDATA');
    const switched = Boolean(oldSession && newSession && oldSession !== newSession);
    this.data.cookie = cookie;
    if (uname) this.data.uname = uname;
    if (switched) {
      this.data.lastDate = '';
      this.data.lastReport = '';
      this.data.coinDate = '';   // 换了账号，旧账号的投币记录不能挡住新账号
      this.data.uname = uname || '';
    }
    this.save();
    return switched;
  }

  /** 服务端确认登录失效时清掉凭据：留着只会让界面永远显示「已登录」 */
  clearSession() {
    this.data.cookie = '';
    this.data.uname = '';
    this.data.lastDate = '';   // 重新登录后当天还可以正常跑
    this.data.coinDate = '';
    this.save();
  }

  setLastDate(d) { this.set('lastDate', d); }
  setLastReport(t) { this.set('lastReport', t); }
}

function cookieValue(cookie, key) {
  if (!cookie) return '';
  for (const part of cookie.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === key) return part.slice(i + 1).trim();
  }
  return '';
}

function cookieHasAll(cookie) {
  return ['SESSDATA', 'bili_jct', 'DedeUserID'].every((k) => cookieValue(cookie, k));
}

module.exports = { Prefs, DEFAULTS, cookieValue, cookieHasAll };
