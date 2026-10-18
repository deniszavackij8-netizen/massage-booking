// Подключается в <head>, до показа страницы. Помечает страницу классом
// motion — так элементы, которые анимации (animations.js) плавно покажут,
// не мелькают до начала анимации. Если анимации не запустились за 1,5 с
// (медленный интернет, ошибка), класс снимается и всё видно как обычно.
(function () {
  var root = document.documentElement;
  root.classList.add('motion');
  setTimeout(function () {
    if (!window.SS_MOTION) root.classList.remove('motion');
  }, 1500);
})();
