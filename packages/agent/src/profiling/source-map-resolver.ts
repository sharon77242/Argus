import { SourceMapConsumer, type RawSourceMap } from "source-map";
import fs from "node:fs";
import path from "node:path";

export class SourceMapResolver {
  private mapCache = new Map<string, SourceMapConsumer>();
  private jsToMapPath = new Map<string, string>();

  private baseDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
  }

  /**
   * Initializes the resolver by scanning for .js and .js.map files.
   * This builds a mapping of .js paths to their corresponding .js.map paths.
   */
  public async initialize(): Promise<void> {
    await this.scanDirectory(this.baseDir);
  }

  private async scanDirectory(dir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        const mapPath = `${fullPath}.map`;
        if (fs.existsSync(mapPath)) {
          this.jsToMapPath.set(fullPath, mapPath);
        }
      }
    }
  }

  /**
   * Resolves a generated line/column to the original source position.
   * Lazily loads and caches the source map the first time it is needed.
   */
  public async resolvePosition(filePath: string, line: number, column: number) {
    const consumer = await this.getConsumer(filePath);
    if (!consumer) {
      return null;
    }

    const originalPosition = consumer.originalPositionFor({
      line,
      column,
    });

    if (originalPosition.source === null) {
      return null;
    }

    return originalPosition;
  }

  private async getConsumer(filePath: string): Promise<SourceMapConsumer | null> {
    if (this.mapCache.has(filePath)) {
      return this.mapCache.get(filePath)!;
    }

    const mapPath = this.jsToMapPath.get(filePath);
    if (!mapPath) return null;

    try {
      const mapContent = await fs.promises.readFile(mapPath, "utf8");
      const rawMap: RawSourceMap = JSON.parse(mapContent);
      const consumer = await new SourceMapConsumer(rawMap);
      this.mapCache.set(filePath, consumer);
      return consumer;
    } catch (error) {
      console.error(`Failed to load source map for ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Destroys cached consumers to prevent memory leaks.
   */
  public destroy() {
    for (const consumer of this.mapCache.values()) {
      consumer.destroy();
    }
    this.mapCache.clear();
  }
}
