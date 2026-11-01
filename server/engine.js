'use strict';

const store = require('./store');
const ops = require('./ops');
const interbank = require('./interbank');
const {
  rid, toCents, fmtCents, dateStr, addDays, sign, signString, httpError, roundFee
} = require('./util');

const CHANNELS = {
  alipay: {
    code: 'alipay', name: '支付宝', feeRate: 0.006, settle: 'T+1', backup: 'wechat',
    color: '#2f7bff', scene: '扫码支付', tagline: '国民级钱包，覆盖率最高'
  },
  wechat: {
    code: 'wechat', name: '微信支付', feeRate: 0.006, settle: 'T+1', backup: 'alipay',
    color: '#22c07a', scene: '扫码支付', tagline: '社交支付场景首选'
  },
  unionpay: {
    code: 'unionpay', name: '银联云闪付', feeRate: 0.0055, settle: 'T+1', backup: 'alipay',
    color: '#d94a4a', scene: '扫码/被扫', tagline: '费率更低，适合大额'
  },
  balance: {
    code: 'balance', name: '账户余额', feeRate: 0, settle: 'T+0', backup: 'alipay',
    color: '#a78bfa', scene: '余额扣款', tagline: '平台账户余额，实时到账'
  },
  crossborder: {
    code: 'crossborder', name: '境外卡组织', feeRate: 0.028, settle: 'T+2', backup: 'unionpay',
    color: '#8b5cf6', scene: '境外卡收单', tagline: 'Visa / Mastercard 多币种收单，实时结汇'
  }
};

const FX_RATE = 7.24;

const PHASES = [
  {
    key: 'order', name: '用户下单', actor: '商户系统', target: '收银台',
    desc: '创建业务订单，锁定商品与价格',
    teaching: '业务订单与支付单分离：订单只关心“卖什么”，支付单关心“怎么收钱”。两者通过商户订单号关联，互不耦合。'
  },
  {
    key: 'cashier', name: '收银台渲染', actor: '收银台', target: '支付网关',
    desc: '展示支付方式，采集支付要素',
    teaching: '收银台是用户与支付网关之间的第一层，负责渠道展示、优惠计算与支付要素采集，不直接触碰资金。'
  },
  {
    key: 'gateway', name: '网关收单校验', actor: '支付网关', target: '风控引擎',
    desc: '参数校验、商户验签、生成支付单',
    teaching: '网关第一件事不是调渠道，而是校验请求合法性与幂等键，避免网络重试造成重复支付单。'
  },
  {
    key: 'risk', name: '实时风控决策', actor: '风控引擎', target: '路由中心',
    desc: '规则评估交易风险，输出通过/复核/拦截',
    teaching: '风控在调用渠道之前完成决策：拦截的成本远低于事后追款。大额交易进入人工复核，黑名单直接阻断。'
  },
  {
    key: 'route', name: '渠道路由', actor: '路由中心', target: '支付渠道',
    desc: '按成本、成功率、限额选择渠道',
    teaching: '路由不只是“选一个能用的渠道”，而是在费率、成功率、额度之间动态权衡，并为故障预留备用通道。'
  },
  {
    key: 'precreate', name: '渠道预下单', actor: '支付渠道', target: '用户',
    desc: '渠道返回交易号与付款凭证',
    teaching: '预下单成功只代表渠道已受理，支付单进入 PAYING。此时钱还没到账，状态绝不能置为成功。'
  },
  {
    key: 'userpay', name: '用户支付', actor: '用户', target: '支付渠道',
    desc: '扫码/确认扣款，渠道完成资金划转',
    teaching: '用户侧支付成功不等于平台入账成功。平台只信任渠道的异步通知或主动查单结果，二者最终以查单为准。'
  },
  {
    key: 'notify', name: '渠道异步通知', actor: '支付渠道', target: '支付网关',
    desc: '渠道回调交易结果，携带签名',
    teaching: '异步通知可能重复、乱序、延迟甚至丢失，所以必须做验签、金额核对与幂等处理，不能“收到即入账”。'
  },
  {
    key: 'verify', name: '验签与幂等', actor: '支付网关', target: '账务中心',
    desc: '验签、核对金额、幂等去重、推进状态机',
    teaching: '幂等键 + 状态机双重保障：同一笔支付无论回调多少次，只能入账一次；验签或金额异常时转主动查单。'
  },
  {
    key: 'ledger', name: '账务入账', actor: '账务中心', target: '商户系统',
    desc: '复式记账，拆分手续费，生成清算流水',
    teaching: '账务必须借贷平衡：渠道应收款 = 商户待结算款 + 手续费收入。资金流与信息流在此完成对齐。'
  },
  {
    key: 'merchant', name: '商户结果通知', actor: '商户系统', target: '支付平台',
    desc: '通知商户支付结果，失败退避重试',
    teaching: '商户通知与渠道回调是对称的：同样需要签名、重试与幂等，直到商户明确返回成功。'
  },
  {
    key: 'done', name: '交易完成', actor: '支付平台', target: '对账中心',
    desc: '支付终态，进入对账与结算周期',
    teaching: '支付成功只是开始：T+1 对账、净额结算、差错处理，才构成资金安全的完整闭环。'
  }
];

const SCENARIOS = [
  { code: 'normal', name: '正常支付', desc: '完整走通 12 个阶段，用于主流程教学', amount: 128, channel: 'alipay', buyer: 'U10001' },
  { code: 'cross_border', name: '跨境支付（境外卡）', desc: '境外持卡人 USD 付款，结汇后经 CIPS 人民币清算入账', amount: 724, channel: 'crossborder', buyer: 'U-FOREIGN-01' },
  { code: 'risk_block', name: '风控拦截', desc: '买家命中黑名单，支付在风控环节被阻断', amount: 299, channel: 'alipay', buyer: 'U-BLACKLIST' },
  { code: 'large_review', name: '大额人工审核', desc: '单笔金额达到阈值，支付暂停等待人工复核', amount: 6800, channel: 'wechat', buyer: 'U10002' },
  { code: 'channel_fail', name: '渠道故障降级', desc: '主渠道预下单超时，路由自动切换备用渠道', amount: 88, channel: 'alipay', buyer: 'U10003' },
  { code: 'insufficient_balance', name: '余额不足', desc: '余额渠道扣款失败，交易终止', amount: 520, channel: 'balance', buyer: 'U10004' },
  { code: 'callback_dup', name: '重复回调（幂等）', desc: '渠道重复推送通知，验证幂等不重复入账', amount: 66.6, channel: 'wechat', buyer: 'U10005' },
  { code: 'callback_lost', name: '回调丢失（掉单）', desc: '渠道已扣款但通知丢失，需主动查单补单', amount: 199, channel: 'alipay', buyer: 'U10006' },
  { code: 'amount_mismatch', name: '金额篡改', desc: '通知金额与订单不一致，拒绝入账并转查单', amount: 10, channel: 'unionpay', buyer: 'U10007' },
  { code: 'bad_signature', name: '验签失败', desc: '通知签名无效，不信任报文并主动查单', amount: 50, channel: 'wechat', buyer: 'U10008' },
  { code: 'notify_retry', name: '商户通知重试', desc: '首次通知商户超时，按退避策略重试成功', amount: 120, channel: 'alipay', buyer: 'U10009' }
];

const LATENCY = {
  order: 35, cashier: 18, gateway: 42, risk: 120, route: 22, precreate: 310,
  userpay: 2300, notify: 860, verify: 28, ledger: 64, merchant: 180, done: 10
};

function nowIso() {
  return new Date().toISOString();
}

function channelOf(code) {
  return CHANNELS[code] || CHANNELS.alipay;
}

function feeFor(amount, channelCode) {
  return roundFee(amount, channelOf(channelCode).feeRate);
}

function fxPayload(payment) {
  const cb = payment.crossBorder;
  if (!cb) return {};
  return {
    foreignCurrency: cb.foreignCurrency,
    foreignAmount: fmtCents(cb.foreignAmount),
    fxRate: cb.fxRate,
    settleCurrency: cb.settleCurrency
  };
}

function fxSummary(payment) {
  const cb = payment.crossBorder;
  if (!cb) return '';
  return `${cb.foreignCurrency} ${fmtCents(cb.foreignAmount)} × ${cb.fxRate} = ¥${fmtCents(payment.amount)}`;
}

function settleDaysOf(channel) {
  if (channel.settle === 'T+0') return 0;
  if (channel.settle === 'T+2') return 2;
  return 1;
}

function findPayment(id) {
  const payment = store.get().payments.find((item) => item.id === id);
  if (!payment) throw httpError(404, '支付单不存在');
  return payment;
}

function findOrder(payment) {
  return store.get().orders.find((item) => item.id === payment.orderId);
}

function emit(payment, phaseIndex, payload) {
  const phase = PHASES[phaseIndex] || { key: 'system', name: '系统', actor: '支付平台' };
  const event = {
    id: rid('EV'),
    seq: payment.events.length + 1,
    ts: payload.ts || nowIso(),
    phaseIndex,
    stage: phase.key,
    stageName: phase.name,
    actor: payload.actor || phase.actor,
    target: payload.target || phase.target || '',
    title: payload.title,
    detail: payload.detail || '',
    level: payload.level || 'info',
    request: payload.request || null,
    response: payload.response || null,
    signInfo: payload.signInfo || null,
    latencyMs: payload.latencyMs === undefined ? (LATENCY[phase.key] || 20) : payload.latencyMs,
    kind: payload.kind || 'normal'
  };
  payment.events.push(event);
  payment.updatedAt = event.ts;
  store.pushLog({
    ...event,
    paymentId: payment.id,
    outTradeNo: payment.outTradeNo,
    merchantName: payment.merchantName
  });
  return event;
}

