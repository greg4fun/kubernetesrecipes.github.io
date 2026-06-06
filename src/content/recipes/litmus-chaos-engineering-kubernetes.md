---
title: "LitmusChaos Engineering on Kubernetes"
description: "Deploy LitmusChaos for resilience testing on Kubernetes. Covers ChaosEngine, ChaosExperiment, ChaosResult CRDs, built-in experiments, GameDay planning, Litmus"
tags:
  - "chaos-engineering"
  - "litmus"
  - "resilience"
  - "testing"
  - "cncf"
category: "troubleshooting"
publishDate: "2026-05-09"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "chaos-mesh-fault-injection-kubernetes"
  - "kubernetes-pod-disruption-budget"
  - "kubernetes-readiness-probe-guide"
  - "kubernetes-hpa-custom-metrics-guide"
---

> 💡 **Quick Answer:** LitmusChaos (CNCF incubating) provides chaos engineering with a built-in experiment hub of 50+ pre-built faults. Define a `ChaosEngine` to attach experiments to target workloads, validate with `SteadyState` hypothesis probes, and view results via `ChaosResult`. Great for teams wanting pre-built chaos experiments without writing custom fault logic.

## The Problem

Building chaos experiments from scratch is time-consuming:

- Need to write custom fault injection for every failure mode
- No standardized way to validate system recovers after chaos
- Difficult to share experiments across teams
- No central hub of community-tested chaos scenarios
- GameDay planning lacks tooling support

## The Solution

### Install LitmusChaos

```bash
# Install Litmus 3.x with ChaosCenter
helm repo add litmuschaos https://litmuschaos.github.io/litmus-helm
helm repo update

helm install litmus litmuschaos/litmus \
  --namespace litmus \
  --create-namespace \
  --set portal.frontend.service.type=ClusterIP

# Install chaos experiments from ChaosHub
kubectl apply -f https://hub.litmuschaos.io/api/chaos/3.0.0?file=charts/generic/experiments.yaml \
  -n litmus

# Verify
kubectl get pods -n litmus
kubectl get chaosexperiments -n litmus
```

### ChaosEngine: Run an Experiment

```yaml
# Pod delete experiment with steady-state validation
apiVersion: litmuschaos.io/v1alpha1
kind: ChaosEngine
metadata:
  name: api-pod-delete
  namespace: production
spec:
  appinfo:
    appns: production
    applabel: app=my-api
    appkind: deployment
  chaosServiceAccount: litmus-admin
  experiments:
    - name: pod-delete
      spec:
        components:
          env:
            - name: TOTAL_CHAOS_DURATION
              value: "30"
            - name: CHAOS_INTERVAL
              value: "10"      # Kill a Pod every 10s
            - name: FORCE
              value: "true"    # Force delete (no graceful)
        probe:
          - name: check-api-health
            type: httpProbe
            mode: Continuous
            httpProbe/inputs:
              url: "http://my-api.production.svc:8080/health"
              insecureSkipVerify: false
              method:
                get:
                  criteria: ==
                  responseCode: "200"
            runProperties:
              probeTimeout: 5
              retry: 3
              interval: 5
              probePollingInterval: 2
```

### Built-in Experiments

```text
Category          Experiments
──────────────────────────────────────────────────────────────────
Pod               pod-delete, container-kill, pod-cpu-hog,
                  pod-memory-hog, pod-network-latency,
                  pod-network-loss, pod-io-stress,
                  pod-dns-error, pod-dns-spoof

Node              node-drain, node-taint, kubelet-service-kill,
                  node-cpu-hog, node-memory-hog, node-io-stress,
                  node-restart

Network           pod-network-latency, pod-network-loss,
                  pod-network-corruption, pod-network-duplication,
                  pod-network-partition

DNS               pod-dns-error, pod-dns-spoof

Disk              disk-fill, pod-io-stress, node-io-stress

Application       spring-boot-cpu-stress, spring-boot-memory-stress,
                  spring-boot-latency, spring-boot-exceptions
```

### Probes: Validate SteadyState

