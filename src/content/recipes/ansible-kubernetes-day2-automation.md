---
draft: false
title: "Automate Kubernetes Day-2 Operations with Ansible"
description: "Use Ansible to automate Kubernetes day-2 operations — apply manifests, roll out upgrades, and reconcile cluster state with the kubernetes.core collection."
category: "deployments"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "A running Kubernetes cluster and a working kubeconfig"
  - "Ansible 2.15+ installed on the control node"
  - "Python kubernetes client (pip install kubernetes)"
  - "The kubernetes.core collection (ansible-galaxy collection install kubernetes.core)"
relatedRecipes:
  - "argocd-gitops"
  - "flux-gitops"
  - "external-secrets-operator"
  - "secrets-management-best-practices"
tags: ["ansible", "automation", "deployments", "day-2", "gitops"]
publishDate: "2026-06-07"
updatedDate: "2026-06-07"
author: "Luca Berton"
---

> 💡 **Quick Answer:** Install the `kubernetes.core` collection, point Ansible at your kubeconfig, and use the `kubernetes.core.k8s` module to apply manifests idempotently. Wrap recurring tasks (cert rotation, etcd backup, node drains) in playbooks so day-2 operations are repeatable and auditable.

## The Problem

`kubectl` is perfect for interactive work, but day-2 operations need to be **repeatable, reviewable, and runnable across many clusters**:

- **Drift** — manual `kubectl apply` runs are not tracked; the cluster diverges from intent
- **Fleet scale** — the same change must land on dev, staging, and N production clusters
- **Auditability** — compliance wants a record of *what* changed, *when*, and *by whom*
- **Sequencing** — node drains, upgrades, and backups need ordering and health checks, not a one-liner

Ansible gives you idempotent, version-controlled automation that complements (not replaces) Kubernetes operators: operators own single-cluster reconciliation, Ansible orchestrates across the fleet.

## The Solution

### Step 1: Install the kubernetes.core Collection

```bash
# Control node
pip install kubernetes
ansible-galaxy collection install kubernetes.core
```

### Step 2: Apply a Manifest Idempotently

The `kubernetes.core.k8s` module is declarative — re-running it is a no-op once the cluster matches the desired state.

```yaml
# apply-app.yml
---
- name: Deploy application to Kubernetes
  hosts: localhost
  connection: local
  gather_facts: false
  tasks:
    - name: Ensure namespace exists
      kubernetes.core.k8s:
        api_version: v1
        kind: Namespace
        name: web
        state: present

    - name: Apply the deployment manifest
      kubernetes.core.k8s:
        state: present
        src: manifests/deployment.yaml
        namespace: web
        wait: true
        wait_condition:
          type: Available
          status: "True"
        wait_timeout: 180
```

```bash
ansible-playbook apply-app.yml
```

### Step 3: Roll Out a Safe Node Upgrade

Day-2 operations like node upgrades need ordering and health gates. Run serially, cordon and drain, then uncordon — with a health check between nodes.

```yaml
# upgrade-nodes.yml
---
- name: Rolling node maintenance
  hosts: localhost
  connection: local
  gather_facts: false
  vars:
    nodes:
      - worker-1
      - worker-2
      - worker-3
  tasks:
    - name: Drain and patch each node in turn
      ansible.builtin.include_tasks: drain-one.yml
      loop: "{{ nodes }}"
      loop_control:
        loop_var: node
```

```yaml
# drain-one.yml
---
- name: Cordon {{ node }}
  kubernetes.core.k8s_drain:
    name: "{{ node }}"
    state: cordon

- name: Drain {{ node }}
  kubernetes.core.k8s_drain:
    name: "{{ node }}"
    state: drain
    delete_options:
      ignore_daemonsets: true
      delete_emptydir_data: true
      wait_timeout: 300

# ... perform your patch / kubelet upgrade here ...

- name: Uncordon {{ node }}
  kubernetes.core.k8s_drain:
    name: "{{ node }}"
    state: uncordon
```

### Step 4: Read Cluster State into Facts

Use the `k8s_info` module to drive conditional logic — for example, only act when a Deployment is unhealthy.

```yaml
- name: Get deployment status
  kubernetes.core.k8s_info:
    api_version: apps/v1
    kind: Deployment
    namespace: web
    name: frontend
  register: dep

- name: Fail if not fully available
  ansible.builtin.assert:
    that:
      - dep.resources[0].status.availableReplicas | default(0) ==
        dep.resources[0].spec.replicas
    fail_msg: "frontend is not fully rolled out"
```

## Best Practices

1. **Keep manifests in Git** — Ansible applies them; Git is the source of truth (pairs naturally with [Argo CD](/recipes/deployments/argocd-gitops/) or [Flux](/recipes/deployments/flux-gitops/) for pull-based GitOps)
2. **Make playbooks idempotent** — prefer `state: present` with `src:` over shelling out to `kubectl`
3. **Gate destructive steps** — use `wait_condition`, `assert`, and `serial`-style loops for upgrades and drains
4. **Separate secrets** — never inline credentials; integrate the [External Secrets Operator](/recipes/security/external-secrets-operator/) or Ansible Vault
5. **Test in staging** — run every day-2 playbook against a non-prod cluster with realistic data first

## Going Further

This recipe is the cookbook-sized version of a deeper topic. For the full treatment — certificate rotation, automated etcd backup with restore testing, and RBAC audit playbooks — see Luca Berton's guide to [Ansible for Kubernetes day-2 operations](https://lucaberton.com/blog/ansible-kubernetes-operators-day2/). If you are just getting started with the `kubernetes.core` modules, the worked examples in [Ansible for Kubernetes by Example](https://lucaberton.com/blog/ansible-for-kubernetes-by-example/) walk through them step by step.

Once your manifests live in Git, you can hand pull-based reconciliation to a GitOps controller and keep Ansible for the imperative, sequenced day-2 work it does best.
