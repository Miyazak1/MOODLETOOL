import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import type { Plugin, ViteDevServer } from "vite";

const workspaceRoot = resolve(__dirname, "..");

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".mp4": "video/mp4",
  ".h5p": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
};

function coursewareMiddleware(): Plugin {
  return {
    name: "courseware-static-middleware",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/courseware", async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const requestedPath = decodeURIComponent((req.url || "").split("?")[0]);
          const filePath = normalize(join(workspaceRoot, "courseware", requestedPath));
          const coursewareRoot = join(workspaceRoot, "courseware");
          if (!filePath.startsWith(coursewareRoot)) {
            res.statusCode = 403;
            res.end("Forbidden");
            return;
          }
          const fileStat = await stat(filePath);
          if (fileStat.isDirectory()) {
            res.statusCode = 404;
            res.end("Not found");
            return;
          }
          const ext = extname(filePath).toLowerCase();
          res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");
          res.setHeader("Content-Length", fileStat.size);
          createReadStream(filePath).pipe(res);
        } catch {
          res.statusCode = 404;
          res.end("Not found");
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), coursewareMiddleware()],
  server: {
    host: "127.0.0.1",
    port: 8890,
    strictPort: true,
    fs: {
      allow: [".."],
    },
  },
});
