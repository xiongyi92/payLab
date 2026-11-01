import { get, put, post } from '../api.js';
import {
  esc, money, fmtTime, badge, toast, openModal, RISK_DECISION, statusBadge
} from '../ui.js';

const PARAM_LABELS = {
  reviewAmount: '审核阈值（元）',
  blockAmount: '拦截阈值（元）',
  startHour: '开始小时',
  endHour: '结束小时',
  minAmount: '金额阈值（元）',
  windowSec: '时间窗口（秒）',
  maxCount: '最大笔数',
  users: '黑名单用户（逗号分隔）'
};

const viewState = {
  buyer: 'U10001',
  amount: '8888',
  hour: String(new Date().getHours()),
  isNewDevice: false,
  result: null
};

function decisionLabel(decision) {
  return RISK_DECISION[decision] || [decision || '—', 'gray'];
}

function paramFields(rule) {
  return Object.entries(rule.params || {}).map(([key, value]) => {
    if (key === 'users') {
      return `
        <label class="field">
          <span>${esc(PARAM_LABELS[key] || key)}</span>
          <input type="text" data-param="${key}" value="${esc((value || []).join(','))}" style="min-width:220px">
        </label>
      `;
    }
    const display = key.endsWith('Amount') ? (Number(value) / 100).toFixed(2) : value;
    return `
      <label class="field">
        <span>${esc(PARAM_LABELS[key] || key)}</span>
        <input type="number" step="${key.endsWith('Amount') ? '0.01' : '1'}" data-param="${key}" value="${esc(display)}">
      </label>
    `;
  }).join('');
}

