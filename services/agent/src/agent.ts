// Core ask() function: RAG retrieval -> Claude -> session persist -> audit.

import { embed } from '../../../lib/embeddings';
import { redact } from '../../../lib/redact';
import { logAction } from '../../../lib/audit';
import {
  IS_MOCK,
  ORG_ID,
  VOLUNTEER_ID,
  invokeModel,
  getAggregates,
  getSimilarTransactions,
  getSession,
  upsertSession,
} from './client';
import { findMentionedTable, describeTable, IS_MCP_MOCK } from './mcp-schema';
import type { AgentResponse, Citation, AggregateRow, TransactionSummary, ConversationTurn } from './types';

const SYSTEM_PROMPT = `You are a financial assistant for a volunteer nonprofit organization.
Answer ONLY from the financial data provided. Cite specific figures.
If the requested information is not in the data, reply with exactly: I don't have that information.
Your reply MUST be valid JSON with no surrounding text:
{"answer": "<the answer>", "citations": [{"category": "<cat>", "detail": "<figures>"}]}`;

function buildContext(
  aggregates: AggregateRow[],
  similar: TransactionSummary[],
  priorTurns: ConversationTurn[],
): string {
  const aggLines = aggregates.map(
    (a) => `  ${a.category}/${a.status}: ${a.count} txn(s), $${(a.total_cents / 100).toFixed(2)}`,
  );
  const simLines = similar.map(
    (t) => `  ${t.category} $${(t.amount_cents / 100).toFixed(2)} on ${t.txn_date} [${t.status}]`,
  );
  const priorLines = priorTurns.length
    ? '\nPrior conversation:\n' + priorTurns.map((t) => `  Q: ${t.question}\n  A: ${t.answer}`).join('\n')
    : '';
  return [
    'Category aggregates:',
    ...aggLines,
    '\nSimilar transactions:',
    ...simLines,
    priorLines,
  ].join('\n');
}

// Deterministic mock answers keyed by question keywords.
function mockAnswer(
  question: string,
): { answer: string; citations: Citation[] } {
  const q = question.toLowerCase();
  if (q.includes('pending')) {
    return {
      answer: 'One transaction is pending review: a veterinary expense of $324.08 dated 2024-08-22.',
      citations: [{ category: 'veterinary', detail: 'pending_review: 1 transaction, $324.08' }],
    };
  }
  if (q.includes('total') || q.includes('spend') || q.includes('year')) {
    return {
      answer: 'Total expenditures are $656.27 across 3 transactions: veterinary $568.77 (2 transactions) and office supplies $87.50 (1 transaction).',
      citations: [
        { category: 'veterinary', detail: 'total: $568.77 (2 transactions)' },
        { category: 'office_supplies', detail: 'total: $87.50 (1 transaction)' },
      ],
    };
  }
  if (q.includes('vet') || q.includes('animal') || q.includes('paws')) {
    return {
      answer: 'Veterinary expenses total $568.77: $244.69 (approved, 2024-07-15) and $324.08 (pending review, 2024-08-22).',
      citations: [{ category: 'veterinary', detail: 'total: $568.77 across 2 transactions' }],
    };
  }
  if (q.includes('supplies') || q.includes('office')) {
    return {
      answer: 'Office supply expenses total $87.50 (1 transaction, approved, 2024-06-10).',
      citations: [{ category: 'office_supplies', detail: 'total: $87.50 (1 transaction, approved)' }],
    };
  }
  return { answer: "I don't have that information.", citations: [] };
}

// Matches "what does the transactions table look like", "schema of
// templates", "structure of the sessions table", "what columns does
// documents have", etc. Table identity itself is resolved dynamically via
// findMentionedTable() (mcp-schema.ts), which checks against the live table
// catalog -- this regex only decides "is this a schema question", it never
// hardcodes a table name or column list.
const SCHEMA_QUESTION_RE = /\b(look like|schema|columns|structure|fields)\b/i;

function isSchemaQuestion(question: string): boolean {
  return SCHEMA_QUESTION_RE.test(question);
}

function parseClaudeJson(raw: string): { answer: string; citations: Citation[] } {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Claude response is not JSON: ${raw.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]) as { answer?: string; citations?: Citation[] };
  return {
    answer: parsed.answer ?? raw.trim(),
    citations: Array.isArray(parsed.citations) ? parsed.citations : [],
  };
}

export async function ask(question: string, sessionId?: string): Promise<AgentResponse> {
  // 1. Load prior session turns
  let priorTurns: ConversationTurn[] = [];
  if (sessionId) {
    const session = await getSession(sessionId);
    priorTurns = session?.pending_documents?.conversation ?? [];
  }

  // 1b. Schema questions ("what does the transactions table look like")
  // are answered via MCP read-only schema introspection instead of the
  // Bedrock RAG path below -- see mcp-schema.ts. Table identity is resolved
  // dynamically against the live (or mock) table catalog, not a hardcoded
  // list, so this works for any table MCP can see.
  if (isSchemaQuestion(question)) {
    const table = await findMentionedTable(question);
    if (table) {
      const answer = await describeTable(table);
      const citations: Citation[] = [
        { category: table, detail: `source: CockroachDB Managed MCP Server, get_table_schema(${table})` },
      ];
      const updatedConversation: ConversationTurn[] = [...priorTurns, { question, answer }];
      const session = await upsertSession(sessionId, { conversation: updatedConversation });
      await logAction(ORG_ID, VOLUNTEER_ID, 'agent_answered_schema', 'sessions', session.id, {
        question,
        table,
        mcp_mock: IS_MCP_MOCK,
      });
      return { answer, citations, session_id: session.id };
    }
  }

  // 2. Retrieve aggregates + vector context
  const [aggregates, queryEmbedding] = await Promise.all([
    getAggregates(),
    embed(question),
  ]);
  const similar = await getSimilarTransactions(queryEmbedding, 3);

  // 3. Build + redact context
  const context = buildContext(aggregates, similar, priorTurns);
  const redactedContext = redact(context);
  const userPrompt = `Question: ${question}\n\nFinancial data:\n${redactedContext}`;

  // 4. Get answer
  let answer: string;
  let citations: Citation[];

  if (IS_MOCK) {
    ({ answer, citations } = mockAnswer(question));
    process.stderr.write(`[mock] question: ${question}\n`);
  } else {
    const raw = await invokeModel(SYSTEM_PROMPT, userPrompt);
    ({ answer, citations } = parseClaudeJson(raw));
  }

  // 5. Persist session
  const updatedConversation: ConversationTurn[] = [...priorTurns, { question, answer }];
  const session = await upsertSession(sessionId, { conversation: updatedConversation });

  // 6. Audit
  await logAction(ORG_ID, VOLUNTEER_ID, 'agent_answered', 'sessions', session.id, { question });

  return { answer, citations, session_id: session.id };
}
