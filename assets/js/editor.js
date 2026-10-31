// EcoTreeMap — редактор мест посадки (tools/editor.html).
// Режимы: «Точка» (клик = место одного дерева) и «Ряд» (начало + конец + N → N равномерных точек
// для следующих неотмеченных деревьев выбранной породы/года). Отмена, черновик в браузере,
// экспорт готового data/trees.js. Внешних сервисов, кроме тайлов OpenStreetMap, не использует.
(function () {
  'use strict';
  var ECO = window.ECO;
  if (!ECO) return;
  // Страховка от смешения версий в кэше браузера (этот файл новее common.js): нет функции — тихая деградация.
  if (typeof ECO.t !== 'function') ECO.t = window.ECO_T || function (k, ru) { return ru; };
  if (typeof ECO.spName !== 'function') ECO.spName = function (sp) { return sp ? sp.name_ru : ''; };
  if (typeof ECO.PATRON_MAX !== 'number') ECO.PATRON_MAX = 80;
  var el = ECO.el;
  var L = window.L;

  // Черновик v2: только изменённые номера + отпечаток data/trees.js, на котором он сделан.
  // Если сайт обновился после черновика (отпечаток другой), восстановить черновик нельзя —
  // он затёр бы новые данные; его можно только скачать файлом или удалить.
  var DRAFT_KEY = 'ecotreemap_editor_draft_v2';
  var LEGACY_DRAFT_KEYS = ['ecotreemap_editor_draft_v1']; // старый формат: все номера, без отпечатка
  var AUTO = ''; // значение «следующее неотмеченное» в списке деревьев

  var TREES_HEADER = [
    "// EcoTreeMap — реестр посаженных деревьев (по одному объекту на дерево, одна строка — одно дерево).",
    "// Файл .js (а не .json), чтобы сайт открывался с флешки (file://) без сервера.",
    "// Поля: id — номер дерева (он же в QR и в адресе pages/tree.html?id=...);",
    "//   L-001…L-096 — липа (2026), C-001…C-047 — черёмуха (2025), Y-001…Y-006 — яблоня (2022);",
    "//   species — ключ породы из data/species.js; planted_year — год посадки;",
    "//   planted_date — дата посадки ГГГГ-ММ-ДД (null = не уточнена);",
    "//   lat/lon — координаты (null = место ещё не отмечено; отмечать в tools/editor.html или tools/field.html);",
    "//   status — состояние: healthy здоровое, needs_water нужен полив, needs_check требуется осмотр,",
    "//     damaged повреждено, sick болеет, dead засохло/погибло (null = не обследовано);",
    "//   event — название акции (\"\" = уточняется); notes — заметки (видны всем).",
    "// Необязательные поля (появляются после слияния полевых записей tools/merge_field.py):",
    "//   status_date — дата осмотра, к которой относится status; photo — фото дерева \"trees/<номер>.jpg\"",
    "//   в папке images/; photo_date — дата снимка; observations — история осмотров [{date, status, notes}]",
    "//   (до 10, новые сверху); coord_accuracy_m — точность GPS в метрах; coord_source — gps | gps-low | gps+manual | manual",
    "//   (gps-low — GPS хуже порога точности, место приблизительное; manual — поставлено вручную на карте).",
    "// Номера новых пород: префикс из data/species.js (1–2 буквы: TB-001); species \"other\" — «Другая порода»,",
    "//   её название — в species_note (до 60 знаков). observations[].watered = true — отметка полива;",
    "//   observations[].photo — фото осмотра \"trees/<номер>/<ГГГГ-ММ-ДД>.jpg\" (photo дерева — последнее фото).",
    "// Шефство (только tools/editor.html): patron — класс или группа (до 80 знаков, без имён); patron_since — дата.",
    "// Не вписывайте сюда числа и факты без подтверждения."
  ];

  function round6(x) {
    return Math.round(x * 1e6) / 1e6;
  }

  function coordsOf(t) {
    return ECO.hasCoords(t) ? [t.lat, t.lon] : null;
  }

  function sameCoords(a, b) {
    if (!a || !b) return !a && !b;
    return a[0] === b[0] && a[1] === b[1];
  }

  // Отпечаток реестра: длина сериализации + FNV-1a (32 бита). Меняется при любом изменении data/trees.js.
  function fingerprint(arr) {
    var s = JSON.stringify(arr);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return s.length + ':' + ('0000000' + h.toString(16)).slice(-8);
  }

  // Шефство дерева: [patron, patron_since] или null.
  function patronOf(t) {
    return ECO.hasOwn(t, 'patron') && typeof t.patron === 'string' && t.patron
      ? [t.patron, typeof t.patron_since === 'string' ? t.patron_since : null] : null;
  }
  function samePatron(a, b) {
    if (!a || !b) return !a && !b;
    return a[0] === b[0] && a[1] === b[1];
  }
  function setPatron(t, v) {
    if (v) {
      t.patron = v[0];
      t.patron_since = v[1];
    } else {
      delete t.patron;
      delete t.patron_since;
    }
  }

  function main() {
    if (!Array.isArray(window.ECO_TREES) || !window.ECO_SPECIES) {
      ECO.showFatal('Данные не загрузились', ['Не найдены data/trees.js или data/species.js рядом с папкой tools/.']);
      return;
    }
    if (typeof L === 'undefined') {
      ECO.showFatal('Карта не загрузилась', ['Не найдена библиотека Leaflet (assets/lib/leaflet).']);
      return;
    }

    // Полная копия исходного массива: экспорт сохраняет все поля и порядок записей.
    var records = JSON.parse(JSON.stringify(window.ECO_TREES));
    var BASE_FP = fingerprint(window.ECO_TREES);
    var species = window.ECO_SPECIES;
    var byId = Object.create(null); // без прототипа: ключи __proto__/constructor — обычные строки
    records.forEach(function (t) {
      if (t && typeof t.id === 'string' && !ECO.hasOwn(byId, t.id)) byId[t.id] = t;
    });
    var ids = Object.keys(byId);
    var baseCoords = Object.create(null); // координаты из загруженного data/trees.js — от них считается черновик
    ids.forEach(function (id) { baseCoords[id] = coordsOf(byId[id]); });
    var basePatron = Object.create(null); // шефство из загруженного data/trees.js
    ids.forEach(function (id) { basePatron[id] = patronOf(byId[id]); });

    var $ = function (id) { return document.getElementById(id); };
    var selSpecies = $('sel-species');
    var selYear = $('sel-year');
    var selTree = $('sel-tree');
    var rowN = $('row-n');
    var hint = $('hint');

    var undoStack = [];
    var rowStart = null;
    var rowStartMarker = null;
    var rowLine = null;
    var draftPending = null; // черновик, по которому пользователь ещё не решил

    // ---------- выборки ----------
    function mode() {
      return document.querySelector('input[name="mode"]:checked').value;
    }
    function speciesName(key) {
      return species[key] ? species[key].name_ru : key;
    }
    function groupTrees() {
      var sp = selSpecies.value;
      var yr = selYear.value;
      return ids
        .map(function (id) { return byId[id]; })
        .filter(function (t) { return t.species === sp && (yr === '' || String(t.planted_year) === yr); });
    }
    function nextUnplaced(n) {
      return groupTrees().filter(function (t) { return !ECO.hasCoords(t); }).slice(0, n);
    }

    // ---------- списки выбора ----------
    var speciesKeys = [];
    ids.forEach(function (id) {
      var k = byId[id].species;
      if (speciesKeys.indexOf(k) === -1) speciesKeys.push(k);
    });
    Object.keys(species).forEach(function (k) {
      if (speciesKeys.indexOf(k) === -1 && species[k]) speciesKeys.push(k);
    });
    speciesKeys.forEach(function (k) {
      var count = ids.filter(function (id) { return byId[id].species === k; }).length;
      selSpecies.appendChild(el('option', { value: k, text: speciesName(k) + (count ? '' : ' — деревьев нет') }));
    });

    function fillYears() {
      ECO.clear(selYear);
      selYear.appendChild(el('option', { value: '', text: 'все годы' }));
      var years = [];
      ids.forEach(function (id) {
        var t = byId[id];
        if (t.species === selSpecies.value && years.indexOf(t.planted_year) === -1) years.push(t.planted_year);
      });
      years.sort(function (a, b) { return b - a; });
      years.forEach(function (y) { selYear.appendChild(el('option', { value: String(y), text: String(y) })); });
    }

    function fillTrees() {
      var keep = selTree.value;
      ECO.clear(selTree);
      selTree.appendChild(el('option', { value: AUTO, text: '— следующее неотмеченное —' }));
      groupTrees().forEach(function (t) {
        selTree.appendChild(el('option', { value: t.id, text: t.id + (ECO.hasCoords(t) ? '  ✓ отмечено' : '') }));
      });
      selTree.value = keep && groupTrees().some(function (t) { return t.id === keep; }) ? keep : AUTO;
    }

    // ---------- карта ----------
    var cfg = window.ECO_CONFIG || {};
    var map = L.map('map', { doubleClickZoom: false }).setView(cfg.MAP_CENTER || [49.777, 73.124], cfg.MAP_ZOOM || 16);
    ECO.addOsmLayer(map, function () {
      var n = $('map-notice');
      n.textContent = 'Подложка карты не загрузилась — нужен интернет, чтобы видеть, куда ставить точки.';
      n.hidden = false;
    });

    var markers = Object.create(null);
    function makeIcon(t, selected) {
      var sp = species[t.species] || { color: '#5f6368' };
      var dot = el('div', { className: 'edit-marker' + (selected ? ' edit-marker--selected' : '') });
      dot.style.background = sp.color;
      return L.divIcon({ html: dot, className: '', iconSize: [18, 18], iconAnchor: [9, 9] });
    }

    function syncMarker(id) {
      var t = byId[id];
      var m = markers[id];
      if (!ECO.hasCoords(t)) {
        if (m) {
          map.removeLayer(m);
          delete markers[id];
        }
        return;
      }
      var selected = selTree.value === id;
      if (!m) {
        m = L.marker([t.lat, t.lon], { icon: makeIcon(t, selected), draggable: true, keyboard: false });
        m.bindTooltip(el('span', { text: t.id }));
        m.on('dragend', function () {
          var p = m.getLatLng();
          var cur = byId[id];
          apply('Перемещено ' + id, [{ id: id, before: coordsOf(cur), after: [round6(p.lat), round6(p.lng)] }]);
        });
        m.on('click', function () { selectTree(id); });
        m.addTo(map);
        markers[id] = m;
      } else {
        m.setLatLng([t.lat, t.lon]);
        m.setIcon(makeIcon(t, selected));
      }
    }

    function selectTree(id) {
      var t = byId[id];
      selSpecies.value = t.species;
      fillYears();
      selYear.value = '';
      fillTrees();
      selTree.value = id;
      refresh(false);
    }

    // ---------- действия и отмена ----------
    // Точка, поставленная или передвинутая в редакторе, — ручная: coord_source "manual", точности нет.
    // Снятая точка — без источника и точности. Остальные поля дерева не трогаются.
    function setCoords(id, c) {
      var t = byId[id];
      t.lat = c ? c[0] : null;
      t.lon = c ? c[1] : null;
      t.coord_accuracy_m = null;
      t.coord_source = c ? 'manual' : null;
    }
    function metaOf(t) {
      return {
        hasAcc: ECO.hasOwn(t, 'coord_accuracy_m'), acc: t.coord_accuracy_m,
        hasSrc: ECO.hasOwn(t, 'coord_source'), src: t.coord_source
      };
    }
    function restoreMeta(id, m) {
      var t = byId[id];
      if (m.hasAcc) t.coord_accuracy_m = m.acc; else delete t.coord_accuracy_m;
      if (m.hasSrc) t.coord_source = m.src; else delete t.coord_source;
    }

    function apply(label, changes, opts) {
      changes = changes.filter(function (ch) { return !sameCoords(ch.before, ch.after); });
      if (!changes.length) {
        refresh(false);
        return;
      }
      changes.forEach(function (ch) {
        ch.beforeMeta = metaOf(byId[ch.id]);
        setCoords(ch.id, ch.after);
      });
      undoStack.push({ label: label, changes: changes });
      if (!(opts && opts.keepSelection)) selTree.value = AUTO;
      refresh(true);
      say(label + '. ' + nextHint());
    }

    function applyPatron(label, changes) {
      changes = changes.filter(function (ch) { return !samePatron(patronOf(byId[ch.id]), ch.after); });
      if (!changes.length) {
        say(label + ': ничего не изменилось.');
        return 0;
      }
      changes.forEach(function (ch) {
        ch.before = patronOf(byId[ch.id]);
        setPatron(byId[ch.id], ch.after);
      });
      undoStack.push({ label: label, patron: true, changes: changes });
      refresh(true);
      say(label + ' — ' + changes.length + ' ' + ECO.treesWord(changes.length) + '. Не забудьте скачать trees.js.');
      return changes.length;
    }

    function undo() {
      var a = undoStack.pop();
      if (!a) return;
      if (a.patron) {
        a.changes.forEach(function (ch) { setPatron(byId[ch.id], ch.before); });
        refresh(true);
        say('Отменено: ' + a.label + '.');
        return;
      }
      a.changes.forEach(function (ch) {
        setCoords(ch.id, ch.before);
        restoreMeta(ch.id, ch.beforeMeta);
      });
      refresh(true);
      say('Отменено: ' + a.label + '. ' + nextHint());
    }

    // ---------- подсказки ----------
    function say(text, warn) {
      hint.textContent = text;
      hint.className = 'editor-hint' + (warn ? ' editor-hint--warn' : '');
    }

    function nextHint() {
      if (mode() === 'row') {
        var n = parseInt(rowN.value, 10);
        var free = nextUnplaced(Infinity).length;
        if (!(n >= 1)) return 'Укажите, сколько деревьев в ряду.';
        if (free === 0) return 'В выбранной группе все деревья уже отмечены.';
        if (n > free) return 'В группе осталось только ' + free + ' неотмеченных — уменьшите число деревьев в ряду.';
        var list = nextUnplaced(n);
        var range = list[0].id + (n > 1 ? '…' + list[n - 1].id : '');
        if (n === 1) return 'Кликните по карте — будет поставлено дерево ' + range + '.';
        return rowStart
          ? 'Кликните КОНЕЦ ряда — будет расставлено ' + n + ' ' + ECO.treesWord(n) + ': ' + range + '.'
          : 'Кликните НАЧАЛО ряда (' + n + ' ' + ECO.treesWord(n) + ': ' + range + ').';
      }
      if (selTree.value !== AUTO) {
        return 'Кликните по карте, чтобы поставить/переставить дерево ' + selTree.value + '.';
      }
      var next = nextUnplaced(1)[0];
      return next
        ? 'Кликните по карте, чтобы поставить дерево ' + next.id + '.'
        : 'В выбранной группе все деревья отмечены. Выберите дерево в списке, чтобы переставить.';
    }

    function clearRowStart() {
      rowStart = null;
      if (rowStartMarker) map.removeLayer(rowStartMarker);
      if (rowLine) map.removeLayer(rowLine);
      rowStartMarker = null;
      rowLine = null;
      $('btn-cancel-row').hidden = true;
    }

    // ---------- клик по карте ----------
    map.on('click', function (e) {
      var p = [round6(e.latlng.lat), round6(e.latlng.lng)];
      if (mode() === 'point') {
        var target = selTree.value !== AUTO ? byId[selTree.value] : nextUnplaced(1)[0];
        if (!target) {
          say('В выбранной группе все деревья отмечены. Выберите дерево в списке, чтобы переставить.', true);
          return;
        }
        apply('Отмечено ' + target.id, [{ id: target.id, before: coordsOf(target), after: p }]);
        return;
      }

      // режим «Ряд»
      var n = parseInt(rowN.value, 10);
      if (!(n >= 1) || n !== Number(rowN.value)) {
        say('Укажите целое число деревьев в ряду (1 или больше).', true);
        return;
      }
      var list = nextUnplaced(n);
      if (list.length < n) {
        say('В группе только ' + list.length + ' неотмеченных деревьев, а в ряду указано ' + n + '. Уменьшите число.', true);
        return;
      }
      if (n === 1) {
        apply('Отмечено ' + list[0].id, [{ id: list[0].id, before: null, after: p }]);
        return;
      }
      if (!rowStart) {
        rowStart = p;
        rowStartMarker = L.marker(p, {
          icon: L.divIcon({ html: el('div', { className: 'row-start-marker' }), className: '', iconSize: [22, 22], iconAnchor: [11, 11] }),
          interactive: false
        }).addTo(map);
        $('btn-cancel-row').hidden = false;
        say(nextHint());
        return;
      }
      var start = rowStart;
      var changes = list.map(function (t, i) {
        var k = i / (n - 1);
        return {
          id: t.id,
          before: null,
          after: [round6(start[0] + (p[0] - start[0]) * k), round6(start[1] + (p[1] - start[1]) * k)]
        };
      });
      clearRowStart();
      apply('Ряд: ' + list[0].id + '…' + list[n - 1].id + ' (' + n + ' ' + ECO.treesWord(n) + ')', changes);
    });

    map.on('mousemove', function (e) {
      if (!rowStart) return;
      if (!rowLine) rowLine = L.polyline([rowStart, e.latlng], { color: '#111', dashArray: '6 6', interactive: false }).addTo(map);
      else rowLine.setLatLngs([rowStart, e.latlng]);
    });

    // ---------- экспорт ----------
    function fmtValue(v) {
      return JSON.stringify(v === undefined ? null : v);
    }
    function buildTreesJs() {
      var lines = records.map(function (t) {
        var parts = Object.keys(t).map(function (k) { return JSON.stringify(k) + ': ' + fmtValue(t[k]); });
        return '  {' + parts.join(', ') + '}';
      });
      return TREES_HEADER.concat([
        '// Сохранено редактором tools/editor.html: ' + new Date().toISOString(),
        'window.ECO_TREES = ['
      ]).join('\n') + '\n' + lines.join(',\n') + '\n];\n';
    }

    function exportStatus(text) {
      $('export-status').textContent = text;
    }

    $('btn-download').addEventListener('click', function () {
      var blob = new Blob([buildTreesJs()], { type: 'text/javascript;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = el('a', { href: url, attrs: { download: 'trees.js' } });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      exportStatus('Файл trees.js скачан (обычно в папку «Загрузки»). Сохраните копию старого data/trees.js, затем замените его новым.' +
        clearDraftAfterExport());
    });

    $('btn-copy').addEventListener('click', function () {
      var ta = $('export-text');
      ta.value = buildTreesJs();
      function fallback() {
        ta.focus();
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        exportStatus(ok
          ? 'Текст скопирован. Вставьте его в data/trees.js вместо старого содержимого (копию старого файла сохраните заранее).' +
            clearDraftAfterExport()
          : 'Не удалось скопировать автоматически: текст выделен — нажмите Ctrl+C.');
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).then(function () {
          exportStatus('Текст скопирован. Вставьте его в data/trees.js вместо старого содержимого (копию старого файла сохраните заранее).' +
            clearDraftAfterExport());
        }, fallback);
      } else {
        fallback();
      }
    });

    // ---------- черновик в браузере ----------
    // Хранятся только номера, чьи координаты отличаются от загруженного data/trees.js, и отпечаток этого файла.
    function draftDiff() {
      var out = Object.create(null);
      var n = 0;
      ids.forEach(function (id) {
        var c = coordsOf(byId[id]);
        if (!sameCoords(c, baseCoords[id])) { out[id] = c; n++; }
      });
      return n ? out : null;
    }
    function draftPatrons() {
      var out = Object.create(null);
      var n = 0;
      ids.forEach(function (id) {
        var v = patronOf(byId[id]);
        if (!samePatron(v, basePatron[id])) { out[id] = v; n++; }
      });
      return n ? out : null;
    }
    function removeDraft() {
      ECO.storageRemove(DRAFT_KEY);
      LEGACY_DRAFT_KEYS.forEach(function (k) { ECO.storageRemove(k); });
    }
    function saveDraft() {
      if (draftPending) return; // не затирать черновик, пока пользователь не решил, что с ним делать
      var diff = draftDiff();
      var pd = draftPatrons();
      if (!diff && !pd) {
        ECO.storageRemove(DRAFT_KEY);
        return;
      }
      ECO.storageSet(DRAFT_KEY, JSON.stringify({ format: 2, saved_at: new Date().toISOString(), base: BASE_FP, coords: diff || {},
        patrons: pd || {} }));
    }
    function clearDraftAfterExport() {
      if (draftPending) return ' Черновик в браузере не тронут — сначала решите, что с ним делать (рамка вверху).';
      removeDraft();
      return ' Черновик в браузере очищен.';
    }
    function validDraftPoint(c) {
      return Array.isArray(c) && c.length === 2 &&
        typeof c[0] === 'number' && typeof c[1] === 'number' && isFinite(c[0]) && isFinite(c[1]) &&
        c[0] >= -90 && c[0] <= 90 && c[1] >= -180 && c[1] <= 180;
    }
    function readDraft() {
      var keys = [DRAFT_KEY].concat(LEGACY_DRAFT_KEYS);
      for (var i = 0; i < keys.length; i++) {
        var raw = ECO.storageGet(keys[i]);
        if (!raw) continue;
        var draft;
        try { draft = JSON.parse(raw); } catch (e) { continue; }
        if (!draft || typeof draft !== 'object' || typeof draft.coords !== 'object' || draft.coords === null ||
            Array.isArray(draft.coords)) continue;
        return { raw: raw, draft: draft, legacy: keys[i] !== DRAFT_KEY };
      }
      return null;
    }
    // Отличия черновика от загруженного сейчас (белый список номеров, проверка значений).
    function draftChanges(draft) {
      var changes = [];
      Object.keys(draft.coords).forEach(function (id) {
        if (!ECO.ID_RE.test(id) || !ECO.hasOwn(byId, id)) return; // только номера по схеме, которые есть в data/trees.js
        var c = draft.coords[id];
        var after = null;
        if (c !== null) {
          if (!validDraftPoint(c)) return; // битая/чужая запись черновика — игнорируется
          after = [c[0], c[1]];
        }
        var before = coordsOf(byId[id]);
        if (!sameCoords(before, after)) changes.push({ id: id, before: before, after: after });
      });
      return changes;
    }
    // Шефство из черновика: только номера реестра, строка ≤80 и дата ГГГГ-ММ-ДД (или null).
    function draftPatronChanges(draft) {
      var out = [];
      var src = draft.patrons;
      if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
      Object.keys(src).forEach(function (id) {
        if (!ECO.ID_RE.test(id) || !ECO.hasOwn(byId, id)) return;
        var v = src[id];
        var after = null;
        if (v !== null) {
          if (!Array.isArray(v) || typeof v[0] !== 'string' || !v[0].trim() || v[0].length > ECO.PATRON_MAX ||
              (v[1] !== null && !ECO.parseDate(v[1]))) return;
          after = [v[0], v[1]];
        }
        if (!samePatron(patronOf(byId[id]), after)) out.push({ id: id, after: after });
      });
      return out;
    }
    // Состав черновика словами: «3 точки», «2 записи о шефстве», «1 точка, 1 запись о шефстве».
    function draftWhat(points, patrons) {
      var what = [];
      if (points || !patrons) what.push(points + ' ' + ECO.plural(points, ['точка', 'точки', 'точек']));
      if (patrons) what.push(patrons + ' ' + ECO.plural(patrons, ['запись', 'записи', 'записей']) + ' о шефстве');
      return what.join(', ');
    }
    function draftWhen(draft) {
      var when = new Date(draft.saved_at);
      return isNaN(when.getTime()) ? '' : ' от ' + when.toLocaleString('ru-RU');
    }
    function downloadDraft(raw) {
      var blob = new Blob([raw], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var d = new Date();
      var name = 'ecotreemap-editor-draft-' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) +
        ('0' + d.getDate()).slice(-2) + '.json';
      var a = el('a', { href: url, attrs: { download: name } });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      return name;
    }
    function draftButtons(box, primary) {
      return el('div', { className: 'btn-row' }, [
        primary,
        el('button', {
          type: 'button', className: 'btn btn--outline', text: primary.textContent === 'Восстановить черновик' ? 'Отбросить' : 'Удалить черновик',
          onclick: function () {
            draftPending = null;
            box.hidden = true;
            removeDraft();
            saveDraft();
            say(nextHint());
          }
        })
      ]);
    }
    function checkDraft() {
      var found = readDraft();
      if (!found) return;
      var draft = found.draft;
      var changes = draftChanges(draft);
      var patronChanges = draftPatronChanges(draft);
      changes.patrons = patronChanges;
      if (!changes.length && !patronChanges.length) {
        removeDraft(); // черновик ничем не отличается от загруженного — терять нечего
        return;
      }
      var box = $('draft-box');
      var fresh = !found.legacy && draft.base === BASE_FP;
      draftPending = changes;
      ECO.clear(box);
      if (fresh) {
        box.appendChild(el('p', {
          style: 'margin:0 0 8px',
          text: 'Найден несохранённый черновик' + draftWhen(draft) + ': ' + (changes.length + patronChanges.length) + ' ' +
            ECO.plural(changes.length + patronChanges.length, ['отличие', 'отличия', 'отличий']) +
            ' от data/trees.js. Пока вы не решите, новые правки в черновик не записываются.'
        }));
        box.appendChild(draftButtons(box, el('button', {
          type: 'button', className: 'btn btn--primary', text: 'Восстановить черновик',
          onclick: function () {
            var ch = draftPending;
            draftPending = null;
            box.hidden = true;
            if (ch.length) apply('Восстановлен черновик', ch);
            if (ch.patrons.length) applyPatron('Восстановлено шефство из черновика', ch.patrons);
          }
        })));
      } else {
        // Сайт обновился после черновика: восстановление затёрло бы новые данные — не предлагаем.
        box.appendChild(el('p', {
          style: 'margin:0 0 8px',
          text: 'Найден черновик' + draftWhen(draft) + ' (' + draftWhat(changes.length, patronChanges.length) +
            '), но сайт обновился после черновика: ' +
            'data/trees.js изменился. Восстановить черновик нельзя — он затёр бы новые данные. ' +
            'Скачайте черновик как файл (точки из него можно перенести вручную) или удалите его. ' +
            'Пока вы не решите, новые правки в черновик не записываются.'
        }));
        box.appendChild(draftButtons(box, el('button', {
          type: 'button', className: 'btn btn--primary', text: 'Скачать черновик как файл',
          onclick: function () {
            var name = downloadDraft(found.raw);
            say('Черновик скачан: ' + name + ' (папка «Загрузки»). Теперь его можно удалить из браузера.');
          }
        })));
      }
      box.hidden = false;
    }

    // ---------- обновление интерфейса ----------
    function refresh(changed) {
      ids.forEach(syncMarker);
      var placed = ids.filter(function (id) { return ECO.hasCoords(byId[id]); }).length;
      var perSpecies = speciesKeys.map(function (k) {
        var g = ids.filter(function (id) { return byId[id].species === k; });
        return speciesName(k) + ' ' + g.filter(function (id) { return ECO.hasCoords(byId[id]); }).length + '/' + g.length;
      });
      $('progress').textContent = 'Отмечено: ' + placed + ' из ' + ids.length + ' (' + perSpecies.join(', ') + ')';
      fillTrees();
      var sel = selTree.value;
      $('btn-remove').disabled = !(sel !== AUTO && ECO.hasCoords(byId[sel]));
      $('btn-undo').disabled = undoStack.length === 0;
      $('export-text').value = buildTreesJs();
      if (changed) saveDraft();
    }

    // ---------- события элементов ----------
    selSpecies.addEventListener('change', function () {
      fillYears();
      clearRowStart();
      selTree.value = AUTO;
      refresh(false);
      say(nextHint());
    });
    selYear.addEventListener('change', function () {
      clearRowStart();
      refresh(false);
      say(nextHint());
    });
    selTree.addEventListener('change', function () {
      refresh(false);
      say(nextHint());
    });
    rowN.addEventListener('input', function () { say(nextHint()); });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="mode"]'), function (r) {
      r.addEventListener('change', function () {
        clearRowStart();
        $('row-options').hidden = mode() !== 'row';
        say(nextHint());
      });
    });
    $('btn-undo').addEventListener('click', undo);

    // ---------- шефство: выбранное дерево / вся группа (порода+год) / диапазон номеров группы ----------
    // Похоже ли название шефа на имя человека: нет цифр и маркеров коллектива (класс, группа, школа, кружок,
    // отряд, команда, семья, клуб…), и это 2–3 слова с заглавной буквы («Иванов Пётр», «Анна С.»).
    // Та же эвристика — в tools/build_publish.py (patron_looks_like_person): там это непроходная проверка сборки.
    var PATRON_GROUP_RE = /(?:^|[^a-zа-яёәғқңөұүһі])(?:класс|кл\.|групп|школ|кружок|кружк|отряд|команд|семья|семьи|семей|клуб|гимнази|лицей|колледж|студи|секци|волонт|сынып|мектеп|үйірме)/i;
    var PATRON_NAME_WORD_RE = /^(?:[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ][a-zа-яёәғқңөұүһі]+(?:-[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ][a-zа-яёәғқңөұүһі]+)?|[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]\.(?:[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]\.)?)$/;
    function patronLooksLikePerson(name) {
      var v = String(name || '').replace(/\s+/g, ' ').trim();
      if (!v || /[0-9]/.test(v) || PATRON_GROUP_RE.test(v)) return false;
      var words = v.replace(/([A-ZА-ЯЁӘҒҚҢӨҰҮҺІ]\.)(?=[A-ZА-ЯЁӘҒҚҢӨҰҮҺІ])/g, '$1 ').split(' ');
      return words.length >= 2 && words.length <= 3 && words.every(function (w) { return PATRON_NAME_WORD_RE.test(w); });
    }
    function patronTargets() {
      var scope = $('patron-scope').value;
      if (scope === 'selected') return selTree.value === AUTO ? [] : [selTree.value];
      var group = groupTrees().map(function (t) { return t.id; });
      if (scope === 'group') return group;
      var from = $('patron-from').value.trim().toUpperCase();
      var to = $('patron-to').value.trim().toUpperCase();
      if (!ECO.ID_RE.test(from) || !ECO.ID_RE.test(to)) return null;
      if (from > to) { var x = from; from = to; to = x; }
      return group.filter(function (id) { return id >= from && id <= to && id.split('-')[0] === from.split('-')[0]; });
    }
    function updatePatronScope() { $('patron-range').hidden = $('patron-scope').value !== 'range'; }
    $('patron-scope').addEventListener('change', updatePatronScope);
    updatePatronScope();
    $('btn-patron-set').addEventListener('click', function () {
      var name = $('patron-name').value.replace(/\s+/g, ' ').trim();
      if (!name || name.length > ECO.PATRON_MAX) { say('Укажите шефа: класс или группу (до 80 знаков, без имён и фамилий).', true); return; }
      var since = $('patron-since').value || null;
      if (since && !ECO.parseDate(since)) { say('Дата начала шефства некорректна.', true); return; }
      var targets = patronTargets();
      if (targets === null) { say('Укажите номера «с» и «по» в формате L-001.', true); return; }
      if (!targets.length) { say('Не выбрано ни одного дерева для шефства.', true); return; }
      var personWarn = 'Похоже на имя человека. Укажите класс или группу (например «8 «Б» класс, школа №…»).';
      if (patronLooksLikePerson(name) &&
          !window.confirm(personWarn + '\n\nШефство видно всем на сайте. Всё равно назначить «' + name + '»?')) {
        say(personWarn + ' Шеф не назначен.', true);
        return;
      }
      var n = applyPatron('Назначен шеф «' + name + '»', targets.map(function (id) { return { id: id, after: [name, since] }; }));
      if (n && /(?:^|[^a-zа-яё])(?:семья|семьи|семей)/i.test(name)) {
        say(hint.textContent + ' Совет: название семьи видно всем на сайте — по возможности укажите класс или кружок.');
      }
    });
    $('btn-patron-clear').addEventListener('click', function () {
      var targets = patronTargets();
      if (targets === null) { say('Укажите номера «с» и «по» в формате L-001.', true); return; }
      if (!targets.length) { say('Не выбрано ни одного дерева.', true); return; }
      applyPatron('Снят шеф', targets.map(function (id) { return { id: id, after: null }; }));
    });
    $('btn-cancel-row').addEventListener('click', function () {
      clearRowStart();
      say(nextHint());
    });
    $('btn-remove').addEventListener('click', function () {
      var id = selTree.value;
      if (id === AUTO || !ECO.hasCoords(byId[id])) return;
      apply('Снята точка ' + id, [{ id: id, before: coordsOf(byId[id]), after: null }]);
    });
    document.addEventListener('keydown', function (e) {
      var tag = e.target && e.target.tagName;
      var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я') && !typing) {
        e.preventDefault();
        undo();
      } else if (e.key === 'Escape' && rowStart) {
        clearRowStart();
        say(nextHint());
      }
    });

    // ---------- старт ----------
    fillYears();
    refresh(false);
    var placedNow = ids.filter(function (id) { return ECO.hasCoords(byId[id]); });
    if (placedNow.length) {
      map.fitBounds(L.latLngBounds(placedNow.map(function (id) { return [byId[id].lat, byId[id].lon]; })), { padding: [30, 30], maxZoom: 18 });
    }
    say(nextHint());
    checkDraft();

    window.ECO_EDITOR = { map: map, records: records, byId: byId, buildTreesJs: buildTreesJs, baseFingerprint: BASE_FP, draftKey: DRAFT_KEY,
      patronLooksLikePerson: patronLooksLikePerson }; // для автоматических проверок
    window.ECO_PAGE_DONE = true;
  }

  try {
    main();
  } catch (e) {
    ECO.showFatal('Ошибка в редакторе', [String(e && e.message ? e.message : e)]);
  }
})();
