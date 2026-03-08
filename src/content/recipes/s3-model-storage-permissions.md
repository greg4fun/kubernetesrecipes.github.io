---
title: "Configure S3 Storage Permissions for ML Models"
description: "Set up S3 bucket ACLs, IAM roles, and PVC permissions so Kubernetes inference pods can securely read large ML model weights from object storage."
category: "storage"
difficulty: "beginner"
timeToComplete: "15 minutes"
kubernetesVersion: "Any"
prerequisites:
  - "S3-compatible object storage (AWS S3, MinIO, Ceph RGW)"
  - "S3 Browser or AWS CLI installed"
  - "Model files uploaded to a bucket"
relatedRecipes:
  - "deploy-mistral-vllm-kubernetes"
  - "deploy-mistral-nvidia-nim"
  - "configmap-secrets-management"
tags:
  - s3
  - storage
  - permissions
  - acl
  - model-storage
  - ai-workloads
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** In S3 Browser, select the model folder, go to **Permissions** tab, check **Full Control** for the Owner, enable **Apply for all subfolders and files**, then click Apply. For PVCs, ensure the `ReadOnlyMany` or `ReadWriteMany` access mode and verify the model directory is complete.


Model inference pods need reliable read access to model files stored on S3-backed volumes. Incorrect ACLs cause silent mount failures or permission-denied errors.

## Model Directory Structure

Before setting permissions, ensure the model directory is complete:

```text
Mistral-7B-v0.1/
├── config.json
├── generation_config.json
├── tokenizer.json
├── tokenizer_config.json
├── special_tokens_map.json
├── model-00001-of-00002.safetensors
├── model-00002-of-00002.safetensors
└── model.safetensors.index.json
```

Missing files (especially `config.json` or safetensors) cause model load failures.

## Set ACL via S3 Browser (GUI)

### Step 1: Navigate to the Bucket

1. Open S3 Browser
2. Expand the S3 endpoint in the left tree
3. Navigate to the model folder (e.g., `Mistral-7B-v0.1/`)

### Step 2: Open Permissions

1. Select the model folder
2. Click the **Permissions** tab in the bottom panel

You will see a permissions grid:

| User | Full Control | Read | Write | Read Permissions | Write Permissions |
|---|---|---|---|---|---|
| Owner | ☐ | ☐ | ☐ | ☐ | ☐ |
| Any AWS Users | ☐ | ☐ | ☐ | ☐ | ☐ |
| All Users | ☐ | ☐ | ☐ | ☐ | ☐ |

### Step 3: Grant Full Control

Check **Full Control** for the **Owner** row.

For inference workloads, Owner Full Control is sufficient. Do not grant broad permissions to "All Users" unless explicitly required.

### Step 4: Apply Recursively

Check: **Apply for all subfolders and files**

This ensures permissions propagate to every file inside the model directory.

### Step 5: Apply Changes

Click **Apply changes**. S3 Browser updates ACLs on all objects.

## Set ACL via AWS CLI

```bash
# Set full control on the model prefix
aws s3api put-object-acl \
  --bucket my-model-bucket \
  --key Mistral-7B-v0.1/ \
  --acl bucket-owner-full-control

# Apply recursively to all objects in the prefix
aws s3 ls s3://my-model-bucket/Mistral-7B-v0.1/ --recursive | \
  awk '{print $4}' | \
  xargs -I {} aws s3api put-object-acl \
    --bucket my-model-bucket \
    --key {} \
    --acl bucket-owner-full-control
```

## Verify Permissions

```bash
# Check ACL on a specific file
aws s3api get-object-acl \
  --bucket my-model-bucket \
  --key Mistral-7B-v0.1/config.json

# List files to confirm access
aws s3 ls s3://my-model-bucket/Mistral-7B-v0.1/
```

## PVC Configuration for Kubernetes

Once S3 permissions are correct, the PVC should be mounted in the inference pod:

```yaml
volumes:
  - name: model-data
    persistentVolumeClaim:
      claimName: model-storage-pvc

containers:
  - name: inference
    volumeMounts:
      - name: model-data
        mountPath: /data
        readOnly: true
```

### Verify Inside the Pod

```bash
kubectl exec -it <inference-pod> -- ls -la /data/Mistral-7B-v0.1/
kubectl exec -it <inference-pod> -- cat /data/Mistral-7B-v0.1/config.json | head -5
```

## Common Issues

| Symptom | Cause | Fix |
|---|---|---|
| `Permission denied` in pod logs | ACL not applied to files | Apply Full Control recursively |
| `FileNotFoundError: config.json` | Incomplete model upload | Re-upload missing files |
| `Access Denied` on S3 list/get | Bucket policy blocks access | Update bucket policy or IAM role |
| Pod mounts empty `/data` | PVC not bound or wrong claim name | Check `kubectl get pvc` |
| Model loads partially | Some safetensors files missing | Verify all shards are uploaded |

## Security Best Practices

- Use **Owner Full Control** only — avoid granting public access
- Use IAM roles or service accounts instead of static keys when possible
- Prefer `ReadOnlyMany` PVC access mode for inference (no writes needed)
- Rotate S3/IAM credentials regularly
- Audit bucket access patterns periodically

## Related Recipes

- [Deploy Mistral with vLLM](/recipes/ai/deploy-mistral-vllm-kubernetes/)
- [Deploy Mistral with NVIDIA NIM](/recipes/ai/deploy-mistral-nvidia-nim/)
