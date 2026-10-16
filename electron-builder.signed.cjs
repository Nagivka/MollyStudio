'use strict';

// Optional Authenticode build. Electron-builder reads CSC_LINK and CSC_KEY_PASSWORD
// from the environment. Never put a certificate or its password in this file.
const { build } = require('./package.json');
module.exports = { ...build, forceCodeSigning: true, win: { ...build.win, verifyUpdateCodeSignature: true } };
