---
title: "Kubernetes 1.36 SPDY to WebSocket Migration"
description: "Kubernetes 1.36 continues migrating kubectl exec/attach/port-forward from SPDY to WebSockets. Understand the changes and troubleshoot connection issues."
tags:
  - "kubernetes-1.36"
  - "kubectl"
  - "websockets"
  - "networking"
  - "migration"
category: "networking"
publishDate: "2026-05-03"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "kubernetes-exec-into-pod"
  - "kubectl-cheat-sheet"
  - "kubernetes-kubectl-debug-guide"
---

> 💡 **Quick Answer:** Kubernetes 1.36 continues the **SPDY to WebSocket transition** (KEP-4006). `kubectl exec`, `attach`, and `port-forward` now use WebSockets by default, improving compatibility with modern proxies, load balancers, and service meshes.

## The Problem

SPDY is a deprecated Google protocol (superseded by HTTP/2 in 2015). Kubernetes still used it for streaming connections:

- **Proxy incompatibility**: Many reverse proxies (nginx, Cloudflare, cloud ALBs) don't support SPDY
- **Firewall issues**: SPDY upgrade requests blocked by security appliances
- **No standard support**: Modern HTTP libraries dropped SPDY support
- **Connection drops**: SPDY connections through corporate proxies timeout or fail silently
- **Service mesh conflicts**: Istio/Envoy struggle with SPDY streams

## The Solution

WebSocket is the modern standard for bidirectional streaming. Kubernetes is migrating all streaming APIs to use WebSocket.

### What's Changed in 1.36

```bash
# These commands now use WebSocket by default:
kubectl exec -it pod-name -- /bin/sh
kubectl attach -it pod-name
kubectl port-forward pod-name 8080:80
kubectl cp file.txt pod-name:/tmp/
kubectl logs -f pod-name    # Already used HTTP/chunked, unaffected
```

### Verify WebSocket Is Being Used

```bash
# Enable verbose logging to see the connection protocol
kubectl exec -v=6 -it my-pod -- /bin/sh
# Look for: "websocket" in the upgrade header

# Check API server supports WebSocket
kubectl get --raw /api/v1 | jq '.serverAddressByClientCIDRs'
```

### Force SPDY Fallback (If Needed)

```bash
# Environment variable to force SPDY (temporary workaround)
export KUBECTL_REMOTE_COMMAND_WEBSOCKETS=false
kubectl exec -it my-pod -- /bin/sh

# Or in kubeconfig
apiVersion: v1
kind: Config
preferences:
  remoteCommandWebsockets: false
```

### Proxy and Load Balancer Configuration

```nginx
# Nginx reverse proxy — WebSocket support
server {
    listen 443 ssl;
    server_name k8s-api.example.com;

    location / {
        proxy_pass https://kube-apiserver:6443;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";    # Required for WebSocket
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;                 # Long-lived connections
    }
}
```

```yaml
# HAProxy configuration
frontend k8s_api
    bind *:6443 ssl crt /etc/ssl/k8s.pem
    default_backend k8s_apiserver

backend k8s_apiserver
    option httpchk GET /healthz
    http-request set-header Connection "upgrade" if { hdr(Upgrade) -m found }
    server api1 10.0.0.1:6443 ssl verify none check
```

```yaml
# AWS ALB Ingress — WebSocket support is automatic
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    # WebSocket supported by default on ALB — no special config needed
```

### Istio Service Mesh Compatibility

```yaml
# Istio DestinationRule for WebSocket connections to API server
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: kube-apiserver
spec:
  host: kubernetes.default.svc
  trafficPolicy:
    connectionPool:
      http:
        h2UpgradePolicy: UPGRADE    # Allow WebSocket upgrade
        idleTimeout: 3600s
```

## Common Issues

### `kubectl exec` fails with "error: unable to upgrade connection"
- **Cause**: Proxy between kubectl and API server doesn't support WebSocket
- **Fix**: Update proxy config to pass WebSocket upgrade headers; or set `KUBECTL_REMOTE_COMMAND_WEBSOCKETS=false`

### Connection drops after 60 seconds
- **Cause**: Proxy or load balancer has short idle timeout
- **Fix**: Increase `proxy_read_timeout` (nginx) or idle timeout (ALB) to 3600s

### Port-forward stops working through VPN
- **Cause**: Corporate VPN/proxy strips WebSocket upgrade headers
- **Fix**: Use SPDY fallback via environment variable until VPN is updated

## Best Practices

1. **Test `kubectl exec` through your full network path** — proxies, LBs, VPNs
2. **Update reverse proxies** — ensure WebSocket upgrade headers are passed
3. **Set long idle timeouts** — WebSocket connections are long-lived (exec sessions)
4. **Keep SPDY fallback available** — for environments that can't upgrade yet
5. **Monitor connection failures** — track WebSocket upgrade errors in API server logs

## Key Takeaways

- SPDY to WebSocket transition continues in **Kubernetes 1.36** (KEP-4006)
- `kubectl exec`, `attach`, `port-forward` use WebSocket by default
- Better compatibility with modern proxies, load balancers, and service meshes
- SPDY fallback available via `KUBECTL_REMOTE_COMMAND_WEBSOCKETS=false`
- Update proxy configurations to pass WebSocket upgrade headers
