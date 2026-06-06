---
title: "Poolside AI Foundation Models on Kubernetes"
description: "Deploy Poolside AI foundation models for enterprise software agents on Kubernetes. On-prem and VPC deployment, multi-agent orchestration, sandboxed"
tags:
  - "poolside"
  - "foundation-models"
  - "agents"
  - "enterprise-ai"
  - "on-prem"
  - "air-gap"
category: "ai"
publishDate: "2026-05-22"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "vllm-openai-container-kubernetes"
  - "nim-multinode-deployment-helm-kubernetes"
  - "red-hat-ai-studio-openshift-model-development"
  - "kubernetes-network-policy-guide"
---

> 💡 **Quick Answer:** Poolside AI builds foundation models optimized for long-horizon software engineering tasks — code generation, multi-agent orchestration, and tool use in sandboxed environments. Deploy on-prem or in your VPC on Kubernetes with strict data boundaries, RBAC for both humans and agents, and air-gap support for defense/regulated use cases.

## The Problem

- General-purpose LLMs lack deep software engineering capabilities (planning, tool use, multi-step execution)
- Enterprise code never leaves the security boundary — cloud-only AI is a non-starter
- Multi-agent systems need orchestration, policy governance, and end-to-end tracing
- Air-gapped and multi-cloud environments require flexible deployment without cloud dependencies
- Need measurable outcomes (code quality, velocity) not just token generation

## The Solution

### Poolside Platform Architecture on Kubernetes

```text
┌──────────────────────────────────────────────────────────────────┐
│ Enterprise Kubernetes Cluster (On-Prem / VPC)                     │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Poolside Control Plane                                      │  │
│  │ ┌──────────────┐ ┌───────────────┐ ┌───────────────────┐  │  │
│  │ │ Agent        │ │ Policy Engine │ │ Trace Collector   │  │  │
│  │ │ Orchestrator │ │ (governance)  │ │ (audit trail)     │  │  │
│  │ └──────┬───────┘ └───────┬───────┘ └───────────────────┘  │  │
│  └────────┼─────────────────┼────────────────────────────────┘  │
│           │                  │                                    │
│  ┌────────▼──────────────────▼───────────────────────────────┐  │
│  │ Foundation Model Serving (GPU Nodes)                        │  │
│  │ ┌─────────────┐ ┌─────────────┐ ┌───────────────────────┐│  │
│  │ │ Poolside FM │ │ Code Agent  │ │ Sandboxed Execution   ││  │
│  │ │ (inference) │ │ (planning)  │ │ (tool use, terminal)  ││  │
│  │ │ H100 × 8    │ │             │ │                       ││  │
│  │ └─────────────┘ └─────────────┘ └───────────────────────┘│  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Data & Knowledge Layer                                      │  │
│  │ • Git repositories    • Databases    • Private corpora      │  │
│  │ • Data warehouses     • Documentation • API specs           │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Deploy Poolside Foundation Model

```yaml
# Poolside FM inference deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: poolside-fm
  namespace: poolside-ai
  labels:
    app: poolside-fm
    component: inference
spec:
  replicas: 1
  selector:
    matchLabels:
      app: poolside-fm
  template:
    metadata:
      labels:
        app: poolside-fm
    spec:
      nodeSelector:
        nvidia.com/gpu.product: "NVIDIA-H100-80GB-HBM3"
      tolerations:
        - key: nvidia.com/gpu
          operator: Exists
          effect: NoSchedule
      containers:
        - name: poolside-inference
          image: registry.example.com/poolside/foundation-model:latest
          ports:
            - containerPort: 8080
              name: api
            - containerPort: 9090
              name: metrics
          env:
            - name: MODEL_PATH
              value: "/models/poolside-fm-enterprise"
            - name: TENSOR_PARALLEL_SIZE
              value: "8"
            - name: MAX_CONTEXT_LENGTH
              value: "131072"
            - name: MAX_BATCH_SIZE
              value: "64"
            - name: ENABLE_TOOL_USE
              value: "true"
            - name: SANDBOX_MODE
              value: "strict"
          volumeMounts:
            - name: model-weights
              mountPath: /models
              readOnly: true
            - name: shm
              mountPath: /dev/shm
          resources:
            limits:
              nvidia.com/gpu: "8"
              memory: "640Gi"
            requests:
              cpu: "32"
              memory: "640Gi"
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 120
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 180
            periodSeconds: 30
      volumes:
        - name: model-weights
          persistentVolumeClaim:
            claimName: poolside-model-pvc
        - name: shm
          emptyDir:
            medium: Memory
            sizeLimit: 64Gi
---
apiVersion: v1
kind: Service
metadata:
  name: poolside-fm
  namespace: poolside-ai
