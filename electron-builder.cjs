module.exports = {
    appId: 'ua.nagivka.mollystudio',
    productName: 'MollyStudio',
    buildVersion: '1.4.5.0',
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
    publish: {provider: 'generic', url: 'https://github.com/Nagivka/MollyStudio-Releases/releases/latest/download/'},
    win: {
        icon: 'src/renderer/assets/images/icon/app.ico',
        target: [{target: 'nsis', arch: ['x64']}],
        artifactName: 'MollyStudio-${buildVersion}-${arch}-setup.${ext}'
    },
    fileAssociations: [{ext: 'mlst', name: 'MollyStudio.Project', description: 'Проект MollyStudio',icon:'src/renderer/assets/images/icon/mlst.ico',mimeType:'application/x-mollystudio-project',role:'Editor'}],
    mac: {
        icon:'src/renderer/assets/images/icon/app.icns',category:'public.app-category.graphics-design',
        bundleVersion:require('./package.json').version,
        minimumSystemVersion:'13.0.0',hardenedRuntime:true,entitlements:'build-config/entitlements.mac.plist',entitlementsInherit:'build-config/entitlements.mac.plist',
        target:[{target:'dmg',arch:['x64','arm64']},{target:'zip',arch:['x64','arm64']}],
        artifactName:'MollyStudio-${buildVersion}-${arch}-mac.${ext}'
    },
    linux: {
        executableName:'mollystudio',icon:'src/renderer/assets/images/icon/icon512.png',category:'Graphics',maintainer:'nagivka',
        target:[{target:'AppImage',arch:['x64','arm64']},{target:'deb',arch:['x64','arm64']},{target:'tar.gz',arch:['x64','arm64']}],
        artifactName:'MollyStudio-${buildVersion}-${arch}-linux.${ext}',
        mimeTypes:['application/x-mollystudio-project'],desktop:{entry:{StartupWMClass:'MollyStudio'}}
    },
    nsis: {oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'MollyStudio',
        installerLanguages: ['ru_RU', 'en_US'], displayLanguageSelector: true, deleteAppDataOnUninstall: false},
    portable: {artifactName: 'MollyStudio-${buildVersion}-${arch}-portable.${ext}'}
};
