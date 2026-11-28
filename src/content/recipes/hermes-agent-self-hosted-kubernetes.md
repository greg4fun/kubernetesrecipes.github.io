---
title: "Hermes Agent Self-Hosted AI on Kubernetes"
description: "Deploy Hermes Agent (Nous Research) on Kubernetes as a persistent self-hosted AI agent with memory, automated skill creation, multi-platform"
tags:
  - "hermes"
  - "ai-agent"
  - "nous-research"
  - "self-hosted"
  - "persistent-memory"
  - "automation"
category: "ai"
publishDate: "2026-05-22"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "nvidia-openshell-sandboxed-ai-agents-kubernetes"
  - "poolside-ai-foundation-models-kubernetes"
  - "vllm-openai-container-kubernetes"
  - "kubernetes-job-cronjob-guide"
---

> 💡 **Quick Answer:** Hermes Agent (by Nous Research, MIT license) is a persistent self-hosted AI agent that learns over time, creates its own skills, connects to 5+ chat platforms (Telegram, Discord, Slack, WhatsApp, Signal), runs scheduled automations, and spawns parallel sub-agents. Deploy on Kubernetes with local vLLM or OpenRouter for model inference, persistent storage for memory, and container hardening for security.

## The Problem

- Chatbots forget everything between sessions — no persistent context
- AI assistants locked to one platform (IDE only, or chat only)
- Need autonomous background tasks (reports, audits, monitoring) not just Q&A
- Commercial solutions send your data to external servers
- Want an agent that gets smarter over time as it learns your projects and preferences

## The Solution

### Hermes Agent Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ Kubernetes Cluster                                            │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Hermes Agent Pod                                        │  │
│  │                                                         │  │
│  │  ┌──────────────┐  ┌───────────────┐  ┌────────────┐  │  │
│  │  │ Gateway      │  │ Memory Store  │  │ Skill      │  │  │
│  │  │ (messaging)  │  │ (~/.hermes/)  │  │ Engine     │  │  │
│  │  │              │  │               │  │ (40+ built │  │  │
│  │  │ • Telegram   │  │ • Preferences │  │  in + auto │  │  │
│  │  │ • Discord    │  │ • Projects    │  │  created)  │  │  │
│  │  │ • Slack      │  │ • Context     │  │            │  │  │
│  │  │ • WhatsApp   │  │ • History     │  │            │  │  │
│  │  │ • Signal     │  │               │  │            │  │  │
│  │  │ • CLI        │  │               │  │            │  │  │
│  │  └──────────────┘  └───────────────┘  └────────────┘  │  │
│  │                                                         │  │
│  │  ┌──────────────┐  ┌───────────────┐  ┌────────────┐  │  │
│  │  │ Cron         │  │ Sub-Agents    │  │ Browser    │  │  │
│  │  │ Scheduler    │  │ (parallel)    │  │ Automation │  │  │
│  │  └──────────────┘  └───────────────┘  └────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
│                              │                                │
│  ┌───────────────────────────▼────────────────────────────┐  │
│  │ Model Backend (choose one)                              │  │
│  │ • Local vLLM (fully on-prem)                            │  │
│  │ • OpenRouter (200+ models)                              │  │
│  │ • Any OpenAI-compatible API                             │  │
│  │ • Nous Portal (native OAuth)                            │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Deploy on Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hermes-agent
  namespace: hermes
  labels:
    app: hermes-agent
