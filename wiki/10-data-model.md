# 数据模型与持久化

所有运行时数据保存在 `data/state.json`。服务启动时读入内存，写入时先改内存再整体落盘。

## 1. 顶层结构

```json
{
  "orders": [],
  "payments": [],
  "refunds": [],
  "ledger": [],
  "batches": [],
  "bills": [],
  "reconRuns": [],
  "risks": { "rules": [], "checks": [] },
  "interbank": { "flows": [], "journal": [], "ops": [] },
  "logs": [],
  "meta": { "version": 1, "createdAt": "...", "seeded": true }
}
```

| 字段 | 含义 |
| --- | --- |
| `orders` | 业务订单 |
| `payments` | 支付单（含事件流） |
| `refunds` | 退款单 |
| `ledger` | 平台复式分录 |
| `batches` | 结算批次 |
| `bills` | 渠道对账单 |
| `reconRuns` | 对账批次与差异 |
| `risks.rules` | 风控规则 |
| `risks.checks` | 风控试算历史（最多 120 条） |
| `interbank.flows` | 跨机构清算链路 |
| `interbank.journal` | 跨机构与银行分录 |
| `interbank.ops` | 银行业务记录 |
| `logs` | 全局事件日志（最多 1500 条） |
| `meta` | 版本与初始化信息 |

## 2. 订单 Order

```json
{
  "id": "ORD...",
  "outTradeNo": "O...",
  "paymentId": "PAY...",
  "merchantId": "M2026001",
  "merchantName": "云栖优选商城",
  "subject": "手冲咖啡豆 250g",
  "amount": 12800,
  "currency": "CNY",
  "status": "CREATED",
  "createdAt": "2026-11-01T..."
}
```

状态：`CREATED` / `PAID` / `CLOSED` / `REFUNDED`。

## 3. 支付单 Payment

```json
{
  "id": "PAY...",
  "orderId": "ORD...",
  "outTradeNo": "O...",
  "merchantId": "M2026001",
  "merchantName": "云栖优选商城",
  "subject": "手冲咖啡豆 250g",
  "amount": 12800,
  "currency": "CNY",
  "settleCycle": "T+1",
  "crossBorder": null,
  "channel": "alipay",
  "channelName": "支付宝",
  "buyer": "U10001",
  "scenario": "normal",
  "status": "SUCCESS",
  "phaseIndex": 12,
  "completed": true,
  "terminated": false,
  "failedPhase": null,
  "waiting": null,
  "events": [],
  "idempotencyKey": "IDK...",
  "riskScore": 6,
  "riskDecision": "PASS",
  "riskHits": [],
  "fee": 77,
  "netAmount": 12723,
  "refundedAmount": 0,
  "refundStatus": "NONE",
  "channelTradeNo": "CH...",
  "channelPaid": true,
  "compensated": false,
  "failover": false,
  "notifyAttempts": 1,
  "renotifyCount": 0,
  "createdAt": "...",
  "updatedAt": "...",
  "paidAt": "...",
  "settleDate": "2026-11-02"
}
```

### 关键字段

| 字段 | 说明 |
| --- | --- |
| `status` | `INIT` / `PAYING` / `SUCCESS` / `FAILED` / `CLOSED` / `EXCEPTION` |
| `phaseIndex` | 下一个待执行阶段索引；完成后为 12 |
| `waiting` | 暂停点信息：`type`、`phase`、`actions`、`title`、`hint` |
| `crossBorder` | 跨境信息：`fxRate`、`foreignCurrency`、`foreignAmount`、`settleCurrency` |
| `compensated` | 是否已完成迟到回调补偿 |
| `settleDate` | 结算日，由支付时间与结算周期计算 |
| `settledBatchId` | 已结算时关联的批次 |
| `compensationRefundId` | 补偿退款单 ID |

### 事件 Event

```json
{
  "id": "EV...",
  "seq": 8,
  "ts": "2026-11-01T...",
  "phaseIndex": 7,
  "stage": "notify",
  "stageName": "渠道异步通知",
  "actor": "支付渠道",
  "target": "支付网关",
  "title": "收到渠道异步通知",
  "detail": "渠道回调支付结果，需验签、核对金额并按幂等键处理",
  "level": "info",
  "request": null,
  "response": { "outTradeNo": "O...", "amount": "128.00", "sign": "..." },
  "signInfo": {
    "algorithm": "HMAC-SHA256",
    "signString": "amount=128.00&channel=alipay&...",
    "sign": "...",
    "verifyResult": "VALID"
  },
  "latencyMs": 860,
  "kind": "callback"
}
```

