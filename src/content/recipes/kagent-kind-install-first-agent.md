---
title: "Install kagent 1.0 on kind and Run a First Agent"
description: "Install kagent 1.0 on a kind cluster with Kubernetes 1.37, apply a Harness, an AgentTemplate and an Agent, then talk to the agent from the kagent CLI."
publishDate: "2026-11-21"
author: "Luca Berton"
category: "ai"
difficulty: "intermediate"
timeToComplete: "30 minutes"
kubernetesVersion: "1.37+"
prerequisites:
  - "Docker and kind v0.32.0 or later"
  - "kubectl, Helm 3 and jq"
  - "An API key for a model provider (the examples use OpenAI)"
tags:
  - "kagent"
  - "ai-agents"
  - "agentic-ai"
  - "kind"
  - "agent-substrate"
  - "local-development"
relatedRecipes:
  - "model-context-protocol-server-kubernetes-kagent"
  - "goose-agents-md-kubernetes-manifests"
  - "kind-local-kubernetes"
  - "what-s-new-in-kind-v0-33-0-kubernetes-1-37-default-and-key-fixes"
  - "agentic-ai-multiagent-kubernetes"
---

> 💡 **Quick Answer:** Create a kind cluster on Kubernetes 1.37, install the kagent CLI, and run `kagent --config kagent-config.yaml install --namespace kagent`. Then apply three resources (a `Harness`, an `AgentTemplate` and an `Agent`), create a Session and send it a task with `kagent agent invoke`.

## The Problem

kagent 1.0 is not the single `Agent` resource of the 0.x releases. Every agent now runs on Agent Substrate, which provides the sandboxed compute, and an agent is described by three resources instead of one:

- A **Harness** holds the runtime: the image and the WorkerPool that the agent runs on.
- An **AgentTemplate** holds the behavior: the model configuration, the system prompt and the tools.
- An **Agent** pairs one Harness with one AgentTemplate.

Two things catch people on a first install:

- Agent Substrate needs the `PodCertificateRequest` and `ClusterTrustBundle` APIs at `certificates.k8s.io/v1`. They are served by default from Kubernetes 1.37, so an older cluster does not work.
- kagent 1.0 does not support an in-place upgrade from the 0.10.x line, and its CRDs replace the ones that a 0.10.x installation uses. Use a fresh cluster.

This recipe gets you from an empty machine to one agent that answers in the terminal.

## The Solution

The commands and the image digest below follow the kagent 1.0.0 documentation. The same steps and resources were also run in a lab on a kind cluster with Kubernetes 1.37 and the kagent 1.0.0-rc3 release candidate.

### Step 1: Create the cluster

Use kind v0.32.0 or later and a 1.37 node image.

```bash
kind create cluster --name kagent --image kindest/node:v1.37.0
```

Confirm that the cluster serves the APIs that Agent Substrate needs.

```bash
kubectl api-resources --api-group=certificates.k8s.io
```

The list must include `clustertrustbundles` and `podcertificaterequests`, both at `certificates.k8s.io/v1`.

### Step 2: Install the kagent CLI

Install the CLI at the same version as the kagent release that you want to run. The CLI calls `helm` to install each chart, so Helm 3 and `kubectl` must be on your path.

```bash
curl https://raw.githubusercontent.com/kagent-dev/kagent/refs/heads/main/scripts/get-kagent | bash -s -- --version v1.0.0
kagent version
```

### Step 3: Install kagent

Set the model provider API key. The installer reads it from the environment.

```bash
export OPENAI_API_KEY="your-api-key-here"
```

`kagent install` does not take Helm flags of its own. Chart values reach it through a CLI configuration file that points at a Helm values file.

```bash
cat > kagent-values.yaml <<EOF
config:
  server:
    grpcReflection: true
EOF

cat > kagent-config.yaml <<EOF
install:
  kagent:
    valuesFiles: [kagent-values.yaml]
EOF
```

Install kagent, then wait for the controller.

```bash
kagent --config kagent-config.yaml install --namespace kagent
kubectl rollout status deployment/kagent-controller -n kagent --timeout=300s
```

The installer puts Agent Substrate into the `ate-system` namespace and deploys a development PostgreSQL database as `kagent-postgresql` in the `kagent` namespace. That database is for evaluation, not for production.

### Step 4: Check what the installer created

```bash
kubectl get pods -n kagent
kubectl get workerpools -n kagent
```

Every pod must report `Running`. A CLI installation lists pods whose names start with `kagent-controller`, `kagent-default`, `kagent-postgresql`, `kagent-tools` and `kagent-ui`. The `kagent-default` WorkerPool must show `1` in the `READY` column, because that pool is where your agent runs.

### Step 5: Apply a Harness, an AgentTemplate and an Agent

The Harness names the WorkerPool and the object storage location for snapshots. The image is kagent's native runtime, pinned by digest. The digest below is the one in the kagent 1.0.0 guide. If you install another version, copy the digest from the "Your first agent" guide for that version.

