---
title: "Use goose with AGENTS.md on a Kubernetes Manifest Repo"
description: "Give the goose coding agent your team's rules for Kubernetes manifests with AGENTS.md, check that the file reached the model, and block cluster changes."
publishDate: "2026-11-21"
author: "Luca Berton"
category: "ai"
difficulty: "beginner"
timeToComplete: "25 minutes"
prerequisites:
  - "A Git repository that holds Kubernetes manifests"
  - "kubectl on the machine where the agent runs"
  - "An API key for a model provider"
tags:
  - "goose"
  - "agents-md"
  - "coding-agents"
  - "gitops"
  - "kustomize"
  - "guardrails"
relatedRecipes:
  - "kagent-kind-install-first-agent"
  - "model-context-protocol-server-kubernetes-kagent"
  - "kubernetes-rbac-least-privilege"
  - "agentic-ai-multiagent-kubernetes"
---

> 💡 **Quick Answer:** Put an `AGENTS.md` file at the root of the manifest repository. goose loads it at the start of every session, so rules such as "render the overlay with `kubectl kustomize` after every change" and "never run `kubectl apply`" reach the model without being repeated in each prompt. Add a `PreToolUse` hook to refuse cluster-changing commands, because a rule in a text file is a request and not a control.

## The Problem

A coding agent that edits Kubernetes manifests does not know how your team works. It does not know that every container needs resource limits, that changes go through a pull request, or that it must not touch the cluster it can reach with your kubeconfig. You can type those rules into every prompt, and you will forget one.

`AGENTS.md` is an open, plain-Markdown format for exactly this: one file in the repository that tells coding agents how to work on the project. goose, an open-source coding agent, reads it by default.

This recipe does not run goose inside a cluster. goose runs on your workstation or in CI, next to the repository, and that is the setup described here.

## The Solution

The goose commands come from a lab that ran them with goose 1.57.0. The example rules for manifests and the pattern in the hook script are written for this recipe: adapt both to your repository.

### Step 1: Install a pinned goose

Install a fixed version without the interactive setup, so that a workstation and a CI job run the same binary.

```bash
curl -fsSL https://github.com/aaif-goose/goose/releases/download/v1.57.0/download_cli.sh \
  | GOOSE_VERSION=v1.57.0 CONFIGURE=false bash
```

The installer puts the binary in `$HOME/.local/bin`. Add that directory to your `PATH` if it is not there.

### Step 2: Connect a model

goose reads the provider and the model from environment variables, and the provider's API key from the provider's own variable. This example uses the OpenAI provider.

```bash
export GOOSE_PROVIDER=openai
export GOOSE_MODEL=<model-name>
export OPENAI_API_KEY=<your-api-key>

goose info --check
```

`goose info --check` tests the provider connection. Do not put the API key in `~/.config/goose/config.yaml`: goose does not read provider keys from that file.

### Step 3: Write AGENTS.md

Create `AGENTS.md` at the root of the repository. Keep it short and specific. Every line is sent with every request, so it costs tokens.

```markdown
# AGENTS.md

## Layout
- Base manifests are in `base/`. One overlay per environment is in `overlays/`.
- Change `base/` only when the change applies to every environment.

## Manifests
- Every container sets `resources.requests` and `resources.limits`.
- Every Deployment sets `securityContext.runAsNonRoot: true`.
- Never write a Secret value into a manifest.

## Validation
- Run `kubectl kustomize overlays/dev` after every change and fix errors before you finish.

## Cluster
- Never run `kubectl apply`, `kubectl delete`, `kubectl patch` or `helm upgrade`. Changes reach the cluster through a pull request.

## Changes
- Add one line under "Unreleased" in CHANGELOG.md for every change.
```

`kubectl kustomize <dir>` renders an overlay on the workstation and does not contact a cluster, which makes it a safe validation step for an agent.

### Step 4: Run a task

Start goose from the repository root, because goose loads context files from the working directory up to the repository root.

```bash
goose run -q -t "Add a readiness probe on /healthz, port 8080, to the web Deployment in base/."
```

`-t` passes the instructions and `-q` prints only the model's response. `goose run` starts a session, does the task and exits. Review the result the way you review a colleague's change:

```bash
git status --short
git diff
kubectl kustomize overlays/dev
```

### Step 5: Refuse cluster-changing commands with a hook

A rule in `AGENTS.md` is text that the model usually follows. A hook is code that runs before a tool call and can deny it. goose discovers project hooks from `.agents/plugins/<plugin-name>/` in the repository:

```text
.agents/plugins/guard/
├── plugin.json
├── hooks/
│   └── hooks.json
└── scripts/
    └── block-cluster-changes.sh
```

`plugin.json`:

```json
{
  "name": "guard",
  "version": "0.1.0",
  "description": "Block commands that change a cluster"
}
```

