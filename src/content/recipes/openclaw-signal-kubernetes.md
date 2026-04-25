---
title: "Deploy an OpenClaw Signal Messenger Bot"
description: "Run OpenClaw as a Signal messenger AI assistant on Kubernetes with linked device pairing, end-to-end encryption, and persistent sessions."
category: "deployments"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster"
  - "A Signal account (phone number)"
  - "An AI provider API key"
relatedRecipes:
  - "openclaw-kubernetes-deployment"
  - "openclaw-whatsapp-kubernetes"
  - "openclaw-telegram-bot-kubernetes"
tags:
  - openclaw
  - signal
  - messaging
  - e2e-encryption
  - ai-assistant
  - privacy
  - deployment
publishDate: "2026-02-26"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Deploy OpenClaw with `channels.signal.enabled: true`, then use `kubectl exec -it` to run `openclaw channels login` and scan the QR code with Signal on your phone (Settings → Linked Devices). Signal's end-to-end encryption is preserved — OpenClaw acts as a linked device.
>
> **Key concept:** Signal uses linked device protocol (like Signal Desktop). Your phone must remain active for the initial sync, but after linking, the bot operates independently.
>
> **Gotcha:** Signal linked devices can be unlinked by the phone at any time. If the pod can't reach Signal servers, re-linking may be needed.

## The Problem

- Signal has no official bot API — only linked devices
- End-to-end encryption makes middleware integration complex
- Session state for linked devices must persist across restarts

## The Solution

OpenClaw links to Signal as a secondary device, preserving E2E encryption while routing messages to your AI agent.

## Deployment

```yaml
# openclaw-signal.yaml
apiVersion: v1
kind: Secret
metadata:
  name: openclaw-signal-secrets
  namespace: openclaw
type: Opaque
stringData:
  ANTHROPIC_API_KEY: "sk-ant-your-key"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: openclaw-signal-config
  namespace: openclaw
data:
  openclaw.json: |
    {
      "gateway": { "port": 18789 },
      "channels": {
        "signal": {
          "enabled": true,
          "allowFrom": ["+15555550123"]
        }
      }
    }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openclaw-signal
  namespace: openclaw
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: openclaw-signal
  template:
    spec:
      containers:
        - name: openclaw
          image: node:22-slim
          command: ["sh", "-c", "npm i -g openclaw@latest && openclaw gateway"]
          envFrom:
            - secretRef:
                name: openclaw-signal-secrets
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
            claimName: openclaw-signal-state
        - name: config
          configMap:
            name: openclaw-signal-config
```

## Pair Signal

```bash
# Link as a new device
kubectl exec -it -n openclaw deploy/openclaw-signal -- openclaw channels login

# On your phone: Signal → Settings → Linked Devices → Link New Device
# Scan the QR code displayed in the terminal
```

## Best Practices

1. **Use allowFrom** — Restrict which numbers can interact with the AI
2. **Recreate strategy** — Only one linked device session per deployment
3. **Persistent PVC** — Signal crypto keys must survive restarts
4. **Backup PVC regularly** — Re-linking requires phone access
5. **Privacy-first** — Signal's E2E encryption is maintained throughout

## Key Takeaways

- **Signal integration** uses the linked device protocol — no bot API needed
- **E2E encryption** is fully preserved — OpenClaw is just another linked device
- **One-time QR pairing** via `kubectl exec`, then hands-off operation
- **PVC persistence** is critical — losing Signal session keys requires re-pairing
- **Ideal for privacy-focused** AI assistant deployments
