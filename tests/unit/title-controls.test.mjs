import test from 'node:test';
import assert from 'node:assert/strict';
import {titleControlAvailability} from '../../src/renderer/js/core/TitleControls.mjs';
import {normalizeTitleDocument,TITLE_FONTS} from '../../src/renderer/js/core/TitleDocument.mjs';
import {TITLE_FONT_MODELS} from '../../src/renderer/js/utils/TitleFontModels.js';
import {TITLE_FONT_CATALOG} from '../../src/renderer/js/core/TitleFontCatalog.mjs';

test('font controls follow native capabilities without changing the document',()=>{
 for(const font of TITLE_FONTS){
  const data=normalizeTitleDocument({font,text:font.endsWith('cyrillic')?'ПРИВЕТ':'HELLO'}),before=JSON.stringify(data),controls=titleControlAvailability(data),models=TITLE_FONT_MODELS[font];
  assert.equal(controls.creeperA,!!models.characters['😳']);assert.equal(controls.kerning,Object.keys(TITLE_FONT_CATALOG[font].shifts||{}).length>0);
  assert.equal(controls.terminators,!TITLE_FONT_CATALOG[font].forcedTerminators&&!!models.characters['┫']&&!!models.characters['┣']);assert.equal(controls.subtitleTexture,false);assert.equal(JSON.stringify(data),before);
 }
});
test('shared subtitle material is available only for a compatible multirow scope',()=>{
 const data=normalizeTitleDocument({text:'HELLO\nWORLD'});assert.equal(titleControlAvailability(data).subtitleTexture,true);assert.equal(titleControlAvailability(data,1).subtitleTexture,false);
 assert.equal(titleControlAvailability(normalizeTitleDocument({text:'HELLO\nПРИВЕТ'})).subtitleTexture,false);
});
