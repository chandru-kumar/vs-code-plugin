/**
 * Shared types for the model layer (chat + completion).
 * Kept dependency-free so it can be imported from anywhere.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
