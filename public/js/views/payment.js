import { get, post } from '../api.js';
import { appState } from '../state.js';
import {
  esc, money, fmtTime, payBadge, badge, toast, eventModal, ORDER_STATUS
} from '../ui.js';
import { openPaymentAccounting, flowStatusBadge } from '../accounting.js';

let meta = null;
let detail = null;
let autoPlaying = false;
let autoTimer = null;
let busy = false;

const ACTION_LABELS = {
  confirm_pay: '确认支付（模拟扫码）',
  approve: '审核通过',
  reject: '审核拒绝',
  query_channel: '主动查单',
  resend_notify: '重发渠道通知'
};

const ACTION_CLASS = {
  confirm_pay: 'primary',
  approve: 'primary',
  reject: 'danger',
  query_channel: 'primary',
  resend_notify: 'ghost'
};

const STATE_TEXT = {
  done: '已完成',
  active: '进行中',
  waiting: '等待操作',
  failed: '已失败',
  skipped: '未执行',
  pending: '待执行'
};

const MACHINE = ['INIT', 'PAYING', 'SUCCESS', 'EXCEPTION', 'FAILED', 'CLOSED'];

function scenarioOf(code) {
  return meta.scenarios.find((item) => item.code === code) || { name: code, desc: '' };
}

function phaseState(payment, idx) {
  if (payment.terminated && payment.failedPhase === idx) return 'failed';
  if (payment.terminated && !payment.compensated && payment.failedPhase !== null && idx > payment.failedPhase) return 'skipped';
  if (payment.completed || idx < payment.phaseIndex) return 'done';
  if (idx === payment.phaseIndex) return payment.waiting ? 'waiting' : 'active';
  return 'pending';
}

function currentPhaseIndex(payment) {
  if (payment.waiting) return Math.min(payment.waiting.phase ?? payment.phaseIndex, meta.phases.length - 1);
  if (payment.terminated && payment.failedPhase !== null) return payment.failedPhase;
  return Math.min(payment.phaseIndex, meta.phases.length - 1);
}

