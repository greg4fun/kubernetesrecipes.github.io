---
title: "Hermes Agent Self-Hosted AI on Kubernetes"
description: "Deploy Hermes Agent (Nous Research) on Kubernetes as a persistent self-hosted AI agent with memory, automated skill creation, multi-platform messaging, scheduled automations, and parallel sub-agents. MIT licensed, zero telemetry."
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
  - "kubernetes-cronjob-guide"
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
          image: ghcr.io/nous-research/hermes-agent:latest
          ports:
            - containerPort: 8080
              name: api
          env:
            # Model backend
            - name: HERMES_MODEL_PROVIDER
              value: "vllm"            # or: openrouter, openai-compatible
            - name: HERMES_MODEL_ENDPOINT
              value: "http://vllm-server.ai:8000/v1"
            - name: HERMES_MODEL
              value: "NousResearch/Hermes-3-Llama-3.1-70B"

            # Messaging platforms
            - name: HERMES_TELEGRAM_TOKEN
              valueFrom:
                secretKeyRef:
                  name: hermes-secrets
                  key: telegram-token
            - name: HERMES_DISCORD_TOKEN
              valueFrom:
                secretKeyRef:
                  name: hermes-secrets
                  key: discord-token
            - name: HERMES_SLACK_TOKEN
              valueFrom:
                secretKeyRef:
                  name: hermes-secrets
                  key: slack-token

            # Security
            - name: HERMES_TELEMETRY
              value: "disabled"
            - name: HERMES_EXECUTION_MODE
              value: "docker"          # Sandboxed execution

          volumeMounts:
            - name: hermes-data
              mountPath: /home/hermes/.hermes
            - name: skills
              mountPath: /home/hermes/.hermes/skills
          resources:
            requests:
              cpu: "2"
              memory: "4Gi"
            limits:
              cpu: "4"
              memory: "8Gi"
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]

      volumes:
        - name: hermes-data
          persistentVolumeClaim:
            claimName: hermes-memory-pvc
        - name: skills
          persistentVolumeClaim:
            claimName: hermes-skills-pvc
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
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: hermes-skills-pvc
  namespace: hermes
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: fast-ssd
  resources:
    requests:
      storage: 5Gi
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
            - --max-model-len=32768
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
  config.yaml: |
    # Persistent Memory
    memory:
      enabled: true
      path: /home/hermes/.hermes/memory
      # Agent remembers preferences, projects, environment
      # Gets smarter the longer it runs

    # Automated Skill Creation
    skills:
      auto_create: true
      # When Hermes solves a hard problem, it writes a reusable
      # SKILL.md so it never forgets how
      format: "agentskills.io"        # Open standard
      community_hub: "agentskills.io"  # Browse and install skills

    # Multi-Platform Messaging
    gateway:
      platforms:
        - telegram
        - discord
        - slack
        - whatsapp
        - signal
        - cli
      # Voice memo transcription supported
      # Cross-platform conversation continuation

    # Scheduled Automations
    cron:
      enabled: true
      jobs:
        - name: daily-report
          schedule: "0 9 * * *"
          task: "Generate daily project status report"
          deliver_to: telegram

        - name: weekly-audit
          schedule: "0 10 * * 1"
          task: "Audit infrastructure and report findings"
          deliver_to: slack

        - name: morning-briefing
          schedule: "0 7 * * 1-5"
          task: "Check email, calendar, news. Brief me."
          deliver_to: telegram

    # Parallel Sub-Agents
    subagents:
      enabled: true
      max_concurrent: 5
      # Each gets own conversation and terminal
      # Zero-context-cost turns via RPC

    # Execution Backends
    execution:
      local_terminal: true
      docker:
        enabled: true
        security:
          read_only_root: true
          drop_capabilities: all
          pid_limit: 100
      ssh:
        enabled: false                # Enable for remote servers
      modal:
        enabled: false                # Enable for cloud/HPC

    # Browser Automation
    browser:
      enabled: true
      # Web search, page extraction, screenshots
      # Full navigation, click, type automation
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
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
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
- **Fix**: Configure memory retention policies; or periodically review `~/.hermes/memory/`

### Sub-agent spawning fails
- **Cause**: Docker socket not available or PID limits hit
- **Fix**: Mount Docker socket or use Kubernetes job-based sub-agents; increase `pid_limit`

### Voice memo transcription not working
- **Cause**: Whisper model not loaded or audio codec unsupported
- **Fix**: Ensure whisper dependency available; check audio format (opus/ogg supported)

### Agent loses context after pod restart
- **Cause**: Memory not persisted (emptyDir instead of PVC)
- **Fix**: Use PersistentVolumeClaim for `~/.hermes/` directory

## Best Practices

1. **Use PVCs for memory** — the agent's value comes from persistent learning
2. **Local vLLM for privacy** — zero data leaves your cluster
3. **Start with one platform** — add more as you trust the agent's behavior
4. **Review auto-created skills** — agent writes skills it can reuse; audit them
5. **Cron for recurring tasks** — don't re-ask; schedule reports and audits
6. **Container hardening** — read-only root, drop all capabilities, non-root user
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
