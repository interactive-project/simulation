import {copySimulation,fieldValues,normalizeSimulationConfig,SimulationError} from '../index.js';

const MAX_ELAPSED_SECONDS=86400;
const DEFAULT_TIMING=Object.freeze({fixedStepSeconds:1/60,maxFrameDeltaSeconds:.25,maxCatchUpSteps:5,stepBudgetMs:50,seed:0});

function checked(fn,value){let r;try{r=fn(value);}catch{}if(r&&typeof r.then==='function'){Promise.resolve(r).catch(()=>{});return false;}return r?.valid===true;}

function timingOptions(input){
 if(input===undefined||input===null)input=DEFAULT_TIMING;
 if(typeof input!=='object'||Array.isArray(input))throw new SimulationError('simulation.timing','initialize');
 let fixedStepSeconds,maxFrameDeltaSeconds,maxCatchUpSteps,stepBudgetMs,seed;
 try{({fixedStepSeconds=DEFAULT_TIMING.fixedStepSeconds,maxFrameDeltaSeconds=DEFAULT_TIMING.maxFrameDeltaSeconds,maxCatchUpSteps=DEFAULT_TIMING.maxCatchUpSteps,stepBudgetMs=DEFAULT_TIMING.stepBudgetMs,seed=DEFAULT_TIMING.seed}=input);}catch{throw new SimulationError('simulation.timing','initialize');}
 if(typeof fixedStepSeconds!=='number'||!Number.isFinite(fixedStepSeconds)||fixedStepSeconds<.000001||fixedStepSeconds>1||
    typeof maxFrameDeltaSeconds!=='number'||!Number.isFinite(maxFrameDeltaSeconds)||maxFrameDeltaSeconds<=0||maxFrameDeltaSeconds>60||
    !Number.isSafeInteger(maxCatchUpSteps)||maxCatchUpSteps<1||maxCatchUpSteps>120||
    !Number.isSafeInteger(stepBudgetMs)||stepBudgetMs<1||stepBudgetMs>60000||
    !Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new SimulationError('simulation.timing','initialize');
 const fixedStepNs=Math.round(fixedStepSeconds*1e9),maxFrameDeltaNs=Math.round(maxFrameDeltaSeconds*1e9);
 if(!Number.isSafeInteger(fixedStepNs)||fixedStepNs<1||!Number.isSafeInteger(maxFrameDeltaNs)||maxFrameDeltaNs<1)throw new SimulationError('simulation.timing','initialize');
 return Object.freeze({fixedStepSeconds:fixedStepNs/1e9,fixedStepNs,maxFrameDeltaSeconds:maxFrameDeltaNs/1e9,maxFrameDeltaNs,maxCatchUpSteps,maxAccumulatorNs:fixedStepNs*maxCatchUpSteps,stepBudgetMs,seed});
}

function seededRandom(seed,stage){
 let cursor=seed>>>0,active=true;
 return {
  next(){
   if(!active)throw new SimulationError('simulation.randomExpired',stage);
   cursor=(cursor+0x6D2B79F5)>>>0;
   let value=cursor;
   value=Math.imul(value^value>>>15,value|1);
   value^=value+Math.imul(value^value>>>7,value|61);
   return ((value^value>>>14)>>>0)/4294967296;
  },
  state(){return cursor;},
  close(){active=false;}
 };
}

export async function initializeSimulation({config:input,driver,validateConfig,validateManifest,policy:inputPolicy={},signal,timeoutMs=30000,timing:inputTiming}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||typeof validateConfig!=='function'||typeof validateManifest!=='function'||typeof driver?.initialize!=='function')throw new SimulationError('simulation.options','initialize');
 const timing=timingOptions(inputTiming),config=normalizeSimulationConfig(input,validateConfig),manifest=copySimulation(driver.manifest),initialize=driver.initialize.bind(driver),policy=copySimulation(inputPolicy);
 if(!checked(validateManifest,manifest))throw new SimulationError('simulation.manifest','negotiation');const model=manifest.models.find(m=>m.id===config.model.id&&m.modelVersion===config.model.modelVersion&&m.stateVersion===config.model.stateVersion);
 if(!model||!model.dimensions.includes(config.model.dimension)||config.model.units.some(u=>!model.units.includes(u)))throw new SimulationError('simulation.model','negotiation');
 if(config.requiredCapabilities.some(k=>manifest.capabilities[k]!==true)||config.requiredOperations.some(k=>manifest.operations[k]!==true)||config.inputs.length&&!manifest.operations.input)throw new SimulationError('simulation.capability','negotiation');
 if(manifest.requiredPermissions.some(k=>policy[k]!==true))throw new SimulationError('simulation.permission','negotiation');
 let disposed=false,busy=false,active=null,handle=null,stepPort,resetPort,disposePort,disposePromise=null,epoch=0,randomState=timing.seed,accumulatorNs=0,paused=false;
 const defaults=fields=>Object.fromEntries(fields.map(f=>[f.id,f.default]));let values=copySimulation({stateVersion:config.model.stateVersion,modelId:config.model.id,modelVersion:config.model.modelVersion,tick:0,parameters:config.parameterValues,inputs:defaults(config.inputs),state:defaults(config.state)});
 const released=new WeakSet();async function release(h){if(!h||typeof h!=='object'||released.has(h))return;released.add(h);try{const port=h===handle&&disposePort?disposePort:h.dispose?.bind(h);await port?.();}catch{}}
 async function operation(stage,fn,outerSignal,commit,budgetMs=timeoutMs){
  if(disposed)throw new SimulationError('simulation.disposed',stage);if(busy)throw new SimulationError('simulation.busy',stage);busy=true;const generation=epoch,controller=new AbortController();active=controller;let timer,abortListener;
  const cancelled=new Promise((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(new SimulationError(controller.signal.reason==='timeout'?'simulation.timeout':'simulation.cancelled',stage)),{once:true});});
  const abort=()=>controller.abort('cancelled');if(outerSignal){abortListener=abort;outerSignal.addEventListener('abort',abort,{once:true});if(outerSignal.aborted)abort();}
  timer=setTimeout(()=>controller.abort('timeout'),budgetMs);
  const work=Promise.resolve().then(()=>{if(controller.signal.aborted)throw new SimulationError('simulation.cancelled',stage);return fn(controller.signal);});
  try{const result=await Promise.race([work,cancelled]);if(disposed||epoch!==generation||controller.signal.aborted)throw new SimulationError('simulation.cancelled',stage);return commit?commit(result):result;}
  catch(e){if(stage!=='initialize'&&controller.signal.aborted){disposed=true;epoch++;disposePromise??=release(handle);}if(e instanceof SimulationError&&e.stage===stage)throw e;throw new SimulationError('simulation.'+stage+'Failure',stage);}
  finally{clearTimeout(timer);outerSignal?.removeEventListener('abort',abortListener);busy=false;if(active===controller)active=null;}
 }
 try{
  const candidate=await operation('initialize',async operationSignal=>{
   const random=seededRandom(randomState,'initialize');
   try{const result=await initialize(config,{signal:operationSignal,random:random.next});if(operationSignal.aborted||disposed){await release(result);throw new SimulationError('simulation.cancelled','initialize');}return{handle:result,randomState:random.state()};}
   finally{random.close();}
  },signal);
  handle=candidate.handle;randomState=candidate.randomState;if(!handle||typeof handle.step!=='function'||typeof handle.dispose!=='function'||manifest.operations.reset&&typeof handle.reset!=='function')throw new SimulationError('simulation.driverHandle','initialize');
  stepPort=handle.step.bind(handle);resetPort=handle.reset?.bind(handle);disposePort=handle.dispose.bind(handle);values=copySimulation({...values,state:fieldValues(config.state,handle.initialState)});
 }catch(e){disposed=true;epoch++;await release(handle);throw e instanceof SimulationError&&e.stage==='initialize'?e:new SimulationError('simulation.initializeFailure','initialize');}

 async function step(dt,{signal:stepSignal}={}){
  if(typeof dt!=='number'||!Number.isFinite(dt)||dt<=0||dt>60)throw new SimulationError('simulation.dt','step');if(values.tick>=Number.MAX_SAFE_INTEGER)throw new SimulationError('simulation.tick','step');const before=values;
  return operation('step',async opSignal=>{
   const random=seededRandom(randomState,'step');
   try{const projected=fieldValues(config.state,await stepPort({state:before.state,parameters:before.parameters,inputs:before.inputs,dt,signal:opSignal,random:random.next}));return{projected,randomState:random.state()};}
   finally{random.close();}
  },stepSignal,result=>{randomState=result.randomState;values=copySimulation({...before,tick:before.tick+1,state:result.projected});return values;},timing.stepBudgetMs);
 }
 async function reset({signal:resetSignal}={}){
  if(!manifest.operations.reset||!resetPort)throw new SimulationError('simulation.capability','reset');const inputs=copySimulation(defaults(config.inputs)),before=values;
  return operation('reset',async opSignal=>{
   const random=seededRandom(timing.seed,'reset');
   try{const state=fieldValues(config.state,await resetPort({parameters:before.parameters,inputs,signal:opSignal,random:random.next}));return{state,randomState:random.state()};}
   finally{random.close();}
  },resetSignal,result=>{epoch++;randomState=result.randomState;accumulatorNs=0;values=copySimulation({...before,tick:0,inputs,state:result.state});return values;});
 }
 async function advance(elapsedSeconds,{signal:advanceSignal}={}){
  if(typeof elapsedSeconds!=='number'||!Number.isFinite(elapsedSeconds)||elapsedSeconds<0||elapsedSeconds>MAX_ELAPSED_SECONDS)throw new SimulationError('simulation.elapsed','advance');
  if(disposed)throw new SimulationError('simulation.disposed','advance');
  if(paused)return Object.freeze({steps:0,pendingSteps:Math.floor(accumulatorNs/timing.fixedStepNs),alpha:(accumulatorNs%timing.fixedStepNs)/timing.fixedStepNs,droppedTimeSeconds:0,paused:true,state:values});
  const elapsedNs=Math.round(elapsedSeconds*1e9),acceptedNs=Math.min(elapsedNs,timing.maxFrameDeltaNs);let droppedNs=elapsedNs-acceptedNs;
  accumulatorNs+=acceptedNs;if(accumulatorNs>timing.maxAccumulatorNs){droppedNs+=accumulatorNs-timing.maxAccumulatorNs;accumulatorNs=timing.maxAccumulatorNs;}
  let steps=0;while(accumulatorNs>=timing.fixedStepNs&&steps<timing.maxCatchUpSteps&&!paused){await step(timing.fixedStepSeconds,{signal:advanceSignal});accumulatorNs-=timing.fixedStepNs;steps++;}
  return Object.freeze({steps,pendingSteps:Math.floor(accumulatorNs/timing.fixedStepNs),alpha:(accumulatorNs%timing.fixedStepNs)/timing.fixedStepNs,droppedTimeSeconds:droppedNs/1e9,paused,state:values});
 }
 function pause(){if(disposed)throw new SimulationError('simulation.disposed','pause');paused=true;}
 function resume(){if(disposed)throw new SimulationError('simulation.disposed','resume');paused=false;}
 function isPaused(){return paused;}
 return Object.freeze({manifest,config,getState(){return values;},input(input){if(disposed)throw new SimulationError('simulation.disposed','input');if(busy)throw new SimulationError('simulation.busy','input');if(!manifest.operations.input)throw new SimulationError('simulation.capability','input');let next;try{next=fieldValues(config.inputs,input);}catch{throw new SimulationError('simulation.inputFailure','input');}values=copySimulation({...values,inputs:next});return values;},step,advance,pause,resume,isPaused,reset,dispose(){if(disposePromise)return disposePromise;disposed=true;epoch++;active?.abort('cancelled');disposePromise=release(handle);return disposePromise;}});
}
