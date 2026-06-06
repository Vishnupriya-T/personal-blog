---
title: 'AI code review in CI/CD is useful only when it stops pretending to be a senior engineer'
description: 'LLM review bots are best at narrow, repetitive checks with rich context. They become dangerous when they make broad architectural judgments without owning production outcomes.'
pubDate: 'Jun 09 2025'
---

AI code review bots are useful. They are also frequently overpromised.

The bad version leaves vague comments like "consider improving error handling" on a pull request it barely understands. The good version catches the boring, repeated mistakes that humans miss because humans are tired: missing timeouts, unsafe shell interpolation, unpinned actions, Kubernetes manifests without resource limits, Dockerfiles that ship build tools to production.

That distinction matters. AI review should be a guardrail, not a pretend staff engineer.

## The model needs a narrow job

The most effective AI review checks are specific:

- Does this deployment set CPU and memory requests?
- Does this GitHub Action pin third-party actions by SHA?
- Does this Dockerfile copy secrets into an image layer?
- Does this Terraform change open a security group to `0.0.0.0/0`?
- Does this Kubernetes change remove a readiness probe?

Those are review tasks with concrete evidence in the diff. The assistant can inspect the patch, compare it to a policy, and produce a precise comment.

The weak version asks the model: "Review this PR for best practices." That prompt invites generic advice. Generic advice becomes noise. Noise gets ignored.

## Put policy next to the prompt

If the assistant is reviewing DevOps changes, it should not rely on whatever "best practices" the model learned from the internet. It should use your team's actual standards.

For example:

```markdown
Kubernetes policy:
- Every Deployment must define readinessProbe and livenessProbe.
- Production Deployments must set requests and limits for CPU and memory.
- Services exposed outside the cluster must include owner and data-classification labels.
- Privileged containers are blocked unless an exception ID is present.
```

Now the assistant has something real to enforce. Its comments can cite the exact rule, not a vague preference.

## CI/CD is where AI review becomes operational

Running AI review only as a GitHub comment is helpful but incomplete. The stronger pattern is tiered enforcement:

1. Informational comments for low-risk issues.
2. Required human acknowledgment for medium-risk issues.
3. Hard failure for known dangerous patterns.

An LLM should not be the only thing blocking production. Deterministic policy tools should handle hard gates whenever possible: OPA, Conftest, Checkov, Trivy, kube-linter, tfsec. The AI layer should explain the failure, suggest the smallest fix, and connect the engineer to the right internal standard.

That is where it shines: translation between policy and developer action.

## Context beats cleverness

The assistant needs more than the diff. It needs:

- Repository type: app, infra, library, data pipeline
- Runtime: Kubernetes, Lambda, VM, batch job
- Environment affected: dev, staging, production
- Service ownership and criticality
- Existing patterns in nearby files

A missing memory limit in a toy dev manifest is not the same as a missing memory limit in a production deployment for a customer-facing API. Without context, the assistant either underreacts or overreacts.

The best implementation I have seen loads a small context bundle into the review:

```text
service: payments-api
runtime: eks
environment: production
criticality: tier-1
owner: platform-payments
policy_pack: kubernetes-production-v3
```

The review becomes sharper because the model knows what kind of system it is looking at.

## Do not let the bot comment on everything

A noisy review bot gets mentally muted within a week.

Set a high bar for comments:

- The issue must be actionable.
- The comment must point to a specific line or file.
- The suggested fix must be concrete.
- The bot should avoid style opinions unless the repo has an explicit style rule.
- The bot should group related findings instead of scattering ten comments.

AI review succeeds when engineers feel it saves them time. It fails when it creates another queue of vague chores.

## What we learned

The practical value of AI in CI/CD is not replacing reviewers. It is making policy understandable at the exact moment a risky change is introduced.

Use deterministic scanners for deterministic failures. Use AI to explain, prioritize, and suggest fixes in the language of the repository. Keep the job narrow. Keep the comments scarce. Feed it your real policies.

That is not as flashy as "AI senior reviewer." It is much more likely to survive contact with production.

