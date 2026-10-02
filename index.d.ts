export type {Scalar,Field,Capability,SimulationConfig,DriverManifest,SimulationState} from './types/simulation.js';
import type {Field,Scalar,SimulationConfig} from './types/simulation.js';
export class SimulationError extends Error {readonly code:string;readonly stage:string;constructor(code:string,stage:string)}
export function copySimulation(input:unknown):unknown;
export function validFieldValue(field:Field,value:unknown):boolean;
export function fieldValues(fields:readonly Field[],input:unknown):Readonly<Record<string,Scalar>>;
export function normalizeSimulationConfig(input:unknown,validateConfig:(input:unknown)=>{valid:boolean}):SimulationConfig;
