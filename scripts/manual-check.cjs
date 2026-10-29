// Interactive Windows check with real dialogs, private settings and recovery.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {PNG} = require('pngjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-output');
fs.mkdirSync(output, {recursive: true});
const sessionPath = path.join(output, 'manual-native-session.json');
const resume = process.argv.includes('--resume');
const session = resume ? JSON.parse(fs.readFileSync(sessionPath, 'utf8')) : {};
if (!resume) {
    session.profile = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-electron-check-manual-'));
    const image = new PNG({width: 32, height: 32});
    for (let y = 6; y < 18; y++) for (let x = 6; x < 22; x++) image.data.set(x < 14 ? [240,80,30,255] : [20,120,235,255], (y * 32 + x) * 4);
    const dataUrl = 'data:image/png;base64,' + PNG.sync.write(image).toString('base64');
    session.files = ['Первый проект.mlst', 'Второй проект.MLST'].map((name, index) => {
        const file = path.join(session.profile, name);
        fs.writeFileSync(file, JSON.stringify({mollyVersion: 2, name: index ? 'Второй проект' : 'Windows Audit', type: 'canvas', config: {width:32,height:32},
            layers: [{id:'pixels-'+index,name:'Тестовые пиксели',width:32,height:32,type:'bitmap',visible:true,opacity:1,blendMode:'source-over',dataUrl}]}));
        return file;
    });
}
const profile = fs.realpathSync(session.profile), temp = fs.realpathSync(os.tmpdir());
if (path.dirname(profile) !== temp || !path.basename(profile).startsWith('molly-electron-check-')) throw Error('Invalid private test profile');
session.exe = require('electron');
const log = fs.openSync(path.join(profile, 'native.log'), 'a');
const child = spawn(session.exe, [root, ...(resume ? [] : [session.files[0]])], {
    env: {...process.env, ELECTRON_RUN_AS_NODE: undefined, NODE_OPTIONS: undefined, MOLLY_TEST_PROFILE: profile, MOLLY_MANUAL_CHECK: '1'}, detached: true, stdio: ['ignore', log, log]
});
child.once('error', error => {console.error(error);process.exitCode = 1;});
child.unref();fs.closeSync(log);session.pid = child.pid;
fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
console.log(`Тестовое окно запускается. Профиль: ${profile}\nСистемные диалоги настоящие; ассоциации .mlst и Discord отключены.\nДля проверки восстановления закройте окно и выполните npm run test:manual -- --resume.`);
