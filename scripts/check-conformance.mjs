import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import ts from 'typescript';
import {normalizeSimulationConfig} from '../index.js';
import {initializeSimulation} from '../runtime/index.js';
import {validateSimulationConfig,validateDriverManifest} from '../validation/index.js';
const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url))),clone=v=>JSON.parse(JSON.stringify(v)),custom=read('fixtures/custom.valid.json'),physics=read('fixtures/physics.valid.json'),manifest=read('fixtures/manifest.valid.json');
for(const file of readdirSync(new URL('../fixtures/',import.meta.url))){const r=file==='manifest.valid.json'?validateDriverManifest(read('fixtures/'+file)):validateSimulationConfig(read('fixtures/'+file));assert.equal(r.valid,file.includes('.valid.'),file+JSON.stringify(r));}
const normalized=normalizeSimulationConfig(custom,validateSimulationConfig);assert.equal(normalized.parameterValues.rate,2);assert(Object.isFrozen(normalized.model));assert(!('renderer' in normalized));
let creates=0,releases=0;
const driver={manifest,async initialize(config){creates++;const defaults=()=>Object.fromEntries(config.state.map(f=>[f.id,f.default]));return{initialState:defaults(),step({state,parameters,inputs,dt}){if(config.model.dimension===0)return{count:state.count+(inputs.enabled?parameters.rate*dt:0)};return{x:state.x+state.vx*dt,y:state.y+state.vy*dt-parameters.gravity*dt*dt/2,vx:state.vx,vy:state.vy-parameters.gravity*dt};},reset(){return defaults()},dispose(){releases++;}};}};
const initialize=(config=custom,options={})=>initializeSimulation({config,driver,validateConfig:validateSimulationConfig,validateManifest:validateDriverManifest,...options});
{
 const a=await initialize(),b=await initialize();await a.step(.5);await b.step(.5);assert.deepEqual(a.getState(),b.getState());assert.equal(a.getState().state.count,1);assert.equal(a.getState().tick,1);a.input({enabled:false});assert.equal((await a.step(1)).state.count,1);assert.throws(()=>a.input({enabled:'yes'}),e=>e.stage==='input');assert.throws(()=>a.input({enabled:true,unknown:1}));await assert.rejects(a.step(0),e=>e.code==='simulation.dt');assert.equal((await a.reset()).tick,0);assert.equal(a.getState().state.count,0);assert.equal(a.getState().inputs.enabled,true);const p=a.dispose();assert.equal(a.dispose(),p);await p;await assert.rejects(a.step(1),e=>e.code==='simulation.disposed');await b.dispose();
 const physicsSession=await initialize(physics);const state=(await physicsSession.step(1)).state;assert.equal(state.x,3);assert(Math.abs(state.y-5.095)<1e-12);assert.equal(state.vy,-9.81);await physicsSession.dispose();
}
{
 const before=creates;for(const mutate of [c=>c.model.modelVersion='2.0.0',c=>c.model.dimension=3,c=>c.model.units.push('kg'),c=>c.requiredCapabilities.push('collaborative')]){const config=clone(custom);mutate(config);await assert.rejects(initialize(config),e=>e.stage==='negotiation');}assert.equal(creates,before);
 const remoteConfig=clone(custom);remoteConfig.requiredCapabilities=['deterministic'];const guarded={...driver,manifest:{...manifest,capabilities:{...manifest.capabilities,offline:false},requiredPermissions:['network']}};await assert.rejects(initialize(remoteConfig,{driver:guarded}),e=>e.code==='simulation.permission');assert.equal(creates,before);const allowed=await initialize(remoteConfig,{driver:guarded,policy:{network:true}});await allowed.dispose();
 const duplicate=clone(manifest);duplicate.models.push(duplicate.models[0]);assert(!validateDriverManifest(duplicate).valid);
}
{
 let releaseLate,entered;const ready=new Promise(r=>entered=r),slow={manifest,initialize(){entered();return new Promise(r=>releaseLate=r)}};const aborted=new AbortController(),p=initialize(custom,{driver:slow,signal:aborted.signal,timeoutMs:1000});await ready;aborted.abort();await assert.rejects(p,e=>e.code==='simulation.cancelled');let cleaned=0;releaseLate({initialState:{count:0},step:()=>({count:0}),reset:()=>({count:0}),dispose:()=>cleaned++});await new Promise(r=>setImmediate(r));assert.equal(cleaned,1);
 const hung={manifest,initialize:()=>new Promise(()=>{})};await assert.rejects(initialize(custom,{driver:hung,timeoutMs:10}),e=>e.code==='simulation.timeout');
}
{
 let finish,entered,cleaned=0;const ready=new Promise(r=>entered=r),slow={manifest,initialize:()=>({initialState:{count:0},step(){entered();return new Promise(r=>finish=r)},reset:()=>({count:0}),dispose:()=>cleaned++})};const session=await initialize(custom,{driver:slow,timeoutMs:1000}),before=session.getState(),p=session.step(1);await ready;await assert.rejects(session.step(1),e=>e.code==='simulation.busy');assert.throws(()=>session.input({enabled:false}),e=>e.code==='simulation.busy');await session.dispose();await assert.rejects(p,e=>e.code==='simulation.cancelled');finish({count:10});await new Promise(r=>setImmediate(r));assert.equal(session.getState(),before);assert.equal(cleaned,1);
}
{
 const failing={manifest,initialize:()=>({initialState:{count:0},step:()=>{throw Error('HOST_INTERNAL_SECRET')},reset:()=>({count:0}),dispose(){}})},session=await initialize(custom,{driver:failing});await assert.rejects(session.step(1),e=>e.code==='simulation.stepFailure'&&!e.message.includes('HOST_INTERNAL_SECRET'));assert.equal(session.getState().tick,0);await session.dispose();
 const invalid={manifest,initialize:()=>({initialState:{count:0},step:()=>({count:Infinity}),reset:()=>({count:0}),dispose(){}})},bad=await initialize(custom,{driver:invalid});await assert.rejects(bad.step(1),e=>e.stage==='step');assert.equal(bad.getState().tick,0);await bad.dispose();
 let cleaned=0;const timed={manifest,initialize:()=>({initialState:{count:0},step:()=>new Promise(()=>{}),reset:()=>({count:0}),dispose:()=>cleaned++})},hung=await initialize(custom,{driver:timed,timeoutMs:10});await assert.rejects(hung.step(1),e=>e.code==='simulation.timeout');await hung.dispose();assert.equal(cleaned,1);assert.throws(()=>hung.input({enabled:true}),e=>e.code==='simulation.disposed');
 const native={manifest,initialize:()=>({initialState:new Date(),step:()=>({count:0}),reset:()=>({count:0}),dispose(){}})};await assert.rejects(initialize(custom,{driver:native}));
}
assert.equal(releases,4);const program=ts.createProgram([new URL('./type-consumer.mts',import.meta.url).pathname],{strict:true,noEmit:true,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,lib:['lib.es2022.d.ts']});const diagnostics=ts.getPreEmitDiagnostics(program);assert.equal(diagnostics.length,0,diagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')).join('\n'));
console.log('Simulation contract: deterministic counter/analytic physics, exact driver negotiation/permissions, typed field bounds, async initialization/step/reset, cancellation/timeout/late cleanup and headless types passed.');
