---
title: "FSDP LoRA Fine-Tuning LLMs on Kubernetes"
description: "Fine-tune large language models with FSDP and LoRA on Kubernetes. Covers memory-efficient loading, checkpoint strategies, and multi-node H200 training."
tags:
  - "fsdp"
  - "lora"
  - "fine-tuning"
  - "distributed"
  - "pytorch"
category: "ai"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "runai-distributed-training-openshift"
  - "multi-node-training-kubernetes"
  - "distributed-multi-gpu-inference-kubernetes"
  - "kubernetes-1-36-topology-aware-scheduling"
  - "mistral-fsdp-lora-accelerate-config"
---

> 💡 **Quick Answer:** Use PyTorch FSDP (Fully Sharded Data Parallel) with LoRA/PEFT to fine-tune 11B+ parameter models across multiple GPUs with minimal memory. Key: `fsdp_cpu_ram_efficient_loading` (only rank 0 loads weights), `fsdp_use_orig_params` (required for LoRA), and `FULL_STATE_DICT` for inference-ready checkpoints.

## The Problem

Fine-tuning large models (11B+ parameters) faces memory constraints:

- **Full fine-tuning of Mistral-Small-4 11B** needs ~44GB just for weights in FP16, plus optimizer states (3× more)
- **Without FSDP**: Each GPU loads the full model → OOM on anything but the largest GPUs
- **Without LoRA**: Training all parameters needs massive optimizer memory
- **Naive multi-node**: All ranks load 238GB from disk simultaneously → RAM deadlock

## The Solution

### FSDP Configuration for LoRA Fine-Tuning

```yaml
# fsdp_config.yaml
compute_environment: LOCAL_MACHINE
distributed_type: FSDP
fsdp_config:
  fsdp_auto_wrap_policy: TRANSFORMER_BASED_WRAP
  fsdp_backward_prefetch: BACKWARD_PRE
  fsdp_cpu_ram_efficient_loading: true
  fsdp_forward_prefetch: false
  fsdp_offload_params: false
  fsdp_sharding_strategy: FULL_SHARD
  fsdp_state_dict_type: FULL_STATE_DICT
  fsdp_sync_module_states: true
  fsdp_use_orig_params: true
machine_rank: 0
main_training_function: main
mixed_precision: bf16
num_machines: 2
num_processes: 2
```

### Key FSDP Settings Explained

```python
# fsdp_cpu_ram_efficient_loading: true
# Only rank 0 loads the full 238GB model from disk.
# Other ranks receive weights via NVLink broadcast.
# Without this: every rank loads 238GB → RAM deadlock on multi-node.

# fsdp_sync_module_states: true
# Rank 0 broadcasts its loaded weights to all other ranks.
# Paired with cpu_ram_efficient_loading.

# fsdp_use_orig_params: true
# CRITICAL for LoRA! Without this flag:
# - FSDP flattens parameters into 1D tensors
# - breaks requires_grad selectivity
# - LoRA adapters can't be trained separately
# - impossible to train only adapter weights

# FULL_STATE_DICT
# Rank 0 reconstructs the complete checkpoint at each save.
# Directly loadable for inference (no FSDP needed to reload).
# Alternative: SHARDED_STATE_DICT (faster save, requires FSDP to reload).

# fsdp_backward_prefetch: BACKWARD_PRE
# During backward of layer i, prefetch layer i-1 in parallel.
# Masks allgather NVLink latency behind GPU compute.
```

### Training Script Structure

```python
#!/usr/bin/env python3
"""FSDP + LoRA fine-tuning with SFTTrainer."""

import os
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig, get_peft_model
from trl import SFTTrainer, SFTConfig
from trl.trainer.callbacks import LLMStepProfiler

def main():
    # Model configuration
    model_name = "mistralai/Mistral-Small-4-11B"
    
    # LoRA configuration
    lora_config = LoraConfig(
        r=8,
        lora_alpha=16,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
    )
    
    # Training configuration
    training_args = SFTConfig(
        output_dir="/data/output/mistral-finetuned",
        num_train_epochs=3,
        per_device_train_batch_size=4,
        gradient_accumulation_steps=8,
        learning_rate=2e-5,
        lr_scheduler_type="cosine",
        warmup_ratio=0.1,
        weight_decay=0.01,
        bf16=True,
        fp16=False,
        logging_steps=10,
        eval_strategy="steps",
        eval_steps=100,
        save_strategy="steps",
        save_steps=200,
        save_total_limit=3,
        seed=42,
        max_seq_length=4096,
        packing=False,
        dataset_text_field="text",
        # FSDP handled by accelerate config
    )
    
    # Load model
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=torch.bfloat16,
        attn_implementation="flash_attention_2",
    )
    
    # Apply LoRA
    model = get_peft_model(model, lora_config)
    
    if torch.distributed.get_rank() == 0:
        model.print_trainable_parameters()
        # trainable params: 26M || all params: 11B || trainable%: 0.24%
    
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    tokenizer.pad_token = tokenizer.eos_token
    
    # Trainer
    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        processing_class=tokenizer,
        callbacks=[LLMStepProfiler()],
    )
    
    trainer.train()
    
    # Save final model
    save_path = os.path.join(training_args.output_dir, "final")
    trainer.save_model(save_path)
    tokenizer.save_pretrained(save_path)

if __name__ == "__main__":
    main()
```

### Launch Script

