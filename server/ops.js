'use strict';

const store = require('./store');
const { rid, dateStr, addDays, fmtCents, httpError } = require('./util');

const ACCOUNTS = {
  CHANNEL_RECEIVABLE: { name: '渠道应收款', type: 'ASSET', desc: '渠道侧尚未结算给平台的资金' },
  MERCHANT_PAYABLE: { name: '商户待结算款', type: 'LIABILITY', desc: '平台应付给商户的净额' },
  FEE_INCOME: { name: '手续费收入', type: 'INCOME', desc: '平台收取的交易手续费' },
  BANK: { name: '银行存款', type: 'ASSET', desc: '实际结算出款的银行账户' }
};

function nowIso() {
  return new Date().toISOString();
}

function accountLine(account, debit, credit) {
  return {
    account,
    accountName: ACCOUNTS[account].name,
    debit: Math.round(debit || 0),
    credit: Math.round(credit || 0)
  };
}

function ledgerExists(bizType, bizId) {
  return store.get().ledger.some((entry) => entry.bizType === bizType && entry.bizId === bizId);
}

function postPaymentLedger(payment, ts) {
  if (ledgerExists('PAYMENT', payment.id)) {
    return store.get().ledger.find((entry) => entry.bizType === 'PAYMENT' && entry.bizId === payment.id);
  }
  const fee = payment.fee || 0;
  const entry = {
    id: rid('LG'),
    bizType: 'PAYMENT',
    bizId: payment.id,
    paymentId: payment.id,
    refundId: null,
    merchantId: payment.merchantId,
    outTradeNo: payment.outTradeNo,
    title: '支付入账',
    amount: payment.amount,
    fee,
    settleDate: payment.settleDate,
    createdAt: ts || payment.paidAt || nowIso(),
    entries: [
      accountLine('CHANNEL_RECEIVABLE', payment.amount, 0),
      accountLine('MERCHANT_PAYABLE', 0, payment.amount - fee),
      accountLine('FEE_INCOME', 0, fee)
    ]
  };
  store.get().ledger.unshift(entry);
  store.save();
  return entry;
}

function postRefundLedger(refund, payment, options = {}) {
  if (ledgerExists('REFUND', refund.id)) {
    return store.get().ledger.find((entry) => entry.bizType === 'REFUND' && entry.bizId === refund.id);
  }
  const entries = [
    accountLine('MERCHANT_PAYABLE', refund.amount, 0),
    accountLine('CHANNEL_RECEIVABLE', 0, refund.amount)
  ];
  if (options.reverseFee) {
    entries.push(accountLine('FEE_INCOME', options.feeAmount || refund.feeAmount || 0, 0));
    entries.push(accountLine('MERCHANT_PAYABLE', 0, options.feeAmount || refund.feeAmount || 0));
  }
  const entry = {
    id: rid('LG'),
    bizType: 'REFUND',
    bizId: refund.id,
    paymentId: payment.id,
    refundId: refund.id,
    merchantId: payment.merchantId,
    outTradeNo: payment.outTradeNo,
    title: options.reverseFee ? '补偿退款冲销（含手续费回退）' : '退款冲销',
    amount: refund.amount,
    fee: 0,
    settleDate: payment.settleDate,
    createdAt: options.ts || refund.finishedAt || nowIso(),
    entries
  };
  store.get().ledger.unshift(entry);
  store.save();
  return entry;
}

function postSettlementLedger(batch, ts) {
  if (ledgerExists('SETTLEMENT', batch.id)) {
    return store.get().ledger.find((entry) => entry.bizType === 'SETTLEMENT' && entry.bizId === batch.id);
  }
  const net = batch.netAmount;
  const entries = net >= 0
    ? [accountLine('MERCHANT_PAYABLE', net, 0), accountLine('BANK', 0, net)]
    : [accountLine('BANK', Math.abs(net), 0), accountLine('MERCHANT_PAYABLE', 0, Math.abs(net))];
  const entry = {
    id: rid('LG'),
    bizType: 'SETTLEMENT',
    bizId: batch.id,
    paymentId: null,
    refundId: null,
    merchantId: batch.merchantId,
    outTradeNo: null,
    title: '结算出款',
    amount: net,
    fee: 0,
    settleDate: batch.settleDate,
    createdAt: ts || nowIso(),
    entries
  };
  store.get().ledger.unshift(entry);
  store.save();
  return entry;
}

function accountsSummary() {
  const summary = Object.entries(ACCOUNTS).map(([code, meta]) => ({
    code,
    name: meta.name,
    type: meta.type,
    desc: meta.desc,
    debit: 0,
    credit: 0,
    balance: 0
  }));
  const index = Object.fromEntries(summary.map((row) => [row.code, row]));
  for (const entry of store.get().ledger) {
    for (const line of entry.entries) {
      if (!index[line.account]) continue;
      index[line.account].debit += line.debit;
      index[line.account].credit += line.credit;
    }
  }
  for (const row of summary) {
    const isCreditNormal = row.type === 'LIABILITY' || row.type === 'INCOME';
    row.balance = isCreditNormal ? row.credit - row.debit : row.debit - row.credit;
  }
  return summary;
}