function phaseRows(payment) {
  return meta.phases.map((phase, idx) => {
    const state = phaseState(payment, idx);
    const events = payment.events.filter((event) => event.phaseIndex === idx);
    const stateText = state === 'failed'
      ? (payment.status === 'CLOSED' ? '已关闭' : '已失败')
      : STATE_TEXT[state];
    const bullet = state === 'done' ? '✓' : state === 'failed' ? '!' : state === 'active' ? '›' : state === 'waiting' ? '…' : String(idx + 1);
    return `
      <li class="phase stage-link ${state === 'pending' ? '' : state}" data-stage="${idx}" title="查看阶段详情：${esc(phase.name)}">
        <div class="phase-bullet">${bullet}</div>
        <div class="phase-body">
          <div class="phase-head">
            <span class="phase-name">${esc(phase.name)}</span>
            <span class="phase-actor">${esc(phase.actor)}</span>
            <span class="phase-state">${esc(stateText)}</span>
            <span class="phase-go">详情 ›</span>
          </div>
          <div class="phase-desc">${esc(phase.desc)}</div>
          ${events.length ? `
            <div class="evt-chips">
              ${events.map((event) => `
                <button class="evt-chip level-${event.level}" type="button" data-evt="${event.id}">
                  ${esc(event.title)}<span>${esc(fmtTime(event.ts))}</span>
                </button>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </li>
    `;
  }).join('');
}

function progressBar(payment) {
  return meta.phases.map((phase, idx) => {
    const state = phaseState(payment, idx);
    const cls = state === 'pending' ? '' : state;
    return `<span class="seg ${cls}" title="${esc(phase.name)}"></span>`;
  }).join('');
}

function machineHTML(payment) {
  const chip = (code, extra = '') => `<span class="sm-chip ${payment.status === code ? 'active' : ''} ${extra}">${code}</span>`;
  const orderStatus = detail.order ? detail.order.status : null;
  const orderChip = (code) => `<span class="sm-chip ${orderStatus === code ? 'active' : ''}">${code}</span>`;
  return `
    <div class="machine">
      <div class="sm-row">${chip('INIT')}<span class="sm-arrow">→</span>${chip('PAYING')}<span class="sm-arrow">→</span>${chip('SUCCESS')}</div>
      <div class="sm-row">${chip('PAYING')}<span class="sm-arrow">→</span>${chip('EXCEPTION')}<span class="sm-arrow">→</span>${chip('SUCCESS')}</div>
      <div class="sm-row">${chip('PAYING')}<span class="sm-arrow">→</span>${chip('FAILED')}<span class="sm-arrow">/</span>${chip('CLOSED')}</div>
      <div class="sm-label">支付单状态：${esc((({ INIT: '待发起', PAYING: '支付中', SUCCESS: '支付成功', FAILED: '支付失败', CLOSED: '已关闭', EXCEPTION: '异常待处理' })[payment.status]) || payment.status)}</div>
      <div class="sm-row" style="margin-top:6px">${orderChip('CREATED')}<span class="sm-arrow">→</span>${orderChip('PAID')}<span class="sm-arrow">/</span>${orderChip('CLOSED')}</div>
      <div class="sm-label">业务订单状态：${orderStatus ? esc((ORDER_STATUS[orderStatus] || [orderStatus])[0]) : '—'}</div>
    </div>
  `;
}

function ledgerHTML(payment) {
  const entry = (detail.ledger || [])[0];
  if (!entry) return '';
  const debit = entry.entries.reduce((sum, line) => sum + line.debit, 0);
  const credit = entry.entries.reduce((sum, line) => sum + line.credit, 0);
  const rows = entry.entries.map((line) => {
    const isDebit = line.debit > 0;
    return `
      <div class="ledger-row">
        <span class="side ${isDebit ? 'debit' : 'credit'}">${isDebit ? '借' : '贷'}</span>
        <span>${esc(line.accountName)}</span>
        <span class="amt">¥${money(isDebit ? line.debit : line.credit)}</span>
      </div>
    `;
  }).join('');
  return `
    <div class="card">
      <div class="card-head">
        <h3>账务分录</h3>
        <span class="badge badge-green">借贷平衡</span>
      </div>
      <div class="ledger-rows">${rows}</div>
      <div class="ledger-note">
        借方合计 ¥${money(debit)} · 贷方合计 ¥${money(credit)}<br>
        手续费 ¥${money(payment.fee)} · 结算日 ${esc(payment.settleDate || '—')}
      </div>
    </div>
  `;
}

function clearingHTML(payment) {
  const flow = detail.clearingFlow;
  if (payment.status !== 'SUCCESS') return '';
  if (!flow) {
    return `
      <div class="card">
        <div class="card-head"><h3>跨机构清算</h3>${badge('未生成', 'gray')}</div>
        <div class="note">支付成功后会自动生成一条跨机构资金链路，展示发卡行、清算机构、央行与收款行的完整记账过程。</div>
      </div>
    `;
  }
  return `
    <div class="card">
      <div class="card-head">
        <h3>跨机构清算</h3>
        ${flowStatusBadge(flow.status)}
      </div>
      <div class="clearing-mini">
        <div><small>清算网络</small><strong>${esc(flow.network)}</strong></div>
        <div><small>链路环节</small><strong>${flow.legDone} / ${flow.legTotal}</strong></div>
        <div><small>收款净额</small><strong>¥${money(flow.payeeNet)}</strong></div>
      </div>
      <div class="clearing-route">${esc(flow.payer)} → ${esc(flow.payee)}</div>
      <button class="btn ghost block mt-12" type="button" data-accounting>查看资金会计链路</button>
    </div>
  `;
}

function actionsHTML(payment) {
  if (payment.waiting) {
    return payment.waiting.actions.map((action) => (
      `<button class="btn ${ACTION_CLASS[action] || 'ghost'}" type="button" data-action="${action}">${esc(ACTION_LABELS[action] || action)}</button>`
    )).join('');
  }
  if (autoPlaying) {
    return `
      <button class="btn ghost" type="button" data-auto-stop>停止自动播放</button>
      <button class="btn ghost" type="button" data-new>新建交易</button>
    `;
  }
  if (payment.completed) {
    return `
      <a class="btn primary" href="#/refund">发起退款</a>
      <button class="btn ghost" type="button" data-accounting>资金会计链路</button>
      <a class="btn ghost" href="#/reconcile">对账中心</a>
      <button class="btn ghost" type="button" data-new>新建交易</button>
    `;
  }
  if (payment.terminated) {
    return `
      <a class="btn ghost" href="#/reliability">去可靠性实验室</a>
      <button class="btn ghost" type="button" data-new>新建交易</button>
    `;
  }
  return `
    <button class="btn primary" type="button" data-step>执行下一步</button>
    <button class="btn ghost" type="button" data-auto>自动播放</button>
    <button class="btn ghost" type="button" data-new>新建交易</button>
  `;
}

function resultBanner(payment) {
  if (payment.waiting) {
    return `
      <div class="wait-hint">
        <strong>${esc(payment.waiting.title || '等待操作')}</strong>
        ${esc(payment.waiting.hint || '')}
      </div>
    `;
  }
  if (payment.completed) {
    return `
      <div class="result-banner">
        <span class="result-icon">✓</span>
        <div><strong>链路闭环完成。</strong>资金已入账，${esc(payment.settleCycle || 'T+1')}（${esc(payment.settleDate || '')}）进入对账与结算周期。${payment.crossBorder ? '国际收支申报已生成。' : ''}</div>
      </div>
    `;
  }
  if (payment.terminated) {
    return `
      <div class="result-banner error">
        <span class="result-icon">!</span>
        <div><strong>${payment.status === 'CLOSED' ? '交易已关闭。' : '交易已终止。'}</strong>${esc(payment.failReason || '')}</div>
      </div>
    `;
  }
  return `
    <div class="note" style="padding:2px 0">
      点击「执行下一步」逐跳推进，或使用「自动播放」观察完整链路。每个阶段下方的标签可打开请求/响应报文与签名。
    </div>
  `;
}

function workbenchHTML(data) {
  const payment = data.payment;
  const scenario = scenarioOf(payment.scenario);
  const ledger = ledgerHTML(payment);
  const currentIdx = currentPhaseIndex(payment);
  const phase = meta.phases[currentIdx];
  const doneCount = meta.phases.filter((_, idx) => phaseState(payment, idx) === 'done').length;

  return `
    <section class="card wb-head">
      <div class="wb-title">
        <div class="row">
          ${payBadge(payment.status)}
          ${badge(scenario.name, 'purple')}
          <span class="chip">${esc(payment.channelName)}</span>
          ${payment.crossBorder ? badge(`${payment.crossBorder.foreignCurrency} ${money(payment.crossBorder.foreignAmount)} × ${payment.crossBorder.fxRate}`, 'blue') : ''}
          ${autoPlaying ? badge('自动播放中', 'blue') : ''}
        </div>
        <h3>${esc(payment.subject)}</h3>
        <div class="wb-meta">支付单 ${esc(payment.id)} · 订单 ${esc(payment.outTradeNo)}</div>
      </div>
      <div class="wb-amounts">
        <div><small>交易金额</small><strong>¥${money(payment.amount)}</strong></div>
        <div><small>手续费</small><strong class="faint">${payment.fee ? `¥${money(payment.fee)}` : '—'}</strong></div>
        <div><small>商户净额</small><strong class="faint">${payment.netAmount ? `¥${money(payment.netAmount)}` : '—'}</strong></div>
        <div><small>已退款</small><strong class="faint">${payment.refundedAmount ? `¥${money(payment.refundedAmount)}` : '—'}</strong></div>
      </div>
    </section>

    <div class="progress">${progressBar(payment)}</div>

    <div class="wb-grid">
      <div class="card">
        <div class="card-head">
          <div>
            <h3>链路阶段</h3>
            <p class="sub">点击阶段查看数据与会计计算，点击标签查看该跳报文</p>
          </div>
          <span class="chip">${doneCount} / ${meta.phases.length} 已完成</span>
        </div>
        <ol class="phase-list">${phaseRows(payment)}</ol>
      </div>

      <aside class="side-stack">
        <div class="card">
          <div class="card-head">
            <h3>操作台</h3>
            <span class="chip">${esc(payment.channelName)}</span>
          </div>
          ${resultBanner(payment)}
          <div class="actions">${actionsHTML(payment)}</div>
          <div class="summary-strip">
            <div><small>当前阶段</small><strong>${esc(phase ? phase.name : '已完成')}</strong></div>
            <div><small>处理方</small><strong>${esc(phase ? phase.actor : '—')}</strong></div>
            <div><small>幂等键</small><strong class="mono" style="font-size:10.5px">${esc(payment.idempotencyKey)}</strong></div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>状态机</h3><span class="chip">支付 / 订单</span></div>
          ${machineHTML(payment)}
        </div>

        ${ledger}
        ${clearingHTML(payment)}

        <div class="card teaching">
          <div class="tip-label">Teaching Note</div>
          <h3 style="margin-bottom:8px">${esc(phase ? phase.name : '交易闭环')}</h3>
          <p>${esc(phase ? phase.teaching : '支付成功只是开始，T+1 对账与结算才是资金安全的最后一道防线。')}</p>
          <div class="tip-meta">阶段 ${currentIdx + 1} / ${meta.phases.length} · ${esc(phase ? phase.actor : '支付平台')}</div>
        </div>
      </aside>
    </div>
  `;
}

function setDetail(data) {
  detail = data;
  appState.activePaymentId = data.payment.id;
}

function renderWorkbench(root) {
  const box = root.querySelector('#workbench');
  if (!box) return;
  if (!detail) {
    box.innerHTML = `
      <div class="card empty-state">
        <div class="empty-icon">◎</div>
        <h3>尚未创建交易</h3>
        <p>选择上方教学场景并创建交易，即可逐步执行 12 个支付阶段。<br>每个阶段都能查看请求报文、响应报文与签名。</p>
        <a class="btn ghost" href="#/overview">返回总览</a>
      </div>
    `;
    return;
  }
  box.innerHTML = workbenchHTML(detail);
}

async function loadPayment(root, id) {
  try {
    const data = await get(`/payments/${id}`);
    setDetail(data);
    renderWorkbench(root);
  } catch (error) {
    appState.activePaymentId = null;
    detail = null;
    renderWorkbench(root);
    toast(error.message, 'error');
  }
}

function applyScenarioDefaults(root, force = false) {
  const form = root.querySelector('#pay-form');
  const select = root.querySelector('#scenario-select');
  const scenario = meta.scenarios.find((item) => item.code === select.value) || meta.scenarios[0];
  root.querySelector('#scenario-banner').innerHTML = `
    <span class="tag">${esc(scenario.name)}</span>
    <span>${esc(scenario.desc)}</span>
  `;
  if (force) {
    form.amount.value = Number(scenario.amount).toFixed(2);
    form.channel.value = scenario.channel;
    form.buyer.value = scenario.buyer;
  }
}

function bind(root) {
  const form = root.querySelector('#pay-form');
  const select = root.querySelector('#scenario-select');

  select.addEventListener('change', () => applyScenarioDefaults(root, true));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const formData = new FormData(form);
      const data = await post('/payments', {
        scenario: formData.get('scenario'),
        subject: formData.get('subject'),
        amount: Number(formData.get('amount')),
        channel: formData.get('channel'),
        buyer: formData.get('buyer')
      });
      setDetail(data);
      renderWorkbench(root);
      toast('交易已创建，可点击「执行下一步」开始', 'success');
      root.querySelector('#workbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      busy = false;
      submit.disabled = false;
    }
  });

  root.addEventListener('click', async (event) => {
    if (event.target.closest('[data-accounting]')) {
      if (detail) openPaymentAccounting(detail.payment.id);
      return;
    }

    const eventChip = event.target.closest('[data-evt]');
    if (eventChip) {
      const found = detail && detail.payment.events.find((item) => item.id === eventChip.dataset.evt);
      if (found) eventModal(found);
      return;
    }

    const stageRow = event.target.closest('[data-stage]');
    if (stageRow && detail) {
      location.hash = `#/stage/${encodeURIComponent(detail.payment.id)}/${stageRow.dataset.stage}`;
      return;
    }

    if (event.target.closest('[data-new]')) {
      autoPlaying = false;
      clearTimeout(autoTimer);
      detail = null;
      appState.activePaymentId = null;
      renderWorkbench(root);
      root.querySelector('#pay-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (event.target.closest('[data-auto-stop]')) {
      autoPlaying = false;
      clearTimeout(autoTimer);
      renderWorkbench(root);
      return;
    }

    if (event.target.closest('[data-auto]')) {
      startAuto(root);
      return;
    }

    const stepButton = event.target.closest('[data-step]');
    if (stepButton && detail && !busy) {
      busy = true;
      stepButton.disabled = true;
      try {
        const data = await post(`/payments/${detail.payment.id}/step`);
        setDetail(data);
        renderWorkbench(root);
        const last = data.payment.events[data.payment.events.length - 1];
        if (last && last.level !== 'info') toast(last.title, last.level === 'error' ? 'error' : last.level === 'warn' ? 'warn' : 'success');
        if (data.payment.waiting) toast(`流程暂停：${data.payment.waiting.title}`, 'warn');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        busy = false;
      }
      return;
    }

    const actionButton = event.target.closest('[data-action]');
    if (actionButton && detail && !busy) {
      busy = true;
      actionButton.disabled = true;
      try {
        const data = await post(`/payments/${detail.payment.id}/action`, { action: actionButton.dataset.action });
        setDetail(data);
        renderWorkbench(root);
        toast(`已执行：${ACTION_LABELS[actionButton.dataset.action] || actionButton.dataset.action}`, 'success');
        if (data.payment.waiting) toast(`流程暂停：${data.payment.waiting.title}`, 'warn');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        busy = false;
      }
    }
  });
}

function startAuto(root) {
  autoPlaying = true;
  renderWorkbench(root);

  const tick = async () => {
    if (!autoPlaying) return;
    if (!detail) {
      autoPlaying = false;
      renderWorkbench(root);
      return;
    }
    if (detail.payment.waiting || detail.payment.terminated || detail.payment.completed) {
      autoPlaying = false;
      renderWorkbench(root);
      if (detail.payment.waiting) toast(`自动播放暂停：${detail.payment.waiting.title}`, 'warn');
      return;
    }
    try {
      const data = await post(`/payments/${detail.payment.id}/step`);
      setDetail(data);
      renderWorkbench(root);
    } catch (error) {
      autoPlaying = false;
      renderWorkbench(root);
      toast(error.message, 'error');
      return;
    }
    autoTimer = setTimeout(tick, 780);
  };

  autoTimer = setTimeout(tick, 320);
}

export default {
  async render(root) {
    meta = await get('/meta');
    detail = null;
    autoPlaying = false;
    clearTimeout(autoTimer);

    root.innerHTML = `
      <section class="card">
        <div class="card-head">
          <div>
            <h2>全链路演练台</h2>
            <p class="sub">选择教学场景并创建交易，逐步观察支付链路的每个阶段</p>
          </div>
          <span class="chip">手动 / 自动执行</span>
        </div>
        <form id="pay-form" class="pay-form" autocomplete="off">
          <label class="field">
            <span>教学场景</span>
            <select id="scenario-select" name="scenario">
              ${meta.scenarios.map((scenario) => `<option value="${scenario.code}">${esc(scenario.name)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>商品名称</span>
            <input type="text" name="subject" value="手冲咖啡豆 250g" maxlength="60">
          </label>
          <label class="field">
            <span>支付金额（元）</span>
            <input type="number" name="amount" min="0.01" max="200000" step="0.01" value="128.00">
          </label>
          <label class="field">
            <span>支付渠道</span>
            <select name="channel">
              ${meta.channels.map((channel) => `<option value="${channel.code}">${esc(channel.name)} · ${(channel.feeRate * 100).toFixed(2)}%</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>买家标识</span>
            <input type="text" name="buyer" value="U10001" maxlength="32">
          </label>
          <div class="form-actions">
            <button class="btn primary" type="submit">创建交易</button>
          </div>
        </form>
        <div id="scenario-banner" class="scenario-banner"></div>
      </section>
      <div id="workbench" class="workbench"></div>
    `;

    bind(root);
    applyScenarioDefaults(root, true);

    if (appState.presetScenario) {
      const preset = appState.presetScenario;
      appState.presetScenario = null;
      const option = root.querySelector(`#scenario-select option[value="${preset}"]`);
      if (option) {
        root.querySelector('#scenario-select').value = preset;
        applyScenarioDefaults(root, true);
      }
    }

    if (appState.activePaymentId) {
      await loadPayment(root, appState.activePaymentId);
    } else {
      renderWorkbench(root);
    }

    return () => {
      autoPlaying = false;
      clearTimeout(autoTimer);
    };
  }
};
