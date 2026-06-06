---
title: "Tabnine AI Code Assistant Self-Hosted on Kubernetes"
description: "Deploy Tabnine Enterprise self-hosted on Kubernetes for private AI code completion and chat. On-prem model serving, multi-model support (Tabnine"
tags:
  - "tabnine"
  - "code-assistant"
  - "enterprise-ai"
  - "self-hosted"
  - "on-prem"
  - "developer-tools"
category: "ai"
publishDate: "2026-05-22"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "poolside-ai-foundation-models-kubernetes"
  - "vllm-openai-container-kubernetes"
  - "red-hat-ai-studio-openshift-model-development"
  - "kubernetes-network-policy-guide"
---

> 💡 **Quick Answer:** Tabnine Enterprise can be self-hosted on Kubernetes for private AI code completion. It supports both Tabnine's proprietary protected models (trained on permissive-license code only) and third-party models (Claude, GPT, Gemini, Llama). Deploy the inference server on GPU nodes, connect IDE extensions to your internal endpoint, and maintain zero data retention.

## The Problem

- Developers need AI code assistance but code can't leave the security boundary
- Cloud-hosted AI assistants send proprietary source code to external APIs
- Compliance requires auditability of which AI models touched which code
- Teams want model choice (Claude for reasoning, GPT for speed, Tabnine Protected for IP safety)
- Need centralized management: model selection, usage policies, license compliance

## The Solution

### Tabnine Model Options (2026)

```text
Tabnine Supported Models:
──────────────────────────────────────────────────────────────────
Provider        Model                   Thinking    CLI Support
──────────────────────────────────────────────────────────────────
Tabnine         Tabnine Protected       —           ✔️
Anthropic       Claude 4.6 Sonnet       ✔️          ✔️
Anthropic       Claude 4.6 Opus         ✔️          ✔️
Anthropic       Claude 4.5 Sonnet       ✔️          ✔️
Anthropic       Claude 4.5 Opus         ✔️          ✔️
Anthropic       Claude 4.5 Haiku        ✔️          ✔️
Anthropic       Claude 4 Sonnet         ✔️          ✔️
OpenAI          GPT-5.4                 —           ✔️
OpenAI          GPT-5.3 Codex           —           ✔️
OpenAI          GPT-5.2 Codex           —           ✔️
OpenAI          GPT-5.2                 —           ✔️
OpenAI          GPT-5                   —           ✔️
Google          Gemini 2.5 Pro          ✔️          ✔️
Google          Gemini 2.5 Flash        ✔️          ✔️
Meta            Llama 4 Maverick        —           ✔️
Meta            Llama 4 Scout           —           ✔️
Qwen            Qwen 3                  ✔️          ✔️
Mistral         Mistral Large           —           ✔️
──────────────────────────────────────────────────────────────────

Deprecated (post v6.2.0): Tabnine-protected legacy, Gemma 3−, Qwen 2.5−

Tabnine Protected: trained exclusively on permissive-license code
                   (MIT, Apache-2.0, BSD) — IP indemnification
```

### Self-Hosted Deployment on Kubernetes

