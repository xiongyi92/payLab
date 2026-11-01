---
name: paylab-dev
description: 'PayLab 支付全链路教学系统的开发指南。用于在 I:\workspace\支付\payLab 中新增或修改支付 12 阶段、教学场景、清算与会计链路、复式分录、前端页面、颜色主题、API、种子数据或 Windows 启动脚本，运行和验证零依赖 Node 服务，或排查 data/state.json、全局试算平衡、清算链路借贷不平衡等问题。'
---

# PayLab 开发指南

## 概览

PayLab 是零依赖的支付全链路教学沙箱：服务端只用 Node.js 内置模块（CommonJS），前端为原生 ES Modules（无框架、无构建），数据持久化到 `data/state.json`。核心链路是「支付 12 阶段 → 平台复式账 → 跨机构清算 → 对账 / 结算 / 银行会计」。

## 启动与验证

```bash
cd I:/workspace/支付/payLab
node server/server.js            # http://localhost:5178
PORT=5180 node server/server.js  # 指定端口
```

- Windows 双击 `start.cmd`：检查 Node 18+、按需安装便携运行时、检测已在运行的实例、启动并打开浏览器；`check-env.cmd` 只检查。
- 没有 npm 依赖、构建步骤或测试框架，不要引入 `package.json`、打包器或运行时依赖。
- 服务端改动后必须重启 Node 进程；前端改动刷新即可，但浏览器可能缓存旧资源，用 `?v=时间戳` 或强制刷新。
- 只读健康检查（服务需已启动）：

```bash
node .qoder/skills/paylab-dev/scripts/smoke.mjs        # 默认 5178
node .qoder/skills/paylab-dev/scripts/smoke.mjs 5180   # 指定端口
```

语法检查：

```bash
for f in server/*.js; do node --check "$f" || exit 1; done
for f in public/js/*.js public/js/views/*.js; do node --input-type=module --check < "$f" || exit 1; done
```

数据与测试：

- `data/state.json` 是运行时数据，已加入 `.gitignore`；损坏时启动脚本会备份并重建。
- `POST /api/reset` 清空并重新播种演示数据，页面左下角「重置演示数据」等价。
- 通过 API 创建清算链路会写入演示数据，且没有删除单条链路的 API；测试后优先重置，或只创建最小链路。
- 用 Git Bash 的 `curl --data` 发送中文可能产生乱码；涉及中文的测试数据改用 `node -e` / `fetch` 或写入 UTF-8 JSON 文件。
- 根目录 `books/` 是参考 PDF，不参与运行；不要修改、提交或依赖它。

## 代码地图

| 路径 | 职责 |
| --- | --- |
| `server/server.js` | HTTP 入口、API 路由分发、静态文件、统一响应 |
| `server/engine.js` | 支付 12 阶段状态机、教学场景、可靠性实验、退款、风控 |
| `server/ops.js` | 平台复式账、对账、结算批次 |
| `server/interbank.js` | 机构与科目、7 类跨机构清算场景、链路环节、全局清算分录 |
| `server/banking.js` | 商业银行存贷款与中间业务 |
| `server/seed.js` | 首次启动的演示数据 |
| `server/store.js` | `data/state.json` 的初始化、去抖保存、重置 |
| `server/util.js` | 金额分转换、ID、HMAC 签名、日期 |
| `public/index.html` | 单页外壳、主题首屏脚本、导航 |
| `public/js/app.js` | 哈希路由、页面标题、重置入口 |
| `public/js/theme.js` | 6 套主题切换、localStorage 持久化、无障碍下拉 |
| `public/js/views/*.js` | 11 个页面视图，默认导出 `{ render(root, params) }` |
| `public/css/app.css` | 布局与颜色变量（`:root`） |
| `public/css/theme.css` | `[data-theme]` 主题变量覆盖 |
| `wiki/` | 架构、支付链路、账务、清算、API、开发排错文档 |
| `scripts/bootstrap.ps1` | Windows 环境检查与便携 Node 安装 |

关键入口：`store.init()` / `seed.run()`、`engine.PHASES`、`engine.SCENARIOS`、`interbank.INSTITUTIONS`、`interbank.SCENARIOS`、`interbank.postJournal()`、`handleApi()`。

## 不可破坏的约定

