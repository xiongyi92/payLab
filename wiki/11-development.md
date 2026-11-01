# 开发与排错

## 1. 运行要求

| 项 | 要求 |
| --- | --- |
| Node.js | 18 或以上（开发验证使用 24.x） |
| 操作系统 | Windows 10/11；Linux / macOS 也可直接运行 |
| 依赖 | 无。不需要 `npm install` |
| 浏览器 | Chrome / Edge / Firefox 等支持 ES Modules 的现代浏览器 |
| 磁盘 | 约 100 MB 可用空间（含便携 Node 时可额外占用约 85 MB） |

## 2. Windows 一键脚本

### `start.cmd`

双击后：

1. 以 UTF-8 打开控制台；
2. 调用 `scripts/bootstrap.ps1` 检查环境；
3. 检查 Node.js 版本，低于 18 或未安装时下载官方 LTS 便携版到 `.runtime/node/node.exe`；
4. 检查项目文件、数据目录、端口与 `state.json`；
5. 若该项目已在运行（探测 `/api/meta`），只打开已有地址并退出，不再启动第二个进程；
6. 否则启动 `server/server.js`；
7. 延迟 2 秒后打开浏览器。

> 重复双击是安全的：两个服务进程同时写 `data/state.json` 会导致后写覆盖，因此脚本宁可复用已有实例。

### `check-env.cmd`

只检查，不安装、不启动：

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap.ps1" -CheckOnly
```

### 脚本生成的文件

| 路径 | 内容 |
| --- | --- |
| `.runtime/node/node.exe` | 便携 Node.js（仅在系统缺少 Node 时下载） |
| `.runtime/node-exec.txt` | 本次使用的 `node.exe` 绝对路径 |
| `.runtime/port.txt` | 本次使用的端口 |

这些文件已加入 `.gitignore`。

### 端口选择

默认 5178。若首选端口被其他程序占用，脚本自动尝试 5179–5199 中的空闲端口，并把结果写入 `.runtime/port.txt`。若占用者是 PayLab 本身（`/api/meta` 返回正常），则复用该端口，不启动新实例。

## 3. 手动启动

```bash
node server/server.js
```

自定义端口：

```bash
# Windows CMD
set PORT=5180 && node server\server.js

# PowerShell
$env:PORT=5180; node server\server.js

# Linux / macOS
PORT=5180 node server/server.js
```

不自动打开浏览器：

```bat
set PAYLAB_NO_BROWSER=1
```

## 4. 目录与职责

```text
server/
  server.js      HTTP 入口、路由分发、静态文件
  engine.js      支付状态机与教学场景
  ops.js         平台账务、对账、结算
  interbank.js   跨机构清算与机构科目
  banking.js     银行业务
  seed.js        演示数据
  store.js       JSON 持久化
  util.js        金额、ID、签名、日期

public/
  index.html     单页外壳
  css/app.css    全站样式与颜色变量
  css/theme.css  6 套颜色主题（data-theme 覆盖变量）
  js/app.js      哈希路由
  js/theme.js    主题切换、持久化与无障碍下拉菜单
  js/api.js      fetch 封装
  js/ui.js       徽标、弹窗、格式化
  js/accounting.js 复式分录组件
  js/views/      11 个页面
