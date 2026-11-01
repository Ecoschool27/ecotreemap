// EcoTreeMap — онлайн-база проекта (Supabase): публичное чтение и приведение строк базы к формату
// data/trees.js и data/species.js, чтобы страницы отрисовывались так же, как со снимка.
// Чтение идёт ОТДЕЛЬНЫМ анонимным клиентом (без сессии): даже если на устройстве кто-то вошёл,
// публичные страницы видят только то, что видно всем, — каждый запрос явно фильтрует
// visible / approved и берёт только колонки из контракта (EcoTreeMap_supabase/README.md).
// Любой сбой (нет сети, отказ, 5 с без ответа) — страница целиком берёт снимок data/*.js (common.js).
// Вывод на страницу — только через textContent (ECO.el), HTML-разметка из данных не используется.
(function () {
  'use strict';

  var ECO = window.ECO;
  if (!ECO) return; // common.js не загрузился — страница покажет «сайт не загрузился», базу не трогаем
  var DB = (ECO.DB = ECO.DB || {});

  DB.TIMEOUT_MS = 5000;   // таймаут на ВЕСЬ набор запросов
  DB.PAGE = 1000;         // строк на страницу запроса
  DB.MAX_PAGES = 200;     // предохранитель от бесконечной выборки
  DB.ANCHOR_NOTE = 'статус из trees.js'; // осмотр-«якорь» сида (EcoTreeMap_supabase/seed) — не показывается

  // Колонки — строго по контракту анонимного чтения.
  var COLS = {
    species: 'key,name_ru,name_kk,name_lat,name_lat_note,type,note,prefix,conf,color,care,care_source,' +
      'co2_kg_per_year_per_cm,co2_source,photo,active',
    trees: 'id,species,species_note,group_id,planted_year,planted_date,lat,lon,coord_accuracy_m,coord_source,' +
      'event,notes,status,status_date,legacy_photo,legacy_photo_date,legacy_patron,legacy_patron_since',
    teams: 'id,name,school,status',
    observations: 'id,tree_id,team_id,status,notes,watered,observed_date,visible,legacy_photo,created_at',
    photos: 'id,tree_id,observation_id,team_id,status,public_path,width,height,created_at',
    patronage: 'id,team_id,tree_id,group_id,status,decided_at'
  };
  DB.COLUMNS = COLS;
  // Обязательные фильтры видимости (явно, независимо от RLS).
  var FILTERS = {
    species: null,
    trees: null,
    teams: ['status', 'approved'],
    observations: ['visible', true],
    photos: ['status', 'approved'],
    patronage: ['status', 'approved']
  };
  DB.FILTERS = FILTERS;
  var ORDER = { species: 'key', trees: 'id', teams: 'id', observations: 'id', photos: 'id', patronage: 'id' };
  var TABLES = ['species', 'trees', 'teams', 'observations', 'photos', 'patronage'];

  var SPECIES_FIELDS = ['name_ru', 'name_kk', 'name_lat', 'name_lat_note', 'type', 'note', 'prefix', 'conf', 'color',
    'care', 'care_source', 'co2_kg_per_year_per_cm', 'co2_source', 'photo'];
  var PUBLIC_BUCKET = 'photos-public';
  // Путь одобренного фото: t/<номер дерева>/<uuid фото>.jpg или p/<uuid предложения>/<uuid фото>.jpg
  // (фото к предложению, одобренное до решения по предложению; дерево ему назначает decide_proposal).
  var UUID_SRC = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  var PUBLIC_PATH_RE = new RegExp('^(?:t/([A-Z]{1,3}-[0-9]{3,5})|p/' + UUID_SRC + ')/' + UUID_SRC + '\\.jpg$');
  DB.PUBLIC_BUCKET = PUBLIC_BUCKET;
  DB.PUBLIC_PATH_RE = PUBLIC_PATH_RE;
  // Публичный адрес фото принимается, только если это наш проект (текущая цель config.js), наш публичный
  // бакет и путь строго по PUBLIC_PATH_RE. Иначе — false (картинка не показывается).
  DB.isPublicPhotoUrl = function (url) {
    var c = DB.config();
    if (!c || typeof url !== 'string') return false;
    var prefix = c.url + '/storage/v1/object/public/' + PUBLIC_BUCKET + '/';
    return url.slice(0, prefix.length) === prefix && PUBLIC_PATH_RE.test(url.slice(prefix.length));
  };
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function own(obj, key) {
    return obj !== null && obj !== undefined && Object.prototype.hasOwnProperty.call(obj, key);
  }

  // Настройки проекта из config.js. null — онлайн-база выключена или настроена неверно (тогда снимок).
  DB.config = function () {
    var cfg = window.ECO_CONFIG || {};
    if (cfg.DATA_SOURCE !== 'supabase') return null;
    var projects = cfg.SUPABASE_PROJECTS;
    var target = cfg.SUPABASE_TARGET;
    if (typeof target !== 'string' || !own(projects, target)) return null;
    var p = projects[target];
    if (!p || typeof p.url !== 'string' || typeof p.key !== 'string') return null;
    if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(p.url)) return null;
    // В браузер — только публичный ключ. Любой другой (секретный, служебный) — база не используется.
    if (!/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(p.key)) return null;
    return { url: p.url, key: p.key, target: target };
  };

  // Сеть разрешена только для страниц по http/https. С флешки (file://) — ни одного запроса.
  DB.networkAllowed = function () {
    var proto = window.location && window.location.protocol;
    return proto === 'http:' || proto === 'https:';
  };

  DB.enabled = function () {
    return !!(DB.networkAllowed() && DB.config() && window.supabase && typeof window.supabase.createClient === 'function');
  };

  var anonClient = null;
  // Анонимный клиент: без сохранения сессии, со своим ключом хранилища (не пересекается с клиентом входа).
  DB.anon = function () {
    if (anonClient) return anonClient;
    if (!DB.enabled()) return null;
    var c = DB.config();
    anonClient = window.supabase.createClient(c.url, c.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'ecotreemap-public-anon'
      }
    });
    return anonClient;
  };

  // Все строки таблицы постранично (по DB.PAGE), с обязательным фильтром и порядком.
  function fetchTable(client, table, signal) {
    var rows = [];
    function page(n) {
      if (n >= DB.MAX_PAGES) return Promise.reject(new Error(table + ': слишком много строк'));
      var from = n * DB.PAGE;
      var q = client.from(table).select(COLS[table]);
      var f = FILTERS[table];
      if (f) q = q.eq(f[0], f[1]);
      q = q.order(ORDER[table], { ascending: true }).range(from, from + DB.PAGE - 1);
      if (signal) q = q.abortSignal(signal);
      // Без повторов при сетевом сбое: откат на снимок должен быть сразу, а не через 5 с ожидания.
      if (typeof q.retry === 'function') q = q.retry(false);
      return q.then(function (res) {
        if (res.error) throw new Error(table + ': ' + (res.error.message || res.error.code || 'ошибка запроса'));
        if (!Array.isArray(res.data)) throw new Error(table + ': ответ не список');
        Array.prototype.push.apply(rows, res.data);
        return res.data.length === DB.PAGE ? page(n + 1) : rows;
      });
    }
    return page(0);
  }

  // Весь публичный набор одним целым: либо все таблицы, либо отказ (смешивания нет).
  DB.fetchPublic = function () {
    var client = DB.anon();
    if (!client) return Promise.reject(new Error('онлайн-база недоступна на этой странице'));
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = null;
    var timeout = new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
        reject(new Error('онлайн-база не ответила за ' + DB.TIMEOUT_MS / 1000 + ' с'));
      }, DB.TIMEOUT_MS);
    });
    var work = Promise.all(TABLES.map(function (t) {
      return fetchTable(client, t, ctrl ? ctrl.signal : null);
    })).then(function (lists) {
      var out = {};
      TABLES.forEach(function (t, i) { out[t] = lists[i]; });
      return out;
    });
    return Promise.race([work, timeout]).then(function (raw) {
      clearTimeout(timer);
      return raw;
    }, function (e) {
      clearTimeout(timer);
      if (ctrl) ctrl.abort();
      throw e;
    });
  };

  // ---------- приведение к формату data/*.js ----------
  function str(v) { return typeof v === 'string' ? v : ''; }
  function num(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v !== '' && isFinite(+v)) return +v;
    return null;
  }
  function date(v) { return typeof v === 'string' && DATE_RE.test(v) ? v : null; }
  // Локальная дата ГГГГ-ММ-ДД из отметки времени базы.
  function localDate(ts) {
    if (typeof ts !== 'string' || !ts) return null;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function isAnchor(o) {
    return o.team_id === null && o.notes === DB.ANCHOR_NOTE && o.watered === false && o.legacy_photo === null;
  }
  // Порядок как в снимке (страницы строят списки по порядку данных); новое — в конце, по ключу.
  function orderLike(keys, staticKeys) {
    var pos = Object.create(null);
    (staticKeys || []).forEach(function (k, i) { if (!(k in pos)) pos[k] = i; });
    return keys.slice().sort(function (a, b) {
      var ia = a in pos, ib = b in pos;
      if (ia && ib) return pos[a] - pos[b];
      if (ia !== ib) return ia ? -1 : 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  // raw — результат DB.fetchPublic(); staticTrees/staticSpecies — снимок (только для порядка).
  // Возвращает {trees, species} в формате data/trees.js / data/species.js.
  DB.adapt = function (raw, staticTrees, staticSpecies) {
    var cfg = DB.config();
    // породы. Снимок data/species.js содержит только действующие породы — неактивные (active=false)
    // в справочник не попадают так же, как их нет в снимке. Исключение — порода, на которую ссылается
    // хотя бы одно дерево базы: без неё дерево показалось бы «порода не указана» (в снимке такого не бывает).
    var usedSpecies = Object.create(null);
    raw.trees.forEach(function (r) { if (r && typeof r.species === 'string') usedSpecies[r.species] = true; });
    var spRows = Object.create(null);
    raw.species.forEach(function (r) {
      if (!r || typeof r.key !== 'string') return;
      if (r.active === false && !usedSpecies[r.key]) return;
      spRows[r.key] = r;
    });
    var species = {};
    orderLike(Object.keys(spRows), staticSpecies && typeof staticSpecies === 'object' ? Object.keys(staticSpecies) : [])
      .forEach(function (k) {
        var r = spRows[k];
        var sp = {};
        SPECIES_FIELDS.forEach(function (f) {
          sp[f] = f === 'co2_kg_per_year_per_cm' ? num(r[f]) : f === 'prefix' ? (typeof r[f] === 'string' ? r[f] : null) : str(r[f]);
        });
        species[k] = sp;
      });

    // команды (только одобренные — запрос уже отфильтрован)
    var teams = Object.create(null);
    raw.teams.forEach(function (r) {
      if (r && r.status === 'approved' && typeof r.id === 'string' && typeof r.name === 'string') teams[r.id] = r.name;
    });

    // опека: на дерево приоритетнее, чем на группу; при нескольких — последнее решение
    function newer(a, b) { return !b || String(a.decided_at || '') > String(b.decided_at || ''); }
    var patTree = Object.create(null);
    var patGroup = Object.create(null);
    raw.patronage.forEach(function (r) {
      if (!r || r.status !== 'approved' || !own(teams, r.team_id)) return;
      if (typeof r.tree_id === 'string') { if (newer(r, patTree[r.tree_id])) patTree[r.tree_id] = r; }
      else if (typeof r.group_id === 'string') { if (newer(r, patGroup[r.group_id])) patGroup[r.group_id] = r; }
    });

    // осмотры (только видимые; «якоря» сида не показываются), новые первыми
    var obsByTree = Object.create(null);
    raw.observations.forEach(function (r) {
      if (!r || r.visible !== true || typeof r.tree_id !== 'string' || !date(r.observed_date) || isAnchor(r)) return;
      (obsByTree[r.tree_id] = obsByTree[r.tree_id] || []).push(r);
    });

    // одобренные фото: только наш публичный бакет и строгий путь (t/<номер>/<uuid>.jpg своего дерева или
    // p/<предложение>/<uuid>.jpg с назначенным деревом). Фото осмотра показывается, только пока осмотр виден:
    // скрытый модератором осмотр анониму не отдаётся — его фото тоже не показываем.
    var visibleObs = Object.create(null);
    raw.observations.forEach(function (r) { if (r && r.visible === true && typeof r.id === 'string') visibleObs[r.id] = true; });
    var photosByTree = Object.create(null);
    raw.photos.forEach(function (r) {
      if (!r || r.status !== 'approved' || typeof r.public_path !== 'string' || typeof r.tree_id !== 'string') return;
      var m = PUBLIC_PATH_RE.exec(r.public_path);
      if (!m || (m[1] !== undefined && m[1] !== r.tree_id)) return;
      if (r.observation_id !== null && r.observation_id !== undefined && !own(visibleObs, r.observation_id)) return;
      (photosByTree[r.tree_id] = photosByTree[r.tree_id] || []).push({
        url: cfg.url + '/storage/v1/object/public/' + PUBLIC_BUCKET + '/' + r.public_path,
        date: localDate(r.created_at),
        width: num(r.width),
        height: num(r.height),
        observation_id: typeof r.observation_id === 'string' ? r.observation_id : null
      });
    });

    var treeRows = Object.create(null);
    raw.trees.forEach(function (r) { if (r && typeof r.id === 'string' && !(r.id in treeRows)) treeRows[r.id] = r; });
    var staticIds = Array.isArray(staticTrees) ? staticTrees.map(function (t) { return t && t.id; }) : [];
    var trees = orderLike(Object.keys(treeRows), staticIds).map(function (id) {
      var r = treeRows[id];
      var t = {
        id: r.id,
        species: r.species,
        planted_year: num(r.planted_year),
        planted_date: date(r.planted_date),
        lat: num(r.lat),
        lon: num(r.lon),
        status: typeof r.status === 'string' ? r.status : null,
        event: str(r.event),
        notes: str(r.notes),
        coord_accuracy_m: num(r.coord_accuracy_m),
        coord_source: typeof r.coord_source === 'string' ? r.coord_source : null
      };
      if (str(r.species_note)) t.species_note = r.species_note;
      if (date(r.status_date)) t.status_date = r.status_date;
      if (typeof r.legacy_photo === 'string' && r.legacy_photo) t.photo = r.legacy_photo;
      if (date(r.legacy_photo_date)) t.photo_date = r.legacy_photo_date;
      var pat = patTree[id] || (typeof r.group_id === 'string' ? patGroup[r.group_id] : null);
      if (pat) {
        t.patron = teams[pat.team_id];
        var since = localDate(pat.decided_at);
        if (since) t.patron_since = since;
      } else if (typeof r.legacy_patron === 'string' && r.legacy_patron) {
        t.patron = r.legacy_patron;
        if (date(r.legacy_patron_since)) t.patron_since = r.legacy_patron_since;
      }
      var obs = obsByTree[id];
      if (obs && obs.length) {
        obs.sort(function (a, b) {
          return a.observed_date < b.observed_date ? 1 : a.observed_date > b.observed_date ? -1
            : String(a.created_at || '') < String(b.created_at || '') ? 1 : -1;
        });
        t.observations = obs.map(function (o) {
          var e = { date: o.observed_date, status: typeof o.status === 'string' ? o.status : null, notes: str(o.notes) };
          if (o.watered === true) e.watered = true;
          if (typeof o.legacy_photo === 'string' && o.legacy_photo) e.photo = o.legacy_photo;
          if (own(teams, o.team_id)) e.team = teams[o.team_id];
          return e;
        });
      }
      if (photosByTree[id]) t.remote_photos = photosByTree[id];
      return t;
    });
    return { trees: trees, species: species };
  };

  // =====================================================================================
  // Аккаунт: вход, регистрация, профиль (страница pages/account.html).
  // ОТДЕЛЬНЫЙ клиент с сессией и своим ключом хранилища. Публичное чтение (DB.fetchPublic) его
  // никогда не использует — только DB.anon(): вошедший не видит на публичных страницах чужое
  // скрытое и своё неподтверждённое. Разные storageKey — без предупреждения supabase-js
  // «Multiple GoTrueClient instances» (оно выдаётся только для одинакового ключа хранилища).
  // =====================================================================================
  DB.SESSION_STORAGE_KEY = 'ecotreemap-session';
  DB.ROLES = { team: 'руководитель команды', moderator: 'модератор', admin: 'администратор' };
  DB.TEAM_STATUS = {
    pending: 'ждёт подтверждения модератором',
    approved: 'подтверждена',
    rejected: 'заявка отклонена',
    suspended: 'работа приостановлена модератором'
  };

  var sessionClient = null;
  DB.session = function () {
    if (sessionClient) return sessionClient;
    if (!DB.enabled()) return null;
    var c = DB.config();
    sessionClient = window.supabase.createClient(c.url, c.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false, // писем со ссылками сайт не шлёт — токены из адреса не принимаем
        storageKey: DB.SESSION_STORAGE_KEY
      }
    });
    return sessionClient;
  };

  function need() {
    var c = DB.session();
    if (!c) throw new Error('онлайн-база недоступна на этой странице');
    return c;
  }
  function unwrap(res) {
    if (res && res.error) {
      var e = res.error;
      // У ошибки PostgREST нет кода HTTP — переносим его из ответа (5xx = временный сбой базы, см. DB.isTemporaryError).
      if (e && typeof e === 'object' && typeof e.status !== 'number' && typeof res.status === 'number') {
        try { e.status = res.status; } catch (x) { /* объект ошибки только для чтения — без кода */ }
      }
      throw e;
    }
    return res ? res.data : null;
  }

  // Текущий пользователь из сохранённой сессии или null.
  DB.currentUser = function () {
    return need().auth.getSession().then(function (res) {
      var data = unwrap(res);
      return data && data.session && data.session.user ? data.session.user : null;
    });
  };

  // Код аккаунта — первые 8 знаков user_id: по нему администратор назначает роль (set_role).
  DB.accountCode = function (userId) {
    return typeof userId === 'string' && /^[0-9a-f]{8}-/.test(userId) ? userId.slice(0, 8) : '';
  };

  // Профиль вошедшего: роль, команда (название, школа, статус), код заявки. null — не вошёл.
  DB.loadProfile = function () { return loadProfile(true); };
  // Облегчённый профиль для публичных страниц (паспорт дерева): роль и команда (id, название, статус) — без
  // team_private (код заявки там не нужен и не запрашивается). requestCode и school всегда ''.
  DB.loadTeamProfile = function () { return loadProfile(false); };
  function loadProfile(withPrivate) {
    var c = need();
    return DB.currentUser().then(function (user) {
      if (!user) return null;
      var out = {
        userId: user.id,
        email: typeof user.email === 'string' ? user.email : '',
        accountCode: DB.accountCode(user.id),
        role: 'team',
        team: null,
        requestCode: ''
      };
      return c.from('profiles').select('user_id,team_id,role').eq('user_id', user.id).maybeSingle()
        .then(unwrap)
        .then(function (p) {
          if (p && own(DB.ROLES, p.role)) out.role = p.role;
          if (!p || typeof p.team_id !== 'string') return out;
          return Promise.all([
            c.from('teams').select(withPrivate ? 'id,name,school,status' : 'id,name,status').eq('id', p.team_id).maybeSingle().then(unwrap),
            withPrivate ? c.from('team_private').select('team_id,request_code,consent_version').eq('team_id', p.team_id).maybeSingle().then(unwrap)
              : null
          ]).then(function (r) {
            var t = r[0];
            if (t && typeof t.name === 'string') {
              out.team = {
                id: t.id,
                name: t.name,
                school: typeof t.school === 'string' ? t.school : '',
                status: typeof t.status === 'string' ? t.status : ''
              };
            }
            if (r[1] && typeof r[1].request_code === 'string') out.requestCode = r[1].request_code;
            return out;
          });
        });
    });
  }

  DB.signIn =function (email, password) {
    return need().auth.signInWithPassword({ email: email, password: password }).then(unwrap);
  };
  // Регистрация. Возвращает {session, user}; session === null — в проекте включено подтверждение email.
  DB.signUp = function (email, password) {
    return need().auth.signUp({ email: email, password: password }).then(function (res) {
      var data = unwrap(res) || {};
      return { session: data.session || null, user: data.user || null };
    });
  };
  // Выход только на этом устройстве (другие устройства руководителя остаются в аккаунте).
  // supabase-js удаляет сессию с устройства и тогда, когда запрос выхода к базе не прошёл (нет связи, сбой
  // сервера), и возвращает ошибку. Поэтому при ошибке решает факт: сессии на устройстве больше нет — выход
  // выполнен; осталась — ошибка показывается.
  DB.signOut = function () {
    var c = need();
    function verdict(err) {
      return c.auth.getSession().then(function (s) {
        if (s && s.data && s.data.session) throw err;
        return true;
      }, function () { throw err; });
    }
    return c.auth.signOut({ scope: 'local' }).then(function (res) {
      return res && res.error ? verdict(res.error) : true;
    }, verdict);
  };
  // Создание команды → код заявки (6 знаков). Версия согласия — из config.js.
  DB.registerTeam = function (name, school) {
    var cfg = window.ECO_CONFIG || {};
    return need().rpc('register_team', {
      p_name: name,
      p_school: school || null,
      p_consent_version: typeof cfg.CONSENT_VERSION === 'string' ? cfg.CONSENT_VERSION : ''
    }).then(unwrap);
  };

  // ---------- коды ошибок Auth и RPC → русский текст ----------
  var RPC_TEXT = {
    team_name_taken: 'Команда с таким названием уже есть. Выберите другое название.',
    already_has_team: 'У этого аккаунта уже есть команда: один аккаунт — одна команда.',
    rate_limit: 'Слишком много действий, попробуйте позже. Если повторяется — обратитесь к модератору.',
    bad_team_name: 'Название команды — от 3 до 60 знаков.',
    bad_school: 'Название школы — не длиннее 80 знаков.',
    consent_required: 'Без согласия на обработку данных команду создать нельзя — отметьте галочку.',
    staff_cannot_register: 'Аккаунт модератора или администратора не может создать команду.',
    not_authenticated: 'Сначала войдите в аккаунт.',
    forbidden: 'Недостаточно прав для этого действия.',
    last_admin: 'Нельзя снять роль с последнего администратора проекта.'
  };
  var SIGNUP_REFUSED = 'Не получилось зарегистрироваться с этим email. Если у вас уже есть аккаунт — войдите; ' +
    'забыли пароль — обратитесь к координатору проекта.';
  var AUTH_TEXT = {
    invalid_credentials: 'Неверный email или пароль.',
    invalid_grant: 'Неверный email или пароль.',
    weak_password: 'Пароль слишком простой или короткий. Нужно не меньше 8 знаков — буквы и цифры.',
    // Нейтрально: текст не подтверждает, что email уже зарегистрирован (иначе форма — способ проверить чужой адрес).
    user_already_exists: SIGNUP_REFUSED,
    email_exists: SIGNUP_REFUSED,
    over_request_rate_limit: 'Слишком много попыток с этого устройства или сети. Подождите несколько минут и попробуйте снова.',
    over_email_send_rate_limit: 'Онлайн-база временно не принимает регистрации. Попробуйте позже или обратитесь к координатору проекта.',
    email_address_invalid: 'Проверьте адрес email.',
    validation_failed: 'Проверьте адрес email и пароль.',
    signup_disabled: 'Регистрация новых аккаунтов сейчас закрыта. Обратитесь к координатору проекта.',
    email_provider_disabled: 'Регистрация новых аккаунтов сейчас закрыта. Обратитесь к координатору проекта.',
    email_not_confirmed: 'Email этого аккаунта не подтверждён. Обратитесь к координатору проекта.',
    user_banned: 'Аккаунт заблокирован. Обратитесь к координатору проекта.',
    session_not_found: 'Сеанс входа закончился. Войдите снова.',
    session_expired: 'Сеанс входа закончился. Войдите снова.',
    refresh_token_not_found: 'Сеанс входа закончился. Войдите снова.',
    refresh_token_already_used: 'Сеанс входа закончился. Войдите снова.',
    bad_jwt: 'Сеанс входа закончился. Войдите снова.',
    PGRST301: 'Сеанс входа закончился. Войдите снова.',
    PGRST303: 'Сеанс входа закончился. Войдите снова.'
  };
  DB.ERROR_FALLBACK = 'Не получилось выполнить действие. Попробуйте ещё раз; если повторится — сообщите координатору проекта.';
  DB.ERROR_NETWORK = 'Нет связи с онлайн-базой. Проверьте интернет и попробуйте снова.';

  function isNetworkError(err) {
    var msg = typeof err.message === 'string' ? err.message : '';
    return err.name === 'AuthRetryableFetchError' || err.name === 'TypeError' || err.name === 'AbortError' ||
      err.name === 'TimeoutError' || /Failed to fetch|NetworkError|Load failed/i.test(msg);
  }
  // Временный сбой (нет связи, база не ответила вовремя, ошибка сервера 5xx) — повтор может помочь, сессия
  // на устройстве при этом не теряет силу. Ошибки входа (неверный пароль, истёкший сеанс) сюда не относятся.
  DB.isTemporaryError = function (err) {
    if (!err || typeof err !== 'object') return false;
    if (isNetworkError(err)) return true;
    return typeof err.status === 'number' && (err.status === 0 || err.status >= 500);
  };
  // Ошибка «база не ответила за отведённое время» (страница аккаунта ждёт проверку входа не дольше 8 с).
  DB.timeoutError = function () {
    var e = new Error('timeout');
    e.name = 'TimeoutError';
    return e;
  };

  // Ошибка Supabase (Auth, PostgREST/RPC, сеть) → понятный текст. Сырой текст ошибки не показывается.
  DB.errorText = function (err) {
    if (!err) return DB.ERROR_FALLBACK;
    var msg = typeof err.message === 'string' ? err.message : '';
    var token = (msg.split(':')[0] || '').trim();
    if (/^[a-z_]+$/.test(token) && own(RPC_TEXT, token)) return RPC_TEXT[token];
    var code = typeof err.code === 'string' ? err.code : '';
    if (code && own(AUTH_TEXT, code)) return AUTH_TEXT[code];
    if (err.status === 429 || /rate limit/i.test(msg)) return AUTH_TEXT.over_request_rate_limit;
    if (/^Invalid login credentials$/i.test(msg)) return AUTH_TEXT.invalid_credentials;
    if (/already (been )?registered|already exists/i.test(msg)) return AUTH_TEXT.user_already_exists;
    if (err.name === 'AuthWeakPasswordError' || /password should/i.test(msg)) return AUTH_TEXT.weak_password;
    if (isNetworkError(err)) return DB.ERROR_NETWORK;
    if (code === '42501') return RPC_TEXT.forbidden;
    return DB.ERROR_FALLBACK;
  };
})();
