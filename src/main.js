/**
 * 主进程：窗口管理、登录抓 Cookie、打卡编排、自启动、单实例。
 *
 * 与安卓版的行为一一对应：
 *  BootReceiver 四道闸门  → 启动参数 --boot 时的 gate 检查
 *  AutoRunActivity        → pageWindow（B站页面）+ panelWindow（进度面板）
 *  WebLoginActivity       → loginWindow（真实浏览器窗口，抓 CookieManager）
 *  MainActivity           → mainWindow（设置页）
 *  免责条款               → disclaimerWindow（首次强制，未同意则退出）
 */
const { app, BrowserWindow, ipcMain, session, shell, dialog, screen } = require('electron');
const path = require('path');
const api = require('./api');
const { Prefs } = require('./prefs');
const cookiesUtil = require('./cookies');
const autoStart = require('./autostart');
const { bootGate, loginVerdict, shouldAutoCoin } = require('./gates');

const IS_BOOT = process.argv.includes('--boot');
const SMOKE_MODE = process.env.SMOKE_TEST || '';   // 自检模式：1=只看窗口，2=自动点「同意」
const IS_SMOKE = SMOKE_MODE !== '';

let prefs = null;
let mainWindow = null;
let loginWindow = null;
let disclaimerWindow = null;
let pageWindow = null;
let panelWindow = null;

let checkRunning = false;    // 并发闸门：界面重建/连点都不会跑出第二套请求
let quitSuppressUntil = 0;   // 窗口切换的空档期（销毁旧窗口→创建新窗口）内不要触发退出
let loginBaseline = null;
let bootPendingLogin = false;   // 开机时发现没登录：先让用户登录，登录完成后立刻补跑打卡
let lastLoginBounds = null;   // 自检用：记录登录窗口实际尺寸
let lastPageBounds = null;    // 自检用：记录 B 站窗口实际尺寸    // 打开登录页那一刻网页自身的 Cookie，用于判断“是否真的换了登录态”

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 单实例
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    // 场景：程序已经在跑，此时系统登录又触发了自启命令（带 --boot）。
    // 只提窗口不打卡，会漏掉当天这一次。
    if (argv && argv.includes('--boot') && prefs && !checkRunning) {
      const gate = bootGate({
        disclaimerAccepted: prefs.get('disclaimerAccepted'),
        bootEnabled: prefs.get('bootEnabled'),
        loggedIn: prefs.loggedIn(),
        lastDate: prefs.get('lastDate')
      }, prefs.today());
      if (gate.ok) startCheckInFlow(true);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      return;
    }
    // 典型场景：开机自启跑到一半（只有打卡窗口），用户又双击了桌面图标。
    // 此时不打开设置页，用户会以为程序没反应。
    if (prefs) {
      if (prefs.get('disclaimerAccepted')) {
        createMainWindow();
      } else {
        showDisclaimer(() => createMainWindow());
      }
    }
  });

  app.whenReady().then(onReady);
}

