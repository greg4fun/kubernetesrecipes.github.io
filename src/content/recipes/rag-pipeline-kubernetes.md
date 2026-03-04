---
title: "Build a RAG Pipeline on Kubernetes"
description: "Deploy a Retrieval-Augmented Generation pipeline on Kubernetes using a vector database, embedding model, and LLM inference server."
category: "ai"
difficulty: "advanced"
timeToComplete: "45 minutes"
kubernetesVersion: "1.28+"
prerequisites:
  - "Kubernetes cluster with GPU nodes"
  - "Working LLM inference server (vLLM or NIM)"
  - "kubectl and Helm CLI"
relatedRecipes:
  - "deploy-mistral-vllm-kubernetes"
  - "deploy-mistral-nvidia-nim"
  - "test-llm-inference-endpoints"
  - "nvidia-gpu-operator-install"
tags:
  - rag
  - retrieval-augmented-generation
  - vector-database
  - embeddings
  - llm
  - ai-workloads
  - chromadb
  - pgvector
publishDate: "2026-02-16"
author: "Luca Berton"
---

> 💡 **Quick Answer:** RAG = Vector DB (store embeddings) + Embedding Model (convert text → vectors) + LLM (generate answers grounded in retrieved context). Deploy ChromaDB or pgvector for storage, use an embedding model sidecar or service, and point your LLM queries through a retrieval layer. All components run as standard Kubernetes deployments.

# Build a RAG Pipeline on Kubernetes

Retrieval-Augmented Generation (RAG) grounds LLM answers in your own documents, reducing hallucination and enabling domain-specific knowledge without fine-tuning.

## Architecture

```text
┌─────────────────────────────────────────────────────────┐
│  Kubernetes Cluster                                      │
│                                                          │
│  ┌──────────┐   ┌────────────────┐   ┌───────────────┐  │
│  │ Ingestion│──▶│ Embedding Model│──▶│ Vector DB     │  │
│  │ (docs)   │   │ (text→vectors) │   │ (ChromaDB /   │  │
│  └──────────┘   └────────────────┘   │  pgvector)    │  │
│                                       └───────┬───────┘  │
│                                               │          │
│  ┌──────────┐   ┌────────────────┐           │          │
│  │ User     │──▶│ RAG Service    │◀──────────┘          │
│  │ Query    │   │ (retrieval +   │                       │
│  └──────────┘   │  prompt build) │──▶┌───────────────┐  │
│                  └────────────────┘   │ LLM Server    │  │
│                                       │ (vLLM / NIM)  │  │
│                                       └───────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Step 1: Deploy a Vector Database

### Option A: ChromaDB

```yaml
# chromadb-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: chromadb
  namespace: ai-inference
spec:
  replicas: 1
  selector:
    matchLabels:
      app: chromadb
  template:
    metadata:
      labels:
        app: chromadb
    spec:
      containers:
        - name: chromadb
          image: chromadb/chroma:latest
          ports:
            - containerPort: 8000
          env:
            - name: CHROMA_SERVER_AUTH_PROVIDER
              value: ""    # No auth for internal use
            - name: ANONYMIZED_TELEMETRY
              value: "false"
          volumeMounts:
            - name: chroma-data
              mountPath: /chroma/chroma
          resources:
            requests:
              memory: "2Gi"
              cpu: "500m"
            limits:
              memory: "4Gi"
              cpu: "2"
      volumes:
        - name: chroma-data
          persistentVolumeClaim:
            claimName: chromadb-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: chromadb
  namespace: ai-inference
spec:
  selector:
    app: chromadb
  ports:
    - port: 8000
      targetPort: 8000
```

### Option B: PostgreSQL with pgvector

```yaml
# pgvector-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: pgvector
  namespace: ai-inference
spec:
  replicas: 1
  selector:
    matchLabels:
      app: pgvector
  template:
    metadata:
      labels:
        app: pgvector
    spec:
      containers:
        - name: postgres
          image: pgvector/pgvector:pg16
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_DB
              value: "ragdb"
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: pgvector-credentials
                  key: username
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: pgvector-credentials
                  key: password
          volumeMounts:
            - name: pg-data
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              memory: "1Gi"
              cpu: "500m"
      volumes:
        - name: pg-data
          persistentVolumeClaim:
            claimName: pgvector-pvc
```

Initialize the vector extension:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    embedding vector(384),   -- dimension depends on model
    metadata JSONB
);

CREATE INDEX ON documents USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
```

## Step 2: Deploy an Embedding Model

Use a lightweight embedding model (no GPU needed for small models):

