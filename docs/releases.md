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

Задания с секретами работают только в официальном `Nagivka/MollyStudio`. Форкам ключи не передаются. Не используйте `pull_request_target` для исполнения кода внешних pull request с секретами.

Окружение `UPDATES_REPO_TOKEN` содержит ограниченный токен записи только в репозиторий релизов. Repository secret `UPDATES_SIGNING_KEY` содержит закрытый ключ Ed25519, соответствующий открытому ключу приложения. Значения не должны попадать в Git, логи, артефакты или готовую программу. Workflow **Check release repository access** проверяет доступ и ключ без изменения релизов. Подпись метаданных не является сертификатом Authenticode/Developer ID.

## Обновления приложения

Проверка выполняется в фоне при запуске и каждые шесть часов, если пользователь её не отключил. Ручная проверка — «Настройки → О программе». Проверяются подпись манифеста, версия, размер, SHA256 и SHA512 пакета. Установка требует явного действия пользователя и успешного сохранения проектов. Обычное закрытие не запускает установщик; отмена закрытия отменяет обновление.

Windows x64 **1.4.5.0** опубликована с установщиком, blockmap, SHA256, `latest.yml` и подписанным манифестом. SHA256 установщика: `e91f5b55dd262de84ab01104395e69099e4931b0cc3850d790cb67fd8c0f22e4`. Доступность других платформ проверяйте в Releases.
