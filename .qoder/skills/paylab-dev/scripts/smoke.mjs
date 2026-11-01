#!/usr/bin/env node
'use strict';

// Read-only health check for a running PayLab instance.
// Usage: node smoke.mjs [port]   (default: 5178, or $PORT)

const port = process.argv[2] || process.env.PORT || '5178';
const base = `http://127.0.0.1:${port}`;
let failures = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function getJson(path) {
  const res = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (!body.ok) throw new Error(body.error || 'ok=false');
  return body.data;
}

async function getText(path) {
  const res = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function check(name, fn) {
  try {
    const note = await fn();
    console.log(`ok   ${name}${note ? ` — ${note}` : ''}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name} — ${error.message}`);
  }
}

console.log(`PayLab smoke · ${base}\n`);

await check('GET /api/meta', async () => {
  const data = await getJson('/api/meta');
  assert(Array.isArray(data.phases) && data.phases.length > 0, '缺少 phases');
  assert(data.phases.some((phase) => phase.key === 'done'), '缺少结束阶段 done');
  assert(Array.isArray(data.scenarios) && data.scenarios.length > 0, '缺少支付场景');
  assert(Array.isArray(data.clearingScenarios) && data.clearingScenarios.length > 0, '缺少清算场景');
  assert(Array.isArray(data.institutions) && data.institutions.length > 0, '缺少清算机构');
  assert(Array.isArray(data.channels) && data.channels.length > 0, '缺少支付渠道');
  return `${data.phases.length} 阶段 · ${data.scenarios.length} 支付场景 · ${data.clearingScenarios.length} 清算场景 · ${data.institutions.length} 机构`;
});

await check('GET /api/summary', async () => {
  const data = await getJson('/api/summary');
  assert(data.kpis && typeof data.kpis.gmv === 'number', 'KPI 结构异常');
  assert(Array.isArray(data.recent), 'recent 不是数组');
  return `GMV ¥${(data.kpis.gmv / 100).toFixed(2)} · ${data.kpis.count} 笔今日交易`;
});

await check('GET /api/payments', async () => {
  const data = await getJson('/api/payments?limit=1');
  assert(Array.isArray(data.payments), 'payments 不是数组');
  return `${data.payments.length} 条返回`;
});

await check('GET /api/refunds', async () => {
  const data = await getJson('/api/refunds');
  assert(Array.isArray(data.refunds), 'refunds 不是数组');
  return `${data.refunds.length} 条退款`;
});

await check('GET /api/reconcile', async () => {
  const data = await getJson('/api/reconcile');
  assert(data && typeof data === 'object', '对账视图为空');
  return '对账视图可读';
});

await check('GET /api/settlements', async () => {
  const data = await getJson('/api/settlements');
  assert(data && typeof data === 'object', '结算视图为空');
  return '结算视图可读';
});

await check('GET /api/risk', async () => {
  const data = await getJson('/api/risk');
  assert(Array.isArray(data.rules) && data.rules.length > 0, '风控规则为空');
  return `${data.rules.length} 条规则`;
});

await check('GET /api/clearing', async () => {
  const data = await getJson('/api/clearing');
  assert(Array.isArray(data.institutions) && data.institutions.length > 0, '缺少机构');
  assert(Array.isArray(data.scenarios) && data.scenarios.length > 0, '缺少清算场景');
  assert(Array.isArray(data.flows), 'flows 不是数组');
  assert(data.trial && typeof data.trial.entryCount === 'number', '缺少全局试算');
  assert(data.trial.balanced === true, `全局试算不平衡：借 ${data.trial.debit} / 贷 ${data.trial.credit}`);
  for (const inst of data.institutions) {
    assert(Array.isArray(inst.balances), `${inst.code} 缺少科目余额`);
  }
  return `${data.flows.length} 条链路 · ${data.trial.entryCount} 张分录 · 试算平衡`;
});

await check('GET /api/clearing/flows/:id', async () => {
  const data = await getJson('/api/clearing');
  if (!data.flows.length) return '无链路，跳过';
  const flow = await getJson(`/api/clearing/flows/${encodeURIComponent(data.flows[0].id)}`);
  assert(Array.isArray(flow.legs), '链路缺少 legs');
  assert(flow.trial && typeof flow.trial.balanced === 'boolean', '链路缺少试算');
  assert(flow.trial.balanced === true, '链路分录不平衡');
  return `${flow.no} · ${flow.legs.length} 环节 · 借贷平衡`;
});

await check('GET /api/banking', async () => {
  const data = await getJson('/api/banking');
  assert(Array.isArray(data.banks) && data.banks.length > 0, '银行列表为空');
  return `${data.banks.length} 家银行`;
});

await check('GET /api/logs', async () => {
  const data = await getJson('/api/logs?limit=1');
  assert(Array.isArray(data.logs), 'logs 不是数组');
  return `${data.logs.length} 条返回`;
});

await check('静态资源与主题', async () => {
  const html = await getText('/');
  assert(html.includes('theme-picker'), '首页缺少主题选择器');
  assert(html.includes('/css/theme.css'), '首页未加载 theme.css');
  assert(html.includes('paylab.theme'), '首页缺少主题首屏脚本');
  const themeCss = await getText('/css/theme.css');
  assert(themeCss.includes('[data-theme="light"]'), 'theme.css 缺少浅色主题');
  const themeJs = await getText('/js/theme.js');
  assert(themeJs.includes("const THEMES"), 'theme.js 缺少 THEMES');
  return '外壳、主题样式与切换脚本可读';
});

console.log('');
if (failures) {
  console.log(`结果：${failures} 项失败`);
  process.exit(1);
}
console.log('结果：全部通过');
