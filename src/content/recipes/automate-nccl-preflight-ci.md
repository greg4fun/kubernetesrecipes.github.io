---
title: "Automate NCCL Preflight Checks in CI/CD Pipelines"
description: "Run NCCL smoke benchmarks automatically before promoting GPU cluster changes to production."
category: "deployments"
difficulty: "advanced"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "CI/CD system with cluster access"
  - "GPU test namespace and quotas"
  - "Reusable NCCL test manifests"
relatedRecipes:
  - "run-nccl-tests-kubernetes"
  - "monitor-nccl-performance-prometheus"
  - "run-nccl-tests-mpijob-kubernetes"
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

## Good Practices

- Keep test matrix small and stable
- Version-control benchmark profiles
- Store results as build artifacts for auditing
