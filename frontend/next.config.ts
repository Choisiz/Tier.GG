import type { NextConfig } from "next";

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
