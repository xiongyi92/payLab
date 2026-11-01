import { get, post } from '../api.js';
import {
  esc, money, pct, fmtTime, badge, toast, openModal
} from '../ui.js';
import { journalEntriesHTML, accountTypeBadge } from '../accounting.js';

const DEFAULT_AMOUNTS = {
  deposit_cash: { amount: '10000.00' },
  loan_issue: { amount: '200000.00' },
  loan_repay: { principal: '50000.00', interest: '2500.00' },
  agency_utility: { amount: '200.00', fee: '2.00' },
  fee_collect: { amount: '50.00' }
};

let cache = null;
let busy = false;

function opType(code) {
  return (cache.operationTypes || []).find((item) => item.code === code) || cache.operationTypes[0];
}

function bankOf(code) {
  return (cache.banks || []).find((item) => item.code === code) || cache.banks[0];
}

function bankCardsHTML() {
  return `
    <div class="bank-grid">
      ${cache.banks.map((bank) => `
        <div class="bank-card" style="--inst:${bank.color}">
          <div class="bank-head">
            <div>
              <strong>${esc(bank.name)}</strong>
              <small>${esc(bank.role)}</small>
            </div>
            <span class="chip">${esc(bank.code)}</span>
          </div>
          <div class="bank-kpis">
            <div><small>吸收存款</small><strong>¥${money(bank.kpis.deposits)}</strong></div>
            <div><small>贷款余额</small><strong>¥${money(bank.kpis.loans)}</strong></div>
            <div><small>央行准备金</small><strong>¥${money(bank.kpis.reserve)}</strong></div>
            <div><small>中间业务收入</small><strong>¥${money(bank.kpis.feeIncome + bank.kpis.interestIncome)}</strong></div>
          </div>
          <div class="bank-customers">
            ${bank.customers.map((customer) => `
              <span class="chip">${esc(customer.name)} · ¥${money(customer.balance)}</span>
            `).join('')}
          </div>
          <button class="link-btn" type="button" data-bank="${bank.code}">查看科目余额与客户存款 ›</button>
        </div>
      `).join('')}
    </div>
  `;
}

