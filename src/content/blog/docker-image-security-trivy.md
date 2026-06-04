---
title: 'We thought our Docker images were secure. Then we ran Trivy.'
description: 'Most Docker images sitting in production right now have critical CVEs in them. Not because engineers are careless — but because the default way everyone learns to write Dockerfiles quietly ships hundreds of vulnerable packages that your app never even uses.'
pubDate: 'Jun 02 2025'
---

Most Docker images in production have critical CVEs in them.

Not zero. Not a few. Hundreds. We ran Trivy across our registry last quarter and the first scan results were embarrassing. Thirteen images in production. Average of 340 vulnerabilities per image. Eleven of those images had at least one critical severity CVE.

The strange part: our engineers are good. They care about security. They were following the Dockerfile patterns they learned from official docs and Stack Overflow answers. And those patterns, it turns out, are quietly building vulnerable images by default.

Here is exactly what was wrong and how we fixed it.

## The real problem: you are shipping an OS you don't need

The most common Dockerfile pattern for a Node.js app looks something like this:

```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "server.js"]
```

This builds a working container. But `node:18` is built on Debian Bookworm. Debian Bookworm ships with over 400 packages: bash, curl, wget, apt, gcc, make, python3, openssl, glibc, and hundreds of libraries that a Node.js HTTP server has absolutely no need for at runtime.

Every one of those packages has its own vulnerability surface. When Debian maintainers are slow to patch a glibc CVE, or when a new exploit drops for OpenSSL, every image built on this base — your image — is now vulnerable. Not because your code has a bug. Because you shipped an entire Linux distribution as background noise.

## What Trivy actually found

We broke our findings into three categories:

**Category 1: OS package CVEs (largest group)**
These are CVEs in packages like `libssl`, `zlib`, `libcurl`, `expat`, that exist in the base image and have nothing to do with your application. Your Node.js app is not calling into zlib directly (in most cases). These packages exist because the base image maintainer included them for general-purpose use. They are the majority of findings in most scans.

**Category 2: Application dependency CVEs**
These are CVEs in your `node_modules`, Python pip packages, or Maven jars. They are in your direct or transitive dependencies. These actually can affect your application — an attacker could trigger a path traversal in an old version of `express`, for example, through your actual HTTP handlers.

**Category 3: CVEs in your build-time tools shipped to production**
This was the embarrassing one. Several of our images were installing build dependencies (like `gcc`, `python3-dev`, `build-essential`) to compile native Node.js addons — and then shipping those compilers in the final image. A compiler in a production container is not just unnecessary; it gives an attacker who gets code execution in your container the ability to compile and run arbitrary binaries.

## The fix: multi-stage builds and distroless

Multi-stage builds have been in Docker since 2017. They are still underused.

The concept is simple: use one stage to build your application (it can be fat and full-featured), and copy only the compiled output into a second, minimal stage. The final image only contains the second stage.

Here is what the insecure Dockerfile above looks like when done properly:

```dockerfile
# Stage 1: Build
FROM node:18-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

# Stage 2: Runtime (distroless)
FROM gcr.io/distroless/nodejs18-debian12
WORKDIR /app
COPY --from=builder /app /app
CMD ["server.js"]
```

The runtime image here is Google's distroless Node.js image. It contains:
- The Node.js runtime binary
- glibc
- OpenSSL (only what Node.js actually links against)
- ca-certificates

It does not contain: a shell, curl, wget, apt, a package manager, or any of the hundreds of OS packages from the standard Debian base. You cannot `exec` into it and run `bash` because bash does not exist. An attacker who gets code execution in your container is running inside a box with almost nothing to work with.

Our Trivy findings after switching to distroless:

| Base Image | CVEs before | CVEs after |
|---|---|---|
| `node:18` | 387 | 11 |
| `python:3.11` | 412 | 8 |
| `openjdk:17` | 298 | 14 |

The 8–14 remaining CVEs were mostly low/medium severity in glibc or OpenSSL with no public exploit and patches in progress. We accepted those and set up alerting to catch when critical new ones arrive.

## The thing about CVE severity that people misunderstand

Not all critical CVEs in your image can actually be exploited against your application. A critical CVE in `curl` only affects you if an attacker can trigger a curl invocation in your running container. If your app never calls curl, the CVE is technically present but not exploitable in your attack surface.

This is why severity alone is not the right filter. What matters is:

1. **Is the vulnerable package actually reachable?** A CVE in a build-time dependency that does not ship in your production image is irrelevant.
2. **Does the CVE require local access or network access?** CVEs that require physical access or logged-in user sessions are typically lower risk in containerized workloads.
3. **Does the CVE have a public PoC exploit?** A theoretical vulnerability and a weaponized exploit are very different operational risks.

Tools like Trivy have improved significantly here — they now support `--ignore-unfixed` to filter CVEs that have no available patch (since there is nothing you can do about them), and you can write `.trivyignore` files to formally acknowledge and suppress accepted risks with documented justification.

## Setting up continuous scanning in CI

Fixing images once is not enough. New CVEs are disclosed every week. The `node:18` image you scanned clean last month may have a new critical finding today.

The pattern we use:

```yaml
# In your GitHub Actions pipeline
- name: Build image
  run: docker build -t myapp:${{ github.sha }} .

- name: Scan with Trivy
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: myapp:${{ github.sha }}
    format: 'sarif'
    exit-code: '1'
    ignore-unfixed: true
    severity: 'CRITICAL,HIGH'
    output: 'trivy-results.sarif'

- name: Upload Trivy results to GitHub Security tab
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: 'trivy-results.sarif'
```

The `exit-code: '1'` flag is the critical part. If Trivy finds a CRITICAL or HIGH CVE with an available fix, the pipeline fails. The image never reaches your registry. This turns CVE management from a quarterly audit task into an automatic gate that runs on every commit.

We also set up scheduled scans against already-deployed images using Trivy's registry scanning mode. Even if your code hasn't changed, a new CVE disclosure against your base image will be caught within 24 hours.

## The hardest part: Java and its transitive dependency graph

For JVM applications, the CVE situation is more complex because Maven and Gradle transitive dependency graphs are enormous. A typical Spring Boot application pulls in 80–120 jars, many of which you never explicitly declared. Log4Shell lived in `log4j-core`, which was a transitive dependency of dozens of frameworks — developers who had never heard of log4j were shipping it.

Trivy scans your jar files directly, including fat jars. But the fix for application-layer CVEs is different from OS-layer CVEs. You cannot switch base images to make a vulnerable Spring dependency disappear. You have to actually update the dependency.

What we now run in addition to Trivy: `mvn dependency:tree` piped through a CVE database check as part of our build, combined with Dependabot alerts configured in GitHub. When a dependency CVE drops, we get a PR automatically that bumps the affected library. We review, test, and merge. The window between CVE disclosure and our images being patched went from "whenever someone noticed" to 48–72 hours.

## What we learned

Secure images are not hard to build. They are just rarely taught correctly. The default patterns everyone learns from documentation produce images that would fail any serious security audit.

The three changes that had the biggest impact:

1. **Switch to distroless or slim base images.** This eliminates 90%+ of your OS-layer CVE surface in one step.
2. **Use multi-stage builds always.** If you are installing build tools, they should never exist in your production image.
3. **Scan in CI with a hard failure gate.** Security that only runs in quarterly audits is not security.

The remaining CVEs after those three changes — the small number in glibc or OpenSSL that are unfixed or low exploitability — are a manageable, documented risk. Everything else is technical debt you inherited from patterns written before container security was a serious concern.

Run Trivy on your images right now. The results will be uncomfortable. That discomfort is useful information.
