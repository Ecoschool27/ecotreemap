// EcoTreeMap — страница «Аккаунт» (pages/account.html): вход и выход руководителя, регистрация,
// создание команды, статус команды и код заявки. Всё через ECO.DB (assets/js/db.js) — клиент с сессией.
// Вывод — только textContent / createElement; данные пользователя в разметку как HTML не попадают.
(function () {
  'use strict';

  var ECO = window.ECO;
  if (!ECO || !ECO.DB) return; // нет common.js/db.js — страховка в account.html покажет причину
  var DB = ECO.DB;

  function $(id) { return document.getElementById(id); }
  var SECTIONS = ['acc-offline', 'acc-loading', 'acc-retry', 'acc-signin', 'acc-signup', 'acc-profile', 'acc-team', 'acc-newteam'];
  var BUTTONS = ['signin-btn', 'signup-btn', 'signout-btn', 'team-btn', 'retry-btn', 'retry-signout-btn'];
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var STATUS_HINT = {
    pending: 'Сообщите код заявки координатору проекта лично (не в чате и не по почте): по нему модератор подтвердит команду.',
    approved: 'Команда подтверждена модератором.',
    rejected: 'Заявка отклонена. Обратитесь к координатору проекта.',
    suspended: 'Работа команды приостановлена. Обратитесь к координатору проекта.'
  };

  function only(ids) {
    SECTIONS.forEach(function (id) { var n = $(id); if (n) n.hidden = ids.indexOf(id) === -1; });
  }
  function message(text, kind) {
    var box = $('acc-msg');
    box.textContent = text || '';
    box.className = 'acc-msg' + (kind ? ' acc-msg--' + kind : '');
    box.hidden = !text;
  }
  var busy = false;
  function setBusy(on) {
    busy = on;
    BUTTONS.forEach(function (id) { var b = $(id); if (b) b.disabled = on; });
  }
  // Действие с блокировкой кнопок (без двойной отправки) и русским текстом ошибки.
  function act(work) {
    if (busy) return Promise.resolve();
    setBusy(true);
    return Promise.resolve().then(work).then(null, function (e) {
      if (window.console) console.warn('[EcoTreeMap] аккаунт: ' + String(e && (e.code || e.name) || 'ошибка'));
      message(DB.errorText(e), 'error');
    }).then(function () { setBusy(false); });
  }

  function render(p) {
    if (!p) {
      only(['acc-signin', 'acc-signup']);
      return;
    }
    $('acc-email').textContent = p.email || '—';
    $('acc-role').textContent = DB.ROLES[p.role] || DB.ROLES.team;
    $('acc-code').textContent = p.accountCode || '—';
    var staff = p.role === 'moderator' || p.role === 'admin';
    // Ссылка «Модерация» статична в account.html и видна только модератору/админу. Доступ к самой
    // странице определяет роль (moderate.js) и RLS базы, а не скрытость ссылки.
    $('acc-moderate').hidden = !staff;
    var show = ['acc-profile'];
    if (p.team) {
      $('team-name').textContent = p.team.name;
      $('team-school').textContent = p.team.school || 'не указана';
      $('team-status').textContent = DB.TEAM_STATUS[p.team.status] || 'неизвестен';
      $('team-status').setAttribute('data-status', p.team.status);
      $('team-code').textContent = p.requestCode || '—';
      $('team-hint').textContent = STATUS_HINT[p.team.status] || '';
      show.push('acc-team');
    } else if (p.role === 'team') {
      show.push('acc-newteam');
    }
    only(show);
  }

  // Нет связи с базой при сохранённом входе: форму входа НЕ показываем (сессия на устройстве жива) —
  // «Повторить» и «Выйти на этом устройстве» (выход удаляет сессию с устройства и без связи).
  function showRetry() {
    message('');
    only(['acc-retry']);
  }

  var CHECK_TIMEOUT_MS = 8000; // начальная проверка входа и «Повторить» ждут базу не дольше 8 с
  var attempt = 0;
  // Загрузка профиля. Ответ, пришедший после таймаута или после следующей попытки, не перерисовывает страницу.
  function refresh() {
    var my = ++attempt;
    var timer = null;
    var timeout = new Promise(function (resolve) {
      timer = setTimeout(function () { resolve({ timeout: true }); }, CHECK_TIMEOUT_MS);
    });
    var load = DB.loadProfile().then(function (p) { return { profile: p }; }, function (e) { return { error: e }; });
    return Promise.race([load, timeout]).then(function (r) {
      clearTimeout(timer);
      if (my !== attempt) return; // уже идёт более новая попытка — она и нарисует страницу
      if (r.timeout) {
        if (window.console) console.warn('[EcoTreeMap] аккаунт: база не ответила за ' + (CHECK_TIMEOUT_MS / 1000) + ' с');
        showRetry();
        return;
      }
      if (!r.error) {
        render(r.profile);
        return;
      }
      var e = r.error;
      if (window.console) console.warn('[EcoTreeMap] аккаунт: профиль не загрузился (' + String(e && (e.code || e.name) || 'ошибка') + ')');
      if (DB.isTemporaryError(e)) {
        showRetry();
        return;
      }
      message(DB.errorText(e), 'error');
      render(null);
    });
  }

  function onRetry() {
    act(function () {
      message('');
      only(['acc-loading']);
      return refresh();
    });
  }

  function offlineReason() {
    if (!DB.networkAllowed()) {
      return 'Сайт открыт с диска (флешки): вход и регистрация работают только на опубликованном сайте в интернете.';
    }
    if (!DB.config()) return 'Онлайн-база выключена в настройках сайта — вход и регистрация сейчас недоступны.';
    return 'Не загрузилась библиотека онлайн-базы (папка assets/lib/supabase). Обновите страницу.';
  }

  function onSignIn(ev) {
    ev.preventDefault();
    var email = $('signin-email').value.trim();
    var pass = $('signin-password').value;
    if (!EMAIL_RE.test(email) || !pass) {
      message('Введите email и пароль.', 'error');
      return;
    }
    act(function () {
      message('');
      return DB.signIn(email, pass).then(function () {
        $('signin-password').value = '';
        message('Вы вошли.', 'ok');
        return refresh();
      });
    });
  }

  function onSignUp(ev) {
    ev.preventDefault();
    var email = $('signup-email').value.trim();
    var pass = $('signup-password').value;
    var pass2 = $('signup-password2').value;
    if (!EMAIL_RE.test(email)) { message('Проверьте адрес email.', 'error'); return; }
    if (pass.length < 8) { message('Пароль — не меньше 8 знаков.', 'error'); return; }
    if (pass !== pass2) { message('Пароли не совпадают.', 'error'); return; }
    act(function () {
      message('');
      return DB.signUp(email, pass).then(function (r) {
        $('signup-password').value = '';
        $('signup-password2').value = '';
        if (!r.session) {
          // В проекте включено подтверждение email, а сайт писем не отправляет — войти пока нельзя.
          message('Аккаунт создан, но войти пока нельзя: в онлайн-базе включено подтверждение email, а сайт писем ' +
            'не отправляет. Обратитесь к координатору проекта — он подтвердит аккаунт, после этого войдите.', 'warn');
          return;
        }
        message('Аккаунт создан, вы вошли. Теперь создайте команду.', 'ok');
        return refresh();
      });
    });
  }

  function onSignOut() {
    act(function () {
      // команда последнего входа для полевого режима (field-sync.js) — после выхода не должна применяться
      ECO.storageRemove('ecotreemap_field_team');
      return DB.signOut().then(function () {
        message('Вы вышли на этом устройстве.', 'ok');
        render(null);
      });
    });
  }

  function onTeam(ev) {
    ev.preventDefault();
    var name = $('team-name-input').value.replace(/\s+/g, ' ').trim();
    var school = $('team-school-input').value.replace(/\s+/g, ' ').trim();
    if (name.length < 3 || name.length > 60) { message('Название команды — от 3 до 60 знаков.', 'error'); return; }
    if (school.length > 80) { message('Название школы — не длиннее 80 знаков.', 'error'); return; }
    if (!$('team-consent').checked) {
      message('Без согласия на обработку данных команду создать нельзя — отметьте галочку.', 'error');
      return;
    }
    act(function () {
      message('');
      return DB.registerTeam(name, school).then(function (code) {
        message('Команда создана. Код заявки: ' + String(code || '') + ' — сообщите его координатору проекта лично.', 'ok');
        $('team-name-input').value = '';
        $('team-school-input').value = '';
        $('team-consent').checked = false;
        return refresh();
      });
    });
  }

  function start() {
    var cfg = window.ECO_CONFIG || {};
    $('consent-version').textContent = typeof cfg.CONSENT_VERSION === 'string' ? cfg.CONSENT_VERSION : '—';
    if (!DB.enabled()) {
      $('acc-offline-text').textContent = offlineReason();
      only(['acc-offline']);
      return Promise.resolve();
    }
    $('signin-form').addEventListener('submit', onSignIn);
    $('signup-form').addEventListener('submit', onSignUp);
    $('team-form').addEventListener('submit', onTeam);
    $('signout-btn').addEventListener('click', onSignOut);
    $('retry-btn').addEventListener('click', onRetry);
    $('retry-signout-btn').addEventListener('click', onSignOut);
    var client = DB.session();
    // Выход в другой вкладке или истёкшая сессия — показать вход. Запросы к базе внутри обработчика
    // не делаются (рекомендация supabase-js: только вне колбэка).
    client.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') setTimeout(function () { render(null); }, 0);
    });
    return refresh();
  }

  var p;
  try {
    p = start();
  } catch (e) {
    p = Promise.reject(e);
  }
  window.ECO_PAGE_PENDING = p.then(function () {
    window.ECO_PAGE_DONE = true;
  }, function (e) {
    only([]);
    ECO.showFatal('Страница аккаунта не загрузилась', [DB.errorText(e)]);
    window.ECO_PAGE_DONE = true; // причина показана — страховка account.html её не перезапишет
  });
})();
