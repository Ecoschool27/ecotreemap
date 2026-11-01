// EcoTreeMap — статистика проекта (pages/stats.html). Все числа — из data/trees.js, ничего не выдумывается.
// Диаграммы — встроенный SVG без библиотек; у каждой есть aria-label/title и текстовый список с числами.
(function () {
  'use strict';
  var ECO = window.ECO;
  if (!ECO) return;
  // Страховка от смешения версий в кэше браузера (этот файл новее common.js): нет функции — тихая деградация.
  if (typeof ECO.t !== 'function') ECO.t = window.ECO_T || function (k, ru) { return ru; };
  if (typeof ECO.spName !== 'function') ECO.spName = function (sp) { return sp ? sp.name_ru : ''; };
  if (typeof ECO.patronOf !== 'function') ECO.patronOf = function () { return ''; };
  if (typeof ECO.validObservations !== 'function') ECO.validObservations = function () { return []; };
  var el = ECO.el;
  var NS = 'http://www.w3.org/2000/svg';

  function svg(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, String(attrs[k])); });
    if (text !== undefined) n.textContent = String(text);
    return n;
  }
  function noData(text) {
    return el('p', { className: 'muted', text: text || 'Пока нет данных.' });
  }

  // Горизонтальные столбцы: подпись над столбцом, число справа. rows: [{label, value, color}]
  function barChart(title, rows) {
    var max = rows.reduce(function (m, r) { return Math.max(m, r.value); }, 0);
    if (!rows.length || !max) return noData();
    var W = 340, rowH = 46;
    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + rows.length * rowH, class: 'chart', role: 'img',
      'aria-label': title + ': ' + rows.map(function (r) { return r.label + ' — ' + r.value; }).join('; ') });
    root.appendChild(svg('title', {}, title));
    rows.forEach(function (r, i) {
      var y = i * rowH;
      var w = Math.max(2, Math.round((W - 60) * r.value / max));
      root.appendChild(svg('text', { x: 0, y: y + 15, 'font-size': 14, fill: '#1c1c1c' }, r.label));
      root.appendChild(svg('rect', { x: 0, y: y + 22, width: w, height: 16, rx: 3, fill: r.color || '#1b5e20' }));
      root.appendChild(svg('text', { x: w + 6, y: y + 36, 'font-size': 14, 'font-weight': 700, fill: '#1c1c1c' }, r.value));
    });
    return root;
  }

  // Кольцо: доли по сегментам. rows: [{label, value, color}]
  function donut(title, rows) {
    var total = rows.reduce(function (s, r) { return s + r.value; }, 0);
    if (!total) return noData();
    var R = 70, C = 2 * Math.PI * R, off = 0;
    var root = svg('svg', { viewBox: '0 0 200 200', class: 'chart', style: 'max-width:220px', role: 'img',
      'aria-label': title + ': ' + rows.filter(function (r) { return r.value; }).map(function (r) { return r.label + ' — ' + r.value; }).join('; ') });
    root.appendChild(svg('title', {}, title));
    rows.forEach(function (r) {
      if (!r.value) return;
      var len = C * r.value / total;
      root.appendChild(svg('circle', { cx: 100, cy: 100, r: R, fill: 'none', stroke: r.color, 'stroke-width': 34,
        'stroke-dasharray': len + ' ' + (C - len), 'stroke-dashoffset': -off, transform: 'rotate(-90 100 100)' }));
      off += len;
    });
    root.appendChild(svg('text', { x: 100, y: 108, 'text-anchor': 'middle', 'font-size': 24, 'font-weight': 700, fill: '#1c1c1c' }, total));
    return root;
  }

  function legend(rows, total) {
    return el('ul', { className: 'chart-legend' }, rows.filter(function (r) { return r.value; }).map(function (r) {
      return el('li', null, [
        el('span', { className: 'dot', style: 'background:' + r.color, attrs: { 'aria-hidden': 'true' } }),
        ' ' + r.label + ': ' + r.value + (total ? ' (' + Math.round(100 * r.value / total) + '%)' : '')
      ]);
    }));
  }

  var STATUS_COLORS = { healthy: '#1b5e20', needs_water: '#0b57d0', needs_check: '#8a5a00', damaged: '#a1261b', sick: '#7b1fa2', dead: '#4a4f4a' };

  // Сводка (чистая функция — для проверок): {total, placed, inspected, patrons, waterings, bySpecies, byYear, byStatus}
  // «Осмотрено» = деревья с указанным состоянием — то же множество, что «из N осмотренных» (сумма byStatus).
  // Отметки «только полив» состояние не задают и считаются отдельно — в waterings.
  ECO.computeStats = function (data) {
    var trees = data.trees;
    var s = { total: trees.length, placed: 0, inspected: 0, patrons: 0, waterings: 0, bySpecies: {}, byYear: {}, byStatus: {} };
    trees.forEach(function (t) {
      if (ECO.hasCoords(t)) s.placed++;
      if (ECO.patronOf(t)) s.patrons++;
      s.waterings += ECO.validObservations(t).filter(function (o) { return o.watered === true; }).length;
      s.bySpecies[t.species] = (s.bySpecies[t.species] || 0) + 1;
      s.byYear[t.planted_year] = (s.byYear[t.planted_year] || 0) + 1;
      if (t.status && ECO.hasOwn(STATUS_COLORS, t.status)) {
        s.inspected++;
        s.byStatus[t.status] = (s.byStatus[t.status] || 0) + 1;
      }
    });
    return s;
  };

  function main(data) {
    if (!data.ok) {
      ECO.showFatal('Данные не загрузились', data.errors, [{ href: '../index.html', text: 'Открыть карту' }]);
      return;
    }
    var s = ECO.computeStats(data);
    var content = ECO.clear(document.getElementById('content'));

    function num(label, value, id) {
      return el('div', { className: 'stat', attrs: { 'data-stat': id } }, [el('b', { text: String(value) }), label]);
    }
    content.appendChild(el('section', { className: 'card' }, [
      el('h2', { text: 'Коротко' }),
      el('div', { className: 'stats-grid' }, [
        num('деревьев на учёте', s.total, 'total'),
        num('отмечено на карте', s.placed, 'placed'),
        num('осмотрено', s.inspected, 'inspected'),
        num('под опекой', s.patrons, 'patrons'),
        num('отметок полива', s.waterings, 'waterings')
      ]),
      el('p', { className: 'muted', text: 'Осмотрено — деревья, у которых указано состояние. Отметка «только полив» ' +
        'осмотром не считается и учитывается в «отметках полива».' })
    ]));

    var spRows = Object.keys(s.bySpecies).map(function (k) {
      var sp = data.species[k] || { name_ru: k, color: '#5f6368' };
      return { label: sp.name_ru, value: s.bySpecies[k], color: sp.color };
    }).sort(function (a, b) { return b.value - a.value; });
    content.appendChild(el('section', { className: 'card', attrs: { id: 'by-species' } }, [
      el('h2', { text: 'По породам' }), barChart('Деревья по породам', spRows)
    ]));

    var yrRows = Object.keys(s.byYear).sort().map(function (y) { return { label: y + ' г.', value: s.byYear[y], color: '#1b5e20' }; });
    content.appendChild(el('section', { className: 'card', attrs: { id: 'by-year' } }, [
      el('h2', { text: 'По годам посадки' }), barChart('Деревья по годам посадки', yrRows)
    ]));

    var stRows = ECO.STATUS_KEYS.map(function (k) { return { label: ECO.statusLabel(k), value: s.byStatus[k] || 0, color: STATUS_COLORS[k] }; });
    var withStatus = stRows.reduce(function (a, r) { return a + r.value; }, 0);
    var stCard = el('section', { className: 'card', attrs: { id: 'by-status' } }, [el('h2', { text: 'Состояние деревьев' })]);
    if (!withStatus) {
      stCard.appendChild(noData('Пока нет данных: ни одно дерево ещё не осмотрено.'));
    } else {
      var healthy = s.byStatus.healthy || 0;
      stCard.appendChild(el('p', { className: 'summary-line', attrs: { id: 'healthy-share' },
        text: 'Здоровых: ' + Math.round(100 * healthy / withStatus) + '% (' + healthy + ' из ' + withStatus + ' осмотренных)' }));
      stCard.appendChild(donut('Состояние осмотренных деревьев', stRows));
      stCard.appendChild(legend(stRows, withStatus));
    }
    content.appendChild(stCard);
    content.appendChild(el('p', { className: 'muted', text: 'Все числа считаются по реестру деревьев сайта (data/trees.js) при открытии страницы.' }));
    window.ECO_STATS = s;
    window.ECO_PAGE_DONE = true;
  }

  // Данные — асинхронно (онлайн-база или снимок, assets/js/db.js + common.js). Старый common.js без
  // ECO.runPage (смешение версий в кэше) — синхронно из снимка, как раньше.
  if (typeof ECO.runPage === 'function') {
    ECO.runPage(main, 'Ошибка на странице статистики', [{ href: '../index.html', text: 'Открыть карту' }]);
  } else {
    try {
      main(ECO.loadData());
    } catch (e) {
      ECO.showFatal('Ошибка на странице статистики', [String(e && e.message ? e.message : e)], [{ href: '../index.html', text: 'Открыть карту' }]);
    }
  }
})();
