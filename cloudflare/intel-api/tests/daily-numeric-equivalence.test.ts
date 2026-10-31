import test from 'node:test';
import assert from 'node:assert/strict';
import {numericTokens as tokens} from '../src/daily-policy.ts';
test('currency and Chinese scale equivalence uses exact decimals',()=>{
 for(const [a,b] of [['$465M','4.65亿美元'],['$1.8M','180万美元'],['1.44 million','144万'],['0 million','0亿'],['$0.5B','5亿美元'],['USD 164M','1.64亿美元']])assert.deepEqual(tokens(a),tokens(b),a);
});
test('scale normalization preserves real mismatches and measurement units',()=>{
 assert.notDeepEqual(tokens('$465M'),tokens('4.66亿美元'));
 assert.notDeepEqual(tokens('48%'),tokens('49%'));
 assert.notDeepEqual(tokens('1.0 ms'),tokens('1.00 ms'));
 assert.deepEqual(tokens('700 ms 2.56 m ROS 2 INT8'),['2','2.56','700','8']);
});
