---
title: "K8s Audit Logging: Track API Activity"
description: "Configure Kubernetes audit logging to track API requests. Audit policy levels, log backends, webhook integration, and security compliance monitoring."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "security"
difficulty: "advanced"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "audit"
  - "security"
  - "logging"
  - "compliance"
  - "cka"
relatedRecipes:
  - "kubernetes-rbac-role-rolebinding"
  - "kubernetes-pod-security-admission"
  - "kubernetes-serviceaccount-guide"
  - "kubernetes-efk-logging-stack"
---

> 💡 **Quick Answer:** Enable audit logging by adding `--audit-policy-file` and `--audit-log-path` to kube-apiserver flags. The audit policy defines what to log at four levels: `None`, `Metadata`, `Request`, `RequestResponse`. Use `Metadata` for most resources, `RequestResponse` for secrets/RBAC changes. Ship logs to your SIEM via webhook or file-based collection.

## The Problem

Without audit logging:

- No record of who accessed or modified resources
- Security incidents can't be investigated
- Compliance requirements (SOC2, PCI-DSS, HIPAA) can't be met
- No way to detect unauthorized access or privilege escalation
- Insider threats are invisible

## The Solution

### Audit Policy

```yaml
# /etc/kubernetes/audit-policy.yaml
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # Don't log requests to certain non-resource URLs
  - level: None
    nonResourceURLs:
    - /healthz*
    - /readyz*
    - /livez*
    - /metrics

  # Don't log watch requests (too noisy)
  - level: None
    verbs: ["watch", "list"]
    resources:
    - group: ""
      resources: ["events"]

  # Log Secret access with full request/response
  - level: RequestResponse
    resources:
    - group: ""
      resources: ["secrets", "configmaps"]
    - group: "rbac.authorization.k8s.io"
      resources: ["clusterroles", "clusterrolebindings", "roles", "rolebindings"]

  # Log authentication events
  - level: RequestResponse
    resources:
    - group: "authentication.k8s.io"
      resources: ["tokenreviews"]

  # Log pod exec/attach (shell access)
  - level: RequestResponse
    resources:
    - group: ""
      resources: ["pods/exec", "pods/attach", "pods/portforward"]

  # Log node and namespace changes
  - level: RequestResponse
    resources:
    - group: ""
      resources: ["nodes", "namespaces"]
    verbs: ["create", "update", "patch", "delete"]

  # Metadata only for everything else
  - level: Metadata
    omitStages:
    - RequestReceived
```

### Enable Audit Logging

```yaml
# Add to kube-apiserver static pod manifest
# /etc/kubernetes/manifests/kube-apiserver.yaml

spec:
  containers:
  - command:
    - kube-apiserver
    # ... existing flags ...
    - --audit-policy-file=/etc/kubernetes/audit-policy.yaml
    - --audit-log-path=/var/log/kubernetes/audit.log
    - --audit-log-maxage=30          # Keep logs 30 days
    - --audit-log-maxbackup=10       # Keep 10 rotated files
    - --audit-log-maxsize=100        # Rotate at 100MB
    
    volumeMounts:
    - mountPath: /etc/kubernetes/audit-policy.yaml
      name: audit-policy
      readOnly: true
    - mountPath: /var/log/kubernetes
      name: audit-log
  
  volumes:
  - hostPath:
      path: /etc/kubernetes/audit-policy.yaml
      type: File
    name: audit-policy
  - hostPath:
      path: /var/log/kubernetes
      type: DirectoryOrCreate
    name: audit-log
```

### Audit Log Format

```json
{
  "kind": "Event",
  "apiVersion": "audit.k8s.io/v1",
  "level": "RequestResponse",
  "auditID": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "stage": "ResponseComplete",
  "requestURI": "/api/v1/namespaces/production/secrets/db-creds",
  "verb": "get",
  "user": {
    "username": "jane@example.com",
    "groups": ["developers", "system:authenticated"]
  },
  "sourceIPs": ["10.0.0.50"],
  "objectRef": {
    "resource": "secrets",
    "namespace": "production",
    "name": "db-creds",
    "apiVersion": "v1"
  },
  "responseStatus": {
    "code": 200
  },
  "requestReceivedTimestamp": "2026-05-02T20:00:00.000000Z",
  "stageTimestamp": "2026-05-02T20:00:00.005000Z"
}
```

### Webhook Backend

```yaml
# /etc/kubernetes/audit-webhook.yaml
apiVersion: v1
kind: Config
clusters:
- name: audit-webhook
  cluster:
    server: https://audit.example.com/webhook
    certificate-authority: /etc/kubernetes/pki/webhook-ca.crt
contexts:
- name: audit-webhook
  context:
    cluster: audit-webhook
current-context: audit-webhook

# kube-apiserver flags:
# --audit-webhook-config-file=/etc/kubernetes/audit-webhook.yaml
# --audit-webhook-batch-max-size=10
# --audit-webhook-batch-max-wait=5s
```

### Audit Levels

```
None              → Don't log this event
Metadata          → Log request metadata (user, timestamp, resource, verb)
Request           → Log metadata + request body
RequestResponse   → Log metadata + request body + response body

Guidelines:
- None: health checks, metrics, frequent read-only operations
- Metadata: most read operations, standard CRUD
- Request: write operations on important resources
- RequestResponse: secrets, RBAC, exec/attach, authentication
```

### Query Audit Logs

```bash
# Find who accessed secrets
grep '"resource":"secrets"' /var/log/kubernetes/audit.log | \
  jq '{user: .user.username, verb: .verb, name: .objectRef.name, ns: .objectRef.namespace}'

# Find kubectl exec sessions
grep '"pods/exec"' /var/log/kubernetes/audit.log | \
  jq '{user: .user.username, pod: .objectRef.name, ns: .objectRef.namespace, time: .requestReceivedTimestamp}'

# Find failed authentication
grep '"code":401' /var/log/kubernetes/audit.log | \
  jq '{user: .user.username, source: .sourceIPs[0], time: .requestReceivedTimestamp}'

# Find resource deletions
grep '"verb":"delete"' /var/log/kubernetes/audit.log | \
  jq '{user: .user.username, resource: .objectRef.resource, name: .objectRef.name}'
```

## Common Issues

**kube-apiserver won't start after adding audit flags**

Policy file syntax error or file not mounted. Check: `crictl logs <apiserver-container>`. Validate YAML syntax.

**Audit logs too large**

Policy is too verbose. Use `None` for high-frequency reads, `Metadata` as default, `RequestResponse` only for sensitive resources.

**Missing events in audit log**

Rules are evaluated top-to-bottom, first match wins. Ensure your `None` rules don't accidentally match before specific rules.

## Best Practices

- **Start with Metadata level** — upgrade specific resources to Request/RequestResponse
- **Always audit secrets, RBAC, and exec** at RequestResponse level
- **Exclude health checks and watches** — prevents log explosion
- **Ship to external SIEM** — audit logs on the node are vulnerable to tampering
- **Set retention and rotation** — logs grow fast in busy clusters
- **Alert on suspicious patterns** — failed auth, secret access, exec into production pods

## Key Takeaways

- Audit logging records all API server requests for security and compliance
- Four levels: None, Metadata, Request, RequestResponse (ascending detail)
- Policy rules are first-match — order matters
- Always audit: secrets, RBAC changes, pod exec/attach, authentication
- Ship logs to external SIEM for tamper-proof storage and alerting
