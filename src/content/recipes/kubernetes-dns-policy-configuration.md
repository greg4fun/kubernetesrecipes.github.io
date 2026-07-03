---
title: "DNS Policy Configuration Kubernetes"
description: "Configure Kubernetes DNS policies: Default, ClusterFirst, ClusterFirstWithHostNet, and None. Custom resolv.conf, ndots tuning, and DNS performance."
publishDate: "2026-04-25"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - "dns"
  - "dns-policy"
  - "coredns"
  - "resolv-conf"
relatedRecipes:
  - "dns-resolution-failure-pods"
  - "kubernetes-dns-services-guide"
  - "kubernetes-coredns-troubleshooting"
---

> 💡 **Quick Answer:** Customize pod DNS with `spec.dnsPolicy` and `spec.dnsConfig`. Use `ClusterFirst` (default), `ClusterFirstWithHostNet`, `Default` (node's DNS), or `None` (fully custom). Add nameservers and searches via `dnsConfig.nameservers` and `dnsConfig.searches`.
>
> **Key config:** For corporate domains, edit the CoreDNS ConfigMap with `forward corp.example.com 10.0.0.53` for stub domains.
>
> **Gotcha:** `ndots:5` default causes up to 5 DNS lookups before trying the absolute name — reduce to `ndots:2` for external-heavy workloads.

## The Problem

Kubernetes uses CoreDNS for service discovery and DNS resolution, but the defaults don't fit every environment — corporate domains need stub-domain forwarding, external-heavy workloads suffer from `ndots` overhead, and some pods need to bypass cluster DNS entirely.

## The Solution

### CoreDNS ConfigMap

```yaml
# kubectl get configmap coredns -n kube-system -o yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    .:53 {
        errors
        health {
           lameduck 5s
        }
        ready
        kubernetes cluster.local in-addr.arpa ip6.arpa {
           pods insecure
           fallthrough in-addr.arpa ip6.arpa
           ttl 30
        }
        prometheus :9153
        forward . /etc/resolv.conf {
           max_concurrent 1000
        }
        cache 30
        loop
        reload
        loadbalance
    }
```

### Add Custom Upstream DNS

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    .:53 {
        errors
        health
        ready
        kubernetes cluster.local in-addr.arpa ip6.arpa {
           pods insecure
           fallthrough in-addr.arpa ip6.arpa
        }
        prometheus :9153
        # Custom upstream DNS servers
        forward . 8.8.8.8 8.8.4.4 {
           max_concurrent 1000
           policy sequential
        }
        cache 30
        loop
        reload
        loadbalance
    }
```

### Stub Domains for Corporate DNS

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    # Corporate domain forwarding
    corp.example.com:53 {
        errors
        cache 30
        forward . 10.0.0.10 10.0.0.11 {
           policy round_robin
        }
    }

    # Internal services domain
    internal.mycompany.com:53 {
        errors
        cache 30
        forward . 192.168.1.53
    }

    # Default zone
    .:53 {
        errors
        health
        ready
        kubernetes cluster.local in-addr.arpa ip6.arpa {
           pods insecure
           fallthrough in-addr.arpa ip6.arpa
        }
        prometheus :9153
        forward . /etc/resolv.conf
        cache 30
        loop
        reload
        loadbalance
    }
```

### Custom DNS Records (Static Entries)

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns-custom
  namespace: kube-system
data:
  custom.server: |
    hosts {
      10.0.0.100 legacy-db.example.com
      10.0.0.101 legacy-api.example.com
      10.0.0.102 printer.office.local
      fallthrough
    }
```

```yaml
# Reference in CoreDNS config
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    .:53 {
        errors
        health
        ready
        import /etc/coredns/custom/*.server
        kubernetes cluster.local in-addr.arpa ip6.arpa {
           pods insecure
           fallthrough in-addr.arpa ip6.arpa
        }
        prometheus :9153
        forward . /etc/resolv.conf
        cache 30
        loop
        reload
        loadbalance
    }
```

### Pod DNS Policy Options

```yaml
# Inherits node DNS
apiVersion: v1
kind: Pod
metadata:
  name: dns-default
spec:
  dnsPolicy: Default
  containers:
    - name: app
      image: nginx
---
# Kubernetes DNS (default for pods)
apiVersion: v1
kind: Pod
metadata:
  name: dns-clusterfirst
spec:
  dnsPolicy: ClusterFirst
  containers:
    - name: app
      image: nginx
---
# No auto-config, fully custom via dnsConfig
apiVersion: v1
kind: Pod
metadata:
  name: dns-none
spec:
  dnsPolicy: None
  dnsConfig:
    nameservers:
      - 8.8.8.8
      - 8.8.4.4
    searches:
      - default.svc.cluster.local
      - svc.cluster.local
      - cluster.local
    options:
      - name: ndots
        value: "2"
      - name: edns0
  containers:
    - name: app
      image: nginx
```

### Custom DNS Config for Pods

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: custom-dns-pod
spec:
  dnsPolicy: ClusterFirst
  dnsConfig:
    nameservers:
      - 10.0.0.53  # Additional nameserver
    searches:
      - mycompany.local
      - prod.mycompany.local
    options:
      - name: ndots
        value: "5"      # Higher ndots for short names
      - name: timeout
        value: "3"      # Query timeout seconds
      - name: attempts
        value: "2"      # Retry attempts
      - name: single-request-reopen
  containers:
    - name: app
      image: nginx
```

### Deployment with DNS Config

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-with-dns
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      dnsPolicy: ClusterFirst
      dnsConfig:
        options:
          - name: ndots
            value: "2"
          - name: single-request-reopen
      containers:
        - name: app
          image: myapp:v1
```

### Headless Service DNS

```yaml
apiVersion: v1
kind: Service
metadata:
  name: database
spec:
  clusterIP: None  # Headless
  selector:
    app: postgres
  ports:
    - port: 5432
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: database
  replicas: 3
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:15
```

DNS records created:
- `database.default.svc.cluster.local` → All pod IPs
- `postgres-0.database.default.svc.cluster.local` → Pod 0 IP
- `postgres-1.database.default.svc.cluster.local` → Pod 1 IP
- `postgres-2.database.default.svc.cluster.local` → Pod 2 IP

### Optimize DNS Performance

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    .:53 {
        errors
        health
        ready
        kubernetes cluster.local in-addr.arpa ip6.arpa {
           pods insecure
           fallthrough in-addr.arpa ip6.arpa
           ttl 60  # Increased TTL
        }
        prometheus :9153
        forward . 8.8.8.8 8.8.4.4 {
           max_concurrent 2000
           policy random
           health_check 5s
        }
        cache {
           success 9984 300  # Cache up to 9984 entries for 5 min
           denial 9984 60    # Cache negative responses for 1 min
        }
        loop
        reload 10s
        loadbalance round_robin
    }
```

## Debug DNS Issues

```bash
kubectl run dns-test --image=busybox:1.28 --rm -it --restart=Never -- sh

nslookup kubernetes.default
nslookup myservice.mynamespace.svc.cluster.local
cat /etc/resolv.conf
nslookup google.com
nslookup kubernetes.default 10.96.0.10
```

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system -l k8s-app=kube-dns
kubectl port-forward -n kube-system svc/kube-dns 9153:9153
curl http://localhost:9153/metrics
```

## Common Issues

**Configuration not applying**

Verify the ConfigMap edit was actually picked up — CoreDNS watches its ConfigMap and reloads via the `reload` plugin, but changes can take up to 30s. Check `kubectl logs -n kube-system -l k8s-app=kube-dns` for reload confirmation.

**Stub domain forwarding not working**

Zone blocks in the Corefile are matched by longest suffix; make sure the corporate zone block appears before (or independent of) the default `.:53` block, and that the forwarded nameserver is actually reachable from CoreDNS pods.

## Best Practices

- **Lower `ndots` for external-heavy workloads** — default `ndots:5` triggers up to 4 wasted search-domain lookups per external name
- **Use stub domains, not full ConfigMap forwarding**, for corporate DNS — keeps cluster-internal resolution isolated
- **Increase cache TTL** for stable environments to cut CoreDNS query volume
- **Monitor CoreDNS metrics** (`:9153/metrics`) for `coredns_dns_response_rcode_count_total` and forward latency
- **Use `dnsPolicy: None` sparingly** — only when a pod genuinely needs to bypass cluster DNS

## Key Takeaways

- `dnsPolicy` controls the DNS behavior tier; `dnsConfig` fine-tunes nameservers, searches, and options
- Stub domains via CoreDNS Corefile zone blocks route specific domains to specific upstream resolvers
- `ndots` tuning is the single biggest DNS-latency lever for external-heavy workloads
- Headless Services get per-pod DNS records automatically via StatefulSet ordinals
- CoreDNS metrics on port 9153 are the primary tool for diagnosing DNS performance issues

---

## 📘 Go Further with Kubernetes Recipes

**Love this recipe? There's so much more!** This is just one of **100+ hands-on recipes** in our comprehensive **[Kubernetes Recipes book](https://amzn.to/3DzC8QA)**.

Inside the book, you'll master:
- ✅ Production-ready deployment strategies
- ✅ Advanced networking and security patterns  
- ✅ Observability, monitoring, and troubleshooting
- ✅ Real-world best practices from industry experts

> *"The practical, recipe-based approach made complex Kubernetes concepts finally click for me."*

**👉 [Get Your Copy Now](https://amzn.to/3DzC8QA)** — Start building production-grade Kubernetes skills today!
