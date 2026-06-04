---
title: 'Your Jenkins pipeline is lying about your deployment success rate'
description: 'A green build does not mean a successful deployment. We discovered our Jenkins pipelines were marking deployments as successful even when the new version never finished starting up, health checks were silently failing, and rollbacks were not actually happening. Here is how we fixed it.'
pubDate: 'Jun 01 2025'
---

A green Jenkins build does not mean your deployment succeeded.

This sounds obvious when you say it out loud. But most Jenkins pipelines are built in a way where the definition of "success" is: the `kubectl apply` or `helm upgrade` command returned exit code 0. Not: the new version of your application is actually running and serving traffic correctly.

We discovered this the hard way when a post-deployment incident showed our monitoring alerting on errors 12 minutes after Jenkins had marked the deployment green and our on-call rotation had signed off.

The gap was 12 minutes of bad traffic to a pod that was alive but broken.

## What Jenkins marks as "success" by default

When you run `kubectl apply -f deployment.yaml` in a pipeline, Kubernetes accepts the manifest and returns a success response. It does not wait for your pods to actually roll out. It does not check if the new pods pass their readiness probes. It does not validate that the old pods terminated cleanly.

The typical Jenkins Kubernetes deployment stage looks like this:

```groovy
stage('Deploy') {
    steps {
        sh 'kubectl apply -f k8s/deployment.yaml'
        sh 'kubectl apply -f k8s/service.yaml'
    }
}
```

Both `kubectl apply` calls return 0. Jenkins marks the stage green. The pipeline ends. Your dashboard shows a successful deployment.

Meanwhile, Kubernetes is doing a rolling update. The new pods are pulling their image, starting their JVM, running initialization code. If they fail — an invalid environment variable, a missing secret, a misconfigured database connection string — the pod enters `CrashLoopBackOff`. Kubernetes kills it, retries it, backs off, retries again. During this entire process, Jenkins already called it a win.

## The three kinds of silent failures we were missing

**Failure type 1: CrashLoopBackOff**

The pod starts, crashes immediately, and Kubernetes keeps retrying with exponential backoff. Traffic continues flowing to the old pod replicas if any are still alive. When the last old pod terminates, traffic goes to a broken new pod. Users start seeing errors. Jenkins showed green 8 minutes ago.

**Failure type 2: Readiness probe timeout**

The pod starts and stays running, but the application inside never passes its readiness probe. Maybe it is waiting on a database that is unreachable. Maybe a downstream service is timing out during initialization. Kubernetes correctly marks the pod as `NotReady` and does not route traffic to it. But if your pipeline doesn't check for this, you might end up with zero ready replicas and all traffic failing, while Jenkins confidently reports success.

**Failure type 3: Partial rollout stall**

Kubernetes's rolling update strategy applies a `maxUnavailable` and `maxSurge` policy. If the new pods never become healthy, the rollout will stall partway through. You might end up with 2 old pods and 1 new (broken) pod all running simultaneously, with traffic hitting both. This is perhaps the worst outcome — intermittent errors that affect some users but not others, for an indeterminate period.

## The fix: `kubectl rollout status`

The simplest change that eliminates most of these failure modes is one line:

```groovy
stage('Deploy') {
    steps {
        sh 'kubectl apply -f k8s/deployment.yaml'
        sh 'kubectl rollout status deployment/myapp --timeout=5m'
    }
}
```

`kubectl rollout status` blocks until one of three things happens:
1. The rollout completes successfully (all new pods are Ready)
2. The rollout fails (pods crash or never become ready)
3. The timeout elapses

If outcome 2 or 3 occurs, `kubectl rollout status` exits with a non-zero code. Jenkins marks the stage as failed. Your pipeline can then trigger a rollback.

This one change made our deployment success rate reporting accurate for the first time. Within a week we had caught three deployment failures that would previously have gone unnoticed for minutes to hours.

## Building a real post-deployment validation stage

`kubectl rollout status` is necessary but not sufficient. It tells you your pods are running and passing their readiness probes. It does not tell you that the new version is actually handling traffic correctly.

We added a validation stage after the rollout that does real behavioral checks:

```groovy
stage('Validate') {
    steps {
        script {
            // Wait for the service to stabilize
            sleep(time: 30, unit: 'SECONDS')
            
            // Check error rate via Prometheus
            def errorRate = sh(
                script: """
                    curl -sf 'http://prometheus:9090/api/v1/query' \
                    --data-urlencode 'query=rate(http_requests_total{job="myapp",status=~"5.."}[2m]) / rate(http_requests_total{job="myapp"}[2m])' \
                    | jq '.data.result[0].value[1]' -r
                """,
                returnStdout: true
            ).trim().toDouble()
            
            if (errorRate > 0.01) { // >1% error rate
                error("Post-deployment error rate too high: ${errorRate * 100}%")
            }
            
            // Check p99 latency hasn't spiked
            def p99Latency = sh(
                script: """
                    curl -sf 'http://prometheus:9090/api/v1/query' \
                    --data-urlencode 'query=histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{job="myapp"}[2m]))' \
                    | jq '.data.result[0].value[1]' -r
                """,
                returnStdout: true
            ).trim().toDouble()
            
            if (p99Latency > 2.0) { // >2 second p99
                error("Post-deployment p99 latency too high: ${p99Latency}s")
            }
        }
    }
}
```

