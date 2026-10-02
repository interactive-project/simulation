import type {JsonValue} from '@interactive-project/protocol/types';
export type Scalar=number|boolean|string;
export type Field={readonly id:string;readonly unit:string|null}&(
 {readonly valueType:'number'|'integer';readonly default:number;readonly minimum:number;readonly maximum:number}|
 {readonly valueType:'boolean';readonly default:boolean}|
 {readonly valueType:'enum';readonly default:string;readonly values:readonly string[]});
export type Capability='interactive'|'evaluable'|'collaborative'|'offline'|'deterministic'|'resumable'|'aiGeneratable';
export interface SimulationConfig {readonly simulationVersion:'1.0.0';readonly model:{readonly id:string;readonly modelVersion:string;readonly stateVersion:string;readonly dimension:0|2|3;readonly units:readonly string[];readonly data:Readonly<Record<string,JsonValue>>};readonly parameters:readonly Field[];readonly parameterValues:Readonly<Record<string,Scalar>>;readonly inputs:readonly Field[];readonly state:readonly Field[];readonly requiredCapabilities:readonly Capability[];readonly requiredOperations:readonly ('step'|'input'|'reset')[]}
export interface DriverManifest {readonly driverVersion:'1.0.0';readonly id:string;readonly models:readonly {readonly id:string;readonly modelVersion:string;readonly stateVersion:string;readonly dimensions:readonly (0|2|3)[];readonly units:readonly string[]}[];readonly capabilities:Readonly<Record<Capability,boolean>>;readonly operations:Readonly<Record<'step'|'input'|'reset',boolean>>;readonly requiredPermissions:readonly ('execution'|'network'|'media')[]}
export interface SimulationState {readonly stateVersion:string;readonly modelId:string;readonly modelVersion:string;readonly tick:number;readonly parameters:Readonly<Record<string,Scalar>>;readonly inputs:Readonly<Record<string,Scalar>>;readonly state:Readonly<Record<string,Scalar>>}
