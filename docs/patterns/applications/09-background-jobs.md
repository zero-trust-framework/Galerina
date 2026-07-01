# Galerina Application Pattern 09 — Background Jobs

**When to use:** Email sending, PDF generation, report generation, CRM sync, data export

---

## The Problem: Ungoverned Background Work

In conventional systems, background jobs are typically:

- Fire-and-forget goroutines, threads, or async tasks
- Not bound by memory limits
- Not tracked in audit logs
- Not governed by effect declarations
- Not retried with declared policies

When a job fails silently or exceeds resource bounds, there is no record of what it attempted, what resources it consumed, or why it stopped.

---

## Galerina Approach: Jobs Are Governed Flows

Every background job in Galerina is a governed flow with a declared entry point. There is no implicit background work.

```galerina
scheduled daily at "02:00" {
  trigger generateMonthlyReport
}

guarded flow generateMonthlyReport() -> JobResult
contract {
  effects { database.read, storage.write, email.send }
  limits {
    max memory 512 MB
    max duration 10 min
  }
  audit { require runtime report }
}
{
  let data = database.query("SELECT * FROM monthly_data WHERE ...")
  let pdf = generatePdf(data)
  storage.write("/reports/monthly.pdf", pdf)
  email.send(to: ops@example.com, subject: "Monthly Report", attachment: pdf)
  return JobResult.success
}
```

The runtime enforces memory and duration limits, records all effects used, and generates a signed runtime report for the execution.

---

## Entry Point Types

| Keyword | Trigger mechanism | Example |
|---------|------------------|---------|
| `scheduled` | Cron-style time trigger | `scheduled daily at "02:00"` |
| `worker` | Queue or worker pool consumer | `worker queue "email-queue"` |
| `event` | Event bus subscription | `event UserCreated triggers sendWelcomeEmail` |

### Scheduled

```galerina
scheduled daily at "02:00" { trigger generateMonthlyReport }
scheduled every 15min { trigger syncCrmData }
scheduled cron "0 9 * * MON" { trigger weeklyDigest }
```

### Worker

```galerina
worker queue "pdf-generation" {
  trigger generateUserReport
  concurrency 4
}
```

### Event

```galerina
event UserCreated triggers sendWelcomeEmail
event OrderPlaced triggers sendOrderConfirmation
event PaymentFailed triggers notifyBillingTeam
```

Event-triggered flows receive the event payload as their first argument:

```galerina
guarded flow sendWelcomeEmail(event: UserCreated) -> JobResult
contract {
  effects { email.send }
  audit { require runtime report }
}
```

---

## No Implicit Background Work

If a function is not declared as a job entry point, it cannot be invoked as a background job at runtime. The scheduler will not run it. Attempting to enqueue an undeclared function is a runtime error, not a silent no-op.

This means every background operation in the system is discoverable from the source — there are no hidden goroutines or anonymous async callbacks.

---

## Runtime Reports for Jobs

Every job execution produces a runtime report automatically when `audit { require runtime report }` is declared. The report includes:

- Job name and entry point type
- Start and end timestamp
- Wall-clock duration
- Peak memory used
- Effects actually invoked (vs effects declared)
- Retry attempts made
- Exit status (`success`, `failed`, `timeout`, `limit-exceeded`)
- Ed25519 signature

The runtime report is written to the audit log store, not to application logs. It is not accessible to the job itself.

---

## Retry Policy

Retry behaviour is declared in the contract under the effect that may fail:

```galerina
contract {
  effects { database.read, email.send }
  retries {
    email.send { attempts 3, backoff exponential, delay 30s }
    database.read { attempts 2, backoff fixed, delay 5s }
  }
}
```

If all retry attempts are exhausted, the job exits with `JobResult.failed` and the retry history is included in the runtime report.

---

## Phase 17 Job Scheduler Integration

Phase 17 introduces the `galerina jobs` CLI and a runtime scheduler component:

```
galerina jobs list          # show all declared job entry points
galerina jobs run <name>    # trigger a job manually (for testing)
galerina jobs status        # show recent job executions and their reports
galerina jobs export        # emit job manifest for external scheduler (e.g. Kubernetes CronJob)
```

The job manifest output (`jobs.manifest.json`) is compatible with Kubernetes CronJob, AWS EventBridge Scheduler, and Fly Machines scheduled tasks. The runtime scheduler can run embedded or delegate to an external system.