function onReady() {
  prefs = new Prefs(app.getPath('userData'));
  if (process.env.DEBUG_UI === '1') {
    console.log('[paths] name=', app.getName(), 'userData=', app.getPath('userData'),
      'isPackaged=', app.isPackaged);
  }

  // 自检用：开机但没登录时，必须把界面打开、等用户登录（不能静默退出）
  if (IS_SMOKE && (process.env.SMOKE_TEST === '13' || process.env.SMOKE_TEST === '14')) {
    prefs.set('disclaimerAccepted', true);
    prefs.set('bootEnabled', true);
    prefs.data.cookie = '';
    prefs.set('uname', '');
    prefs.set('lastDate', '');
  }

  // 自检用：开机自启路径（--boot）的完整链路，含「跑完自动退出」这一条
  if (IS_SMOKE && process.env.SMOKE_TEST === '11') {
    prefs.set('disclaimerAccepted', true);
    prefs.data.cookie = 'SESSDATA=smoke; bili_jct=smoke; DedeUserID=1';
    prefs.set('lastDate', '');
    prefs.set('openBili', false);   // 沙箱里没有可拉起的浏览器/客户端
    api.checkIn = async () => ({
      success: true, uname: 'boot_user', lines: ['• 开机路径测试桩'], retryable: false
    });
    console.log('[boot-test] 桩已就绪，接着走 bootFlow');
  }

  // 自启动状态与实际注册表对齐：
  //  - 打包后才写（开发模式跑的是 electron.exe，写进去是错的）
  //  - 必须先同意免责条款（否则等于「用户还没同意就先给自己开机权限」）
  //  - 每次启动都校准路径：用户移动/重命名文件夹后，旧的注册表命令会失效
  if (app.isPackaged && prefs.get('disclaimerAccepted')) {
    const exe = app.getPath('exe');
    const expected = `"${exe}" --boot`;
    const current = autoStart.readAutoStart();
    const want = prefs.get('bootEnabled');
    if (want && current !== expected) autoStart.setAutoStart(true, exe);
    if (!want && current) autoStart.setAutoStart(false, exe);
  }

  registerIpc();

  if (IS_BOOT) {
    bootFlow();
  } else if (!prefs.get('disclaimerAccepted')) {
    // 首次启动：先弹免责条款，同意后才进入设置页
    showDisclaimer(() => {
      createMainWindow();
    });
  } else {
    createMainWindow();
  }

  if (IS_SMOKE) {
    const mode = process.env.SMOKE_TEST;
    if (mode === '2') {
      // 自检用：模拟点「同意并继续」，确认免责流程真的能进到设置页
      setTimeout(() => {
        const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === '免责声明');
        if (w) w.webContents.executeJavaScript("document.getElementById('agree').click()");
      }, 1500);
      setTimeout(() => {
        console.log('[smoke2] disclaimerAccepted=', prefs.get('disclaimerAccepted'),
          'windows=', BrowserWindow.getAllWindows().map((x) => x.getTitle()).join('|'));
        app.quit();
      }, 5000);
    } else if (mode === '3') {
      // 自检用：同意免责后，把设置页截下来，确认布局没有错乱
      setTimeout(() => {
        const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === '免责声明');
        if (w) w.webContents.executeJavaScript("document.getElementById('agree').click()");
      }, 1500);
      setTimeout(async () => {
        const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().includes('每日自动打卡'));
        if (w) {
          const img = await w.webContents.capturePage();
          require('fs').writeFileSync('/tmp/main-ui.png', img.toPNG());
          // 再按最小允许尺寸截一张：小屏 / 用户手动缩到最小宽度时布局不能错乱
          w.setSize(560, 520);
          await new Promise((r2) => setTimeout(r2, 600));
          require('fs').writeFileSync('/tmp/main-ui-min.png', (await w.webContents.capturePage()).toPNG());
          console.log('[smoke3] 已截图 /tmp/main-ui.png 与 /tmp/main-ui-min.png');
        }
        app.quit();
      }, 4500);
    } else if (mode === '4') {
      // 自检用：单独打开打卡面板截图，确认面板布局没坏
      setTimeout(async () => {
        createPanelWindow();
        await new Promise((r) => setTimeout(r, 800));
        const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === '打卡进度');
        if (w) {
          const img = await w.webContents.capturePage();
          require('fs').writeFileSync('/tmp/panel-ui.png', img.toPNG());
          console.log('[smoke4] 已截图 /tmp/panel-ui.png');
        }
        app.quit();
      }, 1200);
    } else if (mode === '11') {
      // 开机路径：流程跑完应当自己退出进程（不常驻），这里只做守候与判死
      setTimeout(() => {
        console.log('[smoke11] FAIL 跑完仍未自动退出（checkRunning=',
          checkRunning, ', windows=', BrowserWindow.getAllWindows().length, ')');
        app.quit();
      }, 15000);
    } else if (mode === '14') {
      // 开机未登录 → 用户完成登录 → 必须立刻自动补跑打卡（不用再点一次）
      setTimeout(async () => {
        const ses = session.defaultSession;
        const put = (name, value) => ses.cookies.set({
          url: 'https://www.bilibili.com', name, value, domain: '.bilibili.com', path: '/'
        });
        await put('SESSDATA', 's14');
        await put('bili_jct', 'j14');
        await put('DedeUserID', '114514');
        api.fetchNav = async () => ({ ok: true, login: true, uname: 'boot_login_user', level: 3, coins: 5, message: '' });
        api.checkIn = async () => ({ success: true, uname: 'boot_login_user', lines: ['• 补跑桩'], retryable: false });
        const mw = mainWindow;
        if (mw && !mw.isDestroyed()) await mw.webContents.executeJavaScript("window.api.login(false)");
        await new Promise((res) => setTimeout(res, 4000));
        const st = {
          cookie: prefs.get('cookie').includes('SESSDATA=s14'),
          lastDate: prefs.get('lastDate'),
          okReport: prefs.get('lastReport').startsWith('✅'),
          pending: bootPendingLogin
        };
        console.log('[smoke14] result=', JSON.stringify(st));
        console.log([st.cookie, st.lastDate !== '', st.okReport, st.pending === false].every(Boolean)
          ? '[smoke14] PASS 开机登录后自动补跑打卡' : '[smoke14] FAIL 登录后没有自动打卡');
        app.quit();
      }, 2500);
    } else if (mode === '13') {
      // 开机 + 未登录：界面要开出来，且流程处于「等登录」而不是已退出
      setTimeout(() => {
        const titles = BrowserWindow.getAllWindows().map((w) => w.getTitle()).join('|');
        const ok = titles.includes('每日自动打卡') && bootPendingLogin === true;
        console.log('[smoke13] windows=', titles, 'pendingLogin=', bootPendingLogin);
        console.log(ok ? '[smoke13] PASS 开机未登录时打开界面等待登录' : '[smoke13] FAIL 直接退了或没开界面');
        app.quit();
      }, 2500);
    } else if (mode === '12') {
      // 自检用：登录过期时，本地凭据必须被清掉，界面不能继续显示「已登录」
      setTimeout(async () => {
        const dw = BrowserWindow.getAllWindows().find((x) => x.getTitle() === '免责声明');
        if (dw) {
          dw.webContents.executeJavaScript("document.getElementById('agree').click()");
          await new Promise((res) => setTimeout(res, 1000));
        }
        prefs.set('disclaimerAccepted', true);
        prefs.data.cookie = 'SESSDATA=expired; bili_jct=expired; DedeUserID=1';
        prefs.set('uname', 'expired_user');
        prefs.set('lastDate', '');
        api.checkIn = async () => ({
          success: false, uname: '', navOk: false, net: false, retryable: false,
          lines: ['❌ 登录态无效：账号未登录']
        });
        const r12 = startCheckInFlow(false);
        console.log('[smoke12] started=', JSON.stringify(r12));
        await new Promise((res) => setTimeout(res, 4200));
        const st = {
          cookie: prefs.get('cookie'),
          uname: prefs.get('uname'),
          cleared: prefs.get('lastReport').includes('已清除本地登录态')
        };
        console.log('[smoke12] result=', JSON.stringify(st));
        console.log([st.cookie === '', st.uname === '', st.cleared].every(Boolean)
          ? '[smoke12] PASS 过期凭据已清除、报告有提示' : '[smoke12] FAIL 过期凭据仍留在本地');
        app.quit();
      }, 1500);
    } else if (mode === '10') {
      // 自检用：今天已经投过币时，第二次打卡不能再投（重试链也一样）
      setTimeout(async () => {
        const dw = BrowserWindow.getAllWindows().find((x) => x.getTitle() === '免责声明');
        if (dw) {
          dw.webContents.executeJavaScript("document.getElementById('agree').click()");
          await new Promise((res) => setTimeout(res, 1000));
        }
        prefs.set('disclaimerAccepted', true);
        prefs.data.cookie = 'SESSDATA=smoke; bili_jct=smoke; DedeUserID=1';
        prefs.set('autoCoin', true);
        prefs.set('coinDate', prefs.today());
        let seen = null;
        api.checkIn = async (_cookie, opts) => {
          seen = { autoCoin: opts.autoCoin, coinSkipNote: opts.coinSkipNote };
          return { success: true, uname: 'smoke_user', lines: ['• 桩'], retryable: false, coinSpent: false };
        };
        startCheckInFlow(false);
        await new Promise((res) => setTimeout(res, 3500));
        console.log('[smoke10] opts=', JSON.stringify(seen));
        console.log([seen && seen.autoCoin === false, seen && seen.coinSkipNote === true].every(Boolean)
          ? '[smoke10] PASS 当天不再重复投币' : '[smoke10] FAIL 当天可能重复投币');
        app.quit();
      }, 1500);
    } else if (mode === '9') {
      // 自检用：打卡失败路径——必须写 ❌ 报告、不能写今日标记、窗口要关掉
      setTimeout(async () => {
        const dw = BrowserWindow.getAllWindows().find((x) => x.getTitle() === '免责声明');
        if (dw) {
          dw.webContents.executeJavaScript("document.getElementById('agree').click()");
          await new Promise((res) => setTimeout(res, 1000));
        }
        prefs.set('disclaimerAccepted', true);
        prefs.data.cookie = 'SESSDATA=smoke; bili_jct=smoke; DedeUserID=1';
        prefs.set('lastDate', '');
        api.checkIn = async () => ({
          success: false, uname: 'smoke_user', lines: ['• 桩：服务端没有计入'], retryable: false
        });
        const r = startCheckInFlow(false);
        await new Promise((res) => setTimeout(res, 9500));   // 失败路径停留 8 秒后关窗
        const st = {
          running: checkRunning,
          lastDate: prefs.get('lastDate'),
          failReport: prefs.get('lastReport').includes('❌'),
          windows: BrowserWindow.getAllWindows().map((w) => w.getTitle()).join('|')
        };
        console.log('[smoke9] result=', JSON.stringify(st), 'started=', JSON.stringify(r));
        const closed = !st.windows.includes('打卡进度') && !st.windows.includes('打卡中');
        console.log([st.running === false, st.lastDate === '', st.failReport, closed].every(Boolean)
          ? '[smoke9] PASS 失败路径正确' : '[smoke9] FAIL 失败路径不对');
        app.quit();
      }, 1500);
    } else if (mode === '8') {
      // 自检用：用户在内嵌页登录成功后「手动关窗」，关窗前的轮询可能还没跑到。
      // 关窗后必须再判定一次，不能误报「登录未完成」。
      setTimeout(async () => {
        const dw = BrowserWindow.getAllWindows().find((x) => x.getTitle() === '免责声明');
        if (dw) {
          dw.webContents.executeJavaScript("document.getElementById('agree').click()");
          await new Promise((res) => setTimeout(res, 1000));
        }
        api.URLS.login = 'about:blank';
        api.fetchNav = async () => ({ ok: true, uname: 'close_user' });
        for (const [name, value] of [['SESSDATA', 's8'], ['bili_jct', 'j8'], ['DedeUserID', '88']]) {
          await session.defaultSession.cookies.set({ url: 'https://www.bilibili.com/', name, value });
        }
        const p = openLogin(false);
        await new Promise((res) => setTimeout(res, 300));   // 早于 1 秒轮询
        if (loginWindow) loginWindow.close();
        const r = await p;
        const saved = prefs.get('cookie').includes('SESSDATA=s8');
        console.log('[smoke8] result=', JSON.stringify({ ok: r.ok, uname: r.uname, saved }));
        console.log([r.ok, r.uname === 'close_user', saved].every(Boolean)
          ? '[smoke8] PASS 手动关窗后仍认出登录态' : '[smoke8] FAIL 关窗后误判未登录');
        app.quit();
      }, 1200);
    } else if (mode === '7') {
      // 自检用：三项 Cookie 齐全但服务端说没登录 —— 必须清掉 Cookie、窗口留着，
      // 而不是当作登录成功闪退（这是 Android 版踩过的坑）
      setTimeout(async () => {
        const dw = BrowserWindow.getAllWindows().find((x) => x.getTitle() === '免责声明');
        if (dw) {
          dw.webContents.executeJavaScript("document.getElementById('agree').click()");
          await new Promise((res) => setTimeout(res, 1000));
        }
        api.URLS.login = 'about:blank';
        api.fetchNav = async () => ({ ok: false, net: false, message: '账号未登录' });
        for (const [name, value] of [['SESSDATA', 'stale'], ['bili_jct', 'stale'], ['DedeUserID', '77']]) {
          await session.defaultSession.cookies.set({ url: 'https://www.bilibili.com/', name, value });
        }
        openLogin(false);
        await new Promise((res) => setTimeout(res, 2500));
        const remain = (await session.defaultSession.cookies.get({})).filter((c) => c.name === 'SESSDATA').length;
        const keptOpen = Boolean(loginWindow);
        const savedNothing = !prefs.get('cookie');
        console.log('[smoke7] result=', JSON.stringify({ remain, keptOpen, savedNothing }));
        console.log([remain === 0, keptOpen, savedNothing].every(Boolean)
          ? '[smoke7] PASS 过期 Cookie 已清、窗口保留' : '[smoke7] FAIL 过期 Cookie 处理不对');
        if (loginWindow) loginWindow.close();
        setTimeout(() => app.quit(), 500);
      }, 1200);
    } else if (mode === '6') {
      // 自检用：真打开登录窗口（页面换成 about:blank），喂三个 Cookie + 桩校验，
      // 验证「三项齐全 → 真实校验 → 保存 → 自动关窗」这条最容易被判错的链路
      setTimeout(async () => {
        const dw = BrowserWindow.getAllWindows().find((x) => x.getTitle() === '免责声明');
        if (dw) {
          dw.webContents.executeJavaScript("document.getElementById('agree').click()");
          await new Promise((res) => setTimeout(res, 1000));
        }
        api.URLS.login = 'about:blank';
        api.fetchNav = async () => ({ ok: true, uname: 'stub_login_user' });
        for (const [name, value] of [['SESSDATA', 's6'], ['bili_jct', 'j6'], ['DedeUserID', '66']]) {
          await session.defaultSession.cookies.set({ url: 'https://www.bilibili.com/', name, value });
        }
        const r = await openLogin(false);
        const saved = prefs.get('cookie').includes('SESSDATA=s6');
        const closed = !loginWindow;
        const work = screen.getPrimaryDisplay().workAreaSize;
        const withinScreen = lastLoginBounds
          ? lastLoginBounds.width <= work.width && lastLoginBounds.height <= work.height
          : false;
        console.log('[smoke6] result=', JSON.stringify({ ok: r.ok, uname: r.uname, saved, closed }));
        console.log('[smoke6] bounds=', JSON.stringify(lastLoginBounds), 'screen=', JSON.stringify(work));
        console.log([r.ok, r.uname === 'stub_login_user', saved, closed, withinScreen].every(Boolean)
          ? '[smoke6] PASS 登录检测链路完整且窗口不超屏' : '[smoke6] FAIL 登录检测链路不完整');
        app.quit();
      }, 1200);
    } else if (mode === '5') {
      // 自检用：接口打桩，真跑一遍「点立即打卡 → 面板进度 → 落报告 → 关窗」的编排链路
      setTimeout(async () => {
        // 先把免责窗点掉，否则它挡在那里会让“关窗”断言失准
        const dw = BrowserWindow.getAllWindows().find((x) => x.getTitle() === '免责声明');
        if (dw) {
          dw.webContents.executeJavaScript("document.getElementById('agree').click()");
          await new Promise((res) => setTimeout(res, 1200));
        }
        prefs.set('disclaimerAccepted', true);
        prefs.data.cookie = 'SESSDATA=smoke; bili_jct=smoke; DedeUserID=1';
        api.checkIn = async () => ({
          success: true, uname: 'smoke_user', lines: ['• 全部为测试桩，不联网'], retryable: false
        });
        const r = startCheckInFlow(false);
        console.log('[smoke5] started=', JSON.stringify(r));
        await new Promise((res) => setTimeout(res, 3500));
        const state = {
          lastDate: prefs.get('lastDate'),
          hasReport: Boolean(prefs.get('lastReport')),
          running: checkRunning,
          windows: BrowserWindow.getAllWindows().map((w) => w.getTitle()).join('|')
        };
        console.log('[smoke5] result=', JSON.stringify(state));
        const checkWindowsClosed = !state.windows.includes('打卡进度') && !state.windows.includes('打卡中');
        const mw = BrowserWindow.getAllWindows().find((x) => x.getTitle().includes('每日自动打卡'));
        let uiOk = false;
        if (mw) {
          const ui = await mw.webContents.executeJavaScript(
            "JSON.stringify({disabled: document.getElementById('btnCheck').disabled," +
            " report: document.getElementById('reportBox').textContent})"
          );
          const parsed = JSON.parse(ui);
          uiOk = parsed.disabled === false && parsed.report.includes('测试桩');
        }
        const work = screen.getPrimaryDisplay().workAreaSize;
        const pageFits = lastPageBounds
          ? lastPageBounds.width <= work.width && lastPageBounds.height <= work.height
          : false;
        console.log('[smoke5] ui=', uiOk, 'pageBounds=', JSON.stringify(lastPageBounds), 'pageFits=', pageFits);
        console.log([state.lastDate && state.lastDate === prefs.today(), state.hasReport,
          state.running === false, checkWindowsClosed, uiOk, pageFits].every(Boolean)
          ? '[smoke5] PASS 编排链路完整' : '[smoke5] FAIL 编排链路不完整');
        app.quit();
      }, 1500);
    } else {
      setTimeout(() => {
        console.log('[smoke] windows:', BrowserWindow.getAllWindows().map((w) => w.getTitle()).join('|'));
        app.quit();
      }, 4000);
    }
  }
}

