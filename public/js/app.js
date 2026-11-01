import { get, post } from './api.js';
import { toast, confirmDialog } from './ui.js';
import { initThemePicker } from './theme.js';
import overview from './views/overview.js';
import payment from './views/payment.js';
import stage from './views/stage.js';
import reliability from './views/reliability.js';
import refund from './views/refund.js';
import reconcile from './views/reconcile.js';
import settlement from './views/settlement.js';
import clearing from './views/clearing.js';
import banking from './views/banking.js';
import risk from './views/risk.js';
import logs from './views/logs.js';

const routes = { overview, payment, stage, reliability, refund, reconcile, settlement, clearing, banking, risk, logs };

const meta = {
  overview: ['总览', '今日交易、资金与风险一屏掌握'],
  payment: ['全链路演练台', '逐步执行 12 个支付阶段，观察每一跳报文与状态变化'],
  stage: ['阶段详情', '查看该阶段涉及的业务数据、报文与会计计算'],
  reliability: ['可靠性实验室', '重复回调、掉单补偿、超时关单与迟到回调的实战演练'],
  refund: ['退款与冲正', '部分退款、退款状态机与账务冲销'],
  reconcile: ['对账中心', '渠道账单生成、自动对账与长短款差异处理'],
  settlement: ['清结算', 'T+1 净额结算、手续费与试算平衡表'],
  clearing: ['清算网络', '网联、银联、CIPS、央行与银行的跨机构资金清算与会计链路'],
  banking: ['银行会计', '存款、贷款、中间业务与支付机构备付金账务'],
  risk: ['风控引擎', '规则配置、实时决策与风险试算'],
  logs: ['报文与日志', '全链路事件追踪、请求响应报文与签名核验']
};

let cleanup = null;

async function route() {
  const raw = location.hash.replace(/^#\//, '') || 'overview';
  const [name, ...params] = raw.split('/');
  const key = routes[name] ? name : 'overview';
  const navKey = key === 'stage' ? 'payment' : key;

  document.querySelectorAll('#nav a').forEach((link) => {
    link.classList.toggle('active', link.dataset.route === navKey);
  });
  document.getElementById('page-title').textContent = meta[key][0];
  document.getElementById('page-sub').textContent = meta[key][1];
  document.title = `${meta[key][0]} · PayLab 支付全链路教学系统`;

  if (cleanup) {
    try {
      cleanup();
    } catch (error) {
      console.error(error);
    }
    cleanup = null;
  }

  const view = document.getElementById('view');
  view.innerHTML = '<div class="loading"><span class="spinner"></span>加载中…</div>';
  try {
    const result = await routes[key].render(view, params);
    cleanup = typeof result === 'function' ? result : null;
  } catch (error) {
    view.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-icon">!</div><h3>页面加载失败</h3><p>${error.message}</p><button class="btn ghost" onclick="location.reload()">重新加载</button></div></div>`;
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

document.getElementById('reset-btn').addEventListener('click', async () => {
  const confirmed = await confirmDialog(
    '重置演示数据',
    '将清空当前所有交易、退款、对账与结算数据，并恢复初始演示数据。此操作不可撤销。',
    '确认重置',
    true
  );
  if (!confirmed) return;
  try {
    await post('/reset');
    toast('演示数据已重置', 'success');
    if (location.hash === '#/overview' || !location.hash) route();
    else location.hash = '#/overview';
  } catch (error) {
    toast(error.message, 'error');
  }
});

window.addEventListener('hashchange', route);
initThemePicker();
route();
