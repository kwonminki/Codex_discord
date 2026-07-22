# Codex Discord Connector

한국어 | [English](README.en.md)

Mac이나 Ubuntu 서버에서 실행되는 **Codex와 Claude Code를 Discord 스레드로 사용하는 개인용 브리지**입니다.

Discord에서 평소처럼 메시지를 보내면 agent가 해당 컴퓨터에서 작업하고, 중간 진행과 최종 답변을 Discord로 돌려줍니다. 이미지, 영상, 오디오, 일반 파일도 양방향으로 주고받을 수 있습니다.

> 이 봇은 연결된 컴퓨터에서 파일을 수정하고 명령을 실행할 수 있습니다. 신뢰하는 개인 Discord 서버와 본인이 관리하는 컴퓨터에서만 사용하세요.

## 설치는 AI 에이전트에게 맡기세요

사람이 긴 설치 문서를 따라갈 필요는 없습니다. 설치하려는 Mac 또는 Ubuntu 서버의 Codex/Claude Code 같은 AI 에이전트에게 아래 내용을 보내세요.

```text
https://github.com/kwonminki/Codex_discord

이 저장소를 clone하고 docs/AI_AGENT_GUIDE.md를 먼저 전부 읽어줘.
현재 코드와 내 OS 환경을 확인한 뒤 Direct mode로 설치해줘.
Codex runner는 app-server를 사용하고, Discord bot과 worker는 서로 분리된
LaunchAgent 또는 systemd 서비스로 등록해줘.
기존 실행 작업이 있다면 먼저 확인하고 안전하게 배포해줘.
내가 사용하는 언어에 맞춰 connector UI 언어도 네가 알아서 설정해줘.
설치 후 pnpm typecheck와 pnpm test를 실행하고 Discord ready 로그까지 확인해줘.
첫 설치라면 private Discord 서버 생성, application/bot 생성, 서버 초대를
한 단계씩 안내하고 내가 완료할 때마다 다음 단계로 진행해줘.
bot이 서버에 들어온 뒤에는 역할, category, Codex/Claude 채널, 권한,
slash command와 선택적인 release webhook을 네가 API로 구성해줘.
API로 확인할 수 없는 token과 값만 나에게 하나씩 물어봐.
```

AI 에이전트가 읽어야 할 전체 설치·구조·운영 문서는 [AI Agent Guide](docs/AI_AGENT_GUIDE.md)입니다.

## 언어는 자동으로 맞춰집니다

설치를 맡은 AI 에이전트가 현재 대화 언어를 보고 connector UI를 같은 언어로 설정합니다. 사용자가 언어 코드, 환경 변수, 설정 파일을 알거나 직접 고를 필요는 없습니다.

- Connector UI는 한국어, 영어, 중국어(간체), 일본어를 지원합니다.
- 사용자용 README는 한국어와 영어 두 개만 유지합니다.
- 다른 언어가 필요하면 설치 에이전트가 번역 부분만 추가하고 검증한 뒤 설치합니다.
- 버튼, 모달, 상태 문구, slash command 설명과 `/howtouse`가 해당 언어로 표시됩니다.
- 사용자 메시지와 agent가 작성한 답변 원문은 임의로 번역하지 않습니다.

언어 구현과 확장 절차는 사용자 대신 설치 에이전트가 [Localization Guide](docs/localization.md)를 읽고 처리합니다.

## 사용자가 준비할 것

### 1. 개인 Discord 서버

공개 서버보다는 본인만 사용하는 private 서버를 권장합니다. 서버 자체 생성과 bot application의 서버 초대는 사용자가 해야 합니다. bot이 초대된 뒤에는 설치 에이전트가 컴퓨터별 채널을 만들 수 있습니다.

```text
#mac-codex
#mac-claude-code       선택
#gpu-server-codex
#gpu-server-claude     선택
```

