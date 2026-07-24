import { initHome } from './pages/home.js';
import { initSales } from './pages/sales.js';
import { initProducts } from './pages/products.js';
import { initSettings } from './pages/settings.js';

const PAGES = {
  home: initHome,
  sales: initSales,
  products: initProducts,
  settings: initSettings,
};

document.addEventListener('DOMContentLoaded', () => {
  // Навигация
  const links = document.querySelectorAll('nav a');
  links.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const target = link.dataset.target;

      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      const pages = document.querySelectorAll('.page');
      pages.forEach(p => p.classList.remove('active'));
      document.getElementById(target).classList.add('active');

      // Инициализируем только активную страницу
      if (PAGES[target]) PAGES[target]();
    });
  });

  // Активируем первую страницу
  const firstLink = document.querySelector('nav a.active') || document.querySelectorAll('nav a')[0];
  if (firstLink) {
    firstLink.click();
  }
});