function makeSignedPayload(base) {
  const signature = sign(base);
  return {
    payload: { ...base, sign: signature },
    signInfo: {
      algorithm: 'HMAC-SHA256',
      signString: signString(base),
      sign: signature,
      verifyResult: 'VALID'
    }
  };
}

function evaluateRisk(input) {
  const rules = store.get().risks.rules.filter((rule) => rule.enabled);
  const hits = [];
  const hour = input.hour !== undefined ? Number(input.hour) : new Date(input.at || Date.now()).getHours();
  const now = Date.now();

  for (const rule of rules) {
    const params = rule.params || {};
    let hit = false;
    let level = rule.level;
    let detail = '';

    if (rule.id === 'R001') {
      if (input.amount >= params.blockAmount) {
        hit = true;
        level = 'BLOCK';
        detail = `单笔金额 ${fmtCents(input.amount)} 元 ≥ 拦截阈值 ${fmtCents(params.blockAmount)} 元`;
      } else if (input.amount >= params.reviewAmount) {
        hit = true;
        level = 'REVIEW';
        detail = `单笔金额 ${fmtCents(input.amount)} 元 ≥ 审核阈值 ${fmtCents(params.reviewAmount)} 元`;
      }
    } else if (rule.id === 'R002') {
      const start = Number(params.startHour);
      const end = Number(params.endHour);
      const inNight = start <= end ? (hour >= start && hour < end) : (hour >= start || hour < end);
      if (inNight && input.amount >= params.minAmount) {
        hit = true;
        detail = `夜间 ${hour}:00 交易，金额 ${fmtCents(input.amount)} 元 ≥ ${fmtCents(params.minAmount)} 元`;
      }
    } else if (rule.id === 'R003') {
      const users = (params.users || []).map((user) => String(user).toUpperCase());
      if (users.includes(String(input.buyer).toUpperCase())) {
        hit = true;
        detail = `买家 ${input.buyer} 命中黑名单`;
      }
    } else if (rule.id === 'R004') {
      const since = now - Number(params.windowSec) * 1000;
      const count = store.get().payments.filter((payment) => (
        payment.id !== input.paymentId &&
        payment.buyer === input.buyer &&
        new Date(payment.createdAt).getTime() >= since
      )).length;
      if (count >= Number(params.maxCount)) {
        hit = true;
        detail = `买家 ${input.buyer} 在 ${params.windowSec} 秒内已发起 ${count} 笔支付`;
      }
    } else if (rule.id === 'R005') {
      if (input.isNewDevice && input.amount >= params.minAmount) {
        hit = true;
        detail = `新设备首次支付，金额 ${fmtCents(input.amount)} 元 ≥ ${fmtCents(params.minAmount)} 元`;
      }
    }

    if (hit) {
      hits.push({ ruleId: rule.id, ruleName: rule.name, level, detail });
    }
  }

  let decision = 'PASS';
  if (hits.some((hit) => hit.level === 'BLOCK')) decision = 'BLOCK';
  else if (hits.some((hit) => hit.level === 'REVIEW')) decision = 'REVIEW';

  const score = decision === 'BLOCK'
    ? Math.min(99, 80 + hits.length * 4)
    : decision === 'REVIEW'
      ? Math.min(79, 55 + hits.length * 5)
      : 6 + hits.length * 2;

  return { decision, score, hits };
}

function createPayment(body) {
  const scenario = SCENARIOS.some((item) => item.code === body.scenario) ? body.scenario : 'normal';
  const amount = toCents(body.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 20000000) {
    throw httpError(400, '支付金额需在 0.01 ~ 200,000.00 元之间');
  }
  let channelCode = CHANNELS[body.channel] ? body.channel : 'alipay';
  if (scenario === 'insufficient_balance') channelCode = 'balance';
  if (scenario === 'cross_border') channelCode = 'crossborder';
  const channel = channelOf(channelCode);
  const buyer = scenario === 'risk_block' ? 'U-BLACKLIST' : String(body.buyer || 'U10001').trim().slice(0, 32);
  const subject = String(body.subject || '教学演示商品').trim().slice(0, 60) || '教学演示商品';
  const crossBorder = scenario === 'cross_border' ? {
    fxRate: FX_RATE,
    foreignCurrency: 'USD',
    foreignAmount: Math.round(amount / FX_RATE),
    settleCurrency: 'CNY'
  } : null;

  const now = new Date();
  const outTradeNo = rid('O', now);
  const order = {
    id: rid('ORD', now),
    outTradeNo,
    paymentId: null,
    merchantId: 'M2026001',
    merchantName: '云栖优选商城',
    subject,
    amount,
    currency: 'CNY',
    status: 'CREATED',
    createdAt: now.toISOString()
  };
  const payment = {
    id: rid('PAY', now),
    orderId: order.id,
    outTradeNo,
    merchantId: order.merchantId,
    merchantName: order.merchantName,
    subject,
    amount,
    currency: 'CNY',
    settleCycle: channel.settle,
    crossBorder,
    channel: channel.code,
    channelName: channel.name,
    buyer,
    scenario,
    status: 'INIT',
    phaseIndex: 0,
    completed: false,
    terminated: false,
    failedPhase: null,
    waiting: null,
    events: [],
    idempotencyKey: rid('IDK', now),
    riskScore: null,
    riskDecision: null,
    riskHits: [],
    fee: 0,
    netAmount: 0,
    refundedAmount: 0,
    refundStatus: 'NONE',
    channelTradeNo: null,
    channelPaid: false,
    compensated: false,
    failover: false,
    notifyAttempts: 0,
    renotifyCount: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    paidAt: null,
    settleDate: null
  };
  order.paymentId = payment.id;
  store.get().orders.unshift(order);
  store.get().payments.unshift(payment);
  store.save();
  return detail(payment);
}

