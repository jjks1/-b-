/**
 * 开机自启动：写 HKCU\Software\Microsoft\Windows\CurrentVersion\Run
 *
 * 说明：Windows 的“开机自启”实际是「用户登录后启动」，与安卓的 BOOT_COMPLETED 效果等价，
 * 用注册表 Run 键最省事——不需要常驻服务，也不需要管理员权限（只写当前用户）。
 */
const { execFileSync } = require('child_process');

const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const VALUE_NAME = '每日自动打卡';

function isWindows() {
  return process.platform === 'win32';
}

/**
 * 判断注册表里的命令是否就是我们要写的那一条。
 *
 * 为什么要单独判：`reg query` 在中文 Windows 上按 OEM 代码页输出，
 * 用 UTF-8 解码会把 C:\Users\中文名\... 这类路径变成乱码（U+FFFD），
 * 于是「写成功」也会被判成不一致。乱码时退化为弱校验（认 --boot 这个 ASCII 尾巴）。
 */
function isAutoStartCommand(written, expected) {
  if (!written) return false;
  if (written === expected) return true;
  if (written.includes('\uFFFD') && written.includes('--boot')) {
    return true;
  }
  return false;
}

/** 用 PowerShell 读（输出强制 UTF-8，中文路径不会乱码）；不可用时退回 reg query */
function readViaPowerShell() {
  const script =
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;" +
    "try{(Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' " +
    "-Name '" + VALUE_NAME + "').'" + VALUE_NAME + "'}catch{''}";
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  const out = execFileSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64], { encoding: 'utf8', timeout: 8000 });
  return String(out || '').trim();
}

/** 读取当前注册表里的自启动命令，没有则返回空串 */
function readAutoStart() {
  if (!isWindows()) return '';
  try {
    const v = readViaPowerShell();
    if (v) return v;
  } catch (_) {
    // PowerShell 被策略禁用时走下面的 reg
  }
  try {
    const out = execFileSync('reg', ['query', KEY, '/v', VALUE_NAME], { encoding: 'utf8' });
    const m = out.match(/REG_SZ\s+(.*)/);
    return m ? m[1].trim() : '';
  } catch (_) {
    return '';
  }
}

/**
 * 开启/关闭自启动。
 * @param {boolean} enable
 * @param {string} exePath 可执行文件路径（打包后为 app.getPath('exe')）
 * @returns {{ok:boolean, command:string, error?:string}}
 */
function setAutoStart(enable, exePath) {
  if (!isWindows()) {
    return { ok: false, command: '', error: '当前系统不是 Windows，自启动未写入' };
  }
  try {
    if (enable) {
      const command = `"${exePath}" --boot`;
      execFileSync('reg', ['add', KEY, '/v', VALUE_NAME, '/t', 'REG_SZ', '/d', command, '/f'], { encoding: 'utf8' });
      // 回读一遍：被组策略/安全软件拦下时会静默不生效，不能当作成功
      const written = readAutoStart();
      if (!isAutoStartCommand(written, command)) {
        return { ok: false, command: written, error: '注册表未生效（可能被安全软件拦截）' };
      }
      return { ok: true, command };
    }
    try {
      execFileSync('reg', ['delete', KEY, '/v', VALUE_NAME, '/f'], { encoding: 'utf8' });
    } catch (_) {
      // 本来就没有这一项，视为已关闭
    }
    return { ok: true, command: '' };
  } catch (e) {
    return { ok: false, command: '', error: e.message || String(e) };
  }
}

module.exports = { readAutoStart, setAutoStart, isAutoStartCommand, VALUE_NAME, KEY };
