# HTTP API 参考

服务端默认监听 `http://localhost:5178`。所有 API 以 `/api` 开头，请求与响应均为 JSON。

## 1. 响应约定

成功：

```json
{ "ok": true, "data": { } }
```

失败：

```json
{ "ok": false, "error": "错误说明" }
```

常见状态码：

| 状态码 | 含义 |
| --- | --- |
| 200 | 成功 |
| 400 | 参数错误 / 业务校验失败 |
| 404 | 资源不存在 |
| 409 | 状态冲突（重复操作、流程暂停等） |
| 500 | 服务端异常 |

金额参数统一使用「元」（可带小数），服务端转换为分存储；返回金额字段大多为「分」，前端用 `fmtCents` 格式化。

## 2. 元数据与总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/meta` | 渠道、阶段、支付场景、清算场景、机构、银行业务、风控规则 |
| `GET` | `/api/summary` | 今日交易、渠道分布、资金与风险汇总 |

## 3. 支付链路

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/payments?limit=60` | 支付列表，`limit` 最大 200 |
| `POST` | `/api/payments` | 创建交易 |
| `GET` | `/api/payments/:id` | 交易详情（订单、渠道、分录、退款、清算链路） |
| `GET` | `/api/payments/:id/accounting` | 完整会计链路 |
| `GET` | `/api/payments/:id/stages/:index` | 阶段详情，`index` 从 0 开始 |
| `POST` | `/api/payments/:id/step` | 执行下一阶段 |
| `POST` | `/api/payments/:id/action` | 执行暂停点动作 |

### 创建交易

```http
POST /api/payments
Content-Type: application/json

