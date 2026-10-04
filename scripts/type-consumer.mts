import type {SimulationConfig,DriverManifest} from '@interactive-project/simulation';
import {normalizeSimulationConfig} from '@interactive-project/simulation';
import {initializeSimulation} from '@interactive-project/simulation/runtime';
import type {Driver,SimulationAdvanceResult,SimulationSession,SimulationTimingOptions} from '@interactive-project/simulation/runtime';
import {validateSimulationConfig,validateDriverManifest} from '@interactive-project/simulation/validation';
declare const config:SimulationConfig;declare const driver:Driver;const normalized=normalizeSimulationConfig(config,validateSimulationConfig);const pending:Promise<SimulationSession>=initializeSimulation({config:normalized,driver,validateConfig:validateSimulationConfig,validateManifest:validateDriverManifest});void pending;declare const manifest:DriverManifest;void manifest;
const timing:SimulationTimingOptions={fixedStepSeconds:1/60,maxFrameDeltaSeconds:.25,maxCatchUpSteps:5,stepBudgetMs:50,seed:1};void timing;
declare const session:SimulationSession;const advance:Promise<SimulationAdvanceResult>=session.advance(.016);session.pause();session.resume();const paused:boolean=session.isPaused();void advance;void paused;