- **Codex 채널**: 관리자 채널이자 새 Codex 세션을 만드는 부모 채널입니다.
- **Claude Code 채널**: Claude Code를 사용할 때만 만듭니다.
- 같은 bot token을 여러 컴퓨터에서 사용할 수 있지만, 컴퓨터별 채널 ID는 절대 겹치면 안 됩니다.

### 2. Operator 역할

서버 설정에서 `Codex Operator` 같은 역할이 필요합니다. bot에 `Manage Roles` 권한이 있으면 설치 에이전트가 역할을 만들고 본인에게 부여할 수 있습니다. 권한이 없으면 사용자가 직접 만드세요. 봇은 이 역할이 있는 사용자만 요청을 실행하며, 권한 질문과 작업 완료 시 이 역할을 멘션합니다.

Discord 채널 알림은 **멘션만(Only @mentions)** 으로 설정하는 것을 권장합니다. 중간 진행은 조용히 쌓이고, 질문·권한 요청·완료·실패만 알림이 옵니다.

### 3. ID 복사

첫 자동 설치에서는 에이전트가 Discord API 응답에서 Server/Role/Channel ID를 얻어 설정합니다. 기존 Discord 구조를 재사용하거나 bot의 관리 권한이 부족할 때만 `사용자 설정 > 고급 > 개발자 모드`를 켠 뒤 다음 값을 복사해 설치 에이전트에게 알려주세요.

| 값 | 복사하는 곳 |
| --- | --- |
| Server/Guild ID | 서버 아이콘 우클릭 → `서버 ID 복사` |
| Operator Role ID | 서버 설정 → 역할 → 역할 메뉴 → `역할 ID 복사` |
| Codex Channel ID | Codex 채널 우클릭 → `채널 ID 복사` |
| Claude Channel ID | Claude 채널 우클릭 → `채널 ID 복사` |

최초 설치에는 Discord Bot Token도 한 번 필요합니다. token은 비밀번호와 같으므로 Discord나 GitHub에 올리지 말고, 설치 중인 로컬 AI 에이전트에만 전달하세요. Public Key와 OAuth2 Client ID는 connector 설정에 넣지 않습니다.

### 에이전트가 자동화할 수 있는 범위

기존 Discord 서버에 bot이 이미 설치되어 있고 필요한 권한이 있다면 설치 에이전트가 Discord API로 다음 작업을 대신할 수 있습니다.

- 카테고리, 텍스트 채널, 세션 스레드 생성과 이름 변경
- `Codex Operator` 같은 역할 생성과 채널별 permission 설정
- 공지용 incoming webhook 생성
- slash command 등록, connector 설정 파일과 서비스 구성

다음 작업은 사용자 계정의 로그인과 명시적 승인이 필요하므로 완전 자동 설치 대상으로 보지 않습니다.

- 새 Discord 서버 만들기
- Discord Developer Portal에서 새 application과 bot user 만들기
- OAuth2로 bot을 서버에 초대하고 권한 승인하기
- Discord/GitHub 로그인, 2단계 인증, CAPTCHA
- 개인 Discord 알림 설정을 **멘션만(Only @mentions)** 으로 변경하기

에이전트가 로그인된 브라우저 화면을 도와 조작할 수는 있어도 계정 인증과 최종 승인은 사용자가 직접 해야 합니다. 서버와 bot application을 한 번 준비한 뒤에는 채널, 역할, webhook, 로컬 서비스 설치의 대부분을 자동화할 수 있습니다.

## 평소 사용법

### 그냥 대화하기

생성된 Codex 또는 Claude Code 스레드에 자연어로 메시지를 보내면 됩니다.

```text
현재 코드 구조를 확인하고 로그인 오류를 고쳐줘.
테스트까지 실행한 뒤 결과를 알려줘.
이 영상에서 문제가 생기는 구간을 찾아줘.
```

