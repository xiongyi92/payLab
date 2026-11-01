import { get, post } from '../api.js';
import {
  esc, money, fmtTime, badge, toast, openModal
} from '../ui.js';
import {
  openFlowAccounting, journalEntriesHTML, accountTypeBadge, flowStatusBadge
} from '../accounting.js';

const CATEGORY = {
  PAYMENT: ['支付机构', 'blue'],
  CLEARING: ['清算机构', 'purple'],
  CENTRAL_BANK: ['中央银行', 'amber'],
  BANK: ['商业银行', 'green']
};

const METRIC_CODES = {
  PAYLAB: [['RESERVE_PBOC', '备付金存款'], ['WALLET_LIABILITY', '钱包余额'], ['MERCHANT_PAYABLE', '商户待结算']],
  NETSUNION: [['RESERVE_PBOC', '特参账户存款'], ['RECEIVABLE', '清算应收'], ['PAYABLE', '清算应付']],
  UNIONPAY: [['RESERVE_PBOC', '清算备付金'], ['RECEIVABLE', '清算应收'], ['PAYABLE', '清算应付']],
  CIPS: [['RESERVE_PBOC', '清算备付金'], ['RECEIVABLE', '跨境应收'], ['PAYABLE', '跨境应付']],
  ICBC: [['DEPOSITS', '吸收存款'], ['LOANS', '贷款余额'], ['RESERVE_PBOC', '央行准备金']],
  CCB: [['DEPOSITS', '吸收存款'], ['DUE_TO_BANKS', '境外同业存放'], ['RESERVE_PBOC', '央行准备金']],
  ABC: [['DEPOSITS', '吸收存款'], ['LOANS', '贷款余额'], ['RESERVE_PBOC', '央行准备金']],
  HSBC: [['DEPOSITS', '吸收存款'], ['DUE_FROM_BANKS', '存放境内代理行'], ['INTERBANK_PAYABLE', '待清算应付']]
};

const viewState = {
  activeFlowId: null,
  type: 'goods',
  amount: '128.00',
  payer: 'U10001',
  payee: '云栖优选商城'
};

let cache = null;
let activeFlow = null;
let busy = false;

function scenarioOf(code) {
  return (cache.scenarios || []).find((item) => item.code === code) || cache.scenarios[0];
}

function metricRows(inst) {
  const balances = Object.fromEntries((inst.balances || []).map((row) => [row.code, row]));
  if (inst.category === 'CENTRAL_BANK') {
    const total = (inst.balances || [])
      .filter((row) => row.type === 'LIABILITY')
      .reduce((sum, row) => sum + row.balance, 0);
    return [
      { label: '准备金 / 备付金负债', value: total },
      { label: '参与机构账户', value: (inst.balances || []).length, raw: true }
    ];
  }
  return (METRIC_CODES[inst.code] || []).map(([code, label]) => ({
    label,
    value: balances[code] ? balances[code].balance : 0
  }));
}

function mapNode(inst) {
  return `
    <div class="cm-node" style="--inst:${inst.color}">
      <span>${esc(inst.short)}</span>
      <small>${esc(inst.role)}</small>
    </div>
  `;
}

function architectureHTML() {
  const byCode = Object.fromEntries(cache.institutions.map((inst) => [inst.code, inst]));
  return `
    <div class="clearing-map">
      <div class="cm-tier">
        <div class="cm-tier-label">中央银行</div>
        <div class="cm-nodes">${mapNode(byCode.PBOC)}</div>
      </div>
      <div class="cm-connector"><span>大额支付系统 CNAPS · 准备金 / 特参账户清算</span></div>
      <div class="cm-tier">
        <div class="cm-tier-label">清算机构</div>
        <div class="cm-nodes">
          ${mapNode(byCode.NETSUNION)}${mapNode(byCode.UNIONPAY)}${mapNode(byCode.CIPS)}
        </div>
      </div>
      <div class="cm-connector"><span>网联 / 银联 / CIPS 转接 · 轧差净额 · 网联特参账户清算</span></div>
      <div class="cm-tier">
        <div class="cm-tier-label">商业银行与支付机构</div>
        <div class="cm-nodes">
          ${mapNode(byCode.ICBC)}${mapNode(byCode.CCB)}${mapNode(byCode.ABC)}${mapNode(byCode.PAYLAB)}${mapNode(byCode.HSBC)}
        </div>
      </div>
    </div>
  `;
}

