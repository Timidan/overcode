import http from "node:http";
import crypto from "node:crypto";
import { shell } from "electron";

const inFlight = new Set<Provider>();

type Provider = "github" | "gitlab";

interface ProviderConfig {
  port: number;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
}

function configFor(provider: Provider): ProviderConfig {
  if (provider === "github") {
    return {
      port: 3000,
      authorizeUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scopes: "repo read:user",
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    };
  }
  return {
    port: 3001,
    authorizeUrl: "https://gitlab.com/oauth/authorize",
    tokenUrl: "https://gitlab.com/oauth/token",
    scopes: "api read_user",
    clientId: process.env.GITLAB_CLIENT_ID,
    clientSecret: process.env.GITLAB_CLIENT_SECRET,
  };
}

function assertProvider(value: unknown): Provider {
  if (value === "github" || value === "gitlab") return value;
  throw new Error("Unsupported OAuth provider.");
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

export async function startOAuthFlow(provider: Provider): Promise<string> {
  const safeProvider = assertProvider(provider);
  if (inFlight.has(safeProvider)) {
    throw new Error(`An OAuth flow for ${safeProvider} is already in progress.`);
  }
  const cfg = configFor(safeProvider);
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error(
      `${safeProvider.toUpperCase()}_CLIENT_ID / ${safeProvider.toUpperCase()}_CLIENT_SECRET missing from .env`,
    );
  }

  // Use the literal loopback address the server actually binds to (see
  // server.listen(... "127.0.0.1") below) so the OAuth provider's registered
  // callback URL matches the bound address exactly. "localhost" can resolve
  // to ::1 on dual-stack hosts and silently fail the callback round-trip.
  const redirectUri = `http://127.0.0.1:${cfg.port}/callback`;
  const stateToken = crypto.randomBytes(24).toString("hex");
  inFlight.add(safeProvider);

  try {
    const code = await new Promise<string>((resolve, reject) => {
      let timeout: NodeJS.Timeout | null = null;
      const server = http.createServer((req, res) => {
        if (!req.url) return;
        const url = new URL(req.url, redirectUri);
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const returnedState = url.searchParams.get("state");
        if (returnedState !== stateToken) {
          res.writeHead(400, htmlHeaders());
          res.end("<h1>OAuth state mismatch.</h1><p>Request rejected.</p>");
          finish(() => reject(new Error("OAuth state mismatch - request rejected")));
          return;
        }
        const c = url.searchParams.get("code");
        const err = url.searchParams.get("error");
        if (err) {
          res.writeHead(400, htmlHeaders());
          res.end(`<h1>OAuth error: ${htmlEscape(err)}</h1>`);
          finish(() => reject(new Error("OAuth provider rejected the request")));
          return;
        }
        if (!c) {
          res.writeHead(400, htmlHeaders()).end("<h1>OAuth code missing.</h1>");
          return;
        }
        res.writeHead(200, htmlHeaders());
        res.end(
          "<h1>Connected to Overcode.</h1><p>You can close this tab.</p>",
        );
        finish(() => resolve(c));
      });
      function finish(callback: () => void) {
        if (timeout) clearTimeout(timeout);
        try {
          server.close();
        } catch {
          // Server may already be closing after an error or timeout.
        }
        callback();
      }
      server.on("error", (e: NodeJS.ErrnoException) => {
        if (timeout) clearTimeout(timeout);
        if (e.code === "EADDRINUSE") {
          reject(
            new Error(
              `Port ${cfg.port} is already in use. Close the other listener and try again.`,
            ),
          );
        } else {
          reject(e);
        }
      });
      server.listen(cfg.port, "127.0.0.1", () => {
        shell.openExternal(
          `${cfg.authorizeUrl}?client_id=${cfg.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(cfg.scopes)}&response_type=code&state=${stateToken}`,
        );
      });
      timeout = setTimeout(() => {
        try {
          server.close();
        } catch {
          // ignore
        }
        reject(new Error("OAuth timeout (120s)"));
      }, 120_000);
    });

    const tokenResponse = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error("Token exchange failed");
    }
    const payload = (await tokenResponse.json()) as { access_token?: string };
    if (!payload.access_token) {
      throw new Error("Token exchange failed");
    }
    return payload.access_token;
  } finally {
    inFlight.delete(safeProvider);
  }
}

export async function fetchProfile(
  provider: Provider,
  token: string,
): Promise<{ username: string; avatar_url: string }> {
  const safeProvider = assertProvider(provider);
  if (safeProvider === "github") {
    const r = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "overcode" },
    });
    if (!r.ok) throw new Error("GitHub profile request failed");
    const u = (await r.json()) as { login?: string; avatar_url?: string };
    return { username: u.login ?? "unknown", avatar_url: u.avatar_url ?? "" };
  }
  const r = await fetch("https://gitlab.com/api/v4/user", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("GitLab profile request failed");
  const u = (await r.json()) as { username?: string; avatar_url?: string };
  return { username: u.username ?? "unknown", avatar_url: u.avatar_url ?? "" };
}
