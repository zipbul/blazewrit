# Google A2A (Agent-to-Agent) Protocol

Research date: 2026-04-01. Sources: a2a-protocol.org, Google Cloud Blog, GitHub a2aproject/A2A, IBM, InfoWorld.

## Overview

A2A is an open protocol for communication between opaque AI agents. Launched by Google in April 2025, now maintained by the Linux Foundation under Apache 2.0. Backed by 150+ organizations including AWS, Cisco, Google, IBM Research, Microsoft, Salesforce, SAP, ServiceNow. Technical steering committee from these 8 companies guides the spec.

**Current version: v1.0** (first stable, production-ready release). Previous milestones: v0.1 (April 2025), v0.3 (July 2025), v1.0 (early 2026).

**Relationship to MCP**: A2A complements MCP. MCP handles tool/context integration within agents; A2A handles communication between agents. Most production systems use both.

## Architecture: Three Layers

1. **Canonical Data Model** -- core types (Task, Message, Part, Artifact, AgentCard)
2. **Abstract Operations** -- SendMessage, GetTask, CancelTask, etc.
3. **Protocol Bindings** -- JSON-RPC 2.0 over HTTP(S), gRPC (v0.3+), HTTP/REST

## Core Actors

| Actor | Role |
|---|---|
| User | Human or automated service initiating requests |
| A2A Client (Client Agent) | Application acting on user's behalf |
| A2A Server (Remote Agent) | AI agent exposing HTTP endpoint, opaque black-box |

## Agent Card

JSON metadata document published at `/.well-known/agent-card.json`. Digital business card for agent discovery.

### Required Fields
- `name` -- agent identity
- `url` -- service endpoint
- `version` -- A2A protocol version
- `capabilities` -- supported features (streaming, push notifications, extended cards)
- `skills` -- list of AgentSkill objects

### Optional Fields
- `description`, `provider`, `documentationUrl`
- `icon_url`
- `authentication` -- security schemes
- `defaultInputModes`, `defaultOutputModes` -- supported MIME types
- `supported_interfaces` -- ordered list of endpoints/protocols
- `extensions` -- optional or required protocol extensions
- `signature` -- cryptographic verification (v0.3+, signed Agent Cards)

### Discovery
Client fetches `GET https://<base_url>/.well-known/agent-card.json`. Extended (authenticated) card available via `GetExtendedAgentCard` operation.

### Signed Agent Cards (v0.3+)
Cryptographic verification of agent identity and metadata. Critical for enterprise deployments where agents must prove identity.

## Task Lifecycle & States

```
submitted --> working --> completed
                |------> failed
                |------> canceled
                |------> input-required --> (user sends more) --> working
                |------> auth-required --> (auth provided) --> working
                |------> rejected
```

| State | Description |
|---|---|
| `submitted` | Initial state upon creation |
| `working` | Active processing |
| `input-required` | Agent awaiting additional client input |
| `auth-required` | Authentication needed to proceed (v1.0) |
| `completed` | Successfully finished (terminal) |
| `failed` | Execution failed (terminal) |
| `canceled` | User-initiated cancellation (terminal) |
| `rejected` | Agent declined processing (terminal) |

Terminal states prevent new messages from being accepted.

## Message Format

```json
{
  "role": "user" | "agent",
  "parts": [
    { "text": "plain text content" },
    { "raw": "<binary>", "mediaType": "image/png", "filename": "screenshot.png" },
    { "url": "https://...", "mediaType": "application/pdf" },
    { "data": { "structured": "json" }, "mediaType": "application/json" }
  ],
  "metadata": {}
}
```

**Part types**: text, raw (inline binary), url (external reference), data (structured JSON). All parts include optional `mediaType`, `filename`, `metadata`.

**Context preservation**: `contextId` groups related tasks in conversational sessions. Server-generated for new conversations; clients may reference existing contexts for multi-turn interactions.

## Core Operations (JSON-RPC Methods)

| Method | Description |
|---|---|
| `SendMessage` | Initiate or continue task interaction |
| `SendStreamingMessage` | Real-time update streaming via SSE |
| `GetTask` | Poll task status and artifacts |
| `ListTasks` | Paginated task collection with filtering |
| `CancelTask` | Request task termination |
| `SubscribeToTask` | Persistent streaming connection |
| `GetExtendedAgentCard` | Authenticated detailed capabilities |

### Push Notification Operations
| Method | Description |
|---|---|
| `CreateTaskPushNotificationConfig` | Register webhook endpoint |
| `GetTaskPushNotificationConfig` | Retrieve config details |
| `ListTaskPushNotificationConfigs` | Enumerate webhooks for task |
| `DeleteTaskPushNotificationConfig` | Remove webhook |

### JSON-RPC Request Format
```json
{
  "jsonrpc": "2.0",
  "method": "SendMessage",
  "params": { "a2a-message": {...}, "a2a-taskId": "..." },
  "id": "request-id"
}
```

