---
title: "Kubernetes Audit Logging Configuration"
description: "Configure Kubernetes audit logging: audit policy levels and rules, kube-apiserver flags, webhook backend, OpenShift audit profiles, and jq queries."
tags:
  - "audit-logging"
  - "security"
  - "compliance"
  - "api-server"
  - "monitoring"
  - "audit"
  - "logging"
  - "cka"
category: "security"
publishDate: "2026-06-01"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kubernetes-audit-logging-compliance"
  - "kubernetes-rbac-role-clusterrole"
  - "secrets-management-best-practices"
  - "falco-runtime-security"
  - "kubernetes-pod-security-admission"
  - "kubernetes-efk-stack-centralized-logging"
---

> 💡 **Quick Answer:** Kubernetes audit logging records all API requests (who, what, when, result). Configure an audit policy YAML defining which events to log at which level (None/Metadata/Request/RequestResponse), then pass `--audit-policy-file` and `--audit-log-path` to kube-apiserver. For production, use webhook backend to send events to a log aggregator.
>
> **Gotcha:** Rules are first-match. Logging `secrets` at `Request`/`RequestResponse` writes secret values into the audit log — keep secrets (and tokenreviews) at `Metadata`.

## The Problem

- No visibility into who changed what in the cluster
- Can't detect unauthorized access or privilege escalation attempts
- Compliance requirements (SOC 2, HIPAA, PCI-DSS) mandate audit trails
- Need to investigate security incidents after the fact
- Secret access should be logged but not expose secret values

## The Solution

### Audit Policy

```yaml
# /etc/kubernetes/audit-policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # Don't log requests to health endpoints
  - level: None
    nonResourceURLs:
      - "/healthz*"
      - "/readyz*"
      - "/livez*"
      - "/metrics"

  # Don't log watch requests (too noisy)
  - level: None
    verbs: ["watch", "list"]
    resources:
      - group: ""
        resources: ["events"]

  # Log secret access at Metadata level (don't log values!)
  - level: Metadata
    resources:
      - group: ""
        resources: ["secrets", "configmaps"]

  # Log authentication/authorization at RequestResponse
  - level: RequestResponse
    resources:
      - group: "rbac.authorization.k8s.io"
        resources: ["clusterroles", "clusterrolebindings", "roles", "rolebindings"]

  # Log pod exec/attach at RequestResponse (command capture)
  - level: RequestResponse
    resources:
      - group: ""
        resources: ["pods/exec", "pods/attach", "pods/portforward"]

  # Log all write operations at Request level
  - level: Request
    verbs: ["create", "update", "patch", "delete"]
    resources:
      - group: ""
      - group: "apps"
      - group: "batch"
      - group: "networking.k8s.io"

  # Default: Metadata for everything else
  - level: Metadata
    omitStages:
      - "RequestReceived"
```

### Audit Levels

| Level | Records | Use for |
|-------|---------|---------|
| `None` | Nothing | Health checks, metrics, noisy reads |
| `Metadata` | User, verb, resource, source IP, status, timestamps | Default; **secrets**, configmaps, tokenreviews |
| `Request` | Metadata + request body | Writes on important resources |
| `RequestResponse` | Metadata + request + response body | RBAC changes, exec/attach (never secrets) |

Stages: `RequestReceived`, `ResponseStarted` (long-running only, e.g. watch/exec), `ResponseComplete`, `Panic`. Omitting `RequestReceived` halves event volume with little loss.

### Enable Audit Logging (kube-apiserver)

```yaml
# /etc/kubernetes/manifests/kube-apiserver.yaml (static pod, kubeadm)
spec:
  containers:
    - name: kube-apiserver
      command:
        - kube-apiserver
        - --audit-policy-file=/etc/kubernetes/audit-policy.yaml
        - --audit-log-path=/var/log/kubernetes/audit.log
        - --audit-log-maxage=30          # Days to keep
        - --audit-log-maxbackup=10       # Files to retain
        - --audit-log-maxsize=100        # MB per file
      volumeMounts:
        - name: audit-policy
          mountPath: /etc/kubernetes/audit-policy.yaml
          readOnly: true
        - name: audit-logs
          mountPath: /var/log/kubernetes
  volumes:
    - name: audit-policy
      hostPath:
        path: /etc/kubernetes/audit-policy.yaml
        type: File
    - name: audit-logs
      hostPath:
        path: /var/log/kubernetes
        type: DirectoryOrCreate
```

