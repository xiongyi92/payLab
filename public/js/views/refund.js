import { get, post } from '../api.js';
import {
  esc, money, fmtTime, payBadge, statusBadge, badge, toast, openModal, REFUND_STATUS
} from '../ui.js';

let cache = { payments: [], refunds: [] };

function sourceLabel(source) {
  return source === 'COMPENSATION' ? '系统补偿' : '商户申请';
}

function selectablePayments() {
  return cache.payments.filter((payment) => (
    payment.status === 'SUCCESS' && payment.amount - (payment.refundedAmount || 0) > 0
  ));
}

function refundStats() {
  const success = cache.refunds.filter((refund) => refund.status === 'SUCCESS');
  const failed = cache.refunds.filter((refund) => refund.status === 'FAILED');
  const amount = success.reduce((sum, refund) => sum + refund.amount, 0);
  return { success, failed, amount };
}

function paymentOption(payment) {
  const remaining = payment.amount - (payment.refundedAmount || 0);
  return `<option value="${payment.id}" data-remaining="${remaining}" data-amount="${payment.amount}">
    ${esc(payment.subject)} · 可退 ¥${money(remaining)}
  </option>`;
}

function refundDetail(refund) {
  const events = (refund.events || []).map((event) => `
    <div class="timeline-item ${event.level || ''}">
      <h5>${esc(event.title)}</h5>
      <p>${esc(event.detail || '')}</p>
      <time>${esc(fmtTime(event.ts, true))}</time>
    </div>
  `).join('');

  const entries = (refund.ledgerEntries || []).map((line) => {
    const isDebit = line.debit > 0;
    return `
      <div class="ledger-row">
        <span class="side ${isDebit ? 'debit' : 'credit'}">${isDebit ? '借' : '贷'}</span>
        <span>${esc(line.accountName)}</span>
        <span class="amt">¥${money(isDebit ? line.debit : line.credit)}</span>
      </div>
    `;
  }).join('');

  openModal({
    title: '退款详情 · ' + refund.refundNo,
    subtitle: `${refund.subject || ''} · ${sourceLabel(refund.source)}`,
    wide: true,
    body: `
      <div class="row">
        ${statusBadge(REFUND_STATUS, refund.status)}
        <span class="chip">原交易 ${esc(refund.outTradeNo)}</span>
        <span class="chip">${esc(refund.channelName || refund.channel)}</span>
        <span class="chip">退款金额 ¥${money(refund.amount)}</span>
      </div>
      <div class="divider"></div>
      <h3 style="font-size:13px;margin-bottom:4px">退款处理轨迹</h3>
      <div class="timeline">${events || '<p class="note">暂无处理记录</p>'}</div>
      ${entries ? `
        <div class="divider"></div>
        <h3 style="font-size:13px;margin-bottom:8px">账务冲销分录</h3>
        <div class="ledger-rows">${entries}</div>
        <div class="ledger-note">退款不退还手续费：商户待结算款减少全额退款金额，手续费收入保持不变。</div>
      ` : ''}
    `,
    footer: [{ label: '关闭', class: 'ghost' }]
  });
}

function renderStats() {
  const stats = refundStats();
  return `
    <div class="grid-3">
      <div class="kpi k-green">
        <div class="kpi-label">累计退款金额</div>
        <div class="kpi-value">¥${money(stats.amount)}</div>
        <div class="kpi-foot">成功退款 ${stats.success.length} 笔</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">退款失败待重试</div>
        <div class="kpi-value">${stats.failed.length}<small>笔</small></div>
        <div class="kpi-foot">失败退款可点击“重试”再次发起</div>
      </div>
      <div class="kpi k-purple">
        <div class="kpi-label">可退款交易</div>
        <div class="kpi-value">${selectablePayments().length}<small>笔</small></div>
        <div class="kpi-foot">支付成功且仍有可退余额</div>
      </div>
    </div>
  `;
}

