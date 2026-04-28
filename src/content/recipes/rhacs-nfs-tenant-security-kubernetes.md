---
title: "RHACS NFS Tenant Security Kubernetes"
description: "Enforce NFS tenant isolation with RHACS policies. Detect direct NFS mounts, wrong StorageClass usage, privileged escalation, and cross-tenant violations."
publishDate: "2026-04-28"
author: "Luca Berton"
category: "security"
difficulty: "advanced"
timeToComplete: "25 minutes"
kubernetesVersion: "1.28+"
tags:
  - "rhacs"
  - "stackrox"
  - "nfs"
  - "multi-tenancy"
  - "security"
  - "compliance"
relatedRecipes:
  - "nfs-tenant-segregation-kubernetes"
  - "rhacs-kubernetes-security-guide"
  - "kubernetes-multi-tenancy-enterprise"
  - "kubernetes-network-policy-guide"
  - "kubernetes-audit-logging-configuration"
---

> 💡 **Quick Answer:** RHACS (Red Hat Advanced Cluster Security / StackRox) enforces NFS tenant isolation through custom policies that detect direct NFS volume mounts, wrong StorageClass usage, missing NetworkPolicy, no_root_squash risks, and privileged containers accessing storage. Deploy policies in Inform mode first, then switch to Enforce to block violations at admission time.

## The Problem

NFS tenant segregation relies on multiple Kubernetes-native controls (exports, StorageClass, ResourceQuota, NetworkPolicy). But these are declarative — they don't actively detect when:

- Someone creates a Pod with an inline NFS volume bypassing the CSI driver
- A tenant's PV is manually edited to point at another tenant's export
- NetworkPolicy is accidentally deleted, exposing the NFS server
- A privileged container mounts the host filesystem and accesses NFS data directly
- Compliance drift occurs over time as teams modify resources

RHACS provides runtime detection, admission control, and compliance auditing across all these vectors.

## The Solution

### RHACS Policy: Block Direct NFS Volume Mounts

```json
{
  "name": "NFS Direct Mount Blocked",
  "description": "Pods must use PVCs with tenant StorageClass, not inline NFS volumes",
  "severity": "HIGH_SEVERITY",
  "lifecycleStages": ["DEPLOY"],
  "eventSource": "DEPLOYMENT_EVENT",
  "enforcementActions": ["SCALE_TO_ZERO_ENFORCEMENT"],
  "policySections": [
    {
      "policyGroups": [
        {
          "fieldName": "Volume Type",
          "values": [
            {"value": "nfs"}
          ]
        }
      ]
    }
  ],
  "scope": [
    {
      "label": {
        "key": "tenant",
        "value": ""
      }
    }
  ],
  "excludedScopes": [
    {
      "namespace": "nfs-csi-driver"
    }
  ]
}
```

Apply via `roxctl`:

```bash
# Export existing policies
roxctl -e "$ROX_CENTRAL:443" policy export --name "NFS Direct Mount Blocked" > /dev/null 2>&1

# Import custom policy
roxctl -e "$ROX_CENTRAL:443" policy import nfs-direct-mount-policy.json

# Or use the RHACS API
curl -sk -X POST "https://${ROX_CENTRAL}/v1/policies" \
  -H "Authorization: Bearer ${ROX_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @nfs-direct-mount-policy.json
```

### RHACS Policy: Enforce Tenant StorageClass

```yaml
# Custom policy via RHACS declarative config
apiVersion: platform.stackrox.io/v1alpha1
kind: SecurityPolicy
metadata:
  name: enforce-tenant-storageclass
spec:
  policyName: "Tenant StorageClass Enforcement"
  description: "PVCs in tenant namespaces must use their designated StorageClass"
  severity: CRITICAL_SEVERITY
  categories:
  - "Multi-Tenancy"
  - "Storage Security"
  lifecycleStages:
  - DEPLOY
  enforcementActions:
  - SCALE_TO_ZERO_ENFORCEMENT
  policySections:
  - sectionName: "Check volume sources"
    policyGroups:
    - fieldName: "Volume Source"
      booleanOperator: OR
      values:
      - value: "nfs://"  # Catches inline NFS mounts
    - fieldName: "Mount Propagation"
      values:
      - value: "Bidirectional"  # Catches host filesystem escapes
```

