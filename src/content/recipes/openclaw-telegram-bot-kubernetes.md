---
title: "Deploy an OpenClaw Telegram Bot on Kubernetes"
description: "Run OpenClaw as a Telegram bot on Kubernetes with BotFather setup, webhook configuration, inline commands, and persistent conversation history."
category: "deployments"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "A Telegram bot token (from BotFather)"
  - "An AI provider API key"
relatedRecipes:
  - "openclaw-kubernetes-deployment"
  - "openclaw-discord-bot-kubernetes"
  - "openclaw-whatsapp-kubernetes"
tags:
  - openclaw
  - telegram
  - bot
  - ai-agent
  - chatbot
  - deployment
publishDate: "2026-02-26"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Message `@BotFather` on Telegram → `/newbot` → get your token. Deploy OpenClaw with the token as `TELEGRAM_BOT_TOKEN` env var and `channels.telegram.enabled: true` in config. The bot responds to DMs immediately and mentions in groups.
>
> **Key concept:** OpenClaw connects to Telegram via the Bot API using long polling (no webhook/ingress needed). The bot works in DMs and groups where it's added.
>
> **Gotcha:** Add the bot to a group and grant it "Read All Group Messages" permission via BotFather (`/setprivacy` → Disable) for it to see messages beyond direct mentions.

## The Problem

- Telegram bots require handling Bot API updates, webhook setup, and message parsing
- Maintaining conversation context per user across sessions is complex
- Group chat bots need careful mention/command handling to avoid noise

## The Solution

OpenClaw handles all Telegram Bot API integration, session management, and message routing automatically.

## Step 1: Create the Bot via BotFather

```
1. Open Telegram → search @BotFather
2. Send /newbot
3. Choose a name: "My K8s Assistant"
4. Choose a username: my_k8s_bot
5. Copy the token: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
6. Send /setprivacy → @my_k8s_bot → Disable (to read group messages)
```

## Step 2: Deploy

```yaml
# openclaw-telegram.yaml
apiVersion: v1
kind: Secret
metadata:
  name: openclaw-telegram-secrets
  namespace: openclaw
type: Opaque
stringData:
  ANTHROPIC_API_KEY: "sk-ant-your-key"
  TELEGRAM_BOT_TOKEN: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: openclaw-telegram-config
  namespace: openclaw
data:
  openclaw.json: |
    {
      "gateway": { "port": 18789 },
      "channels": {
        "telegram": {
          "enabled": true
        }
      },
      "messages": {
        "groupChat": {
          "requireMention": true
        }
      }
    }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openclaw-telegram
  namespace: openclaw
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: openclaw-telegram
  template:
    metadata:
      labels:
        app: openclaw-telegram
    spec:
      containers:
        - name: openclaw
          image: node:22-slim
          command: ["sh", "-c", "npm i -g openclaw@latest && openclaw gateway"]
          envFrom:
            - secretRef:
                name: openclaw-telegram-secrets
          volumeMounts:
            - name: state
              mountPath: /home/node/.openclaw
            - name: config
              mountPath: /home/node/.openclaw/openclaw.json
              subPath: openclaw.json
          resources:
            requests:
              cpu: 250m
              memory: 512Mi
      volumes:
        - name: state
          persistentVolumeClaim:
            claimName: openclaw-telegram-state
        - name: config
          configMap:
            name: openclaw-telegram-config
```

## Step 3: Test the Bot

```bash
# Check pod is running
kubectl get pods -n openclaw -l app=openclaw-telegram

# View logs to confirm Telegram connection
kubectl logs -n openclaw deploy/openclaw-telegram | grep -i telegram

# Send a DM to your bot on Telegram — it should respond!
```

## Common Issues

### Issue 1: Bot doesn't see group messages

```bash
# BotFather privacy mode is enabled by default
# Solution: /setprivacy → select your bot → Disable
# Then remove and re-add the bot to the group
```

### Issue 2: Duplicate responses

```bash
# Ensure only ONE replica is running
# Two pods = two long-polling connections = duplicate responses
kubectl get pods -n openclaw -l app=openclaw-telegram
```

## Best Practices

1. **Single replica only** — Telegram doesn't support multiple polling connections
2. **Disable privacy mode** — Required for group message visibility
3. **Use requireMention in groups** — Prevents responding to every message
4. **Set bot commands** — Use `/setcommands` in BotFather for a clean UX
5. **Persist state** — PVC keeps conversation history across pod restarts

## Key Takeaways

- **No webhook needed** — OpenClaw uses long polling, so no ingress required
- **BotFather setup** takes 2 minutes, then OpenClaw handles everything
- **Single replica** is mandatory — Telegram rejects duplicate polling connections
- **Group chats** require privacy mode disabled and mention-based routing