`level`：`info` / `success` / `warn` / `error`；`kind`：`normal` / `callback` / `query` / `system`。

## 4. 平台分录 Ledger

```json
{
  "id": "LG...",
  "bizType": "PAYMENT",
  "bizId": "PAY...",
  "paymentId": "PAY...",
  "refundId": null,
  "merchantId": "M2026001",
  "outTradeNo": "O...",
  "title": "支付入账",
  "amount": 12800,
  "fee": 77,
  "settleDate": "2026-11-02",
  "createdAt": "...",
  "entries": [
    { "account": "CHANNEL_RECEIVABLE", "accountName": "渠道应收款", "debit": 12800, "credit": 0 },
    { "account": "MERCHANT_PAYABLE", "accountName": "商户待结算款", "debit": 0, "credit": 12723 },
    { "account": "FEE_INCOME", "accountName": "手续费收入", "debit": 0, "credit": 77 }
  ]
}
```

`bizType`：`PAYMENT` / `REFUND` / `SETTLEMENT`。

## 5. 退款单 Refund

```json
{
  "id": "RFD...",
  "refundNo": "RF...",
  "paymentId": "PAY...",
  "outTradeNo": "O...",
  "merchantId": "M2026001",
  "merchantName": "云栖优选商城",
  "subject": "手冲咖啡豆 250g",
  "channel": "alipay",
  "channelName": "支付宝",
  "amount": 3000,
  "feeAmount": 0,
  "reason": "商品轻微划痕，协商部分退款",
  "source": "MERCHANT",
  "status": "SUCCESS",
  "createdAt": "...",
  "finishedAt": "...",
  "failReason": null,
  "events": [],
  "ledgerEntries": []
}
```

状态：`PROCESSING` / `SUCCESS` / `FAILED`；来源：`MERCHANT` / `COMPENSATION`。

## 6. 结算批次 Batch

```json
{
  "id": "BAT...",
  "merchantId": "M2026001",
  "merchantName": "云栖优选商城",
  "settleDate": "2026-11-02",
  "count": 8,
  "grossAmount": 123456,
  "feeAmount": 789,
  "refundAmount": 3000,
  "netAmount": 119667,
  "paymentIds": ["PAY..."],
  "status": "PENDING",
  "createdAt": "...",
  "settledAt": null
}
```

状态：`PENDING` / `SETTLED`。

## 7. 渠道账单与对账

### Bill

```json
{
  "id": "BILL...",
  "date": "2026-11-01",
  "channel": "alipay",
  "count": 12,
  "totalAmount": 123456,
  "totalFee": 789,
  "lines": [
    { "id": "BL...", "channelTradeNo": "CH...", "outTradeNo": "O...", "amount": 12800, "fee": 77, "status": "SUCCESS" }
  ],
  "injected": { "amount": false, "short": false, "long": false },
  "createdAt": "...",
  "runId": "REC..."
}
```

### ReconRun

```json
{
  "id": "REC...",
  "billId": "BILL...",
  "date": "2026-11-01",
  "channel": "alipay",
  "summary": {
    "localCount": 12,
    "channelCount": 12,
    "matchedCount": 10,
    "diffCount": 2,
    "localAmount": 123456,
    "channelAmount": 124006,
    "diffAmount": 550
  },
  "diffs": [
    {
      "id": "DIFF...",
      "type": "AMOUNT_MISMATCH",
      "label": "金额不一致",
      "outTradeNo": "O...",
      "channelTradeNo": "CH...",
      "localAmount": 12800,
      "channelAmount": 13300,
      "status": "PENDING",
      "resolution": null
    }
  ],
  "createdAt": "...",
  "handledCount": 0
}
```

差异类型：`LOCAL_ONLY` / `CHANNEL_ONLY` / `AMOUNT_MISMATCH`；状态：`PENDING` / `HANDLED`。

## 8. 清算链路 Flow

