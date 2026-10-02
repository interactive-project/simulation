import type {SimulationConfig,DriverManifest} from '@interactive-project/simulation';
import {normalizeSimulationConfig} from '@interactive-project/simulation';
import {initializeSimulation} from '@interactive-project/simulation/runtime';
import type {Driver,SimulationSession} from '@interactive-project/simulation/runtime';
import {validateSimulationConfig,validateDriverManifest} from '@interactive-project/simulation/validation';
declare const config:SimulationConfig;declare const driver:Driver;const normalized=normalizeSimulationConfig(config,validateSimulationConfig);const pending:Promise<SimulationSession>=initializeSimulation({config:normalized,driver,validateConfig:validateSimulationConfig,validateManifest:validateDriverManifest});void pending;declare const manifest:DriverManifest;void manifest;
