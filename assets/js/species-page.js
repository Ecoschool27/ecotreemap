// EcoTreeMap — справочник пород (pages/species.html). Строится из data/species.js и data/trees.js.
// Сначала — породы, посаженные в проекте, затем типичные породы озеленения Караганды.
// Поиск по названию и фильтр по типу (дерево/кустарник) работают без перезагрузки страницы.
(function () {
  'use strict';
  var ECO = window.ECO;
  if (!ECO) return;
  // Страховка от смешения версий в кэше браузера (этот файл новее common.js): нет функции — тихая деградация.
  if (typeof ECO.t !== 'function') ECO.t = window.ECO_T || function (k, ru) { return ru; };
  if (typeof ECO.spName !== 'function') ECO.spName = function (sp) { return sp ? sp.name_ru : ''; };
  var el = ECO.el;
  var t = ECO.t || function (k, ru) { return ru; };

  function norm(s) {
    return String(s || '').toLowerCase().replace(/ё/g, 'е');
  }

  function main(data) {
    if (!data.ok) {
      ECO.showFatal(t('common.data_failed', 'Данные не загрузились'), data.errors,
        [{ href: '../index.html', text: t('common.open_map', 'Открыть карту') }]);
      return;
    }
    var content = document.getElementById('content');
    ECO.clear(content);

    var keys = Object.keys(data.species).filter(function (key) {
      // «Другая порода» показывается, только если в реестре есть такие деревья
      return key !== 'other' || data.trees.some(function (tr) { return tr.species === 'other'; });
    });
    var groups = {};
    keys.forEach(function (key) {
      groups[key] = data.trees.filter(function (tr) { return tr.species === key; });
    });
    var planted = keys.filter(function (key) { return groups[key].length > 0; });
    var ordered = planted.concat(keys.filter(function (key) { return !groups[key].length; }));

    content.appendChild(el('p', {
      text: t('species.intro', 'В проекте посажено {n} {treesWord} {n2} {kindsWord}. ' +
        'В справочнике — породы, типичные для озеленения Караганды: {n3}.', {
        n: data.trees.length, treesWord: ECO.treesWord(data.trees.length),
        n2: planted.length, kindsWord: ECO.plural(planted.length, ['породы', 'пород', 'пород']), n3: keys.length
      })
    }));
    content.appendChild(el('p', {
      className: 'muted',
      text: t('species.photo_note', 'Фотографии пока есть только у пород, посаженных в проекте.')
    }));

    // ----- поиск и фильтр -----
    var search = el('input', { type: 'search', attrs: { id: 'species-search', autocomplete: 'off', maxlength: '60' } });
    var typeSel = el('select', { attrs: { id: 'species-type' } }, [
      el('option', { value: '', text: t('species.type_all', 'Все') }),
      el('option', { value: 'дерево', text: t('species.type_tree', 'Деревья') }),
      el('option', { value: 'кустарник', text: t('species.type_shrub', 'Кустарники') })
    ]);
    var counter = el('p', { className: 'summary-line', attrs: { id: 'species-count', 'aria-live': 'polite' } });
    content.appendChild(el('section', { className: 'card species-filter' }, [
      el('label', { attrs: { for: 'species-search' }, text: t('species.search', 'Поиск по названию') }),
      search,
      el('label', { attrs: { for: 'species-type' }, text: t('species.type', 'Тип') }),
      typeSel,
      counter
    ]));
    var empty = el('p', { className: 'note', hidden: true, text: t('species.none', 'Ничего не найдено — измените запрос или тип.') });
    content.appendChild(empty);

    var cards = [];
    ordered.forEach(function (key) {
      var sp = data.species[key];
      var group = groups[key];
      var onMap = group.filter(ECO.hasCoords).length;
      var years = [];
      group.forEach(function (tr) { if (years.indexOf(tr.planted_year) === -1) years.push(tr.planted_year); });
      years.sort();

      var dl = el('dl', { className: 'facts' });
      function fact(label, value) {
        dl.appendChild(el('dt', { text: label }));
        dl.appendChild(typeof value === 'string' ? el('dd', { text: value }) : el('dd', null, [value]));
      }
      if (sp.name_lat) {
        fact(t('species.lat', 'Латинское название'), el('span', null, [
          el('i', { text: sp.name_lat }),
          sp.name_lat_note ? ' (' + sp.name_lat_note + ')' : ''
        ]));
      }
      if (sp.name_kk) fact(t('species.kk', 'По-казахски'), el('span', { attrs: { lang: 'kk' }, text: sp.name_kk }));
      if (sp.type) fact(t('species.type', 'Тип'), sp.type);
      if (group.length) {
        fact(t('species.planted', 'Посажено'), group.length + ' ' + ECO.treesWord(group.length));
        fact(t('species.year', 'Год посадки'), years.join(', '));
        fact(t('species.on_map', 'Отмечено на карте'), onMap + ' ' + t('common.of', 'из') + ' ' + group.length);
      } else {
        fact(t('species.planted', 'Посажено'), t('species.not_planted', 'в проекте пока не сажали'));
      }
      fact(t('species.color', 'Цвет на карте'), el('span', { className: 'dot', style: 'background:' + sp.color, attrs: { 'aria-hidden': 'true' } }));

      var care = sp.care && sp.care_source
        ? el('div', null, [
            el('p', { text: sp.care }),
            el('p', { className: 'muted' }, [
              t('common.source', 'Источник') + ': ',
              ECO.safeUrl(sp.care_source)
                ? el('a', { href: ECO.safeUrl(sp.care_source), text: sp.care_source, attrs: { target: '_blank', rel: 'noopener' } })
                : sp.care_source
            ])
          ])
        : null;

      // фото — только у пород с подтверждённым фото; у остальных — аккуратная цветная плашка без текста
      var photo = ECO.photoFor(sp)
        ? ECO.photoBlock(sp, '../images/')
        : el('div', { className: 'species-noimg', style: 'background:' + sp.color, attrs: { 'aria-hidden': 'true' } }, [
            el('span', { text: String(sp.name_ru || '?').charAt(0) })
          ]);

      var card = el('section', { className: 'card species-card', attrs: { id: key } }, [
        el('h2', { text: sp.name_ru }),
        photo,
        sp.note ? el('p', { className: 'species-note', text: sp.note }) : null,
        dl,
        care ? el('h3', { text: t('species.care', 'Уход') }) : null,
        care,
        group.length ? el('p', { className: 'back-links' }, [
          el('a', {
            href: '../index.html?species=' + encodeURIComponent(key),
            className: 'btn btn--outline',
            text: t('species.on_map_btn', 'Эта порода на карте'),
            attrs: { 'aria-label': t('species.on_map_aria', 'Показать на карте только породу') + ' «' + (ECO.tr || String)(sp.name_ru) + '»' }
          })
        ]) : null
      ]);
      card.setAttribute('data-search', norm([sp.name_ru, sp.name_kk, sp.name_lat].join(' ')));
      card.setAttribute('data-type', sp.type || '');
      cards.push(card);
      content.appendChild(card);
    });
    if (!planted.length) {
      content.insertBefore(el('p', { className: 'note', text: t('species.no_trees', 'Пока нет данных о посадках.') }), content.firstChild);
    }

    function applyFilter() {
      var q = norm(search.value.trim());
      var ty = typeSel.value;
      var shown = 0;
      cards.forEach(function (c) {
        var ok = (!q || c.getAttribute('data-search').indexOf(q) !== -1) &&
          (!ty || c.getAttribute('data-type').indexOf(ty) !== -1);
        c.hidden = !ok;
        if (ok) shown++;
      });
      counter.textContent = t('species.shown', 'Показано пород') + ': ' + shown + ' ' + t('common.of', 'из') + ' ' + cards.length;
      empty.hidden = shown > 0;
    }
    search.addEventListener('input', applyFilter);
    typeSel.addEventListener('change', applyFilter);
    applyFilter();

    // Переход по якорю species.html#lipa после построения страницы.
    if (window.location.hash) {
      var target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
      if (target) target.scrollIntoView();
    }
    window.ECO_PAGE_DONE = true;
  }

  // Данные — асинхронно (онлайн-база или снимок, assets/js/db.js + common.js). Старый common.js без
  // ECO.runPage (смешение версий в кэше) — синхронно из снимка, как раньше.
  if (typeof ECO.runPage === 'function') {
    ECO.runPage(main, 'Ошибка на странице пород', [{ href: '../index.html', text: 'Открыть карту' }]);
  } else {
    try {
      main(ECO.loadData());
    } catch (e) {
      ECO.showFatal('Ошибка на странице пород', [String(e && e.message ? e.message : e)], [{ href: '../index.html', text: 'Открыть карту' }]);
    }
  }
})();
