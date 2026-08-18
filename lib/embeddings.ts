// Bedrock Titan Embeddings helper — shared across tracks (B1 interface start).
// Real mode: calls amazon.titan-embed-text-v1 (Titan Embeddings G1 — natively 1536 dims,
// matching AGENTS.md §4). NOTE: titan-embed-text-v2 does NOT support 1536 (only 256/512/1024);
// requesting 1536 from v2 is what caused the 'only 1 subschema matches' Bedrock error.
// Mock mode: deterministic sine-based floats derived from text hash.

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const TITAN_MODEL = process.env.BEDROCK_EMBED_MODEL_ID ?? 'amazon.titan-embed-text-v1';

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
    body: JSON.stringify({ inputText: text }), // G1 takes inputText only; outputs 1536 dims
    contentType: 'application/json',
    accept: 'application/json',
  }));
  const result = JSON.parse(Buffer.from(resp.body).toString('utf-8')) as { embedding: number[] };
  return result.embedding;
}
