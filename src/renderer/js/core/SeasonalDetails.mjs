// Local calendar dates; no location, network or telemetry is needed.
export function seasonalDetail(date=new Date()) {
    if(!Number.isFinite(date.getTime()))return null;
    const month=date.getMonth()+1,day=date.getDate();
    if((month===12&&day>=15)||(month===1&&day<=14))return 'newyear';
    if((month===10&&day>=15)||(month===11&&day<=2))return 'halloween';
    if(month===12||month<=2)return 'winter';
    if(month<=5)return 'spring';
    if(month<=8)return 'summer';
    return 'autumn';
}
