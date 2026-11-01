# PayLab 扩展配方与排错

## 1. 新增一个清算环节

在 `server/interbank.js` 的 `build*Flow` 中插入 `makeLeg`。序号必须连续，金额单位为分。

```js
makeLeg(2, {
  key: 'netsunion-sp-receive',
  title: '网联特参账户收款',
  detail: '发卡行净额经人民银行 ACS 记入网联特许参与者账户。',
  system: '人民银行 ACS · 网联特参账户',
  from: 'ICBC',
  to: 'NETSUNION',
  amount: A,
  entries: [
    line('ICBC', 'INTERBANK_PAYABLE', A, 0, '结清网联待清算'),
    line('ICBC', 'RESERVE_PBOC', 0, A, '准备金减少'),
    line('NETSUNION', 'RESERVE_PBOC', A, 0, '特参账户收到清算款'),
    line('NETSUNION', 'RECEIVABLE', 0, A, '结清对工行应收'),
    line('PBOC', 'RESERVE_ICBC', A, 0, '工商银行准备金减少'),
    line('PBOC', 'RESERVE_NETSUNION', 0, A, '网联特参账户增加')
  ]
})
```

校验本环节：`Σ debit === Σ credit`。跨机构分录会进入同一个全局日志，任何一环不平都会让 `/api/clearing` 的 `trial.balanced` 变为 `false`。

新增或删除环节后同步更新：

- `SCENARIOS` 中该场景的 `legs`；
- `seedFlows` 示例的 `run`（不能超过环节数，否则会多执行空步骤）；
- `wiki/05-clearing-banking.md` 的环节数与分录表；
- 前端无需改，`flow.legs` 由 API 返回。

## 2. 网联特参账户的两段式划付

正向（商品 / 缴费 / 充值）：发卡行准备金 → 特参账户 → 支付机构备付金。

```text
环节 A 特参账户收款（全额 A）
  借 ICBC.INTERBANK_PAYABLE A    贷 ICBC.RESERVE_PBOC A
  借 NETSUNION.RESERVE_PBOC A    贷 NETSUNION.RECEIVABLE A
  借 PBOC.RESERVE_ICBC A         贷 PBOC.RESERVE_NETSUNION A

环节 B 特参账户划付（净额 A - networkFee）
  借 NETSUNION.PAYABLE A-fee     贷 NETSUNION.RESERVE_PBOC A-fee
  借 PAYLAB.RESERVE_PBOC A-fee   贷 PAYLAB.INTERBANK_RECEIVABLE A-fee
  借 PBOC.RESERVE_NETSUNION A-fee 贷 PBOC.RESERVE_PAYLAB A-fee
```

差额 `networkFee` 留在 `PBOC.RESERVE_NETSUNION`（负债）与 `NETSUNION.RESERVE_PBOC`（资产），对应 `NETSUNION.FEE_INCOME`。

逆向（提现）：支付机构备付金 → 特参账户 → 收款行准备金，把上述借贷方向整体反转。

## 3. 新增支付阶段

```js
// PHASES
{ key: 'newstep', name: '阶段名', actor: '上游', target: '下游',
  desc: '一句话说明', teaching: '教学要点' }

// LATENCY
newstep: 60

// runPhase：增加阶段逻辑，必要时设置 payment.waiting 等待动作

// stageRows / stageAccounting：补充阶段数据行与会计口径
```

同步检查：阶段总数文案（`app.js` 页面副标题写死了「12 个阶段」）、`wiki/02-payment-pipeline.md`、首页阶段列表。前端 stepper 的阶段数量读取 `meta.phases.length`。

## 4. 新增颜色主题

```css
/* public/css/theme.css */
[data-theme="ocean2"] {
  color-scheme: dark;
  --bg: #070b13;
  --accent: #38bdf8;
  --accent-rgb: 56, 189, 248;
  --accent-deep: #0ea5e9;
  --accent-hover: #5cc9fa;
  --accent-soft: #7dd3fc;
  --accent-tint: #e0f5ff;
  --accent-ink: #03131f;
  /* 继续覆盖 surface / text / border / status / shadow 等变量 */
}
```