### RHACS Policy: Detect Missing NetworkPolicy

```bash
# Use roxctl to check namespaces without NFS NetworkPolicy
roxctl -e "$ROX_CENTRAL:443" deployment check \
  --categories "Networking" \
  --namespace tenant-a

# Custom policy: alert when tenant namespace lacks NetworkPolicy
cat > missing-netpol-policy.json << 'EOF'
{
  "name": "Tenant Missing NFS NetworkPolicy",
  "description": "Tenant namespaces must have NetworkPolicy restricting NFS egress",
  "severity": "HIGH_SEVERITY",
  "lifecycleStages": ["DEPLOY"],
  "enforcementActions": [],
  "policySections": [
    {
      "policyGroups": [
        {
          "fieldName": "Namespace",
          "values": [
            {"value": "tenant-.*"}
          ]
        },
        {
          "fieldName": "Has Egress Network Policy",
          "negate": true,
          "values": [
            {"value": "true"}
          ]
        }
      ]
    }
  ]
}
EOF
```

### RHACS Policy: Block Privileged Storage Access

```json
{
  "name": "Privileged Container with Storage Mount",
  "description": "Privileged containers must not mount persistent volumes in tenant namespaces",
  "severity": "CRITICAL_SEVERITY",
  "lifecycleStages": ["DEPLOY"],
  "enforcementActions": ["SCALE_TO_ZERO_ENFORCEMENT"],
  "policySections": [
    {
      "policyGroups": [
        {
          "fieldName": "Privileged Container",
          "values": [{"value": "true"}]
        },
        {
          "fieldName": "Volume Type",
          "values": [
            {"value": "persistentVolumeClaim"},
            {"value": "nfs"},
            {"value": "hostPath"}
          ]
        }
      ]
    }
  ],
  "scope": [
    {"namespace": "tenant-a"},
    {"namespace": "tenant-b"},
    {"namespace": "tenant-c"}
  ]
}
```

### RHACS Compliance Scan for NFS Isolation

```bash
# Run compliance scan
roxctl -e "$ROX_CENTRAL:443" compliance trigger \
  --standard "CIS Kubernetes Benchmark"

# Check NFS-relevant compliance results
roxctl -e "$ROX_CENTRAL:443" compliance results \
  --standard "CIS Kubernetes Benchmark" \
  --output json | jq '.results[] | select(
    .control.name | test("storage|volume|network|privilege"; "i")
  ) | {control: .control.name, status: .status, cluster: .cluster.name}'
```

### Custom Compliance Check: NFS Tenant Segregation

