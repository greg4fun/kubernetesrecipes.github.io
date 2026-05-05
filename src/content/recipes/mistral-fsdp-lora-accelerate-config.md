---
title: "Mistral FSDP LoRA Complete Accelerate Config"
description: "Complete accelerate FSDP configuration for fine-tuning Mistral-Small-4 11B with LoRA on multi-GPU H200 clusters. Covers every FSDP2 setting with explanations."
tags:
  - "fsdp"
  - "lora"
  - "mistral"
  - "accelerate"
  - "fine-tuning"
category: "ai"
publishDate: "2026-05-05"
author: "Luca Berton"
difficulty: "advanced"
relatedRecipes:
  - "fsdp-lora-finetuning-kubernetes"
  - "runai-distributed-training-openshift"
  - "multi-node-training-kubernetes"
  - "distributed-multi-gpu-inference-kubernetes"
---

> 💡 **Quick Answer:** Fine-tuning Mistral-Small-4 11B with LoRA + FSDP2 on 3× H200 requires a carefully tuned accelerate config. Key settings: `fsdp_use_orig_params: true` (mandatory for PEFT), `fsdp_cpu_ram_efficient_loading: true` (only rank 0 loads 238GB), `fsdp_reshard_after_forward: true` (FSDP2 memory optimization), and `Mistral4DecoderLayer` as the wrap boundary.

## The Problem

FSDP has dozens of configuration options that interact in non-obvious ways. Wrong combinations lead to:

- OOM during loading (all ranks load full model)
- LoRA not training (parameters flattened)
- Deadlocks during checkpoint saving
- Suboptimal memory usage (missing reshard/prefetch)

## The Solution

### Complete Accelerate FSDP Config

```yaml
# fsdp.yaml — Accelerate config for Mistral-Small-4 11B + LoRA on 3× H200
# Reference: linkedin.com/pulse/ai-parallel-training-walkthrough-joshua-

compute_environment: LOCAL_MACHINE
debug: true
distributed_type: FSDP
downcast_bf16: 'no'
enable_cpu_affinity: false
mixed_precision: bf16
num_machines: 3
num_processes: 3
rdzv_backend: static
same_network: true
use_cpu: false

fsdp_config:
  # --- FSDP Version ---
  fsdp_version: 2

  # --- PEFT Compatibility (CRITICAL) ---
  # Without this, FSDP flattens all params into 1D tensors,
  # breaking requires_grad selectivity. LoRA adapters won't train.
  fsdp_use_orig_params: true

  # --- Wrapping ---
  fsdp_auto_wrap_policy: TRANSFORMER_BASED_WRAP
  fsdp_transformer_layer_cls_to_wrap: Mistral4DecoderLayer

  # --- Sharding ---
  # Equivalent to FULL_SHARD in FSDP2: re-shard parameters after
  # each forward pass to free memory between micro-batches.
  fsdp_reshard_after_forward: true
  fsdp_limit_all_gathers: true

  # --- Memory / Loading ---
  # Only rank 0 loads the full model from disk.
  # Other ranks receive weights via broadcast (NVLink).
  # Without this: every rank loads 238GB → RAM deadlock.
  fsdp_cpu_ram_efficient_loading: true
  fsdp_sync_module_states: true
  fsdp_offload_params: true

  # --- Prefetch ---
  # BACKWARD_PRE: during backward of layer i, prefetch layer i-1.
  # Masks allgather NVLink latency behind GPU compute.
  fsdp_backward_prefetch: BACKWARD_PRE
  fsdp_forward_prefetch: true

  # --- State Dict ---
  # FULL_STATE_DICT: rank 0 reconstructs complete checkpoint.
  # Directly loadable for inference (no FSDP needed to reload).
  fsdp_state_dict_type: FULL_STATE_DICT
  state_dict_cpu_offload: true

  # --- Activation Checkpointing ---
  # Managed by SFTConfig(gradient_checkpointing=true) instead
  fsdp_activation_checkpointing: false
```

### Training Configuration YAML

