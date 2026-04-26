// Fixture: connection constructor called inside a function body — should be flagged

declare class Client {
  query(sql: string): Promise<unknown>;
}
declare function createConnection(opts: unknown): unknown;

export async function handleRequest(userId: string): Promise<unknown> {
  const client = new Client();
  return client.query(`SELECT * FROM users WHERE id = '${userId}'`);
}

export function getUser() {
  const conn = createConnection({ host: "localhost" });
  return conn;
}
