---
name: commit
description: 執行提交前檢查（linting、測試、code review）並建立 git commit。當使用者說「commit」、「提交」、「幫我提交」時使用。
allowed-tools: Bash, Read, Grep, Glob, Edit
---

# Git Commit Skill

建立 Git commit 前執行完整的檢查流程。

## 執行流程

### 階段 1：程式碼品質檢查（若有設定則執行）

1. **Linting**（若專案有設定）
   - 若 `package.json` 中有 `lint` script，執行 `npm run lint`
   - 若有 `.eslintrc` 或 `eslint.config.*`，執行 `npx eslint <變更檔案>`
   - 若無 lint 工具，跳過此步驟並告知使用者

2. **測試**（若專案有設定）
   - 若 `package.json` 中有 `test` script，執行 `npm test`
   - 若測試失敗，停止流程並報告
   - 若無測試框架，跳過此步驟並告知使用者

### 階段 2：Code Review

3. **檢視變更內容**
   - 執行 `git diff --stat` 了解變更範圍
   - 執行 `git diff` 詳細檢視變更
   - 若有 staged changes，也執行 `git diff --cached`

4. **Code Review 檢查清單**

針對每個變更的檔案，檢查：
- [ ] 程式碼邏輯是否正確
- [ ] 是否有潛在的 bug 或邊界情況未處理
- [ ] 是否有安全性問題（XSS、injection、硬編碼密碼等）
- [ ] 命名是否清晰、符合專案慣例
- [ ] 是否有不必要的重複程式碼
- [ ] 錯誤處理是否完整
- [ ] 是否有過多的 debug logging

5. **若發現問題**
   - 列出問題清單（分 Critical / High / Medium / Low）
   - 直接修復明顯問題
   - 對於需要決策的問題，詢問使用者是否要修復後再提交

### 階段 3：準備 Commit

6. **查看 Git 狀態**
   - 執行 `git status` 確認要提交的檔案
   - 執行 `git log --oneline -5` 了解 commit message 風格
   - 注意不要提交敏感檔案（.env、credentials 等）

7. **建立 Commit**
   - 將相關檔案加入暫存區（使用具名檔案，不要 `git add .`）
   - 根據變更內容撰寫 commit message
   - 遵循專案的 commit message 風格
   - 使用 HEREDOC 格式確保訊息格式正確

## Commit Message 格式

```
<type>: <簡短描述>

<詳細說明（若需要）>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

**Type 類型**：
- `feat`: 新功能
- `fix`: Bug 修復
- `refactor`: 重構（不改變功能）
- `docs`: 文件更新
- `test`: 測試相關
- `chore`: 雜項（設定、建置等）
- `perf`: 效能優化
- `style`: 格式調整（不影響邏輯）

## 完成後回報

### 檢查結果
- Linting: 通過 / 跳過（未設定） / 失敗（已修復）
- 測試: 通過 / 跳過（未設定） / 失敗
- Code Review: 無問題 / 已修復 N 個問題

### Commit 資訊
- Commit hash: （提交後顯示）
- 變更檔案數: N
- 變更摘要: 一句話描述

## 注意事項

- 不要執行 `git push`，除非使用者明確要求
- 若有未追蹤的重要檔案，詢問使用者是否要加入
- 若使用者提供額外說明，作為 commit message 的參考
- Commit message 使用英文，與現有風格保持一致