```yaml
# config/mistral4small_fsdp_2xH200.yaml

# --- LoRA ---
lora:
  r: 16
  lora_alpha: 32
  lora_dropout: 0.05
  target_modules:
    - q_proj
    - k_proj
    - v_proj
    - o_proj
    - gate_proj
    - up_proj
    - down_proj
  bias: none
  task_type: CAUSAL_LM

# --- Dataset ---
data:
  dataset_name_or_path: /data/input/Datasets/wikitext
  dataset_config_name: wikitext-2-raw-v1
  text_field: text
  train_split: train
  val_split: validation
  max_length: 1024
  prompt_template: null

# --- Training ---
train:
  output_dir: /data/output/Models/mistral4small-lora-fsdp-2xH200
  num_train_epochs: 1

  # FSDP: batch per GPU × 2 GPUs × gradient_accumulation = effective batch
  # 1 × 2 × 16 = 32 effective batch size
  per_device_train_batch_size: 1
  per_device_eval_batch_size: 1
  gradient_accumulation_steps: 16
  gradient_checkpointing: false

  # adamw_torch recommended with FSDP (no paged needed, no CPU offload)
  optim: adamw_torch

  learning_rate: 0.0001
  lr_scheduler_type: cosine
  warmup_ratio: 0.05
  weight_decay: 0.01

  bf16: true
  fp16: false

  logging_steps: 25
  eval_strategy: steps
  eval_steps: 200
  save_strategy: steps
  save_steps: 200
  save_total_limit: 3

  # FSDP + load_best_model_at_end are incompatible
  load_best_model_at_end: false

  report_to: none
  seed: 42
  ddp_find_unused_parameters: false
```

### Python Training Script

