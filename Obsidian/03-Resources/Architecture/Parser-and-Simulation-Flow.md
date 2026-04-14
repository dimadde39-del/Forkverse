# Parser-and-Simulation-Flow

Backlinks: [[MonteRun MOC]] · [[01-Projects/MonteRun/Current-Status]] · [[03-Resources/MOC]] · [[03-Resources/Simulations/Monte-Carlo-Engine]]

## Contract Chain
1. Parser extracts `initial_capital`, `monthly_burn`, `monthly_income`, `income_delay_months`, `months`, `n_simulations`.
2. Backend validates the JSON envelope and normalizes numeric fields.
3. Monte Carlo runs immediately after `status = ready`.
4. Frontend consumes percentiles and raw spaghetti trajectories for chart rendering.

## Why This Note Exists
Когда меняется parser prompt, schema или post-parse simulation behavior, именно эта заметка связывает backend-логику с фронтовым контрактом.

## Related
- Project overview: [[MonteRun MOC]]
- Project status: [[01-Projects/MonteRun/Current-Status]]
- Simulation implementation: [[03-Resources/Simulations/Monte-Carlo-Engine]]
- Design bar: [[03-Resources/Design/emil-design-eng]]
