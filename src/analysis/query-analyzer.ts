import pkg from 'node-sql-parser';
const { Parser } = pkg;
import type { FixSuggestion } from './types.ts';

/**
 * Analyzes sanitized SQL query *structure* (not values) and returns
 * actionable fix suggestions. Uses AST parsing via node-sql-parser
 * to inspect the query shape rather than fragile regex.
 */
export class QueryAnalyzer {
  private parser: InstanceType<typeof Parser>;
  private recentQueries: Map<string, { count: number; firstSeen: number }> = new Map();
  private readonly N_PLUS_ONE_WINDOW_MS = 1000;
  private readonly N_PLUS_ONE_THRESHOLD = 5;

  constructor() {
    this.parser = new Parser();
  }

  /**
   * Analyze a sanitized SQL query and return fix suggestions.
   */
  public analyze(sanitizedQuery: string): FixSuggestion[] {
    const suggestions: FixSuggestion[] = [];

    // Try AST-based analysis first
    try {
      const ast = this.parser.astify(sanitizedQuery);
      const stmts = Array.isArray(ast) ? ast : [ast];

      for (const stmt of stmts) {
        if (stmt.type === 'select') {
          this.analyzeSelect(stmt, suggestions);
        } else if (stmt.type === 'update') {
          this.analyzeUpdate(stmt, suggestions);
        } else if (stmt.type === 'delete') {
          this.analyzeDelete(stmt, suggestions);
        }
      }
    } catch {
      // AST parsing failed — fall back to basic string analysis
      this.analyzeByString(sanitizedQuery, suggestions);
    }

    // N+1 detection (works on any query)
    this.detectNPlusOne(sanitizedQuery, suggestions);

    return suggestions;
  }

  private analyzeSelect(stmt: any, suggestions: FixSuggestion[]): void {
    // Rule: no-select-star
    const columns = stmt.columns;
    if (columns === '*' || (Array.isArray(columns) && columns.some((c: any) => c.expr?.column === '*'))) {
      suggestions.push({
        severity: 'warning',
        rule: 'no-select-star',
        message: 'SELECT * fetches all columns, increasing I/O and memory usage. List only the columns you need.',
        suggestedFix: 'Replace SELECT * with explicit column names: SELECT col1, col2, ...',
      });
    }

    // Rule: missing-limit
    if (!stmt.limit && !stmt.groupby) {
      suggestions.push({
        severity: 'info',
        rule: 'missing-limit',
        message: 'SELECT without LIMIT may return unbounded rows. Consider adding a LIMIT clause.',
        suggestedFix: 'Add LIMIT N to restrict result size (e.g. LIMIT 100)',
      });
    }

    // Rule: missing-where-select (full table scan)
    if (!stmt.where && !stmt.limit) {
      suggestions.push({
        severity: 'warning',
        rule: 'full-table-scan',
        message: 'SELECT without WHERE or LIMIT will perform a full table scan.',
        suggestedFix: 'Add a WHERE clause to filter results or LIMIT to cap the result set.',
      });
    }
  }

  private analyzeUpdate(stmt: any, suggestions: FixSuggestion[]): void {
    // Rule: missing-where-update
    if (!stmt.where) {
      suggestions.push({
        severity: 'critical',
        rule: 'missing-where-update',
        message: 'UPDATE without WHERE will modify every row in the table. This is almost certainly a bug.',
        suggestedFix: 'Add a WHERE clause to target specific rows.',
      });
    }
  }

  private analyzeDelete(stmt: any, suggestions: FixSuggestion[]): void {
    // Rule: missing-where-delete
    if (!stmt.where) {
      suggestions.push({
        severity: 'critical',
        rule: 'missing-where-delete',
        message: 'DELETE without WHERE will remove every row in the table. This is almost certainly a bug.',
        suggestedFix: 'Add a WHERE clause to target specific rows.',
      });
    }
  }

  /**
   * Fallback string-based analysis when AST parsing fails.
   */
  private analyzeByString(query: string, suggestions: FixSuggestion[]): void {
    const upper = query.toUpperCase().trim();

    if (upper.startsWith('SELECT') && upper.includes('SELECT *')) {
      suggestions.push({
        severity: 'warning',
        rule: 'no-select-star',
        message: 'SELECT * fetches all columns. List only the columns you need.',
      });
    }

    if (upper.startsWith('SELECT') && !upper.includes('LIMIT')) {
      suggestions.push({
        severity: 'info',
        rule: 'missing-limit',
        message: 'SELECT without LIMIT may return unbounded rows.',
      });
    }

    if (upper.startsWith('UPDATE') && !upper.includes('WHERE')) {
      suggestions.push({
        severity: 'critical',
        rule: 'missing-where-update',
        message: 'UPDATE without WHERE will modify every row.',
      });
    }

    if (upper.startsWith('DELETE') && !upper.includes('WHERE')) {
      suggestions.push({
        severity: 'critical',
        rule: 'missing-where-delete',
        message: 'DELETE without WHERE will remove every row.',
      });
    }
  }

  /**
   * Detects N+1 query patterns by tracking query frequency within a window.
   */
  private detectNPlusOne(query: string, suggestions: FixSuggestion[]): void {
    const now = Date.now();

    // Normalize the query to detect repeated structural patterns
    const normalized = query.replace(/\?\s*/g, '?').trim();

    const entry = this.recentQueries.get(normalized);

    if (entry) {
      if (now - entry.firstSeen <= this.N_PLUS_ONE_WINDOW_MS) {
        entry.count++;
        if (entry.count >= this.N_PLUS_ONE_THRESHOLD) {
          suggestions.push({
            severity: 'warning',
            rule: 'n-plus-one',
            message: `This query pattern has been executed ${entry.count} times within ${this.N_PLUS_ONE_WINDOW_MS}ms. This is likely an N+1 query problem.`,
            suggestedFix: 'Batch these queries into a single query using IN (...) or a JOIN.',
          });
        }
      } else {
        // Window expired — reset
        entry.count = 1;
        entry.firstSeen = now;
      }
    } else {
      this.recentQueries.set(normalized, { count: 1, firstSeen: now });
    }

    // Evict stale entries periodically
    if (this.recentQueries.size > 500) {
      for (const [key, val] of this.recentQueries) {
        if (now - val.firstSeen > this.N_PLUS_ONE_WINDOW_MS * 2) {
          this.recentQueries.delete(key);
        }
      }
    }
  }

  /**
   * Clear the N+1 tracking state.
   */
  public reset(): void {
    this.recentQueries.clear();
  }
}
