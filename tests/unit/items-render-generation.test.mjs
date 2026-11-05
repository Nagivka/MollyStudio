import test from 'node:test';
import assert from 'node:assert/strict';
import ItemsPanel from '../../src/renderer/js/ui/ItemsPanel.js';
class Element {
 constructor(fragment=false){this.fragment=fragment;this.children=[];this.style={};this.dataset={};}
 setAttribute(){}addEventListener(){}
 appendChild(child){if(child.fragment)this.children.push(...child.children);else this.children.push(child);return child;}
 get firstElementChild(){return this.children[0];}get lastElementChild(){return this.children.at(-1);}
 set innerHTML(value){this.children=[];}replaceChildren(){this.children=[];}
}
test('resource results ignore queued lazy loading from an older search, including empty results',()=>{
 const previous={document:globalThis.document,IntersectionObserver:globalThis.IntersectionObserver},observers=[];
 try{
  globalThis.document={createElement:()=>new Element(),createDocumentFragment:()=>new Element(true)};
  globalThis.IntersectionObserver=class{constructor(callback){this.callback=callback;observers.push(this);}disconnect(){}observe(){}};
  let records=Array.from({length:120},(_,index)=>({id:'old-'+index,name:'Old',file:'old.png'}));
  const panel={gridElement:new Element(),favorites:new Set(),getFilteredItems:()=>records};
  ItemsPanel.prototype.renderItems.call(panel);const old=observers[0];
  records=Array.from({length:10},(_,index)=>({id:'new-'+index,name:'New',file:'new.png'}));
  ItemsPanel.prototype.renderItems.call(panel);old.callback([{isIntersecting:true}]);
  assert.equal(panel.gridElement.children.length,10);
  records=[];ItemsPanel.prototype.renderItems.call(panel);old.callback([{isIntersecting:true}]);assert.equal(panel.gridElement.children.length,0);
 }finally{for(const [key,value] of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});
