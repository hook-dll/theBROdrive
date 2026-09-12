---
description: Choosing an approach, noticing a wrong premise early, and proving work. Applies to any non-trivial change.
alwaysApply: true
---

# Design loop

## Before writing code

- Ask whether the change **writes** to shared, authoritative or persisted state, or only **reads** it. A reader couples to nothing and can be deleted; a writer inherits every consumer's constraints. When both designs are possible, take the reader.
- Prefer placing new behaviour where failure is cosmetic over where failure is structural.

## While working

- **If a fix makes the thing it fixes bigger, more coupled, or further from where it started, stop.** One widening is tuning; two in a row means the premise is wrong. Go back to the decision that created the constraint instead of satisfying it.
- Treat the first measurement that pushes back as information about the design, not as a number to tune.
- When the second attempt at the same problem fails, say so out loud and offer the alternative design. Do not start a third.

## Prototype to product

- A prototype's value is the result it produced, not the mechanism it used. Keep what makes the result; re-decide everything structural.
- Generalising from one hand-checked case to a procedural family is real work. Budget for it rather than treating it as "wiring up".

## Proving it

- Build the shortest path to observing the real thing — a way to reach the state, and a check that reads the property that matters — before the work, not after. Everything downstream of it goes faster.
- Measure the property the feature exists for, not a proxy for it. A proxy that is easy to compute is the most common way to ship something that passes and does not work.
- When a check fails, first ask whether the check is wrong. Fix the measurement before the code.
