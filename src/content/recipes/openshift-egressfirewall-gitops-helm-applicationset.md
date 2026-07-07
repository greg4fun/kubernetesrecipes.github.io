---
title: "OpenShift EgressFirewall with Helm ApplicationSet"
description: "Generate tenant-specific OVN-Kubernetes EgressFirewall objects from inventory files using Helm and OpenShift GitOps ApplicationSet."
publishDate: "2026-07-07"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "25 minutes"
kubernetesVersion: "1.28+"
tags:
  - "openshift"
  - "egressfirewall"
  - "ovn-kubernetes"
  - "gitops"
  - "argocd"
  - "helm"
relatedRecipes:
  - "openshift-gitops-kustomize"
  - "kubernetes-network-policy-guide"
  - "kubernetes-networkpolicy-default-deny-egress"
  - "verify-ovn-underlay-interface"
---

> 💡 **Quick Answer:** Put tenant egress destinations in small YAML inventory files, render one OVN-Kubernetes `EgressFirewall` per namespace with a Helm chart, and let an Argo CD ApplicationSet create one application per tenant. Keep allow rules before deny rules because `EgressFirewall` evaluates rules in order.

## The Problem

In multi-tenant OpenShift clusters, each tenant namespace often needs the same baseline egress controls plus a few tenant-specific exceptions:

- Allow cluster platform services
- Allow shared object storage endpoints
- Deny broad storage or infrastructure ranges by default
- Allow tenant-specific NFS or data-service ranges
- Apply the same policy to several namespaces owned by the same tenant

Copying `EgressFirewall` manifests by hand does not scale. It also creates an easy failure mode: one namespace gets a new exception and another namespace from the same tenant is forgotten.

The pattern below keeps the firewall template stable and moves tenant-specific CIDRs into inventory files.

## Assumptions

This recipe uses anonymized tenant names and documentation-only IP ranges:

| Purpose | Example range |
|---|---|
| Platform services | `192.0.2.0/24` |
| Object storage | `198.51.100.0/24` |
| File services | `203.0.113.0/24` |

Replace these ranges with your real internal CIDRs before applying the manifests.

## Repository Layout

```text
resources/networking/
├── applicationsets/
│   └── egressfirewall-appset.yaml
├── charts/
│   └── egressfirewall/
│       ├── Chart.yaml
│       ├── values.yaml
│       └── templates/
│           └── egressfirewall.yaml
└── tenants/
    ├── team-alpha-dev.yaml
    ├── team-beta-dev.yaml
    └── team-gamma-dev.yaml
```

## Create the Helm Chart

```yaml
# resources/networking/charts/egressfirewall/Chart.yaml
apiVersion: v2
name: egressfirewall
description: Tenant EgressFirewall rules for OpenShift OVN-Kubernetes
type: application
version: 1.0.0
```

```yaml
# resources/networking/charts/egressfirewall/values.yaml
tenant: ""
s3: []
nfs: []
namespaces: []
```

The chart renders one `EgressFirewall` named `default` in every namespace listed for the tenant:

```yaml
# resources/networking/charts/egressfirewall/templates/egressfirewall.yaml
{{- range .Values.namespaces }}
---
apiVersion: k8s.ovn.org/v1
kind: EgressFirewall
metadata:
  name: default
  namespace: {{ . }}
spec:
  egress:
    # Platform control-plane and shared services
    - type: Allow
      to:
        cidrSelector: 192.0.2.10/32
    - type: Allow
      to:
        cidrSelector: 192.0.2.20/32
    - type: Allow
      to:
        cidrSelector: 192.0.2.21/32
    - type: Allow
      to:
        cidrSelector: 192.0.2.22/32

    # Shared object storage endpoints
    - type: Allow
      to:
        cidrSelector: 198.51.100.10/32
    - type: Allow
      to:
        cidrSelector: 198.51.100.16/29

    # Tenant-specific object storage ranges
{{- range $.Values.s3 }}
    - type: Allow
      to:
        cidrSelector: {{ . }}
{{- end }}

    # Deny the rest of the object storage network
    - type: Deny
      to:
        cidrSelector: 198.51.100.0/24

    # Tenant-specific file service ranges
{{- range $.Values.nfs }}
    - type: Allow
      to:
        cidrSelector: {{ . }}
{{- end }}

    # Deny the rest of the file services network
    - type: Deny
      to:
        cidrSelector: 203.0.113.0/24

    # Allow an internal metadata or policy service after storage denies
    - type: Allow
      to:
        cidrSelector: 192.0.2.50/32
{{- end }}
```

The ordering is deliberate. `EgressFirewall` rules are evaluated from top to bottom, so specific `Allow` entries must appear before broader `Deny` entries.

## Add Tenant Inventory Files

Each tenant file supplies only the variable parts: tenant name, allowed object-storage CIDRs, allowed file-service CIDRs, and namespaces.

```yaml
# resources/networking/tenants/team-alpha-dev.yaml
tenant: team-alpha-dev
s3:
  - 198.51.100.32/29
  - 198.51.100.40/30
nfs:
  - 203.0.113.32/29
  - 203.0.113.40/30
namespaces:
  - team-alpha-dev-project-001
  - team-alpha-dev-workspace
```

