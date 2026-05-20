/**
 * Shared types for the model layer (chat + completion + agent).
 * Kept dependency-free so it can be imported from anywhere.
 */

/**
 * A single tool call emitted by an assistant message.
 * Mirrors the OpenAI / Ollama function-calling response shape.
 */
export interface ToolCall {
  /** Stable id used to correlate the call with its tool-result message. */
  id: string;
  type: 'function';
  function: {
    name: string;
    /** JSON-stringified arguments. The model is responsible for valid JSON. */
    arguments: string;
  };
}

/**
 * One OpenAI-style tool descriptor sent to the model in a chat request.
 */
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    /** JSON Schema for the arguments. */
    parameters: object;
  };
}

/**
 * One message in a chat conversation. Supports all four OpenAI roles:
 *  - system   : instructions / context for the model
 *  - user     : developer / human input
 *  - assistant: model output (may include `tool_calls` instead of content)
 *  - tool     : the result of a tool call (must reference `tool_call_id`)
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** Empty string when an assistant message only contains `tool_calls`. */
  content: string;
  /** Only set on assistant messages that requested tools. */
  tool_calls?: ToolCall[];
  /** Required on tool messages — must match the `id` of the original call. */
  tool_call_id?: string;
  /** Optional friendly tool name on tool messages. */
  name?: string;
}
