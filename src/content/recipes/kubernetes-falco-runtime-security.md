---
title: "Falco: K8s Runtime Threat Detection"
description: "Deploy Falco for Kubernetes runtime security monitoring. Detect suspicious container behavior, privilege escalation, file access."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "security"
difficulty: "advanced"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "falco"
  - "runtime-security"
  - "security"
  - "threat-detection"
  - "monitoring"
relatedRecipes:
  - "kubernetes-pod-security-admission"
  - "kubernetes-security-context-guide"
  - "kubernetes-networkpolicy-guide"
  - "kubernetes-kyverno-policy-guide"
---

> 💡 **Quick Answer:** Falco monitors Linux system calls in real-time to detect threats: shell spawned in container, sensitive file read, privilege escalation, unexpected network connections. Install: `helm install falco falcosecurity/falco -n falco --create-namespace --set driver.kind=modern_ebpf`. Rules are YAML conditions on syscall events. Alerts go to stdout, Slack, PagerDuty, or any webhook.

## The Problem

Admission controllers only validate at create time — they can't detect:

- Attacker exec-ing into a running container
- Container reading /etc/shadow or /etc/passwd
- Unexpected outbound network connections (C2 callbacks)
- Privilege escalation attempts at runtime
- Crypto mining processes spawning
- File modifications in read-only containers

## The Solution

### Install Falco

```bash
# Helm install (modern eBPF driver — recommended)
helm repo add falcosecurity https://falcosecurity.github.io/charts
helm install falco falcosecurity/falco \
  -n falco --create-namespace \
  --set driver.kind=modern_ebpf \
  --set falcosidekick.enabled=true \
  --set falcosidekick.config.slack.webhookurl=https://hooks.slack.com/xxx

# Verify
kubectl get pods -n falco
# falco-xxxxx              Running  (DaemonSet — one per node)
# falco-falcosidekick-xxx  Running  (alert routing)

# Check Falco is detecting events
kubectl logs -n falco -l app.kubernetes.io/name=falco --tail=20
```

### Default Rules (What Falco Detects Out-of-Box)

```yaml
# These are built-in — no configuration needed:

# Shell spawned in container
# "A shell was spawned in a container"
# Triggers when: bash, sh, zsh started in any container

# Sensitive file access
# "Sensitive file opened for reading"
# Triggers when: /etc/shadow, /etc/passwd, private keys read

# Privilege escalation
# "Container running as privileged"
# "Setuid or setgid bit set"

# Network anomalies
# "Unexpected outbound connection"
# "Connection to unexpected port"

# Process anomalies
# "Unexpected process spawned"
# "Package management in container" (apt, yum, pip)

# File integrity
# "Write below /etc"
# "Write to binary directories"
# "Modify shell configuration files"
```

### Custom Rules

```yaml
# custom-rules.yaml (mount as ConfigMap or in Helm values)
- rule: Detect kubectl exec
  desc: Detect any kubectl exec into a pod
  condition: >
    spawned_process
    and container
    and proc.pname = runc:[2:INIT]
    and proc.name in (bash, sh, zsh)
  output: >
    Shell spawned in container
    (user=%user.name pod=%k8s.pod.name ns=%k8s.ns.name
     container=%container.name image=%container.image.repository
     command=%proc.cmdline)
  priority: WARNING
  tags: [container, shell, mitre_execution]

---
- rule: Crypto mining detected
  desc: Detect crypto mining processes
  condition: >
    spawned_process
    and container
    and (proc.name in (xmrig, minerd, cpuminer, minergate)
         or proc.cmdline contains "stratum+tcp"
         or proc.cmdline contains "mining.pool")
  output: >
    Crypto mining detected in container
    (pod=%k8s.pod.name ns=%k8s.ns.name
     process=%proc.name command=%proc.cmdline)
  priority: CRITICAL
  tags: [container, crypto, mitre_resource_hijacking]

---
- rule: Sensitive mount detected
  desc: Container mounting sensitive host paths
  condition: >
    container
    and container.mounts contains "/var/run/docker.sock"
    or container.mounts contains "/var/run/crio/crio.sock"
    or container.mounts contains "/run/containerd/containerd.sock"
  output: >
    Container with sensitive mount
    (pod=%k8s.pod.name image=%container.image.repository
     mounts=%container.mounts)
  priority: WARNING

---
- rule: Database credential file access
  desc: Access to database credential files
  condition: >
    open_read
    and container
    and (fd.name contains ".pgpass"
         or fd.name contains ".my.cnf"
         or fd.name contains "credentials.json")
  output: >
    Database credential file accessed
    (pod=%k8s.pod.name file=%fd.name process=%proc.name)
  priority: CRITICAL
```

