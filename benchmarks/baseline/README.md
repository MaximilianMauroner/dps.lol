# P00 baseline benchmark

Raw outputs are in [`optimizer-fixture-2026-09-19.ndjson`](optimizer-fixture-2026-09-19.ndjson)
and [`optimizer-fixture-2026-09-19-post-validation.ndjson`](optimizer-fixture-2026-09-19-post-validation.ndjson).

- Command: `bun run benchmark:optimizer`
- Exit status: `0`
- Wall runtime: `1.63 s` (`/usr/bin/time`; user `1.93 s`, sys `0.19 s`)
- Maximum resident set: `185,924 KiB`
- Source: built-in `fixtureTargets` (`source:"fixture"`); no `--targets-dir`, real cohort or
  production data was supplied.
- Runtime: Bun `1.3.14`, Node `v24.13.1`
- Host: Linux `6.8.0-139-generic`, x86_64, Intel Core i7-6700K CPU, 6 logical CPUs, 5.8 GiB RAM
  visible to the environment.

| Level | Slots | Targets | Candidates | Candidate-target simulations | Internal time |
| ----: | ----: | ------: | ---------: | ---------------------------: | ------------: |
|    10 |     3 |      20 |        210 |                        4,200 |      140.0 ms |
|    13 |     4 |      20 |        910 |                       18,200 |      264.2 ms |
|    16 |     5 |      20 |      2,730 |                       54,600 |      814.6 ms |

The benchmark is a deterministic engine-only fixture measurement, not a real-cohort, browser,
worker, production-latency or performance-target success claim. A sanitized provided-cohort run is
not run in P00 because no such pack was supplied and no production data may be ingested or mutated.

The untouched baseline capture was made before P00 edits and dependency installation: wall `1.63 s`,
user `1.93 s`, sys `0.19 s`, max RSS `185,924 KiB`, with internal times `140.0/264.2/814.6 ms`.
The post-validation rerun used the same fixture inputs after the frozen dependency install: exit
status `0`, wall `2.51 s`, user `2.69 s`, sys `0.21 s`, max RSS `187,192 KiB`, with internal times
`251.0/503.7/1,421.7 ms`. Candidate/target counts, rankings and scores were unchanged; this timing
delta is an environment/runtime observation, not a source performance regression claim.
