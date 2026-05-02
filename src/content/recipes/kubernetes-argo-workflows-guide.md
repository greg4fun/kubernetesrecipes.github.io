---
title: "Argo Workflows: K8s-Native Pipeline Engine"
description: "Run CI/CD pipelines and data workflows with Argo Workflows in Kubernetes. DAG workflows, artifact passing, retry strategies, and cron workflows for batch processing."
publishDate: "2026-05-02"
author: "Luca Berton"
category: "deployments"
difficulty: "intermediate"
timeToComplete: "12 minutes"
kubernetesVersion: "1.28+"
tags:
  - "argo-workflows"
  - "ci-cd"
  - "pipelines"
  - "automation"
  - "batch-processing"
relatedRecipes:
  - "kubernetes-argocd-gitops-guide"
  - "kubernetes-job-cronjob-guide"
  - "kubernetes-cronjob-patterns-guide"
  - "kubernetes-tekton-pipelines-guide"
---

> 💡 **Quick Answer:** Argo Workflows runs multi-step pipelines as Kubernetes pods. Install: `kubectl apply -n argo -f https://github.com/argoproj/argo-workflows/releases/download/v3.5.0/install.yaml`. Define workflows in YAML with steps, DAGs, or directed graphs. Each step runs in its own pod. Supports artifact passing, retries, conditionals, loops, and cron scheduling.

## The Problem

Kubernetes Jobs are limited:

- No multi-step orchestration
- No artifact passing between steps
- No DAG dependencies
- No conditional execution
- No built-in UI for monitoring

## The Solution

### Install Argo Workflows

```bash
kubectl create namespace argo
kubectl apply -n argo -f https://github.com/argoproj/argo-workflows/releases/download/v3.5.0/install.yaml

# Install CLI
curl -sLO https://github.com/argoproj/argo-workflows/releases/download/v3.5.0/argo-linux-amd64.gz
gunzip argo-linux-amd64.gz && chmod +x argo-linux-amd64 && mv argo-linux-amd64 /usr/local/bin/argo

# Access UI
kubectl -n argo port-forward svc/argo-server 2746:2746
# https://localhost:2746
```

### Simple Workflow

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  name: hello-world
spec:
  entrypoint: main
  templates:
  - name: main
    container:
      image: alpine:3.19
      command: [echo, "Hello from Argo Workflows!"]
```

```bash
argo submit hello-world.yaml -n argo --watch
```

### Multi-Step Pipeline

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: build-test-deploy-
spec:
  entrypoint: pipeline
  templates:
  - name: pipeline
    steps:
    - - name: build
        template: build-image
    - - name: unit-tests
        template: run-tests
      - name: lint
        template: run-lint
        # unit-tests and lint run in PARALLEL
    - - name: deploy
        template: deploy-app
        # Runs after both tests pass
  
  - name: build-image
    container:
      image: docker:24
      command: [docker, build, -t, myapp:latest, .]
  
  - name: run-tests
    container:
      image: myapp:latest
      command: [pytest, tests/]
  
  - name: run-lint
    container:
      image: myapp:latest
      command: [flake8, src/]
  
  - name: deploy-app
    container:
      image: bitnami/kubectl:1.30
      command: [kubectl, rollout, restart, deployment/myapp]
```

### DAG Workflow

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: dag-pipeline-
spec:
  entrypoint: dag
  templates:
  - name: dag
    dag:
      tasks:
      - name: checkout
        template: git-clone
      
      - name: build
        template: build-app
        dependencies: [checkout]
      
      - name: test
        template: run-tests
        dependencies: [build]
      
      - name: security-scan
        template: scan
        dependencies: [build]
      
      - name: deploy
        template: deploy
        dependencies: [test, security-scan]    # Both must pass
        when: "{{tasks.test.outputs.result}} == passed"
```

### Artifact Passing

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: artifacts-
spec:
  entrypoint: pipeline
  templates:
  - name: pipeline
    steps:
    - - name: generate
        template: generate-report
    - - name: process
        template: process-report
        arguments:
          artifacts:
          - name: report
            from: "{{steps.generate.outputs.artifacts.report}}"
  
  - name: generate-report
    container:
      image: python:3.12
      command: [python, -c, "open('/tmp/report.csv', 'w').write('data,value\n1,100\n2,200')"]
    outputs:
      artifacts:
      - name: report
        path: /tmp/report.csv
  
  - name: process-report
    inputs:
      artifacts:
      - name: report
        path: /tmp/input/report.csv
    container:
      image: python:3.12
      command: [python, -c, "print(open('/tmp/input/report.csv').read())"]
```