작업이 끝나면 최종 답변과 `Codex Operator` 멘션이 옵니다. Codex가 중간에 선택을 물으면 같은 스레드에 번호나 문장으로 답하면 현재 작업이 그대로 이어집니다.

### 새 채팅 만들기: `/chat-new`

Codex 부모 채널 또는 Claude Code 부모 채널에서 `/chat-new`를 실행하세요. 이름과 작업 폴더를 지정하면 새 Discord 스레드와 새 agent 세션이 만들어집니다.

```text
/chat-new name:로그인 버그 수정
```

기존 대화 맥락을 복제해 다른 방향으로 작업하려면 기존 세션 스레드에서 `/fork`를 사용합니다.

### 실행 중 지시 바꾸기: 일반 메시지 또는 `/steer`

Codex가 작업 중일 때 같은 스레드에 보내는 **일반 메시지는 현재 turn에 즉시 steering**됩니다.

```text
방금 접근은 멈추고 API 계층만 수정해줘.
```

명시적으로 쓰고 싶다면 다음 명령도 같습니다.

```text
/steer prompt:API 계층만 수정해줘
```

Claude Code의 현재 headless 실행은 live steering을 지원하지 않습니다. Claude 작업 중 보낸 메시지는 다음 작업으로 대기합니다.

### 다음 작업 예약하기: `/queue`

현재 작업에 끼어들지 않고 **끝난 다음 별도 turn으로 실행**하려면 `/queue prompt:`를 사용하세요.

```text
/queue prompt:현재 수정이 끝나면 전체 테스트도 실행해줘
```

`/queue`는 현재 대기열을 보여주고, `/queue-clear`는 아직 시작하지 않은 요청을 지웁니다.

### 모델과 생각 강도 설정

각 컴퓨터의 **Codex 부모 채널**과 **Claude Code 부모 채널**에서 기본값을 정할 수 있습니다. 이 값은 `.connect/state.json`에 저장되어 봇을 재시작해도 유지되며, 별도 설정이 없는 모든 세션 스레드가 상속합니다.

```text
/model model:gpt-5.6-sol
/effort level:xhigh
/settings
```

Claude Code 부모 채널에서는 같은 명령이 Claude 설정으로 적용됩니다. Claude의 최고 effort는 `max`, Codex의 최고 reasoning effort는 `xhigh`입니다. Codex 채널에서 `max`를 선택하면 `xhigh`로 정규화됩니다.

각 세션 스레드에서도 `/model`과 `/effort`로 그 스레드만 override할 수 있습니다. 다시 부모 채널 기본값을 따르려면 다음처럼 설정하세요.

```text
/model model:default
/effort level:default
```

`/settings`는 설정만 간단히 보여주고, `/status`는 모델·effort와 값의 출처(`main default`, `thread override`, `CLI default`)를 실행 상태와 함께 보여줍니다. 모델을 `default`로 두면 connector가 모델명을 강제하지 않고 해당 컴퓨터의 Codex 또는 Claude CLI 기본 모델을 사용합니다.

### 자주 쓰는 명령

| 명령 | 용도 |
| --- | --- |
| `/chat-new` | 새 Discord 스레드와 agent 세션 만들기 |
| `/status` | 실행 상태, 큐, 현재 모델·effort와 설정 출처 확인 |
| `/settings` | 현재 적용되는 모델·effort 확인 |
| `/model model:<이름>` | main 기본 모델 또는 현재 스레드 모델 설정; `default`는 상속 복귀 |
| `/effort level:<단계>` | main 기본 effort 또는 현재 스레드 effort 설정; `default`는 상속 복귀 |
| `/steer prompt:<지시>` | 실행 중인 Codex 작업에 즉시 지시 추가 |
| `/queue prompt:<요청>` | 현재 작업 다음에 별도 요청 예약 |
| `/interrupt` | 현재 Codex turn 중단 |
| `/fork` | 현재 세션 맥락을 복제해 새 스레드 만들기 |
| `/howtouse` | agent에게 Discord 파일 송수신과 사용자 질문 기능 알려주기 |
| `/where` | 현재 채널의 컴퓨터, 폴더, session ID 확인 |