function getPaymentLedger(paymentId) {
  return store.get().ledger.filter((entry) => entry.paymentId === paymentId);
}

function refundsForPayment(paymentId) {
  return store.get().refunds.filter((refund) => refund.paymentId === paymentId && refund.status === 'SUCCESS');
}

function generateBatches(settleDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(settleDate || ''))) {
    throw httpError(400, '请提供正确的结算日期（YYYY-MM-DD）');
  }
  const state = store.get();
  const alreadyBatched = new Set();
  for (const batch of state.batches) {
    for (const id of batch.paymentIds) alreadyBatched.add(id);
  }
  const eligible = state.payments.filter((payment) => (
    payment.status === 'SUCCESS' &&
    payment.settleDate === settleDate &&
    !alreadyBatched.has(payment.id)
  ));
  if (!eligible.length) {
    throw httpError(400, `${settleDate} 没有可结算的交易。结算按 T+1 生成，请先完成支付或选择正确的结算日。`);
  }
  const groups = new Map();
  for (const payment of eligible) {
    if (!groups.has(payment.merchantId)) groups.set(payment.merchantId, []);
    groups.get(payment.merchantId).push(payment);
  }
  const created = [];
  for (const [merchantId, payments] of groups) {
    const refunds = state.refunds.filter((refund) => (
      refund.status === 'SUCCESS' && payments.some((payment) => payment.id === refund.paymentId)
    ));
    const grossAmount = payments.reduce((sum, payment) => sum + payment.amount, 0);
    const feeAmount = payments.reduce((sum, payment) => sum + (payment.fee || 0), 0);
    const refundAmount = refunds.reduce((sum, refund) => sum + refund.amount, 0);
    const batch = {
      id: rid('BAT'),
      merchantId,
      merchantName: payments[0].merchantName,
      settleDate,
      count: payments.length,
      grossAmount,
      feeAmount,
      refundAmount,
      netAmount: grossAmount - feeAmount - refundAmount,
      paymentIds: payments.map((payment) => payment.id),
      status: 'PENDING',
      createdAt: nowIso(),
      settledAt: null
    };
    state.batches.unshift(batch);
    created.push(batch);
  }
  store.save();
  return created;
}

function settleBatch(batchId) {
  const batch = store.get().batches.find((item) => item.id === batchId);
  if (!batch) throw httpError(404, '结算单不存在');
  if (batch.status !== 'PENDING') throw httpError(409, '该结算单已处理');
  postSettlementLedger(batch);
  batch.status = 'SETTLED';
  batch.settledAt = nowIso();
  for (const id of batch.paymentIds) {
    const payment = store.get().payments.find((item) => item.id === id);
    if (payment) payment.settledBatchId = batch.id;
  }
  store.save();
  return batch;
}

function localSuccessPayments(date, channel) {
  return store.get().payments.filter((payment) => (
    payment.status === 'SUCCESS' &&
    payment.channel === channel &&
    payment.paidAt &&
    dateStr(new Date(payment.paidAt)) === date
  ));
}

function generateBill({ date, channel, inject = {} }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    throw httpError(400, '请提供正确的账单日期（YYYY-MM-DD）');
  }
  const locals = localSuccessPayments(date, channel);
  if (!locals.length) {
    throw httpError(400, '该日期与渠道没有支付成功记录，无法生成渠道账单');
  }
  let lines = locals.map((payment) => ({
    id: rid('BL'),
    channelTradeNo: payment.channelTradeNo,
    outTradeNo: payment.outTradeNo,
    amount: payment.amount,
    fee: payment.fee || 0,
    status: 'SUCCESS'
  }));
  const applied = { long: false, short: false, amount: false };
  if (inject.amount && lines.length) {
    lines[0].amount += 500;
    applied.amount = true;
  }
  if (inject.short && lines.length > 1) {
    lines.pop();
    applied.short = true;
  }
  if (inject.long) {
    const now = new Date();
    lines.push({
      id: rid('BL'),
      channelTradeNo: `CH-FAKE-${now.getTime().toString().slice(-8)}`,
      outTradeNo: `O-FAKE-${now.getTime().toString().slice(-6)}`,
      amount: 19900,
      fee: 119,
      status: 'SUCCESS'
    });
    applied.long = true;
  }
  const bill = {
    id: rid('BILL'),
    date,
    channel,
    count: lines.length,
    totalAmount: lines.reduce((sum, line) => sum + line.amount, 0),
    totalFee: lines.reduce((sum, line) => sum + line.fee, 0),
    lines,
    injected: applied,
    createdAt: nowIso(),
    runId: null
  };
  store.get().bills.unshift(bill);
  store.save();
  return bill;
}

