# Codex Discord Connector

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
설치 후 pnpm typecheck와 pnpm test를 실행하고 Discord ready 로그까지 확인해줘.
필요한 Discord token과 ID는 나에게 하나씩 물어봐.
```

AI 에이전트가 읽어야 할 전체 설치·구조·운영 문서는 [AI Agent Guide](docs/AI_AGENT_GUIDE.md)입니다.

## 사용자가 준비할 것

### 1. 개인 Discord 서버

공개 서버보다는 본인만 사용하는 private 서버를 권장합니다. 컴퓨터마다 아래 채널을 만드세요.

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

서버 설정에서 `Codex Operator` 같은 역할을 만들고 본인에게 부여하세요. 봇은 이 역할이 있는 사용자만 요청을 실행하며, 권한 질문과 작업 완료 시 이 역할을 멘션합니다.

Discord 채널 알림은 **멘션만(Only @mentions)** 으로 설정하는 것을 권장합니다. 중간 진행은 조용히 쌓이고, 질문·권한 요청·완료·실패만 알림이 옵니다.

### 3. ID 복사

Discord의 `사용자 설정 > 고급 > 개발자 모드`를 켠 뒤 다음 값을 복사해 설치를 맡은 AI 에이전트에게 알려주세요.

| 값 | 복사하는 곳 |
| --- | --- |
| Server/Guild ID | 서버 아이콘 우클릭 → `서버 ID 복사` |
| Operator Role ID | 서버 설정 → 역할 → 역할 메뉴 → `역할 ID 복사` |
| Codex Channel ID | Codex 채널 우클릭 → `채널 ID 복사` |
| Claude Channel ID | Claude 채널 우클릭 → `채널 ID 복사` |

최초 설치에는 Discord Bot Token도 한 번 필요합니다. token은 비밀번호와 같으므로 Discord나 GitHub에 올리지 말고, 설치 중인 로컬 AI 에이전트에만 전달하세요. Public Key와 OAuth2 Client ID는 connector 설정에 넣지 않습니다.

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

### 자주 쓰는 명령

| 명령 | 용도 |
| --- | --- |
| `/chat-new` | 새 Discord 스레드와 agent 세션 만들기 |
| `/status` | 실행 중인지, 질문/권한을 기다리는지, 큐가 몇 개인지 확인 |
| `/steer prompt:<지시>` | 실행 중인 Codex 작업에 즉시 지시 추가 |
| `/queue prompt:<요청>` | 현재 작업 다음에 별도 요청 예약 |
| `/interrupt` | 현재 Codex turn 중단 |
| `/fork` | 현재 세션 맥락을 복제해 새 스레드 만들기 |
| `/howtouse` | agent에게 Discord 파일 전송 규칙 알려주기 |
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

## 현재 가능한 것

- Discord에서 Codex와 Claude Code 세션 생성·재개·fork
- 긴 작업의 중간 설명, 최종 답변, 완료/실패 알림
- Codex 권한 승인 버튼과 사용자 선택 질문
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

## 실행 권한

기본 Direct mode는 개인 자동화 용도로 Codex를 넓은 권한으로 실행합니다.

```text
approval=never
sandbox=danger-full-access
network=enabled
```

Claude Code도 기본적으로 `bypassPermissions`를 사용합니다. 따라서 private Discord와 제한된 Operator 역할이 매우 중요합니다.

권한을 낮추고 싶다면 설치를 맡은 AI 에이전트에게 아래처럼 요청하세요.

```text
Codex 권한을 approval=on-request, sandbox=workspace-write로 낮추고
Discord 권한 승인 버튼이 동작하는지 테스트해줘.
```

OS 권한, macOS 개인정보 보호 설정, Linux 사용자 권한, `sudo`, 컨테이너 GPU 노출은 connector가 우회하지 않습니다.

## 자세한 문서

- [AI Agent Guide: 설치, Discord bot 생성, 코드 구조, 서비스, 운영, 디버깅](docs/AI_AGENT_GUIDE.md)
- [Mac Direct Mode](docs/mac-direct-setup.md)
- [Ubuntu Server Direct Mode](docs/ubuntu-server-direct-setup.ko.md)
- [Operator Guide](docs/operator-guide.md)
- [Security Policy](SECURITY.md)

MIT License.
