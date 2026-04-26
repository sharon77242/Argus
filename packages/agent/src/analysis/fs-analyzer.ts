import type { FixSuggestion } from "./types.ts";

export class FsAnalyzer {
  private recentReads = new Map<string, { count: number; firstSeen: number }>();
  private readonly READ_WINDOW_MS = 1000;
  private readonly READ_THRESHOLD = 5;

  public analyze(methodName: string, filePath: string, insideRequest?: boolean): FixSuggestion[] {
    const suggestions: FixSuggestion[] = [];

    // 1. Sync Method Detection - Event Loop Blockers
    if (methodName.endsWith("Sync")) {
      suggestions.push({
        severity: "critical",
        rule: "synchronous-fs",
        message: `Usage of ${methodName} blocks the entire Node.js Event Loop. A slow disk read pauses all other requests.`,
        suggestedFix: `Replace ${methodName} with the equivalent promise-based fs.promises.${methodName.replace("Sync", "")}() and await it.`,
      });

      if (insideRequest) {
        suggestions.push({
          severity: "critical",
          rule: "sync-in-hot-path",
          message: `${methodName} called inside a live request handler — blocks the event loop for every concurrent request.`,
          suggestedFix: `Replace with fs.promises.${methodName.replace("Sync", "")}() and await it.`,
        });
      }
    }

    // 2. Path Traversal Risks
    if (filePath.includes("../") || filePath.includes("..\\")) {
      suggestions.push({
        severity: "warning",
        rule: "path-traversal-risk",
        message:
          'Detected relative directory traversal ("../") in file path. Ensure this path is strictly sanitized if dynamically generated from user input.',
        suggestedFix:
          "Use path.resolve() and verify the result is strictly inside the intended base directory.",
      });
    }

    // 3. Temporary or Sensitive directories
    const sensitive = ["/etc/shadow", "/etc/passwd", ".env"];
    for (const sens of sensitive) {
      if (filePath.endsWith(sens)) {
        suggestions.push({
          severity: "critical",
          rule: "sensitive-file-access",
          message: `Application is interacting with a highly sensitive file: ${filePath}. Ensure this is entirely intended.`,
        });
      }
    }

    // 4. Repeated Read Monitoring (Missing Cache)
    if (methodName.includes("read") || methodName.includes("Read")) {
      const now = Date.now();
      const entry = this.recentReads.get(filePath);

      if (entry) {
        if (now - entry.firstSeen <= this.READ_WINDOW_MS) {
          entry.count++;
          if (entry.count >= this.READ_THRESHOLD) {
            suggestions.push({
              severity: "warning",
              rule: "missing-fs-cache",
              message: `The file ${filePath} was read ${entry.count} times within ${this.READ_WINDOW_MS}ms. High I/O overhead detected.`,
              suggestedFix:
                "Cache the contents of this file in memory rather than reading it from disk on every request.",
            });
          }
        } else {
          entry.count = 1;
          entry.firstSeen = now;
        }
      } else {
        this.recentReads.set(filePath, { count: 1, firstSeen: now });
      }

      // Evict only stale entries — never wipe the whole map
      if (this.recentReads.size > 100) {
        for (const [k, v] of this.recentReads) {
          if (now - v.firstSeen > this.READ_WINDOW_MS) this.recentReads.delete(k);
        }
      }
    }

    return suggestions;
  }
}
