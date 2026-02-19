import type { NextConfig } from "next";
import { join } from "path";
import { readFileSync, existsSync } from "fs";

const envPath = join(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf-8");
  const match = content.match(/^OPENAI_API_KEY=(.+)$/m);
  if (match) {
    process.env.OPENAI_API_KEY = match[1].trim();
  }
}

const nextConfig: NextConfig = {
  env: {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  },
};

export default nextConfig;
