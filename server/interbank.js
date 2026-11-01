'use strict';

const store = require('./store');
const { rid, toCents, roundFee, httpError } = require('./util');

const ACCOUNT_TYPES = {
  ASSET: { label: '资产', normal: 'DEBIT' },
  LIABILITY: { label: '负债', normal: 'CREDIT' },
  EQUITY: { label: '所有者权益', normal: 'CREDIT' },
  INCOME: { label: '收入', normal: 'CREDIT' },
  EXPENSE: { label: '费用', normal: 'DEBIT' }
};

function bankChart() {
  return {
    DEPOSITS: { name: '吸收存款', type: 'LIABILITY', desc: '客户存入银行的资金，属于银行负债' },
    CASH: { name: '库存现金', type: 'ASSET', desc: '银行柜面与自助设备持有的现金' },
    RESERVE_PBOC: { name: '存放中央银行款项', type: 'ASSET', desc: '在人民银行准备金账户中的存款' },
    LOANS: { name: '发放贷款', type: 'ASSET', desc: '对公与个人贷款本金' },
    INTEREST_RECEIVABLE: { name: '应收利息', type: 'ASSET', desc: '已计提但尚未收到的贷款利息' },
    INTERBANK_RECEIVABLE: { name: '待清算款项（应收）', type: 'ASSET', desc: '清算机构应付给本行的资金' },
    INTERBANK_PAYABLE: { name: '待清算款项（应付）', type: 'LIABILITY', desc: '本行应付给清算机构的资金' },
    SETTLED_FUND: { name: '应解汇款', type: 'LIABILITY', desc: '代收后待划转给收款人的资金' },
    INTEREST_INCOME: { name: '利息收入', type: 'INCOME', desc: '贷款与同业业务产生的利息收入' },
    FEE_INCOME: { name: '手续费及佣金收入', type: 'INCOME', desc: '结算、代理、账户管理等中间业务收入' }
  };
}

const INSTITUTIONS = {
  PAYLAB: {
    code: 'PAYLAB',
    name: 'PayLab 支付机构',
    short: '支付机构',
    category: 'PAYMENT',
    role: '钱包 / 收单 / 备付金存管',
    color: '#38bdf8',
    chart: {
      RESERVE_PBOC: { name: '备付金存款（央行）', type: 'ASSET', desc: '客户备付金 100% 集中存管于人民银行' },
      WALLET_LIABILITY: { name: '钱包余额（客户负债）', type: 'LIABILITY', desc: '用户钱包中的可支付余额' },
      MERCHANT_PAYABLE: { name: '商户待结算款', type: 'LIABILITY', desc: '支付机构应付给特约商户的净额' },
      SETTLED_FUND: { name: '代收代付款项', type: 'LIABILITY', desc: '代收后待划转给公用事业单位的资金' },
      INTERBANK_RECEIVABLE: { name: '清算应收款（网联）', type: 'ASSET', desc: '网联应付给支付机构的清算资金' },
      INTERBANK_PAYABLE: { name: '清算应付款（网联）', type: 'LIABILITY', desc: '支付机构应付给网联的清算资金' },
      FEE_INCOME: { name: '支付服务费收入', type: 'INCOME', desc: '收单、代收、提现等业务手续费' }
    }
  },
  NETSUNION: {
    code: 'NETSUNION',
    name: '网联清算有限公司',
    short: '网联清算',
    category: 'CLEARING',
    role: '第三方支付网络清算',
    color: '#22d3ee',
    chart: {
      RESERVE_PBOC: { name: '特参账户存款（央行）', type: 'ASSET', desc: '网联作为特许参与者在人民银行开立的清算账户资金' },
      RECEIVABLE: { name: '清算应收款', type: 'ASSET', desc: '应向参与机构收取的清算款' },
      PAYABLE: { name: '清算应付款', type: 'LIABILITY', desc: '应向参与机构支付的清算款' },
      FEE_INCOME: { name: '清算服务费收入', type: 'INCOME', desc: '向支付机构收取的网络清算服务费' }
    }
  },
  UNIONPAY: {
    code: 'UNIONPAY',
    name: '中国银联股份有限公司',
    short: '银联清算',
    category: 'CLEARING',
    role: '银行卡跨行转接清算',
    color: '#f87171',
    chart: {
      RESERVE_PBOC: { name: '清算备付金（央行）', type: 'ASSET', desc: '银联在人民银行清算账户中的资金' },
      RECEIVABLE: { name: '清算应收款（发卡行）', type: 'ASSET', desc: '应向发卡行收取的清算款' },
      PAYABLE: { name: '清算应付款（收单行）', type: 'LIABILITY', desc: '应向收单行支付的清算款' },
      FEE_INCOME: { name: '网络服务费收入', type: 'INCOME', desc: '银行卡跨行转接网络服务费' }
    }
  },
  CIPS: {
    code: 'CIPS',
    name: '人民币跨境支付系统（CIPS）',
    short: 'CIPS',
    category: 'CLEARING',
    role: '人民币跨境转接与清算',
    color: '#818cf8',
    chart: {
      RESERVE_PBOC: { name: '清算备付金（央行）', type: 'ASSET', desc: 'CIPS 在人民银行清算账户中的资金' },
      RECEIVABLE: { name: '跨境清算应收款', type: 'ASSET', desc: '应向境外代理行收取的跨境清算款' },
      PAYABLE: { name: '跨境清算应付款', type: 'LIABILITY', desc: '应向境内收款机构支付的跨境清算款' },
      FEE_INCOME: { name: '跨境清算服务费收入', type: 'INCOME', desc: '跨境转接与人民币清算服务费' }
    }
  },
  PBOC: {
    code: 'PBOC',
    name: '中国人民银行',
    short: '人民银行',
    category: 'CENTRAL_BANK',
    role: 'CNAPS 大额 / 小额支付系统',
    color: '#fbbf24',
    chart: {
      ASSETS: { name: '对金融机构债权', type: 'ASSET', desc: '央行通过准备金投放形成的对金融机构债权' },
      RESERVE_ICBC: { name: '准备金存款 · 工商银行', type: 'LIABILITY', desc: '工商银行在央行的准备金存款' },
      RESERVE_CCB: { name: '准备金存款 · 建设银行', type: 'LIABILITY', desc: '建设银行在央行的准备金存款' },
      RESERVE_ABC: { name: '准备金存款 · 农业银行', type: 'LIABILITY', desc: '农业银行在央行的准备金存款' },
      RESERVE_PAYLAB: { name: '备付金存款 · 支付机构', type: 'LIABILITY', desc: '支付机构集中存管的客户备付金' },
      RESERVE_NETSUNION: { name: '网联特参账户', type: 'LIABILITY', desc: '网联作为特许参与者在央行开立的清算账户余额' },
      RESERVE_UNIONPAY: { name: '清算备付金 · 银联', type: 'LIABILITY', desc: '银联在央行的清算备付金' },
      RESERVE_CIPS: { name: '清算备付金 · CIPS', type: 'LIABILITY', desc: 'CIPS 在央行的清算备付金' }
    }
  },
  ICBC: {
    code: 'ICBC',
    name: '中国工商银行',
    short: '工商银行',
    category: 'BANK',
    role: '发卡行 / 零售银行',
    color: '#ef4444',
    chart: bankChart()
  },
  CCB: {
    code: 'CCB',
    name: '中国建设银行',
    short: '建设银行',
    category: 'BANK',
    role: '收单行 / 商户开户行',
    color: '#3b82f6',
    chart: {
      ...bankChart(),
      DUE_TO_BANKS: { name: '境外代理行存放款项', type: 'LIABILITY', desc: '境外银行存放在本行的同业存款（Vostro）' }
    }
  },
  ABC: {
    code: 'ABC',
    name: '中国农业银行',
    short: '农业银行',
    category: 'BANK',
    role: '公用事业收款行',
    color: '#34d399',
    chart: bankChart()
  },
  HSBC: {
    code: 'HSBC',
    name: '汇丰银行（境外收单行）',
    short: '境外收单行',
    category: 'BANK',
    role: '境外卡收单 / 结售汇',
    color: '#f472b6',
    chart: {
      ...bankChart(),
      DUE_FROM_BANKS: { name: '存放境内代理行款项', type: 'ASSET', desc: '境外银行存放在境内代理行的同业存款（Nostro）' }
    }
  }
};

