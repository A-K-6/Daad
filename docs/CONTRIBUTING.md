# Contributing to Daad

Thank you for your interest in contributing to **Daad**!

---

## 🛠️ Development Workflow

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/A-K-6/Daad.git
   cd Daad
   ```
2. Install dependencies with **Bun**:
   ```bash
   bun install
   ```
3. Run the development environment:
   ```bash
   bun run tauri dev
   ```
4. Run tests:
   ```bash
   bun run test
   ```

---

## 📋 Pull Request Rules

- **Use Bun:** Never commit `package-lock.json` or `yarn.lock`. Keep `bun.lock` synchronized.
- **Pass All Tests:** All 56+ tests in Vitest must pass before opening a PR.
- **Follow the Design Language:** Keep UI components aligned with the obsidian dark, utilitarian aesthetic. Avoid generic gradients and bubbly UI elements.