spec:
  replicas: 1                         # Single instance (stateful agent)
  strategy:
    type: Recreate                    # Don't run two instances
  selector:
    matchLabels:
      app: hermes-agent
  template:
    metadata:
      labels:
        app: hermes-agent
    spec:
      containers:
        - name: hermes
          # Official image is on Docker Hub; pin a version (or a digest)
          image: nousresearch/hermes-agent:v0.23.5
          args: ["gateway", "run"]
          ports:
            - containerPort: 8642      # Optional API server (API_SERVER_ENABLED=true)
              name: api
          env:
            # Model backend: set in config.yaml (model.provider/base_url/default),
            # see the ConfigMap below — there are no HERMES_MODEL_* variables.

            # Messaging platforms
            - name: TELEGRAM_BOT_TOKEN
              valueFrom:
                secretKeyRef:
                  name: hermes-secrets
                  key: telegram-token
            - name: DISCORD_BOT_TOKEN
              valueFrom:
                secretKeyRef:
                  name: hermes-secrets
                  key: discord-token
            - name: SLACK_BOT_TOKEN
              valueFrom:
                secretKeyRef:
                  name: hermes-secrets
                  key: slack-bot-token
            - name: SLACK_APP_TOKEN
              valueFrom:
                secretKeyRef:
                  name: hermes-secrets
                  key: slack-app-token

            # Hermes collects no telemetry, so there is no switch for it.
            # Sandboxed execution is terminal.backend in config.yaml.

          volumeMounts:
            - name: hermes-data
              mountPath: /opt/data     # Single data root: config, .env, memories, skills, sessions
          resources:
            requests:
              cpu: "2"
              memory: "4Gi"
            limits:
              cpu: "4"
              memory: "8Gi"
          # The image's init starts as root to fix /opt/data ownership, then
          # drops every Hermes process to the non-root `hermes` user (UID 10000).
          # An arbitrary runAsUser is refused at startup; to match a volume
          # owner, set HERMES_UID/HERMES_GID (or PUID/PGID) in env instead.
          securityContext:
            allowPrivilegeEscalation: false

      volumes:
        - name: hermes-data
          persistentVolumeClaim:
            claimName: hermes-memory-pvc
---
# Persistent storage for agent memory
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: hermes-memory-pvc
  namespace: hermes
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: fast-ssd
  resources:
    requests:
      storage: 10Gi
```

### Model Backend: Local vLLM

```yaml
# Self-hosted inference with vLLM (fully on-prem, zero data leakage)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-hermes
  namespace: hermes
spec:
  replicas: 1
  selector:
    matchLabels:
      app: vllm-hermes
  template:
    metadata:
      labels:
        app: vllm-hermes
    spec:
      nodeSelector:
        nvidia.com/gpu.present: "true"
      containers:
        - name: vllm
          image: vllm/vllm-openai:latest
          args:
            - --model=NousResearch/Hermes-3-Llama-3.1-70B
            - --tensor-parallel-size=4
            - --max-model-len=65536        # Hermes needs at least 64K context for agentic work
            - --enable-auto-tool-choice
            - --tool-call-parser=hermes
          ports:
            - containerPort: 8000
          resources:
            limits:
              nvidia.com/gpu: "4"
              memory: "320Gi"
          volumeMounts:
            - name: model-cache
              mountPath: /root/.cache/huggingface
      volumes:
        - name: model-cache
          persistentVolumeClaim:
            claimName: model-cache-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: vllm-server
  namespace: hermes
spec:
  selector:
    app: vllm-hermes
  ports:
    - port: 8000
      targetPort: 8000
```

### Key Features Configuration

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: hermes-config
  namespace: hermes
data:
  # Place this file at /opt/data/config.yaml on the data volume
  config.yaml: |
    # Model backend: local vLLM through the custom OpenAI-compatible endpoint
    model:
      provider: custom
      base_url: http://vllm-server:8000/v1
      default: NousResearch/Hermes-3-Llama-3.1-70B

    # Persistent Memory (~/.hermes/memories/USER.md and MEMORY.md)
    memory:
      memory_enabled: true
      user_profile_enabled: true

    # Execution backend: local | docker | ssh | modal | daytona | ...
    # docker needs a Docker daemon reachable from the pod; local runs
    # commands inside the Hermes container.
    terminal:
      backend: docker

    # Parallel Sub-Agents
    delegation:
      max_concurrent_children: 5
```

Messaging platforms are enabled by their tokens (the env vars above) or with `hermes gateway setup`, not by a `gateway.platforms` list. Scheduled automations are created with the CLI, not in `config.yaml`:

