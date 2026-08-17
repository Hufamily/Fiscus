// Bedrock Titan Embeddings helper — shared across tracks (B1 interface start).
// Real mode: calls amazon.titan-embed-text-v2:0 (1536 dims, fixed per AGENTS.md §4).
// Mock mode: deterministic sine-based floats derived from text hash.

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const TITAN_MODEL = 'amazon.titan-embed-text-v2:0';

function mockEmbed(text: string): number[] {
  let seed = 0;
  for (let i = 0; i < text.length; i++) {
    seed = Math.imul(seed * 31 + text.charCodeAt(i), 1) | 0;
  }
  return Array.from({ length: 1536 }, (_, i) => {
    const x = Math.sin(seed + i) * 10000;
    return x - Math.floor(x);
  });
}

export async function embed(text: string): Promise<number[]> {
  const hasAwsCreds = !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE);
  if (!hasAwsCreds) return mockEmbed(text);

  const client = new BedrockRuntimeClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
  });
  const resp = await client.send(new InvokeModelCommand({
    modelId: TITAN_MODEL,
    body: JSON.stringify({ inputText: text, dimensions: 1536, normalize: true }),
    contentType: 'application/json',
    accept: 'application/json',
  }));
  const result = JSON.parse(Buffer.from(resp.body).toString('utf-8')) as { embedding: number[] };
  return result.embedding;
}
