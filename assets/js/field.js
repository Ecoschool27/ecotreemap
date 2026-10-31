// EcoTreeMap — полевой режим (tools/field.html): отметка дерева с телефона.
// Записи и фото — в IndexedDB этого браузера (field-store.js); выгрузка в файл JSON,
// слияние с сайтом — tools/merge_field.py. В сеть ничего не отправляется (кроме тайлов OSM).
// Весь пользовательский текст выводится через textContent (ECO.el).
(function () {
  'use strict';
  var ECO = window.ECO;
  if (!ECO) return;
  // Страховка от смешения версий в кэше браузера (этот файл новее common.js): нет функции — тихая деградация.
  if (typeof ECO.t !== 'function') ECO.t = window.ECO_T || function (k, ru) { return ru; };
  if (typeof ECO.spName !== 'function') ECO.spName = function (sp) { return sp ? sp.name_ru : ''; };
  if (typeof ECO.lastWatered !== 'function') ECO.lastWatered = function () { return null; };
  if (typeof ECO.sentence !== 'function') ECO.sentence = function (s) { return String(s); };
  var el = ECO.el;
  var L = window.L;
  var STORE = window.ECO_FIELD_STORE;
  var cfg = window.ECO_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  var LIMITS = { notes: 500, author: 60, event: 120, species_note: 60 };
  var PHOTO = { maxInputBytes: 25 * 1024 * 1024, maxSide: 1200, maxBytes: 400 * 1024 };
  var GPS_WINDOW_MS = 10000;
  var NEAREST_MOVE_M = 10; // список «ближайшие» сам перерисовывается только при сдвиге больше этого
  var THRESHOLD = typeof cfg.FIELD_GPS_ACCURACY_M === 'number' && cfg.FIELD_GPS_ACCURACY_M > 0 ? cfg.FIELD_GPS_ACCURACY_M : 10;
  var EVENT_CUSTOM = '__custom__';
  var EVENT_NONE = '';
  var STATUS_TEXT = {
    healthy: 'здоровое', needs_water: 'нужен полив', needs_check: 'требуется осмотр',
    damaged: 'повреждено', sick: 'болеет', dead: 'засохло/погибло'
  };

  // ---------- адрес сайта (та же проверка, что base_url_problem в generate_qr.py) ----------
  var FORBIDDEN_HOST_PARTS = ['trycloudflare.com', 'ngrok', 'loca.lt', 'serveo', 'localhost.run', 'lhr.life',
    'lhr.rocks', 'localhost', 'localtunnel'];
  var FORBIDDEN_HOST_SUFFIXES = ['.local', '.lan', '.internal', '.home', '.corp', '.test', '.invalid', '.example'];
  function baseUrlProblem(url) {
    if (typeof url !== 'string' || !url.trim()) return 'адрес сайта (SITE_BASE_URL в assets/js/config.js) не задан';
    url = url.trim();
    if (/[\s\x00-\x1f\x7f\\]/.test(url)) return 'в адресе есть пробелы, обратные слеши или управляющие символы';
    if (!/^https:\/\//i.test(url)) return 'адрес должен начинаться с https://';
    if (/[?#]/.test(url)) return 'в адресе не должно быть ? или #';
    var authority = url.slice(8).split('/')[0];
    if (authority.indexOf('@') !== -1) return 'в адресе не должно быть логина/пароля';
    var host = authority.replace(/:\d*$/, '').toLowerCase().replace(/\.$/, '');
    if (!host) return 'в адресе нет домена';
    if (!/^[a-z0-9.-]+$/.test(host)) return 'адрес указывает на IP-адрес или содержит недопустимые символы в домене';
    var labels = host.split('.');
    if (labels.length < 2 || labels.some(function (l) { return !l; })) return 'домен должен быть полным (например school-eco.github.io)';
    if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(labels[labels.length - 1])) return 'адрес указывает на IP-адрес, а не на домен';
    for (var i = 0; i < FORBIDDEN_HOST_PARTS.length; i++) {
      if (host.indexOf(FORBIDDEN_HOST_PARTS[i]) !== -1) return 'адрес указывает на временный/локальный адрес (' + FORBIDDEN_HOST_PARTS[i] + ')';
    }
    for (var j = 0; j < FORBIDDEN_HOST_SUFFIXES.length; j++) {
      var s = FORBIDDEN_HOST_SUFFIXES[j];
      if (host.slice(-s.length) === s) return 'адрес указывает на локальную сеть (' + s + ')';
    }
    return null;
  }
  function siteBase() {
    return baseUrlProblem(cfg.SITE_BASE_URL) ? null : cfg.SITE_BASE_URL.trim().replace(/\/+$/, '');
  }
  function treeUrl(base, id) {
    return base + '/pages/tree.html?id=' + encodeURIComponent(id);
  }

  // ---------- мелочи ----------
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function cleanText(s, max) {
    // управляющие символы и разделители строк U+2028/2029 → пробел; длина ограничена
    return String(s || '').replace(/[\x00-\x08\x0b-\x1f\x7f\u2028\u2029]/g, ' ').replace(/\r\n?/g, '\n').trim().slice(0, max);
  }
  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    var b = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function deviceId() {
    var d = ECO.storageGet('ecotreemap_field_device');
    if (!d || !/^[a-z0-9-]{3,40}$/.test(d)) {
      d = 'tel-' + uuid().slice(0, 8);
      ECO.storageSet('ecotreemap_field_device', d);
    }
    return d;
  }
  function distanceM(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function geoErrorText(err) {
    var code = err && err.code;
    if (code === 1) return 'Доступ к местоположению запрещён. Разрешите его для этого сайта в настройках браузера или поставьте точку на карте вручную.';
    if (code === 2) return 'Не удаётся определить местоположение: включите геолокацию (GPS) на телефоне и выйдите на открытое место. Можно поставить точку вручную.';
    if (code === 3) return 'GPS долго не отвечает. Подождите на открытом месте или поставьте точку на карте вручную.';
    return 'Ошибка геолокации. Поставьте точку на карте вручную.';
  }

  // ---------- фото: поворот по EXIF, ≤1200 px, JPEG ≤400 КБ, без метаданных ----------
  function decodeImage(file) {
    if (window.createImageBitmap) {
      return window.createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return decodeViaImg(file); });
    }
    return decodeViaImg(file);
  }
  function decodeViaImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve(img); setTimeout(function () { URL.revokeObjectURL(url); }, 0); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Файл не похож на фотографию.')); };
      img.src = url;
    });
  }
  function toJpeg(canvas, q) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', q); });
  }
  function processPhoto(file) {
    if (!file) return Promise.reject(new Error('Файл не выбран.'));
    if (file.size > PHOTO.maxInputBytes) return Promise.reject(new Error('Файл больше 25 МБ — выберите другое фото.'));
    if (file.type && !/^image\//.test(file.type)) return Promise.reject(new Error('Это не изображение.'));
    return decodeImage(file).then(function (img) {
      var w = img.width, h = img.height;
      if (!(w > 0 && h > 0)) throw new Error('Не удалось прочитать фото.');
      var scale = Math.min(1, PHOTO.maxSide / Math.max(w, h));
      function render(s) {
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * s));
        c.height = Math.max(1, Math.round(h * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        return c;
      }
      function attempt(s, q) {
        var c = render(s);
        return toJpeg(c, q).then(function (blob) {
          if (!blob) throw new Error('Браузер не смог сжать фото.');
          if (blob.size <= PHOTO.maxBytes) return { blob: blob, width: c.width, height: c.height, quality: q };
          if (q > 0.65) return attempt(s, Math.round((q - 0.1) * 10) / 10);
          if (s * Math.max(w, h) > 400) return attempt(s * 0.85, 0.6);
          throw new Error('Фото не удалось сжать до 400 КБ.');
        });
      }
      return attempt(scale, 0.8).then(function (r) {
        if (img.close) img.close();
        return r;
      });
    });
  }

  // ---------- QR ----------
  function qrCanvas(text, scale) {
    var qr = window.qrcode(0, 'Q');
    qr.addData(text, 'Byte');
    qr.make();
    var n = qr.getModuleCount();
    var border = 4;
    var size = (n + border * 2) * scale;
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#000000';
    for (var r = 0; r < n; r++) {
      for (var col = 0; col < n; col++) {
        if (qr.isDark(r, col)) g.fillRect((col + border) * scale, (r + border) * scale, scale, scale);
      }
    }
    return c;
  }

  function main() {
    if (!Array.isArray(window.ECO_TREES) || !window.ECO_SPECIES) {
      ECO.showFatal('Данные не загрузились', ['Не найдены data/trees.js или data/species.js рядом с папкой tools/.']);
      return;
    }
    if (!STORE) {
      ECO.showFatal('Полевой режим не загрузился', ['Не найден файл assets/js/field-store.js.']);
      return;
    }
    var data = ECO.loadData();
    var species = data.species;
    var trees = data.trees;
    var treeById = Object.create(null);
    trees.forEach(function (t) { treeById[t.id] = t; });
    // префикс номера породы — из data/species.js (prefix: L, TB …); для старых записей без prefix — по номерам
    var prefixOf = Object.create(null);
    Object.keys(species).forEach(function (k) {
      var p = species[k] && species[k].prefix;
      if (typeof p === 'string' && /^[A-Z]{1,2}$/.test(p)) prefixOf[k] = p;
    });
    trees.forEach(function (t) {
      var m = ECO.ID_RE.test(t.id) && /^([A-Z]{1,2})-/.exec(t.id);
      if (m && ECO.hasOwn(species, t.species) && !prefixOf[t.species]) prefixOf[t.species] = m[1];
    });
    var device = deviceId();
    var records = []; // локальные записи
    var state = { lat: null, lon: null, acc: null, source: null, photo: null, saving: false };

    // ---------- выбор действия ----------
    function kind() { return document.querySelector('input[name="kind"]:checked').value; }
    var selSpecies = $('f-species');
    Object.keys(prefixOf).forEach(function (k) {
      selSpecies.appendChild(el('option', { value: k, text: species[k].name_ru }));
    });

    function localClaims() {
      // номера, уже занятые локальными записями «отметить место» и «новое дерево»
      var s = Object.create(null);
      records.forEach(function (r) { if (r.kind !== 'inspect') s[r.id] = r; });
      return s;
    }
    function nextNewId(sp) {
      var p = prefixOf[sp];
      if (!p) return null;
      var max = 0;
      var re = new RegExp('^' + p + '-(\\d{3})$');
      trees.concat(records).forEach(function (t) {
        var m = t && typeof t.id === 'string' && re.exec(t.id);
        if (m && +m[1] > max) max = +m[1];
      });
      var n = max + 1;
      if (n > 999) return null; // формат номера ^[A-Z]{1,2}-\d{3}$ — больше 999 деревьев одной породы не выдаём
      return p + '-' + ('00' + n).slice(-3);
    }
    function freeExisting(sp) {
      var claimed = localClaims();
      return trees.filter(function (t) { return t.species === sp && !ECO.hasCoords(t) && !claimed[t.id]; });
    }

    function fillExisting() {
      var sel = $('f-existing');
      ECO.clear(sel);
      var list = freeExisting(selSpecies.value);
      if (!list.length) sel.appendChild(el('option', { value: '', text: '— все деревья этой породы уже отмечены —' }));
      list.forEach(function (t) { sel.appendChild(el('option', { value: t.id, text: t.id })); });
    }

    var inspectTarget = null;
    function updateKind() {
      var k = kind();
      $('box-species').hidden = k === 'inspect';
      $('box-existing').hidden = k !== 'place_existing';
      $('box-new').hidden = k !== 'new_tree';
      $('box-inspect').hidden = k !== 'inspect';
      $('box-location').hidden = k === 'inspect';
      $('box-event').hidden = k !== 'new_tree';
      $('box-species-note').hidden = !(k === 'new_tree' && selSpecies.value === 'other');
      $('box-water').hidden = k !== 'inspect';
      if (k === 'place_existing') fillExisting();
      if (k === 'new_tree') $('f-new-id').textContent = 'Номер нового дерева: ' + (nextNewId(selSpecies.value) || '—');
      if (k === 'inspect') renderNearest();
      renderFacts();
    }
    function updateKindKeep() {
      var keep = $('f-existing').value;
      updateKind();
      if (keep && Array.prototype.some.call($('f-existing').options, function (o) { return o.value === keep; })) {
        $('f-existing').value = keep;
        renderFacts();
      }
    }
    function renderFacts() {
      var k = kind();
      var t = k === 'place_existing' ? treeById[$('f-existing').value] : k === 'inspect' ? inspectTarget : null;
      var f = $('tree-facts');
      if (!t) { f.textContent = k === 'inspect' ? 'Дерево не выбрано.' : ''; return; }
      var sp = ECO.speciesOf(data, t);
      var lw = k === 'inspect' ? ECO.lastWatered(t) : null;
      f.textContent = ECO.sentence('Дерево ' + t.id + ': ' + sp.name_ru + ', посажено ' +
        (ECO.formatDate(t.planted_date) || (t.planted_year ? t.planted_year + ' г.' : 'год не указан'))) +
        (k === 'place_existing' ? ' Порода и год берутся из реестра и не меняются.' : '') +
        (lw ? ' Последний полив: ' + ECO.sentence(ECO.formatDate(lw)) : '');
    }
    Array.prototype.forEach.call(document.querySelectorAll('input[name="kind"]'), function (r) {
      r.addEventListener('change', updateKind);
    });
    selSpecies.addEventListener('change', updateKind);
    $('f-existing').addEventListener('change', renderFacts);

    // осмотр: ввод номера или 5 ближайших
    function findTree(id) {
      if (ECO.hasOwn(treeById, id)) return treeById[id];
      for (var i = 0; i < records.length; i++) {
        if (records[i].kind === 'new_tree' && records[i].id === id) return records[i];
      }
      return null;
    }
    function knownPoints() {
      var pts = [];
      var claimed = localClaims();
      trees.forEach(function (t) {
        var r = claimed[t.id];
        if (r && typeof r.lat === 'number') pts.push({ id: t.id, lat: r.lat, lon: r.lon });
        else if (ECO.hasCoords(t)) pts.push({ id: t.id, lat: t.lat, lon: t.lon });
      });
      records.forEach(function (r) {
        if (r.kind === 'new_tree' && typeof r.lat === 'number') pts.push({ id: r.id, lat: r.lat, lon: r.lon });
      });
      return pts;
    }
    // Список строится при первом отсчёте GPS, по кнопке «Обновить список» и при смене действия.
    // Новые отсчёты GPS перерисовывают его, только если человек сместился больше чем на NEAREST_MOVE_M
    // от точки последней отрисовки, и не перерисовывают вовсе, пока выбрано дерево из списка, —
    // иначе кнопки пересоздаются под пальцем.
    var nearest = { at: null, locked: false };
    function renderNearest() {
      var box = ECO.clear($('nearest-list'));
      var here = lastSample();
      if (!here) {
        nearest.at = null;
        $('nearest-hint').textContent = 'Ближайшие отмеченные деревья появятся после включения GPS (раздел «Место» скрыт при осмотре — кнопка ниже).';
        box.appendChild(el('button', { type: 'button', className: 'btn', text: 'Включить GPS', onclick: startGps }));
        return;
      }
      nearest.at = { lat: here.lat, lon: here.lon };
      var list = knownPoints().map(function (p) {
        return { id: p.id, d: distanceM([here.lat, here.lon], [p.lat, p.lon]) };
      }).sort(function (a, b) { return a.d - b.d; }).slice(0, 5);
      $('nearest-hint').textContent = list.length ? 'Ближайшие отмеченные деревья:' : 'Рядом нет отмеченных деревьев — введите номер с таблички.';
      list.forEach(function (p) {
        box.appendChild(el('button', {
          type: 'button', className: 'btn btn--outline', text: p.id + ' · ' + Math.round(p.d) + ' м',
          onclick: function () { nearest.locked = true; $('f-inspect-id').value = p.id; pickInspect(); }
        }));
      });
      box.appendChild(el('button', {
        type: 'button', className: 'btn', text: 'Обновить список',
        onclick: function () { nearest.locked = false; renderNearest(); }
      }));
    }
    function nearestOnFix(s) {
      if (nearest.locked) return;
      if (!nearest.at || distanceM([nearest.at.lat, nearest.at.lon], [s.lat, s.lon]) > NEAREST_MOVE_M) renderNearest();
    }
    function pickInspect() {
      var v = $('f-inspect-id').value.trim().toUpperCase();
      inspectTarget = ECO.ID_RE.test(v) ? findTree(v) : null;
      renderFacts();
    }
    $('f-inspect-id').addEventListener('input', function () {
      nearest.locked = false; // номер вводят вручную — выбор из списка сброшен
      pickInspect();
    });

    // ---------- карта и точка ----------
    var map = null, marker = null, accCircle = null;
    if (L) {
      map = L.map('field-map').setView(cfg.MAP_CENTER || [49.777, 73.124], cfg.MAP_ZOOM || 16);
      ECO.addOsmLayer(map, function () {
        $('coord-line').textContent = 'Подложка карты не загрузилась (нет интернета) — точку по GPS зафиксировать можно.';
      });
      map.on('click', function (e) {
        if (kind() === 'inspect') return;
        setPoint(e.latlng.lat, e.latlng.lng, /^gps/.test(state.source || '') ? 'gps+manual' : 'manual', null);
      });
    } else {
      $('field-map').hidden = true;
      $('coord-line').textContent = 'Библиотека карты не загрузилась — точку можно зафиксировать только по GPS.';
    }
    function round7(x) { return Math.round(x * 1e7) / 1e7; }
    function setPoint(lat, lon, source, acc) {
      if (!(isFinite(lat) && isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return;
      state.lat = round7(lat);
      state.lon = round7(lon);
      state.source = source;
      // точность хранится только для точки по GPS (gps и gps-low); ручная поправка её обнуляет
      state.acc = (source === 'gps' || source === 'gps-low') && typeof acc === 'number' ? Math.round(acc * 10) / 10 : null;
      if (map) {
        if (!marker) {
          marker = L.marker([state.lat, state.lon], { draggable: true, keyboard: false }).addTo(map);
          marker.on('dragend', function () {
            var p = marker.getLatLng();
            setPoint(p.lat, p.lng, /^gps/.test(state.source || '') ? 'gps+manual' : 'manual', null);
          });
        } else {
          marker.setLatLng([state.lat, state.lon]);
        }
        map.setView([state.lat, state.lon], Math.max(map.getZoom(), 18));
      }
      var srcText = {
        gps: 'по GPS', 'gps-low': 'по GPS с низкой точностью — место приблизительное',
        'gps+manual': 'по GPS, поправлена вручную', manual: 'вручную на карте'
      }[source];
      $('coord-line').textContent = 'Точка: ' + state.lat.toFixed(6) + ', ' + state.lon.toFixed(6) + ' — ' + srcText +
        (state.acc !== null ? ' (точность ±' + Math.round(state.acc) + ' м)' : '') + '. Маркер можно перетащить.';
    }

    // ---------- GPS ----------
    var watchId = null;
    var samples = [];
    function lastSample() { return samples.length ? samples[samples.length - 1] : null; }
    function gpsStatus(text, warn) {
      $('gps-status').textContent = text;
      $('gps-status').className = 'editor-hint' + (warn ? ' editor-hint--warn' : '');
    }
    // file:// браузеры считают «безопасным», но геолокацию там не дают (или не запоминают разрешение) —
    // для полевого режима это тот же случай, что http: только ручная точка.
    var isFile = location.protocol === 'file:';
    var geoOk = window.isSecureContext && !isFile && 'geolocation' in navigator;
    function startGps() {
      if (!geoOk) {
        gpsStatus('GPS недоступен на этой странице: он работает только когда сайт открыт по https-адресу (или localhost). Поставьте точку на карте вручную.', true);
        return;
      }
      if (watchId !== null) return;
      samples = [];
      gpsStatus('Ищем спутники… Выйдите на открытое место и подождите 10–30 секунд.');
      watchId = navigator.geolocation.watchPosition(onPosition, function (err) {
        stopGps();
        gpsStatus(geoErrorText(err), true);
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
      $('gps-start').disabled = true;
    }
    function stopGps() {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
      $('gps-start').disabled = false;
      $('gps-fix').disabled = true;
      $('gps-force').disabled = true;
      if (accCircle && map) { map.removeLayer(accCircle); accCircle = null; }
    }
    function onPosition(pos) {
      var c = pos.coords;
      if (!(isFinite(c.latitude) && isFinite(c.longitude) && isFinite(c.accuracy) && c.accuracy >= 0)) return;
      var s = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, t: Date.now() };
      samples.push(s);
      samples = samples.filter(function (x) { return s.t - x.t <= GPS_WINDOW_MS; });
      var good = s.acc <= THRESHOLD;
      gpsStatus('GPS: ±' + Math.round(s.acc) + ' м. ' + (good
        ? 'Точность достаточная — нажмите «Зафиксировать».'
        : 'Нужно ±' + THRESHOLD + ' м или лучше — подождите или «Зафиксировать всё равно».'), !good);
      $('gps-fix').disabled = !good;
      $('gps-force').disabled = false;
      if (map) {
        if (!accCircle) accCircle = L.circle([s.lat, s.lon], { radius: s.acc, color: '#0b57d0', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
        else { accCircle.setLatLng([s.lat, s.lon]); accCircle.setRadius(s.acc); }
        if (!marker) map.setView([s.lat, s.lon], 18);
      }
      if (kind() === 'inspect') nearestOnFix(s);
    }
    // Взвешенное среднее 1/acc² по отсчётам последних ~10 с; точность — средняя по использованным отсчётам.
    function fixGps(force) {
      var now = Date.now();
      var used = samples.filter(function (x) { return now - x.t <= GPS_WINDOW_MS && (force || x.acc <= THRESHOLD); });
      if (!used.length) {
        gpsStatus('Нет отсчётов с нужной точностью за последние 10 секунд — подождите.', true);
        return;
      }
      var sw = 0, sl = 0, so = 0, sa = 0;
      used.forEach(function (x) {
        var w = 1 / Math.max(x.acc, 0.5) / Math.max(x.acc, 0.5);
        sw += w; sl += x.lat * w; so += x.lon * w; sa += x.acc;
      });
      var acc = sa / used.length;
      stopGps();
      // «Зафиксировать всё равно» — точка записывается как gps-low с реальной точностью (на сайте: «приблизительно»)
      setPoint(sl / sw, so / sw, force ? 'gps-low' : 'gps', acc);
      gpsStatus('Точка зафиксирована по ' + used.length + ' ' + ECO.plural(used.length, ['отсчёту', 'отсчётам', 'отсчётам']) +
        ' GPS (±' + Math.round(acc) + ' м). Слежение выключено.' +
        (acc > THRESHOLD ? ' Внимание: точность хуже ±' + THRESHOLD + ' м — проверьте точку на карте.' : ''), acc > THRESHOLD);
    }
    $('gps-start').addEventListener('click', startGps);
    $('gps-fix').addEventListener('click', function () { fixGps(false); });
    $('gps-force').addEventListener('click', function () {
      if (window.confirm('Точность GPS хуже ±' + THRESHOLD + ' м — точка может оказаться у соседнего дерева. Зафиксировать всё равно?')) fixGps(true);
    });
    if (!geoOk) {
      var sb = $('secure-banner');
      sb.textContent = window.isSecureContext && !isFile
        ? 'Браузер не поддерживает геолокацию. Ставьте точку на карте вручную — фото и записи работают.'
        : 'GPS работает только когда сайт открыт по https-адресу (или localhost). Сейчас страница открыта как файл ' +
          'или по http — ставьте точку на карте вручную; фото и записи работают.';
      sb.hidden = false;
    }

    // ---------- статусы и акции ----------
    var selStatus = $('f-status');
    selStatus.appendChild(el('option', { value: '', text: '— не указано —' }));
    Object.keys(STATUS_TEXT).forEach(function (k) { selStatus.appendChild(el('option', { value: k, text: STATUS_TEXT[k] })); });
    var selEvent = $('f-event');
    selEvent.appendChild(el('option', { value: EVENT_NONE, text: '— уточняется —' }));
    var events = [];
    trees.forEach(function (t) { if (t.event && events.indexOf(t.event) === -1) events.push(String(t.event)); });
    events.forEach(function (e) { selEvent.appendChild(el('option', { value: e, text: e })); });
    selEvent.appendChild(el('option', { value: EVENT_CUSTOM, text: 'другая акция (ввести)…' }));
    selEvent.addEventListener('change', function () { $('box-event-custom').hidden = selEvent.value !== EVENT_CUSTOM; });
    $('f-observed').value = todayIso();
    $('f-observed').max = todayIso();
    $('f-date').max = todayIso();
    $('f-year').max = String(new Date().getFullYear());

    // ---------- фото ----------
    var photoInput = $('f-photo');
    photoInput.addEventListener('click', function (e) {
      if (ECO.storageGet('ecotreemap_field_photo_warned') === '1') {
        saveFormForCamera(); // камера на телефоне может выгрузить вкладку — форма восстановится после перезагрузки
        return;
      }
      e.preventDefault();
      $('photo-warning').hidden = false;
    });
    $('photo-warning-ok').addEventListener('click', function () {
      ECO.storageSet('ecotreemap_field_photo_warned', '1');
      $('photo-warning').hidden = true;
      $('photo-status').textContent = 'Теперь нажмите «Фото дерева» ещё раз.';
    });
    photoInput.addEventListener('change', function () {
      var f = photoInput.files && photoInput.files[0];
      state.photo = null;
      $('photo-preview').hidden = true;
      if (!f) return;
      $('photo-status').textContent = 'Обрабатываем фото…';
      processPhoto(f).then(function (r) {
        state.photo = r.blob;
        $('photo-status').textContent = 'Фото готово: ' + r.width + '×' + r.height + ' px, ' + Math.round(r.blob.size / 1024) +
          ' КБ (метаданные и координаты из файла удалены).';
        var prev = $('photo-preview');
        if (prev.src) URL.revokeObjectURL(prev.src);
        prev.src = URL.createObjectURL(r.blob);
        prev.hidden = false;
      }, function (err) {
        $('photo-status').textContent = 'Фото не принято: ' + err.message;
      });
    });

    // ---------- сохранение ----------
    function result(text, warn) {
      var r = $('save-result');
      r.textContent = text;
      r.className = 'result' + (warn ? ' result--demo' : '');
      r.hidden = false;
    }
    function buildRecord() {
      var k = kind();
      var now = new Date().toISOString();
      var observed = $('f-observed').value || todayIso();
      if (!ECO.parseDate(observed) || observed > todayIso()) throw new Error('Дата осмотра не может быть в будущем.');
      var rec = {
        record_uid: uuid(), kind: k, id: null, species: null, event: null, planted_year: null, planted_date: null,
        lat: null, lon: null, coord_accuracy_m: null, coord_source: null,
        status: selStatus.value || null, observed_date: observed,
        notes: cleanText($('f-notes').value, LIMITS.notes), author: cleanText($('f-author').value, LIMITS.author),
        photo: !!state.photo, device: device, created_at: now, updated_at: now, exported_at: null, qr_pending: false
      };
      if (rec.status !== null && !ECO.hasOwn(STATUS_TEXT, rec.status)) throw new Error('Неизвестное состояние.');
      if (k === 'inspect') {
        if (!inspectTarget) throw new Error('Выберите дерево: номер с таблички или одно из ближайших.');
        rec.watered = $('f-watered').checked;
        if (!rec.status && !rec.notes && !rec.photo && !rec.watered) throw new Error('Для осмотра укажите состояние, полив, заметку или фото.');
        rec.id = inspectTarget.id;
        rec.species = inspectTarget.species;
        return rec;
      }
      if (state.lat === null) throw new Error('Поставьте точку: GPS («Зафиксировать») или нажатием на карту.');
      rec.lat = state.lat;
      rec.lon = state.lon;
      rec.coord_source = state.source;
      rec.coord_accuracy_m = state.acc;
      if (k === 'place_existing') {
        var t = treeById[$('f-existing').value];
        if (!t || ECO.hasCoords(t) || localClaims()[t.id]) throw new Error('Выберите ещё не отмеченное дерево.');
        rec.id = t.id;
        rec.species = t.species;
        rec.planted_year = t.planted_year;
        rec.planted_date = t.planted_date || null;
        rec.event = t.event || '';
        return rec;
      }
      // новое дерево
      rec.species = selSpecies.value;
      if (rec.species === 'other') {
        rec.species_note = cleanText($('f-species-note').value, LIMITS.species_note);
        if (!rec.species_note) throw new Error('Для «Другая порода» укажите название породы (до 60 знаков).');
      }
      rec.id = nextNewId(rec.species);
      if (!rec.id) throw new Error('Не удалось выдать номер для этой породы.');
      var y = Number($('f-year').value);
      var cy = new Date().getFullYear();
      if (!(Math.floor(y) === y && y >= 1900 && y <= cy)) throw new Error('Укажите год посадки (1900–' + cy + ').');
      rec.planted_year = y;
      var d = $('f-date').value;
      if (d) {
        if (!ECO.parseDate(d) || d > todayIso()) throw new Error('Дата посадки некорректна или в будущем.');
        if (+d.slice(0, 4) !== y) throw new Error('Год в дате посадки не совпадает с годом посадки.');
        rec.planted_date = d;
      }
      rec.event = selEvent.value === EVENT_CUSTOM ? cleanText($('f-event-custom').value, LIMITS.event) : selEvent.value;
      return rec;
    }
    // ---------- форма на время съёмки ----------
    var FORM_KEY = 'ecotreemap_field_form_v1';
    var FORM_FIELDS = ['f-species', 'f-existing', 'f-year', 'f-date', 'f-inspect-id', 'f-status', 'f-event', 'f-event-custom',
      'f-observed', 'f-notes', 'f-author', 'f-species-note'];
    function sessionGet(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
    function sessionSet(k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* хранилище недоступно */ } }
    function sessionRemove(k) { try { window.sessionStorage.removeItem(k); } catch (e) { /* хранилище недоступно */ } }
    function saveFormForCamera() {
      var v = {};
      FORM_FIELDS.forEach(function (id) { v[id] = $(id).value; });
      sessionSet(FORM_KEY, JSON.stringify({
        kind: kind(), values: v, watered: $('f-watered').checked, // флажок: .value у checkbox не отражает отметку
        point: state.lat === null ? null : { lat: state.lat, lon: state.lon, source: state.source, acc: state.acc }
      }));
    }
    function restoreFormAfterCamera() {
      var raw = sessionGet(FORM_KEY);
      if (!raw) return false;
      sessionRemove(FORM_KEY);
      var s;
      try { s = JSON.parse(raw); } catch (e) { return false; }
      if (!s || typeof s !== 'object' || !s.values || typeof s.values !== 'object') return false;
      var radio = document.querySelector('input[name="kind"][value="' + (ECO.hasOwn(KIND_TEXT, s.kind) ? s.kind : 'place_existing') + '"]');
      if (radio) radio.checked = true;
      // сначала порода (от неё зависит список номеров), потом остальное
      ['f-species'].concat(FORM_FIELDS.filter(function (id) { return id !== 'f-species'; })).forEach(function (id) {
        if (typeof s.values[id] !== 'string') return;
        if (id === 'f-existing') fillExisting();
        $(id).value = s.values[id];
      });
      $('box-event-custom').hidden = selEvent.value !== EVENT_CUSTOM;
      var pt = s.point;
      if (pt && typeof pt === 'object' && typeof pt.lat === 'number' && typeof pt.lon === 'number' &&
          ['gps', 'gps-low', 'gps+manual', 'manual'].indexOf(pt.source) !== -1) {
        setPoint(pt.lat, pt.lon, pt.source, typeof pt.acc === 'number' ? pt.acc : null);
      }
      updateKindKeep();
      pickInspect();
      $('f-watered').checked = s.watered === true;
      $('photo-status').textContent = 'Форма восстановлена после перезагрузки страницы. Выберите фото ещё раз.';
      return true;
    }

    function resetForm() {
      sessionRemove(FORM_KEY);
      nearest.locked = false;
      state.lat = state.lon = state.acc = state.source = null;
      state.photo = null;
      if (marker && map) { map.removeLayer(marker); marker = null; }
      $('coord-line').textContent = 'Точка не поставлена.';
      $('f-notes').value = '';
      photoInput.value = '';
      $('photo-preview').hidden = true;
      $('photo-status').textContent = '';
      selStatus.value = '';
      $('f-watered').checked = false;
      $('f-species-note').value = '';
    }
    $('btn-save').addEventListener('click', function () {
      if (state.saving) return;
      var rec;
      try { rec = buildRecord(); } catch (e) { result(e.message, true); return; }
      var base = siteBase();
      rec.qr_pending = rec.kind !== 'inspect' && !base;
      state.saving = true;
      STORE.save(rec, state.photo).then(function () {
        records.push(rec);
        STORE.persist();
        result('Сохранено на телефоне: ' + rec.id + '. Номер закреплён за этой записью.' +
          (rec.qr_pending ? ' QR не построен: адрес сайта не задан — табличку можно будет сделать позже.' : ''), rec.qr_pending);
        if (rec.kind !== 'inspect') showPlaque(rec);
        resetForm();
        updateKind();
        renderRecords();
      }, function (e) {
        result('Не удалось сохранить: ' + (e && e.message ? e.message : e), true);
      }).then(function () { state.saving = false; });
    });

    // Быстрая отметка полива: тот же путь, что осмотр (выгрузка → tools/merge_field.py → история на сайте).
    $('btn-water-quick').addEventListener('click', function () {
      $('f-watered').checked = true;
      $('btn-save').click();
    });
    // Ссылка с паспорта: field.html?id=L-001&action=water — сразу осмотр этого дерева с отметкой полива.
    function openFromLink() {
      var q = new URLSearchParams(window.location.search);
      var id = (q.get('id') || '').trim().toUpperCase();
      if (!ECO.ID_RE.test(id) || !findTree(id)) return false;
      document.querySelector('input[name="kind"][value="inspect"]').checked = true;
      updateKind();
      $('f-inspect-id').value = id;
      pickInspect();
      if (q.get('action') === 'water') {
        $('f-watered').checked = true;
        result('Дерево ' + id + ': отметка «Полил(а)» выбрана. Нажмите «Сохранить запись на телефоне». ' +
          'Отметка появится на сайте после выгрузки и добавления координатором.', false);
      }
      return true;
    }

    // ---------- табличка ----------
    var plaqueCanvas = null, plaqueId = null;
    function showPlaque(rec) {
      var base = siteBase();
      var card = $('plaque-card');
      if (!base || typeof window.qrcode !== 'function') {
        card.hidden = true;
        return false;
      }
      var url = treeUrl(base, rec.id);
      plaqueCanvas = qrCanvas(url, 12);
      plaqueId = rec.id;
      $('plaque-qr').src = plaqueCanvas.toDataURL('image/png');
      $('plaque-id').textContent = rec.id;
      $('plaque-species').textContent = species[rec.species] ? species[rec.species].name_ru : '';
      $('plaque-url').textContent = 'QR ведёт на: ' + url;
      card.hidden = false;
      return true;
    }
    $('btn-print').addEventListener('click', function () {
      // Класс снимаем по afterprint, а не по таймеру: в мобильном Chrome window.print() не блокирует,
      // и таймер успевал бы вернуть всю страницу до снимка для печати. Класс действует только в @media print.
      document.body.classList.add('print-plaque');
      window.addEventListener('afterprint', function done() {
        document.body.classList.remove('print-plaque');
        window.removeEventListener('afterprint', done);
      });
      window.print();
    });
    $('btn-png').addEventListener('click', function () {
      if (!plaqueCanvas) return;
      plaqueCanvas.toBlob(function (blob) { download(blob, 'qr-' + plaqueId + '.png'); }, 'image/png');
    });
    function download(blob, name) {
      var url = URL.createObjectURL(blob);
      var a = el('a', { href: url, attrs: { download: name } });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    // ---------- список и выгрузка ----------
    function pending() {
      return records.filter(function (r) { return !r.exported_at || r.updated_at > r.exported_at; });
    }
    var KIND_TEXT = { place_existing: 'место', new_tree: 'новое', inspect: 'осмотр' };
    function renderRecords() {
      var ul = ECO.clear($('records-list'));
      records.slice().sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }).forEach(function (r) {
        var li = el('li', null, [
          el('b', { text: r.id }),
          ' · ' + KIND_TEXT[r.kind] + ' · ' + (r.status ? STATUS_TEXT[r.status] || r.status : 'без состояния') +
            (r.watered ? ' · полито' : '') + (r.photo ? ' · фото' : '') + ' · ' + (r.exported_at ? 'выгружено' : 'не выгружено')
        ]);
        if (r.kind !== 'inspect' && siteBase()) {
          li.appendChild(el('button', { type: 'button', className: 'btn btn--outline', text: 'Табличка', onclick: function () { showPlaque(r); $('plaque-card').scrollIntoView(); } }));
        }
        ul.appendChild(li);
      });
      if (!records.length) ul.appendChild(el('li', { className: 'muted', text: 'Записей пока нет.' }));
      var n = pending().length;
      var b = $('pending-banner');
      b.textContent = n + ' ' + ECO.plural(n, ['запись', 'записи', 'записей']) + ' ' +
        ECO.plural(n, ['не выгружена', 'не выгружены', 'не выгружено']) + ' — нажмите «Выгрузить новые» внизу страницы.';
      b.hidden = n === 0;
    }
    function blobToBase64(blob) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result).replace(/^data:[^,]*,/, '')); };
        fr.onerror = function () { reject(fr.error); };
        fr.readAsDataURL(blob);
      });
    }
    function stamp(d) {
      return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes());
    }
    function exportRecords(all) {
      var list = all ? records.slice() : pending();
      if (!list.length) {
        $('export-status').textContent = all ? 'Записей нет.' : 'Новых записей нет — всё уже выгружено.';
        return Promise.resolve(null);
      }
      var when = new Date();
      var parts = [];
      var head = { format: 'ecotreemap-field', version: 1, device: device, exported_at: when.toISOString() };
      var clean = list.map(function (r) {
        var c = {};
        Object.keys(r).forEach(function (k) { if (k !== 'exported_at') c[k] = r[k]; });
        return c;
      });
      parts.push(JSON.stringify(head).slice(0, -1) + ',"records":' + JSON.stringify(clean) + ',"photos":{');
      var first = true;
      return list.reduce(function (p, r) {
        return p.then(function () {
          if (!r.photo) return;
          return STORE.getPhoto(r.record_uid).then(function (blob) {
            if (!blob) return;
            return blobToBase64(blob).then(function (b64) {
              parts.push((first ? '' : ',') + JSON.stringify(r.record_uid) + ':"' + b64 + '"');
              first = false;
            });
          });
        });
      }, Promise.resolve()).then(function () {
        parts.push('}}');
        var name = 'ecotreemap-field-' + device + '-' + stamp(when) + '.json';
        download(new Blob(parts, { type: 'application/json' }), name);
        askExportSaved(list, when.toISOString(), name);
        return name;
      }).catch(function (e) {
        $('export-status').textContent = 'Выгрузка не удалась: ' + (e && e.message ? e.message : e);
      });
    }
    // Скачивание браузер может отменить (нет места, пользователь закрыл диалог) — узнать об этом страница не может.
    // Поэтому записи помечаются «выгружено» только после подтверждения «Файл сохранён».
    var exportAsk = null;
    function askExportSaved(list, iso, name) {
      exportAsk = { list: list, iso: iso, name: name };
      $('export-confirm-text').textContent = 'Проверьте, что файл ' + name + ' сохранился (обычно папка «Загрузки»). ' +
        'Пока вы не подтвердите, записи остаются «не выгружено» и попадут в следующую выгрузку.';
      $('export-confirm').hidden = false;
      $('export-status').textContent = 'Файл ' + name + ' отправлен на скачивание — подтвердите сохранение.';
    }
    $('export-saved').addEventListener('click', function () {
      var a = exportAsk;
      exportAsk = null;
      $('export-confirm').hidden = true;
      if (!a) return;
      STORE.markExported(a.list.map(function (r) { return r.record_uid; }), a.iso).then(function () {
        a.list.forEach(function (r) { r.exported_at = a.iso; });
        renderRecords();
        $('export-status').textContent = 'Выгружено ' + a.list.length + ' ' + ECO.plural(a.list.length, ['запись', 'записи', 'записей']) +
          ' в файл ' + a.name + '. Передайте файл координатору.';
      }, function (e) {
        $('export-status').textContent = 'Не удалось отметить записи выгруженными: ' + (e && e.message ? e.message : e);
      });
    });
    $('export-not-saved').addEventListener('click', function () {
      exportAsk = null;
      $('export-confirm').hidden = true;
      $('export-status').textContent = 'Записи остались «не выгружено». Освободите место или проверьте разрешения и нажмите «Выгрузить новые» ещё раз.';
    });
    $('btn-export').addEventListener('click', function () { exportRecords(false); });
    $('btn-export-all').addEventListener('click', function () { exportRecords(true); });

    // ---------- баннер про адрес сайта ----------
    var problem = baseUrlProblem(cfg.SITE_BASE_URL);
    if (problem) {
      $('qr-banner').textContent = 'QR-таблички не строятся: ' + problem +
        '. Записи сохраняются как обычно; таблички можно будет сделать позже.';
      $('qr-banner').hidden = false;
    }

    window.ECO_FIELD = {
      baseUrlProblem: baseUrlProblem, treeUrl: treeUrl, nextNewId: nextNewId, processPhoto: processPhoto,
      exportRecords: exportRecords, records: function () { return records; }, prefixOf: prefixOf, state: state, map: map, formKey: FORM_KEY,
      marker: function () { return marker; }, threshold: THRESHOLD
    };

    return STORE.all().then(function (list) {
      records = (list || []).filter(function (r) { return r && typeof r.record_uid === 'string' && ECO.ID_RE.test(r.id || ''); });
      // все деревья реестра уже на карте (и не заняты записями этого телефона) — по умолчанию «Осмотр»
      var claimed = localClaims();
      if (!trees.some(function (t) { return !ECO.hasCoords(t) && !claimed[t.id]; })) {
        document.querySelector('input[name="kind"][value="inspect"]').checked = true;
      }
      updateKind();
      if (!restoreFormAfterCamera()) openFromLink();
      renderRecords();
      window.ECO_PAGE_DONE = true;
    }, function (e) {
      ECO.showFatal('Хранилище браузера недоступно', [String(e && e.message ? e.message : e),
        'Без него записи негде сохранить. Откройте страницу в обычном (не приватном) окне браузера.']);
    });
  }

  try {
    var p = main();
    if (p && p.catch) p.catch(function (e) { ECO.showFatal('Ошибка полевого режима', [String(e && e.message ? e.message : e)]); });
  } catch (e) {
    ECO.showFatal('Ошибка полевого режима', [String(e && e.message ? e.message : e)]);
  }
})();
