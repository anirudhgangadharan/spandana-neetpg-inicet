/** Interactive Postgres transactions for identity and faculty-module writes. */
import { Pool, neonConfig, type PoolClient } from '@neondatabase/serverless';

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool !== null) return pool;
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  // Both the container's Node 22 and the local Node runtime provide WebSocket.
  // Keep the HTTP query path for ordinary reads; WebSockets allow row locks.
  neonConfig.webSocketConstructor = WebSocket;
  pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
  return pool;
}

export async function withUserTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
