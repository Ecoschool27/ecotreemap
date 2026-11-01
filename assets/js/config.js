// EcoTreeMap — настройки сайта. Меняются только здесь.
window.ECO_CONFIG = {
  // Адрес координатора проекта для кнопок «Сообщить о проблеме» и «Я полил(а)».
  // Пока пусто — кнопки работают в демо-режиме: письмо не формируется, сайт честно об этом пишет.
  // Пример: CONTACT_EMAIL: "coordinator@example.org"
  CONTACT_EMAIL: "",

  // Постоянный адрес опубликованного сайта без завершающего слеша — ЕДИНЫЙ источник адреса для QR
  // (полевой режим tools/field.html и скрипты generate_qr.py, tools/merge_field.py читают его отсюда).
  // Только https и постоянный домен: localhost, IP-адреса, ngrok/trycloudflare/serveo/localhost.run
  // запрещены — напечатанные таблички с временным адресом перестанут открываться.
  // Пусто — QR не строятся. Адрес утверждён владельцем 2026-11-01.
  SITE_BASE_URL: "https://ecoschool27.github.io/ecotreemap",

  // Полевой режим: точность GPS (в метрах), при которой можно «Зафиксировать» точку.
  FIELD_GPS_ACCURACY_M: 10,

  // Подпись к фотографиям конкретных деревьев (сделаны участниками проекта).
  TREE_PHOTO_CREDIT: "Фото: участники проекта EcoTreeMap",

  // Место посадок: Караганда, этнопарк, рядом стела «Сүйінші».
  // Центр карты по умолчанию и начальный масштаб (стартовый вид; места деревьев отмечаются
  // в tools/editor.html и tools/field.html).
  MAP_CENTER: [49.777, 73.124],
  MAP_ZOOM: 16,

  // Источник данных публичных страниц:
  //   "supabase" — онлайн-база проекта; при любом сбое (нет сети, база спит, отказ, 5 с без ответа)
  //                сайт целиком берёт снимок data/trees.js и data/species.js;
  //   "static"   — только снимок data/trees.js и data/species.js (откат без базы).
  // С флешки (file://) сайт всегда работает на снимке и в сеть не ходит.
  DATA_SOURCE: "supabase",

  // Проекты Supabase. Ключ publishable — публичный (не секрет): права даёт только политика
  // базы (RLS). Секретные ключи сюда НЕ вписывать никогда — сборка (tools/build_publish.py) откажет.
  SUPABASE_PROJECTS: {
    prod: { url: "https://ovwjcdnasupqjkhrgmcq.supabase.co", key: "sb_publishable_fxBIIOvubF_DfabMcaSX-Q_fqpSS7H6" },
    test: { url: "https://kkshzshzvmypbguqwyuy.supabase.co", key: "sb_publishable_zbtLn8BPwm9GM6AfXfMqjg_KAcGeFyC" }
  },
  // Какой проект использует сайт. Публикуется только "prod" (сборка проверяет).
  // Переключение через адрес страницы или хранилище браузера намеренно не предусмотрено.
  SUPABASE_TARGET: "prod",

  // Версия текста согласия на обработку данных (страница «Аккаунт»).
  CONSENT_VERSION: "2026-11-01"
};
