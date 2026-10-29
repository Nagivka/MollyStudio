const preset=(id,name,category,dark,surface,light)=>Object.freeze({id,name,category,dark,surface,light,pattern:'none'});
const group=(category,rows)=>rows.map(row=>preset(...row.slice(0,2),category,...row.slice(2)));

/** Existing IDs stay stable; every palette uses clean surfaces with no procedural texture. */
export const GUI_DESIGNS=Object.freeze([
    ...group('Классические',[
        ['vanilla','Классический','#373737','#C6C6C6','#FFFFFF'],
        ['slate','Тёмный сланец','#13181E','#46515F','#97A8BA'],
        ['stone','Камень','#282B2B','#8E9492','#D4D8D5'],
        ['oak','Дуб','#3D2B19','#AA824D','#E5BF7E'],
        ['spruce','Ель','#241F17','#6E5638','#BB9360'],
        ['nether','Незер','#210F17','#713A42','#B96D64'],
        ['ice','Лёд','#27445F','#A3D0E4','#E8FAFF'],
        ['parchment','Пергамент','#5B4330','#D1BA8A','#F2E5BD'],
        ['obsidian','Обсидиан','#0F0C16','#403447','#8F74A2'],
        ['ender','Эндер','#102224','#466A63','#A6C998'],
        ['ocean','Океан','#142C49','#3F7394','#97C7DC'],
        ['copper','Медь','#3A2622','#B37A5D','#E8B18B']
    ]),
    ...group('Нейтральные',[
        ['graphite','Графит','#10141A','#36414D','#9DAEBE'],
        ['coal','Уголь','#080A0D','#242930','#737E8C'],
        ['ash','Пепел','#343238','#817D85','#CFCBD2'],
        ['silver','Серебро','#414B57','#B1BDC9','#EDF4FC'],
        ['steel','Сталь','#1C2C3B','#526D83','#B1C5D7'],
        ['titanium','Титан','#222B32','#727E87','#D8DFE3'],
        ['porcelain','Фарфор','#5B6570','#E0E6EA','#FFFFFF'],
        ['ivory','Слоновая кость','#645846','#DAD0B8','#FFF8E6']
    ]),
    ...group('Холодные',[
        ['sapphire','Сапфир','#0C1937','#284C88','#8EBBFF'],
        ['cobalt','Кобальт','#121C40','#3859AD','#A2BBFF'],
        ['arctic','Арктика','#30465B','#91B6D0','#EAF9FF'],
        ['frost','Иней','#3E5966','#B2CFD8','#F1FEFF'],
        ['lagoon','Лагуна','#103943','#24798A','#91E3E5'],
        ['turquoise','Бирюза','#173F40','#4B9E9B','#A8F2E7'],
        ['aquamarine','Аквамарин','#23514F','#7BC3B5','#DBFFF0'],
        ['abyss','Глубина','#071623','#183D55','#67ACC5']
    ]),
    ...group('Тёплые',[
        ['amber','Янтарь','#522D10','#BC7D24','#FFDA7B'],
        ['bronze','Бронза','#40291F','#956345','#D8AE79'],
        ['brass','Латунь','#494022','#A28F46','#E8D687'],
        ['terracotta','Терракота','#552A26','#B26C55','#EFC3A6'],
        ['coral','Коралл','#542C38','#C5747B','#FFD6CB'],
        ['sandstone','Песчаник','#665135','#CCB17A','#F6E8B8'],
        ['caramel','Карамель','#50321E','#B78550','#F5D3A5'],
        ['chocolate','Шоколад','#251916','#674538','#B6927A']
    ]),
    ...group('Природные',[
        ['moss','Мох','#293821','#6B8050','#C0D69B'],
        ['pine','Хвоя','#102E29','#39675A','#8FC2A5'],
        ['sage','Шалфей','#3B4E43','#8BA58F','#DBEBD3'],
        ['olive','Олива','#383B20','#82834B','#D0CF8E'],
        ['bamboo','Бамбук','#354721','#8EAB52','#DCEC9A'],
        ['jade','Нефрит','#123E32','#438B68','#A5DDB1'],
        ['mint','Мята','#365A50','#9ACDB8','#DFFFF0'],
        ['fern','Папоротник','#193A26','#4B8052','#ACCD8C']
    ]),
    ...group('Фэнтези',[
        ['moonstone','Лунный камень','#35354E','#8F91BA','#ECE5FF'],
        ['runes','Руны','#242B38','#4D5D73','#91D9E3'],
        ['enchanter','Чародей','#2A1746','#725499','#D9B4F2'],
        ['dragon','Дракон','#351E29','#70464F','#E09A68'],
        ['phoenix','Феникс','#4B1D25','#B24F3B','#FFD28B'],
        ['celestial','Небесный','#293F66','#789BC8','#F0E8C5'],
        ['spectral','Призрачный','#263E46','#638A8F','#BDF8E9'],
        ['royal','Королевский','#34244D','#786091','#E5C987']
    ]),
    ...group('Тёмные с акцентом',[
        ['coal-gold','Уголь–золото','#0D1014','#2C3036','#E7BF64'],
        ['graphite-lime','Графит–лайм','#101710','#303A32','#B6D96B'],
        ['black-ruby','Чёрный–рубин','#150E15','#342330','#ED718C'],
        ['night-cyan','Ночь–циан','#081B25','#223C4B','#76DFED'],
        ['ink-purple','Чернильный–фиолетовый','#171326','#353047','#BA96F2'],
        ['titanium-orange','Титан–оранжевый','#1B2026','#39424D','#F6A65E'],
        ['ash-pink','Пепел–розовый','#221B24','#50404E','#EDACC9'],
        ['steel-blue','Сталь–синий','#111F30','#354B63','#8AB9FF']
    ]),
    ...group('Светлые',[
        ['cream','Кремовый','#736451','#E8D6B8','#FFF5E3'],
        ['pearl','Жемчужный','#696878','#DEDFEB','#FFFFFF'],
        ['lavender','Лавандовый','#5E536F','#CBBBD9','#F3E8FF'],
        ['pistachio','Фисташковый','#65704A','#CCDBAE','#F3FFE0'],
        ['peach','Персиковый','#805A48','#E8BFA8','#FFEBDD'],
        ['sky-blue','Небесно-голубой','#536C81','#B9D5EA','#F0FBFF'],
        ['powder','Пудровый','#785E6D','#DFC2CF','#FFF0F7'],
        ['vanilla-cream','Ванильный','#786D4C','#E5DCA9','#FFF9D9']
    ]),
    ...group('Контрастные',[
        ['monochrome','Чёрно-белый','#111419','#60666F','#F5F7FA'],
        ['blue-gold','Сине-золотой','#12233C','#34537F','#EDCE7A'],
        ['burgundy-cream','Бордово-кремовый','#3D1927','#86445B','#F2DFC1'],
        ['green-copper','Зелёно-медный','#12352C','#3F725B','#D8A077'],
        ['purple-silver','Фиолетово-серебряный','#2C2147','#6A568E','#D7E0EC'],
        ['orange-graphite','Оранжево-графитовый','#23262B','#AF663C','#F8BB83'],
        ['turquoise-sand','Бирюзово-песочный','#173B40','#518C8D','#E8D2A2'],
        ['red-steel','Красно-стальной','#351E26','#974D5D','#BCCCD7']
    ])
]);
const rgb=hex=>[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16));
export function recolorGuiPixels(image,id){
    const theme=GUI_DESIGNS.find(item=>item.id===id);if(!theme)throw Error('Неизвестное оформление GUI.');
    if(id==='vanilla')return image;
    const dark=rgb(theme.dark),surface=rgb(theme.surface),light=rgb(theme.light),{data}=image;
    for(let index=0;index<data.length;index+=4){
        if(!data[index+3])continue;
        // Colored artwork in special Java containers is preserved.
        if(Math.max(data[index],data[index+1],data[index+2])-Math.min(data[index],data[index+1],data[index+2])>18)continue;
        const value=(data[index]+data[index+1]+data[index+2])/3,bright=value>=198;
        const low=bright?surface:dark,high=bright?light:surface,t=bright?(value-198)/57:Math.max(0,(value-36)/162);
        for(let channel=0;channel<3;channel++)data[index+channel]=Math.max(0,Math.min(255,Math.round(low[channel]+(high[channel]-low[channel])*Math.min(1,t))));
    }
    return image;
}
