---
title: "Record kubectl Sessions for Kubernetes"
description: "Record and replay kubectl sessions for auditing, documentation, and training. Terminal recording with asciinema, script, and kubectl plugins for OpenShift."
category: "configuration"
publishDate: "2026-04-20"
author: "Luca Berton"
difficulty: "beginner"
timeToComplete: "10 minutes"
kubernetesVersion: "1.21+"
tags: ["kubectl", "recording", "audit", "documentation", "terminal", "openshift"]
relatedRecipes:
  - "kubernetes-configmap-guide"
  - "kubernetes-resource-requests-limits"
  - kubernetes-audit-logging-enterprise
  - kubectl-cheatsheet
  - kubectl-logs-view-pod-logs
---

> 💡 **Quick Answer:** Use `asciinema rec` to record kubectl terminal sessions as shareable replays. For server-side audit, enable Kubernetes audit logging. For automated documentation, pipe commands through `script` or use `kubectl` with `--v=6` for full API request logging.

## The Problem

You need to record kubectl/oc sessions for:
- Compliance auditing (who ran what, when)
- Training materials and documentation
- Incident post-mortems (reproducing steps)
- Sharing troubleshooting workflows with team members

## The Solution

### Method 1: asciinema (Best for Sharing)

```bash
# Install asciinema
# Ubuntu/Debian
sudo apt install asciinema

# macOS
brew install asciinema

# Record a session
asciinema rec kubectl-session.cast

# Now run your kubectl commands...
kubectl get pods
kubectl describe pod myapp-abc12
kubectl logs myapp-abc12 --tail=50
# Press Ctrl+D or type 'exit' to stop recording

# Play back locally
asciinema play kubectl-session.cast

# Upload and share (optional)
asciinema upload kubectl-session.cast
# https://asciinema.org/a/xxx
```

### Method 2: script Command (Built-in Linux)

```bash
# Record terminal session with timestamps
script -t 2>timing.log kubectl-session.txt

# Run your kubectl commands
kubectl get nodes
kubectl top pods -A
kubectl describe svc myapp

# Stop recording
exit

# Replay at original speed
scriptreplay timing.log kubectl-session.txt

# Plain text log (grep-friendly)
cat kubectl-session.txt
```

### Method 3: kubectl Verbose Logging

```bash
# Log all API requests/responses (great for debugging)
kubectl get pods --v=6 2>&1 | tee kubectl-api.log

# Verbosity levels:
# --v=0  Minimal
# --v=4  Debug (shows HTTP requests)
# --v=6  Show API request/response bodies
# --v=8  Show HTTP request contents
# --v=9  Show everything including curl commands

# Record all commands with API details
export KUBECTL_LOG_FILE=/tmp/kubectl-audit.log
```

### Method 4: Shell History with Timestamps

```bash
# Enable timestamp in bash history
export HISTTIMEFORMAT="%Y-%m-%d %H:%M:%S "

# Log all commands to a file
export PROMPT_COMMAND='echo "$(date "+%Y-%m-%d %H:%M:%S") $(history 1)" >> ~/kubectl-history.log'

# Or use a kubectl wrapper function
kubectl() {
    echo "$(date -Iseconds) kubectl $*" >> ~/.kubectl-audit.log
    command kubectl "$@"
}
```

### Method 5: Kubernetes Audit Logging (Server-Side)

```yaml
# audit-policy.yaml — captures all kubectl interactions at the API server
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  # Log all pod operations at RequestResponse level
  - level: RequestResponse
    resources:
      - group: ""
        resources: ["pods", "pods/exec", "pods/log"]
    verbs: ["create", "delete", "patch"]

  # Log secret access at Metadata level (don't log secret values)
  - level: Metadata
    resources:
      - group: ""
        resources: ["secrets"]

  # Log everything else at Request level
  - level: Request
    resources:
      - group: ""
        resources: ["*"]
```

```bash
# Enable on kube-apiserver (add to manifest or kubeadm config)
# --audit-log-path=/var/log/kubernetes/audit.log
# --audit-policy-file=/etc/kubernetes/audit-policy.yaml
# --audit-log-maxage=30
# --audit-log-maxbackup=10
# --audit-log-maxsize=100

# Search audit logs
cat /var/log/kubernetes/audit.log | jq 'select(.user.username=="admin") | {verb, requestURI, timestamp: .requestReceivedTimestamp}'
```

### Method 6: OpenShift Session Recording

```bash
# OpenShift provides built-in terminal recording via tlog
# Enable session recording for specific users
oc adm policy add-cluster-role-to-user cluster-admin admin

# Use oc with verbose output
oc get pods --loglevel=6 2>&1 | tee oc-session.log

# OpenShift audit logs location
# /var/log/openshift-apiserver/audit.log
oc adm node-logs --role=master --path=openshift-apiserver/audit.log
```

### Architecture

```mermaid
graph TD
    A[User Terminal] -->|kubectl commands| B[kubectl Client]
    B -->|API requests| C[kube-apiserver]
    
    A -->|asciinema/script| D[Terminal Recording]
    D --> E[.cast/.txt file]
    
    B -->|--v=6 logging| F[Client-side API log]
    
    C -->|audit policy| G[Audit Log]
    G --> H[/var/log/kubernetes/audit.log]
    G --> I[Webhook → SIEM]
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| asciinema recording too large | Long session with scrolling output | Use `--idle-time-limit=2` |
| script captures control chars | Terminal escape sequences | Use `col -b < session.txt` to clean |
| Audit logs fill disk | Too verbose policy | Use `Metadata` level, exclude reads |
| Missing user identity in audit | Service account auth | Map to real users via OIDC |
| Recording misses sudo/su | New shell session | Record the outer shell |

## Best Practices

1. **Use asciinema for demos** — shareable, replayable, lightweight
2. **Use audit logging for compliance** — server-side, tamper-resistant
3. **Set `--idle-time-limit`** — trims dead time from recordings
4. **Don't record secrets** — mask sensitive output, use `Metadata` audit level
5. **Centralize audit logs** — ship to SIEM via audit webhook

## Key Takeaways

- Client-side: asciinema (share/replay), script (simple text log), verbose kubectl (API debug)
- Server-side: Kubernetes audit logging captures all API interactions regardless of client
- asciinema produces `.cast` files — playable in terminal or embedded in web pages
- For compliance, server-side audit logging is mandatory — client recording is supplementary
- OpenShift adds tlog-based session recording and `oc adm node-logs` for audit access
