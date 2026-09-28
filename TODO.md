# NileChain TODO

## ✅ Done
- [x] Server fixes: reverted MAX_PPH_CEILING to 650K, login() throws on auth failure
- [x] Hermes providers: 6 free providers configured (NVIDIA, Groq, Cerebras, OpenRouter, Google, Cloudflare)
- [x] MCP servers: 5 configured (perplexity, playwright, firecrawl, glyph, chrome)
- [x] Extension rebuilt v1.0.14 with tap optimizations (20 lanes, 6 passes, 5s budget)
- [x] EasyCoin: mine prioritization by yieldPerCycle (best 6 slots first)
- [x] EasyCoin: dig loop uses all tickets per cycle
- [x] EasyCoin: achievement claiming (/achievements/claim)
- [x] EasyCoin: slot spins reads wheel.spins fallback
- [x] MTProto: "missing entity" fix — resolve once, reuse
- [x] Extension rebuilt v1.0.15 with all above

## 🔄 In Progress
- [ ] Replace placeholder API keys for perplexity and firecrawl in MCP config
- [ ] Test MCP servers after `hermes gateway restart`

## 📋 Backlog
- [ ] Add real Perplexity API key to MCP config
- [ ] Add real Firecrawl API key to MCP config
- [ ] Verify Glyphs MCP works (requires macOS Glyphs app on port 9680)
- [ ] Verify Chrome DevTools MCP works (requires Chrome running)
- [ ] Add daily farming routine checklist
- [ ] Monitor server logs for TIMEOUT/auth errors after fixes
- [ ] Fix utya
- [ ] Fix tono
- [ ] Create monsterland
- [ ] Fix mini app
- [ ] Finish up

## 🐛 Issues
- RIGNITE server: TIMEOUT errors on Telegram MTProto (proxy issues)
- Some accounts stuck at L44/L35 battery levels
- Need better proxy rotation for Telegram connections