const fs = require('node:fs');
const path = require('node:path');

function releaseInfo(root, ref = '') {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const config = require(path.join(root, 'electron-builder.cjs'));
    if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw Error('Use a stable three-part package version.');
    if (config.buildVersion !== `${pkg.version}.0`) throw Error('Windows buildVersion must match package version plus .0.');
    const tag = `v${pkg.version}`;
    if (ref.startsWith('refs/tags/') && ref !== `refs/tags/${tag}`) throw Error(`Tag must be ${tag}.`);
    return {tag, version: pkg.version, buildVersion: config.buildVersion,
        filename: `MollyStudio-${config.buildVersion}-x64-portable.exe`,
        notesPath: path.join(root, 'releases', `${pkg.version}.md`)};
}

if (require.main === module) {
    try {
        const info = releaseInfo(path.resolve(__dirname, '../..'), process.env.GITHUB_REF || '');
        if (!fs.readFileSync(info.notesPath, 'utf8').trim()) throw Error('Release notes are empty.');
        console.log(`Release ${info.tag}, Windows ${info.buildVersion}`);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {releaseInfo};
