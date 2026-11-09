# 每日自动打卡 · 哔哩哔哩（Windows 电脑版）

登录 Windows 后自动跑一次的哔哩哔哩每日任务工具。免安装、免运行库，解压即用，每天只跑一次。

这是安卓版的 Windows 移植版：**功能、开关含义、成功判定口径与安卓版一一对应**，界面从系统 WebView 换成 Electron 窗口，其余逻辑不变。

---

## 一、它每天做什么

一次完整运行是这样的：

1. 你登录 Windows（或自己双击图标）
2. 程序检查四道闸门：同意过免责 → 开着自启动 → 有登录态 → 今天还没成功打卡
3. 放行后打开 B 站页面窗口 + 置顶的打卡进度面板
4. 用网页登录时留下的 Cookie 调接口：查登录态 → 查今日任务 → 分享 → 观看（3 次心跳）→ 投币（默认关）→ 直播签到
5. 每做完一项就在面板上打一行进度，结束时写一份带 ✅ / ❌ 的结果报告
6. 跳转到 B 站：先试客户端 `bilibili://`，没有客户端就退回默认浏览器
7. 关掉所有窗口，进程退出（不常驻、不占内存）

失败会如实写 ❌ 报告，**不会**把「接口返回 0」当成「任务已完成」。

---

## 二、能力对照（与安卓版）

| 能力 | Windows 实现 |
|---|---|
| 开机自动打开并打卡 | 写 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`，登录后以 `--boot` 参数启动 |
| 每天只跑一次 | 免责条款 / 自启动开关 / 已登录 / 当天标记，四道闸门 |
| 内嵌浏览器打开 B 站 | 独立 Chromium 窗口加载 `bilibili.com`，与系统浏览器同内核 |
| 网页登录抓 Cookie | 真实浏览器窗口登录，直接读 `session.cookies` 中 `www / passport / api` 三个域 |
| 四项任务 | 登录态、分享、观看（3 次心跳、间隔 3 秒）、投币（默认关）、直播签到 |
| 结果可信 | 分享 / 观看都回查任务列表，不拿接口 `code:0` 当成功 |
| 打卡后跳转 | 先试 `bilibili://` 拉起客户端，失败退回默认浏览器网页版 |
| 设置页 | 4 个开关 + 立即打卡 + 网络检测 + 打开配置目录 + 免责入口 |
| 免责条款 | 首次启动强制弹窗，不同意直接退出；开机入口同样校验；同意后才写自启动 |
| 并发防护 | 单实例锁 + `checkRunning` 闸门，连点 / 重开都不会跑两套请求 |
| 一天最多一枚硬币 | 本地记录 `coinDate`，重试和「重新打卡」都不会重复扣 |

---

## 三、系统要求

- Windows 10 及以上，64 位
- 首次运行需要联网（页面和接口都走 HTTPS）
- 不需要安装 Node、Java、.NET 或任何运行库：Electron 运行时已打进包里
- 不需要管理员权限：自启动只写当前用户的注册表项

---

## 四、快速开始（用打包好的免安装包）

解压 `每日自动打卡-Windows-v1.0.0.zip`，双击里面的 `每日自动打卡.exe`。

1. 首次启动先弹《免责声明》，点「同意并继续」（不同意会直接退出）
2. 点「登录哔哩哔哩」，在弹出的窗口里登录。**推荐「账号密码登录」**，短信验证码要过极验，容易失败
3. 登录成功后窗口自动关闭，设置页显示「已登录」和你的昵称
4. 确认「开机自动打开并打卡」是打开状态——这是免安装包，首次同意免责后会自动写注册表，之后每次登录 Windows 都会跑一次
5. 想立刻试：点「立即打卡」，进度面板会实时显示每一步

SmartScreen 提示「未知发布者」是正常的（exe 未签名），点「更多信息 → 仍要运行」。

---

## 五、从源码运行

需要 Node.js 18+ 与 npm。

```bash
npm install                 # 装 Electron 33.4.11（国内建议用镜像）
npm test                    # 50 个单元测试
npm run lint                # ESLint 静态检查
npm start                   # 开发模式直接运行
```

装依赖时走镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
npm install --registry=https://registry.npmmirror.com
```

---

## 六、自己打包成免安装目录

在 Linux / macOS 上也能做，**不需要 wine**（打不了 NSIS 安装包，所以走免安装 zip）：

```bash
# 1. 取 Windows 运行时（约 110 MB）
curl -L -o electron.zip \
  https://npmmirror.com/mirrors/electron/33.4.11/electron-v33.4.11-win32-x64.zip
