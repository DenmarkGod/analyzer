// Общая навигация для всех страниц
document.addEventListener('DOMContentLoaded', () => {
  const links = document.querySelectorAll('nav a');
  links.forEach(link => {
    link.addEventListener('click', e => {
      // Удаляем active у всех
      links.forEach(l => l.classList.remove('active'));
      // Добавляем active текущему
      link.classList.add('active');
    });
  });

  // Подсветка активной ссылки по URL (опционально, но полезно)
  const currentPath = window.location.pathname;
  const activeLink = Array.from(links).find(a => {
    const href = a.getAttribute('href').replace('#', '');
    return href === currentPath || href === 'index.html' && currentPath === '/';
  });
  if (activeLink) activeLink.classList.add('active');
});