const SCENARIOS = [
  {
    code: 'goods',
    name: '商品支付 · 网联',
    short: '商品支付',
    network: '网联清算',
    desc: '用户银行卡扣款，经网联轧差后通过网联特参账户划入支付机构备付金，再结算给商户开户行。',
    defaultAmount: 128,
    payer: 'U10001',
    payee: '云栖优选商城',
    legs: 6,
    teaching: '第三方支付的核心是备付金：发卡行资金先进入网联在央行的特参账户，再由网联划入支付机构备付金账户，最后按净额结算给商户。'
  },
  {
    code: 'card',
    name: '银行卡消费 · 银联',
    short: '银行卡消费',
    network: '银联清算',
    desc: '发卡行扣款后，银联跨行转接清算，收单行把净额入账到商户存款账户。',
    defaultAmount: 268,
    payer: 'U10003',
    payee: '云栖数码',
    legs: 4,
    teaching: '银行卡交易的手续费由发卡行、清算机构、收单机构共同分配，资金最终通过央行准备金账户完成跨行清算。'
  },
  {
    code: 'utility',
    name: '生活缴费 · 水电费',
    short: '水电费代收',
    network: '网联清算',
    desc: '支付机构代收水电费，资金经网联特参账户和央行清算后划转至公用事业单位开户行。',
    defaultAmount: 200,
    payer: 'U10001',
    payee: '市自来水公司',
    legs: 6,
    teaching: '代收付属于中间业务：支付机构先记“代收代付款项”，再划转给公用事业单位，不能把代收资金当作自有资金。'
  },
  {
    code: 'topup',
    name: '钱包充值',
    short: '钱包充值',
    network: '网联清算',
    desc: '用户从银行卡向支付机构钱包充值，资金经网联特参账户划入备付金，同时确认对用户的钱包余额负债。',
    defaultAmount: 500,
    payer: 'U10001',
    payee: '本人钱包',
    legs: 5,
    teaching: '充值不是收入：支付机构资产（备付金）与负债（钱包余额）同时增加，客户备付金必须 100% 集中存管。'
  },
  {
    code: 'withdraw',
    name: '钱包提现',
    short: '钱包提现',
    network: '网联清算',
    desc: '用户把钱包余额提现到银行卡，支付机构经网联特参账户和央行清算划付。',
    defaultAmount: 300,
    payer: '本人钱包',
    payee: 'U10001',
    legs: 5,
    teaching: '提现是充值、消费的逆向流程：钱包负债减少，备付金减少，平台仅确认提现手续费收入。'
  },
  {
    code: 'wallet',
    name: '余额支付 · 支付机构内部',
    short: '余额支付',
    network: '支付机构内部',
    desc: '用户直接用钱包余额支付，只在支付机构内部完成负债转移与手续费拆分。',
    defaultAmount: 66,
    payer: 'U10001',
    payee: '云栖优选商城',
    legs: 1,
    teaching: '余额支付不产生跨行资金流，但账务上仍需把钱包负债转移为商户待结算款，并确认手续费收入。'
  },
  {
    code: 'cross_border',
    name: '跨境支付 · 境外卡',
    short: '跨境支付',
    network: 'CIPS 跨境清算',
    desc: '境外持卡人以 USD 付款，境外收单行扣款后经 CIPS 转接，央行准备金账户完成人民币最终清算。',
    defaultAmount: 724,
    payer: 'U-FOREIGN-01',
    payee: '云栖优选商城',
    legs: 5,
    teaching: '跨境支付比境内多两层：外币结汇与跨境清算。原币金额按交易日汇率结汇为人民币，再由 CIPS 在境内外机构间完成清算，并履行国际收支申报义务。'
  }
];

const SCENARIO_MAP = Object.fromEntries(SCENARIOS.map((item) => [item.code, item]));

function nowIso() {
  return new Date().toISOString();
}

function ensureState() {
  const state = store.get();
  if (!state.interbank || typeof state.interbank !== 'object') {
    state.interbank = { flows: [], journal: [], ops: [] };
  }
  if (!Array.isArray(state.interbank.flows)) state.interbank.flows = [];
  if (!Array.isArray(state.interbank.journal)) state.interbank.journal = [];
  if (!Array.isArray(state.interbank.ops)) state.interbank.ops = [];
  return state.interbank;
}

function line(institution, code, debit = 0, credit = 0, memo = '') {
  const inst = INSTITUTIONS[institution];
  if (!inst) throw new Error(`未知机构：${institution}`);
  const account = inst.chart[code];
  if (!account) throw new Error(`未知科目：${institution}.${code}`);
  return {
    institution,
    institutionName: inst.short,
    code,
    accountName: account.name,
    accountType: account.type,
    debit: Math.round(debit || 0),
    credit: Math.round(credit || 0),
    memo
  };
}

function postJournal({ flowId = null, legIndex = null, opId = null, source, scenario, title, ts, lines, save = true }) {
  const normalized = lines
    .filter(Boolean)
    .map((item) => ({ ...item, debit: Math.round(item.debit || 0), credit: Math.round(item.credit || 0) }))
    .filter((item) => item.debit || item.credit);
  const debit = normalized.reduce((sum, item) => sum + item.debit, 0);
  const credit = normalized.reduce((sum, item) => sum + item.credit, 0);
  if (debit !== credit) {
    throw new Error(`分录借贷不平衡：借 ${debit} / 贷 ${credit}`);
  }
  const entry = {
    id: rid('JE'),
    flowId,
    legIndex,
    opId,
    source,
    scenario,
    title,
    ts: ts || nowIso(),
    debit,
    credit,
    lines: normalized
  };
  ensureState().journal.unshift(entry);
  if (save) store.save();
  return entry;
}

function makeLeg(index, def) {
  const from = INSTITUTIONS[def.from];
  const to = INSTITUTIONS[def.to];
  return {
    index,
    key: def.key,
    title: def.title,
    detail: def.detail,
    system: def.system,
    from: def.from,
    to: def.to,
    fromName: from ? from.short : def.from,
    toName: to ? to.short : def.to,
    amount: Math.round(def.amount || 0),
    entries: (def.entries || []).filter((item) => item && (item.debit || item.credit)),
    status: 'PENDING',
    executedAt: null
  };
}

