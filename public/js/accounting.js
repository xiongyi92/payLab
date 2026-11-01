import { get } from './api.js';
import { esc, money, fmtTime, badge, toast, openModal } from './ui.js';

const ACCOUNT_TYPE = {
  ASSET: ['资产', 'blue'],
  LIABILITY: ['负债', 'amber'],
  INCOME: ['收入', 'green'],
  EQUITY: ['权益', 'purple'],
  EXPENSE: ['费用', 'red']
};

const FLOW_STATUS = {
  PROCESSING: ['执行中', 'blue'],
  DONE: ['已闭环', 'green']
};

export function accountTypeBadge(type) {
  const [text, tone] = ACCOUNT_TYPE[type] || [type || '科目', 'gray'];
  return badge(text, tone);
}

export function flowStatusBadge(status) {
  const [text, tone] = FLOW_STATUS[status] || [status || '未知', 'gray'];
  return badge(text, tone);
}

function lineRows(lines) {
  return lines.map((line) => {
    const isDebit = line.debit > 0;
    return `
      <tr>
        <td><span class="side ${isDebit ? 'debit' : 'credit'}">${isDebit ? '借' : '贷'}</span></td>
        <td>
          <div>${esc(line.accountName)}</div>
          <div class="mono" style="font-size:10px;color:var(--muted-2)">${esc(line.code)}${line.memo ? ` · ${esc(line.memo)}` : ''}</div>
        </td>
        <td>${accountTypeBadge(line.accountType)}</td>
        <td class="num amount">${isDebit ? `¥${money(line.debit)}` : '—'}</td>
        <td class="num amount">${!isDebit ? `¥${money(line.credit)}` : '—'}</td>
      </tr>
    `;
  }).join('');
}

function groupedLines(lines) {
  const groups = [];
  const index = new Map();
  for (const line of lines) {
    const key = line.institution || 'PLATFORM';
    if (!index.has(key)) {
      const group = {
        institution: key,
        name: line.institutionName || 'PayLab 平台账务',
        lines: []
      };
      index.set(key, group);
      groups.push(group);
    }
    index.get(key).lines.push(line);
  }
  return groups.map((group) => {
    const debit = group.lines.reduce((sum, line) => sum + line.debit, 0);
    const credit = group.lines.reduce((sum, line) => sum + line.credit, 0);
    return `
      <div class="je-group">
        <div class="je-group-head">
          <span class="je-inst">${esc(group.name)}</span>
          <span class="je-total">借 ¥${money(debit)} · 贷 ¥${money(credit)}</span>
        </div>
        <table class="je-table">
          <thead><tr><th>方向</th><th>会计科目</th><th>类型</th><th class="num">借方</th><th class="num">贷方</th></tr></thead>
          <tbody>${lineRows(group.lines)}</tbody>
        </table>
      </div>
    `;
  }).join('');
}

export function journalEntriesHTML(entries, options = {}) {
  if (!entries || !entries.length) {
    return '<div class="table-empty">暂无会计分录</div>';
  }
  return entries.map((entry) => {
    const lines = options.filterInstitution
      ? entry.lines.filter((line) => line.institution === options.filterInstitution)
      : entry.lines;
    return `
      <div class="je-entry">
        <div class="je-head">
          <div>
            <strong>${esc(entry.title || '会计分录')}</strong>
            <div class="je-meta">
              <span class="mono">${esc(entry.id)}</span>
              <span>${esc(fmtTime(entry.ts, true))}</span>
              ${entry.legIndex !== null && entry.legIndex !== undefined ? `<span>环节 ${Number(entry.legIndex) + 1}</span>` : ''}
            </div>
          </div>
          <div class="je-amounts">
            <span>借 ¥${money(entry.debit)}</span>
            <span>贷 ¥${money(entry.credit)}</span>
            ${entry.debit === entry.credit ? badge('平衡', 'green') : badge('不平衡', 'red')}
          </div>
        </div>
        ${groupedLines(lines)}
      </div>
    `;
  }).join('');
}

function legHTML(leg) {
  const state = leg.status === 'DONE' ? 'done' : 'pending';
  const pending = leg.status !== 'DONE';
  const entryCount = leg.entries.length;
  return `
    <li class="leg ${state}">
      <div class="leg-bullet">${state === 'done' ? '✓' : leg.index + 1}</div>
      <div class="leg-body">
        <div class="leg-head">
          <span class="leg-title">${esc(leg.title)}</span>
          <span class="leg-system">${esc(leg.system)}</span>
          ${state === 'done' ? badge('已记账', 'green') : badge('待执行', 'amber')}
        </div>
        <div class="leg-route">
          <span class="chip">${esc(leg.fromName)}</span>
          <span class="leg-arrow">→</span>
          <span class="chip">${esc(leg.toName)}</span>
          <span class="muted">${esc(leg.detail)}</span>
        </div>
        ${pending ? `
          <div class="leg-entries-preview">
            <span class="muted">本环节将生成 ${entryCount} 条分录，执行后在下方展示实际记账结果。</span>
          </div>
        ` : groupedLines(leg.entries)}
      </div>
    </li>
  `;
}