async function paint(root) {
  const [paymentsData, refundsData] = await Promise.all([
    get('/payments?limit=200'),
    get('/refunds')
  ]);
  cache = { payments: paymentsData.payments, refunds: refundsData.refunds };

  root.innerHTML = `
    ${renderStats()}

    <div class="grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head">
          <div>
            <h2>发起退款</h2>
            <p class="sub">支持全额与部分退款，资金原路退回</p>
          </div>
          <span class="chip">Refund</span>
        </div>
        <form id="refund-form" class="stack" style="gap:13px" autocomplete="off">
          <label class="field">
            <span>选择支付成功的交易</span>
            <select name="paymentId" id="refund-payment">
              ${selectablePayments().map(paymentOption).join('') || '<option value="">暂无可退款交易</option>'}
            </select>
          </label>
          <div id="refund-pick"></div>
          <div class="form-grid">
            <label class="field col-6">
              <span>退款金额（元）</span>
              <input type="number" name="amount" id="refund-amount" min="0.01" step="0.01" value="0.00">
            </label>
            <label class="field col-6">
              <span>退款原因</span>
              <select name="reason">
                <option>用户申请退款</option>
                <option>商品质量问题</option>
                <option>协商部分退款</option>
                <option>订单取消</option>
              </select>
            </label>
          </div>
          <label class="check"><input type="checkbox" name="simulateFail"> 模拟渠道退款失败（用于演示失败重试）</label>
          <div class="form-actions">
            <button class="btn primary" type="submit">提交退款</button>
            <span class="note">退款成功后支付单仍为 SUCCESS，退款进度单独维护。</span>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <h2>退款规则与教学要点</h2>
            <p class="sub">退款不是“删除支付”，而是独立的逆向资金流</p>
          </div>
        </div>
        <div class="mini-list">
          <div class="mini-item"><span class="idx">1</span><div><strong>支付与退款状态分离：</strong>退款成功后支付单保持 SUCCESS，仅累计已退金额，避免破坏原交易状态。</div></div>
          <div class="mini-item"><span class="idx">2</span><div><strong>支持部分退款：</strong>可退余额 = 交易金额 - 已退金额，多次退款累计不得超过原金额。</div></div>
          <div class="mini-item"><span class="idx">3</span><div><strong>手续费通常不退还：</strong>退款冲减商户待结算款与渠道应收款，手续费收入保持不变，商户待结算款可能为负。</div></div>
          <div class="mini-item"><span class="idx">4</span><div><strong>失败可重试：</strong>退款单独立记录状态，失败后重试需保证幂等，避免渠道重复退款。</div></div>
          <div class="mini-item"><span class="idx">5</span><div><strong>补偿退款：</strong>超时关单后渠道迟到成功，系统补记支付并自动全额原路退回，手续费一并回退。</div></div>
        </div>
        <div class="scenario-banner" style="margin-top:14px">
          <span class="tag">账务视角</span>
          <span>退款入账：借「商户待结算款」，贷「渠道应收款」；若已结算，则从商户后续结算款中扣回。</span>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head">
        <div>
          <h2>退款记录</h2>
          <p class="sub">点击“详情”查看处理轨迹与账务冲销分录</p>
        </div>
        <span class="chip">${cache.refunds.length} 笔</span>
      </div>
      ${cache.refunds.length ? `
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>退款单号</th>
                <th>原交易</th>
                <th class="num">退款金额</th>
                <th>原因</th>
                <th>来源</th>
                <th>状态</th>
                <th>时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${cache.refunds.slice(0, 40).map((refund) => `
                <tr>
                  <td class="mono">${esc(refund.refundNo)}</td>
                  <td>
                    <div>${esc(refund.subject || '—')}</div>
                    <div class="mono" style="font-size:10px;color:var(--muted-2)">${esc(refund.outTradeNo)}</div>
                  </td>
                  <td class="num amount">¥${money(refund.amount)}</td>
                  <td>${esc(refund.reason)}</td>
                  <td>${badge(sourceLabel(refund.source), refund.source === 'COMPENSATION' ? 'purple' : 'gray')}</td>
                  <td>${statusBadge(REFUND_STATUS, refund.status)}</td>
                  <td class="mono" style="font-size:10.5px">${esc(fmtTime(refund.createdAt, true))}</td>
                  <td>
                    <div class="actions-cell">
                      <button class="btn sm ghost" type="button" data-detail="${refund.id}">详情</button>
                      ${refund.status === 'FAILED' ? `<button class="btn sm primary" type="button" data-retry="${refund.id}">重试</button>` : ''}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<div class="table-empty">暂无退款记录。</div>'}
    </div>
  `;

  const form = root.querySelector('#refund-form');
  const select = root.querySelector('#refund-payment');
  const amountInput = root.querySelector('#refund-amount');
  const pick = root.querySelector('#refund-pick');

  function syncSelectedPayment() {
    const payment = cache.payments.find((item) => item.id === select.value);
    if (!payment) {
      pick.innerHTML = '<div class="note">请先完成一笔支付。</div>';
      amountInput.value = '0.00';
      amountInput.max = '0';
      return;
    }
    const remaining = payment.amount - (payment.refundedAmount || 0);
    amountInput.max = (remaining / 100).toFixed(2);
    amountInput.value = (remaining / 100).toFixed(2);
    const ratio = payment.amount ? Math.min(100, ((payment.refundedAmount || 0) / payment.amount) * 100) : 0;
    pick.innerHTML = `
      <div class="refund-pick">
        <div class="row between">
          <span class="mono" style="font-size:10.5px;color:var(--muted)">${esc(payment.outTradeNo)}</span>
          ${payBadge(payment.status)}
        </div>
        <div class="row between mt-8">
          <span>${esc(payment.subject)} · ${esc(payment.channelName)}</span>
          <span class="amount">¥${money(payment.amount)}</span>
        </div>
        <div class="refund-progress"><i style="width:${ratio}%"></i></div>
        <div class="row between" style="font-size:11px;color:var(--muted)">
          <span>已退 ¥${money(payment.refundedAmount || 0)}</span>
          <span>可退 ¥${money(remaining)}</span>
        </div>
      </div>
    `;
  }

  select.addEventListener('change', syncSelectedPayment);
  syncSelectedPayment();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const formData = new FormData(form);
      if (!formData.get('paymentId')) throw new Error('请选择可退款交易');
      const result = await post('/refunds', {
        paymentId: formData.get('paymentId'),
        amount: Number(formData.get('amount')),
        reason: formData.get('reason'),
        simulateFail: formData.get('simulateFail') === 'on'
      });
      toast(result.refund.status === 'SUCCESS' ? '退款成功，账务已冲销' : '退款失败，可在列表中重试', result.refund.status === 'SUCCESS' ? 'success' : 'warn');
      await paint(root);
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  });

  root.querySelectorAll('[data-detail]').forEach((button) => {
    button.addEventListener('click', () => {
      const refund = cache.refunds.find((item) => item.id === button.dataset.detail);
      if (refund) refundDetail(refund);
    });
  });

  root.querySelectorAll('[data-retry]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await post(`/refunds/${button.dataset.retry}/retry`);
        toast('退款重试成功，账务已冲销', 'success');
        await paint(root);
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    });
  });
}

export default {
  async render(root) {
    await paint(root);
    return () => {};
  }
};
