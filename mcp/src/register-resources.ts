/**
 * Read-only OpenAuditModel resources.
 *
 * Every resource is served from the generated manifest, which is an allowlist
 * built at build time. There is no path resolution: a URI either matches an
 * entry exactly or it is not found. A caller cannot reach a file that was not
 * named in the catalogue, because no filesystem is consulted at all.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { BUNDLED_RESOURCES } from "./resource-manifest.generated.js";

export const RESOURCE_URIS: readonly string[] = BUNDLED_RESOURCES.map((resource) => resource.uri);

export function registerResources(server: McpServer): void {
  for (const resource of BUNDLED_RESOURCES) {
    server.registerResource(
      resource.uri,
      resource.uri,
      {
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType,
      },
      () => ({
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType,
            text: resource.text,
          },
        ],
      }),
    );
  }
}