function feeParts(type, amount, overrideFee) {
  if (type === 'topup' || type === 'wallet') {
    const fee = overrideFee !== undefined ? Math.max(0, Math.round(overrideFee)) : 0;
    return { fee, networkFee: 0, platformFee: fee, payeeNet: amount - fee };
  }
  if (type === 'withdraw') {
    const fee = overrideFee !== undefined
      ? Math.max(0, Math.round(overrideFee))
      : Math.min(amount, Math.max(10, Math.round(amount * 0.001)));
    return { fee, networkFee: 0, platformFee: fee, payeeNet: amount };
  }
  if (type === 'card') {
    const fee = overrideFee !== undefined ? Math.max(0, Math.round(overrideFee)) : roundFee(amount, 0.006);
    const networkFee = fee > 1 ? Math.min(Math.max(1, Math.round(amount * 0.0005)), fee - 1) : 0;
    return { fee, networkFee, platformFee: fee - networkFee, payeeNet: amount - fee };
  }
  if (type === 'cross_border') {
    const fee = overrideFee !== undefined ? Math.max(0, Math.round(overrideFee)) : roundFee(amount, 0.028);
    const networkFee = fee > 1 ? Math.min(Math.max(1, Math.round(amount * 0.001)), fee - 1) : 0;
    return { fee, networkFee, platformFee: fee - networkFee, payeeNet: amount - fee };
  }
  const rate = type === 'utility' ? 0.003 : 0.006;
  const fee = overrideFee !== undefined ? Math.max(0, Math.round(overrideFee)) : roundFee(amount, rate);
  const networkFee = fee > 1 ? Math.min(Math.max(1, Math.round(amount * 0.0001)), fee - 1) : 0;
  return { fee, networkFee, platformFee: fee - networkFee, payeeNet: amount - fee };
}

function buildGoodsFlow(options) {
  const A = options.amount;
  const { fee, networkFee, platformFee, payeeNet } = feeParts('goods', A, options.feeOverride);
  const legs = [
    makeLeg(0, {
      key: 'issuer-debit',
      title: '发卡行扣减用户存款',
      detail: `${INSTITUTIONS.ICBC.name}从付款人账户扣款，形成对网联的待清算应付款。`,
      system: '发卡行核心',
      from: 'ICBC',
      to: 'NETSUNION',
      amount: A,
      entries: [
        line('ICBC', 'DEPOSITS', A, 0, options.payer),
        line('ICBC', 'INTERBANK_PAYABLE', 0, A, '网联待清算')
      ]
    }),
    makeLeg(1, {
      key: 'network-clearing',
      title: '网联受理并轧差',
      detail: `网联登记发卡行应收与支付机构应付，并扣收网络清算服务费 ¥${(networkFee / 100).toFixed(2)}。`,
      system: '网联清算',
      from: 'NETSUNION',
      to: 'PAYLAB',
      amount: A,
      entries: [
        line('NETSUNION', 'RECEIVABLE', A, 0, '工商银行'),
        line('NETSUNION', 'PAYABLE', 0, A - networkFee, 'PayLab 支付机构'),
        line('NETSUNION', 'FEE_INCOME', 0, networkFee, '网络清算服务费')
      ]
    }),
    makeLeg(2, {
      key: 'netsunion-sp-receive',
      title: '网联特参账户收款',
      detail: `${INSTITUTIONS.ICBC.name}的净额经人民银行 ACS 记入网联特许参与者账户，完成跨行资金归集。`,
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
    }),
    makeLeg(3, {
      key: 'netsunion-sp-payout',
      title: '特参账户向支付机构划付',
      detail: `网联从特参账户向支付机构备付金账户划付净额，网络清算费 ¥${(networkFee / 100).toFixed(2)} 留存于特参账户。`,
      system: '人民银行 ACS · 网联特参账户',
      from: 'NETSUNION',
      to: 'PAYLAB',
      amount: A - networkFee,
      entries: [
        line('NETSUNION', 'PAYABLE', A - networkFee, 0, '结清对支付机构应付'),
        line('NETSUNION', 'RESERVE_PBOC', 0, A - networkFee, '特参账户向支付机构划付'),
        line('PAYLAB', 'RESERVE_PBOC', A - networkFee, 0, '备付金账户收款'),
        line('PAYLAB', 'INTERBANK_RECEIVABLE', 0, A - networkFee, '网联待清算'),
        line('PBOC', 'RESERVE_NETSUNION', A - networkFee, 0, '网联特参账户减少'),
        line('PBOC', 'RESERVE_PAYLAB', 0, A - networkFee, '支付机构备付金增加')
      ]
    }),
    makeLeg(4, {
      key: 'paylab-posting',
      title: '支付机构备付金入账',
      detail: '支付机构收到清算资金，同时确认商户待结算款与支付服务费收入。',
      system: '支付机构账务',
      from: 'PAYLAB',
      to: 'MERCHANT',
      amount: A,
      entries: [
        line('PAYLAB', 'INTERBANK_RECEIVABLE', A - networkFee, 0, '清算资金到账'),
        line('PAYLAB', 'MERCHANT_PAYABLE', 0, payeeNet, options.payee),
        line('PAYLAB', 'FEE_INCOME', 0, platformFee, '支付服务费收入')
      ]
    }),
    makeLeg(5, {
      key: 'merchant-settlement',
      title: '商户结算出款',
      detail: `支付机构把商户净额 ¥${(payeeNet / 100).toFixed(2)} 结算至商户开户行，备付金相应减少。`,
      system: '网联 / 央行清算',
      from: 'PAYLAB',
      to: 'CCB',
      amount: payeeNet,
      entries: [
        line('PAYLAB', 'MERCHANT_PAYABLE', payeeNet, 0, '商户结算'),
        line('PAYLAB', 'RESERVE_PBOC', 0, payeeNet, '备付金出款'),
        line('CCB', 'RESERVE_PBOC', payeeNet, 0, '收到商户结算款'),
        line('CCB', 'DEPOSITS', 0, payeeNet, options.payee),
        line('PBOC', 'RESERVE_PAYLAB', payeeNet, 0, '支付机构备付金减少'),
        line('PBOC', 'RESERVE_CCB', 0, payeeNet, '建设银行准备金增加')
      ]
    })
  ];
  return {
    type: 'goods',
    typeName: SCENARIO_MAP.goods.name,
    network: SCENARIO_MAP.goods.network,
    amount: A,
    fee,
    networkFee,
    platformFee,
    payeeNet,
    legs
  };
}

