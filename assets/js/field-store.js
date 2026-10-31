// EcoTreeMap — хранилище полевого режима (IndexedDB): записи и фото живут в браузере телефона,
// пока их не выгрузят в файл JSON. Ничего не отправляет в сеть.
(function () {
  'use strict';
  var DB_NAME = 'ecotreemap_field';
  var DB_VERSION = 1;
  var dbPromise = null;

  function req(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('Браузер не поддерживает IndexedDB — записи негде сохранить.'));
        return;
      }
      var r = window.indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'record_uid' });
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
      };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error || new Error('Не удалось открыть хранилище браузера.')); };
      r.onblocked = function () { reject(new Error('Хранилище занято другой вкладкой — закройте её.')); };
    });
    return dbPromise;
  }

  function tx(stores, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(stores, mode);
        var out;
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('Запись в хранилище отменена (мало места?).')); };
        Promise.resolve(fn(t)).then(function (v) { out = v; }, function (e) { try { t.abort(); } catch (x) { /* уже завершена */ } reject(e); });
      });
    });
  }

  window.ECO_FIELD_STORE = {
    open: open,
    all: function () {
      return tx(['records'], 'readonly', function (t) { return req(t.objectStore('records').getAll()); });
    },
    get: function (uid) {
      return tx(['records'], 'readonly', function (t) { return req(t.objectStore('records').get(uid)); });
    },
    // Сохраняет запись и (необязательно) фото одной транзакцией.
    save: function (record, photoBlob) {
      return tx(['records', 'photos'], 'readwrite', function (t) {
        t.objectStore('records').put(record);
        if (photoBlob) t.objectStore('photos').put(photoBlob, record.record_uid);
      });
    },
    getPhoto: function (uid) {
      return tx(['photos'], 'readonly', function (t) { return req(t.objectStore('photos').get(uid)); });
    },
    markExported: function (uids, when) {
      return tx(['records'], 'readwrite', function (t) {
        var store = t.objectStore('records');
        return Promise.all(uids.map(function (uid) {
          return req(store.get(uid)).then(function (rec) {
            if (!rec) return;
            rec.exported_at = when;
            store.put(rec);
          });
        }));
      });
    },
    // Просит браузер не удалять данные сайта при нехватке места. Возвращает true/false/null.
    persist: function () {
      if (navigator.storage && navigator.storage.persist) {
        return navigator.storage.persist().catch(function () { return null; });
      }
      return Promise.resolve(null);
    }
  };
})();
