import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTitleDocument,titleRowSettings} from '../../src/renderer/js/core/TitleDocument.mjs';
import {TITLE_TEXT_LANGUAGES,titleLanguageIssues,titleFontLanguages,titleFontsForLanguage,titleFontForLanguage} from '../../src/renderer/js/core/TitleLanguages.mjs';
import {TITLE_FONT_MODELS} from '../../src/renderer/js/utils/TitleFontModels.js';
import {TITLE_MATERIAL_CATALOG} from '../../src/renderer/js/core/TitleMaterialCatalog.mjs';
import {resolveTitleGlyph,buildTitleMesh} from '../../src/renderer/js/graphics/TitleMesh.mjs';

test('language choices require a complete alphabet in the original source models',()=>{
 assert.equal(titleFontsForLanguage('en').length,11);
 assert.deepEqual(titleFontsForLanguage('ru'),['minecraft-ten-cyrillic','minecraft-five-bold-cyrillic']);
 assert.deepEqual(titleFontsForLanguage('uk'),[]);
 for(const [language,{alphabet}] of Object.entries(TITLE_TEXT_LANGUAGES))for(const font of titleFontsForLanguage(language))for(const char of alphabet){
  assert.ok(TITLE_FONT_MODELS[font].characters[char],font+'/'+char);
  for(const input of [char,char.toUpperCase()]){
   const glyph=resolveTitleGlyph(font,input,false);
   assert.equal(glyph.font,font);assert.equal(glyph.missing,false);
   assert.equal(glyph.elements,TITLE_FONT_MODELS[font].characters[char]);
   assert.equal(glyph.profile,TITLE_FONT_MODELS[font].profiles[char]);
  }
 }
});

test('each row independently uses its native language, font and atlas',()=>{
 const data=normalizeTitleDocument({font:'minecraft-ten-v2',text:'ПРИВЕТ\nHELLO\nПРИВЕТ',texture:'gold',rowLanguages:['ru','en','uk']});
 const rows=[0,1,2].map(index=>titleRowSettings(data,index));
 assert.deepEqual(rows.map(row=>row.language),['ru','en','ru']);
 assert.deepEqual(rows.map(row=>row.font),['minecraft-ten-cyrillic','minecraft-ten','minecraft-ten-cyrillic']);
 assert.deepEqual(normalizeTitleDocument(data),data);
 for(const row of rows)assert.ok(TITLE_MATERIAL_CATALOG.fonts[row.font].textures.some(item=>item.id===row.texture));
 const scene=buildTitleMesh(data);assert.deepEqual(scene.missing,[]);
 for(const glyph of scene.nodes.filter(node=>node.type==='glyph'))assert.equal(glyph.font,rows[glyph.row].font);
});

test('unsupported families resolve to explicit native variants without fabricated Cyrillic',()=>{
 assert.equal(titleFontForLanguage('minecraft-ten-v2','ru'),'minecraft-ten-cyrillic');
 assert.equal(titleFontForLanguage('minecraft-five-bold','ru'),'minecraft-five-bold-cyrillic');
 assert.equal(titleFontForLanguage('minecraft-five-bold-cyrillic','en'),'minecraft-five-bold');
 assert.equal(titleFontForLanguage('block-serif','ru'),null);
 assert.deepEqual(titleFontLanguages('block-serif'),['en']);
 assert.equal(normalizeTitleDocument({text:'ПРИВЕТ',font:'block-serif'}).font,'minecraft-ten-cyrillic');
 assert.equal(normalizeTitleDocument({text:'ЄНОТ',font:'minecraft-five-bold-cyrillic'}).font,'minecraft-five-bold-cyrillic');
});

test('one alphabet per row allows neutral numbers and punctuation and preserves invalid legacy text',()=>{
 assert.deepEqual(titleLanguageIssues('Привет 123!?\nHELLO +42\nЁжик №7'),[]);
 assert.deepEqual(titleLanguageIssues('ТЕСТ TEST')[0].foreign,['t','e','s']);
 assert.equal(titleLanguageIssues('HELLO',['ru'])[0].language,'ru');
 assert.equal(titleLanguageIssues('ПРИВЕТ',['en'])[0].language,'en');
 assert.equal(titleLanguageIssues('ЄНОТ',['ru'])[0].foreign[0],'є');
 assert.deepEqual(titleLanguageIssues('ЄНОТ',['uk']),[{index:0,language:'ru',foreign:['є']}]);
 assert.equal(titleLanguageIssues('İSTANBUL',['en'])[0].foreign[0],'i\u0307');
 const legacy=normalizeTitleDocument({text:'MOLLY СТУДИЯ'});
 assert.equal(legacy.text,'MOLLY СТУДИЯ');assert.equal(titleLanguageIssues(legacy.text).length,1);
});

test('unavailable English materials and overlays do not get ported onto Russian letters',()=>{
 const englishOnly=TITLE_MATERIAL_CATALOG.fonts['minecraft-ten'].textures.find(item=>!TITLE_MATERIAL_CATALOG.fonts['minecraft-ten-cyrillic'].textures.some(other=>other.id===item.id));
 assert.ok(englishOnly);
 const overlay=TITLE_MATERIAL_CATALOG.fonts['minecraft-ten'].overlays.find(item=>!TITLE_MATERIAL_CATALOG.fonts['minecraft-ten-cyrillic'].overlays.some(other=>other.id===item.id));
 assert.ok(overlay);
 const data=normalizeTitleDocument({font:'minecraft-ten',text:'РУССКИЙ',texture:englishOnly.id,appearance:{overlay:overlay.id}});
 assert.equal(data.font,'minecraft-ten-cyrillic');assert.equal(data.texture,'none');assert.equal(data.appearance.overlay,'none');
 for(const batch of buildTitleMesh(data).batches)assert.ok(batch.texture==='contour-swatches.png'||batch.texture.startsWith('minecraft-ten-cyrillic'),batch.texture);
});

test('NFC accents and all 33 Russian letters retain source geometry at every row role',()=>{
 assert.equal(normalizeTitleDocument({text:'Е\u0308 И\u0306 І\u0308'}).text,'Ё Й Ї');
 for(const font of titleFontsForLanguage('ru'))for(const role of ['top','bottom','small']){
  const data=normalizeTitleDocument({font,text:TITLE_TEXT_LANGUAGES.ru.alphabet,creeperA:false,rows:[{font,role}]}),scene=buildTitleMesh(data);
  assert.deepEqual(scene.missing,[]);assert.equal(scene.nodes.filter(node=>node.type==='glyph').length,33);
  for(const batch of scene.batches)assert.ok(batch.vertices.every(Number.isFinite));
 }
});
