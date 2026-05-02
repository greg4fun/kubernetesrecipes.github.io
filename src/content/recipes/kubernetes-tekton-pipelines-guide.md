---
title: "Tekton: Cloud-Native CI/CD Pipelines"
description: "Build CI/CD pipelines with Tekton in Kubernetes. Tasks, Pipelines, PipelineRuns, workspaces, and Tekton Hub integration for cloud-native continuous delivery."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "tekton"
  - "ci-cd"
  - "pipelines"
  - "automation"
  - "cloud-native"
relatedRecipes:
  - "kubernetes-argocd-gitops-guide"
  - "kubernetes-argo-workflows-guide"
  - "kubernetes-job-cronjob-guide"
---

> 💡 **Quick Answer:** Tekton runs CI/CD pipelines as Kubernetes-native resources. Install: `kubectl apply -f https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml`. Define `Task` (steps in a container), `Pipeline` (sequence of tasks), then run with `PipelineRun`. Each step is a container — build, test, deploy all in K8s. Tekton Hub provides reusable community tasks.

## The Problem

Jenkins, GitLab CI, and GitHub Actions run outside the cluster:

- Different infrastructure for CI/CD vs applications
- Limited Kubernetes integration
- Vendor lock-in for pipeline definitions
- Can't leverage cluster resources for builds
- No Kubernetes-native pipeline CRDs

## The Solution

### Install Tekton

```bash
# Install Tekton Pipelines
kubectl apply -f https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml

# Install Tekton Dashboard (optional)
kubectl apply -f https://storage.googleapis.com/tekton-releases/dashboard/latest/release.yaml

# Install Tekton CLI
# brew install tektoncd-cli (macOS)
# or download from GitHub releases

# Verify
kubectl get pods -n tekton-pipelines
tkn version
```

### Task (Building Block)

```yaml
apiVersion: tekton.dev/v1
kind: Task
metadata:
  name: build-and-push
spec:
  params:
  - name: image
    type: string
  - name: tag
    type: string
    default: latest
  
  workspaces:
  - name: source
  
  steps:
  - name: build
    image: gcr.io/kaniko-project/executor:latest
    args:
    - --dockerfile=Dockerfile
    - --context=$(workspaces.source.path)
    - --destination=$(params.image):$(params.tag)
    - --cache=true

---
apiVersion: tekton.dev/v1
kind: Task
metadata:
  name: run-tests
spec:
  workspaces:
  - name: source
  steps:
  - name: test
    image: python:3.12
    workingDir: $(workspaces.source.path)
    script: |
      pip install -r requirements.txt
      pytest tests/ -v

---
apiVersion: tekton.dev/v1
kind: Task
metadata:
  name: deploy
spec:
  params:
  - name: image
    type: string
  - name: namespace
    type: string
    default: production
  steps:
  - name: deploy
    image: bitnami/kubectl:1.30
    script: |
      kubectl set image deployment/myapp \
        app=$(params.image) \
        -n $(params.namespace)
      kubectl rollout status deployment/myapp \
        -n $(params.namespace) --timeout=300s
```

### Pipeline

```yaml
apiVersion: tekton.dev/v1
kind: Pipeline
metadata:
  name: build-test-deploy
spec:
  params:
  - name: repo-url
    type: string
  - name: image
    type: string
  - name: tag
    type: string
  
  workspaces:
  - name: shared-workspace
  - name: docker-credentials
  
  tasks:
  - name: clone
    taskRef:
      name: git-clone              # From Tekton Hub
    workspaces:
    - name: output
      workspace: shared-workspace
    params:
    - name: url
      value: $(params.repo-url)
  
  - name: test
    taskRef:
      name: run-tests
    runAfter: [clone]
    workspaces:
    - name: source
      workspace: shared-workspace
  
  - name: build
    taskRef:
      name: build-and-push
    runAfter: [test]
    workspaces:
    - name: source
      workspace: shared-workspace
    params:
    - name: image
      value: $(params.image)
    - name: tag
      value: $(params.tag)
  
  - name: deploy
    taskRef:
      name: deploy
    runAfter: [build]
    params:
    - name: image
      value: "$(params.image):$(params.tag)"
```

