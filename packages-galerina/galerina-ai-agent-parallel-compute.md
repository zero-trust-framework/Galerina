# Galerina Parallel AI Agents, CPU and GPU Compute

This document explains how Galerina can support AI agents running in parallel, while
also supporting general CPU, GPU, AI accelerator and future photonic execution.

The goal is to keep the language safe, typed and reportable. Galerina should not run
AI agents as uncontrolled background processes.

Galerina should run agents as:

```text
typed
supervised
permissioned
bounded
cancelable
reportable
```

## Core Principle

```text
Use async flow for parallel agent control.
Use compute flow for CPU/GPU/accelerator execution.
Use secure flow for policy-controlled work.
Use typed outputs for all agent results.
Use reports for every target and fallback decision.
```

AI agents should be allowed to run in parallel, but each agent must declare:

```text
input type
output type
tools
effects
permissions
memory budget
timeout
rate limits
failure behaviour
```

## Package Overview

Recommended package split:

```text
packages-galerina/galerina-core
  flow, secure flow, async flow, compute flow, Result, Option, match, records

packages-galerina/galerina-core-runtime
  structured concurrency, cancellation, timeouts, memory limits, supervision

packages-galerina/galerina-core-security
  permissions, redaction, tool safety, unsafe reports, policy checks

packages-galerina/galerina-ai-agent
  agent definitions, tools, task groups, merge policies and agent reports

packages-galerina/galerina-core-compute
  compute auto, target planning, fallback rules and compute reports

packages-galerina/galerina-core-vector
  Vector<T>, Matrix<T>, Tensor<T>, embeddings, distance functions, batches

packages-galerina/galerina-target-cpu
  CPU execution, x86_64, arm64, riscv64 and vector fallback

packages-galerina/galerina-target-gpu
  GPU execution/planning for CUDA, ROCm, OpenCL, Vulkan and WebGPU backends

packages-galerina/galerina-target-ai-accelerator
  NPU, TPU and AI-chip planning

packages-galerina/galerina-target-photonic
  future photonic planning and simulation
```

## Important Distinction

Do not think of a whole AI agent as "running on GPU".

A better model is:

```text
Agent control:
  CPU

Agent permissions:
  CPU/runtime/security layer

Agent tools:
  CPU / filesystem / database / network

AI model inference:
  CPU, GPU, AI accelerator, low-bit backend or future photonic target

Vector/matrix work:
  CPU vector, GPU, AI accelerator or fallback CPU

Policy decision:
  CPU

Reports:
  CPU/runtime/tooling
```

Galerina should separate:

```text
async flow
  parallel control and orchestration

compute flow
  heavy compute and target selection
```

## Parallel AI Agent Concept

An AI agent in Galerina should be a typed and supervised unit of work.

```Galerina
agent DocumentationAgent {
  input ProjectReviewRequest
  output AgentResult

  tools {
    document.read allow "./docs"
    repo.read allow "./src"
    shell deny
    network deny
  }

  limits {
    timeout 30s
    memory 128mb
    max_tool_calls 50
  }
}
```

Another agent:

```Galerina
agent SecurityAgent {
  input ProjectReviewRequest
  output AgentResult

  tools {
    repo.read allow "./src"
    security.scan allow
    dependency.scan allow
    shell deny
  }

  effects [filesystem_read]

  limits {
    timeout 45s
    memory 256mb
    max_tool_calls 100
  }
}
```

## Running Agents In Parallel

Parallel agents should run inside a supervised task group.

```Galerina
secure async flow reviewProject(input: ProjectReviewRequest)
  -> Result<ProjectReviewReport, AgentError>
{
  task_group agents timeout 90s {
    let docs = spawn DocumentationAgent.run(input)
    let code = spawn CodeReviewAgent.run(input)
    let sec  = spawn SecurityAgent.run(input)

    let results = await_all [docs, code, sec]
  }

  let report = AgentMergePolicy.combine(results)

  return Ok(report)
}
```

This means:

```text
all agents are tracked
timeouts are enforced
memory limits are enforced
tool permissions are checked
failed agents return typed errors
cancellation is automatic
results are merged through policy
```

## What Galerina Should Not Allow By Default

Galerina should avoid uncontrolled background execution.

Avoid:

```Galerina
spawn SecurityAgent.run(input)
```

without supervision.

Better:

```Galerina
task_group agents timeout 60s {
  let security = spawn SecurityAgent.run(input)
  let result = await security
}
```

Rule:

```text
Every parallel agent must belong to a task group, queue, worker pool or supervised runtime.
```

This prevents:

```text
orphaned agents
unbounded cost
unbounded memory use
API rate limit abuse
agents continuing after cancellation
unsafe side effects
unreported tool calls
```

