# agy-mcp

[English](README.md) · [Apache-2.0](LICENSE)

`agy-mcp` は、MCP クライアントから Google Antigravity CLI (`agy`) にタスクを委譲するための、ローカル [Model Context Protocol](https://modelcontextprotocol.io/) サーバーです。stdio で通信し、`agy` を子プロセスとして起動して、結果を構造化された MCP コンテンツとして返します。

個人のローカル利用を主目的にしつつ、OSS としてコードの確認・改変・貢献ができる形を目指しています。Antigravity の公式製品ではなく、Antigravity 側のアカウント、信頼設定、権限設定を置き換えるものでもありません。

## 提供するツール

| MCP ツール             | 用途                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `antigravity_run`      | 新しい Antigravity 会話を開始します。CLI が返した場合は `conversation_id` も返します。                             |
| `antigravity_continue` | ID を指定して会話を継続します。ID を省略すると `agy` の直近の会話を継続します。                                    |
| `antigravity_models`   | `agy models` を実行して CLI の出力を返します。モデルターンは開始しませんが、Antigravity に接続する場合があります。 |

`run` と `continue` は、プロンプト、絶対パスのワークスペース、任意のモデル・effort、`plan` または `accept-edits` の mode、autonomy、実行期限を受け取ります。既定では `agy` を最大 4 件まで並列実行できます。上限は `AGY_MCP_MAX_CONCURRENT` で変更できます。

`antigravity_models` でモデルの slug を一覧し、`model` に指定します。

```json
{
  "prompt": "認証フローを確認し、考えられるエッジケースを挙げてください。",
  "workspace": "/absolute/path/to/workspace",
  "model": "antigravity_models が返した slug",
  "mode": "plan",
  "autonomy": "safe",
  "timeout_seconds": 300
}
```

`timeout_seconds` の既定値は 300 で、10〜3600 の整数を指定できます。

## 並列実行

複数の MCP ツール呼び出しを同時に送ると、独立したタスクを並列実行できます。CLI プロセス、出力、進捗、タイムアウト、キャンセルは呼び出しごとに管理します。1 件をキャンセルしても他の実行は継続し、サーバー終了時には実行中の全プロセスを停止します。

- 新規会話や、異なる `conversation_id` を指定した継続は、同じワークスペースでも並列実行できます。
- 同じ会話 ID を指定した継続は、ワークスペースが異なっても同時実行できません。後から来た呼び出しは `BUSY` を返します。
- ID 省略時の継続（`--continue`）はサーバーを占有します。他の呼び出しが実行中なら `BUSY` を返し、ID 省略の継続が実行中なら他の呼び出しが `BUSY` を返します。並列で会話を継続する場合は `antigravity_run` が返した ID を指定してください。
- `antigravity_models` を含む全コマンドが同時実行数に数えられます。上限超過時は待機キューに入らず、即座に `BUSY` を返します。上限を `1` にすると従来の逐次実行に戻せます。

同時実行数の制限と会話 ID の排他制御は、1 つのサーバープロセス内で有効です。ワークスペースのファイル、CLI の状態、認証情報、アカウントのクォータは共有されます。worktree の自動分離や、別サーバー・別 CLI セッションとの調整は行いません。並列でコードを編集する場合は担当ファイルや worktree を分けてください。また、別セッションによって直近の会話が変わるため、会話 ID の明示を推奨します。

## 前提条件

- Node.js 22 以上
- pnpm 10 以上（このリポジトリは pnpm 10.18.1 を固定）
- `agy` が PATH にある、または `AGY_MCP_BIN` で実行ファイルを指定済み
- Antigravity が利用を許可しているワークスペース

CLI の導入、認証、信頼確認、権限、現在の挙動は、[Antigravity CLI の headless 公式ドキュメント](https://antigravity.google/docs/cli/headless/)を確認してください。このプロジェクトは [公式 TypeScript MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) を利用します。

## ソースから導入する

```bash
git clone https://github.com/Kaikei-e/agy-mcp.git
cd agy-mcp
pnpm install --frozen-lockfile
pnpm build
pnpm run doctor
```

`pnpm run doctor` は設定済みワークスペースを確認し、必要な `agy` の CLI フラグが利用可能か検査します。モデルターンは開始しません。Antigravity 側の認証とワークスペース信頼設定は別途済ませてください。

認証後には、必要に応じてライブのスモークテストを実行できます。

```bash
pnpm run probe
```

この probe は `run` を呼んだ後、その会話を `continue` します。Antigravity のクォータを消費し、会話を作成する可能性があります。CI では実行しません。

## MCP クライアントへ接続する

ビルド後、クライアントがコンパイル済みエントリーポイントを起動するよう設定します。以下にクライアントごとの設定例を示します。絶対パスはすべて自分の環境のパスに置き換えてください。

Claude Code のプロジェクト `.mcp.json` は次のように書けます。

```json
{
  "mcpServers": {
    "antigravity": {
      "command": "node",
      "args": ["/absolute/path/to/agy-mcp/dist/index.js"],
      "env": {
        "AGY_MCP_DEFAULT_WORKSPACE": "/absolute/path/to/workspace",
        "AGY_MCP_ALLOWED_ROOT": "/absolute/path/to",
        "AGY_MCP_MAX_CONCURRENT": "4"
      }
    }
  }
}
```

Codex CLI または Codex IDE では、同じ stdio サーバーを `~/.codex/config.toml`、または信頼済みプロジェクト内の `.codex/config.toml` に追加します。Codex CLI と IDE はこの設定を共有します。利用できる設定は [Codex の MCP 設定ドキュメント](https://developers.openai.com/codex/mcp/) も参照してください。[examples/codex.config.toml](examples/codex.config.toml) をコピーし、プレースホルダーをすべて絶対パスに置き換えて、既存ファイルへ必要なテーブルをマージしてください。既存の `mcp_servers.antigravity` がある場合は重複テーブルを追加せず、その項目を編集します。他の設定を上書きしないでください。

```toml
[mcp_servers.antigravity]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/agy-mcp/dist/index.js"]
startup_timeout_sec = 20
tool_timeout_sec = 3660

[mcp_servers.antigravity.env]
AGY_MCP_DEFAULT_WORKSPACE = "/absolute/path/to/workspace"
AGY_MCP_ALLOWED_ROOT = "/absolute/path/to"
AGY_MCP_MAX_CONCURRENT = "4"
# Codex の PATH に `agy` がない場合に設定します。
AGY_MCP_BIN = "/absolute/path/to/agy"
```

Codex が Node.js を含む PATH を引き継ぐ場合は `command = "node"` も使えます。GUI や IDE から起動する場合は、`command -v node` で確認した Node.js の絶対パスを指定すると安定します。`agy` がその PATH にない場合は `command -v agy` で確認した絶対パスを `AGY_MCP_BIN` に指定してください。通常の PATH で `agy` が見つかる場合はこの項目を削除できます。Codex の既定値はツール 60 秒、起動 10 秒です。このサーバーのリクエスト既定値は 300 秒、最大値は 3600 秒です。`tool_timeout_sec = 3660` は最大値に 60 秒の余裕を加えた値で、`startup_timeout_sec = 20` は起動待ち時間に余裕を持たせます。

先に TOML を編集せず、`codex mcp add` で stdio コマンドを登録することもできます。

```bash
codex mcp add antigravity \
  --env "AGY_MCP_DEFAULT_WORKSPACE=/absolute/path/to/workspace" \
  --env "AGY_MCP_ALLOWED_ROOT=/absolute/path/to" \
  --env "AGY_MCP_MAX_CONCURRENT=4" \
  --env "AGY_MCP_BIN=/absolute/path/to/agy" \
  -- "/absolute/path/to/node" "/absolute/path/to/agy-mcp/dist/index.js"
codex mcp list
codex mcp get antigravity
```

`add` コマンドでは `startup_timeout_sec` と `tool_timeout_sec` は設定されません。実行後に、他の設定を残したまま、上記のタイムアウト設定を生成されたサーバー項目へ追加してください。MCP 設定を変更した後は Codex CLI または IDE のセッションを再起動します。プロジェクト側の設定は、信頼済みプロジェクトでのみ読み込まれます。

サーバーの stdout は MCP 通信専用です。標準出力に診断ログを書くラッパーを挟まないでください。MCP クライアントのタイムアウトはツールの `timeout_seconds` より少し長く設定します。進捗通知やハートビートは状態を示しますが、クライアント側のタイムアウトを必ず延長するものではありません。

Codex がサーバーを起動できない場合は、Node.js の絶対パスと `AGY_MCP_BIN` を確認してください。IDE プロセスではシェルの起動ファイルが読み込まれないことがあります。呼び出しがタイムアウトする場合は、リクエストの `timeout_seconds`（10〜3600）と `tool_timeout_sec` の両方を確認し、設定変更後に Codex を再起動します。

## 安全性とワークスペース境界

標準のリクエスト設定は `mode: "plan"` と `autonomy: "safe"` です。

- `safe` は `agy` 側で設定済みの権限・信頼判断を引き継ぎます。読み取り専用を保証するものではありません。
- `sandbox` は CLI のターミナル制限を追加します。適用範囲と挙動は Antigravity 側の仕様です。
- `full` は CLI の権限回避フラグを使います。サーバー環境で `AGY_MCP_ALLOW_FULL_AUTONOMY=true` を明示した場合だけ受け付けます。

指定する `workspace` は、アクセス可能な絶対パスのディレクトリである必要があります。サーバーは実体パスに正規化してから使います。`AGY_MCP_ALLOWED_ROOT` を設定すると、その実体パス配下だけをワークスペースとして選べます。ただしこれはワークスペース選択の制限であり、子プロセスのファイルシステムアクセスやネットワークアクセスをサンドボックス化するものではありません。信頼できるワークスペースと権限だけを指定してください。

ブリッジはプロンプト内の CLI スラッシュコマンド展開を無効化しますが、エージェントから返る出力は信頼できないデータとして扱ってください。提案されたコマンドや編集は実行前に確認します。

## 環境変数

| 変数                          | 既定値                         | 内容                                                                                 |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| `AGY_MCP_BIN`                 | `agy`                          | CLI の実行ファイル名、絶対パス、またはサーバーのカレントディレクトリからの相対パス。 |
| `AGY_MCP_DEFAULT_WORKSPACE`   | サーバーのカレントディレクトリ | 省略時のワークスペース。解決・正規化後に利用します。                                 |
| `AGY_MCP_ALLOWED_ROOT`        | 未設定                         | 選択可能なワークスペースを含む任意の実体パスのルート。                               |
| `AGY_MCP_MAX_CONCURRENT`      | `4`                            | サーバーごとの CLI 同時実行数の上限。1〜32 の整数。                                  |
| `AGY_MCP_MAX_OUTPUT_CHARS`    | `40000`                        | 各 MCP 結果表現の最大文字数。1024〜1000000 の整数。                                  |
| `AGY_MCP_MAX_BUFFER_BYTES`    | `8388608`                      | 停止前に取り込む CLI stdout の最大バイト数。1024〜67108864 の整数。                  |
| `AGY_MCP_ALLOW_FULL_AUTONOMY` | `false`                        | `autonomy: "full"` を許可するには、厳密に `true` を設定します。                      |

各ツール結果には `structuredContent` と、同一 JSON のテキストコンテンツが含まれます。エラーやメタデータを含む表現全体は `AGY_MCP_MAX_OUTPUT_CHARS` で上限を設け、切り詰め時には明示します。CLI stdout にはプロセスごとに `AGY_MCP_MAX_BUFFER_BYTES` の上限があり、並列数に応じて全体のメモリ使用量が増えます。

進捗トークンを渡すクライアントには、長時間実行中の進捗メタデータとハートビートを返します。キャンセル、タイムアウト、出力上限では Linux と macOS で CLI のプロセスグループ停止を試みます。Windows の停止はベストエフォートのため、重要な場合は子プロセスが残っていないか確認してください。

## 開発

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm format:check
```

`pnpm pack` はパッケージアーカイブ作成前に `prepack` でビルドします。npm 公開を自動化するワークフローはありません。

Issue や Pull Request の前に [CONTRIBUTING.md](CONTRIBUTING.md) と [SECURITY.md](SECURITY.md) を読んでください。変更は [Apache License 2.0](LICENSE) の下で公開されます。
