// Prepare an isolated, offline run of the actual portable executable.
// This command only writes fixtures. Open the returned .wsb to start Windows Sandbox.
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '..');

(async () => {
    const config = require('../electron-builder.cjs');
    const pkg = require('../package.json');
    const name = config.portable.artifactName.replace('${buildVersion}', config.buildVersion)
        .replace('${version}', pkg.version).replace('${arch}', 'x64').replace('${ext}', 'exe');
    const executable = path.join(root, 'dist', name);
    const sha256 = createHash('sha256').update(await fs.readFile(executable)).digest('hex');
    const directory = path.join(root, '.test-output', 'windows-sandbox', `${config.buildVersion}-${Date.now()}`);
    const harness = path.join(directory, 'harness'), output = path.join(directory, 'output');
    await fs.mkdir(harness, {recursive: true});
    await fs.mkdir(output, {recursive: true});
    await fs.copyFile(path.join(__dirname, 'windows-sandbox-smoke.ps1'), path.join(harness, 'smoke.ps1'));
    await fs.writeFile(path.join(harness, 'launch.json'), JSON.stringify({name, sha256,
        args: process.argv.includes('--software') ? ['--disable-gpu'] : []}));
    const xml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    const mapped = (host, guest, readOnly) => `<MappedFolder><HostFolder>${xml(host)}</HostFolder><SandboxFolder>${guest}</SandboxFolder><ReadOnly>${readOnly}</ReadOnly></MappedFolder>`;
    const configuration = path.join(directory, 'MollyStudio-offline.wsb');
    await fs.writeFile(configuration, `<Configuration>
  <vGPU>Disable</vGPU><Networking>Disable</Networking>
  <AudioInput>Disable</AudioInput><VideoInput>Disable</VideoInput>
  <PrinterRedirection>Disable</PrinterRedirection><ClipboardRedirection>Disable</ClipboardRedirection>
  <MemoryInMB>4096</MemoryInMB>
  <MappedFolders>
    ${mapped(path.join(root, 'dist'), 'C:\\MollyStudio', true)}
    ${mapped(harness, 'C:\\MollySmoke', true)}
    ${mapped(output, 'C:\\MollyResults', false)}
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\\MollySmoke\\smoke.ps1</Command></LogonCommand>
</Configuration>
`);
    const report = {preparedAt: new Date().toISOString(), version: pkg.version, buildVersion: config.buildVersion,
        executable, sha256, directory, configuration, output, cleanWindowsVerified: false};
    await fs.writeFile(path.join(root, '.test-output/windows-sandbox/latest.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