function runPhase(payment, idx) {
  const phase = PHASES[idx];

  if (phase.key === 'order') {
    const order = findOrder(payment);
    if (order) order.status = 'CREATED';
    emit(payment, idx, {
      title: '创建业务订单',
      detail: payment.crossBorder
        ? `商户系统生成跨境订单 ${payment.outTradeNo}，原币 ${payment.crossBorder.foreignCurrency} ${fmtCents(payment.crossBorder.foreignAmount)}，按 ${payment.crossBorder.fxRate} 结汇为 ¥${fmtCents(payment.amount)}`
        : `商户系统生成业务订单 ${payment.outTradeNo}，金额 ¥${fmtCents(payment.amount)}`,
      request: {
        merchantId: payment.merchantId,
        outTradeNo: payment.outTradeNo,
        subject: payment.subject,
        amount: fmtCents(payment.amount),
        currency: 'CNY',
        ...fxPayload(payment),
        notifyUrl: 'https://merchant.example.com/api/pay/notify'
      },
      response: {
        orderId: order ? order.id : null,
        orderStatus: 'CREATED',
        createdAt: payment.createdAt
      }
    });
    return 'next';
  }

  if (phase.key === 'cashier') {
    emit(payment, idx, {
      title: '收银台初始化',
      detail: `展示 ${Object.keys(CHANNELS).length} 种支付方式，用户选择 ${channelOf(payment.channel).name}`,
      request: {
        outTradeNo: payment.outTradeNo,
        amount: fmtCents(payment.amount),
        scene: 'PC_QR',
        ...fxPayload(payment),
        channels: Object.values(CHANNELS).map((item) => ({ code: item.code, name: item.name }))
      },
      response: {
        sessionId: rid('CASHIER'),
        selectedChannel: payment.channel,
        selectedChannelName: channelOf(payment.channel).name,
        ...(payment.crossBorder ? { settleCurrency: payment.crossBorder.settleCurrency, fxRate: payment.crossBorder.fxRate } : {}),
        expireIn: 900,
        coupon: null
      }
    });
    return 'next';
  }

  if (phase.key === 'gateway') {
    const base = {
      appId: 'PAYLAB_APP_01',
      outTradeNo: payment.outTradeNo,
      amount: fmtCents(payment.amount),
      currency: 'CNY',
      crossBorder: Boolean(payment.crossBorder),
      ...fxPayload(payment),
      channel: payment.channel,
      idempotencyKey: payment.idempotencyKey
    };
    const signedPayload = makeSignedPayload(base);
    emit(payment, idx, {
      title: '收单校验通过',
      detail: '商户签名校验通过，参数合法，生成平台支付单并分配幂等键',
      request: signedPayload.payload,
      response: {
        paymentId: payment.id,
        status: 'INIT',
        idempotencyKey: payment.idempotencyKey,
        merchantId: payment.merchantId
      },
      signInfo: signedPayload.signInfo
    });
    return 'next';
  }

  if (phase.key === 'risk') {
    const result = evaluateRisk({
      paymentId: payment.id,
      amount: payment.amount,
      buyer: payment.buyer,
      channel: payment.channel,
      at: payment.createdAt,
      isNewDevice: payment.scenario === 'risk_block'
    });

    if (payment.scenario === 'risk_block' && result.decision !== 'BLOCK') {
      result.decision = 'BLOCK';
      result.score = 96;
      result.hits.push({
        ruleId: 'R003',
        ruleName: '黑名单用户',
        level: 'BLOCK',
        detail: `场景预设：买家 ${payment.buyer} 命中黑名单`
      });
    }
    if (payment.scenario === 'large_review' && result.decision === 'PASS') {
      result.decision = 'REVIEW';
      result.score = Math.max(result.score, 62);
      result.hits.push({
        ruleId: 'R001',
        ruleName: '单笔金额阈值',
        level: 'REVIEW',
        detail: '场景预设：大额交易进入人工复核'
      });
    }

    payment.riskDecision = result.decision;
    payment.riskScore = result.score;
    payment.riskHits = result.hits;

    store.get().risks.checks.unshift({
      id: rid('RC'),
      paymentId: payment.id,
      outTradeNo: payment.outTradeNo,
      buyer: payment.buyer,
      amount: payment.amount,
      decision: result.decision,
      score: result.score,
      hits: result.hits,
      at: nowIso()
    });
    if (store.get().risks.checks.length > 120) store.get().risks.checks.length = 120;

    emit(payment, idx, {
      title: `风控决策：${result.decision === 'PASS' ? '通过' : result.decision === 'REVIEW' ? '人工复核' : '拦截'}`,
      detail: result.hits.length ? result.hits.map((hit) => hit.detail).join('；') : '未命中风险规则，交易放行',
      level: result.decision === 'PASS' ? 'success' : result.decision === 'REVIEW' ? 'warn' : 'error',
      request: {
        buyer: payment.buyer,
        amount: fmtCents(payment.amount),
        channel: payment.channel,
        rulesVersion: 'v2.6',
        isNewDevice: payment.scenario === 'risk_block',
        crossBorder: Boolean(payment.crossBorder),
        ...fxPayload(payment)
      },
      response: {
        decision: result.decision,
        score: result.score,
        hits: result.hits,
        ...(payment.crossBorder ? { crossBorderCheck: 'PASS', declaration: 'AFTER_PAYMENT' } : {})
      },
      latencyMs: 120
    });

    if (payment.crossBorder && result.decision !== 'BLOCK') {
      emit(payment, idx, {
        actor: '风控引擎',
        target: '外汇申报系统',
        title: '跨境交易标识 · 国际收支申报',
        detail: `外币交易按 ${payment.crossBorder.fxRate} 折算为本币风控口径；支付成功后需报送国际收支申报`,
        level: 'info',
        request: {
          outTradeNo: payment.outTradeNo,
          crossBorder: true,
          payerCountry: 'US',
          ...fxPayload(payment)
        },
        response: {
          declarationStatus: 'PENDING',
          reportPoint: 'PAYMENT_SUCCESS',
          regulatory: 'SAFE 国际收支申报'
        },
        latencyMs: 18
      });
    }

    if (result.decision === 'BLOCK') {
      failPayment(payment, idx, 'FAILED', result.hits[0] ? result.hits[0].detail : '风控拦截');
      return 'terminate';
    }
    if (result.decision === 'REVIEW') {
      payment.waiting = {
        type: 'risk_review',
        phase: idx,
        actions: ['approve', 'reject'],
        title: '大额交易待人工审核',
        hint: '风控返回 REVIEW，支付流程暂停。请在操作台选择“审核通过”或“审核拒绝”。'
      };
      return 'wait';
    }
    return 'next';
  }

  if (phase.key === 'route') {
    const primary = channelOf(payment.channel);
    const backup = channelOf(primary.backup);
    emit(payment, idx, {
      title: '路由选择',
      detail: payment.crossBorder
        ? `识别为跨境收单，选择 ${primary.name}，经 CIPS 完成人民币跨境清算，${primary.settle} 结算`
        : `综合费率与实时成功率，选择 ${primary.name}${payment.scenario === 'channel_fail' ? '，备用通道已就绪' : ''}`,
      request: {
        amount: fmtCents(payment.amount),
        ...fxPayload(payment),
        candidates: [primary, backup].map((item) => ({
          channel: item.code,
          name: item.name,
          feeRate: item.feeRate,
          settle: item.settle,
          successRate: item.code === 'alipay' ? 0.998 : item.code === 'wechat' ? 0.997 : 0.995
        })),
        strategy: payment.crossBorder ? 'CROSS_BORDER_ACQUIRING' : 'COST_PERFORMANCE'
      },
      response: {
        selected: primary.code,
        selectedName: primary.name,
        fallback: primary.backup,
        reason: payment.crossBorder ? '跨境卡组织直连，支持多币种结汇' : '费率与成功率综合最优',
        ...(payment.crossBorder ? { clearingNetwork: 'CIPS', settleCycle: primary.settle } : {})
      }
    });
    return 'next';
  }

  if (phase.key === 'precreate') {
    let current = channelOf(payment.channel);
    if (payment.scenario === 'channel_fail' && !payment.failover) {
      emit(payment, idx, {
        title: '主渠道预下单失败',
        detail: `${current.name} 返回 CHANNEL_TIMEOUT，重试一次仍然失败`,
        level: 'error',
        request: {
          outTradeNo: payment.outTradeNo,
          amount: fmtCents(payment.amount),
          channel: current.code,
          ...fxPayload(payment)
        },
        response: {
          code: 'CHANNEL_TIMEOUT',
          message: '渠道响应超时（3000ms）',
          retry: 1
        },
        latencyMs: 3000
      });
      const backup = channelOf(current.backup);
      payment.failover = true;
      payment.channel = backup.code;
      payment.channelName = backup.name;
      emit(payment, idx, {
        actor: '路由中心',
        target: backup.name,
        title: '路由自动降级',
        detail: `健康检查发现 ${current.name} 超时率突增，自动切换至备用通道 ${backup.name}`,
        level: 'warn',
        request: { from: current.code, to: backup.code, trigger: 'TIMEOUT_RATE' },
        response: { selected: backup.code, degraded: true, reason: '主通道不可用' },
        latencyMs: 12
      });
      current = backup;
    }

    payment.channelTradeNo = rid('CH');
    payment.status = 'PAYING';
    const expireAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    emit(payment, idx, {
      title: '渠道预下单成功',
      detail: payment.crossBorder
        ? `${current.name} 受理境外卡订单，原币 ${payment.crossBorder.foreignCurrency} ${fmtCents(payment.crossBorder.foreignAmount)} 按 ${payment.crossBorder.fxRate} 锁定结汇价，返回交易号`
        : `${current.name} 受理成功，返回交易号与付款二维码`,
      level: 'success',
      request: {
        outTradeNo: payment.outTradeNo,
        amount: fmtCents(payment.amount),
        subject: payment.subject,
        channel: current.code,
        ...fxPayload(payment)
      },
      response: {
        channelTradeNo: payment.channelTradeNo,
        payUrl: `https://sandbox.pay.example/qr/${payment.channelTradeNo}`,
        expireAt,
        feeRate: current.feeRate,
        settleCycle: current.settle,
        ...(payment.crossBorder ? { fxRate: payment.crossBorder.fxRate, foreignAmount: fmtCents(payment.crossBorder.foreignAmount) } : {})
      },
      latencyMs: 310
    });
    payment.phaseIndex = 6;
    payment.waiting = {
      type: 'user_pay',
      phase: 6,
      actions: ['confirm_pay'],
      title: '等待用户扫码支付',
      hint: `请点击“确认支付”，模拟用户在 ${current.name} 完成 ¥${fmtCents(payment.amount)} 的付款。`
    };
    return 'wait';
  }

  if (phase.key === 'notify') {
    const base = {
      notifyId: rid('NT'),
      outTradeNo: payment.outTradeNo,
      channelTradeNo: payment.channelTradeNo,
      channel: payment.channel,
      amount: fmtCents(payment.amount),
      status: 'SUCCESS',
      ...fxPayload(payment),
      notifiedAt: nowIso()
    };
    let payload;
    let signInfo;
    let level = 'info';

    if (payment.scenario === 'amount_mismatch') {
      const tampered = { ...base, amount: fmtCents(payment.amount + 100) };
      const signature = sign(tampered);
      payload = { ...tampered, sign: signature };
      signInfo = {
        algorithm: 'HMAC-SHA256',
        signString: signString(tampered),
        sign: signature,
        verifyResult: 'VALID'
      };
      level = 'warn';
    } else if (payment.scenario === 'bad_signature') {
      const signature = sign(base);
      payload = { ...base, amount: fmtCents(payment.amount + 10000), sign: 'INVALID_' + signature.slice(0, 24) };
      signInfo = {
        algorithm: 'HMAC-SHA256',
        signString: signString({ ...base, amount: fmtCents(payment.amount + 10000) }),
        sign: payload.sign,
        expected: signature,
        verifyResult: 'INVALID'
      };
      level = 'warn';
    } else {
      const signedPayload = makeSignedPayload(base);
      payload = signedPayload.payload;
      signInfo = signedPayload.signInfo;
    }

    payment.notifyPayload = payload;
    emit(payment, idx, {
      target: '支付网关',
      title: payment.scenario === 'bad_signature' ? '渠道异步通知（签名异常）' : '收到渠道异步通知',
      detail: '渠道回调支付结果，需验签、核对金额并按幂等键处理',
      level,
      request: null,
      response: payload,
      signInfo,
      kind: 'callback'
    });
    return 'next';
  }

  if (phase.key === 'verify') {
    const payload = payment.notifyPayload;
    if (!payload) {
      emit(payment, idx, {
        title: '缺少支付结果报文',
        detail: '未收到有效通知，转主动查单',
        level: 'error',
        response: { code: 'NOTIFY_MISSING' }
      });
      payment.status = 'EXCEPTION';
      payment.waiting = {
        type: 'exception',
        phase: idx,
        actions: ['query_channel'],
        title: '等待主动查单',
        hint: '没有可信的支付结果通知。请点击“主动查单”，以渠道权威结果为准。'
      };
      return 'wait';
    }

    const unsigned = { ...payload };
    delete unsigned.sign;
    const expected = sign(unsigned);
    const signatureValid = payment.queryVerified ? true : payload.sign === expected;

    if (!signatureValid) {
      emit(payment, idx, {
        title: '验签失败',
        detail: '通知签名与报文不匹配，报文不可信，拒绝入账',
        level: 'error',
        request: payload,
        response: {
          code: 'SIGN_INVALID',
          expected: expected.slice(0, 24) + '...',
          actual: String(payload.sign).slice(0, 24) + '...'
        },
        signInfo: {
          algorithm: 'HMAC-SHA256',
          signString: signString(unsigned),
          sign: expected,
          verifyResult: 'INVALID'
        }
      });
      payment.status = 'EXCEPTION';
      payment.waiting = {
        type: 'exception',
        phase: idx,
        actions: ['query_channel'],
        title: '验签失败，等待查单',
        hint: '验签失败的通知不能入账。请主动查单，以渠道权威结果为准。'
      };
      return 'wait';
    }

    const notifyAmount = toCents(payload.amount);
    if (notifyAmount !== payment.amount) {
      emit(payment, idx, {
        title: '金额校验不一致',
        detail: `通知金额 ¥${fmtCents(notifyAmount)} 与订单金额 ¥${fmtCents(payment.amount)} 不一致，拒绝入账`,
        level: 'error',
        request: payload,
        response: {
          code: 'AMOUNT_MISMATCH',
          orderAmount: fmtCents(payment.amount),
          notifyAmount: fmtCents(notifyAmount)
        }
      });
      payment.status = 'EXCEPTION';
      payment.waiting = {
        type: 'exception',
        phase: idx,
        actions: ['query_channel'],
        title: '金额不一致，等待查单',
        hint: '通知金额与订单不符，必须以渠道查单结果为准，避免多记或少记资金。'
      };
      return 'wait';
    }

    if (payment.status === 'SUCCESS') {
      emit(payment, idx, {
        title: '幂等拦截：重复通知',
        detail: '支付单已是 SUCCESS，本次通知被丢弃，不重复入账',
        level: 'success',
        response: { dedup: true, idempotencyKey: payment.idempotencyKey, ledgerAction: 'NONE' },
        latencyMs: 8
      });
      return 'next';
    }

    payment.status = 'SUCCESS';
    payment.paidAt = nowIso();
    payment.settleCycle = channelOf(payment.channel).settle;
    payment.settleDate = addDays(dateStr(new Date(payment.paidAt)), settleDaysOf(channelOf(payment.channel)));
    const fee = feeFor(payment.amount, payment.channel);
    payment.fee = fee;
    payment.netAmount = payment.amount - fee;

    emit(payment, idx, {
      title: '验签通过 · 幂等校验通过',
      detail: payment.crossBorder
        ? `通知金额、结汇汇率与原币金额核对一致，幂等键 ${payment.idempotencyKey} 首次处理，支付单 PAYING → SUCCESS`
        : `幂等键 ${payment.idempotencyKey} 首次处理，支付单 PAYING → SUCCESS`,
      level: 'success',
      request: {
        notifyId: payload.notifyId || null,
        outTradeNo: payment.outTradeNo,
        channelTradeNo: payment.channelTradeNo
      },
      response: {
        signature: 'VALID',
        amountCheck: 'MATCHED',
        ...(payment.crossBorder ? {
          fxCheck: 'MATCHED',
          foreignAmount: fmtCents(payment.crossBorder.foreignAmount),
          fxRate: payment.crossBorder.fxRate,
          settledAmount: fmtCents(payment.amount)
        } : {}),
        idempotency: 'FIRST_PROCESS',
        from: 'PAYING',
        to: 'SUCCESS',
        paidAt: payment.paidAt,
        settleCycle: channelOf(payment.channel).settle,
        settleDate: payment.settleDate
      },
      latencyMs: 28
    });
    return 'next';
  }

  if (phase.key === 'ledger') {
    const entry = ops.postPaymentLedger(payment);
    emit(payment, idx, {
      title: payment.crossBorder ? '结汇入账 · 复式记账完成' : '复式记账完成',
      detail: payment.crossBorder
        ? `原币 ${payment.crossBorder.foreignCurrency} ${fmtCents(payment.crossBorder.foreignAmount)} 按 ${payment.crossBorder.fxRate} 结汇；借：渠道应收款 ¥${fmtCents(payment.amount)}；贷：商户待结算款 ¥${fmtCents(payment.netAmount)}、手续费收入 ¥${fmtCents(payment.fee)}`
        : `借：渠道应收款 ¥${fmtCents(payment.amount)}；贷：商户待结算款 ¥${fmtCents(payment.netAmount)}、手续费收入 ¥${fmtCents(payment.fee)}`,
      level: 'success',
      request: {
        bizType: 'PAYMENT',
        bizId: payment.id,
        outTradeNo: payment.outTradeNo,
        amount: fmtCents(payment.amount),
        fee: fmtCents(payment.fee),
        ...fxPayload(payment)
      },
      response: {
        entries: entry.entries,
        balanced: true,
        settleCurrency: 'CNY',
        settleDate: payment.settleDate
      },
      latencyMs: 64
    });
    const order = findOrder(payment);
    if (order) order.status = 'PAID';
    return 'next';
  }

  if (phase.key === 'merchant') {
    const attempts = payment.scenario === 'notify_retry' ? 2 : 1;
    const base = {
      outTradeNo: payment.outTradeNo,
      status: 'SUCCESS',
      amount: fmtCents(payment.amount),
      channelTradeNo: payment.channelTradeNo,
      paidAt: payment.paidAt
    };
    const signedPayload = makeSignedPayload(base);

    if (attempts === 2) {
      emit(payment, idx, {
        actor: '支付平台',
        target: '商户系统',
        title: '商户通知超时',
        detail: '第 1 次通知 3 秒未收到商户响应，进入退避重试',
        level: 'warn',
        request: {
          notifyUrl: 'https://merchant.example.com/api/pay/notify',
          payload: signedPayload.payload
        },
        response: { code: 'TIMEOUT', attempt: 1, nextRetryIn: '5s' },
        latencyMs: 3000
      });
    }

    emit(payment, idx, {
      actor: '支付平台',
      target: '商户系统',
      title: '商户通知成功',
      detail: `第 ${attempts} 次通知商户成功，商户订单状态更新为已支付`,
      level: 'success',
      request: {
        notifyUrl: 'https://merchant.example.com/api/pay/notify',
        payload: signedPayload.payload
      },
      response: { code: 'SUCCESS', attempt: attempts },
      signInfo: signedPayload.signInfo,
      latencyMs: 180
    });
    payment.notifyAttempts = attempts;

    if (payment.scenario === 'callback_dup') {
      emit(payment, idx, {
        actor: '支付渠道',
        target: '支付网关',
        title: '重复异步通知',
        detail: '渠道按重试策略重复推送同一笔支付结果',
        level: 'warn',
        response: payment.notifyPayload,
        kind: 'callback'
      });
      emit(payment, idx, {
        actor: '支付网关',
        target: '账务中心',
        title: '幂等拦截，未重复入账',
        detail: `幂等键 ${payment.idempotencyKey} 已处理，重复通知被丢弃，账户余额不变`,
        level: 'success',
        response: {
          dedup: true,
          idempotencyKey: payment.idempotencyKey,
          ledgerAction: 'NONE',
          duplicateLedgerEntries: 0
        },
        latencyMs: 6
      });
    }
    return 'next';
  }

  if (phase.key === 'done') {
    emit(payment, idx, {
      title: payment.crossBorder ? '跨境交易闭环完成' : '交易闭环完成',
      detail: payment.crossBorder
        ? `支付成功，${payment.settleCycle || 'T+2'}（${payment.settleDate}）进入对账与结算周期；国际收支申报已生成，跨境资金经 CIPS 清算`
        : `支付成功，${payment.settleCycle || 'T+1'}（${payment.settleDate}）进入对账与结算周期`,
      level: 'success',
      response: {
        paymentStatus: 'SUCCESS',
        settleCycle: payment.settleCycle || 'T+1',
        settleDate: payment.settleDate,
        ...(payment.crossBorder ? {
          clearingNetwork: 'CIPS',
          declaration: 'SUBMITTED',
          regulatory: 'SAFE 国际收支申报'
        } : {}),
        next: 'RECONCILIATION_AND_SETTLEMENT'
      },
      latencyMs: 10
    });
    interbank.ensurePaymentFlow(payment);
    return 'next';
  }

  return 'next';
}

