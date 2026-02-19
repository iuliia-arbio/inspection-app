/**
 * Notion API client for report generation.
 * Requires NOTION_API_KEY. Deal pages must be shared with the integration.
 */

const NOTION_VERSION = "2022-06-28";

function getHeaders(): Record<string, string> {
  const key = process.env.NOTION_API_KEY;
  if (!key) throw new Error("NOTION_API_KEY not configured");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
  };
}

function richText(content: string): Array<{ type: "text"; text: { content: string } }> {
  return [{ type: "text" as const, text: { content: content.slice(0, 2000) } }];
}

const NOTION_BLOCKS_LIMIT = 100;

/** Append blocks to a page. Batches in chunks of 100 (Notion API limit). Returns created block IDs from first batch. */
export async function appendBlocksToPage(
  pageId: string,
  children: NotionBlock[]
): Promise<{ results: { id: string }[] }> {
  const results: { id: string }[] = [];
  for (let i = 0; i < children.length; i += NOTION_BLOCKS_LIMIT) {
    const chunk = children.slice(i, i + NOTION_BLOCKS_LIMIT);
    const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({ children: chunk }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Notion append blocks failed: ${res.status} ${err}`);
    }
    const json = (await res.json()) as { results: { id: string }[] };
    results.push(...(json.results ?? []));
  }
  return { results };
}

/** Append blocks as children of another block (e.g. toggle). Batches in chunks of 100 (Notion API limit). */
export async function appendBlocksToBlock(
  blockId: string,
  children: NotionBlock[]
): Promise<void> {
  for (let i = 0; i < children.length; i += NOTION_BLOCKS_LIMIT) {
    const chunk = children.slice(i, i + NOTION_BLOCKS_LIMIT);
    const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children`, {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({ children: chunk }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Notion append block children failed: ${res.status} ${err}`);
    }
  }
}

/** Create a page (row) in a database. */
export async function createPageInDatabase(
  databaseId: string,
  properties: Record<string, unknown>
): Promise<string> {
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion create page failed: ${res.status} ${err}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

/** Database URL for linking. */
export function getDatabaseUrl(databaseId: string): string {
  const id = databaseId.replace(/-/g, "");
  return `https://notion.so/${id}`;
}

export interface NotionBlock {
  object?: "block";
  type: string;
  [key: string]: unknown;
}

/** Create a heading_2 block (non-toggle). */
export function heading2(content: string): NotionBlock {
  return {
    type: "heading_2",
    heading_2: {
      rich_text: richText(content),
      is_toggleable: false,
    },
  };
}

/** Create a heading_2 toggle block. */
export function heading2Toggle(content: string): NotionBlock {
  return {
    type: "heading_2",
    heading_2: {
      rich_text: richText(content),
      is_toggleable: true,
    },
  };
}

/** Create a paragraph block. */
export function paragraph(content: string): NotionBlock {
  return {
    type: "paragraph",
    paragraph: {
      rich_text: richText(content),
    },
  };
}

/** Create a bookmark block (link). */
export function bookmark(url: string, caption?: string): NotionBlock {
  return {
    type: "bookmark",
    bookmark: {
      url,
      caption: caption ? richText(caption) : [],
    },
  };
}

/** Create an image block (external URL). */
export function image(url: string): NotionBlock {
  return {
    type: "image",
    image: {
      type: "external",
      external: { url },
    },
  };
}

/** Create a heading_3 block. */
export function heading3(content: string): NotionBlock {
  return {
    type: "heading_3",
    heading_3: {
      rich_text: richText(content),
    },
  };
}