```bash
kubectl -n hermes exec deploy/hermes-agent -- hermes cron create "0 9 * * *" \
  "Generate daily project status report" --name daily-report --deliver telegram
```

### Security Hardening

```yaml
# NetworkPolicy — Hermes only reaches model backend and messaging APIs
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: hermes-egress
  namespace: hermes
spec:
  podSelector:
    matchLabels:
      app: hermes-agent
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
    # Local vLLM model
    - to:
        - podSelector:
            matchLabels:
              app: vllm-hermes
      ports:
        - protocol: TCP
          port: 8000
    # Messaging platform APIs (Telegram, Discord, Slack)
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
      ports:
        - protocol: TCP
          port: 443
```

```yaml
# Pod Security — hardened container
apiVersion: v1
kind: Namespace
metadata:
  name: hermes
  labels:
    # baseline, not restricted: the image's init must start as root
    pod-security.kubernetes.io/enforce: baseline
    pod-security.kubernetes.io/audit: baseline
```

### Comparison: Hermes vs Other Agent Runtimes

```text
Feature              Hermes Agent    OpenShell       Poolside
──────────────────────────────────────────────────────────────
License              MIT             Apache-2.0      Commercial
Persistent Memory    ✅              ❌              ❌
Multi-Platform Chat  ✅ (5+)         ❌              ❌
Auto Skill Creation  ✅              ❌              ❌
Scheduled Tasks      ✅ (cron)       ❌              ❌
Sandboxed Exec       ✅ (Docker)     ✅ (proxy)      ✅ (pods)
Browser Control      ✅              ❌              ❌
Sub-Agents           ✅              ❌              ✅
GPU Inference        ✅ (vLLM)       ❌              ✅
Network Policies     Basic           Fine-grained    Fine-grained
Enterprise Focus     Personal/Team   Developer       Enterprise
Zero Telemetry       ✅              ✅              Configurable
```

## Common Issues

### Memory grows unbounded over months
- **Cause**: Agent accumulates context without pruning
- **Fix**: Configure memory retention policies; or periodically review `~/.hermes/memories/` (`/opt/data/memories/` in the container)

### Sub-agent spawning fails
- **Cause**: Docker socket not available or PID limits hit
- **Fix**: Mount Docker socket or use Kubernetes job-based sub-agents

### Voice memo transcription not working
- **Cause**: Whisper model not loaded or audio codec unsupported
- **Fix**: Ensure whisper dependency available; check audio format (opus/ogg supported)

### Agent loses context after pod restart
- **Cause**: Memory not persisted (emptyDir instead of PVC)
- **Fix**: Use a PersistentVolumeClaim for the data root (`/opt/data` in the container, `~/.hermes/` on a host install)

## Best Practices

1. **Use PVCs for memory** — the agent's value comes from persistent learning
2. **Local vLLM for privacy** — zero data leaves your cluster
3. **Start with one platform** — add more as you trust the agent's behavior
4. **Review auto-created skills** — agent writes skills it can reuse; audit them
5. **Cron for recurring tasks** — don't re-ask; schedule reports and audits
6. **Container hardening** — no privilege escalation, egress NetworkPolicy; the image drops to its non-root `hermes` user (UID 10000) after init
7. **Backup memory PVC** — this is the agent's brain; losing it resets learning

## Key Takeaways

- Hermes Agent: open-source (MIT), self-hosted persistent AI agent by Nous Research
- Gets smarter over time — remembers preferences, projects, environment across sessions
- Auto-creates reusable skills (agentskills.io open standard) when solving hard problems
- Multi-platform: Telegram, Discord, Slack, WhatsApp, Signal, CLI — single gateway
- Built-in cron scheduler for autonomous background tasks
- Parallel sub-agents for concurrent workstreams
- Model-agnostic: local vLLM, OpenRouter (200+ models), any OpenAI-compatible API
- Zero telemetry, all data stored locally, MIT license, fully auditable
- Deploy on K8s with PVC for memory persistence + container security hardening
