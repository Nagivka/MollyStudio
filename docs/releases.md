# Выпуск MollyStudio

Исходники открыты в [Nagivka/MollyStudio](https://github.com/Nagivka/MollyStudio). Готовые пакеты и подписанные метаданные обновлений публикуются отдельно в [MollyStudio-Releases](https://github.com/Nagivka/MollyStudio-Releases/releases/latest).

## Проверка и сборка

Нужен Node.js 22.12 или новее. Сборки выполняются на соответствующей ОС.

```sh
npm ci
npm run typecheck
npm run core:verify
npm test
npm run audit
npm run test:desktop
npm run test:updates
```

- Windows x64: `npm run dist:nsis`.
- macOS Intel / Apple Silicon: `npm run dist:mac -- x64` / `npm run dist:mac -- arm64`.
- Linux x64 / ARM64: `npm run dist:linux -- x64` / `npm run dist:linux -- arm64`.
- Сверка файлов пакета с исходниками: `npm run check:distribution`.

Подпись, ограничения обновлений macOS и проверки Linux описаны в [совместимости платформ](platform-compatibility.md). Наличие конфигурации не заменяет проверку запуска на целевой системе.

## Официальная публикация

1. Обновите версии в `package.json`, `package-lock.json`, `electron-builder.cjs` и проверке `tests/unit/distribution.test.mjs`.
2. Добавьте пользовательские изменения в `releases/<версия>.md`.
3. Отправьте проверенные изменения в официальный репозиторий. Запустите **Build Windows installer** вручную с `Publish`, либо отправьте тег `v<версия>`.
4. Workflow ожидает Windows и нативные проверки. Публикация принимает только известные имена пакетов и проверяет размеры и контрольные суммы. Существующий релиз не перезаписывается.

Если Windows-релиз уже опубликован, workflow **Add checked native packages to release** добавляет к нему Linux/macOS. В `run_id` укажите успешный запуск **Native platform compatibility** на `main`. Требуются отчёты всех четырёх платформ/архитектур с совпадающей версией. Windows-пакет и его канал обновлений не изменяются; существующие отличающиеся файлы блокируют публикацию. Сборки Mac без Developer ID доступны для ручной установки, без публикации автоматического канала.

Задания с секретами работают только в официальном `Nagivka/MollyStudio`. Форкам ключи не передаются. Не используйте `pull_request_target` для исполнения кода внешних pull request с секретами.

Окружение `UPDATES_REPO_TOKEN` содержит ограниченный токен записи только в репозиторий релизов. Repository secret `UPDATES_SIGNING_KEY` содержит закрытый ключ Ed25519, соответствующий открытому ключу приложения. Значения не должны попадать в Git, логи, артефакты или готовую программу. Workflow **Check release repository access** проверяет доступ и ключ без изменения релизов. Подпись метаданных не является сертификатом Authenticode/Developer ID.

## Обновления приложения

Проверка выполняется в фоне при запуске и каждые шесть часов, если пользователь её не отключил. Ручная проверка — «Настройки → О программе». Проверяются подпись манифеста, версия, размер, SHA256 и SHA512 пакета. Установка требует явного действия пользователя и успешного сохранения проектов. Обычное закрытие не запускает установщик; отмена закрытия отменяет обновление.

Windows x64 **1.4.5.0** опубликована с установщиком, blockmap, SHA256, `latest.yml` и подписанным манифестом. SHA256 установщика: `e91f5b55dd262de84ab01104395e69099e4931b0cc3850d790cb67fd8c0f22e4`. Доступность других платформ проверяйте в Releases.

6 ноября 2026 к этому выпуску добавлены macOS x64/ARM64 (DMG и ZIP) и Linux x64/ARM64 (AppImage, DEB, RPM и TAR.GZ). [Нативный прогон](https://github.com/Nagivka/MollyStudio/actions/runs/42086085984) завершился успешно для всех четырёх целей: проверены редактор, перенос проектов Windows, запуск упакованного приложения; для Linux также установленный DEB, Wayland, замена и откат AppImage. Linux x64 повторён после медленной загрузки системных зависимостей с Ubuntu-зеркала.

[Публикация](https://github.com/Nagivka/MollyStudio/actions/runs/42096361117) проверила контрольные суммы файлов по отчётам сборки. Публичные SHA256, Linux-манифесты Ed25519 и сохранность Windows EXE проверены отдельно. Mac-пакеты имеют ad-hoc подпись, не имеют Developer ID и нотариализации Apple; их обновление выполняется вручную. Отчёт локальной проверки — `.test-output/published-native-1.4.5.json`.

## Проверка опубликованных пакетов

Workflow **Test published application packages** загружает файлы из публичного Releases, сверяет размеры, SHA256 и подписи каналов Windows/Linux, затем запускает пакеты на одноразовых runner. Для 1.4.5.0 прошли Windows NSIS, Linux AppImage и установленный DEB на x64/ARM64, [установка из DMG на Intel и Apple Silicon](https://github.com/Nagivka/MollyStudio/actions/runs/42098790378) и [установка RPM на Fedora x64/ARM64](https://github.com/Nagivka/MollyStudio/actions/runs/42098505109). В каждом случае проверены открытие и сохранение `.mlst`, попиксельное совпадение экспорта с проектом и штатное закрытие. На macOS также проверено открытие через Launch Services. Прогон Windows/Linux завершил соответствующие задания успешно; первоначальная проверка Mac была заменена отдельным прогоном с установкой из DMG.

В публичном релизе оставлены девять пакетов: один Windows EXE, два Mac DMG и AppImage/DEB/RPM для двух архитектур Linux. Дублирующие ZIP и TAR.GZ и отдельные контрольные суммы заменены единым `SHA256SUMS.txt`. `latest*.yml`, подписанные `release-manifest*.json` и Windows blockmap сохранены. После очистки все три канала обновления и контрольные суммы пакетов проверены повторно. Отчёт: `.test-output/release-145-clean-verified.json`.
