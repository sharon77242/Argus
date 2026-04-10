import pkg from "node-sql-parser";
const { Parser } = pkg;

export class AstSanitizer {
  private parser = new Parser();

  public stripSql(query: string): string {
    const ast = this.parser.astify(query);
    this.traverse(ast);
    return this.parser.sqlify(ast);
  }

  private traverse(node: any): void {
    if (Array.isArray(node)) {
      for (const item of node) {
        this.traverse(item);
      }
      return;
    }

    if (node !== null && typeof node === "object") {
      const literalTypes = [
        "number",
        "string",
        "single_quote_string",
        "double_quote_string",
        "hex_string",
        "bit_string",
        "bool",
        "null"
      ];

      if (typeof node.type === "string" && literalTypes.includes(node.type)) {
        node.type = "origin";
        node.value = "?";
      } else {
        for (const key of Object.keys(node)) {
          this.traverse(node[key]);
        }
      }
    }
  }
}
