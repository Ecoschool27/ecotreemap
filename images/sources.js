// EcoTreeMap — источники и лицензии фотографий (страница pages/credits.html строит атрибуцию отсюда).
// Файл .js (а не .json), чтобы сайт открывался с флешки (file://) без сервера.
// Фото показывается на сайте ТОЛЬКО если для его файла здесь есть запись с автором и лицензией.
// Формат записи:
//   {
//     "file": "lipa.jpg",                       // имя файла в папке images/
//     "author": "Имя автора",                   // как требует лицензия
//     "license": "Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)", // полное название
//     "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",  // для Public Domain — ""
//     "source_page": "https://commons.wikimedia.org/wiki/File:...",       // страница, где взято фото
//     "note": "фото вида, не нашего дерева",    // пояснение для читателя
//     "modified": "уменьшено до 1200 px по ширине, пересжато в JPEG"     // какие изменения внесены (требование CC)
//   }
// Затем в data/species.js у породы указать "photo": "lipa.jpg".
window.ECO_IMAGE_SOURCES = [
  {
    "file": "lipa.jpg",
    "author": "Abraham",
    "license": "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    "license_url": "https://creativecommons.org/licenses/by/4.0/",
    "source_page": "https://commons.wikimedia.org/wiki/File:20240611_small-leaved_lime_Lipa_drobnolistna_Tilia_cordata_Katowice_Powsta%C5%84c%C3%B3w_01.jpg",
    "note": "фото вида, не нашего дерева",
    "modified": "уменьшено до 1200 px по ширине, пересжато в JPEG"
  },
  {
    "file": "cheremukha.jpg",
    "author": "DidierFy",
    "license": "Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)",
    "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
    "source_page": "https://commons.wikimedia.org/wiki/File:Prunus_padus_04.2025_(1).jpg",
    "note": "фото вида, не нашего дерева",
    "modified": "уменьшено до 1200 px по ширине, пересжато в JPEG"
  },
  {
    "file": "yablonya.jpg",
    "author": "Doncsecz",
    "license": "Общественное достояние (Public Domain)",
    "license_url": "",
    "source_page": "https://commons.wikimedia.org/wiki/File:Jablan_na_Verici.JPG",
    "note": "фото вида, не нашего дерева",
    "modified": "уменьшено до 1200 px по ширине, пересжато в JPEG"
  }
];
