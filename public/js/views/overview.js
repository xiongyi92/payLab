import { get, post } from '../api.js';
import { appState } from '../state.js';
import { esc, money, pct, fmtTime, payBadge, badge, toast, openModal } from '../ui.js';
import { openFlowAccounting, flowStatusBadge, accountTypeBadge } from '../accounting.js';

const QUICK_SCENARIOS = [
  { code: 'normal', name: '正常支付', desc: '12 个阶段完整闭环' },
  { code: 'callback_lost', name: '回调丢失', desc: '掉单后的主动查单补偿' },
  { code: 'callback_dup', name: '重复回调', desc: '验证幂等不重复入账' },
  { code: 'risk_block', name: '风控拦截', desc: '黑名单买家实时阻断' },
  { code: 'channel_fail', name: '渠道降级', desc: '主通道故障自动切换' },
  { code: 'large_review', name: '大额复核', desc: '人工审核后放行' },
  { code: 'cross_border', name: '跨境支付', desc: 'USD 结汇 + CIPS 清算' }
];

let labFlow = null;
const lab = { type: 'goods', amount: null, busy: false };

function scenarioByCode(data, code) {
  return (data.scenarios || []).find((item) => item.code === code) || data.scenarios[0];
}

function bannerHTML(scenario) {
  return `<span class="tag">${esc(scenario.network)}</span><span>${esc(scenario.teaching)}</span>`;
}

function flowInstitutionTrail(flow, institutions) {
  const seen = new Set();
  const names = [];
  for (const leg of flow.legs) {
    for (const code of [leg.from, leg.to]) {
      if (!code || seen.has(code)) continue;
      const inst = institutions.find((item) => item.code === code);
      if (!inst) continue;
      seen.add(code);
      names.push(inst.short);
    }
  }
  return names;
}

function progressSegments(flow) {
  return flow.legs.map((leg) => {
    const cls = leg.status === 'DONE'
      ? 'done'
      : (leg.index === flow.currentLeg && flow.status !== 'DONE' ? 'active' : '');
    return `<span class="seg ${cls}" title="${esc(leg.title)}"></span>`;
  }).join('');
}

