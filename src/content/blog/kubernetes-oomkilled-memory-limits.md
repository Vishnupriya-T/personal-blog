---
title: 'Your Kubernetes pods keep OOMKilling. Here is why your memory limits are lying to you.'
description: 'We spent weeks chasing ghost memory leaks in our EKS cluster. The pods were OOMKilled every few hours. Turned out the issue was not a leak at all — it was how Kubernetes, the Linux kernel, and the JVM were each keeping a different definition of what "memory" means.'
pubDate: 'Jun 03 2025'
---

It turns out most teams are setting Kubernetes memory limits wrong.

Not in a subtle way. In a way where they have `requests: 512Mi` and `limits: 512Mi`, their pod OOMKills every six hours like clockwork, and their first response is to bump the limit to `1Gi` — and then `2Gi` — and the pod still gets killed.

We did exactly this. For three weeks.

The real problem is not your application. It is that Kubernetes, the Linux kernel, and the JVM are each keeping a completely different ledger of what the word "memory" actually means. When those ledgers disagree — and they will — your pod dies.

## What OOMKilled actually means

When you see `OOMKilled` in `kubectl describe pod`, the Linux kernel's OOM Killer has stepped in and sent SIGKILL to your container process. This happens when the cgroup memory limit is hit. The kernel does not negotiate. It does not warn you. It just kills the highest-scoring process in the cgroup and moves on.

Kubernetes decides which container to kill using an OOM score — a number from -1000 to 1000. Containers in a `Guaranteed` QoS class (requests == limits) get score -997. `Burstable` containers get scored between 2 and 1000 depending on how much memory they're using relative to their request. Your application containers are almost always the first to go.

The important detail here is: **the OOM Killer fires when the cgroup limit is hit, not when the node runs out of RAM.** So even if your node has 14GB free, if your container's cgroup limit is 512Mi and the RSS touches 513Mi, you get killed.

## The three ledgers that don't agree

Here is where it gets interesting.

**Ledger 1: What Kubernetes thinks your app is using**

Kubernetes reads from `container_memory_working_set_bytes` in cAdvisor. This metric is defined as:
```
RSS + cache that is NOT easily reclaimable
```
It intentionally excludes page cache (files your app has read from disk that the kernel is holding in memory speculatively). This is the number you see in `kubectl top pods`.

**Ledger 2: What the kernel's cgroup is tracking**

The cgroup's memory accounting includes:
```
RSS + reclaimable page cache + anonymous mapped memory
```
This number is always higher than what Kubernetes reports. The cgroup limit fires against *this* number, not the one Kubernetes shows you.

**Ledger 3: What the JVM thinks it's using**

If you are running a Java app (Spring Boot, Kafka Streams, Flink, anything on the JVM), the JVM has its own internal allocator. Before container-aware JVM flags were introduced, the JVM would look at the node's total RAM — say, 64GB — and size its heap relative to that. Running inside a 512Mi cgroup with a JVM targeting 25% of 64GB as default heap size means the JVM tries to allocate ~16GB. It immediately gets killed.

Even with modern JVMs (Java 11+), the defaults are not always what you expect. The JVM respects the cgroup limit for heap sizing by default, but the *off-heap* memory — thread stacks, metaspace, code cache, direct byte buffers, native libraries — is often unaccounted for in your limit calculation.

## A concrete example of how this kills you

Say you set:
```yaml
resources:
  requests:
    memory: "512Mi"
  limits:
    memory: "512Mi"
```

Your Spring Boot app with default settings will allocate roughly:
- JVM heap: ~128Mi (25% of 512Mi cgroup limit)
- Metaspace: ~80–120Mi (grows with class loading)
- Code cache: ~48–64Mi
- Thread stacks: ~1Mi per thread × N threads
- Glibc allocator arenas: up to 8× number of cores (this one surprises people)
- Page cache from reading jars off disk at startup: ~50–100Mi

Before your application processes a single request, you are already sitting at 400–450Mi. The first burst of traffic loads some additional classes, fills a few thread pools, and your RSS crosses 512Mi. The kernel kills the process. `kubectl describe pod` shows `OOMKilled`. Your monitoring shows a restart. You bump the limit. It happens again.

## How we actually fixed it

**Step 1: Stop using the same value for requests and limits.**

This is the single most impactful change. If you set requests < limits, the kernel's page cache has room to breathe. The cgroup will evict page cache before firing the OOM killer when total memory approaches the limit. With equal values, you leave zero headroom for any kernel-managed memory.

We moved to:
```yaml
resources:
  requests:
    memory: "512Mi"
  limits:
    memory: "768Mi"
```

**Step 2: Account for off-heap JVM memory explicitly.**

For Java workloads, we started setting JVM flags explicitly instead of trusting defaults:
```
-XX:MaxRAMPercentage=60.0
-XX:MaxMetaspaceSize=128m
-XX:ReservedCodeCacheSize=64m
-Xss512k
```

The rule of thumb we now use: your JVM heap target + 250-400Mi overhead for everything else = your container memory limit. Never let the JVM heap + overhead exceed your limit by relying on defaults.

**Step 3: Instrument the right metrics.**

Stop looking at `kubectl top pods`. Start looking at `container_memory_rss` and `container_memory_cache` separately in Prometheus. The moment we split those two out on a dashboard, the pattern was obvious — our page cache was enormous and growing with every deployment as the app re-read its jar files.

We also added alerting on `container_memory_working_set_bytes / container_spec_memory_limit_bytes > 0.85`. If any pod crosses 85% of its limit for more than 3 minutes, we get paged before the OOM Killer fires.

**Step 4: Fix Glibc arena fragmentation (the hidden one).**

This one took us a month to find. Glibc's malloc by default creates up to `8 × number_of_cores` memory arenas to reduce lock contention for multithreaded apps. On an 8-core node, that's up to 64 arenas. Each arena holds memory pages that might be "free" from the allocator's perspective but have not been returned to the kernel yet. The cgroup counts this as used.

The fix is straightforward:
```dockerfile
ENV MALLOC_ARENA_MAX=2
```

One environment variable. We saw immediate, sustained 80–120Mi drops in RSS across our Java services.

## The thing nobody tells you about Guaranteed QoS

Setting requests == limits is widely recommended for production because it puts your pod in the `Guaranteed` QoS class, making it nearly immune to eviction. That is true. But it also means you have zero buffer for kernel memory management.

There is no perfect answer here. What we settled on: use `Guaranteed` QoS for your most critical, latency-sensitive services where eviction is unacceptable. Accept that you need to be very precise about your memory budget in that case — instrument everything, tune JVM flags explicitly, and set limits with 20–30% headroom above your measured RSS.

For everything else: `Burstable` QoS with requests set to your baseline steady-state usage and limits set 50% higher. You accept the theoretical risk of eviction under node memory pressure in exchange for your application being able to absorb traffic spikes without dying.

## What we learned

OOMKilled pods are almost never a memory leak. In four years of running Kubernetes in production, a true application-level memory leak has caused maybe 5% of our OOMKill incidents. The other 95% were one of:

- Kernel page cache counted against the cgroup limit
- JVM off-heap memory not accounted for
- Glibc arena fragmentation
- A dependent library (netty, RocksDB, Arrow) using direct byte buffers that bypass heap accounting

The fix is always the same: stop treating memory as a single number, understand whose ledger is being enforced at the moment your pod dies, and instrument each layer separately.

Your application is probably not broken. Kubernetes is just enforcing a definition of "memory" that is more complex than your `limits:` field suggests.