function failPayment(payment, phaseIndex, status, reason) {
  payment.status = status;
  payment.terminated = true;
  payment.completed = false;
  payment.failedPhase = phaseIndex;
  payment.phaseIndex = PHASES.length;
  payment.waiting = null;
  payment.failReason = reason || null;
  const order = findOrder(payment);
  if (order) order.status = 'CLOSED';
}

function stepPayment(id) {
  const payment = findPayment(id);
  if (payment.waiting) {
    throw httpError(409, `流程暂停：${payment.waiting.title}`);
  }
  if (payment.phaseIndex >= PHASES.length) return detail(payment);

  const idx = payment.phaseIndex;
  const result = runPhase(payment, idx);

  if (result === 'terminate') {
    store.save();
    return detail(payment);
  }
  if (result === 'wait') {
    store.save();
    return detail(payment);
  }

  payment.phaseIndex = idx + 1;
  if (payment.phaseIndex >= PHASES.length) payment.completed = true;
  store.save();
  return detail(payment);
}

function doUserPay(payment) {
  const channel = channelOf(payment.channel);
  emit(payment, 6, {
    actor: '用户',
    target: channel.name,
    title: '用户确认支付',
    detail: `用户在 ${channel.name} 完成付款确认，渠道开始扣划资金`,
    level: 'success',
    request: {
      paymentId: payment.id,
      channelTradeNo: payment.channelTradeNo,
      scene: payment.crossBorder ? 'CROSS_BORDER_CARD' : 'QR_SCAN',
      buyer: payment.buyer,
      ...fxPayload(payment)
    },
    response: {
      channelStatus: 'SUCCESS',
      paidAmount: fmtCents(payment.amount),
      ...(payment.crossBorder ? { foreignPaidAmount: `${payment.crossBorder.foreignCurrency} ${fmtCents(payment.crossBorder.foreignAmount)}` } : {}),
      paidAt: nowIso()
    },
    latencyMs: 2300
  });
  payment.channelPaid = true;

  if (payment.scenario === 'insufficient_balance' && payment.channel === 'balance') {
    emit(payment, 6, {
      actor: '账户余额',
      target: '支付网关',
      title: '扣款失败：余额不足',
      detail: '余额渠道扣款失败，交易终止，订单关闭',
      level: 'error',
      response: {
        code: 'BALANCE_NOT_ENOUGH',
        available: '120.00',
        required: fmtCents(payment.amount)
      },
      latencyMs: 120
    });
    failPayment(payment, 6, 'FAILED', '账户余额不足');
    return 'terminate';
  }

  if (payment.scenario === 'callback_lost') {
    emit(payment, 6, {
      actor: '支付渠道',
      target: '支付网关',
      title: '渠道已扣款，但通知丢失',
      detail: '用户支付成功，平台在通知超时时间内未收到渠道异步通知（模拟掉单）',
      level: 'warn',
      response: {
        simulatedLoss: true,
        note: '需通过主动查单发现已支付交易并补单'
      },
      latencyMs: 0
    });
    payment.phaseIndex = 7;
    payment.waiting = {
      type: 'notify_lost',
      phase: 7,
      actions: ['query_channel', 'resend_notify'],
      title: '回调丢失：等待补偿',
      hint: '渠道侧已扣款，但平台没有收到通知。可主动查单补单，或模拟渠道重发通知。'
    };
    return 'wait';
  }

  payment.phaseIndex = 7;
  return 'next';
}