export function flowAccountingBody(flow) {
  if (!flow) {
    return '<div class="table-empty">该交易暂未生成跨机构清算链路</div>';
  }
  const done = flow.legs.filter((leg) => leg.status === 'DONE').length;
  const trial = flow.trial || { debit: 0, credit: 0, balanced: true };
  return `
    <div class="acct-head">
      <div class="acct-stat"><small>交易金额</small><strong>¥${money(flow.amount)}</strong></div>
      <div class="acct-stat"><small>总手续费</small><strong class="faint">¥${money(flow.fee)}</strong></div>
      <div class="acct-stat"><small>网络清算费</small><strong class="faint">¥${money(flow.networkFee)}</strong></div>
      <div class="acct-stat"><small>支付机构收入</small><strong class="faint">¥${money(flow.platformFee)}</strong></div>
      <div class="acct-stat"><small>收款方净额</small><strong class="faint">¥${money(flow.payeeNet)}</strong></div>
    </div>
    <div class="acct-meta">
      <span class="chip">${esc(flow.typeName)}</span>
      <span class="chip">${esc(flow.network)}</span>
      ${flowStatusBadge(flow.status)}
      <span class="chip">环节 ${done}/${flow.legTotal}</span>
      <span class="chip mono">${esc(flow.no)}</span>
    </div>
    <div class="acct-route">${esc(flow.payer || '付款人')} → ${esc(flow.payee || '收款人')}</div>

    <ol class="leg-list">${flow.legs.map(legHTML).join('')}</ol>

    <div class="card-head" style="margin:18px 0 10px">
      <div>
        <h3>科目发生额汇总</h3>
        <p class="sub">按机构与科目汇总本次链路的借贷发生额</p>
      </div>
      ${trial.balanced ? badge('借贷平衡', 'green') : badge('借贷不平衡', 'red')}
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>机构</th><th>科目</th><th>类型</th><th class="num">借方发生额</th><th class="num">贷方发生额</th><th class="num">净额</th></tr>
        </thead>
        <tbody>
          ${(flow.summaries || []).map((row) => `
            <tr>
              <td>${esc(row.institutionName)}</td>
              <td>
                <div>${esc(row.accountName)}</div>
                <div class="mono" style="font-size:10px;color:var(--muted-2)">${esc(row.code)}</div>
              </td>
              <td>${accountTypeBadge(row.accountType)}</td>
              <td class="num">¥${money(row.debit)}</td>
              <td class="num">¥${money(row.credit)}</td>
              <td class="num amount">${row.net > 0 ? '借 ' : row.net < 0 ? '贷 ' : ''}¥${money(Math.abs(row.net))}</td>
            </tr>
          `).join('') || '<tr><td colspan="6" class="table-empty">尚未执行任何环节</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="trial-strip">
      <span>借方合计 <strong>¥${money(trial.debit)}</strong></span>
      <span>贷方合计 <strong>¥${money(trial.credit)}</strong></span>
      ${trial.balanced ? badge('试算平衡', 'green') : badge('存在差额', 'red')}
    </div>
  `;
}

export function openFlowAccounting(flow) {
  if (!flow) return;
  openModal({
    title: '资金会计链路',
    subtitle: `${flow.typeName} · ${flow.no}`,
    body: flowAccountingBody(flow),
    wide: true,
    footer: [{ label: '关闭', class: 'ghost' }]
  });
}

function platformLedgerHTML(ledger) {
  if (!ledger || !ledger.length) {
    return '<div class="table-empty">该交易暂无平台账务分录</div>';
  }
  return ledger.map((entry) => `
    <div class="je-entry">
      <div class="je-head">
        <div>
          <strong>${esc(entry.title || '平台账务分录')}</strong>
          <div class="je-meta">
            <span class="mono">${esc(entry.id)}</span>
            <span>${esc(fmtTime(entry.createdAt, true))}</span>
            <span>${esc(entry.bizType || '')}</span>
            ${entry.settleDate ? `<span>结算日 ${esc(entry.settleDate)}</span>` : ''}
          </div>
        </div>
        <div class="je-amounts"><span>金额 ¥${money(entry.amount)}</span></div>
      </div>
      <table class="je-table">
        <thead><tr><th>方向</th><th>会计科目</th><th>科目码</th><th class="num">借方</th><th class="num">贷方</th></tr></thead>
        <tbody>
          ${entry.entries.map((line) => `
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
  `).join('');
}

export async function openPaymentAccounting(paymentId) {
  try {
    const data = await get(`/payments/${paymentId}/accounting`);
    const payment = data.payment || {};
    const body = `
      <div class="acct-meta">
        <span class="chip">${esc(payment.subject || '交易')}</span>
        <span class="chip mono">${esc(payment.id || paymentId)}</span>
        ${data.flow ? flowStatusBadge(data.flow.status) : badge('无跨机构链路', 'gray')}
      </div>
      <div class="section-title" style="margin:14px 0 10px"><h2>平台复式记账</h2><span class="sub">支付机构内部账务</span></div>
      ${platformLedgerHTML(data.platformLedger)}
      <div class="section-title" style="margin:22px 0 10px"><h2>跨机构资金清算</h2><span class="sub">发卡行 → 清算机构 → 央行 → 收单行 / 支付机构</span></div>
      ${flowAccountingBody(data.flow)}
    `;
    openModal({
      title: '资金会计链路',
      subtitle: `${payment.subject || ''} · 从用户扣款到最终入账`,
      body,
      wide: true,
      footer: [{ label: '关闭', class: 'ghost' }]
    });
  } catch (error) {
    toast(error.message, 'error');
  }
}

export async function openFlowAccountingById(flowId) {
  try {
    const flow = await get(`/clearing/flows/${flowId}`);
    openFlowAccounting(flow);
  } catch (error) {
    toast(error.message, 'error');
  }
}
