# google-calendar-auto-sync Development Guidelines

Auto-generated from all feature plans. Last updated: 2025-10-28

## Active Technologies
- TypeScript 5.3+ with Node.js 20 LTS + Express (webhook server), googleapis (Calendar API + Sheets API), google-auth-library (JWT client) (002-recurring-event-sync)
- In-memory (UserMappingStore, ChannelRegistry, DeduplicationCache) - no external database per constitution (002-recurring-event-sync)

- TypeScript 5.3+ with Node.js 20 LTS (001-calendar-cross-workspace-sync)

## Project Structure

```text
backend/
frontend/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript 5.3+ with Node.js 20 LTS: Follow standard conventions

## Recent Changes
- 002-recurring-event-sync: Added TypeScript 5.3+ with Node.js 20 LTS + Express (webhook server), googleapis (Calendar API + Sheets API), google-auth-library (JWT client)
- 002-recurring-event-sync: Added TypeScript 5.3+ with Node.js 20 LTS + Express (webhook server), googleapis (Calendar API + Sheets API), google-auth-library (JWT client)

- 001-calendar-cross-workspace-sync: Added TypeScript 5.3+ with Node.js 20 LTS

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