function runReconciliation(billId) {
  const bill = store.get().bills.find((item) => item.id === billId);
  if (!bill) throw httpError(404, '渠道账单不存在');
  const locals = localSuccessPayments(bill.date, bill.channel);
  const localMap = new Map(locals.map((payment) => [payment.channelTradeNo, payment]));
  const lineMap = new Map(bill.lines.map((line) => [line.channelTradeNo, line]));
  const diffs = [];
  let matchedCount = 0;

  for (const payment of locals) {
    const line = lineMap.get(payment.channelTradeNo);
    if (!line) {
      diffs.push({
        id: rid('DIFF'),
        type: 'LOCAL_ONLY',
        label: '短款（本地有、渠道无）',
        outTradeNo: payment.outTradeNo,
        channelTradeNo: payment.channelTradeNo,
        localAmount: payment.amount,
        channelAmount: null,
        status: 'PENDING',
        resolution: null
      });
      continue;
    }
    if (line.amount !== payment.amount) {
      diffs.push({
        id: rid('DIFF'),
        type: 'AMOUNT_MISMATCH',
        label: '金额不一致',
        outTradeNo: payment.outTradeNo,
        channelTradeNo: payment.channelTradeNo,
        localAmount: payment.amount,
        channelAmount: line.amount,
        status: 'PENDING',
        resolution: null
      });
      continue;
    }
    matchedCount += 1;
  }

  for (const line of bill.lines) {
    if (localMap.has(line.channelTradeNo)) continue;
    diffs.push({
      id: rid('DIFF'),
      type: 'CHANNEL_ONLY',
      label: '长款（渠道有、本地无）',
      outTradeNo: line.outTradeNo,
      channelTradeNo: line.channelTradeNo,
      localAmount: null,
      channelAmount: line.amount,
      status: 'PENDING',
      resolution: null
    });
  }

  const localAmount = locals.reduce((sum, payment) => sum + payment.amount, 0);
  const channelAmount = bill.lines.reduce((sum, line) => sum + line.amount, 0);
  const run = {
    id: rid('REC'),
    billId: bill.id,
    date: bill.date,
    channel: bill.channel,
    summary: {
      localCount: locals.length,
      channelCount: bill.lines.length,
      matchedCount,
      diffCount: diffs.length,
      localAmount,
      channelAmount,
      diffAmount: channelAmount - localAmount
    },
    diffs,
    createdAt: nowIso(),
    handledCount: 0
  };
  store.get().reconRuns.unshift(run);
  bill.runId = run.id;
  store.save();
  return run;
}

function handleDiff(runId, diffId, { action, note }) {
  const allowed = ['supplement', 'suspend', 'ignore', 'manual'];
  if (!allowed.includes(action)) throw httpError(400, '不支持的处理动作');
  const run = store.get().reconRuns.find((item) => item.id === runId);
  if (!run) throw httpError(404, '对账批次不存在');
  const diff = run.diffs.find((item) => item.id === diffId);
  if (!diff) throw httpError(404, '差异记录不存在');
  if (diff.status === 'HANDLED') throw httpError(409, '该差异已处理');
  diff.status = 'HANDLED';
  diff.resolution = {
    action,
    note: note || '',
    operator: 'ops01',
    handledAt: nowIso()
  };
  run.handledCount = run.diffs.filter((item) => item.status === 'HANDLED').length;
  store.save();
  return diff;
}

function settlementView() {
  const state = store.get();
  const payments = state.payments;
  const batches = state.batches.map((batch) => ({
    ...batch,
    payments: batch.paymentIds
      .map((id) => payments.find((payment) => payment.id === id))
      .filter(Boolean)
      .map((payment) => ({
        id: payment.id,
        outTradeNo: payment.outTradeNo,
        subject: payment.subject,
        amount: payment.amount,
        fee: payment.fee,
        channel: payment.channel
      }))
  }));
  return {
    batches,
    accounts: accountsSummary(),
    pending: batches.filter((batch) => batch.status === 'PENDING').reduce((sum, batch) => sum + batch.netAmount, 0),
    settled: batches.filter((batch) => batch.status === 'SETTLED').reduce((sum, batch) => sum + batch.netAmount, 0)
  };
}

function reconView() {
  const state = store.get();
  return {
    bills: state.bills.slice(0, 20),
    runs: state.reconRuns.slice(0, 20)
  };
}

module.exports = {
  ACCOUNTS,
  postPaymentLedger,
  postRefundLedger,
  postSettlementLedger,
  accountsSummary,
  getPaymentLedger,
  generateBatches,
  settleBatch,
  generateBill,
  runReconciliation,
  handleDiff,
  settlementView,
  reconView,
  localSuccessPayments,
  fmtCents
};
