// Забирает данные из JSON API МоегоСклада и складывает их в data/latest.json.
// Запускается через GitHub Actions (см. .github/workflows/sync.yml), не в браузере —
// поэтому токен доступа никогда не попадает на сайт и не виден посетителям.

const TOKEN = process.env.MOYSKLAD_TOKEN;
const BASE = 'https://api.moysklad.ru/api/remap/1.2';

// Сколько дней истории тянуть для графиков и сколько строк оставлять в топах.
// Можно менять под себя.
const TREND_DAYS = 90;   // окно для графиков продаж/заказов/денег
const PROFIT_DAYS = 30;  // окно для прибыльности по товарам/каналам/клиентам
const TOP_N = 10;        // сколько строк в топ-таблицах
const LOW_STOCK_LIMIT = 30;
const STALE_STOCK_LIMIT = 10;

if (!TOKEN) {
  console.error('Не задан MOYSKLAD_TOKEN (секрет репозитория).');
  process.exit(1);
}

const warnings = [];

function fmtDate(d) {
  // МойСклад ждёт "YYYY-MM-DD HH:MM:SS". Время — по UTC; для дневной
  // группировки точность до часового пояса аккаунта тут не критична.
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function toRub(kopecks) {
  if (kopecks === null || kopecks === undefined) return 0;
  return Math.round(kopecks / 100);
}

async function msFetchUrl(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`МойСклад API ${res.status} ${res.statusText} — ${url}\n${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function msFetch(path) {
  return msFetchUrl(`${BASE}${path}`);
}

// Тянет все страницы коллекции по meta.nextHref (лимит на всякий случай, чтобы
// не уйти в бесконечный цикл при аномалии в ответе API).
async function fetchAllRows(initialPath, maxPages = 10) {
  let url = `${BASE}${initialPath}`;
  let rows = [];
  let page = 0;
  while (url && page < maxPages) {
    const data = await msFetchUrl(url);
    rows = rows.concat(data.rows || []);
    url = data.meta && data.meta.nextHref ? data.meta.nextHref : null;
    page++;
  }
  return rows;
}

// Оборачивает необязательный раздел отчёта: если не хватает прав/тарифа —
// не роняем весь синк, а просто отмечаем раздел как недоступный.
async function optional(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`Пропускаю «${label}»: ${err.message}`);
    warnings.push(`${label}: ${err.status ? `HTTP ${err.status}` : err.message}`);
    return null;
  }
}

async function main() {
  const now = new Date();
  const trendFrom = new Date(now.getTime() - TREND_DAYS * 24 * 60 * 60 * 1000);
  const profitFrom = new Date(now.getTime() - PROFIT_DAYS * 24 * 60 * 60 * 1000);
  const qs = (from, to, extra = '') =>
    `momentFrom=${encodeURIComponent(fmtDate(from))}&momentTo=${encodeURIComponent(fmtDate(to))}${extra}`;

  // --- Показатели дня/недели/месяца (плашки KPI) ---
  const shapeDashboard = (d) => ({
    sales: { count: d.sales.count, amount: toRub(d.sales.amount), movementAmount: toRub(d.sales.movementAmount) },
    orders: { count: d.orders.count, amount: toRub(d.orders.amount), movementAmount: toRub(d.orders.movementAmount) },
    money: {
      income: toRub(d.money.income),
      outcome: toRub(d.money.outcome),
      balance: toRub(d.money.balance),
      todayMovement: toRub(d.money.todayMovement),
      movement: toRub(d.money.movement),
    },
  });

  const dashboard = await optional('Показатели', async () => {
    const [day, week, month] = await Promise.all([
      msFetch('/report/dashboard/day'),
      msFetch('/report/dashboard/week'),
      msFetch('/report/dashboard/month'),
    ]);
    return { day: shapeDashboard(day), week: shapeDashboard(week), month: shapeDashboard(month) };
  });

  // --- Графики: продажи, заказы, деньги ---
  const salesTrend = await optional('График продаж', async () => {
    const r = await msFetch(`/report/sales/plotseries?${qs(trendFrom, now, '&interval=day')}`);
    return r.series.map((p) => ({ date: p.date.slice(0, 10), quantity: p.quantity, sum: toRub(p.sum) }));
  });

  const ordersTrend = await optional('График заказов', async () => {
    const r = await msFetch(`/report/orders/plotseries?${qs(trendFrom, now, '&interval=day')}`);
    return r.series.map((p) => ({ date: p.date.slice(0, 10), quantity: p.quantity, sum: toRub(p.sum) }));
  });

  const moneyTrend = await optional('График денег', async () => {
    const r = await msFetch(`/report/money/plotseries?${qs(trendFrom, now, '&interval=day')}`);
    return {
      creditTotal: toRub(r.credit),
      debitTotal: toRub(r.debit),
      series: r.series.map((p) => ({
        date: p.date.slice(0, 10),
        credit: toRub(p.credit),
        debit: toRub(p.debit),
        balance: toRub(p.balance),
      })),
    };
  });

  // --- Остатки: общие цифры + алерты ---
  const stock = await optional('Остатки', async () => {
    // quantityMode=all — чтобы не терять товары с нулевым доступным остатком
    const rows = await fetchAllRows('/report/stock/all?limit=1000&filter=quantityMode=all');
    const positive = rows.filter((r) => r.stock > 0);

    const totalValueRub = Math.round(
      positive.reduce((sum, r) => sum + (r.price || 0) * r.stock, 0) / 100
    );

    const staleStock = [...positive]
      .sort((a, b) => (b.stockDays || 0) - (a.stockDays || 0))
      .slice(0, STALE_STOCK_LIMIT)
      .map((r) => ({ name: r.name, code: r.code, stock: r.stock, uom: r.uom?.name, stockDays: Math.round(r.stockDays || 0) }));

    const outOfStock = rows
      .filter((r) => r.stock <= 0)
      .slice(0, LOW_STOCK_LIMIT)
      .map((r) => ({ name: r.name, code: r.code, stock: r.stock }));

    let lowStock = [];
    try {
      const lowRows = await fetchAllRows(
        '/report/stock/all?limit=1000&filter=stockMode=underMinimum;quantityMode=all'
      );
      lowStock = lowRows.slice(0, LOW_STOCK_LIMIT).map((r) => ({
        name: r.name,
        code: r.code,
        stock: r.stock,
        uom: r.uom?.name,
      }));
    } catch (err) {
      warnings.push(`Товары ниже минимального остатка: ${err.status ? `HTTP ${err.status}` : err.message}`);
    }

    return {
      totalSkuCount: rows.length,
      totalValueRub,
      lowStock,
      staleStock,
      outOfStock,
    };
  });

  // --- Прибыльность: топ товаров и каналы продаж ---
  const topProducts = await optional('Топ товаров', async () => {
    const rows = await fetchAllRows(`/report/profit/byproduct?limit=1000&${qs(profitFrom, now)}`);
    return rows
      .sort((a, b) => (b.sellSum || 0) - (a.sellSum || 0))
      .slice(0, TOP_N)
      .map((r) => ({
        name: r.assortment?.name,
        code: r.assortment?.code,
        quantity: r.sellQuantity,
        sum: toRub(r.sellSum),
        profit: toRub(r.profit),
        margin: r.salesMargin != null ? Math.round(r.salesMargin * 100) : null,
      }));
  });

  const channels = await optional('Каналы продаж', async () => {
    const rows = await fetchAllRows(`/report/profit/bysaleschannel?limit=1000&${qs(profitFrom, now)}`);
    return rows
      .sort((a, b) => (b.sellSum || 0) - (a.sellSum || 0))
      .map((r) => ({
        name: r.salesChannel?.name || 'Без канала',
        sum: toRub(r.sellSum),
        profit: toRub(r.profit),
        margin: r.salesMargin != null ? Math.round(r.salesMargin * 100) : null,
      }));
  });

  // --- Клиенты: требует опцию CRM в тарифе, поэтому мягкая деградация ---
  const topCounterparties = await optional('Топ клиентов (CRM)', async () => {
    const rows = await fetchAllRows('/report/counterparty?limit=1000');
    return rows
      .sort((a, b) => (b.demandsSum || 0) - (a.demandsSum || 0))
      .slice(0, TOP_N)
      .map((r) => ({
        name: r.counterparty?.name,
        demandsCount: r.demandsCount,
        sum: toRub(r.demandsSum),
        profit: toRub(r.profit),
        lastDemandDate: r.lastDemandDate,
      }));
  });

  const output = {
    updatedAt: now.toISOString(),
    windowDays: { trend: TREND_DAYS, profit: PROFIT_DAYS },
    dashboard,
    salesTrend,
    ordersTrend,
    moneyTrend,
    stock,
    topProducts,
    channels,
    topCounterparties,
    warnings,
  };

  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir('data', { recursive: true });
  await writeFile('data/latest.json', JSON.stringify(output, null, 2) + '\n');

  console.log(`Готово. Разделов с предупреждениями: ${warnings.length}.`);
  if (warnings.length) console.log(warnings.join('\n'));
}

main().catch((err) => {
  console.error('Синхронизация прервана:', err);
  process.exit(1);
});