```yaml
# embedding-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: embedding-server
  namespace: ai-inference
spec:
  replicas: 1
  selector:
    matchLabels:
      app: embedding-server
  template:
    metadata:
      labels:
        app: embedding-server
    spec:
      containers:
        - name: embeddings
          image: ghcr.io/huggingface/text-embeddings-inference:cpu-1.2
          args:
            - --model-id
            - /data/all-MiniLM-L6-v2
            - --port
            - "8080"
          ports:
            - containerPort: 8080
          env:
            - name: HF_HUB_OFFLINE
              value: "1"
          volumeMounts:
            - name: model-data
              mountPath: /data
              readOnly: true
          resources:
            requests:
              memory: "2Gi"
              cpu: "2"
            limits:
              memory: "4Gi"
              cpu: "4"
      volumes:
        - name: model-data
          persistentVolumeClaim:
            claimName: embedding-model-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: embedding-server
  namespace: ai-inference
spec:
  selector:
    app: embedding-server
  ports:
    - port: 8080
      targetPort: 8080
```

Popular embedding models:

| Model | Dimensions | Size | GPU Needed? |
|---|---|---|---|
| all-MiniLM-L6-v2 | 384 | 80 MB | No |
| bge-large-en-v1.5 | 1024 | 1.3 GB | Optional |
| e5-large-v2 | 1024 | 1.3 GB | Optional |
| nomic-embed-text-v1.5 | 768 | 550 MB | No |

## Step 3: Document Ingestion

A Python-based ingestion job:

```yaml
# ingestion-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: document-ingestion
  namespace: ai-inference
spec:
  template:
    spec:
      containers:
        - name: ingest
          image: registry.example.com/org/rag-ingest:latest
          env:
            - name: CHROMA_HOST
              value: "chromadb.ai-inference.svc.cluster.local"
            - name: CHROMA_PORT
              value: "8000"
            - name: EMBEDDING_HOST
              value: "embedding-server.ai-inference.svc.cluster.local"
            - name: EMBEDDING_PORT
              value: "8080"
            - name: DOCS_PATH
              value: "/documents"
          volumeMounts:
            - name: docs
              mountPath: /documents
              readOnly: true
      volumes:
        - name: docs
          persistentVolumeClaim:
            claimName: documents-pvc
      restartPolicy: Never
```

Example ingestion script logic:

```python
# ingest.py (runs inside the job container)
import chromadb
import requests

# Connect to ChromaDB
client = chromadb.HttpClient(host="chromadb", port=8000)
collection = client.get_or_create_collection("docs")

# Read documents
for doc_path in document_paths:
    with open(doc_path) as f:
        text = f.read()

    # Chunk the document
    chunks = split_into_chunks(text, chunk_size=512)

    for i, chunk in enumerate(chunks):
        # Get embedding from embedding server
        resp = requests.post(
            "http://embedding-server:8080/embed",
            json={"inputs": chunk}
        )
        embedding = resp.json()[0]

        # Store in vector DB
        collection.add(
            ids=[f"{doc_path}_{i}"],
            embeddings=[embedding],
            documents=[chunk],
            metadatas=[{"source": doc_path}]
        )
```

## Step 4: RAG Query Service

```python
# rag_service.py
import chromadb
import requests

chroma = chromadb.HttpClient(host="chromadb", port=8000)
collection = chroma.get_collection("docs")

def query_rag(user_question: str) -> str:
    # 1. Embed the question
    embed_resp = requests.post(
        "http://embedding-server:8080/embed",
        json={"inputs": user_question}
    )
    query_embedding = embed_resp.json()[0]

    # 2. Retrieve relevant context
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=5
    )
    context = "\n\n".join(results["documents"][0])

    # 3. Build prompt with context
    prompt = f"""Use the following context to answer the question.

Context:
{context}

Question: {user_question}

Answer:"""

    # 4. Call LLM
    llm_resp = requests.post(
        "http://mistral-vllm:8000/v1/completions",
        json={
            "model": "/data/Mistral-7B-v0.1",
            "prompt": prompt,
            "max_tokens": 256,
            "temperature": 0.3
        }
    )
    return llm_resp.json()["choices"][0]["text"]
```

## Component Communication

All services communicate via Kubernetes internal DNS:

```text
chromadb.ai-inference.svc.cluster.local:8000
embedding-server.ai-inference.svc.cluster.local:8080
mistral-vllm.ai-inference.svc.cluster.local:8000
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Poor retrieval quality | Wrong embedding model or chunk size | Try different model; reduce chunk size to 256–512 |
| Slow queries | Vector DB not indexed | Add IVFFlat or HNSW index |
| Hallucinated answers | Context too short or irrelevant | Increase `n_results`; improve chunking |
| OOM on embedding pod | Large batch of documents | Process in smaller batches |

## Related Recipes

- [Deploy Mistral with vLLM](/recipes/ai/deploy-mistral-vllm-kubernetes/)
- [Deploy Mistral with NVIDIA NIM](/recipes/ai/deploy-mistral-nvidia-nim/)
- [Test LLM Inference Endpoints](/recipes/ai/test-llm-inference-endpoints/)