## 파일 보내고 받기

### Discord에서 agent에게

사용자는 별도 형식을 외울 필요가 없습니다. 메시지에 이미지, 영상, 오디오, 문서 또는 압축 파일을 그냥 첨부하고 원하는 작업을 적으세요. 봇이 해당 컴퓨터에 임시 저장하고 agent에게 로컬 경로를 전달합니다.

- 기본 입력 제한: 메시지당 10개, 파일당 100MiB, 전체 250MiB
- Discord 서버 자체 업로드 제한이 더 작으면 그 제한이 먼저 적용됩니다.
- 첨부만 보내면 agent에게 파일을 확인하라는 기본 요청이 전달됩니다.

### Agent에서 Discord로

세션에서 한 번 `/howtouse`를 실행하면 agent가 결과 파일을 Discord에 첨부하는 형식을 알게 됩니다. 이후에는 이렇게 요청하면 됩니다.

```text
결과 영상과 로그 파일을 Discord에 첨부해서 보내줘.
```

- 이미지, MP4, 오디오, 로그, 일반 파일 전송 지원
- 기본 출력 안전 한도: 파일당 10MiB
- 파일이 많으면 답변 뒤에 파일 전용 메시지 여러 개로 자동 분할 전송
- 큰 파일은 agent에게 압축, 리사이즈, 재인코딩 또는 분할을 요청하세요.
- 최종 답변의 `답변 복사` 버튼은 짧은 답변을 복사용 창으로 열고, 긴 답변은 원문 텍스트 파일로 제공합니다.

## 미디어 설문

세션에서 `/howtouse`를 한 번 실행한 뒤 `결과 영상을 보내고 어떤 버전이 좋은지 선택하게 해줘`처럼 요청하세요. Agent가 만든 이미지·영상·오디오와 단일 또는 복수 선택 메뉴가 같은 설문 메시지에 표시됩니다.

- 최종 설문: Codex와 Claude Code 모두 지원하며, 선택 결과는 같은 세션의 다음 turn으로 안전하게 queue됩니다.
- 중간 질문: Codex app-server가 작업 중 `request_user_input`을 호출할 때 지원하며, 선택 결과가 현재 실행 중인 turn으로 즉시 돌아갑니다.
- 사용자는 선택 메뉴 대신 일반 Discord 메시지로 번호, 선택지 이름 또는 직접 작성한 답변을 보낼 수도 있습니다.
- 설문 선택에도 기존 Operator role 권한 검사가 적용됩니다.
- Agent가 답변 끝에서 선택을 요청하면 설문 메시지 자체가 Operator role을 멘션합니다. 이때 별도의 완료 멘션은 중복 전송하지 않습니다.

## 현재 가능한 것

- Discord에서 Codex와 Claude Code 세션 생성·재개·fork
- 긴 작업의 중간 설명, 최종 답변, 완료/실패 알림
- Codex 권한 승인 버튼과 사용자 선택 질문
- 이미지·영상·오디오와 단일/복수 선택지를 함께 표시하는 미디어 설문
- 최종 설문 선택을 같은 agent 세션의 다음 turn으로 전달
- Codex 작업 중 미디어 질문 선택을 실행 중인 `request_user_input` turn으로 즉시 반환
- 실행 중 Codex steering, interrupt, FIFO queue
- Discord 첨부파일을 agent가 직접 열기
- Agent가 만든 이미지·영상·오디오·일반 파일을 Discord로 전송
- Codex Desktop/IDE 세션 동기화와 완료 알림
- 여러 Mac/Ubuntu 서버를 같은 Discord bot으로 운영
- bot만 재시작한 뒤 실행 중 worker job에 다시 연결

