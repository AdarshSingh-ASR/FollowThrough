const DEFAULT_API_VERSION = "2026-03-11";

function richText(content) {
  return [{ type: "text", text: { content: String(content ?? "").slice(0, 2000) } }];
}

export function buildNotionProperties(commitment) {
  return {
    Commitment: { title: richText(commitment.action) },
    "FollowThrough ID": { rich_text: richText(commitment.id) },
    "Owner Slack ID": { rich_text: richText(commitment.assigneeId) },
    "Promisee Slack IDs": { rich_text: richText((commitment.promiseeIds ?? []).join(", ")) },
    Deadline: { date: commitment.dueAt ? { start: commitment.dueAt } : null },
    Status: { select: { name: commitment.status } },
    Source: { url: commitment.permalink || null },
    Updated: { date: commitment.updatedAt ? { start: commitment.updatedAt } : null },
  };
}

export class NotionCommitmentTracker {
  constructor(env = process.env, request = fetch) {
    this.token = env.NOTION_TOKEN;
    this.dataSourceId = env.NOTION_DATA_SOURCE_ID;
    this.apiVersion = env.NOTION_API_VERSION ?? DEFAULT_API_VERSION;
    this.request = request;
    if (!this.token) throw new Error("NOTION_TOKEN is required for the Notion MCP tracker");
    if (!this.dataSourceId) throw new Error("NOTION_DATA_SOURCE_ID is required for the Notion MCP tracker");
  }

  async #call(path, { method = "GET", body } = {}) {
    const response = await this.request(`https://api.notion.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "Notion-Version": this.apiVersion,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Notion API ${response.status}: ${payload.message ?? JSON.stringify(payload)}`);
    }
    return payload;
  }

  async upsert(commitment) {
    const query = await this.#call(`/data_sources/${this.dataSourceId}/query`, {
      method: "POST",
      body: {
        page_size: 1,
        filter: {
          property: "FollowThrough ID",
          rich_text: { equals: commitment.id },
        },
      },
    });
    const properties = buildNotionProperties(commitment);
    const existing = query.results?.[0];
    if (existing) {
      const page = await this.#call(`/pages/${existing.id}`, {
        method: "PATCH",
        body: { properties },
      });
      return { operation: "updated", pageId: page.id, url: page.url };
    }
    const page = await this.#call("/pages", {
      method: "POST",
      body: {
        parent: { type: "data_source_id", data_source_id: this.dataSourceId },
        properties,
      },
    });
    return { operation: "created", pageId: page.id, url: page.url };
  }
}
