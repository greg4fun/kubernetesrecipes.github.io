---
title: "What's New in ExternalDNS v0.24.0: Breaking Changes and Upgrade Guide"
description: "ExternalDNS v0.24.0 upgrade guide: TCPRoute v1, admission-validated CRDs, multi-namespace support, and breaking changes."
publishDate: "2026-10-29"
author: "Luca Berton"
category: "networking"
difficulty: "intermediate"
timeToComplete: "20 minutes"
kubernetesVersion: "1.27+"
tags:
  - "external-dns"
  - "dns"
  - "gateway-api"
  - "crd"
  - "upgrade"
  - "service-discovery"
---
> 💡 **Quick Answer:** ExternalDNS v0.24.0 ships several breaking changes — TCPRoute now requires Gateway API v1.6.0+, DNSEndpoint/DNSRecord CRDs gain admission validation, and `gateway-httproute` hostname handling changes sync behavior — so re-apply CRDs and run with `--dry-run=true` before rolling this out.

## The Problem

ExternalDNS v0.24.0 introduces multiple changes that can silently delete or fail to update DNS records if you upgrade without preparation: Gateway API CRD version mismatches, stricter CRD admission rules, and a behavior change in how listener hostnames are suppressed for `gateway-httproute`. Operators running `--policy=sync` are most at risk of unexpected record deletion.

## The Solution