function scenarioCardsHTML() {
  const icons = { goods: '商品', card: '银行卡', utility: '水电费', topup: '充值', withdraw: '提现', wallet: '余额', cross_border: '跨境' };
  return cache.scenarios.map((scenario) => `
    <button class="quick-card ${scenario.code === viewState.type ? 'picked' : ''}" data-scenario="${scenario.code}" type="button">
      <strong>${esc(scenario.name)}</strong>
      <small>${esc(scenario.desc)}</small>
      <div class="quick-card-foot">
        <span class="chip">${icons[scenario.code] || scenario.code}</span>
        <span class="chip">${scenario.legs} 个环节</span>
      </div>
    </button>
  `).join('');
}

function progressHTML(flow) {
  const legTotal = flow.legs.length || 1;
  const done = flow.legs.filter((leg) => leg.status === 'DONE').length;
  return `
    <div class="progress flow-progress" style="grid-template-columns:repeat(${legTotal}, minmax(0, 1fr))">
      ${flow.legs.map((leg) => {
        const cls = leg.status === 'DONE' ? 'done' : (leg.index === flow.currentLeg && flow.status !== 'DONE' ? 'active' : '');
        return `<span class="seg ${cls}" title="${esc(leg.title)}"></span>`;
      }).join('')}
    </div>
    <div class="flow-progress-label">${done} / ${legTotal} 环节已记账</div>
  `;
}

function legTimelineHTML(flow) {
  return `
    <ol class="leg-list">
      ${flow.legs.map((leg) => {
        const state = leg.status === 'DONE' ? 'done' : (leg.index === flow.currentLeg && flow.status !== 'DONE' ? 'active' : 'pending');
        return `
          <li class="leg ${state}">
            <div class="leg-bullet">${state === 'done' ? '✓' : state === 'active' ? '›' : leg.index + 1}</div>
            <div class="leg-body">
              <div class="leg-head">
                <span class="leg-title">${esc(leg.title)}</span>
                <span class="leg-system">${esc(leg.system)}</span>
                ${state === 'done' ? badge('已记账', 'green') : state === 'active' ? badge('待执行', 'amber') : badge('未开始', 'gray')}
              </div>
              <div class="leg-route">
                <span class="chip">${esc(leg.fromName)}</span>
                <span class="leg-arrow">→</span>
                <span class="chip">${esc(leg.toName)}</span>
                <span class="muted">${esc(leg.detail)}</span>
              </div>
              ${state === 'done' ? `<div class="leg-time mono">记账时间 ${esc(fmtTime(leg.executedAt, true))}</div>` : ''}
            </div>
          </li>
        `;
      }).join('')}
    </ol>
  `;
}

