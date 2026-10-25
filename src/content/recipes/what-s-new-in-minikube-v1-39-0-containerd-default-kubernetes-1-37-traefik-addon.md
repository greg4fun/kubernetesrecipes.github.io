---
title: "What's New in minikube v1.39.0: containerd Default, Kubernetes 1.37, Traefik Addon"
description: "minikube v1.39.0 switches default runtime to containerd, adds K8s 1.36/1.37 support and a Traefik ingress addon."
publishDate: "2026-10-25"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.36+"
tags:
  - "minikube"
  - "local-development"
  - "containerd"
  - "kubernetes-1.37"
  - "ingress"
  - "upgrade"
  - "breaking-changes"
---
> 💡 **Quick Answer:** minikube v1.39.0 makes containerd the default container runtime, adds support for Kubernetes v1.36/v1.37 (default now v1.37.0), ships a new Traefik Helm-based ingress addon, and brings Apple Silicon support to the VirtualBox driver. Existing clusters created with `docker` or `cri-dockerd` runtimes keep working, but any new `minikube start` without an explicit `--container-runtime` flag will now provision containerd.

## The Problem

Operators tracking local-cluster tooling need to know whether upgrading minikube will change the behavior of existing scripts, CI jobs, or Kubernetes version pinning. v1.39.0 includes a default-runtime change and a cri-dockerd support reduction that can silently alter cluster provisioning if teams rely on implicit defaults.

## The Solution

Upgrade the minikube binary, review the breaking changes below, and explicitly pin `--container-runtime` and `--kubernetes-version` in automation if the previous defaults (Docker runtime, older K8s version) must be preserved.

## What's New

**Highlights**
- Kubernetes v1.36 and v1.37 support added; default cluster version is now **v1.37.0** ([#23567](https://github.com/kubernetes/minikube/pull/23567), [#23596](https://github.com/kubernetes/minikube/pull/23596))
- **Default container runtime changed from Docker to containerd** ([#23562](https://github.com/kubernetes/minikube/pull/23562))
- New **Traefik Helm-based ingress addon** ([#23225](https://github.com/kubernetes/minikube/pull/23225))
- VirtualBox driver now supports **Apple Silicon** with VirtualBox 7.1+ ([#22861](https://github.com/kubernetes/minikube/pull/22861))

**Other notable features**
- Helm added to the minikube ISO, guest Helm client upgraded to Helm 4 ([#23420](https://github.com/kubernetes/minikube/pull/23420), [#23383](https://github.com/kubernetes/minikube/pull/23383))
- Configurable DNS servers for VM drivers ([#23069](https://github.com/kubernetes/minikube/pull/23069))
- New `--mdns` flag to enable mDNS on VM start ([#22964](https://github.com/kubernetes/minikube/pull/22964), [#23208](https://github.com/kubernetes/minikube/pull/23208))
- Deterministic MAC addresses for drivers ([#23172](https://github.com/kubernetes/minikube/pull/23172))
- vfkit auto-selects vmnet-shared network when available ([#23040](https://github.com/kubernetes/minikube/pull/23040))
- VM drivers now start in parallel for faster `minikube start` ([#23112](https://github.com/kubernetes/minikube/pull/23112))
- Preload images now fetched from GitHub by default, GCS as failover ([#23087](https://github.com/kubernetes/minikube/pull/23087))

**Notable bug fixes**
- `kubectl exec` with cri-dockerd fixed on Kubernetes v1.36+ by disabling `ExtendWebSocketsToKubelet` ([#22921](https://github.com/kubernetes/minikube/pull/22921))
- `--extra-config=etcd.*` no longer produces invalid kubeadm config ([#23051](https://github.com/kubernetes/minikube/pull/23051))
- `SSHRunner` exit codes now correctly propagate instead of always returning 0 ([#23364](https://github.com/kubernetes/minikube/pull/23364))
- `image load` no longer fails silently when the image is in use by a running container ([#23034](https://github.com/kubernetes/minikube/pull/23034))

**Breaking changes**
- Default container runtime changed to **containerd** ([#23562](https://github.com/kubernetes/minikube/pull/23562)) — scripts assuming Docker (e.g. calling `docker` inside the node, or relying on `minikube docker-env`) will break unless they pass `--container-runtime=docker` explicitly.
- cri-dockerd support is now **limited to x86 and arm64**, and is migrated to pre-compiled GitHub binaries ([#22922](https://github.com/kubernetes/minikube/pull/22922)) — other architectures lose cri-dockerd support.

## Upgrade Steps

Upgrade the minikube binary (Linux example; adapt for macOS/Windows per the [official install docs](https://minikube.sigs.k8s.io/docs/start/)):

```bash
curl -LO https://storage.googleapis.com/minikube/releases/v1.39.0/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube
minikube version
```

If existing automation depends on the Docker runtime or an older default Kubernetes version, delete and recreate the cluster with explicit flags rather than relying on defaults:

```bash
minikube delete
minikube start \
  --kubernetes-version=v1.37.0 \
  --container-runtime=containerd \
  --driver=docker
```

To keep the previous Docker runtime instead of adopting containerd:

```bash
minikube start --container-runtime=docker
```

Enable the new Traefik ingress addon if needed:

```bash
minikube addons enable traefik
```

## Verify

```bash
minikube version
# confirm: minikube version: v1.39.0

kubectl version --short
# confirm server version matches the pinned/default v1.37.0

minikube ssh -- "sudo crictl info | grep -i containerd"
# confirm containerd is the active runtime (if using the new default)

kubectl get pods -A
# cluster-critical pods should be Running
```

## Common Issues

- **CI pipelines break after upgrade**: caused by the containerd default change. Pin `--container-runtime=docker` explicitly in CI `minikube start` invocations until scripts are updated.
- **cri-dockerd unavailable on non-x86/arm64 hosts**: expected per the breaking change in [#22922](https://github.com/kubernetes/minikube/pull/22922); switch to containerd or Docker runtime on those architectures.
- **`minikube docker-env` behaves unexpectedly**: this command is only meaningful with the Docker runtime; with containerd as default it no longer applies — use `minikube image load` workflows instead.

## Best Practices

- Pin both `--kubernetes-version` and `--container-runtime` in scripts and CI to avoid surprises from future default changes.
- Test the new containerd default in a disposable cluster (`minikube start -p test-containerd`) before rolling the upgrade out to shared dev environments.
- Review the full [v1.39.0 release notes](https://github.com/kubernetes/minikube/releases/tag/v1.39.0) for the complete list of ISO and driver-level changes not covered here.
