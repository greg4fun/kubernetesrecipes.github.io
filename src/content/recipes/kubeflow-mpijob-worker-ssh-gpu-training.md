---
title: "Kubeflow MPIJob Worker SSH Setup for GPU Training"
description: "Configure SSH daemon in Kubeflow MPIJob worker pods for multi-node GPU training. Covers SSHD setup in containers, host key generation, authorized keys from MPI Operator, security context, and sleep infinity pattern for shell mode workers."
tags:
  - "mpi"
  - "ssh"
  - "openshift"
  - "gpu"
  - "training"
category: "ai"
publishDate: "2026-06-04"
author: "Luca Berton"
difficulty: "intermediate"
relatedRecipes:
  - "nccl-network-validator-production-mpijob"
  - "openmpi-control-plane-separation-nccl-rdma"
  - "nccl-all-reduce-perf-benchmark-multi-node"
---

> 💡 **Quick Answer:** Kubeflow MPI Operator requires SSH access from launcher to worker pods. Workers run in "shell" mode: start SSHD, mount operator-provided SSH keys from `/root/.ssh`, keep the container alive with `sleep infinity`. The launcher uses `ssh -o StrictHostKeyChecking=no` to connect and run `all_reduce_perf` (or training scripts) on each worker via `mpirun`.

## The Problem

- MPI Operator launcher pod needs passwordless SSH to all worker pods
- Container images don't have SSHD configured by default
- SSH host keys don't exist in fresh containers
- Authorized keys must come from the MPI Operator's generated secrets
- Workers must stay alive (not exit) while waiting for launcher commands
- OpenShift security contexts restrict port 22 binding

## The Solution

### Worker Pod Entrypoint (Shell Mode)

```bash
#!/bin/bash
# Worker pods use args: ["shell"] which triggers this code path

start_sshd_if_requested() {
  if [[ "${START_SSHD:-false}" != "true" ]]; then
    return 0
  fi

  echo "Starting SSHD for MPI worker access..."

  # Create required directories
  mkdir -p /run/sshd /var/run/sshd /tmp/sshd
  chmod 755 /run/sshd /var/run/sshd /tmp/sshd

  # Fix permissions on operator-mounted SSH keys
  if [[ -d /root/.ssh ]]; then
    chmod 700 /root/.ssh
    chmod 600 /root/.ssh/* 2>/dev/null || true
  fi

  # Generate host keys if missing
  if [[ ! -f /etc/ssh/ssh_host_rsa_key ]]; then
    ssh-keygen -A
  fi

  # Write minimal SSHD config
  cat > /tmp/sshd_config <<EOF
Port 22
ListenAddress 0.0.0.0
PermitRootLogin prohibit-password
PubkeyAuthentication yes
PasswordAuthentication no
UsePAM no
StrictModes no
PidFile /tmp/sshd/sshd.pid
AuthorizedKeysFile .ssh/authorized_keys /root/.ssh/authorized_keys
EOF

  # Validate and start
  /usr/sbin/sshd -t -f /tmp/sshd_config
  /usr/sbin/sshd -D -e -f /tmp/sshd_config &

  sleep 2
  echo "SSHD started on port 22"
}

start_sshd_if_requested

# Keep pod alive for MPI launcher
if [[ -t 0 ]]; then
  exec /bin/bash
else
  echo "Keeping pod alive for MPI launcher access..."
  exec sleep infinity
fi
```

### MPIJob Worker Spec

```yaml
Worker:
  replicas: 2
  restartPolicy: Never
  template:
    metadata:
      labels:
        app: gpu-training
        mpi-role: worker
      annotations:
        k8s.v1.cni.cncf.io/networks: sriov-rdma-net
    spec:
      subdomain: gpu-training    # Required for headless Service DNS
      containers:
        - name: worker
          image: registry.example.com/nccl-validator:v6
          args: ["shell"]        # Triggers SSHD + sleep infinity
          env:
            - name: START_SSHD
              value: "true"
          securityContext:
            runAsUser: 0         # Required for SSHD on port 22
            capabilities:
              add:
                - SYS_CHROOT     # Required by SSHD
                - NET_RAW        # Required for RDMA verbs
          volumeMounts:
            - name: dshm
              mountPath: /dev/shm
          resources:
            requests:
              nvidia.com/gpu: 2
              openshift.io/mellanoxnics: 1
            limits:
              nvidia.com/gpu: 2
              openshift.io/mellanoxnics: 1
      volumes:
        - name: dshm
          emptyDir:
            medium: Memory
            sizeLimit: 16Gi
```

