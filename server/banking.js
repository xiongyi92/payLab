'use strict';

const store = require('./store');
const interbank = require('./interbank');
const { rid, toCents, httpError } = require('./util');

const BANK_CODES = ['ICBC', 'CCB', 'ABC'];

const CUSTOMERS = {
  ICBC: [
    { id: 'C-ICBC-01', name: '张伟', type: '个人客户' },
    { id: 'C-ICBC-02', name: '云栖科技有限公司', type: '企业客户' }
  ],
  CCB: [
    { id: 'C-CCB-01', name: '云栖优选商城', type: '商户' },
    { id: 'C-CCB-02', name: '李娜', type: '个人客户' }
  ],
  ABC: [
    { id: 'C-ABC-01', name: '市自来水公司', type: '公用事业' },
    { id: 'C-ABC-02', name: '市电力公司', type: '公用事业' }
  ]
};

const UTILITY_CUSTOMER = '市自来水公司';

const OPERATION_TYPES = [
  {
    code: 'deposit_cash',
    name: '现金存入',
    desc: '客户存入现金，银行库存现金与吸收存款同时增加。',
    fields: ['amount'],
    teaching: '存款是银行的负债：客户把钱存进银行，银行资产（现金）增加，同时对客户形成负债。'
  },
  {
    code: 'loan_issue',
    name: '发放贷款',
    desc: '银行向企业发放贷款，贷款资产与派生存款同时增加。',
    fields: ['amount'],
    teaching: '贷款创造存款：银行发放贷款时并不是把现金搬给客户，而是在客户账户上记一笔存款，资产与负债同时扩张。'
  },
  {
    code: 'loan_repay',
    name: '收回贷款本息',
    desc: '从客户存款扣收本金与利息，贷款减少，利息收入增加。',
    fields: ['principal', 'interest'],
    teaching: '利息收入在贷款存续期内逐步确认；收回本息时同时减少贷款资产和客户存款。'
  },
  {
    code: 'agency_utility',
    name: '代收水电费并划转',
    desc: '从付款人账户扣款，经央行清算划转至公用事业公司账户。',
    fields: ['amount', 'fee'],
    teaching: '代收付是典型中间业务：银行先收后付，代收资金计入“应解汇款”，不能与自有资金混用。'
  },
  {
    code: 'fee_collect',
    name: '收取账户管理费',
    desc: '从客户存款扣收手续费，确认手续费及佣金收入。',
    fields: ['amount'],
    teaching: '中间业务不占用银行资金，主要赚取手续费与佣金，是银行轻资本收入的重要来源。'
  }
];

const OPERATION_MAP = Object.fromEntries(OPERATION_TYPES.map((item) => [item.code, item]));

function nowIso() {
  return new Date().toISOString();
}

function bankName(code) {
  return interbank.INSTITUTIONS[code] ? interbank.INSTITUTIONS[code].name : code;
}

function findCustomer(bank, name) {
  return (CUSTOMERS[bank] || []).find((item) => item.name === name);
}

function buildLines(type, bank, customer, values) {
  const cash = values.amount;
  if (type === 'deposit_cash') {
    return [
      interbankLine(bank, 'CASH', cash, 0, '现金存入'),
      interbankLine(bank, 'DEPOSITS', 0, cash, customer)
    ];
  }
  if (type === 'loan_issue') {
    return [
      interbankLine(bank, 'LOANS', cash, 0, customer),
      interbankLine(bank, 'DEPOSITS', 0, cash, customer)
    ];
  }
  if (type === 'loan_repay') {
    const principal = values.principal;
    const interest = values.interest;
    return [
      interbankLine(bank, 'DEPOSITS', principal + interest, 0, customer),
      interbankLine(bank, 'LOANS', 0, principal, customer),
      interbankLine(bank, 'INTEREST_INCOME', 0, interest, '贷款利息收入')
    ];
  }
  if (type === 'fee_collect') {
    return [
      interbankLine(bank, 'DEPOSITS', cash, 0, customer),
      interbankLine(bank, 'FEE_INCOME', 0, cash, '账户管理费')
    ];
  }
  if (type === 'agency_utility') {
    const fee = values.fee;
    const lines = [
      interbankLine(bank, 'DEPOSITS', cash + fee, 0, customer),
      interbankLine(bank, 'SETTLED_FUND', 0, cash, '代收水电费'),
      ...(fee > 0 ? [interbankLine(bank, 'FEE_INCOME', 0, fee, '代理手续费')] : [])
    ];
    if (bank === 'ABC') {
      lines.push(
        interbankLine('ABC', 'SETTLED_FUND', cash, 0, '划转公用事业单位'),
        interbankLine('ABC', 'DEPOSITS', 0, cash, UTILITY_CUSTOMER)
      );
      return lines;
    }
    lines.push(
      interbankLine(bank, 'SETTLED_FUND', cash, 0, '划转公用事业单位'),
      interbankLine(bank, 'RESERVE_PBOC', 0, cash, '通过央行清算'),
      interbankLine('ABC', 'RESERVE_PBOC', cash, 0, '收到代收资金'),
      interbankLine('ABC', 'DEPOSITS', 0, cash, UTILITY_CUSTOMER),
      interbankLine('PBOC', `RESERVE_${bank}`, cash, 0, `${bankName(bank)}准备金减少`),
      interbankLine('PBOC', 'RESERVE_ABC', 0, cash, '农业银行准备金增加')
    );
    return lines;
  }
  throw httpError(400, '不支持的银行业务');
}

