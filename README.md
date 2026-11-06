# MollyStudio

Редактор GUI для Minecraft Java Edition, пиксельной графики, префиксов и 3D-надписей.

## Скачать

**[Последняя версия](https://github.com/Nagivka/MollyStudio-Releases/releases/latest)**

| Система | Какой файл скачать |
| --- | --- |
| Windows 10/11, x64 | `*-x64-setup.exe` — установщик |
| macOS, Apple Silicon (M1 и новее) | `*-arm64-mac.dmg` |
| macOS, Intel | `*-x64-mac.dmg` |
| Linux, универсальный запуск | `*-x64-linux.AppImage` или `*-arm64-linux.AppImage` |
| Ubuntu, Debian, Linux Mint | `*-x64-linux.deb` или `*-arm64-linux.deb` |
| Fedora, openSUSE и системы с RPM | `*-x64-linux.rpm` или `*-arm64-linux.rpm` |

Для обычного Intel/AMD-компьютера выбирайте **x64**, для ARM — **arm64**. В Linux разрешите запуск AppImage в свойствах файла. Совместимость и ограничения: [подробнее](docs/platform-compatibility.md).

Файлы `.yml`, `.blockmap`, `release-manifest*.json` нужны автообновлению — вручную их скачивать не требуется. `SHA256SUMS.txt` предназначен для проверки загрузки. Архивы **Source code** на GitHub содержат исходники, а не готовую программу.

Проекты сохраняются в **.mlst**, готовые изображения — в **PNG**. Обновления доступны в «Настройки → О программе».

## Разработка

Node.js 22.12+:

```sh
npm ci
npm start
```

[Выпуск сборок](docs/releases.md) · [Лицензия MIT](LICENSE) · [Сторонние ресурсы](THIRD_PARTY_NOTICES.md)
