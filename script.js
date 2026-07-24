// script.js
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
  const currentPath = window.location.pathname.split('/').pop();
  if (!currentPath || currentPath === 'index.html') {
    document.querySelector('nav a[href="index.html"]').classList.add('active');
  } else {
    const activeLink = document.querySelector(`nav a[href="${currentPath}"]`);
    if (activeLink) activeLink.classList.add('active');
  }
});