```yaml
# RHACS compliance check ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: nfs-tenant-compliance-check
  namespace: stackrox
  labels:
    compliance.openshift.io/check: "true"
data:
  check.sh: |
    #!/bin/bash
    # NFS Tenant Segregation Compliance Check
    PASS=0
    FAIL=0
    
    echo "=== NFS Tenant Segregation Compliance ==="
    
    # Check 1: No inline NFS volumes in tenant namespaces
    for ns in $(kubectl get ns -l tenant -o name); do
      NS_NAME=$(echo $ns | cut -d/ -f2)
      NFS_VOLS=$(kubectl get pods -n $NS_NAME -o json | \
        jq '[.items[].spec.volumes[]? | select(has("nfs"))] | length')
      if [ "$NFS_VOLS" -gt 0 ]; then
        echo "FAIL: $NS_NAME has $NFS_VOLS inline NFS volumes"
        FAIL=$((FAIL+1))
      else
        echo "PASS: $NS_NAME — no inline NFS volumes"
        PASS=$((PASS+1))
      fi
    done
    
    # Check 2: All tenant PVCs use correct StorageClass
    for ns in $(kubectl get ns -l tenant -o name); do
      NS_NAME=$(echo $ns | cut -d/ -f2)
      TENANT_LABEL=$(kubectl get ns $NS_NAME -o jsonpath='{.metadata.labels.tenant}')
      WRONG_SC=$(kubectl get pvc -n $NS_NAME -o json | \
        jq -r --arg t "nfs-tenant-$TENANT_LABEL" \
        '[.items[] | select(.spec.storageClassName != $t and .spec.storageClassName != "nfs-shared-readonly")] | length')
      if [ "$WRONG_SC" -gt 0 ]; then
        echo "FAIL: $NS_NAME has $WRONG_SC PVCs with wrong StorageClass"
        FAIL=$((FAIL+1))
      else
        echo "PASS: $NS_NAME — all PVCs use correct StorageClass"
        PASS=$((PASS+1))
      fi
    done
    
    # Check 3: NetworkPolicy exists
    for ns in $(kubectl get ns -l tenant -o name); do
      NS_NAME=$(echo $ns | cut -d/ -f2)
      NP_COUNT=$(kubectl get networkpolicy -n $NS_NAME --no-headers 2>/dev/null | wc -l)
      if [ "$NP_COUNT" -eq 0 ]; then
        echo "FAIL: $NS_NAME has no NetworkPolicy"
        FAIL=$((FAIL+1))
      else
        echo "PASS: $NS_NAME — $NP_COUNT NetworkPolicies"
        PASS=$((PASS+1))
      fi
    done
    
    echo ""
    echo "Results: $PASS passed, $FAIL failed"
    [ "$FAIL" -gt 0 ] && exit 1 || exit 0
```

### RHACS Dashboard and Notifications

```bash
# Set up Slack notification for NFS policy violations
roxctl -e "$ROX_CENTRAL:443" notifier create \
  --name "NFS Violations Slack" \
  --type slack \
  --slack-webhook "https://hooks.slack.com/services/T.../B.../xxx" \
  --slack-channel "#security-alerts"

# Attach notifier to NFS policies
for policy in "NFS Direct Mount Blocked" "Privileged Container with Storage Mount" "Tenant Missing NFS NetworkPolicy"; do
  POLICY_ID=$(roxctl -e "$ROX_CENTRAL:443" policy list --output json | \
    jq -r --arg n "$policy" '.policies[] | select(.name == $n) | .id')
  roxctl -e "$ROX_CENTRAL:443" policy patch "$POLICY_ID" \
    --add-notifier "NFS Violations Slack"
done
```

## Common Issues

**Policy blocks CSI driver pods**

Exclude the NFS CSI driver namespace from tenant policies. The CSI provisioner legitimately creates NFS mounts. Add `excludedScopes` for `nfs-csi-driver` or `kube-system`.

**False positives on system namespaces**

Scope policies to tenant namespaces only using namespace labels (`tenant: a`). Don't apply tenant storage policies cluster-wide.

**Enforcement mode breaks existing deployments**

Start all policies in `INFORM` mode. Review violations for 1-2 weeks. Fix legitimate issues. Then switch to `ENFORCE` (`SCALE_TO_ZERO_ENFORCEMENT`).

## Best Practices

- **Inform before enforce** — run policies in detection mode for 2 weeks minimum
- **Scope to tenant namespaces** — use namespace labels, not cluster-wide policies
- **Exclude infrastructure** — CSI drivers, monitoring, and system namespaces need exemptions
- **Alert on compliance drift** — configure Slack/email notifications for any violation
- **Run compliance scans weekly** — catch configuration drift before it becomes an incident
- **Layer RHACS on top of native controls** — RHACS detects when Kubernetes-native controls fail

## Key Takeaways

- RHACS adds active detection and enforcement to NFS tenant isolation
- Custom policies catch direct NFS mounts, wrong StorageClass, missing NetworkPolicy, and privileged access
- Compliance scans verify all 6 layers of NFS segregation are intact
- Start in Inform mode, fix violations, then switch to Enforce
- Notification integration ensures security teams know about violations in real time
- RHACS complements Kubernetes-native controls — it's the safety net when other layers fail
