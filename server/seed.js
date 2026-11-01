'use strict';

const store = require('./store');
const ops = require('./ops');
const engine = require('./engine');
const interbank = require('./interbank');
const banking = require('./banking');
const { rid, fmtCents, dateStr, addDays, sign, signString } = require('./util');

const { PHASES, CHANNELS } = engine;

function atDate(dayOffset, hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, Math.floor(Math.random() * 50), 0);
  return d;
}

function todayAt(minutesAgo) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return new Date(Math.max(start.getTime() + 60000, now.getTime() - minutesAgo * 60000));
}

function makeOrder(payment, when) {
  return {
    id: payment.orderId,
    outTradeNo: payment.outTradeNo,
    paymentId: payment.id,
    merchantId: payment.merchantId,
    merchantName: payment.merchantName,
    subject: payment.subject,
    amount: payment.amount,
    currency: 'CNY',
    status: payment.status === 'SUCCESS' ? 'PAID' : payment.status === 'FAILED' || payment.status === 'CLOSED' ? 'CLOSED' : 'CREATED',
    createdAt: when.toISOString()
  };
}

function buildEvents(payment, start, endPhase, failure) {
  const events = [];
  for (let idx = 0; idx <= endPhase; idx += 1) {
    const phase = PHASES[idx];
    let ts = new Date(start.getTime() + idx * 22000 + Math.random() * 5000).toISOString();
    let title = `${phase.name}完成`;
    let detail = phase.desc;
    let level = 'success';
    let request = null;
    let response = null;
    let signInfo = null;

    if (phase.key === 'order') {
      title = '创建业务订单';
      request = { outTradeNo: payment.outTradeNo, amount: fmtCents(payment.amount), subject: payment.subject };
      response = { orderStatus: 'CREATED' };
      level = 'info';
    } else if (phase.key === 'gateway') {
      const base = { outTradeNo: payment.outTradeNo, amount: fmtCents(payment.amount), idempotencyKey: payment.idempotencyKey };
      const signature = sign(base);
      title = '收单校验通过';
      request = { ...base, sign: signature };
      response = { paymentId: payment.id, status: 'INIT' };
      signInfo = { algorithm: 'HMAC-SHA256', signString: signString(base), sign: signature, verifyResult: 'VALID' };
    } else if (phase.key === 'risk') {
      if (failure) {
        title = '风控决策：拦截';
        detail = '买家命中黑名单，交易在风控环节被阻断';
        level = 'error';
        request = { buyer: payment.buyer, amount: fmtCents(payment.amount) };
        response = { decision: 'BLOCK', score: 96, hits: [{ ruleId: 'R003', ruleName: '黑名单用户', level: 'BLOCK', detail: '买家命中黑名单' }] };
      } else {
        title = '风控决策：通过';
        request = { buyer: payment.buyer, amount: fmtCents(payment.amount) };
        response = { decision: 'PASS', score: 9, hits: [] };
      }
    } else if (phase.key === 'precreate') {
      title = '渠道预下单成功';
      request = { outTradeNo: payment.outTradeNo, amount: fmtCents(payment.amount) };
      response = { channelTradeNo: payment.channelTradeNo, payUrl: `https://sandbox.pay.example/qr/${payment.channelTradeNo}` };
    } else if (phase.key === 'userpay') {
      title = '用户完成支付';
      request = { channelTradeNo: payment.channelTradeNo };
      response = { channelStatus: 'SUCCESS', paidAmount: fmtCents(payment.amount) };
    } else if (phase.key === 'notify') {
      const base = {
        notifyId: rid('NT'),
        outTradeNo: payment.outTradeNo,
        channelTradeNo: payment.channelTradeNo,
        channel: payment.channel,
        amount: fmtCents(payment.amount),
        status: 'SUCCESS',
        notifiedAt: ts
      };
      const signature = sign(base);
      title = '收到渠道异步通知';
      request = null;
      response = { ...base, sign: signature };
      signInfo = { algorithm: 'HMAC-SHA256', signString: signString(base), sign: signature, verifyResult: 'VALID' };
      level = 'info';
    } else if (phase.key === 'verify') {
      title = '验签通过 · 幂等校验通过';
      response = { signature: 'VALID', amountCheck: 'MATCHED', idempotency: 'FIRST_PROCESS', from: 'PAYING', to: 'SUCCESS' };
    } else if (phase.key === 'ledger') {
      title = '复式记账完成';
      response = { balanced: true, amount: fmtCents(payment.amount), fee: fmtCents(payment.fee) };
    } else if (phase.key === 'merchant') {
      title = '商户通知成功';
      request = { notifyUrl: 'https://merchant.example.com/api/pay/notify' };
      response = { code: 'SUCCESS', attempt: 1 };
    } else if (phase.key === 'done') {
      title = '交易闭环完成';
      response = { paymentStatus: 'SUCCESS', settleDate: payment.settleDate };
    }

    events.push({
      id: rid('EV'),
      seq: events.length + 1,
      ts,
      phaseIndex: idx,
      stage: phase.key,
      stageName: phase.name,
      actor: phase.actor,
      target: phase.target,
      title,
      detail,
      level,
      request,
      response,
      signInfo,
      latencyMs: 20 + idx * 7,
      kind: 'normal'
    });
  }
  return events;
}

