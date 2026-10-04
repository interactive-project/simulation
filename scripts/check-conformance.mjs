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
assert.equal(releases,4);
{
 const clockDriver={manifest,initialize(config,{random}){const initialState={count:random()};return{initialState,step({state,dt,random:nextRandom}){return{count:state.count+nextRandom()*dt};},reset({random:nextRandom}){return{count:nextRandom()};},dispose(){}};}};
 const timing={fixedStepSeconds:.01,maxFrameDeltaSeconds:.25,maxCatchUpSteps:5,stepBudgetMs:100,seed:123};
 const a=await initialize(custom,{driver:clockDriver,timing}),b=await initialize(custom,{driver:clockDriver,timing}),differentSeed=await initialize(custom,{driver:clockDriver,timing:{...timing,seed:124}});
 const first=await a.advance(.025),second=await b.advance(.01);assert.equal(first.steps,2);assert.equal(first.alpha,.5);assert.equal(second.steps,1);assert.equal((await b.advance(.015)).steps,1);assert.deepEqual(a.getState(),b.getState());assert.notEqual(a.getState().state.count,differentSeed.getState().state.count);
 a.pause();const pausedState=a.getState(),pausedAdvance=await a.advance(3);assert.equal(a.isPaused(),true);assert.equal(pausedAdvance.steps,0);assert.equal(pausedAdvance.pendingSteps,0);assert.equal(pausedAdvance.droppedTimeSeconds,0);assert.equal(a.getState(),pausedState);a.resume();assert.equal((await a.advance(.01)).steps,1);assert.equal(a.isPaused(),false);
 const resetA=await a.reset(),resetB=await a.reset(),fresh=await initialize(custom,{driver:clockDriver,timing});assert.equal(resetA.tick,0);assert.equal(resetA.state.count,resetB.state.count);assert.equal(resetA.state.count,fresh.getState().state.count);await fresh.dispose();
 await a.dispose();await b.dispose();await differentSeed.dispose();
 const largeGap=await initialize(custom,{driver:clockDriver,timing}),gap=await largeGap.advance(5);assert.equal(gap.steps,5);assert.equal(gap.pendingSteps,0);assert.equal(gap.alpha,0);assert(Math.abs(gap.droppedTimeSeconds-4.95)<1e-9);assert.equal(gap.state.tick,5);await largeGap.dispose();
 let finishFirst,markStarted;const started=new Promise(resolve=>markStarted=resolve);let calls=0;const pausable={manifest,initialize:()=>({initialState:{count:0},step({state}){calls++;if(calls===1){markStarted();return new Promise(resolve=>finishFirst=()=>resolve({count:state.count+1}));}return{count:state.count+1};},reset:()=>({count:0}),dispose(){}})},pausing=await initialize(custom,{driver:pausable,timing:{fixedStepSeconds:.01,maxCatchUpSteps:3}}),advanceWhileRunning=pausing.advance(.03);await started;pausing.pause();finishFirst();const pausedResult=await advanceWhileRunning;assert.equal(pausedResult.steps,1);assert.equal(pausedResult.pendingSteps,2);assert.equal(pausedResult.alpha,0);pausing.resume();const resumedResult=await pausing.advance(0);assert.equal(resumedResult.steps,2);assert.equal(resumedResult.pendingSteps,0);assert.equal(resumedResult.state.tick,3);await pausing.dispose();
}
{
 let invalidOnce=true;const recoverable={manifest,initialize:()=>({initialState:{count:0},step({state,dt}){if(invalidOnce){invalidOnce=false;return{count:Infinity};}return{count:state.count+dt};},reset:()=>({count:0}),dispose(){}})};
 const config=clone(custom),session=await initialize(config,{driver:recoverable,timing:{fixedStepSeconds:.01,seed:7}});await assert.rejects(session.advance(.01),e=>e.code==='simulation.stepFailure');assert.equal(session.getState().tick,0);const recovered=await session.advance(0);assert.equal(recovered.steps,1);assert.equal(recovered.state.tick,1);await session.dispose();
 let cleaned=0;const slow={manifest,initialize:()=>({initialState:{count:0},step:()=>new Promise(()=>{}),reset:()=>({count:0}),dispose:()=>cleaned++})},budgeted=await initialize(custom,{driver:slow,timeoutMs:1000,timing:{stepBudgetMs:5}});await assert.rejects(budgeted.step(.01),e=>e.code==='simulation.timeout');assert.equal(cleaned,1);
}
{
 const config=clone(custom);config.requiredCapabilities=['offline'];const inexactManifest={...manifest,capabilities:{...manifest.capabilities,deterministic:false}},inexact={manifest:inexactManifest,initialize:()=>({initialState:{count:0},step({state,dt}){return{count:state.count+Math.sin(dt)+1e-14};},reset:()=>({count:0}),dispose(){}})},session=await initialize(config,{driver:inexact,timing:{fixedStepSeconds:.01}});const value=(await session.step(.01)).state.count;assert(Math.abs(value-Math.sin(.01))<=1e-12);await session.dispose();
}
const program=ts.createProgram([new URL('./type-consumer.mts',import.meta.url).pathname],{strict:true,noEmit:true,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,lib:['lib.es2022.d.ts']});const diagnostics=ts.getPreEmitDiagnostics(program);assert.equal(diagnostics.length,0,diagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')).join('\n'));
console.log('Simulation contract: deterministic fixed-step clock, seeded random streams, pause/resume, catch-up/drop limits, reset, per-step budgets, invalid-state recovery, tolerance comparisons, existing driver negotiation and headless types passed.');
