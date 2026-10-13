import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Sulcus, SulcusError, SecurityValidationError } from "../dist/index.mjs";

describe("Node.js SDK Client Tests", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("initializes with default options", () => {
    const client = new Sulcus({ apiKey: "sk-test12345678" });
    const json = client.toJSON();
    assert.equal(json.baseUrl, "https://api.sulcus.ca");
    assert.equal(json.namespace, "default");
    assert.equal(json.securityGuard, "warn");
  });

  it("initializes localhost without requiring an API key", () => {
    const client = new Sulcus({ baseUrl: "http://localhost:8080" });
    const json = client.toJSON();
    assert.equal(json.baseUrl, "http://localhost:8080");
    assert.equal(json.apiKey, "[not-configured]");
  });

  it("stores a memory via remember()", async () => {
    let capturedUrl = "";
    let capturedInit = null;

    globalThis.fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          id: "mem-node-1",
          pointer_summary: "User prefers tabs over spaces",
          memory_type: "preference",
          current_heat: 0.85,
          base_utility: 1.0,
          is_pinned: true,
          modality: "text",
          namespace: "default",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const client = new Sulcus({ apiKey: "sk-test12345678" });
    const memory = await client.remember("User prefers tabs over spaces", {
      memoryType: "preference",
      heat: 0.85,
      isPinned: true,
    });

    assert.equal(memory.id, "mem-node-1");
    assert.equal(memory.pointer_summary, "User prefers tabs over spaces");
    assert.equal(capturedUrl, "https://api.sulcus.ca/api/v1/agent/nodes");
    assert.equal(capturedInit.method, "POST");
    assert.equal(capturedInit.headers["Authorization"], "Bearer sk-test12345678");
    assert.equal(capturedInit.headers["User-Agent"], "sulcus-nodejs/3.0.0");

    const body = JSON.parse(capturedInit.body);
    assert.equal(body.label, "User prefers tabs over spaces");
    assert.equal(body.memory_type, "preference");
    assert.equal(body.is_pinned, true);
  });

  it("rejects storing secrets when securityGuard is 'reject'", async () => {
    const client = new Sulcus({
      apiKey: "sk-test12345678",
      securityGuard: "reject",
    });

    await assert.rejects(
      async () => {
        await client.remember("Storing master key: AKIA1234567890ABCDEF");
      },
      {
        name: "SecurityValidationError",
        message: /Security Alert: Detected sensitive credential/,
      }
    );
  });

  it("searches memories via search()", async () => {
    let capturedBody = null;

    globalThis.fetch = async (url, init) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify([
          {
            id: "mem-res-1",
            pointer_summary: "Search match",
            memory_type: "semantic",
            current_heat: 0.9,
          },
        ]),
        { status: 200 }
      );
    };

    const client = new Sulcus({ apiKey: "sk-test12345678" });
    const results = await client.search("Search term", {
      limit: 5,
      memoryType: "semantic",
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].id, "mem-res-1");
    assert.equal(capturedBody.query, "Search term");
    assert.equal(capturedBody.limit, 5);
    assert.equal(capturedBody.memory_type, "semantic");
  });

  it("validates connection status via validateConnection()", async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ status: "ok", version: "3.0.0" }), {
        status: 200,
      });
    };

    const client = new Sulcus({ apiKey: "sk-test12345678" });
    const res = await client.validateConnection();
    assert.equal(res.ok, true);
    assert.ok(typeof res.latencyMs === "number");
    assert.equal(res.serviceStatus.version, "3.0.0");
  });

  it("throws SulcusError on API errors", async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ error: "Invalid API key" }), {
        status: 401,
      });
    };

    const client = new Sulcus({ apiKey: "sk-invalid12345" });
    await assert.rejects(
      async () => {
        await client.list();
      },
      (err) => {
        assert.ok(err instanceof SulcusError);
        assert.equal(err.status, 401);
        return true;
      }
    );
  });

  it("constructs formatted context XML envelope via buildContext()", async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("hot-context")) {
        return new Response(
          JSON.stringify([
            {
              id: "hot-1",
              pointer_summary: "User prefers dark mode",
              memory_type: "preference",
              current_heat: 0.95,
              base_utility: 1.0,
              is_pinned: true,
            },
          ]),
          { status: 200 }
        );
      }
      if (urlStr.includes("triggers")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const client = new Sulcus({ apiKey: "sk-test12345678" });
    const envelope = await client.buildContext({ tokenBudget: 1500 });

    assert.ok(envelope.includes("<sulcus_context"));
    assert.ok(envelope.includes("<preferences>"));
    assert.ok(envelope.includes("User prefers dark mode"));
    assert.ok(envelope.includes("</sulcus_context>"));
  });
});
