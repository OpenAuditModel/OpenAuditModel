# Deploying OpenAuditModel

**Experimental. Not production-ready. No compliance guarantee.**

Two containers: the static site that serves the canonical schemas, and the MCP server.

```text
Source repository → docker compose up -d --build
                            │
                            ├─ openauditmodel-site  :2086  static files, canonical schemas
                            └─ openauditmodel-mcp   :8880  MCP over Streamable HTTP
                                        ↑
                    Cloudflare, a tunnel, or an existing reverse proxy terminates HTTPS
```

Both images are built on whichever Docker daemon will run them. **There is no registry**: nothing is
pushed, nothing is pulled, and no login or token is needed anywhere in this workflow.

**Neither container owns port 80 or 443, and neither handles a certificate.** That is deliberate: a
server is usually already serving something else. Each publishes a plain-HTTP port and something in
front terminates TLS, so the private key never enters the process that parses caller-supplied audit
events.

## Deploying to a remote daemon

The build runs wherever the daemon is, so a remote deployment needs no file copying and no registry:

```bash
docker context create prod --docker "host=ssh://user@your-server"
docker --context prod compose -f deploy/docker-compose.yml up -d --build
```

An IDE that offers "Docker over SSH" is doing exactly this. Nothing about the deployment depends on
which IDE, if any, drives it.

## Ports

Both are configurable, because the host is usually occupied:

| Variable        | Default     | Service                     |
| --------------- | ----------- | --------------------------- |
| `OAM_SITE_PORT` | `2086`      | the static site             |
| `OAM_MCP_PORT`  | `8880`      | the MCP endpoint            |
| `OAM_BIND`      | `127.0.0.1` | host interface both bind to |

```bash
OAM_SITE_PORT=2086 OAM_MCP_PORT=8880 docker compose -f deploy/docker-compose.yml up -d --build
```

Repeating those on every command gets old fast. Copy [.env.example](.env.example) to `deploy/.env` and set them there instead — Compose reads `deploy/.env` automatically because that is the directory the compose file lives in, no `--env-file` flag needed. It is gitignored: each host (a dev box, the production server) keeps its own.

```bash
cp deploy/.env.example deploy/.env
# edit deploy/.env for this host, then:
docker compose -f deploy/docker-compose.yml up -d --build
```

`OAM_BIND` defaults to the loopback interface, which is right when the thing terminating TLS runs on
the same machine — a tunnel daemon or an existing proxy. Set it to `0.0.0.0` only when the forwarding
layer reaches the host from outside it, and only behind a firewall that limits who can.

## Behind Cloudflare

Two ways, and they differ in whether the origin port is exposed at all.

**A tunnel is the stronger option.** `cloudflared` dials out, so no inbound port is opened and the
origin address is never published. Keep `OAM_BIND=127.0.0.1` and point the tunnel at
`http://127.0.0.1:2086` and `http://127.0.0.1:8880`.

**The proxy with an origin port** also works, with one constraint worth knowing before choosing a
number: Cloudflare's HTTP proxy only forwards to a fixed set of origin ports. `2086` and `8880` are
both on that list; an arbitrary port such as `3000` is not, and the request never arrives. Set
`OAM_BIND=0.0.0.0`, restrict the port to Cloudflare's ranges at the firewall, and note that traffic
between Cloudflare and the origin is encrypted only if the zone's SSL mode is Full or better — on
Flexible it is plain HTTP, which for the MCP endpoint means audit event content in clear text on that
hop.

Either way the `Host` header arrives as the public hostname, which is what `OAM_ALLOWED_HOSTS`
checks. Someone who finds the origin address and connects to it directly gets a `403`, because the
`Host` they send is an address rather than the configured name.

## DNS

`mcp.openauditmodel.org` must resolve to the public address of the **reverse proxy**, not the
container. No IP address is recorded in this repository: the record is created wherever the project's
DNS is managed, and certificates are issued by the proxy or an external ingress. The application
container manages neither DNS nor certificates.

## Build it

From the repository root, on the host that will run it:

```bash
docker build \
  --tag openauditmodel-mcp:local \
  --file Dockerfile \
  .
```

`openauditmodel-mcp:local` is the default tag for development and deployment. For a release you
intend to be able to return to, build a versioned tag as well:

```bash
docker build --tag openauditmodel-mcp:0.1.0-alpha.1 --file Dockerfile .
```

`latest` is deliberately never used: an unqualified `latest` invites production use of a moving
target, and here it would also be ambiguous about which local build produced it.

## Run it