## Typed Agent Inputs And Outputs

Agents should not pass around unrestricted text when the result affects
application behaviour.

Bad model:

```text
agent receives random prompt string
agent returns random text
application trusts the answer
```

Better model:

```Galerina
record AgentTask {
  objective: Text
  files: Array<SafePath>
  maxFindings: Int range 1..50
}

logic Severity {
  Low
  Medium
  High
  Critical
}

record AgentFinding {
  title: Text
  severity: Severity
  evidence: Text
  confidence: Confidence
}

record AgentResult {
  findings: Array<AgentFinding>
  confidence: Confidence
}
```

Rule:

```text
Agents should return typed results when their output affects logic, security or workflow decisions.
```

## Agent Tool Permissions

Agents should not automatically receive every tool.

```Galerina
agent BugFinder {
  tools {
    repo.read allow "./src"
    static_analysis.run allow
    shell deny
    network deny
    storage.write deny
  }

  limits {
    timeout 20s
    memory 128mb
    max_tool_calls 50
  }
}
```

This allows the agent to inspect code, but prevents it from:

```text
running shell commands
sending data to the internet
reading secret files
changing source code
deleting files
deploying code
```

## CPU Role

CPU is the default execution environment.

CPU is best for:

```text
agent orchestration
tool calling
file reading
API calls
database calls
routing
policy decisions
security checks
JSON validation
logging
queue coordination
small model inference
fallback execution
```

CPU targets include:

```text
Intel x86_64
AMD x86_64
ARM64 / AArch64
AWS Graviton
Apple Silicon
RISC-V later
```

Recommended package:

```text
packages-galerina/galerina-target-cpu
```

Example target report:

```json
{
  "target": "cpu",
  "architecture": "arm64",
  "os": "linux",
  "vector_features": ["neon"],
  "fallback": false
}
```

## GPU Role

GPU is useful for compute-heavy work.

GPU is best for:

```text
LLM inference
embedding generation
vector search ranking
image classification
audio analysis
batch summarisation
matrix multiplication
tensor operations
neural network workloads
large numeric arrays
```

Recommended package:

```text
packages-galerina/galerina-target-gpu
```

Galerina source should stay generic.

Prefer:

```Galerina
compute auto {
  prefer gpu
  fallback cpu
}
```

Avoid vendor-specific source syntax:

```Galerina
compute target nvidia_cuda fallback cpu
```

Vendor selection should happen through backend config and reports.

## Compute Flow Inside Agents

Agent orchestration may run on CPU, while heavy model work runs through
`compute flow`.

```Galerina
compute flow createEmbeddings(docs: Array<Document>)
  -> Array<Embedding>
{
  compute auto {
    prefer gpu
    fallback cpu
  }

  return ai.embedBatch(docs)
}
```

Then an agent can call it:

```Galerina
agent EmbeddingAgent {
  input DocumentBatch
  output EmbeddingResult

  tools {
    model.infer allow
  }

  limits {
    timeout 60s
    memory 512mb
  }
}
```

## Combined CPU/GPU Example

```Galerina
secure async flow searchAndRank(input: SearchRequest)
  -> Result<SearchResponse, SearchError>
{
  task_group searchAgents timeout 60s {
    let keyword  = spawn KeywordAgent.run(input)
    let semantic = spawn SemanticAgent.run(input)
    let safety   = spawn SafetyAgent.run(input)

    let results = await_all [keyword, semantic, safety]
  }

  let ranked = rankResults(results)

  return Ok(ranked)
}

compute flow rankResults(results: AgentResults) -> SearchResponse {
  compute auto {
    prefer gpu
    fallback cpu
  }

  return vector.rank(results)
}
```

In this example:

```text
searchAndRank:
  CPU async orchestration

KeywordAgent / SemanticAgent / SafetyAgent:
  CPU-supervised agents

rankResults:
  GPU if available
  CPU fallback if not
```

## Compute Target Selection

Galerina should use generic target names:

```text
cpu
gpu
ai_accelerator
wasm
photonic
low_bit_ai
```

Avoid hard-coding vendor names into normal syntax.

Good:

```Galerina
compute auto {
  prefer gpu
  fallback cpu
}
```

Good:

```Galerina
compute auto {
  prefer ai_accelerator
  prefer gpu
  fallback cpu
}
```

Good:

```Galerina
compute auto {
  prefer low_bit_ai
  fallback cpu
}
```

Backend config can choose the implementation:

```Galerina
compute_backend {
  gpu {
    backend auto
    allow ["nvidia_cuda", "amd_rocm", "opencl"]
  }

  low_bit_ai {
    backend auto
    allow ["bitnet", "ternary_native", "cpu_reference"]
  }
}
```