// ---------------------------------------------------------------- 设置页

/** 开发/自检用：把页面里的报错和加载失败打到终端，避免界面白屏却查不到原因 */
function attachDiagnostics(win, tag) {
  if (process.env.DEBUG_UI !== '1' && !IS_SMOKE) return;
  const wc = win.webContents;
  wc.on('console-message', (_e, level, message, line, source) => {
    console.log(`[${tag}] console(${level}) ${message} @${source}:${line}`);
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
    console.log(`[${tag}] 加载失败 ${code} ${desc} ${url} main=${isMain}`);
  });
  wc.on('render-process-gone', (_e, detail) => {
    console.log(`[${tag}] 渲染进程结束: ${detail.reason}`);
  });
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  // 小屏幕上 900 的高度会超出工作区，按实际可用高度收缩
  const work = screen.getPrimaryDisplay().workAreaSize;
  const winHeight = Math.min(900, Math.max(560, work.height - 80));
  const winWidth = Math.min(720, Math.max(560, work.width - 60));
  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: 560,
    minHeight: 520,
    title: '每日自动打卡 · 哔哩哔哩（Windows 版）',
    backgroundColor: '#FFF4F7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  attachDiagnostics(mainWindow, 'main');
  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

// ---------------------------------------------------------------- 免责条款

function showDisclaimer(onAccept) {
  if (disclaimerWindow && !disclaimerWindow.isDestroyed()) {
    disclaimerWindow.focus();
    return;
  }
  const parent = mainWindow || undefined;
  disclaimerWindow = new BrowserWindow({
    width: 560,
    height: 660,
    resizable: false,
    parent,
    modal: Boolean(parent),
    title: '免责声明',
    backgroundColor: '#FFF4F7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  attachDiagnostics(disclaimerWindow, 'disclaimer');
  disclaimerWindow.loadFile(path.join(__dirname, '..', 'ui', 'disclaimer.html'));
  disclaimerWindow.on('closed', () => {
    disclaimerWindow = null;
    // 首次启动时用户点 X 关闭 = 不同意，直接退出（与安卓版「不同意就 finish」等价）
    if (!prefs.get('disclaimerAccepted') && onAccept) {
      quitSuppressUntil = 0;
      app.quit();
    }
  });
  disclaimerWindow.__onAccept = onAccept;
}

/** 把窗口尺寸收进屏幕工作区，小屏笔记本（1366×768）上按钮不能被顶出屏幕 */
function fitToScreen(width, height) {
  const work = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.min(width, Math.max(420, work.width - 40)),
    height: Math.min(height, Math.max(400, work.height - 60))
  };
}

// ---------------------------------------------------------------- 登录窗口

async function webCookies() {
  const list = await session.defaultSession.cookies.get({});
  return list.filter((c) => (c.domain || '').includes('bilibili'));
}

async function currentCookieHeader() {
  return cookiesUtil.mergeCookies(await webCookies());
}

/** 清掉 B 站相关的过期 Cookie（校验失败时用，避免「打开即关闭」的死循环） */
async function clearBiliCookies() {
  for (const c of await webCookies()) {
    const url = `https://${(c.domain || '').replace(/^\./, '')}${c.path || '/'}`;
    try {
      await session.defaultSession.cookies.remove(url, c.name);
    } catch (_) {
      // 个别 Cookie 删不掉不影响继续
    }
  }
}

/**
 * 打开内置浏览器登录页并等待三项 Cookie 齐全。
 * @param {boolean} force 「重新登录」场景：必须出现与打开时不同的登录态才自动关闭
 */
async function openLogin(force) {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return { ok: false, reason: 'busy' };
  }
  // 基准取「网页自身」的 Cookie，而不是本地存的 Cookie：
  // 两者可能是不同账号，用本地那份判断会立刻误判成“已登录”而闪退。
  loginBaseline = cookiesUtil.cookieValue(await currentCookieHeader(), 'SESSDATA');

  const res = { ok: false, reason: 'closed' };
  const done = new Promise((resolve) => { res.resolve = resolve; });

  const loginSize = fitToScreen(480, 780);
  lastLoginBounds = loginSize;
  loginWindow = new BrowserWindow({
    width: loginSize.width,
    height: loginSize.height,
    title: '登录哔哩哔哩（登录一次即可长期使用）',
    backgroundColor: '#FFFFFF',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 与系统浏览器一致的真实 UA，避免「UA 与指纹不一致」被当成风控对象
      session: session.defaultSession
    }
  });

  const wc = loginWindow.webContents;
  // 只放行 http/https：登录成功后页面会尝试跳到 bilibili:// 拉起客户端，
   // 拦掉这类协议，否则整页会变成 ERR_UNKNOWN_URL_SCHEME 的空白页。
  const guard = (event, url) => {
    if (!/^https?:/i.test(url)) {
      event.preventDefault();
      return;
    }
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  wc.setWindowOpenHandler(({ url }) => (/^https?:/i.test(url) ? { action: 'allow' } : { action: 'deny' }));

  // 页面加载失败时把真实错误码显示出来，而不是只给一句“网络不给力”
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame) {
      dialog.showMessageBox(loginWindow, {
        type: 'warning',
        title: '页面加载失败',
        message: `网页加载失败（${code}：${desc}）`,
        detail: url || ''
      });
    }
  });

  loginWindow.loadURL(api.URLS.login);

  const timer = setInterval(async () => {
    if (!loginWindow || loginWindow.isDestroyed()) return;
    let header = '';
    try {
      header = await currentCookieHeader();
    } catch (_) {
      return;
    }
    // 判定逻辑抽到 gates.loginVerdict，单测覆盖「齐全但过期」「换号没生效」这些坑
    const first = loginVerdict(header, { force, baseline: loginBaseline });
    if (first.action !== 'check') return;

    const nav = await api.fetchNav(header);
    const verdict = loginVerdict(header, { force, baseline: loginBaseline, nav });
    if (verdict.action === 'wait') return;
    if (verdict.action === 'clear') {
      await clearBiliCookies();   // 登录态无效：清掉，让用户在本窗口重新登录
      return;
    }
    if (verdict.action !== 'ok') return;

    clearInterval(timer);
    res.settled = true;
    const switched = prefs.setSession(header, verdict.uname || '');
    // 先把引用清掉再关窗：close() 是异步的，等 'closed' 事件回来时
    // 调用方可能已经判断过「窗口是否还开着」，会误判成没关
    const win = loginWindow;
    loginWindow = null;
    if (win && !win.isDestroyed()) win.close();
    Object.assign(res, { ok: true, uname: verdict.uname || '', switched });
    res.resolve(res);
  }, 1000);

  loginWindow.on('closed', () => {
    clearInterval(timer);
    loginWindow = null;
    if (res.settled) return;
    // 用户手动关窗：页面里很可能已经登录成功，只是轮询还没轮到。
    // 关窗后再给最后判定一次，否则会误报「登录未完成」。
    (async () => {
      try {
        const header = await currentCookieHeader();
        if (cookiesUtil.hasFullSession(header)) {
          const nav = await api.fetchNav(header);
          if (nav.ok) {
            prefs.setSession(header, nav.uname || '');
            Object.assign(res, { ok: true, uname: nav.uname || '', switched: false });
          }
        }
      } catch (_) {
        // 拿不到就按未登录处理
      }
      res.settled = true;
      res.resolve(res);
    })();
  });

  const result = await done;
  return result;
}

