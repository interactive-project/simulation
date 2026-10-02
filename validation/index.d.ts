export interface ValidationResult {readonly valid:boolean;readonly diagnostics:readonly {code:string;path:string;severity:'error';message:string}[]}
export function validateSimulationConfig(input:unknown):ValidationResult;
export function validateDriverManifest(input:unknown):ValidationResult;
