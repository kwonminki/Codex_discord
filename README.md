# Codex Discord Connector

Codex Discord Connector는 로컬 컴퓨터의 Codex 세션과 파일 작업을 Discord 서버에서 조작할 수 있게 연결하는 브리지입니다. Discord의 카테고리/채널 구조를 Codex의 폴더/세션 구조와 맞춰서, Discord 안에서 Codex와 대화하고 로컬 파일을 탐색하며 필요한 shell 명령을 실행할 수 있습니다.

> Security notice: this tool can execute shell commands on the machine where the connector is running. Only install it on machines you control, connect it only to trusted private Discord servers, and restrict access with Discord role allowlists.

## 핵심 기능

- Discord 관리자 채널에서 로컬 컴퓨터의 파일 구조를 탐색하고 shell 명령을 실행합니다.
- Discord에서 Codex에게 자연어로 요청하고 진행 상황과 최종 답변을 받습니다.
- Codex의 작업 과정을 `파일 탐색 중`, `이미지 생성 중`, `컨텍스트 압축 중`처럼 한국어 진행 상태로 표시합니다.
- Codex가 최종 답변에 로컬 이미지 또는 `codex-discord-send` 첨부 블록을 포함하면 Discord 메시지에 파일로 첨부합니다.
- Codex workspace 폴더를 Discord 카테고리로, Codex 세션을 Discord 텍스트 채널로 동기화합니다.
- `sync` 기본값은 세션 선택 UI입니다. 전체 동기화는 `sync all` 또는 `/sync-all`로 명시해야 합니다.
- Codex thread state에서 활성으로 확인된 앱 세션만 가져옵니다.
- 보관 세션, sub-agent, `codex exec`/CLI 일회성 세션, thread state 미확인 세션은 sync에서 제외합니다.
- 동기화된 세션 채널에는 최근 대화 맥락을 일부 올려서 이어서 대화할 수 있게 합니다.
- 동기화된 세션 채널은 `채팅 시작 시 동기화` 또는 `실시간 동기화` 모드 중 선택할 수 있습니다.
- `실시간 동기화` 모드에서는 Codex Desktop에서 먼저 시작된 세션 진행 상황도 기본 약 5초 주기로 Discord에 반영됩니다.
- Codex 작업 완료를 감지하면 세션별 Discord 스레드에 operator role을 멘션해 알립니다.
- Discord에서 시작한 Codex 작업은 최종 답변 메시지와 완료 알림이 중복되지 않도록 해당 완료 알림 한 번만 답변 본문을 생략합니다.
- Codex가 명령 실행, 파일 변경, 추가 권한을 요청하면 Discord 버튼으로 이번 턴 허용, 세션 동안 허용, 거절, 취소를 선택할 수 있습니다.
- Discord 버튼/드롭다운으로 파일 이동, 파일 보기, Git 확인, 테스트 실행, Codex 리뷰/수정 요청을 처리합니다.
- Git 충돌 표식과 공백 오류를 Discord 드롭다운의 `Git 충돌 점검`으로 바로 확인할 수 있습니다.
- `유지보수` 패널에서 `봇 개발 채팅`, `타입체크`, `테스트 실행`, `명령어 재등록`, `봇 재시작`까지 이어갈 수 있습니다.
- Discord 안에서 slash command 재등록과 봇 재시작을 요청할 수 있습니다.
- 관리자 채널에서 `/clear count:<숫자>` 또는 `clear <개수>`로 운영 채널 메시지를 정리할 수 있습니다. 전체 정리는 확인 명령이 필요합니다.

Codex 요청 timeout은 기본 5시간입니다. `CONNECT_CODEX_PROMPT_TIMEOUT_MS`에 millisecond 값을 넣어 조절할 수 있고, `0`으로 설정하면 전체 Codex 요청 timeout을 끕니다.

## 구조

기본 사용 방식은 **Direct mode**입니다. Direct mode는 외부 Control API를 열지 않고, 같은 컴퓨터에서 Discord gateway와 실행 worker를 독립 프로세스로 실행합니다.

```text
Discord Server
  ├─ Admin Channel
  │   ├─ sync / 파일 탐색 / shell / Codex 요청
  │   └─ 봇 reload / 상태 확인 / 삭제 미리보기
  └─ Codex Workspace Category
      ├─ Codex Session Channel
      └─ Codex Session Channel

Local Computer
  ├─ Codex home: ~/.codex
  ├─ Project workspace
  └─ Codex Discord Connector
      ├─ Discord Bot: 메시지, 버튼, 알림
      ├─ Direct Worker: shell, Codex, Claude Code 실행
      └─ .connect/: durable 요청, job 결과, 연결 상태
```

Direct mode에서는 `Discord Bot -> durable queue -> Direct Worker`로 이 컴퓨터를 제어합니다. Discord bot만 재시작해도 worker와 이미 실행 중인 Codex/Claude Code 하위 프로세스는 계속 동작하며, 새 bot이 같은 request ID로 진행 이벤트, 권한 요청, 최종 결과에 다시 연결됩니다. 컴퓨터나 worker 자체가 강제 종료되면 실행 중 job은 실패 처리되지만 아직 시작하지 않은 요청은 디스크에 남아 다음 worker가 이어서 실행합니다.

같은 Discord bot token을 여러 컴퓨터에서 동시에 실행할 수도 있습니다. 이 경우 각 인스턴스의 admin/session 채널 ID가 서로 겹치지 않아야 하며, 봇은 담당하지 않는 채널의 일반 메시지, slash command, 버튼, 셀렉트, 모달 interaction을 무시합니다.

여러 컴퓨터를 한 Discord 서버에서 관리하는 **Hub mode**도 있지만, 현재는 실험적 기능입니다. Control API와 Local Agent를 추가로 실행해야 하고, 네트워크로 명령 실행 경로가 넓어지므로 보안 위험이 Direct mode보다 큽니다.

## 빠른 시작

### 1. 설치

npm으로 설치합니다.

```bash
npm install -g codex-discord-connector
```

전역 설치를 원하지 않으면 `npx`로도 실행할 수 있습니다.

```bash
npx codex-discord-connector status
```

설치 후 CLI 명령은 `cdc`입니다. 긴 이름 `codex-discord-connector`도 같은 명령으로 동작합니다.

```bash
cdc status
```

### 2. Direct mode 설정

단일 컴퓨터를 Discord와 바로 연결하는 Direct mode가 기본 사용 방식입니다.

```bash
cdc install --direct
```

대화형 설치를 시작하면 각 값의 위치가 먼저 출력되고, 다음 값을 순서대로 입력받습니다.

