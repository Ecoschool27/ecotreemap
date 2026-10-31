// EcoTreeMap — паспорт дерева (pages/tree.html?id=L-001).
(function () {
  'use strict';
  var ECO = window.ECO;
  if (!ECO) return;
  // Страховка от смешения версий в кэше браузера (этот файл новее common.js): нет функции — тихая деградация.
  if (typeof ECO.t !== 'function') ECO.t = window.ECO_T || function (k, ru) { return ru; };
  if (typeof ECO.spName !== 'function') ECO.spName = function (sp) { return sp ? sp.name_ru : ''; };
  if (typeof ECO.lastWatered !== 'function') ECO.lastWatered = function () { return null; };
  if (typeof ECO.obsPhotoPath !== 'function') ECO.obsPhotoPath = function () { return null; };
  if (typeof ECO.patronOf !== 'function') ECO.patronOf = function () { return ''; };
  if (typeof ECO.photoHistory !== 'function') ECO.photoHistory = function () { return []; };
  var el = ECO.el;

  function notFound(title, text) {
    var content = document.getElementById('content');
    ECO.clear(content);
    content.appendChild(el('section', { className: 'card', attrs: { role: 'alert' } }, [
      el('h1', { text: title }),
      el('p', { text: text }),
      el('p', { className: 'back-links' }, [
        el('a', { href: '../index.html', className: 'btn btn--primary', text: 'Открыть карту деревьев' }),
        el('a', { href: 'species.html', className: 'btn btn--outline', text: 'Породы' })
      ])
    ]));
    document.title = title + ' — EcoTreeMap';
    window.ECO_PAGE_DONE = true;
  }

  function fact(dl, label, value) {
    dl.appendChild(el('dt', { text: label }));
    dl.appendChild(typeof value === 'string' ? el('dd', { text: value }) : el('dd', null, [value]));
  }

  function main() {
    var data = ECO.loadData();
    if (!data.ok) {
      ECO.showFatal('Данные о деревьях не загрузились', data.errors, [{ href: '../index.html', text: 'Открыть карту' }]);
      return;
    }

    var id = new URLSearchParams(window.location.search).get('id');
    if (id === null || id.trim() === '') {
      notFound('Номер дерева не указан', 'В ссылке нет номера дерева. Выберите дерево на карте или в списке.');
      return;
    }
    id = id.trim();
    var tree = ECO.byId(data, id);
    if (!tree) {
      var shown = id.length > 40 ? id.slice(0, 40) + '…' : id;
      notFound('Дерево не найдено', 'Дерева с номером «' + shown + '» нет в списке посадок. Проверьте номер на табличке или откройте карту.');
      return;
    }

    var sp = ECO.speciesOf(data, tree);
    document.title = 'Дерево ' + tree.id + ' — ' + sp.name_ru + ' — EcoTreeMap';
    var content = document.getElementById('content');
    ECO.clear(content);

    // ----- основная карточка -----
    var dl = el('dl', { className: 'facts' });
    fact(dl, 'Порода', el('a', { href: 'species.html#' + encodeURIComponent(tree.species), text: sp.name_ru }));
    var plantedDate = ECO.formatDate(tree.planted_date);
    if (plantedDate) fact(dl, 'Дата посадки', plantedDate);
    else fact(dl, 'Год посадки', String(tree.planted_year));
    fact(dl, 'Лет с посадки', ECO.yearsSincePlanting(tree.planted_year, null, tree.planted_date));
    fact(dl, 'Акция', tree.event ? String(tree.event) : 'уточняется');
    var statusDate = tree.status ? ECO.formatDate(tree.status_date) : null;
    fact(dl, 'Состояние', ECO.statusLabel(tree.status) + (statusDate ? ' (осмотр ' + statusDate + ')' : ''));
    var lastWater = ECO.lastWatered(tree);
    fact(dl, 'Последний полив', lastWater ? ECO.formatDate(lastWater) : 'Полив ещё не отмечен');
    var email = ECO.contactEmail();
    var patron = ECO.patronOf(tree);
    if (patron) {
      var since = ECO.formatDate(tree.patron_since);
      fact(dl, 'Шефство', 'Под опекой: ' + patron + (since ? ' (с ' + since + ')' : ''));
    } else {
      fact(dl, 'Шефство', el('span', null, [
        'Ищет опекуна — ',
        email ? el('a', { href: 'mailto:' + email + '?subject=' + encodeURIComponent('Шефство над деревом ' + tree.id),
          text: 'напишите координатору' }) : 'напишите координатору'
      ]));
    }
    if (ECO.hasCoords(tree)) {
      // точность — только для точек по GPS; gps-low (зафиксировано при плохом сигнале) помечается «приблизительно»
      var gpsLike = tree.coord_source === 'gps' || tree.coord_source === 'gps-low';
      var acc = gpsLike && typeof tree.coord_accuracy_m === 'number' && isFinite(tree.coord_accuracy_m) && tree.coord_accuracy_m >= 0
        ? Math.round(tree.coord_accuracy_m) : null;
      var precision = (tree.coord_source === 'gps-low' ? 'приблизительно' : '') +
        (acc !== null ? (tree.coord_source === 'gps-low' ? ', ' : '') + 'точность ±' + acc + ' м' : '');
      fact(dl, 'Место', el('span', null, [
        tree.lat.toFixed(6) + ', ' + tree.lon.toFixed(6) + (precision ? ' (' + precision + ')' : '') + ' · ',
        el('a', { href: '../index.html?focus=' + encodeURIComponent(tree.id), text: 'показать на карте' })
      ]));
    } else {
      fact(dl, 'Место', 'не отмечено на карте');
    }

    var main = el('section', { className: 'card' }, [
      el('h1', { text: 'Дерево ' + tree.id }),
      el('p', { style: 'margin:0' }, [
        el('span', { className: 'chip', style: 'background:' + sp.color, text: sp.name_ru }),
        sp.name_lat ? ' ' : '',
        sp.name_lat ? el('i', { text: sp.name_lat }) : ''
      ]),
      dl
    ]);
    if (tree.notes) main.appendChild(el('p', { className: 'note', text: String(tree.notes) }));
    content.appendChild(main);

    // ----- фото: своё фото дерева приоритетнее фото породы; при 2+ фото — «было → стало» и лента по датам -----
    var history = ECO.photoHistory(tree);
    var cfg = window.ECO_CONFIG || {};
    var credit = typeof cfg.TREE_PHOTO_CREDIT === 'string' && cfg.TREE_PHOTO_CREDIT.trim()
      ? cfg.TREE_PHOTO_CREDIT.trim() : 'Фото: участники проекта EcoTreeMap';
    function histFigure(h, label) {
      var date = ECO.formatDate(h.date);
      var img = el('img', { attrs: { src: '../images/' + h.path, alt: 'Дерево ' + tree.id + (date ? ', ' + date : ''), loading: 'lazy' } });
      var fig = el('figure', { className: 'photo photo--tree', style: 'margin:0' }, [
        img,
        el('figcaption', { className: 'photo-credit', text: (label ? label + ': ' : '') + (date || 'дата не указана') +
          (h.status ? ' — ' + ECO.statusLabel(h.status) : '') })
      ]);
      img.addEventListener('error', function () { if (fig.parentNode) fig.parentNode.removeChild(fig); });
      return fig;
    }
    var photoCard;
    if (history.length >= 2) {
      var first = history[history.length - 1];
      var last = history[0];
      var strip = el('div', { className: 'photo-strip', attrs: { role: 'list', 'aria-label': 'Все фото дерева по датам, новые первыми' } });
      history.forEach(function (h) { strip.appendChild(el('div', { attrs: { role: 'listitem' } }, [histFigure(h)])); });
      photoCard = el('section', { className: 'card' }, [
        el('h2', { text: 'Фото дерева' }),
        el('h3', { text: 'Было → стало' }),
        el('div', { className: 'before-after' }, [histFigure(first, 'Было'), histFigure(last, 'Стало')]),
        el('h3', { text: 'Все фото по датам (' + history.length + ')' }),
        strip,
        el('p', { className: 'photo-credit', text: credit })
      ]);
    } else {
      var treePhoto = ECO.treePhotoBlock(tree, sp, '../images/');
      photoCard = el('section', { className: 'card' }, [
        el('h2', { text: treePhoto ? 'Фото дерева' : 'Фото' }),
        treePhoto || ECO.photoBlock(sp, '../images/')
      ]);
    }
    content.appendChild(photoCard);

    // ----- история осмотров (до 10, новые сверху) -----
    var obs = Array.isArray(tree.observations) ? tree.observations.filter(function (o) {
      return o && typeof o === 'object' && ECO.parseDate(o.date);
    }) : [];
    obs.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    if (obs.length) {
      var ol = el('ul', { className: 'tree-observations' });
      obs.slice(0, 10).forEach(function (o) {
        var parts = [ECO.formatDate(o.date) + ': '];
        parts.push(o.status ? ECO.statusLabel(o.status) : o.watered === true ? '' : 'состояние не указано');
        if (o.watered === true) parts.push((o.status ? '; ' : '') + 'полито');
        if (ECO.obsPhotoPath(tree, o)) parts.push('; фото');
        if (o.notes) parts.push(' — ' + String(o.notes).slice(0, 500));
        ol.appendChild(el('li', { text: parts.join('') }));
      });
      content.appendChild(el('section', { className: 'card' }, [el('h2', { text: 'История осмотров' }), ol]));
    }

    // ----- уход -----
    var careCard = el('section', { className: 'card' }, [el('h2', { text: 'Уход за породой «' + sp.name_ru + '»' })]);
    if (sp.care && sp.care_source) {
      careCard.appendChild(el('p', { text: sp.care }));
      var srcUrl = ECO.safeUrl(sp.care_source);
      careCard.appendChild(el('p', { className: 'muted' }, [
        'Источник: ',
        srcUrl ? el('a', { href: srcUrl, text: sp.care_source, attrs: { target: '_blank', rel: 'noopener' } }) : sp.care_source
      ]));
    } else {
      careCard.appendChild(el('p', { className: 'muted', text: 'Рекомендации по уходу будут добавлены после проверки по источнику.' }));
    }
    content.appendChild(careCard);

    // ----- полив: отметка — запись осмотра в полевом режиме, видна всем после добавления координатором -----
    content.appendChild(el('section', { className: 'card', attrs: { id: 'water' } }, [
      el('h2', { text: 'Полив' }),
      el('p', { text: lastWater ? 'Последний полив: ' + ECO.formatDate(lastWater) : 'Полив ещё не отмечен.' }),
      el('a', {
        href: '../tools/field.html?id=' + encodeURIComponent(tree.id) + '&action=water',
        className: 'btn btn--water btn--block',
        text: 'Полил(а) это дерево'
      }),
      el('p', { className: 'muted', text: 'Кнопка открывает полевой режим для этого дерева. Отметка появится на сайте ' +
        'после выгрузки и добавления координатором.' }),
      // посетитель без полевого режима: отметки ведут волонтёры, посетитель сообщает координатору (без localStorage)
      el('p', { className: 'muted', attrs: { id: 'water-visitor' } }, [
        'Отметки собирают волонтёры проекта в полевом режиме; если вы полили дерево — ',
        email ? el('a', { href: 'mailto:' + email + '?subject=' + encodeURIComponent('Полив дерева ' + tree.id),
          text: 'сообщите координатору' }) : 'сообщите координатору',
        '.'
      ])
    ]));

    // ----- сообщить о проблеме -----
    var typeSelect = el('select', { attrs: { id: 'problem-type', name: 'problem-type' } },
      ['Сухие или сломанные ветви', 'Нужен полив', 'Признаки болезни или вредителей', 'Повреждён ствол', 'Другое'].map(function (o) {
        return el('option', { value: o, text: o });
      }));
    var textArea = el('textarea', { attrs: { id: 'problem-text', name: 'problem-text', rows: '3', maxlength: '1000' } });
    var reportResult = el('div', { className: 'result', attrs: { role: 'status' }, hidden: true });
    var reportBtn = el('button', {
      type: 'submit',
      className: 'btn btn--danger btn--block',
      text: 'Отправить сообщение'
    });
    var form = el('form', null, [
      el('label', { attrs: { for: 'problem-type' }, text: 'Что случилось' }),
      typeSelect,
      el('label', { attrs: { for: 'problem-text' }, text: 'Описание (необязательно)' }),
      textArea,
      el('div', { style: 'margin-top:12px' }, [reportBtn]),
      reportResult
    ]);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var started = ECO.openMail(
        'Паспорт дерева: проблема с деревом ' + tree.id,
        'Дерево ' + tree.id + ' (' + sp.name_ru + ')\nЧто случилось: ' + typeSelect.value +
          '\nОписание: ' + textArea.value + '\n\nОтправлено со страницы паспорта дерева.'
      );
      if (started) {
        reportResult.className = 'result';
        reportResult.textContent = 'Открываем почтовую программу — проверьте письмо и нажмите «Отправить». Спасибо!';
      } else {
        reportResult.className = 'result result--demo';
        reportResult.textContent = 'Демо: адрес координатора не задан — сообщение не отправлено.';
      }
      reportResult.hidden = false;
    });
    content.appendChild(el('section', { className: 'card' }, [
      el('h2', { text: 'Сообщить о проблеме' }),
      email ? null : el('p', { className: 'note', text: 'Демо-режим: адрес координатора пока не задан, письма не отправляются.' }),
      form
    ]));

    // ----- поделиться -----
    if (ECO.shareSection) content.appendChild(ECO.shareSection(tree, sp));

    // ----- QR-код -----
    var qrBox = el('div', { className: 'qr' });
    var qrImg = el('img', { attrs: { src: '../qr/' + encodeURIComponent(tree.id) + '.png', alt: 'QR-код паспорта дерева ' + tree.id } });
    qrImg.addEventListener('error', function () {
      ECO.clear(qrBox).appendChild(el('p', { className: 'muted', text: 'QR-код для таблички ещё не создан.' }));
    });
    qrBox.appendChild(qrImg);
    content.appendChild(el('section', { className: 'card' }, [el('h2', { text: 'QR-код для таблички' }), qrBox]));

    content.appendChild(el('p', { className: 'back-links' }, [
      el('a', { href: '../index.html', className: 'btn btn--outline', text: '← К карте' }),
      el('a', { href: 'species.html', className: 'btn btn--outline', text: 'Все породы' })
    ]));

    window.ECO_PAGE_DONE = true;
  }

  try {
    main();
  } catch (e) {
    ECO.showFatal('Ошибка на странице паспорта', [String(e && e.message ? e.message : e)], [{ href: '../index.html', text: 'Открыть карту' }]);
  }
})();