```yaml
# Tabnine Enterprise Server
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tabnine-server
  namespace: tabnine
  labels:
    app: tabnine-server
spec:
  replicas: 2
  selector:
    matchLabels:
      app: tabnine-server
  template:
    metadata:
      labels:
        app: tabnine-server
    spec:
      nodeSelector:
        nvidia.com/gpu.present: "true"
      containers:
        - name: tabnine
          image: registry.example.com/tabnine/enterprise-server:6.2.0
          ports:
            - containerPort: 8080
              name: api
            - containerPort: 9090
              name: metrics
          env:
            - name: TABNINE_LICENSE_KEY
              valueFrom:
                secretKeyRef:
                  name: tabnine-license
                  key: license-key
            - name: TABNINE_MODEL_PATH
              value: "/models"
            - name: TABNINE_DATA_RETENTION
              value: "none"                  # Zero data retention
            - name: TABNINE_TELEMETRY
              value: "disabled"              # No external telemetry
            - name: TABNINE_ALLOWED_MODELS
              value: "tabnine-protected,claude-4.6-sonnet,gpt-5.3-codex"
            - name: TABNINE_MAX_CONTEXT_TOKENS
              value: "32768"
            - name: TABNINE_COMPLETION_TIMEOUT_MS
              value: "2000"
            # Third-party model routing (self-hosted or API key)
            - name: ANTHROPIC_API_KEY
              valueFrom:
                secretKeyRef:
                  name: tabnine-model-keys
                  key: anthropic-key
            - name: OPENAI_API_KEY
              valueFrom:
                secretKeyRef:
                  name: tabnine-model-keys
                  key: openai-key
          volumeMounts:
            - name: models
              mountPath: /models
            - name: cache
              mountPath: /var/cache/tabnine
          resources:
            limits:
              nvidia.com/gpu: "2"
              memory: "32Gi"
            requests:
              cpu: "8"
              memory: "32Gi"
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 30
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 60
      volumes:
        - name: models
          persistentVolumeClaim:
            claimName: tabnine-models-pvc
        - name: cache
          emptyDir:
            sizeLimit: 10Gi
---
apiVersion: v1
kind: Service
metadata:
  name: tabnine-server
  namespace: tabnine
spec:
  selector:
    app: tabnine-server
  ports:
    - name: api
      port: 443
      targetPort: 8080
    - name: metrics
      port: 9090
      targetPort: 9090
---
# Internal ingress (not exposed externally)
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tabnine-internal
  namespace: tabnine
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "30"
    nginx.ingress.kubernetes.io/limit-rps: "50"
spec:
  ingressClassName: nginx-internal
  tls:
    - hosts:
        - tabnine.internal.example.com
      secretName: tabnine-tls
  rules:
    - host: tabnine.internal.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: tabnine-server
                port:
                  number: 443
```

### Admin Configuration: Model Policies

```yaml
# ConfigMap for enterprise admin policies
apiVersion: v1
kind: ConfigMap
metadata:
  name: tabnine-admin-config
  namespace: tabnine
data:
  admin-policy.yaml: |
    # Model availability per team
    model_policies:
      default:
        allowed_models:
          - tabnine-protected        # IP-safe default
        chat_models:
          - tabnine-protected
          - claude-4.6-sonnet        # For complex reasoning

      platform-team:
        allowed_models:
          - tabnine-protected
          - claude-4.6-sonnet
          - claude-4.6-opus
          - gpt-5.3-codex
        chat_models: all             # Full model access
        features:
          - code_completion
          - chat
          - agent_mode
          - cli

      contractors:
        allowed_models:
          - tabnine-protected        # Only IP-safe model
        chat_models:
          - tabnine-protected
        features:
          - code_completion          # No chat, no agent mode
        blocked_repos:
          - "*/proprietary-algo*"

    # Usage limits
    rate_limits:
      completions_per_minute: 120
      chat_messages_per_hour: 200
      agent_tasks_per_day: 50

    # Compliance
    compliance:
      log_all_completions: false      # Privacy: don't log code
      log_chat_metadata: true         # Log model/timestamp/user, not content
      data_retention: "none"          # Zero retention
      audit_model_usage: true         # Track which models each user uses
```

### Network Isolation

```yaml
# Tabnine server can only reach model APIs (if using cloud models)
# and internal git for context
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: tabnine-egress
  namespace: tabnine
spec:
  podSelector:
    matchLabels:
      app: tabnine-server
  policyTypes:
    - Egress
  egress:
    # DNS
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
    # Anthropic API (if using cloud Claude)
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
      ports:
        - protocol: TCP
          port: 443
      # In fully air-gapped: remove this rule entirely
    # Internal git for code context
    - to:
        - namespaceSelector:
            matchLabels:
              app: gitea
      ports:
        - protocol: TCP
          port: 3000
```

### IDE Configuration

