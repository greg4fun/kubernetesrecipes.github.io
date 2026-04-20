---
title: "Continuous Profiling with Pyroscope"
description: "Deploy Pyroscope on Kubernetes for continuous CPU and memory profiling. Identify performance bottlenecks in production without overhead."
publishDate: "2026-04-20"
author: "Luca Berton"
category: "observability"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - profiling
  - pyroscope
  - performance
  - observability
  - grafana
relatedRecipes:
  - "prometheus-monitoring-setup"
  - "grafana-kubernetes-dashboards"
  - "kubernetes-golden-signals-sli-slo"
---

> 💡 **Quick Answer:** Deploy Pyroscope (now part of Grafana) via Helm with `helm install pyroscope grafana/pyroscope`. Instrument apps with the Pyroscope SDK or use eBPF-based auto-instrumentation for zero-code profiling. View flame graphs in Grafana to identify hot functions consuming CPU or memory.

## The Problem

Your application is slow in production but fine in development. Traditional APM shows high latency but not which function causes it. You need always-on profiling that doesn't impact production performance.

## The Solution

### Install Pyroscope

```bash
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

helm install pyroscope grafana/pyroscope \
  --namespace observability \
  --create-namespace \
  --set pyroscope.replicaCount=2 \
  --set pyroscope.persistence.enabled=true \
  --set pyroscope.persistence.size=50Gi
```

### eBPF Auto-Discovery (Zero Code Changes)

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: pyroscope-ebpf
  namespace: observability
spec:
  selector:
    matchLabels:
      app: pyroscope-ebpf
  template:
    metadata:
      labels:
        app: pyroscope-ebpf
    spec:
      hostPID: true
      containers:
        - name: agent
          image: grafana/pyroscope:1.7
          args:
            - ebpf
            - connect
            - --server-address=http://pyroscope:4040
          securityContext:
            privileged: true
          volumeMounts:
            - name: sys
              mountPath: /sys
              readOnly: true
      volumes:
        - name: sys
          hostPath:
            path: /sys
```

### SDK Instrumentation (Go Example)

```go
import "github.com/grafana/pyroscope-go"

func main() {
    pyroscope.Start(pyroscope.Config{
        ApplicationName: "my-app",
        ServerAddress:   "http://pyroscope.observability:4040",
        ProfileTypes: []pyroscope.ProfileType{
            pyroscope.ProfileCPU,
            pyroscope.ProfileAllocObjects,
            pyroscope.ProfileAllocSpace,
            pyroscope.ProfileInuseObjects,
            pyroscope.ProfileInuseSpace,
            pyroscope.ProfileGoroutines,
            pyroscope.ProfileMutexCount,
            pyroscope.ProfileMutexDuration,
            pyroscope.ProfileBlockCount,
            pyroscope.ProfileBlockDuration,
        },
        Tags: map[string]string{
            "namespace": os.Getenv("POD_NAMESPACE"),
            "pod":       os.Getenv("POD_NAME"),
        },
    })
    // ... rest of application
}
```

### Grafana Data Source

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-datasources
  namespace: observability
data:
  pyroscope.yaml: |
    apiVersion: 1
    datasources:
      - name: Pyroscope
        type: grafana-pyroscope-datasource
        url: http://pyroscope:4040
        access: proxy
        isDefault: false
```

## Querying Profiles

```bash
# List available applications
curl http://pyroscope:4040/api/apps

# Query CPU profile for last hour
curl "http://pyroscope:4040/render?query=my-app.cpu&from=now-1h&until=now&format=json"
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| No profiles appearing | App not instrumented | Add SDK or deploy eBPF agent |
| High storage usage | All profiles stored indefinitely | Set retention: `--storage.retention=7d` |
| eBPF not working | Kernel too old | Requires Linux 4.9+ (5.x recommended) |
| Missing symbols | Stripped binaries | Build with `-gcflags=-N -l` or keep debug info |

## Best Practices

1. **Start with eBPF** — Zero code changes, works for any language
2. **Use SDK for detailed profiling** — Goroutine, mutex, block profiles need SDK
3. **Set retention policies** — 7-14 days is typical for production
4. **Tag by namespace/pod** — Essential for filtering in multi-tenant clusters
5. **Correlate with traces** — Link Pyroscope profiles to distributed traces via exemplars

## Key Takeaways

- Continuous profiling identifies which functions consume CPU/memory in production
- eBPF-based profiling requires zero code changes but needs privileged access
- SDK instrumentation provides richer profile types (goroutines, mutexes)
- Pyroscope integrates natively with Grafana for flame graph visualization
- Overhead is typically <1% CPU for profiled applications