Service parameters use `a2a-` prefix.

### SendMessageConfiguration
- `returnImmediately: false` (default) -- blocks until terminal/interrupted state
- `returnImmediately: true` -- returns immediately with in-progress task
- `acceptedOutputModes` -- client declares accepted response formats

## Streaming Support (SSE)

Three communication patterns:
1. **Request/Response (Polling)** -- client polls for updates
2. **Streaming (SSE)** -- real-time incremental results over persistent HTTP
3. **Push Notifications** -- server sends async updates to client webhooks

### Stream Response Types
- `Task` objects with current state
- `Message` objects for direct (immediate) responses
- `TaskStatusUpdateEvent` for status changes
- `TaskArtifactUpdateEvent` for artifact updates

Streams terminate when tasks reach terminal states. Multiple concurrent streams per task supported.

### gRPC Support (v0.3+)
Optional gRPC binding for higher-performance deployments. Uses server streaming RPCs for streaming operations as defined in Protocol Buffers spec.

## Authentication & Security

### Supported Security Schemes
| Scheme | Details |
|---|---|
| HTTP Basic | Standard basic auth |
| HTTP Bearer | Token-based |
| API Key | Header, query, or cookie |
| OAuth2 | Authorization code, client credentials, device code flows |
| OpenID Connect | Standard OIDC |
| Mutual TLS (mTLS) | Certificate-based mutual auth |

Agents declare required schemes in `AgentCard.security`. Clients must authenticate using declared mechanisms. Authorization errors (403) must not reveal resource existence.

## Multi-Turn Interactions

- `contextId` groups related tasks in conversational sessions
- Server-generated for new conversations; clients may reference existing
- `taskId` must reference existing tasks for continuation
- Agents reject mismatched `contextId`/`taskId` combinations
- Messages can reference related tasks via `referenceTaskIds`

## Multi-Tenancy (v1.0)

Single endpoint can securely host many agents. Critical for platform deployments.

## Error Handling

Standard JSON-RPC error codes + A2A-specific errors:
- `TaskNotFoundError`
- `UnsupportedOperationError`
- `ContentTypeNotSupportedError`
- `VersionNotSupportedError`
- `ExtensionSupportRequiredError`

## Pagination

Cursor-based via `pageToken`/`nextPageToken` (not offset-based).

## Versioning

Clients and servers negotiate via `A2A-Version` service parameter. Unsupported versions trigger `VersionNotSupportedError`. Multiple simultaneous versions supported through deprecation lifecycle.

## v1.0 Migration from v0.3

- Breaking changes to interaction protocol
- AgentCard evolved backward-compatibly (agents can advertise both v0.3 and v1.0)
- Progressive migration supported (no immediate cutover required)

## Reference Implementations & SDKs

### Official SDKs
| Language | Package |
|---|---|
| Python | `pip install a2a-sdk` |
| Go | `go get github.com/a2aproject/a2a-go` |
| JavaScript | `npm install @a2a-js/sdk` |
| Java | Maven |
| C#/.NET | `dotnet add package A2A` (NuGet) |

### Framework Integrations
- Google ADK (Application Development Kit)
- LangGraph
- BeeAI

### Resources
- Spec: https://a2a-protocol.org/latest/specification/
- GitHub: https://github.com/a2aproject/A2A
- Samples: https://github.com/a2aproject/a2a-samples
- DeepLearning.AI course available
- AWS Bedrock AgentCore has A2A protocol contract support

## Relevance to blazewrit

A2A provides the inter-agent communication layer. Key integration points:
- Agent Cards for agent discovery (each blazewrit agent could publish capabilities)
- Task lifecycle maps to blazewrit step states
- Streaming (SSE) for real-time step progress
- Multi-turn interactions for dialogue-heavy steps (orient, dialogue)
- Push notifications for long-running implement/verify cycles
- MCP for tool integration within agents + A2A for agent-to-agent coordination

## Sources

- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)
- [A2A Core Concepts](https://a2a-protocol.org/latest/topics/key-concepts/)
- [A2A v1.0 Announcement](https://a2a-protocol.org/latest/announcing-1.0/)
- [Google Developers Blog - A2A Announcement](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
- [Google Cloud Blog - A2A Upgrade](https://cloud.google.com/blog/products/ai-machine-learning/agent2agent-protocol-is-getting-an-upgrade)
- [GitHub - a2aproject/A2A](https://github.com/a2aproject/A2A)
- [IBM - What Is A2A](https://www.ibm.com/think/topics/agent2agent-protocol)
- [InfoWorld - A2A gRPC and Enterprise Security](https://www.infoworld.com/article/4032776/google-upgrades-agent2agent-protocol-with-grpc-and-enterprise-grade-security.html)
- [AWS Bedrock A2A Contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-a2a-protocol-contract.html)
