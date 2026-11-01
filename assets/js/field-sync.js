// EcoTreeMap — онлайн-отправка записей полевого режима (очередь поверх IndexedDB из field-store.js).
// Работает только когда вошла ПОДТВЕРЖДЁННАЯ команда (сессия и профиль — db.js). Без входа ничего не
// отправляет: записи живут на телефоне и уходят файлом JSON (merge_field.py), как раньше.
//
// Порядок отправки записи (каждый шаг идемпотентен, повтор безопасен):
//   1) фото: строка photos (pending, pending_path = <team_id>/<record_uid>.jpg)  → sync_step 'photo_row'
//   2) фото: файл в бакет photos-pending (image/jpeg, без перезаписи)             → sync_step 'photo_file'
//   3) основная строка: осмотр → observations, место/новое дерево → tree_proposals → sync_step 'done', synced_at
// Первичный ключ строки = record_uid записи: обычный insert, «уже есть» (23505, у файла — 409/Duplicate) = успех.
// Поле author и координаты осмотра в базу не уходят.
// Ошибки:
//   * останавливают очередь до нажатия «Отправить сейчас»: rate_limit по осмотрам/предложениям; 42501 и отказ
//     row-level security у строки таблицы (команда не подтверждена/приостановлена); сеанс входа закончился
//     (401, PGRST301, PGRST303, просроченный токен у Storage);
//   * помечают только эту запись, очередь идёт дальше: rate_limit по фото (за сутки или 300 всего) — основная
//     строка без фото отдельно не уходит; отказ Storage на файле фото («база не приняла фото»); прочие отказы
//     базы (23503 — нет дерева, 23514 — проверка данных) и запись, заведомо не проходящая проверки базы;
//   * временные (нет связи, сбой сервера) — повтор позже.
// Помеченные записи автоматически не повторяются; «Отправить сейчас» повторяет и их.
// Вывод на страницу — только textContent / createElement.
(function () {
  'use strict';
  var ECO = window.ECO;
  var STORE = window.ECO_FIELD_STORE;
  if (!ECO || !STORE) return;

  var IDENTITY_KEY = 'ecotreemap_field_team'; // команда последнего входа (для работы без связи); не секрет
  var LOCK_NAME = 'ecotreemap-field-sync';
  var BUCKET = 'photos-pending';
  var STEP_ORDER = { photo_row: 1, photo_file: 2, done: 3 };
  var RETRY_MS = [30000, 60000, 120000, 300000];
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var KINDS = { inspect: 'observations', place_existing: 'tree_proposals', new_tree: 'tree_proposals' };

  var TEXT = {
    notApproved: 'Онлайн-база не принимает записи: команда не подтверждена модератором или её работа приостановлена. ' +
      'Отправка остановлена, записи сохранены на телефоне — их можно выгрузить файлом JSON (раздел 4).',
    stoppedTail: ' Отправка остановлена; записи сохранены на телефоне. Повторить — кнопкой «Отправить сейчас».',
    noTree: 'Этого дерева ещё нет в онлайн-базе (новое дерево ждёт модератора?). Запись осталась на телефоне — ' +
      'выгрузите её файлом JSON.',
    proposalFk: 'База не приняла: проверьте породу/номер дерева. Запись осталась на телефоне — ' +
      'выгрузите её файлом JSON и передайте координатору.',
    photoDay: 'Фото не принято: лимит фото команды за сутки исчерпан. Запись осталась на телефоне и не отправлена — ' +
      'нажмите «Отправить сейчас» завтра или выгрузите её файлом JSON.',
    photoTotal: 'Фото не принято: достигнут общий лимит фото команды, обратитесь к модератору. ' +
      'Запись осталась на телефоне и не отправлена — её можно выгрузить файлом JSON.',
    photoRejected: 'База не приняла фото этой записи. Запись осталась на телефоне и не отправлена — ' +
      'выгрузите её файлом JSON и передайте координатору.',
    session: 'Сеанс входа закончился. Войдите снова на странице аккаунта.',
    badYear: 'Год посадки должен быть не раньше 1950 — база такую запись не примет. Запись осталась на телефоне — ' +
      'выгрузите её файлом JSON и передайте координатору.',
    badDate: 'Дата осмотра должна быть не раньше 01.01.2020 и не в будущем — база такую запись не примет. ' +
      'Запись осталась на телефоне — выгрузите её файлом JSON и передайте координатору.',
    rejected: 'Онлайн-база не приняла запись (данные не прошли проверку). Запись осталась на телефоне — ' +
      'выгрузите её файлом JSON и передайте координатору.',
    offline: 'Нет связи — записи отправятся, когда появится интернет.',
    temporary: 'Нет связи с онлайн-базой или она временно не отвечает.',
    retryTail: ' Записи сохранены на телефоне; повторная отправка — автоматически чуть позже.',
    provisional: 'табличку печатать после подтверждения номера модератором'
  };

  var S = {
    mode: 'init',      // init | off | checking | anon | ready | cached | error
    identity: null,    // {userId, teamId, teamName, status, role}
    stopped: '',       // текст остановки (rate_limit / 42501 / сеанс) — до ручного запуска
    note: '',          // последнее сообщение (временный сбой, отказ записи)
    noteTemp: false,   // note — о временном сбое (снимается после успешной отправки)
    running: false,
    again: false,
    againManual: false,
    current: null,
    retryTimer: null,
    retryN: 0,
    runs: 0,
    counts: { waiting: 0, sent: 0, errors: 0, noTeam: 0, other: 0 },
    onRecord: null,
    started: false
  };

  var DB = function () { return ECO.DB; };
  function $(id) { return document.getElementById(id); }
  function el(tag, props, children) { return ECO.el(tag, props, children); }
  function nowIso() { return new Date().toISOString(); }
  function canNetwork() {
    var db = DB();
    return !!(db && typeof db.enabled === 'function' && db.enabled());
  }
  function approved() {
    return !!(S.identity && S.identity.teamId && S.identity.status === 'approved');
  }
  function teamId() { return S.identity && S.identity.teamId ? S.identity.teamId : null; }

  // ---------- команда последнего входа (на случай открытия страницы без связи) ----------
  function readCache() {
    var raw = ECO.storageGet(IDENTITY_KEY);
    if (!raw) return null;
    try {
      var c = JSON.parse(raw);
      if (c && typeof c.userId === 'string' && UUID_RE.test(c.userId) && typeof c.teamId === 'string' &&
          UUID_RE.test(c.teamId) && typeof c.teamName === 'string' && typeof c.status === 'string') return c;
    } catch (e) { /* испорченная запись — как будто её нет */ }
    return null;
  }
  function writeCache(id) {
    if (id && id.teamId) {
      ECO.storageSet(IDENTITY_KEY, JSON.stringify({ userId: id.userId, teamId: id.teamId, teamName: id.teamName, status: id.status }));
    } else if (typeof ECO.storageRemove === 'function') {
      ECO.storageRemove(IDENTITY_KEY);
    }
  }
  // user_id сессии, сохранённой на устройстве (без обращения к сети); '' — сессии нет или она не читается.
  function storedUserId() {
    var db = DB();
    var key = db && typeof db.SESSION_STORAGE_KEY === 'string' ? db.SESSION_STORAGE_KEY : '';
    var raw = key ? ECO.storageGet(key) : null;
    if (!raw) return '';
    try {
      var s = JSON.parse(raw);
      if (s && s.currentSession) s = s.currentSession; // прежний формат supabase-js
      var id = s && s.user && s.user.id;
      return typeof id === 'string' && UUID_RE.test(id) ? id : '';
    } catch (e) { return ''; }
  }
  // Команда с прошлого входа — только того же пользователя, что и сессия на устройстве.
  function cachedIdentity(userId) {
    var c = readCache();
    if (!c || !userId || c.userId !== userId) return null;
    return { userId: c.userId, role: 'team', teamId: c.teamId, teamName: c.teamName, status: c.status };
  }

  function loadIdentity() {
    if (!canNetwork()) {
      S.mode = 'off';
      S.identity = null;
      render();
      return Promise.resolve();
    }
    S.mode = 'checking';
    render();
    var db = DB();
    return Promise.resolve().then(function () { return db.currentUser(); }).then(function (user) {
      if (!user) {
        S.mode = 'anon';
        S.identity = null;
        writeCache(null);
        return null;
      }
      return db.loadProfile().then(function (p) {
        if (!p) {
          S.mode = 'anon';
          S.identity = null;
          writeCache(null);
          return;
        }
        S.identity = {
          userId: p.userId,
          role: p.role,
          teamId: p.team ? p.team.id : null,
          teamName: p.team ? p.team.name : '',
          status: p.team ? p.team.status : ''
        };
        S.mode = 'ready';
        writeCache(S.identity);
      }, function (err) {
        var c = db.isTemporaryError(err) ? cachedIdentity(user.id) : null;
        if (c) {
          S.identity = c;
          S.mode = 'cached';
        } else {
          S.identity = null;
          S.mode = 'error';
          S.note = db.errorText(err);
        }
      });
    }, function (err) {
      // сессию не удалось проверить (нет связи для обновления токена): команда с прошлого входа — только если
      // она записана для пользователя сохранённой на устройстве сессии
      var c = db.isTemporaryError(err) ? cachedIdentity(storedUserId()) : null;
      if (c) {
        S.identity = c;
        S.mode = 'cached';
      } else {
        S.identity = null;
        S.mode = 'error';
        S.note = db.errorText(err);
      }
    }).then(render);
  }

  // ---------- отметка новой записи командой ----------
  // Только при входе подтверждённой команды. Без входа запись не меняется (как раньше).
  function stamp(rec) {
    if (!rec || !approved()) return false;
    rec.user_id = S.identity.userId;
    rec.team_id = S.identity.teamId;
    rec.sync_step = null;
    rec.synced_at = null;
    rec.sync_error = null;
    return true;
  }

  // ---------- строки для базы ----------
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function mainRow(rec) {
    if (rec.kind === 'inspect') {
      return {
        id: rec.record_uid, team_id: rec.team_id, tree_id: rec.id, status: rec.status || null,
        notes: str(rec.notes), watered: rec.watered === true, observed_date: rec.observed_date
      };
    }
    var row = {
      id: rec.record_uid, team_id: rec.team_id, kind: rec.kind, species: rec.species || null,
      lat: num(rec.lat), lon: num(rec.lon), accuracy: num(rec.coord_accuracy_m), source: rec.coord_source || null,
      notes: str(rec.notes)
    };
    if (rec.kind === 'place_existing') {
      row.tree_id = rec.id;
    } else {
      row.proposed_id = rec.id;
      row.species_note = str(rec.species_note);
      row.planted_year = typeof rec.planted_year === 'number' ? rec.planted_year : null;
      row.planted_date = rec.planted_date || null;
      row.event = str(rec.event);
    }
    return row;
  }
  function photoPath(rec) { return rec.team_id + '/' + rec.record_uid + '.jpg'; }
  function photoRow(rec, info) {
    return {
      id: rec.record_uid, team_id: rec.team_id,
      tree_id: rec.kind === 'new_tree' ? null : rec.id,
      observation_id: rec.kind === 'inspect' ? rec.record_uid : null,
      proposal_id: rec.kind === 'inspect' ? null : rec.record_uid,
      status: 'pending', pending_path: photoPath(rec),
      bytes: info.bytes, width: info.width, height: info.height
    };
  }
  // Запись, которую база заведомо не примет (проверки CHECK в 001_schema.sql), не отправляется вовсе — иначе фото
  // ушло бы в базу, а основная строка получила бы отказ 23514. Такие записи могли остаться от прежних версий формы.
  function isoDay(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function precheck(rec) {
    if (rec.kind === 'inspect') {
      var d = rec.observed_date;
      var tomorrow = isoDay(new Date(Date.now() + 86400000)); // база допускает current_date + 1 (часовые пояса)
      if (typeof d !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d) || d < '2020-01-01' || d > tomorrow) return TEXT.badDate;
    } else if (rec.kind === 'new_tree') {
      var y = rec.planted_year;
      if (y !== null && y !== undefined && !(typeof y === 'number' && y >= 1950 && y <= 2100)) return TEXT.badYear;
      if (rec.planted_date && String(rec.planted_date) < '1950-01-01') return TEXT.badYear;
    }
    return '';
  }

  // ---------- фото: проверка, что метаданных (EXIF) нет ----------
  // Разбор маркеров JPEG до начала данных изображения: APP1 с подписью «Exif\0\0» — есть метаданные.
  function hasExif(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return false;
    var i = 2;
    while (i + 4 <= bytes.length) {
      if (bytes[i] !== 0xFF) return false;
      var m = bytes[i + 1];
      if (m === 0xD9 || m === 0xDA) return false; // конец / начало данных — метаданных дальше нет
      var len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (m === 0xE1 && len >= 8 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 &&
          bytes[i + 7] === 0x66 && bytes[i + 8] === 0 && bytes[i + 9] === 0) return true;
      i += 2 + len;
    }
    return false;
  }
  function blobBytes(blob) {
    if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(new Uint8Array(fr.result)); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsArrayBuffer(blob);
    });
  }
  function dims(blob) {
    if (!window.createImageBitmap) return Promise.resolve({ width: null, height: null });
    return window.createImageBitmap(blob).then(function (b) {
      var r = { width: b.width, height: b.height };
      if (b.close) b.close();
      return r;
    }, function () { return { width: null, height: null }; });
  }
  // Фото записи, готовое к отправке: JPEG без EXIF. Если метаданные всё же есть — пережимаем через canvas
  // (тот же путь, что при съёмке) и сохраняем очищенную копию вместо исходной.
  function cleanPhoto(rec) {
    return STORE.getPhoto(rec.record_uid).then(function (blob) {
      if (!blob) return null;
      return blobBytes(blob).then(function (bytes) {
        if (!hasExif(bytes)) {
          return dims(blob).then(function (d) {
            return { data: bytes, bytes: bytes.length, width: d.width, height: d.height };
          });
        }
        var F = window.ECO_FIELD;
        if (!F || typeof F.processPhoto !== 'function') throw permanent('Фото не удалось очистить от метаданных.');
        return F.processPhoto(new Blob([bytes], { type: 'image/jpeg' })).then(function (r) {
          return blobBytes(r.blob).then(function (b2) {
            if (hasExif(b2)) throw permanent('Фото не удалось очистить от метаданных.');
            return STORE.putPhoto(rec.record_uid, r.blob).then(function () {
              return { data: b2, bytes: b2.length, width: r.width, height: r.height };
            });
          });
        });
      });
    });
  }

  // ---------- ошибки ----------
  function permanent(text) {
    var e = new Error(text);
    e.fieldKind = 'rejected';
    e.fieldText = text;
    return e;
  }
  function errMessage(err) { return err && typeof err.message === 'string' ? err.message : ''; }
  function isRowDuplicate(err) {
    if (!err) return false;
    if (err.code === '23505') return true;
    return err.status === 409 && !err.code; // 409 без кода — конфликт ключа
  }
  function isFileDuplicate(err) {
    if (!err) return false;
    return err.status === 409 || String(err.statusCode) === '409' || /^Duplicate$/i.test(String(err.error || err.code || '')) ||
      /already exists/i.test(errMessage(err));
  }
  function isSessionError(err) {
    if (!err) return false;
    if (err.code === 'PGRST301' || err.code === 'PGRST303' || err.status === 401 || String(err.statusCode) === '401') return true;
    // Storage отвечает на просроченный/битый токен 400 с error «InvalidJWT» или текстом про «exp» claim
    return err.fieldStage === 'file' && (/InvalidJWT/i.test(String(err.error || err.code || '')) || /jwt|"?exp"? claim/i.test(errMessage(err)));
  }
  function mark(err, key, value) {
    if (err && typeof err === 'object') {
      try { err[key] = value; } catch (x) { /* только чтение */ }
    }
    return err;
  }
  // Вид ошибки: temporary (повтор позже) | stop (остановить очередь) | rejected (пометить запись, идти дальше).
  function classify(err, rec) {
    var db = DB();
    if (err && err.fieldKind) return { kind: err.fieldKind, text: err.fieldText };
    var msg = errMessage(err);
    // лимит фото касается только записи с фото: она помечается, очередь идёт дальше
    if (/^rate_limit: photos\b/.test(msg)) {
      return { kind: 'rejected', photo: true, text: /\btotal\b/.test(msg) ? TEXT.photoTotal : TEXT.photoDay };
    }
    if (/^rate_limit\b/.test(msg)) return { kind: 'stop', text: db.errorText(err) + TEXT.stoppedTail };
    if (isSessionError(err)) return { kind: 'stop', text: TEXT.session + TEXT.stoppedTail };
    if (db.isTemporaryError(err) || (err && err.originalError && db.isTemporaryError(err.originalError))) {
      return { kind: 'temporary', text: TEXT.temporary + TEXT.retryTail };
    }
    // отказ Storage на файле фото (строка photos уже не pending и т.п.) — только эта запись
    if (err && err.fieldStage === 'file') return { kind: 'rejected', photo: true, text: TEXT.photoRejected };
    // строка таблицы: 403 / row-level security трактуются как 42501 — команда не подтверждена или приостановлена
    if (err && (err.code === '42501' || err.status === 403 || String(err.statusCode) === '403' || /row-level security/i.test(msg))) {
      return { kind: 'stop', text: TEXT.notApproved };
    }
    if (err && err.code === '23503') {
      return { kind: 'rejected', text: rec && rec.kind !== 'inspect' ? TEXT.proposalFk : TEXT.noTree };
    }
    return { kind: 'rejected', text: TEXT.rejected };
  }
  function client() { return DB().session(); }
  function insertRow(table, row) {
    return client().from(table).insert(row).then(function (res) {
      if (res && res.error) {
        var e = res.error;
        if (typeof e.status !== 'number' && typeof res.status === 'number') mark(e, 'status', res.status);
        if (isRowDuplicate(e)) return 'dup';
        throw mark(e, 'fieldTable', table);
      }
      return 'ok';
    });
  }
  // Байты (а не Blob): тогда supabase-js шлёт их как есть с Content-Type image/jpeg, без multipart-обёртки.
  function uploadFile(path, data) {
    return client().storage.from(BUCKET).upload(path, data, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' })
      .then(function (res) {
        if (res && res.error) {
          if (isFileDuplicate(res.error)) return 'dup';
          throw mark(res.error, 'fieldStage', 'file');
        }
        return 'ok';
      }, function (err) { throw mark(err, 'fieldStage', 'file'); });
  }

  // ---------- одна запись ----------
  function update(uid, patch) {
    return STORE.setSyncState(uid, patch).then(function (rec) {
      if (rec && typeof S.onRecord === 'function') {
        try { S.onRecord(rec); } catch (e) { /* отрисовка списка не должна ломать отправку */ }
      }
      return rec;
    });
  }
  function sendOne(rec) {
    var table = KINDS[rec.kind];
    if (!table || !UUID_RE.test(rec.record_uid) || !UUID_RE.test(rec.team_id || '')) {
      return Promise.reject(permanent(TEXT.rejected));
    }
    var bad = precheck(rec);
    if (bad) return Promise.reject(permanent(bad));
    var step = STEP_ORDER[rec.sync_step] || 0;
    var chain = Promise.resolve();
    if (rec.photo === true && step < STEP_ORDER.photo_file) {
      chain = chain.then(function () { return cleanPhoto(rec); }).then(function (info) {
        if (!info) return null; // фото на телефоне нет — отправляем запись без него
        var p = Promise.resolve();
        if (step < STEP_ORDER.photo_row) {
          p = p.then(function () { return insertRow('photos', photoRow(rec, info)); })
            .then(function () { return update(rec.record_uid, { sync_step: 'photo_row' }); });
        }
        return p.then(function () { return uploadFile(photoPath(rec), info.data); })
          .then(function () { return update(rec.record_uid, { sync_step: 'photo_file' }); });
      });
    }
    return chain.then(function () { return insertRow(table, mainRow(rec)); })
      .then(function () { return update(rec.record_uid, { sync_step: 'done', synced_at: nowIso(), sync_error: null }); });
  }

  // ---------- проход очереди ----------
  function mine(r) { return !!(r && teamId() && r.team_id === teamId()); }
  function isRejected(r) { return !!(r && r.sync_error && r.sync_error.kind === 'rejected'); }
  function queueOf(list, manual) {
    return list.filter(function (r) { return mine(r) && !r.synced_at && (manual || !isRejected(r)); })
      .sort(function (a, b) { return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0; });
  }
  function pass(manual) {
    return STORE.all().then(function (list) {
      var queue = queueOf(list || [], manual);
      var i = 0;
      function next() {
        if (i >= queue.length) return null;
        var uid = queue[i++].record_uid;
        // свежая копия: другая вкладка могла продвинуть шаги этой записи
        return STORE.get(uid).then(function (rec) {
          if (!rec || rec.synced_at || !mine(rec)) return next();
          return sendOne(rec).then(function () {
            S.retryN = 0;
            if (S.noteTemp) { // связь вернулась — заметка о временном сбое больше не верна
              S.note = '';
              S.noteTemp = false;
            }
            return next();
          }, function (err) {
            var c = classify(err, rec);
            if (c.kind === 'rejected') {
              S.note = 'Запись ' + (rec.id || '') + ': ' + c.text;
              S.noteTemp = false;
              return update(uid, { sync_error: { kind: 'rejected', text: c.text, photo: !!c.photo, at: nowIso() } }).then(next);
            }
            if (c.kind === 'stop') {
              S.stopped = c.text;
              return update(uid, { sync_error: { kind: 'stopped', text: c.text, at: nowIso() } }).then(function () { return null; });
            }
            S.note = c.text;
            S.noteTemp = true;
            return update(uid, { sync_error: { kind: 'temporary', text: c.text, at: nowIso() } }).then(function () {
              scheduleRetry();
              return null;
            });
          });
        });
      }
      return next();
    });
  }
  function withLock(fn) {
    var locks = navigator.locks;
    if (locks && typeof locks.request === 'function') {
      return locks.request(LOCK_NAME, function () { return fn(); });
    }
    return fn();
  }
  function scheduleRetry() {
    if (S.retryTimer) return;
    var ms = RETRY_MS[Math.min(S.retryN, RETRY_MS.length - 1)];
    S.retryN++;
    S.retryTimer = setTimeout(function () {
      S.retryTimer = null;
      run({});
    }, ms);
  }

  function run(opts) {
    opts = opts || {};
    if (opts.manual) {
      S.stopped = '';
      S.note = '';
      S.noteTemp = false;
    }
    if (S.running) {
      S.again = true;
      S.againManual = S.againManual || !!opts.manual;
      return S.current;
    }
    if (S.stopped || !approved() || !canNetwork()) return refreshCounts();
    if (navigator.onLine === false) {
      S.note = TEXT.offline;
      return refreshCounts();
    }
    if (S.retryTimer) {
      clearTimeout(S.retryTimer);
      S.retryTimer = null;
    }
    S.running = true;
    S.runs++;
    if (S.note === TEXT.offline) S.note = '';
    render();
    var manual = !!opts.manual;
    S.current = Promise.resolve().then(function () { return withLock(function () { return pass(manual); }); })
      .catch(function (err) {
        // сбой хранилища браузера — запись не потеряна, повтор позже
        S.note = 'Отправка прервана: ' + (err && err.message ? err.message : String(err));
        S.noteTemp = true;
        scheduleRetry();
      })
      .then(function () {
        S.running = false;
        if (S.again) {
          var m = S.againManual;
          S.again = false;
          S.againManual = false;
          return run({ manual: m });
        }
        return refreshCounts();
      });
    return S.current;
  }
  function kick() {
    if (!S.started) return Promise.resolve();
    return run({});
  }

  // ---------- состояние очереди ----------
  function refreshCounts() {
    return STORE.all().then(function (list) {
      var c = { waiting: 0, sent: 0, errors: 0, noTeam: 0, other: 0 };
      (list || []).forEach(function (r) {
        if (!r) return;
        if (!r.team_id) {
          if (!r.synced_at) c.noTeam++;
          return;
        }
        if (!mine(r)) {
          if (!r.synced_at) c.other++;
          return;
        }
        if (r.synced_at) c.sent++;
        else if (isRejected(r)) c.errors++;
        else c.waiting++;
      });
      S.counts = c;
      render();
      return c;
    }, function () { render(); });
  }

  function teamLine() {
    var id = S.identity;
    switch (S.mode) {
      case 'off':
        return ['Онлайн-отправка недоступна на этой странице (работа со снимком данных или с флешки). ' +
          'Записи сохраняются на телефоне — передайте их файлом JSON (раздел 4).'];
      case 'init':
      case 'checking':
        return ['Проверяем вход команды…'];
      case 'anon':
        return ['Вход не выполнен: записи сохраняются только на телефоне и передаются файлом JSON (раздел 4). ' +
          'Чтобы записи сразу попадали на сайт, войдите: ', el('a', { href: '../pages/account.html', text: 'аккаунт команды' }), '.'];
      case 'error':
        return ['Не удалось проверить вход: ' + (S.note || '') + ' Записи сохраняются на телефоне.'];
    }
    if (!id) return ['Вход не выполнен.'];
    if (!id.teamId) {
      if (id.role === 'moderator' || id.role === 'admin') {
        return ['Вы вошли как ' + ((ECO.DB && ECO.DB.ROLES && ECO.DB.ROLES[id.role]) || id.role) +
          ': полевые записи с этого аккаунта в базу не отправляются (только файлом JSON).'];
      }
      return ['Вы вошли, но у аккаунта ещё нет команды — создайте её на странице ',
        el('a', { href: '../pages/account.html', text: 'аккаунта' }), '. Пока записи сохраняются только на телефоне.'];
    }
    var st = (ECO.DB && ECO.DB.TEAM_STATUS && ECO.hasOwn(ECO.DB.TEAM_STATUS, id.status)) ? ECO.DB.TEAM_STATUS[id.status] : id.status;
    // название команды — данные (без перевода), подписи вокруг — интерфейс
    var out = ['Команда «', el('b', { text: id.teamName, attrs: { 'data-i18n-skip': '' } }), '» — ' + st + '. '];
    if (id.status === 'approved') out.push('Новые записи отправляются в онлайн-базу, когда есть связь.');
    else out.push('Пока команда не подтверждена, записи сохраняются только на телефоне (и в выгрузке JSON).');
    if (S.mode === 'cached') out.push(' Нет связи с базой — данные о команде с прошлого входа.');
    return out;
  }
  function queueLine() {
    var c = S.counts;
    if (!approved()) return '';
    var s = 'Очередь отправки: ждут — ' + c.waiting + ', отправлено — ' + c.sent + ', ошибки — ' + c.errors + '.';
    if (S.running) s += ' Идёт отправка…';
    return s;
  }
  function extraLine() {
    var c = S.counts, parts = [];
    if (c.noTeam) {
      parts.push('Записей, сделанных без входа: ' + c.noTeam + ' — они на телефоне и в выгрузке JSON' +
        (approved() ? '; отправить их от команды можно кнопкой ниже.' : '.'));
    }
    if (c.other) {
      if (!teamId()) {
        parts.push('Записи команды — войдите, чтобы отправить: ' + c.other + ' (пока они на телефоне и в выгрузке JSON).');
      } else if (approved()) {
        parts.push('Записей другой команды: ' + c.other + ' — сами не отправляются; отправить их от текущей команды можно кнопкой ниже.');
      } else {
        parts.push('Записей другой команды: ' + c.other + ' — с этого входа не отправляются, остаются в выгрузке JSON.');
      }
    }
    return parts.join(' ');
  }
  function setText(node, text) {
    if (!node) return;
    node.textContent = text;
    node.hidden = !text;
  }
  function render() {
    var team = $('sync-team');
    if (!team) return;
    ECO.clear(team);
    teamLine().forEach(function (x) { team.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
    setText($('sync-queue'), queueLine());
    setText($('sync-extra'), extraLine());
    var msg = S.stopped || S.note || '';
    setText($('sync-msg'), msg);
    var now = $('sync-now');
    if (now) {
      now.hidden = !approved();
      now.disabled = S.running;
    }
    var adopt = $('sync-adopt');
    if (adopt) {
      adopt.hidden = !(approved() && S.counts.noTeam + S.counts.other > 0);
      ECO.clear(adopt);
      if (approved()) {
        // Подпись уже на языке страницы (ECO.t подставляет название команды как есть, без перевода) — одним
        // узлом с data-i18n-skip, чтобы перевод на выводе не тронул название; один узел — кнопка (flex) не
        // разбивает подпись на строки.
        var label = ECO.i18n && typeof ECO.t === 'function' ? ECO.t('sync.adopt', 'Отправить от имени «{x}»', { x: S.identity.teamName })
          : 'Отправить от имени «' + S.identity.teamName + '»';
        adopt.appendChild(el('span', { text: label, attrs: { 'data-i18n-skip': '' } }));
      }
      adopt.disabled = S.running;
    }
    var card = $('sync-card');
    if (card) card.setAttribute('data-state', S.stopped ? 'stopped' : S.running ? 'running' : S.mode);
  }

  // Записи без отметки команды и записи, помеченные командой, которой у этого входа нет, — от имени текущей
  // команды, после подтверждения (перепомечаются текущей командой).
  function adopt() {
    if (!approved()) return Promise.resolve(0);
    var id = S.identity;
    return STORE.all().then(function (list) {
      var orphans = (list || []).filter(function (r) { return r && !r.synced_at && r.team_id !== id.teamId; });
      if (!orphans.length) return 0;
      var noTeam = orphans.filter(function (r) { return !r.team_id; }).length;
      var other = orphans.length - noTeam;
      var what = [];
      if (noTeam) what.push('сделанные без входа — ' + noTeam + ' шт.');
      if (other) what.push('помеченные другой командой — ' + other + ' шт.');
      // Текст подтверждения — на языке страницы; название команды подставляется без перевода (ECO.t не
      // переводит параметры), перечень записей — интерфейс (ECO.tr). Подпись кнопки отмены задаёт браузер на
      // своём языке — текст на неё не ссылается.
      var tr = ECO.tr || String;
      var t = ECO.i18n && typeof ECO.t === 'function' ? ECO.t : function (k, ru, p) {
        return ru.replace(/\{([a-z0-9]+)\}/gi, function (all, n) { return p && ECO.hasOwn(p, n) ? String(p[n]) : all; });
      };
      var ok = window.confirm(t('sync.adopt_q', 'Отправить от имени команды «{x}» записи на этом телефоне ({what})?',
        { x: id.teamName, what: tr(what.join('; ')) }) + ' ' +
        t('sync.adopt_appear', 'Они появятся на сайте от вашей команды.') + ' ' +
        t('sync.adopt_dup', 'Если эти записи уже переданы координатору файлом JSON — откажитесь в этом окне, иначе на сайте будут повторы.'));
      if (!ok) return 0;
      return orphans.reduce(function (p, r) {
        return p.then(function () {
          return update(r.record_uid, { user_id: id.userId, team_id: id.teamId, sync_step: null, synced_at: null, sync_error: null });
        });
      }, Promise.resolve()).then(function () {
        return run({ manual: true }).then(function () { return orphans.length; });
      });
    });
  }

  // Подпись записи в списке «Записи на этом телефоне» (пусто — запись без команды, как раньше).
  function label(r) {
    if (!r || (!r.team_id && !r.synced_at)) return '';
    if (r.synced_at) return 'отправлено в базу';
    if (r.team_id && !teamId()) return 'запись команды — войдите, чтобы отправить';
    if (r.team_id !== teamId()) return approved() ? 'другой команды — отправить можно кнопкой «Отправить от имени»' : 'другой команды — не отправляется';
    if (isRejected(r)) return r.sync_error.photo ? 'база не приняла фото' : 'база не приняла';
    return 'ждёт отправки';
  }

  function init(opts) {
    if (S.started) return S.current || Promise.resolve();
    S.started = true;
    S.onRecord = opts && typeof opts.onRecord === 'function' ? opts.onRecord : null;
    var now = $('sync-now');
    if (now) now.addEventListener('click', function () { run({ manual: true }); });
    var ad = $('sync-adopt');
    if (ad) ad.addEventListener('click', function () { adopt(); });
    window.addEventListener('online', function () {
      if (S.mode === 'cached' || S.mode === 'error') {
        loadIdentity().then(function () { return run({}); });
      } else {
        run({});
      }
    });
    window.addEventListener('offline', function () { S.note = TEXT.offline; render(); });
    render();
    S.current = loadIdentity().then(refreshCounts).then(function () { return run({}); });
    return S.current;
  }

  window.ECO_FIELD_SYNC = {
    init: init,
    stamp: stamp,
    kick: kick,
    run: run,
    adopt: adopt,
    label: label,
    hasExif: hasExif,
    provisionalText: TEXT.provisional,
    isOnlineTeam: approved,
    whenIdle: function idle() {
      var p = S.current;
      return Promise.resolve(p).then(function () { return S.running || S.current !== p ? idle() : null; });
    },
    state: function () {
      return {
        mode: S.mode, running: S.running, stopped: S.stopped, note: S.note, runs: S.runs,
        counts: { waiting: S.counts.waiting, sent: S.counts.sent, errors: S.counts.errors, noTeam: S.counts.noTeam, other: S.counts.other },
        team: S.identity ? { id: S.identity.teamId, name: S.identity.teamName, status: S.identity.status } : null,
        retryPending: !!S.retryTimer
      };
    }
  };
})();
