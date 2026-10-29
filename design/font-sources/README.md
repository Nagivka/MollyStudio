# Исходник шрифта значков

Полная `MaterialSymbolsRounded.woff2` сохранена здесь для восстановления и добавления значков. В дистрибутив папка `design` не входит. В интерфейс поставляется компактный шрифт с теми же контурами, вариативной толщиной и заполненными состояниями. Текстовые шрифты редактора не сокращаются.

Обновление после добавления значков:

```powershell
python -m pip install -r scripts/requirements-font-tools.txt
python scripts/optimize-material-symbols.py
node scripts/run-electron-check.cjs scripts/font-subset-scenarios.cjs
```

Генератор ищет совпадающие названия во всех исходниках интерфейса, включая динамические варианты, и сохраняет манифест. Модульная проверка обнаруживает новые названия, для которых требуется пересборка. Визуальная проверка сравнивает все значки попиксельно с полным исходником при трёх размерах, пяти толщинах и двух состояниях заполнения.

Google Material Symbols, Copyright 2026 Google LLC. Лицензия Apache 2.0: [оригинал](https://github.com/google/material-design-icons/blob/master/LICENSE). Копия лицензии поставляется в `src/renderer/assets/fonts/MaterialSymbols-LICENSE.txt`. Изменение MollyStudio: исключены неиспользуемые глифы; формы оставшихся символов сохранены.
