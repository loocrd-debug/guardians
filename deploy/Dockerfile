# 가디언즈 인터넷 배포용 이미지 — Node 22 + Playwright Chromium (헤드리스 셸) 포함
FROM mcr.microsoft.com/playwright:v1.59.1-noble
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PORT=3000 GUARDIANS_PUBLIC=1
WORKDIR /app
COPY package.json ./
COPY node_modules ./node_modules
COPY server.cjs scheduler.cjs ai.cjs offline.cjs suggest.js reader.cjs krds_deep.cjs krds_tokens.cjs krds_watch.cjs krds_standard.cjs krds_palette.json pptx_node.js ./
COPY public ./public
COPY pptx_assets ./pptx_assets
COPY extension ./extension
RUN mkdir -p /app/data && chown -R pwuser:pwuser /app
USER pwuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--max-old-space-size=1024", "server.cjs"]