### How MPI Operator Handles SSH Keys

```text
1. MPI Operator creates a Secret with SSH key pair:
   └── Secret: <mpijob-name>-ssh
       ├── id_rsa           (private key → mounted on launcher)
       └── authorized_keys  (public key → mounted on all workers)

2. Keys are mounted at /root/.ssh/ on all pods:
   Launcher: /root/.ssh/id_rsa (can SSH to workers)
   Workers:  /root/.ssh/authorized_keys (accepts launcher connections)

3. The headless Service provides DNS:
   worker-0.<subdomain>.<namespace>.svc.cluster.local
   worker-1.<subdomain>.<namespace>.svc.cluster.local

4. Launcher connects: ssh worker-0.<subdomain>.<namespace>.svc <command>
```

### Dockerfile Requirements

```dockerfile
FROM nvcr.io/nvidia/pytorch:25.11-py3

# SSH server for MPI worker communication
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Create SSH directories
RUN mkdir -p /var/run/sshd /root/.ssh && \
    chmod 700 /root/.ssh

# Copy entrypoint script
COPY validate_network.sh /opt/nccl-tests/
RUN chmod +x /opt/nccl-tests/validate_network.sh

ENTRYPOINT ["/opt/nccl-tests/validate_network.sh"]
CMD ["shell"]
```

### Verifying SSH Connectivity

```bash
# From launcher pod, verify workers are reachable:
kubectl exec -it nccl-validation-launcher -- bash

# Test SSH to worker-0
ssh -o StrictHostKeyChecking=no \
  nccl-validation-worker-0.nccl-validation.gpu-benchmark.svc \
  hostname

# Check SSHD is listening on workers
kubectl exec nccl-validation-worker-0 -- ss -lntp | grep :22

# Verify authorized keys are mounted
kubectl exec nccl-validation-worker-0 -- ls -la /root/.ssh/
```

## Common Issues

### SSHD fails: "Missing privilege separation directory"
- **Cause**: `/run/sshd` or `/var/run/sshd` doesn't exist
- **Fix**: Script creates these directories; ensure Dockerfile doesn't remove them

### "Permission denied (publickey)"
- **Cause**: SSH key permissions too open, or keys not mounted
- **Fix**: `chmod 700 /root/.ssh && chmod 600 /root/.ssh/*`; verify Secret exists

### SSHD won't bind port 22
- **Cause**: Non-root user or missing `SYS_CHROOT` capability
- **Fix**: `runAsUser: 0` + `capabilities.add: [SYS_CHROOT]`

### Workers exit immediately (not staying alive)
- **Cause**: Script doesn't reach `sleep infinity` — check for errors before
- **Fix**: Verify `START_SSHD=true` is set; check container logs for early exit

### "Host key verification failed" on SSH
- **Cause**: Default SSH client checks known_hosts
- **Fix**: `StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null` in plm_rsh_agent

## Best Practices

1. **Use `StrictModes no` in SSHD config** — container filesystems have unpredictable ownership
2. **Generate host keys at runtime** — don't bake them into images (security risk)
3. **`prohibit-password` not `yes`** — no password auth, only keys from MPI Operator
4. **`sleep infinity` not `tail -f`** — cleaner, lower resource, proper signal handling
5. **Set `subdomain` in pod spec** — required for headless Service DNS resolution
6. **`cleanPodPolicy: None`** — keep workers for log inspection after job completes
7. **16Gi `/dev/shm`** — NCCL shared memory transport needs large tmpfs

## Key Takeaways

- Workers run in "shell" mode: SSHD + sleep infinity
- MPI Operator auto-generates SSH keys as Kubernetes Secret
- `runAsUser: 0` + `SYS_CHROOT` + `NET_RAW` required for SSHD + RDMA
- SSH uses eth0 (pod network with DNS); NCCL uses net1 (SR-IOV)
- `subdomain` field enables headless Service DNS for MPI hostfile
- Workers stay alive until launcher completes; `cleanPodPolicy: None` preserves logs
- Image must include `openssh-server` and `openssh-client` packages
