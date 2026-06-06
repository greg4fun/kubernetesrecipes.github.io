---
title: "GPU Sharing with MPS and MIG on Kubernetes"
description: "Share NVIDIA GPUs across multiple pods using MPS time-slicing and MIG hardware partitioning. Maximize GPU utilization for inference workloads."
category: "ai"
difficulty: "advanced"
publishDate: "2026-04-02"
tags: ["gpu-sharing", "mps", "mig", "nvidia", "inference", "kubernetes"]
author: "Luca Berton"
relatedRecipes:
  - "node-feature-discovery-operator"
  - "ai-batch-processing-volcano"
  - "aiperf-benchmark-llm-kubernetes"
  - "aiperf-concurrency-sweep-kubernetes"
---

> 💡 **Quick Answer:** Share NVIDIA GPUs across multiple pods using MPS time-slicing and MIG hardware partitioning. Maximize GPU utilization for inference workloads.

## The Problem

This is a critical skill for managing production Kubernetes clusters at scale. Without it, teams face operational complexity, security risks, and reliability issues.

## The Solution

NVIDIA GPUs can be shared three ways: time-slicing (software, no isolation), MPS (concurrent contexts), and MIG (hardware partitions with memory/compute isolation). Enable time-slicing through the GPU Operator's device-plugin ConfigMap:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: time-slicing-config
  namespace: gpu-operator
data:
  any: |-
    version: v1
    sharing:
      timeSlicing:
        resources:
          - name: nvidia.com/gpu
            replicas: 4   # advertise each physical GPU as 4 schedulable units
```

For hardware isolation, enable a MIG profile on the node and request a slice by its resource name:

```yaml
# Node configured with nvidia.com/mig.config=all-1g.10gb
resources:
  limits:
    nvidia.com/mig-1g.10gb: 1
```

Use MIG for multi-tenant inference where isolation matters; use time-slicing to pack many low-utilization pods onto a single GPU.

## Common Issues

### Troubleshooting
Check logs and events first. Most issues have clear error messages pointing to the root cause.

## Best Practices

- **Follow the principle of least privilege** for all configurations
- **Test in staging** before applying to production
- **Monitor and alert** on key metrics
- **Document your runbooks** for the team

## Key Takeaways

- Essential knowledge for Kubernetes operations at scale
- Start simple and evolve your approach as needed
- Automation reduces human error and operational toil
- Share learnings across your team