```json
{
  "id": "FLOW...",
  "no": "CL...",
  "type": "cross_border",
  "typeName": "跨境支付 · 境外卡",
  "network": "CIPS 跨境清算",
  "amount": 72400,
  "fee": 2027,
  "networkFee": 72,
  "platformFee": 1955,
  "payeeNet": 70373,
  "fxRate": 7.24,
  "foreignCurrency": "USD",
  "foreignAmount": 10000,
  "payer": "U-FOREIGN-01",
  "payee": "云栖优选商城",
  "status": "PROCESSING",
  "currentLeg": 0,
  "legs": [
    {
      "index": 0,
      "key": "overseas-acquirer-debit",
      "title": "境外收单行扣减持卡人资金",
      "detail": "...",
      "system": "境外收单行核心",
      "from": "HSBC",
      "to": "CCB",
      "amount": 72400,
      "status": "PENDING",
      "executedAt": null,
      "entries": []
    }
  ],
  "createdAt": "...",
  "completedAt": null,
  "source": "MANUAL",
  "paymentId": null
}
```

链路状态：`PROCESSING` / `DONE`；来源：`MANUAL` / `PAYMENT`。

## 9. 跨机构分录 Journal

```json
{
  "id": "JNL...",
  "flowId": "FLOW...",
  "legIndex": 0,
  "opId": null,
  "source": "CLEARING",
  "scenario": "cross_border",
  "title": "跨境支付 · 境外卡 · 境外收单行扣减持卡人资金",
  "ts": "...",
  "lines": [
    {
      "institution": "HSBC",
      "institutionName": "境外收单行",
      "code": "DEPOSITS",
      "accountName": "吸收存款",
      "accountType": "LIABILITY",
      "debit": 72400,
      "credit": 0,
      "memo": "U-FOREIGN-01"
    }
  ]
}
```

`source`：`CLEARING` / `BANK_OP` / `OPENING`；每条分录写入前校验借贷平衡。

## 10. 银行业务 BankOp

```json
{
  "id": "BOP...",
  "type": "deposit_cash",
  "typeName": "现金存入",
  "bank": "ICBC",
  "bankName": "中国工商银行",
  "customer": "张伟",
  "amount": 100000,
  "fee": 0,
  "principal": 0,
  "interest": 0,
  "ts": "...",
  "title": "现金存入 · 工商银行",
  "journalId": "JNL...",
  "seeded": false
}
```

## 11. 日志 Log

日志是事件的扁平副本，额外携带支付上下文：

```json
{
  "id": "LOG...",
  "ts": "...",
  "phaseIndex": 7,
  "stage": "notify",
  "stageName": "渠道异步通知",
  "actor": "支付渠道",
  "target": "支付网关",
  "title": "收到渠道异步通知",
  "detail": "...",
  "level": "info",
  "request": null,
  "response": {},
  "signInfo": {},
  "latencyMs": 860,
  "kind": "callback",
  "paymentId": "PAY...",
  "outTradeNo": "O...",
  "merchantName": "云栖优选商城"
}
```

系统事件使用 `phaseIndex = -1`，`kind = "system"`。

## 12. 金额、时间与 ID

| 项 | 约定 |
| --- | --- |
| 金额 | 整数分；API 入参用元 |
| 时间 | ISO 8601 字符串，UTC |
| 日期 | `YYYY-MM-DD`，本地日期 |
| 订单号 | `O` + 时间戳 |
| 支付单 | `PAY` + 时间戳 |
| 退款单 | `RFD` + 时间戳，退款号 `RF` |
| 清算链路 | `FLOW` + 时间戳，业务号 `CL` |
| 签名 | HMAC-SHA256，密钥为教学固定值 |

## 13. 持久化行为

- 首次启动：`state.json` 不存在时创建并播种演示数据；
- 每次修改：先改内存，`store.save()` 在 120ms 后整体写盘；
- 关键操作：`saveNow()` 立即写盘；
- 读取失败：JSON 损坏时记录警告并重建空状态；
- 重置：`POST /api/reset` 清空并重新播种；
- 日志上限 1500 条，风控试算上限 120 条，超出后丢弃最旧记录。

## 14. 种子数据

首次启动会生成：

- 约 20 笔历史与当日支付（含成功、支付中、失败、部分退款）；
- 对应订单、平台分录与退款；
- 昨日/今日结算批次；
- 26 条跨机构清算链路与对应分录（含跨境示例）；
- 银行业务与客户存款；
- 风控试算与系统日志。

种子只在 `state.meta.seeded = false` 时执行，重置后会重新生成。
