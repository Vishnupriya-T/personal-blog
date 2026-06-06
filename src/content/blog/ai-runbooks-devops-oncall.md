---
title: 'AI runbooks will not save your on-call rotation unless you fix your signals first'
description: 'Everyone wants an AI assistant that explains incidents. The hard truth is that most alert streams are too noisy, too vague, and too detached from deployment context for an LLM to reason about safely.'
pubDate: 'Jun 07 2025'
---

AI on-call assistants fail for the same reason human on-call rotations burn out: the signals are bad.

The demo version looks magical. A Slack alert fires. An AI bot reads the alert, checks Grafana, summarizes the likely cause, and suggests a fix. It feels like the future until the first real incident, when the model confidently explains a symptom, misses the actual trigger, and recommends restarting the one service that is already healthy.

The problem is not the model. The problem is that most DevOps environments are not instrumented for reasoning. They are instrumented for noise.

## Alerts are usually symptoms, not evidence

The average production alert says something like:

```text
High 5xx rate on payments-api
```

That is not a diagnosis. That is a smoke alarm.

For an AI assistant to help, it needs the same evidence a good engineer would ask for:

- What changed in the last 30 minutes?
- Which version is currently serving traffic?
- Did the failure start before or after the rollout?
- Is the error isolated to one route, one AZ, one node group, or one dependency?
- Are readiness failures increasing, or only application-level errors?

If that context is not attached to the alert, the model has to guess. Guessing during an incident is just automation-shaped risk.

## The deployment context is the missing layer

Most observability stacks track metrics and logs. Most CI/CD systems track builds and deploys. The two worlds are often separate.

That separation is exactly where AI incident response breaks.

An assistant reading Prometheus may see p99 latency climbing. An assistant reading Jenkins may see build #842 deployed seven minutes ago. But unless your system links those two facts, the assistant cannot tell whether the latency is a rollout regression, a downstream dependency issue, or a normal traffic spike.

The fix is boring and powerful: attach deployment identity everywhere.

```yaml
metadata:
  annotations:
    ci.build/number: "842"
    ci.build/commit: "a17c9f2"
    ci.build/timestamp: "2025-06-07T14:22:10Z"
    app.version: "payments-api:a17c9f2"
```

Then make sure the same version label appears in logs, metrics, traces, and dashboards. Once the model can correlate "errors started after version X entered service," the quality of its recommendations changes completely.

## Your runbooks need structure, not prose

Most runbooks are written for humans under stress. That means they mix background, tribal knowledge, commands, screenshots, and caveats in one long document.

LLMs can read that, but they do better with structured action blocks:

```markdown
## Symptom
Pods in CrashLoopBackOff after deployment

## Checks
1. kubectl get pods -n $NAMESPACE -l app=$APP
2. kubectl logs deployment/$APP -n $NAMESPACE --since=10m
3. kubectl describe pod $POD -n $NAMESPACE

## Rollback condition
Rollback if the new ReplicaSet has zero ready pods after 5 minutes.

## Rollback command
kubectl rollout undo deployment/$APP -n $NAMESPACE
kubectl rollout status deployment/$APP -n $NAMESPACE --timeout=3m
```

That structure gives the assistant rails. It can quote exact checks, fill in variables from alert labels, and avoid inventing a remediation path that never existed in your environment.

## The assistant should recommend before it acts

I am skeptical of fully autonomous production remediation. Not because automation is bad, but because rollback and restart actions are not equally safe across systems.

Restarting a stateless API pod is cheap. Restarting a Kafka broker at the wrong time is an outage. Rolling back a frontend is low risk. Rolling back a database migration can destroy data.

The right first version of an AI DevOps assistant is not "self-healing production." It is:

1. Summarize the incident in plain language.
2. Correlate it with recent deployments and infrastructure changes.
3. Pull the relevant runbook.
4. Suggest the next three checks.
5. Ask for human approval before any mutating command.

That design still saves time. It removes the five-minute fog at the beginning of an incident without pretending every incident is safe to automate.

## What I would build first

Start with one service and one incident class. Do not build a universal AI SRE.

For example: deployment-related failures in Kubernetes.

Give the assistant access to:

- Recent Jenkins or GitHub Actions runs
- Kubernetes rollout history
- Prometheus error and latency metrics
- Pod events and recent logs
- A structured rollback runbook

Then measure one thing: time from alert to correct diagnosis. Not time to flashy response. Not number of generated words. Diagnosis accuracy.

If the assistant can reliably say "the deployment that started at 14:22 introduced version a17c9f2, readiness failures began 90 seconds later, and rollback is recommended by the runbook," that is useful.

Everything else is theatre.

## What we learned

AI is not a replacement for observability. It is a multiplier on observability quality.

If your alerts are vague, your runbooks are stale, and your deployment metadata is missing, an LLM will mostly produce confident incident fan fiction. If your signals are clean, correlated, and structured, it becomes a genuinely useful incident copilot.

The work is not prompting. The work is operational hygiene.