```yaml
# Multiple probe types for comprehensive validation
experiments:
  - name: pod-delete
    spec:
      probe:
        # HTTP probe — check endpoint stays healthy
        - name: api-available
          type: httpProbe
          mode: Continuous
          httpProbe/inputs:
            url: "http://my-api.production.svc:8080/health"
            method:
              get:
                criteria: ==
                responseCode: "200"
          runProperties:
            probeTimeout: 5
            interval: 3

        # CMD probe — run command to validate
        - name: check-replicas
          type: cmdProbe
          mode: Edge              # Check at start and end
          cmdProbe/inputs:
            command: "kubectl get deploy my-api -n production -o jsonpath='{.status.availableReplicas}'"
            comparator:
              type: int
              criteria: ">="
              value: "2"          # At least 2 replicas available
          runProperties:
            probeTimeout: 10

        # Prometheus probe — check SLO metrics
        - name: error-rate-slo
          type: promProbe
          mode: Continuous
          promProbe/inputs:
            endpoint: "http://prometheus.monitoring.svc:9090"
            query: "rate(http_requests_total{status=~'5..', app='my-api'}[1m])"
            comparator:
              type: float
              criteria: "<="
              value: "0.01"       # Error rate < 1%
          runProperties:
            probeTimeout: 5
            interval: 10
```

### ChaosResult: Check Outcome

```bash
# View experiment results
kubectl get chaosresult -n production
# NAME                        VERDICT    PHASE
# api-pod-delete-pod-delete   Pass       Completed

kubectl describe chaosresult api-pod-delete-pod-delete -n production
# Spec:
#   Experiment Status:
#     Verdict: Pass
#     Phase: Completed
#     Fail Step: ""
#   Probe Status:
#     api-available: Passed ✅
#     check-replicas: Passed ✅
#     error-rate-slo: Passed ✅
```

### Litmus vs Chaos Mesh

```text
Feature              LitmusChaos          Chaos Mesh
──────────────────────────────────────────────────────────────────
CNCF status          Incubating           Incubating
Pre-built faults     50+ (ChaosHub)       10+ (built-in)
CRD approach         ChaosEngine          Direct fault CRDs
Validation           Probes (HTTP/CMD/    Manual / webhook
                     Prom/K8s)
Dashboard            ChaosCenter          Chaos Dashboard
Scheduling           CronChaosEngine      Scheduler in spec
Workflow             Argo Workflows       Built-in Workflow
Best for             Teams wanting        Teams wanting
                     pre-built +          fine-grained
                     validation           fault control
GameDay support      Built-in             Manual
```

## Common Issues

### ChaosEngine stuck in "Initialized"
- **Cause**: ChaosExperiment not installed in namespace
- **Fix**: Apply experiments YAML to target namespace

### Probes always fail
- **Cause**: Service DNS not resolvable from chaos runner Pod
- **Fix**: Use full service FQDN; check networkpolicy allows probe traffic

### Experiment runs but no chaos observed
- **Cause**: RBAC — chaosServiceAccount lacks permissions
- **Fix**: Verify ServiceAccount has delete/patch permissions on target resources

## Best Practices

1. **Use probes for every experiment** — chaos without validation is just breaking things
2. **Start with pod-delete** — simplest experiment, validates basic resilience
3. **ChaosHub for pre-built experiments** — don't reinvent the wheel
4. **GameDay schedule** — monthly chaos sessions with the team watching dashboards
5. **Label-based selectors** — never target Pods by name (ephemeral)
6. **Run in staging first** — validate experiment behavior before production

## Key Takeaways

- LitmusChaos provides 50+ pre-built experiments via ChaosHub
- ChaosEngine attaches experiments to workloads with validation probes
- Probes validate steady-state: HTTP, CMD, Prometheus, K8s resource checks
- ChaosResult shows Pass/Fail verdict with probe details
- Better than Chaos Mesh for teams wanting pre-built + validation
- RBAC via chaosServiceAccount controls what experiments can target
- GameDay support built into ChaosCenter dashboard