unzip electron.zip -d 每日自动打卡

# 2. 应用放进 resources/app（Electron 会优先加载这个目录）
mkdir -p 每日自动打卡/resources/app
cp -r src ui package.json README.md 每日自动打卡/resources/app/

# 3. 把 electron.exe 改成看得懂的名字
mv 每日自动打卡/electron.exe "每日自动打卡/每日自动打卡.exe"

# 4. 压缩
zip -qr9 每日自动打卡-Windows-v1.0.0.zip 每日自动打卡
```

打包后的目录长这样：

```
每日自动打卡/
├── 每日自动打卡.exe          # 双击这个
└── resources/app/            # 应用本体（src / ui / package.json / README.md）
```

放在 `resources/app` 下运行时，`app.isPackaged` 为 `true`，程序才会去写注册表自启动；开发模式（`npm start`）跑的是 electron.exe，程序会自动跳过自启动写入，避免把开发路径写进注册表。

---

## 七、工作原理

### 为什么用 Electron

安卓版靠系统 WebView 登录、从 CookieManager 取 Cookie。Windows 上要等价复现「内嵌浏览器登录 + 拿到 Cookie」，Electron 最直接：内嵌的 Chromium 就是浏览器，Cookie 可以直接从 `session.defaultSession.cookies` 读，不需要让用户手动导出 Cookie。

版本固定在 33.4.11：不需要常驻后台服务、不需要原生编译，逻辑只有「主进程 + 三个界面」这一层，没有额外的本地服务进程。

### 四道闸门（开机入口）

开机（`--boot`）时依次检查，任一条不满足就直接退出，不弹窗、不打扰：

| 顺序 | 条件 | 不满足时的行为 |
|---|---|---|
| 1 | `disclaimerAccepted` 为 true | 首次启动会先弹免责，同意后才继续 |
| 2 | `bootEnabled` 为 true | 用户关了自启动开关，直接退出 |
| 3 | 有完整登录态（`SESSDATA` + `bili_jct` + `DedeUserID`） | 打开设置页等你登录；**登录成功后自动补跑一次打卡**，不用再点按钮 |
| 4 | `lastDate` 不是今天 | 今天已成功打过卡，直接退出 |

手动入口（双击图标、点「立即打卡」）的规则不同：只要求**已同意免责**且**已登录**；不检查自启动开关，也**不检查今天是否已完成**——用户主动点的，允许当天重跑（但投币仍受「一天一枚」约束）。

### 打卡链路

| 步骤 | 做的事 |
|---|---|
| 1 | `nav` 查登录态，拿昵称、等级、硬币数；同时作为「Cookie 是否真有效」的依据 |
| 2 | `exp/reward` 查今日任务完成情况与今日经验 |
| 3 | `ranking/v2` 取一个视频（后续分享、心跳要用 aid/cid） |
| 4 | `share/add` 提交分享，**再回查任务列表**确认是否真的计入 |
| 5 | 观看：`pagelist` 取 cid → 3 次 `heartbeat`，间隔 3 秒，三次共用同一个 `start_ts`（否则服务端当成三段独立播放） |
| 6 | 投币：默认关闭；开启时也只在「今天没投过」时投 1 枚 |
| 7 | 直播签到：`DoSign`（活动下线时如实写「无法使用」） |
| 8 | 汇总：`judgeSuccess` 判定 → 生成报告 → 写 `lastDate` / `lastReport` |

### 成功怎么判

```js
navOk && (didSomething || todayExp > 0 || tasksAlreadyDone)
```

- 登录态无效 → 直接判失败
- 四项任务全是「—」且今日经验 +0 → 判失败（不会因为「跑完了流程」就报成功）
- 已经有任务计入（比如今天早就在手机上做过）→ 判成功

### 失败与重试

- 网络类错误（`TIMEOUT` / `ECONN` / `ENOTFOUND` / `EAI_AGAIN` / `socket`）标记为可重试，最多再跑 2 次，间隔 10 秒、20 秒
- 业务类失败（登录失效、任务没计入）不重试，直接落 ❌ 报告
- 服务端明确说「账号未登录」（且不是网络问题）时，会**清掉本地这份已经没用的凭据**，否则设置页会永远显示「已登录」，用户以为好了，实际每天空跑

### 一天只跑一次，且不会重复花钱

- `lastDate` 记的是**流程开始那一刻**的日期：23:59 起跑、00:01 结束的打卡不会把第二天误记成已完成
- 投币单独记 `coinDate`：只有真投成功才记；网络重试、面板「重新打卡」都不会在同一天扣第二枚硬币
- 换账号时 `lastDate`、`coinDate` 一起清空，新账号不会继承旧账号的「今天已完成」

### 重入与退出

- 单实例锁：第二次双击只会激活已有窗口
- `checkRunning` 闸门：打卡进行中再点「立即打卡」会被挡回并提示，不会跑两套请求
- 打卡进行中关窗不会退出进程；流程结束后如果没有残留窗口才退出

---

## 八、目录结构

```
BiliDailyWin/
├── package.json            # 入口 src/main.js，devDependency 只有 electron
├── .eslintrc.json          # no-undef / no-redeclare / no-dupe-keys / no-unreachable
├── README.md               # 本文
├── src/
│   ├── main.js      (959)  # 主进程：窗口、登录抓 Cookie、打卡编排、自启动、单实例、自检分支
│   ├── api.js       (419)  # 全部 B 站接口 + 成功判据，纯 Node https/http，零第三方依赖
│   ├── prefs.js     (134)  # 配置存储，临时文件 + 原子 rename + .bak 恢复
│   ├── autostart.js  (94)  # 注册表 Run 键读写（PowerShell 优先，reg 兜底）
│   ├── cookies.js    (47)  # 三个域的 Cookie 按 key 合并去重
│   ├── gates.js      (44)  # 纯函数：开机闸门、登录判定、投币当日判定
│   ├── report.js     (13)  # 报告文本格式
│   └── preload.js    (23)  # contextBridge，界面拿不到 Node 能力
├── ui/                     # 原生 HTML + CSS + JS（严格 CSP，脚本全部外置）
│   ├── index.html   (83)   # 设置页
│   ├── panel.html   (80)   # 打卡进度面板（无边框、置顶）
│   ├── disclaimer.html(69) # 免责条款
│   ├── style.css   (152)
│   ├── renderer.js (144)   # 设置页逻辑
│   ├── panel.js     (22)
│   └── disclaimer.js (7)
└── test/                   # 50 个 node:test 用例
```

### 测试分布

| 文件 | 用例 | 覆盖内容 |
|---|---|---|
| `api.test.js` | 7 | 成功判据、任务解析、Cookie 取值 |
| `gates.test.js` | 6 | 开机四道闸门 |
| `login-verdict.test.js` | 6 | 登录判定（三项齐全≠有效 / 重登不该立刻关窗） |
| `prefs.test.js` | 6 | 配置读写、默认值 |
| `prefs-robust.test.js` | 6 | 原子写、损坏恢复、残缺 Cookie 不覆盖、换号清派生状态、清凭据 |
| `autostart-command.test.js` | 5 | 自启动命令比对、乱码降级校验 |
| `ui-contract.test.js` | 5 | 页面脚本引用的 id 必须存在、`window.api.*` 必须已暴露、`ipcRenderer.invoke` 必须有对应 handler |
| `cookies.test.js` | 4 | 三域 Cookie 合并去重 |
| `coin-once.test.js` | 4 | 投币当日一次 |

---

## 九、配置文件

位置：`%APPDATA%\每日自动打卡\config.json`（Windows），Linux/macOS 为 `~/.config/每日自动打卡/config.json`。

| 键 | 默认值 | 含义 |
|---|---|---|
| `cookie` | `''` | 完整 Cookie 串（至少含 `SESSDATA`、`bili_jct`、`DedeUserID`） |
| `uname` | `''` | 昵称，用于界面显示 |
| `lastDate` | `''` | 上次**成功**打卡的日期 `yyyy-MM-dd` |
| `lastReport` | `''` | 上次打卡报告全文（成功失败都写） |
| `bootEnabled` | `true` | 登录 Windows 后自启动 |
| `openBili` | `true` | 打卡后自动打开 B 站 |
| `autoCoin` | `false` | 自动投币（消耗真实硬币，默认关） |
| `liveSign` | `true` | 直播间签到 |
| `coinDate` | `''` | 最近一次真正消耗硬币的日期 |
| `disclaimerAccepted` | `false` | 是否已同意免责条款 |

写入是「临时文件 → 原子 rename → 保留 `.bak`」，启动时主文件损坏会自动从备份恢复；残缺 Cookie（缺 `bili_jct`）不会覆盖已有的有效登录态。

---

## 十、接口清单

全部集中在 `src/api.js`，主机与安卓版一致：

| 用途 | 接口 |
|---|---|
| 登录态 / 昵称 / 等级 / 硬币 | `api.bilibili.com/x/web-interface/nav` |
| 今日任务与经验 | `api.bilibili.com/x/member/web/exp/reward` |
| 分享 | `api.bilibili.com/x/web-interface/share/add` |
| 投币 | `api.bilibili.com/x/web-interface/coin/add` |
| 直播签到 | `api.live.bilibili.com/xlive/web-ucenter/v1/sign/DoSign` |
| 排行榜取视频 | `api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all` |
| 取 cid | `api.bilibili.com/x/player/pagelist` |
| 观看心跳 | `api.bilibili.com/x/click-interface/web/heartbeat` |
| 登录页 | `passport.bilibili.com/login` |

**一个必须记住的坑**：`share/add` 和 `heartbeat` 用**无效 Cookie 也会返回 `code:0`**。所以这两个任务一律以「回查任务列表」为准，返回码不可信。投币 `coin/add` 用无效 Cookie 会返回 `-400`。

---

## 十一、开机自启的细节

- 位置：`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`，值名「每日自动打卡」
- 值：`"<exe 完整路径>" --boot`
- 只写当前用户，不需要管理员权限，不装服务、不加计划任务
- 读取优先用 PowerShell（脚本以 UTF-16 + base64 `-EncodedCommand` 传入，强制 UTF-8 输出），失败才退回 `reg query`
  - 原因：`reg query` 在中文 Windows 下按 OEM 代码页输出，Node 用 UTF-8 解码会把 `C:\Users\张三\…` 变成乱码，导致「明明写成功却被判成不一致」，每次启动都重写注册表还报假错
- 写完会回读比对；比对不上（被安全软件/组策略拦下）会如实提示，而不是假装成功
- 关闭开关时删掉该值

想手工确认是否生效：任务管理器 →「启动」标签页，应能看到「每日自动打卡」。

---

## 十二、隐私与数据

- Cookie、昵称、打卡报告**只存在本机** `config.json`，不上传任何服务器
- 没有统计、没有遥测、没有崩溃上报
- 除了 B 站官方接口，不请求任何第三方地址
- 删掉 `%APPDATA%\每日自动打卡` 即可清空全部本地数据

---

## 十三、自检体系

证据分三级，本文严格区分，不含糊：

- **已实测**：单元测试、ESLint、12 种冒烟（真开窗口、真跑编排、接口打桩）
- **仅代码审查**：注册表写入的具体表现、Windows 上 `session.cookies` 的实际返回形态
- **未端到端验证**：真实账号下任务是否计入、安全软件是否拦截自启动、`bilibili://` 能否拉起客户端

