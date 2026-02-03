---
title: "How to Configure Kubernetes Audit Logging"
description: "Enable and configure Kubernetes API audit logging. Track who did what, when, and to which resources for security compliance and troubleshooting."
category: "security"
difficulty: "advanced"
publishDate: "2026-01-22"
tags: ["audit", "logging", "security", "compliance", "api-server"]
---

> 💡 **Quick Answer:** Configure API server with `--audit-policy-file` (defines what to log) and `--audit-log-path` (where to write). Policy uses `rules` with `level` (None, Metadata, Request, RequestResponse) and `resources` filters. Send to SIEM via `--audit-webhook-config-file` for centralized analysis.
>
> **Key config:** Start with Metadata level for all resources, RequestResponse for secrets/RBAC changes.
>
> **Gotcha:** RequestResponse level on high-traffic resources generates massive logs—use selective rules and log rotation.

# How to Configure Kubernetes Audit Logging

Kubernetes audit logs record API server requests, providing a security-relevant chronological record of actions taken in the cluster. Essential for compliance, security monitoring, and troubleshooting.

## Audit Log Concepts

```bash
# Audit logs capture:
# - Who made the request (user/service account)
# - What action was performed (verb)
# - Which resource was affected
# - When it happened
# - Request/response details

# Audit stages:
# RequestReceived - Request received, before processing
# ResponseStarted - Response headers sent (long-running only)
# ResponseComplete - Response body sent
# Panic - Panic occurred during request handling
```

## Audit Policy Levels

```yaml
# Four audit levels:
# None - Don't log events matching this rule
# Metadata - Log request metadata only
# Request - Log metadata and request body
# RequestResponse - Log metadata, request, and response bodies
```

## Basic Audit Policy

```yaml
# audit-policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # Don't log requests to certain non-resource URL paths
  - level: None
    nonResourceURLs:
      - /healthz*
      - /version
      - /readyz
      - /livez

  # Don't log watch requests
  - level: None
    verbs: ["watch"]

  # Don't log events from system components
  - level: None
    users:
      - system:kube-scheduler
      - system:kube-proxy
      - system:apiserver
    verbs: ["get", "list"]

  # Log secrets at Metadata level only (don't log contents)
  - level: Metadata
    resources:
      - group: ""
        resources: ["secrets", "configmaps"]

  # Log token requests at Metadata level
  - level: Metadata
    resources:
      - group: ""
        resources: ["serviceaccounts/token"]

  # Log pod exec/attach at RequestResponse level
  - level: RequestResponse
    resources:
      - group: ""
        resources: ["pods/exec", "pods/attach", "pods/portforward"]

  # Log all other core resources at Request level
  - level: Request
    resources:
      - group: ""
        resources: ["pods", "services", "deployments", "namespaces"]

  # Log everything else at Metadata level
  - level: Metadata
    omitStages:
      - RequestReceived
```

## Comprehensive Audit Policy

```yaml
# comprehensive-audit-policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # Don't log read-only endpoints
  - level: None
    nonResourceURLs:
      - /healthz*
      - /version
      - /swagger*
      - /openapi*
      - /readyz*
      - /livez*

  # Don't log kube-system service account reads
  - level: None
    users: ["system:serviceaccount:kube-system:*"]
    verbs: ["get", "list", "watch"]

  # Don't log node and pod status updates
  - level: None
    resources:
      - group: ""
        resources: ["nodes/status", "pods/status"]
    verbs: ["update", "patch"]

  # Don't log events
  - level: None
    resources:
      - group: ""
        resources: ["events"]

  # Log authentication events
  - level: RequestResponse
    resources:
      - group: "authentication.k8s.io"
        resources: ["tokenreviews"]

  # Log authorization events
  - level: RequestResponse
    resources:
      - group: "authorization.k8s.io"
        resources: ["subjectaccessreviews", "selfsubjectaccessreviews"]

  # Secrets - metadata only (NEVER log contents)
  - level: Metadata
    resources:
      - group: ""
        resources: ["secrets"]

  # RBAC changes - full request/response
  - level: RequestResponse
    resources:
      - group: "rbac.authorization.k8s.io"
        resources: ["clusterroles", "clusterrolebindings", "roles", "rolebindings"]

  # Resource deletion - full request
  - level: Request
    verbs: ["delete", "deletecollection"]
    resources:
      - group: ""
      - group: "apps"
      - group: "batch"

  # Pod exec/attach/port-forward - full logging
  - level: RequestResponse
    resources:
      - group: ""
        resources: ["pods/exec", "pods/attach", "pods/portforward"]

  # Write operations to core resources
  - level: Request
    verbs: ["create", "update", "patch"]
    resources:
      - group: ""
        resources: ["pods", "services", "deployments", "configmaps"]
      - group: "apps"
        resources: ["deployments", "statefulsets", "daemonsets"]

  # Default: log metadata for everything else
  - level: Metadata
    omitStages:
      - RequestReceived
```

