// EcoTreeMap — справочник пород (только породы, реально посаженные в проекте).
// Файл .js (а не .json), чтобы сайт открывался с флешки (file://) без сервера.
// Латинское название — до рода: точный вид саженцев не подтверждён документами.
// Поля с пустым значением ("" / null) сайт показывает как «нужен источник» или скрывает:
//   care / care_source — рекомендации по уходу и источник, откуда они взяты;
//   co2_kg_per_year_per_cm / co2_source — коэффициент поглощения CO2 и его источник
//     (на сайте CO2 не показывается, пока нет источника);
//   photo — имя файла в папке images/ (показывается только при наличии записи
//     с автором и лицензией в images/sources.js).
// color — цвет точек породы на карте.
window.ECO_SPECIES = {
  "lipa": {
    "name_ru": "Липа",
    "name_lat": "Tilia sp.",
    "name_lat_note": "вид не уточнён",
    "color": "#007a5a",
    "care": "",
    "care_source": "",
    "co2_kg_per_year_per_cm": null,
    "co2_source": "",
    "photo": "lipa.jpg"
  },
  "cheremukha": {
    "name_ru": "Черёмуха",
    "name_lat": "Padus sp.",
    "name_lat_note": "вид не уточнён; в ряде систематик черёмухи относят к роду Prunus",
    "color": "#a3297a",
    "care": "",
    "care_source": "",
    "co2_kg_per_year_per_cm": null,
    "co2_source": "",
    "photo": "cheremukha.jpg"
  },
  "yablonya": {
    "name_ru": "Яблоня",
    "name_lat": "Malus sp.",
    "name_lat_note": "вид/сорт не уточнён",
    "color": "#c45000",
    "care": "",
    "care_source": "",
    "co2_kg_per_year_per_cm": null,
    "co2_source": "",
    "photo": "yablonya.jpg"
  }
};
