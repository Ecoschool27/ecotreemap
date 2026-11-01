// EcoTreeMap — карточка «Поделиться» для паспорта дерева (pages/tree.html).
// Картинка 1080×1350 рисуется в canvas: порода, номер, «Я слежу за этим деревом», состояние,
// QR на паспорт (адрес из SITE_BASE_URL, библиотека qrcode-generator), название проекта и адрес сайта.
// Имён людей на картинке нет. Отправка — Web Share API с файлом, если браузер умеет; «Скачать картинку»
// и «Скопировать ссылку» показываются всегда (запасной путь). В сеть ничего не отправляется.
(function () {
  'use strict';
  var ECO = window.ECO;
  if (!ECO) return;
  // Страховка от смешения версий в кэше браузера (этот файл новее common.js): нет функции — тихая деградация.
  if (typeof ECO.t !== 'function') ECO.t = window.ECO_T || function (k, ru) { return ru; };
  if (typeof ECO.spName !== 'function') ECO.spName = function (sp) { return sp ? sp.name_ru : ''; };
  var el = ECO.el;
  var W = 1080, H = 1350;

  // Постоянный https-адрес сайта или null (временные туннели и localhost не годятся для QR).
  ECO.siteBaseUrl = function () {
    var cfg = window.ECO_CONFIG || {};
    var raw = typeof cfg.SITE_BASE_URL === 'string' ? cfg.SITE_BASE_URL.trim().replace(/\/+$/, '') : '';
    var m = /^https:\/\/([a-z0-9.-]+)(\/[A-Za-z0-9._~\/-]*)?$/i.exec(raw);
    if (!m) return null;
    var host = m[1].toLowerCase();
    if (/(^|\.)localhost$|ngrok|trycloudflare|loca\.lt|serveo|localhost\.run|lhr\.(life|rocks)/.test(host) ||
        /^\d+(\.\d+){3}$/.test(host) || host.indexOf('.') === -1) return null;
    return raw;
  };
  ECO.passportUrl = function (id) {
    var base = ECO.siteBaseUrl();
    return base ? base + '/pages/tree.html?id=' + encodeURIComponent(id) : null;
  };

  function wrap(g, text, maxW) {
    var words = String(text).split(/\s+/);
    var lines = [];
    var line = '';
    words.forEach(function (w) {
      var test = line ? line + ' ' + w : w;
      if (g.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  // Рисует карточку; возвращает canvas. url — адрес паспорта (null — без QR).
  ECO.buildShareCanvas = function (tree, sp, url) {
    var c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    var g = c.getContext('2d');
    g.fillStyle = '#1b5e20';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff';
    g.textBaseline = 'top';
    g.font = 'bold 40px sans-serif';
    g.fillText('EcoTreeMap', 72, 64);
    g.font = '34px sans-serif';
    g.fillText((ECO.tr || String)('Карта посаженных деревьев · Караганда'), 72, 118);

    var y = 220;
    g.font = 'bold 76px sans-serif';
    // порода из species_note («Другая порода») — данные команды, на картинке без перевода
    var spTitle = ECO.speciesFromNote && ECO.speciesFromNote(tree) ? sp.name_ru : (ECO.tr || String)(sp.name_ru || 'Дерево');
    wrap(g, spTitle, W - 144).slice(0, 2).forEach(function (l) { g.fillText(l, 72, y); y += 88; });
    g.font = 'bold 60px sans-serif';
    g.fillText((ECO.tr || String)('Дерево ' + tree.id), 72, y + 8);
    y += 100;
    g.font = '46px sans-serif';
    g.fillText((ECO.tr || String)('Я слежу за этим деревом'), 72, y);
    y += 64;
    g.font = '36px sans-serif';
    g.fillText((ECO.tr || String)('Состояние: ' + ECO.statusLabel(tree.status)), 72, y);

    var qrSize = 520;
    var qx = (W - qrSize) / 2, qy = 640;
    if (url && typeof window.qrcode === 'function') {
      var qr = window.qrcode(0, 'M');
      qr.addData(url, 'Byte');
      qr.make();
      var n = qr.getModuleCount();
      var cell = Math.floor(qrSize / (n + 8));
      var size = cell * (n + 8);
      qx = Math.round((W - size) / 2);
      g.fillStyle = '#ffffff';
      g.fillRect(qx, qy, size, size);
      g.fillStyle = '#000000';
      for (var r = 0; r < n; r++) {
        for (var col = 0; col < n; col++) {
          if (qr.isDark(r, col)) g.fillRect(qx + (col + 4) * cell, qy + (r + 4) * cell, cell, cell);
        }
      }
      qrSize = size;
      g.fillStyle = '#ffffff';
      g.font = '32px sans-serif';
      g.fillText((ECO.tr || String)('Наведите камеру — откроется паспорт дерева'), 72, qy + qrSize + 28);
    }
    g.font = '30px sans-serif';
    var host = (ECO.siteBaseUrl() || '').replace(/^https:\/\//, '');
    if (host) wrap(g, host, W - 144).slice(0, 2).forEach(function (l, i) { g.fillText(l, 72, H - 110 + i * 38); });
    return c;
  };

  function download(blob, name) {
    var u = URL.createObjectURL(blob);
    var a = el('a', { href: u, attrs: { download: name } });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }

  ECO.shareSection = function (tree, sp) {
    var url = ECO.passportUrl(tree.id);
    var status = el('p', { className: 'result', attrs: { role: 'status' }, hidden: true });
    var preview = el('img', { className: 'share-preview', hidden: true, attrs: { alt: 'Карточка дерева ' + tree.id + ' для отправки' } });
    var actions = el('div', { className: 'btn-row', hidden: true });
    var canvas = null;
    var ready = null; // {blob, file} — картинка, подготовленная заранее (при нажатии «Поделиться»)
    function say(text) { status.textContent = text; status.hidden = false; }
    var fileName = 'ecotreemap-' + tree.id + '.png';
    // Готовая картинка или ожидание её (toBlob асинхронный, обычно доли секунды).
    function withBlob(cb) {
      if (ready) { cb(ready.blob); return; }
      canvas.toBlob(function (blob) { if (blob) cb(blob); else say('Не удалось подготовить картинку — обновите страницу.'); }, 'image/png');
    }
    function shareFailed(err) {
      if (err && err.name === 'AbortError') { say('Отправка отменена. Можно скачать картинку или скопировать ссылку — кнопки выше.'); return; }
      say('Не удалось отправить картинку' + (err && err.name === 'NotAllowedError' ? ' (браузер не разрешил отправку)' : '') +
        '. Скачайте картинку или скопируйте ссылку — кнопки выше.');
    }

    var btn = el('button', {
      type: 'button', className: 'btn btn--primary btn--block', text: 'Поделиться',
      onclick: function () {
        canvas = ECO.buildShareCanvas(tree, sp, url);
        preview.src = canvas.toDataURL('image/png');
        preview.hidden = false;
        ECO.clear(actions);
        status.hidden = true;
        ready = null;
        var probe = null;
        try { probe = new File([new Blob(['x'], { type: 'image/png' })], fileName, { type: 'image/png' }); } catch (e) { probe = null; }
        var canFiles = false;
        try { canFiles = !!(probe && navigator.canShare && navigator.share && navigator.canShare({ files: [probe] })); } catch (e) { canFiles = false; }
        // Картинка готовится сразу: тогда navigator.share вызывается прямо в нажатии «Отправить картинку»
        // (браузеры разрешают отправку только в пользовательском жесте, без ожидания).
        var sendBtn = null;
        if (canFiles) {
          // кнопка неактивна, пока картинка не готова (доли секунды)
          sendBtn = el('button', {
            type: 'button', className: 'btn btn--primary', text: 'Отправить картинку', disabled: true,
            onclick: function () {
              if (!ready || !ready.file) { say('Картинка ещё готовится — нажмите «Отправить картинку» ещё раз через секунду.'); return; }
              var p;
              try {
                p = navigator.share({ files: [ready.file], title: 'Дерево ' + tree.id, text: 'Я слежу за этим деревом', url: url || undefined });
              } catch (e) { shareFailed(e); return; }
              Promise.resolve(p).then(function () { say('Отправлено.'); }, shareFailed);
            }
          });
          actions.appendChild(sendBtn);
        }
        var shot = canvas;
        canvas.toBlob(function (blob) {
          if (shot !== canvas) return;
          if (!blob) { say('Не удалось подготовить картинку — скопируйте ссылку кнопкой «Скопировать ссылку».'); return; }
          var file = null;
          try { file = new File([blob], fileName, { type: 'image/png' }); } catch (e) { file = null; }
          ready = { blob: blob, file: file };
          if (sendBtn) sendBtn.disabled = !file;
        }, 'image/png');
        // «Скачать» и «Скопировать ссылку» — всегда: и без Web Share API, и как запасной путь, если отправка не удалась.
        actions.appendChild(el('button', {
          type: 'button', className: canFiles ? 'btn btn--outline' : 'btn btn--primary', text: 'Скачать картинку',
          onclick: function () { withBlob(function (blob) { download(blob, fileName); say('Картинка сохранена: ' + fileName + '.'); }); }
        }));
        actions.appendChild(el('button', {
          type: 'button', className: 'btn btn--outline', text: 'Скопировать ссылку',
          onclick: function () {
            var link = url || window.location.href;
            var done = function () { say('Ссылка скопирована: ' + link); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(link).then(done, function () { say('Скопируйте ссылку вручную: ' + link); });
            } else say('Скопируйте ссылку вручную: ' + link);
          }
        }));
        actions.hidden = false;
        if (!url) say('Адрес сайта не задан — на картинке нет QR-кода.');
      }
    });
    return el('section', { className: 'card', attrs: { id: 'share' } }, [
      el('h2', { text: 'Поделиться' }),
      el('p', { className: 'muted', text: 'Картинка с номером дерева и QR-кодом на его паспорт — без имён.' }),
      btn, preview, actions, status
    ]);
  };
})();