function doRiskReview(payment, action) {
  if (action === 'approve') {
    payment.riskDecision = 'REVIEW_APPROVED';
    payment.waiting = null;
    payment.phaseIndex = 4;
    emit(payment, 3, {
      actor: '风控运营',
      target: '支付网关',
      title: '人工复核通过',
      detail: '运营人员确认交易真实，风控放行，流程继续',
      level: 'success',
      request: { operator: 'risk_ops_01', decision: 'APPROVE' },
      response: { riskDecision: 'REVIEW_APPROVED', next: 'ROUTE' },
      latencyMs: 15000
    });
    return 'next';
  }
  payment.riskDecision = 'REVIEW_REJECTED';
  emit(payment, 3, {
    actor: '风控运营',
    target: '支付网关',
    title: '人工复核拒绝',
    detail: '运营人员判定交易存在风险，支付终止',
    level: 'error',
    request: { operator: 'risk_ops_01', decision: 'REJECT' },
    response: { riskDecision: 'REVIEW_REJECTED' },
    latencyMs: 12000
  });
  failPayment(payment, 3, 'FAILED', '人工复核拒绝');
  return 'terminate';
}

function doQuery(payment, reason) {
  const base = {
    outTradeNo: payment.outTradeNo,
    channelTradeNo: payment.channelTradeNo,
    channel: payment.channel,
    amount: fmtCents(payment.amount),
    status: 'SUCCESS',
    ...fxPayload(payment),
    paidAt: payment.paidAt || nowIso(),
    queriedAt: nowIso()
  };
  const signedPayload = makeSignedPayload(base);
  payment.notifyPayload = signedPayload.payload;
  payment.queryVerified = true;
  payment.status = 'PAYING';
  payment.waiting = null;
  payment.phaseIndex = 8;
  emit(payment, 8, {
    actor: '支付网关',
    target: channelOf(payment.channel).name,
    title: reason === 'NOTIFY_LOST' ? '主动查单成功，补单处理' : '主动查单成功，恢复交易',
    detail: `渠道返回交易状态 SUCCESS，平台以查单结果为准继续入账（查单结果权威）`,
    level: 'success',
    request: {
      outTradeNo: payment.outTradeNo,
      channelTradeNo: payment.channelTradeNo,
      queryType: 'TRADE_QUERY'
    },
    response: signedPayload.payload,
    signInfo: signedPayload.signInfo,
    latencyMs: 260,
    kind: 'query'
  });
  return 'next';
}

function doResendNotify(payment) {
  const base = {
    notifyId: rid('NT'),
    outTradeNo: payment.outTradeNo,
    channelTradeNo: payment.channelTradeNo,
    channel: payment.channel,
    amount: fmtCents(payment.amount),
    status: 'SUCCESS',
    ...fxPayload(payment),
    notifiedAt: nowIso()
  };
  const signedPayload = makeSignedPayload(base);
  payment.notifyPayload = signedPayload.payload;
  payment.waiting = null;
  payment.phaseIndex = 8;
  emit(payment, 7, {
    actor: '支付渠道',
    target: '支付网关',
    title: '渠道重发异步通知',
    detail: '模拟渠道按通知重试策略补发支付结果',
    level: 'info',
    response: signedPayload.payload,
    signInfo: signedPayload.signInfo,
    latencyMs: 820,
    kind: 'callback'
  });
  return 'next';
}

function applyAction(id, action) {
  const payment = findPayment(id);
  const waiting = payment.waiting;
  if (!waiting) throw httpError(409, '当前没有待处理动作');
  if (!waiting.actions.includes(action)) throw httpError(400, '不支持的操作');

  let result = 'next';
  if (waiting.type === 'user_pay' && action === 'confirm_pay') {
    result = doUserPay(payment);
  } else if (waiting.type === 'risk_review') {
    result = doRiskReview(payment, action);
  } else if (waiting.type === 'notify_lost' && action === 'query_channel') {
    result = doQuery(payment, 'NOTIFY_LOST');
  } else if (waiting.type === 'notify_lost' && action === 'resend_notify') {
    result = doResendNotify(payment);
  } else if (waiting.type === 'exception' && action === 'query_channel') {
    result = doQuery(payment, 'EXCEPTION');
  }

  if (payment.waiting === waiting && result !== 'terminate') {
    payment.waiting = null;
  }
  if (payment.waiting === null && payment.phaseIndex >= 9 && payment.phaseIndex < PHASES.length && payment.status === 'SUCCESS') {
    // 保持原有相序，无需额外处理
  }
  store.save();
  return detail(payment);
}

function closePayment(id) {
  const payment = findPayment(id);
  if (!['INIT', 'PAYING'].includes(payment.status)) {
    throw httpError(400, '只有待支付/支付中的交易可以关单');
  }
  if (payment.channelPaid) throw httpError(409, '渠道已扣款，不能直接关单，请先查单');
  const idx = Math.min(payment.phaseIndex, 6);
  emit(payment, idx, {
    actor: '交易关单任务',
    target: '支付网关',
    title: '支付超时关单',
    detail: '超过 15 分钟未完成支付，系统关闭订单并撤销渠道预下单',
    level: 'warn',
    request: { outTradeNo: payment.outTradeNo, timeout: '15m' },
    response: { orderStatus: 'CLOSED', paymentStatus: 'CLOSED', channelRevoked: true },
    latencyMs: 5
  });
  payment.status = 'CLOSED';
  payment.terminated = true;
  payment.failedPhase = idx;
  payment.phaseIndex = PHASES.length;
  payment.waiting = null;
  payment.failReason = '支付超时关单';
  const order = findOrder(payment);
  if (order) order.status = 'CLOSED';
  store.save();
  return detail(payment);
}

function renotify(id) {
  const payment = findPayment(id);
  if (payment.status !== 'SUCCESS') throw httpError(400, '只有支付成功的交易才能演示重复回调');
  const payload = payment.notifyPayload || makeSignedPayload({
    outTradeNo: payment.outTradeNo,
    amount: fmtCents(payment.amount),
    status: 'SUCCESS'
  }).payload;
  emit(payment, 8, {
    actor: '支付渠道',
    target: '支付网关',
    title: '重复异步通知',
    detail: '渠道重复推送同一笔支付结果，用于验证幂等',
    level: 'warn',
    response: payload,
    kind: 'callback'
  });
  emit(payment, 8, {
    actor: '支付网关',
    target: '账务中心',
    title: '幂等拦截，未重复入账',
    detail: `幂等键 ${payment.idempotencyKey} 已处理，本次通知被丢弃，账务无新增分录`,
    level: 'success',
    response: {
      dedup: true,
      idempotencyKey: payment.idempotencyKey,
      ledgerAction: 'NONE',
      duplicateLedgerEntries: 0
    },
    latencyMs: 6
  });
  payment.renotifyCount = (payment.renotifyCount || 0) + 1;
  store.save();
  return detail(payment);
}

function queryPayment(id) {
  const payment = findPayment(id);
  if (payment.waiting && ['notify_lost', 'exception'].includes(payment.waiting.type)) {
    return applyAction(id, 'query_channel');
  }
  if (payment.status === 'PAYING') {
    emit(payment, Math.min(payment.phaseIndex, 8), {
      actor: '支付网关',
      target: channelOf(payment.channel).name,
      title: '主动查单：渠道未支付',
      detail: '渠道返回交易未支付，继续等待用户付款或执行超时关单',
      level: 'warn',
      request: {
        outTradeNo: payment.outTradeNo,
        channelTradeNo: payment.channelTradeNo,
        queryType: 'TRADE_QUERY'
      },
      response: { tradeStatus: 'NOTPAY', note: '用户尚未完成付款' },
      latencyMs: 240
    });
    store.save();
    return detail(payment);
  }
  throw httpError(400, '当前交易状态不支持主动查单');
}

