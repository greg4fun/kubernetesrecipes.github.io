---
title: "How to Customize DNS Configuration in Kubernetes"
description: "Configure custom DNS settings in Kubernetes. Learn CoreDNS customization, stub domains, upstream servers, and pod DNS policies."
category: "networking"
difficulty: "intermediate"
publishDate: "2026-01-22"
tags: ["dns", "coredns", "networking", "configuration", "resolution"]
---

# How to Customize DNS Configuration in Kubernetes

Kubernetes uses CoreDNS for service discovery and DNS resolution. Learn to customize DNS settings for corporate domains, external resolvers, and specialized requirements.

## CoreDNS ConfigMap

```yaml
# View current CoreDNS config
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

## Add Custom Upstream DNS

```yaml
# coredns-custom-upstream.yaml
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

## Stub Domains for Corporate DNS

```yaml
# coredns-stub-domains.yaml
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

## Custom DNS Records (Static Entries)

```yaml
# coredns-hosts.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns-custom
  namespace: kube-system
data:
  custom.server: |
    # Static entries
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
        # Import custom hosts
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

## Pod DNS Policy Options

```yaml
# pod-dns-default.yaml - Inherits node DNS
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
# pod-dns-clusterfirst.yaml - Kubernetes DNS (default for pods)
apiVersion: v1
kind: Pod
metadata:
  name: dns-clusterfirst
spec:
  dnsPolicy: ClusterFirst  # Default
  containers:
    - name: app
      image: nginx
---
# pod-dns-none.yaml - No auto-config, use dnsConfig
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

## Custom DNS Config for Pods

```yaml
# pod-custom-dns.yaml
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

## Deployment with DNS Config

```yaml
# deployment-dns.yaml
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

## External DNS for Service Discovery

```yaml
# external-dns.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: external-dns
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: external-dns
  template:
    metadata:
      labels:
        app: external-dns
    spec:
      serviceAccountName: external-dns
      containers:
        - name: external-dns
          image: registry.k8s.io/external-dns/external-dns:v0.14.0
          args:
            - --source=service
            - --source=ingress
            - --domain-filter=example.com
            - --provider=aws
            - --policy=upsert-only
            - --aws-zone-type=public
            - --registry=txt
            - --txt-owner-id=my-cluster
```

## Headless Service DNS

```yaml
# headless-service.yaml
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

## Debug DNS Issues

```bash
# Deploy debug pod
kubectl run dns-test --image=busybox:1.28 --rm -it --restart=Never -- sh

# Test DNS resolution
nslookup kubernetes.default
nslookup myservice.mynamespace.svc.cluster.local

# Check /etc/resolv.conf
cat /etc/resolv.conf

# Test external resolution
nslookup google.com

# Test with specific nameserver
nslookup kubernetes.default 10.96.0.10
```

```bash
# Check CoreDNS pods
kubectl get pods -n kube-system -l k8s-app=kube-dns

# View CoreDNS logs
kubectl logs -n kube-system -l k8s-app=kube-dns

# Check CoreDNS metrics
kubectl port-forward -n kube-system svc/kube-dns 9153:9153
curl http://localhost:9153/metrics
```

## Optimize DNS Performance

```yaml
# coredns-optimized.yaml
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

## Summary

Kubernetes DNS is highly customizable through CoreDNS configuration. Use stub domains for corporate DNS integration, custom hosts for legacy systems, and pod dnsConfig for application-specific requirements. Monitor CoreDNS metrics and optimize cache settings for performance.