function interbankLine(institution, code, debit, credit, memo) {
  const inst = interbank.INSTITUTIONS[institution];
  const account = inst && inst.chart[code];
  if (!account) throw new Error(`未知科目：${institution}.${code}`);
  return {
    institution,
    institutionName: inst.short,
    code,
    accountName: account.name,
    accountType: account.type,
    debit: Math.round(debit || 0),
    credit: Math.round(credit || 0),
    memo: memo || ''
  };
}

function applyBankOperation(body, options = {}) {
  const type = String(body.type || '');
  const meta = OPERATION_MAP[type];
  if (!meta) throw httpError(400, '请选择正确的银行业务');
  const bank = String(body.bank || 'ICBC');
  if (!BANK_CODES.includes(bank)) throw httpError(400, '请选择正确的银行');
  const customer = String(body.customer || '').trim();
  if (!findCustomer(bank, customer)) throw httpError(400, '请选择该银行的客户');

  const amount = toCents(body.amount);
  const fee = toCents(body.fee || 0);
  const principal = toCents(body.principal);
  const interest = toCents(body.interest || 0);

  if (type === 'loan_repay') {
    if (!Number.isFinite(principal) || principal < 1) throw httpError(400, '贷款本金不合法');
    if (!Number.isFinite(interest) || interest < 0) throw httpError(400, '贷款利息不合法');
  } else if (type === 'agency_utility') {
    if (!Number.isFinite(amount) || amount < 1 || amount > 50000000) throw httpError(400, '代收金额不合法');
    if (!Number.isFinite(fee) || fee < 0) throw httpError(400, '代理手续费不合法');
  } else if (!Number.isFinite(amount) || amount < 1 || amount > 50000000) {
    throw httpError(400, '业务金额需在 0.01 ~ 500,000.00 元之间');
  }

  const values = {
    amount: Number.isFinite(amount) ? amount : 0,
    fee: Number.isFinite(fee) ? fee : 0,
    principal: Number.isFinite(principal) ? principal : 0,
    interest: Number.isFinite(interest) ? interest : 0
  };
  const lines = buildLines(type, bank, customer, values);
  const opId = rid('BOP');
  const ts = options.ts || nowIso();
  const title = `${meta.name} · ${interbank.INSTITUTIONS[bank].short}`;
  const entry = interbank.postJournal({
    opId,
    source: 'BANK_OP',
    scenario: type,
    title,
    ts,
    lines,
    save: false
  });
  const op = {
    id: opId,
    type,
    typeName: meta.name,
    bank,
    bankName: interbank.INSTITUTIONS[bank].name,
    customer,
    amount: type === 'loan_repay' ? values.principal + values.interest : values.amount,
    fee: values.fee,
    principal: values.principal,
    interest: values.interest,
    ts,
    title,
    journalId: entry.id,
    seeded: Boolean(options.seed)
  };
  interbank.ensureState().ops.unshift(op);
  if (options.save !== false) store.save();
  return { ...op, journal: entry };
}

function customerDeposits(bank) {
  const journal = interbank.ensureState().journal;
  return (CUSTOMERS[bank] || []).map((customer) => {
    let debit = 0;
    let credit = 0;
    for (const entry of journal) {
      for (const item of entry.lines) {
        if (item.institution !== bank || item.code !== 'DEPOSITS' || item.memo !== customer.name) continue;
        debit += item.debit;
        credit += item.credit;
      }
    }
    return { ...customer, debit, credit, balance: credit - debit };
  });
}