```bash
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml ps      # wait for "healthy" on both

# the MCP endpoint
curl -fsS http://127.0.0.1:8880/health              # {"status":"ok"}
node deploy/smoke-test.mjs http://127.0.0.1:8880

# the site, and the two identifiers it exists to serve
curl -fsS http://127.0.0.1:2086/schemas/audit-event/0.1/schema.json | head -3
curl -fsS http://127.0.0.1:2086/schemas/profile-definition/0.1/schema.json | head -3
```

Compose is configured with `pull_policy: never`, so a missing image fails immediately with a clear
error rather than attempting a fetch from a registry that does not exist. Build first.

Without Compose, the equivalent single container:

```bash
docker run -d \
  --name openauditmodel-mcp \
  -p 127.0.0.1:8880:3000 \
  -e OAM_ALLOWED_ORIGINS=https://openauditmodel.org \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  openauditmodel-mcp:local
```

## Verifying a deployment

`/health` says the process is up, not that MCP works. [smoke-test.mjs](smoke-test.mjs) checks what an
operator actually needs after a deploy or an upgrade: that `initialize` succeeds, that all seven
tools, three prompts and twenty-nine resources are published, that a tool really runs, and that the
origin policy refuses a lookalike domain while accepting a request with no `Origin` at all.

```bash
node deploy/smoke-test.mjs https://mcp.openauditmodel.org
node deploy/smoke-test.mjs http://127.0.0.1:8880
```

It needs only Node 22 or newer and no dependencies, so it runs against a deployment without
installing this repository. It exits non-zero on the first problem, so it can gate a rollout. The
only event it sends is a synthetic one it builds itself — it never transmits your audit data. CI runs
this same script against a freshly built container, so the check that guards a release and the check
an operator runs cannot drift apart.

## Environment

| Variable                | Default                                                     | Meaning                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                  | `3000`                                                      | Port **inside** the container. The host port is `OAM_MCP_PORT`.                                                                         |
| `HOST`                  | `0.0.0.0`                                                   | Bind address.                                                                                                                           |
| `OAM_ALLOWED_ORIGINS`   | `https://openauditmodel.org,https://www.openauditmodel.org` | Browser origins accepted on `/mcp`. A wildcard is rejected at startup.                                                                  |
| `OAM_ALLOWED_HOSTS`     | _(unset — loopback only)_                                   | Hostnames this deployment answers on. Unset accepts only `localhost`, `127.0.0.1` and `[::1]`; a public deployment must list its names. |
| `OAM_TRUST_PROXY`       | `false`                                                     | Believe `X-Forwarded-Host`. Enable **only** behind a proxy that sets it.                                                                |
| `OAM_MAX_REQUEST_BYTES` | `1000000`                                                   | Largest request body.                                                                                                                   |
| `OAM_MAX_EVENT_BYTES`   | `256000`                                                    | Largest single event.                                                                                                                   |
| `OAM_MAX_CHAIN_EVENTS`  | `200`                                                       | Events per `verify_chain` call.                                                                                                         |
| `OAM_LOG_LEVEL`         | `info`                                                      | `debug`, `info`, `error` or `silent`.                                                                                                   |
| `OAM_SHUTDOWN_GRACE_MS` | `10000`                                                     | Grace period for in-flight requests on SIGTERM.                                                                                         |

Configuration is parsed and validated once at startup. An invalid value fails startup with exit code
78 and a message naming the variable — never its value.

### Trusted proxy behaviour

`X-Forwarded-Host` is consulted **only** when `OAM_TRUST_PROXY=true`. Believing a forwarded header by
default would let any client assert any host and defeat host validation entirely. Enable it when, and
only when, a proxy you control sets the header and strips any copy the client supplied.

## Reverse proxy

The proxy owns TLS, DNS and public routing. The container owns none of them. Three routes are
forwarded:

```text
https://mcp.openauditmodel.org/mcp     → http://127.0.0.1:8880/mcp
https://mcp.openauditmodel.org/health  → http://127.0.0.1:8880/health
https://mcp.openauditmodel.org/        → http://127.0.0.1:8880/
https://openauditmodel.org/            → http://127.0.0.1:2086/
```

### Nginx

