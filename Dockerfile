# OpenAuditModel MCP server.
#
# Multi-stage: the build stage carries the toolchain and the whole repository;
# the runtime stage carries compiled JavaScript, production dependencies and
# nothing else. No compiler, no test, no fixture, no git metadata.
#
# Debian slim rather than Alpine: nothing here needs musl, and glibc is the
# platform Node is primarily tested on. Alpine would be a smaller image bought
# with a less-tested libc, which is a poor trade for a service whose only job is
# to be correct.

# ---------------------------------------------------------------- build stage
FROM node:24-bookworm-slim AS build

WORKDIR /build

# Dependencies first, so a source-only change does not re-resolve the tree.
# --ignore-scripts: `prepare` runs `npm run build`, which needs tsconfig.json
# and the source directories copied below — running it now would fail before
# they exist. The explicit `npm run build` after the COPYs is the real build.
COPY package.json package-lock.json ./
COPY mcp/package.json ./mcp/
RUN npm ci --ignore-scripts

# The generators read the canonical schema, the profiles and the specification,
# so the repository content they bundle must be present before they run.
COPY tsconfig.json LICENSE ./
COPY conformance ./conformance
COPY schemas ./schemas
COPY profiles ./profiles
COPY specification ./specification
COPY semantic-conventions ./semantic-conventions
COPY examples ./examples
COPY mcp ./mcp

# Regenerate and verify: a stale validator or manifest must not reach an image.
RUN npm run mcp:generate \
 && npm run mcp:check-generated \
 && npm run build

# Declarations and source maps have no runtime role. The maps carry no embedded
# source and point at paths the image does not contain, so keeping them would
# only make a stack trace reference a file nobody can open.
RUN find dist \( -name "*.d.ts" -o -name "*.js.map" \) -delete

# Production dependency tree, resolved separately from the build tree so that
# no development dependency can reach the runtime image. --ignore-scripts:
# `prepare` needs the devDependencies (typescript) this install deliberately
# omits, and dist/ is already built above.
RUN npm ci --omit=dev --ignore-scripts

# -------------------------------------------------------------- runtime stage
FROM node:24-bookworm-slim AS runtime

ARG VERSION=0.0.0-dev
ARG REVISION=unknown

LABEL org.opencontainers.image.title="OpenAuditModel MCP" \
      org.opencontainers.image.description="Stateless remote OpenAuditModel MCP server over Streamable HTTP. Deterministic, read-only audit event conformance tooling." \
      org.opencontainers.image.source="https://github.com/OpenAuditModel/OpenAuditModel" \
      org.opencontainers.image.url="https://openauditmodel.org" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

# Compiled output, production dependencies and the licence. Nothing else: no
# TypeScript source, no declarations, no source maps, no tests, no fixtures and
# no schemas on disk — the schema and every resource are compiled into the
# bundle, which is why the server can read no file and fetch nothing.
COPY --from=build --chown=node:node /build/node_modules ./node_modules
COPY --from=build --chown=node:node /build/dist ./dist
COPY --from=build --chown=node:node /build/package.json ./package.json
COPY --from=build --chown=node:node /build/LICENSE ./LICENSE

# No package manager is the entry point or is invoked at runtime, but the copies
# bundled in the base image vendor their own dependency trees, which is where
# every Node-level CVE reported against this image came from — none were in
# /app/node_modules. Removing them clears those findings and takes the ability
# to install anything out of a running production container.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg

# The `node` user ships with the official image. Running as root would give a
# process that only parses JSON the ability to write anywhere in the container.
USER node

EXPOSE 3000

# Uses the server's own health endpoint over the loopback interface, so the
# check exercises the real HTTP path rather than merely testing that a process
# exists. No curl is installed; Node is already here.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Exec form: the process is PID 1 and receives SIGTERM directly, which is what
# makes the graceful shutdown in src/index.ts actually run.
ENTRYPOINT ["node", "dist/mcp/src/index.js"]
