import { get, post } from '../api.js';
import { appState } from '../state.js';
import { esc, money, fmtTime, payBadge, badge, toast } from '../ui.js';

const resultState = { last: null };

const ACTION_META = {
  renotify: {
    label: '重发渠道回调',
    endpoint: 'renotify',
    desc: '模拟渠道重复推送同一笔成功通知，观察幂等拦截，账务不会重复入账。'
  },
  query: {
    label: '主动查单',
    endpoint: 'query',
    desc: '调用渠道查单接口核对真实交易状态，以渠道结果为准。'
  },
  close: {
    label: '超时关单',
    endpoint: 'close',
    desc: '超过支付时效后关闭订单并撤销渠道预下单。'
  },
  late: {
    label: '模拟迟到回调',
    endpoint: 'late-notify',
    desc: '订单关闭后渠道才回调成功：系统补记支付并联动原路退款，账务轧平。'
  }
};

function actionButtons(payment) {
  const buttons = [];
  if (payment.status === 'SUCCESS') buttons.push(['renotify', '重发回调', 'ghost']);
  if (payment.status === 'PAYING' || payment.status === 'EXCEPTION') buttons.push(['query', '主动查单', 'ghost']);
  if (payment.status === 'PAYING') buttons.push(['close', '超时关单', 'danger']);
  if (payment.status === 'CLOSED' && !payment.compensated) buttons.push(['late', '模拟迟到回调', 'primary']);
  if (!buttons.length) return '<span class="muted" style="font-size:11px">暂无可演练动作</span>';
  return buttons.map(([key, label, cls]) => (
    `<button class="btn sm ${cls}" type="button" data-run="${key}" data-id="${payment.id}">${label}</button>`
  )).join('');
}

