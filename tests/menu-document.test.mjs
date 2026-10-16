import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectFromForm, normalizeProjectData, buildEditorUrl } from '../www/js/core/ProjectFactory.mjs';
import { validateProjectDocument } from '../www/js/core/ProjectValidation.mjs';
import { createMenuConfig, validateMenuConfig, importMenuYaml, exportMenuYaml, menuEditorView, menuConfigFromView, resizeMenuView, indexMenuItemsBySlot } from '../www/js/core/MenuDocument.mjs';
import { itemSlots, setItemSlots } from '../www/js/core/DeluxeMenuDocument.mjs';
import { MENU_MATERIALS, findMenuMaterial } from '../www/js/utils/MinecraftCatalog.js';

test('menu material catalog does not export sprite variants as nonexistent Bukkit materials',()=>{
    assert.ok(findMenuMaterial('CROSSBOW')&&findMenuMaterial('FILLED_MAP'));
    for(const id of ['CROSSBOW_ARROW','CROSSBOW_STANDBY','ELYTRA_BROKEN','FISHING_ROD_CAST','BURIED_TREASURE_MAP'])assert.equal(findMenuMaterial(id),undefined);
    assert.equal(new Set(MENU_MATERIALS.map(item=>item.material)).size,MENU_MATERIALS.length);
});

test('zMenu plugin survives creation, editor URLs, normalization and project validation', () => {
    const values={'new-deluxemenu-name':'Shop','new-menu-plugin':'zmenu'};
    const project=createProjectFromForm({getElementById:id=>({value:values[id]||''})},'deluxemenu');
    assert.equal(project.menuPlugin,'zmenu');
    assert.deepEqual(project.deluxeData,createMenuConfig('zmenu'));
    assert.equal(normalizeProjectData(project).menuPlugin,'zmenu');
    assert.equal(new URL(buildEditorUrl(project),'https://local.test').searchParams.get('menuPlugin'),'zmenu');
    assert.doesNotThrow(()=>validateProjectDocument({...project,config:{width:256,height:256},layers:[]}));
    assert.throws(()=>normalizeProjectData({...project,menuPlugin:'unknown'}),/Выберите/);
    assert.throws(()=>validateProjectDocument({...project,menuPlugin:'deluxemenus',config:{width:256,height:256},layers:[]}),/menu_title/);
});

test('zMenu visual edits retain native actions, requirements, patterns and custom item options', () => {
    const config={title:['&6My ','shop'],size:27,patterns:['decoration'],'update-interval':500,
        'fill-item':{material:'BLACK_STAINED_GLASS_PANE',name:' ', 'model-id':4},
        'open-requirement':{requirements:[{type:'permission',permission:'shop.open'}]},
        items:{shop:{slot:13,type:'INVENTORY',inventory:'shop2',item:{material:'DIAMOND',name:'&bBuy',lore:['','&7Description'],'model-id':7},
            actions:[{type:'console-command',commands:['give %player% diamond 1'],delay:20, chance:50}],
            'view-requirement':{requirements:[{type:'permission',permission:'shop.item'}]}}}};
    const view=menuEditorView(config,'zmenu');
    view.items.shop.display_name='&aNew';
    view.update_interval=750;
    const changed=menuConfigFromView(view,'zmenu');
    assert.deepEqual(changed.items.shop.actions,config.items.shop.actions);
    assert.deepEqual(changed.items.shop['view-requirement'],config.items.shop['view-requirement']);
    assert.deepEqual(changed['open-requirement'],config['open-requirement']);
    assert.deepEqual(changed.patterns,['decoration']);
    assert.equal(changed.items.shop.item['model-id'],7);
    assert.equal(changed.items.shop.item.name,'&aNew');
    assert.equal(changed['update-interval'],750);
    assert.equal(changed['fill-item']['model-id'],4);
    assert.deepEqual(changed.title,config.title);
    const exported=exportMenuYaml(changed,'zmenu');
    assert.ok(!exported.includes('_native')&&!exported.includes('menu_title')&&!exported.includes('display_name'));
    assert.deepEqual(importMenuYaml(exported),{plugin:'zmenu',config:changed});
    assert.deepEqual(config.items.shop.item.name,'&bBuy');
});

