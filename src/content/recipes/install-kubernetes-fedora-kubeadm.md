---
title: "Install Kubernetes on Fedora with kubeadm"
description: "Step-by-step guide to install Kubernetes on Fedora Linux using kubeadm. Disable swap, configure containerd, install kubeadm kubelet kubectl."
category: "configuration"
publishDate: "2026-04-20"
author: "Luca Berton"
difficulty: "intermediate"
timeToComplete: "30 minutes"
kubernetesVersion: "1.30+"
tags: ["fedora", "kubeadm", "install", "containerd", "linux"]
relatedRecipes:
  - kubernetes-release-cycle-version-support
  - kind-local-kubernetes
  - kubernetes-install-debian
---

> 💡 **Quick Answer:** On Fedora: disable swap, enable kernel modules (br_netfilter, overlay), install containerd, add Kubernetes yum repo, install kubeadm/kubelet/kubectl, then run `kubeadm init`. Fedora uses dnf and has SELinux enabled by default.

## The Problem

Installing Kubernetes on Fedora requires Fedora-specific steps:
- dnf package manager (not apt)
- SELinux is enforcing by default
- firewalld is active
- cgroups v2 is default (requires containerd ≥ 1.5)

## The Solution

### Prerequisites

```bash
# Disable swap (required for kubelet)
sudo swapoff -a
sudo sed -i '/swap/d' /etc/fstab

# Load kernel modules
cat <<EOF | sudo tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF
sudo modprobe overlay
sudo modprobe br_netfilter

# Sysctl settings
cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward = 1
EOF
sudo sysctl --system
```

### Configure SELinux

```bash
# Option 1: Set to permissive (simpler)
sudo setenforce 0
sudo sed -i 's/^SELINUX=enforcing$/SELINUX=permissive/' /etc/selinux/config

# Option 2: Keep enforcing (more secure, requires container-selinux)
sudo dnf install -y container-selinux
```

### Configure Firewall

```bash
# Control plane node
sudo firewall-cmd --permanent --add-port=6443/tcp      # API server
sudo firewall-cmd --permanent --add-port=2379-2380/tcp # etcd
sudo firewall-cmd --permanent --add-port=10250/tcp     # kubelet
sudo firewall-cmd --permanent --add-port=10259/tcp     # kube-scheduler
sudo firewall-cmd --permanent --add-port=10257/tcp     # kube-controller-manager
sudo firewall-cmd --reload

# Worker nodes
sudo firewall-cmd --permanent --add-port=10250/tcp     # kubelet
sudo firewall-cmd --permanent --add-port=10256/tcp     # kube-proxy
sudo firewall-cmd --permanent --add-port=30000-32767/tcp # NodePort
sudo firewall-cmd --reload
```

### Install containerd

```bash
# Install containerd
sudo dnf install -y containerd

# Generate default config
sudo mkdir -p /etc/containerd
containerd config default | sudo tee /etc/containerd/config.toml

# Enable SystemdCgroup (required for cgroups v2 on Fedora)
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml

# Start containerd
sudo systemctl enable --now containerd
```

### Install kubeadm, kubelet, kubectl

```bash
# Add Kubernetes repository
cat <<EOF | sudo tee /etc/yum.repos.d/kubernetes.repo
[kubernetes]
name=Kubernetes
baseurl=https://pkgs.k8s.io/core:/stable:/v1.33/rpm/
enabled=1
gpgcheck=1
gpgkey=https://pkgs.k8s.io/core:/stable:/v1.33/rpm/repodata/repomd.xml.key
exclude=kubelet kubeadm kubectl cri-tools kubernetes-cni
EOF

# Install
sudo dnf install -y kubelet kubeadm kubectl --disableexcludes=kubernetes

# Enable kubelet (will start after kubeadm init)
sudo systemctl enable kubelet
```

### Initialize Control Plane

```bash
# Initialize cluster
sudo kubeadm init \
  --pod-network-cidr=10.244.0.0/16 \
  --cri-socket=unix:///run/containerd/containerd.sock

# Configure kubectl for current user
mkdir -p $HOME/.kube
sudo cp /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config

# Install CNI (Calico example)
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.28.0/manifests/calico.yaml

# Verify
kubectl get nodes
# NAME      STATUS   ROLES           AGE   VERSION
# fedora1   Ready    control-plane   2m    v1.33.0
```

### Join Worker Nodes

```bash
# On worker nodes (after installing containerd + kubeadm):
sudo kubeadm join <control-plane-ip>:6443 \
  --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash>

# Regenerate join command if lost:
kubeadm token create --print-join-command
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| kubelet won't start | Swap still enabled | Verify `free -h` shows 0 swap |
| containerd cgroup error | SystemdCgroup not set | Edit `config.toml`, restart containerd |
| SELinux denials | Enforcing mode + missing policy | Set permissive or install container-selinux |
| Connection refused :6443 | Firewall blocking | Open ports with firewall-cmd |
| coredns pending | No CNI installed | Apply Calico/Flannel/Cilium manifest |
| "cgroup driver mismatch" | Fedora uses cgroupv2 | Ensure `SystemdCgroup = true` in containerd |

## Best Practices

1. **Use cgroups v2 with SystemdCgroup** — Fedora's default, most reliable
2. **Keep SELinux enforcing** if possible — better security posture
3. **Pin Kubernetes version** — avoid surprise upgrades with `--disableexcludes`
4. **Use Cilium CNI on Fedora** — eBPF works well with Fedora's modern kernel
5. **Automate with Ansible** — reproducible across multiple Fedora nodes

## Key Takeaways

- Fedora uses dnf, SELinux enforcing, firewalld, and cgroups v2 by default
- `SystemdCgroup = true` in containerd is mandatory for Fedora
- Kubernetes yum repo at `pkgs.k8s.io` replaces the old Google repo
- Open firewall ports BEFORE `kubeadm init` — otherwise nodes can't communicate
- Disable swap permanently via fstab — kubelet refuses to start with swap on