function buildCardFlow(options) {
  const A = options.amount;
  const { fee, networkFee, platformFee, payeeNet } = feeParts('card', A, options.feeOverride);
  const legs = [
    makeLeg(0, {
      key: 'issuer-debit',
      title: '发卡行扣减持卡人存款',
      detail: `${INSTITUTIONS.ICBC.name}扣减持卡人存款，形成对银联的待清算应付款。`,
      system: '发卡行核心',
      from: 'ICBC',
      to: 'UNIONPAY',
      amount: A,
      entries: [
        line('ICBC', 'DEPOSITS', A, 0, options.payer),
        line('ICBC', 'INTERBANK_PAYABLE', 0, A, '银联待清算')
      ]
    }),
    makeLeg(1, {
      key: 'unionpay-clearing',
      title: '银联跨行转接清算',
      detail: `银联完成交易转接与轧差，扣收网络服务费 ¥${(networkFee / 100).toFixed(2)}。`,
      system: '银联清算',
      from: 'UNIONPAY',
      to: 'CCB',
      amount: A,
      entries: [
        line('UNIONPAY', 'RECEIVABLE', A, 0, '工商银行'),
        line('UNIONPAY', 'PAYABLE', 0, A - networkFee, '建设银行（收单行）'),
        line('UNIONPAY', 'FEE_INCOME', 0, networkFee, '网络服务费')
      ]
    }),
    makeLeg(2, {
      key: 'pboc-settlement',
      title: '央行大额支付系统清算',
      detail: '发卡行、收单行、银联的准备金账户在央行完成最终清算。',
      system: '人民银行 CNAPS',
      from: 'PBOC',
      to: 'ICBC',
      amount: A,
      entries: [
        line('ICBC', 'INTERBANK_PAYABLE', A, 0, '结清银联待清算'),
        line('ICBC', 'RESERVE_PBOC', 0, A, '准备金减少'),
        line('UNIONPAY', 'RESERVE_PBOC', A, 0, '收到发卡行清算款'),
        line('UNIONPAY', 'RECEIVABLE', 0, A, '结清对工行应收'),
        line('UNIONPAY', 'PAYABLE', A - networkFee, 0, '结清对建行应付'),
        line('UNIONPAY', 'RESERVE_PBOC', 0, A - networkFee, '向收单行划付'),
        line('CCB', 'RESERVE_PBOC', A - networkFee, 0, '收单清算款到账'),
        line('CCB', 'INTERBANK_RECEIVABLE', 0, A - networkFee, '银联待清算'),
        line('PBOC', 'RESERVE_ICBC', A, 0, '工商银行准备金减少'),
        line('PBOC', 'RESERVE_CCB', 0, A - networkFee, '建设银行准备金增加'),
        line('PBOC', 'RESERVE_UNIONPAY', 0, networkFee, '银联备付金增加')
      ]
    }),
    makeLeg(3, {
      key: 'acquirer-posting',
      title: '收单行入账并确认手续费',
      detail: `收单行把净额 ¥${(payeeNet / 100).toFixed(2)} 记入商户存款，并确认收单手续费收入。`,
      system: '收单行核心',
      from: 'CCB',
      to: 'MERCHANT',
      amount: payeeNet,
      entries: [
        line('CCB', 'INTERBANK_RECEIVABLE', A - networkFee, 0, '银联清算款'),
        line('CCB', 'DEPOSITS', 0, payeeNet, options.payee),
        line('CCB', 'FEE_INCOME', 0, platformFee, '收单手续费收入')
      ]
    })
  ];
  return {
    type: 'card',
    typeName: SCENARIO_MAP.card.name,
    network: SCENARIO_MAP.card.network,
    amount: A,
    fee,
    networkFee,
    platformFee,
    payeeNet,
    legs
  };
}

function buildUtilityFlow(options) {
  const A = options.amount;
  const { fee, networkFee, platformFee, payeeNet } = feeParts('utility', A, options.feeOverride);
  const legs = [
    makeLeg(0, {
      key: 'issuer-debit',
      title: '付款行扣减缴费人存款',
      detail: `${INSTITUTIONS.ICBC.name}从缴费人账户扣款，形成待清算资金。`,
      system: '发卡行核心',
      from: 'ICBC',
      to: 'NETSUNION',
      amount: A,
      entries: [
        line('ICBC', 'DEPOSITS', A, 0, options.payer),
        line('ICBC', 'INTERBANK_PAYABLE', 0, A, '网联待清算')
      ]
    }),
    makeLeg(1, {
      key: 'network-clearing',
      title: '网联清算',
      detail: '网联登记清算应收应付，并扣收网络服务费。',
      system: '网联清算',
      from: 'NETSUNION',
      to: 'PAYLAB',
      amount: A,
      entries: [
        line('NETSUNION', 'RECEIVABLE', A, 0, '工商银行'),
        line('NETSUNION', 'PAYABLE', 0, A - networkFee, 'PayLab 支付机构'),
        line('NETSUNION', 'FEE_INCOME', 0, networkFee, '网络清算服务费')
      ]
    }),
    makeLeg(2, {
      key: 'netsunion-sp-receive',
      title: '网联特参账户收款',
      detail: `${INSTITUTIONS.ICBC.name}的净额经人民银行 ACS 记入网联特许参与者账户。`,
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
    }),
    makeLeg(3, {
      key: 'netsunion-sp-payout',
      title: '特参账户向支付机构划付',
      detail: `网联从特参账户向支付机构备付金账户划付净额，网络清算费 ¥${(networkFee / 100).toFixed(2)} 留存于特参账户。`,
      system: '人民银行 ACS · 网联特参账户',
      from: 'NETSUNION',
      to: 'PAYLAB',
      amount: A - networkFee,
      entries: [
        line('NETSUNION', 'PAYABLE', A - networkFee, 0, '结清对支付机构应付'),
        line('NETSUNION', 'RESERVE_PBOC', 0, A - networkFee, '特参账户向支付机构划付'),
        line('PAYLAB', 'RESERVE_PBOC', A - networkFee, 0, '备付金账户收款'),
        line('PAYLAB', 'INTERBANK_RECEIVABLE', 0, A - networkFee, '网联待清算'),
        line('PBOC', 'RESERVE_NETSUNION', A - networkFee, 0, '网联特参账户减少'),
        line('PBOC', 'RESERVE_PAYLAB', 0, A - networkFee, '支付机构备付金增加')
      ]
    }),
    makeLeg(4, {
      key: 'agency-posting',
      title: '支付机构确认代收款项',
      detail: '支付机构把代收资金记为负债“代收代付款项”，并确认代理服务费收入。',
      system: '支付机构账务',
      from: 'PAYLAB',
      to: 'UTILITY',
      amount: A,
      entries: [
        line('PAYLAB', 'INTERBANK_RECEIVABLE', A - networkFee, 0, '清算资金到账'),
        line('PAYLAB', 'SETTLED_FUND', 0, payeeNet, options.payee),
        line('PAYLAB', 'FEE_INCOME', 0, platformFee, '代理服务费收入')
      ]
    }),
    makeLeg(5, {
      key: 'utility-remit',
      title: '代收资金划转公用事业单位',
      detail: `支付机构把 ¥${(payeeNet / 100).toFixed(2)} 划转至公用事业单位开户行，代收负债清零。`,
      system: '网联 / 央行清算',
      from: 'PAYLAB',
      to: 'ABC',
      amount: payeeNet,
      entries: [
        line('PAYLAB', 'SETTLED_FUND', payeeNet, 0, '划转公用事业单位'),
        line('PAYLAB', 'RESERVE_PBOC', 0, payeeNet, '备付金出款'),
        line('ABC', 'RESERVE_PBOC', payeeNet, 0, '收到代收资金'),
        line('ABC', 'DEPOSITS', 0, payeeNet, options.payee),
        line('PBOC', 'RESERVE_PAYLAB', payeeNet, 0, '支付机构备付金减少'),
        line('PBOC', 'RESERVE_ABC', 0, payeeNet, '农业银行准备金增加')
      ]
    })
  ];
  return {
    type: 'utility',
    typeName: SCENARIO_MAP.utility.name,
    network: SCENARIO_MAP.utility.network,
    amount: A,
    fee,
    networkFee,
    platformFee,
    payeeNet,
    legs
  };
}

