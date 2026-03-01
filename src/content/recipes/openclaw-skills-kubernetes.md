---
title: "Manage OpenClaw Skills on Kubernetes"
description: "Deploy and manage OpenClaw agent skills (tools, automations, integrations) on Kubernetes using ConfigMaps, PVCs, and git-sync for dynamic capability management."
category: "configuration"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "OpenClaw deployed on Kubernetes"
  - "kubectl access to the cluster"
relatedRecipes:
  - "openclaw-kubernetes-deployment"
  - "openclaw-workspace-gitops"
  - "openclaw-multi-agent-kubernetes"
tags:
  - openclaw
  - skills
  - tools
  - plugins
  - configuration
  - agent-capabilities
publishDate: "2026-02-26"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Skills are directories with a `SKILL.md` file that teach the agent how to use specific tools. Place them in the workspace's `skills/` directory. On Kubernetes, either bake them into your custom image, mount via ConfigMap, or sync from Git.
>
> ```bash
> # Install a skill from ClawhHub
> kubectl exec -n openclaw deploy/openclaw -- openclaw skills install weather
> ```
>
> **Key concept:** Skills are declarative — SKILL.md describes when and how to use the skill. The agent reads it automatically when the task matches.
>
> **Gotcha:** Skills that require shell scripts need the dependencies installed in the container image.

## The Problem

- AI agents need specific capabilities (weather, email, calendar, web search)
- Skills must be discoverable and automatically loaded by the agent
- Different agents may need different skill sets
- Updating skills shouldn't require pod restarts

## The Solution

OpenClaw skills are simple directories with a SKILL.md file. Manage them as code in Kubernetes using ConfigMaps, PVCs, or Git sync.

## Skill Structure

```
skills/
├── weather/
│   └── SKILL.md          # Instructions for the agent
├── discord/
│   └── SKILL.md
├── web-search/
│   ├── SKILL.md
│   └── search.sh         # Helper script (optional)
└── custom-tool/
    ├── SKILL.md
    ├── tool.py
    └── requirements.txt
```

## Method 1: ConfigMap Skills

```yaml
# skill-configmaps.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: skill-weather
  namespace: openclaw
data:
  SKILL.md: |
    # Weather Skill
    
    Get current weather and forecasts using wttr.in.
    
    ## When to use
    When the user asks about weather, temperature, or forecasts.
    
    ## How to use
    ```bash
    curl -s "wttr.in/CityName?format=4"
    ```
    
    For detailed forecast:
    ```bash
    curl -s "wttr.in/CityName?format=v2"
    ```
```

Mount in deployment:

```yaml
containers:
  - name: openclaw
    volumeMounts:
      - name: skill-weather
        mountPath: /home/node/.openclaw/workspace/skills/weather
volumes:
  - name: skill-weather
    configMap:
      name: skill-weather
```

## Method 2: Install from ClawHub

```bash
# Install skills interactively
kubectl exec -n openclaw deploy/openclaw -- openclaw skills install weather
kubectl exec -n openclaw deploy/openclaw -- openclaw skills install discord

# List installed skills
kubectl exec -n openclaw deploy/openclaw -- openclaw skills list

# Skills are saved to the PVC and persist across restarts
```

## Method 3: Bake into Docker Image

```dockerfile
FROM node:22-slim
RUN npm install -g openclaw@latest

# Copy custom skills
COPY skills/ /home/node/.openclaw/workspace/skills/

USER node
ENTRYPOINT ["openclaw", "gateway"]
```

## Common Issues

### Issue 1: Skill not detected by agent

```bash
# Verify SKILL.md exists in the right path
kubectl exec -n openclaw deploy/openclaw -- \
  ls -la /home/node/.openclaw/workspace/skills/

# Check the skill description matches the task
kubectl exec -n openclaw deploy/openclaw -- \
  cat /home/node/.openclaw/workspace/skills/weather/SKILL.md
```

### Issue 2: Skill scripts fail

```bash
# Ensure dependencies are installed in the container
# For Python skills: pip install in Dockerfile
# For shell scripts: ensure curl, jq, etc. are available
```

## Best Practices

1. **Clear SKILL.md descriptions** — The agent matches tasks to skills based on the description
2. **One skill per concern** — Don't bundle unrelated capabilities
3. **Version skills with Git** — Track changes to skill instructions
4. **Test skills locally** — Verify before deploying to Kubernetes
5. **Use ClawHub** — Community skills at <https://clawhub.com>

## Key Takeaways

- **Skills are directories** with a SKILL.md that teaches the agent new capabilities
- **ConfigMaps, PVCs, or Git sync** all work for skill deployment on Kubernetes
- **ClawHub** provides community-maintained skills for common tasks
- **Custom skills** can include scripts, configs, and any supporting files
- **Per-agent skills** via separate workspace directories enable capability isolation
