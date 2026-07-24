// api.js для Cloudflare Workers

const API_BASE = 'https://api.moysklad.ru/api/remap/1.2';

// Очередь запросов
let requestQueue = [];
let activeRequests = 0;
const MAX_PARALLEL = 5;
const RATE_LIMIT_WINDOW = 3000;
let requestCount = 0;
let windowStart = Date.now();

// Вспомогательная функция для задержки
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Проверка лимита запросов
async function checkRateLimit() {
  const now = Date.now();
  if (now - windowStart > RATE_LIMIT_WINDOW) {
    requestCount = 0;
    windowStart = now;
  }

  const MAX_REQUESTS_PER_WINDOW = 11;

  if (requestCount >= MAX_REQUESTS_PER_WINDOW) {
    const delay = RATE_LIMIT_WINDOW - (now - windowStart);
    await sleep(delay);
    return checkRateLimit();
  }

  requestCount++;
}

// Основная функция запроса
async function request(endpoint, token, method = 'GET', body = null) {
  await checkRateLimit();

  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept-Encoding': 'gzip',
    'Content-Type': 'application/json'
  };

  const options = {
    method,
    headers,
    ...(body && { body: JSON.stringify(body) })
  };

  try {
    const response = await fetch(url, options);

    if (response.status === 429) {
      await sleep(5000);
      return request(endpoint, token, method, body);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error: ${response.status} - ${errorText}`);
    }

    return await response.json();
  } catch (err) {
    throw err;
  }
}

// Внутренняя функция для выполнения запроса с очередью
function queueRequest(endpoint, token, method, body) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ endpoint, token, method, body, resolve, reject });
    processQueue();
  });
}

async function processQueue() {
  if (activeRequests >= MAX_PARALLEL || requestQueue.length === 0) {
    return;
  }

  const { endpoint, token, method, body, resolve, reject } = requestQueue.shift();
  activeRequests++;

  try {
    const result = await request(endpoint, token, method, body);
    resolve(result);
  } catch (err) {
    reject(err);
  } finally {
    activeRequests--;
    processQueue();
  }
}

// Экспортируемые функции
async function getSales(token, from, to) {
  return queueRequest(`/report/sales?from=${from}&to=${to}`, token, 'GET');
}

async function getProducts(token) {
  return queueRequest('/entity/product', token, 'GET');
}

async function getStocks(token) {
  return queueRequest('/report/stock/all', token, 'GET');
}

async function getMetadata(entityType, token) {
  return queueRequest(`/entity/${entityType}/metadata`, token, 'GET');
}

async function validateToken(token) {
  try {
    const data = await request('/security/token', token, 'GET');
    return { valid: true, data };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// Пример асинхронного запроса
async function createAsyncStockReport(token) {
  const response = await request('/report/stock/bystore?async=true', token, 'GET');
  return response['content-location'] || response.location;
}

// Основной обработчик Cloudflare Workers
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const token = request.headers.get('token');

    if (!token) {
      return new Response(JSON.stringify({ error: 'Токен не предоставлен' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (path === '/sales') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');

      if (!from || !to) {
        return new Response(JSON.stringify({ error: 'Не указаны даты: from, to' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      try {
        const data = await getSales(token, from, to);
        return new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    if (path === '/products') {
      try {
        const data = await getProducts(token);
        return new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    if (path === '/stocks') {
      try {
        const data = await getStocks(token);
        return new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    if (path === '/validate-token') {
      try {
        const result = await validateToken(token);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Маршрут не найден' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