Treat this as a planned upgrade, not a rolling update. Validate Gateway API CRD versions, re-apply the `DNSEndpoint`/`DNSRecord` CRDs, and run the new version with `--dry-run=true` first to inspect the diff before letting it touch live records. This is the official guidance per the [version-update-playbook](https://kubernetes-sigs.github.io/external-dns/latest/docs/version-update-playbook/).

## Whats New

**⚠️ Action required before upgrade**

- `gateway-tcproute` source now watches Gateway API `TCPRoute v1` instead of an older version (#6755). Requires **Gateway API CRDs >= v1.6.0** — check with `kubectl get crd tcproutes.gateway.networking.k8s.io -o jsonpath='{.spec.versions[*].name}'`.
- `skipper-routegroup` source now uses client-go informers (#6714). The RouteGroup CRD must be installed in the cluster or the source will fail to start.
- `.Metadata` in `--fqdn-template` is deprecated — use `{{.Name}}` instead of `{{.Metadata.Name}}`.
- `DNSEndpoint` and `DNSRecord` CRDs now validate schema at admission (#6620). **Re-apply the CRDs** after upgrading. Existing objects that violate the new rules cannot be updated until fixed.
- Packagers: version ldflags moved to `sigs.k8s.io/external-dns/pkg/version.{Version,GitCommit}` (#6774). Old ldflags paths still build but report version `unknown`.

**ℹ️ Important behavior changes**

- `gateway-httproute`: a hostname set via annotation or FQDN template now suppresses the listener hostname fallback (#6746). With `--policy=sync`, previously-created wildcard or listener-fallback records may be **deleted** on this upgrade.
- `scaleway`: `ALIAS` records are now read back, and apex `CNAME` records are created as `ALIAS` (#6543). With `--registry=noop` and `--policy=sync`, pre-existing `ALIAS` records may be updated or deleted.
- `--namespace` now accepts multiple comma-separated values (e.g. `--namespace=a,b`) for `service` and `crd` sources (#6763, #6764). `Config.Namespace` is now `Config.Namespaces []string` for Go importers of `pkg/apis/externaldns`.
- `$KUBECONFIG` is now honored, and `--server` is no longer ignored when running in-cluster (#6736).
- Endpoints without targets are now skipped instead of crashing the provider (#6752).
- `coredns`: deleting a record now also deletes its TXT registry entry (#6747). TXT entries orphaned by prior versions remain in etcd and must be cleaned up manually.

**Features**

- `awssd`: dual-stack load balancer alias support (#6665)
- `controller`: sync outcome reported to a DNSEndpoint status writer (#6767)
- `crd`: DNSEndpoint schema admission validation (#6620)
- `rfc2136`: insecure AXFR upstream support (#6519), TLSA record support (#6721)
- `source`: watch multiple namespaces in service/crd sources (#6764)

**Bug fixes**

- `coredns`: delete endpoint now also deletes registry TXT entry (#6747)
- `gateway`: `--annotation-filter` no longer applied to ListenerSets (#6794)
- `mx`: keeps null MX and strips trailing dot (#6661)
- `source`: keeps RefObjects on endpoints built from `--default-targets` (#6765)

## Upgrade Steps

Check Gateway API CRD version if using `gateway-tcproute`:

```bash
kubectl get crd tcproutes.gateway.networking.k8s.io -o jsonpath='{.spec.versions[*].name}{"\n"}'
# upgrade Gateway API if v1 is not listed
kubectl kustomize "https://github.com/kubernetes-sigs/gateway-api/config/crd?ref=v1.6.0" | kubectl apply -f -
```

Re-apply the DNSEndpoint/DNSRecord CRDs before rolling the controller:

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/external-dns/v0.24.0/docs/contributing/crd-source/crd-manifest.yaml
```

Deploy ExternalDNS with `--dry-run=true` first to review planned changes:

```bash
kubectl set image deployment/external-dns \
  external-dns=registry.k8s.io/external-dns/external-dns:v0.24.0 \
  -n external-dns

kubectl -n external-dns patch deployment external-dns --type='json' \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--dry-run=true"}]'

kubectl logs -n external-dns deployment/external-dns -f --tail=100
```

For Helm users:

```bash
helm repo update external-dns
helm upgrade external-dns external-dns/external-dns \
  -n external-dns \
  --set image.tag=v0.24.0 \
  --set extraArgs='{--dry-run=true}'
```

After confirming the dry-run plan matches expectations, remove `--dry-run=true` and restart:

```bash
kubectl -n external-dns patch deployment external-dns --type='json' \
  -p='[{"op":"remove","path":"/spec/template/spec/containers/0/args/-1"}]'

kubectl rollout restart deployment/external-dns -n external-dns
```

## Verify

```bash
kubectl -n external-dns get deployment external-dns \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'

kubectl -n external-dns logs deployment/external-dns --tail=50 | grep -i 'version\|error'

kubectl get crd dnsendpoints.externaldns.k8s.io -o yaml | grep -A2 'validation'
```

Confirm the binary reports the correct version (not `unknown`), which validates the ldflags path fix (#6774):

```bash
kubectl exec -n external-dns deployment/external-dns -- external-dns --version
```

## Common Issues

- **Wildcard/listener records deleted after upgrade**: caused by the `gateway-httproute` hostname-fallback change (#6746) combined with `--policy=sync`. Run with `--dry-run=true` first to catch this before it happens live.
- **`skipper-routegroup` source fails to start**: the RouteGroup CRD is missing — install it before upgrading (#6714).
- **CRD apply rejected**: existing `DNSEndpoint`/`DNSRecord` objects violate the new admission schema (#6620). Fix the offending objects' spec before re-applying.
- **Version shows `unknown`**: custom build pipelines still set ldflags on the old `main.{version,gitCommit}` path; update to `sigs.k8s.io/external-dns/pkg/version.{Version,GitCommit}` (#6774).
- **Orphaned TXT records in CoreDNS/etcd**: records deleted by versions prior to v0.24.0 left orphaned TXT registry entries; these are not auto-cleaned and require manual removal (#6747).

## Best Practices

- Always upgrade with `--dry-run=true` and review the planned change log before applying for real, as recommended in the [upgrade playbook](https://kubernetes-sigs.github.io/external-dns/latest/docs/version-update-playbook/).
- Pin Gateway API CRDs to >= v1.6.0 before enabling `gateway-tcproute`.
- Audit `--policy=sync` usage with `gateway-httproute` and `scaleway` providers specifically for this release; consider temporarily switching to `--policy=upsert-only` during the upgrade window.
- Update `--fqdn-template` references from `{{.Metadata.Name}}` to `{{.Name}}` ahead of time since the old field is deprecated.
- Track full changelog and any CVE notes on the [v0.24.0 release page](https://github.com/kubernetes-sigs/external-dns/releases/tag/v0.24.0).
