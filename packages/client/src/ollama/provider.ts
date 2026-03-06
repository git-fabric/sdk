// OllamaProvider -- local LLM inference via Ollama API
// Used when interceptor returns 'local-llm' lane
// All methods return null on failure for graceful Claude fallback

import axios from 'axios';
import type { OllamaConfig, OllamaChatMessage, OllamaChatResponse } from '../types.js';

export class OllamaProvider {
  private endpoint: string;
  private model: string;
  private timeout: number;

  constructor(config: OllamaConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.model = config.model;
    this.timeout = config.timeout_ms ?? 30_000;
  }

  async chat(
    messages: OllamaChatMessage[],
    options?: { temperature?: number; max_tokens?: number },
  ): Promise<OllamaChatResponse | null> {
    try {
      const resp = await axios.post(
        `${this.endpoint}/api/chat`,
        {
          model: this.model,
          messages,
          stream: false,
          options: {
            temperature: options?.temperature ?? 0.3,
            num_predict: options?.max_tokens ?? 2048,
          },
        },
        { timeout: this.timeout },
      );

      return {
        content: resp.data.message?.content ?? '',
        model: resp.data.model ?? this.model,
        done: resp.data.done ?? true,
      };
    } catch {
      return null;
    }
  }

  async embed(text: string): Promise<number[] | null> {
    try {
      const resp = await axios.post(
        `${this.endpoint}/api/embed`,
        { model: this.model, input: text },
        { timeout: this.timeout },
      );

      return resp.data.embeddings?.[0] ?? resp.data.embedding ?? null;
    } catch {
      return null;
    }
  }

  async generate(
    prompt: string,
    options?: { temperature?: number; max_tokens?: number },
  ): Promise<string | null> {
    try {
      const resp = await axios.post(
        `${this.endpoint}/api/generate`,
        {
          model: this.model,
          prompt,
          stream: false,
          options: {
            temperature: options?.temperature ?? 0.3,
            num_predict: options?.max_tokens ?? 2048,
          },
        },
        { timeout: this.timeout },
      );

      return resp.data.response ?? null;
    } catch {
      return null;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await axios.get(`${this.endpoint}/api/tags`, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}
