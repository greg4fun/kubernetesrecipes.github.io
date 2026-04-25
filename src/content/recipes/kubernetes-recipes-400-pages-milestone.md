---
title: "400 Recipes Milestone: What We Built & What..."
description: "Kubernetes Recipes reaches 400 articles. Explore new AI/GPU infrastructure, NVIDIA networking, ArgoCD GitOps, OpenShift, and RHACS security recipes."
publishDate: "2026-03-17"
author: "Luca Berton"
category: "configuration"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.28+"
tags:
  - community
  - milestone
  - kubernetes
  - recipes
  - blog
relatedRecipes:
  - "deploy-llama2-70b-kubernetes"
  - "openshift-acs-kubernetes"
  - "argocd-app-of-apps-pattern"
  - "triton-vllm-kubernetes"
  - "model-storage-hostpath-pvc"
  - "multi-tenant-gpu-namespace-isolation"
  - "nncp-static-ip-workers"
  - "doca-driver-openshift-dtk"
---

> 💡 **Quick Answer:** Kubernetes Recipes has reached **400 production-ready articles** covering Kubernetes, OpenShift, NVIDIA GPU infrastructure, AI model serving, and platform engineering. Every recipe includes working YAML, troubleshooting steps, and best practices drawn from real production environments.

## The Problem

Kubernetes documentation is scattered across vendor docs, GitHub issues, blog posts, and Stack Overflow answers. Finding a single, tested, production-ready solution means stitching together fragments from dozens of sources. This is especially true for advanced topics like GPU infrastructure, RDMA networking, and AI model serving.

## The Solution

We've built a single, searchable library of 400 recipes. Here's what's new.

### AI & GPU Infrastructure (50+ recipes)

The fastest-growing section. From deploying a single model to managing multi-tenant GPU clusters:

- **Model Deployment** — [Deploy Llama 2 70B](/recipes/ai/deploy-llama2-70b-kubernetes/), [Phi-4](/recipes/ai/deploy-phi4-kubernetes/), [Whisper](/recipes/ai/deploy-whisper-kubernetes/), [Stable Diffusion XL](/recipes/ai/deploy-stable-diffusion-xl-kubernetes/), and 10+ more models with production-ready manifests
- **Inference Serving** — [Triton + vLLM](/recipes/ai/triton-vllm-kubernetes/), [TensorRT-LLM](/recipes/ai/triton-tensorrt-llm-kubernetes/), [multi-model serving](/recipes/ai/triton-multi-model-serving/), [autoscaling on GPU metrics](/recipes/ai/triton-autoscaling-gpu-metrics/)
- **Model Storage** — [hostPath vs PVC patterns](/recipes/ai/model-storage-hostpath-pvc/) for fast model loading with NVMe caching
- **Benchmarking** — [AIPerf](/recipes/ai/aiperf-benchmark-llm-kubernetes/) and [GenAI-Perf](/recipes/ai/genai-perf-benchmark-llm/) for TTFT, ITL, and throughput measurement
- **Training** — [NeMo training](/recipes/ai/nvidia-nemo-training-kubernetes/), [distributed training with Kubeflow](/recipes/ai/kubeflow-distributed-training/), [MPI Operator](/recipes/ai/mpi-operator-kubernetes/)
- **Multi-Tenant GPU** — [namespace isolation](/recipes/security/multi-tenant-gpu-namespace-isolation/), [ResourceQuotas](/recipes/configuration/resourcequota-limitrange-gpu/), [time-slicing vs MIG](/recipes/ai/timeslicing-mig-full-gpu/), [chargeback monitoring](/recipes/observability/gpu-tenant-monitoring-chargeback/)

### NVIDIA Networking (20+ recipes)

Deep-dive infrastructure recipes for high-performance networking:

- **NNCP** — 10 recipes for [static IPs](/recipes/networking/nncp-static-ip-workers/), [bonds](/recipes/networking/nncp-bond-interfaces-workers/), [VLANs](/recipes/networking/nncp-vlan-tagging-workers/), [Linux bridges](/recipes/networking/nncp-linux-bridge-workers/), [OVS bridges](/recipes/networking/nncp-ovs-bridge-workers/), and [jumbo frames](/recipes/networking/nncp-mtu-jumbo-frames-workers/)
- **SR-IOV** — [VF configuration](/recipes/networking/sriov-nicclusterpolicy-vfs/), [AI workload binding](/recipes/networking/sriov-vf-ai-workloads/), [mixed NIC generations](/recipes/networking/sriov-mixed-nic-gpu-nodes/), [troubleshooting](/recipes/troubleshooting/sriov-vf-troubleshooting/)
- **NFSoRDMA** — [dedicated NIC setup](/recipes/networking/nfsordma-dedicated-nic/), [bonding](/recipes/networking/nfsordma-bond-access-mode/), [PV integration](/recipes/storage/nfsordma-persistent-volume/), [performance tuning](/recipes/networking/nfsordma-troubleshooting-performance/)
- **DOCA/MOFED** — [driver containers on OpenShift](/recipes/configuration/doca-driver-openshift-dtk/), [NIC driver entrypoint deep-dive](/recipes/networking/nvidia-nic-driver-container-entrypoint/)

