import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

/**
 * 저장소 루트 `.env`에서 `API_BASE_URL` **하나만** 읽어 서버 환경 변수로 넣는다 (front_spec 변경 01 D8).
 * - DB·Riot 키 같은 다른 값은 프론트 프로세스에 넣지 않는다.
 * - 이미 값이 있으면(배포 환경 변수 등) 덮어쓰지 않는다.
 * - `env` 옵션은 쓰지 않는다 (값이 번들에 박힌다).
 */
function loadApiBaseUrlFromRootEnv(): void {
  if (process.env.API_BASE_URL) {
    return;
  }
  const rootEnvPath = path.join(__dirname, "..", ".env");
  if (!existsSync(rootEnvPath)) {
    return;
  }
  const value = parseEnv(readFileSync(rootEnvPath, "utf8")).API_BASE_URL;
  if (value) {
    process.env.API_BASE_URL = value;
  }
}

loadApiBaseUrlFromRootEnv();

const nextConfig: NextConfig = {
  // 계획서(front_spec.md 4장)의 캐싱 설계(route segment `revalidate`, `dynamicParams`,
  // fetch `force-cache`)를 그대로 쓰기 위해 Cache Components(cacheComponents)는 사용하지 않는다.
  images: {
    remotePatterns: [new URL("https://ddragon.leagueoflegends.com/cdn/**")],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
