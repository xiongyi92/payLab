import { get, post } from '../api.js';
import {
  esc, money, addDays, localDateString, badge, toast, openModal, confirmDialog
} from '../ui.js';

let viewState = { date: addDays(localDateString(), 1) };

const ACCOUNT_TYPE = {
  ASSET: ['资产', 'blue'],
  LIABILITY: ['负债', 'amber'],
  INCOME: ['收入', 'green']
};

function batchDetail(batch) {
  const rows = (batch.payments || []).map((payment) => `
    <tr>
      <td>${esc(payment.subject)}</td>
      <td class="mono">${esc(payment.outTradeNo)}</td>
      <td class="num">¥${money(payment.amount)}</td>
      <td class="num">¥${money(payment.fee)}</td>
      <td class="num">¥${money(payment.amount - payment.fee)}</td>
    </tr>
  `).join('');

  openModal({
    title: `结算单 · ${batch.settleDate}`,
    subtitle: `${batch.merchantName || batch.merchantId} · ${batch.count} 笔交易`,
    wide: true,
    body: `
      <div class="row">
        <span class="chip">交易总额 ¥${money(batch.grossAmount)}</span>
        <span class="chip">手续费 ¥${money(batch.feeAmount)}</span>
        <span class="chip">退款抵扣 ¥${money(batch.refundAmount)}</span>
        <span class="chip">结算净额 ¥${money(batch.netAmount)}</span>
        ${batch.status === 'PENDING' ? badge('待结算', 'amber') : badge('已结算', 'green')}
      </div>
      <div class="table-wrap mt-12">
        <table class="table">
          <thead><tr><th>商品</th><th>订单号</th><th class="num">金额</th><th class="num">手续费</th><th class="num">净额</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" class="table-empty">无交易明细</td></tr>'}</tbody>
        </table>
      </div>
      <div class="note mt-12">结算采用净额出款：交易总额 - 手续费 - 退款抵扣 = 结算净额。若已结算交易发生退款，会从后续结算款中扣回。</div>
    `,
    footer: [{ label: '关闭', class: 'ghost' }]
  });
}

