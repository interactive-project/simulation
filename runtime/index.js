import {copySimulation,fieldValues,normalizeSimulationConfig,SimulationError} from '../index.js';
function checked(fn,value){let r;try{r=fn(value);}catch{}if(r&&typeof r.then==='function'){Promise.resolve(r).catch(()=>{});return false;}return r?.valid===true;}
export async function initializeSimulation({config:input,driver,validateConfig,validateManifest,policy:inputPolicy={},signal,timeoutMs=30000}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||typeof validateConfig!=='function'||typeof validateManifest!=='function'||typeof driver?.initialize!=='function')throw new SimulationError('simulation.options','initialize');
 const config=normalizeSimulationConfig(input,validateConfig),manifest=copySimulation(driver.manifest),initialize=driver.initialize.bind(driver),policy=copySimulation(inputPolicy);
 if(!checked(validateManifest,manifest))throw new SimulationError('simulation.manifest','negotiation');const model=manifest.models.find(m=>m.id===config.model.id&&m.modelVersion===config.model.modelVersion&&m.stateVersion===config.model.stateVersion);
 if(!model||!model.dimensions.includes(config.model.dimension)||config.model.units.some(u=>!model.units.includes(u)))throw new SimulationError('simulation.model','negotiation');
 if(config.requiredCapabilities.some(k=>manifest.capabilities[k]!==true)||config.requiredOperations.some(k=>manifest.operations[k]!==true)||config.inputs.length&&!manifest.operations.input)throw new SimulationError('simulation.capability','negotiation');
 if(manifest.requiredPermissions.some(k=>policy[k]!==true))throw new SimulationError('simulation.permission','negotiation');
 let disposed=false,busy=false,active=null,handle=null,stepPort,resetPort,disposePort,disposePromise=null,epoch=0;
 const defaults=fields=>Object.fromEntries(fields.map(f=>[f.id,f.default]));let values=copySimulation({stateVersion:config.model.stateVersion,modelId:config.model.id,modelVersion:config.model.modelVersion,tick:0,parameters:config.parameterValues,inputs:defaults(config.inputs),state:defaults(config.state)});
 const released=new WeakSet();async function release(h){if(!h||typeof h!=='object'||released.has(h))return;released.add(h);try{const port=h===handle&&disposePort?disposePort:h.dispose?.bind(h);await port?.();}catch{}}
 async function operation(stage,fn,outerSignal,commit){
  if(disposed)throw new SimulationError('simulation.disposed',stage);if(busy)throw new SimulationError('simulation.busy',stage);busy=true;const generation=epoch,controller=new AbortController();active=controller;let timer,abortListener;
  const cancelled=new Promise((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(new SimulationError(controller.signal.reason==='timeout'?'simulation.timeout':'simulation.cancelled',stage)),{once:true});});
  const abort=()=>controller.abort('cancelled');if(outerSignal){abortListener=abort;outerSignal.addEventListener('abort',abort,{once:true});if(outerSignal.aborted)abort();}
  timer=setTimeout(()=>controller.abort('timeout'),timeoutMs);
  const work=Promise.resolve().then(()=>{if(controller.signal.aborted)throw new SimulationError('simulation.cancelled',stage);return fn(controller.signal);});
  try{const result=await Promise.race([work,cancelled]);if(disposed||epoch!==generation||controller.signal.aborted)throw new SimulationError('simulation.cancelled',stage);return commit?commit(result):result;}
  catch(e){if(stage!=='initialize'&&controller.signal.aborted){disposed=true;epoch++;disposePromise??=release(handle);}if(e instanceof SimulationError&&e.stage===stage)throw e;throw new SimulationError('simulation.'+stage+'Failure',stage);}
  finally{clearTimeout(timer);outerSignal?.removeEventListener('abort',abortListener);busy=false;if(active===controller)active=null;}
 }
 try{
  const candidate=await operation('initialize',async operationSignal=>{
   const result=await initialize(config,{signal:operationSignal});if(operationSignal.aborted||disposed){await release(result);throw new SimulationError('simulation.cancelled','initialize');}return result;
  },signal);
  handle=candidate;if(!handle||typeof handle.step!=='function'||typeof handle.dispose!=='function'||manifest.operations.reset&&typeof handle.reset!=='function')throw new SimulationError('simulation.driverHandle','initialize');
  stepPort=handle.step.bind(handle);resetPort=handle.reset?.bind(handle);disposePort=handle.dispose.bind(handle);values=copySimulation({...values,state:fieldValues(config.state,handle.initialState)});
 }catch(e){disposed=true;epoch++;await release(handle);throw e instanceof SimulationError&&e.stage==='initialize'?e:new SimulationError('simulation.initializeFailure','initialize');}
 return Object.freeze({
  manifest,config,getState(){return values;},
  input(input){if(disposed)throw new SimulationError('simulation.disposed','input');if(busy)throw new SimulationError('simulation.busy','input');if(!manifest.operations.input)throw new SimulationError('simulation.capability','input');let next;try{next=fieldValues(config.inputs,input);}catch{throw new SimulationError('simulation.inputFailure','input');}values=copySimulation({...values,inputs:next});return values;},
  async step(dt,{signal:stepSignal}={}){if(typeof dt!=='number'||!Number.isFinite(dt)||dt<=0||dt>60)throw new SimulationError('simulation.dt','step');if(values.tick>=Number.MAX_SAFE_INTEGER)throw new SimulationError('simulation.tick','step');const before=values;const next=await operation('step',async opSignal=>fieldValues(config.state,await stepPort({state:before.state,parameters:before.parameters,inputs:before.inputs,dt,signal:opSignal})),stepSignal,next=>{values=copySimulation({...before,tick:before.tick+1,state:next});return values;});return next;},
  async reset({signal:resetSignal}={}){if(!manifest.operations.reset||!resetPort)throw new SimulationError('simulation.capability','reset');const inputs=copySimulation(defaults(config.inputs)),before=values;const next=await operation('reset',async opSignal=>fieldValues(config.state,await resetPort({parameters:before.parameters,inputs,signal:opSignal})),resetSignal,next=>{epoch++;values=copySimulation({...before,tick:0,inputs,state:next});return values;});return next;},
  dispose(){if(disposePromise)return disposePromise;disposed=true;epoch++;active?.abort('cancelled');disposePromise=release(handle);return disposePromise;}
 });
}