```nginx
# The container publishes on the loopback interface, so the upstream is local.
# If the proxy itself runs in Docker on the same network, use the service name
# instead: server openauditmodel-mcp:3000; (the port inside the container)
upstream openauditmodel_mcp {
    server 127.0.0.1:8880;
    keepalive 16;
}

server {
    listen 443 ssl;
    http2 on;
    server_name mcp.openauditmodel.org;

    ssl_certificate     /etc/letsencrypt/live/mcp.openauditmodel.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mcp.openauditmodel.org/privkey.pem;

    # Match the application limit so oversized bodies are refused at the edge.
    client_max_body_size 1m;

    # Never log request bodies. Audit event content must not reach proxy logs.
    access_log /var/log/nginx/mcp.access.log;

    # Shared by every route below.
    proxy_http_version 1.1;
    proxy_set_header Connection         "";
    proxy_set_header Host               $host;
    proxy_set_header X-Forwarded-Host   $host;
    proxy_set_header X-Forwarded-Proto  $scheme;
    proxy_set_header X-Forwarded-For    $proxy_add_x_forwarded_for;
    # Origin is forwarded unchanged: the application decides on it.
    proxy_set_header Origin             $http_origin;

    location /mcp {
        proxy_pass http://openauditmodel_mcp;

        # Streamable HTTP may return a streamed response. Buffering would hold
        # it until complete and break incremental delivery.
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;

        proxy_read_timeout    120s;
        proxy_send_timeout    120s;
        proxy_connect_timeout 5s;

        limit_req zone=mcp burst=20 nodelay;
    }

    location = /health {
        proxy_pass http://openauditmodel_mcp;
        access_log off;
    }

    # Fixed service metadata. No version, hostname or container detail.
    location = / {
        proxy_pass http://openauditmodel_mcp;
    }

    # Anything else is not part of the service surface.
    location / {
        return 404;
    }
}

# In the http{} block:
# limit_req_zone $binary_remote_addr zone=mcp:10m rate=10r/s;
```

`proxy_buffering off` on `/mcp` is the one setting that is not optional: with buffering on, Nginx
holds a streamed response until it is complete, which defeats incremental delivery.

**This example is not suitable for every environment.** Rate limits, timeouts, TLS policy and network
placement depend on your deployment; review each before exposing the service.

## Rate limiting

The application deliberately has no in-process rate limiter: with multiple replicas an in-memory
counter is both ineffective and misleading. Rate limiting belongs at the proxy or edge, as in the
`limit_req` directive above. **Apply it before exposing the endpoint publicly** — the alpha is
unauthenticated, so anyone who can reach it can consume capacity.

## Updating

Pull the source, rebuild, recreate:

```bash
git pull

docker build \
  --tag openauditmodel-mcp:local \
  --file Dockerfile \
  .

docker compose -f deploy/docker-compose.yml up -d --force-recreate

node deploy/smoke-test.mjs http://127.0.0.1:8880
```

`--force-recreate` is required. Rebuilding replaces what `openauditmodel-mcp:local` points at, but
Compose sees the same tag and would otherwise leave the running container alone.

The server is stateless, so there is no migration and no draining beyond the SIGTERM grace period.
Compose starts the new container and stops the old one; the proxy sees a brief connection refusal
unless you run two replicas behind it.

## Rolling back

Because the image is local, rolling back means keeping the previous build addressable. Tag each
release before replacing it:

```bash
# Before an update, give the running build a name you can return to.
docker tag openauditmodel-mcp:local openauditmodel-mcp:0.1.0-alpha.1
```

To go back, point Compose at that tag — set `image: openauditmodel-mcp:0.1.0-alpha.1` in
`docker-compose.yml`, or override it for one run:

```bash
docker run -d --name openauditmodel-mcp \
  -p 127.0.0.1:8880:3000 \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  openauditmodel-mcp:0.1.0-alpha.1
```

Nothing is persisted, so a rollback carries no data compatibility question — an older image behaves
exactly as it did before. The one thing that can make rollback impossible is deleting the old image:
`docker image prune -a` removes untagged builds, so tag a release **before** you replace it.

## Data handling

> MCP tool inputs are processed ephemerally by the OpenAuditModel MCP service. The service does not
> intentionally persist audit event content or include tool arguments in application logs.

> Users should review their organization's data-handling requirements before submitting production
> audit events to a remote MCP service.

The container has no volume, no database and no writable application directory. Application logs
carry a generated request identifier, the route, the tool name, a result category, a status code and
a duration — never a request body, an event identifier, an actor, a resource, a digest or a finding.

Configure your **proxy** not to log request bodies either. The application cannot control that.

## Public alpha risk

The alpha is unauthenticated. Anyone who can reach the endpoint can call every tool. That is
defensible only because every tool is read-only, there is no account, no write operation and no
persistence — and it stops being defensible the moment any of those changes. Apply rate limiting, and
consider restricting network access until standards-based authentication exists.
