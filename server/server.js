'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const seed = require('./seed');
const engine = require('./engine');
const ops = require('./ops');
const interbank = require('./interbank');
const banking = require('./banking');

const PORT = Number(process.env.PORT || 5178);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function ok(res, data) {
  sendJson(res, 200, { ok: true, data });
}

function fail(res, error) {
  sendJson(res, error.status || 500, { ok: false, error: error.message || '服务器内部错误' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(Object.assign(new Error('请求 JSON 格式错误'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, pathname, url) {
  const method = req.method;
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : {};

  if (method === 'GET' && pathname === '/api/meta') {
    return ok(res, {
      channels: Object.values(engine.CHANNELS),
      phases: engine.PHASES,
      scenarios: engine.SCENARIOS,
      clearingScenarios: interbank.SCENARIOS,
      institutions: Object.values(interbank.INSTITUTIONS).map((item) => ({
        code: item.code,
        name: item.name,
        short: item.short,
        category: item.category,
        role: item.role,
        color: item.color
      })),
      bankOperationTypes: banking.OPERATION_TYPES,
      rules: store.get().risks.rules
    });
  }

  if (method === 'GET' && pathname === '/api/summary') {
    return ok(res, engine.summary());
  }

  if (method === 'GET' && pathname === '/api/payments') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 60), 200);
    return ok(res, { payments: engine.listPayments(limit) });
  }

  if (method === 'POST' && pathname === '/api/payments') {
    return ok(res, engine.createPayment(body));
  }

  let match = pathname.match(/^\/api\/payments\/([^/]+)$/);
  if (method === 'GET' && match) {
    return ok(res, engine.detail(engine.findPayment(match[1])));
  }

  match = pathname.match(/^\/api\/payments\/([^/]+)\/accounting$/);
  if (method === 'GET' && match) {
    return ok(res, engine.accountingDetail(match[1]));
  }

  match = pathname.match(/^\/api\/payments\/([^/]+)\/stages\/(\d+)$/);
  if (method === 'GET' && match) {
    return ok(res, engine.stageDetail(match[1], match[2]));
  }

  match = pathname.match(/^\/api\/payments\/([^/]+)\/step$/);
  if (method === 'POST' && match) {
    return ok(res, engine.stepPayment(match[1]));
  }

  match = pathname.match(/^\/api\/payments\/([^/]+)\/action$/);
  if (method === 'POST' && match) {
    if (!body.action) throw Object.assign(new Error('缺少 action 参数'), { status: 400 });
    return ok(res, engine.applyAction(match[1], body.action));
  }

  match = pathname.match(/^\/api\/payments\/([^/]+)\/close$/);
  if (method === 'POST' && match) {
    return ok(res, engine.closePayment(match[1]));
  }

  match = pathname.match(/^\/api\/payments\/([^/]+)\/renotify$/);
  if (method === 'POST' && match) {
    return ok(res, engine.renotify(match[1]));
  }

  match = pathname.match(/^\/api\/payments\/([^/]+)\/query$/);
  if (method === 'POST' && match) {
    return ok(res, engine.queryPayment(match[1]));
  }

  match = pathname.match(/^\/api\/payments\/([^/]+)\/late-notify$/);
  if (method === 'POST' && match) {
    return ok(res, engine.lateNotify(match[1]));
  }

  if (method === 'GET' && pathname === '/api/refunds') {
    return ok(res, { refunds: engine.listRefunds() });
  }

  if (method === 'POST' && pathname === '/api/refunds') {
    return ok(res, engine.createRefund(body));
  }

  match = pathname.match(/^\/api\/refunds\/([^/]+)\/retry$/);
  if (method === 'POST' && match) {
    return ok(res, engine.retryRefund(match[1]));
  }

  if (method === 'GET' && pathname === '/api/reconcile') {
    return ok(res, ops.reconView());
  }

  if (method === 'POST' && pathname === '/api/reconcile/bills') {
    return ok(res, ops.generateBill(body));
  }

  match = pathname.match(/^\/api\/reconcile\/bills\/([^/]+)\/run$/);
  if (method === 'POST' && match) {
    return ok(res, ops.runReconciliation(match[1]));
  }

  match = pathname.match(/^\/api\/reconcile\/runs\/([^/]+)\/diffs\/([^/]+)\/handle$/);
  if (method === 'POST' && match) {
    return ok(res, ops.handleDiff(match[1], match[2], body));
  }

  if (method === 'GET' && pathname === '/api/settlements') {
    return ok(res, ops.settlementView());
  }

  if (method === 'POST' && pathname === '/api/settlements/generate') {
    return ok(res, { batches: ops.generateBatches(body.date) });
  }

  match = pathname.match(/^\/api\/settlements\/([^/]+)\/settle$/);
  if (method === 'POST' && match) {
    return ok(res, ops.settleBatch(match[1]));
  }

  if (method === 'GET' && pathname === '/api/risk') {
    return ok(res, engine.riskView());
  }

  match = pathname.match(/^\/api\/risk\/rules\/([^/]+)$/);
  if (method === 'PUT' && match) {
    return ok(res, engine.updateRule(match[1], body));
  }

  if (method === 'POST' && pathname === '/api/risk/check') {
    return ok(res, engine.riskCheck(body));
  }

  if (method === 'GET' && pathname === '/api/clearing') {
    return ok(res, interbank.clearingView());
  }

  if (method === 'POST' && pathname === '/api/clearing/flows') {
    return ok(res, interbank.createFlow(body));
  }

  match = pathname.match(/^\/api\/clearing\/flows\/([^/]+)$/);
  if (method === 'GET' && match) {
    return ok(res, interbank.flowDetailById(match[1]));
  }

  match = pathname.match(/^\/api\/clearing\/flows\/([^/]+)\/step$/);
  if (method === 'POST' && match) {
    return ok(res, interbank.stepFlow(match[1]));
  }

  match = pathname.match(/^\/api\/clearing\/flows\/([^/]+)\/run$/);
  if (method === 'POST' && match) {
    return ok(res, interbank.runFlow(match[1]));
  }

  if (method === 'GET' && pathname === '/api/banking') {
    return ok(res, banking.bankingView());
  }

  if (method === 'POST' && pathname === '/api/banking/ops') {
    return ok(res, banking.applyBankOperation(body));
  }

  if (method === 'GET' && pathname === '/api/logs') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 200), 500);
    const level = url.searchParams.get('level');
    const keyword = (url.searchParams.get('q') || '').trim();
    let logs = store.get().logs;
    if (level) logs = logs.filter((log) => log.level === level);
    if (keyword) {
      const lower = keyword.toLowerCase();
      logs = logs.filter((log) => `${log.title} ${log.detail} ${log.stageName} ${log.paymentId || ''}`.toLowerCase().includes(lower));
    }
    logs = logs.slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
    return ok(res, { logs: logs.slice(0, limit) });
  }

  if (method === 'POST' && pathname === '/api/reset') {
    store.reset();
    seed.run();
    return ok(res, { reset: true });
  }

  throw Object.assign(new Error(`接口不存在：${method} ${pathname}`), { status: 404 });
}

function serveStatic(req, res, pathname) {
  let requested = pathname === '/' ? '/index.html' : pathname;
  try {
    requested = decodeURIComponent(requested);
  } catch (error) {
    res.writeHead(400);
    return res.end('Bad Request');
  }
  const filePath = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 · 资源不存在');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Length': stat.size
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, url);
      return;
    }
    serveStatic(req, res, pathname);
  } catch (error) {
    console.error(`[api] ${req.method} ${pathname} ->`, error.message);
    if (!res.headersSent) fail(res, error);
  }
});

const fresh = store.init();
if (fresh) {
  const seeded = seed.run();
  if (seeded) console.log('[seed] 演示数据初始化完成');
}

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  端口 ${PORT} 已被占用，请关闭占用该端口的程序后重试。`);
    console.error('');
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, () => {
  console.log('');
  console.log('  PayLab · 支付全链路教学系统');
  console.log(`  本地地址:  http://localhost:${PORT}`);
  console.log('  数据目录:  ./data/state.json');
  console.log('  按 Ctrl+C 停止服务');
  console.log('');
});
