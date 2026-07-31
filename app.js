const APP = document.getElementById('app');
const STAMP = document.getElementById('syncStamp');

const fmtRub = (n) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
const fmtNum = (n) => Number(n).toLocaleString('ru-RU');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function deltaHtml(value) {
  if (value === null || value === undefined || value === 0) {
    return `<span class="kpi-delta flat">без изменений</span>`;
  }
  const up = value > 0;
  return `<span class="kpi-delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${fmtRub(Math.abs(value))} к пред. периоду</span>`;
}

function relativeTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = ms / 3_600_000;
  if (hours < 1) return 'только что';
  if (hours < 24) return `${Math.round(hours)} ч назад`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'вчера';
  return `${days} дн назад`;
}

function renderStamp(data) {
  STAMP.classList.remove('stamp--fresh', 'stamp--stale', 'stamp--old', 'stamp--unknown');
  if (!data || !data.updatedAt) {
    STAMP.classList.add('stamp--unknown');
    STAMP.querySelector('.stamp-text').textContent = 'нет данных';
    return;
  }
  const hours = (Date.now() - new Date(data.updatedAt).getTime()) / 3_600_000;
  const level = hours < 8 ? 'fresh' : hours < 48 ? 'stale' : 'old';
  STAMP.classList.add(`stamp--${level}`);
  const warn = data.warnings && data.warnings.length ? ` · ${data.warnings.length} предупр.` : '';
  STAMP.querySelector('.stamp-text').textContent = `синхр. ${relativeTime(data.updatedAt)}${warn}`;
}

function renderEmpty() {
  APP.innerHTML = `
    <div class="empty card">
      <h2>Данных пока нет</h2>
      <p>Первая синхронизация ещё не запускалась.</p>
      <p>Откройте вкладку <strong>Actions</strong> репозитория → workflow <strong>Sync MoySklad data</strong> →
      <code>Run workflow</code>, чтобы забрать данные вручную первый раз. Дальше это будет происходить по расписанию само.</p>
    </div>`;
}

function renderError(err) {
  APP.innerHTML = `
    <div class="error card">
      <h2>Не получилось загрузить данные</h2>
      <p>Файл <code>data/latest.json</code> не найден или повреждён.</p>
      <p class="warnings-note">${esc(err && err.message)}</p>
    </div>`;
}

function kpiSection(dashboard) {
  if (!dashboard) return '';
  const periods = { day: 'День', week: 'Неделя', month: 'Месяц' };
  const render = (period) => {
    const d = dashboard[period];
    return `
      <div class="kpi-grid" data-period-panel="${period}" ${period !== 'month' ? 'hidden' : ''}>
        <div class="kpi-card card">
          <p class="kpi-label">Продажи</p>
          <p class="kpi-value">${fmtRub(d.sales.amount)}</p>
          ${deltaHtml(d.sales.movementAmount)}
        </div>
        <div class="kpi-card card">
          <p class="kpi-label">Заказы</p>
          <p class="kpi-value">${fmtNum(d.orders.count)} шт</p>
          <span class="kpi-delta flat">на сумму ${fmtRub(d.orders.amount)}</span>
        </div>
        <div class="kpi-card card">
          <p class="kpi-label">Доход / расход</p>
          <p class="kpi-value" style="font-size:18px;">${fmtRub(d.money.income)} / ${fmtRub(d.money.outcome)}</p>
          <span class="kpi-delta flat">за период</span>
        </div>
        <div class="kpi-card card">
          <p class="kpi-label">Баланс денег</p>
          <p class="kpi-value">${fmtRub(d.money.balance)}</p>
          ${deltaHtml(d.money.todayMovement)}
        </div>
      </div>`;
  };
  return `
    <section>
      <div class="kpi-head">
        <h2 class="section-title">Показатели</h2>
        <div class="period-tabs" id="periodTabs">
          ${Object.entries(periods).map(([k, label]) => `<button data-period="${k}" class="${k === 'month' ? 'active' : ''}">${label}</button>`).join('')}
        </div>
      </div>
      ${Object.keys(periods).map(render).join('')}
    </section>`;
}

function wirePeriodTabs() {
  const tabs = document.getElementById('periodTabs');
  if (!tabs) return;
  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-period]');
    if (!btn) return;
    const period = btn.dataset.period;
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('[data-period-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.periodPanel !== period;
    });
  });
}

function chartsSection(salesTrend, moneyTrend, days) {
  if (!salesTrend && !moneyTrend) return '';
  return `
    <section>
      <h2 class="section-title">Динамика, ${days} дней</h2>
      <div class="chart-grid">
        ${salesTrend ? `<div class="chart-card card"><div class="chart-wrap"><canvas id="salesChart" role="img" aria-label="Оборот по дням за ${days} дней"></canvas></div></div>` : ''}
        ${moneyTrend ? `<div class="chart-card card"><div class="chart-wrap"><canvas id="moneyChart" role="img" aria-label="Доход и расход по дням за ${days} дней"></canvas></div></div>` : ''}
      </div>
    </section>`;
}