```bash
npm test      # 50 个单元测试
npm run lint  # ESLint：no-undef 能拦住「函数名写错」这类 node --check 查不出的问题
```

界面与编排用虚拟显示真跑（无桌面环境也能跑）：

```bash
SMOKE_TEST=2  DEBUG_UI=1 xvfb-run -a ./node_modules/electron/dist/electron . --no-sandbox  # 免责 → 设置页
SMOKE_TEST=3  DEBUG_UI=1 xvfb-run -a ./node_modules/electron/dist/electron . --no-sandbox  # 截设置页（含最小尺寸）
SMOKE_TEST=4  DEBUG_UI=1 xvfb-run -a ./node_modules/electron/dist/electron . --no-sandbox  # 截打卡面板
SMOKE_TEST=5  DEBUG_UI=1 xvfb-run -a ./node_modules/electron/dist/electron . --no-sandbox  # 接口打桩，真跑一遍打卡编排
SMOKE_TEST=6  DEBUG_UI=1 xvfb-run -a ./node_modules/electron/dist/electron . --no-sandbox  # 登录检测：齐全→校验→保存→关窗
SMOKE_TEST=7  DEBUG_UI=1 xvfb-run -a ./node_modules/electron/dist/electron . --no-sandbox  # 过期 Cookie：清掉且窗口保留
SMOKE_TEST=8  DEBUG_UI=1 xvfb-run -a ./node_modules/electron/dist/electron . --no-sandbox  # 手动关窗后仍能认出已登录
SMOKE_TEST=9  DEBUG_UI=1 xvfb-run -a ./node_modules/electron/dist/electron . --no-sandbox  # 失败路径：写 ❌ 报告、不写今日标记
SMOKE_TEST=10 DEBUG_UI=1 xvfb-run -a ./node_modules/electron/dist/electron . --no-sandbox  # 当天已投币时不再重复扣硬币
SMOKE_TEST=11 DEBUG_UI=1 xvfb-run -a ./node_modules/electron/dist/electron . --boot --no-sandbox  # 开机自启全链路（跑完自动退出）
SMOKE_TEST=12 DEBUG_UI=1 xvfb-run -a ./node_modules/electron/dist/electron . --no-sandbox  # 登录过期时清掉本地凭据
SMOKE_TEST=13 DEBUG_UI=1 xvfb-run -a ./node_modules/electron/dist/electron . --boot --no-sandbox  # 开机未登录：开界面等待登录
SMOKE_TEST=14 DEBUG_UI=1 xvfb-run -a ./node_modules/electron/dist/electron . --boot --no-sandbox  # 开机未登录→登录后自动补跑打卡
```

