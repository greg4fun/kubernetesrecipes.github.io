---
title: "What's New in kind v0.33.0: Kubernetes 1.37 Default and Key Fixes"
description: "kind v0.33.0 defaults to Kubernetes 1.37.0 nodes, fixes Docker proxy handling and LB config persistence, plus local-path-provisioner tweaks."
publishDate: "2026-10-25"
author: "Luca Berton"
category: "deployments"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.37+"
tags:
  - "kind"
  - "local-cluster"
  - "kubernetes-in-docker"
  - "upgrade"
  - "release-notes"
  - "testing"
---
> 💡 **Quick Answer:** kind v0.33.0 bumps the default node image to Kubernetes 1.37.0 (pinned by sha256 digest), fixes Docker client proxy handling and load-balancer config persistence across restarts, and improves local-path-provisioner tolerations. No new user-facing features beyond dependency bumps.

## The Problem

Teams running `kind` for local development or CI need up-to-date Kubernetes node images and bug fixes without re-learning a new workflow each release. Prior versions defaulted to older Kubernetes minors and had issues with Docker proxy configs not being respected and load balancer (HAProxy/envoy CDS/LDS) config resetting on container restart.

## The Solution

Upgrade the `kind` CLI binary to v0.33.0 and, if you pin node images explicitly in your cluster config, update to the new `kindest/node` digests. The default cluster created with no `--image` flag now provisions Kubernetes 1.37.0.

## Whats New

**Breaking Changes**

- Default node image changed to:
 ```
 kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5
 ```
 Any automation relying on the previous default minor version will now get 1.37.0 unless an image is pinned explicitly.

**New Features**

- Assorted dependency updates (no new CLI features called out in this release).

**Fixes**

- Respect Docker client proxy config for docker-backed nodes (#4192).
- Preserve external load balancer CDS/LDS configuration across container restarts (#4195) — relevant for multi-control-plane (HA) kind clusters.
- Improve local-path-provisioner helperPod tolerations (#4210).
- Assorted documentation fixes.

**Pre-built node images for this release**

| Kubernetes | Image digest |
|---|---|
| v1.37.0 | `kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5` |
| v1.36.4 | `kindest/node:v1.36.4@sha256:099e049362a1526b2db71494e1947aae99bd16290d7c895f2b7ea312e3cbfaed` |
| v1.35.8 | `kindest/node:v1.35.8@sha256:07b2536e30b803ed61d1677a79df6115f798ce64c80f9e22f6ed45afd09323c0` |
| v1.34.11 | `kindest/node:v1.34.11@sha256:44e222ee2132dab25ff87301682f89eb82c7880ea3a1bf543bfe9708fd08d67d` |

> Note: Always pin by `@sha256` digest. Tag-only references are not guaranteed to resolve to the release-specific build until kind changes its tagging scheme. Images support amd64 and arm64 — use the digest matching your host architecture (see [kind#2718](https://github.com/kubernetes-sigs/kind/issues/2718)).

## Upgrade Steps

Install or upgrade the `kind` binary (Linux amd64 example):

```bash
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.33.0/kind-linux-amd64
chmod +x ./kind
sudo mv ./kind /usr/local/bin/kind
kind version
```

For macOS via Homebrew:

```bash
brew upgrade kind
```

Create a new cluster on the default (1.37.0) node image:

```bash
kind create cluster --name demo
```

Or pin an explicit image/digest in a cluster config:

```bash
cat <<'EOF' > kind-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
 image: kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5
- role: worker
 image: kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5
EOF

kind create cluster --name demo --config kind-config.yaml
```

Existing clusters are not upgraded in place — `kind` does not support live Kubernetes version upgrades. Delete and recreate if you need the new default:

```bash
kind delete cluster --name demo
kind create cluster --name demo
```

## Verify

```bash
kind version
# kind v0.33.0 go1.2x linux/amd64

kubectl cluster-info --context kind-demo
kubectl get nodes -o wide
# CONTAINER-RUNTIME column / image should reflect v1.37.0 nodes

docker ps --filter label=io.x-k8s.kind.cluster=demo --format '{{.Image}}'
```

If you run multi-control-plane (HA) clusters behind the built-in load balancer, restart a control-plane container and confirm routing still works (regression fixed by #4195):

```bash
docker restart demo-control-plane2
kubectl get nodes
```

## Common Issues

- **Pulling the wrong architecture image**: if you manually specify an image digest, ensure it matches your host CPU architecture (amd64/arm64); kind does not cross-build automatically.
- **CI pipelines pinned to old Kubernetes minor break**: if automation assumed the previous default minor, pin the image explicitly as shown above rather than relying on kind's shifting default.
- **local-path-provisioner pods pending**: if you customized tolerations on nodes, verify the updated helperPod tolerations (#4210) still match your node taints.

## Best Practices

- Always pin node images by `@sha256` digest in CI and shared dev environments for reproducibility.
- Track the [kind releases page](https://github.com/kubernetes-sigs/kind/releases) and bump the default Kubernetes version deliberately rather than implicitly via `kind` CLI upgrades.
- Recreate clusters rather than attempting in-place Kubernetes version upgrades — kind clusters are designed to be ephemeral.
- Check Docker proxy environment variables (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`) are correctly picked up now that #4192 is fixed, especially in corporate network setups.