## Enable Audit Logging on API Server

```yaml
# kube-apiserver configuration
# Add these flags to API server manifest

apiVersion: v1
kind: Pod
metadata:
  name: kube-apiserver
  namespace: kube-system
spec:
  containers:
    - name: kube-apiserver
      command:
        - kube-apiserver
        - --audit-policy-file=/etc/kubernetes/audit/policy.yaml
        - --audit-log-path=/var/log/kubernetes/audit/audit.log
        - --audit-log-maxage=30
        - --audit-log-maxbackup=10
        - --audit-log-maxsize=100
      volumeMounts:
        - name: audit-policy
          mountPath: /etc/kubernetes/audit
          readOnly: true
        - name: audit-log
          mountPath: /var/log/kubernetes/audit
  volumes:
    - name: audit-policy
      hostPath:
        path: /etc/kubernetes/audit
        type: DirectoryOrCreate
    - name: audit-log
      hostPath:
        path: /var/log/kubernetes/audit
        type: DirectoryOrCreate
```

## Audit Log Backends

### File Backend

```bash
# API server flags for file backend
--audit-policy-file=/etc/kubernetes/audit-policy.yaml
--audit-log-path=/var/log/audit.log
--audit-log-maxage=30        # Days to retain
--audit-log-maxbackup=10     # Number of log files
--audit-log-maxsize=100      # MB per file
--audit-log-format=json      # or 'legacy'
```

### Webhook Backend

```yaml
# webhook-config.yaml
apiVersion: v1
kind: Config
clusters:
  - name: audit-webhook
    cluster:
      server: https://audit-receiver.logging.svc:8443/audit
      certificate-authority: /etc/kubernetes/pki/audit-ca.crt
contexts:
  - name: default
    context:
      cluster: audit-webhook
current-context: default
```

```bash
# API server flags for webhook
--audit-policy-file=/etc/kubernetes/audit-policy.yaml
--audit-webhook-config-file=/etc/kubernetes/audit-webhook.yaml
--audit-webhook-batch-max-size=100
--audit-webhook-batch-max-wait=5s
```

## Audit Log Format

```json
{
  "kind": "Event",
  "apiVersion": "audit.k8s.io/v1",
  "level": "Request",
  "auditID": "abc-123-def",
  "stage": "ResponseComplete",
  "requestURI": "/api/v1/namespaces/default/pods",
  "verb": "create",
  "user": {
    "username": "admin@example.com",
    "groups": ["system:authenticated", "developers"]
  },
  "sourceIPs": ["10.0.0.50"],
  "userAgent": "kubectl/v1.28.0",
  "objectRef": {
    "resource": "pods",
    "namespace": "default",
    "name": "nginx-pod",
    "apiVersion": "v1"
  },
  "responseStatus": {
    "metadata": {},
    "code": 201
  },
  "requestReceivedTimestamp": "2024-01-20T10:30:00.000000Z",
  "stageTimestamp": "2024-01-20T10:30:00.123456Z"
}
```

## Query Audit Logs

