// EcoTreeMap — страница «Модерация» (pages/moderate.html): очереди команд, предложений деревьев, фото, опеки,
// последние осмотры и роли (роли — только администратор). Всё через клиент с сессией ECO.DB.session().
// Доступ определяет роль из profiles; всем, кроме модератора и администратора, — только «Нет доступа», запросов
// очередей нет. Настоящая защита — RLS и RPC базы (002/003/004), страница лишь отражает права.
// Вывод — только textContent / createElement: данные команд в разметку как HTML не попадают.
(function () {
  'use strict';

  var ECO = window.ECO;
  if (!ECO || !ECO.DB) return; // нет common.js/db.js — страховка в moderate.html покажет причину
  var DB = ECO.DB;
  var el = ECO.el;

  var PENDING_BUCKET = 'photos-pending';
  var PUBLIC_BUCKET = DB.PUBLIC_BUCKET || 'photos-public';
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var TREE_ID_RE = /^[A-Z]{1,3}-[0-9]{3,5}$/;
  var CODE_RE = /^[A-Z0-9]{6}$/;
  var ACCOUNT_CODE_RE = /^[0-9a-f]{8}$/;
  var MAX_SIDE = 1600;       // photos.width/height ≤ 1600 (001)
  var MAX_BYTES = 500000;    // бакет photos-public ≤ 512000 байт (003)
  var CHECK_TIMEOUT_MS = 10000;
  var QUEUE_LIMIT = 100;     // карточек в очереди (новые первыми); остальные — после решений по показанным
  var SECTIONS = ['mod-offline', 'mod-loading', 'mod-denied', 'mod-error', 'mod-main'];

  // Коды ошибок RPC и триггеров (EcoTreeMap_supabase/migrations/004) → русский текст.
  var MOD_TEXT = {
    wrong_code: 'Код заявки не совпал. Уточните код у руководителя команды и введите его ещё раз.',
    team_not_found: 'Команда не найдена. Обновите очереди.',
    team_not_pending: 'Команда уже подтверждена или заявка отклонена. Обновите очереди.',
    use_approve_team: 'Подтвердить команду можно только по коду заявки.',
    frozen_columns: 'Это поле менять нельзя.',
    proposal_not_found: 'Предложение не найдено. Обновите очереди.',
    proposal_not_pending: 'По этому предложению уже принято решение. Обновите очереди.',
    bad_decision: 'Не выбрано решение по предложению.',
    bad_tree_id: 'Номер дерева — 1–3 латинские заглавные буквы, дефис и 3–5 цифр, например L-012.',
    tree_id_taken: 'Дерево с таким номером уже есть. Укажите другой номер.',
    tree_not_found: 'Дерево из предложения не найдено в базе.',
    account_not_found: 'Аккаунт с таким кодом не найден. Проверьте код (8 знаков со страницы «Аккаунт»).',
    account_code_ambiguous: 'Этому коду соответствуют несколько аккаунтов — введите полный номер аккаунта.',
    bad_account_code: 'Код аккаунта — 8 знаков (цифры и латинские буквы a–f) или полный номер аккаунта.',
    account_has_team: 'У этого аккаунта есть команда: модератором или администратором может быть только аккаунт без команды.',
    bad_role: 'Неизвестная роль.',
    last_admin: 'Нельзя снять роль с последнего администратора проекта. Сначала назначьте другого администратора.',
    forbidden: 'Недостаточно прав для этого действия.'
  };
  var STALE = 'Пока страница была открыта, решение уже приняли (возможно, другой модератор). Обновите очереди.';

  function $(id) { return document.getElementById(id); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function only(id) { SECTIONS.forEach(function (s) { var n = $(s); if (n) n.hidden = s !== id; }); }
  function say(box, text, kind) {
    box.textContent = text || '';
    box.className = (box.getAttribute('data-base') || 'acc-msg') + (kind ? ' acc-msg--' + kind : '');
    box.hidden = !text;
  }
  function localError(text) {
    var e = new Error('local');
    e.modText = text;
    return e;
  }
  function errText(e, ctx) {
    if (e && typeof e.modText === 'string') return e.modText;
    var msg = e && typeof e.message === 'string' ? e.message : '';
    var token = (msg.split(':')[0] || '').trim();
    if (/^[a-z_]+$/.test(token) && own(MOD_TEXT, token)) return MOD_TEXT[token];
    if (ctx === 'patronage' && e && e.code === '23505') {
      return 'У дерева уже есть шеф: вторую опеку одобрить нельзя. Отклоните эту заявку.';
    }
    return DB.errorText(e);
  }
  function unwrap(res) {
    if (res && res.error) {
      var e = res.error;
      if (e && typeof e === 'object' && typeof e.status !== 'number' && typeof res.status === 'number') {
        try { e.status = res.status; } catch (x) { /* только для чтения */ }
      }
      throw e;
    }
    return res ? res.data : null;
  }
  function isFileDuplicate(err) {
    if (!err) return false;
    var m = typeof err.message === 'string' ? err.message : '';
    return err.status === 409 || String(err.statusCode) === '409' || /^Duplicate$/i.test(String(err.error || '')) ||
      /already exists/i.test(m);
  }
  function day(ts) {
    var d = typeof ts === 'string' ? ts.slice(0, 10) : '';
    return ECO.formatDate(d) || '—';
  }
  function teamName(id) {
    return id && own(teams, id) ? '«' + teams[id].name + '»' : (id ? 'команда удалена' : 'без команды (исторический)');
  }
  function client() { return DB.session(); }

  var me = null;                      // {userId, role}
  var teams = Object.create(null);    // id → {name, school, status, created_at}
  var species = Object.create(null);  // key → name_ru
  var groups = Object.create(null);   // id → name

  // ---------- действие в карточке очереди: блокировка кнопок, текст ошибки по-русски ----------
  function itemNode(id, extraClass) {
    return el('li', { className: 'mod-item' + (extraClass ? ' ' + extraClass : ''), attrs: { 'data-id': id } });
  }
  function itemMsg() {
    return el('p', { className: 'acc-msg mod-item-msg', hidden: true,
      attrs: { role: 'status', 'aria-live': 'polite', 'data-base': 'acc-msg mod-item-msg' } });
  }
  // Строка итога над списком очереди: карточка после успешного действия перерисовывается вместе со списком,
  // поэтому итог показывается здесь (ошибка — в самой карточке: список при ошибке не перерисовывается).
  function sectionMsg(listId) {
    var id = listId + '-msg';
    var n = $(id);
    if (!n) {
      var list = $(listId);
      n = el('p', { className: 'acc-msg', hidden: true, attrs: { id: id, role: 'status', 'aria-live': 'polite' } });
      list.parentNode.insertBefore(n, list);
    }
    return n;
  }
  function act(item, msgBox, ctx, work, reload) {
    var buttons = item.querySelectorAll('button, input');
    if (item.getAttribute('data-busy') === '1') return Promise.resolve();
    var listId = item.parentNode && item.parentNode.id;
    item.setAttribute('data-busy', '1');
    Array.prototype.forEach.call(buttons, function (b) { b.disabled = true; });
    say(msgBox, 'Выполняется…');
    var okText = '';
    return Promise.resolve().then(work).then(function (text) {
      if (text === null) { say(msgBox, ''); return false; } // отменено модератором (confirm)
      okText = text || 'Готово.';
      say(msgBox, okText);
      item.setAttribute('data-done', '1');
      return true;
    }, function (e) {
      if (window.console) console.warn('[EcoTreeMap] модерация: ' + String(e && (e.code || e.name || e.modText) || 'ошибка'));
      say(msgBox, errText(e, ctx), 'error');
      item.setAttribute('data-error', '1');
      return false;
    }).then(function (done) {
      item.removeAttribute('data-busy');
      Array.prototype.forEach.call(buttons, function (b) { b.disabled = false; });
      if (!done || !reload) return null;
      return Promise.resolve(reload()).then(function () { if (listId) say(sectionMsg(listId), okText); });
    });
  }
  function btn(text, cls, onClick) {
    var b = el('button', { type: 'button', className: 'btn ' + cls, text: text });
    b.addEventListener('click', onClick);
    return b;
  }
  function emptyItem(list, text) {
    list.appendChild(el('li', { className: 'mod-item muted mod-empty', text: text }));
  }
  // Очередь длиннее показанного: подсказка над списком (показаны новые; старые появятся после решений).
  function limitNote(list, n) {
    if (n < QUEUE_LIMIT) return;
    list.appendChild(el('li', { className: 'mod-item muted mod-limit',
      text: 'Показаны ' + QUEUE_LIMIT + ' последних. Остальные появятся после решений по этим и нажатия «Обновить очереди».' }));
  }
  // Ошибка загрузки одной очереди не мешает остальным.
  function guard(listId, load) {
    var list = $(listId);
    return Promise.resolve().then(load).then(null, function (e) {
      if (window.console) console.warn('[EcoTreeMap] модерация: очередь ' + listId + ': ' + String(e && (e.code || e.name) || 'ошибка'));
      ECO.clear(list);
      list.appendChild(el('li', { className: 'mod-item acc-msg acc-msg--error', text: 'Очередь не загрузилась: ' + errText(e) }));
    });
  }

  // =====================================================================================
  // Справочники: команды (модератор видит все), породы, группы
  // =====================================================================================
  function loadRefs() {
    var c = client();
    return Promise.all([
      c.from('teams').select('id,name,school,status,created_at').order('created_at', { ascending: true }).limit(2000).then(unwrap),
      c.from('species').select('key,name_ru').limit(1000).then(unwrap),
      c.from('tree_groups').select('id,name').limit(1000).then(unwrap)
    ]).then(function (r) {
      teams = Object.create(null);
      (r[0] || []).forEach(function (t) {
        if (t && typeof t.id === 'string' && typeof t.name === 'string') {
          teams[t.id] = { name: t.name, school: typeof t.school === 'string' ? t.school : '', status: t.status, created_at: t.created_at };
        }
      });
      species = Object.create(null);
      (r[1] || []).forEach(function (s) { if (s && typeof s.key === 'string') species[s.key] = String(s.name_ru || s.key); });
      groups = Object.create(null);
      (r[2] || []).forEach(function (g) { if (g && typeof g.id === 'string') groups[g.id] = String(g.name || ''); });
    });
  }

  // =====================================================================================
  // а) Команды: pending — «Одобрить» по коду (approve_team) / «Отклонить»; approved — «Приостановить»;
  //    suspended — «Вернуть» (тоже approve_team по коду: прямой перевод в approved запрещён триггером teams_guard)
  // =====================================================================================
  var TEAM_ORDER = { pending: 0, suspended: 1, approved: 2 };
  function renderTeams() {
    var list = ECO.clear($('list-teams'));
    var ids = Object.keys(teams).filter(function (id) { return own(TEAM_ORDER, teams[id].status); });
    ids.sort(function (a, b) {
      return TEAM_ORDER[teams[a].status] - TEAM_ORDER[teams[b].status] ||
        (String(teams[a].created_at) < String(teams[b].created_at) ? -1 : 1);
    });
    if (!ids.length) emptyItem(list, 'Команд пока нет.');
    ids.forEach(function (id) {
      var t = teams[id];
      var item = itemNode(id);
      item.setAttribute('data-status', t.status);
      var msg = itemMsg();
      item.appendChild(el('h3', { className: 'mod-team-name', text: t.name }));
      item.appendChild(el('p', { text: 'Статус: ' + (DB.TEAM_STATUS[t.status] || t.status) + ' · заявка от ' + day(t.created_at) +
        (t.school ? ' · школа: ' + t.school : '') }));
      var actions = el('p', { className: 'acc-actions' });
      if (t.status === 'pending' || t.status === 'suspended') {
        var code = el('input', { type: 'text', className: 'mod-code', attrs: {
          maxlength: '6', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'characters',
          placeholder: 'код заявки', 'aria-label': 'Код заявки команды (со слов руководителя)' } });
        actions.appendChild(code);
        actions.appendChild(btn(t.status === 'pending' ? 'Одобрить' : 'Вернуть', 'btn--primary ' +
          (t.status === 'pending' ? 'mod-approve' : 'mod-restore'), function () {
          act(item, msg, 'teams', function () {
            var v = code.value.trim().toUpperCase();
            if (!CODE_RE.test(v)) throw localError('Код заявки — 6 знаков: латинские буквы и цифры.');
            return client().rpc('approve_team', { p_team_id: id, p_code: v }).then(unwrap).then(function () {
              code.value = '';
              return 'Команда подтверждена.';
            });
          }, reloadTeams);
        }));
      }
      if (t.status === 'pending') {
        actions.appendChild(btn('Отклонить', 'btn--outline mod-reject', function () {
          act(item, msg, 'teams', function () {
            if (!window.confirm('Отклонить заявку команды «' + t.name + '»?')) return null;
            return setTeamStatus(id, 'pending', 'rejected', 'Заявка отклонена.');
          }, reloadTeams);
        }));
      }
      if (t.status === 'approved') {
        actions.appendChild(btn('Приостановить', 'btn--outline mod-suspend', function () {
          act(item, msg, 'teams', function () {
            if (!window.confirm('Приостановить работу команды «' + t.name + '»? Команда не сможет отправлять осмотры и фото.')) return null;
            return setTeamStatus(id, 'approved', 'suspended', 'Работа команды приостановлена.');
          }, reloadTeams);
        }));
      }
      item.appendChild(actions);
      item.appendChild(msg);
      list.appendChild(item);
    });
  }
  function setTeamStatus(id, from, to, okText) {
    return client().from('teams').update({ status: to }).eq('id', id).eq('status', from).select('id').then(unwrap)
      .then(function (rows) {
        if (!rows || !rows.length) throw localError(STALE);
        return okText;
      });
  }
  function reloadTeams() {
    return guard('list-teams', function () { return loadRefs().then(renderTeams); });
  }

  // =====================================================================================
  // б) Предложения деревьев (pending): decide_proposal(p_id, p_approve, p_final_id)
  // =====================================================================================
  function mapLink(lat, lon) {
    var la = Number(lat);
    var lo = Number(lon);
    if (!isFinite(la) || !isFinite(lo)) return null;
    var a = la.toFixed(6);
    var o = lo.toFixed(6);
    return el('a', { href: 'https://www.openstreetmap.org/?mlat=' + a + '&mlon=' + o + '#map=19/' + a + '/' + o,
      text: a + ', ' + o, className: 'mod-coords', attrs: { target: '_blank', rel: 'noopener' } });
  }
  function loadProposals() {
    return client().from('tree_proposals')
      .select('id,team_id,kind,tree_id,proposed_id,species,species_note,lat,lon,accuracy,source,planted_year,planted_date,event,notes,status,created_at')
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(QUEUE_LIMIT).then(unwrap)
      .then(renderProposals);
  }
  function renderProposals(rows) {
    var list = ECO.clear($('list-proposals'));
    rows = rows || [];
    if (!rows.length) emptyItem(list, 'Предложений на проверке нет.');
    limitNote(list, rows.length);
    rows.forEach(function (p) {
      if (!p || typeof p.id !== 'string') return;
      var item = itemNode(p.id);
      item.setAttribute('data-kind', p.kind);
      var msg = itemMsg();
      var isNew = p.kind === 'new_tree';
      item.appendChild(el('h3', { text: isNew ? 'Новое дерево' + (p.proposed_id ? ' (предложен номер ' + p.proposed_id + ')' : '')
        : 'Место для существующего дерева ' + (p.tree_id || '') }));
      var sp = p.species && own(species, p.species) ? species[p.species] : (p.species || '');
      if (sp || p.species_note) {
        item.appendChild(el('p', { className: 'mod-species', text: 'Порода: ' + (sp || '—') + (p.species_note ? ' (' + p.species_note + ')' : '') }));
      }
      var coords = el('p', null, ['Координаты: ']);
      var link = mapLink(p.lat, p.lon);
      coords.appendChild(link || document.createTextNode('нет'));
      var extra = [];
      if (typeof p.accuracy === 'number' && isFinite(p.accuracy)) extra.push('±' + Math.round(p.accuracy) + ' м');
      if (p.source) extra.push(String(p.source));
      if (extra.length) coords.appendChild(document.createTextNode(' (' + extra.join(', ') + ')'));
      if (!isNew && p.tree_id) {
        coords.appendChild(document.createTextNode(' · '));
        coords.appendChild(el('a', { href: 'tree.html?id=' + encodeURIComponent(p.tree_id), text: 'паспорт дерева' }));
      }
      item.appendChild(coords);
      item.appendChild(el('p', { className: 'mod-team', text: 'Команда: ' + teamName(p.team_id) + ' · отправлено ' + day(p.created_at) }));
      if (p.planted_date || p.planted_year) {
        item.appendChild(el('p', { text: 'Посадка: ' + (ECO.formatDate(p.planted_date) || String(p.planted_year)) }));
      }
      if (p.event) item.appendChild(el('p', { text: 'Акция: ' + p.event }));
      if (p.notes) item.appendChild(el('p', { className: 'mod-notes', text: 'Заметка: ' + p.notes }));
      var actions = el('p', { className: 'acc-actions' });
      var finalId = el('input', { type: 'text', className: 'mod-final', value: (isNew ? p.proposed_id : p.tree_id) || '',
        attrs: { maxlength: '9', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Номер дерева после подтверждения' } });
      if (!isNew) finalId.readOnly = true; // для места существующего дерева номер не меняется
      actions.appendChild(el('label', { text: 'Номер: ' }, [finalId]));
      actions.appendChild(btn('Одобрить', 'btn--primary mod-approve', function () {
        act(item, msg, 'proposals', function () {
          var v = finalId.value.trim().toUpperCase();
          if (isNew && !TREE_ID_RE.test(v)) throw localError(MOD_TEXT.bad_tree_id);
          return client().rpc('decide_proposal', { p_id: p.id, p_approve: true, p_final_id: isNew ? v : null }).then(unwrap)
            .then(function (treeId) { return 'Принято: дерево ' + (typeof treeId === 'string' ? treeId : v) + '.'; });
        }, function () { return guard('list-proposals', loadProposals); });
      }));
      actions.appendChild(btn('Отклонить', 'btn--outline mod-reject', function () {
        act(item, msg, 'proposals', function () {
          if (!window.confirm('Отклонить предложение?')) return null;
          return client().rpc('decide_proposal', { p_id: p.id, p_approve: false, p_final_id: null }).then(unwrap)
            .then(function () { return 'Предложение отклонено.'; });
        }, function () { return guard('list-proposals', loadProposals); });
      }));
      item.appendChild(actions);
      item.appendChild(msg);
      list.appendChild(item);
    });
  }

  // =====================================================================================
  // в) Фото. Одобрение: скачать из photos-pending → перекодировать canvas (метаданные снимаются ещё раз) →
  //    загрузить в photos-public (t/<дерево>/<фото>.jpg или p/<предложение>/<фото>.jpg; 409 = уже загружено —
  //    размеры и вес берутся с лежащего файла) → update photos (approved, public_path, reviewed_*, width, height, bytes) →
  //    удалить копию по другому пути (p/… от попытки до назначения дерева) → удалить объект из pending →
  //    pending_path = null (признак «перенос завершён»).
  //    Отклонение: rejected → удалить ОБЕ возможные публичные копии (t/… и p/…: прошлая попытка одобрения могла
  //    успеть загрузить файл) → удалить из pending → pending_path = null. Ошибка очистки — строка остаётся в очереди.
  //    Каждый шаг повторяем: строка с решением, но с непустым pending_path, остаётся в очереди («Завершить»).
  // =====================================================================================
  var CLEANUP_FAIL = 'Не удалось удалить публичную копию фото из хранилища. Фото осталось в очереди — повторите действие позже.';
  // Все возможные публичные пути фото: t/<дерево>/<фото>.jpg (если дерево есть) и p/<предложение>/<фото>.jpg.
  function photoPaths(r) {
    var out = [];
    if (!r || typeof r.id !== 'string') return out;
    if (typeof r.tree_id === 'string' && r.tree_id) out.push('t/' + r.tree_id + '/' + r.id + '.jpg');
    if (typeof r.proposal_id === 'string' && UUID_RE.test(r.proposal_id)) out.push('p/' + r.proposal_id + '/' + r.id + '.jpg');
    return out.filter(function (p) { return DB.PUBLIC_PATH_RE.test(p); });
  }
  function publicPath(r) {
    var p = photoPaths(r)[0];
    if (!p) throw localError('У фото нет дерева или предложения — одобрить нельзя. Отклоните его.');
    return p;
  }
  function isNotFound(err) {
    if (!err) return false;
    var m = typeof err.message === 'string' ? err.message : '';
    return err.status === 404 || String(err.statusCode) === '404' || /not[ _]?found/i.test(m) || /not[ _]?found/i.test(String(err.error || ''));
  }
  // Удалить публичные копии, кроме keep. Отсутствующий объект — не ошибка. Хранилище сообщает об отказе полем
  // error (не исключением) — его проверяем; при отказе — понятный текст, вызывающий не трогает pending_path.
  function removePublic(paths, keep) {
    var list = [];
    paths.forEach(function (p) { if (typeof p === 'string' && p && p !== keep && list.indexOf(p) === -1) list.push(p); });
    if (!list.length) return Promise.resolve();
    return client().storage.from(PUBLIC_BUCKET).remove(list).then(function (res) {
      if (res && res.error && !isNotFound(res.error)) throw localError(CLEANUP_FAIL);
    }, function () { throw localError(CLEANUP_FAIL); });
  }
  // Размеры и вес уже лежащего файла (повтор одобрения после 409).
  function measure(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        if (!img.naturalWidth || !img.naturalHeight) { reject(localError('Публичная копия фото повреждена. Отклоните фото.')); return; }
        resolve({ width: img.naturalWidth, height: img.naturalHeight, bytes: blob.size });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(localError('Публичная копия фото повреждена. Отклоните фото.')); };
      img.src = url;
    });
  }
  function reencode(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth;
        var h = img.naturalHeight;
        if (!w || !h) { reject(localError('Файл фото повреждён.')); return; }
        var k = Math.min(1, MAX_SIDE / Math.max(w, h));
        w = Math.max(1, Math.round(w * k));
        h = Math.max(1, Math.round(h * k));
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        var q = 0.9;
        (function attempt() {
          canvas.toBlob(function (b) {
            if (!b) { reject(localError('Не получилось перекодировать фото.')); return; }
            if (b.size <= MAX_BYTES) { resolve({ blob: b, width: w, height: h, bytes: b.size }); return; }
            if (q <= 0.5) { reject(localError('Фото слишком большое даже после сжатия.')); return; }
            q = Math.round((q - 0.1) * 10) / 10;
            attempt();
          }, 'image/jpeg', q);
        })();
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(localError('Файл не открылся как изображение.')); };
      img.src = url;
    });
  }
  function readPhoto(id) {
    return client().from('photos').select('id,status,tree_id,proposal_id,public_path,pending_path').eq('id', id).maybeSingle().then(unwrap);
  }
  function removePending(r) {
    if (!r.pending_path) return Promise.resolve();
    // удаление отсутствующего объекта — не ошибка (повтор после частичного успеха)
    return client().storage.from(PENDING_BUCKET).remove([r.pending_path]).then(unwrap).then(function () {
      return client().from('photos').update({ pending_path: null }).eq('id', r.id).then(unwrap);
    });
  }
  function approvePhoto(r) {
    var c = client();
    if (r.status !== 'pending') {
      // «Завершить» у одобренного: копия по другому (старому) пути — удалить, затем копию из pending
      return readPhoto(r.id).then(function (now) {
        if (!now || now.status !== 'approved' || typeof now.public_path !== 'string') throw localError(STALE);
        return removePublic(photoPaths(now).concat(photoPaths(r)), now.public_path).then(function () { return removePending(now); });
      }).then(function () { return 'Перенос завершён.'; });
    }
    var path = publicPath(r);
    return c.storage.from(PENDING_BUCKET).download(r.pending_path).then(function (res) {
      if (res.error) throw localError('Файл фото не найден в хранилище: возможно, команда ещё не загрузила его. Обновите очередь позже.');
      return reencode(res.data);
    }).then(function (m) {
      return c.storage.from(PUBLIC_BUCKET).upload(path, m.blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' })
        .then(function (res) {
          if (!res.error) return m;
          if (!isFileDuplicate(res.error)) throw res.error;
          // 409 — файл уже перенесён прошлой попыткой: размеры и вес — с лежащего файла, не с нового перекодирования
          return c.storage.from(PUBLIC_BUCKET).download(path).then(function (d) {
            if (d.error) throw d.error;
            return measure(d.data);
          });
        });
    }).then(function (m) {
      return c.from('photos').update({
        status: 'approved', public_path: path, reviewed_by: me.userId, reviewed_at: new Date().toISOString(),
        width: m.width, height: m.height, bytes: m.bytes
      }).eq('id', r.id).eq('status', 'pending').select('id').then(unwrap);
    }).then(function (rows) {
      if (rows && rows.length) return path;
      return readPhoto(r.id).then(function (now) {
        // одобрено параллельно — дочищаем, опубликованной считается копия из строки
        if (now && now.status === 'approved' && typeof now.public_path === 'string') return now.public_path;
        // фото тем временем отклонили: убираем только что положенную публичную копию (и копию по другому пути)
        return removePublic([path].concat(photoPaths(r), photoPaths(now)), null).then(function () { throw localError(STALE); });
      });
    }).then(function (keep) {
      // копия по другому пути (p/<предложение>/… от попытки до назначения дерева) не должна остаться публичной
      return removePublic([path].concat(photoPaths(r)), keep);
    }).then(function () {
      return removePending(r);
    }).then(function () { return 'Фото одобрено и опубликовано.'; });
  }
  function rejectPhoto(r) {
    var c = client();
    var decide = r.status !== 'pending' ? Promise.resolve()
      : c.from('photos').update({ status: 'rejected', reviewed_by: me.userId, reviewed_at: new Date().toISOString() })
        .eq('id', r.id).eq('status', 'pending').select('id').then(unwrap);
    return decide.then(function () { return readPhoto(r.id); }).then(function (now) {
      if (!now) return removePublic(photoPaths(r), null).then(function () { throw localError(STALE); });
      if (now.status !== 'rejected') throw localError(STALE); // одобрено другим модератором — публичную копию не трогаем
      // обе возможные публичные копии (дерево и предложение — по свежей строке и по карточке), потом pending
      return removePublic(photoPaths(now).concat(photoPaths(r)), null).then(function () { return removePending(now); });
    }).then(function () { return r.status === 'pending' ? 'Фото отклонено и удалено из хранилища.' : 'Перенос завершён.'; });
  }
  function loadPhotos() {
    return client().from('photos')
      .select('id,team_id,tree_id,observation_id,proposal_id,status,pending_path,public_path,created_at')
      .or('status.eq.pending,pending_path.not.is.null').order('created_at', { ascending: false }).limit(QUEUE_LIMIT).then(unwrap)
      .then(function (rows) {
        rows = rows || [];
        var paths = rows.filter(function (r) { return r && r.status === 'pending' && typeof r.pending_path === 'string'; })
          .map(function (r) { return r.pending_path; });
        if (!paths.length) return renderPhotos(rows, {});
        // подписанные адреса просмотра — одним запросом на всю очередь (10 минут)
        return client().storage.from(PENDING_BUCKET).createSignedUrls(paths, 600).then(function (res) {
          var urls = Object.create(null);
          ((res && !res.error && res.data) || []).forEach(function (d) {
            if (d && !d.error && typeof d.path === 'string' && typeof d.signedUrl === 'string') urls[d.path] = d.signedUrl;
          });
          return renderPhotos(rows, urls);
        }, function () { return renderPhotos(rows, {}); });
      });
  }
  function renderPhotos(rows, urls) {
    var list = ECO.clear($('list-photos'));
    if (!rows.length) emptyItem(list, 'Фото на проверке нет.');
    limitNote(list, rows.length);
    var signedPrefix = (DB.config() || {}).url + '/storage/v1/object/sign/' + PENDING_BUCKET + '/';
    rows.forEach(function (r) {
      if (!r || typeof r.id !== 'string') return;
      var item = itemNode(r.id);
      item.setAttribute('data-status', r.status);
      var msg = itemMsg();
      var target = r.tree_id ? 'дерево ' + r.tree_id : 'предложение нового дерева';
      item.appendChild(el('h3', { text: 'Фото: ' + target + (r.observation_id ? ' (к осмотру)' : '') }));
      item.appendChild(el('p', { className: 'mod-team', text: 'Команда: ' + teamName(r.team_id) + ' · отправлено ' + day(r.created_at) }));
      var actions = el('p', { className: 'acc-actions' });
      if (r.status === 'pending') {
        var fig = el('p', { className: 'mod-photo' });
        var u = typeof r.pending_path === 'string' && own(urls, r.pending_path) ? urls[r.pending_path] : '';
        if (!u || u.slice(0, signedPrefix.length) !== signedPrefix) {
          fig.className = 'mod-photo muted';
          fig.textContent = 'Файл фото пока не загружен командой.';
        } else {
          var img = el('img', { className: 'mod-thumb', attrs: { src: u, alt: 'Фото на проверке: ' + target } });
          img.addEventListener('error', function () { ECO.clear(fig).appendChild(document.createTextNode('Файл фото не открылся.')); });
          fig.appendChild(img);
        }
        item.appendChild(fig);
        actions.appendChild(btn('Одобрить', 'btn--primary mod-approve', function () {
          act(item, msg, 'photos', function () { return approvePhoto(r); }, function () { return guard('list-photos', loadPhotos); });
        }));
        actions.appendChild(btn('Отклонить', 'btn--outline mod-reject', function () {
          act(item, msg, 'photos', function () {
            if (!window.confirm('Отклонить фото? Файл будет удалён.')) return null;
            return rejectPhoto(r);
          }, function () { return guard('list-photos', loadPhotos); });
        }));
      } else {
        item.appendChild(el('p', { className: 'acc-msg acc-msg--warn', text: 'Решение принято (' +
          (r.status === 'approved' ? 'одобрено' : 'отклонено') + '), но копия в закрытом хранилище ещё не удалена.' }));
        actions.appendChild(btn('Завершить', 'btn--primary mod-finish', function () {
          act(item, msg, 'photos', function () { return r.status === 'approved' ? approvePhoto(r) : rejectPhoto(r); },
            function () { return guard('list-photos', loadPhotos); });
        }));
      }
      item.appendChild(actions);
      item.appendChild(msg);
      list.appendChild(item);
    });
  }

  // =====================================================================================
  // г) Опека (pending): approved/rejected + decided_by/decided_at; 23505 — у дерева уже есть шеф
  // =====================================================================================
  function loadPatronage() {
    return client().from('patronage').select('id,team_id,tree_id,group_id,status,requested_at')
      .eq('status', 'pending').order('requested_at', { ascending: false }).limit(QUEUE_LIMIT).then(unwrap)
      .then(renderPatronage);
  }
  function decidePatronage(p, status) {
    return client().from('patronage').update({ status: status, decided_by: me.userId, decided_at: new Date().toISOString() })
      .eq('id', p.id).eq('status', 'pending').select('id').then(unwrap).then(function (rows) {
        if (!rows || !rows.length) throw localError(STALE);
        return status === 'approved' ? 'Опека подтверждена.' : 'Заявка на опеку отклонена.';
      });
  }
  function renderPatronage(rows) {
    var list = ECO.clear($('list-patronage'));
    rows = rows || [];
    if (!rows.length) emptyItem(list, 'Заявок на опеку нет.');
    limitNote(list, rows.length);
    rows.forEach(function (p) {
      if (!p || typeof p.id !== 'string') return;
      var item = itemNode(p.id);
      var msg = itemMsg();
      var head = el('h3');
      if (p.tree_id) {
        head.appendChild(document.createTextNode('Опека дерева '));
        head.appendChild(el('a', { href: 'tree.html?id=' + encodeURIComponent(p.tree_id), text: p.tree_id }));
      } else {
        head.textContent = 'Опека группы «' + (own(groups, p.group_id) ? groups[p.group_id] : 'группа') + '»';
      }
      item.appendChild(head);
      item.appendChild(el('p', { className: 'mod-team', text: 'Команда: ' + teamName(p.team_id) + ' · заявка от ' + day(p.requested_at) }));
      var reload = function () { return guard('list-patronage', loadPatronage); };
      item.appendChild(el('p', { className: 'acc-actions' }, [
        btn('Одобрить', 'btn--primary mod-approve', function () {
          act(item, msg, 'patronage', function () { return decidePatronage(p, 'approved'); }, reload);
        }),
        btn('Отклонить', 'btn--outline mod-reject', function () {
          act(item, msg, 'patronage', function () {
            if (!window.confirm('Отклонить заявку на опеку?')) return null;
            return decidePatronage(p, 'rejected');
          }, reload);
        })
      ]));
      item.appendChild(msg);
      list.appendChild(item);
    });
  }

  // =====================================================================================
  // д) Последние 50 осмотров: «Скрыть» (visible=false, hidden_by) и «Вернуть»
  // =====================================================================================
  function loadObservations() {
    return client().from('observations').select('id,tree_id,team_id,status,notes,watered,observed_date,visible,created_at')
      .order('created_at', { ascending: false }).limit(50).then(unwrap).then(renderObservations);
  }
  function renderObservations(rows) {
    var list = ECO.clear($('list-observations'));
    rows = rows || [];
    if (!rows.length) emptyItem(list, 'Осмотров пока нет.');
    rows.forEach(function (o) {
      if (!o || typeof o.id !== 'string') return;
      var item = itemNode(o.id, o.visible ? '' : 'mod-hidden');
      item.setAttribute('data-visible', o.visible ? '1' : '0');
      var msg = itemMsg();
      var head = el('h3');
      head.appendChild(el('a', { href: 'tree.html?id=' + encodeURIComponent(o.tree_id), text: 'Дерево ' + o.tree_id }));
      head.appendChild(document.createTextNode(' — ' + (ECO.formatDate(o.observed_date) || '—') + (o.visible ? '' : ' (скрыт)')));
      item.appendChild(head);
      var parts = [o.status ? ECO.statusLabel(o.status) : 'состояние не указано'];
      if (o.watered === true) parts.push('полито');
      item.appendChild(el('p', { text: parts.join('; ') }));
      if (o.notes) item.appendChild(el('p', { className: 'mod-notes', text: 'Заметка: ' + o.notes }));
      item.appendChild(el('p', { className: 'mod-team', text: 'Команда: ' + teamName(o.team_id) + ' · отправлено ' + day(o.created_at) }));
      var reload = function () { return guard('list-observations', loadObservations); };
      item.appendChild(el('p', { className: 'acc-actions' }, [
        o.visible ? btn('Скрыть', 'btn--outline mod-hide', function () {
          act(item, msg, 'observations', function () {
            return client().from('observations').update({ visible: false, hidden_by: me.userId }).eq('id', o.id).select('id').then(unwrap)
              .then(function (r) { if (!r || !r.length) throw localError(STALE); return 'Осмотр скрыт.'; });
          }, reload);
        }) : btn('Вернуть', 'btn--primary mod-show', function () {
          act(item, msg, 'observations', function () {
            return client().from('observations').update({ visible: true, hidden_by: null }).eq('id', o.id).select('id').then(unwrap)
              .then(function (r) { if (!r || !r.length) throw localError(STALE); return 'Осмотр снова виден.'; });
          }, reload);
        })
      ]));
      item.appendChild(msg);
      list.appendChild(item);
    });
  }

  // =====================================================================================
  // е) Роли (только администратор): set_role(p_user, p_role). Код аккаунта (8 знаков) база ищет сама
  //    среди profiles (004); при совпадении у нескольких — просит полный номер.
  // =====================================================================================
  function loadStaff() {
    return client().from('profiles').select('user_id,role').in('role', ['moderator', 'admin']).limit(200).then(unwrap)
      .then(function (rows) {
        var list = ECO.clear($('list-staff'));
        (rows || []).forEach(function (p) {
          if (!p || typeof p.user_id !== 'string') return;
          list.appendChild(el('li', { className: 'mod-item', attrs: { 'data-code': DB.accountCode(p.user_id) } }, [
            el('code', { text: DB.accountCode(p.user_id) }),
            ' — ' + (DB.ROLES[p.role] || p.role) + (p.user_id === me.userId ? ' (это вы)' : '')
          ]));
        });
        if (!list.firstChild) emptyItem(list, 'Список пуст.');
      });
  }
  function setupRoles() {
    var form = $('role-form');
    if (form.getAttribute('data-ready') === '1') return;
    form.setAttribute('data-ready', '1');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var box = $('role-msg');
      var b = $('role-btn');
      if (b.disabled) return;
      var acc = $('role-account').value.trim().toLowerCase();
      var role = $('role-select').value;
      if (!ACCOUNT_CODE_RE.test(acc) && !UUID_RE.test(acc)) { say(box, MOD_TEXT.bad_account_code, 'error'); return; }
      if (!own(DB.ROLES, role)) { say(box, MOD_TEXT.bad_role, 'error'); return; }
      var self = acc === DB.accountCode(me.userId) || acc === me.userId;
      if (self && role !== me.role && !window.confirm('Вы меняете роль собственного аккаунта. Продолжить?')) return;
      b.disabled = true;
      say(box, 'Выполняется…');
      client().rpc('set_role', { p_user: acc, p_role: role }).then(unwrap).then(function (uid) {
        say(box, 'Роль «' + DB.ROLES[role] + '» назначена аккаунту ' + (DB.accountCode(uid) || acc) + '.');
        return guard('list-staff', loadStaff);
      }, function (e) {
        if (window.console) console.warn('[EcoTreeMap] модерация: роль: ' + String(e && (e.code || e.name) || 'ошибка'));
        say(box, errText(e), 'error');
      }).then(function () { b.disabled = false; });
    });
  }

  // =====================================================================================
  // Запуск: роль из profiles → «Нет доступа» или очереди
  // =====================================================================================
  function loadRole() {
    return DB.currentUser().then(function (user) {
      if (!user) return null;
      return client().from('profiles').select('role').eq('user_id', user.id).maybeSingle().then(unwrap).then(function (p) {
        return { userId: user.id, role: p && typeof p.role === 'string' ? p.role : 'team' };
      });
    });
  }
  function withTimeout(p) {
    var timer;
    return Promise.race([p, new Promise(function (resolve, reject) {
      timer = setTimeout(function () { reject(DB.timeoutError()); }, CHECK_TIMEOUT_MS);
    })]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }
  function loadAll() {
    say($('mod-msg'), '');
    var refs = guard('list-teams', function () { return loadRefs().then(renderTeams); });
    return refs.then(function () {
      var work = [
        guard('list-proposals', loadProposals),
        guard('list-photos', loadPhotos),
        guard('list-patronage', loadPatronage),
        guard('list-observations', loadObservations)
      ];
      if (me.role === 'admin') work.push(guard('list-staff', loadStaff));
      return Promise.all(work);
    });
  }
  function start() {
    only('mod-loading');
    return withTimeout(loadRole()).then(function (u) {
      if (!u || (u.role !== 'moderator' && u.role !== 'admin')) {
        $('mod-denied-text').textContent = u ? 'Эта страница — только для модератора и администратора проекта.'
          : 'Войдите в аккаунт модератора или администратора на странице «Аккаунт».';
        only('mod-denied');
        return null;
      }
      me = u;
      $('mod-who').textContent = DB.ROLES[u.role];
      $('q-roles').hidden = u.role !== 'admin';
      if (u.role === 'admin') setupRoles();
      only('mod-main');
      return loadAll();
    }).then(null, function (e) {
      if (window.console) console.warn('[EcoTreeMap] модерация: ' + String(e && (e.code || e.name) || 'ошибка'));
      $('mod-error-text').textContent = errText(e);
      only('mod-error');
    });
  }

  function boot() {
    if (!DB.enabled()) {
      only('mod-offline');
      window.ECO_PAGE_DONE = true;
      return;
    }
    $('mod-retry').addEventListener('click', function () { start(); });
    var refreshing = false;
    $('mod-refresh').addEventListener('click', function () {
      if (refreshing || !me) return;
      refreshing = true;
      $('mod-refresh').disabled = true;
      loadAll().then(function () { refreshing = false; $('mod-refresh').disabled = false; });
    });
    var p = start().then(function () { window.ECO_PAGE_DONE = true; });
    window.ECO_PAGE_PENDING = p;
  }
  boot();
})();
