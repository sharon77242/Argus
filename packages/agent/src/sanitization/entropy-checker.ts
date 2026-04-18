export class EntropyChecker {
  /**
   * Calculates the Shannon Entropy of a given string.
   * Higher values indicate more randomness (like API tokens, hashes).
   */
  public static calculateShannonEntropy(str: string): number {
    if (!str || str.length === 0) return 0;

    const frequencies: Record<string, number> = {};
    for (const char of str) {
      frequencies[char] = (frequencies[char] || 0) + 1;
    }

    let entropy = 0;
    const length = str.length;
    for (const char in frequencies) {
      const p = frequencies[char] / length;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  /**
   * Tokenizes a string and drops tokens that look like random secrets.
   * A token is considered a secret if its length is >= 16 characters
   * and its Shannon entropy is greater than the threshold (default 4.0).
   */
  public static scrubHighEntropyStrings(input: string, threshold = 4.0): string {
    // Split on common delimiters that separate words/tokens in JSON, URLs, Headers, or SQL
    const tokens = input.split(/([\s=,;'"()\[\]{}]+)/);

    return tokens
      .map((token) => {
        // Must be long enough to actually be a secret (prevent false positives on short words)
        if (token.length >= 16 && this.calculateShannonEntropy(token) > threshold) {
          return "[REDACTED_SECRET]";
        }
        return token;
      })
      .join("");
  }
}