function buildTopupFlow(options) {
  const A = options.amount;
  const { fee } = feeParts('topup', A, options.feeOverride);
  const legs = [
    makeLeg(0, {
      key: 'issuer-debit',
      title: '银行卡扣款',
      detail: `${INSTITUTIONS.ICBC.name}从用户银行卡扣款，形成网联待清算款。`,
      system: '发卡行核心',
      from: 'ICBC',
      to: 'NETSUNION',
      amount: A,
      entries: [
        line('ICBC', 'DEPOSITS', A, 0, options.payer),
        line('ICBC', 'INTERBANK_PAYABLE', 0, A, '网联待清算')
      ]
    }),
    makeLeg(1, {
      key: 'network-clearing',
      title: '网联清算',
      detail: '网联登记付款行与支付机构之间的清算应收应付。',
      system: '网联清算',
      from: 'NETSUNION',
      to: 'PAYLAB',
      amount: A,
      entries: [
        line('NETSUNION', 'RECEIVABLE', A, 0, '工商银行'),
        line('NETSUNION', 'PAYABLE', 0, A, 'PayLab 支付机构')
      ]
    }),
    makeLeg(2, {
      key: 'netsunion-sp-receive',
      title: '网联特参账户收款',
      detail: `${INSTITUTIONS.ICBC.name}的扣款净额经人民银行 ACS 记入网联特许参与者账户。`,
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
    }),
    makeLeg(3, {
      key: 'netsunion-sp-payout',
      title: '特参账户向支付机构划付',
      detail: '网联从特参账户向支付机构备付金账户划付充值资金。',
      system: '人民银行 ACS · 网联特参账户',
      from: 'NETSUNION',
      to: 'PAYLAB',
      amount: A,
      entries: [
        line('NETSUNION', 'PAYABLE', A, 0, '结清对支付机构应付'),
        line('NETSUNION', 'RESERVE_PBOC', 0, A, '特参账户向支付机构划付'),
        line('PAYLAB', 'RESERVE_PBOC', A, 0, '备付金账户收款'),
        line('PAYLAB', 'INTERBANK_RECEIVABLE', 0, A, '网联待清算'),
        line('PBOC', 'RESERVE_NETSUNION', A, 0, '网联特参账户减少'),
        line('PBOC', 'RESERVE_PAYLAB', 0, A, '支付机构备付金增加')
      ]
    }),
    makeLeg(4, {
      key: 'wallet-posting',
      title: '支付机构确认钱包余额',
      detail: '支付机构资产（备付金）与负债（钱包余额）同时增加，充值不确认收入。',
      system: '支付机构账务',
      from: 'PAYLAB',
      to: 'USER',
      amount: A,
      entries: [
        line('PAYLAB', 'INTERBANK_RECEIVABLE', A, 0, '清算资金到账'),
        line('PAYLAB', 'WALLET_LIABILITY', 0, A, options.payee || options.payer)
      ]
    })
  ];
  return {
    type: 'topup',
    typeName: SCENARIO_MAP.topup.name,
    network: SCENARIO_MAP.topup.network,
    amount: A,
    fee,
    networkFee: 0,
    platformFee: fee,
    payeeNet: A,
    legs
  };
}

function buildWithdrawFlow(options) {
  const A = options.amount;
  const { fee } = feeParts('withdraw', A, options.feeOverride);
  const legs = [
    makeLeg(0, {
      key: 'wallet-debit',
      title: '支付机构扣减钱包余额',
      detail: `用户钱包减少 ¥${((A + fee) / 100).toFixed(2)}，其中 ¥${(fee / 100).toFixed(2)} 为提现手续费收入。`,
      system: '支付机构账务',
      from: 'PAYLAB',
      to: 'NETSUNION',
      amount: A,
      entries: [
        line('PAYLAB', 'WALLET_LIABILITY', A + fee, 0, options.payer),
        line('PAYLAB', 'INTERBANK_PAYABLE', 0, A, '网联待清算'),
        line('PAYLAB', 'FEE_INCOME', 0, fee, '提现手续费')
      ]
    }),
    makeLeg(1, {
      key: 'network-clearing',
      title: '网联清算',
      detail: '网联登记支付机构应付与收款行应收。',
      system: '网联清算',
      from: 'NETSUNION',
      to: 'ICBC',
      amount: A,
      entries: [
        line('NETSUNION', 'RECEIVABLE', A, 0, 'PayLab 支付机构'),
        line('NETSUNION', 'PAYABLE', 0, A, '工商银行')
      ]
    }),
    makeLeg(2, {
      key: 'netsunion-sp-receive',
      title: '网联特参账户收款',
      detail: '支付机构备付金经人民银行 ACS 划入网联特许参与者账户。',
      system: '人民银行 ACS · 网联特参账户',
      from: 'PAYLAB',
      to: 'NETSUNION',
      amount: A,
      entries: [
        line('PAYLAB', 'INTERBANK_PAYABLE', A, 0, '结清网联待清算'),
        line('PAYLAB', 'RESERVE_PBOC', 0, A, '备付金减少'),
        line('NETSUNION', 'RESERVE_PBOC', A, 0, '特参账户收到清算款'),
        line('NETSUNION', 'RECEIVABLE', 0, A, '结清对支付机构应收'),
        line('PBOC', 'RESERVE_PAYLAB', A, 0, '支付机构备付金减少'),
        line('PBOC', 'RESERVE_NETSUNION', 0, A, '网联特参账户增加')
      ]
    }),
    makeLeg(3, {
      key: 'netsunion-sp-payout',
      title: '特参账户向收款行划付',
      detail: '网联从特参账户向工商银行准备金账户划付提现资金。',
      system: '人民银行 ACS · 网联特参账户',
      from: 'NETSUNION',
      to: 'ICBC',
      amount: A,
      entries: [
        line('NETSUNION', 'PAYABLE', A, 0, '结清对工行应付'),
        line('NETSUNION', 'RESERVE_PBOC', 0, A, '特参账户向收款行划付'),
        line('ICBC', 'RESERVE_PBOC', A, 0, '收到提现清算款'),
        line('ICBC', 'INTERBANK_RECEIVABLE', 0, A, '网联待清算'),
        line('PBOC', 'RESERVE_NETSUNION', A, 0, '网联特参账户减少'),
        line('PBOC', 'RESERVE_ICBC', 0, A, '工商银行准备金增加')
      ]
    }),
    makeLeg(4, {
      key: 'bank-credit',
      title: '收款行入账',
      detail: '收款行把提现金额记入用户银行卡存款账户。',
      system: '收款行核心',
      from: 'ICBC',
      to: 'USER',
      amount: A,
      entries: [
        line('ICBC', 'INTERBANK_RECEIVABLE', A, 0, '提现清算款'),
        line('ICBC', 'DEPOSITS', 0, A, options.payee || options.payer)
      ]
    })
  ];
  return {
    type: 'withdraw',
    typeName: SCENARIO_MAP.withdraw.name,
    network: SCENARIO_MAP.withdraw.network,
    amount: A,
    fee,
    networkFee: 0,
    platformFee: fee,
    payeeNet: A,
    legs
  };
}

