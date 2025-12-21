# JavaScript/TypeScript Style Guide

## General Principles
- Use TypeScript when possible for type safety
- Prefer `const` over `let`, avoid `var`
- Use meaningful variable and function names
- Keep functions small and focused (< 20 lines ideal)

## Formatting
- 2 spaces for indentation
- Semicolons required
- Single quotes for strings
- Trailing commas in multiline

## Naming Conventions
- `camelCase` for variables and functions
- `PascalCase` for classes and components
- `UPPER_SNAKE_CASE` for constants
- `kebab-case` for file names

## Functions
- Use arrow functions for callbacks
- Prefer async/await over .then() chains
- Always handle errors with try/catch

## Imports
- Group imports: external, internal, relative
- Use named exports over default exports
- Avoid circular dependencies

## Comments
- Use JSDoc for public APIs
- Comment the "why", not the "what"
- Remove commented-out code