function drawCharts(data) {
  const muted = '#7a8290';
  const grid = 'rgba(255,255,255,0.06)';

  if (data.salesTrend && document.getElementById('salesChart')) {
    new Chart(document.getElementById('salesChart'), {
      type: 'line',
      data: {
        labels: data.salesTrend.map((p) => p.date.slice(5)),
        datasets: [{
          label: 'Оборот',
          data: data.salesTrend.map((p) => p.sum),
          borderColor: '#ffb13c',
          backgroundColor: 'rgba(255,177,60,0.14)',
          fill: true,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtRub(c.parsed.y) } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: muted, maxTicksLimit: 8, font: { size: 11 } } },
          y: { grid: { color: grid }, ticks: { color: muted, font: { size: 11 } } },
        },
      },
    });
  }

  if (data.moneyTrend && document.getElementById('moneyChart')) {
    new Chart(document.getElementById('moneyChart'), {
      type: 'line',
      data: {
        labels: data.moneyTrend.series.map((p) => p.date.slice(5)),
        datasets: [
          { label: 'Доход', data: data.moneyTrend.series.map((p) => p.credit), borderColor: '#2dd4a7', borderWidth: 2, pointRadius: 0, tension: 0.25 },
          { label: 'Расход', data: data.moneyTrend.series.map((p) => p.debit), borderColor: '#ff6b5b', borderWidth: 2, pointRadius: 0, tension: 0.25 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { color: muted, font: { size: 11 }, boxWidth: 10 } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtRub(c.parsed.y)}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: muted, maxTicksLimit: 8, font: { size: 11 } } },
          y: { grid: { color: grid }, ticks: { color: muted, font: { size: 11 } } },
        },
      },
    });
  }
}

function alertsSection(stock) {
  if (!stock) return '';
  const row = (name, code, meta, badgeClass, badgeText) => `
    <div class="alert-row card">
      <span class="alert-name">${esc(name)}${code ? ` <span class="alert-meta">· ${esc(code)}</span>` : ''}</span>
      <span style="display:flex; align-items:center; gap:10px;">
        <span class="alert-meta">${esc(meta)}</span>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </span>
    </div>`;

  const groups = [
    { title: 'Ниже минимального остатка', items: stock.lowStock, render: (r) => row(r.name, r.code, `${r.stock} ${r.uom || ''}`, 'badge--warning', 'Пополнить') },
    { title: 'Нет в наличии', items: stock.outOfStock, render: (r) => row(r.name, r.code, `${r.stock}`, 'badge--danger', 'Дефицит') },
    { title: 'Давно не двигался', items: stock.staleStock, render: (r) => row(r.name, r.code, `${r.stock} ${r.uom || ''}`, 'badge--warning', `${r.stockDays} дн`) },
  ];

  return `
    <section>
      <h2 class="section-title">Остатки: ${stock.totalSkuCount} позиций на ${fmtRub(stock.totalValueRub)}</h2>
      ${groups.map((g) => `
        <p class="kpi-label" style="margin: 14px 0 8px;">${g.title}</p>
        <div class="alert-list">
          ${g.items && g.items.length ? g.items.map(g.render).join('') : `<div class="alert-empty card">Пусто — всё в порядке.</div>`}
        </div>
      `).join('')}
    </section>`;
}

function tablesSection(topProducts, channels, topCounterparties) {
  const productsTable = topProducts ? `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Товар</th><th class="num">Продано</th><th class="num">Выручка</th><th class="num">Маржа</th></tr></thead>
          <tbody>
            ${topProducts.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${fmtNum(r.quantity)}</td><td class="num">${fmtRub(r.sum)}</td><td class="num">${r.margin != null ? r.margin + '%' : '—'}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  const channelsTable = channels && channels.length ? `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Канал</th><th class="num">Оборот</th><th class="num">Маржа</th></tr></thead>
          <tbody>
            ${channels.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${fmtRub(r.sum)}</td><td class="num">${r.margin != null ? r.margin + '%' : '—'}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  const customersTable = topCounterparties ? `
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Клиент</th><th class="num">Продаж</th><th class="num">Сумма</th></tr></thead>
          <tbody>
            ${topCounterparties.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${fmtNum(r.demandsCount)}</td><td class="num">${fmtRub(r.sum)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : `<div class="card" style="padding:16px; color:var(--text-muted); font-size:13px;">Раздел CRM недоступен на текущем тарифе или без нужных прав.</div>`;

  const productsSection = (productsTable || channelsTable) ? `
    <section>
      <h2 class="section-title">Топ товаров и каналы</h2>
      <div class="tables-grid">
        ${productsTable}
        ${channelsTable}
      </div>
    </section>` : '';

  const customersSection = `
    <section>
      <h2 class="section-title">Клиенты</h2>
      ${customersTable}
    </section>`;

  return productsSection + customersSection;
}

function warningsNote(warnings) {
  if (!warnings || !warnings.length) return '';
  return `<p class="warnings-note">Недоступны при последней синхронизации: ${warnings.map(esc).join(' · ')}</p>`;
}

function renderApp(data) {
  const days = data.windowDays ? data.windowDays.trend : 90;
  APP.innerHTML = `
    ${kpiSection(data.dashboard)}
    ${chartsSection(data.salesTrend, data.moneyTrend, days)}
    ${alertsSection(data.stock)}
    ${tablesSection(data.topProducts, data.channels, data.topCounterparties)}
    ${warningsNote(data.warnings)}
  `;
  wirePeriodTabs();
  drawCharts(data);
}

async function main() {
  try {
    const res = await fetch('data/latest.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderStamp(data);
    if (!data.updatedAt) {
      renderEmpty();
      return;
    }
    renderApp(data);
  } catch (err) {
    renderStamp(null);
    renderError(err);
  }
}

main();