function buildWalletFlow(options) {
  const A = options.amount;
  const { fee, payeeNet } = feeParts('wallet', A, options.feeOverride);
  const legs = [
    makeLeg(0, {
      key: 'wallet-transfer',
      title: '钱包余额支付',
      detail: '支付机构内部完成负债转移：钱包余额减少，商户待结算款增加，并确认手续费收入。',
      system: '支付机构内部账务',
      from: 'PAYLAB',
      to: 'MERCHANT',
      amount: A,
      entries: [
        line('PAYLAB', 'WALLET_LIABILITY', A, 0, options.payer),
        line('PAYLAB', 'MERCHANT_PAYABLE', 0, payeeNet, options.payee),
        line('PAYLAB', 'FEE_INCOME', 0, fee, '支付服务费')
      ]
    })
  ];
  return {
    type: 'wallet',
    typeName: SCENARIO_MAP.wallet.name,
    network: SCENARIO_MAP.wallet.network,
    amount: A,
    fee,
    networkFee: 0,
    platformFee: fee,
    payeeNet,
    legs
  };
}

function buildCrossBorderFlow(options) {
  const A = options.amount;
  const fxRate = options.fxRate || 7.24;
  const foreignCurrency = options.foreignCurrency || 'USD';
  const foreignAmount = options.foreignAmount !== undefined && options.foreignAmount !== null
    ? Math.round(options.foreignAmount)
    : Math.round(A / fxRate);
  const foreignText = `${foreignCurrency} ${(foreignAmount / 100).toFixed(2)}`;
  const { fee, networkFee, platformFee, payeeNet } = feeParts('cross_border', A, options.feeOverride);
  const legs = [
    makeLeg(0, {
      key: 'overseas-acquirer-debit',
      title: '境外收单行扣减持卡人资金',
      detail: `${INSTITUTIONS.HSBC.name}扣减境外持卡人 ${foreignText}，按 ${fxRate} 折算为人民币 ¥${(A / 100).toFixed(2)}，形成对境内代理行的待清算应付款。`,
      system: '境外收单行核心',
      from: 'HSBC',
      to: 'CCB',
      amount: A,
      entries: [
        line('HSBC', 'DEPOSITS', A, 0, options.payer),
        line('HSBC', 'INTERBANK_PAYABLE', 0, A, '境内代理行待清算')
      ]
    }),
    makeLeg(1, {
      key: 'cips-clearing',
      title: 'CIPS 转接与轧差',
      detail: `CIPS 受理跨境支付指令，登记境外代理行应收与支付机构应付，并扣收跨境清算服务费 ¥${(networkFee / 100).toFixed(2)}。`,
      system: 'CIPS 跨境清算',
      from: 'CIPS',
      to: 'PAYLAB',
      amount: A,
      entries: [
        line('CIPS', 'RECEIVABLE', A, 0, '境外代理行'),
        line('CIPS', 'PAYABLE', 0, A - networkFee, 'PayLab 支付机构'),
        line('CIPS', 'FEE_INCOME', 0, networkFee, '跨境清算服务费')
      ]
    }),
    makeLeg(2, {
      key: 'pboc-final-settlement',
      title: '央行准备金账户最终清算',
      detail: '境外代理行通过存放在建设银行的同业存款支付，CIPS 与支付机构的清算备付金在央行完成最终划拨。',
      system: 'CIPS / 人民银行',
      from: 'PBOC',
      to: 'HSBC',
      amount: A,
      entries: [
        line('HSBC', 'INTERBANK_PAYABLE', A, 0, '结清境内代理行应付款'),
        line('HSBC', 'DUE_FROM_BANKS', 0, A, '动用境内代理行同业存款'),
        line('CCB', 'DUE_TO_BANKS', A, 0, '境外代理行存款减少'),
        line('CCB', 'RESERVE_PBOC', 0, A, '向 CIPS 划付'),
        line('CIPS', 'RESERVE_PBOC', A, 0, '收到跨境清算款'),
        line('CIPS', 'RECEIVABLE', 0, A, '结清对境外代理行应收'),
        line('CIPS', 'PAYABLE', A - networkFee, 0, '结清对支付机构应付'),
        line('CIPS', 'RESERVE_PBOC', 0, A - networkFee, '向支付机构划付'),
        line('PAYLAB', 'RESERVE_PBOC', A - networkFee, 0, '跨境清算款到账'),
        line('PAYLAB', 'INTERBANK_RECEIVABLE', 0, A - networkFee, 'CIPS 待清算'),
        line('PBOC', 'RESERVE_CCB', A, 0, '建设银行准备金减少'),
        line('PBOC', 'RESERVE_PAYLAB', 0, A - networkFee, '支付机构备付金增加'),
        line('PBOC', 'RESERVE_CIPS', 0, networkFee, 'CIPS 备付金增加')
      ]
    }),
    makeLeg(3, {
      key: 'paylab-fx-posting',
      title: '支付机构结汇入账',
      detail: `支付机构按 ${fxRate} 将 ${foreignText} 结汇为人民币，确认商户待结算款与跨境收单手续费收入。`,
      system: '支付机构账务',
      from: 'PAYLAB',
      to: 'MERCHANT',
      amount: A,
      entries: [
        line('PAYLAB', 'INTERBANK_RECEIVABLE', A - networkFee, 0, '跨境清算资金到账'),
        line('PAYLAB', 'MERCHANT_PAYABLE', 0, payeeNet, options.payee),
        line('PAYLAB', 'FEE_INCOME', 0, platformFee, '跨境收单服务费收入')
      ]
    }),
    makeLeg(4, {
      key: 'merchant-settlement',
      title: '商户结算出款',
      detail: `支付机构把商户净额 ¥${(payeeNet / 100).toFixed(2)} 结算至商户开户行，备付金相应减少。`,
      system: 'CIPS / 央行清算',
      from: 'PAYLAB',
      to: 'CCB',
      amount: payeeNet,
      entries: [
        line('PAYLAB', 'MERCHANT_PAYABLE', payeeNet, 0, '商户结算'),
        line('PAYLAB', 'RESERVE_PBOC', 0, payeeNet, '备付金出款'),
        line('CCB', 'RESERVE_PBOC', payeeNet, 0, '收到商户结算款'),
        line('CCB', 'DEPOSITS', 0, payeeNet, options.payee),
        line('PBOC', 'RESERVE_PAYLAB', payeeNet, 0, '支付机构备付金减少'),
        line('PBOC', 'RESERVE_CCB', 0, payeeNet, '建设银行准备金增加')
      ]
    })
  ];
  return {
    type: 'cross_border',
    typeName: SCENARIO_MAP.cross_border.name,
    network: SCENARIO_MAP.cross_border.network,
    amount: A,
    fee,
    networkFee,
    platformFee,
    payeeNet,
    fxRate,
    foreignCurrency,
    foreignAmount,
    legs
  };
}

