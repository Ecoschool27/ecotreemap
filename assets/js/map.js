// EcoTreeMap — главная карта: точки деревьев с кластеризацией, фильтр по породам и годам,
// список деревьев без отмеченного места.
(function () {
  'use strict';
  var ECO = window.ECO;
  if (!ECO) return; // common.js не загрузился — сообщение покажет страховка в index.html
  ECO.needsCluster = true;

  var params = new URLSearchParams(window.location.search);

  function passportHref(id) {
    return 'pages/tree.html?id=' + encodeURIComponent(id);
  }

  function main() {
    var data = ECO.loadData();
    if (!data.ok) {
      ECO.showFatal('Данные о деревьях не загрузились', data.errors.concat([
        'Проверьте, что папка data/ лежит рядом с index.html.'
      ]));
      return;
    }

    var trees = data.trees;
    var total = trees.length;
    var placed = trees.filter(ECO.hasCoords);
    var unplaced = trees.filter(function (t) { return !ECO.hasCoords(t); });

    // ----- сводка -----
    document.getElementById('summary').textContent =
      'Отмечено на карте: ' + placed.length + ' из ' + total + ' ' + ECO.treesWord(total);

    // ----- легенда/фильтр: строится из данных -----
    var speciesKeys = [];
    var years = [];
    trees.forEach(function (t) {
      if (speciesKeys.indexOf(t.species) === -1) speciesKeys.push(t.species);
      if (years.indexOf(t.planted_year) === -1) years.push(t.planted_year);
    });
    years.sort(function (a, b) { return b - a; });

    var initialSpecies = params.get('species');
    var speciesBox = document.getElementById('species-filter');
    speciesKeys.forEach(function (key) {
      var sp = data.species[key] || { name_ru: key, color: '#5f6368' };
      var all = trees.filter(function (t) { return t.species === key; });
      var onMap = all.filter(ECO.hasCoords).length;
      var input = ECO.el('input', {
        type: 'checkbox',
        checked: !initialSpecies || initialSpecies === key,
        attrs: { 'data-species': key }
      });
      speciesBox.appendChild(
        ECO.el('label', { className: 'check' }, [
          input,
          ECO.el('span', { className: 'dot', style: 'background:' + sp.color }),
          ECO.el('span', { text: sp.name_ru }),
          ECO.el('span', { className: 'legend-count', text: onMap + ' из ' + all.length })
        ])
      );
    });

    var yearBox = document.getElementById('year-filter');
    years.forEach(function (y) {
      var count = trees.filter(function (t) { return t.planted_year === y; }).length;
      yearBox.appendChild(
        ECO.el('label', { className: 'check' }, [
          ECO.el('input', { type: 'checkbox', checked: true, attrs: { 'data-year': String(y) } }),
          ECO.el('span', { text: String(y) }),
          ECO.el('span', { className: 'legend-count', text: count + ' ' + ECO.treesWord(count) })
        ])
      );
    });

    // ----- шефство: фильтр «под опекой / ищут опекуна» -----
    var patronBox = document.getElementById('patron-filter');
    var withPatron = trees.filter(function (t) { return !!ECO.patronOf(t); }).length;
    [['yes', 'Под опекой', withPatron, '#1b5e20'], ['no', 'Ищут опекуна', total - withPatron, '#ffffff']].forEach(function (row) {
      patronBox.appendChild(ECO.el('label', { className: 'check' }, [
        ECO.el('input', { type: 'checkbox', checked: true, attrs: { 'data-patron': row[0] } }),
        ECO.el('span', { className: 'dot dot--ring', style: 'background:' + row[3] }),
        ECO.el('span', { text: row[1] }),
        ECO.el('span', { className: 'legend-count', text: row[2] + ' ' + ECO.treesWord(row[2]) })
      ]));
    });

    // ----- список деревьев без места (паспорта доступны и без координат) -----
    document.getElementById('unplaced-summary').textContent =
      'Место не отмечено: ' + unplaced.length + ' ' + ECO.treesWord(unplaced.length);
    var unplacedList = document.getElementById('unplaced-list');
    if (!unplaced.length) {
      unplacedList.appendChild(ECO.el('p', { className: 'muted', text: 'Все деревья отмечены на карте.' }));
    }
    speciesKeys.forEach(function (key) {
      var group = unplaced.filter(function (t) { return t.species === key; });
      if (!group.length) return;
      var sp = data.species[key] || { name_ru: key };
      var ul = ECO.el('ul', { className: 'id-list' });
      group.forEach(function (t) {
        ul.appendChild(ECO.el('li', null, [
          ECO.el('a', {
            href: passportHref(t.id),
            text: t.id,
            attrs: { 'aria-label': 'Паспорт дерева ' + t.id + ' (место не отмечено)' }
          })
        ]));
      });
      unplacedList.appendChild(ECO.el('div', { className: 'unplaced-group' }, [
        ECO.el('h3', { text: sp.name_ru + ' — ' + group.length }),
        ul
      ]));
    });

    // На узком экране панель свёрнута, чтобы карта была видна сразу.
    if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) {
      document.getElementById('filters').open = false;
    }

    // ----- карта -----
    var missing = ECO.libsMissing();
    if (missing.length) {
      ECO.showFatal('Карта не загрузилась', [
        'Не найдены файлы библиотеки: ' + missing.join(', ') + '.',
        'Список деревьев и паспорта работают — они в панели слева/сверху.'
      ]);
      document.getElementById('map').hidden = true;
      return;
    }

    var cfg = window.ECO_CONFIG || {};
    var map = window.L.map('map', { zoomControl: true }).setView(cfg.MAP_CENTER || [49.777, 73.124], cfg.MAP_ZOOM || 16);

    var notice = document.getElementById('map-notice');
    var noticeLines = {};
    function renderNotice() {
      ECO.clear(notice);
      var keys = Object.keys(noticeLines).filter(function (k) { return noticeLines[k]; });
      keys.forEach(function (k) { notice.appendChild(ECO.el('p', { text: noticeLines[k] })); });
      notice.hidden = keys.length === 0;
    }

    ECO.addOsmLayer(map, function () {
      noticeLines.tiles = 'Подложка карты не загрузилась — нужен интернет. Точки деревьев и паспорта работают и без неё.';
      renderNotice();
    });

    var cluster = window.L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: function (zoom) {
        return zoom >= 19 ? 15 : zoom >= 17 ? 40 : 60;
      }
    });
    map.addLayer(cluster);

    var markers = Object.create(null); // без прототипа: ?focus=__proto__/constructor не находит чужих ключей
    placed.forEach(function (t) {
      var sp = ECO.speciesOf(data, t);
      var marker = window.L.circleMarker([t.lat, t.lon], {
        radius: 9,
        fillColor: sp.color,
        color: '#ffffff',
        weight: 2,
        fillOpacity: 0.95
      });
      marker.bindPopup(function () {
        return ECO.el('div', { className: 'popup' }, [
          ECO.el('h3', { text: 'Дерево ' + t.id }),
          ECO.el('p', { text: sp.name_ru + (sp.name_lat ? ' (' + sp.name_lat + ')' : '') }),
          ECO.el('p', { text: 'Посажено: ' + (ECO.formatDate(t.planted_date) || t.planted_year + ' г.') }),
          ECO.el('p', { text: 'Лет с посадки: ' + ECO.yearsSincePlanting(t.planted_year, null, t.planted_date) }),
          t.event ? ECO.el('p', { text: 'Акция: ' + t.event }) : null,
          ECO.el('p', { text: ECO.patronOf(t) ? 'Под опекой: ' + ECO.patronOf(t) : 'Ищет опекуна' }),
          ECO.el('a', { href: passportHref(t.id), text: 'Открыть паспорт дерева →' })
        ]);
      });
      marker.bindTooltip(ECO.el('span', { text: t.id }));
      markers[t.id] = { marker: marker, tree: t };
    });

    function checkedValues(box, attr) {
      var out = [];
      Array.prototype.forEach.call(box.querySelectorAll('input[' + attr + ']'), function (i) {
        if (i.checked) out.push(i.getAttribute(attr));
      });
      return out;
    }

    // «Нужна помощь»: состояние из списка; по галкам — ещё давно не осмотренные / давно не политые (только с местом)
    var helpOnly = document.getElementById('help-only');
    var helpStale = document.getElementById('help-stale');
    var helpDry = document.getElementById('help-dry');
    var helpCount = document.getElementById('help-count');
    var today = new Date();
    function needsHelp(t) {
      var r = ECO.helpReasons(t, today);
      return r.status || (helpStale.checked && r.stale) || (helpDry.checked && r.dry);
    }
    function applyFilter() {
      var sp = checkedValues(speciesBox, 'data-species');
      var yr = checkedValues(yearBox, 'data-year');
      var pt = checkedValues(patronBox, 'data-patron');
      var help = helpOnly.checked;
      var visible = [];
      var helpN = 0;
      Object.keys(markers).forEach(function (id) {
        var m = markers[id];
        var h = needsHelp(m.tree);
        if (h) helpN++;
        m.marker.setStyle(h && help ? { color: '#a1261b', weight: 4 } : { color: '#ffffff', weight: 2 });
        if (sp.indexOf(m.tree.species) !== -1 && yr.indexOf(String(m.tree.planted_year)) !== -1 &&
            pt.indexOf(ECO.patronOf(m.tree) ? 'yes' : 'no') !== -1 && (!help || h)) visible.push(m.marker);
      });
      var helpOff = trees.filter(function (t) { return !ECO.hasCoords(t) && needsHelp(t); }).length;
      helpCount.textContent = helpN
        ? 'Нужна помощь: ' + helpN + ' ' + ECO.treesWord(helpN) + ' на карте' + (helpOff ? '; ещё ' + helpOff + ' без места на карте' : '')
        : 'Сейчас нет отмеченных на карте деревьев, которым нужна помощь' + (helpOff ? ' (без места на карте: ' + helpOff + ')' : '') + '.';
      cluster.clearLayers();
      cluster.addLayers(visible);
      if (help && !helpN) {
        noticeLines.places = 'Деревьев, которым нужна помощь, на карте сейчас нет.';
      } else if (!placed.length) {
        noticeLines.places = 'Места посадок ещё не отмечены на карте (0 из ' + total + '). ' +
          'Паспорта деревьев открываются из списка «Место не отмечено».';
      } else if (!visible.length) {
        noticeLines.places = 'По выбранному фильтру точек на карте нет.';
      } else {
        noticeLines.places = '';
      }
      renderNotice();
      return visible;
    }

    document.getElementById('filter-form').addEventListener('change', applyFilter);
    var visible = applyFilter();

    // Показать дерево по ссылке index.html?focus=L-001
    var focusId = params.get('focus');
    if (focusId && ECO.ID_RE.test(focusId) && ECO.hasOwn(markers, focusId)) {
      cluster.zoomToShowLayer(markers[focusId].marker, function () {
        markers[focusId].marker.openPopup();
      });
    } else {
      if (focusId) {
        var ft = ECO.byId(data, focusId);
        noticeLines.focus = ft
          ? 'Место дерева ' + ft.id + ' пока не отмечено на карте.'
          : 'Дерево с номером «' + focusId.slice(0, 40) + '» не найдено.';
        renderNotice();
      }
      if (visible.length) {
        map.fitBounds(window.L.featureGroup(visible).getBounds(), { padding: [30, 30], maxZoom: 18 });
      }
    }

    // Панель на мобильном раскрывается и сжимает карту — пересчитать размер.
    Array.prototype.forEach.call(document.querySelectorAll('.panel details'), function (d) {
      d.addEventListener('toggle', function () { map.invalidateSize(); });
    });
    window.addEventListener('resize', function () { map.invalidateSize(); });

    window.ECO_MAP = map; // для отладки и автоматических проверок
    window.ECO_CLUSTER = cluster;
    window.ECO_PAGE_DONE = true;
  }

  try {
    main();
  } catch (e) {
    ECO.showFatal('Ошибка на странице карты', [String(e && e.message ? e.message : e)]);
  }
})();