The kubelet restarts the API server when the manifest changes. Repeat on every control-plane node — each writes its own log.

### OpenShift: Audit Profiles

OpenShift manages the policy for you; pick a profile on the cluster `APIServer` resource instead of editing flags:

```bash
oc patch apiserver cluster --type=merge -p '{"spec":{"audit":{"profile":"WriteRequestBodies"}}}'
# Default | WriteRequestBodies | AllRequestBodies | None
# Per-group overrides: spec.audit.customRules[{group: system:authenticated:oauth, profile: WriteRequestBodies}]

oc adm node-logs --role=master --path=kube-apiserver/        # list files
oc adm node-logs --role=master --path=kube-apiserver/audit.log | jq 'select(.verb=="delete")'
```

OpenShift never logs Secret, Route or OAuthClient bodies, even with `AllRequestBodies`. Ship them off-cluster with the Logging operator's `ClusterLogForwarder` (`inputRefs: [audit]`).

### Webhook Backend (Production)

```yaml
# /etc/kubernetes/audit-webhook.yaml
apiVersion: v1
kind: Config
clusters:
  - name: audit-webhook
    cluster:
      server: "https://audit-collector.monitoring:8443/audit"
      certificate-authority: /etc/kubernetes/pki/ca.crt
contexts:
  - name: default
    context:
      cluster: audit-webhook
current-context: default
```

```bash
# Add to kube-apiserver:
--audit-webhook-config-file=/etc/kubernetes/audit-webhook.yaml
--audit-webhook-batch-max-size=100
--audit-webhook-batch-max-wait=5s
```

### Audit Event Structure

```json
{
  "apiVersion": "audit.k8s.io/v1",
  "kind": "Event",
  "level": "RequestResponse",
  "auditID": "a1b2c3d4-5678-90ab-cdef-123456789012",
  "stage": "ResponseComplete",
  "requestURI": "/api/v1/namespaces/production/secrets/db-creds",
  "verb": "get",
  "user": {
    "username": "alice@example.com",
    "groups": ["developers", "system:authenticated"]
  },
  "sourceIPs": ["10.0.1.50"],
  "objectRef": {
    "resource": "secrets",
    "namespace": "production",
    "name": "db-creds",
    "apiVersion": "v1"
  },
  "responseStatus": {
    "code": 200
  },
  "requestReceivedTimestamp": "2026-06-01T14:30:00.000000Z",
  "stageTimestamp": "2026-06-01T14:30:00.005000Z"
}
```

### Query Audit Logs

```bash
# Find who deleted a deployment
cat /var/log/kubernetes/audit.log | \
  jq 'select(.verb == "delete" and .objectRef.resource == "deployments")'

# Find all secret access by user
cat /var/log/kubernetes/audit.log | \
  jq 'select(.objectRef.resource == "secrets" and .user.username == "alice@example.com")'

# Find failed auth attempts
cat /var/log/kubernetes/audit.log | \
  jq 'select(.responseStatus.code >= 403)'

# Find kubectl exec sessions
cat /var/log/kubernetes/audit.log | \
  jq 'select(.objectRef.subresource == "exec")'
```

### Aggregate Analysis

Single-event greps find one thing; aggregation surfaces patterns:

```bash
# Most active users / verbs - a sudden spike is worth investigating
jq -r '.user.username' audit.log | sort | uniq -c | sort -rn | head
jq -r '.verb' audit.log | sort | uniq -c | sort -rn

# Repeated 401s from one source - brute force / credential stuffing
jq -r 'select(.responseStatus.code == 401) | .sourceIPs[0]' audit.log | sort | uniq -c | sort -rn

# Off-hours activity (adjust the hour prefix)
jq 'select(.stageTimestamp | startswith("2026-06-01T03"))' audit.log
```

### Falco Integration (Real-Time Alerts)

