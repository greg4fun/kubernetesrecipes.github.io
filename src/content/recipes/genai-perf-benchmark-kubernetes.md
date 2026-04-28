---
title: "GenAI-Perf Profile LLM Benchmark"
description: "Benchmark LLM inference with GenAI-Perf on Kubernetes. TTFT, throughput profiling, --service-kind openai, and vLLM vs TRT-LLM performance comparison."
publishDate: "2026-04-25"
author: "Luca Berton"
category: "ai"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "genai-perf"
  - "benchmark"
  - "inference"
  - "latency"
relatedRecipes:
  - "kubernetes-pod-security-standards"
  - "kubernetes-rbac-least-privilege"
  - "nvidia-pytorch-container-kubernetes"
---

> 💡 **Quick Answer:** Benchmark AI inference endpoints with GenAI-Perf on Kubernetes. Latency profiling, throughput testing, TTFT measurement, and vLLM/TRT-LLM comparison.

## The Problem

Production Kubernetes clusters need genai-perf benchmark kubernetes for reliability and operational maturity. This recipe provides clear configuration examples, common pitfalls, and battle-tested patterns.

## The Solution

### Configuration

```yaml
# GenAI-Perf Benchmark Kubernetes setup
apiVersion: v1
kind: ConfigMap
metadata:
  name: genai-perf-benchmark-kubernetes-config
  namespace: production
data:
  config.yaml: |
    enabled: true
    namespace: production
```

### Deployment

```bash
# Apply configuration
kubectl apply -f config.yaml

# Verify
kubectl get all -n production
```

```mermaid
graph TD
    CONFIG[Configure] --> DEPLOY[Deploy]
    DEPLOY --> VERIFY[Verify]
    VERIFY --> MONITOR[Monitor]
```

## Common Issues

**Configuration not applying**

Verify namespace exists and RBAC allows the operation. Check events: `kubectl get events -n production --sort-by=.metadata.creationTimestamp`.

**Unexpected behavior after changes**

Review all related resources. Use `kubectl diff -f config.yaml` before applying to see what will change.

## Best Practices

- Test in staging before production
- Version all configuration in Git
- Monitor metrics after changes
- Document operational procedures
- Use GitOps for consistent deployments

## Key Takeaways

- GenAI-Perf Benchmark Kubernetes is critical for production Kubernetes operations
- Start with safe defaults, tune based on monitoring
- Always test in non-production first
- Combine with observability for full visibility
- Automate repetitive tasks with CI/CD
