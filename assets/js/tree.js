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
  if (typeof ECO.dataSpan !== 'function') ECO.dataSpan = function (s, c) { return ECO.el('span', { className: c, text: String(s), attrs: { 'data-i18n-skip': '' } }); };
  if (typeof ECO.speciesFromNote !== 'function') ECO.speciesFromNote = function () { return false; };
  if (typeof ECO.speciesNameNode !== 'function') ECO.speciesNameNode = function (t, sp) { return sp.name_ru; };
  if (typeof ECO.tData !== 'function') ECO.tData = function (k, ru, p) {
    return [ru.replace(/\{([a-z0-9]+)\}/gi, function (a, n) { var v = p && p[n]; return v == null ? a : v.nodeType ? v.textContent : String(v); })];
  };
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

  // Одобренные фото из онлайн-базы: адрес обязан быть нашим публичным (ECO.DB.isPublicPhotoUrl), иначе фото нет.
  function remotePhotos(tree) {
    var DB = ECO.DB;
    if (!tree || !Array.isArray(tree.remote_photos) || !DB || typeof DB.isPublicPhotoUrl !== 'function') return [];
    return tree.remote_photos.filter(function (p) { return p && DB.isPublicPhotoUrl(p.url); }).map(function (p) {
      return { url: p.url, date: ECO.parseDate(p.date) ? p.date : null, status: null };
    });
  }

  // Опека для вошедшей ПОДТВЕРЖДЁННОЙ команды: «Взять под опеку» → заявка ждёт модератора → «Отказаться».
  // Только при данных из онлайн-базы. Клиент с сессией — лишь для этих действий; публичная отрисовка страницы —
  // по-прежнему анонимным чтением (ECO.loadDataAsync). Посетителю без входа блок не показывается.
  function patronageBox(tree, data) {
    var DB = ECO.DB;
    if (!data || data.source !== 'supabase' || !DB || typeof DB.loadTeamProfile !== 'function' || !DB.enabled()) return null;
    var box = el('section', { className: 'card', hidden: true, attrs: { id: 'patronage' } });
    var msg = el('p', { className: 'acc-msg', hidden: true, attrs: { id: 'patronage-msg', role: 'status', 'aria-live': 'polite' } });
    var body = el('div', { attrs: { id: 'patronage-body' } });
    box.appendChild(el('h2', { text: 'Опека команды' }));
    box.appendChild(body);
    box.appendChild(msg);
    var profile = null;
    var busy = false;

    function say(text, kind) {
      msg.textContent = text || '';
      msg.className = 'acc-msg' + (kind ? ' acc-msg--' + kind : '');
      msg.hidden = !text;
    }
    function warn(e) {
      if (window.console) console.warn('[EcoTreeMap] опека: ' + String(e && (e.code || e.name) || 'ошибка'));
    }
    function button(id, text, cls, onClick) {
      var b = el('button', { type: 'button', className: 'btn ' + cls, text: text, attrs: { id: id } });
      b.addEventListener('click', function () {
        if (busy) return;
        busy = true;
        b.disabled = true;
        say('');
        Promise.resolve().then(onClick).then(null, function (e) {
          warn(e);
          say(DB.errorText(e), 'error');
        }).then(function () { busy = false; b.disabled = false; });
      });
      return b;
    }
    function ownRow() {
      return DB.session().from('patronage').select('id,status')
        .eq('tree_id', tree.id).eq('team_id', profile.team.id).in('status', ['pending', 'approved'])
        .order('requested_at', { ascending: false }).limit(1)
        .then(function (res) {
          if (res.error) throw res.error;
          return res.data && res.data[0] ? res.data[0] : null;
        });
    }
    function render(row) {
      ECO.clear(body);
      // название команды — данные: отдельным узлом без перевода (ECO.tData), текст вокруг — на языке страницы
      var team = function () { return el('span', null, ['«', ECO.dataSpan(profile.team.name), '»']); };
      if (row && row.status === 'approved') {
        body.appendChild(el('p', { attrs: { id: 'patronage-state', 'data-state': 'approved' } },
          ECO.tData('tree.pat_yours', 'Ваша команда {x} опекает это дерево.', { x: team() })));
      } else if (row) {
        body.appendChild(el('p', { attrs: { id: 'patronage-state', 'data-state': 'pending' } },
          ECO.tData('tree.pat_pending', 'Заявка команды {x} на опеку ждёт модератора.', { x: team() })));
      } else if (ECO.patronOf(tree)) {
        box.hidden = true; // у дерева уже есть шеф — кнопки нет
        return;
      } else {
        body.appendChild(el('p', { attrs: { id: 'patronage-state', 'data-state': 'none' } },
          ECO.tData('tree.pat_can', 'Команда {x} может взять это дерево под опеку: поливать, осматривать и отмечать состояние.',
            { x: team() }).concat([' Заявку подтверждает модератор.'])));
        body.appendChild(el('p', { className: 'acc-actions' }, [
          button('patronage-take', 'Взять под опеку', 'btn--primary', function () {
            return DB.session().from('patronage').insert({ tree_id: tree.id, status: 'pending' }).then(function (res) {
              if (res.error && res.error.code !== '23505') throw res.error; // 23505 — заявка уже есть (повтор)
              return refresh('Заявка отправлена. Опека начнётся после подтверждения модератором.');
            });
          })
        ]));
        box.hidden = false;
        return;
      }
      body.appendChild(el('p', { className: 'acc-actions' }, [
        button('patronage-end', row.status === 'approved' ? 'Отказаться от опеки' : 'Отозвать заявку', 'btn--outline', function () {
          if (!window.confirm((ECO.tr || String)(row.status === 'approved' ? 'Отказаться от опеки дерева ' + tree.id + '?'
            : 'Отозвать заявку на опеку дерева ' + tree.id + '?'))) return null;
          var was = row.status;
          return DB.session().from('patronage').update({ status: 'ended' }).eq('id', row.id).then(function (res) {
            if (res.error) throw res.error;
            return refresh(was === 'approved' ? 'Опека завершена. Строка «Под опекой» на странице обновится после перезагрузки.'
              : 'Заявка отозвана.', was === 'approved');
          });
        })
      ]));
      box.hidden = false;
    }
    // Шеф дерева по свежему публичному чтению (после отказа от опеки у дерева может остаться групповой или
    // исторический шеф — его нельзя «сбросить» локально). Нет онлайн-данных — null (кнопку не показываем).
    function freshPatron() {
      return ECO.loadDataAsync().then(function (d) {
        if (!d || !d.ok || d.source !== 'supabase') return null;
        var t = ECO.byId(d, tree.id);
        return t ? { patron: t.patron, patron_since: t.patron_since } : null;
      });
    }
    function refresh(text, ended) {
      return ownRow().then(function (row) {
        if (!ended || row) return row;
        // Своя опека только что завершена: строка «Под опекой» на странице обновится при перезагрузке,
        // а кнопку решаем по свежим данным — групповой/исторический шеф остаётся шефом.
        return freshPatron().then(function (f) {
          if (f) tree = Object.assign({}, tree, f); // нет свежих данных — шеф прежний, кнопка не появляется
          return null;
        });
      }).then(function (row) {
        render(row);
        if (text) {
          say(text);
          box.hidden = false; // итог действия виден, даже если кнопки у дерева с другим шефом нет
        }
      });
    }

    // data-ready="1" — проверка входа и своей заявки завершена (блок показан или остался скрытым)
    DB.loadTeamProfile().then(function (p) {
      if (!p || p.role !== 'team' || !p.team || p.team.status !== 'approved') return null;
      profile = p;
      return refresh('');
    }).then(null, warn).then(function () { box.setAttribute('data-ready', '1'); });
    return box;
  }

  function main(data) {
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
    fact(dl, 'Порода', el('a', { href: 'species.html#' + encodeURIComponent(tree.species) }, [ECO.speciesNameNode(tree, sp)]));
    var plantedDate = ECO.formatDate(tree.planted_date);
    if (plantedDate) fact(dl, 'Дата посадки', plantedDate);
    else fact(dl, 'Год посадки', String(tree.planted_year));
    fact(dl, 'Лет с посадки', ECO.yearsSincePlanting(tree.planted_year, null, tree.planted_date));
    fact(dl, 'Акция', tree.event ? ECO.dataSpan(tree.event) : 'уточняется');
    var statusDate = tree.status ? ECO.formatDate(tree.status_date) : null;
    fact(dl, 'Состояние', ECO.statusLabel(tree.status) + (statusDate ? ' (осмотр ' + statusDate + ')' : ''));
    var lastWater = ECO.lastWatered(tree);
    fact(dl, 'Последний полив', lastWater ? ECO.formatDate(lastWater) : 'Полив ещё не отмечен');
    var email = ECO.contactEmail();
    var patron = ECO.patronOf(tree);
    if (patron) {
      var since = ECO.formatDate(tree.patron_since);
      // шеф — название команды/группы (данные), дата — интерфейс (переводится как текстовый узел)
      fact(dl, 'Шефство', el('span', null, since
        ? ECO.tData('tree.patron_since', 'Под опекой: {x} (с {date})', { x: patron, date: document.createTextNode(since) })
        : ECO.tData('map.popup_patron', 'Под опекой: {x}', { x: patron })));
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
        el('span', { className: 'chip', style: 'background:' + sp.color }, [ECO.speciesNameNode(tree, sp)]),
        sp.name_lat ? ' ' : '',
        sp.name_lat ? el('i', { text: sp.name_lat }) : ''
      ]),
      dl
    ]);
    if (tree.notes) main.appendChild(el('p', { className: 'note', text: String(tree.notes), attrs: { 'data-i18n-skip': '' } }));
    content.appendChild(main);
    var patBox = patronageBox(tree, data);
    if (patBox) content.appendChild(patBox);

    // ----- фото: своё фото дерева приоритетнее фото породы; при 2+ фото — «было → стало» и лента по датам -----
    // одобренные фото из онлайн-базы (только наш публичный бакет, проверка адреса — ECO.DB.isPublicPhotoUrl)
    var remote = remotePhotos(tree);
    var history = ECO.photoHistory(tree);
    if (remote.length) {
      history = history.concat(remote);
      // новые первыми; за один день порядок прежний (сортировка устойчивая)
      history.sort(function (a, b) { var da = a.date || '', db = b.date || ''; return da < db ? 1 : da > db ? -1 : 0; });
    }
    var cfg = window.ECO_CONFIG || {};
    var credit = typeof cfg.TREE_PHOTO_CREDIT === 'string' && cfg.TREE_PHOTO_CREDIT.trim()
      ? cfg.TREE_PHOTO_CREDIT.trim() : 'Фото: участники проекта EcoTreeMap';
    function histFigure(h, label) {
      var date = ECO.formatDate(h.date);
      var img = el('img', { attrs: { src: h.url || '../images/' + h.path, alt:'Дерево ' + tree.id + (date ? ', ' + date : ''), loading: 'lazy' } });
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
    } else if (history.length === 1 && history[0].url) {
      photoCard = el('section', { className: 'card' }, [
        el('h2', { text: 'Фото дерева' }),
        histFigure(history[0]),
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
      // Строка истории собирается из узлов: дата, состояние, «полито», «фото» и «(команда «…»)» — интерфейс
      // (переводится), заметка и название команды — данные (ECO.dataSpan, без перевода).
      obs.slice(0, 10).forEach(function (o) {
        var li = el('li');
        li.appendChild(el('span', { className: 'obs-date', text: ECO.formatDate(o.date) }));
        li.appendChild(document.createTextNode(': '));
        var what = [];
        if (o.status) what.push(ECO.statusLabel(o.status));
        else if (o.watered !== true) what.push('состояние не указано');
        if (o.watered === true) what.push('полито');
        if (ECO.obsPhotoPath(tree, o)) what.push('фото');
        what.forEach(function (w, i) {
          if (i) li.appendChild(document.createTextNode('; '));
          li.appendChild(el('span', { className: 'obs-what', text: w }));
        });
        if (o.notes) {
          li.appendChild(document.createTextNode(' — '));
          li.appendChild(ECO.dataSpan(String(o.notes).slice(0, 500), 'obs-note'));
        }
        if (typeof o.team === 'string' && o.team) {
          li.appendChild(document.createTextNode(' '));
          li.appendChild(el('span', { className: 'obs-team' },
            ECO.tData('tree.obs_team', '(команда «{x}»)', { x: ECO.dataSpan(o.team.slice(0, 60), 'obs-team-name') })));
        }
        ol.appendChild(li);
      });
      content.appendChild(el('section', { className: 'card' }, [el('h2', { text: 'История осмотров' }), ol]));
    }

    // ----- уход -----
    var careCard = el('section', { className: 'card' }, [el('h2', null, ECO.tData('tree.care', 'Уход за породой «{x}»',
      { x: ECO.speciesFromNote(tree) ? sp.name_ru : document.createTextNode(sp.name_ru) }))]);
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

  // Данные — асинхронно (онлайн-база или снимок, assets/js/db.js + common.js). Старый common.js без
  // ECO.runPage (смешение версий в кэше) — синхронно из снимка, как раньше.
  if (typeof ECO.runPage === 'function') {
    ECO.runPage(main, 'Ошибка на странице паспорта', [{ href: '../index.html', text: 'Открыть карту' }]);
  } else {
    try {
      main(ECO.loadData());
    } catch (e) {
      ECO.showFatal('Ошибка на странице паспорта', [String(e && e.message ? e.message : e)], [{ href: '../index.html', text: 'Открыть карту' }]);
    }
  }
})();
