// EcoTreeMap — общие функции страниц. Весь пользовательский/внешний текст выводится через
// textContent (функция ECO.el), innerHTML с данными не используется.
(function () {
  'use strict';

  var ECO = (window.ECO = window.ECO || {});

  // ---------- построение DOM без innerHTML ----------
  // ECO.el('a', {href: '...', className: 'x', text: 'подпись', attrs: {'aria-label': '...'}}, [дети])
  ECO.el = function (tag, props, children) {
    var node = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (key) {
      var value = props[key];
      if (value === undefined || value === null) return;
      if (key === 'text') node.textContent = String(value);
      else if (key === 'className') node.className = value;
      else if (key === 'attrs') {
        Object.keys(value).forEach(function (a) {
          if (value[a] !== undefined && value[a] !== null) node.setAttribute(a, String(value[a]));
        });
      } else if (key === 'style') node.setAttribute('style', value);
      else if (key.indexOf('on') === 0 && typeof value === 'function') {
        node.addEventListener(key.slice(2), value);
      } else node[key] = value;
    });
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  };

  ECO.clear = function (node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  };

  // Ссылки из данных (источники фото и т.п.) — только http/https, иначе null.
  ECO.safeUrl = function (url) {
    if (typeof url !== 'string' || !url) return null;
    try {
      var u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch (e) {
      return null;
    }
  };

  // ---------- склонение ----------
  // forms: ['год', 'года', 'лет']
  ECO.plural = function (n, forms) {
    var a = Math.abs(n) % 100;
    var b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b === 1) return forms[0];
    if (b >= 2 && b <= 4) return forms[1];
    return forms[2];
  };

  // Дата посадки 'ГГГГ-ММ-ДД' → {y, m, d} или null.
  ECO.parseDate = function (s) {
    var m = typeof s === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return { y: y, m: mo, d: d };
  };

  var MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  ECO.formatDate = function (s) {
    var p = ECO.parseDate(s);
    return p ? p.d + ' ' + MONTHS_GEN[p.m - 1] + ' ' + p.y + ' г.' : null;
  };

  // «Лет с посадки». Если известна дата — считаем полные годы; если только год — разницу календарных лет
  // со знаком «≈» (без даты точный возраст неизвестен: он может быть на год меньше).
  // now — необязательная дата «сегодня» (Date), для проверок.
  ECO.yearsSincePlanting = function (plantedYear, now, plantedDate) {
    if (typeof now === 'number') now = new Date(now, 11, 31); // совместимость: передан год
    if (!(now instanceof Date)) now = new Date();
    var cy = now.getFullYear();
    var diff;
    var p = ECO.parseDate(plantedDate);
    if (p) {
      diff = cy - p.y;
      var beforeAnniversary = now.getMonth() + 1 < p.m || (now.getMonth() + 1 === p.m && now.getDate() < p.d);
      if (beforeAnniversary) diff--;
      if (diff <= 0) return cy === p.y || diff < 0 ? 'посажено в этом году' : 'меньше года';
    } else {
      diff = cy - plantedYear;
    }
    if (!(diff > 0)) return 'посажено в этом году';
    return (p ? '' : '≈ ') + diff + ' ' + ECO.plural(diff, ['год', 'года', 'лет']);
  };

  ECO.treesWord = function (n) {
    return ECO.plural(n, ['дерево', 'дерева', 'деревьев']);
  };

  // ---------- состояние дерева ----------
  // Словарь состояний (ключи совпадают с tools/merge_field.py и tools/field.html).
  var STATUS_LABELS = {
    healthy: 'здоровое',
    needs_water: 'нужен полив',
    needs_check: 'требуется осмотр',
    damaged: 'повреждено',
    sick: 'болеет',
    dead: 'засохло/погибло'
  };
  ECO.STATUS_KEYS = Object.keys(STATUS_LABELS);
  ECO.hasOwn = function (obj, key) {
    return obj !== null && obj !== undefined && Object.prototype.hasOwnProperty.call(obj, key);
  };
  ECO.statusLabel = function (status) {
    if (status === null || status === undefined || status === '') return 'нет данных (не обследовано)';
    return ECO.hasOwn(STATUS_LABELS, status) ? STATUS_LABELS[status] : String(status);
  };
  // Номер дерева: буква породы, дефис, 3–4 цифры (L-001). Используется для ссылок и черновиков.
  ECO.ID_RE = /^[A-Z]-\d{3}$/;

  // ---------- данные ----------
  ECO.hasCoords = function (t) {
    return (
      t &&
      typeof t.lat === 'number' &&
      typeof t.lon === 'number' &&
      isFinite(t.lat) &&
      isFinite(t.lon) &&
      t.lat >= -90 &&
      t.lat <= 90 &&
      t.lon >= -180 &&
      t.lon <= 180
    );
  };

  // Проверяет data/trees.js и data/species.js. Возвращает {ok, trees, species, errors, warnings}.
  ECO.loadData = function () {
    var errors = [];
    var warnings = [];
    var trees = window.ECO_TREES;
    var species = window.ECO_SPECIES;
    if (!Array.isArray(trees)) errors.push('Не загрузился файл data/trees.js (список деревьев).');
    if (!species || typeof species !== 'object') errors.push('Не загрузился файл data/species.js (справочник пород).');
    if (errors.length) return { ok: false, trees: [], species: {}, errors: errors, warnings: warnings };

    var seen = Object.create(null);
    var clean = [];
    trees.forEach(function (t, i) {
      if (!t || typeof t.id !== 'string' || !t.id) {
        warnings.push('Запись №' + (i + 1) + ' без номера пропущена.');
        return;
      }
      if (seen[t.id]) {
        warnings.push('Номер ' + t.id + ' повторяется — второй экземпляр пропущен.');
        return;
      }
      seen[t.id] = true;
      if (!species[t.species]) warnings.push('У дерева ' + t.id + ' неизвестная порода «' + t.species + '».');
      if ((t.lat !== null || t.lon !== null) && !ECO.hasCoords(t)) {
        warnings.push('У дерева ' + t.id + ' некорректные координаты — считается неотмеченным.');
      }
      // мягкая проверка полей полевого режима: некорректное значение не показывается, запись остаётся
      if (t.status !== null && t.status !== undefined && !ECO.hasOwn(STATUS_LABELS, t.status)) {
        warnings.push('У дерева ' + t.id + ' неизвестное состояние «' + String(t.status).slice(0, 30) + '».');
      }
      if (t.photo !== null && t.photo !== undefined && !ECO.treePhotoPath(t)) {
        warnings.push('У дерева ' + t.id + ' некорректный путь к фото — фото не показывается.');
      }
      if (t.observations !== undefined && t.observations !== null && !Array.isArray(t.observations)) {
        warnings.push('У дерева ' + t.id + ' история осмотров не списком — не показывается.');
      }
      if (t.coord_source !== undefined && t.coord_source !== null && ['gps', 'gps-low', 'gps+manual', 'manual'].indexOf(t.coord_source) === -1) {
        warnings.push('У дерева ' + t.id + ' неизвестный источник координат «' + String(t.coord_source).slice(0, 20) + '».');
      }
      clean.push(t);
    });
    warnings.forEach(function (w) {
      if (window.console) console.warn('[EcoTreeMap] ' + w);
    });
    return { ok: true, trees: clean, species: species, errors: errors, warnings: warnings };
  };

  ECO.speciesOf = function (data, tree) {
    return (
      data.species[tree.species] || {
        name_ru: 'порода не указана',
        name_lat: '',
        color: '#5f6368'
      }
    );
  };

  ECO.byId = function (data, id) {
    for (var i = 0; i < data.trees.length; i++) if (data.trees[i].id === id) return data.trees[i];
    return null;
  };

  // ---------- фото породы ----------
  // Фото показывается только при наличии в images/sources.js записи с автором и лицензией.
  // Возвращает {file, author, license, license_url, source_page} или null.
  ECO.photoFor = function (sp) {
    if (!sp || typeof sp.photo !== 'string' || !sp.photo) return null;
    if (!/^[A-Za-z0-9._-]+$/.test(sp.photo)) return null; // только имя файла в images/
    var sources = Array.isArray(window.ECO_IMAGE_SOURCES) ? window.ECO_IMAGE_SOURCES : [];
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      if (s && s.file === sp.photo && s.author && s.license) return s;
    }
    return null;
  };

  // Блок фото: картинка с подписью-атрибуцией или заглушка «фото будет добавлено».
  // Подпись: пометка (note), автор, лицензия (ссылка, если есть license_url), источник, изменения.
  // Все данные — только через textContent/атрибуты (ECO.el), ссылки — через ECO.safeUrl.
  ECO.photoBlock = function (sp, imagesPrefix) {
    var src = ECO.photoFor(sp);
    if (!src) {
      return ECO.el('div', { className: 'photo-placeholder', text: 'Фото будет добавлено' });
    }
    var licenseUrl = ECO.safeUrl(src.license_url);
    var sourceUrl = ECO.safeUrl(src.source_page);
    var license = String(src.license);
    var caption = ECO.el('figcaption', { className: 'photo-credit' }, [
      src.note ? ECO.el('span', { className: 'photo-note', text: String(src.note) }) : null,
      src.note ? ECO.el('br') : null,
      'Фото: ' + String(src.author) + '. Лицензия: ',
      licenseUrl
        ? ECO.el('a', { href: licenseUrl, text: license, attrs: { target: '_blank', rel: 'noopener' } })
        : license,
      sourceUrl ? '. ' : null,
      sourceUrl ? ECO.el('a', { href: sourceUrl, text: 'Источник', attrs: { target: '_blank', rel: 'noopener' } }) : null,
      src.modified ? '. Изменено: ' + String(src.modified) : null,
      '.'
    ]);
    var img = ECO.el('img', { attrs: { src: imagesPrefix + src.file, alt: sp.name_ru, loading: 'lazy' } });
    var fig = ECO.el('figure', { className: 'photo', style: 'margin:0' }, [img, caption]);
    img.addEventListener('error', function () {
      fig.parentNode && fig.parentNode.replaceChild(
        ECO.el('div', { className: 'photo-placeholder', text: 'Фото будет добавлено' }), fig);
    });
    return fig;
  };

  // ---------- фото конкретного дерева (из полевого режима) ----------
  // Путь только вида trees/<номер>.jpg и только для своего номера. Иначе null.
  ECO.treePhotoPath = function (t) {
    if (!t || typeof t.photo !== 'string') return null;
    var m = /^trees\/([A-Z]-\d{3})\.jpg$/.exec(t.photo);
    return m && m[1] === t.id ? t.photo : null;
  };
  // Фото дерева с подписью «Фото дерева, <дата>; Фото: участники проекта EcoTreeMap».
  // Если файла нет — подставляется блок фото породы (fallback).
  ECO.treePhotoBlock = function (t, sp, imagesPrefix) {
    var path = ECO.treePhotoPath(t);
    if (!path) return null;
    var cfg = window.ECO_CONFIG || {};
    var credit = typeof cfg.TREE_PHOTO_CREDIT === 'string' && cfg.TREE_PHOTO_CREDIT.trim()
      ? cfg.TREE_PHOTO_CREDIT.trim() : 'Фото: участники проекта EcoTreeMap';
    var date = ECO.formatDate(t.photo_date);
    var img = ECO.el('img', { attrs: { src: imagesPrefix + path, alt: 'Дерево ' + t.id + ' (' + sp.name_ru + ')', loading: 'lazy' } });
    var fig = ECO.el('figure', { className: 'photo photo--tree', style: 'margin:0' }, [
      img,
      ECO.el('figcaption', { className: 'photo-credit', text: 'Фото дерева' + (date ? ', ' + date : '') + '; ' + credit })
    ]);
    img.addEventListener('error', function () {
      if (fig.parentNode) fig.parentNode.replaceChild(ECO.photoBlock(sp, imagesPrefix), fig);
    });
    return fig;
  };

  // ---------- контакт координатора ----------
  ECO.contactEmail = function () {
    var cfg = window.ECO_CONFIG || {};
    var email = typeof cfg.CONTACT_EMAIL === 'string' ? cfg.CONTACT_EMAIL.trim() : '';
    return /^[^\s@<>()"',;:\\]+@[^\s@<>()"',;:\\]+\.[^\s@<>()"',;:\\]+$/.test(email) ? email : '';
  };

  // Открывает почтовую программу. Возвращает true, если письмо инициировано.
  ECO.openMail = function (subject, body) {
    var email = ECO.contactEmail();
    if (!email) return false;
    window.location.href =
      'mailto:' + email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    return true;
  };

  // ---------- localStorage (может быть недоступен) ----------
  ECO.storageGet = function (key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  };
  ECO.storageSet = function (key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  };
  ECO.storageRemove = function (key) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      /* нет хранилища — нечего удалять */
    }
  };

  // ---------- сообщения об ошибках ----------
  // Показывает видимое сообщение в #fatal (есть на каждой странице) и отмечает страницу как обработанную.
  ECO.showFatal = function (title, lines, links) {
    var box = document.getElementById('fatal');
    if (!box) {
      box = ECO.el('div', { attrs: { id: 'fatal', role: 'alert' }, className: 'fatal' });
      document.body.insertBefore(box, document.body.firstChild);
    }
    ECO.clear(box);
    box.appendChild(ECO.el('h2', { text: title }));
    (lines || []).forEach(function (l) {
      box.appendChild(ECO.el('p', { text: l }));
    });
    if (links && links.length) {
      var p = ECO.el('p', { className: 'fatal__links' });
      links.forEach(function (l) {
        p.appendChild(ECO.el('a', { href: l.href, text: l.text, className: 'btn btn--primary' }));
      });
      box.appendChild(p);
    }
    box.hidden = false;
    window.ECO_PAGE_DONE = true;
  };

  ECO.libsMissing = function () {
    var missing = [];
    if (typeof window.L === 'undefined') missing.push('Leaflet (assets/lib/leaflet)');
    else if (typeof window.L.markerClusterGroup !== 'function' && ECO.needsCluster)
      missing.push('Leaflet.markercluster (assets/lib/markercluster)');
    return missing;
  };

  // Подложка OpenStreetMap — одна на все страницы.
  ECO.addOsmLayer = function (map, onTilesFailed) {
    var loaded = 0;
    var failed = 0;
    var reported = false;
    var layer = window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">участники OpenStreetMap</a>'
    });
    layer.on('tileload', function () {
      loaded++;
    });
    layer.on('tileerror', function () {
      failed++;
      if (!reported && loaded === 0 && failed >= 2 && typeof onTilesFailed === 'function') {
        reported = true;
        onTilesFailed();
      }
    });
    layer.addTo(map);
    return layer;
  };
})();
