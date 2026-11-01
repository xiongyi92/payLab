import { get, post } from '../api.js';
import {
  esc, money, fmtTime, localDateString, badge, toast, openModal, DIFF_TYPE
} from '../ui.js';

let meta = null;
let viewState = { date: localDateString(), channel: 'alipay', inject: { long: false, short: false, amount: false } };

const RESOLUTION_LABELS = {
  supplement: '补单入账',
  suspend: '挂账待查',
  ignore: '忽略差异',
  manual: '转人工处理'
};

function channelName(code) {
  const channel = (meta.channels || []).find((item) => item.code === code);
  return channel ? channel.name : code;
}

function diffActions(diff) {
  if (diff.status === 'HANDLED') {
    const resolution = diff.resolution || {};
    return `${badge('已处理', 'green')}<div class="note" style="font-size:10.5px;margin-top:3px">${esc(RESOLUTION_LABELS[resolution.action] || resolution.action || '')}${resolution.note ? ' · ' + esc(resolution.note) : ''}</div>`;
  }
  const buttons = diff.type === 'CHANNEL_ONLY'
    ? [['supplement', '补单']]
    : diff.type === 'LOCAL_ONLY'
      ? [['suspend', '挂账']]
      : [['manual', '转人工']];
  buttons.push(['ignore', '忽略']);
  return buttons.map(([action, label]) => (
    `<button class="btn sm ${action === 'ignore' ? 'ghost' : 'primary'}" type="button" data-diff="${diff.id}" data-action="${action}">${label}</button>`
  )).join(' ');
}

function billDetail(bill) {
  const lines = bill.lines.map((line) => `
    <tr>
      <td class="mono">${esc(line.channelTradeNo)}</td>
      <td class="mono">${esc(line.outTradeNo)}</td>
      <td class="num amount">¥${money(line.amount)}</td>
      <td class="num">¥${money(line.fee)}</td>
      <td>${badge('SUCCESS', 'green')}</td>
    </tr>
  `).join('');

  openModal({
    title: `渠道账单 · ${bill.date}`,
    subtitle: `${channelName(bill.channel)} · ${bill.count} 条明细`,
    wide: true,
    body: `
      <div class="row">
        <span class="chip">账单金额 ¥${money(bill.totalAmount)}</span>
        <span class="chip">手续费 ¥${money(bill.totalFee)}</span>
        ${bill.injected.long ? badge('已注入长款', 'amber') : ''}
        ${bill.injected.short ? badge('已注入短款', 'red') : ''}
        ${bill.injected.amount ? badge('已注入金额差异', 'purple') : ''}
      </div>
      <div class="table-wrap mt-12">
        <table class="table">
          <thead><tr><th>渠道交易号</th><th>商户订单号</th><th class="num">金额</th><th class="num">手续费</th><th>状态</th></tr></thead>
          <tbody>${lines}</tbody>
        </table>
      </div>
    `,
    footer: [{ label: '关闭', class: 'ghost' }]
  });
}

