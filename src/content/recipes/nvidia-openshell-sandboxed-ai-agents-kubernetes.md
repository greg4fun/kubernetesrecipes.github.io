---
title: "NVIDIA OpenShell Sandboxed AI Agent Runtime on Kubernetes"
description: "Deploy NVIDIA OpenShell on Kubernetes for safe, private autonomous AI agent execution. Declarative YAML network policies, sandboxed containers"
tags:
  - "nvidia"
  - "openshell"
  - "agents"
  - "sandbox"
  - "security"
  - "developer-tools"
category: "ai"
publishDate: "2026-05-22"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "poolside-ai-foundation-models-kubernetes"
  - "kubernetes-network-policy-guide"
  - "pod-security-standards"
  - "tabnine-enterprise-self-hosted-kubernetes"
---

> 💡 **Quick Answer:** NVIDIA OpenShell is a safe, private runtime for autonomous AI agents. It provides sandboxed execution environments governed by declarative YAML policies that prevent unauthorized file access, data exfiltration, and uncontrolled network activity. Deploy on Kubernetes via Helm chart with proxy-enforced HTTP-level access control per sandbox.

## The Problem

- AI coding agents (Claude, Codex, Copilot) need shell access but uncontrolled access is dangerous
- Agents can exfiltrate data, access credentials, or make unauthorized network calls
- Standard container isolation isn't granular enough — need HTTP method + path level control
- No visibility into what agents are doing inside their execution environment
- Need a way to give agents tools (git, python, node) without giving them everything

## The Solution

### OpenShell Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ Host / Kubernetes Cluster                                     │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ OpenShell Gateway                                      │   │
│  │ ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │   │
│  │ │ Policy      │  │ HTTP Proxy   │  │ Audit Log    │  │   │
│  │ │ Engine      │  │ (L7 filter)  │  │              │  │   │
│  │ └─────────────┘  └──────┬───────┘  └──────────────┘  │   │
│  └──────────────────────────┼────────────────────────────┘   │
│                              │                                │
│  ┌──────────────────────────▼────────────────────────────┐   │
│  │ Sandbox Container (per agent session)                  │   │
│  │                                                        │   │
│  │  Agent: claude / opencode / codex / copilot            │   │
│  │  Tools: python 3.14, node 22, git, gh, vim            │   │
│  │  Network: ALL traffic goes through gateway proxy       │   │
│  │                                                        │   │
│  │  ┌──────────────────────────────────────────────────┐ │   │
│  │  │ curl api.github.com → Proxy → Policy Check       │ │   │
│  │  │   ✅ Allowed by policy → Forward                  │ │   │
│  │  │   ❌ Not in policy → HTTP 403                     │ │   │
│  │  └──────────────────────────────────────────────────┘ │   │
│  └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### Deploy on Kubernetes (Helm)

```bash
# Install OpenShell gateway via Helm (experimental)
helm install openshell oci://ghcr.io/nvidia/openshell/helm-chart

# Or with custom values
helm install openshell oci://ghcr.io/nvidia/openshell/helm-chart \
  --namespace openshell \
  --create-namespace \
  --set gateway.replicas=2 \
  --set sandbox.runtime=containerd \
  --set sandbox.resourceDefaults.cpu=2 \
  --set sandbox.resourceDefaults.memory=4Gi
```

```yaml
# values.yaml for Kubernetes deployment
gateway:
  replicas: 2
  resources:
    requests:
      cpu: "500m"
      memory: "512Mi"
    limits:
      cpu: "2"
      memory: "2Gi"

sandbox:
  runtime: containerd              # or docker, podman, microvm
  image: ghcr.io/nvidia/openshell-community/base:latest
  resourceDefaults:
    cpu: "2"
    memory: "4Gi"
  maxConcurrent: 20                # Max simultaneous sandboxes
  timeoutMinutes: 60               # Auto-terminate idle sandboxes

proxy:
  # Default: deny all outbound
  defaultPolicy: deny
  auditLog:
    enabled: true
    retention: 30d

# OpenShift-specific
openshift:
  enabled: false                   # Set true for OpenShift
  securityContextConstraints: true
```

