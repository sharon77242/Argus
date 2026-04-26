// Fixture: connection constructor at module level — should NOT be flagged

declare class Client {
  query(sql: string): Promise<unknown>;
}

const client = new Client();

export async function handleRequest(userId: string): Promise<unknown> {
  return client.query(`SELECT * FROM users WHERE id = '${userId}'`);
}
