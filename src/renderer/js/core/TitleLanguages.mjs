import {TITLE_FONT_CATALOG} from './TitleFontCatalog.mjs';

export const TITLE_TEXT_LANGUAGES=Object.freeze({
 en:{name:'English',alphabet:'abcdefghijklmnopqrstuvwxyz',font:'minecraft-ten'},
 ru:{name:'Русский',alphabet:'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',font:'minecraft-ten-cyrillic'},
 uk:{name:'Українська',alphabet:'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя',font:'minecraft-ten-cyrillic'}
});
export const titleLanguageModes=Object.freeze(['auto',...Object.keys(TITLE_TEXT_LANGUAGES)]);
export function titleFontLanguages(font){
 if(font==='minecraft-ten-cyrillic')return ['ru','uk'];
 if(font==='minecraft-five-bold-cyrillic')return ['ru'];
 return TITLE_FONT_CATALOG[font]?['en']:[];
}
export function titleLanguageForLine(text,mode='auto',font='minecraft-ten'){
 if(TITLE_TEXT_LANGUAGES[mode])return mode;
 if(/[іїєґ]/i.test(text))return 'uk';
 if(/\p{Script=Cyrillic}/u.test(text))return 'ru';
 if(/\p{Script=Latin}/u.test(text))return 'en';
 return titleFontLanguages(font)[0]||'en';
}
export function titleFontForLanguage(font,language){
 if(titleFontLanguages(font).includes(language))return font;
 const base=TITLE_FONT_CATALOG[font]?.baseFont||font;
 const paired=language==='en'?base:base==='minecraft-five-bold'?'minecraft-five-bold-cyrillic':base==='minecraft-ten'||font==='minecraft-ten-v2'?'minecraft-ten-cyrillic':null;
 return titleFontLanguages(paired).includes(language)?paired:null;
}
export const titleFontsForLanguage=language=>Object.keys(TITLE_FONT_CATALOG).filter(font=>titleFontLanguages(font).includes(language));
export function titleLanguageIssues(text,modes=[]){
 const issues=[];
 text.normalize('NFC').replace(/\r/g,'').split('\n').slice(0,3).forEach((line,index)=>{
  const language=titleLanguageForLine(line,modes[index]),alphabet=TITLE_TEXT_LANGUAGES[language].alphabet;
  const foreign=[...new Set([...line].filter(char=>/\p{L}/u.test(char)&&!alphabet.includes(char.toLowerCase())).map(char=>char.toLowerCase()))];
  if(foreign.length)issues.push({index,language,foreign});
 });
 return issues;
}