Falco's `k8saudit` plugin consumes audit events (point an audit webhook backend at Falco's `/k8s-audit` endpoint) and evaluates rules on them in real time:

```yaml
# Falco rule to alert on secret access
- rule: Secret Accessed by Unauthorized User
  desc: Alert when secrets are accessed by users outside allowed list
  condition: >
    ka.verb in (get, list) and
    ka.target.resource = "secrets" and
    not ka.user.name in (system:serviceaccount:kube-system:default, admin@example.com)
  output: >
    Secret accessed (user=%ka.user.name secret=%ka.target.name
    namespace=%ka.target.namespace verb=%ka.verb sourceIP=%ka.sourceips)
  priority: WARNING
```

## Common Issues

### Audit logs consuming too much disk
- **Cause**: Policy too verbose (logging everything at RequestResponse)
- **Fix**: Use `Metadata` level for most; `RequestResponse` only for critical paths; set maxsize/maxbackup

### Performance impact from audit logging
- **Cause**: Webhook backend slow; or too many events
- **Fix**: Use batch mode (`--audit-webhook-batch-*`); filter noisy events with `level: None`

### kube-apiserver won't start after adding audit flags
- **Cause**: Policy YAML error, or the file/directory isn't mounted into the static pod
- **Fix**: `crictl ps -a | grep kube-apiserver` then `crictl logs <id>`; validate the policy and check `hostPath` + `volumeMounts`

### Missing events in audit log
- **Cause**: Policy rules order matters — first match wins
- **Fix**: Put specific `None` rules first (health checks), then more verbose rules for important resources

### Can't enable audit logging on managed K8s (EKS/GKE/AKS)
- **Cause**: No direct access to kube-apiserver config
- **Fix**: Use cloud-native audit: EKS CloudTrail, GKE Cloud Audit Logs, AKS Diagnostic Settings

## Best Practices

1. **Never log Secret values** — use `Metadata` level for secrets (logs access, not content)
2. **Filter health checks** — `level: None` for `/healthz`, `/readyz`, watch on events
3. **Log all destructive operations** — create/update/patch/delete at Request level
4. **Webhook for production** — don't rely on local file (node failure = lost logs)
5. **Set retention limits** — `maxage`, `maxbackup`, `maxsize` prevent disk exhaustion
6. **Alert on anomalies** — Falco or SIEM rules for unusual access patterns
7. **Policy order matters** — first matching rule wins; put exceptions first

## Frequently Asked Questions

### How do I enable audit logging in Kubernetes?

Write an audit `Policy` file and start kube-apiserver with `--audit-policy-file` plus either `--audit-log-path` (file backend) or `--audit-webhook-config-file` (webhook backend). On kubeadm clusters, edit the static pod manifest and mount both paths. Managed services and OpenShift expose it as a platform setting instead.

### What are the Kubernetes audit levels?

`None`, `Metadata`, `Request` and `RequestResponse`, in increasing detail. `Metadata` records who did what to which object and the result; `Request` adds the request body; `RequestResponse` adds the response body too.

### Where are Kubernetes audit logs stored?

Wherever `--audit-log-path` points on each control-plane node (commonly `/var/log/kubernetes/audit.log`), or in your collector when using the webhook backend. On OpenShift they're under `/var/log/kube-apiserver/` on control-plane nodes; on EKS/GKE/AKS they go to CloudWatch, Cloud Audit Logs or Azure Monitor.

### Do audit logs slow down the API server?

Some overhead is unavoidable; it scales with event volume and level. Drop noisy events with `level: None`, omit the `RequestReceived` stage, avoid `RequestResponse` on high-volume resources, and use batched webhook mode.

## Key Takeaways

- Audit logging captures all API requests: who, what, when, from where, result
- Four levels: `None` (skip), `Metadata` (who/what/when), `Request` (+body), `RequestResponse` (+response)
- Policy rules: first match wins — order matters
- File backend for dev; webhook backend for production (batch mode)
- Never log secret values — `Metadata` level logs access without exposing content
- Managed K8s: use cloud audit (CloudTrail, Cloud Audit Logs, Diagnostic Settings)
- Combine with Falco for real-time security alerting on suspicious patterns
