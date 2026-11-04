const fs=require('node:fs');
const path=require('node:path');
function createCaseChecker(root){
    const cache=new Map();
    return target=>{
        const relative=path.relative(root,target);
        if(path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))return null;
        let current=root;
        for(const part of relative.split(path.sep).filter(Boolean)){
            let entries=cache.get(current);
            if(!entries){try{entries=fs.readdirSync(current);cache.set(current,entries);}catch{return null;}}
            if(!entries.includes(part)){
                const actual=entries.find(entry=>entry.toLowerCase()===part.toLowerCase());
                return actual?{requested:part,actual,path:relative}:null;
            }
            current=path.join(current,part);
        }
        return null;
    };
}
module.exports={createCaseChecker};
