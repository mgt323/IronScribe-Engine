export { createLlmClient } from './client.js';
export { LlmError, type LlmAttempt, type LlmErrorCode } from './errors.js';
export {
  DEFAULT_EVAL_CASES,
  runEvalSuite,
  type EvalCase,
  type EvalCaseResult,
  type EvalReport,
} from './eval.js';
export { createGeminiAdapter, type GeminiConfig } from './gemini.js';
export {
  createOpenAiCompatibleAdapter,
  detectOpenAiModel,
  type OpenAiCompatibleConfig,
  type OpenAiSchemaMode,
} from './openai-compatible.js';
export { toFlatJsonSchema } from './schema.js';
export {
  createScriptedLlmAdapter,
  createScriptedLlmClient,
  type ScriptedLlmAdapter,
  type ScriptedStep,
} from './testing/fake-client.js';
export type {
  AdapterRequest,
  AdapterResponse,
  ChatMessage,
  FlatJsonSchema,
  LlmClient,
  LlmProviderAdapter,
  ObjectGenerationResult,
  StructuredPrompt,
  TextGenerationResult,
  TokenUsage,
} from './types.js';