{
  "scenario": "normal",
  "subject": "手冲咖啡豆 250g",
  "amount": 128,
  "channel": "alipay",
  "buyer": "U10001"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `scenario` | 否 | 场景代码，默认 `normal`；未知值回退为 `normal` |
| `subject` | 否 | 商品名称，最长 60 字符 |
| `amount` | 是 | 0.01–200,000.00 元 |
| `channel` | 否 | 渠道代码，默认 `alipay` |
| `buyer` | 否 | 买家标识，最长 32 字符 |

特殊规则：

- `scenario = insufficient_balance` 强制使用 `balance` 渠道；
- `scenario = cross_border` 强制使用 `crossborder` 渠道，并生成结汇字段；
- `scenario = risk_block` 强制买家为 `U-BLACKLIST`。

### 暂停点动作

```http
POST /api/payments/:id/action
Content-Type: application/json

{ "action": "confirm_pay" }
```

| 动作 | 适用 `waiting.type` | 说明 |
| --- | --- | --- |
| `confirm_pay` | `user_pay` | 确认用户已付款 |
| `approve` | `risk_review` | 人工复核通过 |
| `reject` | `risk_review` | 人工复核拒绝 |
| `query_channel` | `notify_lost` / `exception` | 主动查单 |
| `resend_notify` | `notify_lost` | 模拟渠道重发通知 |

## 4. 可靠性演练

| 方法 | 路径 | 前置条件 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/api/payments/:id/renotify` | SUCCESS | 重复通知，验证幂等 |
| `POST` | `/api/payments/:id/query` | PAYING / 异常等待 | 主动查单 |
| `POST` | `/api/payments/:id/close` | INIT / PAYING 且未扣款 | 超时关单 |
| `POST` | `/api/payments/:id/late-notify` | CLOSED 且未补偿 | 迟到回调，补单并退款 |

以上接口均无需请求体。

## 5. 退款

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/refunds` | 最近退款列表 |
| `POST` | `/api/refunds` | 发起退款 |
| `POST` | `/api/refunds/:id/retry` | 重试失败退款 |

```http
POST /api/refunds
Content-Type: application/json

{
  "paymentId": "PAY...",
  "amount": 30,
  "reason": "商品轻微划痕",
  "simulateFail": false
}
```

| 字段 | 说明 |
| --- | --- |
| `paymentId` | 必须为支付成功的交易 |
| `amount` | 元，累计退款不能超过支付金额 |
| `reason` | 退款原因，最长 80 字符 |
| `simulateFail` | `true` 时模拟渠道超时，退款进入 FAILED |

## 6. 对账

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/reconcile` | 最近账单与对账批次 |
| `POST` | `/api/reconcile/bills` | 生成渠道账单 |
| `POST` | `/api/reconcile/bills/:id/run` | 执行自动对账 |
| `POST` | `/api/reconcile/runs/:runId/diffs/:diffId/handle` | 处理差异 |

### 生成账单

```json
{
  "date": "2026-11-01",
  "channel": "alipay",
  "inject": { "amount": true, "short": true, "long": true }
}
```

### 处理差异

```json
{
  "action": "supplement",
  "note": "核对渠道流水后补单"
}
```

`action` 取值：`supplement`、`suspend`、`ignore`、`manual`。

## 7. 清结算

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/settlements` | 结算批次、科目余额、待结算/已结算金额 |
| `POST` | `/api/settlements/generate` | 生成结算批次 |
| `POST` | `/api/settlements/:id/settle` | 结算出款 |

```json
{ "date": "2026-11-02" }
```

结算日必须与支付单的 `settleDate` 一致；没有可结算交易时返回 400。

## 8. 风控

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/risk` | 规则列表与最近 20 条试算 |
| `PUT` | `/api/risk/rules/:id` | 修改规则 |
| `POST` | `/api/risk/check` | 风控试算 |

```http
PUT /api/risk/rules/R001
Content-Type: application/json

{
  "enabled": true,
  "params": { "reviewAmount": 3000, "blockAmount": 30000 }
}
```

```http
POST /api/risk/check
Content-Type: application/json

{
  "amount": 6800,
  "buyer": "U10002",
  "channel": "wechat",
  "hour": 2,
  "isNewDevice": true
}
```

## 9. 清算网络

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/clearing` | 场景、机构、口径、链路列表、全局试算 |
| `POST` | `/api/clearing/flows` | 创建清算链路 |
| `GET` | `/api/clearing/flows/:id` | 链路详情 |
| `POST` | `/api/clearing/flows/:id/step` | 执行下一环节 |
| `POST` | `/api/clearing/flows/:id/run` | 自动执行全部环节 |

```http
POST /api/clearing/flows
Content-Type: application/json

{
  "type": "goods",
  "amount": 128,
  "payer": "U10001",
  "payee": "云栖优选商城",
  "fee": 0.72,
  "autoRun": false
}
```

| 字段 | 说明 |
| --- | --- |
| `type` | 清算场景代码 |
| `amount` | 0.01–500,000.00 元 |
| `payer` / `payee` | 付款方与收款方 |
| `fee` | 可选，覆盖默认手续费 |
| `autoRun` | `true` 时创建后自动跑完全部环节 |

## 10. 银行会计

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/banking` | 银行科目、客户存款、业务记录 |
| `POST` | `/api/banking/ops` | 执行银行业务 |

```http
POST /api/banking/ops
Content-Type: application/json

{
  "type": "deposit_cash",
  "bank": "ICBC",
  "customer": "张伟",
  "amount": 1000
}
```

| `type` | 说明 | 额外字段 |
| --- | --- | --- |
| `deposit_cash` | 现金存入 | `amount` |
| `loan_issue` | 发放贷款 | `amount` |
| `loan_repay` | 收回贷款本息 | `principal`、`interest` |
| `agency_utility` | 代收水电费并划转 | `amount`、`fee` |
| `fee_collect` | 收取账户管理费 | `amount` |

`bank` 取值：`ICBC`、`CCB`、`ABC`。

## 11. 日志与重置

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/logs?limit=200&level=error&q=关键词` | 事件日志，`limit` 最大 500 |
| `POST` | `/api/reset` | 重置演示数据 |

`level` 可选：`info`、`success`、`warn`、`error`；`q` 会匹配标题、详情、阶段名与支付单号。

## 12. 调试示例

```bash
# 查看元数据
curl http://localhost:5178/api/meta

# 创建一笔跨境交易
curl -X POST http://localhost:5178/api/payments \
  -H "Content-Type: application/json" \
  -d '{"scenario":"cross_border","subject":"跨境教学商品","amount":724,"channel":"crossborder","buyer":"U-FOREIGN-01"}'

# 推进一步（需要替换 PAY... 为真实支付单号）
curl -X POST http://localhost:5178/api/payments/PAY.../step

# 执行全部清算环节
curl -X POST http://localhost:5178/api/clearing/flows/FLOW.../run
```

## 13. 安全说明

本项目定位为本地教学沙箱：

- 无鉴权、无权限模型，任何能访问端口的人都可以读写数据；
- 仅建议在本机使用，不要直接暴露到局域网或公网；
- 如需多人使用，请在前面加反向代理与访问控制，并做好数据备份。
