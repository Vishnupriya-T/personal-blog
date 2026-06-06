---
title: 'Your LLM app needs Prometheus metrics before it needs a better prompt'
description: 'AI features deployed into production need the same operational discipline as every other service: latency SLOs, token cost metrics, error budgets, fallback behavior, and retrieval quality signals.'
pubDate: 'Jun 10 2025'
---

Most teams debug LLM applications by reading transcripts.

That is useful for product quality. It is not enough for operations.

Once an AI feature is in production, it behaves like a service dependency with unusual failure modes: high latency, provider errors, rate limits, cost spikes, retrieval misses, context-window overflow, and output quality regressions. If you cannot see those signals in Prometheus, Grafana, or whatever observability stack you use, you are flying blind.

## The first SLO is latency

Users experience an AI feature as waiting. If the assistant takes 18 seconds to answer, it may be technically working and still feel broken.

Track latency by stage:

```text
request received
-> auth and policy check
-> retrieval
-> model call
-> streaming first token
-> final token
```

The most important metric is time to first token. A streamed response that starts in 900ms and finishes in 8 seconds feels better than a silent 5-second wait followed by a full response.

Useful metrics:

```text
llm_request_duration_seconds
llm_time_to_first_token_seconds
llm_model_duration_seconds
llm_retrieval_duration_seconds
```

Break them down by model, route, environment, and feature. A global average hides the endpoint your users are actually complaining about.

## Token cost should be a first-class metric

Token usage is capacity. Treat it that way.

If a prompt change doubles input tokens, it can double cost and increase latency. If retrieval starts pulling 20 chunks instead of 5, your model calls get slower and more expensive. If a user opens a chat loop that repeatedly sends the entire conversation history, the system may work during testing and become expensive in production.

Track:

```text
llm_input_tokens_total
llm_output_tokens_total
llm_estimated_cost_usd_total
llm_context_window_usage_ratio
```

Then alert on abnormal changes. A sudden 3x increase in tokens per request is a production regression, even if every response returns HTTP 200.

## Retrieval quality needs operational signals

RAG failures often look like model failures. The model gives a weak answer, but the real issue is that retrieval gave it weak context.

Instrument retrieval directly:

- Number of chunks retrieved
- Similarity score distribution
- Empty retrieval rate
- Source document age
- Permission-filter drop rate
- Top source types used in answers

If empty retrieval rate jumps after a docs migration, the prompt is not the problem. Your index is stale or your chunking pipeline broke.

## Fallbacks are part of reliability

LLM providers fail. Rate limits happen. Network calls time out. A production AI feature needs a fallback path.

Fallback does not always mean another model. Sometimes it means:

- Return a concise "I cannot answer right now" message.
- Show the top retrieved documents without synthesis.
- Switch from a large model to a smaller model.
- Disable tool calls while keeping search available.
- Queue the task and notify the user when complete.

The worst fallback is hanging until a load balancer timeout. That turns a model issue into a broken application experience.

## Logs must be useful without leaking secrets

AI logs are tricky. You need enough detail to debug behavior, but prompts can contain secrets, PII, internal URLs, stack traces, and customer data.

Log structured metadata by default:

```json
{
  "request_id": "req_123",
  "feature": "ask-vishnu",
  "model": "gemini",
  "status": "success",
  "input_tokens": 1834,
  "output_tokens": 402,
  "retrieved_chunks": 5,
  "time_to_first_token_ms": 840
}
```

Store full transcripts only when there is a clear policy, retention limit, and redaction layer. Debuggability should not quietly become a data retention problem.

## What we learned

LLM production readiness is not mysterious. It is service reliability with a few new dimensions.

Before spending another week tuning a prompt, add the boring metrics: latency, first-token time, token usage, cost, provider errors, retrieval health, fallback rate. Once those are visible, the system becomes much easier to improve.

You cannot prompt your way out of missing observability.