/** 已登录但缺 bili_jct 时，必须明确告诉用户缺哪一项，而不是“登录成功但打卡永远失败” */
function sessionProblem() {
  const cookie = prefs.get('cookie');
  if (!cookie) return '尚未登录';
  const missing = ['SESSDATA', 'bili_jct', 'DedeUserID'].filter((k) => !cookiesUtil.cookieValue(cookie, k));
  return missing.length ? `登录信息不完整，缺少 ${missing.join(' / ')}` : '';
}

// ---------------------------------------------------------------- 打卡流程

async function runCheckIn(opts = {}) {
  // SESSDATA 会被服务端定期轮换，本地存的那份可能已经失效。
  // 网页会话里的 Cookie 是实时的，优先用它（同一账号，不会串号）。
  let cookie = prefs.get('cookie');
  let freshUsed = '';
  try {
    const fresh = await currentCookieHeader();
    if (cookiesUtil.hasFullSession(fresh)) {
      cookie = fresh;
      freshUsed = fresh;
    }
  } catch (_) {
    // 读不到会话就用本地那份
  }
  const autoCoin = shouldAutoCoin(prefs.get('autoCoin'), prefs.get('coinDate'), prefs.today());
  const result = await api.checkIn(cookie, {
    autoCoin,
    // 开关开着但今天已经投过：要让用户从报告里看到「跳过」，而不是以为程序没干活
    coinSkipNote: prefs.get('autoCoin') && !autoCoin,
    liveSign: prefs.get('liveSign'),
    onStep: (text) => sendProgress(text)
  });
  // 真花掉硬币才记账：重试/重打卡时不会一天扣两枚
  if (result && result.coinSpent) prefs.set('coinDate', prefs.today());

  // 服务端明确说「账号未登录」（不是网络问题）时，本地这份凭据已经没用了：
  // 留着只会让设置页永远显示「已登录」，用户以为好了，实际每天空跑
  if (result && result.navOk === false && !result.net && prefs.get('cookie')) {
    prefs.clearSession();
    result.uname = '';
    result.lines.push('• 登录已失效，已清除本地登录态，请点「登录哔哩哔哩」重新登录');
  }

  // 用实时 Cookie 跑完后，如果账号和本地存的不一致（会话里换了号），
  // 把本地也同步过去，否则界面显示的还是旧账号、今天的标记也会错位。
  if (freshUsed) {
    const stored = cookiesUtil.cookieValue(prefs.get('cookie'), 'SESSDATA');
    const current = cookiesUtil.cookieValue(freshUsed, 'SESSDATA');
    if (stored && current && stored !== current) prefs.setSession(freshUsed, result.uname);
  }
  return result;
}