### Falcosidekick (Alert Routing)

```yaml
# Helm values for alert destinations
falcosidekick:
  config:
    slack:
      webhookurl: "https://hooks.slack.com/services/xxx"
      channel: "#security-alerts"
      minimumpriority: "warning"
    
    pagerduty:
      apikey: "xxx"
      minimumpriority: "critical"
    
    elasticsearch:
      hostport: "http://elasticsearch:9200"
      index: "falco"
    
    prometheus:
      extralabels: "source:falco"
    
    webhook:
      address: "http://incident-handler:8080/falco"
      minimumpriority: "error"

# Falcosidekick supports 50+ outputs:
# Slack, Teams, PagerDuty, OpsGenie, Elasticsearch,
# Prometheus, Loki, S3, CloudWatch, Datadog, etc.
```

### Falco + Prometheus Metrics

```promql
# Alert count by rule
sum(rate(falco_events_total[5m])) by (rule)

# Critical alerts
falco_events_total{priority="Critical"}

# Alerts by namespace
sum(rate(falco_events_total[1h])) by (k8s_ns_name)
```

### Response Automation

```yaml
# Falcosidekick can trigger Kubernetes actions:
# Kill the offending pod when critical alert fires

# Using Falcosidekick + Kubeless/OpenFaaS:
# 1. Falco detects shell in container → alert
# 2. Falcosidekick sends to function
# 3. Function kills the pod

# Example: Kubernetes Response Engine
# https://github.com/falcosecurity/falco-talon

# Falco Talon — automated response
# Delete pod on critical rule match
# Network isolate namespace
# Cordon affected node
```

### Verify Falco is Working

```bash
# Trigger a test alert (shell in container)
kubectl run test --image=alpine --rm -it --restart=Never -- sh
# Falco should log: "A shell was spawned in a container"

# Read sensitive file
kubectl run test --image=alpine --rm -it --restart=Never -- cat /etc/shadow
# Falco should log: "Sensitive file opened for reading"

# Check Falco logs
kubectl logs -n falco -l app.kubernetes.io/name=falco --tail=10 | grep -i warning
```

## Common Issues

**Falco pod CrashLoopBackOff**

Kernel headers not available for driver. Use `driver.kind=modern_ebpf` (no headers needed) instead of kernel module.

**Too many alerts (noisy)**

Override rules with exceptions. Use `append` to add exceptions to default rules, or set `minimumpriority` on outputs.

**Performance impact**

eBPF driver is lightweight (~1-2% CPU overhead). Kernel module driver can be heavier. Monitor Falco's own resource usage.

## Best Practices

- **Use modern_ebpf driver** — no kernel headers needed, best performance
- **Start with default rules** — they cover common threats
- **Tune false positives** — add exceptions for known-good behavior
- **Route critical alerts to PagerDuty** — low priority to Slack
- **Combine with NetworkPolicy** — Falco detects, NetworkPolicy prevents

## Key Takeaways

- Falco monitors Linux syscalls in real-time for threat detection
- Detects: shell access, file reads, privilege escalation, crypto mining, network anomalies
- Rules are YAML conditions on syscall events with severity levels
- Falcosidekick routes alerts to 50+ destinations (Slack, PagerDuty, etc.)
- Complements admission-time security (PSA, Kyverno) with runtime security