## 꼭 알아둘 점

### IDE와 Discord에서 같은 세션을 동시에 실행하지 마세요

Codex Desktop, VS Code, Antigravity 같은 IDE에서 이미 같은 세션이 작업 중이라면 Discord에서 동시에 새 작업을 시작하지 않는 것이 안전합니다. 반대 방향도 같습니다.

- 같은 session ID에 두 turn이 겹치면 메시지 순서, 화면 갱신, 최종 답변 위치가 혼동될 수 있습니다.
- 한쪽 작업이 끝난 뒤 다른 쪽에서 이어가세요.
- 병렬 작업이 필요하면 `/fork` 또는 `/chat-new`로 세션을 분리하세요.
- Discord에서 진행한 내용이 이미 열린 IDE 화면에 즉시 나타난다는 보장은 없습니다. 세션을 다시 열거나 새로고침해야 보일 수 있습니다.

### 일반 메시지는 실행 중 Codex에 바로 들어갑니다

작업 중 보낸 말은 새로운 작업이 아니라 steering입니다. 다음 작업으로 남기고 싶다면 반드시 `/queue prompt:`를 사용하세요.

### 서비스 종료 범위가 다릅니다

- **Discord bot만 재시작**: 실행 중인 Codex/Claude 작업은 worker에서 계속됩니다.
- **worker 강제 종료 또는 컴퓨터 재부팅**: 실행 중인 agent와 그 하위 프로세스가 중단될 수 있습니다.
- 정상 worker 재시작은 활성 작업이 끝날 때까지 drain하도록 구성하는 것이 권장됩니다.

### 여러 컴퓨터에서는 채널을 분리하세요

같은 Discord bot token을 여러 서버에서 함께 사용해도 됩니다. 각 인스턴스가 담당하는 Codex/Claude 채널 ID만 서로 다르게 설정하세요. 같은 채널을 두 인스턴스에 연결하면 중복 실행과 interaction 경합이 생길 수 있습니다.

## 버전 업데이트 공지

이 저장소는 서버 봇이 GitHub를 polling하지 않습니다. 대신 `master`에 push가 발생할 때 GitHub Actions가 커밋을 확인하고, **첫 줄이 버전으로 시작하는 커밋만** 지정된 Discord 채널에 한 번 공지합니다. 여러 컴퓨터에서 같은 봇을 실행해도 공지는 GitHub에서 직접 전송되므로 중복되지 않습니다.

이 기능은 connector 실행에 필수는 아니며 **컴퓨터가 아니라 GitHub 저장소마다 한 번만** 설정합니다. 저장소를 단순히 clone해서 기존 upstream의 업데이트를 받는 사용자는 아무것도 설정할 필요가 없습니다. 자신의 fork나 별도 저장소에서 버전 공지를 운영할 때만 아래 설정이 필요합니다. Webhook URL은 코드나 로컬 `.env`에 들어가지 않고 해당 GitHub 저장소의 Actions secret에만 저장됩니다.

### 설치 에이전트에게 맡기기

다음 조건이 갖춰지면 Codex나 Claude Code 같은 설치 에이전트가 webhook 생성부터 GitHub secret 등록까지 처리할 수 있습니다.

- 기존 Discord 서버, 공지를 받을 텍스트 채널, 서버에 설치된 Discord bot
- 공지 채널에서 bot의 **웹후크 관리(Manage Webhooks)** 권한
- 공지 채널 ID와 기존 `DISCORD_BOT_TOKEN`
- 대상 GitHub 저장소에 secret을 등록할 수 있는 권한
- GitHub CLI를 사용할 경우 `gh auth login`이 끝난 환경

설치 에이전트에게 아래처럼 요청하세요.

