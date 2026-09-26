---
title: "LitmusChaos: Chaos Engineering on Kubernetes"
description: "Run LitmusChaos experiments on Kubernetes: install ChaosCenter, pod-delete ChaosEngine, HTTP/cmd/Prometheus probes, ChaosResult verdicts vs Chaos Mesh."
tags:
  - "chaos-engineering"
  - "litmus"
  - "resilience"
  - "testing"
  - "cncf"
  - "chaos-testing"
category: "troubleshooting"
publishDate: "2026-05-09"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "chaos-mesh-fault-injection-kubernetes"
  - "kubernetes-pod-disruption-budget"
  - "kubernetes-readiness-probe-guide"
  - "kubernetes-hpa-custom-metrics-guide"
  - "kubernetes-rbac-least-privilege"
---

> 💡 **Quick Answer:** LitmusChaos (CNCF incubating) ships 50+ pre-built faults (pod-delete, network latency, CPU/memory hog, disk fill, node drain) via ChaosHub. Install the fault definition (`ChaosExperiment`), give it a ServiceAccount, then create a `ChaosEngine` that targets workloads by label and validates steady state with probes (HTTP, cmd, Prometheus, k8s). Read the verdict from `kubectl get chaosresult`. ChaosCenter (the Litmus 3.x UI) adds scheduling, GameDays and multi-cluster chaos infrastructure.
>
> **Gotcha:** Litmus 3.x probe `runProperties` take duration strings (`probeTimeout: 5s`); 2.x-style integers are rejected.

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

# Verify ChaosCenter (frontend, server, auth, MongoDB)
kubectl get pods -n litmus
kubectl port-forward -n litmus svc/litmus-frontend-service 9091:9091   # admin / litmus, change it
```

ChaosCenter connects to target clusters through a **chaos infrastructure** agent that you deploy from the UI. To run faults directly with CRDs (no UI), install the chaos operator and the individual fault into the target namespace:

```bash
# Fault definition (ChaosExperiment) from the chaos-charts repo — pin the branch to your Litmus version
kubectl apply -n production -f \
  https://raw.githubusercontent.com/litmuschaos/chaos-charts/master/faults/kubernetes/pod-delete/fault.yaml
kubectl get chaosexperiments -n production

# Least-privilege ServiceAccount for the experiment
kubectl apply -n production -f \
  https://raw.githubusercontent.com/litmuschaos/chaos-charts/master/faults/kubernetes/pod-delete/rbac.yaml
```

The rbac manifest creates a ServiceAccount (`pod-delete-sa`); reference it as `chaosServiceAccount`.

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
  engineState: active
  chaosServiceAccount: pod-delete-sa
  jobCleanUpPolicy: delete
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
              probeTimeout: 5s
              retry: 3
              interval: 5s
              probePollingInterval: 2s
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
            probeTimeout: 5s
            interval: 3s

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
            probeTimeout: 10s
            interval: 5s

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
            probeTimeout: 5s
            interval: 10s
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
Validation           Probes (HTTP/CMD/    StatusCheck in
                     Prom/K8s)            Workflows
Dashboard            ChaosCenter          Chaos Dashboard
Scheduling           ChaosCenter cron     Schedule CRD
Workflow             Argo-based chaos     Built-in Workflow
                     experiments
Best for             Teams wanting        Teams wanting
                     pre-built +          fine-grained
                     validation           fault control
GameDay support      Built-in             Manual
```

## Common Issues

### ChaosEngine stuck in "Initialized"
- **Cause**: ChaosExperiment not installed in the ChaosEngine's namespace, or the chaos operator isn't running
- **Fix**: `kubectl get chaosexperiments -n <ns>`; apply the fault YAML there; check operator logs

### `runProperties` validation error after upgrading to 3.x
- **Cause**: integer timeouts from Litmus 2.x examples
- **Fix**: use duration strings — `probeTimeout: 5s`, `interval: 2s`

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

## Frequently Asked Questions

### What is LitmusChaos?

An open-source, CNCF incubating chaos engineering platform for Kubernetes. It provides a chaos operator and CRDs (`ChaosExperiment`, `ChaosEngine`, `ChaosResult`), a hub of ready-made faults, probes to verify steady state, and ChaosCenter for scheduling, GameDays and reporting.

### Is it safe to run Litmus in production?

Yes, with guardrails: start in staging, target by label (never all pods), keep `TOTAL_CHAOS_DURATION` short, run with a least-privilege ServiceAccount, make sure PodDisruptionBudgets and alerting are in place, and use probes so a failing steady state aborts and flags the run.

### LitmusChaos vs Chaos Mesh?

Litmus leans on pre-built faults plus probe-based validation and a GameDay UI; Chaos Mesh exposes one CRD per fault type (PodChaos, NetworkChaos, IOChaos, TimeChaos) with fine-grained kernel-level injection. See [Chaos Mesh fault injection](/recipes/troubleshooting/chaos-mesh-fault-injection-kubernetes/).

### What happens when a probe fails?

The `ChaosResult` verdict becomes `Fail` and records which probe failed; in ChaosCenter the experiment run is marked failed and the resilience score drops. Chaos is still reverted at the end of the duration.
