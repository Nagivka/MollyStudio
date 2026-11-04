import test from 'node:test';
import assert from 'node:assert/strict';
import {seasonalDetail} from '../../src/renderer/js/core/SeasonalDetails.mjs';

test('only the seven approved local calendar dates have decorations',()=>{
 const holidays=new Map([['1-1','newyear'],['1-7','christmas'],['8-25','studioBirthday'],['10-31','halloween'],['12-25','christmas'],['12-30','authorBirthday'],['12-31','newyear']]);
 for(const year of [2026,2028])for(let month=0;month<12;month++)for(let day=1;day<=new Date(year,month+1,0).getDate();day++){
  for(const hour of [0,23])assert.equal(seasonalDetail(new Date(year,month,day,hour,59)),holidays.get(`${month+1}-${day}`)||null);
 }
 assert.equal(seasonalDetail(new Date(NaN)),null);
});
