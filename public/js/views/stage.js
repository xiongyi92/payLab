import { get } from '../api.js';
import {
  esc, money, fmtTime, badge, jsonBlock, levelBadge
} from '../ui.js';
import { openPaymentAccounting } from '../accounting.js';

const STATE_BADGE = {
  done: ['已完成', 'green'],
  active: ['进行中', 'blue'],
  waiting: ['等待操作', 'amber'],
  failed: ['已失败', 'red'],
  skipped: ['未执行', 'gray'],
  pending: ['待执行', 'gray']
};

function stateBadge(state) {
  const [text, tone] = STATE_BADGE[state] || STATE_BADGE.pending;
  return badge(text, tone);
}

function stepperHTML(phaseStates, current, paymentId) {
  return `
    <div class="stage-steps" style="--steps:${phaseStates.length}">
      ${phaseStates.map((state, idx) => `
        <a class="stage-step ${state} ${idx === current ? 'current' : ''}"
           href="#/stage/${encodeURIComponent(paymentId)}/${idx}"
           title="阶段 ${idx + 1}">
          <b>${idx + 1}</b>
          <span>${state === 'done' ? '✓' : state === 'failed' ? '!' : state === 'waiting' ? '…' : ''}</span>
        </a>
      `).join('')}
    </div>
  `;
}

