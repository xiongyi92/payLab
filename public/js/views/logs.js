import { get } from '../api.js';
import { esc, fmtTime, levelBadge, badge, toast, emptyState, eventModal } from '../ui.js';

const REFRESH_OPTIONS = [
  ['0', '手动刷新'],
  ['5', '每 5 秒'],
  ['15', '每 15 秒'],
  ['30', '每 30 秒']
];

function toolbar() {
  return `
    <div class="card">
      <div class="card-head">
        <div>
          <h2>全链路事件流</h2>
          <p class="sub">每一次状态推进、渠道交互与账务动作都会留下可追溯的事件与报文</p>
        </div>
        <div class="log-badges" id="log-stats"></div>
      </div>
      <div class="log-toolbar">
        <label class="field">
          <span>日志级别</span>
          <select id="log-level">
            <option value="">全部级别</option>
            <option value="info">信息 info</option>
            <option value="success">成功 success</option>
            <option value="warn">警告 warn</option>
            <option value="error">错误 error</option>
          </select>
        </label>
        <label class="field grow">
          <span>关键词检索</span>
          <input id="log-q" type="search" placeholder="搜索事件标题、阶段、交易号或支付单号" autocomplete="off">
        </label>
        <label class="field" style="min-width:120px">
          <span>自动刷新</span>
          <select id="log-refresh">
            ${REFRESH_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
          </select>
        </label>
        <button class="btn ghost" type="button" id="log-reload">立即刷新</button>
        <span class="chip" id="log-count">—</span>
      </div>
    </div>
  `;
}

function row(log, index) {
  const level = ['info', 'success', 'warn', 'error'].includes(log.level) ? log.level : 'info';
  return `
    <div class="log-row" data-index="${index}" role="button" tabindex="0" title="点击查看完整报文">
      <div class="log-time">${esc(fmtTime(log.ts, true))}</div>
      <div class="lvl-dot ${level}"></div>
      <div class="log-main">
        <div class="log-title">${esc(log.title || '未命名事件')}</div>
        <div class="log-sub">${esc(log.detail || '—')}</div>
      </div>
      <div class="log-badges">
        ${levelBadge(level)}
        ${log.stageName ? badge(log.stageName, 'gray') : ''}
        ${log.outTradeNo ? `<span class="chip mono">${esc(log.outTradeNo)}</span>` : ''}
        ${Number.isFinite(Number(log.latencyMs)) && log.latencyMs !== null ? `<span class="chip">${Number(log.latencyMs)}ms</span>` : ''}
      </div>
    </div>
  `;
}

export default {
  async render(root) {
    root.innerHTML = `
      ${toolbar()}
      <div class="card mt-16" style="padding:0">
        <div class="log-list" id="log-list">
          <div class="loading"><span class="spinner"></span>加载事件流…</div>
        </div>
      </div>
      <div class="card mt-16 tight">
        <div class="card-head"><h3>如何阅读这份日志</h3>${badge('Observability', 'blue')}</div>
        <p class="note">
          事件流按时间倒序展示。点击任意一行可以查看该阶段的请求报文、响应报文、签名待签串与验签结果。
          排查问题时，通常先用交易号定位链路，再对照渠道回调与本地账务时间点，判断是否存在重复入账、掉单或金额不一致。
        </p>
      </div>
    `;

    const listEl = root.querySelector('#log-list');
    const countEl = root.querySelector('#log-count');
    const statsEl = root.querySelector('#log-stats');
    const levelEl = root.querySelector('#log-level');
    const queryEl = root.querySelector('#log-q');
    const refreshEl = root.querySelector('#log-refresh');

    let logs = [];
    let timer = null;
    let debounce = null;
    let requestSeq = 0;

    function bindRows() {
      listEl.querySelectorAll('[data-index]').forEach((item) => {
        const open = () => {
          const log = logs[Number(item.dataset.index)];
          if (log) eventModal(log);
        };
        item.addEventListener('click', open);
        item.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        });
      });
    }

    async function load(silent = false) {
      const seq = ++requestSeq;
      const params = new URLSearchParams({ limit: '300' });
      if (levelEl.value) params.set('level', levelEl.value);
      const keyword = queryEl.value.trim();
      if (keyword) params.set('q', keyword);
      try {
        const data = await get(`/logs?${params.toString()}`);
        if (seq !== requestSeq) return;
        logs = data.logs || [];
        countEl.textContent = `${logs.length} 条事件`;
        const counts = logs.reduce((acc, log) => {
          acc[log.level] = (acc[log.level] || 0) + 1;
          return acc;
        }, {});
        statsEl.innerHTML = ['error', 'warn', 'success', 'info']
          .filter((level) => counts[level])
          .map((level) => levelBadge(level) + `<span class="chip">${counts[level]}</span>`)
          .join('');
        listEl.innerHTML = logs.length
          ? logs.map(row).join('')
          : emptyState('没有匹配的事件', '换一个关键词或切换日志级别试试。');
        bindRows();
      } catch (error) {
        if (!silent) toast(error.message, 'error');
      }
    }

    function schedule() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      const seconds = Number(refreshEl.value);
      if (seconds > 0) {
        timer = setInterval(() => load(true), seconds * 1000);
      }
    }

    levelEl.addEventListener('change', () => load());
    queryEl.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => load(), 260);
    });
    refreshEl.addEventListener('change', schedule);
    root.querySelector('#log-reload').addEventListener('click', () => {
      load();
      toast('事件流已刷新', 'success', 1600);
    });

    await load();
    schedule();

    return () => {
      requestSeq += 1;
      if (timer) clearInterval(timer);
      if (debounce) clearTimeout(debounce);
    };
  }
};