function resultPanel() {
  if (!viewState.result) {
    return `
      <div class="note" style="padding:14px;border:1px dashed var(--border);border-radius:12px">
        填写买家、金额与交易时间后点击「执行试算」。风控将返回 PASS / REVIEW / BLOCK 三种决策。
      </div>
    `;
  }
  const result = viewState.result;
  const [label, tone] = decisionLabel(result.decision);
  const scoreClass = result.decision === 'PASS' ? 'pass' : result.decision === 'REVIEW' ? 'review' : 'block';
  return `
    <div class="decision-panel">
      <div class="decision-score ${scoreClass}">
        <div><strong>${result.score}</strong><small>RISK SCORE</small></div>
      </div>
      <div style="flex:1;min-width:200px">
        <div class="row">
          ${badge(label, tone)}
          <span class="chip">命中 ${result.hits.length} 条规则</span>
          <span class="chip">${esc(result.buyer || viewState.buyer)}</span>
        </div>
        <p class="note mt-8">${
          result.decision === 'PASS' ? '未触发高风险规则，交易可以直接放行。'
            : result.decision === 'REVIEW' ? '命中人工复核规则，支付流程会暂停，等待风控运营审批。'
              : '命中拦截规则，交易会被直接阻断，业务订单同步关闭。'
        }</p>
      </div>
    </div>
    ${result.hits.length ? `
      <div class="hit-list">
        ${result.hits.map((hit) => `
          <div class="hit-item ${hit.level === 'BLOCK' ? 'block' : ''}">
            <span class="hit-rule">${esc(hit.ruleId)}</span>
            <div><strong>${esc(hit.ruleName)}</strong> · ${esc(hit.level)}<br><span style="color:var(--muted)">${esc(hit.detail)}</span></div>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
}

function checkDetail(check) {
  openModal({
    title: `风控决策详情 · ${check.outTradeNo}`,
    subtitle: `${fmtTime(check.at, true)} · 买家 ${check.buyer} · ¥${money(check.amount)}`,
    body: `
      <div class="row">
        ${statusBadge(RISK_DECISION, check.decision)}
        <span class="chip">风险分 ${check.score}</span>
        <span class="chip">命中 ${check.hits.length} 条</span>
      </div>
      <div class="hit-list">
        ${check.hits.length ? check.hits.map((hit) => `
          <div class="hit-item ${hit.level === 'BLOCK' ? 'block' : ''}">
            <span class="hit-rule">${esc(hit.ruleId)}</span>
            <div><strong>${esc(hit.ruleName)}</strong> · ${esc(hit.level)}<br><span style="color:var(--muted)">${esc(hit.detail)}</span></div>
          </div>
        `).join('') : '<div class="note">未命中任何规则。</div>'}
      </div>
    `,
    footer: [{ label: '关闭', class: 'ghost' }]
  });
}

function checksTable(checks) {
  if (!checks.length) return '<div class="table-empty">暂无风控记录。</div>';
  return `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>时间</th><th>买家</th><th class="num">金额</th><th>决策</th><th class="num">分数</th><th>操作</th></tr></thead>
        <tbody>
          ${checks.slice(0, 12).map((check) => `
            <tr>
              <td class="mono" style="font-size:10.5px">${esc(fmtTime(check.at, true))}</td>
              <td class="mono" style="font-size:11px">${esc(check.buyer)}</td>
              <td class="num">¥${money(check.amount)}</td>
              <td>${statusBadge(RISK_DECISION, check.decision)}</td>
              <td class="num">${check.score}</td>
              <td><button class="btn sm ghost" type="button" data-check="${check.id}">命中详情</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function paint(root) {
  const data = await get('/risk');

  root.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-head">
          <div>
            <h2>风控实时试算</h2>
            <p class="sub">模拟一笔交易请求，观察规则命中与最终决策</p>
          </div>
          <span class="chip">Rule Engine</span>
        </div>
        <form id="risk-form" class="form-grid" autocomplete="off">
          <label class="field col-6">
            <span>买家标识</span>
            <input type="text" name="buyer" value="${esc(viewState.buyer)}" placeholder="例如 U-BLACKLIST">
          </label>
          <label class="field col-6">
            <span>交易金额（元）</span>
            <input type="number" name="amount" step="0.01" min="0.01" value="${esc(viewState.amount)}">
          </label>
          <label class="field col-6">
            <span>交易时间（小时 0-23）</span>
            <input type="number" name="hour" min="0" max="23" value="${esc(viewState.hour)}">
          </label>
          <div class="field col-6">
            <span>设备特征</span>
            <div class="row" style="min-height:38px">
              <label class="check"><input type="checkbox" name="isNewDevice" ${viewState.isNewDevice ? 'checked' : ''}> 新设备 / 异地</label>
            </div>
          </div>
          <div class="col-12 form-actions">
            <button class="btn primary" type="submit">执行试算</button>
            <span class="note">提示：买家 U-BLACKLIST 会命中黑名单；金额 ≥ 5,000 元触发人工复核。</span>
          </div>
        </form>
        <div class="divider"></div>
        <div id="risk-result">${resultPanel()}</div>
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <h2>最近风控命中</h2>
            <p class="sub">真实支付与试算的决策记录</p>
          </div>
          <span class="chip" id="risk-check-count">${data.checks.length} 条</span>
        </div>
        <div id="risk-checks">${checksTable(data.checks)}</div>
        <div class="scenario-banner" style="margin-top:14px">
          <span class="tag">串联演练</span>
          <span>选择「风控拦截」或「大额人工审核」场景创建真实支付，可在演练台观察风控暂停与人工审批流程。</span>
        </div>
      </div>
    </div>

    <div class="card mt-16">
      <div class="card-head">
        <div>
          <h2>风控规则配置</h2>
          <p class="sub">开关与阈值会实时作用于后续支付与试算</p>
        </div>
        <span class="chip">${data.rules.filter((rule) => rule.enabled).length} / ${data.rules.length} 启用</span>
      </div>
      <div id="rule-list">
        ${data.rules.map((rule) => {
          const [label, tone] = rule.level === 'BLOCK' ? ['拦截', 'red'] : ['复核', 'amber'];
          return `
            <div class="risk-rule" data-rule-card="${rule.id}">
              <div>
                <h4>
                  ${esc(rule.name)}
                  ${badge(label, tone)}
                  <span class="mono" style="font-size:10px;color:var(--muted-2)">${rule.id}</span>
                </h4>
                <p>${esc(rule.desc)}</p>
                <div class="rule-params">${paramFields(rule)}</div>
              </div>
              <div class="rule-side">
                <label class="switch" title="${rule.enabled ? '已启用' : '已停用'}">
                  <input type="checkbox" data-toggle="${rule.id}" ${rule.enabled ? 'checked' : ''}>
                  <span class="track"></span>
                </label>
                <button class="btn sm ghost" type="button" data-save="${rule.id}">保存参数</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  const form = root.querySelector('#risk-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    viewState.buyer = String(formData.get('buyer') || 'U10001');
    viewState.amount = String(formData.get('amount'));
    viewState.hour = String(formData.get('hour'));
    viewState.isNewDevice = formData.get('isNewDevice') === 'on';
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const check = await post('/risk/check', {
        buyer: viewState.buyer,
        amount: Number(viewState.amount),
        hour: Number(viewState.hour),
        isNewDevice: viewState.isNewDevice
      });
      viewState.result = check;
      root.querySelector('#risk-result').innerHTML = resultPanel();
      toast(`风控决策：${decisionLabel(check.decision)[0]}`, check.decision === 'PASS' ? 'success' : check.decision === 'REVIEW' ? 'warn' : 'error');
      const refreshed = await get('/risk');
      root.querySelector('#risk-checks').innerHTML = checksTable(refreshed.checks);
      const countChip = root.querySelector('#risk-check-count');
      if (countChip) countChip.textContent = `${refreshed.checks.length} 条`;
      bindCheckButtons(root, refreshed.checks);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  bindCheckButtons(root, data.checks);

  root.querySelectorAll('[data-toggle]').forEach((toggle) => {
    toggle.addEventListener('change', async () => {
      try {
        await put(`/risk/rules/${toggle.dataset.toggle}`, { enabled: toggle.checked });
        toast(`规则已${toggle.checked ? '启用' : '停用'}`, 'success');
      } catch (error) {
        toast(error.message, 'error');
        toggle.checked = !toggle.checked;
      }
    });
  });

  root.querySelectorAll('[data-save]').forEach((button) => {
    button.addEventListener('click', async () => {
      const ruleId = button.dataset.save;
      const card = root.querySelector(`[data-rule-card="${ruleId}"]`);
      const params = {};
      card.querySelectorAll('[data-param]').forEach((input) => {
        params[input.dataset.param] = input.value;
      });
      button.disabled = true;
      try {
        await put(`/risk/rules/${ruleId}`, { params });
        toast('规则参数已保存', 'success');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
  });
}

function bindCheckButtons(root, checks) {
  root.querySelectorAll('[data-check]').forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = '1';
    button.addEventListener('click', () => {
      const check = checks.find((item) => item.id === button.dataset.check);
      if (check) checkDetail(check);
    });
  });
}

export default {
  async render(root) {
    await paint(root);
    return () => {};
  }
};