function bankCards() {
  return BANK_CODES.map((code) => {
    const inst = interbank.INSTITUTIONS[code];
    const accounts = interbank.accountBalances(code);
    const get = (accountCode) => {
      const row = accounts.find((item) => item.code === accountCode);
      return row ? row.balance : 0;
    };
    return {
      code,
      name: inst.name,
      short: inst.short,
      role: inst.role,
      color: inst.color,
      accounts,
      customers: customerDeposits(code),
      kpis: {
        deposits: get('DEPOSITS'),
        loans: get('LOANS'),
        reserve: get('RESERVE_PBOC'),
        feeIncome: get('FEE_INCOME'),
        interestIncome: get('INTEREST_INCOME'),
        cash: get('CASH')
      }
    };
  });
}

function paymentInstitutionView() {
  const accounts = interbank.accountBalances('PAYLAB');
  const get = (code) => {
    const row = accounts.find((item) => item.code === code);
    return row ? row.balance : 0;
  };
  const reserve = get('RESERVE_PBOC');
  const wallet = get('WALLET_LIABILITY');
  const journal = interbank.ensureState().journal
    .filter((entry) => entry.lines.some((item) => item.institution === 'PAYLAB'))
    .slice(0, 24)
    .map((entry) => ({
      ...entry,
      lines: entry.lines.filter((item) => item.institution === 'PAYLAB')
    }));
  return {
    accounts,
    kpis: {
      reserve,
      wallet,
      merchantPayable: get('MERCHANT_PAYABLE'),
      settledFund: get('SETTLED_FUND'),
      feeIncome: get('FEE_INCOME'),
      coverage: wallet > 0 ? (reserve / wallet) * 100 : 100
    },
    journal
  };
}

function bankingView() {
  const state = interbank.ensureState();
  const banks = bankCards();
  const ops = state.ops.slice(0, 25).map((op) => ({
    ...op,
    journal: state.journal.filter((entry) => entry.opId === op.id)
  }));
  const journal = state.journal
    .filter((entry) => entry.source === 'BANK_OP')
    .slice(0, 30);
  return {
    banks,
    paymentInstitution: paymentInstitutionView(),
    operationTypes: OPERATION_TYPES,
    customers: CUSTOMERS,
    ops,
    journal,
    trial: interbank.globalTrial(),
    totals: banks.reduce((acc, bank) => ({
      deposits: acc.deposits + bank.kpis.deposits,
      loans: acc.loans + bank.kpis.loans,
      feeIncome: acc.feeIncome + bank.kpis.feeIncome,
      interestIncome: acc.interestIncome + bank.kpis.interestIncome
    }), { deposits: 0, loans: 0, feeIncome: 0, interestIncome: 0 })
  };
}

function seedBanking() {
  if (interbank.ensureState().ops.length) return;
  const at = (offset, hour, minute) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    date.setHours(hour, minute, 0, 0);
    return date.toISOString();
  };
  const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const operations = [
    { type: 'deposit_cash', bank: 'ICBC', customer: '张伟', amount: 50000, ts: at(-4, 9, 10) },
    { type: 'deposit_cash', bank: 'ICBC', customer: '云栖科技有限公司', amount: 300000, ts: at(-4, 10, 20) },
    { type: 'deposit_cash', bank: 'CCB', customer: '云栖优选商城', amount: 120000, ts: at(-3, 11, 5) },
    { type: 'deposit_cash', bank: 'ABC', customer: '市自来水公司', amount: 80000, ts: at(-3, 14, 30) },
    { type: 'loan_issue', bank: 'ICBC', customer: '云栖科技有限公司', amount: 500000, ts: at(-2, 9, 40) },
    { type: 'loan_issue', bank: 'CCB', customer: '云栖优选商城', amount: 200000, ts: at(-2, 15, 20) },
    { type: 'loan_repay', bank: 'ICBC', customer: '云栖科技有限公司', principal: 100000, interest: 4500, ts: at(-1, 10, 15) },
    { type: 'agency_utility', bank: 'ICBC', customer: '张伟', amount: 200, fee: 2, ts: minutesAgo(90) },
    { type: 'fee_collect', bank: 'CCB', customer: '云栖优选商城', amount: 50, ts: minutesAgo(60) }
  ];
  for (const operation of operations) {
    applyBankOperation(operation, { ts: operation.ts, seed: true, save: false });
  }
  store.save();
}

module.exports = {
  BANK_CODES,
  CUSTOMERS,
  OPERATION_TYPES,
  applyBankOperation,
  bankingView,
  seedBanking
};
