---
title: "Network Policies for OpenClaw on Kubernetes"
description: "Secure OpenClaw deployments with Kubernetes NetworkPolicies to restrict egress to messaging APIs, block unauthorized ingress, and isolate the gateway."
category: "security"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A Kubernetes cluster with a CNI that supports NetworkPolicy (Calico, Cilium)"
  - "OpenClaw deployed on Kubernetes"
relatedRecipes:
  - "pod-security-context"
  - "namespace-management"
  - "openclaw-kubernetes-deployment"
  - "openclaw-secrets-management"
  - "network-policies-kubernetes"
  - "oidc-authentication-kubernetes"
tags:
  - openclaw
  - network-policy
  - security
  - egress
  - ingress
  - isolation
publishDate: "2026-02-26"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Apply a NetworkPolicy that allows OpenClaw egress to AI APIs (api.anthropic.com), messaging services (WhatsApp, Telegram, Discord), and DNS. Block all other egress and restrict ingress to the Control UI port from authorized sources only.
>
> **Key concept:** OpenClaw needs outbound access to AI provider APIs and messaging service endpoints. Lock down everything else with deny-all + allow-list policies.
>
> **Gotcha:** WhatsApp uses dynamic IP ranges. You'll need to allow egress on ports 443 and 5222 broadly, or use a DNS-based policy engine like Cilium.

## The Problem

- OpenClaw has access to AI API keys and messaging credentials
- Default Kubernetes allows all pod-to-pod and pod-to-internet traffic
- A compromised pod could exfiltrate credentials to unauthorized endpoints
- The Control UI should not be accessible to everyone on the cluster

## The Solution

Apply Kubernetes NetworkPolicies to restrict OpenClaw's network access to only what's needed.

## Network Policies

```yaml
# openclaw-netpol.yaml
# Default deny all
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: openclaw
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
# Allow DNS
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: openclaw
spec:
  podSelector:
    matchLabels:
      app: openclaw
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector: {}
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
---
# Allow egress to AI APIs and messaging services (HTTPS)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-external-apis
  namespace: openclaw
spec:
  podSelector:
    matchLabels:
      app: openclaw
  policyTypes: [Egress]
  egress:
    # HTTPS for AI APIs (Anthropic, OpenAI) and messaging APIs
    - ports:
        - protocol: TCP
          port: 443
    # WhatsApp uses XMPP on port 5222
    - ports:
        - protocol: TCP
          port: 5222
---
# Allow ingress to Control UI from monitoring/ingress only
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress
  namespace: openclaw
spec:
  podSelector:
    matchLabels:
      app: openclaw
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
      ports:
        - protocol: TCP
          port: 18789
```

## Cilium DNS-Based Policy (Advanced)

```yaml
# For more precise control, use Cilium's FQDN-based policies
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: openclaw-egress
  namespace: openclaw
spec:
  endpointSelector:
    matchLabels:
      app: openclaw
  egress:
    - toFQDNs:
        - matchName: "api.anthropic.com"
        - matchName: "api.openai.com"
        - matchName: "discord.com"
        - matchName: "gateway.discord.gg"
        - matchName: "api.telegram.org"
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP
    - toEndpoints:
        - matchLabels:
            k8s:io.kubernetes.pod.namespace: kube-system
            k8s-app: kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: UDP
```

## Common Issues

### Issue 1: WhatsApp disconnects after applying policy

```bash
# WhatsApp uses dynamic IPs — port-based policy is needed
# Ensure port 443 and 5222 egress is allowed broadly
# Or use Cilium FQDN policies for precise control
```

## Best Practices

1. **Start with deny-all** — Then add specific allow rules
2. **Use Cilium for FQDN policies** — More precise than IP-based rules
3. **Restrict Control UI access** — Only allow ingress from ingress controller/monitoring
4. **Test policies in audit mode** — Verify before enforcing
5. **Document allowed endpoints** — Maintain a list of required external services

## Key Takeaways

- **Default-deny + allow-list** is the correct approach for OpenClaw security
- **Port 443 egress** covers most AI APIs and messaging services
- **Cilium FQDN policies** provide the most precise control
- **Control UI ingress** should be restricted to authorized namespaces
- **Test thoroughly** before enforcing — a wrong policy takes the bot offline
