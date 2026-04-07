# CLAUDE.md

このファイルは、Claude Code がこのリポジトリで作業する際のガイダンスを提供します。

## プロジェクト概要

**製品原価シミュレーション** - 中小製造業向けの原価計算ツール。ブラウザだけで動作する静的Webアプリケーション。

## デプロイワークフロー

### 重要ルール

- **「プッシュして」** → `git push origin main` のみ実行。Netlifyデプロイはしない。
- **「デプロイして」** → `git push origin main` + Netlifyデプロイを実行。
- 開発中の確認はローカルプレビューサーバー（port 8082）で行う。
- Netlifyデプロイは明示的に指示された場合のみ実行し、クレジットを節約する。

### Netlifyデプロイコマンド

```bash
export PATH="/opt/homebrew/bin:$PATH" && npx --yes netlify-cli deploy --prod --dir=. --site=31c05340-e0f7-40cb-b063-20336abd6274
```

### コミット規約

- コミットメッセージの末尾に必ず以下を含める:
  ```
  Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
  ```
- git index.lockが残っている場合は `rm -f .git/index.lock` で削除してからコミット

## アーキテクチャ

### ファイル構成

- `index.html` - メインアプリケーション
- `app.js` - コアロジック（データ管理、ウィザード、ヘルプ、カバーページ）
- `calc-engine.js` - 原価計算エンジン（4方式対応）
- `base-data.js` - 全社設定UI（P&L、MCR、直間区分）
- `dept-cost.js` - 部門管理（アワーレート計算）
- `product-cost.js` - 製品原価（利益分析、診断コメント）
- `export.js` - Excel/PDF出力
- `styles.css` - スタイリング
- `lp.html` - ランディングページ

### 技術スタック

- 純粋なVanilla JavaScript（ES5+、IIFE パターン）
- フレームワーク不使用、ビルドプロセスなし
- localStorage でデータ保存
- CDN: SheetJS, html2canvas, jsPDF

### 原価計算の構造

- 製造間接費: 部門に配賦 → アワーレートに含まれる
- 販管費: 全社ベースで製品に直接配賦（稼働時間比 or 直接原価比）
- 4つの利益: 限界利益、貢献利益、製造利益、営業利益

## 外部サービス

- **Netlify**: サイトID `31c05340-e0f7-40cb-b063-20336abd6274`
- **GitHub**: `furu30/cost-simulation`
- **本番URL**: https://cost-simulation.netlify.app