function createCompensationRefund(payment, reason) {
  const refund = {
    id: rid('RFD'),
    refundNo: rid('RF'),
    paymentId: payment.id,
    outTradeNo: payment.outTradeNo,
    merchantId: payment.merchantId,
    merchantName: payment.merchantName,
    subject: payment.subject,
    channel: payment.channel,
    channelName: payment.channelName,
    amount: payment.amount,
    feeAmount: payment.fee || 0,
    reason,
    source: 'COMPENSATION',
    status: 'SUCCESS',
    createdAt: nowIso(),
    finishedAt: nowIso(),
    failReason: null,
    events: []
  };
  const entry = ops.postRefundLedger(refund, payment, {
    reverseFee: true,
    feeAmount: payment.fee || 0
  });
  refund.ledgerEntries = entry.entries;
  refund.events.push({
    ts: nowIso(),
    title: '补偿退款成功',
    detail: '渠道已原路退回全部资金，手续费一并回退，账务轧平',
    level: 'success',
    request: { paymentId: payment.id, amount: fmtCents(payment.amount), source: 'COMPENSATION' },
    response: { channelRefundNo: rid('CRF'), status: 'SUCCESS', feeReversed: fmtCents(payment.fee || 0) }
  });
  store.get().refunds.unshift(refund);
  return refund;
}

function lateNotify(id) {
  const payment = findPayment(id);
  if (payment.status !== 'CLOSED') throw httpError(400, '只有已关闭的交易可以演示迟到回调');
  if (payment.compensated) throw httpError(409, '该笔交易已完成补偿处理');
  const base = {
    outTradeNo: payment.outTradeNo,
    channelTradeNo: payment.channelTradeNo || rid('CH'),
    channel: payment.channel,
    amount: fmtCents(payment.amount),
    status: 'SUCCESS',
    notifiedAt: nowIso()
  };
  const signedPayload = makeSignedPayload(base);
  payment.notifyPayload = signedPayload.payload;
  payment.channelPaid = true;
  payment.paidAt = nowIso();
  payment.settleDate = addDays(dateStr(new Date(payment.paidAt)), 1);
  payment.fee = feeFor(payment.amount, payment.channel);
  payment.netAmount = payment.amount - payment.fee;

  emit(payment, 7, {
    actor: '支付渠道',
    target: '支付网关',
    title: '迟到回调：渠道已扣款',
    detail: '订单关闭后收到渠道成功通知。渠道资金已扣划，平台需要补单并原路退款',
    level: 'error',
    response: signedPayload.payload,
    signInfo: signedPayload.signInfo,
    kind: 'callback'
  });

  ops.postPaymentLedger(payment);
  emit(payment, 8, {
    actor: '支付网关',
    target: '账务中心',
    title: '异常补单入账',
    detail: '以渠道权威结果补记支付并完成入账，随后联动原路全额退款',
    level: 'warn',
    request: { outTradeNo: payment.outTradeNo, amount: fmtCents(payment.amount) },
    response: { supplemented: true, then: 'COMPENSATION_REFUND' },
    latencyMs: 40
  });

  const refund = createCompensationRefund(payment, '超时关单后渠道已扣款，系统自动原路退款');
  payment.refundedAmount = payment.amount;
  payment.refundStatus = 'FULL';
  payment.compensated = true;
  payment.compensationRefundId = refund.id;
  payment.phaseIndex = PHASES.length;

  emit(payment, 11, {
    actor: '退款中心',
    target: '支付渠道',
    title: '补偿退款完成',
    detail: `已原路退回 ¥${fmtCents(payment.amount)}，手续费 ¥${fmtCents(payment.fee)} 同步回退，账务余额归零`,
    level: 'success',
    request: { refundNo: refund.refundNo, amount: fmtCents(payment.amount) },
    response: { refundStatus: 'SUCCESS', ledgerBalanced: true },
    latencyMs: 620
  });
  store.save();
  return detail(payment);
}

function createRefund(body) {
  const payment = findPayment(body.paymentId);
  if (payment.status !== 'SUCCESS') throw httpError(400, '只有支付成功的交易可以发起退款');
  const amount = toCents(body.amount);
  if (!Number.isFinite(amount) || amount < 1) throw httpError(400, '退款金额不合法');
  const refundable = payment.amount - (payment.refundedAmount || 0);
  if (amount > refundable) throw httpError(400, `退款金额超过可退余额（可退 ¥${fmtCents(refundable)}）`);

  const refundNo = rid('RF');
  const refund = {
    id: rid('RFD'),
    refundNo,
    paymentId: payment.id,
    outTradeNo: payment.outTradeNo,
    merchantId: payment.merchantId,
    merchantName: payment.merchantName,
    subject: payment.subject,
    channel: payment.channel,
    channelName: payment.channelName,
    amount,
    feeAmount: 0,
    reason: String(body.reason || '用户申请退款').slice(0, 80),
    source: 'MERCHANT',
    status: 'PROCESSING',
    createdAt: nowIso(),
    finishedAt: null,
    failReason: null,
    events: [{
      ts: nowIso(),
      title: '退款申请受理',
      detail: `商户发起退款，金额 ¥${fmtCents(amount)}，原路退回 ${payment.channelName}`,
      level: 'info',
      request: { paymentId: payment.id, amount: fmtCents(amount), reason: body.reason || '用户申请退款' },
      response: { refundNo, status: 'PROCESSING' }
    }]
  };
  store.get().refunds.unshift(refund);
  store.save();
  processRefund(refund, payment, Boolean(body.simulateFail));
  return { refund: detailRefund(refund), payment: detail(payment) };
}

function processRefund(refund, payment, simulateFail) {
  if (simulateFail) {
    refund.status = 'FAILED';
    refund.failReason = '渠道退款接口超时';
    refund.events.push({
      ts: nowIso(),
      title: '渠道退款失败',
      detail: '渠道退款接口响应超时，退款未完成，可稍后重试',
      level: 'error',
      request: { refundNo: refund.refundNo, amount: fmtCents(refund.amount) },
      response: { code: 'REFUND_TIMEOUT', message: '渠道退款接口超时' }
    });
    store.save();
    return refund;
  }

  refund.status = 'SUCCESS';
  refund.finishedAt = nowIso();
  payment.refundedAmount = (payment.refundedAmount || 0) + refund.amount;
  payment.refundStatus = payment.refundedAmount >= payment.amount ? 'FULL' : 'PARTIAL';
  const entry = ops.postRefundLedger(refund, payment);
  refund.ledgerEntries = entry.entries;
  refund.events.push({
    ts: nowIso(),
    title: '渠道退款成功',
    detail: '渠道已原路退回资金，退款状态推进为 SUCCESS',
    level: 'success',
    request: { refundNo: refund.refundNo, amount: fmtCents(refund.amount) },
    response: { channelRefundNo: rid('CRF'), status: 'SUCCESS', finishTime: refund.finishedAt }
  });
  refund.events.push({
    ts: nowIso(),
    title: '账务冲销完成',
    detail: payment.settledBatchId
      ? '借：商户待结算款 / 贷：渠道应收款；该笔已结算，差额从商户后续结算款中扣回'
      : '借：商户待结算款 / 贷：渠道应收款；手续费不退还，商户待结算款可能为负',
    level: 'success',
    request: { bizType: 'REFUND', bizId: refund.id },
    response: { entries: entry.entries, balanced: true, feeReversed: false }
  });
  store.save();
  return refund;
}

function retryRefund(id) {
  const refund = store.get().refunds.find((item) => item.id === id);
  if (!refund) throw httpError(404, '退款单不存在');
  if (refund.status !== 'FAILED') throw httpError(409, '只有退款失败的记录可以重试');
  const payment = findPayment(refund.paymentId);
  processRefund(refund, payment, false);
  return detailRefund(refund);
}

function detailRefund(refund) {
  return {
    ...refund,
    channelName: channelOf(refund.channel).name
  };
}

function summarize(payment) {
  return {
    id: payment.id,
    outTradeNo: payment.outTradeNo,
    subject: payment.subject,
    amount: payment.amount,
    currency: payment.currency || 'CNY',
    channel: payment.channel,
    channelName: channelOf(payment.channel).name,
    status: payment.status,
    scenario: payment.scenario,
    buyer: payment.buyer,
    settleCycle: payment.settleCycle || channelOf(payment.channel).settle,
    crossBorder: payment.crossBorder || null,
    fee: payment.fee,
    netAmount: payment.netAmount,
    refundedAmount: payment.refundedAmount || 0,
    refundStatus: payment.refundStatus || 'NONE',
    createdAt: payment.createdAt,
    paidAt: payment.paidAt,
    settleDate: payment.settleDate,
    phaseIndex: payment.phaseIndex,
    completed: payment.completed,
    terminated: payment.terminated,
    compensated: Boolean(payment.compensated),
    channelPaid: Boolean(payment.channelPaid),
    failReason: payment.failReason || null,
    renotifyCount: payment.renotifyCount || 0,
    waiting: payment.waiting ? { type: payment.waiting.type, title: payment.waiting.title } : null
  };
}

function detail(payment) {
  return {
    payment,
    order: findOrder(payment) || null,
    channel: channelOf(payment.channel),
    ledger: ops.getPaymentLedger(payment.id),
    refunds: store.get().refunds.filter((refund) => refund.paymentId === payment.id).map(detailRefund),
    clearingFlow: interbank.flowSummaryForPayment(payment.id)
  };
}

