# Parser-and-Simulation-Flow

Backlinks: [[ForkVerse MOC]] · [[01-Projects/ForkVerse/Current-Status]] · [[03-Simulations/Monte-Carlo-Engine]]

## Contract Chain
1. Parser extracts `initial_capital`, `monthly_burn`, `monthly_income`, `income_delay_months`, `months`, `n_simulations`.
2. Backend validates the JSON envelope and normalizes numeric fields.
3. Monte Carlo runs immediately after `status = ready`.
4. Frontend consumes percentiles and raw spaghetti trajectories for chart rendering.

## Why This Note Exists
Когда меняется parser prompt, schema или post-parse simulation behavior, именно эта заметка должна связывать backend-логику с фронтовым контрактом.

## Related
- Simulation implementation: [[03-Simulations/Monte-Carlo-Engine]]
- Project map: [[ForkVerse MOC]]
- Status snapshot: [[01-Projects/ForkVerse/Current-Status]]