function workbenchHTML(flow) {
  if (!flow) {
    return `
      <div class="card empty-state">
        <div class="empty-icon">⇄</div>
        <h3>尚未创建清算链路</h3>
        <p>从上方选择业务场景创建一笔跨机构资金链路，然后逐环节观察银行、清算机构与央行的记账过程。</p>
      </div>
    `;
  }
  const pending = flow.status !== 'DONE';
  const current = flow.legs[flow.currentLeg];
  return `
    <section class="card wb-head">
      <div class="wb-title">
        <div class="row">
          ${flowStatusBadge(flow.status)}
          ${badge(flow.network, 'purple')}
          <span class="chip">${esc(flow.typeName)}</span>
          ${flow.fxRate ? badge(`${flow.foreignCurrency} ${money(flow.foreignAmount)} × ${flow.fxRate}`, 'blue') : ''}
          ${flow.paymentId ? badge('支付联动', 'blue') : badge('手工发起', 'gray')}
        </div>
        <h3>${esc(flow.typeName)}</h3>
        <div class="wb-meta">链路 ${esc(flow.no)} · ${esc(flow.payer)} → ${esc(flow.payee)}</div>
      </div>
      <div class="wb-amounts">
        <div><small>交易金额</small><strong>¥${money(flow.amount)}</strong></div>
        <div><small>总手续费</small><strong class="faint">¥${money(flow.fee)}</strong></div>
        <div><small>网络清算费</small><strong class="faint">¥${money(flow.networkFee)}</strong></div>
        <div><small>收款方净额</small><strong class="faint">¥${money(flow.payeeNet)}</strong></div>
      </div>
    </section>

    ${progressHTML(flow)}

    <div class="wb-grid">
      <div class="card">
        <div class="card-head">
          <div>
            <h3>资金链路环节</h3>
            <p class="sub">每个环节执行后立即写入复式分录</p>
          </div>
          <span class="chip">${flow.legs.filter((leg) => leg.status === 'DONE').length} / ${flow.legs.length} 已执行</span>
        </div>
        ${legTimelineHTML(flow)}
      </div>

      <aside class="side-stack">
        <div class="card">
          <div class="card-head"><h3>执行操作台</h3>${flowStatusBadge(flow.status)}</div>
          ${pending ? `
            <div class="wait-hint" style="margin-bottom:10px">
              <strong>下一环节：${esc(current ? current.title : '')}</strong>
              ${esc(current ? current.detail : '')}
            </div>
          ` : `
            <div class="result-banner">
              <span class="result-icon">✓</span>
              <div><strong>资金链路已闭环。</strong>全部环节完成记账，借贷双方平衡。</div>
            </div>
          `}
          <div class="actions">
            ${pending ? `
              <button class="btn primary" type="button" data-step>执行下一环节</button>
              <button class="btn ghost" type="button" data-run>一键执行完成</button>
            ` : ''}
            <button class="btn ghost" type="button" data-detail>查看会计链路</button>
          </div>
          <div class="summary-strip">
            <div><small>当前环节</small><strong>${esc(pending && current ? current.title : '已完成')}</strong></div>
            <div><small>处理系统</small><strong>${esc(pending && current ? current.system : '—')}</strong></div>
            <div><small>记账状态</small><strong>${flow.status === 'DONE' ? '借贷平衡' : '部分记账'}</strong></div>
          </div>
        </div>

        <div class="card teaching">
          <div class="tip-label">Teaching Note</div>
          <h3 style="margin-bottom:8px">${esc(flow.typeName)}</h3>
          <p>${esc((cache.scenarios.find((item) => item.code === flow.type) || {}).teaching || '')}</p>
          <div class="tip-meta">${esc(flow.network)} · ${flow.legs.length} 个清算环节</div>
        </div>
      </aside>
    </div>
  `;
}

function bankFlowTrail(flow) {
  return flow.legs.map((leg) => `${esc(leg.fromName)} → ${esc(leg.toName)}`).join(' · ');
}

