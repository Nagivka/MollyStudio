import {TITLE_FONT_CATALOG} from './TitleFontCatalog.mjs';
import {TITLE_FONT_MODELS} from '../utils/TitleFontModels.js';
import {titleRowSettings} from './TitleDocument.mjs';

/** Expose controls only where a native model or layout actually uses them. */
export function titleControlAvailability(data,rowIndex=-1){
 const row=titleRowSettings(data,rowIndex),font=TITLE_FONT_CATALOG[row.font],model=TITLE_FONT_MODELS[row.font];
 const rows=data.text.split('\n').map((_,index)=>titleRowSettings(data,index));
 return {
  kerning:Object.keys(font.shifts||{}).length>0,
  terminators:!font.forcedTerminators&&!!model.characters['┫']&&!!model.characters['┣'],
  creeperA:rows.some(row=>!!TITLE_FONT_MODELS[row.font].characters['😳']),
  subtitleTexture:rowIndex<0&&rows.length>1&&new Set(rows.map(row=>row.language)).size===1
 };
}
