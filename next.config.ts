import type { NextConfig } from "next";

/** Cross-origin isolation enables multi-threaded WebAssembly for the AI model. */
const isolationHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Node-only packages used by the server fallback route.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
  // The native ONNX runtime is loaded dynamically, so it must be traced explicitly (Linux x64 CPU only).
  outputFileTracingIncludes: {
    "/api/scene": [
      "node_modules/onnxruntime-node/package.json",
      "node_modules/onnxruntime-node/dist/**",
      "node_modules/onnxruntime-node/bin/napi-v*/linux/x64/libonnxruntime.so.1",
      "node_modules/onnxruntime-node/bin/napi-v*/linux/x64/libonnxruntime_providers_shared.so",
      "node_modules/onnxruntime-node/bin/napi-v*/linux/x64/onnxruntime_binding.node",
    ],
    "/api/sam/embed": [
      "node_modules/onnxruntime-node/package.json",
      "node_modules/onnxruntime-node/dist/**",
      "node_modules/onnxruntime-node/bin/napi-v*/linux/x64/libonnxruntime.so.1",
      "node_modules/onnxruntime-node/bin/napi-v*/linux/x64/libonnxruntime_providers_shared.so",
      "node_modules/onnxruntime-node/bin/napi-v*/linux/x64/onnxruntime_binding.node",
    ],
  },
  // Keep the serverless function small: only the Linux x64 CPU runtime is needed.
  outputFileTracingExcludes: {
    "/api/scene": [
      "node_modules/onnxruntime-node/bin/napi-v*/darwin/**",
      "node_modules/onnxruntime-node/bin/napi-v*/win32/**",
      "node_modules/onnxruntime-node/bin/napi-v*/linux/arm64/**",
      "node_modules/onnxruntime-node/bin/napi-v*/linux/x64/libonnxruntime_providers_cuda.so",
      "node_modules/onnxruntime-node/bin/napi-v*/linux/x64/libonnxruntime_providers_tensorrt.so",
      "node_modules/onnxruntime-web/**",
      "public/ort/**",
    ],
    "/api/sam/embed": [
      "node_modules/onnxruntime-node/bin/napi-v*/darwin/**",
      "node_modules/onnxruntime-node/bin/napi-v*/win32/**",
      "node_modules/onnxruntime-node/bin/napi-v*/linux/arm64/**",
      "node_modules/onnxruntime-node/bin/napi-v*/linux/x64/libonnxruntime_providers_cuda.so",
      "node_modules/onnxruntime-node/bin/napi-v*/linux/x64/libonnxruntime_providers_tensorrt.so",
      "node_modules/onnxruntime-web/**",
      "public/ort/**",
    ],
  },
  async headers() {
    return [
      { source: "/:locale/editor", headers: isolationHeaders },
      // Worker scripts of an isolated page must themselves be served with COEP.
      { source: "/_next/static/:path*", headers: isolationHeaders },
      { source: "/ort/:path*", headers: [...isolationHeaders, { key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.alias = { ...config.resolve.alias, sharp$: false, "onnxruntime-node$": false };
    }
    return config;
  },
};

export default nextConfig;
