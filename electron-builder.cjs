module.exports = {
    appId: 'ua.nagivka.mollystudio',
    productName: 'MollyStudio',
    buildVersion: '1.4.0.0',
    copyright: 'Copyright © 2026 nagivka',
    directories: {output: 'dist'},
    files: ['src/main/**/*.cjs', 'src/preload/**/*.cjs', 'src/renderer/**/*', 'package.json', '!src/main/test-mode.cjs'],
    asar: true,
    electronFuses: {
        runAsNode: false,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: false,
        enableEmbeddedAsarIntegrityValidation: true,
        onlyLoadAppFromAsar: true,
        grantFileProtocolExtraPrivileges: false
    },
    compression: 'maximum',
    electronLanguages: ['en-US', 'ru'],
    npmRebuild: false,
    forceCodeSigning: false,
    publish: null,
    win: {
        icon: 'src/renderer/assets/images/icon/app.ico',
        target: [{target: 'nsis', arch: ['x64']}],
        artifactName: 'MollyStudio-${version}-${arch}-setup.${ext}'
    },
    fileAssociations: [{ext: 'mlst', name: 'MollyStudio.Project', description: 'Проект MollyStudio',
        icon: 'src/renderer/assets/images/icon/mlst.ico', role: 'Editor'}],
    nsis: {oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'MollyStudio',
        installerLanguages: ['ru_RU', 'en_US'], displayLanguageSelector: true, deleteAppDataOnUninstall: false},
    portable: {artifactName: 'MollyStudio-${buildVersion}-${arch}-portable.${ext}'}
};
