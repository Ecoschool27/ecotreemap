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
  // Номер дерева: 1–2 буквы породы (префикс из data/species.js), дефис, 3 цифры (L-001, TB-001).
  ECO.ID_RE = /^[A-Z]{1,2}-\d{3}$/;

  // Фраза с точкой в конце без удвоения («13 мая 2026 г.» + «.» → одна точка).
  ECO.sentence = function (s) {
    s = String(s);
    return /[.!?…]$/.test(s) ? s : s + '.';
  };

  // ---------- шефство ----------
  // patron — только название группы/класса (без имён), до 80 знаков; patron_since — дата ГГГГ-ММ-ДД.
  ECO.PATRON_MAX = 80;
  ECO.patronOf = function (t) {
    if (!t || typeof t.patron !== 'string') return '';
    var v = t.patron.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim();
    return v.length <= ECO.PATRON_MAX ? v : '';
  };

  // ---------- осмотры, полив, «нужна помощь» ----------
  ECO.HELP_STATUSES = ['needs_water', 'needs_check', 'damaged', 'sick'];
  ECO.STALE_DAYS = 60;   // «давно не осматривали»
  ECO.DRY_DAYS = 14;     // «давно не поливали» (только май–сентябрь)
  ECO.validObservations = function (t) {
    return t && Array.isArray(t.observations) ? t.observations.filter(function (o) {
      return o && typeof o === 'object' && ECO.parseDate(o.date);
    }) : [];
  };
  function maxDate(list) {
    var best = null;
    list.forEach(function (d) { if (ECO.parseDate(d) && (!best || d > best)) best = d; });
    return best;
  }
  // Осмотр — запись с указанным состоянием (как в статистике «Осмотрено»). Отметка «только полив»
  // или заметка без состояния осмотром не считается и «давно не осматривали» не сбрасывает.
  ECO.hasStatus = function (o) {
    return !!o && typeof o.status === 'string' && ECO.hasOwn(STATUS_LABELS, o.status);
  };
  ECO.lastInspection = function (t) {
    return maxDate(ECO.validObservations(t).filter(ECO.hasStatus).map(function (o) { return o.date; })
      .concat(ECO.hasStatus(t) ? [t.status_date] : []));
  };
  ECO.lastWatered = function (t) {
    return maxDate(ECO.validObservations(t).filter(function (o) { return o.watered === true; })
      .map(function (o) { return o.date; }));
  };
  function isoOf(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  ECO.daysBetween = function (iso, now) {
    var p = ECO.parseDate(iso);
    if (!p) return null;
    var n = ECO.parseDate(isoOf(now));
    return Math.round((Date.UTC(n.y, n.m - 1, n.d) - Date.UTC(p.y, p.m - 1, p.d)) / 86400000);
  };
  // Причины, по которым дереву нужна помощь: {status, stale, dry}. now — Date (для проверок).
  ECO.helpReasons = function (t, now) {
    now = now instanceof Date ? now : new Date();
    var r = { status: false, stale: false, dry: false };
    if (!t) return r;
    r.status = ECO.HELP_STATUSES.indexOf(t.status) !== -1;
    if (!ECO.hasCoords(t) || t.status === 'dead') return r;
    var li = ECO.lastInspection(t);
    r.stale = !li || ECO.daysBetween(li, now) > ECO.STALE_DAYS;
    var month = now.getMonth() + 1;
    if (month >= 5 && month <= 9) {
      var lw = ECO.lastWatered(t);
      r.dry = !lw || ECO.daysBetween(lw, now) > ECO.DRY_DAYS;
    }
    return r;
  };

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

  // Проверяет data/trees.js и data/species.js (снимок). Синхронно; так работают редактор и откат.
  // Возвращает {ok, trees, species, errors, warnings, source: 'static', snapshotDate}.
  ECO.loadData = function () {
    var d = ECO.validateData(window.ECO_TREES, window.ECO_SPECIES, 'static');
    d.source = 'static';
    d.snapshotDate = d.ok ? ECO.snapshotDate(d.trees) : null;
    return d;
  };

  // Дата снимка: window.ECO_TREES_DATE (если задана выгрузкой), иначе самая поздняя дата в данных.
  ECO.snapshotDate = function (trees) {
    if (ECO.parseDate(window.ECO_TREES_DATE)) return window.ECO_TREES_DATE;
    var best = null;
    function take(d) { if (ECO.parseDate(d) && (!best || d > best)) best = d; }
    (trees || []).forEach(function (t) {
      if (!t) return;
      take(t.planted_date); take(t.status_date); take(t.photo_date); take(t.patron_since);
      ECO.validObservations(t).forEach(function (o) { take(o.date); });
    });
    return best;
  };

  // Асинхронная загрузка для публичных страниц: онлайн-база (assets/js/db.js), а при любом сбое,
  // отказе или таймауте — целиком снимок data/*.js (без смешивания источников). Промис не отклоняется.
  ECO.loadDataAsync = function () {
    function fallback(reason) {
      var d = ECO.loadData();
      if (reason && window.console) console.warn('[EcoTreeMap] онлайн-база не используется: ' + reason + ' — данные из снимка.');
      return d;
    }
    var DB = ECO.DB;
    if (!DB || typeof DB.enabled !== 'function' || !DB.enabled()) return Promise.resolve(fallback(null));
    var p;
    try {
      p = DB.fetchPublic();
    } catch (e) {
      return Promise.resolve(fallback(String(e && e.message ? e.message : e)));
    }
    return p.then(function (raw) {
      var a = DB.adapt(raw, window.ECO_TREES, window.ECO_SPECIES);
      var d = ECO.validateData(a.trees, a.species, 'supabase');
      if (!d.ok || !d.trees.length) return fallback('данные базы не прошли проверку');
      d.source = 'supabase';
      d.snapshotDate = null;
      return d;
    }).then(null, function (e) {
      return fallback(String(e && e.message ? e.message : e));
    });
  };

  // Строка источника данных: «Данные: онлайн-база» / «Данные: снимок от <дата>».
  ECO.dataSourceText = function (data) {
    if (!data || !data.ok) return '';
    if (data.source === 'supabase') return 'Данные: онлайн-база';
    var d = ECO.formatDate(data.snapshotDate);
    return d ? 'Данные: снимок от ' + d : 'Данные: снимок (файл сайта)';
  };
  ECO.showDataSource = function (data) {
    var box = document.getElementById('data-source');
    var text = ECO.dataSourceText(data);
    if (!box || !text) return;
    box.textContent = text;
    box.setAttribute('data-source', data.source);
    box.hidden = false;
  };

  // Запуск страницы: данные (асинхронно) → main(data). window.ECO_PAGE_PENDING — промис запуска,
  // его ждёт страховка «сайт не загрузился» в HTML (не срабатывает, пока данные в пути).
  ECO.runPage = function (main, fatalTitle, fatalLinks) {
    function fatal(e) { ECO.showFatal(fatalTitle, [String(e && e.message ? e.message : e)], fatalLinks); }
    var p = ECO.loadDataAsync().then(function (data) {
      ECO.lastData = data;
      ECO.showDataSource(data);
      var r = main(data);
      return r && typeof r.then === 'function' ? r.then(null, fatal) : r;
    }).then(null, fatal);
    window.ECO_PAGE_PENDING = p;
    return p;
  };

  // Проверка набора данных (общая для снимка и онлайн-базы). Возвращает {ok, trees, species, errors, warnings}.
  ECO.validateData = function (trees, species, origin) {
    var errors = [];
    var warnings = [];
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
      if (window.console) console.warn('[EcoTreeMap] ' + (origin === 'supabase' ? '(онлайн-база) ' : '') + w);
    });
    return { ok: true, trees: clean, species: species, errors: errors, warnings: warnings };
  };

  // Порода дерева. Для «Другая порода» (other) название берётся из species_note дерева (до 60 знаков).
  ECO.SPECIES_NOTE_MAX = 60;
  ECO.speciesNote = function (tree) {
    if (!tree || typeof tree.species_note !== 'string') return '';
    var v = tree.species_note.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim();
    return v.length <= ECO.SPECIES_NOTE_MAX ? v : '';
  };
  ECO.speciesOf = function (data, tree) {
    var sp = data.species[tree.species];
    if (sp && tree.species === 'other' && ECO.speciesNote(tree)) {
      var copy = {};
      Object.keys(sp).forEach(function (k) { copy[k] = sp[k]; });
      copy.name_ru = ECO.speciesNote(tree);
      copy.name_lat = '';
      return copy;
    }
    return (
      sp || {
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
  // Путь только вида trees/<номер>.jpg (старый) или trees/<номер>/<ГГГГ-ММ-ДД>[-N].jpg и только для своего номера.
  // Суффикс -N (N = 2…999) — второе и следующие фото того же дерева за тот же день (tools/merge_field.py).
  var TREE_PHOTO_RE = /^trees\/([A-Z]{1,2}-[0-9]{3})(?:\/([0-9]{4}-[0-9]{2}-[0-9]{2})(?:-(?:[2-9]|[1-9][0-9]{1,2}))?)?\.jpg$/;
  var OBS_PHOTO_RE = /^trees\/([A-Z]{1,2}-[0-9]{3})\/([0-9]{4}-[0-9]{2}-[0-9]{2})(?:-(?:[2-9]|[1-9][0-9]{1,2}))?\.jpg$/;
  ECO.treePhotoPath = function (t) {
    if (!t || typeof t.photo !== 'string') return null;
    var m = TREE_PHOTO_RE.exec(t.photo);
    return m && m[1] === t.id && (!m[2] || ECO.parseDate(m[2])) ? t.photo : null;
  };
  // Фото осмотра: trees/<номер>/<дата осмотра>[-N].jpg — только своего дерева и своей даты.
  ECO.obsPhotoPath = function (t, o) {
    if (!t || !o || typeof o.photo !== 'string') return null;
    var m = OBS_PHOTO_RE.exec(o.photo);
    return m && m[1] === t.id && m[2] === o.date && ECO.parseDate(m[2]) ? o.photo : null;
  };
  // Все фото дерева во времени, новые первыми: [{path, date, status}].
  ECO.photoHistory = function (t) {
    var out = [];
    var seen = Object.create(null);
    ECO.validObservations(t).forEach(function (o) {
      var p = ECO.obsPhotoPath(t, o);
      if (p && !seen[p]) { seen[p] = true; out.push({ path: p, date: o.date, status: o.status || null }); }
    });
    var main = ECO.treePhotoPath(t);
    if (main && !seen[main]) {
      out.push({ path: main, date: ECO.parseDate(t.photo_date) ? t.photo_date : null, status: null });
    }
    // новые первыми; за один день — по суффиксу -N (второе фото дня новее первого)
    function dayNo(p) { var m = /[0-9]{4}-[0-9]{2}-[0-9]{2}-([0-9]{1,3})\.jpg$/.exec(p); return m ? +m[1] : 1; }
    out.sort(function (a, b) {
      var da = a.date || '', db = b.date || '';
      return da < db ? 1 : da > db ? -1 : dayNo(b.path) - dayNo(a.path);
    });
    return out;
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
