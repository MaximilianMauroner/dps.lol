# Database wake and Railway sleep rollout

The web query and transaction helpers acquire a connection and run a bounded
readiness probe before application SQL. Connection and probe failures can retry
four times. The existing pool remains max 3 with a 30-second idle timeout and
five-second connection timeout. At worst five connection/probe attempts plus
backoff take about 54 seconds. SQL errors, writes and uncertain commit responses
are never replayed. A failed transaction discards its connection and preserves
its original error even if rollback cannot reach the database.

The raw `database()` pool remains available for bounded ingestion and migration
commands. Those direct callers fail on connection loss rather than replaying a
write. They do not have the web helpers' wake retry. Retrying ingestion requires
its existing archive and match identities, and is a separate operator action.

## Local acceptance

Use a newly initialized, disposable localhost PostgreSQL database:

```sh
DPS_TEST_DATABASE_URL=postgresql://localhost:55439/dps_wake_test bun test tests/database-wake.test.ts
```

The test creates `wake_fixture` in a new isolated schema. A local TCP proxy
rejects connections and drops INSERT/COMMIT responses
after PostgreSQL commits. Tests check stale idle sockets, retained reads/writes,
rollback, no duplicate write, and bounded dependency failure. This simulates
dependency unavailability; it does not prove Railway's private TCP wake routing.

## Unapplied production rollout

1. Obtain Max's approval for deploying the draft PR and enabling sleep on the
   dps production Postgres service. Do not change credentials, volume, backups,
   database contents, schema or the existing pool settings.
2. Deploy the code with Postgres still awake. Confirm authenticated cohort and
   progression reads, then verify an authorized ingestion operation separately.
3. Enable `sleepApplication: true` on Postgres. Verify that private Railway TCP
   connections wake this template. If they do not, revert the setting immediately.
4. After at least 15 minutes without traffic, confirm sleep from Railway lifecycle
   evidence. Wake through an authenticated read, confirm existing row counts and
   archive pointers without changing data, and record response latency.
5. Check retained data again after another sleep cycle. Confirm idle connections
   close after 30 seconds and compare metered memory/CPU over seven days.

Current-period Postgres RAM is about $0.82 per 30 days. At 10–50% awake duty,
expected marginal saving is about $0.41–$0.74/month, before small wake CPU costs.
The prior partial-cycle RAM bill was $0.33. Volume and archived data costs remain.
These are resource savings, not a reduction below the Hobby $5 cash floor.

Rollback: disable Postgres sleep first; this restores the existing always-awake
dependency. Revert the code only if a regression remains. No migration or data
rollback is required. If a write response is uncertain, reconcile its existing
match/archive identity before retrying; never blindly repeat the transaction.