spec:
  selector:
    app: poolside-fm
  ports:
    - name: api
      port: 8080
      targetPort: 8080
    - name: metrics
      port: 9090
      targetPort: 9090
```

### Multi-Agent Orchestration

```yaml
# Agent orchestrator — manages multi-agent workflows
apiVersion: apps/v1
kind: Deployment
metadata:
  name: poolside-orchestrator
  namespace: poolside-ai
spec:
  replicas: 2
  selector:
    matchLabels:
      app: poolside-orchestrator
  template:
    metadata:
      labels:
        app: poolside-orchestrator
    spec:
      containers:
        - name: orchestrator
          image: registry.example.com/poolside/orchestrator:latest
          ports:
            - containerPort: 8081
              name: api
          env:
            - name: FM_ENDPOINT
              value: "http://poolside-fm.poolside-ai:8080"
            - name: POLICY_ENGINE_ENDPOINT
              value: "http://poolside-policy.poolside-ai:8082"
            - name: TRACE_ENDPOINT
              value: "http://poolside-traces.poolside-ai:4317"
            - name: MAX_AGENT_CONCURRENCY
              value: "20"
            - name: EXECUTION_TIMEOUT_SECONDS
              value: "300"
            - name: SANDBOX_RUNTIME
              value: "kubernetes"          # Spawn sandboxed pods for tool use
          volumeMounts:
            - name: agent-config
              mountPath: /etc/poolside/agents
      volumes:
        - name: agent-config
          configMap:
            name: poolside-agent-policies
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: poolside-agent-policies
  namespace: poolside-ai
data:
  policies.yaml: |
    agents:
      code-writer:
        description: "Generates and modifies source code"
        tools:
          - file_read
          - file_write
          - git_operations
          - terminal_execute
        sandboxed: true
        max_execution_time: 120s
        resource_limits:
          cpu: "2"
          memory: "4Gi"
        allowed_paths:
          - "/workspace/**"
        blocked_commands:
          - "rm -rf /"
          - "curl * | bash"

      code-reviewer:
        description: "Reviews code changes for quality and security"
        tools:
          - file_read
          - git_diff
          - linter_run
          - security_scan
        sandboxed: true
        read_only: true

      planner:
        description: "Decomposes tasks into subtasks for other agents"
        tools:
          - task_create
          - agent_delegate
          - progress_track
        sandboxed: false
        max_delegations: 10

    governance:
      require_approval_for:
        - git_push
        - deploy_to_production
        - database_write
      audit_all_actions: true
      trace_retention_days: 90
```

### Sandboxed Execution Environment

```yaml
# Poolside spawns ephemeral pods for agent tool execution
apiVersion: v1
kind: ResourceQuota
metadata:
  name: poolside-sandbox-quota
  namespace: poolside-sandboxes
spec:
  hard:
    pods: "50"
    requests.cpu: "100"
    requests.memory: "200Gi"
    limits.cpu: "200"
    limits.memory: "400Gi"
---
# NetworkPolicy: sandboxes can't reach production services
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: sandbox-isolation
  namespace: poolside-sandboxes
spec:
  podSelector: {}                    # All pods in namespace
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              app: poolside-orchestrator
  egress:
    # Allow DNS
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
    # Allow access to internal git only
    - to:
        - namespaceSelector:
            matchLabels:
              app: gitea
      ports:
        - protocol: TCP
          port: 3000
    # Block all other egress (no internet from sandboxes)
---
# PodSecurityStandard for sandboxes
apiVersion: v1
kind: Namespace
metadata:
  name: poolside-sandboxes
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

### Data & Knowledge Connectors

```yaml
# Connect Poolside to internal repositories and data sources
apiVersion: v1
kind: ConfigMap
metadata:
  name: poolside-data-connectors
  namespace: poolside-ai
data:
  connectors.yaml: |
    sources:
      - name: internal-git
        type: git
        endpoint: "https://gitea.internal.example.com"
        auth:
          secretRef: git-credentials
        sync_interval: 5m
        repositories:
          - "org/backend-services"
          - "org/frontend-apps"
          - "org/infrastructure"

      - name: documentation
        type: confluence
        endpoint: "https://wiki.example.com"
        auth:
          secretRef: confluence-token
        spaces:
          - "ARCH"      # Architecture decisions
          - "RUNBOOKS"  # Operations runbooks
          - "API"       # API documentation

      - name: database-schema
        type: postgresql
        endpoint: "postgres.data.svc:5432"
        auth:
          secretRef: db-readonly-creds
        schema_only: true           # Only schema, no data
        databases:
          - "orders"
          - "inventory"

      - name: api-specs
        type: openapi
        sources:
          - "https://api.example.com/v1/openapi.json"
          - "https://payments.example.com/spec.yaml"

    boundaries:
      # Data never leaves these namespaces
      allowed_namespaces:
        - poolside-ai
        - poolside-sandboxes
      # PII detection and masking
      pii_detection: enabled
      mask_patterns:
        - "\\b\\d{3}-\\d{2}-\\d{4}\\b"     # SSN
        - "\\b[A-Z]{2}\\d{2}[A-Z0-9]{18}\\b"  # IBAN
```