```bash
# Search for specific user actions
grep '"username":"admin@example.com"' /var/log/kubernetes/audit/audit.log | jq .

# Find all delete operations
grep '"verb":"delete"' /var/log/kubernetes/audit/audit.log | jq .

# Find secret access
grep '"resource":"secrets"' /var/log/kubernetes/audit/audit.log | jq .

# Find pod exec sessions
grep 'pods/exec' /var/log/kubernetes/audit/audit.log | jq .

# Filter by namespace
cat /var/log/kubernetes/audit/audit.log | \
  jq 'select(.objectRef.namespace=="production")'

# Failed requests
cat /var/log/kubernetes/audit/audit.log | \
  jq 'select(.responseStatus.code >= 400)'
```

## Audit Log Analysis

```bash
# Count events by user
cat audit.log | jq -r '.user.username' | sort | uniq -c | sort -rn

# Count events by verb
cat audit.log | jq -r '.verb' | sort | uniq -c | sort -rn

# Count events by resource
cat audit.log | jq -r '.objectRef.resource' | sort | uniq -c | sort -rn

# Find suspicious patterns
# Many failed auth attempts
cat audit.log | jq 'select(.responseStatus.code == 401)' | \
  jq -r '.sourceIPs[0]' | sort | uniq -c | sort -rn

# Unusual time access
cat audit.log | jq 'select(.stageTimestamp | startswith("2024-01-20T03"))' 
```

## Falco for Runtime Audit

```yaml
# falco-rules.yaml
# Detect suspicious activities in real-time
- rule: Detect kubectl exec
  desc: Detect kubectl exec commands
  condition: >
    spawned_process and 
    container and 
    proc.name in (kubectl) and 
    proc.cmdline contains "exec"
  output: "kubectl exec detected (user=%user.name command=%proc.cmdline)"
  priority: WARNING

- rule: Secret Access
  desc: Detect secret access
  condition: >
    ka.verb in (get,list) and 
    ka.target.resource = secrets
  output: "Secret accessed (user=%ka.user.name secret=%ka.target.name)"
  priority: INFO
```

## Send Audit Logs to SIEM

```yaml
# fluent-bit for audit logs
apiVersion: v1
kind: ConfigMap
metadata:
  name: fluent-bit-audit
data:
  fluent-bit.conf: |
    [INPUT]
        Name tail
        Path /var/log/kubernetes/audit/audit.log
        Parser json
        Tag kube-audit
        Refresh_Interval 5

    [OUTPUT]
        Name splunk
        Match kube-audit
        Host splunk.example.com
        Port 8088
        TLS On
        TLS.Verify On
        Splunk_Token ${SPLUNK_TOKEN}
        Splunk_Source kubernetes-audit
        Splunk_Sourcetype _json
```

## Compliance-Focused Policy

```yaml
# compliance-audit-policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # Full logging for compliance-sensitive actions
  
  # Privileged pod creation
  - level: RequestResponse
    resources:
      - group: ""
        resources: ["pods"]
    verbs: ["create"]
  
  # All RBAC changes
  - level: RequestResponse
    resources:
      - group: "rbac.authorization.k8s.io"
  
  # All namespace changes
  - level: RequestResponse
    resources:
      - group: ""
        resources: ["namespaces"]
    verbs: ["create", "update", "patch", "delete"]
  
  # Service account token creation
  - level: RequestResponse
    resources:
      - group: ""
        resources: ["serviceaccounts/token"]
  
  # Network policy changes
  - level: RequestResponse
    resources:
      - group: "networking.k8s.io"
        resources: ["networkpolicies"]
  
  # Metadata for reads
  - level: Metadata
    verbs: ["get", "list", "watch"]
```

## Summary

Kubernetes audit logging tracks all API server requests for security and compliance. Configure an audit policy to control what gets logged at which level. Use the file backend for simple setups and webhook backend for real-time streaming to SIEM systems. Never log secret contents—use Metadata level for secrets. Regularly analyze logs for suspicious patterns and integrate with alerting for security events.

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
