import { createReadStream, existsSync, statSync } from "node:fs";
import { Agent as HttpAgent, createServer, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distRoot = join(frontendRoot, "dist");
const backendTarget = new URL(process.env.BACKEND_TARGET || "http://127.0.0.1:8000");
const proxyPrefixes = ["/api", "/auth"];
const httpAgent = new HttpAgent({ keepAlive: true, maxSockets: 100 });
const httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 100 });

function readArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const host = readArg("host", process.env.HOST || "0.0.0.0");
const port = Number(readArg("port", process.env.PORT || "5173"));
const publicUrl = String(process.env.FRONTEND_PUBLIC_URL || "").trim();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function sendText(response, statusCode, text) {
  if (response.headersSent) {
    if (!response.writableEnded) {
      response.destroy();
    }
    return;
  }
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
}

function publicResponseHeaders(headers) {
  const nextHeaders = { ...headers };
  delete nextHeaders.connection;
  delete nextHeaders["keep-alive"];
  delete nextHeaders["proxy-authenticate"];
  delete nextHeaders["proxy-authorization"];
  delete nextHeaders.te;
  delete nextHeaders.trailer;
  delete nextHeaders.upgrade;
  return nextHeaders;
}

function resolveStaticPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  const candidate = pathname === "/" ? "/index.html" : pathname;
  const absolutePath = normalize(join(distRoot, candidate));
  if (absolutePath !== distRoot && !absolutePath.startsWith(`${distRoot}${sep}`)) {
    return null;
  }
  if (existsSync(absolutePath) && statSync(absolutePath).isFile()) {
    return absolutePath;
  }
  return join(distRoot, "index.html");
}

function proxyRequest(clientRequest, clientResponse) {
  const target = new URL(clientRequest.url || "/", backendTarget);
  const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
  const proxy = transport(
    target,
    {
      method: clientRequest.method,
      agent: target.protocol === "https:" ? httpsAgent : httpAgent,
      headers: {
        ...clientRequest.headers,
        host: target.host,
      },
    },
    (proxyResponse) => {
      clientResponse.writeHead(proxyResponse.statusCode || 502, publicResponseHeaders(proxyResponse.headers));
      proxyResponse.pipe(clientResponse);
    },
  );

  proxy.on("error", (error) => {
    sendText(clientResponse, 502, `Backend proxy failed: ${error.message}`);
  });

  clientRequest.pipe(proxy);
}

const server = createServer((request, response) => {
  const requestPath = new URL(request.url || "/", "http://localhost").pathname;
  if (proxyPrefixes.some((prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`))) {
    proxyRequest(request, response);
    return;
  }

  if (!existsSync(distRoot)) {
    sendText(response, 500, "Missing frontend/dist. Run `npm run build` first.");
    return;
  }

  const staticPath = resolveStaticPath(request.url || "/");
  if (!staticPath) {
    sendText(response, 403, "Forbidden");
    return;
  }

  const fileSize = statSync(staticPath).size;
  response.writeHead(200, {
    "content-type": contentTypes[extname(staticPath)] || "application/octet-stream",
    "content-length": fileSize,
    "cache-control": staticPath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
  });
  createReadStream(staticPath).pipe(response);
});

server.listen(port, host, () => {
  console.log("MES public frontend");
  console.log(`  Local:   http://127.0.0.1:${port}`);
  if (publicUrl) console.log(`  Network: ${publicUrl}`);
  console.log(`  Binding: http://${host}:${port}`);
  console.log(`  Proxy:   ${backendTarget.origin}`);
});