This stage queries your actual metrics. If error rates or latency spike after deployment, the pipeline fails — and we trigger an automatic rollback.

## Automatic rollback: the part everyone skips

Most pipelines have no rollback at all. Rollback is a manual operation: someone gets paged, looks at the monitoring, runs `kubectl rollout undo deployment/myapp`, and waits for it to complete. In our case, that process took 8–15 minutes from alert to recovery.

The correct approach is to wire rollback directly into the pipeline's failure path:

```groovy
post {
    failure {
        script {
            echo "Deployment failed. Initiating automatic rollback..."
            sh 'kubectl rollout undo deployment/myapp'
            sh 'kubectl rollout status deployment/myapp --timeout=3m'
            
            // Notify the team
            slackSend(
                channel: '#deployments',
                color: 'danger',
                message: "ROLLBACK: ${env.JOB_NAME} build #${env.BUILD_NUMBER} failed post-deployment validation. Automatically rolled back to previous version."
            )
        }
    }
}
```

The `post { failure { ... } }` block in Jenkins runs whenever any stage fails. If `kubectl rollout status` exits non-zero, if your error rate validation fails, if your latency check fails — the rollback fires automatically, without a human having to notice and respond.

Our mean time to recovery dropped from 12–18 minutes to under 4 minutes after adding automatic rollback. The 4 minutes is the time for `kubectl rollout undo` to complete and for pods to restart.

## The deployment tracking gap between Jenkins and Kubernetes

There is another problem nobody talks about: Jenkins and Kubernetes have no shared concept of identity for a deployment.

Jenkins knows about builds. Build #247 was triggered by commit `abc1234`, ran at 14:32, and succeeded or failed. Kubernetes knows about ReplicaSets and rollout history. It does not know which Jenkins build produced which container image or triggered which rollout.

When an incident happens and you ask "what changed?", you have to manually correlate Jenkins build numbers, Git commit hashes, container image tags, and Kubernetes rollout history. It is slower than it should be.

The fix is to inject traceability at build time. We use image labels to embed the Git commit, build number, and timestamp into the image itself:

```dockerfile
ARG GIT_COMMIT
ARG BUILD_NUMBER
ARG BUILD_TIMESTAMP

LABEL git.commit="${GIT_COMMIT}" \
      ci.build.number="${BUILD_NUMBER}" \
      ci.build.timestamp="${BUILD_TIMESTAMP}"
```

And in the Jenkins pipeline:

```groovy
stage('Build') {
    steps {
        sh """
            docker build \
              --build-arg GIT_COMMIT=${env.GIT_COMMIT} \
              --build-arg BUILD_NUMBER=${env.BUILD_NUMBER} \
              --build-arg BUILD_TIMESTAMP=\$(date -u +%Y-%m-%dT%H:%M:%SZ) \
              -t myapp:${env.GIT_COMMIT} .
        """
    }
}
```

We also annotate the Kubernetes deployment during rollout:

```groovy
sh """
    kubectl annotate deployment/myapp \
      ci.build/number='${env.BUILD_NUMBER}' \
      ci.build/commit='${env.GIT_COMMIT}' \
      ci.build/timestamp='\$(date -u +%Y-%m-%dT%H:%M:%SZ)' \
      --overwrite
"""
```

Now `kubectl describe deployment/myapp` shows exactly which Jenkins build and Git commit is currently running. During incidents, the "what changed?" question goes from a 5-minute investigation to a 5-second lookup.

## What a production-grade deployment pipeline actually looks like

Putting it all together, here is the shape of a pipeline that accurately reflects reality:

```
Build & Test → Push Image → Deploy to Staging → Integration Tests → 
Deploy to Production → Rollout Status Check → Post-Deploy Validation → 
✅ Success notification OR ❌ Automatic rollback + alert
```

The critical difference from the typical pattern: the pipeline does not end at `Deploy`. It ends at `Post-Deploy Validation`. Success means your application is actually running and serving traffic correctly. Not just that Kubernetes accepted your manifest.

## What we learned

Jenkins pipelines lie because we let them. The default behavior of `kubectl apply` returning 0 is correct — it correctly reports that Kubernetes accepted the manifest. We just incorrectly treated "Kubernetes accepted the manifest" as synonymous with "the deployment succeeded."

The changes that made the biggest difference:

1. **Add `kubectl rollout status` to every deployment stage.** This alone catches CrashLoopBackOff and readiness failures.
2. **Query your real metrics in a post-deployment validation stage.** Your readiness probe passing does not mean your p99 latency is acceptable.
3. **Wire automatic rollback into the failure path.** Manual rollback during an incident is too slow.
4. **Inject build identity into your images and Kubernetes annotations.** Incident correlation should take seconds, not minutes.

Your deployment success rate is probably not as high as your Jenkins dashboard suggests. The gap between "Jenkins thinks it worked" and "users are seeing errors" is real, and in most pipelines today it is entirely invisible.

The good news: closing that gap takes about half a day of pipeline work, and the first time your automatic rollback fires and saves a production incident, you will wonder how you ran without it.
