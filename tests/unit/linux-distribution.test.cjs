const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const config=require('../../electron-builder.cjs'),yaml=require('js-yaml');
test('Linux packages cover both architectures and Flatpak preserves the Chromium sandbox',()=>{
 for(const target of ['deb','rpm','AppImage','tar.gz'])assert.deepEqual(config.linux.target.find(item=>item.target===target).arch,['x64','arm64']);
 assert.equal(config.flatpak.runtimeVersion,config.flatpak.baseVersion);
 assert.equal(config.flatpak.base,'org.electronjs.Electron2.BaseApp');
 assert.ok(config.flatpak.finishArgs.includes('--device=dri'));
 assert.ok(config.flatpak.finishArgs.includes('--socket=wayland'));
 assert.ok(config.flatpak.finishArgs.includes('--socket=fallback-x11'));
 assert.ok(!JSON.stringify(config).includes('--no-sandbox'));
});
test('Linux distro CI exercises several package families without running the app as root',()=>{
 const workflow=yaml.load(fs.readFileSync(path.join(__dirname,'../../.github/workflows/linux-distributions.yml'),'utf8'));
 const images=workflow.jobs.desktop.strategy.matrix.image;
 for(const prefix of ['ubuntu:','debian:','fedora:','archlinux:','opensuse/'])assert.ok(images.some(image=>image.startsWith(prefix)));
 assert.ok(workflow.jobs.desktop.needs==='build');
 const shell=fs.readFileSync(path.join(__dirname,'../../scripts/linux-distro-check.sh'),'utf8');
 assert.ok(shell.includes('runuser -u mollyqa -- xvfb-run'));
 assert.ok(shell.includes('chmod 4755'));
 assert.ok(!shell.includes('--no-sandbox'));
});
