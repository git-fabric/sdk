import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaProvider } from '../src/ollama/provider.js';
import axios from 'axios';

vi.mock('axios');
const mockAxios = vi.mocked(axios);

describe('OllamaProvider', () => {
  let ollama: OllamaProvider;

  beforeEach(() => {
    ollama = new OllamaProvider({
      endpoint: 'http://localhost:11434',
      model: 'qwen2.5-coder:3b',
    });
    vi.clearAllMocks();
  });

  describe('chat', () => {
    it('sends correct payload and returns response', async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: {
          message: { content: 'The fix is to bump lodash to 4.17.21' },
          model: 'qwen2.5-coder:3b',
          done: true,
        },
      });

      const result = await ollama.chat([
        { role: 'user', content: 'How to fix CVE-2021-23337?' },
      ]);

      expect(result).not.toBeNull();
      expect(result!.content).toContain('lodash');
      expect(result!.done).toBe(true);
      expect(mockAxios.post).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        expect.objectContaining({ model: 'qwen2.5-coder:3b', stream: false }),
        expect.any(Object),
      );
    });

    it('returns null on error', async () => {
      mockAxios.post = vi.fn().mockRejectedValue(new Error('Connection refused'));
      const result = await ollama.chat([{ role: 'user', content: 'test' }]);
      expect(result).toBeNull();
    });
  });

  describe('embed', () => {
    it('returns embedding vector', async () => {
      mockAxios.post = vi.fn().mockResolvedValue({
        data: { embeddings: [[0.1, 0.2, 0.3]] },
      });

      const result = await ollama.embed('test text');
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it('returns null on error', async () => {
      mockAxios.post = vi.fn().mockRejectedValue(new Error('fail'));
      const result = await ollama.embed('test');
      expect(result).toBeNull();
    });
  });

  describe('isAvailable', () => {
    it('returns true when endpoint responds', async () => {
      mockAxios.get = vi.fn().mockResolvedValue({ data: {} });
      expect(await ollama.isAvailable()).toBe(true);
    });

    it('returns false when endpoint is down', async () => {
      mockAxios.get = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      expect(await ollama.isAvailable()).toBe(false);
    });
  });
});