function bankModal(bank) {
  openModal({
    title: bank.name,
    subtitle: `${bank.role} · 会计科目与客户存款`,
    wide: true,
    body: `
      <div class="row" style="margin-bottom:12px">
        <span class="chip">吸收存款 ¥${money(bank.kpis.deposits)}</span>
        <span class="chip">贷款余额 ¥${money(bank.kpis.loans)}</span>
        <span class="chip">准备金 ¥${money(bank.kpis.reserve)}</span>
        <span class="chip">库存现金 ¥${money(bank.kpis.cash)}</span>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>会计科目</th><th>类型</th><th>正常方向</th><th class="num">借方发生额</th><th class="num">贷方发生额</th><th class="num">余额</th></tr></thead>
          <tbody>
            ${bank.accounts.map((row) => `
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
      <div class="card-head" style="margin:18px 0 8px"><h3>客户存款</h3><span class="chip">${bank.customers.length} 位客户</span></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>客户</th><th>类型</th><th class="num">存入</th><th class="num">支取</th><th class="num">当前余额</th></tr></thead>
          <tbody>
            ${bank.customers.map((customer) => `
              <tr>
                <td>${esc(customer.name)}</td>
                <td>${esc(customer.type)}</td>
                <td class="num">¥${money(customer.credit)}</td>
                <td class="num">¥${money(customer.debit)}</td>
                <td class="num amount">¥${money(customer.balance)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="note mt-12">存款是银行负债；贷款是银行资产。发放贷款会同时创造派生存款，因此资产与负债同步扩张。</div>
    `,
    footer: [{ label: '关闭', class: 'ghost' }]
  });
}

function operationFormHTML() {
  const bank = bankOf('ICBC');
  const type = cache.operationTypes[0];
  return `
    <form id="bank-op-form" class="form-grid" autocomplete="off">
      <label class="field col-2">
        <span>开户银行</span>
        <select name="bank">
          ${cache.banks.map((item) => `<option value="${item.code}">${esc(item.name)}</option>`).join('')}
        </select>
      </label>
      <label class="field col-3">
        <span>业务类型</span>
        <select name="type">
          ${cache.operationTypes.map((item) => `<option value="${item.code}">${esc(item.name)}</option>`).join('')}
        </select>
      </label>
      <label class="field col-3">
        <span>客户</span>
        <select name="customer">
          ${(cache.customers[bank.code] || []).map((item) => `<option value="${esc(item.name)}">${esc(item.name)} · ${esc(item.type)}</option>`).join('')}
        </select>
      </label>
      <label class="field col-2" data-op-field="amount">
        <span>业务金额（元）</span>
        <input type="number" name="amount" min="0.01" max="500000" step="0.01" value="${DEFAULT_AMOUNTS[type.code].amount || '100.00'}">
      </label>
      <label class="field col-2" data-op-field="fee">
        <span>手续费（元）</span>
        <input type="number" name="fee" min="0" max="500000" step="0.01" value="2.00">
      </label>
      <label class="field col-2 hidden" data-op-field="principal">
        <span>贷款本金（元）</span>
        <input type="number" name="principal" min="0.01" max="500000" step="0.01" value="50000.00">
      </label>
      <label class="field col-2 hidden" data-op-field="interest">
        <span>利息（元）</span>
        <input type="number" name="interest" min="0" max="500000" step="0.01" value="2500.00">
      </label>
      <div class="col-12 form-actions">
        <button class="btn primary" type="submit">提交业务并记账</button>
        <span class="note">提交后立即生成银行会计分录；演示数据仅保存在本地。</span>
      </div>
    </form>
  `;
}

function syncFormFields(root) {
  const form = root.querySelector('#bank-op-form');
  if (!form) return;
  const type = form.elements.type.value;
  const fields = (opType(type) || {}).fields || [];
  root.querySelectorAll('[data-op-field]').forEach((field) => {
    const name = field.dataset.opField;
    field.classList.toggle('hidden', !fields.includes(name));
  });
  const bank = form.elements.bank.value;
  const customers = cache.customers[bank] || [];
  const select = form.elements.customer;
  const previous = select.value;
  select.innerHTML = customers.map((customer) => `<option value="${esc(customer.name)}">${esc(customer.name)} · ${esc(customer.type)}</option>`).join('');
  if (customers.some((customer) => customer.name === previous)) select.value = previous;
}

function typeBannerHTML(typeCode) {
  const type = opType(typeCode);
  return `
    <span class="tag">${esc(type.name)}</span>
    <span>${esc(type.desc)} ${esc(type.teaching || '')}</span>
  `;
}

function paymentInstitutionHTML(pi) {
  const coverage = pi.kpis.coverage;
  const coverageOk = coverage >= 100;
  const accounts = pi.accounts || [];
  return `
    <div class="pi-grid">
      <div class="pi-kpis">
        <div class="stat"><small>备付金存款（央行）</small><strong>¥${money(pi.kpis.reserve)}</strong></div>
        <div class="stat"><small>钱包余额负债</small><strong class="amber">¥${money(pi.kpis.wallet)}</strong></div>
        <div class="stat"><small>商户待结算款</small><strong>¥${money(pi.kpis.merchantPayable)}</strong></div>
        <div class="stat"><small>手续费收入</small><strong class="green">¥${money(pi.kpis.feeIncome)}</strong></div>
      </div>
      <div class="coverage-box">
        <div class="coverage-head">
          <span>备付金覆盖率</span>
          <strong class="${coverageOk ? 'green' : 'red'}">${pct(coverage)}</strong>
        </div>
        <div class="coverage-bar"><i style="width:${Math.min(100, Math.max(0, coverage))}%;background:${coverageOk ? 'linear-gradient(90deg,#1f8f74,#34d399)' : 'linear-gradient(90deg,#b91c1c,#f87171)'}"></i></div>
        <p class="note">${coverageOk ? '备付金余额覆盖钱包负债，符合 100% 集中存管要求。' : '备付金不足以覆盖钱包负债，存在挪用客户资金风险。'}</p>
      </div>
    </div>
    <div class="table-wrap mt-16">
      <table class="table">
        <thead><tr><th>会计科目</th><th>类型</th><th class="num">借方发生额</th><th class="num">贷方发生额</th><th class="num">余额</th></tr></thead>
        <tbody>
          ${accounts.map((row) => `
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
  `;
}

function opsTableHTML() {
  if (!cache.ops.length) {
    return '<div class="table-empty">暂无银行业务记录。使用上方表单办理第一笔业务。</div>';
  }
  return `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>时间</th><th>业务</th><th>银行 / 客户</th><th class="num">金额</th><th class="num">手续费 / 利息</th><th>操作</th></tr>
        </thead>
        <tbody>
          ${cache.ops.map((op) => `
            <tr>
              <td class="mono">${esc(fmtTime(op.ts, true))}</td>
              <td>
                <div>${esc(op.typeName)}</div>
                <div class="mono" style="font-size:10px;color:var(--muted-2)">${esc(op.id)}</div>
                ${op.seeded ? badge('演示数据', 'gray') : badge('手工办理', 'blue')}
              </td>
              <td>
                <div>${esc(op.bankName)}</div>
                <div class="note" style="font-size:10.5px">${esc(op.customer)}</div>
              </td>
              <td class="num amount">¥${money(op.amount)}</td>
              <td class="num">
                ${op.type === 'loan_repay'
                  ? `本金 ¥${money(op.principal)}<div class="note" style="font-size:10px">利息 ¥${money(op.interest)}</div>`
                  : op.fee ? `手续费 ¥${money(op.fee)}` : '—'}
              </td>
              <td><button class="btn sm ghost" type="button" data-op="${op.id}">查看分录</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function opModal(op) {
  openModal({
    title: `业务分录 · ${op.typeName}`,
    subtitle: `${op.bankName} · ${op.customer} · ¥${money(op.amount)}`,
    wide: true,
    body: `
      <div class="row" style="margin-bottom:12px">
        <span class="chip">${esc(op.id)}</span>
        <span class="chip mono">${esc(fmtTime(op.ts, true))}</span>
        ${op.type === 'loan_repay' ? `<span class="chip">本金 ¥${money(op.principal)}</span><span class="chip">利息 ¥${money(op.interest)}</span>` : ''}
        ${op.fee ? `<span class="chip">手续费 ¥${money(op.fee)}</span>` : ''}
      </div>
      ${journalEntriesHTML(op.journal || [])}
      <div class="scenario-banner" style="margin-top:14px">
        <span class="tag">会计要点</span>
        <span>${esc((cache.operationTypes.find((item) => item.code === op.type) || {}).teaching || '')}</span>
      </div>
    `,
    footer: [{ label: '关闭', class: 'ghost' }]
  });
}

async function paint(root) {
  cache = await get('/banking');
  const totals = cache.totals;
  const trial = cache.trial;
  const pi = cache.paymentInstitution;
  const type = opType(cache.operationTypes[0].code);

  root.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">银行存款总额</div>
        <div class="kpi-value">¥${money(totals.deposits)}</div>
        <div class="kpi-foot">吸收存款 · 银行负债</div>
      </div>
      <div class="kpi k-purple">
        <div class="kpi-label">贷款余额</div>
        <div class="kpi-value">¥${money(totals.loans)}</div>
        <div class="kpi-foot">贷款资产 · 派生存款</div>
      </div>
      <div class="kpi k-green">
        <div class="kpi-label">中间业务收入</div>
        <div class="kpi-value">¥${money(totals.feeIncome)}</div>
        <div class="kpi-foot">结算、代理、账户管理手续费</div>
      </div>
      <div class="kpi k-amber">
        <div class="kpi-label">利息收入</div>
        <div class="kpi-value">¥${money(totals.interestIncome)}</div>
        <div class="kpi-foot">贷款利息 · 收入类科目</div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div>
          <h2>商业银行会计视图</h2>
          <p class="sub">存款、贷款、准备金与中间业务收入一屏掌握</p>
        </div>
        <a class="chip" href="#/clearing">跨机构清算 ›</a>
      </div>
      ${bankCardsHTML()}
    </div>

    <div class="grid-2 mt-16" style="align-items:start">
      <div class="card">
        <div class="card-head">
          <div>
            <h2>办理银行业务</h2>
            <p class="sub">存款、贷款、收回本息、代收水电费与账户管理费</p>
          </div>
          <span class="chip">复式记账</span>
        </div>
        ${operationFormHTML()}
        <div id="op-banner" class="scenario-banner">${typeBannerHTML(type.code)}</div>
      </div>

      <div class="card teaching">
        <div class="card-head">
          <div>
            <h2>银行会计要点</h2>
            <p class="sub">资产、负债与收入的确认逻辑</p>
          </div>
          <span class="chip">Accounting</span>
        </div>
        <div class="mini-list">
          <div class="mini-item"><span class="idx">1</span><div><strong>存款是负债：</strong>客户存入现金，银行库存现金增加，同时对客户形成吸收存款负债。</div></div>
          <div class="mini-item"><span class="idx">2</span><div><strong>贷款创造存款：</strong>放贷时同时确认贷款资产与客户存款负债，资产与负债同步扩张。</div></div>
          <div class="mini-item"><span class="idx">3</span><div><strong>利息分期确认：</strong>收回贷款本息时，本金冲减贷款资产，利息确认为利息收入。</div></div>
          <div class="mini-item"><span class="idx">4</span><div><strong>中间业务轻资本：</strong>代收水电费先计入应解汇款负债，再划转公用事业单位，手续费确认为中间业务收入。</div></div>
        </div>
        <div class="scenario-banner" style="margin-top:14px">
          <span class="tag">账务链路</span>
          <span>现金存入 → 派生存款 → 发放贷款 → 收回本息 → 代收付划转 → 手续费收入。</span>
        </div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div>
          <h2>支付机构会计</h2>
          <p class="sub">客户备付金、钱包负债与商户待结算款</p>
        </div>
        <div class="row">
          ${badge(pi.kpis.coverage >= 100 ? '备付金覆盖率达标' : '备付金覆盖不足', pi.kpis.coverage >= 100 ? 'green' : 'red')}
          <a class="chip" href="#/clearing">查看清算链路 ›</a>
        </div>
      </div>
      ${paymentInstitutionHTML(pi)}
      <div class="card-head" style="margin:18px 0 10px">
        <div><h3>支付机构最近分录</h3><p class="sub">仅展示与支付机构相关的科目行</p></div>
        <span class="chip">${(pi.journal || []).length} 张分录</span>
      </div>
      ${journalEntriesHTML((pi.journal || []).slice(0, 6))}
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div>
          <h2>银行业务流水</h2>
          <p class="sub">点击“查看分录”查看该笔业务的完整借贷科目</p>
        </div>
        <span class="chip">${cache.ops.length} 笔业务</span>
      </div>
      ${opsTableHTML()}
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div>
          <h2>全局试算平衡</h2>
          <p class="sub">银行、支付机构、清算机构与央行共用同一套复式记账日志</p>
        </div>
        ${trial.balanced ? badge('借贷平衡', 'green') : badge('存在差额', 'red')}
      </div>
      <div class="trial-strip">
        <span>借方合计 <strong>¥${money(trial.debit)}</strong></span>
        <span>贷方合计 <strong>¥${money(trial.credit)}</strong></span>
        <span>会计分录 <strong>${trial.entryCount}</strong> 张</span>
        ${trial.balanced ? badge('试算平衡', 'green') : badge('不平衡', 'red')}
      </div>
    </div>
  `;

  const form = root.querySelector('#bank-op-form');
  syncFormFields(root);
  form.elements.type.addEventListener('change', () => {
    syncFormFields(root);
    const fields = (opType(form.elements.type.value) || {}).fields || [];
    const defaults = DEFAULT_AMOUNTS[form.elements.type.value] || {};
    for (const [name, value] of Object.entries(defaults)) {
      if (fields.includes(name) && form.elements[name]) form.elements[name].value = value;
    }
    root.querySelector('#op-banner').innerHTML = typeBannerHTML(form.elements.type.value);
  });
  form.elements.bank.addEventListener('change', () => syncFormFields(root));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const body = {
      bank: form.elements.bank.value,
      type: form.elements.type.value,
      customer: form.elements.customer.value,
      amount: Number(form.elements.amount.value || 0),
      fee: Number(form.elements.fee.value || 0),
      principal: Number(form.elements.principal.value || 0),
      interest: Number(form.elements.interest.value || 0)
    };
    busy = true;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const result = await post('/banking/ops', body);
      toast(`已办理：${result.typeName} · ${result.bankName}`, 'success');
      await paint(root);
    } catch (error) {
      toast(error.message, 'error');
      submit.disabled = false;
    } finally {
      busy = false;
    }
  });

  root.querySelectorAll('[data-bank]').forEach((button) => {
    button.addEventListener('click', () => {
      const bank = bankOf(button.dataset.bank);
      if (bank) bankModal(bank);
    });
  });

  root.querySelectorAll('[data-op]').forEach((button) => {
    button.addEventListener('click', () => {
      const op = cache.ops.find((item) => item.id === button.dataset.op);
      if (op) opModal(op);
    });
  });

  return () => {};
}

export default {
  async render(root) {
    await paint(root);
    return () => {};
  }
};
