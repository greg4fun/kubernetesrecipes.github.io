---
title: "kubeadm init: Bootstrap K8s Cluster"
description: "Bootstrap a Kubernetes cluster with kubeadm init and join. Control plane setup, worker node joining, pod network installation, and high availability configuration."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "configuration"
difficulty: "advanced"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "kubeadm"
  - "cluster-setup"
  - "installation"
  - "administration"
  - "cka"
relatedRecipes:
  - "kubernetes-kubeadm-upgrade-guide"
  - "kubernetes-certificate-management"
  - "kubernetes-kubelet-configuration"
  - "kubernetes-etcd-backup-guide"
---

> 💡 **Quick Answer:** `kubeadm init --pod-network-cidr=10.244.0.0/16` bootstraps the control plane. Then install a CNI: `kubectl apply -f calico.yaml`. Join workers: `kubeadm join <cp-ip>:6443 --token <token> --discovery-token-ca-cert-hash sha256:<hash>`. For HA: add `--control-plane-endpoint` with a load balancer and join additional control planes with `--control-plane`.

## The Problem

Setting up a Kubernetes cluster from scratch requires:

- Installing container runtime (containerd)
- Installing kubeadm, kubelet, kubectl
- Initializing the control plane
- Configuring networking (CNI)
- Joining worker nodes
- Optional: multi-control-plane HA

## The Solution

### Prerequisites (All Nodes)

```bash
# Disable swap (required for kubelet)
swapoff -a
sed -i '/ swap / s/^/#/' /etc/fstab

# Enable required kernel modules
cat <<EOF | tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF
modprobe overlay
modprobe br_netfilter

# Sysctl settings
cat <<EOF | tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sysctl --system

# Install containerd
apt-get update
apt-get install -y containerd
mkdir -p /etc/containerd
containerd config default | tee /etc/containerd/config.toml
# Set SystemdCgroup = true in config.toml
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
systemctl restart containerd

# Install kubeadm, kubelet, kubectl
apt-get install -y apt-transport-https ca-certificates curl gpg
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.30/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.30/deb/ /' | tee /etc/apt/sources.list.d/kubernetes.list
apt-get update
apt-get install -y kubelet=1.30.0-1.1 kubeadm=1.30.0-1.1 kubectl=1.30.0-1.1
apt-mark hold kubelet kubeadm kubectl
```

### Initialize Control Plane

```bash
# Basic init
kubeadm init --pod-network-cidr=10.244.0.0/16

# With configuration file (recommended)
cat <<EOF > kubeadm-config.yaml
apiVersion: kubeadm.k8s.io/v1beta3
kind: ClusterConfiguration
kubernetesVersion: v1.30.0
controlPlaneEndpoint: "cp.example.com:6443"  # For HA
networking:
  podSubnet: 10.244.0.0/16
  serviceSubnet: 10.96.0.0/12
---
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
cgroupDriver: systemd
EOF

kubeadm init --config kubeadm-config.yaml

# Set up kubectl access
mkdir -p $HOME/.kube
cp /etc/kubernetes/admin.conf $HOME/.kube/config
chown $(id -u):$(id -g) $HOME/.kube/config
```

### Install CNI (Pod Network)

```bash
# Calico
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/calico.yaml

# Or Flannel
kubectl apply -f https://github.com/flannel-io/flannel/releases/latest/download/kube-flannel.yml

# Or Cilium
helm repo add cilium https://helm.cilium.io/
helm install cilium cilium/cilium -n kube-system

# Wait for CNI pods
kubectl get pods -n kube-system -w
# calico-node-xxxxx   1/1   Running   0   30s  (one per node)

# Control plane should now be Ready
kubectl get nodes
# NAME           STATUS   ROLES           VERSION
# control-plane  Ready    control-plane   v1.30.0
```

### Join Worker Nodes

```bash
# The kubeadm init output shows the join command:
kubeadm join cp.example.com:6443 \
  --token abcdef.0123456789abcdef \
  --discovery-token-ca-cert-hash sha256:abc123...

# If token expired, generate a new one:
kubeadm token create --print-join-command
# Outputs the full join command

# Verify nodes joined
kubectl get nodes
# NAME           STATUS   ROLES           VERSION
# control-plane  Ready    control-plane   v1.30.0
# worker-1       Ready    <none>          v1.30.0
# worker-2       Ready    <none>          v1.30.0

# Label workers (optional)
kubectl label node worker-1 node-role.kubernetes.io/worker=""
kubectl label node worker-2 node-role.kubernetes.io/worker=""
```

### High Availability (Multi-CP)

```bash
# Prerequisites:
# - Load balancer in front of control planes (HAProxy, cloud LB)
# - Same --control-plane-endpoint on all CP nodes

# Init first control plane
kubeadm init \
  --control-plane-endpoint "lb.example.com:6443" \
  --upload-certs \
  --pod-network-cidr=10.244.0.0/16

# Join additional control planes (from init output)
kubeadm join lb.example.com:6443 \
  --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash> \
  --control-plane \
  --certificate-key <cert-key>

# Verify HA
kubectl get nodes
# cp-1   Ready   control-plane   v1.30.0
# cp-2   Ready   control-plane   v1.30.0
# cp-3   Ready   control-plane   v1.30.0
```

### Verify Cluster

```bash
# All nodes ready
kubectl get nodes -o wide

# System pods running
kubectl get pods -n kube-system
# coredns, kube-proxy, CNI, etcd, apiserver, controller-manager, scheduler

# Cluster info
kubectl cluster-info

# Run a test pod
kubectl run test --image=nginx:1.27 --rm -it --restart=Never -- curl -s localhost
kubectl delete pod test

# DNS test
kubectl run dnstest --image=busybox:1.36 --rm -it --restart=Never -- nslookup kubernetes
```

### Reset (Start Over)

```bash
# On each node
kubeadm reset -f
iptables -F && iptables -t nat -F && iptables -t mangle -F
rm -rf /etc/cni/net.d /var/lib/etcd /etc/kubernetes

# Then kubeadm init again
```

## Common Issues

**"kubelet is not running" during init**

Swap not disabled or containerd not configured with systemd cgroup. Check: `journalctl -u kubelet`.

**Nodes stuck NotReady**

CNI not installed. Install Calico/Flannel/Cilium after `kubeadm init`.

**Token expired for join**

Tokens expire after 24h. Generate new: `kubeadm token create --print-join-command`.

**API server not reachable from workers**

Firewall blocking port 6443. Open: 6443 (apiserver), 2379-2380 (etcd), 10250 (kubelet), 10259 (scheduler), 10257 (controller-manager).

## Best Practices

- **Use configuration file** over CLI flags — version-controlled and reproducible
- **Pin versions** — `apt-mark hold` prevents accidental upgrades
- **HA with 3+ control planes** — odd number for etcd quorum
- **Back up certificates** — `/etc/kubernetes/pki/` after init
- **Document the join command** — or use `kubeadm token create` later

## Key Takeaways

- `kubeadm init` bootstraps the control plane; `kubeadm join` adds nodes
- Must install CNI plugin after init — nodes stay NotReady without it
- Disable swap, enable kernel modules, install containerd before kubeadm
- For HA: load balancer + `--control-plane-endpoint` + 3 control planes
- CKA exam tests the full init→join→verify workflow
