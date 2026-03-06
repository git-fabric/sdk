// Fabric-SDK AIANA -- embedding provider
// OpenAI text-embedding-3-small (1536 dims)

import OpenAI from 'openai';

export class EmbeddingProvider {
  private client: OpenAI;
  private model = 'text-embedding-3-small';

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    return res.data[0].embedding;
  }
}