```python
"""
Fine-tuning script for Mistral Small 4 (11B) with LoRA — BF16, no quantization.

Architecture:
  Mistral Small 4 is packaged as MistralForConditionalGeneration (vision + text).
  We extract the inner MistralForCausalLM directly, skipping the vision encoder.

  The FP8 weights are dequantized to BF16 at load time by transformers.
  No BitsAndBytes config is used.

Requirements:
  pip install peft trl accelerate transformers datasets

Usage:
  CUDA_VISIBLE_DEVICES=0,1 python finetune_mistral4small.py \
    --config configs/mistral4small_2xH200.yaml

  # With overrides:
  CUDA_VISIBLE_DEVICES=0,1 python finetune_mistral4small.py \
    --config configs/mistral4small_2xH200.yaml \
    --override train.learning_rate=1e-4 --override lora.r=32
"""

import argparse
import logging
import os
from dataclasses import asdict, dataclass, field, fields
from typing import Any, Optional

import torch
import yaml
from datasets import load_dataset
from peft import LoraConfig, TaskType, get_peft_model
from transformers import AutoConfig, AutoTokenizer, Mistral4ForCausalLM
from trl import SFTConfig, SFTTrainer

from llm_train_utils import LLMStepProfiler, print_hw_summary, _nvaml_gpu_stats

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# --- Configuration dataclasses ---

@dataclass
class ModelConfig:
    model_name_or_path: str = "/data/input/Models/Mistral-Small-4-119B-2603"
    torch_dtype: str = "bfloat16"
    device_map: str = "auto"
    use_cache: bool = False
    attn_implementation: Optional[str] = None


@dataclass
class LoRAConfig:
    r: int = 16
    lora_alpha: int = 32
    lora_dropout: float = 0.05
    target_modules: list = field(
        default_factory=lambda: ["q_proj", "k_proj", "v_proj", "o_proj"]
    )
    bias: str = "none"
    task_type: str = "CAUSAL_LM"


@dataclass
class DataConfig:
    dataset_name_or_path: str = "/data/input/Datasets/wikitext"
    dataset_config_name: str = "wikitext-2-raw-v1"
    text_field: str = "text"
    train_split: str = "train"
    val_split: str = "validation"
    max_length: int = 1024
    prompt_template: Optional[str] = None


@dataclass
class TrainConfig:
    output_dir: str = "/data/output/Models/mistral4small-lora-fsdp"
    num_train_epochs: int = 1
    per_device_train_batch_size: int = 1
    per_device_eval_batch_size: int = 1
    gradient_accumulation_steps: int = 16
    gradient_checkpointing: bool = False
    optim: str = "adamw_torch"
    learning_rate: float = 1e-4
    lr_scheduler_type: str = "cosine"
    warmup_ratio: float = 0.05
    weight_decay: float = 0.01
    bf16: bool = True
    fp16: bool = False
    logging_steps: int = 25
    eval_strategy: str = "steps"
    eval_steps: int = 200
    save_strategy: str = "steps"
    save_steps: int = 200
    save_total_limit: int = 3
    load_best_model_at_end: bool = False
    report_to: Optional[str] = None
    seed: int = 42
    ddp_find_unused_parameters: bool = False


def main():
    # Load config from YAML
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=str, required=True)
    parser.add_argument("--override", action="append", default=[])
    args = parser.parse_args()

    with open(args.config) as f:
        cfg = yaml.safe_load(f)

    model_cfg = ModelConfig(**cfg.get("model", {}))
    lora_cfg = LoRAConfig(**cfg.get("lora", {}))
    data_cfg = DataConfig(**cfg.get("data", {}))
    train_cfg = TrainConfig(**cfg.get("train", {}))

    # Load dataset
    train_dataset = load_dataset(
        data_cfg.dataset_name_or_path,
        data_cfg.dataset_config_name,
        split=data_cfg.train_split,
    )
    val_dataset = load_dataset(
        data_cfg.dataset_name_or_path,
        data_cfg.dataset_config_name,
        split=data_cfg.val_split,
    )

    # Load model (extract CausalLM from ConditionalGeneration wrapper)
    model = Mistral4ForCausalLM.from_pretrained(
        model_cfg.model_name_or_path,
        torch_dtype=getattr(torch, model_cfg.torch_dtype),
        use_cache=model_cfg.use_cache,
    )

    # Apply LoRA
    peft_config = LoraConfig(
        r=lora_cfg.r,
        lora_alpha=lora_cfg.lora_alpha,
        lora_dropout=lora_cfg.lora_dropout,
        target_modules=lora_cfg.target_modules,
        bias=lora_cfg.bias,
        task_type=TaskType.CAUSAL_LM,
    )

    model = get_peft_model(model, peft_config)

    logger.info(
        f"LoRA rank={lora_cfg.r}, alpha={lora_cfg.lora_alpha}, "
        f"modules={lora_cfg.target_modules}"
    )

    # Tokenizer
    tokenizer = AutoTokenizer.from_pretrained(model_cfg.model_name_or_path)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # SFTConfig
    sft_config = SFTConfig(
        output_dir=train_cfg.output_dir,
        num_train_epochs=train_cfg.num_train_epochs,
        per_device_train_batch_size=train_cfg.per_device_train_batch_size,
        per_device_eval_batch_size=train_cfg.per_device_eval_batch_size,
        gradient_accumulation_steps=train_cfg.gradient_accumulation_steps,
        gradient_checkpointing=train_cfg.gradient_checkpointing,
        optim=train_cfg.optim,
        learning_rate=train_cfg.learning_rate,
        lr_scheduler_type=train_cfg.lr_scheduler_type,
        warmup_ratio=train_cfg.warmup_ratio,
        weight_decay=train_cfg.weight_decay,
        bf16=train_cfg.bf16,
        fp16=train_cfg.fp16,
        logging_steps=train_cfg.logging_steps,
        eval_strategy=train_cfg.eval_strategy,
        eval_steps=train_cfg.eval_steps,
        save_strategy=train_cfg.save_strategy,
        save_steps=train_cfg.save_steps,
        save_total_limit=train_cfg.save_total_limit,
        seed=train_cfg.seed,
        dataset_text_field=data_cfg.text_field,
        max_seq_length=data_cfg.max_length,
        packing=False,
    )

    # Trainer
    trainer = SFTTrainer(
        model=model,
        args=sft_config,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        processing_class=tokenizer,
        callbacks=[LLMStepProfiler(
            debug_freq=args.debug_freq if hasattr(args, 'debug_freq') else 25,
            seq_len=data_cfg.max_length,
            output_dir=train_cfg.output_dir,
        )],
        report_meta={
            "model": {"name": model_cfg.model_name_or_path, "dtype": str(model_cfg.torch_dtype)},
            "lora": {"r": lora_cfg.r, "alpha": lora_cfg.lora_alpha, "modules": lora_cfg.target_modules},
            "data": {"dataset": data_cfg.dataset_name_or_path, "max_length": data_cfg.max_length},
            "train": {"epochs": train_cfg.num_train_epochs, "lr": train_cfg.learning_rate,
                      "batch": train_cfg.per_device_train_batch_size,
                      "accum": train_cfg.gradient_accumulation_steps},
        },
        script_name="finetune_mistral4small",
    )

    if trainer.accelerator.is_main_process and hasattr(trainer.model, "print_trainable_parameters"):
        trainer.model.print_trainable_parameters()

    logger.info("Starting training...")
    trainer.train()
    logger.info("Training complete.")

    # Save final model
    save_path = os.path.join(train_cfg.output_dir, "final")
    trainer.save_model(save_path)
    tokenizer.save_pretrained(save_path)
    logger.info(f"Model saved to {save_path}")


if __name__ == "__main__":
    main()
```

### Launch Commands