- Discord bot token: [Discord Developer Portal](https://discord.com/developers/applications)에서 앱을 선택하고 `Bot > Reset Token/Copy`에서 가져옵니다. Public Key와 OAuth2 Client ID는 입력하지 않습니다.
- Discord guild/server ID: Discord `사용자 설정 > 고급 > 개발자 모드`를 켠 뒤 서버 아이콘을 우클릭하고 `서버 ID 복사`를 선택합니다.
- Operator role ID 목록: `서버 설정 > 역할`에서 connector 사용을 허용할 역할의 메뉴를 열어 `역할 ID 복사`를 선택합니다. 여러 역할은 쉼표로 구분합니다.
- Codex/admin 채널 ID: 서버별 전용 Codex 채널을 우클릭하고 `채널 ID 복사`를 선택합니다.
- Claude Code 채널 ID: 같은 서버의 전용 Claude Code 채널을 우클릭하고 `채널 ID 복사`를 선택합니다. Claude Code를 사용하지 않을 때만 비워둘 수 있습니다.
- 연결할 workspace root
- 컴퓨터 이름과 workspace 표시 이름
- Codex home 경로, 보통 `$HOME/.codex`

서버와 채널 ID를 복사하려면 Discord Developer Mode가 필요합니다. Codex/admin 채널과 Claude Code 채널은 서로 다른 채널이어야 하며, 같은 bot token을 여러 컴퓨터에서 쓸 때는 컴퓨터별 채널 ID도 겹치면 안 됩니다. 자세한 ID 복사 방법은 [Discord 공식 안내](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID)를 참고하세요.

비대화형으로도 설정할 수 있습니다.

```bash
cdc install --direct \
  --token "DISCORD_BOT_TOKEN" \
  --guild-id "DISCORD_GUILD_ID" \
  --role-ids "ROLE_ID_1,ROLE_ID_2" \
  --channel-id "CODEX_ADMIN_CHANNEL_ID" \
  --claude-channel-id "CLAUDE_CODE_CHANNEL_ID" \
  --workspace-root "$PWD" \
  --workspace-name "CodexDiscordConnector"
```

상위 폴더 이동을 허용하면서 특정 프로젝트 폴더에서 시작하려면 workspace root를 더 넓은 허용 루트로 잡고 `--initial-cwd`를 지정합니다.

```bash
cdc install --direct \
  --workspace-root "/Users/me/projects" \
  --initial-cwd "/Users/me/projects/my-app" \
  --workspace-name "projects"
```

설정이 끝나면 `.connect/config.json`과 `.env`가 생성됩니다.

### Codex app-server 설정

Codex 세션 fork와 실행 중 steering을 사용하려면 runner가 반드시 `app-server`여야 합니다. Direct mode의 기본값도 `app-server`지만, LaunchAgent나 systemd처럼 별도 서비스로 실행할 때는 설정 누락을 쉽게 확인할 수 있도록 아래 값을 명시하는 것을 권장합니다.

```bash
CODEX_DISCORD_CODEX_RUNNER=app-server
```

systemd unit에서는 다음처럼 설정합니다.

```ini
Environment=CODEX_DISCORD_CODEX_RUNNER=app-server
```

`codex exec` 호환 모드에서는 `/fork`와 실행 중인 turn에 대한 일반 메시지 steering이 동작하지 않습니다. 예전 Codex CLI와의 호환성이 꼭 필요한 경우에만 `CODEX_DISCORD_CODEX_RUNNER=exec`를 명시하세요.

### 3. 봇 실행

```bash
cdc start --direct
```

처음 실행 후 Discord 관리자 채널에서 `help`를 입력해 버튼과 명령어가 보이면 연결된 상태입니다.

### Discord 채널과 알림 권장 설정

개인용 private Discord 서버에 컴퓨터별 관리자 채널과 Codex/Claude Code 세션 채널을 따로 만드는 구성을 권장합니다. 서버 또는 봇 전용 채널의 알림 설정은 **멘션만(Only @mentions)** 으로 두세요. 태그 없는 중간 진행 메시지는 알림 없이 쌓이고, 확인이 필요한 권한 요청과 최종 완료·실패 메시지만 operator role 멘션으로 알림이 옵니다.

세션 채널이 많다면 전용 카테고리를 만들고 같은 알림 정책을 적용하면 관리하기 편합니다. operator role은 실제 알림을 받을 사용자에게만 부여하고, 각 컴퓨터의 봇 인스턴스에는 서로 겹치지 않는 관리자/세션 부모 채널 ID를 설정하세요.

### 자주 쓰는 명령어

| 명령어 | 용도 |
| --- | --- |
| `/status` | 현재 세션 연결, 실행 상태, 마지막 활동 시각과 대기열을 확인합니다. |
| `/fork` | 현재 Codex 또는 Claude Code 세션의 맥락을 복제해 새 Discord thread로 분기합니다. Codex에서는 `app-server`가 필요합니다. |
| `/howtouse` | 현재 agent 세션에 Discord 사용법과 이미지·영상·오디오·파일 첨부 형식을 전달합니다. |
| `/queue prompt:<요청>` | 현재 작업에 끼어들지 않고 다음 작업으로 실행할 요청을 예약합니다. |

## 버전 호환성

Codex CLI와 Claude Code의 headless/protocol 인터페이스는 버전에 따라 달라질 수 있습니다. 특히 이 connector는 Codex의 `app-server` JSON-RPC와 Claude Code의 stream JSON 출력을 사용하므로, 서버마다 버전이 크게 다르면 한 서버에서만 fork, resume, 진행 출력 또는 권한 설정이 실패할 수 있습니다.

2026-07-21 현재 개발 및 실제 Mac 서비스에서 확인한 기준은 다음과 같습니다.

| 구성 요소 | 지원 또는 확인 버전 | 메모 |
| --- | --- | --- |
| Node.js | `^20.19.0` 또는 `>=22.12.0` | Ubuntu는 Node.js 22 LTS 권장 |
| pnpm | `9.15.0` | `packageManager`와 Ubuntu 설치 문서에서 고정 |
| Codex CLI | `codex-cli 0.145.0-alpha.18` 확인 | `app-server`, `thread/resume`, `thread/fork`, `turn/start` 사용 |
| Claude Code | `2.1.215` 확인 | `stream-json`, `--resume`, `--fork-session`, `--permission-mode` 사용 |

Codex와 Claude Code의 표에 적힌 값은 엄격한 최소 버전이 아니라 **검증 기준 버전**입니다. 더 최신 버전이 항상 호환된다는 뜻은 아닙니다. 여러 Ubuntu 서버를 운영할 때는 가능한 한 같은 CLI 버전을 맞추고, 한 서버에서 먼저 connector smoke test를 통과시킨 뒤 나머지 서버를 업데이트하세요.

각 머신에서 아래 결과를 함께 기록하면 호환 문제를 비교하기 쉽습니다.

```bash
node --version
pnpm --version
codex --version
claude --version
git -C /path/to/Codex_discord rev-parse --short HEAD
```

CLI 업데이트 후에는 최소한 `where`, 짧은 Codex/Claude 요청, `/fork`, bot 재시작 후 실행 중 job 재연결을 확인하세요. 특정 서버에서만 문제가 생기면 정상 서버와 위 버전을 먼저 비교하고, 필요하면 해당 서버의 CLI를 마지막 정상 버전으로 되돌리세요. systemd가 interactive shell과 다른 실행 파일을 잡지 않도록 `CODEX_DISCORD_CODEX_COMMAND`와 `CODEX_DISCORD_CLAUDE_COMMAND`에는 검증한 실행 파일의 절대 경로를 설정하는 것이 안전합니다.

## 실험적 다중 컴퓨터 연결: Hub mode

Hub mode는 여러 컴퓨터를 한 Discord 서버에서 관리하기 위한 실험적 옵션입니다. 아직 테스트 중인 서브 기능이며, 보안 위험이 Direct mode보다 높습니다. 꼭 필요한 경우가 아니라면 Direct mode를 사용하세요.

Hub mode에서는 아래 컴포넌트를 함께 실행합니다.

- Discord Bot
- Control API
- Local Agent

위 구조는 여러 컴퓨터를 등록할 수 있게 해주지만, Control API와 Agent 연결 경로가 추가됩니다. 네트워크 노출, 인증 설정, 로그/명령 출력 관리, 운영자 role 관리가 모두 더 중요해집니다.

최소 권장 조건:

- 신뢰하는 private Discord 서버에서만 사용
- Control API를 공개 인터넷에 직접 노출하지 않기
- 방화벽, VPN, localhost 터널 등 별도 접근 제어 사용
- 각 컴퓨터의 workspace root를 필요한 범위로 제한
- 운영자 role을 최소 인원에게만 부여
- shell 명령 출력에 민감 정보가 섞이지 않는지 별도 점검

```bash
cdc setup --hub
cdc start --hub
```

```text
Discord Bot -> Control API -> Local Agent -> Local Computer
```

Direct mode와 달리 여러 컴퓨터를 등록하고 관리할 수 있습니다. 이 기능은 안정화 전까지 “테스트 중”으로 보고, 중요한 컴퓨터나 민감한 workspace에는 사용하지 않는 것을 권장합니다.

## Discord 사용법

### 관리자 채널

관리자 채널은 컴퓨터 제어용 채널입니다. 일반 메시지는 role 검사를 거친 뒤 shell 명령으로 처리됩니다.
Codex 대화는 이 채널에서 직접 실행하지 않고, `chat new` 또는 `sync`로 만든 세션 채널에서 진행합니다.

```text
help
where
ls
cd apps
cat README.md
chat new name:자유 메모
chat new current name:지금 폴더 작업
chat new cwd:/Users/me/project name:새 기능 구현
sync
sync status
reload
```

위험한 명령은 명시 확인이 필요합니다.

```text
confirm rm path/to/file
```

### Codex 세션 채널

`sync`로 만들어진 세션 채널은 Codex 대화방처럼 사용할 수 있습니다. 일반 메시지는 Codex에게 전달되고, shell 명령은 `!` 접두어를 붙입니다.

```text
이 세션에서 지금까지 한 일 요약해줘
다음 단계 구현해줘
review 보안 위험 위주
model gpt-5.4
!ls
!cat README.md
archive confirm
```

### 새 Codex 채팅 만들기

관리자 채널에서 새 Discord 채널을 만들고, 그 채널을 새 Codex 대기 세션으로 연결할 수 있습니다.

```text
chat new name:자유 메모
/chat-new location:general name:자유 메모
```

위 명령은 카테고리 없는 일반 Codex 채팅 채널을 만듭니다. 봇은 일반 채팅용 전용 폴더를 만들고, 새 채널에서 첫 메시지를 보내면 그때 실제 Codex 세션이 열립니다.
Discord 버튼으로 만들 때는 `새 일반 채팅` 또는 `현재 폴더 채팅`을 누르면 모달이 열립니다. 채널 이름과 첫 요청을 입력할 수 있고, 둘 다 비워도 채널만 먼저 만들 수 있습니다.

현재 Discord 채널의 작업 폴더에서 새 채팅을 시작하려면 `current`를 사용합니다. 특정 폴더에서 시작하려면 `cwd`를 지정합니다. 이 경우 해당 폴더 이름의 Discord 카테고리 아래에 채널이 생성됩니다.

```text
chat new current name:지금 폴더 작업
/chat-new location:current name:지금 폴더 작업
chat new cwd:/Users/me/project name:주간 보고서
/chat-new location:path name:주간 보고서 cwd:/Users/me/project category:true
```

`location:general` 또는 `cwd` 생략 기본값은 프로젝트 폴더와 분리된 일반 채팅입니다.

## Slash commands

봇은 시작 시 Discord-native slash command를 등록합니다. 명령어는 전역으로 보이지만, 실제 실행 가능 범위는 채널 모드로 나뉩니다. main/admin 채널에서 Codex 대화 명령을 실행하거나, session 채널에서 동기화/봇 관리 명령을 실행하면 안내 메시지와 함께 차단됩니다.

### Admin 전용 또는 Admin 중심 명령

| 명령어 | 설명 |
| --- | --- |
| `/where` | 현재 채널의 컴퓨터, workspace, cwd, 세션 연결 상태를 보여줍니다. |
| `/status` | `/where`와 동일한 상태 카드를 보여줍니다. |
| `/browse` | 현재 폴더의 파일 브라우저 UI를 엽니다. |
| `/shell command:<명령>` | 현재 cwd에서 shell 명령을 실행합니다. |
| `/diff` | 현재 cwd에서 `git diff --stat`을 실행합니다. |
| `/clear count:<숫자>` | 관리자 채널의 최근 메시지를 지정한 수만큼 삭제합니다. 최대 100개까지 삭제합니다. |
| `/clear all:true` | 관리자 채널의 가능한 최근 메시지 전체 삭제 확인 카드를 엽니다. 실제 삭제는 `clear all confirm`으로 확정합니다. |
| `/sync limit:<숫자>` | 활성 Codex 세션 선택 드롭다운을 엽니다. |
| `/sync-select limit:<숫자>` | `/sync`와 동일하게 선택 드롭다운을 엽니다. |
| `/sync-all limit:<숫자>` | 활성 세션을 선택 없이 즉시 동기화합니다. |
| `/sync-status` | 동기화된 카테고리, 채널, 보관 세션 상태를 보여줍니다. |
| `/sync-mode mode:on-chat 또는 realtime` | 동기화된 세션 채널의 transcript 반영 방식을 선택합니다. |
| `/sync-delete mode:preview/all/channels/session session_id:<id> confirm:<true/false>` | 동기화된 Discord 채널 삭제를 미리보기/확정합니다. 미리보기 카드에서 삭제할 채널 하나를 드롭다운으로 고를 수 있습니다. 로컬 Codex 세션 파일은 삭제하지 않습니다. |
| `/sync-archive session_id:<id> confirm:<true/false>` | 특정 Codex 세션을 bridge 보관 목록에 넣어 다음 sync에서 제외합니다. |
| `/schedule action:create mode:once/every/daily/weekly command:<명령> at:<시간> every:<주기> weekdays:<요일>` | 기존 채팅형 명령을 특정 시간/주기/요일에 반복 실행하도록 예약합니다. |
| `/schedule action:list` | 등록된 예약 명령을 보여줍니다. |
| `/schedule action:delete id:<id>` | 예약 명령을 삭제합니다. |
| `/chat-new location:general/current/path name:<이름> cwd:<경로> category:<true/false> prompt:<요청>` | 새 Codex 채팅 채널을 만듭니다. `general`은 일반 채팅, `current`는 현재 채널의 작업 폴더, `path`는 지정한 `cwd`에서 시작합니다. |
| `/reload mode:commands` | Discord slash command를 다시 등록합니다. |
| `/reload mode:restart confirm:true` | 봇 프로세스를 Discord에서 재시작 요청합니다. |
| `/codex-command command:<name> prompt:<args>` | 운영 단축 명령을 실행합니다. Admin에서는 `diff`, `mcp` 등 운영 명령만 사용하고 Codex 대화형 shortcut은 차단됩니다. |

### Session 전용 또는 Session 중심 명령

| 명령어 | 설명 |
| --- | --- |
| `/codex prompt:<요청>` | Codex에게 자연어 요청을 보냅니다. |
| `/review prompt:<관점>` | `codex exec review`로 현재 변경사항을 리뷰시킵니다. |
| `/fix-tests` | 테스트 실행, 실패 분석, 수정, 재검증을 요청합니다. |
| `/summarize target:<대상>` | 현재 채널 또는 지정 대상을 요약합니다. |
| `/howtouse` | 현재 Codex 세션에 Discord 봇 사용법과 첨부 전송 형식을 안내합니다. |
| `/compact prompt:<요청>` | 대화형 `/compact` passthrough가 아니라, 현재 작업 맥락을 압축 요약하도록 Codex에 요청합니다. |
| `/skill name:<skill> prompt:<요청>` | 지정한 skill 관점으로 Codex 요청을 실행합니다. |
| `/model model:<모델>` | 이 Discord 채널의 이후 Codex 실행에 사용할 모델을 설정합니다. |
| `/archive` | 현재 세션 채널의 보관 확인 카드를 엽니다. 확정하려면 `archive confirm`을 사용합니다. |
| `/fork` | Codex 또는 Claude Code session thread에서 이름 입력 모달을 열고, 현재 agent session을 새 Discord thread로 fork합니다. |
| `/steer prompt:<지시>` | 일반 메시지와 동일하게 현재 실행 중인 Codex turn에 새 지시를 즉시 추가하는 명시적 별칭입니다. Claude Code에서는 지원 안내를 표시합니다. |
| `/interrupt` | 현재 실행 중인 Codex turn에 중단 요청을 보냅니다. Claude Code에서는 지원 안내를 표시합니다. |
| `/queue prompt:<요청>` | 현재 turn에 steering하지 않고, 작업이 끝난 뒤 실행할 다음 요청으로 FIFO 대기열에 추가합니다. prompt를 비우면 대기열 상태를 보여줍니다. |
| `/queue-clear` | 현재 실행은 유지하고 아직 시작하지 않은 대기 요청을 삭제합니다. |
| `/where` 또는 `/status` | 큐를 기다리지 않고 현재 채널의 컴퓨터, workspace, cwd, 세션, 모델과 agent 실행 상태를 보여줍니다. 실행 중이면 요청 요약, 시작 시각, 경과 시간, 마지막 활동 시각, 대기 요청 수도 표시합니다. |
| `/browse` | 현재 폴더의 파일 브라우저 UI를 엽니다. |
| `/shell command:<명령>` | 현재 cwd에서 shell 명령을 실행합니다. 일반 텍스트 shell 명령은 `!` 접두어를 사용합니다. |
| `/diff` | 현재 cwd에서 `git diff --stat`을 실행합니다. |
| `/codex-command command:<name> prompt:<args>` | `model`, `review`, `compact`, `mcp` 같은 session shortcut을 같은 라우터로 실행합니다. |
| `/schedule action:create mode:once/every/daily/weekly command:<명령> at:<시간> every:<주기> weekdays:<요일>` | 이 세션 채널에서 기존 채팅형 명령을 예약 실행합니다. |

`/fork`와 `/howtouse`는 앞에 `/`가 붙은 명령으로만 동작합니다. `fork는 잘 되는건가?`, `howtouse 내용을 바꿔줘`처럼 같은 단어가 들어간 일반 메시지는 명령으로 해석하지 않고 현재 agent에게 그대로 전달합니다.

### 채팅형 예약 명령

`/schedule`은 아래 채팅형 명령과 같은 라우터를 사용합니다. 예약 대상 `command:`에는 이미 지원되는 채팅형 명령을 넣습니다.

```text
schedule list
schedule every 10m command:shell pwd
schedule daily at 09:30 command:codex 오늘 계획 정리
schedule weekly mon,wed,fri at 09:30 command:shell pnpm test
schedule once at 2026-04-25 09:30 command:sync status
schedule delete <schedule-id>
```

```text
/schedule action:create mode:every every:10m command:shell pwd
/schedule action:create mode:daily at:09:30 command:codex 오늘 계획 정리
/schedule action:create mode:weekly weekdays:mon,wed,fri at:09:30 command:shell pnpm test
/schedule action:list
/schedule action:delete id:<schedule-id>
```

예약은 `.connect/state.json`에 저장되고 봇 재시작 후에도 유지됩니다. 봇은 기본 30초 주기로 만료된 예약을 확인합니다. `CONNECT_SCHEDULE_POLL_INTERVAL_MS`로 확인 주기를 조정할 수 있습니다.

## 세션 동기화

`sync`는 기본적으로 바로 생성하지 않고 선택 UI를 엽니다.

```text
sync
sync 10
sync select 25
/sync limit:25
```

위 명령은 최근 활성 Codex 세션 목록을 드롭다운으로 보여주고, 선택한 세션만 Discord 채널로 생성합니다.

전체 활성 세션을 즉시 동기화하려면 명시적으로 `all`을 사용합니다.

```text
sync all 25
/sync-all limit:25
```

동기화 대상은 Codex thread state에서 활성으로 확인된 앱 세션만입니다. 다음 항목은 제외됩니다.

- Codex에서 보관된 세션
- bridge에서 보관한 세션
- sub-agent 세션
- `codex exec` 또는 CLI 일회성 세션
- `session_index.jsonl`에는 있지만 thread state에서 확인되지 않는 만료/유실 세션

동기화 상태는 아래 명령으로 확인합니다.

```text
sync status
/sync-status
```

동기화된 세션 채널의 Codex transcript 반영 방식은 두 가지입니다.

```text
sync mode on-chat
sync mode realtime
/sync-mode mode:on-chat
/sync-mode mode:realtime
```

- `on-chat`: 실시간 폴링은 하지 않고, 동기화된 세션 채널에서 다시 채팅을 시작할 때 Codex 데스크탑의 최신 대화 내용을 먼저 반영합니다.
- `realtime`: 봇이 기본 약 5초 주기로 동기화된 세션을 확인해 Codex Desktop이나 IDE에서 생긴 새 대화 내용을 Discord 채널에 반영합니다.
- Desktop/IDE에서 보낸 사용자 메시지와 Codex가 외부에 공개한 commentary는 각각 별도의 새 Discord 메시지로 올라옵니다. 진행 메시지에는 operator role을 멘션하지 않습니다.
- `생각 중`, 명령 실행 상태, 파일 변경 상태 같은 내부 상태 이벤트는 보내지 않습니다. `final_answer`도 진행 피드에서는 제외하고, 기존 작업 완료 알림에서 답변과 operator role 멘션을 한 번만 보냅니다.
- Discord에서 직접 실행 중인 세션은 기존 스트리밍 메시지와 중복되지 않도록 transcript 기준점만 갱신합니다.
- `realtime`은 새 Discord 채널을 자동 생성하지 않습니다. 열려 있지 않은 Codex 세션을 Discord로 가져오려면 admin 채널에서 `sync` 또는 `/sync`를 명시적으로 실행합니다.
- 폴링 간격은 `CONNECT_TRANSCRIPT_SYNC_INTERVAL_MS`로 조정할 수 있습니다. 변화가 없거나 시스템 부하가 높으면 백그라운드 스캔은 자동으로 최대 `CONNECT_BACKGROUND_POLL_MAX_INTERVAL_MS`까지 늦춰집니다.
- `CONNECT_BACKGROUND_MAX_LOAD`는 CPU core 수로 나눈 1분 load average 기준입니다. 기본값은 `0.7`이고, `0`으로 설정하면 부하 기반 스킵을 끕니다.

처음 동기화된 채널은 과거 로그를 한꺼번에 쏟아내지 않도록 기준점만 잡고, 이후 새 transcript만 올립니다.

## 완료 알림과 세션 스레드

봇은 Codex native session log를 폴링해서 `작업 완료` 이벤트를 감지합니다. 알림 대상은 bridge 보관 목록에 들어 있지 않은 Codex 세션이며, 처음 켜졌을 때 이미 끝나 있던 작업은 과거 알림 폭주를 막기 위해 기준점만 잡고 넘어갑니다.

완료 알림은 가능한 경우 세션별 Discord 스레드로 전송됩니다. 스레드가 아직 없으면 Codex 대화방 이름을 Discord 스레드 이름 규칙에 맞게 정리해서 만들고, 설정된 operator role을 멘션해 스레드에서도 알림이 보이게 합니다. 스레드를 만들 수 없는 환경에서는 관리자 채널로 대신 보냅니다.

알림 본문에는 세션 이름, 작업 위치, 업데이트 시각, 세션 ID가 포함됩니다. Codex Desktop이나 IDE에서 시작한 작업처럼 Discord에 최종 답변이 아직 없던 작업은 완료 알림에 마지막 답변 preview를 함께 붙입니다. Discord에서 직접 보낸 Codex 요청은 이미 결과 메시지로 답변이 오기 때문에, 그 요청에 대응하는 완료 알림 한 번만 답변 preview를 생략해 같은 답변이 두 번 올라오지 않게 합니다. 같은 세션에서 이후 Desktop이나 IDE 작업이 완료되면 다시 답변 preview를 포함합니다.

같은 완료 이벤트는 `.connect/state.json`에 기록되어 중복 전송되지 않습니다. 봇은 알림을 보내기 전에 먼저 해당 완료 이벤트를 state에 예약 기록하므로, 짧은 폴링 간격이나 reload 직후에도 같은 완료 알림이 겹쳐 올라올 가능성을 줄입니다.

## Codex 진행 표시와 이미지

Codex 요청 중에는 raw 이벤트명 대신 읽기 쉬운 한국어 상태가 표시됩니다.

```text
42개 파일 · rg --files
진행: 파일 탐색 중

진행: 이미지 생성 중
진행: 컨텍스트 압축 중
진행: 답변 작성 중
```

Discord에서 직접 요청한 Codex 및 Claude Code의 최종 답변은 agent 종류와 요청 시작 위치에 관계없이 `작업 완료` 메타데이터와 `답변` embed가 있는 같은 카드 형식으로 전송됩니다. 한 메시지 제한을 넘으면 문단과 줄바꿈을 우선해 `답변 (계속)` 카드로 나눠 순서대로 전송합니다. 코드 블록은 각 분할 메시지 안에서 닫고 다음 메시지에서 다시 열며, 모든 답변 조각을 보낸 뒤에만 operator role이 포함된 완료 알림을 보냅니다.

### Discord에서 agent로 파일 보내기

Direct mode의 관리 채널이나 session thread에서 Discord 메시지에 이미지, 영상, 오디오 또는 일반 파일을 첨부하면 봇이 해당 컴퓨터의 `.connect/incoming-attachments/<message-id>/` 아래에 먼저 저장합니다. Codex/Claude Code에는 원래 파일명, MIME type, 크기, 로컬 절대경로가 prompt와 함께 전달되므로 agent가 로컬 도구로 파일을 직접 열 수 있습니다. 본문 없이 파일만 보내면 `첨부된 파일을 확인해줘.`라는 기본 요청으로 처리됩니다. main/admin 채널의 첨부 메시지는 기본적으로 Codex로 보내며, Claude Code로 보내려면 본문을 `claude <요청>`으로 시작합니다.

다운로드는 Discord CDN의 HTTPS 첨부 URL만 허용합니다. 기본 제한은 메시지당 10개, 파일당 100MiB, 메시지 전체 250MiB이며 Discord 서버 자체의 업로드 제한도 먼저 적용됩니다. 임시 파일은 기본 7일 동안 보관되고 다음 첨부 처리 시 만료 항목을 정리합니다. 다음 환경변수로 조정할 수 있습니다.

```bash
CONNECT_INCOMING_ATTACHMENT_ROOT=/absolute/path/to/incoming-attachments
CONNECT_INCOMING_ATTACHMENT_MAX_FILES=10
CONNECT_INCOMING_ATTACHMENT_MAX_BYTES=104857600
CONNECT_INCOMING_ATTACHMENT_TOTAL_MAX_BYTES=262144000
CONNECT_INCOMING_ATTACHMENT_TTL_MS=604800000
```

첨부 입력은 bot gateway와 worker가 같은 컴퓨터의 파일시스템을 보는 Direct mode에서 지원합니다. Hub mode처럼 gateway와 agent가 서로 다른 컴퓨터라면 gateway의 로컬 경로를 agent가 열 수 없으므로 현재 첨부 입력을 거부합니다. 파일 경로는 durable queue에 포함되므로 gateway만 재시작해도 대기 중 요청이 이어집니다.

Codex가 최종 답변에 `![이미지](/로컬/절대/경로.png)` 형태의 로컬 이미지 파일을 포함하면, 봇은 해당 파일을 Discord 메시지에 첨부합니다. `https://...png` 같은 원격 이미지 URL은 메시지 본문에 함께 표시되어 Discord에서 미리보기로 볼 수 있습니다.

이미지 외의 파일, 동영상, 오디오를 명시적으로 첨부하려면 Codex가 최종 답변에 아래 블록을 넣으면 됩니다. 봇은 이 제어 블록을 Discord 본문에서는 숨기고, 존재하는 로컬 파일만 첨부합니다.

````text
```codex-discord-send
{
  "message": "Discord 메시지에 같이 보여줄 문장",
  "files": [
    "/absolute/path/result.png",
    {"path": "/absolute/path/demo.mp4", "name": "demo.mp4"},
    {"path": "/absolute/path/audio.wav", "name": "audio.wav"}
  ]
}
```
````

`files`에는 절대경로 또는 `file://` URL을 넣습니다. 기본 업로드 안전 한도는 파일당 10MiB(Discord 표기 10MB)이며, 한 메시지에 최대 10개 파일을 첨부합니다. 더 큰 파일은 여러 파일로 쪼개거나, 압축/리사이즈/인코딩 옵션 조정으로 용량을 낮춘 뒤 첨부해야 합니다. 세션 채널에서 `/howtouse`를 실행하면 이 형식이 현재 Codex 세션에 직접 전달됩니다. `.mp3`, `.wav`, `.m4a` 같은 오디오 파일도 같은 방식으로 첨부됩니다.

동기화된 세션 채널에서 Discord로 보낸 요청은 항상 같은 Codex 세션에 `resume`되므로, Codex Desktop 쪽에서도 같은 세션 안에서 새 사용자 요청과 처리 과정이 이어집니다. Codex/Claude Code session thread에서는 `/fork`를 실행해 새 이름을 입력하면 기존 agent session을 분기하고, 같은 부모 채널 아래에 새 Discord thread를 만듭니다. fork 응답이 실패했거나 원본과 같은 session ID를 반환하면 연결하지 않고 임시 Discord thread를 정리하며, 이미 다른 Discord thread에 연결된 session ID의 중복 연결도 거부합니다. Codex fork는 `CODEX_DISCORD_CODEX_RUNNER=app-server` 모드에서 Codex app-server의 `thread/fork`를 사용합니다.

Codex 작업이 실행 중일 때 같은 Discord thread에 보내는 일반 메시지는 활성 app-server turn에 즉시 steering됩니다. 현재 작업을 건드리지 않고 다음 turn으로 남기려면 `/queue prompt:<요청>`을 사용합니다. app-server turn 등록 직후의 짧은 경쟁 상태는 자동으로 재시도합니다. 활성 요청이 남아 있는데도 steering이 실패하거나 지원되지 않으면 일반 메시지를 FIFO로 바꾸지 않고 Discord에 실패를 표시합니다. `/steer`는 명시적 steering 별칭으로 계속 지원하고, prompt 없는 `/queue`는 현재 실행과 대기 요청을 보여줍니다. 후속 agent 요청이 남아 있으면 중간 turn의 완료 멘션은 생략하고 큐가 모두 끝났을 때 한 번만 알립니다. 실패와 권한 요청은 즉시 멘션합니다. Claude Code headless 실행은 live steering을 지원하지 않으므로 작업 중 일반 메시지와 `/queue prompt:<요청>`이 모두 다음 turn으로 대기합니다. Direct mode의 agent 요청과 FIFO 대기열은 `.connect/discord-queue`와 `.connect/worker`에 기록되므로 bot 재시작 후에도 유지됩니다.

`/status`와 `where`도 대기열을 우회하므로 긴 작업 도중 즉시 조회할 수 있습니다. `Agent state`가 `running`이면 Discord에서 시작한 요청이 아직 반환되지 않은 상태이고, `waiting-for-approval`이면 권한 선택을 기다리는 상태입니다. `Last activity`가 오래되었다면 모델 응답이나 외부 명령을 기다리는 중인지 진행 메시지와 시스템 상태를 함께 확인하세요.

Codex와 Claude Code thread에서는 agent가 직접 작성한 중간 설명만 별도 메시지로 전송하되 role을 mention하지 않습니다. 명령 실행, 파일 수정, 검색, `item.started`, `생각 중`, `답변 작성 중` 같은 상태 이벤트는 진행 피드에 게시하지 않습니다. 마지막 agent 메시지는 최종 답변으로 간주해 중간 피드에서 제외하며, 동일 문구를 제거하고 작업당 최대 40개까지 보냅니다. 작업이 끝나면 처음의 진행 카드는 완료 상태로 닫고, 최종 답변은 마지막 진행 메시지 아래에 새 메시지로 게시한 뒤 operator role을 mention합니다. 응답의 `finalMessage`가 비어 있으면 마지막 공개 agent 메시지를 최종 답변으로 복구합니다. 새 요청 직전 transcript 동기화는 기준점만 갱신하고 이전 대화를 다시 게시하지 않습니다.

## Codex 권한 요청 처리

Direct mode는 별도 설정이 없으면 Codex app-server runner를 사용합니다. 호환성 때문에 예전 `codex exec` 방식이 꼭 필요할 때만 `CODEX_DISCORD_CODEX_RUNNER=exec`를 명시하세요. app-server runner는 Discord에서 실행하는 작업을 로컬/서버 자동화 용도로 쓰기 위해 기본적으로 아래 권한 설정으로 실행됩니다.

```text
approval=never, reviewer=user, sandbox=danger-full-access, network=enabled
```

권한은 환경변수로 조정할 수 있습니다.

```bash
CODEX_DISCORD_CODEX_APPROVAL_POLICY=on-request
CODEX_DISCORD_CODEX_SANDBOX=workspace-write
```

`CODEX_DISCORD_CODEX_SANDBOX` 값은 `read-only`, `workspace-write`, `danger-full-access` 중 하나입니다. `danger-full-access`는 Codex의 OS sandbox를 풀기 때문에 신뢰하는 private Discord 서버와 신뢰하는 머신에서만 사용하세요. 더 좁은 권한이 필요하면 위 환경변수로 `workspace-write`나 `read-only`로 낮출 수 있습니다. `codex exec` runner에서는 `CODEX_DISCORD_CODEX_BYPASS_APPROVALS_AND_SANDBOX=1`도 지원하지만, app-server runner를 쓰는 일반 Mac 설정에서는 `danger-full-access`를 사용합니다.

작업 중 Codex가 sandbox 밖 파일 변경, 명령 실행, 파일 패치, 추가 권한을 요청하면 봇이 같은 Discord 채널에 권한 요청 메시지를 보냅니다. operator role이 있는 사용자는 버튼으로 아래 선택을 할 수 있습니다.

- `허용`: 이번 요청만 허용합니다.
- `세션 동안 허용`: 같은 Codex 세션에서 같은 종류의 요청을 계속 허용합니다.
- `거절`: 요청을 거절하고 Codex에 거절 결과를 전달합니다.
- `취소`: 현재 권한 요청을 취소합니다.

권한 요청은 해당 Codex 작업이 진행 중인 채널에서만 유효합니다. 오래된 버튼이나 다른 채널에서 온 응답은 무시되며, 찾을 수 없는 요청이라는 안내를 보냅니다.

## 보관과 삭제

로컬 Codex 세션 파일을 삭제하지 않고 Discord mapping에서만 제외하려면 보관을 사용합니다.

```text
archive confirm
sync archive <session-id> confirm
/sync-archive session_id:<session-id> confirm:true
```

동기화로 생성된 Discord 채널을 삭제하려면 먼저 미리보기를 확인합니다.

```text
sync delete preview
sync delete session <session-id>
sync delete session <session-id> confirm
sync delete channels confirm
sync delete all confirm
/sync-delete mode:preview
/sync-delete mode:session session_id:<session-id> confirm:true
```

`sync delete session <session-id> confirm`은 해당 세션의 Discord 채널과 mapping만 삭제하고, 나중에 다시 `sync`하면 다시 가져올 수 있습니다. `sync archive <session-id> confirm`은 세션을 보관 목록에 넣어 다음 sync에서도 제외합니다. `sync delete channels confirm`은 텍스트 채널만 삭제합니다. `sync delete all confirm`은 텍스트 채널과 카테고리를 삭제하고 `.connect/state.json`의 동기화 상태를 정리합니다. 로컬 Codex 세션 파일은 삭제하지 않습니다.

## 파일 브라우저와 작업 버튼

`ls` 또는 `/browse` 결과에는 Discord UI가 붙습니다.

- `상위 폴더`: 현재 cwd를 상위 폴더로 이동합니다.
- `새로고침`: 현재 폴더 목록을 다시 불러옵니다.
- `여기서 새 채팅`: 현재 브라우저 위치에서 새 Codex 채팅 모달을 엽니다.
- `하위 항목으로 이동`: 드롭다운에서 폴더를 선택해 이동합니다.
- `파일 보기`: 드롭다운에서 파일을 선택해 미리봅니다.
- `Codex에게 요청`: session 채널에서만 표시되며, 모달을 열어 현재 컨텍스트로 Codex에게 요청합니다.

Git과 테스트 결과에도 작업 버튼이 붙습니다.

- Admin 채널의 `git status --short`: Diff 보기, 테스트 실행 버튼 제공
- Session 채널의 `git status --short`: Diff 보기, Codex 리뷰, 테스트 실행 버튼 제공
- Admin 채널의 `pnpm test`: 테스트 다시 실행 버튼 제공
- Session 채널의 `pnpm test`: 테스트 다시 실행, 실패 시 Codex에게 수정 요청 버튼 제공
- `유지보수` 패널: Git 상태, Diff 보기, 충돌 점검, 테스트 실행, 봇 재시작 또는 Codex 리뷰/수정 버튼을 한곳에 모읍니다.

## Discord에서 봇 자체 유지보수

관리자 채널에서 `help`를 누른 뒤 `유지보수` 패널을 엽니다.

```text
유지보수 → 봇 개발 채팅 → Codex에게 수정 요청 → 타입체크 → 테스트 실행 → 명령어 재등록 또는 봇 재시작
```

- `봇 개발 채팅`: 현재 workspace에서 이 봇 유지보수용 Codex 세션 채널을 만듭니다.
- `타입체크`: `pnpm typecheck`를 실행합니다.
- `테스트 실행`: `pnpm test`를 실행합니다.
- `명령어 재등록`: 코드 변경 없이 slash command만 다시 등록합니다.
- `봇 재시작`: 새 작업 유입을 막고 실행 중 작업과 대기열이 끝난 뒤 봇 프로세스를 재시작합니다. `cdc start` 또는 `pnpm connect start`로 실행 중일 때 사용하세요.

## 봇 업데이트

Discord에서 봇 명령어를 다시 등록할 수 있습니다.

```text
reload
/reload mode:commands
```

새 코드까지 반영하려면 봇 재시작을 요청합니다.

```text
reload restart confirm
/reload mode:restart confirm:true
```

기본 재시작은 다른 채널의 활성 작업과 대기열이 모두 끝날 때까지 자동으로 보류되며, 보류 중에는 권한 응답과 `/status`, `/queue`, `/interrupt` 같은 제어 명령만 받습니다. 즉시 bot 코드를 다시 읽어야 한다면 아래 강제 명령을 사용합니다. 분리된 Direct worker는 어느 방식이든 종료되지 않으므로 실행 중 작업은 계속되고, 새 bot이 재연결합니다.

```text
reload restart force confirm
/reload mode:restart force:true confirm:true
```

bot 전용 systemd/LaunchAgent만 재시작하는 것은 실행 worker에 영향을 주지 않습니다. worker service는 `SIGTERM`을 받으면 새 job을 시작하지 않고 활성 job이 끝날 때까지 drain한 뒤 종료합니다. `SIGKILL`, 서버 재부팅, worker service의 강제 종료는 실행 중인 Codex/Claude와 하위 프로세스를 중단합니다.

자동 재시작은 `cdc start --direct`, `cdc start --hub`, `pnpm connect start --direct`, `pnpm connect start --hub`로 실행 중일 때 동작합니다. 운영 환경에서는 `--component bot`과 `--component worker`를 별도 서비스로 실행하는 구성을 권장합니다. `pnpm dev:bot`로 직접 실행 중이면 프로세스가 종료되므로 터미널에서 다시 시작해야 합니다.

## 안전 정책

- 허용된 Discord role을 가진 사용자만 명령을 실행할 수 있습니다.
- 각 Discord 채널은 독립적인 cwd를 가집니다.
- `cd`는 해당 채널의 cwd만 변경합니다.
- Local Agent는 OS sandbox가 아니므로 명령은 로컬 사용자 권한으로 실행됩니다.
- Direct mode가 기본 권장 구성입니다. Hub mode는 다중 컴퓨터 실험 기능이며 네트워크 공격면이 더 넓습니다.
- 절대 경로, 상위 경로 이동, shell escape, 위험 명령은 확인이 필요합니다.
- 보관과 Discord 채널 삭제는 로컬 Codex 세션 파일을 삭제하지 않습니다.
- `.env`, `.connect/` 전체, 로그, 로컬 DB, Codex 세션 파일은 커밋하거나 npm 패키지에 포함하지 마세요.
- Discord bot token이 노출되면 Discord Developer Portal에서 즉시 token을 재발급하고 봇을 재시작하세요.
- 공개 Discord 서버나 신뢰하지 않는 role에는 연결하지 마세요. 이 도구는 private server와 제한된 운영자 role을 전제로 합니다.
- 같은 bot token을 여러 머신에서 실행할 때는 머신별 Discord 채널 ID를 겹치지 않게 설정하세요. 같은 채널을 두 인스턴스가 맡으면 중복 실행이 생길 수 있습니다.

## 기여와 라이선스

기여 가이드는 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요. 이 프로젝트는 [MIT License](LICENSE)로 배포됩니다. 기여를 제출하면 해당 기여도 MIT License로 제공하는 데 동의한 것으로 간주합니다.

## npm 공개 전 점검

배포 전에 아래 명령으로 테스트, 타입체크, 패키지 포함 파일을 확인합니다.

```bash
pnpm test
pnpm typecheck
npm pack --dry-run
```

`npm pack --dry-run` 출력에 아래 항목이 포함되지 않아야 합니다.

- `.env`
- `.connect/`
- `*.sqlite`, `*.log`
- Discord token 또는 guild/channel/role secret이 들어 있는 파일
- Codex transcript/session 원본 파일

취약점 제보와 운영 보안 모델은 [SECURITY.md](SECURITY.md)를 참고하세요.

## 프로젝트 구성

```text
apps/
  connect-cli/      설치, 설정, 실행 CLI
  control-api/      hub mode용 Control API
  discord-bot/      Discord bot, slash command, 버튼/드롭다운 처리
  local-agent/      hub mode agent와 direct mode durable worker
packages/
  codex-adapter/    Codex session index/thread state/transcript parser
  core/             command policy, domain model
docs/
  operator-guide.md 운영자용 세부 가이드
```

상태 파일은 주로 아래 위치에 저장됩니다.

- `.connect/config.json`: 연결 설정
- `.connect/state.json`: direct mode 동기화 상태
- `.connect/discord-queue`: Discord agent 요청과 FIFO 복구 정보
- `.connect/worker`: 실행 요청, 진행 이벤트, 승인, 결과를 보관하는 worker spool
- `.env`: 실행 환경 변수
- `$HOME/.codex`: Codex native 세션, thread state, transcript

## 개발 명령

소스에서 개발할 때는 pnpm workspace 명령을 사용합니다.

```bash
pnpm install
pnpm connect install --direct
pnpm connect start --direct
```

운영 서비스는 bot과 worker를 따로 실행할 수 있습니다.

```bash
pnpm connect start --direct --component worker
pnpm connect start --direct --component bot
```

```bash
pnpm test
pnpm typecheck
pnpm test:watch
```

개별 프로세스 실행:

```bash
pnpm dev:control
pnpm dev:agent
pnpm dev:bot
```

Prisma를 사용하는 hub mode DB 작업:

```bash
DATABASE_URL="file:./dev.sqlite" pnpm prisma db push
pnpm prisma:generate
pnpm prisma:migrate
```

## 문제 해결

### Slash command가 Discord에 보이지 않음

관리자 채널에서 명령어를 다시 등록합니다.

```text
reload
```

그래도 보이지 않으면 봇을 재시작합니다.

```text
reload restart confirm
```

### `sync`에 원하지 않는 세션이 보임

`sync`는 thread state에서 활성으로 확인된 앱 세션만 가져옵니다. 이미 Discord에 만들어진 오래된 채널은 아래 순서로 정리할 수 있습니다.

```text
sync delete preview
sync delete session <session-id> confirm
sync delete channels confirm
sync
```

### 현재 채널이 어디에 연결됐는지 모르겠음

```text
where
/where
```

### 작업 중인 봇 버전이 최신인지 모르겠음

```text
reload restart confirm
```

이 명령은 실행 중 작업이 있으면 완료될 때까지 기다립니다. 즉시 중단하고 재시작하려면 `reload restart force confirm`을 사용합니다.

## 참고 문서

- [Operator Guide](docs/operator-guide.md)
- [Mac Direct Mode Setup](docs/mac-direct-setup.md)
- [Ubuntu Server Direct Mode Setup](docs/ubuntu-server-direct-setup.ko.md)