function flowsTableHTML() {
  if (!cache.flows.length) {
    return '<div class="table-empty">暂无清算链路。选择场景创建第一笔跨机构资金流。</div>';
  }
  return `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>创建时间</th><th>场景</th><th>资金流向</th><th class="num">金额</th>
            <th class="num">手续费</th><th>进度</th><th>状态</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${cache.flows.map((flow) => `
            <tr>
              <td class="mono">${esc(fmtTime(flow.createdAt, true))}</td>
              <td>
                <div>${esc(flow.typeName)}</div>
                <div class="mono" style="font-size:10px;color:var(--muted-2)">${esc(flow.no)}</div>
              </td>
              <td class="flow-trail">${esc(flow.payer)} → ${esc(flow.payee)}<div class="mono">${bankFlowTrail(flow)}</div></td>
              <td class="num amount">¥${money(flow.amount)}</td>
              <td class="num">¥${money(flow.fee)}</td>
              <td class="nowrap">${flow.legDone}/${flow.legTotal}</td>
              <td>${flowStatusBadge(flow.status)}</td>
              <td>
                <div class="actions-cell">
                  <button class="btn sm ghost" type="button" data-flow-detail="${flow.id}">详情</button>
                  ${flow.status !== 'DONE' ? `<button class="btn sm primary" type="button" data-flow-step="${flow.id}">执行下一环节</button>` : ''}
                  ${flow.status !== 'DONE' ? `<button class="btn sm ghost" type="button" data-flow-run="${flow.id}">一键完成</button>` : ''}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function institutionsHTML() {
  return `
    <div class="inst-grid">
      ${cache.institutions.map((inst) => {
        const [categoryText, tone] = CATEGORY[inst.category] || [inst.category, 'gray'];
        const metrics = metricRows(inst);
        return `
          <div class="inst-card" style="--inst:${inst.color}">
            <div class="inst-head">
              <strong>${esc(inst.short)}</strong>
              ${badge(categoryText, tone)}
            </div>
            <div class="inst-name">${esc(inst.name)}</div>
            <div class="inst-role">${esc(inst.role)}</div>
            <div class="inst-metrics">
              ${metrics.map((metric) => `
                <div>
                  <small>${esc(metric.label)}</small>
                  <strong>${metric.raw ? metric.value : `¥${money(metric.value)}`}</strong>
                </div>
              `).join('')}
            </div>
            <button class="link-btn" type="button" data-institution="${inst.code}">查看全部科目 ›</button>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function institutionModal(inst) {
  const totals = { ASSET: 0, LIABILITY: 0, INCOME: 0 };
  for (const row of inst.balances) {
    if (totals[row.type] !== undefined) totals[row.type] += row.balance;
  }
  openModal({
    title: inst.name,
    subtitle: `${inst.role} · 科目余额表`,
    wide: true,
    body: `
      <div class="row" style="margin-bottom:12px">
        <span class="chip">资产合计 ¥${money(totals.ASSET)}</span>
        <span class="chip">负债合计 ¥${money(totals.LIABILITY)}</span>
        <span class="chip">收入合计 ¥${money(totals.INCOME)}</span>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>科目</th><th>类型</th><th>正常方向</th><th class="num">借方发生额</th><th class="num">贷方发生额</th><th class="num">余额</th></tr></thead>
          <tbody>
            ${inst.balances.map((row) => `
              <tr>
                <td>
                  <div>${esc(row.name)}</div>
                  <div class="mono" style="font-size:10px;color:var(--muted-2)">${esc(row.code)}</div>
                  <div class="note" style="font-size:10.5px;margin-top:2px">${esc(row.desc)}</div>
                </td>
                <td>${accountTypeBadge(row.type)}</td>
                <td>${row.normalSide === 'DEBIT' ? '借方' : '贷方'}</td>
                <td class="num">¥${money(row.debit)}</td>
                <td class="num">¥${money(row.credit)}</td>
                <td class="num amount">¥${money(row.balance)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="note mt-12">余额方向遵循会计科目性质：资产类余额 = 借方 - 贷方；负债与收入类余额 = 贷方 - 借方。</div>
    `,
    footer: [{ label: '关闭', class: 'ghost' }]
  });
}

async function loadActive(root) {
  if (!viewState.activeFlowId) {
    activeFlow = null;
    return;
  }
  try {
    activeFlow = await get(`/clearing/flows/${viewState.activeFlowId}`);
  } catch (error) {
    viewState.activeFlowId = null;
    activeFlow = null;
    toast(error.message, 'error');
  }
}

function fillForm(root) {
  const form = root.querySelector('#clear-form');
  if (!form) return;
  form.type.value = viewState.type;
  form.amount.value = viewState.amount;
  form.payer.value = viewState.payer;
  form.payee.value = viewState.payee;
}

function updateBanner(root) {
  const banner = root.querySelector('#clear-banner');
  if (!banner) return;
  const scenario = scenarioOf(viewState.type);
  banner.innerHTML = `
    <span class="tag">${esc(scenario.network)}</span>
    <span>${esc(scenario.desc)}</span>
  `;
}

function renderWorkbench(root) {
  const box = root.querySelector('#flow-workbench');
  if (box) box.innerHTML = workbenchHTML(activeFlow);
}

function syncStateFromForm(form) {
  viewState.type = form.type.value;
  viewState.amount = form.amount.value;
  viewState.payer = form.payer.value;
  viewState.payee = form.payee.value;
}

function applyScenario(root, code) {
  const scenario = scenarioOf(code);
  viewState.type = scenario.code;
  viewState.amount = Number(scenario.defaultAmount).toFixed(2);
  viewState.payer = scenario.payer;
  viewState.payee = scenario.payee;
  fillForm(root);
  updateBanner(root);
  root.querySelectorAll('[data-scenario]').forEach((button) => {
    button.classList.toggle('picked', button.dataset.scenario === scenario.code);
  });
}

async function createFlow(root, autoRun) {
  if (busy) return;
  const form = root.querySelector('#clear-form');
  syncStateFromForm(form);
  const payload = {
    type: viewState.type,
    amount: Number(viewState.amount),
    payer: viewState.payer,
    payee: viewState.payee,
    autoRun
  };
  busy = true;
  try {
    const flow = await post('/clearing/flows', payload);
    viewState.activeFlowId = flow.id;
    activeFlow = flow;
    await paint(root);
    renderWorkbench(root);
    toast(autoRun ? '资金链路已一键执行完成' : '清算链路已创建，可逐环节执行', 'success');
    const box = root.querySelector('#flow-workbench');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    busy = false;
  }
}

async function stepFlow(root, flowId, runAll) {
  if (busy) return;
  busy = true;
  try {
    const flow = await post(`/clearing/flows/${flowId}/${runAll ? 'run' : 'step'}`);
    viewState.activeFlowId = flow.id;
    activeFlow = flow;
    await paint(root);
    renderWorkbench(root);
    toast(runAll ? '资金链路已全部执行' : `已执行：${flow.legs[flow.currentLeg - 1] ? flow.legs[flow.currentLeg - 1].title : '当前环节'}`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    busy = false;
  }
}

async function paint(root) {
  cache = await get('/clearing');
  if (viewState.activeFlowId && !cache.flows.some((flow) => flow.id === viewState.activeFlowId)) {
    viewState.activeFlowId = null;
  }
  await loadActive(root);

  const kpis = cache.kpis;
  root.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">累计清算金额</div>
        <div class="kpi-value">¥${money(kpis.volume)}</div>
        <div class="kpi-foot">${kpis.count} 条跨机构资金链路</div>
      </div>
      <div class="kpi k-green">
        <div class="kpi-label">已闭环链路</div>
        <div class="kpi-value">${kpis.done}<small>条</small></div>
        <div class="kpi-foot">全部环节完成记账 · 借贷平衡</div>
      </div>
      <div class="kpi k-amber">
        <div class="kpi-label">待执行环节</div>
        <div class="kpi-value">${kpis.pending}<small>条链路</small></div>
        <div class="kpi-foot">可逐环节执行或一键完成</div>
      </div>
      <div class="kpi k-purple">
        <div class="kpi-label">清算参与机构</div>
        <div class="kpi-value">${kpis.institutionCount}<small>家</small></div>
        <div class="kpi-foot">累计 ${kpis.journalCount} 张清算分录 · ${kpis.balanced ? '试算平衡' : '存在差额'}</div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div>
          <h2>跨机构清算架构</h2>
          <p class="sub">商业银行 → 清算机构（网联 / 银联 / CIPS）→ 网联特参账户 / 央行准备金账户 → 收款行 / 支付机构</p>
        </div>
        <span class="chip">${cache.institutions.length} 家参与机构</span>
      </div>
      ${architectureHTML()}
      <div class="arch-aux">
        <span class="chip">备付金 100% 集中存管</span>
        <span class="chip">网联特参账户清算</span>
        <span class="chip">轧差净额清算</span>
        <span class="chip">准备金账户最终结算</span>
        <a class="chip" href="#/banking">银行会计 ›</a>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div>
          <h2>资金清算场景执行</h2>
          <p class="sub">选择业务场景，创建一笔跨机构资金链路并观察每个环节的会计分录</p>
        </div>
        <span class="chip">${cache.scenarios.length} 个教学场景</span>
      </div>
      <div class="quick-grid">${scenarioCardsHTML()}</div>
      <form id="clear-form" class="form-grid mt-16" autocomplete="off">
        <label class="field col-3">
          <span>清算场景</span>
          <select name="type">
            ${cache.scenarios.map((scenario) => `<option value="${scenario.code}">${esc(scenario.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field col-2">
          <span>金额（元）</span>
          <input type="number" name="amount" min="0.01" max="500000" step="0.01">
        </label>
        <label class="field col-3">
          <span>付款方</span>
          <input type="text" name="payer" maxlength="40">
        </label>
        <label class="field col-2">
          <span>收款方</span>
          <input type="text" name="payee" maxlength="40">
        </label>
        <div class="col-2 form-actions">
          <button class="btn primary" type="submit">创建并逐步执行</button>
        </div>
      </form>
      <div id="clear-banner" class="scenario-banner"></div>
      <div class="row mt-12">
        <button id="create-run" class="btn ghost" type="button">创建并一键执行完成</button>
        <span class="note">“逐步执行”适合观察每一跳；账务分录在环节执行时同步写入，重复执行不会重复记账。</span>
      </div>
    </div>

    <div id="flow-workbench" class="workbench">${workbenchHTML(activeFlow)}</div>

    <div class="card mt-16">
      <div class="card-head">
        <div>
          <h2>清算链路记录</h2>
          <p class="sub">点击“详情”查看完整资金会计链路与各机构分录</p>
        </div>
        <span class="chip">${cache.flows.length} 条链路</span>
      </div>
      ${flowsTableHTML()}
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div>
          <h2>机构账务视图</h2>
          <p class="sub">各参与机构的科目余额与资金存管关系</p>
        </div>
        <div class="row">
          ${badge(cache.trial.balanced ? '全局试算平衡' : '全局不平衡', cache.trial.balanced ? 'green' : 'red')}
          <span class="chip">${cache.trial.entryCount} 张分录</span>
        </div>
      </div>
      ${institutionsHTML()}
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div>
          <h2>最近清算分录</h2>
          <p class="sub">跨机构日志按时间倒序，展示每一笔资金流转的借贷双方</p>
        </div>
        ${cache.trial.balanced ? badge('借贷平衡', 'green') : badge('存在差额', 'red')}
      </div>
      ${journalEntriesHTML(cache.recentJournal)}
      <div class="trial-strip">
        <span>借方合计 <strong>¥${money(cache.trial.debit)}</strong></span>
        <span>贷方合计 <strong>¥${money(cache.trial.credit)}</strong></span>
        ${cache.trial.balanced ? badge('试算平衡', 'green') : badge('存在差额', 'red')}
      </div>
    </div>
  `;

  fillForm(root);
  updateBanner(root);

  const form = root.querySelector('#clear-form');
  form.addEventListener('change', (event) => {
    if (event.target.name === 'type') {
      applyScenario(root, event.target.value);
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    createFlow(root, false);
  });
  root.querySelector('#create-run').addEventListener('click', () => createFlow(root, true));

  root.querySelectorAll('[data-scenario]').forEach((button) => {
    button.addEventListener('click', () => applyScenario(root, button.dataset.scenario));
  });

  root.querySelectorAll('[data-flow-detail]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const flow = await get(`/clearing/flows/${button.dataset.flowDetail}`);
        openFlowAccounting(flow);
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });

  root.querySelectorAll('[data-flow-step]').forEach((button) => {
    button.addEventListener('click', () => stepFlow(root, button.dataset.flowStep, false));
  });

  root.querySelectorAll('[data-flow-run]').forEach((button) => {
    button.addEventListener('click', () => stepFlow(root, button.dataset.flowRun, true));
  });

  root.querySelectorAll('[data-institution]').forEach((button) => {
    button.addEventListener('click', () => {
      const inst = cache.institutions.find((item) => item.code === button.dataset.institution);
      if (inst) institutionModal(inst);
    });
  });

  const workbench = root.querySelector('#flow-workbench');
  workbench.addEventListener('click', (event) => {
    if (!activeFlow) return;
    if (event.target.closest('[data-step]')) {
      stepFlow(root, activeFlow.id, false);
      return;
    }
    if (event.target.closest('[data-run]')) {
      stepFlow(root, activeFlow.id, true);
      return;
    }
    if (event.target.closest('[data-detail]')) {
      openFlowAccounting(activeFlow);
    }
  });

  return () => {};
}

export default {
  async render(root) {
    await paint(root);
    return () => {};
  }
};
