---
title: "Monitor NCCL Benchmark Runs Prometheus & Gr..."
description: "Track NCCL benchmark outcomes and GPU telemetry over time with Prometheus and Grafana dashboards to detect communication regressions early."
category: "observability"
difficulty: "intermediate"
timeToComplete: "30 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Prometheus and Grafana available"
  - "NVIDIA DCGM exporter installed"
  - "NCCL test workload logs accessible"
relatedRecipes:
  - "run-nccl-tests-mpijob-kubernetes"
  - "run-nccl-tests-kubernetes"
  - "automate-nccl-preflight-ci"
  - "nccl-allreduce-benchmark-profile"
tags:
  - nccl
  - prometheus
  - grafana
  - observability
  - gpu
publishDate: "2026-02-17"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Combine NCCL benchmark logs with GPU metrics (utilization, memory, interconnect indicators) in Grafana dashboards to detect performance drift across cluster changes.


Benchmark snapshots are useful, but trend-based monitoring catches regressions sooner.

## Data Sources

- NCCL benchmark output logs
- DCGM exporter metrics
- Node and pod metadata labels

## Dashboard Suggestions

- Benchmark run duration by node pair
- Effective bandwidth trend by test profile
- GPU utilization and memory during tests
- Failure count per benchmark type

## Operational Practice

Schedule recurring benchmark jobs and alert when bandwidth drops below baseline thresholds.
