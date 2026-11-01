async function request(path, options = {}) {
  const target = path.startsWith('/api') ? path : `/api${path}`;
  const response = await fetch(target, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }
  if (!response.ok || !payload || payload.ok === false) {
    throw new Error((payload && payload.error) || `请求失败（HTTP ${response.status}）`);
  }
  return payload.data;
}

export const get = (path) => request(path);
export const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) });
export const put = (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body || {}) });