```json
// VS Code settings.json — point to self-hosted Tabnine
{
  "tabnine.serverUrl": "https://tabnine.internal.example.com",
  "tabnine.cloudEnabled": false,
  "tabnine.model": "tabnine-protected",
  "tabnine.chatModel": "claude-4.6-sonnet",
  "tabnine.codeCompletionEnabled": true,
  "tabnine.inlineAgentEnabled": true,
  "tabnine.certificate": "/etc/pki/tls/certs/internal-ca.pem"
}
```

```bash
# Tabnine CLI configuration
tabnine config set server-url https://tabnine.internal.example.com
tabnine config set model claude-4.6-sonnet
tabnine config set telemetry disabled

# CLI usage
tabnine chat "Explain this function"
tabnine complete --file src/main.rs --line 42
tabnine agent "Add error handling to all HTTP endpoints in this service"
```

### Monitoring Usage

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: tabnine-metrics
  namespace: tabnine
spec:
  selector:
    matchLabels:
      app: tabnine-server
  endpoints:
    - port: metrics
      interval: 30s
```

```promql
# Active users
tabnine_active_users_total

# Completions per model
rate(tabnine_completions_total[5m])

# Completion acceptance rate (developer productivity signal)
tabnine_completions_accepted_total / tabnine_completions_shown_total

# Chat usage by model
rate(tabnine_chat_messages_total[1h])

# Latency (P99 should be <200ms for inline completions)
histogram_quantile(0.99, rate(tabnine_completion_latency_seconds_bucket[5m]))

# GPU utilization (Tabnine Protected model)
tabnine_gpu_utilization{model="tabnine-protected"}
```

### HPA for Peak Hours

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: tabnine-hpa
  namespace: tabnine
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: tabnine-server
  minReplicas: 2
  maxReplicas: 8
  metrics:
    - type: Pods
      pods:
        metric:
          name: tabnine_active_sessions
        target:
          type: AverageValue
          averageValue: "50"          # Scale at 50 concurrent sessions per pod
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
```

## Common Issues

### Completion latency >500ms
- **Cause**: GPU saturation or model too large for available VRAM
- **Fix**: Scale replicas; or use smaller model for completions (Tabnine Protected is fast), larger for chat

### IDE shows "disconnected" 
- **Cause**: TLS certificate not trusted by IDE; or ingress timeout too short
- **Fix**: Install internal CA in IDE config; increase `proxy-read-timeout` for chat (streaming)

### Third-party model API errors
- **Cause**: API key expired or rate limited by provider
- **Fix**: Rotate keys in `tabnine-model-keys` Secret; check provider usage dashboard

### Deprecated model warning after upgrade
- **Cause**: v6.2.0+ drops Gemma 3, Qwen 2.5, legacy Tabnine-protected
- **Fix**: Update admin policy to remove deprecated models before upgrading

## Best Practices

1. **Default to Tabnine Protected** — IP-safe, no license risk, fastest for completions
2. **Claude for reasoning** — complex refactoring, architecture chat, code review
3. **GPT Codex for speed** — quick completions when latency matters most
4. **Zero data retention** — set `TABNINE_DATA_RETENTION=none` for compliance
5. **Rate limit per user** — prevent a single user from saturating GPU resources
6. **Monitor acceptance rate** — if <20%, model isn't providing useful completions
7. **Separate completion vs chat GPUs** — completions need low latency; chat can queue

## Key Takeaways

- Tabnine Enterprise self-hosts on Kubernetes: GPU inference + IDE integration
- Multi-model: Tabnine Protected (IP-safe), Claude 4.6, GPT-5.x, Gemini, Llama 4
- Zero data retention + no telemetry for regulated environments
- Admin policies control model access per team/role (contractors get IP-safe only)
- Thinking models (Claude 4.5/4.6) support extended reasoning for complex tasks
- CLI + IDE extensions (VS Code, JetBrains) + agent mode for autonomous coding
- v6.2.0 deprecates older models — plan upgrades around model policy changes
- Key metric: completion acceptance rate (developer productivity ROI)