function accountingDetail(id) {
  const payment = findPayment(id);
  if (payment.status === 'SUCCESS') {
    interbank.ensurePaymentFlow(payment);
  }
  const flow = interbank.flowDetailForPayment(payment.id);
  return {
    payment: summarize(payment),
    platformLedger: ops.getPaymentLedger(payment.id),
    flow
  };
}

const STAGE_STATE_TEXT = {
  done: '已完成',
  active: '进行中',
  waiting: '等待操作',
  failed: '已失败',
  skipped: '未执行',
  pending: '待执行'
};

function stageState(payment, idx) {
  if (payment.terminated && payment.failedPhase === idx) return 'failed';
  if (payment.terminated && !payment.compensated && payment.failedPhase !== null && idx > payment.failedPhase) return 'skipped';
  if (payment.completed || idx < payment.phaseIndex) return 'done';
  if (idx === payment.phaseIndex) return payment.waiting ? 'waiting' : 'active';
  return 'pending';
}

function decisionLabel(decision) {
  return { PASS: '通过', REVIEW: '人工复核', BLOCK: '拦截' }[decision] || decision || '—';
}

function lastResponse(events) {
  return events.length ? (events[events.length - 1].response || {}) : {};
}

function lastSignInfo(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].signInfo) return events[i].signInfo;
  }
  return null;
}

function stageRows(payment, phase, events, ctx) {
  const rows = [];
  const push = (label, value, extra = {}) => {
    if (value === null || value === undefined || value === '') return;
    rows.push({ label, value: String(value), ...extra });
  };
  const res = lastResponse(events);
  const signInfo = lastSignInfo(events);
  const channel = ctx.channel;
  const cb = payment.crossBorder;
  const pushFx = () => {
    if (!cb) return;
    push('原币金额', `${cb.foreignCurrency} ${fmtCents(cb.foreignAmount)}`);
    push('结算汇率', `1 ${cb.foreignCurrency} = ${cb.fxRate} CNY`);
  };

  if (phase.key === 'order') {
    push('业务订单号', payment.outTradeNo, { mono: true });
    push('商户', payment.merchantName);
    push('商品', payment.subject);
    push('订单金额', `¥${fmtCents(payment.amount)}`);
    pushFx();
    push('币种', payment.currency);
    push('订单状态', ctx.order ? ctx.order.status : 'CREATED', { mono: true });
    push('创建时间', payment.createdAt, { mono: true });
  } else if (phase.key === 'cashier') {
    push('收银台会话', res.sessionId, { mono: true });
    push('支付场景', cb ? 'CROSS_BORDER_CARD' : 'PC_QR');
    push('可选渠道', `${Object.keys(CHANNELS).length} 种`);
    push('用户选择', channel.name);
    pushFx();
    push('会话有效期', '900 秒');
    push('优惠券', res.coupon ? '已使用' : '未使用');
  } else if (phase.key === 'gateway') {
    push('支付单号', payment.id, { mono: true });
    push('应用 AppID', 'PAYLAB_APP_01', { mono: true });
    push('商户订单号', payment.outTradeNo, { mono: true });
    push('幂等键', payment.idempotencyKey, { mono: true });
    pushFx();
    push('商户验签', signInfo ? signInfo.verifyResult || 'VALID' : 'VALID');
    push('支付单状态', payment.status, { mono: true });
  } else if (phase.key === 'risk') {
    push('风险决策', decisionLabel(payment.riskDecision), {
      tone: payment.riskDecision === 'PASS' ? 'green' : payment.riskDecision === 'REVIEW' ? 'amber' : 'red'
    });
    push('风险评分', payment.riskScore === null || payment.riskScore === undefined ? '—' : `${payment.riskScore} / 100`);
    push('命中规则', payment.riskHits && payment.riskHits.length ? payment.riskHits.map((hit) => hit.ruleName).join('、') : '无');
    push('买家标识', payment.buyer, { mono: true });
    if (cb) {
      push('跨境标识', '是 · 境外卡收单', { tone: 'blue' });
      push('国际收支申报', '支付成功后报送 SAFE', { tone: 'amber' });
    }
    push('规则版本', 'v2.6', { mono: true });
  } else if (phase.key === 'route') {
    push('主选渠道', res.selectedName || channel.name);
    push('备用通道', res.fallback ? channelOf(res.fallback).name : '—');
    push('路由策略', res.reason || '费率与成功率综合最优');
    push('主通道费率', `${(channel.feeRate * 100).toFixed(2)}%`);
    push('主通道结算', channel.settle, { mono: true });
    if (cb) push('跨境清算网络', 'CIPS 人民币跨境支付系统', { mono: true });
  } else if (phase.key === 'precreate') {
    const degraded = events.some((event) => event.title.includes('降级'));
    push('渠道交易号', payment.channelTradeNo, { mono: true });
    push('受理渠道', channel.name);
    push('预下单结果', degraded ? '主通道超时，已降级' : '受理成功', { tone: degraded ? 'amber' : 'green' });
    pushFx();
    push('付款二维码', res.payUrl, { mono: true });
    push('过期时间', res.expireAt, { mono: true });
    push('渠道费率', `${(channel.feeRate * 100).toFixed(2)}%`);
  } else if (phase.key === 'userpay') {
    push('渠道交易号', payment.channelTradeNo, { mono: true });
    push('实付金额', `¥${fmtCents(payment.amount)}`);
    if (cb) push('原币实付', `${cb.foreignCurrency} ${fmtCents(cb.foreignAmount)}`);
    push('付款方', payment.buyer, { mono: true });
    push('付款时间', payment.paidAt || res.paidAt, { mono: true });
    push('渠道扣款', payment.channelPaid ? '已扣款' : '未确认', { tone: payment.channelPaid ? 'green' : 'gray' });
  } else if (phase.key === 'notify') {
    push('通知单号', res.notifyId, { mono: true });
    push('通知金额', res.amount ? `¥${res.amount}` : '—');
    if (cb) {
      push('通知原币', res.foreignAmount ? `${res.foreignCurrency} ${res.foreignAmount}` : '—');
      push('结算汇率', res.fxRate || cb.fxRate);
    }
    push('通知状态', res.status || '—', { mono: true });
    push('验签结果', signInfo ? signInfo.verifyResult : '—', {
      tone: signInfo && signInfo.verifyResult === 'INVALID' ? 'red' : 'green'
    });
    push('签名算法', signInfo ? signInfo.algorithm : 'HMAC-SHA256');
  } else if (phase.key === 'verify') {
    push('验签结果', signInfo ? signInfo.verifyResult : 'VALID', {
      tone: signInfo && signInfo.verifyResult === 'INVALID' ? 'red' : 'green'
    });
    push('金额核对', res.amountCheck === 'MATCHED' ? '一致' : (res.amountCheck || '—'));
    if (cb) {
      push('结汇核对', res.fxCheck === 'MATCHED' ? '汇率与原币金额一致' : '—', { tone: res.fxCheck === 'MATCHED' ? 'green' : 'gray' });
      push('结汇人民币', `¥${fmtCents(payment.amount)}`);
    }
    push('幂等处理', res.idempotency === 'FIRST_PROCESS' ? '首次处理' : (res.idempotency || '—'));
    push('状态迁移', res.from && res.to ? `${res.from} → ${res.to}` : '—', { mono: true });
    push('支付时间', payment.paidAt, { mono: true });
    push('结算日', payment.settleDate, { mono: true });
  } else if (phase.key === 'ledger') {
    const entry = ctx.ledger[0];
    const estFee = payment.fee || feeFor(payment.amount, payment.channel);
    const estNet = payment.netAmount || payment.amount - estFee;
    push('记账凭证号', entry ? entry.id : '—', { mono: true });
    push('凭证标题', entry ? entry.title : '支付入账');
    push('记账金额', `¥${fmtCents(payment.amount)}`);
    pushFx();
    push('手续费', `¥${fmtCents(estFee)}`);
    push('商户待结算', `¥${fmtCents(estNet)}`);
    push('结算日', payment.settleDate, { mono: true });
    push('分录条数', entry ? `${entry.entries.length} 条` : '待入账');
  } else if (phase.key === 'merchant') {
    const notifyEvent = events.filter((event) => event.title.includes('商户通知')).pop();
    push('通知地址', 'https://merchant.example.com/api/pay/notify', { mono: true });
    push('通知次数', `${payment.notifyAttempts || 0} 次`);
    push('商户响应', notifyEvent && notifyEvent.response ? notifyEvent.response.code : '—', { mono: true });
    push('签名算法', 'HMAC-SHA256');
    push('重发次数', `${payment.renotifyCount || 0} 次`);
  } else if (phase.key === 'done') {
    push('支付终态', payment.status, { mono: true, tone: payment.status === 'SUCCESS' ? 'green' : 'amber' });
    push('结算周期', payment.settleCycle || channel.settle, { mono: true });
    push('结算日', payment.settleDate, { mono: true });
    push('后续动作', `${payment.settleCycle || 'T+1'} 对账 → 净额结算`);
    if (cb) {
      push('跨境清算网络', 'CIPS', { mono: true });
      push('国际收支申报', payment.status === 'SUCCESS' ? '已报送 SAFE' : '支付成功后报送', {
        tone: payment.status === 'SUCCESS' ? 'green' : 'gray'
      });
    }
    push('跨机构链路', ctx.flow ? ctx.flow.no : '未生成', { mono: true });
    push('已退款', payment.refundedAmount ? `¥${fmtCents(payment.refundedAmount)}` : '¥0.00');
  }
  return rows;
}