function buildFlow(options) {
  if (options.type === 'goods') return buildGoodsFlow(options);
  if (options.type === 'card') return buildCardFlow(options);
  if (options.type === 'utility') return buildUtilityFlow(options);
  if (options.type === 'topup') return buildTopupFlow(options);
  if (options.type === 'withdraw') return buildWithdrawFlow(options);
  if (options.type === 'wallet') return buildWalletFlow(options);
  if (options.type === 'cross_border') return buildCrossBorderFlow(options);
  throw httpError(400, '不支持的清算场景');
}

function createFlowInternal(options) {
  const state = ensureState();
  const built = buildFlow(options);
  const flow = {
    id: rid('FLOW'),
    no: rid('CL'),
    type: built.type,
    typeName: built.typeName,
    network: built.network,
    amount: built.amount,
    fee: built.fee,
    networkFee: built.networkFee,
    platformFee: built.platformFee,
    payeeNet: built.payeeNet,
    fxRate: built.fxRate || null,
    foreignCurrency: built.foreignCurrency || null,
    foreignAmount: built.foreignAmount || null,
    payer: options.payer,
    payee: options.payee,
    status: 'PROCESSING',
    currentLeg: 0,
    legs: built.legs,
    createdAt: options.createdAt || nowIso(),
    completedAt: null,
    source: options.paymentId ? 'PAYMENT' : 'MANUAL',
    paymentId: options.paymentId || null
  };
  state.flows.unshift(flow);
  return flow;
}

function legTimestamp(flow, index) {
  return new Date(new Date(flow.createdAt).getTime() + (index + 1) * 30000).toISOString();
}

function executeNextInternal(flow, ts) {
  if (flow.status === 'DONE') throw httpError(409, '该资金链路已执行完成');
  const leg = flow.legs[flow.currentLeg];
  if (!leg) throw httpError(409, '没有待执行的处理环节');
  if (leg.status === 'DONE') throw httpError(409, '该环节已执行');
  const executedAt = ts || nowIso();
  leg.status = 'DONE';
  leg.executedAt = executedAt;
  postJournal({
    flowId: flow.id,
    legIndex: leg.index,
    source: 'CLEARING',
    scenario: flow.type,
    title: `${flow.typeName} · ${leg.title}`,
    ts: executedAt,
    lines: leg.entries,
    save: false
  });
  flow.currentLeg += 1;
  if (flow.currentLeg >= flow.legs.length) {
    flow.status = 'DONE';
    flow.completedAt = executedAt;
  }
  return leg;
}

function runFlowObject(flow, tsBase) {
  let guard = 0;
  while (flow.status !== 'DONE' && guard <= flow.legs.length) {
    const leg = flow.legs[flow.currentLeg];
    const ts = tsBase ? new Date(new Date(tsBase).getTime() + (leg.index + 1) * 30000).toISOString() : nowIso();
    executeNextInternal(flow, ts);
    guard += 1;
  }
  return flow;
}

function createFlow(body) {
  const type = String(body.type || '');
  const scenario = SCENARIO_MAP[type];
  if (!scenario) throw httpError(400, '请选择正确的清算场景');
  const amount = toCents(body.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 50000000) {
    throw httpError(400, '清算金额需在 0.01 ~ 500,000.00 元之间');
  }
  const payer = String(body.payer || scenario.payer || 'U10001').trim().slice(0, 40);
  const payee = String(body.payee || scenario.payee || '收款方').trim().slice(0, 40);
  const flow = createFlowInternal({
    type,
    amount,
    payer,
    payee,
    feeOverride: body.fee !== undefined ? toCents(body.fee) : undefined,
    createdAt: nowIso()
  });
  if (body.autoRun) {
    runFlowObject(flow);
  }
  store.save();
  return flowDetail(flow);
}

function findFlow(id) {
  const flow = ensureState().flows.find((item) => item.id === id);
  if (!flow) throw httpError(404, '资金链路不存在');
  return flow;
}

function stepFlow(id) {
  const flow = findFlow(id);
  executeNextInternal(flow);
  store.save();
  return flowDetail(flow);
}

function runFlow(id) {
  const flow = findFlow(id);
  runFlowObject(flow);
  store.save();
  return flowDetail(flow);
}

function accountBalances(institution) {
  const inst = INSTITUTIONS[institution];
  if (!inst) throw httpError(404, '机构不存在');
  const rows = Object.entries(inst.chart).map(([code, meta]) => ({
    code,
    name: meta.name,
    type: meta.type,
    typeLabel: ACCOUNT_TYPES[meta.type] ? ACCOUNT_TYPES[meta.type].label : meta.type,
    desc: meta.desc,
    debit: 0,
    credit: 0,
    balance: 0,
    normalSide: ACCOUNT_TYPES[meta.type] ? ACCOUNT_TYPES[meta.type].normal : 'DEBIT'
  }));
  const index = Object.fromEntries(rows.map((row) => [row.code, row]));
  for (const entry of ensureState().journal) {
    for (const item of entry.lines) {
      if (item.institution !== institution) continue;
      const row = index[item.code];
      if (!row) continue;
      row.debit += item.debit;
      row.credit += item.credit;
    }
  }
  for (const row of rows) {
    row.balance = row.normalSide === 'DEBIT' ? row.debit - row.credit : row.credit - row.debit;
  }
  return rows;
}

function accountBalance(institution, code) {
  const row = accountBalances(institution).find((item) => item.code === code);
  return row ? row.balance : 0;
}

function globalTrial() {
  let debit = 0;
  let credit = 0;
  const journal = ensureState().journal;
  for (const entry of journal) {
    for (const item of entry.lines) {
      debit += item.debit;
      credit += item.credit;
    }
  }
  return {
    debit,
    credit,
    balanced: debit === credit,
    entryCount: journal.length
  };
}

function flowSummary(flow) {
  const done = flow.legs.filter((leg) => leg.status === 'DONE').length;
  return {
    id: flow.id,
    no: flow.no,
    type: flow.type,
    typeName: flow.typeName,
    network: flow.network,
    amount: flow.amount,
    fee: flow.fee,
    networkFee: flow.networkFee,
    platformFee: flow.platformFee,
    payeeNet: flow.payeeNet,
    fxRate: flow.fxRate || null,
    foreignCurrency: flow.foreignCurrency || null,
    foreignAmount: flow.foreignAmount || null,
    payer: flow.payer,
    payee: flow.payee,
    status: flow.status,
    currentLeg: flow.currentLeg,
    legTotal: flow.legs.length,
    legDone: done,
    createdAt: flow.createdAt,
    completedAt: flow.completedAt,
    source: flow.source,
    paymentId: flow.paymentId,
    legs: flow.legs.map((leg) => ({
      index: leg.index,
      title: leg.title,
      status: leg.status,
      system: leg.system,
      from: leg.from,
      to: leg.to,
      fromName: leg.fromName,
      toName: leg.toName,
      amount: leg.amount
    }))
  };
}