### Parameters and Conditionals

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: conditional-
spec:
  entrypoint: main
  arguments:
    parameters:
    - name: environment
      value: staging
  
  templates:
  - name: main
    steps:
    - - name: build
        template: build
    - - name: deploy-staging
        template: deploy
        arguments:
          parameters:
          - name: env
            value: staging
        when: "{{workflow.parameters.environment}} == staging"
      - name: deploy-production
        template: deploy
        arguments:
          parameters:
          - name: env
            value: production
        when: "{{workflow.parameters.environment}} == production"
  
  - name: build
    container:
      image: alpine
      command: [echo, "Building..."]
  
  - name: deploy
    inputs:
      parameters:
      - name: env
    container:
      image: alpine
      command: [echo, "Deploying to {{inputs.parameters.env}}"]
```

### Retry and Error Handling

```yaml
templates:
- name: flaky-task
  retryStrategy:
    limit: 3
    retryPolicy: Always
    backoff:
      duration: "10s"
      factor: 2
      maxDuration: "1m"
  container:
    image: alpine
    command: [sh, -c, "exit $(( RANDOM % 2 ))"]   # 50% failure rate

- name: with-timeout
  activeDeadlineSeconds: 300     # 5 minute timeout
  container:
    image: long-running:v1
```

### CronWorkflow

```yaml
apiVersion: argoproj.io/v1alpha1
kind: CronWorkflow
metadata:
  name: nightly-etl
spec:
  schedule: "0 2 * * *"          # 2 AM daily
  timezone: "UTC"
  concurrencyPolicy: Replace
  successfulJobsHistoryLimit: 5
  failedJobsHistoryLimit: 3
  workflowSpec:
    entrypoint: etl-pipeline
    templates:
    - name: etl-pipeline
      dag:
        tasks:
        - name: extract
          template: extract-data
        - name: transform
          template: transform
          dependencies: [extract]
        - name: load
          template: load-db
          dependencies: [transform]
```

### WorkflowTemplate (Reusable)

```yaml
apiVersion: argoproj.io/v1alpha1
kind: WorkflowTemplate
metadata:
  name: build-template
spec:
  arguments:
    parameters:
    - name: image
    - name: tag
  templates:
  - name: build
    inputs:
      parameters:
      - name: image
      - name: tag
    container:
      image: docker:24
      command: [docker, build, -t, "{{inputs.parameters.image}}:{{inputs.parameters.tag}}", .]

---
# Reference in workflow
apiVersion: argoproj.io/v1alpha1
kind: Workflow
spec:
  templates:
  - name: main
    steps:
    - - name: build
        templateRef:
          name: build-template
          template: build
        arguments:
          parameters:
          - name: image
            value: myapp
          - name: tag
            value: v2.0
```

## Common Issues

**Workflow pods stuck Pending**

Resource quota exceeded or no matching nodes. Check: `kubectl describe pod <workflow-pod>`.

**Artifact storage not configured**

Default is emptyDir (lost between steps). Configure S3/GCS/MinIO in workflow-controller-configmap for persistent artifacts.

**"forbidden" RBAC errors**

Argo needs RBAC to create pods. Check: ServiceAccount and Role bindings in the workflow namespace.

## Best Practices

- **DAG over steps** for complex pipelines — clearer dependency visualization
- **WorkflowTemplates** for reusable components
- **Retry strategies** on flaky external calls
- **Resource limits** on workflow pods — prevent cluster starvation
- **CronWorkflow** for scheduled ETL, reports, backups

## Key Takeaways

- Argo Workflows runs multi-step pipelines as Kubernetes pods
- Steps run sequentially; parallel steps in nested arrays
- DAG workflows for complex dependency graphs
- Artifacts pass data between steps (S3, GCS, MinIO)
- CronWorkflow for scheduled pipelines, WorkflowTemplate for reuse
