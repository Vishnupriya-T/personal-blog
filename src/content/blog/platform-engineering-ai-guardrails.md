---
title: 'Platform teams should treat AI like production infrastructure, not a side project'
description: 'Internal AI tools fail when they bypass the same controls we expect from every other production platform: identity, audit logs, cost limits, data boundaries, and deployment ownership.'
pubDate: 'Jun 08 2025'
---

The fastest way to create AI risk inside an engineering organization is to treat AI tooling like a hackathon project.

Someone builds a useful chatbot. It answers questions from Confluence. Then it reads deployment logs. Then someone connects it to Jira. Then it gets access to incident channels. Six weeks later, nobody can answer a simple question: what data can this thing see, and who approved it?

That is not an AI problem. That is a platform engineering problem.

## AI tools need the same ownership model as internal platforms

If a tool can read internal code, summarize incidents, inspect logs, or suggest deployment commands, it is production infrastructure. It needs an owner, an SLO, a rollback plan, access reviews, and a clear boundary around what it is allowed to do.

The mistake is letting every team build its own AI workflow from scratch. That creates five different prompt stores, five different API keys, five different logging practices, and five different answers to "where did this customer data go?"

A platform team should provide the paved road:

- Approved model providers
- Centralized secret management
- Request logging with sensitive-field redaction
- Role-based access controls
- Prompt and tool versioning
- Cost budgets by team or app
- Evaluation gates before production rollout

Teams can still move fast. They just move fast on top of a system that will survive an audit.

## The real control plane is not the model

People obsess over which model to use. That matters, but not as much as the control plane around it.

The control plane answers:

- Who is allowed to call the model?
- What data can be retrieved for a given user?
- Which tools can the assistant invoke?
- Are mutating tools disabled by default?
- Are prompts and outputs logged safely?
- Can we reproduce what the assistant saw during an incident?

Without those controls, you do not have an AI platform. You have API calls with optimism.

## RAG needs DevOps discipline

Retrieval-augmented generation sounds like an application feature, but in production it behaves like a distributed system.

Documents change. Embeddings drift. Permissions change. Indexing jobs fail. Stale chunks stick around. A page that was public last month becomes restricted this month, but the vector database still contains it.

That means your RAG pipeline needs the same operational controls as any data pipeline:

```text
Source sync -> Permission filter -> Chunk -> Embed -> Index -> Evaluate -> Serve
```

Every stage needs metrics. Every stage needs failure alerts. Every indexed chunk should carry source metadata, timestamp, owner, and permission scope. If a user loses access to a document, retrieval must respect that immediately or the system becomes a data leak with a chat interface.

## Cost is a reliability concern

AI costs are not just finance problems. They are reliability problems because uncontrolled cost often leads to emergency throttling.

If a popular internal assistant suddenly burns through its monthly budget in eight days, someone will add crude limits under pressure. Those limits will break workflows at the worst possible time.

Treat inference like any other shared resource:

- Rate limits per user and service account
- Budget alerts before the hard limit
- Caching for repeated internal questions
- Smaller models for classification and routing
- Larger models only when the task requires reasoning depth

The best AI platform decisions often look like boring capacity planning.

## Evaluation has to be part of CI/CD

You would not deploy a new payment service without tests. But teams routinely deploy new prompts without any evaluation suite.

That is how regressions sneak in. A prompt change improves one demo question and quietly breaks five operational questions that mattered more.

At minimum, keep a versioned evaluation set:

```json
{
  "question": "Why is the payments-api rollout stuck?",
  "expected_sources": ["kubernetes-rollout-runbook", "jenkins-deployment-guide"],
  "must_include": ["kubectl rollout status", "readiness probe"],
  "must_not_include": ["delete namespace", "restart cluster"]
}
```

Run it in CI when prompts, retrieval code, model versions, or tool definitions change. This is not perfect, but it catches the obvious failures before users do.

## What we learned

AI in DevOps should feel innovative to users and boring to operators.

That means identity, auditability, cost controls, evals, deployment metadata, and rollback paths. The model is only one component. The platform around the model is what decides whether the system becomes a trusted internal capability or another unowned experiment that everyone is afraid to touch.

Build the paved road first. Then let teams build quickly on top of it.