function flowDetail(flow) {
  const journal = ensureState().journal
    .filter((entry) => entry.flowId === flow.id)
    .sort((a, b) => a.legIndex - b.legIndex);
  const map = new Map();
  for (const entry of journal) {
    for (const item of entry.lines) {
      const key = `${item.institution}|${item.code}`;
      if (!map.has(key)) {
        map.set(key, {
          institution: item.institution,
          institutionName: item.institutionName,
          code: item.code,
          accountName: item.accountName,
          accountType: item.accountType,
          debit: 0,
          credit: 0
        });
      }
      const row = map.get(key);
      row.debit += item.debit;
      row.credit += item.credit;
    }
  }
  const summaries = [...map.values()].map((row) => ({
    ...row,
    net: row.debit - row.credit
  }));
  const debit = summaries.reduce((sum, row) => sum + row.debit, 0);
  const credit = summaries.reduce((sum, row) => sum + row.credit, 0);
  return {
    ...flowSummary(flow),
    legs: flow.legs,
    journal,
    summaries,
    trial: { debit, credit, balanced: debit === credit }
  };
}

function flowDetailById(id) {
  return flowDetail(findFlow(id));
}

function listFlows(limit = 30) {
  return ensureState().flows
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit)
    .map(flowSummary);
}

function ensurePaymentFlow(payment, options = {}) {
  if (!payment || payment.status !== 'SUCCESS') return null;
  const state = ensureState();
  const existing = state.flows.find((flow) => flow.paymentId === payment.id);
  if (existing) return existing;
  let type = 'goods';
  if (payment.channel === 'balance') type = 'wallet';
  else if (payment.channel === 'unionpay') type = 'card';
  if (payment.crossBorder) type = 'cross_border';
  const flow = createFlowInternal({
    type,
    amount: payment.amount,
    payer: payment.buyer,
    payee: payment.merchantName,
    feeOverride: payment.fee || 0,
    fxRate: payment.crossBorder ? payment.crossBorder.fxRate : undefined,
    foreignCurrency: payment.crossBorder ? payment.crossBorder.foreignCurrency : undefined,
    foreignAmount: payment.crossBorder ? payment.crossBorder.foreignAmount : undefined,
    paymentId: payment.id,
    createdAt: payment.paidAt || payment.createdAt
  });
  if (options.autoRun !== false) {
    runFlowObject(flow, flow.createdAt);
  }
  if (options.save !== false) store.save();
  return flow;
}

function flowSummaryForPayment(paymentId) {
  const flow = ensureState().flows.find((item) => item.paymentId === paymentId);
  return flow ? flowSummary(flow) : null;
}

function flowDetailForPayment(paymentId) {
  const flow = ensureState().flows.find((item) => item.paymentId === paymentId);
  return flow ? flowDetail(flow) : null;
}

function institutionList() {
  return Object.values(INSTITUTIONS).map((inst) => ({
    code: inst.code,
    name: inst.name,
    short: inst.short,
    category: inst.category,
    role: inst.role,
    color: inst.color,
    chart: Object.entries(inst.chart).map(([code, meta]) => ({
      code,
      name: meta.name,
      type: meta.type,
      typeLabel: ACCOUNT_TYPES[meta.type] ? ACCOUNT_TYPES[meta.type].label : meta.type,
      desc: meta.desc
    }))
  }));
}

function clearingView() {
  const state = ensureState();
  const flows = state.flows
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const trial = globalTrial();
  const volume = flows.reduce((sum, flow) => sum + flow.amount, 0);
  const fee = flows.reduce((sum, flow) => sum + flow.fee, 0);
  const done = flows.filter((flow) => flow.status === 'DONE').length;
  return {
    scenarios: SCENARIOS,
    institutions: institutionList().map((inst) => ({
      ...inst,
      balances: accountBalances(inst.code)
    })),
    flows: flows.slice(0, 30).map(flowSummary),
    kpis: {
      count: flows.length,
      volume,
      fee,
      done,
      pending: flows.length - done,
      institutionCount: Object.keys(INSTITUTIONS).length,
      journalCount: state.journal.length,
      balanced: trial.balanced,
      debit: trial.debit,
      credit: trial.credit
    },
    recentJournal: state.journal.slice(0, 12),
    trial
  };
}

function seedFlows(payments) {
  const state = ensureState();
  if (state.journal.length === 0) {
    postJournal({
      source: 'OPENING',
      scenario: 'opening',
      title: '期初资产负债表 · 准备金投放与客户存款',
      ts: new Date(Date.now() - 5 * 86400000).toISOString(),
      lines: [
        line('PBOC', 'ASSETS', 2000000, 0, '期初准备金投放'),
        line('ICBC', 'RESERVE_PBOC', 800000, 0, '期初准备金'),
        line('CCB', 'RESERVE_PBOC', 700000, 0, '期初准备金'),
        line('ABC', 'RESERVE_PBOC', 500000, 0, '期初准备金'),
        line('PBOC', 'RESERVE_ICBC', 0, 800000, '工商银行准备金'),
        line('PBOC', 'RESERVE_CCB', 0, 700000, '建设银行准备金'),
        line('PBOC', 'RESERVE_ABC', 0, 500000, '农业银行准备金'),
        line('ICBC', 'DEPOSITS', 0, 800000, '云栖科技有限公司'),
        line('CCB', 'DEPOSITS', 0, 700000, '云栖优选商城'),
        line('ABC', 'DEPOSITS', 0, 500000, '市自来水公司')
      ],
      save: false
    });
  }
  if (state.flows.length) return;
  const day = (offset, hour, minute) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    date.setHours(hour, minute, 0, 0);
    return date.toISOString();
  };
  const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

  const examples = [
    {
      type: 'goods', amount: 12800, payer: 'U20001', payee: '云栖优选商城',
      createdAt: day(-1, 10, 15), run: 6
    },
    {
      type: 'utility', amount: 20000, payer: '张伟', payee: '市自来水公司',
      createdAt: day(-1, 15, 20), run: 6
    },
    {
      type: 'card', amount: 26800, payer: 'U10003', payee: '云栖数码',
      createdAt: minutesAgo(180), run: 4
    },
    {
      type: 'topup', amount: 50000, payer: '李娜', payee: '李娜钱包',
      createdAt: minutesAgo(120), run: 5
    },
    {
      type: 'withdraw', amount: 30000, payer: '李娜钱包', payee: '李娜',
      createdAt: minutesAgo(45), run: 2
    },
    {
      type: 'goods', amount: 6600, payer: 'U10009', payee: '云栖优选商城',
      createdAt: minutesAgo(8), run: 0
    },
    {
      type: 'cross_border', amount: 72400, payer: 'U-FOREIGN-01', payee: '云栖优选商城',
      createdAt: minutesAgo(20), run: 3, fxRate: 7.24, foreignCurrency: 'USD', foreignAmount: 10000
    }
  ];

  for (const example of examples) {
    const flow = createFlowInternal(example);
    for (let index = 0; index < example.run; index += 1) {
      executeNextInternal(flow, legTimestamp(flow, index));
    }
  }

  for (const payment of payments || []) {
    if (payment.status === 'SUCCESS') {
      ensurePaymentFlow(payment, { autoRun: true, save: false });
    }
  }
  store.save();
}

module.exports = {
  INSTITUTIONS,
  ACCOUNT_TYPES,
  SCENARIOS,
  ensureState,
  postJournal,
  createFlow,
  stepFlow,
  runFlow,
  flowDetailById,
  flowDetailForPayment,
  flowSummaryForPayment,
  ensurePaymentFlow,
  listFlows,
  accountBalances,
  accountBalance,
  globalTrial,
  clearingView,
  seedFlows
};