## CPU Fallback Rule

Every advanced compute feature should have a CPU fallback unless it is
explicitly hardware-specific.

Rule:

```text
If GPU is unavailable, use CPU.
If AI accelerator is unavailable, use CPU.
If low-bit backend is unavailable, use CPU reference.
If photonic target is unavailable, use CPU simulation or CPU fallback.
```

Example report:

```json
{
  "flow": "rankResults",
  "requested": "compute auto",
  "selected_target": "cpu",
  "fallback": true,
  "reason": "No supported GPU backend available"
}
```

## Agent Merge Policy

Parallel agents should not automatically decide final outcomes.

Bad:

```Galerina
if SecurityAgent.saysSafe {
  deployToProduction()
}
```

Good:

```Galerina
let decision = DeploymentPolicy.decide(agentReport)

match decision {
  Allow => deployToProduction()
  Review => holdForHumanReview()
  Deny => stopDeployment()
}
```

Rule:

```text
Agent output can inform decisions.
Agent output must not directly become a security decision.
```

## Reports

Galerina should generate reports for parallel agents and compute targets.

Possible reports:

```text
agent-report.json
agent-tool-report.json
agent-cost-report.json
agent-memory-report.json
agent-security-report.json
agent-decision-report.json
agent-failure-report.json
compute-target-report.json
fallback-report.json
```

Example agent report:

```json
{
  "flow": "reviewProject",
  "parallel": true,
  "timeout": "90s",
  "agents": [
    {
      "name": "DocumentationAgent",
      "status": "passed",
      "toolCalls": 12,
      "memory": "64mb",
      "duration": "14s"
    },
    {
      "name": "SecurityAgent",
      "status": "passed",
      "toolCalls": 21,
      "memory": "128mb",
      "duration": "19s"
    }
  ],
  "unsafeToolsUsed": [],
  "humanReviewRequired": true
}
```

Example compute report:

```json
{
  "flow": "createEmbeddings",
  "requested": "compute auto",
  "selected_target": "gpu",
  "backend": "nvidia_cuda",
  "fallback": false,
  "memory": "512mb"
}
```

Fallback example:

```json
{
  "flow": "createEmbeddings",
  "requested": "compute auto",
  "selected_target": "cpu",
  "backend": "cpu_vector",
  "fallback": true,
  "reason": "No supported GPU backend available"
}
```

## Security Rules

Parallel AI agents must follow strict safety rules.

```text
Agents must declare tools.
Agents must declare effects.
Agents must have memory limits.
Agents must have timeouts.
Agents must have typed inputs.
Agents must have typed outputs.
Agents must run inside supervised structures.
Agents must not access secrets unless explicitly allowed.
Agents must not write files unless explicitly allowed.
Agents must not run shell unless explicitly unsafe.
Agents must not make final security decisions directly.
```

Compute rules:

```text
GPU output must return to typed Galerina values.
AI model output is not automatically true.
Confidence is not Bool.
Distribution<T> is not Bool.
Model output cannot directly allow dangerous actions.
CPU fallback must be reportable.
Unsafe native runtimes must be explicit.
```

## Language Features Required

Galerina needs these language features to support this properly:

```text
async flow
secure flow
compute flow
task_group
spawn
await
await_all
timeouts
cancellation
Result<T, E>
Option<T>
typed records
effects
permissions
memory budgets
typed reports
policy matching
exhaustive match
```

Useful later:

```text
stream flow
worker pools
queues
distributed task execution
agent memory policy
cost budgets
token budgets
model selection policy
```

## Future Distributed Agent Workers

For larger workloads, Galerina may later support distributed agents through queues and
workers.

Example use cases:

```text
large codebase analysis
multi-repository scanning
background document indexing
long AI workflows
batch embedding generation
large security audits
```

Possible package:

```text
packages-galerina/Galerina-queue
```

Future model:

```text
request flow
  -> queue job
  -> worker pool
  -> parallel agents
  -> compute flow
  -> typed report
```

Rules:

```text
jobs must be idempotent where needed
retries must be typed
failures must be reported
workers must have memory limits
agents must have permissions
unsafe tools must be denied by default
```

## Final Principle

Galerina should support parallel AI agents across CPU and GPU by separating
orchestration from compute.

```text
CPU:
  orchestration
  tools
  permissions
  security
  policy
  I/O
  fallback

GPU:
  model inference
  embeddings
  vector operations
  tensors
  matrix operations
  batch AI workloads
```

Final rule:

```text
AI agents in Galerina should be parallel, but supervised.
Compute should be accelerated, but typed.
GPU should be used when useful, but CPU fallback should remain available.
Agent decisions should be policy-checked, not blindly trusted.
Everything should be bounded, permissioned and reportable.
```
