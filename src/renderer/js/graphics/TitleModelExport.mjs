/** Self-contained Blockbench scene with welded, editable body and contour meshes. */
export function createTitleBlockbenchModel(scene,images,name='Title'){
    const batches=scene.modelBatches||scene.batches;
    // Blockbench's Minecraft Title camera faces -Z; our editor camera faces +Z.
    const pointToBlockbench=point=>point.map((n,i)=>Number((n*4*(i===1?1:-1)).toFixed(6)));
    const uuid=()=>globalThis.crypto.randomUUID(),elements=[],textures=[],textureIds=new Map(),ids=new Map();
    for(const node of scene.nodes)ids.set(node.id,uuid());
    for(const batch of batches)if(!textureIds.has(batch.texture)){
        const image=images[batch.texture];if(!image?.source?.startsWith('data:image/png;base64,'))throw Error('Отсутствует встроенная текстура модели: '+batch.texture);
        const index=textures.length;textureIds.set(batch.texture,index);
        textures.push({uuid:uuid(),id:String(index),name:batch.texture+'.png',internal:true,saved:false,render_sides:'front',source:image.source,width:image.width,height:image.height,uv_width:16,uv_height:16,visible:true});
    }
    const meshes=new Map(),nodes=new Map(scene.nodes.map(node=>[node.id,node]));
    for(const batch of batches)for(const triangle of batch.triangles){
        if(!meshes.has(triangle.objectId)){
            const node=nodes.get(triangle.objectId);
            meshes.set(triangle.objectId,{origin:pointToBlockbench(node.worldPivot||node.pivot),vertices:{},faces:{},count:0,positions:new Map()});
        }
        const mesh=meshes.get(triangle.objectId),keys=triangle.points.map((point,index)=>{
            // Mesh vertices are relative to their own origin in BBModel. Bake
            // the transforms while retaining a usable pivot for further edits.
            const position=pointToBlockbench(point).map((n,i)=>Number((n-mesh.origin[i]).toFixed(6))),location=position.join(',');
            if(mesh.positions.has(location))return mesh.positions.get(location);
            const key='v'+mesh.count++;mesh.vertices[key]=position;mesh.positions.set(location,key);return key;
        });
        mesh.faces['f'+Object.keys(mesh.faces).length]={vertices:keys,uv:Object.fromEntries(keys.map((key,index)=>[key,triangle.uv[index].map(n=>n*16)])),texture:textureIds.get(batch.texture)};
    }
    for(const node of scene.nodes)if(node.type==='cube'&&meshes.has(node.id)){
        const mesh=meshes.get(node.id);elements.push({uuid:ids.get(node.id),name:node.part==='source'?'Cube '+node.label:node.part==='outline'?'Outline':'Body',type:'mesh',origin:mesh.origin,rotation:[0,0,0],vertices:mesh.vertices,faces:mesh.faces,visibility:node.visible});
    }
    const existing=new Set(elements.map(element=>element.uuid));
    const group=parent=>scene.nodes.filter(node=>node.parent===parent).flatMap(node=>{
        if(node.type==='cube')return existing.has(ids.get(node.id))?[ids.get(node.id)]:[];
        return [{uuid:ids.get(node.id),name:node.label,origin:pointToBlockbench(node.worldPivot||node.pivot),rotation:[0,0,0],visibility:node.visible,children:group(node.id)}];
    });
    return {meta:{format_version:'4.10',model_format:'free',box_uv:false},name,resolution:{width:16,height:16},elements,outliner:group(null),textures,credit:'Minecraft Title Generator assets: Ewan Howell and contributors. Scene edited in MollyStudio.'};
}