async function paint(root) {
  const data = await get('/settlements');
  const pendingBatches = data.batches.filter((batch) => batch.status === 'PENDING');
  const totalDebit = data.accounts.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = data.accounts.reduce((sum, row) => sum + row.credit, 0);

  root.innerHTML = `
    <div class="grid-3">
      <div class="kpi k-amber">
        <div class="kpi-label">待结算金额</div>
        <div class="kpi-value">¥${money(data.pending)}</div>
        <div class="kpi-foot">${pendingBatches.length} 个待结算批次</div>
      </div>
      <div class="kpi k-green">
        <div class="kpi-label">已结算金额</div>
        <div class="kpi-value">¥${money(data.settled)}</div>
        <div class="kpi-foot">结算出款流水累计</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">试算平衡</div>
        <div class="kpi-value" style="font-size:22px">${totalDebit === totalCredit ? '借贷平衡' : '存在差额'}</div>
        <div class="kpi-foot">借方 ¥${money(totalDebit)} · 贷方 ¥${money(totalCredit)}</div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div>
          <h2>生成 T+1 结算单</h2>
          <p class="sub">结算日 = 支付成功日 + 1 天，按商户维度生成净额结算批次</p>
        </div>
        <span class="chip">Net Settlement</span>
      </div>
      <form id="settle-form" class="form-grid" autocomplete="off">
        <label class="field col-4">
          <span>结算日期</span>
          <input type="date" name="date" value="${esc(viewState.date)}">
        </label>
        <div class="col-8 form-actions">
          <button class="btn primary" type="submit">生成结算单</button>
          <span class="note">只有尚未纳入结算批次的成功交易会被生成，重复生成不会重复出款。</span>
        </div>
      </form>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div>
          <h2>结算批次</h2>
          <p class="sub">点击“执行结算”完成出款并生成账务分录</p>
        </div>
        <span class="chip">${data.batches.length} 个批次</span>
      </div>
      ${data.batches.length ? `
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>结算日</th>
                <th>商户</th>
                <th class="num">笔数</th>
                <th class="num">交易总额</th>
                <th class="num">手续费</th>
                <th class="num">退款抵扣</th>
                <th class="num">结算净额</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${data.batches.map((batch) => `
                <tr>
                  <td class="mono">${esc(batch.settleDate)}</td>
                  <td>${esc(batch.merchantName || batch.merchantId)}</td>
                  <td class="num">${batch.count}</td>
                  <td class="num">¥${money(batch.grossAmount)}</td>
                  <td class="num">¥${money(batch.feeAmount)}</td>
                  <td class="num">¥${money(batch.refundAmount)}</td>
                  <td class="num amount">¥${money(batch.netAmount)}</td>
                  <td>${batch.status === 'PENDING' ? badge('待结算', 'amber') : badge('已结算', 'green')}</td>
                  <td>
                    <div class="actions-cell">
                      <button class="btn sm ghost" type="button" data-batch="${batch.id}">详情</button>
                      ${batch.status === 'PENDING' ? `<button class="btn sm primary" type="button" data-settle="${batch.id}">执行结算</button>` : ''}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<div class="table-empty">暂无结算批次。完成支付后按 T+1 生成结算单。</div>'}
    </div>

    <div class="grid-2 mt-16">
      <div class="card">
        <div class="card-head">
          <div>
            <h2>试算平衡表</h2>
            <p class="sub">所有账务分录按账户维度汇总</p>
          </div>
          ${totalDebit === totalCredit ? badge('借贷平衡', 'green') : badge('不平衡', 'red')}
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>账户</th><th>类型</th><th class="num">借方合计</th><th class="num">贷方合计</th><th class="num">余额</th></tr></thead>
            <tbody>
              ${data.accounts.map((account) => `
                <tr>
                  <td>
                    <div>${esc(account.name)}</div>
                    <div class="account-type">${esc(account.desc)}</div>
                  </td>
                  <td>${badge(ACCOUNT_TYPE[account.type] ? ACCOUNT_TYPE[account.type][0] : account.type, ACCOUNT_TYPE[account.type] ? ACCOUNT_TYPE[account.type][1] : 'gray')}</td>
                  <td class="num">¥${money(account.debit)}</td>
                  <td class="num">¥${money(account.credit)}</td>
                  <td class="num amount">¥${money(account.balance)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="ledger-note">资产类余额 = 借方 - 贷方；负债与收入类余额 = 贷方 - 借方。全部账户借贷总额相等，说明账务层没有凭空产生或丢失资金。</div>
      </div>

      <div class="card">
        <div class="card-head"><h2>清结算要点</h2><span class="chip">Settlement</span></div>
        <div class="mini-list">
          <div class="mini-item"><span class="idx">1</span><div><strong>交易与结算分离：</strong>支付成功只代表资金到渠道，结算才是平台把净额打给商户。</div></div>
          <div class="mini-item"><span class="idx">2</span><div><strong>T+1 账期：</strong>渠道先与平台对账，再按净额结算；不同渠道账期可能不同（余额渠道为 T+0）。</div></div>
          <div class="mini-item"><span class="idx">3</span><div><strong>净额结算：</strong>交易额 - 手续费 - 退款抵扣 = 结算净额，一次出款对应一条结算分录。</div></div>
          <div class="mini-item"><span class="idx">4</span><div><strong>已结算后退款：</strong>商户待结算款会出现负余额，从后续结算款中扣回，而不是直接修改历史结算单。</div></div>
        </div>
        <div class="scenario-banner">
          <span class="tag">账务链路</span>
          <span>支付入账 → 手续费拆分 → 待结算款累计 → T+1 结算出款（借商户待结算款 / 贷银行存款）。</span>
        </div>
      </div>
    </div>
  `;

  const form = root.querySelector('#settle-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const dataForm = new FormData(form);
    viewState.date = dataForm.get('date');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await post('/settlements/generate', { date: viewState.date });
      toast(`已生成 ${result.batches.length} 个结算批次`, 'success');
      await paint(root);
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  });

  root.querySelectorAll('[data-batch]').forEach((button) => {
    button.addEventListener('click', () => {
      const batch = data.batches.find((item) => item.id === button.dataset.batch);
      if (batch) batchDetail(batch);
    });
  });

  root.querySelectorAll('[data-settle]').forEach((button) => {
    button.addEventListener('click', async () => {
      const batch = data.batches.find((item) => item.id === button.dataset.settle);
      if (!batch) return;
      const confirmed = await confirmDialog(
        '执行结算出款',
        `确认向「${batch.merchantName}」结算 ¥${money(batch.netAmount)}？执行后将生成结算账务分录，状态变为已结算。`,
        '确认结算'
      );
      if (!confirmed) return;
      button.disabled = true;
      try {
        await post(`/settlements/${batch.id}/settle`);
        toast('结算完成，已生成出款分录', 'success');
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