### OpenShift Deployment

```bash
# For OpenShift clusters
helm install openshell oci://ghcr.io/nvidia/openshell/helm-chart \
  --namespace openshell \
  --create-namespace \
  --set openshift.enabled=true \
  --set openshift.securityContextConstraints=true
```

```yaml
# OpenShift SCC for sandbox pods
apiVersion: security.openshift.io/v1
kind: SecurityContextConstraints
metadata:
  name: openshell-sandbox
allowPrivilegedContainer: false
allowHostNetwork: false
allowHostPID: false
allowHostPorts: false
runAsUser:
  type: MustRunAsNonRoot
seLinuxContext:
  type: MustRunAs
fsGroup:
  type: RunAsAny
volumes:
  - emptyDir
  - projected
  - secret
  - configMap
users:
  - system:serviceaccount:openshell:openshell-sandbox
```

### Network Policies (Declarative YAML)

```yaml
# Policy: allow GitHub API read access
# File: policies/github-readonly.yaml
apiVersion: openshell.nvidia.com/v1alpha1
kind: SandboxPolicy
metadata:
  name: github-readonly
spec:
  network:
    outbound:
      - host: "api.github.com"
        methods: [GET]
        paths:
          - "/repos/**"
          - "/users/**"
          - "/orgs/**"
        # Blocked: POST, PUT, DELETE (no pushing, no creating)

      - host: "github.com"
        methods: [GET]
        paths:
          - "/**"
        # Read-only clone access

  filesystem:
    writable:
      - "/workspace/**"
      - "/tmp/**"
    readonly:
      - "/etc/**"
    blocked:
      - "/etc/shadow"
      - "/root/.ssh/**"
      - "**/.env"
      - "**/credentials*"
```

```yaml
# Policy: full development access (trusted internal agent)
apiVersion: openshell.nvidia.com/v1alpha1
kind: SandboxPolicy
metadata:
  name: full-dev
spec:
  network:
    outbound:
      - host: "api.github.com"
        methods: [GET, POST, PUT, PATCH]
        paths: ["/**"]

      - host: "registry.npmjs.org"
        methods: [GET]

      - host: "pypi.org"
        methods: [GET]

      - host: "*.internal.example.com"
        methods: [GET, POST]
        paths: ["/**"]

  filesystem:
    writable:
      - "/workspace/**"
      - "/tmp/**"
      - "/home/agent/**"
    blocked:
      - "/etc/shadow"
      - "/root/**"

  execution:
    allowed_commands:
      - "git *"
      - "python *"
      - "node *"
      - "npm *"
      - "pip *"
    blocked_commands:
      - "rm -rf /"
      - "curl * | bash"
      - "wget * | sh"
```

### Using OpenShell with AI Agents

```bash
# Create a sandbox with Claude agent
openshell sandbox create -- claude

# Create with specific policy
openshell sandbox create --policy github-readonly -- opencode

# Create with Codex (OpenAI)
openshell sandbox create -- codex

# Create with GitHub Copilot
openshell sandbox create -- copilot

# List active sandboxes
openshell sandbox list
# ID          AGENT     POLICY          STATUS    AGE
# sb-a1b2c3   claude    github-readonly  running   5m
# sb-d4e5f6   codex     full-dev         running   12m

# View sandbox audit log
openshell sandbox logs sb-a1b2c3
# [10:31:02] GET api.github.com/repos/org/app/contents/src ✅
# [10:31:05] POST api.github.com/repos/org/app/pulls ❌ BLOCKED (readonly policy)
# [10:31:08] GET pypi.org/simple/requests ❌ BLOCKED (not in policy)

# Apply policy at runtime (no restart needed)
openshell policy apply --sandbox sb-a1b2c3 --policy full-dev
# Policy updated — sandbox now has full-dev access
```