```yaml
kubectl apply -f - <<EOF
apiVersion: api.kagent.dev/v1alpha3
kind: Harness
metadata:
  name: my-first-harness
  namespace: kagent
spec:
  kagent: {}
  workload:
    image: ghcr.io/kagent-dev/kagent/golang-adk@sha256:f62e9f2820d3325ca147a5d39802dc3e9c914bee97b3e021bd38f6f5df10e3bf
  substrate:
    workerPoolRef:
      name: kagent-default
    snapshotPolicy:
      location: s3://ate-snapshots/kagent/
---
apiVersion: api.kagent.dev/v1alpha3
kind: AgentTemplate
metadata:
  name: my-first-template
  namespace: kagent
spec:
  description: My first kagent agent
  modelConfig:
    name: default-model-config
  systemPrompt: You are a concise, helpful assistant.
---
apiVersion: api.kagent.dev/v1alpha3
kind: Agent
metadata:
  name: my-first-agent
  namespace: kagent
spec:
  template:
    ref:
      name: my-first-template
  harnessRef:
    name: my-first-harness
EOF
```

`default-model-config` is the ModelConfig that the installer creates for the provider API key you exported in Step 3. `s3://ate-snapshots/kagent/` is the bucket that the Agent Substrate chart creates in its bundled object store.

### Step 6: Create a Session and talk to the agent

A Session is one running conversation with an Agent. Creating it starts an Actor on the WorkerPool.

```bash
export SESSION_ID=$(kagent agent session create --agent my-first-agent -o json | jq -r '.session.id')
echo $SESSION_ID

kagent agent invoke --session $SESSION_ID --task "What is 2+2?"
kagent agent invoke --session $SESSION_ID --task "What did I just ask you?"
```

The reply prints as text, and its wording depends on the model. The second task works because the Session holds the transcript of the conversation.

The CLI reaches the controller at `localhost:8083`. When nothing serves that port, it runs `kubectl port-forward` against the `kagent-controller` service for the length of the command, so keep your kubeconfig pointed at the kind cluster.

## Verify

Check that the Agent is ready before you create a Session.

```bash
kagent agent get my-first-agent
```

`READY` must be `True`. A value of `False` right after you apply the Agent is expected, because kagent builds a snapshot of the runtime first, and that can take a minute. If it stays `False`, read the conditions.

```bash
kubectl get agent my-first-agent -n kagent -o jsonpath='{.status.conditions}' | jq
```

An Agent reports four conditions in order: `Accepted`, `ResolvedRefs`, `Compatible` and `Ready`.

To look at the same agent in the web interface, forward the UI service in a second terminal and open `http://localhost:8082`.

```bash
kubectl port-forward -n kagent svc/kagent-ui 8082:8080
```

### Clean up

Deleting an Agent does not delete its Sessions, so delete the Sessions first.

```bash
kagent agent session list -o json \
  | jq -r '.sessions[] | select(.agent.name == "my-first-agent") | .id' \
  | xargs -n1 kagent agent session delete

kubectl delete agent my-first-agent -n kagent
kubectl delete agenttemplate my-first-template -n kagent
kubectl delete harness my-first-harness -n kagent
```

To remove everything, delete the cluster with `kind delete cluster --name kagent`.

## Common Issues

**`kubectl api-resources` does not list `podcertificaterequests`**

The cluster is older than Kubernetes 1.37. Recreate it with a 1.37 node image. Agent Substrate cannot run without these APIs.

**The Agent stays `READY: False`**

Read the first condition that is `False` and whose reason is not `Blocked`. When one stage fails, kagent marks every later stage `False` with the reason `Blocked`, so only the first failure describes the real problem. A wrong ModelConfig, Harness or AgentTemplate name shows up at `ResolvedRefs`.

**`Agent does not have a ready prepared revision` when you create a Session**

The Agent is not `Ready` yet. Wait, then check the conditions as shown in the Verify section.

**A turn fails with a timeout**

Start with the WorkerPool. If `kubectl get workerpools -n kagent` does not show a ready replica, no Actor can start.

**You did not install with an OpenAI key**

`default-model-config` exists because the installer created it for the key in Step 3. For an OpenAI-compatible endpoint of your own, create a ModelConfig with `provider: OpenAI`, an `apiKeySecret`, and `openAI.baseUrl` set to the endpoint, then name that ModelConfig in the AgentTemplate. Use a DNS name in the URL, such as a Service name ending in `.svc.cluster.local`: kagent's egress gateway only accepts DNS names.

**You edited the AgentTemplate and the agent behaves as before**

A Session keeps the revision that it started from for its whole life. Create a new Session to pick up the edit.

## Best Practices

- **Match the CLI and the release.** Install the `kagent` CLI at the same version as the kagent release in the cluster.
- **Keep the three resources in files.** A Harness, an AgentTemplate and an Agent are ordinary Kubernetes resources, so they belong in Git next to the rest of your manifests.
- **Treat the bundled database as a lab database.** The CLI installation deploys a development PostgreSQL. A production installation uses Helm against a database that you provide.
- **Pin the runtime image by digest.** The Harness image decides which runtime your agents run, so change it on purpose and not by tag drift.
- **Read conditions before logs.** The four Agent conditions tell you which stage failed faster than pod logs do.

## Key Takeaways

- kagent 1.0 needs Kubernetes 1.37 or later, because Agent Substrate depends on `PodCertificateRequest` and `ClusterTrustBundle` at `certificates.k8s.io/v1`.
- One command, `kagent --config kagent-config.yaml install --namespace kagent`, installs the CRDs, Agent Substrate, a development database and kagent.
- An agent is three resources: a Harness for the runtime, an AgentTemplate for the behavior, and an Agent that pairs them.
- You talk to an agent through a Session, created and used with the `kagent agent session create` and `kagent agent invoke` commands.
- The next step is tools: see [Run an MCP Server on Kubernetes and Bind It to kagent](/recipes/ai/model-context-protocol-server-kubernetes-kagent/).
