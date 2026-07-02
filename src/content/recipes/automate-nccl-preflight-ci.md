---
title: "Automate NCCL Preflight Checks in CI/CD Pipelines"
description: "Run NCCL smoke benchmarks automatically in CI/CD pipelines before promoting GPU cluster changes to production, catching regressions early."
category: "deployments"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "CI/CD system with cluster access"
  - "GPU test namespace and quotas"
  - "Reusable NCCL test manifests"
relatedRecipes:
  - "kubernetes-readiness-probe-guide"
  - "nccl-allgather-benchmark-profile"
  - "run-nccl-tests-kubernetes"
  - "monitor-nccl-performance-prometheus"
  - "run-nccl-tests-mpijob-kubernetes"
  - "argocd-gitops"
  - "flux-gitops-continuous-delivery"
tags:
  - nccl
  - ci-cd
  - preflight
  - gpu
  - automation
publishDate: "2026-02-17"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Add a CI job that deploys a short NCCL benchmark, parses `algbw` thresholds, and fails pipeline promotion when performance regresses.


NCCL preflight tests reduce risk when changing GPU drivers, networking, or scheduling policies.

## Pipeline Stages

1. Deploy benchmark pod or MPIJob
2. Run short deterministic profile
3. Parse logs and extract key metrics
4. Compare with baseline threshold
5. Mark pass/fail and publish artifacts

## Example Gate

- Pass if median `algbw` >= baseline × 0.9
- Fail on NCCL transport errors or timeouts

Run the benchmark as a Job, then gate the pipeline on the parsed bandwidth:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: nccl-preflight
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: nccl
          image: nvcr.io/nvidia/pytorch:24.05-py3
          command: ["all_reduce_perf", "-b", "8", "-e", "256M", "-f", "2", "-g", "8"]
          resources:
            limits:
              nvidia.com/gpu: 8
```

```bash
# CI step: fail the build if bus bandwidth regresses below the baseline
kubectl logs job/nccl-preflight | tee nccl.log
algbw=$(awk '/Avg bus bandwidth/ {print $(NF)}' nccl.log)
awk -v b="$algbw" 'BEGIN { exit (b+0 >= 90.0) ? 0 : 1 }' \
  || { echo "NCCL regression: ${algbw} GB/s < 90 GB/s baseline"; exit 1; }
```

## Good Practices

- Keep test matrix small and stable
- Version-control benchmark profiles
- Store results as build artifacts for auditing
