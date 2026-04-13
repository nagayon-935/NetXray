# NetXray

ブラウザ完結型のネットワーク可視化・シミュレーションツール。
containerlab 環境で BGP / SRv6 / EVPN-VXLAN の検証・デバッグを行うための「ネットワーク・レントゲン」。

## 概要

NetXray は **Intermediate Representation (IR) JSON** を読み込み、トポロジをインタラクティブに可視化します。
パケットシミュレーション・ACL 解析・BGP セッション表示などをすべてブラウザ内で完結させ、実機への接続なしに静的解析が可能です。

```
IRファイル (JSON)
      │
      ▼
┌─────────────┐      ┌──────────────────────┐
│  Frontend   │◄────►│  WASM Engine (Rust)  │
│ React + RF  │      │  経路計算 / ACL評価   │
└─────────────┘      └──────────────────────┘
      ▲
      │ POST /api/collect
┌─────────────┐
│   Backend   │  ← containerlab / FRR / Arista cEOS
│  FastAPI    │
└─────────────┘
```

## ディレクトリ構成

```
NetXray/
├── schema/                  # IR JSON Schema (Single Source of Truth)
├── frontend/                # Vite + React SPA
├── engine/                  # Rust → WASM ロジックエンジン
├── backend/                 # FastAPI (Collector + Translator + API)
└── .gitignore
```

## IR スキーマバージョン

| バージョン | 主な追加内容 |
|---|---|
| v0.1.0 | ノード / インターフェース / リンク / ACL / VRF / ルーティングテーブル |
| v0.2.0 | BGP セッション (RFC 9234 Role) / SRv6 SID / EVPN-VXLAN VNI |

スキーマ定義: [`schema/netxray-ir.schema.json`](schema/netxray-ir.schema.json)

## クイックスタート

### フロントエンドのみ（ファイル読み込みモード）

```bash
cd frontend
npm install
npm run dev
# http://localhost:5173 を開く
# サンプルトポロジを読み込むか、IRファイルをドラッグ＆ドロップ
```

### バックエンドを使う（実機収集モード）

```bash
cd backend
uv sync
uv run uvicorn api.main:app --reload --port 8000
```

環境変数で接続先を設定:

```bash
export NETXRAY_CLAB_SSH_USER=admin
export NETXRAY_CLAB_SSH_PASSWORD=admin
export NETXRAY_DATA_DIR=/path/to/topologies
```

詳細は [`backend/README.md`](backend/README.md) を参照。

## 主な機能

### トポロジ可視化
- ReactFlow + elkjs による自動レイアウト（spine-leaf / ring / manual）
- ルーター / スイッチ / ホストのカスタムノード
- リンク状態（up/down）とインターフェース名ラベル

### 詳細パネル
- インターフェース一覧・VRF ルーティングテーブル
- BGP セッション一覧（確立状態・AS 番号・RFC 9234 Role）
- SRv6 SID テーブル（Function / VRF）
- EVPN VNI 一覧（L2/L3 / RD / RT）

### ACL 解析
- ルール一覧の Permit/Deny 色分け
- シャドウされたルールの自動検出・ハイライト

### BGP オーバーレイ
- BGP セッションを物理リンクと独立したレイヤで描画
- Established（緑・アニメーション）/ 非確立（橙・破線）
- RFC 9234 Role ミスマッチの検出・UI ハイライト

### パケットシミュレーション
- src / dst / プロトコル / ポートを指定してパス追跡
- エッジアニメーションでフロー方向を可視化

### スナップショット
- 任意タイミングで IR 状態を保存（最大 20 件）
- スナップショット間の diff 表示（ノード増減・リンク状態変化）

## 技術スタック

| レイヤ | 技術 |
|---|---|
| Frontend | Vite 8 / React 19 / TypeScript 6 / Tailwind CSS 4 |
| グラフ | React Flow 12 / elkjs |
| 状態管理 | Zustand 5 |
| WASM エンジン | Rust / wasm-bindgen / petgraph |
| Backend | FastAPI / Pydantic v2 / Netmiko / uvicorn |
| IR スキーマ | JSON Schema (quicktype で TS 型生成) |
