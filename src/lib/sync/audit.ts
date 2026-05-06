import { db, schema } from "@/lib/db";

export async function logAudit(args: {
  source: string;
  op: string;
  payload?: unknown;
  error?: string | null;
  correlationId?: string;
}) {
  const id = crypto.randomUUID();
  await db.insert(schema.auditLog).values({
    id,
    source: args.source,
    op: args.op,
    payload: args.payload === undefined ? null : (args.payload as object),
    error: args.error ?? null,
  });
  return { id };
}
