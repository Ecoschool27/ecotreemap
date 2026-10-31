// EcoTreeMap — паспорт дерева (pages/tree.html?id=L-001).
(function () {
  'use strict';
  var ECO = window.ECO;
  if (!ECO) return;
  var el = ECO.el;

  var WATER_KEY_PREFIX = 'ecotreemap_watered_';

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

  function formatWaterDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var days = Math.floor((Date.now() - d.getTime()) / 86400000);
    var when = days <= 0 ? 'сегодня' : days === 1 ? 'вчера' : days + ' ' + ECO.plural(days, ['день', 'дня', 'дней']) + ' назад';
    return when + ' (' + d.toLocaleDateString('ru-RU') + ')';
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

    // ----- фото: своё фото дерева приоритетнее фото породы -----
    var treePhoto = ECO.treePhotoBlock(tree, sp, '../images/');
    content.appendChild(el('section', { className: 'card' }, [
      el('h2', { text: treePhoto ? 'Фото дерева' : 'Фото' }),
      treePhoto || ECO.photoBlock(sp, '../images/')
    ]));

    // ----- история осмотров (до 10, новые сверху) -----
    var obs = Array.isArray(tree.observations) ? tree.observations.filter(function (o) {
      return o && typeof o === 'object' && ECO.parseDate(o.date);
    }) : [];
    obs.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    if (obs.length) {
      var ol = el('ul', { className: 'tree-observations' });
      obs.slice(0, 10).forEach(function (o) {
        var parts = [ECO.formatDate(o.date) + ': '];
        parts.push(o.status ? ECO.statusLabel(o.status) : 'состояние не указано');
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

    // ----- полив -----
    var email = ECO.contactEmail();
    var waterStatus = el('p', { attrs: { 'aria-live': 'polite' } });
    var waterResult = el('div', { className: 'result', attrs: { role: 'status' }, hidden: true });
    function renderWater() {
      var last = ECO.storageGet(WATER_KEY_PREFIX + tree.id);
      var text = last && formatWaterDate(last);
      waterStatus.textContent = text
        ? 'На этом устройстве последняя отметка полива: ' + text + '.'
        : 'На этом устройстве отметок полива этого дерева нет.';
    }
    var waterBtn = el('button', {
      type: 'button',
      className: 'btn btn--water btn--block',
      text: 'Я полил(а) это дерево сегодня',
      onclick: function () {
        var saved = ECO.storageSet(WATER_KEY_PREFIX + tree.id, new Date().toISOString());
        renderWater();
        var msg = saved ? 'Отметка сохранена на этом устройстве. ' : 'Браузер не разрешил сохранить отметку на устройстве. ';
        if (email) {
          ECO.openMail(
            'Паспорт дерева: полив ' + tree.id,
            'Дерево ' + tree.id + ' (' + sp.name_ru + ') полито ' + new Date().toLocaleString('ru-RU') + '.\n\nОтправлено со страницы паспорта дерева.'
          );
          waterResult.className = 'result';
          waterResult.textContent = msg + 'Открываем почтовую программу — отправьте письмо координатору. Спасибо!';
        } else {
          waterResult.className = 'result result--demo';
          waterResult.textContent = msg + 'Демо: адрес координатора не задан, поэтому координатору ничего не отправлено.';
        }
        waterResult.hidden = false;
      }
    });
    content.appendChild(el('section', { className: 'card' }, [
      el('h2', { text: 'Полив' }),
      el('p', { className: 'muted', text: 'Отметки полива хранятся только на этом устройстве (в браузере) — другие люди их не видят.' }),
      waterBtn,
      waterStatus,
      waterResult
    ]));
    renderWater();

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