function dataRowsHTML(rows) {
  if (!rows.length) {
    return '<div class="stage-empty">该阶段尚未产生业务数据，推进链路后即可查看。</div>';
  }
  return `
    <table class="table stage-table">
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td class="stage-key">${esc(row.label)}</td>
            <td class="${row.mono ? 'mono' : ''} ${row.tone ? `tone-${row.tone}` : ''}">${esc(row.value)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function formulaHTML(formulas) {
  return `
    <ul class="stage-formulas">
      ${formulas.map((line) => `<li>${esc(line)}</li>`).join('')}
    </ul>
  `;
}

function entryTableHTML(entries, totals) {
  return `
    <div class="table-wrap">
      <table class="table stage-ledger">
        <thead>
          <tr><th>方向</th><th>会计科目</th><th>科目码</th><th class="num">借方</th><th class="num">贷方</th></tr>
        </thead>
        <tbody>
          ${entries.map((line) => `
            <tr>
              <td><span class="side ${line.debit > 0 ? 'debit' : 'credit'}">${line.debit > 0 ? '借' : '贷'}</span></td>
              <td>${esc(line.accountName)}</td>
              <td class="mono" style="font-size:10.5px">${esc(line.account)}</td>
              <td class="num amount">${line.debit > 0 ? `¥${money(line.debit)}` : '—'}</td>
              <td class="num amount">${line.credit > 0 ? `¥${money(line.credit)}` : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="trial-strip">
      <span>借方合计 <strong>¥${money(totals.debit)}</strong></span>
      <span>贷方合计 <strong>¥${money(totals.credit)}</strong></span>
      ${totals.balanced ? badge('借贷平衡', 'green') : badge('借贷不平衡', 'red')}
    </div>
  `;
}

function accountingHTML(accounting) {
  if (accounting.kind === 'ENTRY') {
    return `
      ${formulaHTML(accounting.formulas)}
      <div class="stage-note">${esc(accounting.note)}</div>
      ${entryTableHTML(accounting.entries, accounting.totals)}
      <div class="stage-meta-row">
        <span class="chip mono">${esc(accounting.entryId || '')}</span>
        ${accounting.settleDate ? `<span class="chip">结算日 ${esc(accounting.settleDate)}</span>` : ''}
      </div>
    `;
  }
  if (accounting.kind === 'FLOW' && accounting.flow) {
    const flow = accounting.flow;
    return `
      ${formulaHTML(accounting.formulas)}
      <div class="stage-note">${esc(accounting.note)}</div>
      <div class="stage-meta-row">
        <span class="chip">${esc(flow.typeName)}</span>
        <span class="chip">${esc(flow.network)}</span>
        <span class="chip">环节 ${flow.legDone}/${flow.legTotal}</span>
        <span class="chip mono">${esc(flow.no)}</span>
      </div>
    `;
  }
  return `
    ${formulaHTML(accounting.formulas)}
    <div class="stage-note">${esc(accounting.note)}</div>
  `;
}

function eventsHTML(events) {
  if (!events.length) {
    return '<div class="stage-empty">该阶段尚未执行，暂无请求与响应报文。</div>';
  }
  return events.map((event) => {
    const signInfo = event.signInfo ? `
      <div class="sign-box">
        <h4>签名与验签</h4>
        <dl>
          <dt>算法</dt><dd>${esc(event.signInfo.algorithm || 'HMAC-SHA256')}</dd>
          <dt>待签串</dt><dd>${esc(event.signInfo.signString || '—')}</dd>
          <dt>签名值</dt><dd>${esc(event.signInfo.sign || '—')}</dd>
          <dt>验签结果</dt><dd>${esc(event.signInfo.verifyResult || 'VALID')}</dd>
        </dl>
      </div>
    ` : '';
    return `
      <div class="stage-event">
        <div class="stage-event-head">
          ${levelBadge(event.level)}
          <strong>${esc(event.title || '')}</strong>
          <span class="chip mono">${esc(fmtTime(event.ts, true))}</span>
          ${event.latencyMs !== null && event.latencyMs !== undefined ? `<span class="chip">${event.latencyMs}ms</span>` : ''}
        </div>
        <div class="stage-event-route">${esc(event.actor || '—')} → ${esc(event.target || '—')}</div>
        ${event.detail ? `<div class="stage-event-detail">${esc(event.detail)}</div>` : ''}
        <div class="payload-grid">
          <div class="payload-box">
            <h4>请求 REQUEST</h4>
            ${jsonBlock(event.request)}
          </div>
          <div class="payload-box">
            <h4>响应 RESPONSE</h4>
            ${jsonBlock(event.response)}
          </div>
        </div>
        ${signInfo}
      </div>
    `;
  }).join('');
}

function renderPage(root, meta, data) {
  const phase = data.phase;
  const payment = data.payment;
  const [stateText] = STATE_BADGE[data.status.state] || STATE_BADGE.pending;
  const prevPhase = data.prev === null ? null : meta.phases[data.prev];
  const nextPhase = data.next === null ? null : meta.phases[data.next];
  const href = (idx) => `#/stage/${encodeURIComponent(payment.id)}/${idx}`;

  root.innerHTML = `
    <section class="card stage-head">
      <div class="stage-head-main">
        <div class="row">
          <a class="btn ghost sm" href="#/payment">← 返回演练台</a>
          <span class="chip">阶段 ${phase.index + 1} / ${phase.total}</span>
          ${stateBadge(data.status.state)}
          ${payment.crossBorder ? badge(`${payment.crossBorder.foreignCurrency} ${money(payment.crossBorder.foreignAmount)} × ${payment.crossBorder.fxRate}`, 'blue') : ''}
          <span class="chip mono">${esc(payment.id)}</span>
        </div>
        <h2>${esc(phase.name)}</h2>
        <p class="sub">${esc(phase.desc)}</p>
        <div class="stage-route">
          <span class="chip">${esc(phase.actor)}</span>
          <span class="leg-arrow">→</span>
          <span class="chip">${esc(phase.target)}</span>
          <span class="chip">${esc(payment.subject)}</span>
        </div>
      </div>
      <div class="stage-head-side">
        <div><small>交易金额</small><strong>¥${money(payment.amount)}</strong></div>
        <div><small>手续费</small><strong class="faint">${payment.fee ? `¥${money(payment.fee)}` : '—'}</strong></div>
        <div><small>商户净额</small><strong class="faint">${payment.netAmount ? `¥${money(payment.netAmount)}` : '—'}</strong></div>
        <div><small>阶段耗时</small><strong class="faint">${data.status.latencyMs}ms</strong></div>
        <div><small>报文条数</small><strong class="faint">${data.status.eventCount}</strong></div>
      </div>
    </section>

    <div class="stage-progress-row">
      <div class="stage-steps-wrap">${stepperHTML(data.phaseStates, phase.index, payment.id)}</div>
      <div class="stage-nav">
        ${prevPhase ? `<a class="btn ghost sm" href="${href(data.prev)}">‹ ${esc(prevPhase.name)}</a>` : ''}
        ${nextPhase ? `<a class="btn ghost sm" href="${href(data.next)}">${esc(nextPhase.name)} ›</a>` : ''}
      </div>
    </div>

    ${data.status.state === 'pending' || data.status.state === 'skipped' ? `
      <div class="stage-banner warn">
        <strong>该阶段尚未执行（${esc(stateText)}）。</strong>
        下方展示的是按当前订单预估的数据与计算口径；回到演练台推进链路后，即可看到真实的请求报文与记账结果。
      </div>
    ` : ''}

    <div class="stage-grid">
      <div class="stage-col">
        <div class="card">
          <div class="card-head">
            <div>
              <h3>阶段数据</h3>
              <p class="sub">本阶段流转的订单、渠道与状态信息</p>
            </div>
            <span class="chip">${data.data.length} 项</span>
          </div>
          ${dataRowsHTML(data.data)}
        </div>

        <div class="card">
          <div class="card-head">
            <div>
              <h3>会计计算</h3>
              <p class="sub">金额口径、费用拆分与本阶段账务结果</p>
            </div>
            ${data.accounting.kind === 'ENTRY' ? badge('已入账', 'green') : data.accounting.kind === 'FLOW' ? badge('跨机构清算', 'purple') : badge('不记账', 'gray')}
          </div>
          <div class="stage-acct-title">${esc(data.accounting.title)}</div>
          ${accountingHTML(data.accounting)}
          <div class="actions" style="margin-top:12px">
            <button class="btn ghost sm" type="button" data-open-accounting="${esc(payment.id)}">查看完整会计链路</button>
            ${data.accounting.flow ? `<a class="btn ghost sm" href="#/clearing">清算网络</a>` : ''}
          </div>
        </div>
      </div>

      <div class="stage-col">
        <div class="card">
          <div class="card-head">
            <div>
              <h3>报文与签名</h3>
              <p class="sub">该阶段的请求、响应与验签过程</p>
            </div>
            <span class="chip">${data.events.length} 条事件</span>
          </div>
          ${eventsHTML(data.events)}
        </div>

        <div class="card teaching">
          <div class="tip-label">Teaching Note</div>
          <h3 style="margin-bottom:8px">${esc(phase.name)}</h3>
          <p>${esc(phase.teaching)}</p>
          <div class="tip-meta">阶段 ${phase.index + 1} / ${phase.total} · ${esc(phase.actor)} → ${esc(phase.target)}</div>
          <div class="actions" style="margin-top:12px">
            ${data.links.map((link) => `<a class="btn ghost sm" href="${link.href}">${esc(link.label)}</a>`).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  root.querySelectorAll('[data-open-accounting]').forEach((button) => {
    button.addEventListener('click', () => openPaymentAccounting(button.dataset.openAccounting));
  });

  document.getElementById('page-title').textContent = phase.name;
  document.getElementById('page-sub').textContent = `阶段 ${phase.index + 1} / ${phase.total} · ${phase.actor} → ${phase.target}`;
  document.title = `${phase.name} · PayLab 支付全链路教学系统`;
}

export default {
  async render(root, params = []) {
    const paymentId = params[0];
    const phaseIndex = Number(params[1]);

    if (!paymentId || !Number.isInteger(phaseIndex) || phaseIndex < 0) {
      root.innerHTML = `
        <div class="card">
          <div class="empty-state">
            <div class="empty-icon">!</div>
            <h3>缺少阶段参数</h3>
            <p>请从演练台的「链路阶段」或总览的 12 个阶段进入。</p>
            <a class="btn ghost" href="#/payment">进入演练台</a>
          </div>
        </div>
      `;
      return;
    }

    try {
      const [meta, data] = await Promise.all([
        get('/meta'),
        get(`/payments/${encodeURIComponent(paymentId)}/stages/${phaseIndex}`)
      ]);
      if (phaseIndex >= meta.phases.length) {
        root.innerHTML = `
          <div class="card">
            <div class="empty-state">
              <div class="empty-icon">!</div>
              <h3>阶段不存在</h3>
              <p>该交易共 ${meta.phases.length} 个阶段。</p>
              <a class="btn ghost" href="#/payment">返回演练台</a>
            </div>
          </div>
        `;
        return;
      }
      renderPage(root, meta, data);
    } catch (error) {
      root.innerHTML = `
        <div class="card">
          <div class="empty-state">
            <div class="empty-icon">!</div>
            <h3>阶段详情加载失败</h3>
            <p>${esc(error.message)}</p>
            <a class="btn ghost" href="#/payment">返回演练台</a>
          </div>
        </div>
      `;
    }
  }
};