```js
// public/js/theme.js
const THEMES = [
  // ...
  { id: 'ocean2', name: '主题名', bg: '#070b13', swatch: 'linear-gradient(135deg, #38bdf8, #6366f1)' }
];
```

同时把 id 加入 `public/index.html` 首屏脚本的合法数组，否则刷新后会回退默认主题。浅色主题需要额外覆盖状态色（绿/黄/红徽标、借贷方向、弹窗遮罩）与 `color-scheme: light`。

## 5. 新增页面

```js
// public/js/views/example.js
import { get } from '../api.js';

export default {
  async render(root) {
    const data = await get('/example');
    root.innerHTML = `<div class="card"><h2>示例</h2></div>`;
    return () => {}; // 清理事件监听
  }
};
```

在 `app.js` 注册 `routes.example` 与 `meta.example`，在 `index.html` 导航加入链接。带参数页面通过 `render(root, params)` 接收 `#/stage/PAY123` 的 `params`。

## 6. 试算与余额公式

```text
资产类余额 = 借方累计 - 贷方累计
负债 / 权益 / 收入类余额 = 贷方累计 - 借方累计
全局试算平衡 ⇔ Σ debit === Σ credit
```

`GET /api/clearing` 返回：

- `trial: { debit, credit, balanced, entryCount }`；
- `institutions[].balances[]`：每个科目的 `debit / credit / balance`；
- 某条链路详情另有按 `institution + code` 汇总的 `summaries` 与 `trial`。

## 7. 排错表

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| `分录借贷不平衡：借 X / 贷 Y` | 新环节分录写错 | 逐条重算，先保证本环节平衡 |
| 页面显示 5 个环节但新链路是 6 个 | 旧链路保留原结构 | 新建链路验证；旧数据不迁移 |
| `未知科目：NETSUNION.XXX` | 科目 code 未在 `chart` 定义 | 在对应机构 `chart` 添加，勿随意改旧 code |
| 全局 `balanced = false` | 历史/测试分录被手工改动 | 用 `git` 或备份恢复 `data/state.json`，或 `POST /api/reset` |
| `EADDRINUSE` | 端口已被占用 | 关闭占用进程或 `PORT=5180 node server/server.js` |
| 页面还是旧样式/旧脚本 | 浏览器缓存 | 用 `?v=时间戳` 访问或强制刷新 |
| 中文测试数据显示为乱码 | Git Bash `curl` 编码问题 | 用 Node `fetch` + UTF-8 JSON 重新创建 |
| 主题刷新后回到默认 | 新 id 未加入 `index.html` 白名单 | 补入首屏脚本数组 |
| 前端报错但服务端正常 | ES Module 语法错误或旧缓存 | `node --input-type=module --check < 文件`，再强制刷新 |

## 8. API 速查（只读优先）

```text
GET  /api/meta
GET  /api/summary
GET  /api/payments?limit=20
GET  /api/payments/:id
GET  /api/payments/:id/accounting
GET  /api/payments/:id/stages/:index
GET  /api/refunds
GET  /api/reconcile
GET  /api/settlements
GET  /api/risk
GET  /api/clearing
GET  /api/clearing/flows/:id
GET  /api/banking
GET  /api/logs?limit=50&level=INFO&q=关键词
```

写操作：`POST /api/payments`、`POST /api/refunds`、`POST /api/reconcile/bills`、`POST /api/settlements/generate`、`POST /api/clearing/flows`、`POST /api/banking/ops`、`POST /api/reset`。创建清算链路的请求体：

```json
{ "type": "goods", "amount": 128, "payer": "U10001", "payee": "云栖优选商城", "autoRun": true }
```
