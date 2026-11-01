# PayLab Wiki

PayLab 是一个零依赖的支付全链路教学系统。本 Wiki 从架构、业务流程、账务、清算、跨境、接口与数据等角度完整说明项目，适合作为教学讲义、代码导读与二次开发参考。

## 阅读路线

**第一次使用**

1. [快速开始](../README.md) — 双击 `start.cmd` 启动
2. [系统架构](01-architecture.md) — 先建立整体心智模型
3. [12 阶段支付全链路](02-payment-pipeline.md) — 跟着页面走一遍正常支付

**支付工程专题**

- [可靠性实验室](03-reliability.md) — 幂等、掉单、关单、迟到回调
- [退款与风控](08-refund-risk.md) — 退款状态机与规则引擎
- [对账与清结算](07-reconcile-settlement.md) — 长短款、净额结算

**账务与清算专题**

- [复式记账与账务体系](04-accounting.md)
- [清算网络与银行会计](05-clearing-banking.md)
- [跨境支付专题](06-cross-border.md)

**开发参考**

- [HTTP API 参考](09-api.md)
- [数据模型与持久化](10-data-model.md)
- [开发与排错](11-development.md)

## 页面与文档对照

| 页面 | 路由 | 对应文档 |
| --- | --- | --- |
| 总览 | `#/overview` | [01 架构](01-architecture.md) |
| 全链路演练 | `#/payment` | [02 支付链路](02-payment-pipeline.md) |
| 阶段详情 | `#/stage/<paymentId>/<index>` | [02 支付链路](02-payment-pipeline.md) |
| 可靠性实验室 | `#/reliability` | [03 可靠性](03-reliability.md) |
| 退款与冲正 | `#/refund` | [08 退款与风控](08-refund-risk.md) |
| 对账中心 | `#/reconcile` | [07 对账结算](07-reconcile-settlement.md) |
| 清结算 | `#/settlement` | [07 对账结算](07-reconcile-settlement.md) |
| 清算网络 | `#/clearing` | [05 清算与银行](05-clearing-banking.md) |
| 银行会计 | `#/banking` | [05 清算与银行](05-clearing-banking.md) |
| 风控引擎 | `#/risk` | [08 退款与风控](08-refund-risk.md) |
| 报文与日志 | `#/logs` | [10 数据模型](10-data-model.md) |

## 术语表

| 术语 | 含义 |
| --- | --- |
| 信息流 | 订单、支付指令、通知、对账文件等报文流转 |
| 资金流 | 银行账户、备付金账户、准备金账户之间的真实资金划转 |
| 备付金 | 支付机构代收的客户资金，须 100% 集中存管于人民银行 |
| 网联 | 网联清算平台，处理第三方支付机构的网络支付转接清算 |
| 银联 | 中国银联，处理银行卡跨行转接清算 |
| CIPS | 人民币跨境支付系统，处理跨境人民币清算 |
| CNAPS | 人民银行现代化支付系统，完成跨行最终清算 |
| 轧差 | 将多笔收付相抵后只结算净额 |
| 幂等 | 同一请求重复执行多次，业务与账务结果只生效一次 |
| 挂账 | 资金已到但暂时无法确认归属，先计入过渡性科目 |
| 长短款 | 对账中本地与渠道记录不一致形成的多收或少收 |

> 说明：项目中的机构名称、费率、汇率、科目与流程均为教学简化，不代表真实业务规则。
