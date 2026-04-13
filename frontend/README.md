# NetXray Frontend

Vite + React + TypeScript による SPA。IR JSON を読み込んでネットワークトポロジをブラウザ内で可視化・操作する。

## セットアップ

```bash
npm install
npm run dev      # 開発サーバー http://localhost:5173
npm run build    # プロダクションビルド
npm run lint     # ESLint チェック
```

## ディレクトリ構成

```shellsession
src/
├── types/
│   └── netxray-ir.ts          # IR 型定義（JSON Schema から生成）
├── stores/
│   ├── topology-store.ts      # IR / ReactFlow ノード・エッジ / 選択状態
│   ├── layer-store.ts         # 可視化レイヤのオン/オフ（BGP / SRv6 / EVPN）
│   └── snapshot-store.ts      # IR スナップショット保存・diff
├── components/
│   ├── TopologyCanvas.tsx     # メインキャンバス（ReactFlow）
│   ├── nodes/                 # カスタムノード（Router / Switch / Host）
│   ├── edges/                 # カスタムエッジ（NetworkEdge / BgpEdge）
│   ├── panels/                # サイドパネル（詳細 / ACL / パケット / スナップショット）
│   └── toolbar/               # SimToolbar（レイアウト切替・レイヤトグル・スナップショット）
├── hooks/
│   ├── useTopologyLayout.ts   # elkjs レイアウト（spine-leaf / ring / manual）
│   ├── useWasmEngine.ts       # WASM ロード + モックフォールバック
│   └── useIRLoad.ts           # ファイル読み込み処理
├── engine/
│   ├── mock-engine.ts         # TypeScript モックエンジン（WASM と同一 IF）
│   └── wasm-engine.ts         # WASM バインディング
└── lib/
    ├── ir-loader.ts           # IR JSON バリデーション・読み込み（10 MB 上限）
    └── bgp-overlay.ts         # BGP エッジ生成・RFC 9234 Role ミスマッチ検出
```

## IR ファイルの読み込み方法

1. **ドラッグ＆ドロップ** — キャンバスに IR JSON ファイルをドロップ
2. **サンプルトポロジ** — ツールバーの「Load Sample」から選択
3. **バックエンド API** — `/api/topologies` 経由で取得（バックエンド起動時）

サンプル IR は `public/sample-topologies/` に配置:

- `simple-3node.json` — ルーター 3 台の三角トポロジ（v0.2、BGP + SRv6）
- `spine-leaf-4.json` — Spine 2 台 + Leaf 2 台 + Host 4 台（v0.2、iBGP + eBGP + EVPN、意図的な Role ミスマッチ含む）

## レイヤトグル

BGP / SRv6 / EVPN データを持つ IR を読み込むと、ツールバーにレイヤボタンが出現する。

| ボタン | 表示内容 |
| --- | --- |
| BGP | BGP セッションオーバーレイエッジ |
| SRv6 | （将来拡張: SID マップオーバーレイ） |
| EVPN | （将来拡張: VNI トンネルオーバーレイ） |

## WASM エンジン

`engine/` の Rust クレートを `wasm-pack build --target web` でビルドすると `frontend/src/engine/pkg/` に出力される。
ビルド済み WASM が存在しない場合は自動的にモックエンジンにフォールバックする。
