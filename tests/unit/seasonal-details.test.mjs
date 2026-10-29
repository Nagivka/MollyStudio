import test from 'node:test';
import assert from 'node:assert/strict';
import {seasonalDetail} from '../../src/renderer/js/core/SeasonalDetails.mjs';
test('seasonal details respect local date boundaries, year rollover and leap days',()=>{
 for(const [month,day,expected] of [[1,1,'newyear'],[1,14,'newyear'],[1,15,'winter'],[2,29,'winter'],[3,1,'spring'],[5,31,'spring'],[6,1,'summer'],[8,31,'summer'],[9,1,'autumn'],[10,14,'autumn'],[10,15,'halloween'],[10,31,'halloween'],[11,2,'halloween'],[11,3,'autumn'],[12,1,'winter'],[12,14,'winter'],[12,15,'newyear'],[12,31,'newyear']])assert.equal(seasonalDetail(new Date(2028,month-1,day,23,59)),expected);
 assert.equal(seasonalDetail(new Date(NaN)),null);
});