test('zMenu matrix expands to editable slots and is not reapplied after a move or deletion', () => {
    const config={name:'Matrix',size:9,matrix:['A  A    B'],items:{A:{item:{material:'STONE'}},B:{item:{material:'PAPER'}},pattern:{type:'HOME'}}};
    const view=menuEditorView(validateMenuConfig(config,'zmenu'),'zmenu');
    assert.deepEqual(itemSlots(view.items.A,9),[0,3]);
    assert.deepEqual(itemSlots(view.items.B,9),[8]);
    setItemSlots(view.items.A,[1,2]);delete view.items.B;
    const changed=menuConfigFromView(view,'zmenu');
    assert.equal(changed.matrix,undefined);
    assert.deepEqual(changed.items.A.slots,[1,2]);
    assert.ok(changed.items.pattern&&!changed.items.pattern.item);
    assert.throws(()=>resizeMenuView(view,'zmenu','BEACON',1),/границей/);
});

test('zMenu page preview filters page ranges without losing permanent buttons', () => {
    const view=menuEditorView({name:'Pages',size:9,items:{first:{slot:0,item:{material:'STONE'}},second:{slot:0,page:2,item:{material:'DIAMOND'}},range:{slot:1,page:'2-4',item:{material:'PAPER'}},home:{slot:8,'is-permanent':true,type:'HOME',item:{material:'ARROW'}}}},'zmenu');
    assert.deepEqual(indexMenuItemsBySlot(view,'zmenu',1)[0].map(([id])=>id),['first']);
    assert.deepEqual(indexMenuItemsBySlot(view,'zmenu',2)[0].map(([id])=>id),['second']);
    assert.equal(indexMenuItemsBySlot(view,'zmenu',3)[1][0][0],'range');
    assert.equal(indexMenuItemsBySlot(view,'zmenu',99)[8][0][0],'home');
});

test('zMenu rejects invalid slots, action objects and update units while allowing dynamic amounts', () => {
    const base={name:'Test',size:9,items:{a:{slot:0,item:{material:'PAPER',amount:'%player_level%'}}}};
    assert.doesNotThrow(()=>validateMenuConfig(base,'zmenu'));
    assert.throws(()=>validateMenuConfig({...base,'update-interval':.5},'zmenu'),/миллисекунд/);
    assert.throws(()=>validateMenuConfig({...base,items:{a:{...base.items.a,slot:9}}},'zmenu'),/вне меню/);
    assert.throws(()=>validateMenuConfig({...base,items:{a:{...base.items.a,actions:['[player] spawn']}}},'zmenu'),/списком объектов/);
    assert.throws(()=>validateMenuConfig({...base,items:{a:{...base.items.a,'to-page':0}}},'zmenu'),/страница/);
    assert.throws(()=>validateMenuConfig({...base,matrix:['AAAAAAAAAA']},'zmenu'),/Матрица/);
    assert.throws(()=>validateMenuConfig({...base,type:'PLAYER'},'zmenu'),/не поддерживает/);
    assert.throws(()=>importMenuYaml("name: Test\nitems:\n  __proto__: {}"),/Недопустимый ключ/);
});

test('legacy DeluxeMenus projects retain their exact native YAML configuration', () => {
    const config={menu_title:'DM',size:9,items:{a:{slot:1,material:'STONE',left_click_commands:['[player] spawn']}}};
    const project=normalizeProjectData({type:'deluxemenu',deluxeData:config});
    assert.equal(project.menuPlugin,'deluxemenus');
    assert.deepEqual(menuConfigFromView(menuEditorView(config)),config);
    assert.deepEqual(importMenuYaml(exportMenuYaml(config)),{plugin:'deluxemenus',config});
});
