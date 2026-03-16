---
title: "HAProxy Keepalived Multi-Tenant GPU Ingress"
description: "Configure HAProxy with Keepalived VIPs for per-tenant GPU cluster ingress with Jinja2 templates and per-tenant logging."
publishDate: "2026-02-26"
author: "Luca Berton"
category: "networking"
difficulty: "advanced"
tags:
  - "haproxy"
  - "keepalived"
  - "multi-tenant"
  - "vip"
  - "ingress"
  - "load-balancer"
relatedRecipes:
  - "multi-tenant-gpu-namespace-isolation"
  - "gpu-tenant-bootstrap-bundle"
  - "gpu-tenant-slo-observability"
  - "gpu-tenant-monitoring-chargeback"
  - "sriov-mixed-nic-gpu-nodes"
---

> 💡 **Quick Answer:** Deploy HAProxy + Keepalived with per-tenant VIPs, NodePort backends, and rsyslog logging to `/var/log/haproxy-<tenant>.log`. Templatize with Jinja2 — adding a tenant = adding a dict entry.

## The Problem

In multi-tenant GPU clusters, each team needs its own ingress endpoint for model serving, notebooks, and APIs. Sharing a single ingress creates noisy-neighbor issues, makes per-tenant monitoring impossible, and complicates access control.

## The Solution

HAProxy with Keepalived provides dedicated VIPs per tenant. Each tenant gets its own frontend, backend, and log file. Jinja2 templates make tenant addition a one-line config change.

### Keepalived Configuration

```yaml
# keepalived.conf (managed via ConfigMap or Ansible)
vrrp_instance VI_APPS {
    state MASTER
    interface ens192
    virtual_router_id 51
    priority 100
    advert_int 1
    authentication {
        auth_type PASS
        auth_pass k8sgpu
    }
    virtual_ipaddress {
        10.0.100.10/24    # tenant-alpha VIP
        10.0.100.11/24    # tenant-beta VIP
        10.0.100.12/24    # tenant-gamma VIP
    }
}
```

### HAProxy Jinja2 Template

```jinja2
# haproxy.cfg.j2
global
    log /dev/log local0
    maxconn 4096
    daemon

defaults
    log     global
    mode    http
    option  httplog
    timeout connect 5s
    timeout client  300s
    timeout server  300s

{% for tenant in tenants %}
# === Tenant: {{ tenant.name }} ===
frontend ft_{{ tenant.name }}
    bind {{ tenant.vip }}:443 ssl crt /etc/haproxy/certs/{{ tenant.name }}.pem
    log /dev/log local{{ tenant.log_facility }} info
    default_backend bk_{{ tenant.name }}
    http-request set-header X-Tenant-ID {{ tenant.name }}
    # Per-tenant rate limiting
    stick-table type ip size 100k expire 30s store http_req_rate(10s)
    http-request deny deny_status 429 if { sc_http_req_rate(0) gt {{ tenant.rate_limit | default(100) }} }

backend bk_{{ tenant.name }}
    balance roundrobin
{% for node in gpu_nodes %}
    server {{ node.name }} {{ node.ip }}:{{ tenant.nodeport }} check
{% endfor %}

{% endfor %}
```

### Tenant Configuration (Ansible vars)

```yaml
# group_vars/all.yml
tenants:
  - name: alpha
    vip: 10.0.100.10
    nodeport: 30001
    log_facility: 1
    rate_limit: 200
    team: "ML Training"
  - name: beta
    vip: 10.0.100.11
    nodeport: 30002
    log_facility: 2
    rate_limit: 100
    team: "Inference Serving"
  - name: gamma
    vip: 10.0.100.12
    nodeport: 30003
    log_facility: 3
    rate_limit: 150
    team: "Research"

gpu_nodes:
  - name: gpu-worker-1
    ip: 10.0.1.101
  - name: gpu-worker-2
    ip: 10.0.1.102
  - name: gpu-worker-3
    ip: 10.0.1.103
```

### Per-Tenant rsyslog Logging

```bash
# /etc/rsyslog.d/49-haproxy-tenants.conf
local1.* /var/log/haproxy-alpha.log
local2.* /var/log/haproxy-beta.log
local3.* /var/log/haproxy-gamma.log
```

### NodePort Services in OpenShift

```yaml
apiVersion: v1
kind: Service
metadata:
  name: model-serving
  namespace: tenant-alpha
spec:
  type: NodePort
  selector:
    app: inference-server
  ports:
    - port: 8080
      targetPort: 8080
      nodePort: 30001
```

```mermaid
graph TD
    A[Client] --> B[Keepalived VIP 10.0.100.10]
    A --> C[Keepalived VIP 10.0.100.11]
    
    B --> D[HAProxy frontend: tenant-alpha]
    C --> E[HAProxy frontend: tenant-beta]
    
    D --> F[NodePort 30001 on GPU nodes]
    E --> G[NodePort 30002 on GPU nodes]
    
    F --> H[tenant-alpha pods]
    G --> I[tenant-beta pods]
    
    D -->|rsyslog| J[/var/log/haproxy-alpha.log]
    E -->|rsyslog| K[/var/log/haproxy-beta.log]
```

## Common Issues

- **VIP not reachable** — verify Keepalived VRRP is running; check `ip addr show` for VIP; ensure firewall allows VRRP (protocol 112)
- **Backend health checks failing** — NodePort service must be type NodePort; verify pods are running in tenant namespace
- **Per-tenant logs not splitting** — rsyslog facility numbers must match HAProxy config; restart rsyslog after adding rules
- **SSL certificate mismatch** — each tenant frontend needs its own certificate; use wildcard or per-tenant certs

## Best Practices

- One VIP per tenant for full traffic isolation and independent monitoring
- Jinja2 templates ensure consistent config — add tenant = add dict entry
- Per-tenant log files enable independent troubleshooting and SLO tracking
- Rate limiting per frontend prevents one tenant from overwhelming shared infrastructure
- Use health checks on all backend servers for automatic failover
- Keepalived provides HA — if primary HAProxy fails, backup takes over VIPs

## Key Takeaways

- HAProxy + Keepalived provides per-tenant VIP isolation on bare metal
- Jinja2 templates make tenant addition a single dict entry change
- Per-tenant rsyslog splitting enables independent p50/p95 latency monitoring
- NodePort backends route to tenant-specific services in isolated namespaces
- Rate limiting per frontend prevents cross-tenant resource exhaustion