### ArgoCD GitOps (10 recipes)

Complete ArgoCD coverage from basic setup to multi-cluster fleet management:

- [Sync waves ordering](/recipes/deployments/argocd-sync-waves-ordering/), [App-of-Apps pattern](/recipes/deployments/argocd-app-of-apps-pattern/), [pre/post-sync hooks](/recipes/deployments/argocd-presync-postsync-hooks/), [database migrations](/recipes/deployments/argocd-sync-waves-database-migration/), [canary deployments](/recipes/deployments/argocd-sync-waves-canary/), and [multi-cluster management](/recipes/deployments/argocd-multi-cluster-app-of-apps/)

### OpenShift Platform Engineering (15+ recipes)

- **Image Mirroring** — [IDMS](/recipes/deployments/openshift-idms-install-config/), [ITMS](/recipes/deployments/openshift-itms-image-tag-mirror/), [MCP rollout management](/recipes/deployments/openshift-mcp-itms-rollout/)
- **Security** — [RHACS full install](/recipes/security/openshift-acs-kubernetes/), [custom policies](/recipes/security/rhacs-custom-security-policies/), [network segmentation](/recipes/security/rhacs-network-segmentation/), [compliance scanning](/recipes/security/rhacs-compliance-scanning/), [CI/CD integration](/recipes/security/rhacs-cicd-pipeline-integration/)
- **Node Management** — [RHCOS MachineConfig](/recipes/configuration/rhcos-openshift-node-management/), [custom CA certificates](/recipes/security/custom-ca-openshift/)
- **Registry** — [Quay robot accounts](/recipes/deployments/quay-robot-account-kubernetes/), [default permissions](/recipes/security/quay-default-permissions-robot/), [token rotation](/recipes/security/rotate-quay-robot-tokens/)
- **Serverless** — [KnativeServing with KPA/HPA](/recipes/deployments/openshift-serverless-knativeserving/)

### Core Kubernetes (100+ recipes)

The foundation — battle-tested patterns for every cluster:

- **Troubleshooting** — [CrashLoopBackOff](/recipes/troubleshooting/debug-crashloopbackoff/), [OOMKilled](/recipes/troubleshooting/debug-oom-killed/), [ImagePullBackOff](/recipes/troubleshooting/debug-imagepullbackoff/), [DNS issues](/recipes/troubleshooting/debug-dns-issues/), [scheduling failures](/recipes/troubleshooting/debug-scheduling-failures/)
- **Autoscaling** — [HPA](/recipes/autoscaling/horizontal-pod-autoscaler/), [VPA](/recipes/autoscaling/vertical-pod-autoscaler/), [Cluster Autoscaler](/recipes/autoscaling/cluster-autoscaler/), [KEDA](/recipes/autoscaling/keda-event-driven-autoscaling/)
- **Deployments** — [rolling updates](/recipes/deployments/rolling-update-deployment/), [canary](/recipes/deployments/canary-deployments/), [blue-green](/recipes/deployments/blue-green-deployment/), [probes](/recipes/deployments/liveness-readiness-probes/)
- **Security** — [NetworkPolicies](/recipes/networking/network-policies/), [Pod Security](/recipes/security/pod-security-standards/), [RBAC](/recipes/security/rbac-service-accounts/), [secrets management](/recipes/configuration/configmap-secrets-management/)

## What's Next

- **More AI model recipes** — covering the latest HuggingFace trending models as they release
- **Performance benchmarking** — MLPerf, AIPerf, and GenAI-Perf deep-dives
- **Platform engineering patterns** — multi-cluster GitOps, policy-as-code, developer portals
- **Community contributions** — we welcome PRs at [github.com/greg4fun/kubernetesrecipes.github.io](https://github.com/greg4fun/kubernetesrecipes.github.io)

## About the Book

These online recipes complement the **[Kubernetes Recipes](https://link.springer.com/book/10.1007/979-8-8688-1227-8)** book published by Apress. The book covers core concepts in depth; this site extends it with cutting-edge topics in AI infrastructure, NVIDIA networking, and OpenShift platform engineering.

## Key Takeaways

- 400 recipes covering 10 categories: AI, networking, security, deployments, autoscaling, troubleshooting, configuration, storage, observability, and Helm
- Every recipe includes working YAML, a Quick Answer, common issues, and best practices
- AI/GPU infrastructure is the fastest-growing section with 50+ recipes
- All content is open source and free — contributions welcome
