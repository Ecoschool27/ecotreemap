// EcoTreeMap — справочник пород (pages/species.html). Строится из data/species.js и data/trees.js.
(function () {
  'use strict';
  var ECO = window.ECO;
  if (!ECO) return;
  var el = ECO.el;

  function main() {
    var data = ECO.loadData();
    if (!data.ok) {
      ECO.showFatal('Данные не загрузились', data.errors, [{ href: '../index.html', text: 'Открыть карту' }]);
      return;
    }
    var content = document.getElementById('content');
    ECO.clear(content);

    var keys = Object.keys(data.species);
    content.appendChild(el('p', {
      text: 'В проекте посажено ' + data.trees.length + ' ' + ECO.treesWord(data.trees.length) +
        ' ' + keys.length + ' ' + ECO.plural(keys.length, ['породы', 'пород', 'пород']) + '.'
    }));

    keys.forEach(function (key) {
      var sp = data.species[key];
      var group = data.trees.filter(function (t) { return t.species === key; });
      var onMap = group.filter(ECO.hasCoords).length;
      var years = [];
      group.forEach(function (t) { if (years.indexOf(t.planted_year) === -1) years.push(t.planted_year); });
      years.sort();

      var dl = el('dl', { className: 'facts' });
      function fact(label, value) {
        dl.appendChild(el('dt', { text: label }));
        dl.appendChild(typeof value === 'string' ? el('dd', { text: value }) : el('dd', null, [value]));
      }
      fact('Латинское название', el('span', null, [
        el('i', { text: sp.name_lat || '—' }),
        sp.name_lat_note ? ' (' + sp.name_lat_note + ')' : ''
      ]));
      fact('Посажено', group.length + ' ' + ECO.treesWord(group.length));
      fact('Год посадки', years.length ? years.join(', ') : '—');
      fact('Отмечено на карте', onMap + ' из ' + group.length);
      fact('Цвет на карте', el('span', { className: 'dot', style: 'background:' + sp.color, attrs: { 'aria-hidden': 'true' } }));

      var care = sp.care && sp.care_source
        ? el('div', null, [
            el('p', { text: sp.care }),
            el('p', { className: 'muted' }, [
              'Источник: ',
              ECO.safeUrl(sp.care_source)
                ? el('a', { href: ECO.safeUrl(sp.care_source), text: sp.care_source, attrs: { target: '_blank', rel: 'noopener' } })
                : sp.care_source
            ])
          ])
        : el('p', { className: 'muted', text: 'Рекомендации по уходу будут добавлены после проверки по источнику.' });

      content.appendChild(el('section', { className: 'card', attrs: { id: key } }, [
        el('h2', { text: sp.name_ru }),
        ECO.photoBlock(sp, '../images/'),
        dl,
        el('h3', { text: 'Уход' }),
        care,
        el('p', { className: 'back-links' }, [
          el('a', {
            href: '../index.html?species=' + encodeURIComponent(key),
            className: 'btn btn--outline',
            text: 'Эта порода на карте',
            attrs: { 'aria-label': 'Показать на карте только породу «' + sp.name_ru + '»' }
          })
        ])
      ]));
    });

    // Переход по якорю species.html#lipa после построения страницы.
    if (window.location.hash) {
      var target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
      if (target) target.scrollIntoView();
    }
    window.ECO_PAGE_DONE = true;
  }

  try {
    main();
  } catch (e) {
    ECO.showFatal('Ошибка на странице пород', [String(e && e.message ? e.message : e)], [{ href: '../index.html', text: 'Открыть карту' }]);
  }
})();
