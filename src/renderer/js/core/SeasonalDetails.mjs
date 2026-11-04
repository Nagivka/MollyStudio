// Local calendar dates; no location, network or telemetry is needed.
export function seasonalDetail(date=new Date()) {
    if(!Number.isFinite(date.getTime()))return null;
    const month=date.getMonth()+1,day=date.getDate();
    if((month===12&&day===31)||(month===1&&day===1))return 'newyear';
    if(month===10&&day===31)return 'halloween';
    if(month===8&&day===25)return 'studioBirthday';
    if((month===1&&day===7)||(month===12&&day===25))return 'christmas';
    if(month===12&&day===30)return 'authorBirthday';
    return null;
}