function addPayment(config) {
  const when = config.when;
  const channel = CHANNELS[config.channel];
  const fee = engine.feeFor(config.amount, config.channel);
  const outTradeNo = rid('O', when);
  const orderId = rid('ORD', when);
  const payment = {
    id: rid('PAY', when),
    orderId,
    outTradeNo,
    merchantId: 'M2026001',
    merchantName: '云栖优选商城',
    subject: config.subject,
    amount: config.amount,
    currency: 'CNY',
    channel: config.channel,
    channelName: channel.name,
    buyer: config.buyer || 'U10001',
    scenario: config.status === 'FAILED' ? 'risk_block' : config.status === 'PAYING' ? 'normal' : 'normal',
    status: config.status,
    phaseIndex: config.status === 'SUCCESS' ? PHASES.length : config.status === 'PAYING' ? 6 : PHASES.length,
    completed: config.status === 'SUCCESS',
    terminated: config.status === 'FAILED',
    failedPhase: config.status === 'FAILED' ? 3 : null,
    waiting: config.status === 'PAYING' ? {
      type: 'user_pay',
      phase: 6,
      actions: ['confirm_pay'],
      title: '等待用户扫码支付',
      hint: `请点击“确认支付”，模拟用户完成 ¥${fmtCents(config.amount)} 的付款。`
    } : null,
    events: [],
    idempotencyKey: rid('IDK', when),
    riskScore: config.status === 'FAILED' ? 96 : 9,
    riskDecision: config.status === 'FAILED' ? 'BLOCK' : 'PASS',
    riskHits: [],
    fee: config.status === 'SUCCESS' ? fee : 0,
    netAmount: config.status === 'SUCCESS' ? config.amount - fee : 0,
    refundedAmount: 0,
    refundStatus: 'NONE',
    channelTradeNo: config.status === 'FAILED' ? null : rid('CH', when),
    channelPaid: config.status === 'SUCCESS',
    compensated: false,
    failover: false,
    notifyAttempts: config.status === 'SUCCESS' ? 1 : 0,
    renotifyCount: 0,
    createdAt: when.toISOString(),
    updatedAt: when.toISOString(),
    paidAt: config.status === 'SUCCESS' ? new Date(when.getTime() + 90000).toISOString() : null,
    settleDate: config.status === 'SUCCESS' ? addDays(dateStr(when), 1) : null,
    seeded: true
  };

  if (config.status === 'SUCCESS') {
    const paidAt = new Date(payment.paidAt);
    payment.events = buildEvents(payment, when, PHASES.length - 1, false);
    const base = {
      outTradeNo: payment.outTradeNo,
      channelTradeNo: payment.channelTradeNo,
      channel: payment.channel,
      amount: fmtCents(payment.amount),
      status: 'SUCCESS',
      notifiedAt: paidAt.toISOString()
    };
    const signature = sign(base);
    payment.notifyPayload = { ...base, sign: signature };
    ops.postPaymentLedger(payment, payment.paidAt);
  } else if (config.status === 'FAILED') {
    payment.events = buildEvents(payment, when, 3, true);
    store.get().risks.checks.unshift({
      id: rid('RC'),
      paymentId: payment.id,
      outTradeNo: payment.outTradeNo,
      buyer: payment.buyer,
      amount: payment.amount,
      decision: 'BLOCK',
      score: 96,
      hits: [{ ruleId: 'R003', ruleName: '黑名单用户', level: 'BLOCK', detail: '买家命中黑名单' }],
      at: when.toISOString()
    });
  } else {
    payment.events = buildEvents(payment, when, 5, false);
  }

  store.get().orders.unshift(makeOrder(payment, when));
  store.get().payments.push(payment);
  return payment;
}