```

## 5. 颜色主题

- 所有颜色集中在 `public/css/app.css` 的 `:root` 变量中；组件样式只引用变量，不写死色值。
- `public/css/theme.css` 用 `[data-theme="<id>"]` 覆盖同一组变量，已在 `ocean`（深海蓝，默认）、`violet`（星夜紫）、`forest`（翡翠绿）、`sunset`（落日橙）、`rose`（玫瑰粉）、`light`（晨雾白）中定义。
- 主题由 `public/js/theme.js` 管理：选择后写入 `localStorage['paylab.theme']`，并同步 `<meta name="theme-color">`；`index.html` 里的内联脚本在首屏渲染前读取并设置 `data-theme`，避免刷新闪烁。
- 新增主题：在 `theme.css` 增加 `[data-theme="<id>"]` 变量块，在 `theme.js` 的 `THEMES` 增加 `{ id, name, bg, swatch }`，同时把 id 加入 `index.html` 内联脚本的合法列表。
- 浅色主题需要额外覆盖状态色（绿/黄/红徽标、借贷方向、弹窗遮罩）以保证对比度。

## 6. 开发约定

- 服务端 CommonJS，前端原生 ES Modules；
- 不引入运行时依赖与构建工具；
- 金额一律整数分，入参在边界处用 `toCents` 转换；
- API 统一返回 `{ ok, data }` 或 `{ ok: false, error }`；
- 业务错误使用 `httpError(status, message)`；
- 所有跨机构分录必须借贷平衡，交给 `postJournal` 校验；
- 账务写入必须幂等，使用 `ledgerExists` 或业务状态判断；
- 前端展示统一使用 `esc()` 转义用户可控字符串。

## 7. 常见扩展

### 新增支付渠道

1. 在 `server/engine.js` 的 `CHANNELS` 增加渠道定义（费率、结算周期、备用通道）；
2. 在 `server/seed.js` 或页面表单中引用；
3. 如需特殊账务，在 `fees` 与清算场景中补充。

### 新增教学场景

1. 在 `SCENARIOS` 增加 `{ code, name, desc, amount, channel, buyer }`；
2. 在 `createPayment` 中处理强制渠道或买家；
3. 在 `runPhase` 的对应阶段增加分支；
4. 如需暂停，设置 `payment.waiting` 并在 `applyAction` 中处理。

### 新增支付阶段

1. 在 `PHASES` 插入阶段元数据；
2. 在 `LATENCY` 增加模拟耗时；
3. 在 `runPhase` 增加阶段逻辑；
4. 在 `stageRows` 增加数据行，在 `stageAccounting` 增加会计口径；
5. 更新前端 `stepper` 与相关文案（阶段数量会自动读取 `meta.phases.length`）。

### 新增清算场景

1. 在 `server/interbank.js` 的 `SCENARIOS` 注册场景；
2. 编写 `build*Flow(options)`，每个环节使用 `line()` 生成分录；
3. 在 `feeParts` 中定义费用拆分；
4. 在 `buildFlow` 中注册类型；
5. 确保每个环节借贷相等，并在页面验证全局试算。

### 新增银行科目

1. 在对应机构的 `chart` 中增加科目；
2. 在 `buildLines` 中引用；
3. 如需在页面汇总，更新 `banking.js` 的视图字段。

### 新增页面

1. 在 `public/js/views/` 新建视图，导出 `render(root, params)`；
2. 在 `app.js` 的 `routes` 与 `meta` 注册；
3. 在 `index.html` 的侧边栏增加导航项（可选）。

## 8. 调试方法

### 查看 API

```bash
curl http://localhost:5178/api/meta
curl http://localhost:5178/api/payments
curl http://localhost:5178/api/payments/PAY.../stages/3
```

响应统一包络，取数据时注意 `.data`。

### 查看事件

- 页面「报文与日志」支持按级别与关键词过滤；
- 支付详情返回完整 `events`；
- 阶段详情只返回该阶段事件。

### 浏览器调试

- 前端无构建步骤，修改 JS 后刷新即可；
- 页面报错看 DevTools Console；
- 网络请求看 DevTools Network，失败响应体含 `error` 字段。

### 重置数据

页面左下角「重置演示数据」，或：

```bash
curl -X POST http://localhost:5178/api/reset
```

也可以停止服务后删除 `data/state.json`，下次启动会重新播种。

## 9. 排错

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `未检测到 Node.js` | 系统无 Node，且便携下载失败 | 手动安装 Node 18+，或检查网络/代理后重试 |
| `端口 5178 已被占用` | 另一个程序占用 | 脚本会自动顺延；若占用者是 PayLab，则直接复用，不重复启动 |
| 双击 start.cmd 只显示「已在运行」 | 之前启动的实例还在 | 正常行为；关闭旧窗口/进程后再双击，或直接使用已打开的页面 |
| 页面空白 | JS 加载失败或接口报错 | 打开 DevTools Console / Network 查看 |
| 中文乱码 | 终端代码页不是 UTF-8 | 使用 `start.cmd`（内置 `chcp 65001`），或在 PowerShell 中设置 UTF-8 |
| 数据异常或想恢复初始状态 | 演示数据被修改 | 点击「重置演示数据」或删除 `data/state.json` |
| `state.json` 损坏 | 非正常退出/手工编辑 | 启动脚本会备份为 `state.json.corrupt-时间戳` 并重建 |
| 清算链路借贷不平衡 | 新增分录设计错误 | 检查 `postJournal` 报错信息，逐条核对借贷 |
| 支付流程卡住 | 处于 `waiting` 暂停点 | 查看页面提示，执行对应动作 |
| 退款失败 | 模拟失败或渠道异常 | 在退款页点击重试 |
| 结算没有可结算交易 | 结算日不匹配 | 按支付单的 `settleDate` 选择日期；跨境为 T+2 |

## 10. 验证清单

修改后建议至少验证：

1. 首页与 11 个页面均可打开，无控制台报错；
2. 正常支付 12 阶段可走通，最终 `SUCCESS`；
3. 账务入账分录借贷平衡；
4. 跨境支付可完成，清算链路 5 个环节全部 `DONE`；网联商品支付 6 个环节全部 `DONE`，且特参账户留存网络清算费；
5. 全局试算平衡 `balanced = true`；
6. 重复回调不新增分录；
7. 退款后商户净额正确；
8. 对账能识别注入的长款、短款与金额差异；
9. 结算批次能生成并出款；
10. 页面在窄屏下无横向溢出（开发时以约 826px 宽度验证）。

## 11. 安全边界

- 项目没有登录与权限控制，所有接口对本机开放；
- 默认监听所有网卡，若在不可信网络中使用，请通过防火墙限制访问，或修改 `server.js` 仅绑定 `127.0.0.1`；
- 签名密钥是教学固定值，不能用于真实业务；
- 不要将 `data/state.json`、`.runtime/` 或包含个人信息的演示数据提交到公开仓库。

## 12. 发布到 Git

`.gitignore` 已排除运行时数据与便携运行时。常规流程：

```bash
git init
git add .
git commit -m "feat: PayLab 支付全链路教学系统"
git branch -M main
git remote add origin https://github.com/<owner>/payLab.git
git push -u origin main
```

如果仓库已有内容，先 `git pull --rebase` 再推送。