- **金额一律整数分**：所有存储与分录金额用分，边界处用 `toCents`；展示层再格式化。
- **API 统一信封**：成功 `{ ok: true, data }`，失败 `{ ok: false, error }`；业务错误用 `httpError(status, message)`。
- **借贷必须平衡**：跨机构分录交给 `postJournal`，写入前校验 `借方合计 = 贷方合计`；任何新环节先手算平衡。
- **账务写入幂等**：支付、退款、对账、清算都要用状态或 `ledgerExists` 防重复记账。
- **输出必须转义**：前端渲染用户可控字符串统一用 `esc()`。
- **零依赖、无构建**：不要新增 npm 包、打包器或编译步骤。
- **颜色走变量**：组件样式引用 `app.css` 的 CSS 变量，不写死色值；主题只改变量。
- **机构科目代码稳定**：余额按 `institution + code` 汇总，可以改显示名和描述，不要随意改 `code`，否则历史分录余额会丢失。
- **清算环节序号连续**：`makeLeg(0..n)` 必须连续；`SCENARIOS[].legs` 必须与 builder 实际环节数一致；`seedFlows` 的 `run` 不超过环节数。
- **旧数据兼容**：新增字段时在 `ensureState()` / `store.init()` 中补默认值；新增环节不会迁移历史链路，旧流程保留原环节数。

## 常见任务

### 修改清算 / 会计链路

在 `server/interbank.js` 对应 `build*Flow` 中增删 `makeLeg`，保证：

1. 环节序号连续；
2. 每个环节的 `entries` 借贷相等；
3. 机构与科目存在于 `INSTITUTIONS[].chart`；
4. 更新 `SCENARIOS[].legs`、`seedFlows` 的 `run` 和 `wiki/05-clearing-banking.md`；
5. 用 `/api/clearing/flows` 创建并跑完整链路，确认 `status = DONE`、`trial.balanced = true`。

网联特参账户链路是目前最完整的示例：`buildGoodsFlow` 中的「特参账户收款 / 划付」两环节，资产端 `NETSUNION.RESERVE_PBOC`，负债端 `PBOC.RESERVE_NETSUNION`，网络费留存于特参账户。

### 新增支付阶段

在 `server/engine.js`：`PHASES` 加元数据、`LATENCY` 加耗时、`runPhase` 加逻辑、`stageRows` 加数据、`stageAccounting` 加会计口径。前端 stepper 读取 `meta.phases.length`，通常无需改页面。

### 新增教学场景

- 支付场景：`engine.SCENARIOS` + `createPayment` / `runPhase` 分支。
- 清算场景：`interbank.SCENARIOS` + 新 `build*Flow` + `buildFlow` 注册，并同步 `legs`。

### 新增页面

1. 在 `public/js/views/` 新建视图并默认导出 `render`；
2. 在 `app.js` 的 `routes` 与 `meta` 注册；
3. 在 `index.html` 导航加入 `data-route` 链接；
4. 深链接使用 `#/page`，带参数使用 `#/stage/<id>` 形式。

### 新增颜色主题

同时修改四处，缺一不可：

1. `public/css/app.css`：补充或复用语义变量，组件不写死颜色；
2. `public/css/theme.css`：新增 `[data-theme="<id>"]` 变量块，浅色主题还要覆盖状态色与遮罩；
3. `public/js/theme.js`：在 `THEMES` 加 `{ id, name, bg, swatch }`；
4. `public/index.html`：把 id 加入首屏脚本的合法主题列表。

### 新增 API

在 `server/server.js` 的 `handleApi` 中匹配方法 + 路径，返回统一信封；路由参数用正则捕获。同步更新 `wiki/09-api.md`。

## 验证清单

完成改动后至少执行：

1. 语法检查（上面两条命令）；
2. 启动服务并运行 `scripts/smoke.mjs`；
3. 若改了清算，创建对应场景链路并确认环节数、`DONE`、`trial.balanced`；
4. 若改了前端，浏览器打开相关页面，检查控制台无报错、窄屏无横向溢出；
5. 若改了主题，逐套切换并刷新，确认首屏无闪烁、对比度正常；
6. `git status` 确认没有把 `data/state.json`、`.runtime/`、`books/` 或测试数据加入提交。

## 资源

- `references/recipes.md`：新增环节/阶段/主题/页面的代码骨架与排错表。
- `scripts/smoke.mjs`：只读 API 与静态资源健康检查。
- 项目文档：`wiki/01-architecture.md`、`wiki/02-payment-pipeline.md`、`wiki/04-accounting.md`、`wiki/05-clearing-banking.md`、`wiki/09-api.md`、`wiki/11-development.md`。