### Developer Surface Integration

```yaml
# Expose Poolside API for IDE extensions and CLI tools
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: poolside-developer-api
  namespace: poolside-ai
  annotations:
    nginx.ingress.kubernetes.io/auth-type: basic
    nginx.ingress.kubernetes.io/auth-secret: poolside-api-auth
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
spec:
  tls:
    - hosts:
        - poolside.internal.example.com
      secretName: poolside-tls
  rules:
    - host: poolside.internal.example.com
      http:
        paths:
          - path: /v1/
            pathType: Prefix
            backend:
              service:
                name: poolside-orchestrator
                port:
                  number: 8081
```

```bash
# Developer CLI usage
poolside ask "Refactor the payment service to use event sourcing"
# Agent plans → writes code → runs tests → creates PR

# IDE extension (VS Code / JetBrains)
# Connects to: poolside.internal.example.com/v1/
# Features: inline completion, chat, multi-file edit, terminal agent

# TUI for terminal-first developers
poolside tui
# Interactive terminal interface with agent delegation
```

### Air-Gapped Deployment

```bash
# For disconnected/air-gapped environments:

# 1. Mirror images to internal registry
skopeo copy \
  docker://registry.poolside.ai/poolside/foundation-model:latest \
  docker://registry.airgap.example.com/poolside/foundation-model:latest

# 2. Transfer model weights via removable media
# Download on connected machine:
poolside-cli model download --model enterprise-fm --output /media/transfer/

# Copy to air-gapped cluster:
kubectl cp /media/transfer/enterprise-fm poolside-ai/model-loader:/models/

# 3. No external network dependencies
# - All inference runs locally
# - Knowledge connectors point to internal services only
# - No telemetry sent externally
# - License validated via offline key
```

### Monitoring and Governance

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: poolside-metrics
  namespace: poolside-ai
spec:
  selector:
    matchLabels:
      app: poolside-fm
  endpoints:
    - port: metrics
      interval: 15s
---
# Key metrics to monitor:
# poolside_inference_requests_total        — total API calls
# poolside_tokens_generated_total          — output tokens
# poolside_agent_tasks_completed_total     — successful agent executions
# poolside_agent_tasks_failed_total        — failed executions
# poolside_sandbox_pods_active             — concurrent sandboxed executions
# poolside_policy_violations_total         — governance policy blocks
# poolside_tool_executions_total           — tool calls by type
# poolside_e2e_task_duration_seconds       — end-to-end task completion time
```

## Common Issues

### Agent sandbox pod pending (no resources)
- **Cause**: ResourceQuota exhausted or insufficient node capacity
- **Fix**: Increase quota; or add node autoscaling for sandbox namespace

### Slow model loading (>5 min startup)
- **Cause**: Large model weights loading from networked storage (NFS)
- **Fix**: Use local NVMe PVs for model storage; or pre-load with init container

### Policy engine blocking legitimate actions
- **Cause**: Governance rules too restrictive for the use case
- **Fix**: Review `policies.yaml`; add specific allow rules; check trace logs for blocked action details

### Knowledge connector stale data
- **Cause**: Sync interval too long or webhook not configured
- **Fix**: Reduce `sync_interval`; configure git webhooks for push-based updates

## Best Practices

1. **Deploy model weights on local NVMe** — network storage adds 2-5 min to cold starts
2. **Strict NetworkPolicies on sandboxes** — agents executing code should never reach production
3. **RBAC for agents AND humans** — Poolside supports role-based access for both
4. **Audit everything** — enable full trace collection; 90-day retention for compliance
5. **Start with read-only agents** — code reviewer before code writer builds trust
6. **PII detection enabled** — prevent models from memorizing sensitive data from connectors
7. **Resource quotas on sandbox namespace** — prevent runaway agent spawning

## Key Takeaways

- Poolside AI: foundation models purpose-built for software engineering (code gen, planning, tool use)
- Deploy on-prem/VPC on Kubernetes — data never leaves your boundary
- Multi-agent orchestration with policy governance and end-to-end tracing
- Sandboxed execution: agents run tools in isolated pods with NetworkPolicies
- Knowledge layer connects to git, databases, wikis, API specs within strict boundaries
- Developer surfaces: IDE extensions, TUI, CLI — intelligence where work happens
- Air-gap ready: offline model loading, no external dependencies, offline licensing
- Enterprise governance: audit trails, policy violations, role-based access for humans and agents