function sendProgress(text) {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.webContents.send('progress', text);
  }
}

const { buildReport } = require('./report');

async function checkInWithRetry() {
  let res = await runCheckIn();
  let attempt = 0;
  while (!res.success && res.retryable && attempt < 2) {
    attempt++;
    const wait = attempt === 1 ? 10000 : 20000;
    sendProgress(`网络似乎还没就绪，${wait / 1000} 秒后重试（${attempt}/2）…`);
    await sleep(wait);
    res = await runCheckIn();
  }
  return res;
}

/**
 * 完整打卡流程：打开 B 站页面 + 进度面板 → 跑打卡 → 落报告 → 跳转 → 关闭。
 * @param {boolean} fromBoot 是否由开机自启触发（决定成功后是否等一会儿再关）
 */
function startCheckInFlow(fromBoot = false) {
  if (checkRunning) {
    return { started: false, reason: 'running' };
  }
  checkRunning = true;

  // 前提条件：未同意免责条款时不打卡（界面校验之外，后台入口也要挡）
  if (!prefs.get('disclaimerAccepted')) {
    checkRunning = false;
    return { started: false, reason: 'disclaimer' };
  }
  if (!prefs.loggedIn()) {
    checkRunning = false;
    return { started: false, reason: 'login' };
  }

  createPageWindow();
  createPanelWindow();

  // 日期在开始时定死：23:59 起跑、00:01 结束的打卡不能把「第二天」记成已完成
  const runDate = prefs.today();

  let flowPromise;
  try {
    flowPromise = checkInWithRetry();
  } catch (e) {
    // 起跑就失败也要把「正在打卡」的闸门放开，否则后面永远提示正在打卡中
    checkRunning = false;
    closeCheckInWindows();
    return { started: false, reason: '异常：' + (e && e.message ? e.message : String(e)) };
  }

  flowPromise
    .then(async (res) => {
      const report = buildReport(res, runDate);
      prefs.setLastReport(report);           // 成功失败都落盘，避免设置页一直显示上一次的成功报告
      if (res.success) prefs.setLastDate(runDate);
      if (panelWindow && !panelWindow.isDestroyed()) {
        panelWindow.webContents.send('result', { success: res.success, report });
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('refresh');
      }
      // 成功 2.5 秒后跳转并关闭；失败停留 8 秒，让用户看清原因
      await sleep(res.success ? 2500 : 8000);
      if (res.success && prefs.get('openBili')) openBiliSite();
      closeCheckInWindows();
      checkRunning = false;
      quitIfNothingLeft();
    })
    .catch((e) => {
      console.error('[checkIn] 例外:', e);
      const report = buildReport(
        { success: false, uname: prefs.get('uname'), lines: [`• 异常中断：${e && e.message ? e.message : String(e)}`] },
        runDate
      );
      prefs.setLastReport(report);
      if (panelWindow && !panelWindow.isDestroyed()) {
        panelWindow.webContents.send('result', { success: false, report });
      }
      setTimeout(() => {
        closeCheckInWindows();
        checkRunning = false;
        quitIfNothingLeft();
      }, 8000);
    });

  return { started: true };
}