### PipelineRun (Trigger)

```yaml
apiVersion: tekton.dev/v1
kind: PipelineRun
metadata:
  generateName: build-test-deploy-
spec:
  pipelineRef:
    name: build-test-deploy
  params:
  - name: repo-url
    value: https://github.com/myorg/myapp.git
  - name: image
    value: registry.example.com/myapp
  - name: tag
    value: v2.0.0
  workspaces:
  - name: shared-workspace
    volumeClaimTemplate:
      spec:
        accessModes: [ReadWriteOnce]
        resources:
          requests:
            storage: 1Gi
  - name: docker-credentials
    secret:
      secretName: docker-registry-creds
```

### Tekton Hub (Reusable Tasks)

```bash
# Install community tasks from Tekton Hub
tkn hub install task git-clone
tkn hub install task kaniko
tkn hub install task kubernetes-actions
tkn hub install task helm-upgrade-from-source

# Search for tasks
tkn hub search build
tkn hub search deploy
```

### Tekton Triggers (Webhook)

```yaml
# EventListener — receives webhooks
apiVersion: triggers.tekton.dev/v1beta1
kind: EventListener
metadata:
  name: github-listener
spec:
  triggers:
  - name: github-push
    bindings:
    - ref: github-push-binding
    template:
      ref: build-template

---
# TriggerBinding — extract data from webhook
apiVersion: triggers.tekton.dev/v1beta1
kind: TriggerBinding
metadata:
  name: github-push-binding
spec:
  params:
  - name: repo-url
    value: $(body.repository.clone_url)
  - name: revision
    value: $(body.head_commit.id)

---
# TriggerTemplate — create PipelineRun
apiVersion: triggers.tekton.dev/v1beta1
kind: TriggerTemplate
metadata:
  name: build-template
spec:
  params:
  - name: repo-url
  - name: revision
  resourcetemplates:
  - apiVersion: tekton.dev/v1
    kind: PipelineRun
    metadata:
      generateName: github-build-
    spec:
      pipelineRef:
        name: build-test-deploy
      params:
      - name: repo-url
        value: $(tt.params.repo-url)
```

### CLI Operations

```bash
# List pipelines
tkn pipeline list

# Start a pipeline
tkn pipeline start build-test-deploy \
  -p repo-url=https://github.com/myorg/myapp.git \
  -p image=registry.example.com/myapp \
  -p tag=v2.0.0 \
  -w name=shared-workspace,claimName=build-pvc

# List runs
tkn pipelinerun list

# View logs
tkn pipelinerun logs build-test-deploy-xxx -f

# List tasks
tkn task list

# Run a single task
tkn task start run-tests -w name=source,claimName=source-pvc
```

## Common Issues

**"pod not scheduled" during pipeline**

Workspace PVC not available or resource quota exceeded. Use `volumeClaimTemplate` for dynamic PVCs.

**Steps can't share files**

Steps within a Task share a workspace. Tasks in a Pipeline need explicit workspace passing.

**Kaniko build fails with auth**

Docker credentials not mounted. Create: `kubectl create secret docker-registry` and reference in workspace.

## Best Practices

- **Tekton Hub for common tasks** — git-clone, kaniko, kubectl — don't reinvent
- **Workspaces for data sharing** — PVCs between tasks, emptyDir within tasks
- **Triggers for automation** — GitHub/GitLab webhooks start pipelines
- **Tekton Chains for supply chain security** — sign and verify artifacts
- **Combine with ArgoCD** — Tekton builds, ArgoCD deploys (GitOps)

## Key Takeaways

- Tekton runs CI/CD as Kubernetes-native CRDs (Task, Pipeline, PipelineRun)
- Each step is a container — full isolation and reproducibility
- Workspaces share data between tasks (PVCs) and steps (emptyDir)
- Tekton Hub provides reusable community tasks
- Triggers enable webhook-driven pipeline execution
