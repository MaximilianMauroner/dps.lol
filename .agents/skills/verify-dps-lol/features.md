# Feature map

Reusable procedure map. README documents simulator limits and the current patch.
A fixture pass does not establish live League or stored-match acceptance.

| ID | Public action and expected result | Source / regression checks | Reset |
| --- | --- | --- | --- |
| D1 | Open login, reject wrong password, sign in and sign out. Page/API access is gated before data access; session is short-lived and private. | middleware, auth routes/session tests | Dispose owned cookies. |
| D2 | Compare seeded IE/LDR builds at same Yunara level and fixture cohort. Disclosure says fixture/demo, patch/data pin and supported mechanics remain visible. | simulate/cohort routes; domain/API tests | Reset local controls. |
| D3 | Edit items/slots, ranks, combo reorder/remove, duration and Yun Tal stacks. Cached cohort stays stable; explicit realistic reset replaces manual edits only when requested. | workbench and worker protocol; optimizer tests | Reset controls. |
| D4 | Change level/target filters, inspect progression distribution, common core, skill-rank fallback and target cohort. No false stored-match claim with fixtures; denominators/fallback are explicit. | progression/realistic-targets; progression tests | Reset filters. |
| D5 | Select target and inspect chronological trace, mortal death/overkill/censoring, uncapped mode, first crossing and W linger. Summary/trace match; mobility-only E remains a warning. | simulator/engine; chronology/kernel tests | Reset controls. |
| D6 | Run bounded Worker optimization, cancel/restart and inspect progress/results. Exact supported catalog/constraints and worker identity preserved. | optimizer worker/protocol; optimizer tests | Stop owned worker/context. |
| D7 | Send invalid/oversized simulation/cohort requests. Typed bounds/errors and private sanitized output, no server crash. | API routes/tests | Restart owned fixture instance if needed. |
| D8 | On separately provisioned disposable Postgres/bucket, replay owned archives and inspect lineage/coverage. Missing archives stay legacy/incomplete, not verified. | storage-architecture docs; archive tests | Delete only owned synthetic state. |
| D9 | Human Practice Tool comparison with identical target/opener. In-game verification is a separate observed claim, not inferred from engine tests. | README limitations/manual check | Restore test game. |

D8 is blocked without disposable storage; production/Riot ingestion is excluded.
D9 needs a League test operator. No fake cohort establishes population representativeness.