function run() {
  if (!store.isFresh()) return false;
  const state = store.get();
  state.payments = [];
  state.orders = [];
  state.ledger = [];
  state.refunds = [];
  state.batches = [];
  state.bills = [];
  state.reconRuns = [];
  state.interbank = { flows: [], journal: [], ops: [] };
  state.logs = [];

  addPayment({ when: atDate(-2, 10, 12), amount: 25800, channel: 'wechat', subject: '静音机械键盘', buyer: 'U20001', status: 'SUCCESS' });
  addPayment({ when: atDate(-2, 14, 36), amount: 12850, channel: 'alipay', subject: '手冲咖啡豆 250g', buyer: 'U20002', status: 'SUCCESS' });
  addPayment({ when: atDate(-2, 18, 5), amount: 3990, channel: 'unionpay', subject: '保温杯 500ml', buyer: 'U20003', status: 'SUCCESS' });

  addPayment({ when: atDate(-1, 9, 20), amount: 12800, channel: 'alipay', subject: '无线降噪耳机', buyer: 'U20004', status: 'SUCCESS' });
  addPayment({ when: atDate(-1, 11, 42), amount: 6660, channel: 'wechat', subject: '云存储年卡', buyer: 'U20005', status: 'SUCCESS' });
  addPayment({ when: atDate(-1, 16, 8), amount: 52000, channel: 'wechat', subject: '人体工学办公椅', buyer: 'U20006', status: 'SUCCESS' });
  addPayment({ when: atDate(-1, 20, 55), amount: 120000, channel: 'alipay', subject: '设计素材年度包', buyer: 'U20007', status: 'SUCCESS' });

  const todayPayment = addPayment({ when: todayAt(300), amount: 12800, channel: 'alipay', subject: '手冲咖啡豆 250g', buyer: 'U10001', status: 'SUCCESS' });
  addPayment({ when: todayAt(180), amount: 6660, channel: 'wechat', subject: '云存储年卡', buyer: 'U10002', status: 'SUCCESS' });
  const refundedPayment = addPayment({ when: todayAt(90), amount: 99900, channel: 'unionpay', subject: '无线降噪耳机', buyer: 'U10003', status: 'SUCCESS' });
  addPayment({ when: todayAt(35), amount: 19900, channel: 'alipay', subject: '待支付订单 · 演示超时关单', buyer: 'U10008', status: 'PAYING' });
  addPayment({ when: todayAt(20), amount: 29900, channel: 'alipay', subject: '风控拦截演示商品', buyer: 'U-BLACKLIST', status: 'FAILED' });

  const refundTime = new Date(todayPayment.createdAt).getTime() + 30 * 60 * 1000;
  const refund = {
    id: rid('RFD'),
    refundNo: rid('RF'),
    paymentId: refundedPayment.id,
    outTradeNo: refundedPayment.outTradeNo,
    merchantId: refundedPayment.merchantId,
    merchantName: refundedPayment.merchantName,
    subject: refundedPayment.subject,
    channel: refundedPayment.channel,
    channelName: refundedPayment.channelName,
    amount: 3000,
    feeAmount: 0,
    reason: '商品轻微划痕，协商部分退款',
    source: 'MERCHANT',
    status: 'SUCCESS',
    createdAt: new Date(refundTime).toISOString(),
    finishedAt: new Date(refundTime + 40000).toISOString(),
    failReason: null,
    events: [
      {
        ts: new Date(refundTime).toISOString(),
        title: '退款申请受理',
        detail: '商户发起部分退款，金额 ¥30.00',
        level: 'info',
        response: { refundNo: 'RF...', status: 'PROCESSING' }
      },
      {
        ts: new Date(refundTime + 20000).toISOString(),
        title: '渠道退款成功',
        detail: '渠道已原路退回资金',
        level: 'success',
        response: { status: 'SUCCESS' }
      },
      {
        ts: new Date(refundTime + 40000).toISOString(),
        title: '账务冲销完成',
        detail: '借：商户待结算款 / 贷：渠道应收款（手续费不退还）',
        level: 'success',
        response: { balanced: true }
      }
    ]
  };
  refundedPayment.refundedAmount = 3000;
  refundedPayment.refundStatus = 'PARTIAL';
  const refundEntry = ops.postRefundLedger(refund, refundedPayment, { ts: refund.createdAt });
  refund.ledgerEntries = refundEntry.entries;
  state.refunds.push(refund);

  const yesterday = dateStr(new Date(Date.now() - 86400000));
  const today = dateStr(new Date());

  const oldBatch = state.payments.filter((payment) => payment.settleDate === yesterday && payment.status === 'SUCCESS');
  if (oldBatch.length) {
    const batches = ops.generateBatches(yesterday);
    for (const batch of batches) ops.settleBatch(batch.id);
  }
  if (state.payments.some((payment) => payment.settleDate === today && payment.status === 'SUCCESS')) {
    ops.generateBatches(today);
  }

  interbank.seedFlows(state.payments);
  banking.seedBanking();

  state.logs = [];
  for (const payment of state.payments) {
    for (const event of payment.events) {
      store.pushLog({
        ...event,
        paymentId: payment.id,
        outTradeNo: payment.outTradeNo,
        merchantName: payment.merchantName
      });
    }
  }
  store.pushLog({
    id: rid('LOG'),
    ts: new Date().toISOString(),
    phaseIndex: -1,
    stage: 'seed',
    stageName: '演示数据',
    actor: '系统',
    target: '',
    title: '演示数据初始化完成',
    detail: '已生成历史交易、退款、结算与风控记录',
    level: 'info',
    request: null,
    response: null,
    signInfo: null,
    latencyMs: 0,
    kind: 'system'
  });
  store.pushLog({
    id: rid('LOG'),
    ts: new Date().toISOString(),
    phaseIndex: -1,
    stage: 'interbank',
    stageName: '跨机构清算',
    actor: '系统',
    target: '',
    title: '清算网络与银行会计演示数据就绪',
    detail: `已生成 ${state.interbank.flows.length} 条跨机构资金链路、${state.interbank.journal.length} 张跨机构分录与 ${state.interbank.ops.length} 笔银行业务`,
    level: 'info',
    request: null,
    response: null,
    signInfo: null,
    latencyMs: 0,
    kind: 'system'
  });
  store.markSeeded();
  store.saveNow();
  return true;
}

module.exports = { run };