```bash
#!/bin/bash
set -euo pipefail

# Avoid tokenizer deadlocks with multiprocess DataLoader
export TOKENIZERS_PARALLELISM=false

# Better GPU memory management (reduces OOM from fragmentation)
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

# Dependencies
pip install --quiet peft datasets trl transformers accelerate

# Update torchao for latest optimizations
pip install -U torchao

export PATH=$PATH:$HOME/.local/bin

# Working directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
FINETUNE_DIR="$REPO_ROOT/llm/finetune-peft"

echo "============================================"
echo " FSDP fine-tuning — Mistral-Small-4 11B — 2× H200 NVL"
echo "============================================"
echo " date       : $(date '+%Y-%m-%d %H:%M:%S')"
echo " hostname   : $(hostname)"
echo " RANK       : ${RANK:-0}"
echo " MASTER_ADDR: ${MASTER_ADDR:-localhost}"
echo " MASTER_PORT: ${MASTER_PORT:-29500}"
echo " FINETUNE_DIR: $FINETUNE_DIR"

# GPU info
nvidia-smi --query-gpu=index,name,memory.total,driver_version \
           --format=csv,noheader

# NVLink verification
nvidia-smi nvlink --status -i 0 2>/dev/null | grep -E "Link|Active|Inactive" || true

# Launch training via accelerate
cd $FINETUNE_DIR
accelerate launch \
  --config_file config/fsdp_2xH200.yaml \
  --machine_rank ${RANK:-0} \
  --main_process_ip ${MASTER_ADDR:-localhost} \
  --main_process_port ${MASTER_PORT:-29500} \
  --num_machines 2 \
  --num_processes 2 \
  finetune_mistral_fsdpv2.py
```

### Memory Budget (Mistral-Small-4 11B, LoRA, FSDP on 2× H200)

```text
Per-GPU breakdown (H200 141GB HBM3e):
├── Model shard (FSDP Full Shard): ~22 GB (11B × 2 bytes ÷ 2 GPUs)
├── LoRA adapters: ~52 MB (26M params × 2 bytes)
├── Optimizer states (AdamW, LoRA only): ~208 MB
├── Activations (batch=4, seq=4096): ~8 GB
├── NCCL buffers: ~2 GB
├── KV cache during forward: ~4 GB
└── Free headroom: ~104 GB
    Total: ~36 GB used / 141 GB available ✓
```

### Object Detection DDP Example (RetinaNet)

```bash
#!/bin/bash
pip install datasets torchmetrics

echo "rank = $RANK"
echo "master addr = $MASTER_ADDR"
echo "master port = $MASTER_PORT"

export RDMAV_FORK_SAFE=1

torchrun --nnodes=2 --nproc_per_node=1 --node_rank=${RANK} \
         --master_addr=${MASTER_ADDR} --master_port=${MASTER_PORT} \
         retinanet_train_factory.py \
         --batch-size 16 \
         --accum-steps 1 \
         --image-size 800 \
         --max-train 200 \
         --backend cpu \
         --num-workers 8 \
         --debug-freq 10 \
         --max-val 500 \
         --epochs 2 \
         --weights-path /data/input/Datasets/RetinaNet/pretrained/retinanet_resnet50_fpn_coco.pth \
         --local-image-dir /data/input/Datasets/RetinaNet/data/openimages/images \
         --cache-dir /data/input/Datasets/RetinaNet/data/openimages
```

## Common Issues

### OOM when all ranks load model simultaneously
- **Cause**: Missing `fsdp_cpu_ram_efficient_loading`
- **Fix**: Enable it + `fsdp_sync_module_states` — only rank 0 loads, broadcasts via NVLink

### LoRA adapters not training (loss doesn't decrease)
- **Cause**: Missing `fsdp_use_orig_params: true`
- **Fix**: This flag is CRITICAL — without it, FSDP flattens tensors and breaks selective `requires_grad`

### Checkpoint too large (full model saved per worker)
- **Cause**: Using `SHARDED_STATE_DICT` or each rank saving independently
- **Fix**: Use `FULL_STATE_DICT` — only rank 0 saves the complete checkpoint

### NCCL timeout during allgather
- **Cause**: Model shard transfer exceeds default timeout
- **Fix**: Increase `NCCL_TIMEOUT` or ensure RDMA is active (check `NCCL_SOCKET_IFNAME`)

## Best Practices

1. **Always set `fsdp_use_orig_params: true` with LoRA** — non-negotiable
2. **Use `fsdp_cpu_ram_efficient_loading`** — prevents RAM deadlock on multi-node
3. **BF16 over FP16** — better numerical stability for training, no loss scaling needed
4. **`PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`** — reduces fragmentation OOMs
5. **`TOKENIZERS_PARALLELISM=false`** — prevents deadlocks with HuggingFace fast tokenizers + multiprocessing
6. **`FULL_STATE_DICT` for checkpoints** — directly loadable for inference without FSDP
7. **Verify NVLink before training** — check `nvidia-smi nvlink --status`

## Key Takeaways

- FSDP + LoRA enables fine-tuning 11B+ models on 2 GPUs with minimal memory
- `fsdp_cpu_ram_efficient_loading` = only rank 0 loads model (others receive via broadcast)
- `fsdp_use_orig_params` = mandatory for LoRA/PEFT compatibility with FSDP
- `BACKWARD_PRE` prefetch masks NVLink allgather latency behind compute
- H200 141GB gives massive headroom — can fine-tune with larger batches or longer sequences
- `accelerate launch` with FSDP config handles all distributed coordination