```bash
# Single node, 1 GPU (testing)
CUDA_VISIBLE_DEVICES=0,1 python finetune_mistral4small.py \
  --config configs/mistral4small_2xH200.yaml

# With hyperparameter overrides
CUDA_VISIBLE_DEVICES=0,1 python finetune_mistral4small.py \
  --config configs/mistral4small_2xH200.yaml \
  --override train.learning_rate=1e-4 --override lora.r=32

# Multi-node via accelerate
accelerate launch \
  --config_file fsdp.yaml \
  --machine_rank ${RANK:-0} \
  --main_process_ip ${MASTER_ADDR:-localhost} \
  --main_process_port ${MASTER_PORT:-29500} \
  --num_machines 3 \
  --num_processes 3 \
  finetune_mistral4small.py \
  --config configs/mistral4small_2xH200.yaml
```

### Key FSDP2 Settings Explained

| Setting | Value | Why |
|---------|-------|-----|
| `fsdp_version` | 2 | FSDP2 has better memory efficiency and composability |
| `fsdp_use_orig_params` | true | **Mandatory for LoRA** — preserves tensor shapes for selective grad |
| `fsdp_reshard_after_forward` | true | Equivalent to FULL_SHARD — frees memory between micro-batches |
| `fsdp_limit_all_gathers` | true | Rate-limits allgather to prevent OOM spikes |
| `fsdp_cpu_ram_efficient_loading` | true | Only rank 0 loads model → broadcast to others |
| `fsdp_sync_module_states` | true | Enables the rank 0 → others broadcast |
| `fsdp_offload_params` | true | Offload optimizer states to CPU (saves GPU memory) |
| `fsdp_backward_prefetch` | BACKWARD_PRE | Overlap communication with compute |
| `fsdp_forward_prefetch` | true | Pre-fetch next layer during forward |
| `fsdp_state_dict_type` | FULL_STATE_DICT | Save complete checkpoint for inference |
| `state_dict_cpu_offload` | true | Gather state dict to CPU (avoids GPU OOM during save) |
| `fsdp_transformer_layer_cls_to_wrap` | Mistral4DecoderLayer | Wrap boundary for sharding |
| `fsdp_activation_checkpointing` | false | Handled by SFTConfig instead |

### Why `adamw_torch` with FSDP

```python
# adamw_torch is recommended with FSDP:
# - No paged optimizer needed (unlike bitsandbytes adamw_8bit)
# - No CPU offload overhead if params fit in GPU
# - Compatible with FSDP's parameter sharding
# - bitsandbytes optimizers are problematic with FSDP's flattened params
optim: adamw_torch
```

### Mistral-Small-4 Architecture Note

```python
# Mistral Small 4 is packaged as MistralForConditionalGeneration (vision + text).
# We extract the inner MistralForCausalLM directly, skipping the vision encoder.
# This avoids loading unused vision parameters.

from transformers import Mistral4ForCausalLM

model = Mistral4ForCausalLM.from_pretrained(
    model_path,
    torch_dtype=torch.bfloat16,
    use_cache=False,  # Incompatible with gradient checkpointing
)
```

## Common Issues

### `load_best_model_at_end=True` crashes with FSDP
- **Cause**: FSDP state dict gathering conflicts with best-model reload
- **Fix**: Set `load_best_model_at_end: false` — manually load best checkpoint after training

### Tokenizer deadlocks with multiprocessing DataLoader
- **Cause**: HuggingFace fast tokenizers use Rust threads that deadlock after fork()
- **Fix**: `export TOKENIZERS_PARALLELISM=false`

### Static rendezvous backend fails
- **Cause**: Dynamic DNS resolution issues between nodes
- **Fix**: Use `rdzv_backend: static` with `same_network: true` when nodes are on same network

## Best Practices

1. **FSDP2 over FSDP1** — better composability with PEFT and activation checkpointing
2. **All attention + MLP projections as LoRA targets** — `q/k/v/o_proj` + `gate/up/down_proj` for best quality
3. **`state_dict_cpu_offload: true`** — prevents OOM during checkpoint gathering
4. **`fsdp_limit_all_gathers: true`** — prevents memory spikes from concurrent allgathers
5. **Batch size 1 + gradient accumulation 16** — maximize sequence length per GPU
6. **Cosine scheduler with 5% warmup** — standard for LoRA fine-tuning

## Key Takeaways

- FSDP2 + LoRA on Mistral-Small-4 11B works on 2-3× H200 GPUs
- `fsdp_use_orig_params: true` is non-negotiable for PEFT
- `fsdp_cpu_ram_efficient_loading` prevents RAM deadlock on multi-node
- Use `Mistral4DecoderLayer` as the transformer wrap class
- `adamw_torch` is the correct optimizer for FSDP (not bitsandbytes)
- `load_best_model_at_end` must be false with FSDP