function createPageWindow() {
  if (pageWindow && !pageWindow.isDestroyed()) return;
  const pageSize = fitToScreen(1180, 820);
  lastPageBounds = pageSize;
  pageWindow = new BrowserWindow({
    width: pageSize.width,
    height: pageSize.height,
    title: '哔哩哔哩（打卡中）',
    autoHideMenuBar: true,
    backgroundColor: '#FFFFFF',
    webPreferences: { contextIsolation: true, nodeIntegration: false, session: session.defaultSession }
  });
  pageWindow.loadURL('https://www.bilibili.com');
  pageWindow.on('closed', () => { pageWindow = null; });
}

function createPanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.show();
    return;
  }
  panelWindow = new BrowserWindow({
    width: 420,
    height: 320,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    title: '打卡进度',
    backgroundColor: '#00000000',
    transparent: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  attachDiagnostics(panelWindow, 'panel');
  panelWindow.loadFile(path.join(__dirname, '..', 'ui', 'panel.html'));
  panelWindow.setPosition(24, 24);
  panelWindow.on('closed', () => { panelWindow = null; });
}

function closeCheckInWindows() {
  if (panelWindow && !panelWindow.isDestroyed()) panelWindow.close();
  if (pageWindow && !pageWindow.isDestroyed()) pageWindow.close();
}

/** 打开 B 站：优先拉起客户端协议；只有客户端确实没装上时才回退到浏览器 */
function openBiliSite() {
  const fallback = () => {
    shell.openExternal('https://www.bilibili.com').catch(() => {});
  };
  // shell.openExternal 返回 Promise，协议没注册时会 reject（try/catch 抓不到异步失败）。
  // 必须用 .catch 才不至于「客户端和浏览器各开一次」。
  shell.openExternal('bilibili://').catch(fallback);
}

// ---------------------------------------------------------------- 开机自启流程

function bootFlow() {
  const gate = bootGate({
    disclaimerAccepted: prefs.get('disclaimerAccepted'),
    bootEnabled: prefs.get('bootEnabled'),
    loggedIn: prefs.loggedIn(),
    lastDate: prefs.get('lastDate')
  }, prefs.today());
  if (!gate.ok) {
    console.log('[boot] 跳过打卡：' + gate.reason);
    // 没登录时不能静默退出——开机本来就该把程序打开，用户才看得到要登录；
    // 登录成功后由下面的 login 处理补跑一次打卡
    if (gate.reason === '尚未登录') {
      bootPendingLogin = true;
      createMainWindow();
      return;
    }
    return app.quit();
  }

  const r = startCheckInFlow(true);
  if (!r.started) app.quit();

  // 打卡结束后如果没有任何窗口残留，直接退出进程（不常驻）
  const watcher = setInterval(() => {
    if (!checkRunning && BrowserWindow.getAllWindows().length === 0) {
      clearInterval(watcher);
      console.log('[boot] 打卡流程结束，退出进程');
      app.quit();
    }
  }, 1000);
  setTimeout(() => clearInterval(watcher), 120000);
}

// ---------------------------------------------------------------- IPC

function stateSnapshot() {
  return {
    uname: prefs.get('uname'),
    loggedIn: prefs.loggedIn(),
    sessionProblem: sessionProblem(),
    lastDate: prefs.get('lastDate'),
    lastReport: prefs.get('lastReport'),
    bootEnabled: prefs.get('bootEnabled'),
    openBili: prefs.get('openBili'),
    autoCoin: prefs.get('autoCoin'),
    liveSign: prefs.get('liveSign'),
    disclaimerAccepted: prefs.get('disclaimerAccepted'),
    autostartRegistered: Boolean(autoStart.readAutoStart()),
    today: prefs.today(),
    packaged: app.isPackaged,
    platform: process.platform
  };
}

function registerIpc() {
  ipcMain.handle('state', () => stateSnapshot());

  ipcMain.handle('setPref', (_e, key, value) => {
    const allowed = ['bootEnabled', 'openBili', 'autoCoin', 'liveSign'];
    if (!allowed.includes(key)) return stateSnapshot();
    prefs.set(key, Boolean(value));
    if (key === 'bootEnabled' && app.isPackaged) {
      autoStart.setAutoStart(Boolean(value), app.getPath('exe'));
    }
    return stateSnapshot();
  });

  ipcMain.handle('login', async (_e, force) => {
    const r = await openLogin(Boolean(force));
    if (r.ok && bootPendingLogin) {
      bootPendingLogin = false;
      // 登录窗已关，稍等一下再开打卡窗口，避免两个窗口的重叠动画
      setTimeout(() => { startCheckInFlow(true); }, 600);
    }
    return { ok: r.ok, uname: r.uname || '', switched: Boolean(r.switched), state: stateSnapshot() };
  });

  ipcMain.handle('checkNow', async () => {
    const problem = sessionProblem();
    if (problem) {
      const fresh = await currentCookieHeader().catch(() => '');
      if (!cookiesUtil.hasFullSession(fresh)) return { started: false, reason: problem };
      prefs.setSession(fresh, prefs.get('uname') || '');
    }
    return startCheckInFlow(false);
  });

  ipcMain.handle('netTest', async () => api.netProbe());

  ipcMain.handle('showDisclaimer', () => { showDisclaimer(null); });

  ipcMain.handle('acceptDisclaimer', () => {
    prefs.set('disclaimerAccepted', true);
    if (app.isPackaged && prefs.get('bootEnabled')) {
      autoStart.setAutoStart(true, app.getPath('exe'));
    }
    // 销毁免责窗口的瞬间会触发「所有窗口已关闭」，这里先压住退出，
  // 否则首次启动点「同意」后程序会直接退出，而不是打开设置页。
  quitSuppressUntil = Date.now() + 2000;
  // 空档期结束后如果既没有窗口、也没有在打卡，就正常退出，别留成无界面常驻进程
  setTimeout(() => {
    if (!checkRunning && BrowserWindow.getAllWindows().length === 0) app.quit();
  }, 2100);
  const win = disclaimerWindow;
  const cb = win && win.__onAccept;
  disclaimerWindow = null;
  if (win && !win.isDestroyed()) win.destroy();
  if (typeof cb === 'function') cb();
    return stateSnapshot();
  });

  ipcMain.handle('rejectDisclaimer', () => { app.quit(); });

  ipcMain.handle('openBili', () => { openBiliSite(); return true; });

  ipcMain.handle('closePanel', () => { closeCheckInWindows(); return true; });

  ipcMain.handle('retryFromPanel', () => {
    // 上一轮还在跑时不能重入：两套请求会互相关掉对方的面板、并发写同一份状态
    if (checkRunning) return { started: false, reason: 'running' };
    closeCheckInWindows();
    return startCheckInFlow(false);
  });

  ipcMain.handle('openDataDir', () => {
    shell.openPath(app.getPath('userData'));
    return true;
  });
}

/** 打卡收尾后如果没有任何窗口（典型是开机自启场景），直接退出进程，不留后台常驻 */
function quitIfNothingLeft() {
  if (BrowserWindow.getAllWindows().length === 0) {
    console.log('[flow] 没有残留窗口，退出进程');
    app.quit();
  }
}

// 任务栏/B 站页面被关掉时，面板留着会变成孤儿窗口
app.on('window-all-closed', () => {
  if (Date.now() < quitSuppressUntil) return;
  if (!checkRunning) {
    console.log('[flow] 窗口全部关闭且未在打卡，退出进程');
    app.quit();
  }
});
