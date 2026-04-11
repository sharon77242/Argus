import pkg from "node-sql-parser";
const { Parser } = pkg;

export class AstSanitizer {
  private parser = new Parser();

  public stripSql(query: string): string {
    const ast = this.parser.astify(query);
    this.traverse(ast);
    return this.parser.sqlify(ast);
  }

  private traverse(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node as unknown[]) {
        this.traverse(item);
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
          this.traverse(n[key]);
        }
      }
    }
  }
}