```text
이 저장소의 GitHub Actions 버전 공지를 설정해줘.
대상 저장소: OWNER/REPOSITORY
Discord 공지 채널 ID: CHANNEL_ID

현재 connector의 DISCORD_BOT_TOKEN을 사용하되 절대 출력하지 말고,
bot의 Manage Webhooks 권한을 확인한 다음 "Codex Releases" webhook을 만들어줘.
생성한 webhook URL은 파일이나 .env에 저장하지 말고 GitHub repository Actions secret
DISCORD_RELEASE_WEBHOOK_URL로만 등록해줘. GitHub 인증이 필요하면 내가 직접 로그인하게 요청해줘.
같은 이름의 webhook이 이미 있으면 중복 생성하지 말고 먼저 확인해줘.
마지막에는 secret 이름과 workflow 존재 여부만 확인하고 URL/token 값은 보여주지 마.
```

사람이 해야 하는 일은 Discord/GitHub 로그인, 필요한 2단계 인증, bot 권한 부여뿐입니다. 에이전트가 GitHub 저장소 권한이나 Discord의 `Manage Webhooks` 권한을 갖지 못했다면 아래 수동 절차를 사용하세요.

### 직접 설정하기

1. 공지를 받을 Discord 채널의 `채널 편집 > 연동 > 웹후크`에서 webhook을 하나 만듭니다.
2. GitHub 저장소의 `Settings > Secrets and variables > Actions`에 `DISCORD_RELEASE_WEBHOOK_URL`이라는 repository secret으로 webhook URL을 등록합니다.
3. 버전 커밋의 첫 줄을 아래 형식으로 작성합니다. 커밋 본문은 Discord의 변경 내용으로 그대로 표시됩니다.

```text
v1.0: 첫 공개 버전

- 버전 업데이트 자동 공지
- 여러 서버를 사용해도 공지는 한 번만 전송
```

`v1.0`, `v1.2.3: 제목`, `v2.0-beta.1 Release candidate` 형식을 지원합니다. 일반 커밋은 workflow가 실행되더라도 Discord 메시지를 보내지 않습니다. 한 저장소에는 공지용 secret을 하나만 두는 것을 권장합니다. 여러 fork가 각각 같은 Discord webhook을 등록하면 각 fork의 버전 push마다 별도 공지가 전송될 수 있습니다. Webhook URL은 비밀번호처럼 취급하고 코드, `.env`, 로그에 넣지 마세요.

## 실행 권한

기본 Direct mode는 개인 자동화 용도로 Codex를 넓은 권한으로 실행합니다.

```text
approval=never
sandbox=danger-full-access
network=enabled
```

Claude Code도 기본적으로 `bypassPermissions`를 사용합니다. Agent effort 기본값은 Codex `xhigh`, Claude Code `max`이며, 모델 기본값은 각 CLI 설정을 따릅니다. Discord main 채널의 `/model`과 `/effort`로 컴퓨터별 기본값을 명시할 수 있습니다. 따라서 private Discord와 제한된 Operator 역할이 매우 중요합니다.

권한을 낮추고 싶다면 설치를 맡은 AI 에이전트에게 아래처럼 요청하세요.

```text
Codex 권한을 approval=on-request, sandbox=workspace-write로 낮추고
Discord 권한 승인 버튼이 동작하는지 테스트해줘.
```

OS 권한, macOS 개인정보 보호 설정, Linux 사용자 권한, `sudo`, 컨테이너 GPU 노출은 connector가 우회하지 않습니다.

## 자세한 문서

- [AI Agent Guide: 설치, Discord bot 생성, 코드 구조, 서비스, 운영, 디버깅](docs/AI_AGENT_GUIDE.md)
- [Localization Guide: 영어 설치와 새 언어 추가](docs/localization.md)
- [Mac Direct Mode](docs/mac-direct-setup.md)
- [Ubuntu Server Direct Mode](docs/ubuntu-server-direct-setup.ko.md)
- [Operator Guide](docs/operator-guide.md)
- [Security Policy](SECURITY.md)

MIT License.