```yaml
# resources/networking/tenants/team-beta-dev.yaml
tenant: team-beta-dev
s3:
  - 198.51.100.48/29
  - 198.51.100.56/30
nfs:
  - 203.0.113.48/29
  - 203.0.113.56/30
namespaces:
  - team-beta-dev-project-001
  - team-beta-dev-workspace
```

```yaml
# resources/networking/tenants/team-gamma-dev.yaml
tenant: team-gamma-dev
s3:
  - 198.51.100.64/29
  - 198.51.100.72/30
nfs:
  - 203.0.113.64/29
  - 203.0.113.72/30
namespaces:
  - team-gamma-dev-workspace
```

## Create the ApplicationSet

The Git file generator reads every tenant YAML file. Go templating is enabled so the template can iterate over `s3`, `nfs`, and `namespaces`.

```yaml
# resources/networking/applicationsets/egressfirewall-appset.yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: tenant-egressfirewalls
  namespace: openshift-gitops
spec:
  goTemplate: true
  goTemplateOptions:
    - missingkey=error
  generators:
    - git:
        repoURL: https://git.example.com/platform/gitops.git
        revision: main
        files:
          - path: resources/networking/tenants/*.yaml
  template:
    metadata:
      name: '{{ .tenant }}-egressfirewalls'
    spec:
      project: default
      source:
        repoURL: https://git.example.com/platform/gitops.git
        targetRevision: main
        path: resources/networking/charts/egressfirewall
        helm:
          values: |
            tenant: {{ .tenant }}
            s3:
            {{ range .s3 }}
              - {{ . }}
            {{ end }}
            nfs:
            {{ range .nfs }}
              - {{ . }}
            {{ end }}
            namespaces:
            {{ range .namespaces }}
              - {{ . }}
            {{ end }}
      destination:
        server: https://kubernetes.default.svc
        namespace: openshift-gitops
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

## Apply It

Commit the chart, tenant files, and ApplicationSet to your GitOps repository, then apply the ApplicationSet:

```bash
oc apply -f resources/networking/applicationsets/egressfirewall-appset.yaml
```

Check that Argo CD created one application per tenant:

```bash
oc get applications.argoproj.io -n openshift-gitops | grep egressfirewalls
```

Expected shape:

```text
team-alpha-dev-egressfirewalls   Synced   Healthy
team-beta-dev-egressfirewalls    Synced   Healthy
team-gamma-dev-egressfirewalls   Synced   Healthy
```

## Verify the Rendered Firewalls

List the generated `EgressFirewall` objects:

```bash
oc get egressfirewall -A
```

Inspect one namespace:

```bash
oc get egressfirewall default -n team-alpha-dev-project-001 -o yaml
```

Confirm the rule order:

```bash
oc get egressfirewall default -n team-alpha-dev-project-001 \
  -o jsonpath='{range .spec.egress[*]}{.type}{"\t"}{.to.cidrSelector}{"\n"}{end}'
```

You should see narrow `Allow` rules before the broad `Deny` rules:

```text
Allow   192.0.2.10/32
Allow   192.0.2.20/32
Allow   192.0.2.21/32
Allow   192.0.2.22/32
Allow   198.51.100.10/32
Allow   198.51.100.16/29
Allow   198.51.100.32/29
Allow   198.51.100.40/30
Deny    198.51.100.0/24
Allow   203.0.113.32/29
Allow   203.0.113.40/30
Deny    203.0.113.0/24
Allow   192.0.2.50/32
```

## Troubleshooting

### ApplicationSet fails with missing key errors

With `missingkey=error`, every tenant file must define `tenant`, `s3`, `nfs`, and `namespaces`. Use empty arrays when a tenant has no exceptions:

```yaml
tenant: team-delta-dev
s3: []
nfs: []
namespaces:
  - team-delta-dev-workspace
```

### EgressFirewall already exists

OVN-Kubernetes allows only one `EgressFirewall` per namespace, and it must be named `default`. If another controller or manual manifest already owns it, decide which source of truth should manage the object before enabling sync.

```bash
oc get egressfirewall default -n <namespace> -o yaml
```

### Traffic is still denied

Check the first matching rule. A broad `Deny` placed above a narrow `Allow` will block the later allow rule.

```bash
oc get egressfirewall default -n <namespace> \
  -o jsonpath='{range .spec.egress[*]}{.type}{"\t"}{.to.cidrSelector}{"\n"}{end}'
```

Also remember that `EgressFirewall` applies at namespace scope. If the pod runs in a different namespace than expected, it is controlled by that namespace's firewall, not the tenant file you meant to change.

## Production Notes

- Keep tenant files small and reviewable; they are the change surface for firewall exceptions.
- Use pull requests for CIDR changes so platform and security teams can review them.
- Validate CIDR overlap before merge, especially when deny ranges cover the same address family as allow ranges.
- Avoid mixing manual `oc edit` changes with GitOps-managed `EgressFirewall` objects.
- Add a pre-sync or CI check that runs `helm template` against every tenant file.

## Key Takeaways

- Use one Helm chart for the stable `EgressFirewall` structure.
- Use one tenant YAML file per tenant for variable CIDR and namespace data.
- Use ApplicationSet Git file generation to create one Argo CD application per tenant.
- Put specific `Allow` rules before broad `Deny` rules.
- Keep real customer names, repository URLs, and production IP ranges out of reusable examples.