`hooks/hooks.json` runs the script before every call to the `shell` tool. `on_failure: block` denies the call when the hook itself fails, instead of letting it through.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^shell$",
        "hooks": [
          {
            "type": "command",
            "command": "${PLUGIN_ROOT}/scripts/block-cluster-changes.sh",
            "on_failure": "block"
          }
        ]
      }
    ]
  }
}
```

`scripts/block-cluster-changes.sh` reads the event payload from stdin and prints a block decision when the command matches. Make it executable with `chmod +x`.

```bash
#!/usr/bin/env bash
payload="$(cat)"
if printf '%s' "$payload" | grep -Eq 'kubectl +(apply|delete|patch|replace|scale)|helm +(install|upgrade|uninstall|rollback)|git push'; then
  printf '{"decision":"block","reason":"cluster change blocked by project policy"}'
fi
```

When the hook blocks, goose does not run the tool and tells the model that the call was denied by a policy hook and must not be retried.

### Step 6: A reviewer that cannot change anything

For a task that only reads, restrict the tools instead of trusting the prompt. A goose recipe can limit an extension to named tools with `available_tools`. Save this as `reviewer.yaml`:

```yaml
version: 1.0.0
title: Read-only manifest reviewer
description: Describe the manifests in this repository without being able to change anything
prompt: What does this repository deploy? List the workloads and their namespaces in a short summary.
extensions:
  - type: builtin
    name: developer
    available_tools: [tree, analyze]
```

```bash
goose run -q -n manifest-review --recipe reviewer.yaml
goose session export -n manifest-review -o manifest-review.md
```

With only `tree` and `analyze` listed, the developer extension gives this run no shell tool and no write tool. The exported Markdown file is a record of what the agent was asked and what it did. Attach it to the pull request or keep it as a CI artifact.

## Verify

Check that the file was sent to the model, not only that it exists. goose keeps the most recent model requests in `~/.local/state/goose/logs/`. Search them for a phrase that appears only in your `AGENTS.md`:

```bash
grep -l "kubectl kustomize overlays/dev" ~/.local/state/goose/logs/llm_request.*.jsonl | head -n 1
```

A file name in the output means that the request to the model contained the rule.

Check the result of the task with Git and with the renderer, not with the exit code of `goose run`:

```bash
git diff --stat
kubectl kustomize overlays/dev > /dev/null && echo "overlay renders"
```

Check the hook script on its own, without a model. goose writes a JSON payload with the tool name and the tool input to the script's stdin, so feed it one by hand:

```bash
printf '{"tool_name":"shell","tool_input":{"command":"kubectl delete pod web-0"}}' \
  | .agents/plugins/guard/scripts/block-cluster-changes.sh
```

The script prints the block decision:

```json
{"decision":"block","reason":"cluster change blocked by project policy"}
```

The same test with `kubectl kustomize overlays/dev` as the command prints nothing, which means the call is allowed.

## Common Issues

**goose ignores AGENTS.md**

Hints need the `developer` extension, so check that it is enabled. Start goose from inside the repository. Check that `CONTEXT_FILE_NAMES` is not set to a list without `AGENTS.md`: the default list holds `AGENTS.md` and `.goosehints`.

**You edited AGENTS.md and the agent follows the old rules**

goose loads context files at the start of a session. Start a new session after you change the file.

**The hook never runs**

Project plugins are loaded only when goose is started from that project. The `matcher` is a regular expression and not a glob: a bare `*` is invalid, and goose skips the whole rule with a warning. The shell tool arrives under the bare name `shell`, so `^shell$` is the right matcher.

**The task "succeeded" but nothing was done**

A zero exit code from `goose run` says that the run ended, not that the work is correct. In CI, follow the run with a check on the result, such as `test -s <file>` for a report or `kubectl kustomize` for manifests.

**An unattended run needs different guardrails**

Approve mode does not work in a headless run. The default mode, `GOOSE_MODE=auto`, runs tools without asking, which is why the hook and the tool restriction in this recipe matter. In a GitHub Actions job, also set `GOOSE_DISABLE_KEYRING: "1"`, which disables the system keyring for secret storage, and pass the API key from a repository secret.

## Best Practices

- **State the limit honestly.** The hook matches text in a shell command. It stops the obvious command, not every way to reach the API server: `kubectl -n prod delete pod web-0` does not match the pattern above. The real control is the identity: run the agent with a kubeconfig that is bound to a read-only role, and confirm with `kubectl auth can-i delete pods`.
- **Write rules that can be checked.** "Run `kubectl kustomize overlays/dev` after every change" can be verified. "Write good manifests" cannot.
- **Pin the version.** Install the same goose release on workstations and in CI, and upgrade on purpose.
- **Keep one source of rules.** `AGENTS.md` is read by several coding agents, so the same file serves the whole team whatever tool each person uses.
- **Keep the record.** Export the session of every unattended run. When a change is questioned later, the record shows what the agent was asked and what it ran.

## Key Takeaways

- `AGENTS.md` at the repository root gives a coding agent your rules for manifests, and goose loads it by default.
- Prove that the file reached the model by searching goose's request log, instead of assuming it.
- A text rule is not a control. A `PreToolUse` hook with `on_failure: block` and a recipe with `available_tools` are.
- Validate the agent's work with `git diff` and `kubectl kustomize`, never with the exit code alone.
- The agent's Kubernetes permissions are whatever its kubeconfig allows, so give it a read-only identity.
