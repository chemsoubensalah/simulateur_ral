# SAM 3 walls server — Hugging Face Space (Docker, free "CPU basic") or any Docker host.
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
# SAM 3 (text prompts) exported to ONNX, int8 (~880 MB), downloaded once at build time.
RUN mkdir -p /models && cd /models && \
    for f in vision_encoder_int8.onnx text_encoder_int8.onnx decoder_int8.onnx tokenizer.json tokenizer_config.json; do \
      curl -fsSL --retry 3 -o "$f" "https://huggingface.co/danilobukvic/sam3-text-onnx/resolve/main/$f"; \
    done
COPY server.mjs ./
ENV MODELS_DIR=/models PORT=7860 NODE_ENV=production
EXPOSE 7860
USER node
CMD ["node", "server.mjs"]
