'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

let state = null;
let fresh = false;
let saveTimer = null;

function defaultRules() {
  return [
    {
      id: 'R001',
      name: '单笔金额阈值',
      desc: '单笔 ≥ 5,000 元转人工审核；≥ 50,000 元直接拦截',
      enabled: true,
      level: 'REVIEW',
      params: { reviewAmount: 500000, blockAmount: 5000000 }
    },
    {
      id: 'R002',
      name: '夜间大额交易',
      desc: '00:00 - 06:00 期间，单笔 ≥ 1,000 元需人工复核',
      enabled: true,
      level: 'REVIEW',
      params: { startHour: 0, endHour: 6, minAmount: 100000 }
    },
    {
      id: 'R003',
      name: '黑名单用户',
      desc: '命中黑名单的买家直接阻断支付',
      enabled: true,
      level: 'BLOCK',
      params: { users: ['U-BLACKLIST', 'U-6666'] }
    },
    {
      id: 'R004',
      name: '高频交易',
      desc: '同一买家 60 秒内发起 ≥ 5 笔支付',
      enabled: true,
      level: 'BLOCK',
      params: { windowSec: 60, maxCount: 5 }
    },
    {
      id: 'R005',
      name: '新设备异地支付',
      desc: '新设备首次支付且金额 ≥ 2,000 元需复核',
      enabled: false,
      level: 'REVIEW',
      params: { minAmount: 200000 }
    }
  ];
}

function baseState() {
  return {
    orders: [],
    payments: [],
    refunds: [],
    ledger: [],
    batches: [],
    bills: [],
    reconRuns: [],
    risks: { rules: defaultRules(), checks: [] },
    interbank: { flows: [], journal: [], ops: [] },
    logs: [],
    meta: {
      version: 1,
      createdAt: new Date().toISOString(),
      seeded: false
    }
  };
}

function init() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(STATE_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (parsed && parsed.meta && Array.isArray(parsed.payments)) {
        state = parsed;
        if (!state.interbank || typeof state.interbank !== 'object') {
          state.interbank = { flows: [], journal: [], ops: [] };
        }
        if (!Array.isArray(state.interbank.flows)) state.interbank.flows = [];
        if (!Array.isArray(state.interbank.journal)) state.interbank.journal = [];
        if (!Array.isArray(state.interbank.ops)) state.interbank.ops = [];
        fresh = false;
      }
    } catch (error) {
      console.warn('[store] 状态文件读取失败，将重建：', error.message);
    }
  }
  if (!state) {
    state = baseState();
    fresh = true;
  }
  return fresh;
}

function isFresh() {
  return fresh;
}

function markSeeded() {
  fresh = false;
  state.meta.seeded = true;
  saveNow();
}

function get() {
  return state;
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persist();
  }, 120);
}

function persist() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.error('[store] 状态持久化失败：', error.message);
  }
}

function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  persist();
}

function pushLog(event) {
  state.logs.unshift(event);
  if (state.logs.length > 1500) state.logs.length = 1500;
}

function reset() {
  state = baseState();
  fresh = true;
  saveNow();
}

module.exports = {
  init,
  isFresh,
  markSeeded,
  get,
  save,
  saveNow,
  pushLog,
  reset,
  defaultRules
};
