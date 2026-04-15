import pkg from "node-sql-parser";
const { Parser } = pkg;

// Keys whose values are query operators, not user data — must be preserved.
// e.g. { age: { $gt: 30 } } → { age: { $gt: '?' } } keeps the operator key '$gt'.
const NOSQL_OPERATOR_PREFIXES = ['$', '_'];

function isOperatorKey(key: string): boolean {
  return NOSQL_OPERATOR_PREFIXES.some(p => key.startsWith(p));
}

export class AstSanitizer {
  private parser = new Parser();

  /**
   * Strip all literal values from a SQL query using AST traversal.
   * Throws if the query cannot be parsed — callers should fall back to regex.
   */
  public stripSql(query: string): string {
    const ast = this.parser.astify(query);
    this.traverseSql(ast);
    return this.parser.sqlify(ast);
  }

  /**
   * Strip all leaf values from a NoSQL document (MongoDB filter, DynamoDB
   * ExpressionAttributeValues, Firestore data, etc.) replacing them with '?'.
   * Operator keys (starting with '$' or '_') are preserved; only their values
   * are replaced. Returns a new object — the original is not mutated.
   */
  public sanitizeDocument(doc: unknown): unknown {
    if (Array.isArray(doc)) {
      return doc.map(item => this.sanitizeDocument(item));
    }
    if (doc !== null && typeof doc === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
        // Recurse into operator sub-documents; replace primitive values with '?'
        result[key] = (value !== null && typeof value === 'object')
          ? this.sanitizeDocument(value)
          : isOperatorKey(key) ? value  // keep operator flag values (true/false/$exists etc.)
          : '?';
      }
      return result;
    }
    // Primitive at top-level (e.g. a bare string/number filter value)
    return '?';
  }

  private traverseSql(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node as unknown[]) {
        this.traverseSql(item);
      }
      return;
    }

    if (node !== null && typeof node === 'object') {
      const n = node as Record<string, unknown>;
      const literalTypes = [
        'number', 'string', 'single_quote_string', 'double_quote_string',
        'hex_string', 'bit_string', 'bool', 'null'
      ];

      if (typeof n.type === 'string' && literalTypes.includes(n.type)) {
        n.type = 'origin';
        n.value = '?';
      } else {
        for (const key of Object.keys(n)) {
          this.traverseSql(n[key]);
        }
      }
    }
  }
}