function lastEntriesHTML(flow) {
  const leg = flow.legs[flow.legDone - 1];
  if (!leg || !leg.entries || !leg.entries.length) return '';
  const groups = new Map();
  for (const entry of leg.entries) {
    if (!groups.has(entry.institution)) {
      groups.set(entry.institution, { name: entry.institutionName, debit: 0, credit: 0 });
    }
    const group = groups.get(entry.institution);
    group.debit += entry.debit;
    group.credit += entry.credit;
  }
  return `
    <div class="pano-entries">
      <div class="pano-entries-head">最近一次记账 · ${esc(leg.title)}</div>
      <div class="pano-entry-grid">
        ${[...groups.values()].map((group) => `
          <div class="pano-entry">
            <span class="pano-entry-name">${esc(group.name)}</span>
            <span class="pano-entry-amt">借 ¥${money(group.debit)} · 贷 ¥${money(group.credit)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function labStatusHTML(data) {
  if (!labFlow) {
    return `
      <div class="pano-lab-empty">
        <span class="dot"></span>
        <span>尚未创建实验链路。选择场景后点击「创建并逐步执行」，下方架构图会高亮本次参与机构。</span>
      </div>
    `;
  }
  const flow = labFlow;
  const pending = flow.status !== 'DONE';
  const current = pending ? flow.legs[flow.currentLeg] : null;
  const done = flow.legs.filter((leg) => leg.status === 'DONE').length;
  const trail = flowInstitutionTrail(flow, data.institutions);
  return `
    <div class="pano-run">
      <div class="pano-run-head">
        <div class="pano-run-title">
          <div class="row">
            ${flowStatusBadge(flow.status)}
            <span class="chip">${esc(flow.network)}</span>
            <span class="chip mono">${esc(flow.no)}</span>
          </div>
          <strong>${esc(flow.typeName)} · ¥${money(flow.amount)}</strong>
        </div>
        <div class="pano-run-amounts">
          <div><small>手续费</small><strong>¥${money(flow.fee)}</strong></div>
          <div><small>收款净额</small><strong>¥${money(flow.payeeNet)}</strong></div>
          <div><small>已执行</small><strong>${done} / ${flow.legs.length}</strong></div>
        </div>
      </div>
      <div class="progress flow-progress" style="grid-template-columns:repeat(${flow.legs.length}, minmax(0, 1fr))">${progressSegments(flow)}</div>
      <div class="pano-run-body">
        <div class="pano-current">
          ${pending && current ? `
            <small>下一环节 · ${esc(current.system)}</small>
            <strong>${esc(current.title)}</strong>
            <span>${esc(current.fromName)} → ${esc(current.toName)}</span>
            <p>${esc(current.detail || '')}</p>
          ` : `
            <small>实验完成</small>
            <strong>全部环节已记账，借贷平衡</strong>
            <span>参与机构的分录合计相等，客户资金完成跨机构转移。</span>
          `}
        </div>
        <div class="actions">
          ${pending ? `
            <button class="btn primary sm" type="button" data-lab-step>执行下一环节</button>
            <button class="btn ghost sm" type="button" data-lab-run>一键完成</button>
          ` : ''}
          <button class="btn ghost sm" type="button" data-lab-detail>查看会计链路</button>
          <button class="btn ghost sm" type="button" data-lab-reset>重新实验</button>
        </div>
      </div>
      ${lastEntriesHTML(flow)}
      <div class="pano-run-foot">参与机构：${trail.map(esc).join(' → ')} · 实验会写入真实账本，可在「清算网络」查看记录。</div>
    </div>
  `;
}

function applyLabHighlights(root, flow) {
  const pano = root.querySelector('#pano-diagram');
  if (!pano) return;
  pano.classList.toggle('has-flow', Boolean(flow));
  const involved = new Set();
  for (const leg of flow ? flow.legs : []) {
    if (leg.from) involved.add(leg.from);
    if (leg.to) involved.add(leg.to);
  }
  const current = flow && flow.status !== 'DONE' ? flow.legs[flow.currentLeg] : null;
  const currentCodes = new Set(current ? [current.from, current.to] : []);
  pano.querySelectorAll('.pano-node').forEach((node) => {
    const codes = (node.dataset.inst || '').split(/\s+/).filter(Boolean);
    node.classList.toggle('pano-hot', codes.some((code) => involved.has(code)));
    node.classList.toggle('pano-current', codes.some((code) => currentCodes.has(code)));
  });
  pano.querySelectorAll('.pano-tier').forEach((tier) => {
    const foundational = tier.dataset.layer === 'user' || tier.dataset.layer === 'entry';
    tier.classList.toggle('tier-hot', Boolean(flow) && (foundational || Boolean(tier.querySelector('.pano-node.pano-hot'))));
  });
}

function renderLabStatus(root, data) {
  const box = root.querySelector('#pano-lab-status');
  if (box) box.innerHTML = labStatusHTML(data);
  applyLabHighlights(root, labFlow);
}

function syncLabForm(root, data) {
  const scenario = scenarioByCode(data, root.querySelector('#pano-type').value);
  lab.type = scenario.code;
  lab.amount = Number(scenario.defaultAmount).toFixed(2);
  root.querySelector('#pano-amount').value = lab.amount;
  root.querySelector('#pano-route').textContent = `${scenario.payer} → ${scenario.payee}`;
  root.querySelector('#pano-network').textContent = `${scenario.network} · ${scenario.legs} 个环节`;
  root.querySelector('#pano-banner').innerHTML = bannerHTML(scenario);
}

async function startExperiment(root, data, autoRun) {
  if (lab.busy) return;
  const scenario = scenarioByCode(data, root.querySelector('#pano-type').value);
  const amount = Number(root.querySelector('#pano-amount').value);
  if (!Number.isFinite(amount) || amount < 0.01 || amount > 500000) {
    toast('实验金额需在 0.01 ~ 500,000.00 元之间', 'error');
    return;
  }
  lab.busy = true;
  try {
    const flow = await post('/clearing/flows', {
      type: scenario.code,
      amount,
      payer: scenario.payer,
      payee: scenario.payee,
      autoRun
    });
    lab.type = scenario.code;
    lab.amount = amount.toFixed(2);
    labFlow = flow;
    const counter = root.querySelector('#pano-flow-count');
    if (counter) {
      const next = Number(counter.dataset.count || 0) + 1;
      counter.dataset.count = String(next);
      counter.textContent = `${next} 条清算链路`;
    }
    renderLabStatus(root, data);
    toast(autoRun ? `实验完成：${scenario.name} 全链路已记账` : '实验链路已创建，可逐环节执行', 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    lab.busy = false;
  }
}

async function stepExperiment(root, data, runAll) {
  if (lab.busy || !labFlow) return;
  const currentId = labFlow.id;
  lab.busy = true;
  try {
    const flow = await post(`/clearing/flows/${currentId}/${runAll ? 'run' : 'step'}`);
    labFlow = flow;
    renderLabStatus(root, data);
    const lastLeg = flow.legs[flow.legDone - 1];
    toast(runAll ? '全部环节执行完成，试算平衡' : `已记账：${lastLeg ? lastLeg.title : '当前环节'}`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    lab.busy = false;
  }
}

function institutionTotals(inst) {
  const totals = { ASSET: 0, LIABILITY: 0, INCOME: 0 };
  for (const row of inst.balances || []) {
    if (totals[row.type] !== undefined) totals[row.type] += row.balance;
  }
  return totals;
}

function openInstitutionModal(inst) {
  const totals = institutionTotals(inst);
  const isBank = inst.category === 'BANK';
  openModal({
    title: inst.name,
    subtitle: `${inst.role} · 实时科目余额`,
    wide: true,
    body: `
      <div class="row" style="margin-bottom:12px">
        <span class="chip" style="border-color:${inst.color}66">${esc(inst.short)}</span>
        <span class="chip">资产 ¥${money(totals.ASSET)}</span>
        <span class="chip">负债 ¥${money(totals.LIABILITY)}</span>
        <span class="chip">收入 ¥${money(totals.INCOME)}</span>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>科目</th><th>类型</th><th class="num">借方发生额</th><th class="num">贷方发生额</th><th class="num">余额</th></tr></thead>
          <tbody>
            ${(inst.balances || []).map((row) => `
              <tr>
                <td>
                  <div>${esc(row.name)}</div>
                  <div class="mono" style="font-size:10px;color:var(--muted-2)">${esc(row.code)}</div>
                </td>
                <td>${accountTypeBadge(row.type)}</td>
                <td class="num">¥${money(row.debit)}</td>
                <td class="num">¥${money(row.credit)}</td>
                <td class="num amount">¥${money(row.balance)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="note mt-12">余额遵循科目性质：资产类 = 借方 - 贷方；负债与收入类 = 贷方 - 借方。</div>
    `,
    footer: [
      { label: '关闭', class: 'ghost' },
      {
        label: isBank ? '进入银行会计' : '进入清算网络',
        class: 'primary',
        onClick: (close) => {
          close();
          location.hash = isBank ? '#/banking' : '#/clearing';
        }
      }
    ]
  });
}

function openBankGroupModal(banks) {
  const rows = banks.map((bank) => {
    const balances = Object.fromEntries((bank.balances || []).map((row) => [row.code, row.balance]));
    return `
      <tr>
        <td>
          <div>${esc(bank.name)}</div>
          <div class="mono" style="font-size:10px;color:var(--muted-2)">${esc(bank.code)}</div>
        </td>
        <td class="num">¥${money(balances.DEPOSITS || 0)}</td>
        <td class="num">¥${money(balances.LOANS || 0)}</td>
        <td class="num">¥${money(balances.RESERVE_PBOC || 0)}</td>
        <td class="num">¥${money((balances.FEE_INCOME || 0) + (balances.INTEREST_INCOME || 0))}</td>
      </tr>
    `;
  }).join('');
  openModal({
    title: '商业银行体系',
    subtitle: '发卡行 / 收单行 / 账户行 · 实时科目余额',
    wide: true,
    body: `
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>银行</th><th class="num">吸收存款</th><th class="num">贷款余额</th><th class="num">央行准备金</th><th class="num">中间业务与利息收入</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="note mt-12">存款是银行负债、贷款是资产；准备金账户用于跨行清算，中间业务收入不占用银行资金。</div>
    `,
    footer: [
      { label: '关闭', class: 'ghost' },
      {
        label: '进入银行会计',
        class: 'primary',
        onClick: (close) => {
          close();
          location.hash = '#/banking';
        }
      }
    ]
  });
}

function bindLab(root, data) {
  const type = root.querySelector('#pano-type');
  type.addEventListener('change', () => syncLabForm(root, data));
  root.querySelector('#pano-start').addEventListener('click', () => startExperiment(root, data, false));
  root.querySelector('#pano-run').addEventListener('click', () => startExperiment(root, data, true));

  root.querySelector('#pano-lab-status').addEventListener('click', (event) => {
    if (event.target.closest('[data-lab-step]')) {
      stepExperiment(root, data, false);
      return;
    }
    if (event.target.closest('[data-lab-run]')) {
      stepExperiment(root, data, true);
      return;
    }
    if (event.target.closest('[data-lab-detail]')) {
      if (labFlow) openFlowAccounting(labFlow);
      return;
    }
    if (event.target.closest('[data-lab-reset]')) {
      labFlow = null;
      renderLabStatus(root, data);
    }
  });

  root.querySelectorAll('.pano-node[data-inst]').forEach((node) => {
    node.addEventListener('click', () => {
      const codes = (node.dataset.inst || '').split(/\s+/).filter(Boolean);
      const insts = codes
        .map((code) => data.institutions.find((item) => item.code === code))
        .filter(Boolean);
      if (!insts.length) return;
      if (insts.length > 1) openBankGroupModal(insts);
      else openInstitutionModal(insts[0]);
    });
  });
}

export default {
  async render(root) {
    const [summary, meta, clearing] = await Promise.all([
      get('/summary'),
      get('/meta'),
      get('/clearing')
    ]);
    if (labFlow) {
      try {
        labFlow = await get(`/clearing/flows/${labFlow.id}`);
      } catch (error) {
        labFlow = null;
      }
    }
    if (!clearing.scenarios.some((item) => item.code === lab.type)) {
      lab.type = clearing.scenarios[0].code;
    }
    const kpis = summary.kpis;
    const labScenario = scenarioByCode(clearing, lab.type);
    if (lab.amount === null) lab.amount = Number(labScenario.defaultAmount).toFixed(2);
    const stagePayment = appState.activePaymentId
      ? { id: appState.activePaymentId }
      : (summary.recent.find((item) => item.completed) || summary.recent[0] || null);

    root.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi">
          <div class="kpi-label">今日交易额 GMV</div>
          <div class="kpi-value">¥${money(kpis.gmv)}</div>
          <div class="kpi-foot"><span class="up">●</span> 成功支付 ${kpis.successCount} 笔 · 今日退款 ¥${money(kpis.refundToday)}</div>
        </div>
        <div class="kpi k-green">
          <div class="kpi-label">今日交易笔数</div>
          <div class="kpi-value">${kpis.count}<small>笔</small></div>
          <div class="kpi-foot">今日创建交易 · 含进行中、失败与已关闭</div>
        </div>
        <div class="kpi k-purple">
          <div class="kpi-label">支付成功率</div>
          <div class="kpi-value">${pct(kpis.successRate)}</div>
          <div class="kpi-foot">按已完成交易口径计算</div>
        </div>
        <div class="kpi k-amber">
          <div class="kpi-label">待结算资金</div>
          <div class="kpi-value">¥${money(kpis.pendingSettlement)}</div>
          <div class="kpi-foot">${kpis.pendingBatchCount} 个待结算批次 · T+1 出款</div>
        </div>
      </div>

      <div class="grid-2" style="margin-top:16px">
        <div class="card">
          <div class="card-head">
            <div>
              <h2>支付系统全景</h2>
              <p class="sub">信息流、资金流与账务流的完整闭环 · 点击阶段查看数据与会计计算</p>
            </div>
            <span class="chip">12 个阶段</span>
          </div>
          <div class="arch">
            <div class="arch-flow">
              <div class="arch-node"><span>用户 / 商户</span><small>下单 · 收银</small></div>
              <div class="arch-arrow">›</div>
              <div class="arch-node"><span>收银台</span><small>支付方式 · 要素</small></div>
              <div class="arch-arrow">›</div>
              <div class="arch-node accent"><span>支付网关</span><small>收单 · 验签 · 幂等</small></div>
              <div class="arch-arrow">›</div>
              <div class="arch-node"><span>支付渠道</span><small>支付宝 · 微信 · 银联</small></div>
              <div class="arch-arrow">›</div>
              <div class="arch-node"><span>账务中心</span><small>复式记账 · 分录</small></div>
              <div class="arch-arrow">›</div>
              <div class="arch-node"><span>对账结算</span><small>T+1 对账 · 出款</small></div>
            </div>
            <div class="arch-aux">
              <span class="chip">风控引擎 · 事前拦截</span>
              <span class="chip">路由中心 · 成本与降级</span>
              <span class="chip">通知中心 · 重试与幂等</span>
            </div>
            <div class="arch-aux" style="margin-top:10px">
              ${meta.phases.map((phase, index) => `
                <a class="chip phase-chip" href="${stagePayment ? `#/stage/${encodeURIComponent(stagePayment.id)}/${index}` : '#/payment'}" title="查看「${esc(phase.name)}」的数据与会计计算">
                  <b>${index + 1}</b> ${esc(phase.name)}
                </a>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div>
              <h2>一键进入教学场景</h2>
              <p class="sub">自动预填参数，进入演练台逐步执行</p>
            </div>
            <a class="link-btn" href="#/payment">全部场景 ›</a>
          </div>
          <div class="quick-grid">
            ${QUICK_SCENARIOS.map((scenario) => `
              <button class="quick-card" data-scenario="${scenario.code}" type="button">
                <strong>${esc(scenario.name)}</strong>
                <small>${esc(scenario.desc)}</small>
              </button>
            `).join('')}
          </div>
          <div class="scenario-banner" style="margin-top:14px">
            <span class="tag">教学建议</span>
            <span>先跑一次「正常支付」建立全局认知，再体验回调丢失、重复回调、风控拦截与渠道降级，最后用「跨境支付」理解结汇与 CIPS 清算。</span>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-head">
          <div>
            <h2>中国支付全景架构</h2>
            <p class="sub">六层机构与三条脉络：从 C 端支付需求到央行准备金账户的最终清算</p>
          </div>
          <div class="row pano-legend">
            <span class="pano-key info">信息流</span>
            <span class="pano-key fund">资金流</span>
            <span class="pano-key rule">监管要求</span>
          </div>
        </div>

        <div class="pano-lab" id="pano-lab">
          <div class="pano-lab-head">
            <div>
              <div class="tip-label">互动实验</div>
              <h3>亲手跑一笔跨机构清算</h3>
              <p class="sub">选择场景与金额创建链路，下方架构图会高亮参与机构，并支持逐环节记账</p>
            </div>
            <div class="row">
              <span class="chip">${clearing.institutions.length} 家参与机构</span>
              <span class="chip" id="pano-flow-count" data-count="${clearing.kpis.count}">${clearing.kpis.count} 条清算链路</span>
              ${badge(clearing.trial.balanced ? '全局试算平衡' : '存在差额', clearing.trial.balanced ? 'green' : 'red')}
            </div>
          </div>
          <div class="pano-lab-form">
            <label class="field">
              <span>业务场景</span>
              <select id="pano-type">
                ${clearing.scenarios.map((item) => `<option value="${item.code}"${item.code === labScenario.code ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}
              </select>
            </label>
            <label class="field">
              <span>实验金额（元）</span>
              <input id="pano-amount" type="number" min="0.01" max="500000" step="0.01" value="${esc(lab.amount)}">
            </label>
            <div class="pano-lab-route">
              <small>资金流向</small>
              <strong id="pano-route">${esc(labScenario.payer)} → ${esc(labScenario.payee)}</strong>
              <span class="chip" id="pano-network">${esc(labScenario.network)} · ${labScenario.legs} 个环节</span>
            </div>
            <div class="actions">
              <button class="btn primary" id="pano-start" type="button">创建并逐步执行</button>
              <button class="btn ghost" id="pano-run" type="button">创建并一键完成</button>
            </div>
          </div>
          <div class="scenario-banner" id="pano-banner">${bannerHTML(labScenario)}</div>
          <div id="pano-lab-status">${labStatusHTML(clearing)}</div>
        </div>

        <div class="pano" id="pano-diagram">
          <div class="pano-tier t-user" data-layer="user">
            <div class="pano-label"><b>01</b><span>用户与商户</span><small>支付需求的发生端</small></div>
            <div class="pano-nodes">
              <div class="pano-node"><strong>C 端消费者</strong><small>扫码 · 被扫 · 刷脸 · 免密支付</small></div>
              <div class="pano-node"><strong>B 端商户</strong><small>线上商城 · 线下门店 · 连锁零售</small></div>
              <div class="pano-node"><strong>企业与机构</strong><small>供应链 · 代发代扣 · 跨境贸易</small></div>
              <div class="pano-node"><strong>政务与民生</strong><small>社保 · 税费 · 水电燃气 · 交通出行</small></div>
            </div>
          </div>

          <div class="pano-link">
            <span class="pano-flow info">商品订单 · 支付需求</span>
          </div>

          <div class="pano-tier t-entry" data-layer="entry">
            <div class="pano-label"><b>02</b><span>场景与入口</span><small>把支付能力嵌入交易场景</small></div>
            <div class="pano-nodes">
              <div class="pano-node"><strong>收银台 / 聚合支付</strong><small>一次接入，多渠道收单</small></div>
              <div class="pano-node"><strong>App / 小程序 / H5</strong><small>钱包、电商与 SaaS 收银</small></div>
              <div class="pano-node"><strong>二维码 / NFC / 刷脸</strong><small>条码支付与近场支付介质</small></div>
              <div class="pano-node"><strong>跨境独立站</strong><small>境外收单与本地化支付</small></div>
            </div>
          </div>

          <div class="pano-link">
            <span class="pano-flow info">支付要素 · 支付指令</span>
          </div>

          <div class="pano-tier t-inst" data-layer="inst">
            <div class="pano-label"><b>03</b><span>支付服务机构</span><small>持牌经营，管理账户与收单</small></div>
            <div class="pano-nodes">
              <button class="pano-node accent" type="button" data-inst="ICBC CCB ABC"><strong>商业银行</strong><small>发卡行 · 收单行 · 账户行</small></button>
              <button class="pano-node accent" type="button" data-inst="PAYLAB"><strong>第三方支付机构</strong><small>支付宝 · 微信支付 · 银联商务</small></button>
              <div class="pano-node"><strong>聚合技术服务商</strong><small>为商户整合多个支付通道</small></div>
              <button class="pano-node accent" type="button" data-inst="HSBC"><strong>境外收单机构</strong><small>境外卡收单 · 结售汇 · CIPS 间接参与者</small></button>
            </div>
          </div>

          <div class="pano-link">
            <span class="pano-flow info">交易报文 · 轧差净额</span>
            <span class="pano-flow fund">备付金 / 准备金划拨</span>
          </div>

          <div class="pano-tier t-clearing" data-layer="clearing">
            <div class="pano-label"><b>04</b><span>清算基础设施</span><small>跨机构转接与净额清算</small></div>
            <div class="pano-nodes">
              <button class="pano-node accent" type="button" data-inst="NETSUNION"><strong>网联清算平台</strong><small>第三方支付网络清算 · 断直连</small></button>
              <button class="pano-node accent" type="button" data-inst="UNIONPAY"><strong>中国银联</strong><small>银行卡跨行转接清算</small></button>
              <button class="pano-node accent" type="button" data-inst="CIPS"><strong>CIPS</strong><small>人民币跨境支付系统 · 跨境转接清算</small></button>
              <div class="pano-node"><strong>城商行资金清算中心</strong><small>中小银行间资金清算</small></div>
            </div>
          </div>

          <div class="pano-link">
            <span class="pano-flow info">净额清算指令</span>
            <span class="pano-flow fund">准备金账户借记 / 贷记</span>
          </div>

          <div class="pano-tier t-central" data-layer="central">
            <div class="pano-label"><b>05</b><span>中央银行</span><small>最终清算与货币发行</small></div>
            <div class="pano-nodes">
              <button class="pano-node accent" type="button" data-inst="PBOC"><strong>中国人民银行</strong><small>CNAPS 大额 / 小额支付系统</small></button>
              <div class="pano-node"><strong>备付金集中存管</strong><small>客户备付金 100% 缴存央行</small></div>
              <div class="pano-node"><strong>征信与反洗钱</strong><small>二代征信 · 大额可疑交易监测</small></div>
              <div class="pano-node"><strong>基础货币与准备金</strong><small>货币发行 · 准备金账户管理</small></div>
            </div>
          </div>

          <div class="pano-link">
            <span class="pano-flow rule">牌照准入 · 反洗钱 · 数据安全 · 消费者保护</span>
          </div>

          <div class="pano-tier t-support" data-layer="support">
            <div class="pano-label"><b>06</b><span>监管与支撑</span><small>让支付体系安全运行</small></div>
            <div class="pano-nodes">
              <div class="pano-node"><strong>国家金融监督管理总局</strong><small>支付牌照与机构监管</small></div>
              <div class="pano-node"><strong>中国支付清算协会</strong><small>行业自律与标准制定</small></div>
              <div class="pano-node"><strong>风控与反欺诈</strong><small>实时规则 · 设备指纹 · 名单</small></div>
              <div class="pano-node"><strong>对账与差错处理</strong><small>渠道对账 · 差错调账 · 资金安全</small></div>
            </div>
          </div>
        </div>

        <div class="pano-fund">
          <div class="pano-fund-head">
            <span class="pano-key fund">资金流</span>
            <strong>一笔消费背后的真实资金路径</strong>
          </div>
          <div class="arch-flow pano-path">
            <div class="arch-node"><span>付款人账户</span><small>存款减少</small></div>
            <div class="arch-arrow">›</div>
            <div class="arch-node"><span>发卡行</span><small>扣款 · 待清算应付</small></div>
            <div class="arch-arrow">›</div>
            <div class="arch-node accent"><span>网联 / 银联</span><small>轧差 · 净额清算</small></div>
            <div class="arch-arrow">›</div>
            <div class="arch-node"><span>人民银行准备金账户</span><small>跨行最终清算</small></div>
            <div class="arch-arrow">›</div>
            <div class="arch-node"><span>收单行 / 支付机构</span><small>商户入账 · 备付金</small></div>
            <div class="arch-arrow">›</div>
            <div class="arch-node"><span>收款人账户</span><small>存款增加</small></div>
          </div>
        </div>

        <div class="grid-3 mt-16">
          <div class="mini-item"><span class="idx">1</span><div><strong>断直连：</strong>第三方支付机构不再直连银行，统一经网联 / 银联转接，交易与资金流向可被完整监测。</div></div>
          <div class="mini-item"><span class="idx">2</span><div><strong>备付金集中存管：</strong>客户备付金 100% 缴存人民银行，支付机构不得挪用，从制度上隔离客户资金与自有资金。</div></div>
          <div class="mini-item"><span class="idx">3</span><div><strong>两级清算：</strong>清算机构负责转接与轧差，央行 CNAPS 在准备金账户完成最终清算，银行与支付机构再完成客户入账。</div></div>
        </div>
        <div class="pano-hint">示意图用于教学：点击高亮的机构节点可查看实时科目余额；实际体系还包括收单外包服务机构、支付信息服务机构等。</div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-head">
          <div>
            <h2>跨机构清算与银行会计</h2>
            <p class="sub">支付完成只是开始：资金还要经过发卡行、清算机构、央行准备金账户，最终到达收款行</p>
          </div>
          <div class="row">
            <a class="btn ghost sm" href="#/clearing">进入清算网络</a>
            <a class="btn ghost sm" href="#/banking">银行会计</a>
          </div>
        </div>
        <div class="arch">
          <div class="arch-flow">
            <div class="arch-node"><span>发卡行 / 付款行</span><small>扣减用户存款</small></div>
            <div class="arch-arrow">›</div>
            <div class="arch-node accent"><span>网联 / 银联</span><small>转接 · 轧差净额</small></div>
            <div class="arch-arrow">›</div>
            <div class="arch-node"><span>人民银行 CNAPS</span><small>准备金账户最终清算</small></div>
            <div class="arch-arrow">›</div>
            <div class="arch-node"><span>收单行 / 支付机构</span><small>商户入账 · 备付金</small></div>
          </div>
          <div class="arch-aux">
            ${(meta.clearingScenarios || []).map((scenario) => `<a class="chip" href="#/clearing">${esc(scenario.short)}</a>`).join('')}
          </div>
          <div class="arch-aux" style="margin-top:10px">
            ${(meta.institutions || []).map((inst) => `<span class="chip" style="border-color:${inst.color}55">${esc(inst.short)}</span>`).join('')}
          </div>
        </div>
        <div class="grid-3 mt-16">
          <div class="mini-item"><span class="idx">1</span><div><strong>资金流与信息流分离：</strong>订单、支付指令是信息流；清算与结算是真实资金在银行间转移。</div></div>
          <div class="mini-item"><span class="idx">2</span><div><strong>支付机构备付金：</strong>客户资金 100% 集中存管于央行，充值只是资产与负债同时增加，不是平台收入。</div></div>
          <div class="mini-item"><span class="idx">3</span><div><strong>银行复式记账：</strong>存款是负债、贷款是资产，中间业务赚取手续费，全部机构共用一套借贷平衡的会计日志。</div></div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-head">
          <div>
            <h2>最近交易</h2>
            <p class="sub">点击任意一笔交易可回到演练台查看完整链路</p>
          </div>
          <div class="row">
            <span class="chip">支付 ${summary.counts.payments} 笔</span>
            <span class="chip">退款 ${summary.counts.refunds} 笔</span>
            <a class="btn ghost sm" href="#/logs">查看全链路日志</a>
          </div>
        </div>
        ${summary.recent.length ? `
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>商品 / 订单号</th>
                  <th>渠道</th>
                  <th class="num">金额</th>
                  <th>状态</th>
                  <th>阶段</th>
                </tr>
              </thead>
              <tbody>
                ${summary.recent.map((item) => `
                  <tr class="clickable" data-payment="${item.id}">
                    <td class="mono">${esc(fmtTime(item.createdAt, true))}</td>
                    <td>
                      <div style="font-weight:500">${esc(item.subject)}</div>
                      <div class="mono" style="color:var(--muted-2);font-size:10.5px">${esc(item.outTradeNo)}</div>
                    </td>
                    <td>${esc(item.channelName)}</td>
                    <td class="num amount">¥${money(item.amount)}</td>
                    <td>${payBadge(item.status)}</td>
                    <td>
                      ${item.completed ? badge('已闭环', 'green') : item.terminated ? badge('已终止', 'gray') : badge(`阶段 ${Math.min(item.phaseIndex + 1, 12)}/12`, 'blue')}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div class="table-empty">暂无交易数据，前往演练台创建第一笔支付。</div>'}
      </div>
    `;

    root.querySelectorAll('[data-scenario]').forEach((button) => {
      button.addEventListener('click', () => {
        appState.presetScenario = button.dataset.scenario;
        location.hash = '#/payment';
      });
    });

    root.querySelectorAll('[data-payment]').forEach((row) => {
      row.addEventListener('click', () => {
        appState.activePaymentId = row.dataset.payment;
        location.hash = '#/payment';
      });
    });

    bindLab(root, clearing);
    applyLabHighlights(root, labFlow);
  }
};
