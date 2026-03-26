/**
 * Upload a file to the log-files ingest API using apiEndpoint and apiKey from config.json.
 * Usage: npm run upload [file-path]
 *        npx tsx test/upload-file.ts [file-path]
 * If file-path is omitted, uploads a small built-in test payload.
 */

import fs from "fs";
import path from "path";

// Use cwd so config.json is resolved from the package root (e.g. when run via npm run upload).
const serviceRoot = process.cwd();

interface Config {
  apiEndpoint: string;
  apiKey: string;
  vercelProtectionBypass: string;
}

function loadIngestConfig(): Config {
  const configPath = path.join(serviceRoot, "config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `config.json not found at ${configPath}. Copy config.example.json to config.json and set apiEndpoint and apiKey.`
    );
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const config = JSON.parse(raw) as Record<string, unknown>;
  const apiEndpoint = process.env.API_ENDPOINT ?? config.apiEndpoint;
  const apiKey = process.env.API_KEY ?? config.apiKey;
  const vercelProtectionBypass =
    process.env.VERCEL_PROTECTION_BYPASS ??
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET ??
    config.vercelProtectionBypass ??
    "";
  if (typeof apiEndpoint !== "string" || !apiEndpoint || typeof apiKey !== "string" || !apiKey) {
    throw new Error("config.json must contain apiEndpoint and apiKey (or set API_ENDPOINT and API_KEY).");
  }
  return { apiEndpoint, apiKey, vercelProtectionBypass: String(vercelProtectionBypass).trim() };
}

async function uploadFile(
  apiEndpoint: string,
  apiKey: string,
  content: string,
  filename: string,
  vercelProtectionBypass = ""
): Promise<{ ok: boolean; status: number; body: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
  };
  if (vercelProtectionBypass) headers["x-vercel-protection-bypass"] = vercelProtectionBypass;
  const res = await fetch(apiEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ content, filename }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

async function main(): Promise<void> {
  const fileArg = process.argv[2];

  let content: string;
  let filename: string;

  if (fileArg) {
    const filePath = path.isAbsolute(fileArg) ? fileArg : path.resolve(process.cwd(), fileArg);
    if (!fs.existsSync(filePath)) {
      console.error("File not found:", filePath);
      process.exit(1);
    }
    content = fs.readFileSync(filePath, "utf8");
    filename = path.basename(filePath);
    console.log("Uploading:", filePath);
  } else {
    content = "test line 1\ntest line 2\n";
    filename = "test-upload.txt";
    console.log("No file path given; uploading built-in test payload as", filename);
  }

  const { apiEndpoint, apiKey, vercelProtectionBypass } = loadIngestConfig();
  console.log("Endpoint:", apiEndpoint);

  try {
    const result = await uploadFile(apiEndpoint, apiKey, content, filename, vercelProtectionBypass);
    if (result.ok || result.status === 200 || result.status === 201) {
      console.log("Status:", result.status);
      console.log(result.body);
    } else {
      console.error("Status:", result.status);
      console.error(result.body);
      process.exit(1);
    }
  } catch (err) {
    console.error("Request failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
