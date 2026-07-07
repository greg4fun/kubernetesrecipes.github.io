---
title: "Fix OLM Subscription ResolutionFailed in Disconnected OpenShift"
description: "Fix ConstraintsNotSatisfiable and UnhealthyCatalogSourceFound errors when an OLM Subscription references a catalog that doesn't exist in your mirrored cluster."
publishDate: "2026-07-06"
author: "Luca Berton"
category: "troubleshooting"
difficulty: "advanced"
timeToComplete: "20 minutes"
kubernetesVersion: "1.28+"
tags:
  - "olm"
  - "disconnected"
  - "openshift"
  - "operators"
  - "catalogsource"
  - "troubleshooting"
relatedRecipes:
  - "oc-mirror-troubleshooting-disconnected"
  - "openshift-catalogsource-custom-operator"
  - "disconnected-environments-openshift-guide"
  - "openshift-operatorhub-disable-sources"
  - "openshift-catalogsource-filtering"
  - "mirror-registry-disconnected-openshift"
---

> 💡 **Quick Answer:** In a disconnected OpenShift cluster, the default `redhat-operators` CatalogSource doesn't exist — oc-mirror creates catalogs with names like `cs-redhat-operator-index-v4-20`. Any Subscription that still says `source: redhat-operators` fails with `ResolutionFailed: ConstraintsNotSatisfiable`, and the operator, its CSV, and its CRDs are never created. Fix it by pointing `spec.source` at the mirrored catalog: `oc patch sub <name> -n openshift-operators --type merge -p '{"spec":{"source":"cs-redhat-operator-index-v4-20"}}'`.

## The Problem

You create a Subscription in a disconnected (air-gapped) cluster — often by copying YAML from documentation, from a connected cluster, or from an old GitOps repo — and the operator never installs. The Subscription object exists and looks healthy at first glance, but its status tells a different story:

```yaml
status:
  conditions:
    - message: targeted catalogsource openshift-marketplace/redhat-operators missing
      reason: UnhealthyCatalogSourceFound
      status: 'True'
      type: CatalogSourcesUnhealthy
    - message: >-
        constraints not satisfiable: no operators found from catalog
        redhat-operators in namespace openshift-marketplace referenced by
        subscription servicemeshoperator3, subscription servicemeshoperator3 exists
      reason: ConstraintsNotSatisfiable
      status: 'True'
      type: ResolutionFailed
```

The result is a silent cascade:

| Object | State |
|---|---|
| Subscription | ✅ exists |
| InstallPlan | ❌ never created |
| CSV | ❌ never installed |
| Operator CRDs | ❌ never registered |
| Workloads depending on the CRDs | ❌ fail with `no matches for kind` |

The last row is what usually gets noticed first. For example, a component that renders an Istio `DestinationRule` fails with `no matches for kind "DestinationRule" in version "networking.istio.io/v1"` — the root cause is three layers up: the Service Mesh operator's Subscription points at a catalog that doesn't exist on this cluster.

## Why This Happens

Disconnected clusters disable the default OperatorHub sources (`redhat-operators`, `certified-operators`, `community-operators`, `redhat-marketplace`), because those pull from the internet:

```bash
oc patch operatorhub cluster --type merge \
  -p '{"spec":{"disableAllDefaultSources":true}}'
```

In their place, oc-mirror generates CatalogSource objects backed by your internal registry, with generated names:

```bash
oc get catalogsource -n openshift-marketplace
```

```
NAME                                   DISPLAY                TYPE   AGE
cs-certified-operator-index-v4-20      Certified Operators    grpc   42d
cs-community-operator-index-v4-20      Community Operators    grpc   42d
cs-redhat-operator-index-v4-20         Red Hat Operators      grpc   42d
```

OLM resolves a Subscription **only** against the exact catalog named in `spec.source`. It does not fall back to other catalogs, even if they contain the requested package. A Subscription with `source: redhat-operators` on this cluster can never resolve.

## Diagnose It

### Step 1: Confirm the operator never actually installed

```bash
# No CSV means no operator, regardless of what the Subscription says
oc get csv -A | grep -i <operator-name>

# No InstallPlan means OLM never even started the install
oc get installplan -n openshift-operators

# No CRDs means dependent workloads will fail
oc get crd | grep <operator-api-group>
```

All three empty? The Subscription is broken, not the operator.

### Step 2: Read the Subscription status

```bash
oc get subscription <name> -n openshift-operators \
  -o jsonpath='{range .status.conditions[*]}{.type}{"\t"}{.reason}{"\t"}{.message}{"\n"}{end}'
```

`ResolutionFailed` + `ConstraintsNotSatisfiable` mentioning a catalog you don't have is the signature of this problem.

### Step 3: Find which catalog actually serves the package

```bash
# Is the package available at all on this cluster?
oc get packagemanifests | grep <operator-name>

# Which CatalogSource provides it?
oc get packagemanifest <operator-name> \
  -o jsonpath='{.status.catalogSource}{"\n"}'
```

Two possible outcomes:

- **The package exists** in a `cs-*` catalog → the Subscription just points at the wrong source. Continue to the fix below.
- **The package doesn't exist** → it was never mirrored. Add it to your `ImageSetConfiguration` and re-run oc-mirror (see the last section).

## The Fix

### Option 1: Patch the existing Subscription

`spec.source` is mutable — OLM re-runs resolution after the change:

```bash
oc patch subscription <name> -n openshift-operators --type merge \
  -p '{"spec":{"source":"cs-redhat-operator-index-v4-20"}}'
```

Watch resolution recover:

```bash
oc get subscription <name> -n openshift-operators -o yaml | grep -A5 conditions
oc get installplan -n openshift-operators
```

### Option 2: Delete and recreate with the correct source

Cleaner when the Subscription came from GitOps (fix it at the source) or when resolution has been failing for a long time:

```bash
oc delete subscription <name> -n openshift-operators

# If a partial CSV exists from earlier attempts, remove it too
oc get csv -n openshift-operators | grep <operator-name>
oc delete csv <csv-name> -n openshift-operators
```

Then recreate with the mirrored catalog name. Here is a complete example installing Red Hat Connectivity Link (Kuadrant) from a mirrored catalog:

```yaml
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: rhcl-operator
  namespace: openshift-operators
spec:
  channel: stable
  name: rhcl-operator
  source: cs-redhat-operator-index-v4-20      # mirrored catalog, NOT redhat-operators
  sourceNamespace: openshift-marketplace
  installPlanApproval: Manual
  startingCSV: rhcl-operator.v1.4.1
```

```bash
oc apply -f rhcl-subscription.yaml
```

### Approve the InstallPlan (Manual approval)

With `installPlanApproval: Manual`, OLM creates the InstallPlan but waits for you:

```bash
oc get installplan -n openshift-operators
```

```
NAME            CSV                    APPROVAL   APPROVED
install-x7k2p   rhcl-operator.v1.4.1   Manual     false
```

```bash
oc patch installplan install-x7k2p -n openshift-operators \
  --type merge -p '{"spec":{"approved":true}}'
```

> ⚠️ **Note:** Manual approval applies to *all* operators sharing the namespace. In `openshift-operators`, one Manual subscription forces every co-located operator update to wait for approval. Install operators into dedicated namespaces if you want independent update policies.

### Verify the operator is really installed

```bash
# CSV must reach Succeeded
oc get csv -n openshift-operators | grep rhcl
# rhcl-operator.v1.4.1   Red Hat Connectivity Link   1.4.1   Succeeded

# CRDs are now registered
oc get crd | grep kuadrant.io
# authpolicies.kuadrant.io
# dnspolicies.kuadrant.io
# kuadrants.kuadrant.io
# ratelimitpolicies.kuadrant.io
# tlspolicies.kuadrant.io
```

Only when the CRDs exist will dependent resources (policies, gateways, meshes) stop failing with `no matches for kind`.

## Watch Out for Operator Dependencies

OLM resolves an operator's dependencies from catalogs too. Red Hat Connectivity Link, for example, requires `authorino-operator`, `dns-operator`, and `limitador-operator`. If you mirrored only the top-level package, resolution fails again — this time with `ConstraintsNotSatisfiable` naming the missing dependency.

Mirror the operator **and** its dependencies in your `ImageSetConfiguration`:

```yaml
apiVersion: mirror.openshift.io/v2alpha1
kind: ImageSetConfiguration
mirror:
  operators:
    - catalog: registry.redhat.io/redhat/redhat-operator-index:v4.20
      packages:
        - name: rhcl-operator
          channels:
            - name: stable
        - name: authorino-operator
        - name: dns-operator
        - name: limitador-operator
        - name: servicemeshoperator3
          channels:
            - name: stable
```

```bash
# Mirror-to-disk on the connected side
oc mirror -c imageset-config.yaml file:///data/mirror --v2

# Disk-to-mirror on the disconnected side
oc mirror -c imageset-config.yaml \
  --from file:///data/mirror \
  docker://registry.example.com:5000 --v2
```

Then apply the generated `CatalogSource` and `ImageDigestMirrorSet`/`ITMS` resources from the oc-mirror workspace (`working-dir/cluster-resources/`), and confirm the new packages appear:

```bash
oc get packagemanifests | grep -E 'rhcl|limitador|authorino|dns-operator'
```

## Quick Reference: Symptom → Cause

| Symptom | Cause |
|---|---|
| `targeted catalogsource ... redhat-operators missing` | Subscription references a default catalog that's disabled in disconnected clusters |
| `ConstraintsNotSatisfiable: no operators found from catalog <cs-name>` | Package (or a dependency) not mirrored into that catalog |
| Subscription exists but no InstallPlan | Resolution failing — read `status.conditions` |
| InstallPlan exists, `APPROVED false` | `installPlanApproval: Manual` — patch `spec.approved` |
| CSV `Succeeded` but workloads still fail | Wrong namespace, or workload needs a different operator's CRDs |

The golden rule for disconnected clusters: **never copy `spec.source` from documentation or a connected cluster.** Always look up the real catalog name with `oc get packagemanifest <name> -o jsonpath='{.status.catalogSource}'` first.
