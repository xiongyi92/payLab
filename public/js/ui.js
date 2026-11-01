export function esc(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

export function money(cents) {
  return Number((Number(cents || 0)) / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function pct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

export function fmtTime(iso, showDate = false) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  const pad = (num) => String(num).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  const sameDay = date.toDateString() === new Date().toDateString();
  return showDate || !sameDay ? `${date.getMonth() + 1}月${date.getDate()}日 ${time}` : time;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function localDateString(date = new Date()) {
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

export const PAY_STATUS = {
  INIT: ['待发起', 'gray'],
  PAYING: ['支付中', 'blue'],
  SUCCESS: ['支付成功', 'green'],
  FAILED: ['支付失败', 'red'],
  CLOSED: ['已关闭', 'amber'],
  EXCEPTION: ['异常待处理', 'purple']
};

export const ORDER_STATUS = {
  CREATED: ['待支付', 'gray'],
  PAID: ['已支付', 'green'],
  CLOSED: ['已关闭', 'amber'],
  REFUNDED: ['已退款', 'purple']
};

export const REFUND_STATUS = {
  PROCESSING: ['退款处理中', 'blue'],
  SUCCESS: ['退款成功', 'green'],
  FAILED: ['退款失败', 'red']
};

export const BATCH_STATUS = {
  PENDING: ['待结算', 'amber'],
  SETTLED: ['已结算', 'green']
};

export const DIFF_STATUS = {
  PENDING: ['待处理', 'amber'],
  HANDLED: ['已处理', 'green']
};

export const DIFF_TYPE = {
  LOCAL_ONLY: ['短款 · 本地有渠道无', 'red'],
  CHANNEL_ONLY: ['长款 · 渠道有本地无', 'amber'],
  AMOUNT_MISMATCH: ['金额不一致', 'purple']
};

export const LEVEL = {
  info: ['信息', 'blue'],
  success: ['成功', 'green'],
  warn: ['警告', 'amber'],
  error: ['错误', 'red']
};

export const RISK_DECISION = {
  PASS: ['通过', 'green'],
  REVIEW: ['人工复核', 'amber'],
  BLOCK: ['拦截', 'red'],
  REVIEW_APPROVED: ['复核通过', 'green'],
  REVIEW_REJECTED: ['复核拒绝', 'red']
};

export function badge(text, tone = 'gray') {
  return `<span class="badge badge-${tone}">${esc(text)}</span>`;
}

export function statusBadge(map, status) {
  const [text, tone] = map[status] || [status || '未知', 'gray'];
  return badge(text, tone);
}

export function payBadge(status) {
  return statusBadge(PAY_STATUS, status);
}

export function levelBadge(level) {
  const [text, tone] = LEVEL[level] || LEVEL.info;
  return badge(text, tone);
}

export function jsonBlock(value) {
  if (value === null || value === undefined) return '<div class="note" style="padding:6px 0">无报文</div>';
  return `<pre class="code">${esc(JSON.stringify(value, null, 2))}</pre>`;
}

export function toast(message, type = 'info', duration = 3000) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const item = document.createElement('div');
  item.className = `toast toast-${type}`;
  item.textContent = message;
  root.appendChild(item);
  setTimeout(() => {
    item.style.transition = 'opacity .25s ease, transform .25s ease';
    item.style.opacity = '0';
    item.style.transform = 'translateY(6px)';
    setTimeout(() => item.remove(), 260);
  }, duration);
}

export function openModal({ title, subtitle = '', body = '', footer = [], wide = false, onClose }) {
  const root = document.getElementById('modal-root');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div>
          <h3>${esc(title)}</h3>
          ${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ''}
        </div>
        <button class="modal-close" aria-label="关闭">×</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot"></div>
    </div>
  `;
  const modal = overlay.querySelector('.modal');
  const footerBox = modal.querySelector('.modal-foot');

  const close = () => {
    overlay.remove();
    document.body.classList.remove('modal-open');
    if (onClose) onClose();
  };

  for (const item of footer) {
    const button = document.createElement('button');
    button.className = `btn ${item.class || 'ghost'}`;
    button.textContent = item.label;
    button.onclick = () => {
      if (item.onClick) item.onClick(close);
      else close();
    };
    footerBox.appendChild(button);
  }
  if (!footer.length) footerBox.remove();

  overlay.querySelector('.modal-backdrop').onclick = close;
  overlay.querySelector('.modal-close').onclick = close;
  const onKey = (event) => {
    if (event.key === 'Escape') {
      document.removeEventListener('keydown', onKey);
      close();
    }
  };
  document.addEventListener('keydown', onKey);

  document.body.classList.add('modal-open');
  root.appendChild(overlay);
  return { close, modal, overlay };
}

export function confirmDialog(title, message, okText = '确定', danger = false) {
  return new Promise((resolve) => {
    const modal = openModal({
      title,
      body: `<p class="note" style="font-size:13px;line-height:1.8">${esc(message)}</p>`,
      footer: [
        { label: '取消', class: 'ghost', onClick: (close) => { resolve(false); close(); } },
        {
          label: okText,
          class: danger ? 'danger' : 'primary',
          onClick: (close) => { resolve(true); close(); }
        }
      ],
      onClose: () => resolve(false)
    });
    modal.overlay.querySelector('.modal-backdrop').onclick = () => {
      modal.close();
    };
  });
}

export function eventModal(event) {
  if (!event) return;
  const [levelText, tone] = LEVEL[event.level] || LEVEL.info;
  const signInfo = event.signInfo ? `
    <div class="sign-box">
      <h4>签名与验签</h4>
      <dl>
        <dt>算法</dt><dd>${esc(event.signInfo.algorithm || 'HMAC-SHA256')}</dd>
        <dt>待签串</dt><dd>${esc(event.signInfo.signString || '—')}</dd>
        <dt>签名值</dt><dd>${esc(event.signInfo.sign || '—')}</dd>
        <dt>验签结果</dt><dd>${esc(event.signInfo.verifyResult || 'VALID')}</dd>
        ${event.signInfo.expected ? `<dt>期望签名</dt><dd>${esc(event.signInfo.expected)}</dd>` : ''}
      </dl>
    </div>
  ` : '';

  const body = `
    <div class="event-top">
      ${badge(levelText, tone)}
      <span class="chip">${esc(event.stageName || '系统')}</span>
      <span class="chip">阶段 ${Number(event.phaseIndex) + 1}</span>
      ${event.latencyMs !== null && event.latencyMs !== undefined ? `<span class="chip">耗时 ${event.latencyMs}ms</span>` : ''}
      <span class="chip mono">${esc(fmtTime(event.ts, true))}</span>
    </div>
    <div class="event-title">${esc(event.title || '')}</div>
    <div class="event-detail">${esc(event.detail || '')}</div>
    <div class="row mt-12">
      <span class="chip">${esc(event.actor || '—')}</span>
      <span class="sm-arrow">→</span>
      <span class="chip">${esc(event.target || '—')}</span>
    </div>
    <div class="payload-grid">
      <div class="payload-box">
        <h4>请求报文 REQUEST</h4>
        ${jsonBlock(event.request)}
      </div>
      <div class="payload-box">
        <h4>响应报文 RESPONSE</h4>
        ${jsonBlock(event.response)}
      </div>
    </div>
    ${signInfo}
  `;

  openModal({
    title: '报文详情 · ' + (event.stageName || '系统事件'),
    body,
    wide: true,
    footer: [{ label: '关闭', class: 'ghost' }]
  });
}

export function emptyState(title, text, actionHtml = '') {
  return `
    <div class="empty-state">
      <div class="empty-icon">◎</div>
      <h3>${esc(title)}</h3>
      <p>${text}</p>
      ${actionHtml}
    </div>
  `;
}