`SMOKE_TEST=5` 会把接口换成桩，完整走「立即打卡 → 面板进度 → 落报告 → 写今日标记 → 关窗 → 标记复位」，专门拦编排层的低级错误（函数名写错这类 `node --check` 查不出来，截图也看不出来）。

手动验证开机闸门：

```bash
# 把 config.json 的 lastDate 写成今天，然后带 --boot 启动
./每日自动打卡.exe --boot     # 应打印「跳过打卡：今天已经打过卡」并退出
```

---

## 十四、已知限制

- **LV0 未转正账号拿不到经验**：平台规则如此（需 LV1 且绑定手机），此时会如实报告「今日没有产生任何经验」，不伪装成功
- **短信验证码受极验限制**：`sms/send` 会返回 `-105`，必须先在网页上过极验；建议直接用账号密码登录
- **接口是网页端私有接口**：平台调整后需要同步改 `src/api.js`
- **exe 未签名**：SmartScreen 会提示「未知发布者」
- **未在真机 Windows 上端到端验证**：注册表自启是否被安全软件拦、PowerShell 读注册表是否正常、`bilibili://` 能否拉起客户端、真实账号下分享与心跳是否真计入——这四项必须有 Windows 真机 + 真实账号才能确认
- 开发环境为 Linux 沙箱，SSL 握手被拦，**B 站接口从未真正联通**；所有接口结论来自安卓期用无效 Cookie 的实测，冒烟测试一律用桩