function stageAccounting(payment, phase, events, ctx) {
  const channel = ctx.channel;
  const fee = payment.fee || feeFor(payment.amount, payment.channel);
  const net = payment.netAmount || payment.amount - fee;
  const cb = payment.crossBorder;
  const fxFormulas = cb ? [
    `原币金额 = ${cb.foreignCurrency} ${fmtCents(cb.foreignAmount)}`,
    `结汇人民币 = ${fmtCents(cb.foreignAmount)} × ${cb.fxRate} = ¥${fmtCents(payment.amount)}（四舍五入到分）`,
    `跨境通道费率 ${(channel.feeRate * 100).toFixed(2)}%，其中含 CIPS 网络清算成本`
  ] : [];
  const baseFormulas = [
    `交易金额 = ¥${fmtCents(payment.amount)}`,
    `手续费 = ¥${fmtCents(payment.amount)} × ${(channel.feeRate * 100).toFixed(2)}% = ¥${fmtCents(fee)}`,
    `商户净额 = 交易金额 − 手续费 = ¥${fmtCents(net)}`,
    ...fxFormulas
  ];

  if (phase.key === 'ledger' && ctx.ledger.length) {
    const entry = ctx.ledger[0];
    const debit = entry.entries.reduce((sum, line) => sum + line.debit, 0);
    const credit = entry.entries.reduce((sum, line) => sum + line.credit, 0);
    return {
      kind: 'ENTRY',
      title: cb ? '结汇入账 · 支付入账分录' : '支付入账分录',
      note: cb
        ? '跨境收单以人民币入账：借：渠道应收款（跨境清算应收，资产增加）；贷：商户待结算款（负债增加）、手续费收入（收入增加）。原币仅用于结汇折算，不再单独记账。'
        : '借：渠道应收款（资产增加）；贷：商户待结算款（负债增加）、手续费收入（收入增加）。',
      formulas: [
        ...baseFormulas,
        `借方合计 ${fmtCents(debit)} = 贷方合计 ${fmtCents(credit)}，借贷平衡`
      ],
      entries: entry.entries,
      totals: { debit, credit, balanced: debit === credit },
      entryId: entry.id,
      settleDate: entry.settleDate
    };
  }

  if (phase.key === 'done') {
    const flow = ctx.flow;
    return {
      kind: 'FLOW',
      title: '跨机构资金链路',
      note: flow
        ? (cb
          ? '跨境资金路径：境外收单行扣款 → CIPS 转接轧差 → 央行准备金账户最终清算 → 支付机构结汇入账 → 商户开户行结算。'
          : '平台入账已完成，跨机构资金按发卡行 → 清算机构 → 央行 → 收款行的顺序逐环节记账，全部环节完成后链路闭环。')
        : '支付入账发生在「账务入账」阶段，本阶段只推进终态并触发对账与结算。',
      formulas: flow
        ? [
          `收款方净额 = 交易金额 − 总手续费 = ¥${fmtCents(flow.payeeNet)}`,
          `网络清算费 ¥${fmtCents(flow.networkFee)} · 支付机构收入 ¥${fmtCents(flow.platformFee)}`,
          `链路环节 ${flow.legDone} / ${flow.legTotal} 已记账`,
          ...fxFormulas
        ]
        : baseFormulas,
      entries: [],
      totals: null,
      flow
    };
  }

  return {
    kind: 'NONE',
    title: '本阶段不产生复式分录',
    note: phase.key === 'verify'
      ? '验签与幂等只负责确认交易可信与唯一，资金在下一阶段「账务入账」才正式落账。'
      : '该阶段属于信息流（报文、校验、通知、路由），不触碰账户余额；真正的资金记账发生在「账务入账」阶段。',
    formulas: baseFormulas,
    entries: [],
    totals: null
  };
}

function stageDetail(id, index) {
  const payment = findPayment(id);
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= PHASES.length) {
    throw httpError(400, '阶段序号不合法');
  }
  const phase = PHASES[idx];
  const state = stageState(payment, idx);
  const events = payment.events.filter((event) => event.phaseIndex === idx);
  const order = findOrder(payment) || null;
  const channel = channelOf(payment.channel);
  const ledger = ops.getPaymentLedger(payment.id);
  const flow = interbank.flowSummaryForPayment(payment.id);
  const ctx = { order, channel, ledger, flow };

  const links = [{ label: '返回演练台', href: '#/payment' }];
  if (phase.key === 'risk') links.push({ label: '风控规则与试算', href: '#/risk' });
  if (phase.key === 'ledger') links.push({ label: '清结算试算平衡', href: '#/settlement' });
  if (phase.key === 'done') links.push({ label: '对账中心', href: '#/reconcile' }, { label: '清算网络', href: '#/clearing' });

  return {
    payment: summarize(payment),
    order: order ? {
      id: order.id,
      outTradeNo: order.outTradeNo,
      subject: order.subject,
      amount: order.amount,
      status: order.status,
      merchantName: order.merchantName,
      createdAt: order.createdAt
    } : null,
    channel: { code: channel.code, name: channel.name, feeRate: channel.feeRate, settle: channel.settle },
    phase: {
      index: idx,
      total: PHASES.length,
      key: phase.key,
      name: phase.name,
      actor: phase.actor,
      target: phase.target,
      desc: phase.desc,
      teaching: phase.teaching
    },
    status: {
      state,
      text: STAGE_STATE_TEXT[state],
      reached: events.length > 0,
      eventCount: events.length,
      latencyMs: events.reduce((sum, event) => sum + (event.latencyMs || 0), 0)
    },
    phaseStates: PHASES.map((_, i) => stageState(payment, i)),
    events,
    data: stageRows(payment, phase, events, ctx),
    accounting: stageAccounting(payment, phase, events, ctx),
    links,
    prev: idx > 0 ? idx - 1 : null,
    next: idx < PHASES.length - 1 ? idx + 1 : null
  };
}

function listPayments(limit = 50) {
  return store.get().payments
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map(summarize);
}

function listRefunds(limit = 60) {
  return store.get().refunds.slice(0, limit).map((refund) => ({
    ...detailRefund(refund),
    subject: refund.subject || (store.get().payments.find((payment) => payment.id === refund.paymentId) || {}).subject
  }));
}

function summary() {
  const state = store.get();
  const today = dateStr(new Date());
  const todays = state.payments.filter((payment) => dateStr(new Date(payment.createdAt)) === today);
  const success = todays.filter((payment) => payment.status === 'SUCCESS');
  const processed = todays.filter((payment) => ['SUCCESS', 'FAILED', 'CLOSED', 'EXCEPTION'].includes(payment.status));
  const gmv = success.reduce((sum, payment) => sum + payment.amount, 0);
  const refundToday = state.refunds
    .filter((refund) => refund.status === 'SUCCESS' && dateStr(new Date(refund.createdAt)) === today)
    .reduce((sum, refund) => sum + refund.amount, 0);
  const pendingBatches = state.batches.filter((batch) => batch.status === 'PENDING');
  return {
    kpis: {
      gmv,
      count: todays.length,
      successCount: success.length,
      successRate: processed.length ? (success.length / processed.length) * 100 : 0,
      refundToday,
      pendingSettlement: pendingBatches.reduce((sum, batch) => sum + batch.netAmount, 0),
      pendingBatchCount: pendingBatches.length
    },
    recent: state.payments
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 8)
      .map(summarize),
    counts: {
      payments: state.payments.length,
      refunds: state.refunds.length,
      bills: state.bills.length,
      reconRuns: state.reconRuns.length
    },
    channels: Object.values(CHANNELS)
  };
}

function updateRule(id, body) {
  const rule = store.get().risks.rules.find((item) => item.id === id);
  if (!rule) throw httpError(404, '风控规则不存在');
  if (body.enabled !== undefined) rule.enabled = Boolean(body.enabled);
  if (body.params && typeof body.params === 'object') {
    for (const [key, value] of Object.entries(body.params)) {
      if (key === 'users') {
        rule.params.users = String(value).split(',').map((item) => item.trim()).filter(Boolean);
      } else if (key.endsWith('Amount')) {
        const cents = toCents(value);
        if (Number.isFinite(cents)) rule.params[key] = cents;
      } else {
        const num = Number(value);
        if (Number.isFinite(num)) rule.params[key] = num;
      }
    }
  }
  store.save();
  return rule;
}

function riskCheck(input) {
  const amount = toCents(input.amount);
  if (!Number.isFinite(amount) || amount < 1) throw httpError(400, '试算金额不合法');
  const result = evaluateRisk({
    amount,
    buyer: String(input.buyer || 'U10001'),
    channel: input.channel || 'alipay',
    hour: input.hour,
    isNewDevice: Boolean(input.isNewDevice)
  });
  const check = {
    id: rid('RC'),
    paymentId: null,
    outTradeNo: '风控试算',
    buyer: String(input.buyer || 'U10001'),
    amount,
    hour: Number(input.hour),
    isNewDevice: Boolean(input.isNewDevice),
    decision: result.decision,
    score: result.score,
    hits: result.hits,
    at: nowIso()
  };
  store.get().risks.checks.unshift(check);
  if (store.get().risks.checks.length > 120) store.get().risks.checks.length = 120;
  store.save();
  return check;
}

function riskView() {
  return {
    rules: store.get().risks.rules,
    checks: store.get().risks.checks.slice(0, 20)
  };
}

module.exports = {
  CHANNELS,
  PHASES,
  SCENARIOS,
  feeFor,
  channelOf,
  evaluateRisk,
  createPayment,
  stepPayment,
  applyAction,
  closePayment,
  renotify,
  queryPayment,
  lateNotify,
  createRefund,
  retryRefund,
  listPayments,
  listRefunds,
  detail,
  accountingDetail,
  stageDetail,
  summarize,
  summary,
  riskCheck,
  riskView,
  updateRule,
  findPayment
};
