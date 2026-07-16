# NetXray Backend

FastAPI による REST API サーバー。containerlab / FRR / Arista cEOS からルーティング情報を収集し、NetXray IR JSON に変換して提供する。

## セットアップ

Python 3.12+ が必要。依存管理は [uv](https://github.com/astral-sh/uv) を使用。

```bash
cd backend
uv sync
uv run uvicorn api.main:app --reload --port 8000
```

## 環境変数

| 変数名 | デフォルト | 説明 |
|---|---|---|
| `DATA_DIR` | `./data/topologies` | IR JSON の保存ディレクトリ |
| `CLAB_SSH_USER` | `""` | SSH ユーザー名（未設定時は起動警告） |
| `CLAB_SSH_PASSWORD` | `""` | SSH パスワード（未設定時は起動警告） |
| `NETXRAY_CLAB_LABS_DIR` | `/labs` | containerlab トポロジのベースディレクトリ（`binds:` の一貫性のためホストと同一パスにする） |

## API エンドポイント

### トポロジ管理

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/api/topologies` | 保存済み IR ファイルの一覧 |
| `GET` | `/api/topology/{name}` | 指定トポロジの IR JSON を返す |
| `POST` | `/api/topology/{name}` | IR JSON を保存 |
| `DELETE` | `/api/topology/{name}` | IR を削除 |
| `POST` | `/api/collect` | containerlab トポロジから IR を収集・保存 |

### IaC（clab 生成・変換）

| メソッド | パス | 説明 |
|---|---|---|
| `POST` | `/api/iac/export/clab` | IR から clab トポロジ YAML を生成 |
| `POST` | `/api/iac/deploy-clab` | 生成した clab トポロジをデプロイ |
| `POST` | `/api/iac/from-clab-yaml` | clab YAML を IR に変換 |
| `POST` | `/api/iac/clone-to-clab` | IR を複製し clab としてデプロイ |
| `POST` | `/api/iac/config/generate` | ノードの startup-config を生成 |

### Lab ライフサイクル

| メソッド | パス | 説明 |
|---|---|---|
| `POST` | `/api/lab/deploy` | containerlab トポロジをデプロイ |
| `POST` | `/api/lab/destroy` | トポロジを破棄 |
| `POST` | `/api/lab/redeploy` | 再デプロイ |
| `GET` | `/api/lab/status` | デプロイ状態を取得 |
| `GET` | `/api/lab/logs/{run_id}` | 実行ログを取得 |

### リンク impairment（netem）

| メソッド | パス | 説明 |
|---|---|---|
| `POST` | `/api/link/impairment` | リンクに遅延 / ロス / 帯域制限を適用 |
| `DELETE` | `/api/link/impairment` | impairment を解除 |
| `GET` | `/api/link/impairments` | 適用中の impairment 一覧 |

### その他

| メソッド | パス | 説明 |
|---|---|---|
| `WS` | `/api/ws/lab/{run_id}` | Lab ライフサイクルログのストリーミング |
| `GET` | `/metrics` | Prometheus メトリクス |
| `GET` | `/health` | ヘルスチェック |

### POST /api/collect リクエスト例

```json
{
  "topology_name": "my-lab",
  "clab_topology": "/path/to/clab.yml"
}
```

## ディレクトリ構成

```
backend/
├── api/
│   ├── main.py            # FastAPI アプリ・起動設定
│   ├── config.py          # Pydantic Settings（環境変数）
│   ├── schemas.py         # リクエスト/レスポンス型
│   ├── state.py           # 現在ロード中の IR 状態
│   └── routes/
│       ├── topology.py    # トポロジの一覧 / 取得 / 保存 / 削除
│       ├── collect.py     # POST /api/collect
│       ├── iac.py         # clab 生成・変換・デプロイ・config 生成
│       ├── lab.py         # Lab ライフサイクル（deploy / destroy / redeploy / status / logs）
│       ├── link.py        # リンク impairment（netem）
│       ├── metrics.py     # Prometheus メトリクス
│       └── ws.py          # WebSocket（Lab ログストリーミング）
├── collector/
│   ├── clab.py            # containerlab inspect 連携
│   ├── clab_lifecycle.py  # clab deploy / destroy サブプロセス管理
│   ├── clab_netem.py      # netem によるリンク impairment 適用
│   ├── telemetry_manager.py # WebSocket チャンネル管理（ログ配信）
│   ├── gnmi_client.py     # gNMI クライアント（スタブ・将来拡張）
│   ├── ssh_client.py      # Netmiko SSH 接続ラッパー
│   ├── driver_base.py     # VendorDriver プロトコル定義
│   └── drivers/
│       ├── frr.py         # FRR コマンド定義
│       └── arista.py      # Arista cEOS コマンド定義
├── translator/
│   ├── ir_builder.py      # 収集データ → IR JSON 変換パイプライン
│   ├── link_builder.py    # インターフェース情報からリンク生成
│   ├── parser_base.py     # VendorParser プロトコル定義
│   └── parsers/
│       ├── frr.py         # FRR パーサー（JSON API + TTP/Regex）
│       └── arista.py      # Arista パーサー（eAPI JSON）
├── data/topologies/       # 収集済み IR JSON の保存先
├── tests/                 # pytest テスト群
└── pyproject.toml
```

## テスト

```bash
uv run pytest -v
```

フィクスチャ（`tests/fixtures/`）はすべてオフライン実行可能。実機への SSH は不要。

## ベンダー拡張

新しいベンダーを追加する場合:

1. `collector/drivers/<vendor>.py` を作成し `VendorDriver` を実装
2. `translator/parsers/<vendor>.py` を作成し `VendorParser` を実装
3. `translator/parsers/__init__.py` の `PARSERS` 辞書に登録

既存コードの変更は不要（Open-Closed 原則）。