function resultCard() {
  if (!resultState.last) return '';
  const last = resultState.last;
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-head">
        <div>
          <h2>最近一次演练结果</h2>
          <p class="sub">${esc(last.title)} · 交易 ${esc(last.paymentId)}</p>
        </div>
        <span class="chip">${esc(fmtTime(last.at, true))}</span>
      </div>
      <div class="stack" style="gap:8px">
        ${last.events.map((event) => `
          <div class="result-banner ${event.level === 'error' ? 'error' : event.level === 'warn' ? 'warn' : ''}">
            <span class="result-icon">${event.level === 'error' ? '!' : event.level === 'warn' ? '△' : '✓'}</span>
            <div>
              <strong>${esc(event.title)}</strong><br>
              <span style="font-size:11.5px;opacity:.9">${esc(event.detail || '')}</span>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="row mt-12">
        <button class="btn ghost sm" type="button" data-open="${last.paymentId}">打开交易链路</button>
      </div>
    </div>
  `;
}

function machineGuide() {
  const chip = (text, cls = '') => `<span class="sm-chip ${cls}">${text}</span>`;
  const arrow = '<span class="sm-arrow">→</span>';
  return `
    <div class="state-guide">
      <div class="state-card">
        <h4>支付单状态机 <span class="badge badge-blue">Payment</span></h4>
        <div class="sm-row">${chip('INIT')}${arrow}${chip('PAYING')}${arrow}${chip('SUCCESS', 'ok')}</div>
        <div class="sm-row">${chip('PAYING')}${arrow}${chip('EXCEPTION', 'bad')}${arrow}${chip('SUCCESS', 'ok')}</div>
        <div class="sm-row">${chip('PAYING')}${arrow}${chip('FAILED', 'bad')}</div>
        <div class="sm-row">${chip('INIT')}${arrow}${chip('CLOSED', 'bad')}</div>
        <p>支付终态一旦落定不可回退；重复通知只能触发幂等逻辑，不能再次推进状态。</p>
      </div>
      <div class="state-card">
        <h4>业务订单状态机 <span class="badge badge-gray">Order</span></h4>
        <div class="sm-row">${chip('CREATED')}${arrow}${chip('PAID', 'ok')}</div>
        <div class="sm-row">${chip('CREATED')}${arrow}${chip('CLOSED', 'bad')}</div>
        <div class="sm-row">${chip('PAID')}${arrow}${chip('REFUNDED')}</div>
        <p>订单与支付单分离：一笔订单可能对应多笔支付尝试，只有支付成功后订单才变为 PAID。</p>
      </div>
      <div class="state-card">
        <h4>退款状态机 <span class="badge badge-purple">Refund</span></h4>
        <div class="sm-row">${chip('PROCESSING')}${arrow}${chip('SUCCESS', 'ok')}</div>
        <div class="sm-row">${chip('PROCESSING')}${arrow}${chip('FAILED', 'bad')}${arrow}${chip('SUCCESS', 'ok')}</div>
        <p>退款成功不改变支付单状态，退款进度独立记录，支持部分退款与失败重试。</p>
      </div>
    </div>
  `;
}

async function paint(root) {
  const { payments } = await get('/payments?limit=120');
  const actionable = payments.filter((payment) => (
    (payment.status === 'SUCCESS' && payment.completed) ||
    payment.status === 'PAYING' ||
    payment.status === 'EXCEPTION' ||
    (payment.status === 'CLOSED' && !payment.compensated)
  ));

  root.innerHTML = `
    ${resultCard()}
    <div class="grid-3">
      <div class="card tight">
        <div class="card-head"><h3>幂等回调</h3>${badge('Idempotency', 'blue')}</div>
        <p class="note">同一个幂等键 + 已成功状态，重复通知只做验签与去重，不产生新的账务分录。资金只入账一次。</p>
      </div>
      <div class="card tight">
        <div class="card-head"><h3>掉单补偿</h3>${badge('Query', 'amber')}</div>
        <p class="note">通知可能丢失。定时任务或人工主动查单发现“渠道已成功、平台未入账”，按权威结果补单。</p>
      </div>
      <div class="card tight">
        <div class="card-head"><h3>关单与迟到回调</h3>${badge('Compensation', 'purple')}</div>
        <p class="note">订单超时关闭后渠道才回调成功，必须补记支付并联动原路退款，避免用户资金悬空。</p>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div>
          <h2>可演练交易</h2>
          <p class="sub">选择一笔交易执行故障注入与补偿动作，表格会自动刷新</p>
        </div>
        <span class="chip">${actionable.length} 笔可操作</span>
      </div>
      ${actionable.length ? `
        <div class="table-wrap">
          <table class="table action-table">
            <thead>
              <tr>
                <th>交易</th>
                <th>状态</th>
                <th>渠道</th>
                <th class="num">金额</th>
                <th>时间</th>
                <th>演练动作</th>
              </tr>
            </thead>
            <tbody>
              ${actionable.slice(0, 24).map((payment) => `
                <tr>
                  <td>
                    <div style="font-weight:500">${esc(payment.subject)}</div>
                    <div class="mono" style="color:var(--muted-2);font-size:10px">${esc(payment.outTradeNo)}</div>
                  </td>
                  <td>${payBadge(payment.status)}${payment.compensated ? `<div style="margin-top:4px">${badge('已补偿', 'purple')}</div>` : ''}</td>
                  <td>${esc(payment.channelName)}</td>
                  <td class="num amount">¥${money(payment.amount)}</td>
                  <td class="mono" style="font-size:10.5px">${esc(fmtTime(payment.createdAt, true))}</td>
                  <td><div class="actions-cell">${actionButtons(payment)}</div></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<div class="table-empty">暂无可演练交易，请先在演练台创建并完成一笔支付。</div>'}
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div>
          <h2>状态机与可靠性约束</h2>
          <p class="sub">理解状态机，是理解幂等与补偿的前提</p>
        </div>
      </div>
      ${machineGuide()}
    </div>
  `;

  root.querySelectorAll('[data-run]').forEach((button) => {
    button.addEventListener('click', async () => {
      const meta = ACTION_META[button.dataset.run];
      if (!meta) return;
      button.disabled = true;
      try {
        const data = await post(`/payments/${button.dataset.id}/${meta.endpoint}`);
        resultState.last = {
          title: meta.label + ' · ' + meta.endpoint,
          paymentId: data.payment.id,
          at: new Date().toISOString(),
          events: data.payment.events.slice(-3)
        };
        toast(`${meta.label} 执行完成`, 'success');
        await paint(root);
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    });
  });

  root.querySelectorAll('[data-open]').forEach((button) => {
    button.addEventListener('click', () => {
      appState.activePaymentId = button.dataset.open;
      location.hash = '#/payment';
    });
  });
}

export default {
  async render(root) {
    await paint(root);
    return () => {};
  }
};
