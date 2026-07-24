document.addEventListener('DOMContentLoaded', function () {
  // Переключение вкладок
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();

      // Обновляем активную вкладку
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      this.classList.add('active');

      // Показываем нужную страницу
      const target = this.getAttribute('data-target');
      document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
      document.getElementById(target).classList.add('active');
    });
  });

  // Анимация появления при загрузке
  document.querySelectorAll('.metric-card, .section-title').forEach(el => {
    el.classList.add('animate-fade-in');
  });
});
