---
title: "Kyverno LLM Inference Cost and Security Guardrails"
description: "Implement policy-as-code guardrails for LLM inference workloads with Kyverno: GPU quota enforcement, model size limits, cost controls, prompt injection"
tags:
  - "kyverno"
  - "llm"
  - "inference"
  - "cost-management"
  - "ai-security"
category: "security"
publishDate: "2026-05-06"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "kyverno-cel-policy-model"
  - "kyverno-ai-software-provenance"
  - "runai-fsdp-training-mistral-gpu"
  - "nim-multinode-deployment-helm-kubernetes"
---

> 💡 **Quick Answer:** Use Kyverno policies to enforce cost controls (max GPU allocation per namespace/team), security boundaries (approved model list, network egress restrictions), and operational guardrails (resource limits, node affinity) for LLM inference workloads.

## The Problem

LLM inference workloads can:

- Consume unlimited GPU resources ($10-30/hour per GPU)
- Run unapproved models (data exfiltration risk)
- Lack resource limits (noisy neighbor on shared GPU nodes)
- Access external APIs (prompt injection → data leak)
- Be deployed without proper security context

## The Solution

### GPU Cost Guardrails

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: llm-gpu-cost-guardrails
spec:
  validationFailureAction: Enforce
  rules:
    - name: max-gpus-per-inference-pod
      match:
        any:
          - resources:
              kinds:
                - Pod
              selector:
                matchLabels:
                  workload-type: inference
      validate:
        cel:
          expressions:
            - expression: |
                object.spec.containers.all(c,
                  !has(c.resources.limits) ||
                  !has(c.resources.limits['nvidia.com/gpu']) ||
                  int(c.resources.limits['nvidia.com/gpu']) <= 4
                )
              message: "Inference Pods limited to 4 GPUs max. For more, use multi-node with Run:ai."

    - name: require-gpu-limits-match-requests
      match:
        any:
          - resources:
              kinds:
                - Pod
              selector:
                matchLabels:
                  workload-type: inference
      validate:
        cel:
          expressions:
            - expression: |
                object.spec.containers.all(c,
                  !has(c.resources.limits) ||
                  !has(c.resources.limits['nvidia.com/gpu']) ||
                  c.resources.limits['nvidia.com/gpu'] == c.resources.requests['nvidia.com/gpu']
                )
              message: "GPU limits must equal requests (no overcommit for inference)"
```

### Approved Model Allowlist

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: llm-approved-models
spec:
  validationFailureAction: Enforce
  rules:
    - name: only-approved-models
      match:
        any:
          - resources:
              kinds:
                - Pod
              namespaceSelector:
                matchLabels:
                  purpose: ai-inference
      validate:
        cel:
          variables:
            - name: approvedModels
              expression: |
                [
                  'mistral-small',
                  'mistral-7b-instruct',
                  'llama-3.1-8b',
                  'llama-3.1-70b',
                  'codellama-34b',
                  'phi-3-medium'
                ]
            - name: modelEnvVars
              expression: |
                object.spec.containers.flatMap(c,
                  has(c.env) ? c.env.filter(e, e.name == 'MODEL_NAME' || e.name == 'HF_MODEL_ID') : []
                )
          expressions:
            - expression: |
                variables.modelEnvVars.size() == 0 ||
                variables.modelEnvVars.all(e,
                  variables.approvedModels.exists(m, e.value.contains(m))
                )
              message: "Only approved models may be deployed for inference. Contact ML platform team for additions."
```

### Memory Guardrails (Prevent OOM)

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: llm-memory-guardrails
spec:
  validationFailureAction: Enforce
  rules:
    - name: inference-memory-limits
      match:
        any:
          - resources:
              kinds:
                - Pod
              selector:
                matchLabels:
                  workload-type: inference
      validate:
        cel:
          expressions:
            - expression: |
                object.spec.containers.all(c,
                  has(c.resources) &&
                  has(c.resources.limits) &&
                  has(c.resources.limits.memory) &&
                  quantity(c.resources.limits.memory).compareTo(quantity('256Gi')) <= 0
                )
              message: "Inference container memory limit cannot exceed 256Gi"

            - expression: |
                object.spec.containers.all(c,
                  has(c.resources) &&
                  has(c.resources.requests) &&
                  has(c.resources.requests.memory) &&
                  quantity(c.resources.requests.memory).compareTo(quantity('2Gi')) >= 0
                )
              message: "Inference containers must request at least 2Gi memory"
```

### Network Egress Restriction (Prevent Data Exfiltration)

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: llm-network-restriction
spec:
  rules:
    - name: generate-egress-restriction
      match:
        any:
          - resources:
              kinds:
                - Namespace
              selector:
                matchLabels:
                  purpose: ai-inference
      generate:
        apiVersion: networking.k8s.io/v1
        kind: NetworkPolicy
        name: "inference-egress-restrict"
        namespace: "{{ request.object.metadata.name }}"
        synchronize: true
        data:
          spec:
            podSelector:
              matchLabels:
                workload-type: inference
            policyTypes:
              - Egress
            egress:
              # Allow DNS
              - to:
                  - namespaceSelector:
                      matchLabels:
                        kubernetes.io/metadata.name: kube-dns
                ports:
                  - port: 53
                    protocol: UDP
              # Allow model registry
              - to:
                  - ipBlock:
                      cidr: 10.0.0.0/8
                ports:
                  - port: 443
              # Block all external internet
              # (prevents prompt injection → data exfiltration)
```

### Require Security Context for Inference

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: llm-security-context
spec:
  validationFailureAction: Enforce
  rules:
    - name: inference-security-baseline
      match:
        any:
          - resources:
              kinds:
                - Pod
              selector:
                matchLabels:
                  workload-type: inference
      validate:
        cel:
          expressions:
            - expression: |
                object.spec.containers.all(c,
                  has(c.securityContext) &&
                  has(c.securityContext.allowPrivilegeEscalation) &&
                  c.securityContext.allowPrivilegeEscalation == false
                )
              message: "Inference containers must disable privilege escalation"

            - expression: |
                !has(object.spec.hostNetwork) || object.spec.hostNetwork == false
              message: "Inference Pods must not use host networking"
```

## Common Issues

### Policy blocks NIM containers
- **Cause**: NIM uses specific UID/GID and needs GPU device access
- **Fix**: Exclude NIM-specific security requirements; allow GPU device plugin volume

### Model name check too strict
- **Cause**: Model versions (e.g., `mistral-7b-instruct-v0.3`) don't exact-match
- **Fix**: Use `contains()` instead of exact match in CEL expression

### GPU limit policy blocks DRA (Dynamic Resource Allocation)
- **Cause**: DRA uses ResourceClaim instead of `nvidia.com/gpu` in limits
- **Fix**: Add alternative check for ResourceClaim-based GPU allocation

## Best Practices

1. **Separate training from inference policies** — different cost profiles
2. **Allowlist models** — prevent shadow AI deployments
3. **Block egress by default** — inference shouldn't call external APIs
4. **GPU limits = requests** — no overcommit for predictable latency
5. **Cost labels** — require `cost-center` annotation for chargeback
6. **Audit first for 2 weeks** — discover what inference patterns exist

## Key Takeaways

- Kyverno enforces GPU quotas at admission time (before scheduling)
- Model allowlists prevent unauthorized model deployment
- Network egress restriction prevents prompt injection data exfiltration
- Memory guardrails prevent OOM cascades on shared GPU nodes
- CEL `quantity()` function enables numeric comparison of resource values
- Cost control: max GPUs per Pod + per namespace ResourceQuota
- Security: no privilege escalation, no host network, egress-restricted
