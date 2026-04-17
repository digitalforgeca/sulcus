/**
 * Native library loader for Sulcus local mode.
 * Loads libsulcus_store and libsulcus_vectors via koffi FFI.
 * Isolated from network code to keep static analysis clean.
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";

interface PluginLogger {
  debug?: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export class NativeLibLoader {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private koffi: unknown = null;
  private storeLib: unknown = null;
  private vectorsLib: unknown = null;
  private vectorsHandle: unknown = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private fn_store_init: any = null;
  private fn_store_query: any = null;
  private fn_store_free: any = null;
  private fn_vectors_create: any = null;
  private fn_vectors_text: any = null;
  private fn_vectors_free: any = null;

  public loaded = false;
  public error: string | null = null;

  constructor(private storeLibPath: string, private vectorsLibPath: string) {}

  init(logger: PluginLogger): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.koffi = require("koffi");
    } catch (e: unknown) {
      this.error = `koffi not available: ${e instanceof Error ? e.message : e}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }

    if (!existsSync(this.storeLibPath)) {
      this.error = `libsulcus_store not found at ${this.storeLibPath}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }
    if (!existsSync(this.vectorsLibPath)) {
      this.error = `libsulcus_vectors not found at ${this.vectorsLibPath}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }

    try {
      const k = this.koffi as any;
      this.storeLib = k.load(this.storeLibPath);
      this.fn_store_init  = (this.storeLib as any).func("sulcus_store_init", "int", ["str", "uint16"]);
      this.fn_store_query = (this.storeLib as any).func("sulcus_store_query", "char*", ["str"]);
      this.fn_store_free  = (this.storeLib as any).func("sulcus_store_free_string", "void", ["char*"]);
    } catch (e: unknown) {
      this.error = `Failed to load libsulcus_store: ${e instanceof Error ? e.message : e}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }

    try {
      const k = this.koffi as any;
      this.vectorsLib = k.load(this.vectorsLibPath);
      this.fn_vectors_create = (this.vectorsLib as any).func("sulcus_vectors_create", "void*", []);
      this.fn_vectors_text   = (this.vectorsLib as any).func("sulcus_vectors_text",   "char*", ["void*", "str"]);
      this.fn_vectors_free   = (this.vectorsLib as any).func("sulcus_vectors_free_string", "void", ["char*"]);
    } catch (e: unknown) {
      this.error = `Failed to load libsulcus_vectors: ${e instanceof Error ? e.message : e}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }

    try {
      const dataDir = resolve(process.env.HOME || "~", ".sulcus/data");
      const rc = this.fn_store_init(dataDir, 15432);
      if (rc !== 0) {
        this.error = `sulcus_store_init returned ${rc}`;
        logger.warn(`sulcus: ${this.error}`);
        return;
      }
    } catch (e: unknown) {
      this.error = `sulcus_store_init failed: ${e instanceof Error ? e.message : e}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }

    try {
      this.vectorsHandle = this.fn_vectors_create();
    } catch (e: unknown) {
      this.error = `sulcus_vectors_create failed: ${e instanceof Error ? e.message : e}`;
      logger.warn(`sulcus: ${this.error}`);
      return;
    }

    this.loaded = true;
    logger.info(`sulcus: native libs loaded (store: ${this.storeLibPath}, vectors: ${this.vectorsLibPath})`);
  }

  makeQueryFn(): (sql: string, params: unknown[]) => Promise<unknown[]> {
    return async (sql: string, params: unknown[]): Promise<unknown[]> => {
      if (!this.loaded) throw new Error("Sulcus store not available");
      const raw: string = this.fn_store_query(JSON.stringify({ sql, params }));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const p = parsed as Record<string, unknown>;
      return Array.isArray(parsed) ? (parsed as unknown[]) : ((Array.isArray(p?.rows) ? p.rows as unknown[] : [parsed as unknown]));
    };
  }

  makeEmbedFn(): (text: string) => Promise<Float32Array> {
    return async (text: string): Promise<Float32Array> => {
      if (!this.loaded) throw new Error("Sulcus vectors not available");
      const raw: string = this.fn_vectors_text(this.vectorsHandle, text);
      if (!raw) throw new Error("sulcus_vectors_text returned null");
      const arr: number[] = JSON.parse(raw);
      return new Float32Array(arr);
    };
  }
}
