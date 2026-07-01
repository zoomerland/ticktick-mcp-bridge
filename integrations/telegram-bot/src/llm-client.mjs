export class LlmClientError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = "LlmClientError";
    this.details = details;
  }
}

function apiUrl(baseUrl) {
  const value = String(baseUrl || "").replace(/\/+$/, "");
  if (!value) return "http://127.0.0.1:11434/api/chat";
  if (value.endsWith("/api/chat")) return value;
  return `${value}/api/chat`;
}

function openAiUrl(baseUrl) {
  const value = String(baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  if (value.endsWith("/chat/completions")) return value;
  return `${value}/chat/completions`;
}

function stripThinking(text) {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function parseJsonResponse(response) {
  if (typeof response.json === "function") return response.json();
  throw new LlmClientError("LLM response did not provide JSON");
}

export class OllamaChatClient {
  constructor({ baseUrl, model, keepAlive = "", timeoutMs = 30000, fetchImpl = fetch } = {}) {
    this.url = apiUrl(baseUrl);
    this.model = model || "qwen3:14b";
    this.keepAlive = keepAlive;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async chat({ messages, model = this.model, format, keepAlive = this.keepAlive, options = {}, think } = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new LlmClientError("LLM chat requires messages");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          ...(format ? { format } : {}),
          ...(keepAlive === "" || keepAlive === undefined ? {} : { keep_alive: keepAlive }),
          ...(think === undefined ? {} : { think }),
          ...(options ? { options } : {}),
        }),
        signal: controller.signal,
      });
      const body = await parseJsonResponse(response);
      if (!response.ok) {
        throw new LlmClientError(`LLM HTTP ${response.status}`, body);
      }
      if (body.error) {
        throw new LlmClientError(body.error, body);
      }
      const content = body.message?.content ?? body.response ?? "";
      return {
        content: stripThinking(content),
        raw: body,
      };
    } catch (error) {
      if (error.name === "AbortError") {
        throw new LlmClientError(`LLM request timed out after ${this.timeoutMs}ms`);
      }
      if (error instanceof LlmClientError) throw error;
      throw new LlmClientError(error.message || String(error));
    } finally {
      clearTimeout(timer);
    }
  }
}

export class OpenAIChatClient {
  constructor({
    baseUrl = "https://api.openai.com/v1",
    apiKey,
    model,
    organization = "",
    project = "",
    timeoutMs = 120000,
    fetchImpl = fetch,
  } = {}) {
    this.url = openAiUrl(baseUrl);
    this.apiKey = apiKey || "";
    this.model = model || "";
    this.organization = organization;
    this.project = project;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async chat({ messages, model = this.model, format, options = {} } = {}) {
    if (!this.apiKey) {
      throw new LlmClientError("OPENAI API key is required for provider=openai");
    }
    if (!model) {
      throw new LlmClientError("OpenAI model is required for provider=openai");
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new LlmClientError("OpenAI chat requires messages");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.organization) headers["OpenAI-Organization"] = this.organization;
    if (this.project) headers["OpenAI-Project"] = this.project;

    const maxTokens = Number(options.num_predict || options.max_tokens || options.max_completion_tokens || 0);
    const payload = {
      model,
      messages,
      store: false,
      ...(format === "json" ? { response_format: { type: "json_object" } } : {}),
      ...(Number.isFinite(Number(options.temperature)) ? { temperature: Number(options.temperature) } : {}),
      ...(Number.isFinite(Number(options.top_p)) ? { top_p: Number(options.top_p) } : {}),
      ...(maxTokens > 0 ? { max_completion_tokens: maxTokens } : {}),
    };

    try {
      const response = await this.fetchImpl(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await parseJsonResponse(response);
      if (!response.ok) {
        throw new LlmClientError(`OpenAI HTTP ${response.status}`, body);
      }
      if (body.error) {
        throw new LlmClientError(body.error.message || "OpenAI API error", body.error);
      }
      const content = body.choices?.[0]?.message?.content ?? "";
      return {
        content: stripThinking(content),
        raw: body,
      };
    } catch (error) {
      if (error.name === "AbortError") {
        throw new LlmClientError(`OpenAI request timed out after ${this.timeoutMs}ms`);
      }
      if (error instanceof LlmClientError) throw error;
      throw new LlmClientError(error.message || String(error));
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createLlmClient(config, { fetchImpl = fetch } = {}) {
  if (!config?.enabled) return null;
  const provider = config.provider || "ollama";
  if (provider === "ollama") {
    return new OllamaChatClient({
      baseUrl: config.baseUrl,
      model: config.model,
      keepAlive: config.ollamaKeepAlive,
      timeoutMs: config.timeoutMs,
      fetchImpl,
    });
  }
  if (provider === "openai") {
    return new OpenAIChatClient({
      baseUrl: config.openaiBaseUrl,
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      organization: config.openaiOrganization,
      project: config.openaiProject,
      timeoutMs: config.timeoutMs,
      fetchImpl,
    });
  }
  throw new LlmClientError(`Unsupported LLM provider: ${config.provider}`);
}