---

## 十五、常见问题

**双击没反应？**
已经有一个实例在跑时，第二次双击只会把已有窗口提到前面。若窗口也没出现，检查任务管理器里是否还有进程，然后重启。

**提示「未知发布者」？**
exe 没有代码签名，点「更多信息 → 仍要运行」即可。要消除提示得自备签名证书。

**登录了还是显示未登录？**
登录态必须三项齐全（`SESSDATA` + `bili_jct` + `DedeUserID`）。缺哪项界面会用红字写明，重新登录一次即可。

**打卡报告四项全「—」、经验 +0？**
账号等级 LV0 未转正，平台不给经验。换 LV1 以上账号即可。

**打卡后没打开 B 站？**
先试 `bilibili://` 客户端，没装客户端会退回默认浏览器。若两者都没反应，检查默认浏览器是否被安全软件拦截。

**每天没有自动跑？**
先看是不是没登录（开机时程序会停在设置页，登录完才会自动补跑）。若问题在自启动：设置页底部会红字提示「开机自启动没有写进注册表」，说明被安全软件拦了写入，把 exe 加白名单后重开一次设置页即可再次写入；也可以直接去任务管理器 →「启动」里确认有没有「每日自动打卡」。

**报告写着「今天已经投过，不再重复扣硬币」？**
这是当天的幂等保护，不是漏做。第二天会正常投。

**想彻底重来？**
删掉 `%APPDATA%\每日自动打卡`（会清掉登录态、开关、报告、当日标记），重新打开程序。

---

## 十六、卸载

1. 设置页关掉「开机自动打开并打卡」（会删注册表值），或手工删 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 下的「每日自动打卡」
2. 删掉程序目录
3. 删掉 `%APPDATA%\每日自动打卡`（可选，删了登录态和报告也没了）

---

## 十七、免责声明

个人自用辅助工具，非哔哩哔哩官方产品，与哔哩哔哩无任何关联。第三方自动化操作可能违反平台用户协议，账号风险由使用者自行承担。完整条款见应用内「免责声明」（首次启动强制确认，不同意无法使用）。
</content>