function runCard(run) {
  const summary = run.summary;
  return `
    <div class="card" style="margin-bottom:14px">
      <div class="card-head">
        <div>
          <h3>对账批次 · ${esc(run.date)} · ${esc(channelName(run.channel))}</h3>
          <p class="sub">${esc(fmtTime(run.createdAt, true))} · 差异 ${summary.diffCount} 笔，已处理 ${run.handledCount || 0} 笔</p>
        </div>
        <span class="badge badge-${summary.diffCount === 0 ? 'green' : 'amber'}">${summary.diffCount === 0 ? '账账相符' : '存在差异'}</span>
      </div>
      <div class="recon-stats">
        <div class="stat"><small>本地成功笔数</small><strong>${summary.localCount}</strong></div>
        <div class="stat"><small>渠道账单笔数</small><strong>${summary.channelCount}</strong></div>
        <div class="stat"><small>一致笔数</small><strong class="green">${summary.matchedCount}</strong></div>
        <div class="stat"><small>差异金额</small><strong class="${summary.diffAmount === 0 ? '' : 'red'}">¥${money(Math.abs(summary.diffAmount))}</strong></div>
      </div>
      ${run.diffs.length ? `
        <div class="table-wrap mt-12">
          <table class="table">
            <thead>
              <tr>
                <th>差异类型</th>
                <th>本地单号 / 渠道单号</th>
                <th class="num">本地金额</th>
                <th class="num">渠道金额</th>
                <th>处理</th>
              </tr>
            </thead>
            <tbody>
              ${run.diffs.map((diff) => `
                <tr>
                  <td>${(DIFF_TYPE[diff.type] ? badge(DIFF_TYPE[diff.type][0], DIFF_TYPE[diff.type][1]) : badge(diff.type, 'gray'))}</td>
                  <td>
                    <div class="mono">${esc(diff.outTradeNo)}</div>
                    <div class="mono" style="font-size:10px;color:var(--muted-2)">${esc(diff.channelTradeNo)}</div>
                  </td>
                  <td class="num">${diff.localAmount === null ? '—' : '¥' + money(diff.localAmount)}</td>
                  <td class="num">${diff.channelAmount === null ? '—' : '¥' + money(diff.channelAmount)}</td>
                  <td>
                    <div class="actions-cell" style="align-items:center">
                      ${diffActions(diff)}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="diff-legend">
          <span><i style="background:var(--red)"></i>短款：本地成功但渠道无记录，需挂账核查</span>
          <span><i style="background:var(--amber)"></i>长款：渠道有记录但本地无，可能掉单，需要补单</span>
          <span><i style="background:var(--purple)"></i>金额差异：双方金额不一致，转人工核查</span>
        </div>
      ` : '<div class="result-banner mt-12"><span class="result-icon">✓</span><div><strong>本地流水与渠道账单完全一致</strong>，无需差错处理。</div></div>'}
    </div>
  `;
}

async function paint(root) {
  const [recon, metaData] = await Promise.all([get('/reconcile'), get('/meta')]);
  meta = metaData;

  root.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <h2>渠道账单与自动对账</h2>
          <p class="sub">按「支付日期 + 渠道」生成渠道账单，可注入长款 / 短款 / 金额差异进行教学</p>
        </div>
        <span class="chip">对账周期 T+1</span>
      </div>
      <form id="bill-form" class="form-grid" autocomplete="off">
        <label class="field col-3">
          <span>账单日期</span>
          <input type="date" name="date" value="${esc(viewState.date)}">
        </label>
        <label class="field col-3">
          <span>支付渠道</span>
          <select name="channel">
            ${meta.channels.map((channel) => `<option value="${channel.code}" ${channel.code === viewState.channel ? 'selected' : ''}>${esc(channel.name)}</option>`).join('')}
          </select>
        </label>
        <div class="field col-6">
          <span>差异注入</span>
          <div class="row" style="min-height:38px">
            <label class="check"><input type="checkbox" name="long" ${viewState.inject.long ? 'checked' : ''}> 注入长款</label>
            <label class="check"><input type="checkbox" name="short" ${viewState.inject.short ? 'checked' : ''}> 注入短款</label>
            <label class="check"><input type="checkbox" name="amount" ${viewState.inject.amount ? 'checked' : ''}> 注入金额差异</label>
          </div>
        </div>
        <div class="col-12 form-actions">
          <button class="btn primary" type="submit">生成渠道账单</button>
          <span class="note">账单会基于所选日期与渠道的本地成功交易生成，注入的差异用于模拟真实渠道差错。</span>
        </div>
      </form>
    </div>

    ${recon.runs.length ? `
      <div style="margin-top:20px">
        <div class="section-title"><h2>对账结果</h2><span class="sub">最新 ${Math.min(recon.runs.length, 3)} 个批次</span></div>
        ${recon.runs.slice(0, 3).map(runCard).join('')}
      </div>
    ` : ''}

    <div class="card">
      <div class="card-head">
        <div>
          <h2>渠道账单记录</h2>
          <p class="sub">点击“执行对账”比对本地流水与渠道账单</p>
        </div>
        <span class="chip">${recon.bills.length} 份账单</span>
      </div>
      ${recon.bills.length ? `
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>账单日期</th>
                <th>渠道</th>
                <th class="num">明细数</th>
                <th class="num">账单金额</th>
                <th>注入差异</th>
                <th>对账状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${recon.bills.map((bill) => `
                <tr>
                  <td class="mono">${esc(bill.date)}</td>
                  <td>${esc(channelName(bill.channel))}</td>
                  <td class="num">${bill.count}</td>
                  <td class="num amount">¥${money(bill.totalAmount)}</td>
                  <td>
                    ${bill.injected.long ? badge('长款', 'amber') : ''}
                    ${bill.injected.short ? badge('短款', 'red') : ''}
                    ${bill.injected.amount ? badge('金额差异', 'purple') : ''}
                    ${!bill.injected.long && !bill.injected.short && !bill.injected.amount ? '<span class="muted">无</span>' : ''}
                  </td>
                  <td>${bill.runId ? badge('已对账', 'green') : badge('未对账', 'gray')}</td>
                  <td>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      <button class="btn sm ghost" type="button" data-bill="${bill.id}">查看明细</button>
                      <button class="btn sm primary" type="button" data-run-bill="${bill.id}">执行对账</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<div class="table-empty">暂无渠道账单。选择日期与渠道后点击“生成渠道账单”。</div>'}
    </div>

    <div class="card mt-16">
      <div class="card-head"><h2>对账方法</h2><span class="chip">Reconciliation</span></div>
      <div class="mini-list">
        <div class="mini-item"><span class="idx">1</span><div><strong>按渠道交易号匹配：</strong>本地支付单的 channelTradeNo 与渠道账单逐笔匹配，是自动对账的主键。</div></div>
        <div class="mini-item"><span class="idx">2</span><div><strong>短款（本地有、渠道无）：</strong>平台认为成功但渠道账单缺失，通常意味着渠道侧异常，需要挂账核查、防止虚增收入。</div></div>
        <div class="mini-item"><span class="idx">3</span><div><strong>长款（渠道有、本地无）：</strong>渠道已收款但平台未记录，常见于回调丢失，需要补单入账，避免用户资金悬空。</div></div>
        <div class="mini-item"><span class="idx">4</span><div><strong>金额不一致：</strong>双方金额存在差异，需转人工核对，禁止自动调账。</div></div>
      </div>
    </div>
  `;

  const form = root.querySelector('#bill-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    viewState.date = data.get('date');
    viewState.channel = data.get('channel');
    viewState.inject = {
      long: data.get('long') === 'on',
      short: data.get('short') === 'on',
      amount: data.get('amount') === 'on'
    };
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const bill = await post('/reconcile/bills', {
        date: viewState.date,
        channel: viewState.channel,
        inject: viewState.inject
      });
      toast(`账单已生成：${bill.count} 条明细`, 'success');
      await paint(root);
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  });

  root.querySelectorAll('[data-bill]').forEach((button) => {
    button.addEventListener('click', () => {
      const bill = recon.bills.find((item) => item.id === button.dataset.bill);
      if (bill) billDetail(bill);
    });
  });

  root.querySelectorAll('[data-run-bill]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const run = await post(`/reconcile/bills/${button.dataset.runBill}/run`);
        toast(run.diffs.length ? `对账完成，发现 ${run.diffs.length} 笔差异` : '对账完成，账账相符', run.diffs.length ? 'warn' : 'success');
        await paint(root);
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    });
  });

  root.querySelectorAll('[data-diff]').forEach((button) => {
    button.addEventListener('click', async () => {
      const activeRun = recon.runs.find((run) => run.diffs.some((diff) => diff.id === button.dataset.diff));
      if (!activeRun) {
        toast('未找到对账批次', 'error');
        return;
      }
      button.disabled = true;
      try {
        await post(`/reconcile/runs/${activeRun.id}/diffs/${button.dataset.diff}/handle`, {
          action: button.dataset.action,
          note: RESOLUTION_LABELS[button.dataset.action]
        });
        toast('差异已处理', 'success');
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
