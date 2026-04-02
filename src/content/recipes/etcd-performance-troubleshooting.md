---
title: "Debug etcd Performance Issues"
description: "Diagnose slow etcd causing API latency and leader election storms. Check disk IOPS, compaction, defrag, and network latency."
publishDate: "2026-03-19"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "advanced"
timeToComplete: "15 minutes"
kubernetesVersion: "1.28+"
tags:
  - etcd
  - performance
  - latency
  - disk-io
  - cluster
relatedRecipes:
  - "fix-certificate-expiration-cluster"
  - "node-not-ready-troubleshooting"
---
> 💡 **Quick Answer:** Slow etcd is almost always a disk I/O problem. Check `etcdctl endpoint status` for Raft index lag, `iostat` for disk latency, and etcd metrics for `etcd_disk_wal_fsync_duration_seconds`. Target: WAL fsync p99 < 10ms. Fix: use dedicated SSD/NVMe for etcd data, defragment, and compact.

## The Problem

The Kubernetes API server is slow. `kubectl` commands take 5-30 seconds instead of milliseconds. Pods take minutes to schedule. You see `etcdserver: request timed out` or `etcdserver: leader changed` in API server logs. The root cause is etcd performance degradation.

## The Solution

### Step 1: Check etcd Health

```bash
# On a master node or etcd pod
etcdctl endpoint health --cluster
# https://10.0.1.10:2379 is healthy: successfully committed proposal: took = 3.456ms
# https://10.0.1.11:2379 is healthy: successfully committed proposal: took = 2.123ms
# https://10.0.1.12:2379 is healthy: successfully committed proposal: took = 45.678ms ← SLOW

# Check endpoint status
etcdctl endpoint status --cluster -w table
# Shows: DB SIZE, LEADER, RAFT INDEX, RAFT APPLIED INDEX
```

### Step 2: Check Disk Performance

```bash
# On the slow etcd node
iostat -xz 1 5
# Look for: await > 10ms on the etcd disk → too slow

# Check specifically the etcd data directory
# OpenShift: /var/lib/etcd
fio --rw=write --ioengine=sync --fdatasync=1 --directory=/var/lib/etcd     --size=22m --bs=2300 --name=etcd-bench
# Target: fdatasync p99 < 10ms
```

### Step 3: Check etcd Metrics

```bash
# Key metrics (via Prometheus or direct curl)
# WAL fsync latency — most critical
curl -s http://localhost:2379/metrics | grep etcd_disk_wal_fsync_duration_seconds

# Backend commit latency
curl -s http://localhost:2379/metrics | grep etcd_disk_backend_commit_duration_seconds

# Network latency between peers
curl -s http://localhost:2379/metrics | grep etcd_network_peer_round_trip_time_seconds
```

### Step 4: Compact and Defragment

```bash
# Get current revision
REV=$(etcdctl endpoint status -w json | jq -r '.[0].Status.header.revision')

# Compact old revisions
etcdctl compact "$REV"

# Defragment each member (one at a time!)
etcdctl defrag --endpoints=https://10.0.1.10:2379
etcdctl defrag --endpoints=https://10.0.1.11:2379
etcdctl defrag --endpoints=https://10.0.1.12:2379

# Check DB size after
etcdctl endpoint status -w table
```

### Step 5: Long-Term Fixes

```yaml
# Dedicated SSD/NVMe for etcd (must be low-latency)
# On bare metal: separate physical disk
# On cloud: io2 EBS (AWS), pd-ssd (GCP), Premium SSD (Azure)

# Increase etcd snapshot count (reduces compaction frequency)
# In etcd configuration:
ETCD_SNAPSHOT_COUNT: "10000"   # Default: 100000

# Separate etcd network from pod network
# Use dedicated NICs for etcd peer communication
```

## Common Issues

### Leader Election Storms

If you see frequent `leader changed` messages, check network latency between etcd members:
```bash
# From each etcd node, ping the others
ping -c 10 <other-etcd-node>
# Latency should be < 2ms for etcd peers
```

### DB Size Growing Continuously

```bash
# Check alarm status
etcdctl alarm list
# If NOSPACE alarm is active:
etcdctl alarm disarm
etcdctl compact $(etcdctl endpoint status -w json | jq '.[0].Status.header.revision')
etcdctl defrag
```

## Best Practices

- **Dedicated low-latency storage** — NVMe or SSD with < 10ms p99 fsync
- **3 or 5 etcd members** — more members increase write latency
- **Monitor WAL fsync duration** — alert if p99 > 10ms
- **Schedule regular compaction** — etcd auto-compacts but defrag is manual
- **Keep etcd DB under 8GB** — performance degrades with large databases
- **Separate etcd traffic** — use dedicated network for peer communication

## Key Takeaways

- etcd performance = disk I/O performance (WAL fsync is the bottleneck)
- Target: WAL fsync p99 < 10ms, backend commit < 25ms
- Compact + defragment to reclaim space and improve read performance
- Leader election storms indicate network latency between members
- Always use dedicated SSD/NVMe — shared storage kills etcd performance
