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
| `NETXRAY_DATA_DIR` | `./data/topologies` | IR JSON の保存ディレクトリ |
| `NETXRAY_CLAB_SSH_USER` | `""` | SSH ユーザー名（未設定時は起動警告） |
| `NETXRAY_CLAB_SSH_PASSWORD` | `""` | SSH パスワード（未設定時は起動警告） |

## API エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/api/topologies` | 保存済み IR ファイルの一覧 |
| `GET` | `/api/topology/{name}` | 指定トポロジの IR JSON を返す |
| `POST` | `/api/collect` | containerlab トポロジから IR を収集・保存 |

### POST /api/collect リクエスト例

```json
{
  "topology_name": "my-lab",
  "clab_topology_file": "/path/to/clab.yml"
}
```

## ディレクトリ構成

```
backend/
├── api/
│   ├── main.py            # FastAPI アプリ・起動設定
│   ├── config.py          # Pydantic Settings（環境変数）
│   ├── schemas.py         # リクエスト/レスポンス型
│   └── routes/
│       ├── topology.py    # GET /api/topologies, GET /api/topology/{name}
│       └── collect.py     # POST /api/collect
├── collector/
│   ├── clab.py            # containerlab inspect 連携
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
