import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('frozen Worker prompts exactly match authoritative robotics V1 sources',()=>{
 assert.equal(readFileSync('src/prompts/analysis.v1.txt','utf8'),readFileSync('../../industry/robotics/prompts/analysis.v1.md','utf8'));
 assert.equal(readFileSync('src/prompts/scoring.v1.txt','utf8'),readFileSync('../../industry/robotics/scoring.v1.md','utf8'));
});