### Kubernetes-Native Sandbox Pods

```yaml
# What OpenShell creates behind the scenes on K8s
apiVersion: v1
kind: Pod
metadata:
  name: openshell-sandbox-a1b2c3
  namespace: openshell
  labels:
    app: openshell-sandbox
    sandbox-id: a1b2c3
    agent: claude
    policy: github-readonly
  annotations:
    openshell.nvidia.com/policy: "github-readonly"
    openshell.nvidia.com/created-by: "user@example.com"
spec:
  serviceAccountName: openshell-sandbox
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    fsGroup: 1000
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: sandbox
      image: ghcr.io/nvidia/openshell-community/base:latest
      # Includes: python 3.14, node 22, git, gh, vim, nano
      # Agents: claude, opencode, codex, copilot
      env:
        - name: HTTP_PROXY
          value: "http://openshell-gateway.openshell:8080"
        - name: HTTPS_PROXY
          value: "http://openshell-gateway.openshell:8080"
        - name: NO_PROXY
          value: "localhost,127.0.0.1"
        - name: OPENSHELL_SANDBOX_ID
          value: "a1b2c3"
      resources:
        requests:
          cpu: "2"
          memory: "4Gi"
        limits:
          cpu: "4"
          memory: "8Gi"
      volumeMounts:
        - name: workspace
          mountPath: /workspace
  volumes:
    - name: workspace
      emptyDir:
        sizeLimit: 10Gi
  # Auto-terminate after timeout
  activeDeadlineSeconds: 3600
```

### Monitoring and Audit

```promql
# Active sandboxes
openshell_sandboxes_active

# Policy violations (blocked requests)
rate(openshell_policy_violations_total[5m])

# Agent actions per minute
rate(openshell_agent_actions_total[1m])

# Network requests by destination
topk(10, sum by (host) (rate(openshell_proxy_requests_total[5m])))

# Sandbox resource usage
openshell_sandbox_cpu_usage_cores
openshell_sandbox_memory_usage_bytes
```

## Common Issues

### Agent can't access needed API
- **Cause**: Policy doesn't include the host/path
- **Fix**: `openshell policy apply` with updated YAML — no sandbox restart needed

### Sandbox OOMKilled
- **Cause**: Agent spawning too many processes or loading large dependencies
- **Fix**: Increase memory limit in sandbox resource defaults; or constrain agent behavior

### Proxy latency adding >100ms to API calls
- **Cause**: Policy evaluation overhead on complex rule sets
- **Fix**: Simplify policies (fewer regex patterns); or increase gateway replicas

### Agent trying to read /root/.ssh
- **Cause**: Git clone attempting SSH auth
- **Fix**: Policy blocks sensitive paths by default — configure HTTPS-based git access instead

## Best Practices

1. **Start with deny-all** — add access incrementally as needed
2. **Read-only policies first** — prove agent works before granting write access
3. **Audit everything** — review sandbox logs before promoting to wider access
4. **Time-limit sandboxes** — `activeDeadlineSeconds` prevents abandoned sandboxes
5. **Separate policies per risk level** — `readonly`, `dev`, `deploy` tiers
6. **Use on Kubernetes for multi-tenant** — Helm chart + namespace isolation per team
7. **Hot-reload policies** — no restart needed; apply at runtime as trust builds

## Key Takeaways

- OpenShell = sandboxed runtime for AI agents (Claude, Codex, Copilot, OpenCode)
- All network traffic routed through policy-enforcing HTTP proxy
- Declarative YAML policies: host + method + path level granularity
- Kubernetes deployment via Helm (experimental); OpenShift supported
- Sandbox includes Python 3.14, Node 22, git, gh, vim + agent CLI
- Policies apply at runtime without restart — build trust incrementally
- Key principle: agents get tools without getting everything
- Alpha software — single-player now, multi-tenant enterprise coming
