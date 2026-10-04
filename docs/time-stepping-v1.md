# Simulation time stepping v1

The runtime clock keeps simulation time separate from rendering cadence. A host samples its own monotonic clock and passes elapsed seconds to `session.advance(elapsedSeconds)`. The package does not read wall-clock time, create a timer, or call `requestAnimationFrame`. Manual `session.step(dt)` remains available and accepts seconds in `(0, 60]`.

## Fixed-step clock

`initializeSimulation` accepts an optional `timing` object:

| Option | Default | Bounds |
| --- | --- | --- |
| `fixedStepSeconds` | `1 / 60` | 1 microsecond through 1 second |
| `maxFrameDeltaSeconds` | `0.25` | greater than zero through 60 seconds |
| `maxCatchUpSteps` | `5` | integer 1 through 120 |
| `stepBudgetMs` | `50` | integer 1 through 60,000 ms |
| `seed` | `0` | unsigned 32-bit integer |

Elapsed input must be finite and between zero and 86,400 seconds per call. Time values are rounded to integer nanoseconds before accumulation. Each successful fixed step receives the configured fixed delta in seconds, commits exactly one validated state projection, and increments `tick` once. `advance` runs no more than `maxCatchUpSteps` in one call and returns `{steps, pendingSteps, alpha, droppedTimeSeconds, paused, state}`. `alpha` is the remaining fractional step for host interpolation; it is not simulation state.

An elapsed frame delta above `maxFrameDeltaSeconds` is clamped. The accumulator is also capped at `fixedStepSeconds * maxCatchUpSteps`. Both limits drop excess time and report the amount in `droppedTimeSeconds`. This bounds catch-up work after a suspended tab or long stall and avoids an unbounded backlog. `pendingSteps` reports whole accumulated steps left after the call; it is normally zero, but can be nonzero if the host pauses during an asynchronous step. `alpha` remains the fractional remainder in `[0, 1)`. A failed step does not consume its accumulated interval; after a recoverable driver error, the host may call `advance(0)` to retry it. A cancelled or timed-out operation disposes the session under the existing lifecycle contract.

`pause()` stops adding elapsed time. Calls to `advance` while paused run no steps and discard the supplied wall-clock interval without counting it as dropped simulation time. If pause occurs during an asynchronous fixed step, that step is allowed to finish and remaining accumulated steps are reported as `pendingSteps`; `resume()` continues them on the next `advance` call, without replaying time spent paused. A successful `reset()` clears the accumulator and resets the random stream to the original seed; it preserves the paused/running state. Pause, resume and reset do not start or stop a host renderer.

## Seeded random source

The runtime injects a `random()` function into driver initialization, reset and step contexts. It uses a versioned Mulberry32 sequence seeded by the unsigned 32-bit `seed`; results are finite values in `[0, 1)`. The source is only valid during the corresponding asynchronous driver operation and throws `simulation.randomExpired` if retained and called afterward. The sequence advances only when the operation returns a valid state projection. A rejected step leaves both the public state and random sequence unchanged, making a later retry reproducible. Reset starts again from the initialization seed.

This source is deterministic, not cryptographic. A driver that needs seeded reproducibility must use the injected function instead of `Math.random`, clocks, or unseeded vendor randomness. Equal seed, driver version, successful random draw order, inputs and fixed-step trace reproduce the same stream in the same JavaScript environment. Floating-point math, browser/runtime differences, vendor versions and nondeterministic drivers may still produce different results. Conformance checks for such drivers must use declared tolerances rather than exact equality; the `deterministic` manifest capability remains a driver claim.

## Budgets and invalid state

`stepBudgetMs` applies independently to every manual or fixed step. Initialization and reset use `timeoutMs` (30 seconds by default). A timed-out step is cancelled and disposes the session, preventing late state application. Cooperative abort signals do not interrupt synchronous CPU-bound JavaScript or a vendor process; hard worker/process resource isolation remains the host's responsibility.

The runtime validates the complete projected state before committing it. Non-finite numbers, out-of-range fields, missing fields and extra fields reject the step; `tick`, projected state, accumulator interval and random stream remain at their last committed values. If a trusted driver can recover from the bad output, the caller can retry the retained fixed interval. Drivers should stage vendor mutations so a rejected projection does not corrupt their private state.

No ActivitySpec, DriverManifest, Protocol, Core, or snapshot wire schema changes are introduced. Timing options and the random callback are runtime/driver API additions owned by this package; neither enters portable model data or public snapshots.
