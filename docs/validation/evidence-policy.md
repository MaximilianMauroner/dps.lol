# Mechanic validation evidence policy

P03 starts from P01 contract fixtures. Those are **synthetic** interface examples and supply no
in-game evidence. Legacy characterization records preserve historical output, including known
wrong behavior; they never establish game truth. Only a controlled **observed** record may support
an empirical mechanic claim. Source artifacts from Riot or CommunityDragon explain intended rules,
but do not by themselves establish live behavior.

Each observed record identifies retained capture bytes by SHA-256, locator and source ID. Its
protocol records patch, exact client and hotfix, mode, champion, items, starting numeric state,
timed actions, target stats and trial count. A later client cannot validate patch 26.18. Record
aggregate outputs and sanitized captures without player identifiers. Retain original capture bytes
privately and reference the hash; do not copy private player data into the repository.

For each mechanic, require a source mapping, a synthetic unit or interaction fixture, a trace
assertion for event order and proc multiplicity where applicable, and numeric comparisons with a
declared tolerance. Material discrepancies include changed build ranking, survival/death outcome,
ability availability, target selection, proc count, or an amount outside its stated tolerance.
Classify each discrepancy as input error, source-version conflict, timing/rounding uncertainty,
implementation error or unobserved behavior. An unresolved material discrepancy remains an
explicit coverage gap; it cannot be accepted as a new golden value. A disputed interaction needs a
reviewer different from the mechanic author.

No controlled matching-client observations have been collected by this P03 slice. Patch 26.18
mechanics therefore retain an observation collection and independent review task for P27. P30
reports empirical readiness separately from functional implementation.

Run `bun test tests/engine-harness tests/observations` for the synthetic assertion layer. The CLI
`bun scripts/validate-mechanics.ts <record.json> <trace.json> <expectations.json>` validates a
record and trace; it prints the evidence category and discrepancy so a synthetic result cannot
look like an observed result. Integrators pass their engine's public P01 `Trace` to this harness;
expected facts remain in the record and assertion inputs when the engine adapter changes.
